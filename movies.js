'use strict';
/**
 * movies.js — .moviepro for KAVIZ MD V1 (v2.24)
 *
 *  v2.24 — Asitha-style REPLY flow (screenshot UX) on our own CineSubz pipeline:
 *    .moviepro <නම>            → Cinemeta search (movies + series) → numbered list
 *    reply අංකය (number reply) → next step — every interactive card registers a "ui"
 *                                ({key, kind, n, rowNo}); bot.js bridges bare numbers via
 *                                bridgeReply(jid, quotedId, digits) → .moviepro … grammar.
 *    .moviepro <n> (movie)     → info card + CineSubz quality list → reply q# → movie FILE
 *    .moviepro <n> (series)    → IMDb card + Episodes List (📦 season rows + Season N Episode M)
 *    .moviepro <n> <row#>      → season → 🧳 quality options · episode → 🎬 quality list
 *    .moviepro <n> <row#> <q#> → 🧳 SEASON PACK = FILES, one per message (episode එකින් එක)
 *                                · 🎬 episode file
 *    … link suffix             → 🔗 direct-link pack instead of files (v2.23 behaviour)
 *    … next                    → continue pack (files or links) / episodes page
 *
 *  NOTE: subtitle rows (Asitha shows 16 languages) are NOT offered — CineSubz exposes no
 *  subtitle files (probed 2026-10: no srt/zip on tv or episode pages). We don't fake rows.
 *
 *  Series pipeline (verified live Oct 2026):
 *    cinesubz /tvshows/<slug>/ → server-rendered .episode-link rows (data-pid, data-season,
 *    data-episode, ep-date) → episode page /episodes/<slug-NxM>/ → .zetaflix_player_option rows
 *    (data-post, data-nume) → POST wp-admin/admin-ajax.php {action:zeta_player_ajax, post,
 *    nume, type:'ep'} → {embed_url:'https://player1.setwenna.one/<file>.mp4', type:'mp4'}
 *    → embed_url + '?play=true' → 206 video/mp4 (Range OK, NO referer needed) → downloader → WA.
 *
 *  Movie pipeline (v2.19, unchanged):
 *    search /?s= → movie page → /zt-links/<id>/ gate → masked google.com/serverN link →
 *    drive.csplayer2.space/serverN → /api/download-data live-check → downloader → document.
 *    CDN serves its player instead of the file → clean fallback links.
 */
const { smartFetch } = require('./net');
const { human, maxMB } = require('./downloader');
const { foot, cut, bar } = require('./style');

