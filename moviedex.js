'use strict';
/**
 * moviedex.js — .moviedex for KAVIZ MD V1 (v2.28)
 *
 *  Movie + TV-series search & FILE downloads from the MovieBox MOBILE BFF
 *  (the signed wCFeed-mobile-bff API the Android app uses — reverse-engineered from
 *  mesamirh/MovieBox-Tui, verified live 2026-10: movies 1080p + full series with
 *  season/episode streams, guest JWT, zero paywall for these endpoints).
 *
 *  Flow (same reply UX the bot's old movie command had):
 *    .moviedex <නම>            → search (movies + 📺 series) → numbered list
 *    reply අංකය (number reply) → next step — every interactive card registers a "ui"
 *                                ({key, kind, n, rowNo}); bot.js bridges bare numbers via
 *                                bridgeReply(jid, quotedId, digits) → .moviedex … grammar.
 *    .moviedex <n> (movie)     → info card + quality list (1080/720/480/360p + sizes)
 *    .moviedex <n> (series)    → info card + Episodes List (📦 season rows + Season N Episode M)
 *    .moviedex <n> <row#>      → season → 🧳 quality options · episode → 🎬 quality list
 *    .moviedex <n> <row#> <q#> → 🧳 SEASON PACK = files, one per message (cap 50/run + next)
 *                                · 🎬 episode file · 🍿 movie file
 *    … link suffix             → 🔗 mirror share link instead of a WhatsApp file
 *    … next                    → continue pack / episodes page
 *
 *  Delivery pipeline (verified live):
 *    play-info/v2 → streams[].signCookie → base64 urlprefix = DASH dir on
 *    sbcdnN.hakunaymatata.com → index.mpd (Edge-Cache-Cookie + Referer: sportslive.wine)
 *    → fMP4 init + chunk segments (chunk-stream<rep>-<NNNNN>.m4s) downloaded with own
 *    concurrent engine → ffmpeg -c copy mux (video+audio) → WhatsApp document.
 *    stream.url alone is a shared 824 KB notice stub — the signCookie DASH is the real file.
 *
 *  v2.30: ① 360p row — MovieBox DASH ladders stop at 480p (verified 2026-10 across titles),
 *             so "360p" downloads the 480p track and re-encodes locally (x264 veryfast,
 *             audio copy → live progress bar). ② quality menus merge ALL play-info streams
 *             (not just streams[0]) + dedupe duplicate MPD entries. ③ honest progress:
 *             real downloaded bytes, byte-based % in drain mode (no instant fake 99%),
 *             CDN-stall watchdog. ④ WhatsApp upload timeout — one hung 200MB document used
 *             to deadlock the pacer chain and silence the whole bot (the stuck-99% bug).
 *   v2.37 — download SPEED: ① video + audio tracks download in PARALLEL (audio used to wait
 *             for the whole video — free tail time back). ② segment workers 4 → 8 (video) / 6
 *             (audio) — segment CDNs happily serve 6-8 connections per client. ③ ffmpeg mux is
 *             ASYNC now (was execFileSync → the whole bot froze for minutes during mux, so an
 *             episode request sent mid-mux sat unanswered and replayed — users saw it as
 *             "download restarts from the beginning"). The bot stays live during mux.
 *   v2.39 — EPISODE PACKS (the user's edited-screenshot system for LONG shows like Black
 *             Clover 170 eps): series card gains 🧳 12-episode pack rows — 1.1 = S01 EP1-EP12,
 *             1.2 = EP13-EP24 … (seasons with 24+ eps only; short lists stay clean). Reply the
 *             pack number → quality menu → files, one per episode. Episodes keep their integer
 *             numbers (pack rows use S.P labels — numbering never shifts). Season row
 *             ('Download Season (All)') + 'next' 50-cap flow unchanged.
 *   v2.39 — REMOVED the v2.38 '.moviedex <n> <row#> <q#> 70-80' range command (user: broken —
 *             the search ate "70-80" as the query). A trailing "70-80" typed at search level is
 *             now stripped with a hint pointing to the pack rows.
 *   v2.38 — seasonFilesCmd HOOKS test seam (mbPlay/mergedQualities/downloadDash/gap); season
 *             pack 'next' continuation fix (tv.pack.from never advanced → restart from ep 1)
 *             + overflow guard.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { smartFetch } = require('./net');
const { human, maxMB } = require('./downloader');
const { foot, cut, bar } = require('./style');

/** v2.28 brand footer — replaces the old tutorial hint lines (user request) */
const MV_FOOT = '> ＫＡＶＩＺ Ｖ1 🍁';

/* ───────────────── 1. signed MovieBox mobile-BFF client ───────────────── */

const MB_SECRET = Buffer.from('efa891974eecd3148df63aa611602defd101259ba521022c57ae0566bd8e', 'hex');
const MB_HOSTS = ['https://api6.aoneroom.com', 'https://api5.aoneroom.com', 'https://api4.aoneroom.com',
    'https://api4sg.aoneroom.com', 'https://api3.aoneroom.com', 'https://api.inmoviebox.com'];
const STREAM_REFERER = 'https://sportslive.wine';
const md5hex = (b) => crypto.createHash('md5').update(b).digest('hex');

let mbUA = '', mbCI = '', mbIP = '', mbToken = null, mbHostIdx = 0;
const sleepMs = (ms) => new Promise(res => setTimeout(res, ms));

/** random Redmi/Cronet device identity (server rejects known-bad fingerprints) */
function mbIdentity() {
    const ver = ['10', '11', '12', '13'][Math.floor(Math.random() * 4)];
    const build = { 10: 'QP1A.191005.007.A3', 11: 'RP1A.200720.011', 12: 'S1B.220414.015', 13: 'TQ2A.230405.003' }[ver];
    const devs = [['23078RKD5C', 'Redmi'], ['M2012K11AG', 'Redmi'], ['2201117TY', 'Redmi']];
    const [model, brand] = devs[Math.floor(Math.random() * devs.length)];
    const vc = [50020117, 50020118, 50020119][Math.floor(Math.random() * 3)];
    const did = crypto.randomBytes(16).toString('hex');
    const gaid = [8, 4, 4, 4, 12].map(n => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n)).join('-');
    mbUA = `com.community.oneroom/${vc} (Linux; U; Android ${ver}; en_US; ${model}; Build/${build}; Cronet/135.0.7012.3)`;
    mbCI = JSON.stringify({ package_name: 'com.community.oneroom', version_name: '4.0.01.0813.03', version_code: vc, os: 'android', os_version: ver, install_ch: 'ps', device_id: did, install_store: 'ps', gaid, brand, model, system_language: 'en', net: 'NETWORK_WIFI', region: 'US', timezone: 'Asia/Kolkata', sp_code: '40401', 'X-Play-Mode': '2' });
    mbIP = Array.from({ length: 4 }, () => 2 + Math.floor(Math.random() * 253)).join('.');
}
mbIdentity();

/** X-TR-Signature: ts|2|b64(hmac-md5(secret, canonical)) — canonical = METHOD\naccept\nctype\nlen\nts\nmd5(body)\nurl */
function mbHeaders(method, url, body) {
    const ts = Date.now();
    const u = new URL(url);
    const qs = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const canonical = u.pathname + (qs.length ? '?' + qs.map(([k, v]) => `${k}=${v}`).join('&') : '');
    const canon = [method.toUpperCase(), 'application/json', 'application/json',
        body ? String(Buffer.byteLength(body)) : '', String(ts), body ? md5hex(body) : '', canonical].join('\n');
    const sig = crypto.createHmac('md5', MB_SECRET).update(canon).digest('base64');
    const h = {
        'User-Agent': mbUA, Accept: 'application/json', 'Content-Type': 'application/json', Connection: 'keep-alive',
        'x-client-token': `${ts},${md5hex(String(ts).split('').reverse().join(''))}`,
        'x-tr-signature': `${ts}|2|${sig}`,
        'x-client-info': mbCI, 'x-client-status': '0', 'x-forwarded-for': mbIP,
    };
    if (mbToken) h.Authorization = 'Bearer ' + mbToken;
    return h;
}

/** visitor-login → guest JWT (fresh identity each round — some ids get "miss token" 441) */
async function mbLogin(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
        mbIdentity();
        const host = MB_HOSTS[mbHostIdx++ % MB_HOSTS.length];
        const url = host + '/wefeed-mobile-bff/user-api/visitor-login';
        try {
            const r = await fetch(url, { method: 'POST', headers: mbHeaders('POST', url, '{}'), body: '{}', signal: AbortSignal.timeout(15000) });
            if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('HTTP ' + r.status); }
            const j = await r.json();
            const tok = (j.data || {}).token;
            if (tok) { mbToken = tok; return true; }
        } catch { }
        await sleepMs(1200);
    }
    return false;
}

