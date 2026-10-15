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
 *    .moviedex <n> (series)    → info card + FULL episode menu in ONE message (ALL seasons + episodes,
 *                                numbered 1..N — the v2.27-era card the user wants; long texts fold behind
 *                                WhatsApp's Read-more on phones — tap once to expand — but NEVER cut, and
 *                                never split into multiple messages)
 *    .moviedex <n> <row#>      → season → 🧳 quality options · episode → 🎬 quality list
 *    .moviedex <n> <row#> <q#> → 🧳 SEASON PACK = files, one per message (cap 50/run + next)
 *                                · 🎬 episode file · 🍿 movie file
 *    … link suffix             → 🔗 mirror share link instead of a WhatsApp file
 *    … next                    → season-pack file-run continue ONLY (menu has no pages)
 *
 *  Delivery pipeline (verified live):
 *    play-info/v2 → streams[].signCookie → base64 urlprefix = DASH dir on
 *    sbcdnN.hakunaymatata.com → index.mpd (Edge-Cache-Cookie + Referer: sportslive.wine)
 *    → fMP4 init + chunk segments (chunk-stream<rep>-<NNNNN>.m4s) downloaded with own
 *    concurrent engine → ffmpeg -c copy mux (video+audio) → WhatsApp document.
 *    stream.url alone is a shared 824 KB notice stub — the signCookie DASH is the real file.
 *
 *  v2.30: ① 360p row — MovieBox DASH ladders stop at 480p (verified 2026-10 across titles),
 *             so "360p" downloads the 480p track and re-encodes locally (x264,
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
 *   v2.44 — download SPEED II (benchmarked on the real sbcdn3 edge): the CDN throttles
 *             PER-CONNECTION (~60-120KB/s each) — aggregate scales with connection count
 *             up to ~16-24 total. ① segment workers 8/6 → 16/8 (env: ARENA_SEG_WORKERS_V/A).
 *             ② 360p re-encode preset veryfast → ultrafast (2-3× faster mux, maxrate cap
 *             keeps the size). ③ separate phase timing logs (chunks / mux / re-encode) so
 *             the next "slow" report pinpoints the exact phase. NOTE: WhatsApp upload is
 *             NOT the bottleneck (53MB in ~6s measured); the DASH CDN download is.
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

const MB_SECRET = Buffer.from('76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O', 'base64');   // v2.46: base64 gateway key (the old hex efa89197… key + visitor identity gets stubbed streams now)
const MB_CLIENT_BUILD = '1786863422670304777.c58dd77ad46d7d89b4605211013d392f-1786863190149921915.2f932bfba072c98c72572c2ecde2b365';
/** shared notice-stub markers (matches upstream MovieBox-Tui is_deprecation_notice_url) */
const MB_STUB_RE = /macdn\.aoneroom\.com\/other\/|9a0461bc39da389663bf3dbb17091d3f|80da52722ee7de7a4303290af6783424|1c7de0bd3393702d9191801f15f88f8d|b164fbfb4347792950bdfbfb563d39d9|\/notice\.mp4/i;
const MB_HOSTS = ['https://api6.aoneroom.com', 'https://api5.aoneroom.com', 'https://api4.aoneroom.com',
    'https://api4sg.aoneroom.com', 'https://api3.aoneroom.com', 'https://api.inmoviebox.com'];
const STREAM_REFERER = 'https://sportslive.wine';
const md5hex = (b) => crypto.createHash('md5').update(b).digest('hex');

let mbUA = '', mbCI = '', mbIP = '', mbToken = null, mbHostIdx = 0;
const sleepMs = (ms) => new Promise(res => setTimeout(res, ms));

/** v2.46 registered-app identity (4.0.02 / version_code 50020126) — the visitor-era identity
 *  (4.0.01 / 50020117-19, region US) now receives stubbed notice links on stream endpoints. */
function mbIdentity() {
    const ver = ['12', '13', '14'][Math.floor(Math.random() * 3)];
    const build = { 12: 'S1B.220414.015', 13: 'TQ2A.230405.003', 14: 'UP1A.231005.007' }[ver];
    const devs = [['SM-G991B', 'Samsung'], ['23106RN0DA', 'Redmi'], ['2201117TG', 'Redmi']];
    const [model, brand] = devs[Math.floor(Math.random() * devs.length)];
    const did = crypto.randomBytes(16).toString('hex');
    const gaid = [4, 2, 2, 2, 6].map(n => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n)).join('-');
    mbUA = 'okhttp/4.9.3';
    mbCI = JSON.stringify({ package_name: 'com.community.oneroom', version_name: '4.0.02.0831.03', version_code: 50020126, os: 'android', os_version: ver, install_ch: 'google-play', device_id: did, install_store: 'gp', gaid, brand, model, system_language: 'en', net: 'NETWORK_WIFI', region: 'NG', timezone: 'Africa/Lagos', sp_code: '62120', 'X-Child-UID': '', 'X-Client-Build': MB_CLIENT_BUILD, 'X-Play-Mode': '2', 'X-Idle-Data': '1', 'X-Family-Mode': '0', 'X-Content-Mode': '0' });
    mbIP = Array.from({ length: 4 }, () => 2 + Math.floor(Math.random() * 253)).join('.');
}
mbIdentity();

/** X-TR-Signature: ts|2|b64(hmac-md5(secret, canonical)) — canonical = METHOD\naccept\nctype\nlen\nts\nmd5(body)\nurl
 *  v2.46: okhttp UA, charset content-type, x-client-build + play/idle/family/content headers,
 *  Authorization prefers the registered user token (mbPickToken) over the visitor JWT. */
