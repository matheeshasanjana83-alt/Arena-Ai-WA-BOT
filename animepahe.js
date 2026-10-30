/**
 * animepahe.js — v3.04.0 🎌 .animepahe — anime search → episodes → quality → FILE downloads
 * PROVIDER LADDER (user directive 2026-10-30: "Puppeteer is useless — server IP hard-blocked.
 * Switch to the Consumet API fallback method. Scrape api.consumet.org instead of animepahe.pw"):
 *
 *   1) CONSUMET — GET {base}/anime/animepahe/{q}|info?id=|watch/{epId} (consumet.ts contract,
 *      keyless JSON). Base = ARENA_CONSUMET_BASE env > settings.json "consumetBase" (.setconsumet)
 *      > https://api.consumet.org. LIVE-PROBED 2026-10-30 (scripts/probe_consumet.js): the OFFICIAL
 *      instance is DEAD — HTTP 451 + GitHub-Parks HTML ("Consumet API is no longer publicly
 *      available", ByteMuseum/api.consumet.org README); mirrors probed dead too (api-v2/.net DNS
 *      fail · onrender fail · vercel FUNCTION_INVOCATION_FAILED). Dead verdict cached 10 min then
 *      retried — the moment ANY working instance exists (self-hosted docker riimuru/consumet-api
 *      or a mirror), *.setconsumet <url> lights the provider up with zero other changes.
 *   2) DIRECT — animepahe.pw internal API (ElijahCodes12345/animepahe-api contract, keyless
 *      zero-dep) — v3.03 panel verdict: CF IP-REPUTATION HARD WAF BLOCK on datacenter IPs
 *      (sandbox + panel + 0/24 free proxies, stealth browser had nothing to solve). This path
 *      works the moment a residential proxy is set (*.setproxy → net.js routes everything).
 *
 * Direct contract (unchanged):
 *   search:   GET /api?m=search&q=<q>&page=1 → {data:[{session,slug,title,poster,type,episodes,year}]}
 *   releases: GET /api?m=release&id=<s>&sort=episode_asc&page=N → {last_page,data:[{session,episode,episode2,audio}]}
 *   play:     GET /play/<a>/<e> → #pickDownload <a href="pahe.win/…">
 *   download: pahe.win/kwik form page → POST _token → 302 Location = DIRECT file URL
 * Consumet watch sources = kwik embed URLs → SAME form-token machinery resolves them to direct.
 *
 * Flow (cinesite.js session grammar — quote-reply only, cardId-enforced):
 *   .animepahe <name> → search menu → quote N → 📺 episode menu (ep1 first, [dub] rows) →
 *   quote M → 🎬 quality card (res · size · fansub · BD) → quote K → FILE via dlQueue.
 *   Direct URL jumps: /play/<a>/<e> → quality menu · /anime/<session> → episode menu.
 * Final URL carries #apref=<page> fragment → resolvers.js strips it into the Referer (v3.04: REAL).
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { foot } = require('./style');
const { smartFetch, viaPool } = require('./net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://animepahe.pw';
const HOST = 'animepahe.pw';
const BRAND = '🎌 AnimePahe';
const TAG = '🎌 AnimePahe';
const TTL = 30 * 60e3;
const CAP = 40;
const MENU_ROWS = 10;
const EP_CAP = 300;                       // hard cap (menu honest about truncation)
const EP_PAGES_MAX = 8;                   // release pages fetched (30/page → ~240 eps)
const TIMEOUT = 30e3;
const CMDS = { '.animepahe': 1, '.aphe': 1, '.animepahae': 1, '.anemepahe': 1 };   // last two = user typos (2026-10-30)

// net.js smartFetch — fetcher seam (metdn/cinesite pattern): tests inject a mock; live = smartFetch.
let fetcher = (u, o) => smartFetch(u, o);
const setFetcher = (f) => { const prev = fetcher; fetcher = f; return prev; };

// ── 🌐 v3.04 CONSUMET base — env > settings.json (.setconsumet) > official (dead, kept as the
// documented default so a revival / mirror at the same host lights up with zero config).
const CONSUMET_DEFAULT = 'https://api.consumet.org';
function consumetBase() {
    const env = String(process.env.ARENA_CONSUMET_BASE || '').trim();
    if (env) return env.replace(/\/+$/, '');
    try { const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); if (s.consumetBase) return String(s.consumetBase).replace(/\/+$/, ''); } catch { }
    return CONSUMET_DEFAULT;
}
// instance health state (dead verdict = 10 min skip, then one retry — never hammer a dead base)
const C_STATE_TTL = 10 * 60e3;
let cState = { ok: null, at: 0, status: 0 };
const _cTest = (p = {}) => {
    if (p.reset) cState = { ok: null, at: 0, status: 0 };
    if ('ok' in p) cState.ok = p.ok;
    if ('at' in p) cState.at = p.at;
    if ('status' in p) cState.status = p.status;
    return { ...cState };
};
// probe a base URL once (owner .setconsumet verify + boot healthCheck) — honest shape report
async function probeConsumetBase(base) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(b)) return { ok: false, status: 0, why: 'URL format එක වැරදියි' };
    try {
        const r = await fetcher(b + '/anime/animepahe/a', { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
        const txt = await r.text().catch(() => '');
        let json = false; try { json = JSON.parse(txt) != null; } catch { }
        return { ok: r.ok && json, status: r.status, shape: json ? 'json' : 'html', why: r.ok ? (json ? 'JSON-OK' : 'non-JSON response (instance dead/parked)') : 'HTTP ' + r.status };
    } catch (e) { return { ok: false, status: 0, why: String((e && e.message) || e).slice(0, 60) }; }
}

// ── 🥷 v3.03 CF stealth-solve ladder (user directive: Puppeteer + Stealth) — cf_clearance is
// IP+UA-bound, so we cache { cookie, ua } from a real stealth-Chrome solve and reuse BOTH with
// plain fetch. Lazy: puppeteer absent (npm optional) → getSolver() null → honest wall card.
let solver = null;                                    // test seam; live = require('./cfsolver') (lazy)
const setSolver = (s) => { const p = solver; solver = s; return p; };
function getSolver() {
    if (solver !== null) return solver === false ? null : solver;
    try { solver = require('./cfsolver'); } catch { solver = false; }   // false = absent, cached
    return solver === false ? null : solver;
}
const cfCache = new Map();                            // host → { cookie, ua, at }
const CF_TTL = 25 * 60e3;                             // refresh window (cookie nominal 1y, site may rotate)
const SOLVE_COOLDOWN = 90e3;                          // ≤ 1 browser solve / 90s bot-wide (RAM guard)
const FAIL_GIVEUP = 5, FAIL_BACKOFF = 15 * 60e3;      // 5 fails → stop browser attempts 15 min (RAM guard)
let lastSolveAt = 0, lastFailAt = 0, failStreak = 0;

async function clearance(host) {
    const hit = cfCache.get(host);
    if (hit && Date.now() - hit.at < CF_TTL) return hit;
    if (failStreak >= FAIL_GIVEUP && Date.now() - lastFailAt < FAIL_BACKOFF) return null;
    if (Date.now() - lastSolveAt < SOLVE_COOLDOWN) return null;
    lastSolveAt = Date.now();
    const mod = getSolver();
    if (!mod || typeof mod.solve !== 'function') return null;
    let r = null;
    try { r = await mod.solve('https://' + host + '/', (m) => console.log('[ANIMEPAHE] ' + m)); } catch { r = null; }
    if (r && r.ok && r.cookie) {
        failStreak = 0;
        cfCache.set(host, { cookie: r.cookie, ua: r.ua || UA, at: Date.now() });
        console.log(`[ANIMEPAHE] 🥷 CF solve OK — cf_clearance cached (${host}, reuse ${CF_TTL / 60e3}m) ✅`);
        return cfCache.get(host);
    }
    failStreak++; lastFailAt = Date.now();
    console.log(`[ANIMEPAHE] 🥷 CF solve FAIL — ${String((r && r.why) || 'null').slice(0, 60)} (streak ${failStreak}) ⚠️`);
    return null;
}

async function grab(url, o = {}) {
    const headers = { 'User-Agent': UA, Accept: o.accept || 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9', ...(o.referer ? { Referer: o.referer } : {}), ...(o.headers || {}) };
    let r = await fetcher(url, {
        headers,
        ...(o.method ? { method: o.method, body: o.body } : {}), signal: AbortSignal.timeout(o.timeout || TIMEOUT),
    });
    if (r.status === 403 && !o.noSolve) {              // 🥷 CF wall → stealth-solve once → retry with clearance
        const t403 = await r.text().catch(() => '');
        if (isCF(t403)) {
            const c = await clearance(new URL(url).host);
            if (c) {
                r = await fetcher(url, {
                    headers: { ...headers, 'User-Agent': c.ua, Cookie: c.cookie },
                    ...(o.method ? { method: o.method, body: o.body } : {}), signal: AbortSignal.timeout(o.timeout || TIMEOUT),
                });
            } else {
                throw cfErr(new URL(url).host);
            }
        } else {
            r = { ok: r.ok, status: r.status, headers: r.headers, text: async () => t403 };   // non-CF 403: re-readable
        }
    }
    if (!r.ok && !o.allowFail) {
        const e = new Error('HTTP ' + r.status + ' @ ' + url.slice(0, 60));
        if (r.status === 403) e.cf = true;
        throw e;
    }
    return r;
}
const grabText = async (url, o = {}) => await (await grab(url, o)).text();

// CF block page detector — the honest-wall signature
const isCF = (txt) => /Attention Required|challenge-platform|Just a moment|cf-browser-verification|Verifying you are human|Checking if you are human|Access denied|Error 1020/i.test(String(txt || '').slice(0, 4000));
const cfErr = (host) => Object.assign(new Error(`${host} bot-traffic wall එකෙන් ඇතුලේ යන්න බෑ (Cloudflare) — ටික වෙලාවකින් ආයෙත් try කරන්න`), { cf: true });

// ── API (JSON) ──
async function api(params) {
    const qs = new URLSearchParams(params).toString();
    let r, txt;
    try {
        r = await grab(`${BASE}/api?${qs}`, { referer: BASE + '/', accept: 'application/json, text/plain, */*', timeout: 25e3 });
        txt = await r.text();
    } catch (e) {
        if (e && e.cf) throw cfErr(HOST);
        throw e;
    }
    if (isCF(txt)) throw cfErr(HOST);
    let j; try { j = JSON.parse(txt); } catch { throw new Error('API JSON fail — site එක response එක වෙනස් වෙලා (' + txt.slice(0, 50) + ')'); }
    return j;
}

