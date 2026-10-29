'use strict';
/**
 * zetasub.js — KAVIZ MD V1 v3.00.0 — 🎬 CineSubz/Cineru (zetaflix-family) mirror source for MovieDex.
 *
 * WHY: MovieBox VIP-blocked whole titles (user: '.moviedex mashle' → EVERY episode/quality answers
 * 'MovieBox මේ item එක VIP-only වෙලා — free copy එකක් නෑ' — verified 2026-10-30: all 4 mashle subject-ids,
 * all resolutions, direct-MP4 AND DASH paths; the SAME title downloaded fine days earlier). Asitha-MD
 * MoviePro (the bot the user compared against) serves these titles from the Sri-Lankan zetaflix-family
 * sites — its own API docs list /cinesubz/* + /cineru/* wrappers (back.asitha.top).
 *
 * SOURCE LADDER: cinesubz.net (LIVE-verified end-to-end from sandbox 2026-10-30: search → tvshow →
 * episode pages → download links → resolve) → cineru.lk (CF-challenges the sandbox IP but the panel/
 * residential routes may pass — same zetaflix theme, same scraper).
 *
 * PIPELINE (all LIVE-verified against cinesubz.net):
 *   1. search  GET /wp-json/zetaflix/search/?keyword=X&nonce=<n>  — nonce from any page HTML
 *      ("nonce":"<hex10>"; several exist — try each). Response: {"<postid>":{title,url,img,extra}}
 *   2. tvshow  GET /tvshows/<slug>/  — inline episode anchors (a.episode-link[data-pid][data-season]
 *      [data-episode], href=/episodes/<epslug>/) → ep-slug base (solo-leveling-1x1 → 'solo-leveling')
 *      → any season/ep = /episodes/<base>-<s>x<e>/ (S2E1 verified live)
 *   3. links   episode/movie page embeds .download-link-item / .movie-download-link-item anchors:
 *      href=/zt-links/<tok>/ (also obfuscated /api-…/<tok>/ variants) + download-meta
 *      'WEBRip SD 480p • 130 MB • Japanese'
 *   4. resolve link page JS: masked href 'https://google.com/serverN/1:/…' + urlMappings
 *      [{search:[...],replace:'https://drive.csplayer2.space/serverN/'}] → real CDN url
 *      + '.mp4?bot=…' → '?ext=mp4&bot=…' fix (parsed from the page, never hardcoded)
 *   5. download ranged-parallel (moviedex downloadDash row.zeta route) — CF may challenge datacenter
 *      IPs on the CDN; bot.js never fakes success — honest error when the mirror refuses.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TTL = 10 * 60e3;
const DOMAINS = ['https://cinesubz.net', 'https://cineru.lk'];
const dState = new Map();   // host → { badUntil, nonce(s), nonceAt }

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const normTitle = (s) => String(s || '').toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

async function zget(url, { timeout = 25000 } = {}) {
    const r = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
        redirect: 'follow', signal: AbortSignal.timeout(timeout),
    });
    return r;
}

function markBad(host, ms = 30 * 60e3) { const s = dState.get(host) || {}; s.badUntil = Date.now() + ms; dState.set(host, s); }
const isBad = (host) => (dState.get(host)?.badUntil || 0) > Date.now();

/* ── pure parsers (unit-tested offline) ── */
const parseNonce = (html) => [...String(html || '').matchAll(/"nonce":"([a-f0-9]{8,12})"/g)].map((m) => m[1]);

const parseSearch = (j) => {
    const out = [];
    for (const [id, it] of Object.entries(j || {})) {
        const url = String(it?.url || '');
        const type = /\/tvshows\//.test(url) ? 'tv' : /\/movies\//.test(url) ? 'movie' : '';
        if (!type) continue;
        out.push({ id, name: dec(String(it?.title || '')).replace(/\s*\|\s*Sinhala Subtitles.*$/i, '').replace(/\s+Sinhala Sub.*$/i, '').trim(), url, type, year: String(it?.extra?.date || '').trim(), img: String(it?.img || ''), imdb: String(it?.extra?.imdb || '').trim() });
    }
    return out;
};

const parseTv = (html) => {
    const h = String(html || '');
    const eps = [...h.matchAll(/href='(https?:\/\/[^']+)' data-pid='\d+' data-season='(\d+)' data-episode='(\d+)'/g)];
    const seasons = [...new Set([...h.matchAll(/data-snum='(\d+)'/g)].map((m) => Number(m[1])))];
    let base = '';
    if (eps.length) {
        const first = (new URL(eps[0][1]).pathname.replace(/\/+$/, '').split('/').pop()) || '';   // solo-leveling-1x1
        base = first.replace(/-\d+x\d+$/, '');
    }
    return { epSlugBase: base, seasons: seasons.length ? seasons : [1], epRows: eps.map((m) => ({ se: Number(m[2]), ep: Number(m[3]), url: m[1] })) };
};