/** signed GET/POST with full fallback: next host → fresh identity → re-login on 441/401 */
async function mbApi(p, bodyObj, tries = 8) {
    let last, fails = 0;
    for (let i = 0; i < tries; i++) {
        const host = MB_HOSTS[mbHostIdx++ % MB_HOSTS.length];
        const url = host + p;
        let body = null, method = 'GET';
        if (bodyObj !== undefined) { body = JSON.stringify(bodyObj); method = 'POST'; }
        try {
            const r = await fetch(url, { method, headers: mbHeaders(method, url, body), body: body || undefined, signal: AbortSignal.timeout(20000) });
            const xu = r.headers.get('x-user');
            if (xu) { try { const t = JSON.parse(xu).token; if (t) mbToken = t; } catch { } }
            if (!r.ok) { const bt = await r.text().catch(() => ''); try { await r.body?.cancel(); } catch { } throw new Error('HTTP ' + r.status + ' ' + bt.slice(0, 50)); }
            const j = await r.json();
            if (j.code !== undefined && j.code !== 0 && j.code !== 200) throw new Error('api ' + j.code + ' ' + String(j.message || '').slice(0, 40));
            return j;
        } catch (e) {
            last = e; fails++;
            if (/HTTP 441|HTTP 401|miss token|UNAUTHORIZED/i.test(String(e.message))) {
                mbToken = null;
                if (!await mbLogin(tries <= 3 ? 2 : 6)) throw new Error('MovieBox re-login fail');   // probes fail FAST — no minute-long login loops
            } else {
                if (fails % 2 === 0) mbIdentity();   // flagged fingerprint → new device
                await sleepMs(900);
            }
        }
    }
    throw new Error('MovieBox API fail: ' + (last?.message || last));
}

/* data adapters (search / details / seasons / streams) */

const mbSubs = (j) => { const out = []; for (const g of ((j.data || {}).results || [])) for (const s of (g.subjects || [])) out.push(s); return out; };
const cleanTitle = (t) => String(t || '').replace(/\s*S\d+(\s*-\s*S\d+)?\s*$/i, '').trim();
const coverUrl = (c) => (typeof c === 'string' ? c : c?.url) || '';
const asArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);

/** search → dedup by subjectId (season-split rows share one id), movies first, 📺 for series */
async function mbSearch(q, n = 10) {
    const j = await mbApi('/wefeed-mobile-bff/subject-api/search/v2', { keyword: String(q || '').trim(), page: 1, perPage: 20, subjectType: 0 });
    const seen = new Map();
    for (const s of mbSubs(j)) {
        const id = String(s.subjectId ?? s.id ?? '');
        if (!id) continue;
        const title = s.title || s.name || '';
        const cur = seen.get(id);
        // keep the cleanest row per id: no trailing "S5", then shorter
        const rank = (x) => (/\s*S\d+(-\s*S\d+)?\s*$/i.test(x.title || '') ? 2 : 0) + String(x.title || '').length / 1000;
        if (!cur || rank(s) < rank(cur)) seen.set(id, s);
    }
    const list = [...seen.values()].map(s => ({
        sid: String(s.subjectId ?? s.id),
        name: cleanTitle(s.title || s.name || 'Unknown'),
        type: Number(s.subjectType ?? s.stype ?? 1) === 2 ? 'series' : 'movie',
        year: String(s.releaseDate || s.year || '').slice(0, 4),
        poster: coverUrl(s.cover ?? s.coverUrl ?? s.poster ?? s.pic),
        rating: s.imdbRatingValue ?? s.rating ?? null,
        raw: s,
    }));
    // relevance first (the API's own order drifts — junk interviews sneak in), movies before series as tiebreak
    const qTokens = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
    const score = (m) => {
        const t = m.name.toLowerCase();
        let hit = 0;
        for (const w of qTokens) if (t.includes(w)) hit++;
        let sc = qTokens.length ? hit / qTokens.length : 0;
        if (t === String(q || '').toLowerCase()) sc += 0.5;      // exact name
        if (t.startsWith(String(q || '').toLowerCase())) sc += 0.15;
        return sc;
    };
    list.sort((a, b) => score(b) - score(a) || (a.type === 'movie' ? 0 : 1) - (b.type === 'movie' ? 0 : 1));
    return list.slice(0, n);
}

/** full details (get) — data IS the subject (flat) · tries=4: card flow stays bounded (no minute-long silence) */
async function mbDetails(sid, tries = 4) {
    const j = await mbApi(`/wefeed-mobile-bff/subject-api/get?subjectId=${sid}`, undefined, tries);
    const d = j.data || {};
    return {
        sid: String(d.subjectId ?? sid),
        name: cleanTitle(d.title || 'Unknown'),
        type: Number(d.subjectType ?? d.stype ?? 1) === 2 ? 'series' : 'movie',
        year: String(d.releaseDate || '').slice(0, 4),
        date: String(d.releaseDate || '').slice(0, 10),
        duration: d.duration || d.durationSeconds ? (typeof d.duration === 'string' ? d.duration : '') : '',
        genres: asArr(d.genre ?? d.genres).slice(0, 4),
        country: d.countryName || '',
        language: d.language || '',
        rating: d.imdbRatingValue ?? d.rating ?? null,
        desc: String(d.description ?? d.intro ?? '').trim(),
        poster: coverUrl(d.cover),
        seNum: d.seNum || null,
    };
}

/** seasons for a series → [{ se, maxEp }] · tries=4 bounded */
async function mbSeasons(sid, tries = 4) {
    const j = await mbApi(`/wefeed-mobile-bff/subject-api/season-info?subjectId=${sid}`, undefined, tries);
    const raw = (j.data || {}).seasons ?? j.data ?? [];
    const arr = Array.isArray(raw) ? raw : (raw.seasons || []);
    return arr.map(s => ({ se: Number(s.se ?? s.season ?? 1), maxEp: Number(s.maxEp ?? (s.episodeNumbers || []).length ?? 0) }))
        .filter(s => s.maxEp > 0).sort((a, b) => a.se - b.se);
}

/** play-info streams for a movie (se/ep empty) or one episode · tries: 8 downloads / 2-3 menus (v2.27 fast-fail)
 *  v2.30: duplicate stream entries pointing at the SAME index.mpd (seen on multi-entry titles) collapse to one */
async function mbPlay(sid, se, ep, tries = 8) {
    const q = se && ep ? `&se=${se}&ep=${ep}` : '';
    const j = await mbApi(`/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=${sid}${q}`, undefined, tries);
    const streams = (j.data || {}).streams || [];
    const out = [], seen = new Set();
    for (const s of streams.filter(s => s.signCookie && (s.url || '').startsWith('http'))) {
        const d = dashFrom(s.signCookie);
        if (d && seen.has(d.mpd)) continue;
        if (d) seen.add(d.mpd);
        out.push(s);
    }
    return out;
}

/* ───────────────── 2. DASH engine (own downloader + ffmpeg mux) ───────────────── */

/** signCookie → { mpd, cookie } (urlprefix b64 = DASH dir; same cookie covers all reps) */
function dashFrom(signCookie) {
    for (const part of String(signCookie || '').split(';')) {
        const t = part.trim();
        const i = t.indexOf('urlprefix=');
        if (i >= 0) {
            const b64 = t.slice(i + 10).split(':')[0].replace(/-/g, '+').replace(/_/g, '/');
            try {
                const url = Buffer.from(b64, 'base64').toString('utf8');
                const base = url.replace(/\*+$/, '').replace(/\/+$/, '');
                if (/^https?:\/\//.test(base) && base.includes('/dash/')) {
                    return { mpd: base + '/index.mpd', cookie: String(signCookie || '').trim().replace(/;+$/, '').split(';').map(s => s.trim()).filter(Boolean).join('; ') };
                }
            } catch { }
        }
    }
    return null;
}

const dashHeaders = (cookie) => ({ 'User-Agent': mbUA, Referer: STREAM_REFERER, Cookie: cookie || '' });