// ── 1. search rows ──  {data:[{session, slug, title, poster, type, episodes, year}]}
function parseSearchRows(j) {
    const rows = [];
    for (const it of (Array.isArray(j?.data) ? j.data : [])) {
        if (!it || !it.session) continue;
        rows.push({
            session: String(it.session),
            title: String(it.title || it.name || it.slug || 'Untitled').replace(/\s+/g, ' ').trim(),
            slug: String(it.slug || ''),
            poster: String(it.poster || ''),
            type: String(it.type || ''),
            year: String(it.year || ''),
            episodes: Number(it.episodes) || 0,
        });
        if (rows.length >= MENU_ROWS) break;
    }
    return rows;
}

// ── 2. release rows ──  {last_page, data:[{session, episode, episode2, audio}]}
function parseReleaseRows(j) {
    const eps = [];
    for (const it of (Array.isArray(j?.data) ? j.data : [])) {
        if (!it || !it.session) continue;
        const n = Number(it.episode) || 0;
        eps.push({ session: String(it.session), ep: n, ep2: it.episode2 != null ? Number(it.episode2) : null, dub: String(it.audio || '') === 'eng' });
    }
    if (eps.length > 1 && eps[0].ep > eps[eps.length - 1].ep) eps.reverse();   // desc arrived → ep1 first
    return { eps, lastPage: Number(j?.last_page) || 1 };
}
const epLabel = (e) => `EP ${e.ep}${e.ep2 ? '.' + e.ep2 : ''}${e.dub ? ' [dub]' : ''}`;