const LINK_RE = /<a\s+href='(https?:\/\/[^']+\/[a-z0-9]{6,14}\/)'\s+target='_blank'\s+class='(?:movie-)?download-button'[^>]*>[\s\S]*?<span class='(?:movie-)?download-meta'>([^<]+)<\/span>/g;
const parseLinks = (html) => {
    const rows = [];
    for (const m of String(html || '').matchAll(LINK_RE)) {
        const meta = dec(m[2]);
        const q = meta.match(/(\d{3,4})\s*p/i);
        const sz = meta.match(/([\d.]+)\s*(GB|MB)\s*(?:•|$)/i);
        const lang = (meta.split('•')[2] || '').trim();
        const h = q ? Number(q[1]) : 0;
        let sizeMB = 0;
        if (sz) sizeMB = Number(sz[1]) * (/gb/i.test(sz[2]) ? 1024 : 1);
        rows.push({ label: (q ? q[1] + 'p' : meta.split('•')[0].trim().split(' ').pop()) || 'link', h, sizeMB, lang, meta: meta.trim(), linkUrl: m[1] });
    }
    return rows;
};

const parseLinkPage = (html) => {
    const anchors = [...String(html || '').matchAll(/href=["'](https?:\/\/[^"']+)["']/g)].map((m) => dec(m[1]));
    const skip = /cinesubz|cineru|t\.me|google\.com\/search|fonts\.|wp-content|wp-json|w3\.org|youtu|facebook|instagram|whatsapp\.com|wa\.me/i;
    const mappings = [...String(html || '').matchAll(/\{search:\[([^\]]+)\],replace:"([^"]+)"\}/g)].map((m) => ({
        search: [...m[1].matchAll(/"(https?:\/\/[^"]+)"/g)].map((x) => x[1]),
        replace: m[2],
    }));
    let url = '';
    for (const u of anchors) if (/\.mp4($|[?&])|\.mkv($|[?&])|\/server\d/.test(u) && !skip.test(u)) { url = u; break; }
    if (!url) {
        const masked = anchors.find((u) => /google\.com\/server/.test(u));
        if (!masked) return null;
        url = masked;
        for (const mp of mappings) {
            for (const s of mp.search) {
                if (url.startsWith(s)) { url = mp.replace + url.slice(s.length); break; }
            }
            if (!url.includes('google.com/server')) break;
        }
    }
    url = url.replace(/^http:/, 'https:');
    // ext fix — the page's own JS: '.mp4?bot=…' → '?ext=mp4&bot=…', plain '.mp4' → '?ext=mp4' (first occurrence, same order)
    if (url.includes('.mp4?bot=cscloud2bot&code=')) url = url.replace('.mp4?bot=cscloud2bot&code=', '?ext=mp4&bot=cscloud2bot&code=');
    else if (url.includes('.mkv?bot=cscloud2bot&code=')) url = url.replace('.mkv?bot=cscloud2bot&code=', '?ext=mkv&bot=cscloud2bot&code=');
    else if (url.includes('.mp4')) url = url.replace('.mp4', '?ext=mp4');
    else if (url.includes('.mkv')) url = url.replace('.mkv', '?ext=mkv');
    else if (url.includes('.zip')) url = url.replace('.zip', '?ext=zip');
    if (!/^https?:\/\//.test(url) || /google\.com\/server/.test(url)) return null;
    const fname = (() => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\?.*$/, '') || ''; } catch { return ''; } })();
    return { url, fname };
};

/** nonce hunt: any "nonce":"<hex>" pair on the homepage — cached 10 min, refreshed on failures */
async function getNonce(host) {
    const s = dState.get(host) || {};
    if (s.nonce && s.nonceAt && Date.now() - s.nonceAt < TTL) return s.nonce;
    const r = await zget(host + '/');
    if (r.status === 403 || r.status === 503) { markBad(host); throw new Error(host + ' CF-block (' + r.status + ')'); }
    const html = await r.text();
    const nonces = parseNonce(html);
    if (!nonces.length) { markBad(host); throw new Error(host + ' nonce නෑ'); }
    s.nonces = [...new Set(nonces)]; s.nonce = s.nonces[0]; s.nonceAt = Date.now();
    dState.set(host, s);
    return s.nonce;
}