/** parse index.mpd → { video:[{id,h,bw}], audio:{id,bw}|null, durSec, seg:{video:{...},audio:{...}} } */
function parseMpd(txt) {
    const durStr = (txt.match(/mediaPresentationDuration="([^"]+)"/) || [])[1] || '';
    const iso = (s) => {   // PT2H20M50.4S → sec
        const m = String(s).match(/PT?(?:(\d+)H)?(?:(\d+)M)?([\d.]+)?S?$/);
        return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    };
    const durSec = iso(durStr);
    const sets = [...txt.matchAll(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g)].map(m => m[0]);
    const video = [], letAudio = { v: null };
    const mkSeg = (block, inherited) => {
        const tpl = block.match(/<SegmentTemplate[^>]*>/g)?.pop() || inherited || '';
        const attr = (a) => (tpl.match(new RegExp(a + `="([^"]+)"`)) || [])[1] || '';
        return {
            media: attr('media'), init: attr('initialization'),
            dur: +attr('duration') || 0, timescale: +attr('timescale') || 1,
            start: +attr('startNumber') || 1, raw: tpl,
        };
    };
    for (const setS of sets) {
        const isAudio = /contentType="audio"|mimeType="audio\//.test(setS);
        const inherited = setS.match(/<SegmentTemplate[^>]*>/g)?.[0] || '';
        for (const rep of [...setS.matchAll(/<Representation\s[^>]*>/g)].map(m => m[0])) {
            const id = (rep.match(/id="([^"]+)"/) || [])[1];
            const bw = +((rep.match(/bandwidth="(\d+)"/) || [])[1] || 0);
            const h = +((rep.match(/height="(\d+)"/) || [])[1] || 0);
            if (!id) continue;
            const seg = mkSeg(rep.outer || rep, inherited);
            if (isAudio) { if (!letAudio.v || bw > letAudio.v.bw) letAudio.v = { id, bw, seg }; }
            else if (h > 0) video.push({ id, h, bw, seg });
        }
    }
    video.sort((a, b) => b.h - a.h || b.bw - a.bw);
    return { video, audio: letAudio.v, durSec, mpdDur: durStr };
}

/** $RepresentationID$/$Number%05d$ template expand */
const expandTpl = (tpl, rep, n) => String(tpl || '')
    .replace(/\$RepresentationID\$/g, rep)
    .replace(/\$Bandwidth\$/g, '0')
    .replace(/\$Time\$/g, '0')
    .replace(/\$Number(%0(\d+)d)?\$/g, (_, __, w) => (w ? String(n).padStart(+w, '0') : String(n)));

const chunkCount = (seg, durSec) => {
    if (seg.dur > 0) return Math.max(1, Math.ceil((durSec * seg.timescale) / seg.dur));
    return 0;   // unknown → drain mode (download until 404)
};

/** fetch with per-request retry (CDN flakes single chunks) */
async function segFetch(url, cookie, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await smartFetch(url, { headers: dashHeaders(cookie), signal: AbortSignal.timeout(30000) });
            if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); try { await r.body?.cancel(); } catch { } if (buf.length > 16) return buf; }
            else { try { await r.body?.cancel(); } catch { } if (r.status === 404 || r.status === 410) return null; }
        } catch (e) { if (i === tries - 1) return null; }
        await sleepMs(400 + i * 600);
    }
    return null;
}

/** DASH → single file: init+chunks per track (ordered append) → ffmpeg -c copy mux.  maxSegs = safety cap (drain mode / corrupt manifest)
 *  v2.30: man/mpdTxt cached from the menu probe → no second CDN fetch · onProgress(pct, realBytes) ·
 *  honest % (segments when counted, bytes when duration unknown — no instant fake 99%) ·
 *  watchdog: 2 min with zero successful segments → abort with a clear error (was: silent forever). */
async function dashDownload({ mpd, cookie, height, outPath, onProgress, wantSize, maxSegs = 4000, man: manIn, mpdTxt: txtIn }) {
    let txt = txtIn || '', man = manIn || null;
    if (!man || !txt) {
        const r = await smartFetch(mpd, { headers: dashHeaders(cookie), signal: AbortSignal.timeout(30000) });
        if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('DASH manifest HTTP ' + r.status); }
        txt = await r.text();
        try { await r.body?.cancel(); } catch { }
        man = parseMpd(txt);
    }
    const rep = height ? (man.video.find(v => v.h === height) || man.video.find(v => v.h <= height) || man.video[0]) : man.video[0];
    if (!rep) throw new Error('manifest එකේ video tracks නෑ');
    const audio = man.audio;

    const tmp = path.join(process.env.DL_TMP || os.tmpdir(), 'moviedex-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(tmp, { recursive: true });
    const vFile = path.join(tmp, 'v.m4s'), aFile = audio ? path.join(tmp, 'a.m4s') : null;
    const base = mpd.replace(/index\.mpd.*$/, '');

    const counts = { v: chunkCount(rep.seg, man.durSec), a: audio ? chunkCount(audio.seg, man.durSec) : 0 };
    const estBytes = ((rep.bw + (audio ? audio.bw : 0)) * man.durSec) / 8 || wantSize || 0;

    let done = { v: 0, a: 0 }, bytes = { v: 0, a: 0 }, stop = false, stalled = false, drainOver = false;
    let lastSegAt = Date.now();
    const totalSegs = counts.v + counts.a || 0;
    const pctNow = () => {
        const t = done.v + done.a;
        if (totalSegs > 0) return Math.min(95, Math.floor(t * 100 / totalSegs));   // counted → segments; cap 95 (99 = post-download only)
        const got = bytes.v + bytes.a;                                             // drain (duration unknown) → real bytes vs estimate
        if (estBytes > 0 && got > 1048576) return Math.min(95, Math.floor(got * 100 / estBytes));
        return 0;
    };
    const wd = setInterval(() => { if (Date.now() - lastSegAt > 120e3) { stalled = true; stop = true; } }, 15000);
    const grab = async (kind, seg, repId, count, file) => {
        const fd = fs.openSync(file, 'a');
        try {
            const init = await segFetch(base + expandTpl(seg.init || 'init-stream$RepresentationID$.m4s', repId, 0), cookie);
            if (!init) throw new Error('init segment fail');
            fs.writeSync(fd, init);
            bytes[kind] += init.length;
            const cap = Math.min(count || maxSegs, maxSegs);
            const queue = Array.from({ length: cap }, (_, i) => seg.start + i);
            const results = new Map();
            let nextToWrite = seg.start, cursor = 0, got404 = 0;
            const workers = Array.from({ length: kind === 'v' ? 8 : 6 }, async () => {   // v2.37: was 4
                while (!stop) {
                    if (count === 0 && estBytes > 0 && bytes.v + bytes.a > estBytes * 3) { drainOver = true; stop = true; return; }   // v2.30 runaway guard
                    const idx = cursor < queue.length ? queue[cursor++] : null;
                    if (idx == null) return;
                    const buf = await segFetch(base + expandTpl(seg.media, repId, idx), cookie);
                    if (buf == null) { got404++; results.set(idx, null); continue; }   // missing chunk → skip (drain tolerated)
                    results.set(idx, buf);
                    lastSegAt = Date.now();
                    // ordered flush
                    while (results.has(nextToWrite)) {
                        const b = results.get(nextToWrite);
                        results.delete(nextToWrite);
                        if (b) { fs.writeSync(fd, b); bytes[kind] += b.length; }
                        done[kind]++;
                        nextToWrite++;
                    }
                    if (count === 0 && got404 > 2 && results.size === 0 && nextToWrite > seg.start) return;   // drain end
                    if (onProgress) {
                        const t = done.v + done.a;
                        if (t % 3 === 0) onProgress(pctNow(), bytes.v + bytes.a);
                    }
                }
            });
            await Promise.all(workers);
        } finally { fs.closeSync(fd); }
        if (fs.statSync(file).size < 1024) throw new Error('segments download fail');
    };

    try {
        // v2.37: both tracks at once — audio is ~10% of the bytes but used to cost its
        // full download time AFTER video finished; parallel = tail time gone.
        await Promise.all([
            grab('v', rep.seg, rep.id, counts.v, vFile),
            audio ? grab('a', audio.seg, audio.id, counts.a, aFile) : Promise.resolve(),
        ]);
        clearInterval(wd);
        if (stalled) throw new Error('CDN stall — තත්පර 120ක් segment එකක්වත් ආවේ නෑ');
        if (drainOver) throw new Error('manifest size mismatch — download 3× ලොකු වෙලා, abort');
        if (onProgress) onProgress(99, bytes.v + bytes.a);
        // mux — hevc → mkv (players ok), h264 → mp4
        const ffmpeg = await require('./media').getBin('ffmpeg').catch(() => null);
        if (!ffmpeg) throw new Error('ffmpeg නෑ — Termux: pkg install ffmpeg · panel: restart (auto download)');
        const hevc = /hev1|hvc1|hevc/i.test(txt);
        const out = hevc && !outPath.endsWith('.mkv') ? outPath.replace(/\.[a-z0-9]+$/i, '.mkv') : outPath;
        // v2.37: execFile (async) — execFileSync blocked the EVENT LOOP for the whole mux
        // (minutes on a weak CPU): messages queued, sockets idle, parallel episode requests
        // replayed after unfreeze → "everything restarts from the beginning" feeling.
        const { execFile } = require('child_process');
        const runFF = (a) => new Promise((res, rej) => execFile(ffmpeg, a,
            { timeout: 15 * 60e3, maxBuffer: 8 * 1024 * 1024 }, (er) => (er ? rej(er) : res())));
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-i', vFile];
        if (audio && fs.statSync(aFile).size > 1024) args.push('-i', aFile);
        args.push('-c', 'copy', '-movflags', '+faststart', out);
        try { await runFF(args); }
        catch (e) {
            if (audio) {   // audio track broken → video-only retry
                await runFF(['-y', '-hide_banner', '-loglevel', 'error', '-i', vFile, '-c', 'copy', '-movflags', '+faststart', out]);
            } else throw e;
        }
        if (!fs.existsSync(out) || fs.statSync(out).size < 100 * 1024) throw new Error('mux output එක හිස්');
        if (onProgress) onProgress(100, fs.statSync(out).size);
        return { path: out, bytes: fs.statSync(out).size, hevc };
    } finally {
        clearInterval(wd);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    }
}