// fetch releases pages 1..min(lastPage, EP_PAGES_MAX) → flat eps (≤ EP_CAP)
async function fetchReleases(animeSession) {
    const first = await api({ m: 'release', id: animeSession, sort: 'episode_asc', page: 1 });
    const p1 = parseReleaseRows(first);
    const eps = p1.eps;
    const lastPage = Math.min(p1.lastPage, EP_PAGES_MAX);
    for (let p = 2; p <= lastPage && eps.length < EP_CAP; p++) {
        try {
            const pj = parseReleaseRows(await api({ m: 'release', id: animeSession, sort: 'episode_asc', page: p }));
            eps.push(...pj.eps);
        } catch { break; }   // page fetch fail → menu එකේ තියෙන ටිකෙන් ඉස්සරහට
    }
    return { eps: eps.slice(0, EP_CAP), truncated: p1.lastPage > EP_PAGES_MAX || eps.length >= EP_CAP };
}

// ── 3. play page → #pickDownload rows [{url(pahe.win), label, res, sizeMB, fansub, dub, bd}] ──
const decodeEnt = (s) => String(s || '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&middot;/gi, '·')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ' '; } })
    .replace(/\s+/g, ' ').trim();
function parsePickDownload(html) {
    const rows = [];
    const seen = new Set();
    for (const a of html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']*(?:pahe\.win|kwik\.(?:cx|si))[^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
        const url = a[1];
        if (seen.has(url)) continue;
        seen.add(url);
        const text = decodeEnt(String(a[2]).replace(/<[^>]+>/g, ' '));
        const res = (text.match(/(\d{3,4})\s*p/i) || [])[1] || '';
        const sizeM = text.match(/\((\d+(?:\.\d+)?)\s*(MB|GB)\)/i);
        const sizeMB = sizeM ? Math.round(parseFloat(sizeM[1]) * (sizeM[2].toUpperCase() === 'GB' ? 1024 : 1)) : 0;
        const parts = text.split('·').map((p) => p.trim()).filter(Boolean);
        const fansub = parts.length >= 2 ? parts[0] : '';
        rows.push({
            url, label: text.slice(0, 80) || 'file',
            res: res ? parseInt(res, 10) : 0, sizeMB,
            fansub, dub: /\beng\b/i.test(text), bd: /\bBD\b/.test(text),
        });
        if (rows.length >= 60) break;
    }
    rows.sort((a, b) => (b.res - a.res) || (b.sizeMB - a.sizeMB));   // best-first
    return rows;
}

// ── 4. kwik/pahe.win form extraction (vm sandbox, $ shim — repo's jsdom approach, zero-dep) ──
function makeSandbox(found) {
    const noop = () => { };
    const capture = (s) => {
        if (found.action || typeof s !== 'string' || s.length < 20) return;
        const a = s.match(/action=["']([^"']+)["']/i);
        const t = s.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i);
        if (a && t) { found.action = a[1]; found.token = t[1]; }
    };
    const fakeEl = { innerHTML: '', style: {}, setAttribute: noop, getAttribute: () => '', appendChild: noop, remove: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } };
    const $ = (sel) => {
        if (typeof sel === 'function') { try { sel.call(document); } catch { } return $; }
        const api = {
            html: (v) => { if (v !== undefined) capture(v); return api; },
            append: (v) => { if (v !== undefined) capture(v); return api; },
            text: (v) => { if (v !== undefined) capture(v); return api; },
            attr: () => '', val: () => '', click: noop, on: noop, off: noop, each: noop,
            remove: noop, length: 0, eq: () => api, get: () => fakeEl, find: () => api, ready: (f) => { try { f(); } catch { } return api; },
        };
        return api;
    };
    $.ajax = noop; $.get = noop; $.post = noop; $.extend = () => { };
    const document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ ...fakeEl }), addEventListener: noop, body: fakeEl, readyState: 'complete', cookie: '' };
    const window = {};
    Object.assign(window, {
        document, navigator: { userAgent: UA }, location: { href: '', search: '', pathname: '/', host: 'pahe.win' },
        setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
        atob: (s) => Buffer.from(String(s), 'base64').toString('binary'), btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
        addEventListener: noop, requestAnimationFrame: () => 0,
    });
    window.window = window; window.self = window; window.top = window; window.globalThis = window;
    return {
        window, document, $, jQuery: $, navigator: window.navigator, location: window.location,
        atob: window.atob, btoa: window.btoa, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
        setInterval: window.setInterval, clearInterval: window.clearInterval,
        MutationObserver: function () { this.observe = noop; this.disconnect = noop; },
        XMLHttpRequest: function () { this.open = noop; this.send = noop; this.setRequestHeader = noop; },
        fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
        console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    };
}
function extractFormTokens(html) {
    // cheap path 1: raw form markup
    const form = html.match(/<form[^>]*action=["']([^"']+)["'][^>]*>([\s\S]{0,4000}?)<\/form>/i);
    if (form) {
        const t = form[2].match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i) || form[2].match(/value=["']([^"']+)["'][^>]*name=["']_token["']/i);
        if (t) return { action: form[1].replace(/&amp;/g, '&'), token: t[1] };
    }
    // cheap path 2: tokens visible in inline JS strings
    const found = { action: '', token: '' };
    const js = html.match(/action=["']([^"']*\/[^"']*)["'][\s\S]{0,600}?name=["']_token["'][^>]*value=["']([^"']+)["']/i);
    if (js) return { action: js[1].replace(/&amp;/g, '&'), token: js[2] };
    // vm path: run page scripts, capture the form HTML the page builds via $().html(...)
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    for (const s of scripts) {
        if (!s || s.length < 100) continue;
        try { vm.runInNewContext(s, makeSandbox(found), { timeout: 3000, displayErrors: false }); } catch { }
        if (found.action && found.token) break;
    }
    return found.action && found.token ? { action: found.action, token: found.token } : null;
}
const pageTitle = (html) => decodeEnt(((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s*::\s*Kwik.*$/i, '').slice(0, 90));

// ── 5. resolve pahe.win/kwik page → DIRECT file URL (POST _token → 302 Location) ──
async function resolveDirect(pageUrl, o = {}) {
    const r = await grab(pageUrl, { referer: o.referer || BASE + '/', timeout: 25e3 });
    const setCookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => String(c).split(';')[0]).filter(Boolean);
    const html = await r.text();
    if (isCF(html)) throw cfErr(new URL(pageUrl).host);
    const tok = extractFormTokens(html);
    if (!tok) throw new Error('download form එක හම්බුණේ නෑ — file links expire වෙලා වෙන්න පුළුවන්');
    const u = new URL(pageUrl);
    const cl = await clearance(u.host);   // 🥷 v3.03 stealth clearance reuse for the pahe.win POST (cached — no re-solve)
    const cookieLine = [setCookies.join('; '), cl && cl.cookie].filter(Boolean).join('; ');
    const post = await fetch(tok.action, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: pageUrl,
            Origin: u.origin,
            ...(cookieLine ? { Cookie: cookieLine } : {}),
            'User-Agent': cl && cl.ua ? cl.ua : UA,
        },
        body: '_token=' + encodeURIComponent(tok.token),
        redirect: 'manual',
        signal: AbortSignal.timeout(25e3),
    });
    let dl = post.headers.get('location') || '';
    if (!dl && post.status === 200) {
        const body = await post.text().catch(() => '');
        dl = (body.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*url=["']?([^"'\s>]+)["']?/i) || body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    }
    if (!dl) throw new Error('direct link එක එළියට එන්නේ නෑ (HTTP ' + post.status + ')');
    return { url: dl.replace(/&amp;/g, '&'), filename: pageTitle(html) };
}

