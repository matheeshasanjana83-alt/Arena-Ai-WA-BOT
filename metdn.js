/**
 * metdn.js — 🔞 mat6tube.com search + quality menu downloader (v2.88.0)
 * v2.86 = link-only (window.playlist → BEST auto-download, yt-dlp #14613 port). v2.88 = the
 * user's OWN mat6tube-catalog-api (transfer zip, Express+cheerio) ported IN-BOT regex-native —
 * same engine, zero deps, no second process (established pattern: javdn/terabox/hmanga).
 * LIVE-PROBED 2026-10-21 (probe_metdn_search.js):
 *   search = /video/<q> (+?p=<page-1>, one-based API page) → .list_videos .item blocks —
 *   <a href="/watch/ID" class="item_link"> (href BEFORE class — attr-order-aware regex both ways),
 *   img data-src (lazy base64 in src!), .i_info .title, .m_views " 2.81M", .m_time " 1:48:28",
 *   <i class="hd_mark">HD</i>; .more[data-page]:not([data-action=prev]):not([hidden]) = hasNext
 *   (page 2 carries a prev button — excluded); 24 items/page; trailer data-trailer_url (tr.
 *   host) correctly outside the pvvstream allowlist.
 * FLOW (user: '.metdn <name title> search menu ~> quality menu ~> download විදිහට ඔනි'):
 *   .metdn <query> → search menu (10 rows) → quote N → quality card (thumb + numbered mp4
 *   qualities, ⭐ BEST first) → quote M → FRESH page re-fetch (signed URLs are short-lived —
 *   the API streams fresh sources per download request) → LABEL-matched download.
 *   .metdn <link> → straight into the same quality card. .metdn more → next search page.
 * API policy ported: mp4-only sources (hls filtered), 3-4 digit quality labels, query 1-80
 * chars no control chars, page ≤50, entity-decoded titles; sessions TTL 30min cap 40 +
 * reply-only cardId-enforced bridge (terabox pattern, bot.js numeric chain).
 */
const { foot } = require('./style');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const HOST_RE = /^(?:[\w-]+\.)*(?:mat6tube\.com|noodlemagazine\.com)$/i;
const REFERER = 'https://mat6tube.com/';
const ORIGIN = 'https://mat6tube.com';
const TTL = 30 * 60e3;
const CAP = 40;
const MENU_ROWS = 10;
const MAX_PAGE = 50;

// plain fetch (NOT smartFetch) — signed media is srcIp-locked to the page-fetcher IP, so the
// page fetch must never drift through a proxy pool; downloader.js httpGet is plain too.
let fetcher = (u, h) => fetch(u, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(30e3) });
const setFetcher = (f) => { const prev = fetcher; fetcher = f; return prev; };   // returns previous → restore pattern

// ── link → watch id (-?\d+_\d+) ──
function idOf(link) {
    let u; try { u = new URL(String(link).trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || !HOST_RE.test(u.hostname)) return null;
    return (u.pathname.match(/^\/watch\/(-?\d+_\d+)/) || [])[1] || null;
}

// window.playlist = {...} — brace-balanced with string-state (yt-dlp _search_json contract)
function playlistJson(html) {
    const i = html.indexOf('window.playlist');
    if (i < 0) return null;
    const s = html.indexOf('{', i);
    if (s < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let j = s; j < html.length && j < s + 200000; j++) {
        const c = html[j];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(html.slice(s, j + 1)); } catch { return null; } } }
    }
    return null;
}

function meta(h, name) {
    const m = h.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))
        || h.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
    return m ? m[1] : '';
}

// ── v2.88 catalog parsers (regex-native port of the user's scraper.js) ──
const ENT = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
function decodeEnt(s) {
    return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
        if (/^#x/i.test(e)) { const n = parseInt(e.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
        if (/^#/.test(e)) { const n = parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
        return ENT[e.toLowerCase()] || m;
    });
}

function secondsFromClock(value) {
    if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) return null;
    const parts = value.split(':').map(Number);
    if (parts.slice(1).some((p) => p > 59)) return null;
    return parts.reduce((sum, part) => sum * 60 + part, 0);
}