/** v2.30 — 360p re-encode (source ladders stop at 480p): x264 veryfast, audio copy when the
 *  stream is mp4-friendly, one AAC fallback. -progress pipe:1 → live % via onProgress. */
async function transcode360(inp, outPath, { durSec = 0, onProgress, edit } = {}) {
    const ffmpeg = await require('./media').getBin('ffmpeg').catch(() => null);
    if (!ffmpeg) throw new Error('ffmpeg නෑ — 360p re-encode කරන්න බෑ. Termux: pkg install ffmpeg · panel: restart (auto download)');
    const { spawn } = require('child_process');
    const run = (aEnc) => new Promise((res, rej) => {
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', inp,
            '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-maxrate', '450k', '-bufsize', '900k',
            '-c:a', aEnc, ...(aEnc === 'aac' ? ['-b:a', '128k'] : []), '-movflags', '+faststart', outPath];
        const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let buf = '', err = '';
        p.stdout.on('data', (d) => {
            buf = (buf + d).slice(-512);
            const m = buf.match(/out_time_us=(\d+)/) || buf.match(/out_time_ms=(\d+)/);   // ffmpeg: both µs (quirk)
            if (m) {
                buf = '';
                if (durSec > 0 && onProgress) onProgress(Math.min(99, Math.floor((+m[1] / 1e6) * 100 / durSec)));
            }
        });
        p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
        const killT = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } }, 45 * 60e3);
        p.on('close', (code) => {
            clearTimeout(killT);
            const ok = code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 100 * 1024;
            if (ok) return res(fs.statSync(outPath).size);
            rej(new Error('360p re-encode fail' + (err.trim() ? ': ' + err.trim().split('\n').pop().slice(0, 80) : ` (exit ${code})`)));
        });
        p.on('error', (e) => { clearTimeout(killT); rej(new Error('ffmpeg spawn fail: ' + e.message)); });
    });
    try {
        return await run('copy');
    } catch (e) {
        try { fs.rmSync(outPath, { force: true }); } catch { }
        if (edit) { try { await edit('⚙️ 360p re-encode · audio AAC…'); } catch { } }
        return await run('aac');   // audio codec not mp4-friendly → re-encode audio once
    }
}

/** v2.30 — one quality row → final file. Shared by movie/episode/season flows:
 *  DASH download (cached manifest) [+ 360p re-encode when row.transcode]. Files live in a
 *  per-run tmpDir so the WhatsApp filename stays CLEAN (the old flow appended -<timestamp>). */
async function downloadDash(row, { tmpDir, finalName, onProgress, edit }) {
    fs.mkdirSync(tmpDir, { recursive: true });
    const rawPath = row.transcode ? path.join(tmpDir, 'src-' + Date.now() + '.mkv') : path.join(tmpDir, finalName);
    const res = await dashDownload({
        mpd: row.dash.mpd, cookie: row.dash.cookie, height: row.transcode ? row.srcH : row.h,
        outPath: rawPath, onProgress, wantSize: (row.sizeMB || 0) * 1048576,
        man: row.man || null, mpdTxt: row.mpdTxt || null,
    });
    if (!row.transcode) return res;
    const finalPath = path.join(tmpDir, finalName);
    const bytes = await transcode360(res.path, finalPath, { durSec: row.man?.durSec || 0, onProgress, edit });
    try { fs.rmSync(res.path, { force: true }); } catch { }
    return { path: finalPath, bytes, hevc: false };
}

/* ───────────────── 3. sessions + message builders ───────────────── */

const SESSION_TTL = 15 * 60e3;
const UI_TTL = 10 * 60e3;
const EP_PAGE_ROWS = 200;       // rows per message — v2.27: FULL menu (all seasons + episodes) in ONE message for any normal series
const SEASON_FILE_CAP = 50;     // episode files per pack run ('next' continues)
const EP_PACK_SIZE = 12;        // v2.39: episodes per pack row (1.1 = EP1-12, 1.2 = EP13-24 …)
const EP_PACK_MIN = 24;         // v2.39: pack rows only for 24+ ep seasons (short lists stay clean)
const EP_SEND_GAP = 5000;       // pause between episode sends
const PACK_LINK_CAP = 40;       // mirror links per pack message
const sessions = new Map();     // jid → { list, at, mv:{n:...}, tv:{n:...}, ui }
let HOOKS = null;               // v2.38 test seam — offline tests inject fake mbPlay/mergedQualities/downloadDash/gap

const hasSession = (jid) => { const s = sessions.get(jid); return !!(s && Date.now() - s.at < SESSION_TTL && s.list?.length); };

/** remember interactive cards (bare-number replies route by these) — v2.28: keep the last
 *  8 cards, not just the newest: the user replies to the SERIES CARD after a quality menu
 *  replaced s.ui, and the old single-ui bridge fell through to the search-list pick (1-10) error. */
function setUi(s, sent, kind, n, rowNo) {
    const key = sent?.key?.id || (typeof sent?.key === 'string' ? sent.key : null);
    s.ui = { key, kind, n: n ?? null, rowNo: rowNo ?? null, at: Date.now() };
    if (key) s.cards = [{ key, kind, n: s.ui.n, rowNo: s.ui.rowNo, at: s.ui.at },
        ...(s.cards || []).filter((c) => c.key !== key)].slice(0, 8);
}

/** mpd-derived quality rows: [{ h, bw, label, sizeMB }] */
function repRows(man, durSec) {
    return man.video.map(v => {
        const sizeMB = Math.round(((v.bw + (man.audio ? man.audio.bw : 0)) * durSec / 8) / 1048576);
        return { h: v.h, bw: v.bw, label: `${v.h}p`, sizeMB };
    });
}

/** quality rows for a stream (play-info → mpd; falls back to resolutions string + scaled sizes)
 *  v2.30: returns txt (raw mpd) too — rows cached downstream, dashDownload never re-fetches */
async function streamQualities(st) {
    const d = dashFrom(st.signCookie);
    if (!d) return null;
    try {
        const r = await smartFetch(d.mpd, { headers: dashHeaders(d.cookie), signal: AbortSignal.timeout(30000) });
        if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('mpd HTTP ' + r.status); }
        const txt = await r.text();
        try { await r.body?.cancel(); } catch { }
        const man = parseMpd(txt);
        const rows = repRows(man, man.durSec);
        if (!rows.length) return null;
        return { dash: d, man, rows, txt };
    } catch {
        // mpd unreachable → honest list from the resolutions string, sizes scaled from stream.size
        const top = Math.max(...String(st.resolutions || '720').split(',').map(x => +x || 0));
        const rows = String(st.resolutions || '').split(',').map(x => +x).filter(Boolean).sort((a, b) => b - a)
            .map(h => ({ h, bw: 0, label: `${h}p`, sizeMB: st.size ? Math.round((Number(st.size) * Math.pow(h / top, 1.6)) / 1048576) : null }));
        return rows.length ? { dash: d, man: null, rows, txt: null } : null;
    }
}

/** v2.30 — quality rows across ALL play-info streams (not just streams[0]): MPD-dedupe, best
 *  bandwidth per height, then a synthetic "360p" re-encode row appended (MovieBox DASH ladders
 *  stop at 480p — verified 2026-10; the app's player shows its own ABR, no 360 file exists).
 *  Every row carries { dash, man, mpdTxt } so the actual download skips the second MPD fetch. */