// ── 🌐 v3.04 CONSUMET provider — consumet.ts animepahe contract (keyless JSON, zero-dep).
// Shapes are the documented ISearch/ISource contract; parsers are defensive because the official
// instance is dead (451) so live-shape verification is impossible until a working base exists.
function parseConsumetSearch(j) {
    const rows = [];
    for (const it of (Array.isArray(j?.results) ? j.results : (Array.isArray(j) ? j : []))) {
        if (!it || !it.id) continue;
        rows.push({
            session: String(it.id),
            title: String(it.title || it.name || it.id || 'Untitled').replace(/\s+/g, ' ').trim(),
            slug: String(it.slug || ''),
            poster: String(it.image || it.poster || it.cover || ''),
            type: String(it.type || ''),
            year: String(it.year || ''),
            episodes: Number(it.episodes) || 0,
        });
        if (rows.length >= MENU_ROWS) break;
    }
    return rows;
}
function parseConsumetInfo(j) {
    const eps = [];
    for (const it of (Array.isArray(j?.episodes) ? j.episodes : [])) {
        if (!it || !it.id) continue;
        const n = Number(it.number ?? it.episode ?? it.ep) || eps.length + 1;
        eps.push({ session: String(it.id), ep: n, ep2: null, dub: false });
    }
    if (eps.length > 1 && eps[0].ep > eps[eps.length - 1].ep) eps.reverse();
    return eps;
}
function parseConsumetWatch(j) {
    const rows = [];
    for (const s of (Array.isArray(j?.sources) ? j.sources : (Array.isArray(j) ? j : []))) {
        if (!s || !s.url) continue;
        const url = String(s.url);
        if (/\.m3u8($|\?)/i.test(url) || s.isM3U8 === true) continue;   // HLS stream — FILE එකට බෑ (honest skip)
        const qlab = String(s.quality || '');
        const res = (qlab.match(/(\d{3,4})/) || url.match(/(\d{3,4})p/) || [])[1] || '';
        rows.push({ url, label: qlab || 'file', res: res ? parseInt(res, 10) : 0, sizeMB: 0, fansub: '', dub: false, bd: false, referer: String(j?.headers?.Referer || 'https://animepahe.ru/') });
        if (rows.length >= 20) break;
    }
    rows.sort((a, b) => (b.res - a.res) || (b.sizeMB - a.sizeMB));   // best-first
    return rows;
}
// consumet GET — plain fetcher (NO solver: a dead/blocked instance must fail fast into the
// direct ladder, never wake the RAM-heavy stealth browser for it)
async function cGet(pathname, timeout = 15e3) {
    const r = await fetcher(consumetBase() + pathname, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    let j; try { j = JSON.parse(txt); } catch { const e = new Error('non-JSON response (instance dead/parked)'); e.status = r.status; throw e; }
    return j;
}
const cSearch = (q) => cGet('/anime/animepahe/' + encodeURIComponent(q) + '?page=1');
const cInfo = (id) => cGet('/anime/animepahe/info?id=' + encodeURIComponent(id));
const cWatch = (epId) => cGet('/anime/animepahe/watch/' + encodeURIComponent(epId));
// provider ladder — consumet first (unless known-dead within TTL) → direct → honest dual-fail card
async function searchProvider(q) {
    const cb = consumetBase();
    if (!(cState.ok === false && Date.now() - cState.at < C_STATE_TTL)) {
        try {
            const rows = parseConsumetSearch(await cSearch(q));
            cState = { ok: true, at: Date.now(), status: 200 };
            return { src: 'consumet', rows, base: cb };
        } catch (e) {
            cState = { ok: false, at: Date.now(), status: e.status || 0 };
            console.log(`[ANIMEPAHE] consumet ${cb} FAIL ${String(e.message).slice(0, 60)} — direct ladder fallback ⚠️`);
        }
    }
    try {
        const rows = parseSearchRows(await api({ m: 'search', q, page: 1 }));
        return { src: 'direct', rows, base: cb };
    } catch (de) {
        const cPart = `Consumet API (${cb}) = ${cState.status || 'fail'} — public instance එක dead 🪦`;
        const dPart = de.cf ? `${HOST} = bot-traffic wall (Cloudflare 403 — server IP hard-blocked)` : `${HOST} = ` + String(de.message).slice(0, 80);
        const e = new Error(`${cPart} · ${dPart}\n💡 fix 2ක්: *.setconsumet <api-url>* (වැඩ කරන instance එකක්) / *.setproxy* (residential proxy — ඔයාගේ home IP එක animepahe වලට pass)`);
        e.cf = !!de.cf;
        throw e;
    }
}

// ── sessions (cinesite grammar) ──
const sessions = new Map();
const gcSessions = () => {
    for (const [k, s] of sessions) if (Date.now() - (s.at || 0) > TTL) sessions.delete(k);
    if (sessions.size > CAP) sessions.delete(sessions.keys().next().value);
};
const remember = (jid, s) => { gcSessions(); sessions.set(jid, s); };

// ── cards ──
function searchCard(q, items) {
    const rows = items.map((it, i) => `${i + 1}. 📺 ${it.title.slice(0, 60)} · ${it.type || 'TV'}${it.year ? ' ' + it.year : ''}${it.episodes ? ' · ' + it.episodes + ' ep' : ''}`);
    return [`${BRAND} search — "${q}"`, '', ...rows, '', '✦ ගානක් *quote කරලා* එවන්න → episode menu'].join('\n') + '\n' + foot(HOST);
}
function epsCard(ctx) {
    const lines = [BRAND, `📄 ${String(ctx.title || 'Untitled').slice(0, 80)}`, `📺 Episodes ${ctx.eps.length}${ctx.truncated ? '+' : ''}`, ''];
    ctx.eps.forEach((e, i) => lines.push(`${i + 1}. ${epLabel(e)}`));
    if (ctx.truncated) lines.push(`⚠️ මුල් ${ctx.eps.length} විතරයි — ඉතුරු ටික menu එකේ නෑ`);
    lines.push('', '✦ Episode ගානක් *quote කරලා* එවන්න → quality menu');
    return lines.join('\n') + '\n' + foot(HOST);
}
function qualityCard(ctx, qs) {
    const lines = [BRAND, `📄 ${String(ctx.title || 'Untitled').slice(0, 90)}`];
    if (ctx.epLabel) lines.push(`🎬 ${ctx.epLabel}`);
    lines.push('', '📋 Quality එක තෝරන්න — ගානක් *quote කරලා* එවන්න:');
    qs.forEach((q, i) => lines.push(`${i + 1}. ${q.res ? q.res + 'p' : 'file'}${q.bd ? ' BD' : ''}${q.dub ? ' dub' : ''} · ${q.sizeMB ? q.sizeMB + ' MB' : 'size ?'}${q.fansub ? ' · ' + q.fansub.slice(0, 20) : ''}`));
    return lines.join('\n') + '\n' + foot(HOST);
}
const USAGE = `${BRAND} — *.animepahe <නම / link>* (alias *.aphe*)
උදා: \`.animepahe frieren\`

✦ නමක් දුන්නාම → search menu → ගානක් quote කරන්න
✦ episode menu → quality menu → 📥 FILE (kwik/pahe.win direct)
✦ ${HOST}/play/… link එකක් දුන්නාම → කෙලින්ම quality menu එකෙන් පටන් ගන්නවා
✦ mkv/mp4 files — සැබෑ download links (stream නෙවෙයි)
✦ source: Consumet API mirror (*.setconsumet*) / animepahe.pw direct (*.setproxy*)\n` + foot(HOST);

// ── flow steps ──
async function openAnime(ctx, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    let eps, truncated;
    if (ctx.src === 'consumet') {
        eps = parseConsumetInfo(await cInfo(ctx.session));
        truncated = eps.length >= EP_CAP;
    } else {
        ({ eps, truncated } = await fetchReleases(ctx.session));
    }
    if (!eps.length) throw new Error('episodes හම්බුණේ නෑ — මේ anime එකේ release එකක් නෑ');
    Object.assign(ctx, { stage: 'eps', eps, truncated, at: Date.now() });
    await edit(epsCard(ctx));
    ctx.cardId = st.key?.id || null;
}

async function openEpisode(ctx, n, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const ep = ctx.eps[n - 1];
    let qs, title;
    if (ctx.src === 'consumet') {
        qs = parseConsumetWatch(await cWatch(ep.session));
        title = ctx.title;
    } else {
        const playUrl = `${BASE}/play/${ctx.session}/${ep.session}`;
        const html = await grabText(playUrl, { referer: BASE + '/' });
        qs = parsePickDownload(html);
        title = (pageTitle(html) || ctx.title);
    }
    if (!qs.length) throw new Error('download links නෑ — මේ episode එක stream විතරයි');
    Object.assign(ctx, { stage: 'quality', qs, epLabel: epLabel(ep), title, at: Date.now() });
    const cap = qualityCard(ctx, qs);
    if (ctx.poster) {
        try {
            const im = await send(jid, { image: { url: ctx.poster }, caption: cap }, { quoted: msg });
            ctx.cardId = im?.key?.id || null;
            try { await send(jid, { delete: st.key }); } catch { }
            return;
        } catch { }
    }
    await edit(cap);
    ctx.cardId = st.key?.id || null;
}

async function goPick(send, jid, msg, n, download) {
    gcSessions();
    const ctx = sessions.get(jid);
    if (!ctx) return send(jid, { text: `⏳ session expire වෙලා — *.animepahe <නම>* ආයෙත් ගහන්න` }, { quoted: msg });
    if (ctx.stage === 'search') {
        if (!ctx.items[n - 1]) return send(jid, { text: `❌ ${n} — menu එකේ නෑ (1-${ctx.items.length})` }, { quoted: msg });
        const it = ctx.items[n - 1];
        const st = await send(jid, { text: `${BRAND} — episodes කියවනවා…` }, { quoted: msg });
        try {
            Object.assign(ctx, { session: it.session, title: it.title, poster: it.poster });
            await openAnime(ctx, { send, jid, msg, st });
            return true;
        } catch (e) { return await (async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } })('❌ AnimePahe: ' + String((e && e.message) || e).slice(0, 180)); }
    }
    if (ctx.stage === 'eps') {
        if (!ctx.eps[n - 1]) return send(jid, { text: `❌ ${n} — episode එකක් නෑ (1-${ctx.eps.length})` }, { quoted: msg });
        const st = await send(jid, { text: `${BRAND} — episode links කියවනවා…` }, { quoted: msg });
        try { await openEpisode(ctx, n, { send, jid, msg, st }); return true; }
        catch (e) { return await (async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } })('❌ AnimePahe: ' + String((e && e.message) || e).slice(0, 180)); }
    }
    const q = ctx.qs && ctx.qs[n - 1];
    if (!q) return send(jid, { text: `❌ ${n} — quality එකක් නෑ (1-${(ctx.qs || []).length})` }, { quoted: msg });
    if (!download) return send(jid, { text: `🔗 ${q.url}` }, { quoted: msg });   // tests / fallback
    sessions.delete(jid);
    const st = await send(jid, { text: `${BRAND} — direct link resolve කරනවා…` }, { quoted: msg });
    try {
        const { url, filename } = await resolveDirect(q.url, { referer: q.referer });
        try { await send(jid, { text: `📥 ${filename || 'file'} — download පටන් ගන්නවා…`, edit: st.key }); } catch { }
        await download(url + '#apref=' + encodeURIComponent(q.referer || q.url), TAG + (ctx.epLabel ? ` · ${ctx.epLabel}` : '') + ` · ${q.res ? q.res + 'p' : 'file'}`);
        return true;
    } catch (e) {
        return await (async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } })('❌ AnimePahe: ' + String((e && e.message) || e).slice(0, 180));
    }
}