const API = 'https://v3-cinemeta.strem.io/catalog/movie/top/search=';
const API_S = 'https://v3-cinemeta.strem.io/catalog/series/top/search=';
const SESSION_TTL = 15 * 60e3;
const TV_PAGE_ROWS = 60;       // episodes per message page
const PACK_PER_MSG = 25;       // direct links per message in a link pack
const PACK_RESOLVE_CAP = 120;  // hard cap on episodes resolved for one pack
const SEASON_FILE_CAP = 50;    // episode FILES per season-pack run ('next' continues)
const EP_SEND_GAP = 5000;      // pause between episode sends (flood safety)
const UI_TTL = 10 * 60e3;      // interactive-card reply window
const sessions = new Map();   // jid → { list, at, movie?, tv?, ui? }

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const enc = (s) => encodeURIComponent(String(s || '').trim()).replace(/%20/g, '+');
const stripEnt = (s) => String(s || '').replace(/&#0?38;|&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function fetchJson(url, ms = 25000, headers) {
    const r = await smartFetch(url, { headers: headers || { 'User-Agent': UA_BROWSER, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('HTTP ' + r.status); }
    return r.json();
}

async function fetchHtml(url, ms = 30000, referer) {
    const h = { 'User-Agent': UA_BROWSER, Accept: 'text/html,*/*' };
    if (referer) h.Referer = referer;
    const r = await smartFetch(url, { headers: h, signal: AbortSignal.timeout(ms) });
    if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('HTTP ' + r.status); }
    return r.text();
}

/** Cinemeta catalog search → top n metas (one retry on flaky cold-start) */
async function catalog(api, q, n = 8) {
    let lastE;
    for (let i = 0; i < 2; i++) {
        try { const j = await fetchJson(api + enc(q) + '.json'); return (j.metas || []).slice(0, n); }
        catch (e) { lastE = e; if (!/timeout|EAI|ENOTFOUND|reset/i.test(String(e.message))) break; }
    }
    throw lastE;
}

/** movies + series merged (movies first — list stays familiar, series get 📺) */
async function search(q, n = 8) {
    const [movies, series] = await Promise.all([
        catalog(API, q, n).catch(() => []),
        catalog(API_S, q, n).catch(() => []),
    ]);
    if (!movies.length && !series.length) throw new Error('HTTP 404');
    const seen = new Set();
    const merged = [];
    for (const m of [...movies, ...series]) {
        if (seen.has(m.imdb_id)) continue;
        seen.add(m.imdb_id);
        merged.push({ ...m, type: m.type === 'series' ? 'series' : 'movie' });
        if (merged.length >= n + 4) break;
    }
    return merged;
}

const yearOf = (m) => String(m.releaseInfo || '').split('–')[0].slice(0, 4);
const subsUrl = (m) => 'https://sinhalasub.lk/?s=' + enc(`${m.name} ${yearOf(m)}`);
const dlUrl = (m) => 'https://cinesubz.net/?s=' + enc(m.name);
const ytLink = (m) => { const yt = (m.trailerStreams || [])[0]?.ytId; return yt ? 'https://youtu.be/' + yt : null; };

/* ───────────────────────── CineSubz pipeline ───────────────────────── */

/** cinesubz.net search → [{ url, title }] (movies first) */
async function csSearch(q) {
    const html = await fetchHtml('https://cinesubz.net/?s=' + enc(q));
    const out = [];
    const re = /<a\s+href="(https:\/\/cinesubz\.net\/(?:movies|tvshows)\/[^"]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        // title from anchor's own title attr, else nearest <h3>
        const seg = html.slice(m.index, m.index + 1200);
        let t = stripEnt((seg.match(/title="([^"]*)"/) || [])[1] || '');
        if (!t) t = stripEnt((seg.match(/<h3>([^<]*)<\/h3>/) || [])[1] || '');
        t = t.replace(/\s*\|\s*සිංහල.*$/u, '').replace(/\s*Sinhala Subtitles.*$/i, '').trim();
        if (out.find(x => x.url === m[1])) continue;
        out.push({ url: m[1], title: t, tv: m[1].includes('/tvshows/') });
        if (out.length >= 10) break;
    }
    return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** best cinesubz match for a cinemeta meta (prefer: 'movie' | 'series') */
function bestMatch(items, m, prefer = 'movie') {
    const name = norm(m.name), yr = yearOf(m);
    let best = null, bestScore = 0, bestLen = Infinity;
    for (const it of items) {
        const t = norm(it.title);
        const tokens = name.split(' ').filter(w => w.length > 1);
        let hit = tokens.filter(w => t.includes(w)).length;
        let score = tokens.length ? hit / tokens.length : 0;
        if (yr && it.title.includes(yr)) score += 0.25;
        if (prefer === 'series') { if (it.tv) score += 0.3; else score -= 0.3; }
        else if (it.tv) score -= 0.3;                 // default: prefer movies
        if (score > bestScore || (score === bestScore && best && t.length < bestLen)) {
            bestScore = score; best = it; bestLen = t.length;   // tie → shorter title = closer match
        }
    }
    return bestScore >= 0.5 ? best : null;
}

/** cinesubz TV page → { url, title, poster, eps:[{ slug, pid, season, ep, title, date }] } */
async function csTvPage(url) {
    const html = await fetchHtml(url);
    const poster = (html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/) || [])[1] || '';
    const title = stripEnt((html.match(/property="og:title"\s+content="([^"]+)"/) || [])[1] || '').replace(/\s*\|\s*.*$/u, '');
    const eps = [];
    const re = /<a[^>]+class=['"]episode-link['"][^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const tag = m[0];
        const attr = (a) => stripEnt((tag.match(new RegExp(a + "=['\"]([^'\"]+)['\"]")) || [])[1] || '');
        const href = attr('href');
        const pid = attr('data-pid');
        const season = parseInt(attr('data-season')) || 1;
        const ep = parseInt(attr('data-episode')) || 0;
        if (!href || !pid || !ep) continue;
        const seg = html.slice(m.index, m.index + 900);
        const t = stripEnt((seg.match(/ep-title['"]?\s*>\s*([^<]+)/) || [])[1] || '');
        const d = stripEnt((seg.match(/ep-date['"]?\s*>\s*([^<]+)/) || [])[1] || '');
        if (eps.find(x => x.pid === pid)) continue;
        eps.push({ slug: href, pid, season, ep, title: t || `Episode ${ep}`, date: d });
    }
    eps.sort((a, b) => a.season - b.season || a.ep - b.ep);
    return { url, title, poster, eps };
}

/** cinesubz search limited to /tvshows/ → best match for a series meta (name only — the site's search chokes on years) */
async function csTvFind(m) {
    try {
        let items = await csSearch(m.name);
        if (!items.length) {
            const short = m.name.split(/[:–—-]/)[0].trim();   // "Money Heist: Korea" → "Money Heist"
            if (short && short.toLowerCase() !== m.name.toLowerCase()) items = await csSearch(short);
        }
        const tvItems = items.filter(x => x.tv);
        if (!tvItems.length) return null;
        return bestMatch(tvItems, m, 'series');
    } catch { return null; }
}

/* ── zeta player ajax (episode direct files — verified live 2026-10) ── */

/** POST zeta_player_ajax → direct file URL for an episode player option */
async function playerAjax(post, nume, type = 'ep') {
    const r = await smartFetch('https://cinesubz.net/wp-admin/admin-ajax.php', {
        method: 'POST',
        headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json,*/*', 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://cinesubz.net/' },
        body: new URLSearchParams({ action: 'zeta_player_ajax', post: String(post), nume: String(nume), type }).toString(),
        signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('HTTP ' + r.status); }
    const j = await r.json();
    if (!j || !j.embed_url || !/\.(mp4|mkv)(\?|$)/i.test(j.embed_url)) return null;   // iframe-embed player → not a direct file
    let url = stripEnt(j.embed_url);
    if (!url.includes('?')) url += '?play=true';     // supercloud gate: ?play=true → 206 video/mp4
    return url;
}

/** quality token from a file URL (…720p… → '720p') */
const qualityToken = (url) => {
    let f = url;
    try { f = decodeURIComponent(new URL(url).pathname); } catch { }
    return (f.match(/(\d{3,4})p/i) || [])[1] ? RegExp.$1.toLowerCase() + 'p' : null;
};

const fileName = (url) => {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'video.mp4').replace(/^CineSubz\.com\s*-\s*/i, ''); } catch { return 'video.mp4'; }
};

/** episode page slug → [{ nume, post, type, label, token, url }] direct-file player options */
async function epQualities(slug) {
    const html = await fetchHtml(slug);
    const opens = [...html.matchAll(/<li[^>]+player-option-\d+[^>]*>/g)];
    const opts = [];
    for (let i = 0; i < opens.length; i++) {
        const tag = opens[i][0];
        const post = (tag.match(/data-post=['"]?(\d+)/) || [])[1];
        const nume = (tag.match(/data-nume=['"]?(\d+)/) || [])[1];
        const type = (tag.match(/data-type=['"]?([a-z]+)/) || [])[1] || 'ep';
        if (!post || !nume) continue;
        // visible label of the option (e.g. "Server CS Player 720p") — text up to the next option li
        const stop = i + 1 < opens.length ? opens[i + 1].index : Math.min(opens[i].index + 700, html.length);
        const siteLabel = stripEnt(html.slice(opens[i].index + tag.length, stop).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 40);
        opts.push({ post, nume, type, siteLabel });
    }
    if (!opts.length) return [];
    const out = [];
    const batch = opts.slice(0, 8);
    const res = await Promise.allSettled(batch.map(o => playerAjax(o.post, o.nume, o.type)));
    for (let i = 0; i < res.length; i++) {
        if (res[i].status !== 'fulfilled' || !res[i].value) continue;
        const url = res[i].value;
        const tok = qualityToken(url) || qualityToken(batch[i].siteLabel) || null;
        const label = tok ? `Video: ${tok}`
            : (batch[i].siteLabel ? batch[i].siteLabel.replace(/^Server\s+/i, '') : `Server ${batch[i].nume}`);
        out.push({ nume: batch[i].nume, post: batch[i].post, type: batch[i].type, label, token: tok, url });
    }
    out.sort((a, b) => (parseInt(a.token) || 0) - (parseInt(b.token) || 0));
    return out;
}

/** ranged GET → size MB (single tiny request; supercloud ignores HEAD) */
async function sizeOfUrl(url) {
    try {
        const r = await smartFetch(url, { headers: { 'User-Agent': UA_BROWSER, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
        try { await r.body?.cancel(); } catch { }
        const cr = r.headers?.get?.('content-range') || '';
        const total = parseInt((cr.match(/\/(\d+)\s*$/) || [])[1] || '0');
        return total ? Math.round(total / 1024 / 1024) : null;
    } catch { return null; }
}

/** movie page → { title, poster, links: [{ gate, label }] } */
async function csMoviePage(url) {
    const html = await fetchHtml(url);
    const poster = (html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/) || [])[1] || '';
    const title = stripEnt((html.match(/property="og:title"\s+content="([^"]+)"/) || [])[1] || '').replace(/\s*\|\s*.*$/u, '');
    const links = [];
    const re = /href=['"](https:\/\/cinesubz\.net\/zt-links\/[a-z0-9]+\/)['"][^>]*>[\s\S]{0,400}?movie-download-meta['"]>([^<]+)</g;
    let m;
    while ((m = re.exec(html)) !== null) links.push({ gate: m[1], label: stripEnt(m[2]) });
    return { url, title, poster, links };
}

/* gate-page JS mapping (verified 2026-10): masked google.com/serverN → real CDN */
const GATE_MAP = [
    ['https://google.com/server11/1:/', 'https://drive.csplayer2.space/server1/'],
    ['https://google.com/server12/1:/', 'https://drive.csplayer2.space/server1/'],
    ['https://google.com/server13/1:/', 'https://drive.csplayer2.space/server1/'],
    ['https://google.com/server21/1:/', 'https://drive.csplayer2.space/server2/'],
    ['https://google.com/server22/1:/', 'https://drive.csplayer2.space/server2/'],
    ['https://google.com/server23/1:/', 'https://drive.csplayer2.space/server2/'],
    ['https://google.com/server3/1:/', 'https://drive.csplayer2.space/server3/'],
    ['https://google.com/server4/1:/', 'https://drive.csplayer2.space/server4/'],
    ['https://google.com/server5/1:/', 'https://drive.csplayer2.space/server5/'],
    ['https://google.com/server6/', 'https://drive.csplayer2.space/server6/'],
    ['https://google.com/server7/', 'https://drive.csplayer2.space/server7/'],
];

/** pure fn (tested): masked link → real direct URL + telegram fallback link */
function mapMasked(raw) {
    const masked = stripEnt(raw);
    let real = null;
    for (const [from, to] of GATE_MAP) {
        if (masked.startsWith(from)) { real = to + masked.slice(from.length); break; }
    }
    if (!real) return { real: masked, cdn: false, tg: null };   // gdrive/gofile/etc. → downloader handles as-is
    // ext transform (same rule as the gate JS)
    if (real.includes('.mp4?bot=cscloud2bot&code=')) real = real.replace('.mp4?bot=cscloud2bot&code=', '?ext=mp4&bot=cscloud2bot&code=');
    else if (real.includes('.mkv?bot=cscloud2bot&code=')) real = real.replace('.mkv?bot=cscloud2bot&code=', '?ext=mkv&bot=cscloud2bot&code=');
    else if (/\.mp4(?!\?)/.test(real)) real = real.replace(/\.mp4(?!\?)/, '?ext=mp4');
    else if (/\.mkv(?!\?)/.test(real)) real = real.replace(/\.mkv(?!\?)/, '?ext=mkv');
    // cinesubz's own telegram delivery bot (from the bot= code param or an explicit t.me link)
    const code = (masked.match(/[?&]code=([A-Za-z0-9=_\-]+)/) || [])[1];
    const tg = code ? `https://telegram.me/cscloud2bot?start=${code}`
        : (masked.match(/https:\/\/t\.me\/[\s'"&]+/) || []).filter(u => !u.includes('/CineSubz'))[0] || null;
    return { real, cdn: true, tg };
}

/** gate page → { real, cdn, tg, live } (live = CDN API says the file exists) */
async function resolveGate(gate) {
    const html = await fetchHtml(gate, 30000, 'https://cinesubz.net/');
    const masked = (html.match(/<a\s+id="link"\s+href="([^"]+)"/) || html.match(/<a\s+href="([^"]+)"\s+id="link"/) || [])[1];
    if (!masked) throw new Error('gate page එකෙන් link එක decode කරන්න බැරි වුණා');
    const r = mapMasked(masked);
    r.live = true;
    if (r.cdn) {
        try {
            const u = new URL(r.real);
            const apiPath = u.pathname.replace(/\.(mp4|mkv)$/i, '') + u.search;
            const j = await fetchJson('https://drive.csplayer2.space/api/download-data' + apiPath, 20000);
            r.live = !!j.success || !!j.redirect;
        } catch { r.live = true; }   // API unreachable → optimistically try the download anyway
    }
    return r;
}

/** quality list for a cinemeta meta → { movie, items:[{gate,label}] } | null */
async function qualitiesFor(m) {
    try {
        const items = await csSearch(`${m.name} ${yearOf(m)}`.trim());
        if (!items.length) return null;
        const best = bestMatch(items, m) || (!items[0].tv ? items[0] : null);
        if (!best) return null;
        const page = await csMoviePage(best.url);
        if (!page.links.length) return null;
        return { page, items: page.links };
    } catch { return null; }
}

const sizeMB = (label) => {
    const g = label.match(/([\d.]+)\s*(GB|MB)/i);
    if (!g) return null;
    return Math.round(parseFloat(g[1]) * (g[2].toUpperCase() === 'GB' ? 1024 : 1));
};

/** full meta for the card (search metas lack rating/description) — best effort */
async function enrichMeta(m) {
    try {
        if (m.imdbRating && m.description) return m;
        if (!m.imdb_id) return m;
        const type = m.type || 'movie';
        const j = await fetchJson(`https://v3-cinemeta.strem.io/meta/${type}/${m.imdb_id}.json`, 20000);
        const full = j.meta || {};
        return { ...m, ...full, type };   // full wins (rating, description, genres, runtime)
    } catch { return m; }
}

/* ───────────────────────── message builders ───────────────────────── */

function listText(q, list) {
    return `🎬 *MoviePro — "${cut(q, 40)}"*\n\n` + list.map((m, i) =>
        `*${i + 1}.* ${m.type === 'series' ? '📺 ' : ''}${cut(m.name, 60)}${m.releaseInfo ? ' (' + m.releaseInfo + ')' : ''}${m.imdbRating ? '  ⭐' + m.imdbRating : ''}`).join('\n')
        + `\n${foot('*.moviepro <අංකය>* — අංකය විතරක් reply කරන්නත් වැඩ')}`;
}

function cardText(m, n, quals) {
    const cast = (m.cast || []).slice(0, 3).join(', ');
    const desc = String(m.description || '').trim().slice(0, 380) || '—';
    const rows = [`🎬 *${m.name}*${m.releaseInfo ? ` (${m.releaseInfo})` : ''}`,
        `⭐ ${m.imdbRating || '—'}/10 IMDb${m.runtime ? '  •  ⏱ ' + m.runtime : ''}`,
        m.genres?.length ? `🎭 ${m.genres.slice(0, 4).join(', ')}` : '',
        cast ? `👥 ${cast}` : '', '', `📝 ${desc}`, ''];
    if (quals && quals.items.length) {
        rows.push('', '» Download Options 🎬');
        quals.items.forEach((l, i) => rows.push(`*${i + 1}* | ${l.label}`));
        rows.push('', `> අංකය reply කරන්න — 🍿 movie file එකම එනවා`);
    } else {
        rows.push('', `⬇️ ${dlUrl(m)}`, `🇱🇰 සිංහල උපසිරැසි: ${subsUrl(m)}`);
    }
    rows.push('', ytLink(m) ? `*.moviepro ${n} trailer* — 🎥 trailer` : '');
    return rows.filter(x => x !== undefined).filter(Boolean).join('\n');
}

async function sendCard(send, jid, msg, m, n, quals) {
    const text = cardText(m, n, quals);
    const poster = quals?.page?.poster || m.poster;
    try {
        if (!poster) throw new Error('no poster');
        return await send(jid, { image: { url: poster }, caption: text.slice(0, 1000) }, { quoted: msg });
    } catch {
        return await send(jid, { text }, { quoted: msg });   // poster fail → text only
    }
}

/* ───────────────── series: episodes list + season pack ───────────────── */

/** session rows for a series: [📦 season rows interleaved with episode rows] */
function tvRows(tv) {
    const eps = [...tv.eps].sort((a, b) => a.season - b.season || a.ep - b.ep);
    const seasons = [...new Set(eps.map(e => e.season))].sort((a, b) => a - b);
    const rows = [];
    for (const se of seasons) {
        rows.push({ kind: 'season', season: se });
        for (const e of eps.filter(x => x.season === se)) rows.push({ kind: 'ep', ...e });
    }
    return rows;
}

const epLabel = (r) => `Season ${r.season} Episode ${r.ep}`;

/** series card (IMDb details) + episodes page — screenshot-style single message */
function seriesText(m, n, tv, rows, pageIdx) {
    const date = String(m.released || '').slice(0, 10) || (m.releaseInfo || '');
    const desc = String(m.description || '').trim().slice(0, 340) || '—';
    const rows2 = [`🍀 *${cut(m.name, 60)}*${m.releaseInfo ? ` (${m.releaseInfo})` : ''}`,
        `📅 ${date || '—'}${m.runtime ? '  ·  ⏱ ' + m.runtime : ''}  ·  ⭐ ${m.imdbRating || '—'} IMDb`,
        m.genres?.length ? `🎭 ${m.genres.slice(0, 4).join(', ')}` : '',
        m.country ? `🌍 ${Array.isArray(m.country) ? m.country.join(', ') : m.country}` : '',
        '', `📝 _${desc}_`, ''];
    const start = pageIdx * TV_PAGE_ROWS;
    const page = rows.slice(start, start + TV_PAGE_ROWS);
    if (!page.length) rows2.push('ℹ️ තව episodes නෑ');
    page.forEach((r, i) => {
        const no = start + i + 1;
        rows2.push(r.kind === 'season'
            ? `*${no}* | 📦 Download Season ${r.season} (All Episodes)`
            : `*${no}* | ${epLabel(r)}${r.date ? `  ·  ${r.date}` : ''}`);
    });
    const more = start + TV_PAGE_ROWS < rows.length;
    rows2.push('', `> අංකය reply කරන්න — season → 🧳 pack options · episode → 🎬 quality`);
    if (more) rows2.push(`> *.moviepro ${n} next* — ඊළඟ page එක (${Math.ceil(rows.length / TV_PAGE_ROWS)} pages)`);
    return rows2.filter(x => x !== undefined).join('\n');
}

async function sendSeriesCard(send, jid, msg, m, n, tv, pageIdx = 0) {
    const rows = tvRows(tv);
    const text = seriesText(m, n, tv, rows, pageIdx);
    const poster = tv.poster || m.poster;
    try {
        if (!poster) throw new Error('no poster');
        return await send(jid, { image: { url: poster }, caption: text.slice(0, 6000) }, { quoted: msg });
    } catch {
        return await send(jid, { text }, { quoted: msg });
    }
}

/** season pack quality options card (probe first episodes of the season) */
function seasonOptText(m, n, rowNo, season, toks) {
    const rows = [`🧳 *SELECT DOWNLOAD OPTION FOR SEASON ${season}*`, `🍀 ${cut(m.name, 46)}`, '', '» Video Qualities (All Episodes) 👇'];
    toks.forEach((t, i) => rows.push(`*${i + 1}* | 🎥 ${t.token ? 'Video: ' + t.token : (t.label || 'Original')}`));
    rows.push('', `> අංකය reply කරන්න — Season ${season} episodes ඔක්කොම 🧳 files විදිහට එනවා`,
        `> 🔗 links ඕනෙ නම් — *.moviepro ${n} ${rowNo} <q#> link*`);
    return rows.join('\n');
}

/** season pack link page text */
function packText(m, tv, season, token, items, rowNo, qNo, hasMore) {
    const rows = [`📦 *${cut(m.name, 46)}* — Season ${season} · ${token}\n`];
    for (const it of items) rows.push(`E${it.ep} → ${it.url}`);
    rows.push('');
    if (hasMore) rows.push(`> *.moviepro ${rowNo} ${qNo} next* — ඊළඟ ${PACK_PER_MSG} ට`);
    rows.push(`> single episode file: *.moviepro <n> <ep row#> <q#>*`);
    return rows.join('\n');
}

/** trailer video via features.ytCommand (yt-dlp → clipto fallback → cookies/pool) */
async function trailerCmd(send, jid, msg, m) {
    const yt = ytLink(m);
    if (!yt) return send(jid, { text: '❌ මේ movie එකට trailer link එකක් නෑ' }, { quoted: msg });
    await require('./features').ytCommand(send, jid, msg, yt + ' 720', 'video', `Trailer — ${m.name}`);
}

/* ───────────────────────── movie file download ───────────────────────── */

async function movieFileCmd(send, jid, msg, m, qi, quals, linkMode = false, react) {
    const item = quals.items[qi - 1];
    if (!item) return send(jid, { text: `❌ ${qi} — quality නෑ (1-${quals.items.length})` }, { quoted: msg });
    const label = item.label || 'movie';
    const mb = sizeMB(label);
    const status = await send(jid, { text: `🎯 ${label} · resolve…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const r = await resolveGate(item.gate);
        if (!r.live) {
            react?.('❌');
            await edit(`❌ ${label} — file එක server එකෙන් අයින් වෙලා\n> අනිත් quality එකක් try කරන්න`);
            return;
        }
        if (mb && mb > maxMB()) {
            await edit(`📦 ${human(mb * 1024 * 1024)} — limit එක ${human(maxMB() * 1024 * 1024)}\n> *.maxmb* වෙනස් කරන්න\n🔗 ${r.real}`);
            return;
        }
        let last = 0;
        const onProgress = (loaded, total) => {
            const now = Date.now();
            if (now - last < 8000) return;
            last = now;
            const pct = total ? Math.floor(loaded * 100 / total) : null;
            const b = pct === null ? '' : bar(pct) + ` ${pct}%\n`;
            edit(`⬇️ ${label}\n${b}${human(loaded)} / ${human(total) || '?'}`);
        };
        await edit(`⬇️ ${label} · download…`);
        const { download } = require('./downloader');
        const files = await download(r.real, onProgress, { stream: !linkMode });   // 🌊 file mode → straight to WA; link mode → temp file → mirror
        for (const f of files) {
            if (linkMode) {
                await edit(`🪞 upload… (${human(f.size)})`);
                const rel = await require('./mirror').uploadFile(f.path, f.name);
                react?.('✅');
                await edit(`🔗 *${cut(m.name, 80)}*\n${rel.url}\n${foot(`${human(f.size)} · ${label} · ${rel.days}d (${rel.host}) · public`)}`);
            } else {
                await edit(`📤 WhatsApp… (${human(f.size)})`);
                await send(jid, {
                    document: f.open ? { stream: f.open() } : { url: f.path }, fileName: f.name, mimetype: f.mime,
                    caption: `🎬 *${cut(m.name, 100)}*${m.releaseInfo ? ` (${m.releaseInfo})` : ''}\n${foot(`${human(f.size)} · ${label} · ⭐ ${m.imdbRating || '—'}`)}`,
                }, { quoted: msg });
            }
            if (f.path) require('fs').rm(f.path, { force: true }, () => { });
        }
        if (!linkMode) { try { await send(jid, { delete: status.key }); } catch { } react?.('✅'); }   // bubble අයින් — movie එකම ප්‍රමාණවත්
    } catch (e) {
        const msgTxt = String(e.message || '');
        react?.('❌');
        // CDN served its protected player instead of the file → clean link fallback
        try {
            const r = await resolveGate(item.gate);
            let t = `⚠️ ${cut(msgTxt, 100)}\n\n🔗 *${label}* — ${r.real}`;
            if (r.tg) t += `\n✈️ ${r.tg}`;
            t += `\n> 🌐 ${quals.page?.url || item.gate}`;
            await edit(t);
        } catch {
            await edit(`❌ ${msgTxt.slice(0, 200)}`);
        }
    }
}

/* ───────────────── episode file download (v2.23 series pipeline) ───────────────── */

/** shared download+deliver core: url → WhatsApp document (or mirror link) */
async function deliverStream(send, jid, msg, { url, label, mb, capTitle, capMeta, fname, linkMode, react, status, edit }) {
    if (mb && mb > maxMB()) {
        await edit(`📦 ${human(mb * 1024 * 1024)} — limit එක ${human(maxMB() * 1024 * 1024)}\n> *.maxmb* වෙනස් කරන්න\n🔗 ${url}`);
        return;
    }
    let last = 0;
    const onProgress = (loaded, total) => {
        const now = Date.now();
        if (now - last < 8000) return;
        last = now;
        const pct = total ? Math.floor(loaded * 100 / total) : null;
        const b = pct === null ? '' : bar(pct) + ` ${pct}%\n`;
        edit(`⬇️ ${label}\n${b}${human(loaded)} / ${human(total) || '?'}`);
    };
    await edit(`⬇️ ${label} · download…`);
    const { download } = require('./downloader');
    const files = await download(url, onProgress, { stream: !linkMode });
    for (const f of files) {
        if (linkMode) {
            await edit(`🪞 upload… (${human(f.size)})`);
            const rel = await require('./mirror').uploadFile(f.path, f.name);
            react?.('✅');
            await edit(`🔗 *${cut(capTitle, 80)}*\n${rel.url}\n${foot(`${human(f.size)} · ${label} · ${rel.days}d (${rel.host}) · public`)}`);
        } else {
            await edit(`📤 WhatsApp… (${human(f.size)})`);
            await send(jid, {
                document: f.open ? { stream: f.open() } : { url: f.path }, fileName: fname || f.name, mimetype: f.mime,
                caption: `${capTitle}\n${foot(capMeta || human(f.size))}`,
            }, { quoted: msg });
        }
        if (f.path) require('fs').rm(f.path, { force: true }, () => { });
    }
    if (!linkMode) { try { await send(jid, { delete: status.key }); } catch { } react?.('✅'); }
}

/** .moviepro <n> <row#> <q#> → episode FILE to chat (link mode → mirror link) */
async function episodeFileCmd(send, jid, msg, m, r, qi, items, linkMode, react) {
    const item = items[qi - 1];
    if (!item) return send(jid, { text: `❌ ${qi} — quality නෑ (1-${items.length})` }, { quoted: msg });
    const label = item.label || `Video: ${item.token || '?'}`;
    const status = await send(jid, { text: `🎯 ${label} · resolve…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const mb = item.mb ?? await sizeOfUrl(item.url);
        const fname = fileName(item.url);
        await deliverStream(send, jid, msg, {
            url: item.url, label, mb,
            capTitle: `📺 *${cut(m.name, 60)}* — ${epLabel(r)}`,
            capMeta: `${human((mb || 0) * 1024 * 1024)} · ${label}${m.imdbRating ? ` · ⭐ ${m.imdbRating}` : ''}`,
            fname, linkMode, react, status, edit,
        });
    } catch (e) {
        react?.('❌');
        await edit(`❌ ${cut(String(e.message || ''), 150)}\n> අනිත් quality එකක් try කරන්න`);
    }
}

/** resolve one episode → { ep, nume, url, token } | null (exact nume → exact token → best available) */
async function resolveEp(e, wantToken, wantNume) {
    try {
        const items = await epQualities(e.slug);
        if (!items.length) return null;
        let pick = wantNume ? items.find(x => String(x.nume) === String(wantNume)) : null;
        if (!pick && wantToken) pick = items.find(x => x.token === wantToken);
        if (!pick) pick = items[items.length - 1];   // best available (sorted → highest token last)
        return { ep: e.ep, nume: pick.nume, url: pick.url, token: pick.token || wantToken || null };
    } catch { return null; }
}

/** .moviepro <n> <seasonRow#> <q#> link [next] → direct links for every episode of the season */
async function seasonPackCmd(send, jid, msg, m, tv, rowNo, season, qNo, tok, cursor, react, nume) {
    const eps = tv.eps.filter(x => x.season === season).slice(0, PACK_RESOLVE_CAP);
    const status = await send(jid, { text: `📦 Season ${season} · ${tok || 'best'} · resolve 0/${eps.length}…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const from = cursor || 0;
        const slice = eps.slice(from, from + PACK_PER_MSG);
        const out = [];
        for (let i = 0; i < slice.length; i += 6) {
            const batch = slice.slice(i, i + 6);
            const res = await Promise.all(batch.map(e => resolveEp(e, tok, nume)));
            for (const r of res) if (r) out.push(r);
            await edit(`📦 Season ${season} · ${tok || 'best'} · resolve ${Math.min(from + i + batch.length, eps.length)}/${eps.length}…`);
        }
        if (!out.length) {
            react?.('❌');
            await edit(`❌ Season ${season} — episodes resolve කරන්න බැරි වුණා\n> ටිකකින් ආයෙත් try`);
            return;
        }
        const hasMore = from + PACK_PER_MSG < eps.length;
        react?.('✅');
        try { await send(jid, { delete: status.key }); } catch { }
        await send(jid, { text: packText(m, tv, season, tok, out, rowNo, qNo, hasMore) }, { quoted: msg });
    } catch (e) {
        react?.('❌');
        await edit(`❌ ${cut(String(e.message || ''), 150)}`);
    }
}

/* ── v2.24: season pack as FILES (Asitha screenshot UX) ── */

/** filename for a delivered episode file: "Breaking Bad S01E01 [720p].mp4" */
function epFileName(show, season, ep, tok, url) {
    const ext = (/\.([a-z0-9]{2,4})(?:\?|$)/i.exec(String(url || '')) || [])[1] || 'mp4';
    const s = String(show || 'Show').replace(/[\\/:*?"<>|.]/g, '').slice(0, 48) || 'Show';
    return `${s} S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')} [${tok || 'orig'}].${ext}`;
}

/** caption for a delivered episode file */
function epCaption(show, season, ep, tok, done, total, fail) {
    return `🎬 *${cut(show, 60)} S${season}E${ep}*\n⚡ Quality: ${tok || 'best'}\n${foot(`Season ${season} · ${done}/${total}${fail ? ' · ⚠️ ' + fail : ''}`)}`;
}

/** queue status line for the pack bubble */
function packStat(show, season, ok, fail, at, total, note) {
    return `🧳 *${cut(show, 50)}* — Season ${season}\n✅ ${ok}  ⚠️ ${fail}  ·  ${at}/${total}${note ? '\n' + note : ''}`;
}

const sleepMs = (ms) => new Promise(res => setTimeout(res, ms));

/** .moviepro <n> <seasonRow#> <q#> [next] → every episode of the season as a FILE, one by one */
async function seasonFilesCmd(send, jid, msg, full, tv, n, rowNo, season, qNo, tok, from, react, nume) {
    const eps = tv.eps.filter(x => x.season === season).slice(0, PACK_RESOLVE_CAP);
    if (!eps.length) return send(jid, { text: `❌ Season ${season} — episodes නෑ` }, { quoted: msg });
    const show = cut(full.name, 50);
    const total = eps.length;
    const startTxt = from > 0
        ? `🧳 *Continuing Season ${season} Download* — ${cut(full.name, 50)}\n\nEpisodes: ${from + 1}–${Math.min(total, from + SEASON_FILE_CAP)} / ${total}\nQuality: ${tok || 'best available'}`
        : `🧳 *Starting Season ${season} Download* for ${cut(full.name, 50)}…\n\nTotal Episodes: ${total}\nQuality: ${tok || 'best available'}`;
    const status = await send(jid, { text: startTxt + '\n' + foot('episode එකින් එක එවනවා — stop කරන්න නම් මට කියන්න') }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    const { download } = require('./downloader');
    const end = Math.min(total, from + SEASON_FILE_CAP);
    tv.pack = { row: rowNo, season, qNo, tok, nume, from: end, mode: 'file' };
    let ok = 0, fail = 0, lastEdit = 0;
    for (let i = from; i < end; i++) {
        const e = eps[i];
        const tag = `S${season}E${e.ep}`;
        const r = await resolveEp(e, tok, nume);
        if (!r) { fail++; await edit(packStat(show, season, ok, fail, i + 1, total, `${tag} — resolve fail`)); continue; }
        try {
            const mb = await sizeOfUrl(r.url);
            if (mb && mb > maxMB()) {
                fail++;
                await send(jid, { text: `⚠️ ${tag} — ${human(mb * 1048576)} limit එකට වඩා ලොකුයි (*.maxmb*)\n🔗 ${r.url}` }, { quoted: msg });
                continue;
            }
            const onProgress = (loaded, tot) => {
                const now = Date.now();
                if (now - lastEdit < 8000) return;
                lastEdit = now;
                const pct = tot ? Math.floor(loaded * 100 / tot) : null;
                edit(`⬇️ ${tag} · ${pct === null ? human(loaded) : bar(pct) + ' ' + pct + '%'}\n✅ ${ok}  ⚠️ ${fail}  ·  ${i + 1}/${total}`);
            };
            const files = await download(r.url, onProgress, { stream: true });
            for (const f of files) {
                await send(jid, {
                    document: f.open ? { stream: f.open() } : { url: f.path },
                    fileName: epFileName(show, season, e.ep, r.token || tok, r.url),
                    mimetype: f.mime,
                    caption: epCaption(show, season, e.ep, r.token || tok, ok + 1, total, fail),
                }, { quoted: msg });
                if (f.path) require('fs').rm(f.path, { force: true }, () => { });
            }
            ok++;
        } catch (err) {
            fail++;
            console.log('[moviepro] ' + tag + ' fail: ' + cut(String(err.message || ''), 160));
            await send(jid, { text: `⚠️ ${tag} — ${cut(String(err.message || ''), 90)}\n🔗 ${r.url}` }, { quoted: msg });
        }
        await edit(packStat(show, season, ok, fail, i + 1, total));
        if (i < end - 1) await sleepMs(EP_SEND_GAP);
    }
    react?.(ok ? '✅' : '❌');
    if (end < total) {
        await edit(`⏸ Season ${season} — ${end}/${total} යවලා ඉවර්\n✅ ${ok}  ⚠️ ${fail}\n> ඉතුරු ටිකට — *.moviepro ${n} ${rowNo} ${qNo} next*`);
        return;
    }
    try { await send(jid, { delete: status.key }); } catch { }
    if (fail) await send(jid, { text: `🧳 Season ${season} — ✅ ${ok} · ⚠️ ${fail} fail\n> fail වූ ඒවායේ links — *.moviepro ${n} ${rowNo} ${qNo} link*` }, { quoted: msg });
}

/* ───────────────────────── command handler ───────────────────────── */

const hasSession = (jid) => { const s = sessions.get(jid); return !!(s && Date.now() - s.at < SESSION_TTL && s.list?.length); };

/** remember the last interactive card we sent (for bare-number replies) */
function setUi(s, sent, kind, n, rowNo) {
    s.ui = { key: sent?.key?.id || null, kind, n: n ?? null, rowNo: rowNo ?? null, at: Date.now() };
}

/** bot.js bridges a bare-number reply here → full .moviepro grammar (or null → not ours) */
function bridgeReply(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!hasSession(jid)) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d)) return null;
    const ui = s.ui;
    if (ui && ui.kind && Date.now() - ui.at < UI_TTL) {
        const quotedOurs = !!(qid && ui.key && String(qid) === String(ui.key));
        if (quotedOurs || !qid) {   // replied to our card — or just sent the number right after
            if (ui.kind === 'movie') return `.moviepro ${ui.n} ${d}`;
            if (ui.kind === 'tv') return `.moviepro ${ui.n} ${d}`;
            if (ui.kind === 'season') return `.moviepro ${ui.n} ${ui.rowNo} ${d}`;
            if (ui.kind === 'ep') return `.moviepro ${ui.n} ${ui.rowNo} ${d}`;
            return `.moviepro ${d}`;   // kind list → search-list pick
        }
    }
    return `.moviepro ${d}`;   // fallback: search-list pick (v2.23 behaviour)
}

async function handle(c, ctx) {
    if (c !== '.moviepro' && c !== '.mvpro' && c !== '.movie') return false;
    const { send, jid, msg, rest, react } = ctx;
    const arg = rest.join(' ').trim();
    const pick = arg.match(/^(\d{1,3})(?:\s+(trailer|t|next|n))?(?:\s+(\d{1,3}))?(?:\s+(\d{1,3}))?(?:\s+(link|l|next|n))?$/i);
    const isNum = (x) => /^\d+$/.test(x || '');

    if (pick) {
        const s = sessions.get(jid);
        if (!hasSession(jid)) return send(jid, { text: `⏳ session expire වෙලා — *.moviepro <නම>* ආයෙත් ගහන්න` }, { quoted: msg });
        const n = +pick[1], m = s.list[n - 1];
        if (!m) return send(jid, { text: `❌ ${n} — result එකක් නෑ (1-${s.list.length})` }, { quoted: msg });
        const isSeries = m.type === 'series';
        const wantNext = !!(pick[2] && /^n/i.test(pick[2])) || !!(pick[5] && /^n/i.test(pick[5]));
        if (pick[2] && /^t/i.test(pick[2])) { await trailerCmd(send, jid, msg, m); return true; }

        const full = await enrichMeta(m);
        const idx = s.list.indexOf(m); if (idx >= 0) s.list[idx] = full;   // cache the enriched meta

        /* ── SERIES flow ── */
        if (isSeries) {
            if (!s.tv) s.tv = {};
            let tv = s.tv[n];
            if (!tv || Date.now() - tv.at > SESSION_TTL) {
                if (wantNext || pick[3] || pick[4]) {
                    return send(jid, { text: `⏳ episodes load වෙලා නෑ — මුලින්ම *.moviepro ${n}* ගහන්න` }, { quoted: msg });
                }
                const st = await send(jid, { text: `🔎 ${cut(full.name, 50)} · episodes…` }, { quoted: msg });
                const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                const found = await csTvFind(full);
                if (!found) {
                    await edit(`📺 *${cut(full.name, 50)}*\n\n⚠️ CineSubz එකේ මේ series එකේ episodes නෑ\n🇱🇰 සිංහල උපසිරැසි: ${subsUrl(full)}\n> වෙන series එකක් try කරන්න`);
                    s.tv[n] = { at: Date.now(), eps: [] };   // don't re-probe every reply
                    return true;
                }
                tv = await csTvPage(found.url);
                if (!tv.eps.length) {
                    await edit(`📺 *${cut(full.name, 50)}*\n\n⚠️ CineSubz එකේ මේ series එකේ episodes නෑ\n🇱🇰 සිංහල උපසිරැසි: ${subsUrl(full)}`);
                    s.tv[n] = { at: Date.now(), eps: [] };
                    return true;
                }
                tv.at = Date.now(); tv.pageIdx = 0; tv.epStates = {}; tv.seasonStates = {};
                s.tv[n] = tv;
                try { await send(jid, { delete: st.key }); } catch { }
                const sent = await sendSeriesCard(send, jid, msg, full, n, tv, 0);
                setUi(s, sent, 'tv', n);
                return true;
            }
            // next page (.moviepro <n> next)
            if (wantNext && !pick[3] && !pick[4]) {
                const rows = tvRows(tv);
                const maxPage = Math.max(0, Math.ceil(rows.length / TV_PAGE_ROWS) - 1);
                tv.pageIdx = Math.min((tv.pageIdx || 0) + 1, maxPage);
                const sentPg = await sendSeriesCard(send, jid, msg, full, n, tv, tv.pageIdx);
                setUi(s, sentPg, 'tv', n);
                return true;
            }
            // row pick (.moviepro <n> <row#> ...)
            if (pick[3] && isNum(pick[3])) {
                const rowNo = +pick[3];
                const rows = tvRows(tv);
                const row = rows[rowNo - 1];
                if (!row) return send(jid, { text: `❌ ${rowNo} — row එකක් නෑ (1-${rows.length})` }, { quoted: msg });
                if (row.kind === 'season') {
                    // quality options for the season pack (probe first episodes)
                    let toks = tv.seasonStates[rowNo];
                    if (!toks || !toks.length) {
                        const st = await send(jid, { text: `📦 Season ${row.season} · qualities…` }, { quoted: msg });
                        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                        const probe = tv.eps.filter(x => x.season === row.season).slice(0, 2);
                        const agg = [];
                        for (const e of probe) {
                            for (const it of await epQualities(e.slug).catch(() => [])) {
                                const k = it.token || it.label;
                                if (k && !agg.find(a => (a.token || a.label) === k)) agg.push(it);
                            }
                            if (agg.length >= 3) break;
                        }
                        toks = agg.map(a => ({ token: a.token, label: a.label, nume: a.nume }));
                        tv.seasonStates[rowNo] = toks;
                        try { await send(jid, { delete: st.key }); } catch { }
                        if (!toks.length) return edit(`❌ Season ${row.season} — direct file options නෑ (CineSubz player එක iframe විතරයි)`);
                    }
                    // season pack: continue / start / options card
                    if (pick[5] && /^n/i.test(pick[5])) {
                        const p = tv.pack;
                        if (!p || p.row !== rowNo) return send(jid, { text: `⏳ pack start කරලා නෑ — *.moviepro ${n} ${rowNo} <q#>* ගහන්න` }, { quoted: msg });
                        if (p.mode === 'link') {
                            await seasonPackCmd(send, jid, msg, full, tv, p.row, p.season, p.qNo, p.tok, p.from + PACK_PER_MSG, react, p.nume);
                            p.from += PACK_PER_MSG;
                        } else {
                            await seasonFilesCmd(send, jid, msg, full, tv, n, p.row, p.season, p.qNo, p.tok, p.from, react, p.nume);
                        }
                        return true;
                    }
                    if (pick[5] && /^l/i.test(pick[5])) {
                        return send(jid, { text: `🔗 quality අංකය එකත් ඕනෙ — *.moviepro ${n} ${rowNo} 1 link*` }, { quoted: msg });
                    }
                    if (pick[4] && isNum(pick[4])) {
                        const qNo = +pick[4];
                        const chosen = toks[qNo - 1];
                        if (!chosen) return send(jid, { text: `❌ ${qNo} — quality නෑ (1-${toks.length})` }, { quoted: msg });
                        if (pick[5] && /^l/i.test(pick[5])) {
                            tv.pack = { row: rowNo, season: row.season, qNo, tok: chosen.token, nume: chosen.nume, from: 0, mode: 'link' };
                            await seasonPackCmd(send, jid, msg, full, tv, rowNo, row.season, qNo, chosen.token, 0, react, chosen.nume);
                        } else {
                            await seasonFilesCmd(send, jid, msg, full, tv, n, rowNo, row.season, qNo, chosen.token, 0, react, chosen.nume);
                        }
                        return true;
                    }
                    const sentOpt = await send(jid, { text: seasonOptText(full, n, rowNo, row.season, toks) }, { quoted: msg });
                    setUi(s, sentOpt, 'season', n, rowNo);
                    return true;
                }
                // episode row → quality list / file
                let items = tv.epStates[rowNo];
                if (!items || !items.length) {
                    const st = await send(jid, { text: `🔎 ${epLabel(row)} · qualities…` }, { quoted: msg });
                    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
                    items = (await epQualities(row.slug).catch(() => [])).map(it => ({ ...it, mb: null }));
                    tv.epStates[rowNo] = items;
                    try { await send(jid, { delete: st.key }); } catch { }
                    if (!items.length) return edit(`❌ ${epLabel(row)} — direct file options නෑ\n> වෙන episode එකක් try`);
                }
                if (pick[4] && isNum(pick[4])) {
                    await episodeFileCmd(send, jid, msg, full, row, +pick[4], items, !!(pick[5] && /^l/i.test(pick[5])), react);
                    return true;
                }
                if (pick[4] && /^l/i.test(pick[4])) {
                    return send(jid, { text: `🔗 quality අංකය එකත් ඕනෙ — *.moviepro ${n} ${rowNo} 1 link*` }, { quoted: msg });
                }
                const optRows = [`🎬 *SELECT DOWNLOAD OPTION* — ${epLabel(row)}`, `📺 ${cut(full.name, 50)}`, '', '» Video Qualities 👇'];
                items.forEach((it, i) => optRows.push(`*${i + 1}* | 🎥 ${it.label}`));
                optRows.push('', `> අංකය reply කරන්න — episode file එකම එනවා`,
                    `> 🔗 links — *.moviepro ${n} ${rowNo} <q#> link*`);
                const sentOpt = await send(jid, { text: optRows.join('\n') }, { quoted: msg });
                setUi(s, sentOpt, 'ep', n, rowNo);
                return true;
            }
            // plain pick (no row) → (re)send episodes list
            const sentList = await sendSeriesCard(send, jid, msg, full, n, tv, tv.pageIdx || 0);
            setUi(s, sentList, 'tv', n);
            return true;
        }

        /* ── MOVIE flow (v2.19, unchanged) ── */
        if (pick[3] && isNum(pick[3])) {
            if (!s.movie || !s.movie.items?.length) {
                return send(jid, { text: `⏳ quality list load වෙලා නෑ — මුලින්ම *.moviepro ${n}* ගහන්න` }, { quoted: msg });
            }
            s.movie.picked = full;
            await movieFileCmd(send, jid, msg, full, +pick[3], s.movie, !!(pick[5] && /^l/i.test(pick[5])), react);
            return true;
        }
        if (pick[5] || pick[4]) return send(jid, { text: `🔗 quality අංකය එකත් ඕනෙ — *.moviepro ${n} 1 link*` }, { quoted: msg });

        // info card + CineSubz quality list
        const st = await send(jid, { text: `🔎 ${cut(full.name, 50)}…` }, { quoted: msg });
        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
        const quals = await qualitiesFor(full);
        if (quals) { s.movie = { page: quals.page, items: quals.items, at: Date.now() }; }
        else s.movie = null;
        const sent = await sendCard(send, jid, msg, full, n, quals);
        setUi(s, sent, 'movie', n);
        try { await send(jid, { delete: st.key }); } catch { }   // status bubble අයින් — card එකම ප්‍රමාණවත්
        return true;
    }

    if (!arg) {
        return send(jid, {
            text: `🎬 *MoviePro*\n\n*.moviepro <නම>* — search (movies + 📺 series)\nඅංකය reply කරන්න — card → options → files\n*.moviepro <n> <row#> <q#>* — 🍿 movie file · 🧳 season files · 🎬 episode file\n*.moviepro <n> <row#> <q#> link* — 🔗 direct links\n*.moviepro <n> trailer* — 🎥 trailer\n${foot('series = 📺 · උදා: .moviepro money heist')}`,
        }, { quoted: msg });
    }

    const st = await send(jid, { text: `🔎 ${cut(arg, 50)}…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const list = await search(arg);
        if (!list.length) return edit(`❌ "${cut(arg, 40)}" — results නෑ · නම ටිකක් වෙනස් කරලා try`);
        sessions.set(jid, { list, at: Date.now() });
        if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
        edit(listText(arg, list));
        const s2 = sessions.get(jid);
        if (s2) setUi(s2, st, 'list');
    } catch (e) {
        edit(`❌ ${String(e.message).slice(0, 180)}\n> ටිකකින් ආයෙත් try`);
    }
    return true;
}

module.exports = { handle, search, cardText, listText, hasSession, bridgeReply, csSearch, csMoviePage, mapMasked, resolveGate, qualitiesFor, sizeMB, bestMatch, enrichMeta, csTvPage, csTvFind, tvRows, epQualities, playerAjax, qualityToken, seriesText, seasonOptText, packText, epFileName, epCaption, packStat, sizeOfUrl, _testSession: (jid, s) => sessions.set(jid, s), _sessions: sessions };
// `next` in pick[2] = episodes page; pick[4] next handled in series branch