async function mergedQualities(streams) {
    const picks = [];
    const seen = new Set();
    for (const st of (streams || []).slice(0, 4)) {
        const d = dashFrom(st?.signCookie);
        if (!d || seen.has(d.mpd)) continue;
        seen.add(d.mpd);
        picks.push(st);
    }
    const byH = new Map();
    await Promise.all(picks.map(async (st) => {
        const q = await streamQualities(st).catch(() => null);
        if (!q) return;
        for (const r of q.rows) {
            const cur = byH.get(r.h);
            if (!cur || (r.bw || 0) > (cur.bw || 0)) byH.set(r.h, { ...r, dash: q.dash, man: q.man || null, mpdTxt: q.txt || null });
        }
    }));
    const rows = [...byH.values()].sort((a, b) => b.h - a.h || (b.bw || 0) - (a.bw || 0));
    if (rows.length && !byH.has(360)) {
        const cands = rows.filter(r => r.h <= 720);
        const src = cands[cands.length - 1];   // lowest real rep ≤ 720 (usually the 480p)
        if (src) {
            let estMB = 0;
            if (src.man?.durSec && src.bw) estMB = Math.round(((src.bw * 0.6 + (src.man.audio?.bw || 128000)) * src.man.durSec / 8) / 1048576);
            if (!estMB || !Number.isFinite(estMB)) estMB = Math.round((src.sizeMB || 0) * 0.7);
            rows.push({ h: 360, bw: 0, label: '360p', sizeMB: Math.max(1, estMB), transcode: true, srcH: src.h, dash: src.dash, man: src.man, mpdTxt: src.mpdTxt });
        }
    }
    return rows;
}

function listText(q, list) {
    return `🎬 *MovieDex — "${cut(q, 40)}"*\n\n` + list.map((m, i) =>
        `*${i + 1}.* ${m.type === 'series' ? '📺 ' : ''}${cut(m.name, 58)}${m.year ? ' (' + m.year + ')' : ''}${m.rating ? '  ⭐' + m.rating : ''}`).join('\n')
        + `\n${MV_FOOT}`;
}

function cardText(m, n, rows) {
    const desc = String(m.desc || '').trim().slice(0, 360) || '—';
    const out = [`🎬 *${m.name}*${m.year ? ` (${m.year})` : ''}`,
        `⭐ ${m.rating || '—'}/10 IMDb${m.duration ? '  •  ⏱ ' + m.duration : ''}`,
        m.genres?.length ? `🎭 ${m.genres.join(', ')}` : '',
        m.language ? `🗣 ${m.language}` : '', '', `📝 ${desc}`, ''];
    if (rows && rows.length) {
        out.push('', '» Download Options 🎬');
        rows.forEach((r, i) => out.push(`*${i + 1}* | 🎥 ${r.label}${r.sizeMB ? ' · ~' + human(r.sizeMB * 1048576) : ''}`));
        out.push('', MV_FOOT);
    } else {
        out.push('', '⚠️ මේ title එකට download streams නෑ');
    }
    return out.filter(Boolean).join('\n');
}

async function sendCard(send, jid, msg, m, n, rows) {
    const text = cardText(m, n, rows);
    try {
        if (!m.poster) throw new Error('no poster');
        return await send(jid, { image: { url: m.poster }, caption: text.slice(0, 1000) }, { quoted: msg });
    } catch {
        return await send(jid, { text }, { quoted: msg });
    }
}

/** session rows for a series — v2.39: 📦 season rows + 🧳 12-ep PACK rows (1.1 = EP1-EP12 …,
 *  only for 24+ ep seasons) interleaved with episode rows. `no` = the printed integer number;
 *  pack rows take NO integer (S.P labels) so episode numbering NEVER shifts (WYSIWYG). */
function tvRows(seasons) {
    const rows = [];
    let no = 0;
    for (const se of seasons) {
        rows.push({ kind: 'season', no: ++no, season: se.se, maxEp: se.maxEp });
        for (let e = 1; e <= se.maxEp; e++) {
            if (se.maxEp >= EP_PACK_MIN && (e - 1) % EP_PACK_SIZE === 0) {
                rows.push({ kind: 'pack', label: se.se + '.' + (Math.floor((e - 1) / EP_PACK_SIZE) + 1), season: se.se, from: e, to: Math.min(se.maxEp, e + EP_PACK_SIZE - 1) });
            }
            rows.push({ kind: 'ep', no: ++no, season: se.se, ep: e });
        }
    }
    return rows;
}

const epLabel = (r) => `Season ${r.season} Episode ${r.ep}`;

function seriesText(m, n, rows, pageIdx) {
    const out = [`🍀 *${cut(m.name, 58)}*${m.year ? ` (${m.year})` : ''}`,
        `📅 ${m.date || m.year || '—'}${m.duration ? '  ·  ⏱ ' + m.duration : ''}  ·  ⭐ ${m.rating || '—'} IMDb`,
        m.genres?.length ? `🎭 ${m.genres.join(', ')}` : '',
        m.country ? `🌍 ${m.country}` : '',
        '', `📝 _${String(m.desc || '—').trim().slice(0, 320)}_`, ''];
    const start = pageIdx * EP_PAGE_ROWS;
    const page = rows.slice(start, start + EP_PAGE_ROWS);
    if (!page.length) out.push('ℹ️ තව episodes නෑ');
    page.forEach((r) => {
        out.push(r.kind === 'season'
            ? `*${r.no}* | 📦 Download Season ${r.season} (All Episodes)`
            : r.kind === 'pack'
                ? `*${r.label}* | 🧳 S${String(r.season).padStart(2, '0')} EP${r.from}-EP${r.to} ✅`
                : `*${r.no}* | ${epLabel(r)}`);
    });
    const more = start + EP_PAGE_ROWS < rows.length;
    out.push('', MV_FOOT);
    if (more) out.push(`> *.moviedex ${n} next* — ඊළඟ page`);
    return out.filter(Boolean).join('\n');
}

async function sendSeriesCard(send, jid, msg, m, n, rows, pageIdx = 0) {
    const text = seriesText(m, n, rows, pageIdx);
    try {
        if (!m.poster) throw new Error('no poster');
        return await send(jid, { image: { url: m.poster }, caption: text.slice(0, 9999) }, { quoted: msg });   // v2.27: full menu fits
    } catch {
        return await send(jid, { text }, { quoted: msg });
    }
}

function seasonOptText(m, n, rowNo, season, rows, packRange) {
    const out = [packRange
        ? `🧳 *SELECT DOWNLOAD OPTION — S${String(season).padStart(2, '0')} ${packRange}*`
        : `🧳 *SELECT DOWNLOAD OPTION FOR SEASON ${season}*`,
        `🍀 ${cut(m.name, 46)}`, '',
        packRange ? '» Video Qualities (Pack Episodes) 👇' : '» Video Qualities (All Episodes) 👇'];
    rows.forEach((r, i) => out.push(`*${i + 1}* | 🎥 ${r.label}${r.sizeMB ? ' · ~' + human(r.sizeMB * 1048576) + '/ep' : ''}`));
    out.push('', `> *.moviedex ${n} ${rowNo} <q#>* — ${packRange ? 'pack එකේ files (එක පාරට)' : 'season files (50 බැගින් · next)'}`, '', MV_FOOT);
    return out.join('\n');
}