// ── command handle — (cmd, {send,jid,msg,rest,react,download}) cinesite contract ──
const isApUrl = (arg) => {
    const m = String(arg || '').match(/https?:\/\/(?:www\.)?animepahe\.[a-z]+\/(play|anime)\/([^\s#]+)/i);
    return m ? { kind: m[1].toLowerCase(), path: '/' + m[1] + '/' + m[2].replace(/\/+$/, '') } : null;
};
async function handle(c, ctx) {
    if (!CMDS[String(c || '').toLowerCase()]) return false;
    const { send, jid, msg, rest, react, download } = ctx;
    const arg = rest.join(' ').trim();

    const mNum = arg.match(/^(?:go\s+)?(\d{1,4})$/i);   // .animepahe 2 / .aphe go 2
    if (mNum) return goPick(send, jid, msg, parseInt(mNum[1], 10), download);
    if (!arg) return send(jid, { text: USAGE }, { quoted: msg });

    await react?.('🎌');
    const st = await send(jid, { text: `${BRAND} — search කරනවා…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const lnk = isApUrl(arg);
        if (lnk) {
            gcSessions();
            if (lnk.kind === 'play') {
                const parts = lnk.path.split('/').filter(Boolean);   // ['play', anime, ep]
                if (parts.length < 3) throw new Error('play link එකේ format එක වැරදියි — /play/<anime>/<episode>');
                const sctx = { cmd: String(c).toLowerCase(), stage: 'eps', session: parts[1], title: '(play link)', poster: '', eps: [{ session: parts[2], ep: 1, ep2: null, dub: false }], truncated: false, url: BASE + lnk.path, at: Date.now(), cardId: null };
                remember(jid, sctx);
                const html = await grabText(sctx.url, { referer: BASE + '/' });
                sctx.qs = parsePickDownload(html);
                if (!sctx.qs.length) throw new Error('download links නෑ — මේ episode එක stream විතරයි');
                sctx.stage = 'quality';
                sctx.title = pageTitle(html) || sctx.title;
                sctx.epLabel = 'EP (link)';
                await edit(qualityCard(sctx, sctx.qs));
                sctx.cardId = st.key?.id || null;
                return true;
            }
            // /anime/<session> → episode menu
            const parts = lnk.path.split('/').filter(Boolean);   // ['anime', session]
            const sctx = { cmd: String(c).toLowerCase(), stage: 'search', session: parts[1], title: '(anime link)', poster: '', items: [], at: Date.now(), cardId: null };
            remember(jid, sctx);
            await openAnime(sctx, { send, jid, msg, st });
            return true;
        }
        if (arg.length > 80) throw new Error('search query එක 80 අකුරු ඇතුලේ වෙන්න ඕන');
        const prov = await searchProvider(arg);
        if (!prov.rows.length) return await edit(`${BRAND} search — "${arg.slice(0, 40)}"\n\n❌ මුකුතු හම්බුණේ නෑ — වෙන නමක් / කෙටි නමක් try කරන්න\n` + foot(HOST));
        remember(jid, { cmd: String(c).toLowerCase(), stage: 'search', q: arg.slice(0, 80), items: prov.rows, src: prov.src, at: Date.now(), cardId: null });
        await edit(searchCard(arg.slice(0, 40), prov.rows));
        sessions.get(jid).cardId = st.key?.id || null;
        return true;
    } catch (e) {
        return await edit('❌ AnimePahe: ' + String((e && e.message) || e).slice(0, 260));
    }
}
// numeric quote bridge (bot.js chain) — card quote එකට number → '.animepahe go N'
function bridge(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s || !s.cmd) return null;
    if (Date.now() - (s.at || 0) > TTL + 30 * 60e3) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d) || d < 1) return null;
    if (qid && s.cardId && String(qid) !== String(s.cardId)) return null;   // 🔒 reply-only
    return s.cmd + ' go ' + d;
}

// boot health probe — one-shot console log (panel-network truth, ~9s after boot). v3.03: on a CF
// wall it goes one step further — reports whether the stealth solver is installed and actually
// tries ONE solve, so the boot log is the definitive "does .animepahe work here" truth.
let booted = false;
function healthCheck(delayMs = 9000) {
    if (booted) return;
    booted = true;
    const t = setTimeout(async () => {
        // 🌐 v3.04: consumet base probe first — the boot log carries BOTH provider truths.
        try {
            const cb = consumetBase();
            const p = await probeConsumetBase(cb);
            console.log(`[ANIMEPAHE] consumet ${cb} boot probe = ${p.status} ${p.why}${p.ok ? ' ✅ provider READY' : ' ⚠️ dead → direct ladder'}`);
        } catch { }
        try {
            if (process.env.ARENA_APHE_SOLVER === '0') { console.log('[ANIMEPAHE] solver disabled (ARENA_APHE_SOLVER=0) — plain fetch only'); }
            const r = await fetcher(`${BASE}/api?m=search&q=a&page=1`, { headers: { 'User-Agent': UA, Referer: BASE + '/' }, signal: AbortSignal.timeout(15e3) });
            const txt = await r.text().catch(() => '');
            const cf = isCF(txt);
            const json = !cf && /"data"/.test(txt) ? ' JSON-OK' : '';
            console.log(`[ANIMEPAHE] ${HOST} boot probe = ${r.status}${cf ? ' CF-WALLED' : ''}${json}${!cf && json ? ' ✅' : ' ⚠️'}`);
            if (r.status === 403 || cf) {
                if (process.env.ARENA_APHE_SOLVER === '0') { console.log('[ANIMEPAHE] → .animepahe answers honest wall cards (solver off by env)'); return; }
                const mod = getSolver();
                if (!mod) { console.log('[ANIMEPAHE] solver: puppeteer ABSENT (npm optionalDependencies not installed) — honest wall cards stay'); return; }
                const c = await clearance(HOST);
                if (c) console.log('[ANIMEPAHE] ✅ stealth SOLVE OK — cf_clearance cached, .animepahe READY 🥷');
                else console.log('[ANIMEPAHE] ❌ stealth solve failed — honest wall cards stay (check panel RAM / chromium libs)');
            }
        } catch (e) {
            console.log(`[ANIMEPAHE] ${HOST} boot probe FAIL ${String((e && e.message) || e).slice(0, 60)} ⚠️`);
        }
    }, delayMs);
    if (t.unref) t.unref();
}

module.exports = {
    handle, bridge, healthCheck, setFetcher, setSolver, getSolver, clearance, CMDS, BASE, HOST,
    parseSearchRows, parseReleaseRows, parsePickDownload, extractFormTokens, resolveDirect,
    fetchReleases, epLabel, isApUrl, _sessions: sessions, _cfCache: cfCache,
    parseConsumetSearch, parseConsumetInfo, parseConsumetWatch, consumetBase, probeConsumetBase,
    cSearch, cInfo, cWatch, _cTest,
    _cfTest: (p = {}) => {   // tests: deterministic solver-ladder state
        if ('failStreak' in p) failStreak = p.failStreak;
        if ('lastSolveAt' in p) lastSolveAt = p.lastSolveAt;
        if ('lastFailAt' in p) lastFailAt = p.lastFailAt;
        return { failStreak, lastSolveAt, lastFailAt };
    },
};
