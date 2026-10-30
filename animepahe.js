/**
 * animepahe.js — v3.02.0 🎌 .animepahe — anime search → episodes → quality → FILE downloads
 * Source: animepahe.pw internal API (ElijahCodes12345/animepahe-api contract, ported keyless zero-dep).
 *
 * LIVE-PROBED 2026-10-30 (scripts/probe_animepahe*.js): animepahe.pw = Cloudflare WAF block
 * ("Attention Required", 403) from sandbox datacenter IP AND free-proxy IPs (0/24 pass) —
 * cf-mitigated:challenge on kwik.cx/pahe.win. Panel network PASSED cinesubz CF (v3.01 boot probe),
 * so panel truth comes from healthCheck() boot log; every flow has an honest CF-wall card —
 * the command NEVER fakes success.
 *
 * Contract (from the reference repo, exact endpoints):
 *   search:   GET /api?m=search&q=<q>&page=1          → { data: [{session, slug, title, poster,
 *                                                       type, episodes, year}] }
 *   releases: GET /api?m=release&id=<session>&sort=episode_asc&page=N
 *                                                      → { last_page, data: [{session (ep),
 *                                                       episode, episode2, audio, snapshot}] }
 *   play:     GET /play/<animeSession>/<epSession>     → HTML with #pickDownload <a href="pahe.win/…">
 *                                                       (label "fansub · 1080p (1.3GB) · eng/BD")
 *   download: pahe.win page = kwik-style form page → script builds <form action=_token> →
 *             POST _token → 302 Location = DIRECT file URL (Referer: download page needed)
 *
 * Flow (cinesite.js session grammar — quote-reply only, cardId-enforced):
 *   .animepahe <name> → search menu → quote N → 📺 episode menu (ep1 first, [dub] rows) →
 *   quote M → 🎬 quality card (res · size · fansub · BD) → quote K → FILE via dlQueue.
 *   Direct URL jumps: /play/<a>/<e> → quality menu · /anime/<session> → episode menu.
 * Final URL carries #apref=<download-page> fragment → resolvers strips it into the Referer
 * (pahe.win CDN drops referer-less file requests).
 */
const vm = require('vm');
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
const CMDS = { '.animepahe': 1, '.aphe': 1 };