function epFileName(show, season, ep, h, hevc) {
    const s = String(show || 'Show').replace(/[\\/:*?"<>|.]/g, '').slice(0, 48) || 'Show';
    return `${s} S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')} [${h || 'orig'}p].${hevc ? 'mkv' : 'mp4'}`;
}

function epCaption(show, season, ep, h, done, total, fail) {
    return `🎬 *${cut(show, 58)} S${season}E${ep}*\n⚡ Quality: ${h || 'best'}p\n${foot(`Season ${season} · ${done}/${total}${fail ? ' · ⚠️ ' + fail : ''}`)}`;
}

function packStat(show, season, ok, fail, at, total, note) {
    return `🧳 *${cut(show, 50)}* — Season ${season}\n✅ ${ok}  ⚠️ ${fail}  ·  ${at}/${total}${note ? '\n' + note : ''}`;
}

/* ───────────────── 4. delivery (file / mirror link) ───────────────── */

/** one quality row → WhatsApp document (or mirror link) — v2.30: row carries { dash, man, mpdTxt,
 *  transcode? } resolved by mergedQualities → no re-probe, real-byte progress, clean filename,
 *  360p rows re-encode locally. st (optional) only as a defensive fallback. */
async function deliverStream(send, jid, msg, { st, qrow, fname, capTitle, capMeta, linkMode, react, status, edit, show, season, ep }) {
    if ((!qrow || !qrow.dash) && st) {
        const q = await streamQualities(st).catch(() => null);
        if (q?.rows?.length) qrow = { ...q.rows[0], dash: q.dash, man: q.man || null, mpdTxt: q.txt || null };
    }
    if (!qrow || !qrow.dash) { react?.('❌'); await edit('❌ streams decode කරන්න බැරි වුණා — ටිකකින් ආයෙත් try'); return; }
    const row = qrow;
    const mb = row.sizeMB || null;
    if (mb && mb > maxMB()) {
        await edit(`📦 ~${human(mb * 1048576)} — limit එක ${human(maxMB() * 1048576)}\n> අඩු quality එකක් try කරන්න හෝ *.maxmb* වෙනස් කරන්න`);
        return;
    }
    const isEp = season && ep;
    const est = mb ? mb * 1048576 : 0;
    const finalName = isEp ? epFileName(show, season, ep, row.h, !row.transcode)
        : (fname || `MovieDex [${row.label}].${row.transcode ? 'mp4' : 'mkv'}`);
    let last = 0;
    const onProgress = (pct, realBytes) => {
        const now = Date.now();
        if (now - last < 8000) return;
        last = now;
        const shown = realBytes || Math.round(est * pct / 100);
        edit(`⬇️ ${row.transcode ? row.srcH + 'p → ' : ''}${row.label}\n${bar(pct)} ${pct}%\n${human(shown)}${est ? ' / ~' + human(est) : ''}`);
    };
    try {
        await edit(`⬇️ ${row.label} · ${est ? '~' + human(est) + ' · ' : ''}download…`);
        const tmpDir = path.join(process.env.DL_TMP || os.tmpdir(), 'mdx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
        const res = await downloadDash(row, { tmpDir, finalName, onProgress, edit });
        const f = { path: res.path, name: finalName, size: res.bytes };
        if (linkMode) {
            await edit(`🪞 upload… (${human(f.size)})`);
            const rel = await require('./mirror').uploadFile(f.path, f.name);
            react?.('✅');
            await edit(`🔗 *${cut(show || capTitle || 'MovieDex', 80)}*\n${rel.url}\n${foot(`${human(f.size)} · ${row.label} · ${rel.days}d (${rel.host}) · public`)}`);
        } else {
            await edit(`📤 WhatsApp… (${human(f.size)})`);
            await send(jid, {
                document: { url: f.path }, fileName: f.name,
                mimetype: f.name.endsWith('.mp4') ? 'video/mp4' : 'video/x-matroska',
                caption: isEp ? epCaption(show, season, ep, row.h, 1, 1, 0) : `${capTitle}\n${foot(capMeta || human(f.size))}`,
            }, { quoted: msg });
        }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
        if (!linkMode) { try { await send(jid, { delete: status.key }); } catch { } react?.('✅'); }
    } catch (e) {
        react?.('❌');
        await edit(`❌ ${cut(String(e.message || ''), 150)}\n> ආයෙත් try · වෙන quality එකක් · නැත්නම් *.moviedex <n> <q#> link*`);
    }
}

/** .moviedex <n> <q#> [link] → movie file — v2.30: card-time merged rows + fresh re-resolve */
async function movieFileCmd(send, jid, msg, m, qi, cardRows, streams, linkMode, react) {
    const status = await send(jid, { text: `🎯 quality ${qi} · resolve…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    const cardRow = (cardRows || [])[qi - 1];
    if (!cardRow) return edit(`❌ ${qi} — quality නෑ (1-${(cardRows || []).length || '?'})`);
    let qrow = cardRow;   // fresh dash beats cached; card row is the fallback
    try {
        const fresh = streams?.length ? await mergedQualities(streams) : [];
        qrow = fresh.find(r => r.h === cardRow.h) || cardRow;
    } catch { }
    await deliverStream(send, jid, msg, {
        qrow, linkMode, react, status, edit,
        fname: `${String(m.name).replace(/[\\/:*?"<>|.]/g, '').slice(0, 60)} [${qrow.label}].${qrow.transcode ? 'mp4' : 'mkv'}`,
        capTitle: `🎬 *${cut(m.name, 90)}*${m.year ? ` (${m.year})` : ''}`,
        capMeta: `${qrow.sizeMB ? '~' + human(qrow.sizeMB * 1048576) + ' · ' : ''}${qrow.label} · ⭐ ${m.rating || '—'}`,
        show: m.name,
    });
}

/** .moviedex <n> <row#> <q#> [link] → single episode file (qRows = the quality list shown on the card)
 *  v2.30: fresh play-info + merged rows at send time; chosen row (with its dash) goes straight in */
async function episodeFileCmd(send, jid, msg, m, row, qi, qRows, linkMode, react) {
    const status = await send(jid, { text: `🎯 ${epLabel(row)} · resolve…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    const chosen = (qRows || [])[qi - 1];
    if (!chosen) return edit(`❌ ${qi} — quality නෑ (1-${(qRows || []).length || '?'})`);
    try {
        const streams = await mbPlay(m.sid, row.season, row.ep);
        if (!streams.length) { react?.('❌'); return edit(`❌ ${epLabel(row)} — streams නෑ\n> වෙන episode එකක් try`); }
        const fresh = await mergedQualities(streams).catch(() => []);
        const qrow = fresh.find(r => r.h === chosen.h) || chosen;
        await deliverStream(send, jid, msg, { qrow, linkMode, react, status, edit, show: m.name, season: row.season, ep: row.ep });
    } catch (e) {
        react?.('❌');
        await edit(`❌ ${cut(String(e.message || ''), 140)}`);
    }
}

/** .moviedex <n> <seasonRow#> <q#> [next] → season pack as FILES, one per message */
async function seasonFilesCmd(send, jid, msg, m, season, maxEp, qNo, height, from, react, toEp = 0, nextHint = null) {
    const total = maxEp;
    if (!total) return send(jid, { text: `❌ Season ${season} — episodes නෑ` }, { quoted: msg });
    const isRange = toEp > 0;   // v2.39: bounded pack download (from = first-1, toEp = last inclusive)
    const playFn = (HOOKS && HOOKS.mbPlay) || mbPlay;
    const mqFn = (HOOKS && HOOKS.mergedQualities) || mergedQualities;
    const dlFn = (HOOKS && HOOKS.downloadDash) || downloadDash;
    const gap = (HOOKS && HOOKS.gap) ?? EP_SEND_GAP;
    const show = cut(m.name, 50);
    const startTxt = isRange
        ? `🧳 *${cut(m.name, 50)}* — Season ${season} · EP${from + 1}-EP${Math.min(total, toEp)} Pack\n\nEpisodes: ${from + 1}–${Math.min(total, toEp)} / ${total}\nQuality: ${height || 'best available'}`
        : from > 0
        ? `🧳 *Continuing Season ${season} Download* — ${cut(m.name, 50)}\n\nEpisodes: ${from + 1}–${Math.min(total, from + SEASON_FILE_CAP)} / ${total}\nQuality: ${height || 'best available'}`
        : `🧳 *Starting Season ${season} Download* for ${cut(m.name, 50)}…\n\nTotal Episodes: ${total}\nQuality: ${height || 'best available'}`;
    const status = await send(jid, { text: startTxt + '\n' + foot('episode එකින් එක එවනවා — stop කරන්න නම් මට කියන්න') }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    const end = Math.min(total, isRange ? toEp : from + SEASON_FILE_CAP);   // v2.38: range-aware
    let ok = 0, fail = 0, lastEdit = 0;
    for (let ep = from + 1; ep <= end; ep++) {
        const tag = `S${season}E${ep}`;
        const tmpDir = path.join(process.env.DL_TMP || os.tmpdir(), 'mdx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
        try {
            const streams = await playFn(m.sid, season, ep);
            if (!streams.length) throw new Error('streams නෑ');
            const per = async (pct, bytes) => {
                const now = Date.now();
                if (now - lastEdit < 9000) return;
                lastEdit = now;
                edit(`⬇️ ${tag} · ${bar(pct)} ${pct}%\n✅ ${ok}  ⚠️ ${fail}  ·  ${ep}/${total}`);
            };
            const rows = await mqFn(streams).catch(() => []);
            if (!rows.length) throw new Error('qualities නෑ');
            const row = height ? (rows.find(r => r.h === height) || rows.find(r => r.h <= height && !r.transcode) || rows[rows.length - 1]) : rows[0];
            if (row.sizeMB && row.sizeMB > maxMB()) {
                fail++;
                await send(jid, { text: `⚠️ ${tag} — ~${human(row.sizeMB * 1048576)} limit එකට වඩා ලොකුයි (*.maxmb*)` }, { quoted: msg });
                continue;
            }
            const finalName = epFileName(m.name, season, ep, row.h, !row.transcode);
            const res = await dlFn(row, { tmpDir, finalName, onProgress: per, edit });
            await send(jid, {
                document: { url: res.path }, fileName: finalName,
                mimetype: finalName.endsWith('.mp4') ? 'video/mp4' : 'video/x-matroska',
                caption: epCaption(m.name, season, ep, row.h, ok + 1, total, fail),
            }, { quoted: msg });
            ok++;
        } catch (err) {
            fail++;
            console.log('[moviedex] ' + tag + ' fail: ' + cut(String(err.message || ''), 160));
            await send(jid, { text: `⚠️ ${tag} — ${cut(String(err.message || ''), 90)}\n> මේ එක skip කළා` }, { quoted: msg });
        }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
        await edit(packStat(show, season, ok, fail, ep, total));
        if (ep < end) await sleepMs(gap);
    }
    react?.(ok ? '✅' : '❌');
    if (end < total) {
        await edit(`⏸ Season ${season} — ${end}/${total} යවලා ඉවර්\n✅ ${ok}  ⚠️ ${fail}${nextHint ? '\n> ඉතුරු ටිකට — ' + nextHint : ''}`);
        return;
    }
    try { await send(jid, { delete: status.key }); } catch { }
    if (fail) await send(jid, { text: `🧳 Season ${season} — ✅ ${ok} · ⚠️ ${fail} fail\n> fail වූ ඒවා ආයෙත් ඕනෙ නම් single episode විදිහට try කරන්න` }, { quoted: msg });
}

/* ───────────────── 5. bridge + command handler ───────────────── */

/** bot.js bridges a bare-number reply here → full .moviedex grammar (or null → not ours) */
function bridgeReply(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s || !s.list?.length) return null;
    const raw = String(digits ?? '').trim();   // v2.39: pack tokens ("1.1") ride through raw
    const d = parseInt(raw, 10);
    if (!Number.isFinite(d)) return null;
    if (!hasSession(jid)) {   // v2.27: recently-expired session (≤30 min) still routes → user gets the "expire" hint, never silence
        if (Date.now() - (s.at || 0) > SESSION_TTL + 30 * 60e3) return null;
        return `.moviedex ${d}`;
    }
    const route = (c) => {
        if (!c || !c.kind) return `.moviedex ${d}`;
        if (c.kind === 'movie') return `.moviedex ${c.n} ${d}`;
       if (c.kind === 'tv') return `.moviedex ${c.n} ${raw}`;   // row token — "14" or pack "1.1" (WYSIWYG)
        if (c.kind === 'season') return `.moviedex ${c.n} ${c.rowNo} ${d}`;
        if (c.kind === 'ep') return `.moviedex ${c.n} ${c.rowNo} ${d}`;
        return `.moviedex ${d}`;   // list → search-list pick
    };
    if (qid) {   // v2.28: match ANY of the recent cards (series card, quality menus…), not just the newest
        const hit = (s.cards || []).find((c) => c.key && String(c.key) === String(qid) && Date.now() - c.at < SESSION_TTL);
        if (hit) return route(hit);
    }
    if (!qid && s.ui?.kind && Date.now() - s.ui.at < UI_TTL) return route(s.ui);   // bare number, no quote → newest card
    return `.moviedex ${d}`;   // fallback: search-list pick
}

async function handle(c, ctx) {
    if (c !== '.moviedex' && c !== '.mdx') return false;
    const { send, jid, msg, rest, react } = ctx;
    const arg = rest.join(' ').trim();
    const pick = arg.match(/^(\d{1,3})(?:\s+(next|n))?(?:\s+(\d{1,3}(?:\.\d{1,3})?))?(?:\s+(\d{1,3}))?(?:\s+(link|l|next|n))?$/i);   // v2.39: row token = "14" | pack "1.1" (range command REMOVED)
    const isNum = (x) => /^\d+$/.test(x || '');

    if (pick) {
        const s = sessions.get(jid);
        if (!hasSession(jid)) return send(jid, { text: `⏳ session expire වෙලා — *.moviedex <නම>* ආයෙත් ගහන්න` }, { quoted: msg });
        const n = +pick[1], m = s.list[n - 1];
        if (!m) return send(jid, { text: `❌ ${n} — result එකක් නෑ (1-${s.list.length})` }, { quoted: msg });
        const isSeries = m.type === 'series';
        const wantNext = !!(pick[2] && /^n/i.test(pick[2])) || !!(pick[5] && /^n/i.test(pick[5]));
        const linkMode = !!(pick[5] && /^l/i.test(pick[5]));

        // full details (cached)
        let full = s.detail?.[n];
        if (!full || Date.now() - (s.detail?.[n]?.at || 0) > SESSION_TTL) {
            full = { ...await mbDetails(m.sid), at: Date.now() };
            (s.detail ||= {})[n] = full;
        }
        s.at = Date.now();

        /* ── SERIES flow ── */
        if (isSeries) {
            if (!s.tv) s.tv = {};
            let tv = s.tv[n];
            if (!tv || Date.now() - tv.at > SESSION_TTL) {
                if (wantNext || pick[3]) {
                    return send(jid, { text: `⏳ episodes load වෙලා නෑ — මුලින්ම *.moviedex ${n}* ගහන්න` }, { quoted: msg });
                }
                const st = await send(jid, { text: `🔎 ${cut(full.name, 50)} · seasons…` }, { quoted: msg });
                const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                let seasons = [];
                try { seasons = await mbSeasons(full.sid); } catch { }
                try { await send(jid, { delete: st.key }); } catch { }
                if (!seasons.length) {
                    await edit(`📺 *${cut(full.name, 50)}*\n\n⚠️ MovieBox එකේ මේ series එකේ episodes නෑ`);
                    s.tv[n] = { at: Date.now(), seasons: [] };
                    return true;
                }
                tv = { at: Date.now(), seasons, pageIdx: 0 };
                s.tv[n] = tv;
                const rows = tvRows(seasons);
                const sent = await sendSeriesCard(send, jid, msg, full, n, rows, 0);
                setUi(s, sent, 'tv', n);
                return true;
            }
            const rows = tvRows(tv.seasons);
            if (wantNext && !pick[3]) {
                const maxPage = Math.max(0, Math.ceil(rows.length / EP_PAGE_ROWS) - 1);
                tv.pageIdx = Math.min((tv.pageIdx || 0) + 1, maxPage);
                const sentPg = await sendSeriesCard(send, jid, msg, full, n, rows, tv.pageIdx);
                setUi(s, sentPg, 'tv', n);
                return true;
            }
            if (pick[3]) {
                const rowNo = pick[3];   // "14" | "1.1"
                const row = isNum(rowNo) ? rows.find(r => r.no === +rowNo) : rows.find(r => r.kind === 'pack' && r.label === rowNo);
                if (!row) return send(jid, { text: `❌ ${rowNo} — row එකක් නෑ (card එකේ අංකයක් තෝරන්න)` }, { quoted: msg });
                if (row.kind === 'season') {
                    // pack: continue via next
                    if (pick[5] && /^n/i.test(pick[5])) {
                        const p = tv.pack;
                        if (!p || p.row !== rowNo) return send(jid, { text: `⏳ pack start කරලා නෑ — *.moviedex ${n} ${rowNo} <q#>* ගහන්න` }, { quoted: msg });
                        if (p.from >= p.maxEp) return send(jid, { text: `✅ Season ${p.season} pack එක ඉවර් (${p.maxEp}/${p.maxEp}) — ආයෙත් ඕනෙ නම් *.moviedex ${n} ${rowNo} <q#>* ආයෙත් ගහන්න` }, { quoted: msg });
                        await seasonFilesCmd(send, jid, msg, full, p.season, p.maxEp, p.qNo, p.height, p.from, react, 0, '*.moviedex ' + n + ' ' + rowNo + ' next*');
                        tv.pack = { ...p, from: Math.min(p.maxEp, p.from + SEASON_FILE_CAP) };
                        return true;
                    }
                    if (linkMode) return send(jid, { text: `🔗 season pack එකට quality අංකයක් ඕනෙ — *.moviedex ${n} ${rowNo} 1*` }, { quoted: msg });
                    if (pick[4] && isNum(pick[4])) {
                        const qNo = +pick[4];
                        const qRows = tv.qualities?.[rowNo];
                        if (!qRows || !qRows.length) return send(jid, { text: `⏳ qualities load වෙලා නෑ — *.moviedex ${n} ${rowNo}* මුලින්ම` }, { quoted: msg });
                        const chosen = qRows[qNo - 1];
                        if (!chosen) return send(jid, { text: `❌ ${qNo} — quality නෑ (1-${qRows.length})` }, { quoted: msg });
                        tv.pack = { row: rowNo, season: row.season, maxEp: row.maxEp, qNo, height: chosen.h, from: 0 };
                        await seasonFilesCmd(send, jid, msg, full, row.season, row.maxEp, qNo, chosen.h, 0, react, 0, '*.moviedex ' + n + ' ' + rowNo + ' next*');
                        tv.pack.from = Math.min(row.maxEp, SEASON_FILE_CAP);   // v2.38 FIX: from never advanced after the FIRST run → 'next' re-downloaded from ep 1
                        return true;
                    }
                    // quality options (probe S×E1 stream once)
                    if (!tv.qualities?.[rowNo]) {
                        const st = await send(jid, { text: `📦 Season ${row.season} · qualities…` }, { quoted: msg });
                        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                        let qRows = [];
                        try {
                            const streams = await ((HOOKS && HOOKS.mbPlay) || mbPlay)(full.sid, row.season, 1, 2);   // probe fast-fails — menu එක seconds වලින්
                            if (streams.length) qRows = await ((HOOKS && HOOKS.mergedQualities) || mergedQualities)(streams).catch(() => []);   // merged (incl. 360p)
                        } catch { }
                        try { await send(jid, { delete: st.key }); } catch { }
                        if (!qRows.length) return edit(`❌ Season ${row.season} — streams නෑ (MovieBox free tier එකේ මේ season එක cover කරලා නෑ)`);
                        (tv.qualities ||= {})[rowNo] = qRows;
                    }
                    const sentOpt = await send(jid, { text: seasonOptText(full, n, rowNo, row.season, tv.qualities[rowNo]) }, { quoted: msg });
                    setUi(s, sentOpt, 'season', n, rowNo);
                    return true;
                }
                // v2.39: 🧳 PACK row — reply 1.1 → quality menu → 12 files (the edited-screenshot system)
                if (row.kind === 'pack') {
                    if (linkMode) return send(jid, { text: '🔗 pack download වලට link mode නෑ — files විදිහටම එවනවා' }, { quoted: msg });
                    const nextPack = rows.find(r => r.kind === 'pack' && r.season === row.season && r.from === row.to + 1);
                    if (pick[4] && isNum(pick[4])) {
                        const qNo = +pick[4];
                        const qRows = tv.qualities?.[rowNo];
                        if (!qRows || !qRows.length) return send(jid, { text: `⏳ qualities load වෙලා නෑ — *.moviedex ${n} ${rowNo}* මුලින්ම` }, { quoted: msg });
                        const chosen = qRows[qNo - 1];
                        if (!chosen) return send(jid, { text: `❌ ${qNo} — quality නෑ (1-${qRows.length})` }, { quoted: msg });
                        const smax = (tv.seasons.find(x => x.se === row.season) || {}).maxEp || row.to;
                        await seasonFilesCmd(send, jid, msg, full, row.season, smax, qNo, chosen.h, row.from - 1, react, row.to,
                            nextPack ? ('*.moviedex ' + n + ' ' + nextPack.label + ' ' + qNo + '*') : null);
                        return true;
                    }
                    if (!tv.qualities?.[rowNo]) {
                        const st = await send(jid, { text: `🧳 S${String(row.season).padStart(2, '0')} EP${row.from}-EP${row.to} · qualities…` }, { quoted: msg });
                        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                        let qRows = [];
                        try {
                            const streams = await ((HOOKS && HOOKS.mbPlay) || mbPlay)(full.sid, row.season, row.from, 2);
                            if (streams.length) qRows = await ((HOOKS && HOOKS.mergedQualities) || mergedQualities)(streams).catch(() => []);
                        } catch { }
                        try { await send(jid, { delete: st.key }); } catch { }
                        if (!qRows.length) return edit(`❌ S${String(row.season).padStart(2, '0')} EP${row.from}-EP${row.to} — streams නෑ`);
                        (tv.qualities ||= {})[rowNo] = qRows;
                    }
                    const sentPack = await send(jid, { text: seasonOptText(full, n, rowNo, row.season, tv.qualities[rowNo], `EP${row.from}-EP${row.to}`) }, { quoted: msg });
                    setUi(s, sentPack, 'season', n, rowNo);
                    return true;
                }
                // episode row → quality list / file
                if (pick[4] && isNum(pick[4])) {
                    await episodeFileCmd(send, jid, msg, full, row, +pick[4], (s.tv[n].epQualities || {})[rowNo], linkMode, react);
                    return true;
                }
                if (pick[4] && /^l/i.test(pick[4])) {
                    return send(jid, { text: `🔗 quality අංකය එකත් ඕනෙ — *.moviedex ${n} ${rowNo} 1 link*` }, { quoted: msg });
                }
                const st = await send(jid, { text: `🔎 ${epLabel(row)} · qualities…` }, { quoted: msg });
                const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                let qRows = [];
                try {
                    const streams = await ((HOOKS && HOOKS.mbPlay) || mbPlay)(full.sid, row.season, row.ep, 2);   // probe fast-fails — menu එක seconds වලින්
                    if (streams.length) qRows = await ((HOOKS && HOOKS.mergedQualities) || mergedQualities)(streams).catch(() => []);   // merged (incl. 360p)
                } catch { }
                try { await send(jid, { delete: st.key }); } catch { }
                if (!qRows.length) return edit(`❌ ${epLabel(row)} — streams නෑ\n> වෙන episode එකක් try`);
                const optRows = [`🎬 *SELECT DOWNLOAD OPTION* — ${epLabel(row)}`, `📺 ${cut(full.name, 50)}`, '', '» Video Qualities 👇'];
                qRows.forEach((r, i) => optRows.push(`*${i + 1}* | 🎥 ${r.label}${r.sizeMB ? ' · ~' + human(r.sizeMB * 1048576) : ''}`));
                optRows.push('', MV_FOOT);
                const sentOpt = await send(jid, { text: optRows.join('\n') }, { quoted: msg });
                (s.tv[n].epQualities ||= {})[rowNo] = qRows;
                setUi(s, sentOpt, 'ep', n, rowNo);
                return true;
            }
            // plain pick → (re)send episodes list
            const sentList = await sendSeriesCard(send, jid, msg, full, n, rows, tv.pageIdx || 0);
            setUi(s, sentList, 'tv', n);
            return true;
        }

        /* ── MOVIE flow ── */
        if (pick[3] && isNum(pick[3])) {
            const mv = s.mv?.[n];
            if (!mv || !mv.streams?.length) {
                return send(jid, { text: `⏳ quality list load වෙලා නෑ — මුලින්ම *.moviedex ${n}* ගහන්න` }, { quoted: msg });
            }
            await movieFileCmd(send, jid, msg, full, +pick[3], mv.qualities || [], mv.streams, linkMode, react);
            return true;
        }
        if (pick[4] || pick[5]) return send(jid, { text: `🔗 quality අංකය එකත් ඕනෙ — *.moviedex ${n} 1 link*` }, { quoted: msg });

        const st = await send(jid, { text: `🔎 ${cut(full.name, 50)}…` }, { quoted: msg });
        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
        let streams = [];
        try { streams = await mbPlay(full.sid, null, null, 3); } catch { }
        let rows = [];
        if (streams.length) rows = await mergedQualities(streams).catch(() => []);   // v2.30: merged rows (incl. 360p) carry dash → sends never re-probe
        (s.mv ||= {})[n] = { streams, qualities: rows, at: Date.now() };
        try { await send(jid, { delete: st.key }); } catch { }
        const sent = await sendCard(send, jid, msg, full, n, rows);
        setUi(s, sent, 'movie', n);
        return true;
    }

    if (!arg) {
        return send(jid, {
            text: `🎬 *MovieDex*\n\n*.moviedex <නම>* — search (movies + 📺 series)\nඅංකය reply කරන්න — card → options → files\n*.moviedex <n> <q#>* — 🍿 movie file · 🧳 season files · 🎬 episode file
*.moviedex <n> 1.1 <q#>* — 🧳 12-ep pack files (24+ ep seasons)\n*.moviedex <n> <q#> link* — 🔗 share link\n${foot('series = 📺 · උදා: .moviedex breaking bad')}`,
        }, { quoted: msg });
    }

    let q = arg, rangeHint = '';
    const rm = q.match(/^(.*\S)\s+\d{1,4}\s*[-–]\s*\d{1,4}$/);   // v2.39: old range habit → strip + pack hint
    if (rm) { q = rm[1]; rangeHint = '\n\n🎯 range command එක අයින් කළා — දැන් series card එකේ *1.1 · 1.2* 🧳 pack rows (12 eps බැගින්) reply කරන්න'; }
    const st = await send(jid, { text: `🔎 ${cut(q, 50)}…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const list = await mbSearch(q);
        if (!list.length) return edit(`❌ "${cut(q, 40)}" — results නෑ · නම ටිකක් වෙනස් කරලා try`);
        sessions.set(jid, { list, at: Date.now(), detail: {}, tv: {}, mv: {} });
        if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
        edit(listText(q, list) + rangeHint);
        const s2 = sessions.get(jid);
        if (s2) setUi(s2, st, 'list');
    } catch (e) {
        edit(`❌ ${cut(String(e.message || ''), 170)}\n> ටිකකින් ආයෙත් try`);
    }
    return true;
}

module.exports = { __hooks: (h) => { HOOKS = h; }, handle, bridgeReply, hasSession, setUi, mbSearch, mbDetails, mbSeasons, mbPlay, dashFrom, parseMpd, dashDownload, chunkCount, expandTpl, streamQualities, mergedQualities, downloadDash, transcode360, tvRows, listText, cardText, seriesText, seasonOptText, epFileName, epCaption, packStat, __deliver: deliverStream, _sessions: sessions, _testSession: (jid, s) => sessions.set(jid, s) };
