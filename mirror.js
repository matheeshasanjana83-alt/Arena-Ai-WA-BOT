'use strict';
/**
 * mirror.js — KAVIZ MD V1 v2.21 — file / URL → direct share link (relay)
 *
 * UX = අනිත් bots වලගේ /dl/<id>?code= links වගේ: file එකක් upload කරලා
 * browser එකෙන් උනේන direct download link එකක් ගන්නවා (status/grp share).
 *
 * Host chain:
 *   1. qu.ax                  — 30 days, short link (≤ ~950 MB)
 *   2. transfer.archivete.am  — ~7 days / 100 downloads, streams big files (PUT)
 *
 * All uploads go through net.js smartFetch (proxy-pool fallback included).
 */
const fs = require('fs');
const { Readable } = require('stream');

let netMod = null;
try { netMod = require('./net'); } catch { }
const fetchFn = (...a) => (netMod && netMod.smartFetch ? netMod.smartFetch(...a) : fetch(...a));

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const QUAX_MAX = 950 * 1048576;          // qu.ax cap guess → bigger files go straight to transfer
const BUF_MAX = 190 * 1048576;           // buffer-upload ceiling (read whole file to RAM)

const safeName = (n) => encodeURIComponent(String(n || 'file.bin').replace(/[^\w.\-() ]+/g, '_').slice(0, 120));

/** hand-rolled multipart → body is a plain Buffer, reusable across smartFetch route retries
 *  v2.90: field param — qu.ax wants "files[]", gofile/tmpfiles want "file" */
function multipart(buf, name, field = 'files[]') {
    const b = safeName(name);
    const head = Buffer.from('--KV\r\nContent-Disposition: form-data; name="' + field + '"; filename="' + b + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
    const tail = Buffer.from('\r\n--KV--\r\n');
    return { body: Buffer.concat([head, buf, tail]), type: 'multipart/form-data; boundary=KV' };
}

/** qu.ax — POST multipart, returns JSON { files: [{ url }] } */
async function upQuax(buf, name) {
    const mp = multipart(buf, name);
    const r = await fetchFn('https://qu.ax/upload.php', { method: 'POST', body: mp.body, headers: { ...UA, 'Content-Type': mp.type } });
    if (!r.ok) throw new Error('qu.ax HTTP ' + r.status);
    const j = await r.json();
    const u = j && j.files && j.files[0] && j.files[0].url;
    if (!/^https?:\/\//.test(u || '')) throw new Error('qu.ax bad reply');
    return { url: u, host: 'qu.ax', days: 30 };
}

/** transfer.archivete.am — PUT /<name> → plain-text link (Buffer or file path, streams big files)
 *  v2.87: opts passthrough (signal) — callers bound the upload time so a slow/blocked host can
 *  never hang the command forever (.uploadtra 104MB stall fix). */
async function upTransfer(bufOrPath, name, opts = {}) {
    const body = typeof bufOrPath === 'string'
        ? Readable.toWeb(fs.createReadStream(bufOrPath))
        : bufOrPath;
    const r = await fetchFn('https://transfer.archivete.am/' + safeName(name), {
        method: 'PUT', body, duplex: 'half',
        headers: { ...UA, 'Content-Type': 'application/octet-stream' },
        ...opts,
    });
    const t = (await r.text()).trim();
    if (!/^https?:\/\//.test(t)) throw new Error('transfer HTTP ' + r.status + ' ' + t.slice(0, 60));
    const del = r.headers.get('x-url-delete') || null;
    return { url: t, host: 'transfer', days: 7, del };
}

/** gofile.io — v2.90 .uploadgo: guest API (LIVE-PROBED 2026-10-27): GET /servers → store list ok;
 *  POST {server}.gofile.io/contents/uploadfile (multipart field "file") → {downloadPage, guestToken, id}.
 *  Guests can UPLOAD but NOT download via API (contents = error-notPremium, /download/web/ = 302 page,
 *  site wt.obf.js anti-bot token) → card links the browser downloadPage; free files clean after ~10d inactive. */
async function upGofile(buf, name, opts = {}) {
    const mp = multipart(buf, name, 'file');
    const sr = await fetchFn('https://api.gofile.io/servers', { ...opts, headers: { ...UA } });
    if (!sr.ok) throw new Error('gofile servers HTTP ' + sr.status);
    const sj = await sr.json().catch(() => null);
    const sname = sj && sj.data && sj.data.servers && sj.data.servers[0] && sj.data.servers[0].name;
    if (!sname) throw new Error('gofile servers list හිස්');
    const r = await fetchFn('https://' + sname + '.gofile.io/contents/uploadfile', {
        method: 'POST', body: mp.body,
        headers: { ...UA, 'Content-Type': mp.type },
        ...opts,
    });
    const j = await r.json().catch(() => null);
    const d = j && j.data;
    if (!r.ok || !d || !d.downloadPage) throw new Error('gofile HTTP ' + r.status + ' ' + String((j && j.status) || '').slice(0, 40));
    return { url: d.downloadPage, host: 'gofile', days: 10, fileId: d.id || null, guestToken: d.guestToken || null };
}

/** tmpfiles.org — v2.90 .uploadtm: POST /api/v1/upload (field "file") → { data: { url } }.
 *  100 MB cap · files expire in 60 MINUTES (card warns). The /dl/<ts>.<hash>/ direct link is
 *  SINGLE-USE → resolvers.js re-derives it from the page at download time (never cached). */
const TMPFILES_MAX = 100 * 1048576;
async function upTmpfiles(buf, name, opts = {}) {
    if (buf.length > TMPFILES_MAX) throw new Error('tmpfiles 100 MB cap — මේ file එක ලොකු වැඩියි (.uploadgo/.uploadtra use කරන්න)');
    const mp = multipart(buf, name, 'file');
    const r = await fetchFn('https://tmpfiles.org/api/v1/upload', {
        method: 'POST', body: mp.body,
        headers: { ...UA, 'Content-Type': mp.type },
        ...opts,
    });
    if (!r.ok) throw new Error('tmpfiles HTTP ' + r.status);
    const j = await r.json().catch(() => null);
    const u = j && j.data && j.data.url;
    if (!/^https?:\/\/tmpfiles\.org\//.test(u || '')) throw new Error('tmpfiles bad reply');
    return { url: u, host: 'tmpfiles', days: 0.04 };   // ~1h — the command formats this as ⏳ 60 min
}

/** Buffer → best host (qu.ax 30d first, transfer fallback) */
async function uploadBuffer(buf, name) {
    if (buf.length <= QUAX_MAX) { try { return await upQuax(buf, name); } catch { } }
    return await upTransfer(buf, name);
}

/** File on disk → link. Small files try qu.ax first; big files stream PUT to transfer. */
async function uploadFile(filePath, name) {
    let sz = 0;
    try { sz = fs.statSync(filePath).size; } catch { }
    if (sz > 0 && sz <= BUF_MAX) { try { return await upQuax(fs.readFileSync(filePath), name); } catch { } }
    return await upTransfer(filePath, name);
}

module.exports = { uploadBuffer, uploadFile, upQuax, upTransfer, upGofile, upTmpfiles, TMPFILES_MAX, QUAX_MAX, BUF_MAX };
