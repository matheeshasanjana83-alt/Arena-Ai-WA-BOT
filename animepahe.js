/**
 * animepahe.js — v3.05.0 🎌 .animepahe — anime search → episodes → quality → FILE
 * CONSUMET-ONLY (user directive 2026-10-30: "Rewrite animepahe.js completely. Delete the massive
 * CF solver, vm sandbox, and direct scraping logic. Hardcode the new base URL. The .animepahe
 * command should ONLY use this new API."):
 *
 *   The ONLY data source is a Consumet API instance (consumet.ts animepahe contract, keyless JSON):
 *     search:  GET {base}/anime/animepahe/{q}?page=1          → { results:[{id,title,image,...}] }
 *     info:    GET {base}/anime/animepahe/info/{id}           → { episodes:[{id,number,...}] }
 *              (older instances: /info?id= — both forms tried)
 *     watch:   GET {base}/anime/animepahe/watch?episodeId=…   → { sources:[{url,quality,isM3U8}], headers:{Referer} }
 *              (older instances: /watch/{epId} — both forms tried)
 *     m3u8 (HLS) rows are skipped — FILE delivery needs direct mp4/mkv; the instance's Kwik
 *     extractor resolves pahe.win/kwik pages server-side and returns direct URLs + Referer.
 *
 *   Base URL = ARENA_CONSUMET_BASE env > settings.json "consumetBase" (*.setconsumet)
 *              > hardcoded default: https://api-consumet-org.vercel.app
 *              (the deterministic production URL of matheeshasanjana83-alt/api.consumet.org —
 *              repo ships a GitHub Actions workflow that deploys it to Vercel with one token).
 *
 *   ALL animepahe.pw direct scraping is GONE (user order): no internal-API calls, no download-page
 *   anchor parsing, no pahe.win form tokens, no vm sandbox, no stealth browser / cookie-bypass machinery.
 *   Errors are neutral short cards — no wall/dead-API commentary.
 *
 * Flow (cinesite.js session grammar — quote-reply only, cardId-enforced):
 *   .animepahe <name> → search menu → quote N → 📺 episode menu (ep1 first) →
 *   quote M → 🎬 quality card → quote K → FILE via dlQueue.
 *   URL jumps: /anime/<id> → episode menu · /play/<a>/<e> → quality card (episodeId = a/e).
 * Final URL carries #apref=<referer> fragment → resolvers.js strips it into the download Referer.
 */