function mbHeaders(method, url, body) {
    const ts = Date.now();
    const u = new URL(url);
    const qs = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const canonical = u.pathname + (qs.length ? '?' + qs.map(([k, v]) => `${k}=${v}`).join('&') : '');
    const ct = body ? 'application/json;charset=UTF-8' : '';
    const canon = [method.toUpperCase(), 'application/json', ct,
        body ? String(Buffer.byteLength(body)) : '', String(ts), body ? md5hex(body) : '', canonical].join('\n');
    const sig = crypto.createHmac('md5', MB_SECRET).update(canon).digest('base64');
    const h = {
        'User-Agent': 'okhttp/4.9.3', Accept: 'application/json', Connection: 'keep-alive',
        'x-client-token': `${ts},${md5hex(String(ts).split('').reverse().join(''))}`,
        'x-tr-signature': `${ts}|2|${sig}`,
        'x-client-info': mbCI, 'x-client-status': '1', 'x-forwarded-for': mbIP,
        'x-client-build': MB_CLIENT_BUILD, 'x-play-mode': '2', 'x-idle-data': '1',
        'x-family-mode': '0', 'x-content-mode': '0', 'x-child-uid': '',
    };
    if (ct) h['Content-Type'] = ct;
    const tok = mbPickToken();
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
}

