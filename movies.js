'use strict';
/**
 * movies.js — .moviepro for KAVIZ MD V1 (v2.23)
 *
 *  v2.23 — TV series flow (Asitha-style episodes UX, our own CineSubz pipeline):
 *    .moviepro <නම>            → Cinemeta search (movies + series) → numbered list
 *    .moviepro <n> (movie)     → info card + CineSubz quality list (unchanged v2.19 flow)
 *    .moviepro <n> (series)    → IMDb card (release/rating/genres/country) + Episodes List:
 *                                📦 Download Season N (All Episodes) rows + Season N Episode M
 *    .moviepro <n> <row#>      → row pick: season → quality options; episode → quality list
 *    .moviepro <n> <row#> <q#> → season: all-episode direct link pack; episode: FILE sent to chat
 *    .moviepro <n> <row#> <q#> next → link pack next page
 *    .moviepro <n> next        → episodes list next page
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
const PACK_PER_MSG = 25;       // direct links per message in a season pack
const PACK_RESOLVE_CAP = 120;  // hard cap on episodes resolved for one pack
const sessions = new Map();   // jid → { list, at, movie?, tv? }

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

/** episode page slug → [{ nume, label, url }] player options with direct URLs (best effort per option) */
async function epQualities(slug) {
    const html = await fetchHtml(slug);
    const opts = [];
    const re = /<li[^>]+player-option-\d+[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const tag = m[0];
        const post = (tag.match(/data-post=['"]?(\d+)/) || [])[1];
        const nume = (tag.match(/data-nume=['"]?(\d+)/) || [])[1];
        const type = (tag.match(/data-type=['"]?([a-z]+)/) || [])[1] || 'ep';
        if (post && nume) opts.push({ post, nume, type });
    }
    if (!opts.length) return [];
    const out = [];
    const batch = opts.slice(0, 8);
    const res = await Promise.allSettled(batch.map(o => playerAjax(o.post, o.nume, o.type)));
    for (let i = 0; i < res.length; i++) {
        if (res[i].status !== 'fulfilled' || !res[i].value) continue;
        const url = res[i].value;
        const tok = qualityToken(url);
        out.push({ nume: batch[i].nume, label: tok ? `Video: ${tok}` : `Video #${batch[i].nume}`, token: tok, url });
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
        rows.push('');
        quals.items.forEach((l, i) => rows.push(`*${i + 1}.* ${l.label}`));
        rows.push('', `*.moviepro ${n} <quality#>* — 🍿 movie file එකම එනවා`);
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
        await send(jid, { image: { url: poster }, caption: text.slice(0, 1000) }, { quoted: msg });
    } catch {
        await send(jid, { text }, { quoted: msg });   // poster fail → text only
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
    rows2.push('', `> *.moviepro ${n} <row#>* — episode → quality list · season → pack options`);
    if (more) rows2.push(`> *.moviepro ${n} next* — ඊළඟ page එක (${Math.ceil(rows.length / TV_PAGE_ROWS)} pages)`);
    return rows2.filter(x => x !== undefined).join('\n');
}

async function sendSeriesCard(send, jid, msg, m, n, tv, pageIdx = 0) {
    const rows = tvRows(tv);
    const text = seriesText(m, n, tv, rows, pageIdx);
    const poster = tv.poster || m.poster;
    try {
        if (!poster) throw new Error('no poster');
        await send(jid, { image: { url: poster }, caption: text.slice(0, 6000) }, { quoted: msg });
    } catch {
        await send(jid, { text }, { quoted: msg });
    }
}

/** season pack quality options card (probe first episodes of the season) */
function seasonOptText(m, n, rowNo, season, toks, sinSub) {
    const rows = [`📦 *Download Season ${season}* — ${cut(m.name, 46)}`, '', '» Video Qualities (All Episodes) 🎬'];
    toks.forEach((t, i) => rows.push(`*${i + 1}* | 🎥 Video: ${t.token}`));
    rows.push('', `🇱🇰 සිංහල උපසිරැසි: ${sinSub}`, '',
        `> *.moviepro ${n} ${rowNo} <quality#>* — episodes ඔක්කොමේ direct links`,
        `> single episode file එකට — *.moviepro ${n} <ep row#> <quality#>*`);
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

/** resolve one episode → { ep, url, token } | null (best quality = highest token ≥ wanted) */
async function resolveEp(e, wantToken) {
    try {
        const items = await epQualities(e.slug);
        if (!items.length) return null;
        let pick = wantToken ? items.find(x => x.token === wantToken) : null;
        if (!pick) pick = items[items.length - 1];   // best available
        return { ep: e.ep, url: pick.url, token: pick.token || wantToken || 'best' };
    } catch { return null; }
}

/** .moviepro <n> <seasonRow#> <q#> [next] → direct links for every episode of the season */
async function seasonPackCmd(send, jid, msg, m, tv, rowNo, season, qNo, tok, cursor, react) {
    const eps = tv.eps.filter(x => x.season === season).slice(0, PACK_RESOLVE_CAP);
    const status = await send(jid, { text: `📦 Season ${season} · ${tok} · resolve 0/${eps.length}…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const from = cursor || 0;
        const slice = eps.slice(from, from + PACK_PER_MSG);
        const out = [];
        for (let i = 0; i < slice.length; i += 6) {
            const batch = slice.slice(i, i + 6);
            const res = await Promise.all(batch.map(e => resolveEp(e, tok)));
            for (const r of res) if (r) out.push(r);
            await edit(`📦 Season ${season} · ${tok} · resolve ${Math.min(from + i + batch.length, eps.length)}/${eps.length}…`);
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

/* ───────────────────────── command handler ───────────────────────── */

const hasSession = (jid) => { const s = sessions.get(jid); return !!(s && Date.now() - s.at < SESSION_TTL && s.list?.length); };

async function handle(c, ctx) {
    if (c !== '.moviepro' && c !== '.mvpro' && c !== '.movie') return false;
    const { send, jid, msg, rest, react } = ctx;
    const arg = rest.join(' ').trim();
    const pick = arg.match(/^(\d{1,2})(?:\s+(trailer|t|next|n))?(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}))?(?:\s+(link|l|next|n))?$/i);
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
                await sendSeriesCard(send, jid, msg, full, n, tv, 0);
                return true;
            }
            // next page (.moviepro <n> next)
            if (wantNext && !pick[3] && !pick[4]) {
                const rows = tvRows(tv);
                const maxPage = Math.max(0, Math.ceil(rows.length / TV_PAGE_ROWS) - 1);
                tv.pageIdx = Math.min((tv.pageIdx || 0) + 1, maxPage);
                await sendSeriesCard(send, jid, msg, full, n, tv, tv.pageIdx);
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
                                if (it.token && !agg.find(a => a.token === it.token)) agg.push(it);
                            }
                            if (agg.length) break;
                        }
                        toks = agg.map(a => ({ token: a.token }));
                        tv.seasonStates[rowNo] = toks;
                        try { await send(jid, { delete: st.key }); } catch { }
                        if (!toks.length) return edit(`❌ Season ${row.season} — direct file options නෑ (CineSubz player එක iframe විතරයි)`);
                    }
                    // season pack: continue / start / options card
                    if (pick[5] && /^n/i.test(pick[5])) {
                        const p = tv.pack;
                        if (!p || p.row !== rowNo) return send(jid, { text: `⏳ pack start කරලා නෑ — *.moviepro ${n} ${rowNo} <q#>* ගහන්න` }, { quoted: msg });
                        await seasonPackCmd(send, jid, msg, full, tv, p.row, p.season, p.qNo, p.tok, p.from + PACK_PER_MSG, react);
                        p.from += PACK_PER_MSG;
                        return true;
                    }
                    if (pick[5] && /^l/i.test(pick[5])) {
                        return send(jid, { text: `🔗 quality අංකය එකත් ඕනෙ — *.moviepro ${n} ${rowNo} 1*` }, { quoted: msg });
                    }
                    if (pick[4] && isNum(pick[4])) {
                        const qNo = +pick[4];
                        const tok = toks[qNo - 1]?.token;
                        if (!tok) return send(jid, { text: `❌ ${qNo} — quality නෑ (1-${toks.length})` }, { quoted: msg });
                        tv.pack = { row: rowNo, season: row.season, qNo, tok, from: 0 };
                        await seasonPackCmd(send, jid, msg, full, tv, rowNo, row.season, qNo, tok, 0, react);
                        return true;
                    }
                    await send(jid, { text: seasonOptText(full, n, rowNo, row.season, toks, subsUrl(full)) }, { quoted: msg });
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
                const optRows = [`📺 *${cut(full.name, 50)}* — ${epLabel(row)}`, '', '» Download Options 🎬'];
                items.forEach((it, i) => optRows.push(`*${i + 1}* | ${it.label}`));
                optRows.push('', `> *.moviepro ${n} ${rowNo} <quality#>* — episode file එකම එනවා`);
                await send(jid, { text: optRows.join('\n') }, { quoted: msg });
                return true;
            }
            // plain pick (no row) → (re)send episodes list
            await sendSeriesCard(send, jid, msg, full, n, tv, tv.pageIdx || 0);
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
        await sendCard(send, jid, msg, full, n, quals);
        try { await send(jid, { delete: st.key }); } catch { }   // status bubble අයින් — card එකම ප්‍රමාණවත්
        return true;
    }

    if (!arg) {
        return send(jid, {
            text: `🎬 *MoviePro*\n\n*.moviepro <නම>* — search\n*.moviepro <n>* — info card\n*.moviepro <n> <row#>* — 🍿 movie quality / 📺 episode list\n*.moviepro <n> <row#> <q#>* — 🍿 movie file / 📦 season links / 📺 episode file\n*.moviepro <n> <row#> <q#> link* — 🔗 share link\n${foot('series = 📺 · උදා: .moviepro money heist')}`,
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
    } catch (e) {
        edit(`❌ ${String(e.message).slice(0, 180)}\n> ටිකකින් ආයෙත් try`);
    }
    return true;
}

module.exports = { handle, search, cardText, listText, hasSession, csSearch, csMoviePage, mapMasked, resolveGate, qualitiesFor, sizeMB, bestMatch, enrichMeta, csTvPage, csTvFind, tvRows, epQualities, playerAjax, qualityToken, seriesText, seasonOptText, packText, sizeOfUrl };
// `next` in pick[2] = episodes page; pick[4] next handled in series branch