function countFromText(value) {
    const m = String(value || '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([KMB])?$/i);
    if (!m) return null;
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
    const n = Number(m[1]) * mult;
    return Number.isFinite(n) ? Math.round(n) : null;
}

// .list_videos .item blocks — item_link anchors (BOTH attr orders) delimit item regions
function parseListing(html) {
    const items = [];
    const seen = new Set();
    const re = /<a\b[^>]*?\bhref=["'](\/watch\/(-?\d+_\d+)[^"']*)["'][^>]*?\bclass=["'][^"']*\bitem_link\b[^"']*["'][^>]*>|<a\b[^>]*?\bclass=["'][^"']*\bitem_link\b[^"']*["'][^>]*?\bhref=["'](\/watch\/(-?\d+_\d+)[^"']*)["'][^>]*>/gi;
    const anchors = [...html.matchAll(re)];
    for (let i = 0; i < anchors.length; i++) {
        const start = anchors[i].index + anchors[i][0].length;
        const end = i + 1 < anchors.length ? anchors[i + 1].index : Math.min(html.length, start + 12000);
        const id = anchors[i][2] || anchors[i][4];
        if (!id || seen.has(id)) continue;
        const region = html.slice(start, end);
        const img = (region.match(/<img\b[^>]*>/i) || [])[0] || '';
        const dsrc = (img.match(/\bdata-src=["']([^"']+)["']/i) || [])[1] || '';
        const isrc = (img.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || '';
        const thumb = /^https?:/i.test(dsrc) ? dsrc : (/^https?:/i.test(isrc) ? isrc : '');
        const strip = (re) => decodeEnt(((region.match(re) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        const title = strip(/<div[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
            || decodeEnt((img.match(/\balt=["']([^"']*)["']/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
        if (!title) continue;   // menu row needs a name (API keeps null-title items; menu drops them)
        const viewsText = strip(/<div[^>]*class=["'][^"']*\bm_views\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        const duration = strip(/<div[^>]*class=["'][^"']*\bm_time\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        const hd = strip(/<i[^>]*class=["'][^"']*\bhd_mark\b[^"']*["'][^>]*>([\s\S]*?)<\/i>/i);
        seen.add(id);
        items.push({ id, title, thumb, duration, durS: secondsFromClock(duration), viewsText, views: countFromText(viewsText), hd, url: `${ORIGIN}/watch/${id}` });
    }
    let hasNext = false;
    for (const m of html.matchAll(/<div\b[^>]*class=["'][^"']*\bmore\b[^"']*["'][^>]*>/gi)) {
        const tag = m[0];
        if (/data-action=["']prev["']/i.test(tag) || /\bhidden\b/i.test(tag)) continue;
        if (/data-page/i.test(tag)) { hasNext = true; break; }
    }
    return { items, hasNext };
}

function validateQuery(q) {
    const t = String(q || '').trim();
    if (!t || t.length > 80 || /[\x00-\x1f\x7f]/.test(t)) throw new Error('search query එක 1-80 අකුරු වෙන්න ඕන');
    return t;
}

// search = /video/<q>?p=<page-1> (site page param is zero-based; API page one-based)
async function searchVideos(q, page) {
    const p = Math.min(MAX_PAGE, Math.max(1, parseInt(page, 10) || 1));
    const url = `${ORIGIN}/video/${encodeURIComponent(q)}${p > 1 ? '?p=' + (p - 1) : ''}`;
    const r = await fetcher(url, { 'User-Agent': UA, Referer: REFERER });
    const html = await r.text();
    if (r.status && r.status !== 200) throw new Error('search page HTTP ' + r.status);
    return parseListing(html);
}

// ── watch page → info { deleted, title, duration, views, tags, image, sources, hlsOnly } ──
async function parsePage(link) {
    const r = await fetcher(link, { 'User-Agent': UA, Referer: REFERER });
    const html = await r.text();
    const info = { deleted: /<title>\s*Video deleted/i.test(html), title: '', duration: 0, views: 0, tags: [], image: '', sources: [], hlsOnly: false };
    if (info.deleted) return info;
    info.title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || meta(html, 'og:title') || '').replace(/\s*[-–|]\s*mat6tube.*$/i, '').trim();
    info.duration = parseInt(meta(html, 'video:duration'), 10) || 0;
    info.views = parseInt((meta(html, 'ya:ovs:views_total') || '').replace(/[^\d]/g, ''), 10) || 0;
    info.tags = (meta(html, 'video:tag') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const pl = playlistJson(html);
    if (!pl) throw new Error('playlist එක හම්බුණේ නෑ — site markup එක වෙනස් වෙලා වෙන්න පුළුවන්');
    info.image = pl.image || meta(html, 'og:image');
    for (const s of pl.sources || []) {
        const f = String(s.file || '');
        if (!f) continue;
        info.sources.push({ label: parseInt(s.label, 10) || 0, type: String(s.type || ''), file: f });
    }
    info.sources.sort((a, b) => b.label - a.label);   // best-first
    info.hlsOnly = info.sources.length > 0 && info.sources.every((s) => s.type === 'hls');
    return info;
}

const bestSrc = (info) => info.sources.find((s) => s.type !== 'hls') || null;   // sorted best-first

// ── formatting ──
const dur = (s) => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
const views = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || '');

function infoCard(info) {
    const b = bestSrc(info);
    const lines = [
        '🔞 *mat6tube*',
        `📄 ${String(info.title || 'Untitled').slice(0, 90)}`,
        `🎬 ${b ? b.label + 'p' : '?'}${info.duration ? ' · ⏱ ' + dur(info.duration) : ''}${info.views ? ' · 👁 ' + views(info.views) : ''}`,
    ];
    if (info.tags.length) lines.push(`🏷 ${info.tags.slice(0, 5).join(', ').slice(0, 80)}`);
    lines.push('', b ? '⬇️ එවනවා…' : info.hlsOnly ? '❌ මේ video එකේ m3u8 stream එක විතරයි — direct mp4 source එකක් නෑ' : '❌ mp4 source එකක් නෑ');
    return lines.join('\n') + '\n' + foot('yt-dlp #14613 · mat6tube.com');
}

// ── cards ──
function searchCard(s) {
    const rows = s.items.slice(0, MENU_ROWS).map((it, i) =>
        `${i + 1}. ${it.title.slice(0, 64)}${it.duration ? ' · ⏱ ' + it.duration : ''}${it.viewsText ? ' · 👁 ' + it.viewsText.trim() : ''}${it.hd ? ' · ' + it.hd : ''}`);
    const lines = [`🔞 *mat6tube search*${s.q ? ` — "${s.q}"` : ''} (page ${s.page})`, '', ...rows, '',
        '✦ ගානක් *quote කරලා* එවන්න → quality menu එක'];
    if (s.hasNext) lines.push('✦ ඊළඟ page: *.metdn more*');
    return lines.join('\n') + '\n' + foot('mat6tube.com · 18+');
}

function qualityCap(info, labels) {
    const lines = [
        '🔞 *mat6tube*',
        `📄 ${String(info.title || 'Untitled').slice(0, 90)}`,
        `${info.duration ? '⏱ ' + dur(info.duration) : ''}${info.views ? ' · 👁 ' + views(info.views) : ''}` || ' ',
    ];
    if (info.tags.length) lines.push(`🏷 ${info.tags.slice(0, 5).join(', ').slice(0, 80)}`);
    lines.push('', '📋 Quality එක තෝරන්න — ගාන *quote කරලා* එවන්න:');
    labels.forEach((l, i) => lines.push(`${i + 1}. ${l}p${i === 0 ? ' ⭐ BEST' : ''}`));
    return lines.join('\n') + '\n' + foot('mat6tube.com · 18+');
}

// ── sessions (search picks + quality picks — terabox pattern) ──
const sessions = new Map();
const gcSessions = () => {
    for (const [k, s] of sessions) if (Date.now() - (s.at || 0) > TTL) sessions.delete(k);
    if (sessions.size > CAP) sessions.delete(sessions.keys().next().value);
};

// quality card from a parsed watch page — mp4 sources only (API policy: hls filtered,
// 3-4 digit labels); session stage 'quality' stores labels for the quote pick
async function qualityMenu({ send, jid, msg, edit, st }, info, wid) {
    const srcs = info.sources.filter((s) => s.type !== 'hls' && /^\d{3,4}$/.test(String(s.label)));
    if (!srcs.length) return await edit(infoCard(info));   // honest hls-only / no-mp4 card
    gcSessions();
    sessions.set(jid, { stage: 'quality', id: wid, labels: srcs.map((s) => s.label), at: Date.now(), cardId: null, cards: (sessions.get(jid) || {}).cards || [] });   // 🕰️ v2.90: prev flow's card ring carried forward
    const regCard = (id) => {   // 🕰️ v2.90: card ring — search card එකත් ජීවත්වෙනවා (ආපහු quote කරලා වෙන video එකක් තෝරන්න පුළුවන්)
        const s = sessions.get(jid); if (!s || !id) return;
        s.cardId = id;
        s.cards = [{ id: String(id), stage: 'quality', wid, labels: srcs.map((x) => x.label), at: Date.now() }, ...(s.cards || []).filter((c) => c.id !== String(id))].slice(0, 12);
    };
    const cap = qualityCap(info, srcs.map((s) => s.label));
    if (info.image) {
        try {
            const im = await send(jid, { image: { url: info.image }, caption: cap }, { quoted: msg });
            regCard(im?.key?.id);
            try { await send(jid, { delete: st.key }); } catch { }   // progress bubble අයින් — image card එකම ඇති
            return true;
        } catch { }   // thumb send fail → edited text card එකට
    }
    await edit(cap);
    regCard(st?.key?.id);   // text card = edited progress bubble
    return true;
}

// quote pick — stage search → quality card · stage quality → FRESH fetch + label download
async function goPick(send, jid, msg, n, download) {
    gcSessions();
    const s = sessions.get(jid);
    if (!s) return send(jid, { text: '⏳ session expire වෙලා — *.metdn <නම / link>* ආයෙත් ගහන්න' }, { quoted: msg });
    if (s.stage === 'search') {
        if (!s.items[n - 1] || n > MENU_ROWS) return send(jid, { text: `❌ ${n} — menu එකේ නෑ (1-${Math.min(s.items.length, MENU_ROWS)})` }, { quoted: msg });
        const st = await send(jid, { text: '🔞 mat6tube — page එක කියවනවා…' }, { quoted: msg });
        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
        try {
            const info = await parsePage(`${ORIGIN}/watch/${s.items[n - 1].id}`);
            if (info.deleted) return await edit('❌ මේ video එක delete වෙලා (site එකේම "Video deleted" පෙන්නනවා)');
            await qualityMenu({ send, jid, msg, edit, st }, info, s.items[n - 1].id);
            return true;
        } catch (e) {
            return await edit('❌ mat6tube: ' + String((e && e.message) || e).slice(0, 180));
        }
    }
    const label = s.labels[n - 1];
    if (!label) return send(jid, { text: `❌ ${n} — quality එකක් නෑ (1-${s.labels.length})` }, { quoted: msg });
    if (!download) return send(jid, { text: `🔗 ${ORIGIN}/watch/${s.id} · ${label}p` }, { quoted: msg });   // tests / fallback
    s.at = Date.now();   // 🕰️ v2.90: session එක මැරෙන්නේ නෑ — download ඉවර උනාට පස්සෙත් quality card එකටම ආයෙත් reply කරලා වෙන quality එකක් ගන්න පුළුවන්
    const st = await send(jid, { text: `🔞 ${label}p — source URL එක අලුත් කරගන්නවා…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const info = await parsePage(`${ORIGIN}/watch/${s.id}`);   // FRESH — signed URLs are short-lived
        const src = info.sources.find((x) => x.type !== 'hls' && x.label === label);
        if (!src) return await edit(`❌ ${label}p source එක දැන් නෑ — *.metdn <link>* ආයෙත් ගහලා quality menu එක ගන්න`);
        await edit(`⬇️ ${label}p එවනවා…`);
        await download(src.file, '🔞 mat6tube');
        return true;
    } catch (e) {
        return await edit('❌ mat6tube: ' + String((e && e.message) || e).slice(0, 180));
    }
}

// '.metdn more' — next search page of the active session
async function goMore(send, jid, msg) {
    gcSessions();
    const s = sessions.get(jid);
    if (!s || s.stage !== 'search' || !s.q) return send(jid, { text: '⏳ search session එකක් නෑ — *.metdn <නමක්>* ගහලා search කරන්න' }, { quoted: msg });
    if (!s.hasNext) return send(jid, { text: '❌ මේක අන්තිම page එක' }, { quoted: msg });
    const page = Math.min(MAX_PAGE, s.page + 1);
    const st = await send(jid, { text: `🔞 mat6tube — page ${page} search කරනවා…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const { items, hasNext } = await searchVideos(s.q, page);
        if (!items.length) return await edit(`❌ page ${page} එකේ මුකුත් නෑ — මේක අන්තිම page එක වෙන්න ඇති`);
        Object.assign(s, { page, items, hasNext, at: Date.now(), cardId: null });
        await edit(searchCard(s));
        s.cardId = st.key?.id || null;   // text card = edited progress bubble (terabox pattern)
        if (s.cardId) s.cards = [{ id: String(s.cardId), stage: 'search', q: s.q, page, items, hasNext, at: Date.now() }, ...(s.cards || []).filter((c) => c.id !== String(s.cardId))].slice(0, 12);   // 🕰️ v2.90: ring
        return true;
    } catch (e) {
        return await edit('❌ mat6tube: ' + String((e && e.message) || e).slice(0, 180));
    }
}

const METDN_USAGE = `🔞 *mat6tube* — *.metdn <නම / link>*
උදා: \`.metdn dance\` · \`.metdn https://mat6tube.com/watch/-114054493_456243244\`

✦ නමක් දුන්නාම → search menu එක → ගානක් quote කරන්න → quality menu → download
✦ watch link එකක් දුන්නාම → quality menu එකෙන්ම පටන් ගන්නවා
✦ *.metdn more* — search එකේ ඊළඟ page එක
✦ deleted video → අවංක error card එකක්\n${foot('yt-dlp #14613 · mat6tube.com')}`;

// ── command handle (same contract as terabox.handle: (cmd, {send,jid,msg,rest,react,download})) ──
async function handle(c, ctx) {
    if (c !== '.metdn') return false;
    const { send, jid, msg, rest, react, download } = ctx;
    const arg = rest.join(' ').trim();

    const mNum = arg.match(/^(?:go\s+)?(\d{1,3})$/i);   // .metdn 2 / .metdn go 2 — digit from the CAPTURE ('go 2' → NaN trap)
    if (mNum) return goPick(send, jid, msg, parseInt(mNum[1], 10), download);
    if (/^more$/i.test(arg)) return goMore(send, jid, msg);
    if (!arg) return send(jid, { text: METDN_USAGE }, { quoted: msg });

    const link = (arg.match(/https?:\/\/\S+/) || [])[0];
    const wid = link && idOf(link);
    if (link && !wid) return send(jid, { text: '❌ මේක mat6tube watch link එකක් නෙවෙයි\n\n✦ mat6tube.com/watch/… link එකක් හෝ නමක් (search) එවන්න\n✦ අනිත් sites: *.download <link>*' }, { quoted: msg });

    await react?.('🔞');
    const st = await send(jid, { text: link ? '🔞 mat6tube — page එක කියවනවා…' : '🔞 mat6tube — search කරනවා…' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        if (wid) {
            const info = await parsePage(`${ORIGIN}/watch/${wid}`);
            if (info.deleted) return await edit('❌ මේ video එක delete වෙලා (site එකේම "Video deleted" පෙන්නනවා)');
            await qualityMenu({ send, jid, msg, edit, st }, info, wid);
            return true;
        }
        const q = validateQuery(arg);
        const { items, hasNext } = await searchVideos(q, 1);
        if (!items.length) return await edit(`🔞 *mat6tube search* — "${q}"\n\n❌ මුකුතු හම්බුණේ නෑ — වෙන නමක් / කෙටි නමක් try කරන්න\n` + foot('mat6tube.com · 18+'));
        gcSessions();
        const s = { stage: 'search', q, page: 1, items, hasNext, at: Date.now(), cardId: null, cards: [] };
        sessions.set(jid, s);
        await edit(searchCard(s));
        s.cardId = st.key?.id || null;   // text card = edited progress bubble (terabox pattern)
        if (s.cardId) s.cards = [{ id: String(s.cardId), stage: 'search', q, page: 1, items, hasNext, at: Date.now() }];   // 🕰️ v2.90: card ring seed
        return true;
    } catch (e) {
        return await edit('❌ mat6tube: ' + String((e && e.message) || e).slice(0, 180));
    }
}

// numeric quote bridge (bot.js chain) — card එකට QUOTE කරපු number එක → '.metdn go N'
function bridge(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s) return null;
    if (Date.now() - (s.at || 0) > TTL + 30 * 60e3) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d) || d < 1) return null;
    if (qid && String(qid) !== String(s.cardId)) {   // 🔒 reply-only — 🕰️ v2.90: old flow card (search menu / old quality card) → rewind to that stage (user video bug = animehub එකේම class එක)
        const hit = (s.cards || []).find((c) => c.id === String(qid) && Date.now() - c.at < TTL + 30 * 60e3);
        if (!hit) return null;
        if (hit.stage === 'search') Object.assign(s, { stage: 'search', q: hit.q, page: hit.page, items: hit.items, hasNext: hit.hasNext, at: Date.now(), cardId: hit.id });
        else Object.assign(s, { stage: 'quality', id: hit.wid, labels: hit.labels, at: Date.now(), cardId: hit.id });
    }
    return '.metdn go ' + d;
}

module.exports = {
    handle, bridge, parsePage, parseListing, searchVideos, validateQuery,
    idOf, bestSrc, playlistJson, infoCard, qualityCap, searchCard,
    setFetcher, HOST_RE, METDN_USAGE, TTL, ORIGIN, secondsFromClock, countFromText, _sessions: sessions,
};