/** zetaflix search → [{name, url, type:'movie'|'tv', year, img, imdb}] · domain ladder */
async function zetaSearch(title, n = 6) {
    const q = normTitle(title).split(' ').slice(0, 6).join(' ').trim() || String(title || '').trim();
    const errs = [];
    for (const host of DOMAINS) {
        if (isBad(host)) { errs.push(hostOf(host) + ' cooldown'); continue; }
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const nonce = await getNonce(host);
                const r = await zget(`${host}/wp-json/zetaflix/search/?keyword=${encodeURIComponent(q)}&nonce=${nonce}`);
                const j = await r.json().catch(() => ({}));
                if (j?.error === 'no_verify_nonce') { const s = dState.get(host) || {}; s.nonce = (s.nonces || [])[attempt + 1] || null; s.nonceAt = 0; continue; }
                if (j?.error) { if (/no_posts/i.test(j.error)) break; throw new Error(j.error); }   // no results on this domain → next domain
                const out = parseSearch(j);
                if (out.length) return out.slice(0, n);
                break;
            } catch (e) { errs.push(hostOf(host) + ' ' + String(e.message || e).slice(0, 60)); }
        }
    }
    if (errs.length) console.log('[zetasub] search fail:', errs.join(' | ').slice(0, 200));
    return [];
}

/** fuzzy title match — MovieBox name vs zetaflix name (token overlap) */
function matchScore(a, b) {
    const A = new Set(normTitle(a).split(' ').filter(Boolean));
    const B = new Set(normTitle(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const t of A) if (B.has(t)) hit++;
    return hit / Math.max(A.size, B.size);
}

/** best show/movie for a title → {name,url,type,year} or null */
async function zetaFindShow(title) {
    const res = await zetaSearch(title, 6);
    if (!res.length) return null;
    let best = null, bs = 0;
    for (const it of res) { const sc = matchScore(title, it.name); if (sc > bs) { bs = sc; best = it; } }
    return bs >= 0.33 ? best : null;   // ≥⅓ token overlap — 'Mashle: Magic and Muscles' vs 'Mashle ...'
}

/** tvshow page → { epSlugBase, seasons:[..], epRows } */
async function zetaTvPage(tvUrl) {
    const r = await zget(tvUrl);
    if (!r.ok) throw new Error('tvshow HTTP ' + r.status);
    return parseTv(await r.text());
}

/** episode page URL for (se,ep): inline S1 rows give the slug base; deeper seasons constructed */
async function zetaEpisodeUrl(show, se, ep) {
    const showInfo = await zetaFindShow(show);
    if (!showInfo) return null;
    if (showInfo.type === 'movie') return { showInfo, epUrl: showInfo.url, isMovie: true };
    const tv = await zetaTvPage(showInfo.url);
    if (!tv.epSlugBase) return null;
    const inline = tv.epRows.find((r) => r.se === Number(se) && r.ep === Number(ep));
    if (inline) return { showInfo, epUrl: inline.url, isMovie: false };
    return { showInfo, epUrl: `${new URL(showInfo.url).origin}/episodes/${tv.epSlugBase}-${se}x${ep}/`, isMovie: false };
}

/** episode/movie page → download rows [{label, h, sizeMB, lang, linkUrl}] */
async function zetaLinks(pageUrl) {
    const r = await zget(pageUrl);
    if (!r.ok || r.status === 404) return [];
    return parseLinks(await r.text());
}

/** link page (zt-links / api-…) → final CDN url (+ filename hint) — mappings parsed from the page */
async function zetaResolve(linkUrl) {
    const r = await zget(linkUrl);
    if (!r.ok) throw new Error('link page HTTP ' + r.status);
    const res = parseLinkPage(await r.text());
    if (!res) throw new Error('link page එකෙන් file url හම්බුණේ නෑ / mapping එක ගැලපුණේ නෑ');
    return res;
}

/** one (show,se,ep) → best download row (nearest height) · movie: se=0/ep=0 */
async function zetaRow(title, se, ep, wantH = 0, cache) {
    cache = cache || {};
    const key = normTitle(title).slice(0, 60);
    if (!cache[key]) cache[key] = await zetaEpisodeUrl(title, se, ep).catch((e) => ({ err: String(e.message || e) }));
    const found = cache[key];
    if (!found || found.err) return null;
    const links = await zetaLinks(found.epUrl);
    if (!links.length) return null;
    const pick = wantH ? (links.find((l) => l.h === wantH) || links.find((l) => l.h <= wantH && l.h) || links[links.length - 1]) : links[0];
    const res = await zetaResolve(pick.linkUrl).catch(() => null);
    if (!res?.url) return null;
    return { label: pick.label, h: pick.h, sizeMB: pick.sizeMB, lang: pick.lang, url: res.url, fname: res.fname || found.showInfo.name, showName: found.showInfo.name, isMovie: !!found.isMovie };
}

module.exports = { DOMAINS, UA, parseNonce, parseSearch, parseTv, parseLinks, parseLinkPage, matchScore, normTitle, getNonce, markBad, isBad, zetaSearch, zetaFindShow, zetaTvPage, zetaEpisodeUrl, zetaLinks, zetaResolve, zetaRow, _state: dState };