/** visitor-login → guest JWT (fresh identity each round — some ids get "miss token" 441) */
async function mbLogin(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
        mbIdentity();
        const host = MB_HOSTS[mbHostIdx++ % MB_HOSTS.length];
        const url = host + '/wefeed-mobile-bff/user-api/visitor-login';
        try {
            const _vh = mbHeaders('POST', url, '{}'); delete _vh.Authorization;   // v2.46: visitor-login must be anonymous
            const r = await fetch(url, { method: 'POST', headers: _vh, body: '{}', signal: AbortSignal.timeout(15000) });
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
            mbAuthFailAt = 0;   // v2.46: authenticated again
            return j;
        } catch (e) {
            last = e; fails++;
            if (/HTTP 441|HTTP 401|HTTP 406|miss token|UNAUTHORIZED/i.test(String(e.message))) {
                mbToken = null;
                mbAuthFailAt = Date.now(); mbUserToken = '';   // v2.46: token rejected → visitor window + fresh registration
                if (/resource/.test(p)) scheduleMbRegister(1500);
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
            const workers = Array.from({ length: kind === 'v'
                ? (parseInt(process.env.ARENA_SEG_WORKERS_V || '16', 10) || 16)
                : (parseInt(process.env.ARENA_SEG_WORKERS_A || '8', 10) || 8) }, async () => {   // v2.44: was 8/6 — CDN throttles per-connection, 16+8 scales ~1.5-1.9× (benchmarked)
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

/** v2.30 — 360p re-encode (source ladders stop at 480p): x264 ultrafast (v2.44), audio copy when the
 *  stream is mp4-friendly, one AAC fallback. -progress pipe:1 → live % via onProgress. */
async function transcode360(inp, outPath, { durSec = 0, onProgress, edit } = {}) {
    const ffmpeg = await require('./media').getBin('ffmpeg').catch(() => null);
    if (!ffmpeg) throw new Error('ffmpeg නෑ — 360p re-encode කරන්න බෑ. Termux: pkg install ffmpeg · panel: restart (auto download)');
    const { spawn } = require('child_process');
    const run = (aEnc) => new Promise((res, rej) => {
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', inp,
            '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-maxrate', '450k', '-bufsize', '900k',
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
    if (row.direct) return directDownload(row, { tmpDir, finalName, onProgress });   // v2.46: resource-position MP4 (no DASH, no mux)
    fs.mkdirSync(tmpDir, { recursive: true });
    const rawPath = row.transcode ? path.join(tmpDir, 'src-' + Date.now() + '.mkv') : path.join(tmpDir, finalName);
    const tChunk0 = Date.now();   // v2.44 phase timing (chunks vs re-encode)
    const res = await dashDownload({
        mpd: row.dash.mpd, cookie: row.dash.cookie, height: row.transcode ? row.srcH : row.h,
        outPath: rawPath, onProgress, wantSize: (row.sizeMB || 0) * 1048576,
        man: row.man || null, mpdTxt: row.mpdTxt || null,
    });
    console.log(`[moviedex] ⬇️ chunks ${row.transcode ? row.srcH + 'p src' : row.label} (${human(res.bytes)}) in ${Math.round((Date.now() - tChunk0) / 1000)}s`);   // v2.44 phase log
    if (!row.transcode) return res;
    const finalPath = path.join(tmpDir, finalName);
    const tEnc0 = Date.now();
    const bytes = await transcode360(res.path, finalPath, { durSec: row.man?.durSec || 0, onProgress, edit });
    console.log(`[moviedex] 🎞️ 360p re-encode (${human(bytes)}) in ${Math.round((Date.now() - tEnc0) / 1000)}s`);   // v2.44 phase log
    try { fs.rmSync(res.path, { force: true }); } catch { }
    return { path: finalPath, bytes, hevc: false };
}

/* ───────────────── 2b. DIRECT-MP4 mode (v2.46) ─────────────────
 * MovieBox stubbed the visitor play-info/signCookie DASH path (2026-10-10): every stream now
 * points at the shared 824 KB notice MP4 on macdn.aoneroom.com/other/ — that is why the quality
 * menu died with "0 rows in 0s" (the signCookie filter dropped everything). The real files moved
 * to the REGISTERED-user path: subject-api/resource (per-resolution items) → subject-api/
 * resource-position/v2 → time-signed MP4 on bcdn.hakunaymatata.com. Verified live 2026-10-14:
 * S1E1 37MB + 287MB movie, parallel ranged GET ~16MB/s aggregate, no cookie needed, UA okhttp.
 * Identity also bumped: version_code 50020126 (4.0.02.0831.03) + x-client-build + base64
 * gateway HMAC key — visitor-only identity with the old hex key gets stubbed streams. */

const SET_PATH = path.join(__dirname, 'settings.json');
const readSet = () => { try { return JSON.parse(fs.readFileSync(SET_PATH, 'utf8')); } catch { return {}; } };
const saveSet = (d) => { try { fs.writeFileSync(SET_PATH, JSON.stringify(d, null, 2)); } catch { } };

/** registered-user JWT (temp-email account) — visitor tokens only get stubbed links */
let mbUserToken = (() => {
    if (process.env.MB_USER_TOKEN) return String(process.env.MB_USER_TOKEN);
    try { return String(readSet().moviedexUserToken || ''); } catch { return ''; }
})();
let mbAuthFailAt = 0;   // v2.46 auth-failure window → visitor fallback while re-registering
const jwtExpMs = (t) => { try { const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64').toString('utf8')); return (p.exp || 0) * 1000; } catch { return 0; } };
const tokenUsable = (t) => !!t && jwtExpMs(t) - Date.now() > 3600e3;

/** bootstrap registered token (shared pool account) — replaced by our own registration ASAP */
const MB_BOOTSTRAP_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjkxMTAyODI4OTUyNzIzMzgzOTIsInV0cCI6MSwiZXhwIjoxNzk2MDcxNTgwLCJpYXQiOjE3ODgyOTUyODB9.l4MFha-s4DfMUOEQqPUGKZ_1NqfgI7NewaGJ0Saruik';

let mbRegRunning = false;
function scheduleMbRegister(delayMs = 0) {
    if (mbRegRunning || tokenUsable(mbUserToken)) return;
    const t = setTimeout(() => { mbRegisterAccount().catch(() => { }); }, delayMs);
    if (t.unref) t.unref();
}

/** temp-email inbox → { email, waitCode(ms) } — tempmail.lol first, guerrillamail fallback */
async function mbTempEmail() {
    try {
        const r = await fetch('https://api.tempmail.lol/v2/inbox/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        if (j.address && j.token) {
            return {
                email: j.address, waitCode: async (ms) => {
                    const dl = Date.now() + ms;
                    while (Date.now() < dl) {
                        await sleepMs(2500);
                        try {
                            const ir = await fetch(`https://api.tempmail.lol/v2/inbox?token=${encodeURIComponent(j.token)}`, { signal: AbortSignal.timeout(15000) });
                            const ij = JSON.parse(await ir.text());
                            for (const m of (ij.emails || [])) {
                                const mm = `${m.subject || ''} ${m.body || ''}`.match(/\b(\d{4,8})\b/);
                                if (mm) return mm[1];
                            }
                        } catch { }
                    }
                    throw new Error('code timeout');
                },
            };
        }
    } catch { }
    const r2 = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address', { signal: AbortSignal.timeout(15000) });
    const j2 = await r2.json();
    if (!j2.email_addr || !j2.sid_token) throw new Error('temp-email fail');
    let seq = 0;
    return {
        email: j2.email_addr, waitCode: async (ms) => {
            const dl = Date.now() + ms;
            while (Date.now() < dl) {
                await sleepMs(3000);
                try {
                    const ir = await fetch(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=${seq}&sid_token=${encodeURIComponent(j2.sid_token)}`, { signal: AbortSignal.timeout(15000) });
                    const ij = JSON.parse(await ir.text());
                    for (const mail of (ij.list || [])) {
                        seq = Math.max(seq, Number(mail.mail_id) || 0);
                        const fr = await fetch(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${mail.mail_id}&sid_token=${encodeURIComponent(j2.sid_token)}`, { signal: AbortSignal.timeout(15000) });
                        const body = await fr.text();
                        const mm = body.match(/\b(\d{4,8})\b/);
                        if (mm) return mm[1];
                    }
                } catch { }
            }
            throw new Error('code timeout');
        },
    };
}

/** register a real MovieBox account (get-sms-code → email code → register) → persists JWT */
async function mbRegisterAccount() {
    if (mbRegRunning) return null;
    mbRegRunning = true;
    try {
        if (tokenUsable(mbUserToken)) return mbUserToken;
        const { email, waitCode } = await mbTempEmail();
        const regPost = async (p, obj) => {
            const host = MB_HOSTS[mbHostIdx++ % MB_HOSTS.length];
            const url = `${host}${p}?host=${encodeURIComponent(host)}`;
            const body = JSON.stringify(obj);
            const hh = mbHeaders('POST', url, body);
            delete hh.Authorization;   // register endpoints must be anonymous
            const r = await fetch(url, { method: 'POST', headers: hh, body, signal: AbortSignal.timeout(20000) });
            const t = await r.text();
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 60));
            const jj = JSON.parse(t);
            if (jj.code !== 0) throw new Error('api ' + jj.code + ' ' + String(jj.message || '').slice(0, 40));
            return jj.data;
        };
        await regPost('/wefeed-mobile-bff/user-api/get-sms-code', { type: 1, authType: 1, mail: email, package_name: 'com.community.oneroom' });
        const code = await waitCode(55e3);
        const reg = await regPost('/wefeed-mobile-bff/user-api/register', { authType: 1, mail: email, verificationCode: code, password: 'Mb!' + crypto.randomBytes(6).toString('hex'), package_name: 'com.community.oneroom' });
        const tok = reg?.token;
        if (!tok) throw new Error('no token in register response');
        mbUserToken = tok;
        mbAuthFailAt = 0;
        const d = readSet(); d.moviedexUserToken = tok; saveSet(d);
        console.log('[moviedex] 🔐 MovieBox account registered — real-stream path live');
        return tok;
    } catch (e) {
        console.log('[moviedex] 🔐 register fail: ' + cut(String(e.message || ''), 100));
        return null;
    } finally { mbRegRunning = false; }
}

/** best token: registered JWT → bootstrap pool → visitor */
function mbPickToken() {
    if (tokenUsable(mbUserToken) && Date.now() - mbAuthFailAt > 120e3) return mbUserToken;
    if (tokenUsable(MB_BOOTSTRAP_TOKEN) && Date.now() - mbAuthFailAt > 120e3) return MB_BOOTSTRAP_TOKEN;
    return mbToken;   // visitor (metadata keeps working)
}

/** resource-position/v2 → REAL signed MP4 (not the poisoned play-info stub) */
async function mbDirectUrl(sid, se, ep, rid) {
    const j = await mbApi(`/wefeed-mobile-bff/subject-api/resource-position/v2?subjectId=${sid}&resourceId=${rid}&failUrl=&failCode=&resourceNum=1&isVip=false`, undefined, 3);
    const link = String((((j.data || {}).list) || [])[0]?.resourceLink || '');
    if (!link || MB_STUB_RE.test(link)) throw new Error('MovieBox මේ item එක VIP-only වෙලා — free copy එකක් නෑ');
    return link;
}

/** resource items for (se,ep) across all resolutions · movies: se=0, ep=0 */
async function mbResourceItems(sid, se, ep) {
    const wantSe = Number(se || 0), wantEp = Number(ep || 0);
    const out = [];
    await Promise.all([1080, 720, 480, 360].map(async (r) => {
        for (let page = 1; page <= 6; page++) {
            const j = await mbApi(`/wefeed-mobile-bff/subject-api/resource?subjectId=${sid}&se=${wantSe}&page=${page}&perPage=20&all=0&pagerMode=0&resolution=${r}`, undefined, 2).catch(() => null);   // perPage>20 → 400 "exceed limit"
            const items = (j?.data?.list) || [];
            const hit = items.filter(i => Number(i.se || 0) === wantSe && Number(i.ep || 0) === wantEp && Number(i.size || 0) > 0);
            if (hit.length) { out.push(...hit); return; }
            if (!items.length) return;
        }
    }));
    return out;
}

/** v2.46 — quality rows from the registered-user resource path (REAL mp4 per resolution).
 *  row.direct = { sid, se, ep, rid, codec } — the signed URL is resolved FRESH at download time. */
async function mbDirectRows(sid, se, ep) {
    const items = await mbResourceItems(sid, se, ep);
    const byRes = new Map();
    for (const it of items) {
        const r = Number(it.resolution) || 0;
        if (!r || it.vipInfo?.requireMemberType === 1) continue;   // VIP-locked → honest skip (preview files are not the episode)
        if (!byRes.has(r)) byRes.set(r, it);
    }
    return [...byRes.entries()].sort((a, b) => b[0] - a[0]).map(([r, it]) => ({
        h: r, bw: 0, label: `${r}p`, sizeMB: Math.round((Number(it.size) || 0) / 1048576),
        transcode: false, direct: { sid, se: Number(se || 0), ep: Number(ep || 0), rid: String(it.resourceId), codec: String(it.codecName || '') },
    }));
}

/** legacy DASH rows + direct rows merged (direct wins per height) — the v2.46 menu source */
async function combinedRows(sid, se, ep, streams) {
    const [dashRows, directRows] = await Promise.all([
        streams?.length ? mergedQualities(streams).catch(() => []) : Promise.resolve([]),
        mbDirectRows(sid, se, ep).catch(() => []),
    ]);
    const byH = new Map();
    for (const r of [...directRows, ...dashRows]) if (r && !byH.has(r.h)) byH.set(r.h, r);
    return [...byH.values()].sort((a, b) => b.h - a.h || (b.bw || 0) - (a.bw || 0));
}

/** direct row → file: fresh signed URL → parallel ranged GET (bcdn allows ~16MB/s aggregate).
 *  4MB chunks, ordered position-writes, retry ×3 per chunk, 120s stall watchdog. */
async function directDownload(row, { tmpDir, finalName, onProgress }) {
    fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, finalName);
    const url = await mbDirectUrl(row.direct.sid, row.direct.se, row.direct.ep, row.direct.rid);
    const hdrs = () => ({ 'User-Agent': 'okhttp/4.12.0', Accept: '*/*', 'Accept-Encoding': 'identity' });
    const openRes = async (u, range) => {   // manual redirect follow (CDN 302s, headers preserved)
        let cur = u;
        for (let hop = 0; hop < 5; hop++) {
            const r = await fetch(cur, { headers: { ...hdrs(), ...(range ? { Range: range } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(45000) });
            if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
                const loc = r.headers.get('location');
                try { await r.body?.cancel(); } catch { }
                cur = loc.startsWith('http') ? loc : new URL(loc, cur).toString();
                continue;
            }
            return r;
        }
        throw new Error('CDN redirect loop');
    };
    const head = await openRes(url, 'bytes=0-1');
    if (head.status !== 206 && !head.ok) { try { await head.body?.cancel(); } catch { } throw new Error('CDN HTTP ' + head.status); }
    const cr = head.headers.get('content-range') || '';
    const total = Number((cr.split('/')[1] || head.headers.get('content-length') || 0)) || 0;
    try { await head.body?.cancel(); } catch { }
    if (!total) throw new Error('file size එක unknown — ආයෙත් try');
    const CHUNK = 4 * 1048576;
    const chunks = Math.ceil(total / CHUNK);
    let got = 0, cursor = 0, stop = false, lastByteAt = Date.now();
    const wd = setInterval(() => { if (Date.now() - lastByteAt > 120e3) stop = true; }, 15000);
    const fd = fs.openSync(outPath, 'w');
    try {
        try { fs.ftruncateSync(fd, total); } catch { }
        const results = new Map();
        let nextWrite = 0;
        const nW = parseInt(process.env.ARENA_DL_WORKERS || '10', 10) || 10;
        const t0 = Date.now();
        await Promise.all(Array.from({ length: Math.min(nW, chunks) }, async () => {
            while (!stop) {
                const idx = cursor < chunks ? cursor++ : null;
                if (idx == null) return;
                let ok = false;
                for (let t = 0; t < 3 && !stop && !ok; t++) {
                    try {
                        const r = await openRes(url, `bytes=${idx * CHUNK}-${Math.min(total, (idx + 1) * CHUNK) - 1}`);
                        if (r.status === 206 || r.ok) {
                            const buf = Buffer.from(await r.arrayBuffer());
                            try { await r.body?.cancel(); } catch { }
                            if (buf.length > 0) {
                                results.set(idx, buf);
                                lastByteAt = Date.now();
                                while (results.has(nextWrite)) {
                                    const b = results.get(nextWrite); results.delete(nextWrite);
                                    fs.writeSync(fd, b, 0, b.length, nextWrite * CHUNK);
                                    got += b.length; nextWrite++;
                                }
                                if (onProgress && nextWrite % 2 === 0) onProgress(Math.min(99, Math.floor(nextWrite * 100 / chunks)), got);
                                ok = true;
                            }
                        } else { try { await r.body?.cancel(); } catch { } }
                    } catch { }
                    if (!ok && t < 2) await sleepMs(400 * (t + 1));
                }
                if (!ok) { stop = true; throw new Error('CDN chunk fail — ආයෙත් try'); }
            }
        }));
        clearInterval(wd);
        if (stop) throw new Error('CDN stall — තත්පර 120ක් bytes ආවේ නෑ');
        const size = fs.statSync(outPath).size;
        if (size < 100 * 1024) throw new Error('download එක අසම්පූර්ණයි (' + human(size) + ')');
        if (onProgress) onProgress(100, size);
        console.log(`[moviedex] ⬇️ direct ${row.label} (${human(size)}) in ${Math.round((Date.now() - t0) / 1000)}s · ${chunks} chunks`);
        return { path: outPath, bytes: size, hevc: /hevc|h265/i.test(row.direct.codec || '') };
    } finally {
        clearInterval(wd);
        try { fs.closeSync(fd); } catch { }
    }
}

if (!tokenUsable(mbUserToken)) scheduleMbRegister(tokenUsable(MB_BOOTSTRAP_TOKEN) ? 8000 : 2000);   // boot-time registration (background, non-blocking)


/* ───────────────── 3. sessions + message builders ───────────────── */

const SESSION_TTL = 15 * 60e3;
const UI_TTL = 10 * 60e3;
const EP_PAGE_ROWS = 999999;    // NO pagination, NO chunking — ONE message with the FULL menu (user final word: 'කලින් ඔවා 4 බෙදලා නෙමෙ තිබ්බෙ full menu එකම තිබ්බා' — both 60-row pages AND 50-row chunks rejected)
const MENU_FOLD_LINES = 135;    // WhatsApp phone preview cuts at ~135 lines ('*135 | Sea…' screenshot) — the packed menu below stays WELL under this so the WHOLE list is visible even on phones
const SEASON_FILE_CAP = 50;     // episode files per pack run ('next' continues)
const EP_SEND_GAP = 5000;       // pause between episode sends
const PACK_LINK_CAP = 40;       // mirror links per pack message
const sessions = new Map();     // jid → { list, at, mv:{n:...}, tv:{n:...}, ui }

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

/** session rows for a series: 📦 season rows interleaved with episode rows */
function tvRows(seasons) {
    const rows = [];
    for (const se of seasons) {
        rows.push({ kind: 'season', season: se.se, maxEp: se.maxEp });
        for (let e = 1; e <= se.maxEp; e++) rows.push({ kind: 'ep', season: se.se, ep: e });
    }
    return rows;
}

const epLabel = (r) => `Season ${r.season} Episode ${r.ep}`;

function seriesHeadLines(m) {
    return [`🍀 *${cut(m.name, 58)}*${m.year ? ` (${m.year})` : ''}`,
        `📅 ${m.date || m.year || '—'}${m.duration ? '  ·  ⏱ ' + m.duration : ''}  ·  ⭐ ${m.rating || '—'} IMDb`,
        m.genres?.length ? `🎭 ${m.genres.join(', ')}` : '',
        m.country ? `🌍 ${m.country}` : '',
        '', `📝 _${String(m.desc || '—').trim().slice(0, 320)}_`];
}

/** packed episode lines — consecutive episodes of ONE season, 4 per line as *N* E<ep>.
 *  Row numbers stay the global 1..N picks (reply grammar unchanged); short tokens keep every
 *  line ≤ ~45 visible chars so WhatsApp never soft-wraps them into extra lines. */
function packEpLines(rows, from, to) {
    const runLen = to - from;
    const perLine = runLen > 700 ? 2 : runLen > 300 ? 3 : 4;
    const out = [];
    for (let i = from; i < to; i += perLine) {
        const cells = [];
        for (let j = i; j < Math.min(i + perLine, to); j++) cells.push(`*${j + 1}* E${rows[j].ep}`);
        out.push(cells.join(' · '));
    }
    return out;
}

/** FULL episode menu text — header + ALL rows numbered 1..N + footer (ONE message, never split).
 *  Compact packing keeps a 174-ep series at ~60 lines / ~2.5KB — inside the ~135-line phone
 *  preview fold, so the menu is fully visible WITHOUT Read-more on phone AND desktop. */
function seriesText(m, n, rows) {
    const out = seriesHeadLines(m);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind === 'season') {
            out.push(`*${i + 1}* | 📦 Download Season ${r.season} (All Episodes)`);
        } else {
            let j = i;
            while (j < rows.length && rows[j].kind === 'ep' && rows[j].season === r.season) j++;
            out.push(`▸ Season ${r.season} · Episodes ${rows[i].ep}-${rows[j - 1].ep}`);
            out.push(...packEpLines(rows, i, j));
            i = j - 1;
        }
    }
    out.push('', MV_FOOT);
    return out.filter(Boolean).join('\n');
}

async function sendSeriesCard(send, jid, msg, m, n, rows, s) {
    const text = seriesText(m, n, rows);
    if (text.length > 9000) {   // 1000+ ep mega series can't fit a caption — poster card + FULL list as its own text message (still no split of the list itself)
        try { if (m.poster) await send(jid, { image: { url: m.poster }, caption: `🍀 *${cut(m.name, 58)}* — full episode menu 👇` }, { quoted: msg }); } catch { }
        const r = await send(jid, { text }, { quoted: msg });
        if (s) setUi(s, r, 'tv', n);
        return r;
    }
    try {
        if (!m.poster) throw new Error('no poster');
        const r = await send(jid, { image: { url: m.poster }, caption: text }, { quoted: msg });   // ONE bubble — full menu
        if (s) setUi(s, r, 'tv', n);
        return r;
    } catch {
        const r = await send(jid, { text }, { quoted: msg });
        if (s) setUi(s, r, 'tv', n);
        return r;
    }
}

function seasonOptText(m, n, rowNo, season, rows) {
    const out = [`🧳 *SELECT DOWNLOAD OPTION FOR SEASON ${season}*`, `🍀 ${cut(m.name, 46)}`, '', '» Video Qualities (All Episodes) 👇'];
    rows.forEach((r, i) => out.push(`*${i + 1}* | 🎥 ${r.label}${r.sizeMB ? ' · ~' + human(r.sizeMB * 1048576) + '/ep' : ''}`));
    out.push('', MV_FOOT);
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
    if ((!qrow || (!qrow.dash && !qrow.direct)) && st) {
        const q = await streamQualities(st).catch(() => null);
        if (q?.rows?.length) qrow = { ...q.rows[0], dash: q.dash, man: q.man || null, mpdTxt: q.txt || null };
    }
    if (!qrow || (!qrow.dash && !qrow.direct)) { react?.('❌'); await edit('❌ streams decode කරන්න බැරි වුණා — ටිකකින් ආයෙත් try'); return; }
    const row = qrow;
    const mb = row.sizeMB || null;
    if (mb && mb > maxMB()) {
        await edit(`📦 ~${human(mb * 1048576)} — limit එක ${human(maxMB() * 1048576)}\n> අඩු quality එකක් try කරන්න හෝ *.maxmb* වෙනස් කරන්න`);
        return;
    }
    const isEp = season && ep;
    const est = mb ? mb * 1048576 : 0;
    const finalName = isEp ? epFileName(show, season, ep, row.h, !row.transcode && !row.direct)
        : (fname || `MovieDex [${row.label}].${(row.direct || row.transcode) ? 'mp4' : 'mkv'}`);
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
        const d0 = Date.now();
        const res = await downloadDash(row, { tmpDir, finalName, onProgress, edit });
        console.log(`[moviedex] ⬇️ downloaded ${row.label} (${human(res.bytes)}) in ${Math.round((Date.now() - d0) / 1000)}s`);
        const f = { path: res.path, name: finalName, size: res.bytes };
        if (linkMode) {
            console.log(`[moviedex] 🪞 mirror upload start: ${f.name} (${human(f.size)})`);
            const m0 = Date.now();
            await edit(`🪞 upload… (${human(f.size)})`);
            const rel = await require('./mirror').uploadFile(f.path, f.name);
            console.log(`[moviedex] 🪞 mirror done ${f.name} in ${Math.round((Date.now() - m0) / 1000)}s → ${rel.url}`);
            react?.('✅');
            await edit(`🔗 *${cut(show || capTitle || 'MovieDex', 80)}*\n${rel.url}\n${foot(`${human(f.size)} · ${row.label} · ${rel.days}d (${rel.host}) · public`)}`);
        } else {
            console.log(`[moviedex] 📤 upload start: ${f.name} (${human(f.size)}) → ${jid}`);
            const t0 = Date.now();
            let alive = true, secs = 0;
            (async () => { while (alive) { await sleepMs(30000); if (!alive) break; secs += 30; edit(`📤 WhatsApp… (${human(f.size)}) · ${secs}s…`); } })();   // v2.43 upload heartbeat
            try {
                await send(jid, {
                    document: { url: f.path }, fileName: f.name,
                    mimetype: f.name.endsWith('.mp4') ? 'video/mp4' : 'video/x-matroska',
                    caption: isEp ? epCaption(show, season, ep, row.h, 1, 1, 0) : `${capTitle}\n${foot(capMeta || human(f.size))}`,
                }, { quoted: msg });
            } finally { alive = false; }
            console.log(`[moviedex] ✅ sent ${f.name} in ${Math.round((Date.now() - t0) / 1000)}s`);
        }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
        if (!linkMode) { try { await send(jid, { delete: status.key }); } catch { } react?.('✅'); }
    } catch (e) {
        react?.('❌');
        console.log('[moviedex] ❌ send fail: ' + cut(String(e.message || ''), 120));
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
        fname: `${String(m.name).replace(/[\\/:*?"<>|.]/g, '').slice(0, 60)} [${qrow.label}].${(qrow.direct || qrow.transcode) ? 'mp4' : 'mkv'}`,
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
        const streams = await mbPlay(m.sid, row.season, row.ep).catch(() => []);   // legacy DASH — dead since the stubbing, kept as fallback
        const fresh = await combinedRows(m.sid, row.season, row.ep, streams).catch(() => []);
        const qrow = fresh.find(r => r.h === chosen.h) || chosen;
        if (!qrow || (!qrow.direct && !qrow.dash)) { react?.('❌'); return edit(`❌ ${epLabel(row)} — streams නෑ\n> වෙන episode එකක් try`); }
        await deliverStream(send, jid, msg, { qrow, linkMode, react, status, edit, show: m.name, season: row.season, ep: row.ep });
    } catch (e) {
        react?.('❌');
        await edit(`❌ ${cut(String(e.message || ''), 140)}`);
    }
}

/** .moviedex <n> <seasonRow#> <q#> [next] → season pack as FILES, one per message */
async function seasonFilesCmd(send, jid, msg, m, season, maxEp, qNo, height, from, react) {
    const total = maxEp;
    if (!total) return send(jid, { text: `❌ Season ${season} — episodes නෑ` }, { quoted: msg });
    const show = cut(m.name, 50);
    const startTxt = from > 0
        ? `🧳 *Continuing Season ${season} Download* — ${cut(m.name, 50)}\n\nEpisodes: ${from + 1}–${Math.min(total, from + SEASON_FILE_CAP)} / ${total}\nQuality: ${height || 'best available'}`
        : `🧳 *Starting Season ${season} Download* for ${cut(m.name, 50)}…\n\nTotal Episodes: ${total}\nQuality: ${height || 'best available'}`;
    const status = await send(jid, { text: startTxt + '\n' + foot('episode එකින් එක එවනවා — stop කරන්න නම් මට කියන්න') }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    const end = Math.min(total, from + SEASON_FILE_CAP);
    let ok = 0, fail = 0, lastEdit = 0;
    for (let ep = from + 1; ep <= end; ep++) {
        const tag = `S${season}E${ep}`;
        const tmpDir = path.join(process.env.DL_TMP || os.tmpdir(), 'mdx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
        try {
            const streams = await mbPlay(m.sid, season, ep).catch(() => []);   // legacy DASH — dead since the stubbing
            const per = async (pct, bytes) => {
                const now = Date.now();
                if (now - lastEdit < 9000) return;
                lastEdit = now;
                edit(`⬇️ ${tag} · ${bar(pct)} ${pct}%\n✅ ${ok}  ⚠️ ${fail}  ·  ${ep}/${total}`);
            };
            const rows = await combinedRows(m.sid, season, ep, streams).catch(() => []);
            if (!rows.length) throw new Error('streams නෑ (MovieBox මේ ep එක VIP-only කරලා ඇති)');
            const row = height ? (rows.find(r => r.h === height) || rows.find(r => r.h <= height && !r.transcode) || rows[rows.length - 1]) : rows[0];
            if (row.sizeMB && row.sizeMB > maxMB()) {
                fail++;
                await send(jid, { text: `⚠️ ${tag} — ~${human(row.sizeMB * 1048576)} limit එකට වඩා ලොකුයි (*.maxmb*)` }, { quoted: msg });
                continue;
            }
            const finalName = epFileName(m.name, season, ep, row.h, !row.transcode && !row.direct);
            const s0 = Date.now();
            const res = await downloadDash(row, { tmpDir, finalName, onProgress: per, edit });
            console.log(`[moviedex] ⬇️ downloaded ${finalName} (${human(res.bytes)}) in ${Math.round((Date.now() - s0) / 1000)}s`);
            console.log(`[moviedex] 📤 upload start: ${finalName} (${human(res.bytes)})`);
            const u0 = Date.now();
            await send(jid, {
                document: { url: res.path }, fileName: finalName,
                mimetype: finalName.endsWith('.mp4') ? 'video/mp4' : 'video/x-matroska',
                caption: epCaption(m.name, season, ep, row.h, ok + 1, total, fail),
            }, { quoted: msg });
            ok++;
            console.log(`[moviedex] ✅ sent ${finalName} in ${Math.round((Date.now() - u0) / 1000)}s`);
        } catch (err) {
            fail++;
            console.log('[moviedex] ' + tag + ' fail: ' + cut(String(err.message || ''), 160));
            await send(jid, { text: `⚠️ ${tag} — ${cut(String(err.message || ''), 90)}\n> මේ එක skip කළා` }, { quoted: msg });
        }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
        await edit(packStat(show, season, ok, fail, ep, total));
        if (ep < end) await sleepMs(EP_SEND_GAP);
    }
    react?.(ok ? '✅' : '❌');
    if (end < total) {
        await edit(`⏸ Season ${season} — ${end}/${total} යවලා ඉවර්\n✅ ${ok}  ⚠️ ${fail}\n> ඉතුරු ටිකට — *.moviedex ${season} next* (Season ${season} card එකෙන්)`);
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
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d)) return null;
    if (!hasSession(jid)) {   // v2.27: recently-expired session (≤30 min) still routes → user gets the "expire" hint, never silence
        if (Date.now() - (s.at || 0) > SESSION_TTL + 30 * 60e3) return null;
        return `.moviedex ${d}`;
    }
    const route = (c) => {
        if (!c || !c.kind) return `.moviedex ${d}`;
        if (c.kind === 'movie') return `.moviedex ${c.n} ${d}`;
        if (c.kind === 'tv') return `.moviedex ${c.n} ${d}`;   // row number — same numbering the menu prints (WYSIWYG)
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
    const pick = arg.match(/^(\d{1,3})(?:\s+(next|n))?(?:\s+(\d{1,3}))?(?:\s+(\d{1,3}))?(?:\s+(link|l|next|n))?$/i);
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
                if (wantNext || (pick[3] && isNum(pick[3]))) {
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
                tv = { at: Date.now(), seasons };
                s.tv[n] = tv;
                const rows = tvRows(seasons);
                const sent = await sendSeriesCard(send, jid, msg, full, n, rows, s);
                setUi(s, sent, 'tv', n);
                return true;
            }
            const rows = tvRows(tv.seasons);
            if (wantNext && !(pick[3] && isNum(pick[3]))) {   // no pages anymore — menu arrives whole, chunks auto-sent
                return send(jid, { text: `ℹ️ ඔක්කොම episodes දැන්ම menu එකේ තියෙනවා — *next* ඕන නෑ 😊\n> season pack run එකක් continue කරනවා නම් විතරයි next ගහන්නෙ` }, { quoted: msg });
            }
            if (pick[3] && isNum(pick[3])) {
                const rowNo = +pick[3];
                const row = rows[rowNo - 1];
                if (!row) return send(jid, { text: `❌ ${rowNo} — row එකක් නෑ (1-${rows.length})` }, { quoted: msg });
                if (row.kind === 'season') {
                    // pack: continue via next
                    if (pick[5] && /^n/i.test(pick[5])) {
                        const p = tv.pack;
                        if (!p || p.row !== rowNo) return send(jid, { text: `⏳ pack start කරලා නෑ — *.moviedex ${n} ${rowNo} <q#>* ගහන්න` }, { quoted: msg });
                        await seasonFilesCmd(send, jid, msg, full, p.season, p.maxEp, p.qNo, p.height, p.from, react);
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
                        await seasonFilesCmd(send, jid, msg, full, row.season, row.maxEp, qNo, chosen.h, 0, react);
                        return true;
                    }
                    // quality options (probe S×E1 stream once)
                    if (!tv.qualities?.[rowNo]) {
                        const sp0 = Date.now();
                        console.log(`[moviedex] 🧳 season-menu probe S${row.season}E1…`);
                        const st = await send(jid, { text: `📦 Season ${row.season} · qualities…` }, { quoted: msg });
                        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                        let qRows = [];
                        try {
                            const streams = await mbPlay(full.sid, row.season, 1, 2).catch(() => []);   // legacy DASH — dead since the stubbing
                            qRows = await combinedRows(full.sid, row.season, 1, streams);   // v2.46: direct rows (resource-position) + dash
                        } catch { }
                        const seasonErr = qRows.length ? '' : `❌ Season ${row.season} — streams නෑ (MovieBox free tier එකේ මේ season එක cover කරලා නෑ)`;
                        try { await send(jid, { delete: st.key }); } catch { }
                        if (seasonErr) return send(jid, { text: seasonErr }, { quoted: msg });   // v2.46: NEW msg — edit-after-delete = user silence bug
                        (tv.qualities ||= {})[rowNo] = qRows;
                        console.log(`[moviedex] 🧳 season-menu probe done: ${qRows.length} rows in ${Math.round((Date.now() - sp0) / 1000)}s`);
                    }
                    const sentOpt = await send(jid, { text: seasonOptText(full, n, rowNo, row.season, tv.qualities[rowNo]) }, { quoted: msg });
                    setUi(s, sentOpt, 'season', n, rowNo);
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
                const p0 = Date.now();
                console.log(`[moviedex] 🎬 menu probe ${epLabel(row)}…`);
                const st = await send(jid, { text: `🔎 ${epLabel(row)} · qualities…` }, { quoted: msg });
                const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                let qRows = [];
                try {
                    const streams = await mbPlay(full.sid, row.season, row.ep, 2).catch(() => []);   // legacy DASH — dead since the stubbing
                    qRows = await combinedRows(full.sid, row.season, row.ep, streams);   // v2.46: direct rows (resource-position) + dash
                } catch { }
                console.log(`[moviedex] 🎬 menu probe done: ${qRows.length} rows (${qRows.filter(r => r.direct).length} direct) in ${Math.round((Date.now() - p0) / 1000)}s`);
                const epErr = qRows.length ? '' : `❌ ${epLabel(row)} — streams නෑ\n> වෙන episode එකක් try`;
                try { await send(jid, { delete: st.key }); } catch { }
                if (epErr) return send(jid, { text: epErr }, { quoted: msg });   // v2.46: NEW msg — edit-after-delete = user silence bug
                const optRows = [`🎬 *SELECT DOWNLOAD OPTION* — ${epLabel(row)}`, `📺 ${cut(full.name, 50)}`, '', '» Video Qualities 👇'];
                qRows.forEach((r, i) => optRows.push(`*${i + 1}* | 🎥 ${r.label}${r.sizeMB ? ' · ~' + human(r.sizeMB * 1048576) : ''}`));
                optRows.push('', MV_FOOT);
                const sentOpt = await send(jid, { text: optRows.join('\n') }, { quoted: msg });
                (s.tv[n].epQualities ||= {})[rowNo] = qRows;
                setUi(s, sentOpt, 'ep', n, rowNo);
                return true;
            }
            // plain pick → (re)send episodes list
            const sentList = await sendSeriesCard(send, jid, msg, full, n, rows, s);
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
        const mp0 = Date.now();
        console.log(`[moviedex] 📺 movie probe ${cut(full.name, 40)}…`);
        let streams = [];
        try { streams = await mbPlay(full.sid, null, null, 3).catch(() => []); } catch { }
        let rows = [];
        try { rows = await combinedRows(full.sid, 0, 0, streams); } catch { }   // v2.46: direct rows (resource-position) + dash
        console.log(`[moviedex] 📺 movie probe done: ${rows.length} rows (${rows.filter(r => r.direct).length} direct) in ${Math.round((Date.now() - mp0) / 1000)}s`);
        (s.mv ||= {})[n] = { streams, qualities: rows, at: Date.now() };
        try { await send(jid, { delete: st.key }); } catch { }
        const sent = await sendCard(send, jid, msg, full, n, rows);
        setUi(s, sent, 'movie', n);
        return true;
    }

    if (!arg) {
        return send(jid, {
            text: `🎬 *MovieDex*\n\n*.moviedex <නම>* — search (movies + 📺 series)\nඅංකය reply කරන්න — card → options → files\n*.moviedex <n> <q#>* — 🍿 movie file · 🧳 season files · 🎬 episode file\n*.moviedex <n> <q#> link* — 🔗 share link\n${foot('series = 📺 · උදා: .moviedex breaking bad')}`,
        }, { quoted: msg });
    }

    const st = await send(jid, { text: `🔎 ${cut(arg, 50)}…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const list = await mbSearch(arg);
        if (!list.length) return edit(`❌ "${cut(arg, 40)}" — results නෑ · නම ටිකක් වෙනස් කරලා try`);
        sessions.set(jid, { list, at: Date.now(), detail: {}, tv: {}, mv: {} });
        if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
        edit(listText(arg, list));
        const s2 = sessions.get(jid);
        if (s2) setUi(s2, st, 'list');
    } catch (e) {
        edit(`❌ ${cut(String(e.message || ''), 170)}\n> ටිකකින් ආයෙත් try`);
    }
    return true;
}

module.exports = { handle, bridgeReply, hasSession, setUi, mbSearch, mbDetails, mbSeasons, mbPlay, dashFrom, parseMpd, dashDownload, chunkCount, expandTpl, streamQualities, mergedQualities, downloadDash, transcode360, tvRows, listText, cardText, seriesText, sendSeriesCard, seasonOptText, epFileName, epCaption, packStat, mbDirectRows, mbDirectUrl, combinedRows, directDownload, mbRegisterAccount, __deliver: deliverStream, _sessions: sessions, _testSession: (jid, s) => sessions.set(jid, s) };
