const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { resolve, driveConfirmUrl, UA_BROWSER, UA_CURL } = require('./resolvers');

const MAX_BYTES = parseInt(process.env.DL_MAX_MB || '2000', 10) * 1024 * 1024; // WhatsApp document limit ≈ 2 GB
const TMP = process.env.DL_TMP || os.tmpdir();

const human = (b) => !b ? '?' : b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';


// "fetch failed" hides the real reason → show it (and retry once for flaky network errors)
function explainNetErr(e, url) {
    const c = e?.cause?.code || e?.code || '';
    const host = (() => { try { return new URL(url).hostname; } catch { return 'site'; } })();
    const why = {
        ECONNRESET: `${host} server එක connection එක කැපුවා — බොහෝවිට site එක server/datacenter IP block කරනවා`,
        ECONNREFUSED: `${host} connection එක reject කළා`,
        ETIMEDOUT: `${host} වලට connect වෙන්න බැරි වුණා (timeout) — site එක මේ server එක block කරලා වෙන්න පුළුවන්`,
        UND_ERR_CONNECT_TIMEOUT: `${host} වලට connect වෙන්න බැරි වුණා (timeout) — site එක මේ server එක block කරලා වෙන්න පුළුවන්`,
        ENOTFOUND: `${host} හොයාගන්න බෑ (DNS) — server එකේ DNS එක ${host} block කරනවා හෝ link එක වැරදියි`,
        EAI_AGAIN: `DNS error (${host}) — ටිකකින් ආයෙත් try කරන්න`,
        UND_ERR_SOCKET: `${host} connection එක මැදින් කැඩුණා — site එක server IP block කරනවා වෙන්න පුළුවන්`,
        CERT_HAS_EXPIRED: `${host} SSL certificate එක expire වෙලා`,
        UNABLE_TO_VERIFY_LEAF_SIGNATURE: `${host} SSL certificate error`,
    }[c];
    const err = new Error((why || `network error: ${e?.cause?.message || e.message}`) + (c ? ` [${c}]` : ''));
    err.code = c; return err;
}
async function fetchExplained(url, opts) {
    for (let i = 0; ; i++) {
        try { return await fetch(url, opts); }
        catch (e) {
            const c = e?.cause?.code || e?.code || '';
            if (i < 1 && /ECONNRESET|UND_ERR_SOCKET|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(c)) { await new Promise(r => setTimeout(r, 2000)); continue; }
            throw explainNetErr(e, url);
        }
    }
}

function safeName(n) {
    n = String(n || '').replace(/[\/\\?%*:|"<>\x00-\x1f]/g, '_').trim();
    return n.slice(0, 180) || 'file';
}

function nameFromHeaders(h, url) {
    const cd = h.get('content-disposition') || '';
    let m = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/) || cd.match(/filename\s*=\s*"([^"]+)"/) || cd.match(/filename\s*=\s*([^;]+)/);
    if (m) { try { return safeName(decodeURIComponent(m[1].trim())); } catch { return safeName(m[1].trim()); } }
    try { const p = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); if (p) return safeName(p); } catch { }
    return 'file';
}

/** pipe a web/node stream to disk with size cap + progress */
async function streamToFile(stream, dest, total, onProgress) {
    const out = fs.createWriteStream(dest);
    let loaded = 0;
    const started = Date.now();
    await new Promise((res, rej) => {
        stream.on('data', (c) => {
            loaded += c.length;
            if (loaded > MAX_BYTES) { stream.destroy(); out.destroy(); return rej(new Error(`file එක ${human(MAX_BYTES)} ට වඩා ලොකුයි`)); }
            onProgress?.(loaded, total, loaded / Math.max((Date.now() - started) / 1000, 0.5));
        });
        stream.on('error', rej);
        out.on('error', rej);
        out.on('finish', res);
        stream.pipe(out);
    });
    return loaded;
}

async function httpGet(url, ua, referer) {
    const headers = { 'User-Agent': ua, 'Accept': '*/*' };
    if (referer) headers.Referer = referer;
    return fetchExplained(url, { headers, redirect: 'follow' });
}

async function downloadHttp(r, dest, onProgress) {
    let res, ct;
    // try browser UA, then curl UA (some hosts give a "warning page" to browsers, e.g. filebin)
    for (const ua of [UA_BROWSER, UA_CURL]) {
        res = await httpGet(r.url, ua, r.referer);
        ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (res.ok && ct !== 'text/html') break;
        if (res.ok && ct === 'text/html' && r.drive) {
            const next = driveConfirmUrl(await res.text());
            if (next) { res = await httpGet(next, ua); ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); if (res.ok && ct !== 'text/html') break; }
            throw new Error('Google Drive file එක public නෑ (Anyone with the link කරන්න) හෝ download limit එක ඉවරයි');
        }
        if (!res.ok && res.status !== 403) break;
        try { await res.body?.cancel(); } catch { }
    }
    if (!res.ok) throw new Error(`server එකෙන් ${res.status} ආවා (link එක expire වෙලා / private / වැරදියි)`);
    if (ct === 'text/html') { try { await res.body?.cancel(); } catch { } throw new Error('මේ link එකෙන් එන්නේ web page එකක්, file එකක් නෙවෙයි. Direct download link එකක් එවන්න.'); }

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    if (total > MAX_BYTES) { try { await res.body?.cancel(); } catch { } throw new Error(`file එක ${human(total)} — limit එක ${human(MAX_BYTES)}`); }
    const name = nameFromHeaders(res.headers, res.url || r.url);
    const size = await streamToFile(Readable.fromWeb(res.body), dest, total, onProgress);
    return { name, size, mime: ct || 'application/octet-stream' };
}

async function downloadMega(url, destDir, onProgress) {
    const { File } = require('megajs');
    const f = File.fromURL(url);
    try { await f.loadAttributes(); }
    catch (e) { throw new Error(/ENOENT|-9|EKEY|-14|not found/i.test(e.message) ? 'MEGA file එක delete වෙලා හෝ link එකේ key එක වැරදියි (# පස්සේ කොටසත් එක්කම link එක එවන්න)' : 'MEGA error: ' + e.message); }
    const files = f.directory ? (f.children || []).filter(c => !c.directory).slice(0, 10) : [f];
    if (!files.length) throw new Error('MEGA folder එක හිස්');
    const out = [];
    for (const file of files) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} — ${human(file.size)}, limit ${human(MAX_BYTES)}`);
        const dest = path.join(destDir, `mega-${Date.now().toString(36)}-${out.length}`);
        const size = await streamToFile(file.download(), dest, file.size, onProgress);
        out.push({ path: dest, name: safeName(file.name), size, mime: 'application/octet-stream' });
    }
    return out;
}

/** Download any supported link → [{path,name,size,mime}] (caller deletes files) */
async function download(link, onProgress) {
    const r = await resolve(link);
    if (r.kind === 'mega') return downloadMega(r.url, TMP, onProgress);
    const dest = path.join(TMP, `dl-${process.pid}-${Date.now().toString(36)}`);
    try {
        const info = await downloadHttp(r, dest, onProgress);
        return [{ path: dest, ...info }];
    } catch (e) { fs.rm(dest, { force: true }, () => { }); throw e; }
}

module.exports = { explainNetErr, download, human, MAX_BYTES };