// net.js smartFetch — fetcher seam (metdn/cinesite pattern): tests inject a mock; live = smartFetch.
let fetcher = (u, o) => smartFetch(u, o);
const setFetcher = (f) => { const prev = fetcher; fetcher = f; return prev; };
async function grab(url, o = {}) {
    const r = await fetcher(url, {
        headers: { 'User-Agent': UA, Accept: o.accept || 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9', ...(o.referer ? { Referer: o.referer } : {}), ...(o.headers || {}) },
        ...(o.method ? { method: o.method, body: o.body } : {}), signal: AbortSignal.timeout(o.timeout || TIMEOUT),
    });
    if (!r.ok && !o.allowFail) {
        const e = new Error('HTTP ' + r.status + ' @ ' + url.slice(0, 60));
        if (r.status === 403) e.cf = true;
        throw e;
    }
    return r;
}
const grabText = async (url, o = {}) => await (await grab(url, o)).text();

// CF block page detector — the honest-wall signature
const isCF = (txt) => /Attention Required|challenge-platform|Just a moment|cf-browser-verification/i.test(String(txt || '').slice(0, 4000));
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
async function resolveDirect(pageUrl) {
    const r = await grab(pageUrl, { referer: BASE + '/', timeout: 25e3 });
    const setCookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => String(c).split(';')[0]).filter(Boolean);
    const html = await r.text();
    if (isCF(html)) throw cfErr(new URL(pageUrl).host);
    const tok = extractFormTokens(html);
    if (!tok) throw new Error('download form එක හම්බුණේ නෑ — file links expire වෙලා වෙන්න පුළුවන්');
    const u = new URL(pageUrl);
    const post = await fetch(tok.action, {
        method: 'POST',
        headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: pageUrl,
            Origin: u.origin,
            ...(setCookies.length ? { Cookie: setCookies.join('; ') } : {}),
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
✦ episode menu → quality menu → 📥 FILE (pahe.win direct)
✦ ${HOST}/play/… link එකක් දුන්නාම → කෙලින්ම quality menu එකෙන් පටන් ගන්නවා
✦ mkv/mp4 files — සැබෑ download links (stream නෙවෙයි)\n` + foot(HOST);

// ── flow steps ──
async function openAnime(ctx, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const { eps, truncated } = await fetchReleases(ctx.session);
    if (!eps.length) throw new Error('episodes හම්බුණේ නෑ — මේ anime එකේ release එකක් නෑ');
    Object.assign(ctx, { stage: 'eps', eps, truncated, at: Date.now() });
    await edit(epsCard(ctx));
    ctx.cardId = st.key?.id || null;
}

async function openEpisode(ctx, n, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const ep = ctx.eps[n - 1];
    const playUrl = `${BASE}/play/${ctx.session}/${ep.session}`;
    const html = await grabText(playUrl, { referer: BASE + '/' });
    const qs = parsePickDownload(html);
    if (!qs.length) throw new Error('download links නෑ — මේ episode එක stream විතරයි');
    Object.assign(ctx, { stage: 'quality', qs, epLabel: epLabel(ep), playUrl, title: (pageTitle(html) || ctx.title), at: Date.now() });
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
        const { url, filename } = await resolveDirect(q.url);
        try { await send(jid, { text: `📥 ${filename || 'file'} — download පටන් ගන්නවා…`, edit: st.key }); } catch { }
        await download(url + '#apref=' + encodeURIComponent(q.url), TAG + (ctx.epLabel ? ` · ${ctx.epLabel}` : '') + ` · ${q.res ? q.res + 'p' : 'file'}`);
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
        const rows = parseSearchRows(await api({ m: 'search', q: arg, page: 1 }));
        if (!rows.length) return await edit(`${BRAND} search — "${arg.slice(0, 40)}"\n\n❌ මුකුතු හම්බුණේ නෑ — වෙන නමක් / කෙටි නමක් try කරන්න\n` + foot(HOST));
        remember(jid, { cmd: String(c).toLowerCase(), stage: 'search', q: arg.slice(0, 80), items: rows, at: Date.now(), cardId: null });
        await edit(searchCard(arg.slice(0, 40), rows));
        sessions.get(jid).cardId = st.key?.id || null;
        return true;
    } catch (e) {
        return await edit('❌ AnimePahe: ' + String((e && e.message) || e).slice(0, 180));
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

// boot health probe — one-shot console log (panel-network truth, 8s after boot)
let booted = false;
function healthCheck(delayMs = 9000) {
    if (booted) return;
    booted = true;
    const t = setTimeout(async () => {
        try {
            const r = await fetcher(`${BASE}/api?m=search&q=a&page=1`, { headers: { 'User-Agent': UA, Referer: BASE + '/' }, signal: AbortSignal.timeout(15e3) });
            const txt = await r.text().catch(() => '');
            const cf = isCF(txt) ? ' CF-WALLED' : '';
            const json = !cf && /"data"/.test(txt) ? ' JSON-OK' : '';
            console.log(`[ANIMEPAHE] ${HOST} boot probe = ${r.status}${cf}${json}${!cf && json ? ' ✅' : ' ⚠️'}`);
        } catch (e) {
            console.log(`[ANIMEPAHE] ${HOST} boot probe FAIL ${String((e && e.message) || e).slice(0, 60)} ⚠️`);
        }
    }, delayMs);
    if (t.unref) t.unref();
}

module.exports = {
    handle, bridge, healthCheck, setFetcher, CMDS, BASE, HOST,
    parseSearchRows, parseReleaseRows, parsePickDownload, extractFormTokens, resolveDirect,
    fetchReleases, epLabel, isApUrl, _sessions: sessions,
};