const fs = require('fs');
const path = require('path');
const { foot } = require('./style');
const { smartFetch } = require('./net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST = 'api-consumet-org.vercel.app';
const BRAND = '🎌 AnimePahe';
const TAG = '🎌 AnimePahe';
const TTL = 30 * 60e3;
const CAP = 40;
const MENU_ROWS = 10;
const EP_CAP = 300;
const TIMEOUT = 20e3;
const CMDS = { '.animepahe': 1, '.aphe': 1, '.animepahae': 1, '.anemepahe': 1 };   // last two = user typos (2026-10-30)

// net.js smartFetch — fetcher seam (metdn/cinesite pattern): tests inject a mock; live = smartFetch.
let fetcher = (u, o) => smartFetch(u, o);
const setFetcher = (f) => { const prev = fetcher; fetcher = f; return prev; };

// ── 🌐 Consumet base — env > settings.json (.setconsumet) > hardcoded default (this repo's own
// Vercel deployment URL; deploy = add VERCEL_TOKEN secret → the Actions workflow ships it).
const CONSUMET_DEFAULT = 'https://api-consumet-org.vercel.app';
function consumetBase() {
    const env = String(process.env.ARENA_CONSUMET_BASE || '').trim();
    if (env) return env.replace(/\/+$/, '');
    try { const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); if (s.consumetBase) return String(s.consumetBase).replace(/\/+$/, ''); } catch { }
    return CONSUMET_DEFAULT;
}
// instance health state (unreachable verdict = 10 min skip, then one retry — never hammer a down base)
const C_STATE_TTL = 10 * 60e3;
let cState = { ok: null, at: 0, status: 0 };
const _cTest = (p = {}) => {
    if (p.reset) cState = { ok: null, at: 0, status: 0 };
    if ('ok' in p) cState.ok = p.ok;
    if ('at' in p) cState.at = p.at;
    if ('status' in p) cState.status = p.status;
    return { ...cState };
};
const neutralErr = (status, detail) => {
    const e = new Error(`API එකෙන් reply එකක් නෑ${status ? ` (HTTP ${status})` : ''} — ටික වෙලාවකින් ආයෙත් try කරන්න${detail ? ` · ${String(detail).slice(0, 60)}` : ''}`);
    e.status = status || 0;
    return e;
};
// probe a base URL once (owner .setconsumet verify + boot healthCheck) — shape report
async function probeConsumetBase(base) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(b)) return { ok: false, status: 0, why: 'URL format එක වැරදියි' };
    try {
        const r = await fetcher(b + '/anime/animepahe/a', { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
        const txt = await r.text().catch(() => '');
        let json = false; try { json = JSON.parse(txt) != null; } catch { }
        return { ok: r.ok && json, status: r.status, shape: json ? 'json' : 'html', why: r.ok ? (json ? 'JSON-OK' : 'non-JSON response') : 'HTTP ' + r.status };
    } catch (e) { return { ok: false, status: 0, why: String((e && e.message) || e).slice(0, 60) }; }
}

// ── consumet.ts animepahe contract parsers (defensive — every known response shape tolerated) ──
const epLabel = (e) => `EP ${e.ep}${e.ep2 ? '.' + e.ep2 : ''}${e.dub ? ' [dub]' : ''}`;
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
    if (eps.length > 1 && eps[0].ep > eps[eps.length - 1].ep) eps.reverse();   // desc arrived → ep1 first
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
        rows.push({ url, label: qlab || 'file', res: res ? parseInt(res, 10) : 0, sizeMB: 0, fansub: '', dub: false, bd: false, referer: String(j?.headers?.Referer || j?.headers?.referer || '') });
        if (rows.length >= 20) break;
    }
    rows.sort((a, b) => (b.res - a.res) || (b.sizeMB - a.sizeMB));   // best-first
    return rows;
}
// consumet GET — plain fetch, fail fast into the neutral card (no solver, no fallback ladder)
async function cGet(pathname, timeout = TIMEOUT) {
    const r = await fetcher(consumetBase() + pathname, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) throw neutralErr(r.status);
    let j; try { j = JSON.parse(txt); } catch { throw neutralErr(r.status, 'non-JSON response'); }
    return j;
}
const cSearch = (q) => cGet('/anime/animepahe/' + encodeURIComponent(q) + '?page=1');
async function cInfo(id) {
    const enc = encodeURIComponent(id);
    try { return await cGet(`/anime/animepahe/info/${enc}`); }
    catch (e) {
        if (e.status === 404 || e.status === 405) return await cGet(`/anime/animepahe/info?id=${enc}`);   // older instance shape
        throw e;
    }
}
async function cWatch(epId) {
    const enc = encodeURIComponent(epId);
    try { return await cGet(`/anime/animepahe/watch?episodeId=${enc}`); }
    catch (e) {
        if (e.status === 404 || e.status === 405) return await cGet(`/anime/animepahe/watch/${enc}`);   // older instance shape
        throw e;
    }
}
// consumet-only search — unreachable verdict cached 10 min (fail fast on repeats)
async function searchProvider(q) {
    const cb = consumetBase();
    if (cState.ok === false && Date.now() - cState.at < C_STATE_TTL) throw neutralErr(cState.status);
    try {
        const rows = parseConsumetSearch(await cSearch(q));
        cState = { ok: true, at: Date.now(), status: 200 };
        return { rows, base: cb };
    } catch (e) {
        cState = { ok: false, at: Date.now(), status: e.status || 0 };
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
✦ episode menu → quality menu → 📥 FILE (direct mp4)
✦ animepahe /anime/… link එකක් → episode menu · /play/… link එකක් → quality menu
✦ source: Consumet API (*.setconsumet* — instance එක මාරු කරන්න)\n` + foot(HOST);

// ── flow steps ──
async function openAnime(ctx, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const eps = parseConsumetInfo(await cInfo(ctx.session));
    const truncated = eps.length >= EP_CAP;
    if (!eps.length) throw new Error('episodes හම්බුණේ නෑ — මේ anime එකේ release එකක් නෑ');
    Object.assign(ctx, { stage: 'eps', eps: eps.slice(0, EP_CAP), truncated, at: Date.now() });
    await edit(epsCard(ctx));
    ctx.cardId = st.key?.id || null;
}

async function openEpisode(ctx, n, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const ep = ctx.eps[n - 1];
    const qs = parseConsumetWatch(await cWatch(ep.session));
    if (!qs.length) throw new Error('download links නෑ — මේ episode එක HLS stream විතරයි');
    Object.assign(ctx, { stage: 'quality', qs, epLabel: epLabel(ep), title: ctx.title, at: Date.now() });
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

// direct-file guard — consumet watch SHOULD return server-resolved direct URLs (Kwik extractor);
// a raw kwik/pahe.win PAGE link means the instance-side extraction failed → honest short error.
const looksDirect = (url) => {
    try {
        const u = new URL(url);
        if (/\.(mp4|mkv|webm|m4v|mpa|mov)(\?|$)/i.test(u.pathname + u.search)) return true;
        return !/kwik\.|pahe\.win/i.test(u.host);
    } catch { return false; }
};

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
    if (!looksDirect(q.url)) return send(jid, { text: `❌ AnimePahe: file link එක resolve වුණේ නෑ — වෙන quality එකක් try කරන්න` }, { quoted: msg });
    sessions.delete(jid);
    const st = await send(jid, { text: `${BRAND} — file එක ගන්නවා…` }, { quoted: msg });
    try {
        try { await send(jid, { text: `📥 ${ctx.title || 'file'}${ctx.epLabel ? ' · ' + ctx.epLabel : ''} — download පටන් ගන්නවා…`, edit: st.key }); } catch { }
        const referer = q.referer || q.url;
        await download(q.url + '#apref=' + encodeURIComponent(referer), TAG + (ctx.epLabel ? ` · ${ctx.epLabel}` : '') + ` · ${q.res ? q.res + 'p' : 'file'}`);
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
            const parts = lnk.path.split('/').filter(Boolean);
            if (lnk.kind === 'play') {
                // /play/<anime>/<episode> — consumet episodeId = "<anime>/<episode>" (provider GETs /play/{id})
                if (parts.length < 3) throw new Error('play link එකේ format එක වැරදියි — /play/<anime>/<episode>');
                const epId = parts.slice(1).join('/');
                const sctx = { cmd: String(c).toLowerCase(), stage: 'eps', session: epId, title: '(play link)', poster: '', eps: [{ session: epId, ep: 1, ep2: null, dub: false }], truncated: false, at: Date.now(), cardId: null };
                remember(jid, sctx);
                await openEpisode(sctx, 1, { send, jid, msg, st });
                sctx.epLabel = 'EP (link)';
                return true;
            }
            // /anime/<id> → episode menu straight from consumet info
            const sctx = { cmd: String(c).toLowerCase(), stage: 'search', session: parts[1], title: '(anime link)', poster: '', items: [], at: Date.now(), cardId: null };
            remember(jid, sctx);
            await openAnime(sctx, { send, jid, msg, st });
            return true;
        }
        if (arg.length > 80) throw new Error('search query එක 80 අකුරු ඇතුලේ වෙන්න ඕන');
        const prov = await searchProvider(arg);
        if (!prov.rows.length) return await edit(`${BRAND} search — "${arg.slice(0, 40)}"\n\n❌ මුකුතු හම්බුණේ නෑ — වෙන නමක් / කෙටි නමක් try කරන්න\n` + foot(HOST));
        remember(jid, { cmd: String(c).toLowerCase(), stage: 'search', q: arg.slice(0, 80), items: prov.rows, at: Date.now(), cardId: null });
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

// boot health probe — one-shot console log (panel-network truth, ~9-11s after boot)
let booted = false;
function healthCheck(delayMs = 9000) {
    if (booted) return;
    booted = true;
    const t = setTimeout(async () => {
        try {
            const cb = consumetBase();
            const p = await probeConsumetBase(cb);
            console.log(`[ANIMEPAHE] consumet ${cb} boot probe = ${p.status} ${p.why}${p.ok ? ' ✅ provider READY' : ' ⚠️ not answering'}`);
        } catch (e) {
            console.log(`[ANIMEPAHE] boot probe FAIL ${String((e && e.message) || e).slice(0, 60)} ⚠️`);
        }
    }, delayMs);
    if (t.unref) t.unref();
}

module.exports = {
    handle, bridge, healthCheck, setFetcher, CMDS, HOST, isApUrl, epLabel,
    _sessions: sessions,
    consumetBase, CONSUMET_DEFAULT, probeConsumetBase,
    parseConsumetSearch, parseConsumetInfo, parseConsumetWatch,
    cSearch, cInfo, cWatch, searchProvider, looksDirect, _cTest,
};
