/**
 * cinesite.js — v2.100.0 🍿 .cinesubz + .cineru — Sinhala-subtitle movie & series downloads
 *
 * User spec (2026-10-30): "Moviedex command එකට cinesubz,cineru mix කරන්න එපා — ඒ දෙක වෙනම
 * command දෙකක් ලෙස ඇඩ් කරන්න" → moviedex stays MovieBox-only; each site gets its OWN command
 * (same zetaflix/Dooplay engine underneath, per-host config — never mixed in one menu).
 *
 * LIVE-VERIFIED 2026-10-30 (scripts/probe_sites_v2100.js / _2 / _3 / probe_series_v2100.js):
 *   1. search:   GET /?s=<q> → div.display-item → <a href="{base}/movies|tvshows/<slug>/"
 *                data-ptype="movies|tvshows" title="…"> + <img data-original="poster">
 *   2. title:    page → <li id="player-option-N" data-type="mv|ep" data-post="65702" data-nume="N">
 *   3. player:   POST /wp-admin/admin-ajax.php  action=zeta_player_ajax&post=<post>&nume=<n>&type=<t>
 *                (zetaflix theme action — classic doo_player_ajax returns "0"/400, verified)
 *                nume=1 → {"embed_url":"https://player2.setwenna.one/<file>-720p.mp4","type":"mp4"}
 *                nume=2 → {"embed_url":"<iframe …>","type":"iframe"} = stream-only, NOT downloadable
 *   4. qualities: GET that player URL (the "Stream Player" HTML) → ALL_QUALITIES =
 *                [{"html":"SD 480P","url":"https://csXX.supercloud1.xyz/<file>-480p.mp4?play=true"},…]
 *   5. download: "?play=true" URLs serve REAL bytes to token-less / referer-less Range requests
 *                (player source says it, probes confirm: 206 + content-range + ftyp box) —
 *                files live on their ORIGINAL csXX node (cross-host = 404, keep url verbatim)
 *   6. series:   /tvshows/<slug>/ lists ALL /episodes/<slug>-N-x-M/ links in order on ONE page
 *                (Breaking Bad S1E1→S5E16 = 62/62 verified) — no season ajax needed
 * Flow (metdn.js session grammar — quote-reply only, cardId-enforced):
 *   .cinesubz <name> → search menu → quote N → 🎬 movie: quality card (real sizes)
 *                                     → 📺 series: FULL episode menu → quote M → quality card
 *   quote K → handleDownload (dlQueue). Direct URL jump also supported.
 * Boot health probe (healthCheck) logs both hosts to console 8s after boot — panel-network truth.
 */
const { foot } = require('./style');
const { smartFetch } = require('./net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TTL = 30 * 60e3;
const CAP = 40;
const MENU_ROWS = 10;
const EP_CAP = 300;                       // episode menu rows cap (menu still honest about truncation)
const TIMEOUT = 30e3;

const SITES = {
    '.cinesubz': { cmd: '.cinesubz', host: 'cinesubz.net', base: 'https://cinesubz.net', brand: '🍿 CineSubz', tag: '🍿 CineSubz' },
    '.cineru': { cmd: '.cineru', host: 'cineru.lk', base: 'https://cineru.lk', brand: '🍿 Cineru', tag: '🍿 Cineru' },
};
const siteOf = (c) => SITES[String(c || '').toLowerCase()] || null;
const isSiteUrl = (arg) => {
    const m = String(arg || '').match(/https?:\/\/(?:www\.)?(cinesubz\.net|cineru\.lk)\/([^\s]+)/i);
    return m ? { host: m[1].toLowerCase(), path: '/' + m[2].replace(/\/+$/, '') } : null;
};

// net.js smartFetch — DoH/proxy resilience (cinesubz could be DNS-blocked on some ISPs).
// fetcher seam (metdn pattern): tests inject a mock; live path stays smartFetch.
let fetcher = (u, o) => smartFetch(u, o);
const setFetcher = (f) => { const prev = fetcher; fetcher = f; return prev; };   // returns previous → restore pattern
async function grab(url, o = {}) {
    const r = await fetcher(url, { headers: { 'User-Agent': UA, Accept: o.accept || 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9', ...(o.referer ? { Referer: o.referer } : {}), ...(o.headers || {}) }, ...(o.method ? { method: o.method, body: o.body } : {}), signal: AbortSignal.timeout(o.timeout || TIMEOUT) });
    if (!r.ok && !o.allowFail) throw new Error('HTTP ' + r.status + ' @ ' + url.slice(0, 60));
    return r;
}
const grabText = async (url, o = {}) => await (await grab(url, o)).text();

// ── 1. search parse — display-item blocks (data-ptype = movies|tvshows) ──
function parseSearch(html, site) {
    const items = [];
    const seen = new Set();
    const re = /<div[^>]+id=["']item-\d+["'][^>]*class=["'][^"']*\bdisplay-item\b[^"']*["'][^>]*>([\s\S]{0,2500}?)<\/div>\s*(?=<div[^>]+id=["']item-|<\/div>\s*<\/div>\s*<\/main>|<div class="page-nav)/gi;
    // fallback anchor-scan: display-item markup nests <a> then <img data-original>
    const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']*\/(movies|tvshows)\/([^"']+)\/)["'][^>]*>/gi)];
    for (const a of anchors) {
        const url = a[1].startsWith('http') ? a[1] : site.base + a[1];
        if (!url.includes(site.host) || seen.has(url)) continue;
        const kind = a[2].toLowerCase() === 'tvshows' ? 'series' : 'movie';
        // region to the next anchor — img + title live right after
        const start = a.index + a[0].length;
        const nxt = html.indexOf('<a', start);
        const region = html.slice(start, nxt > -1 && nxt - start < 3000 ? nxt : start + 2500);
        const img = region.match(/<img[^>]*>/i)?.[0] || '';
        const poster = (img.match(/data-original=["']([^"']+)["']/i) || img.match(/src=["']([^"']+)["']/i) || [])[1] || '';
        const title = (a[0].match(/title=["']([^"']+)["']/i) || [])[1]
            || (img.match(/alt=["']([^"']+)["']/i) || [])[1]
            || decodeURIComponent(url.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ').trim();
        if (!title) continue;
        seen.add(url);
        items.push({ title: title.replace(/\s+/g, ' ').trim(), url, kind, poster });
        if (items.length >= MENU_ROWS) break;
    }
    return items;
}

// ── 2. title page parse — player options + (series) all episode links ──
function parseTitle(html, site) {
    const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s*\|\s*[^|]*$/, '').replace(/\s*[-–]\s*CineSubz.*$/i, '').trim();
    const poster = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1] || '';
    const options = [];
    for (const li of html.matchAll(/<li[^>]*id=["']player-option-(\d+)["'][^>]*>/gi)) {
        const tag = li[0];
        options.push({ nume: li[1], type: (tag.match(/data-type=["']([^"']+)["']/i) || [])[1] || '', post: (tag.match(/data-post=["']([^"']+)["']/i) || [])[1] || '' });
    }
    const episodes = [];
    const seen = new Set();
    for (const m of html.matchAll(/href=["'](https?:\/\/[^"']*\/episodes\/[^"']+)["']/gi)) {
        let u; try { u = new URL(m[1]); } catch { continue; }
        if (u.hostname !== site.host) continue;
        u.hash = ''; u.search = '';
        const url = u.origin + u.pathname;
        if (seen.has(url)) continue;
        seen.add(url);
        episodes.push(url);
        if (episodes.length >= EP_CAP) break;
    }
    return { title, poster, options, episodes, epTruncated: episodes.length >= EP_CAP };
}

// 'breaking-bad-5x16' → 'S5·E16' · 'show-s01e02' → 'S1·E2' · no suffix → ''
function seasonSlug(url) {
    const slug = String(url || '').replace(/\/+$/, '').split('/').pop() || '';
    let m = slug.match(/-(\d{1,2})x(\d{1,4})$/i) || slug.match(/-s(\d{1,2})e(\d{1,4})$/i);
    if (!m) return '';
    return `S${parseInt(m[1], 10)}·E${parseInt(m[2], 10)}`;
}

// ── 3. player ajax — zetaflix theme action (zeta_player_ajax) ──
async function playerAjax(site, opt, referer) {
    const body = `action=zeta_player_ajax&post=${encodeURIComponent(opt.post)}&nume=${encodeURIComponent(opt.nume)}&type=${encodeURIComponent(opt.type)}`;
    const t = await grabText(site.base + '/wp-admin/admin-ajax.php', { method: 'POST', body, referer, accept: 'application/json, text/plain, */*', timeout: 25e3, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } });
    let j; try { j = JSON.parse(t); } catch { throw new Error('player ajax JSON fail: ' + t.slice(0, 60)); }
    if (!j.embed_url) throw new Error('embed_url නෑ — ' + String(j.msg || 'site එක response එක වෙනස්').slice(0, 60));
    return { embed: String(j.embed_url), type: String(j.type || '') };
}

// ── 4. "Stream Player" page → [{html, url}] ──
// Two live-verified shapes: (a) multi-quality ALL_QUALITIES = [{html,url},…] (Glass Onion/CIA),
// (b) single-file ALL_QUALITIES = [] with the real file as the Artplayer url:/media href
// (Breaking Bad S01E01 = cs01.supercloud1.xyz/…mp4). Sizes verified via Range probe.
function parseQualities(html) {
    const raw = html.match(/ALL_QUALITIES\s*=\s*(\[[\s\S]*?\])\s*[;\n]/);
    if (raw) {
        try {
            const arr = JSON.parse(raw[1].replace(/,(?=\s*])/g, '')).filter((q) => q && /^https?:/.test(q.url || ''));
            if (arr.length) return arr;
        } catch { }
    }
    const media = [...new Set([
        ...[...html.matchAll(/url\s*:\s*['"](https?:\/\/[^'"]+\.(?:mp4|mkv)[^'"]*)['"]/gi)].map((m) => m[1]),
        ...[...html.matchAll(/["'](https?:\/\/[^"']*supercloud[^"']*\.(?:mp4|mkv)[^"']*)["']/gi)].map((m) => m[1]),
    ])];
    return media.slice(0, 1).map((u) => ({ html: 'MP4', url: u }));
}

// ── 5. Range size probe — 206 + content-range total (?play=true needs no referer/token) ──
async function probeSize(url) {
    try {
        const r = await fetcher(url, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15e3) });
        const cr = r.headers.get('content-range');
        const m = cr && cr.match(/\/(\d+)$/);
        if (m) return { ok: r.status === 206, sizeMB: Math.round(Number(m[1]) / 1048576) };
        const cl = r.headers.get('content-length');
        if (r.status === 200 && cl && Number(cl) > 1e4) return { ok: true, sizeMB: Math.round(Number(cl) / 1048576) };
        return { ok: false, sizeMB: 0 };
    } catch { return { ok: false, sizeMB: 0 }; }
}

// nume=1 mp4 option → player page → qualities probed best-first (desc)
async function resolveQualities(site, pageUrl, options) {
    const mp4Opts = options.filter((o) => o.post && o.nume);
    if (!mp4Opts.length) throw new Error('player options නෑ — මේ page එකේ download source එකක් නෑ');
    let lastErr = null;
    for (const opt of mp4Opts.slice(0, 3)) {   // option 1 = mp4 usually; try up to 3
        try {
            const { embed, type } = await playerAjax(site, opt, pageUrl);
            if (type !== 'mp4' || !/\.mp4(\?|$)/i.test(embed)) { lastErr = new Error('download source නෑ — iframe stream එක විතරයි'); continue; }
            const page = await grabText(embed, { referer: site.base + '/' });
            const qs = parseQualities(page);
            if (!qs.length) { lastErr = new Error('quality list එක හම්බුණේ නෑ — player page එක වෙනස් වෙලා වෙන්න පුළුවන්'); continue; }
            const out = [];
            for (const q of qs) { const { ok, sizeMB } = await probeSize(q.url); out.push({ label: String(q.html || 'MP4').trim(), url: q.url, sizeMB, ok }); }
            const live = out.filter((q) => q.ok);
            if (!live.length) { lastErr = new Error('quality files ටික server එකෙන් හම්බුණේ නෑ (404)'); continue; }
            live.sort((a, b) => (parseInt(String(b.label).match(/(\d{3,4})/)?.[1], 10) || 0) - (parseInt(String(a.label).match(/(\d{3,4})/)?.[1], 10) || 0));   // 1080 first (label may be 'FHD 1080P' or '480p')
            return live;
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('download source එකක් හම්බුණේ නෑ');
}

// ── sessions (metdn grammar) ──
const sessions = new Map();
const gcSessions = () => {
    for (const [k, s] of sessions) if (Date.now() - (s.at || 0) > TTL) sessions.delete(k);
    if (sessions.size > CAP) sessions.delete(sessions.keys().next().value);
};
const remember = (jid, s) => { gcSessions(); sessions.set(jid, s); };

// ── cards ──
function searchCard(site, q, items) {
    const rows = items.map((it, i) => `${i + 1}. ${it.kind === 'series' ? '📺' : '🎬'} ${it.title.slice(0, 66)}`);
    return [`${site.brand} search — "${q}"`, '', ...rows, '', '✦ ගානක් *quote කරලා* එවන්න → 🎬 movie: quality menu · 📺 series: episode menu'].join('\n') + '\n' + foot(site.host);
}
function qualityCard(site, ctx, qs) {
    const lines = [site.brand, `📄 ${String(ctx.title || 'Untitled').slice(0, 90)}`];
    if (ctx.epLabel) lines.push(`🎬 ${ctx.epLabel}`);
    lines.push('', '📋 Quality එක තෝරන්න — ගානක් *quote කරලා* එවන්න:');
    qs.forEach((q, i) => lines.push(`${i + 1}. ${q.label} · ${q.sizeMB ? q.sizeMB + ' MB' : 'size ?'}`));
    return lines.join('\n') + '\n' + foot(site.host);
}
function epsCard(site, ctx) {
    const lines = [site.brand, `📄 ${String(ctx.title || 'Untitled').slice(0, 80)}`, `📺 Episodes ${ctx.episodes.length}${ctx.epTruncated ? '+' : ''} (සියල්ල එක menu එකේ)`, ''];
    ctx.episodes.forEach((u, i) => lines.push(`${i + 1}. ${seasonSlug(u) || 'EP ' + (i + 1)}`));
    lines.push('', '✦ Episode ගානක් *quote කරලා* එවන්න → quality menu');
    return lines.join('\n') + '\n' + foot(site.host);
}
const USAGE = (site) => `${site.brand} — *.${site.cmd.slice(1)} <නම / link>*
උදා: \`${site.cmd} glass onion\`

✦ නමක් දුන්නාම → search menu → ගානක් quote කරන්න
✦ 🎬 movie → quality menu → file · 📺 series → episode menu → quality menu → file
✦ ${site.host} link එකක් දුන්නාම → කෙලින්ම quality/episode menu එකෙන් පටන් ගන්නවා
✦ moviedex (MovieBox) සහ මේ දෙක වෙන වෙනමයි — sources mix වෙන්නෙ නෑ\n` + foot(site.host);

// ── flow steps ──
async function openTitle(site, ctx, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const page = await grabText(ctx.url, { referer: site.base + '/?s=' });
    const info = parseTitle(page, site);
    if (!info.title) throw new Error('page එක කියවන්න බෑ — site markup එක වෙනස් වෙලා වෙන්න පුළුවන්');
    Object.assign(ctx, { title: info.title || ctx.title, poster: info.poster || ctx.poster || '' });
    if (ctx.kind === 'series' || info.episodes.length) {
        if (!info.episodes.length) throw new Error('episodes හම්බුණේ නෑ — මේ series එකේ episode list එකක් නෑ');
        Object.assign(ctx, { stage: 'eps', episodes: info.episodes, epTruncated: info.epTruncated, at: Date.now() });
        await edit(epsCard(site, ctx));
        ctx.cardId = st.key?.id || null;
        return true;
    }
    // movie — quality menu right away (poster card like metdn qualityMenu)
    const qs = await resolveQualities(site, ctx.url, info.options);
    Object.assign(ctx, { stage: 'quality', qs, at: Date.now() });
    const cap = qualityCard(site, ctx, qs);
    if (ctx.poster) {
        try {
            const im = await send(jid, { image: { url: ctx.poster }, caption: cap }, { quoted: msg });
            ctx.cardId = im?.key?.id || null;
            try { await send(jid, { delete: st.key }); } catch { }
            return true;
        } catch { }
    }
    await edit(cap);
    ctx.cardId = st.key?.id || null;
    return true;
}

async function openEpisode(site, ctx, n, { send, jid, msg, st }) {
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    const url = ctx.episodes[n - 1];
    const page = await grabText(url, { referer: ctx.url });
    const info = parseTitle(page, site);
    if (!info.options.length) throw new Error('මේ episode එකේ player options නෑ');
    const qs = await resolveQualities(site, url, info.options);
    Object.assign(ctx, { stage: 'quality', qs, epLabel: seasonSlug(url) || 'EP ' + n, epUrl: url, at: Date.now() });
    const cap = qualityCard(site, ctx, qs);
    if (ctx.poster) {
        try {
            const im = await send(jid, { image: { url: ctx.poster }, caption: cap }, { quoted: msg });
            ctx.cardId = im?.key?.id || null;
            try { await send(jid, { delete: st.key }); } catch { }
            return true;
        } catch { }
    }
    await edit(cap);
    ctx.cardId = st.key?.id || null;
    return true;
}

async function goPick(site, send, jid, msg, n, download) {
    gcSessions();
    const ctx = sessions.get(jid);
    if (!ctx) return send(jid, { text: `⏳ session expire වෙලා — *${site.cmd} <නම>* ආයෙත් ගහන්න` }, { quoted: msg });
    if (ctx.stage === 'search') {
        if (!ctx.items[n - 1]) return send(jid, { text: `❌ ${n} — menu එකේ නෑ (1-${ctx.items.length})` }, { quoted: msg });
        const it = ctx.items[n - 1];
        const st = await send(jid, { text: `${site.brand} — page එක කියවනවා…` }, { quoted: msg });
        try {
            Object.assign(ctx, { url: it.url, kind: it.kind, title: it.title, poster: it.poster });
            await openTitle(site, ctx, { send, jid, msg, st });
            return true;
        } catch (e) { return await (async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } })('❌ ' + site.brand.slice(2) + ': ' + String((e && e.message) || e).slice(0, 180)); }
    }
    if (ctx.stage === 'eps') {
        if (!ctx.episodes[n - 1]) return send(jid, { text: `❌ ${n} — episode එකක් නෑ (1-${ctx.episodes.length})` }, { quoted: msg });
        const st = await send(jid, { text: `${site.brand} — episode එක කියවනවා…` }, { quoted: msg });
        try { await openEpisode(site, ctx, n, { send, jid, msg, st }); return true; }
        catch (e) { return await (async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } })('❌ ' + site.brand.slice(2) + ': ' + String((e && e.message) || e).slice(0, 180)); }
    }
    const q = ctx.qs && ctx.qs[n - 1];
    if (!q) return send(jid, { text: `❌ ${n} — quality එකක් නෑ (1-${(ctx.qs || []).length})` }, { quoted: msg });
    if (!download) return send(jid, { text: `🔗 ${q.url}` }, { quoted: msg });   // tests / fallback
    sessions.delete(jid);
    await download(q.url, site.tag + (ctx.epLabel ? ` · ${ctx.epLabel}` : '') + ` · ${q.label}`);
    return true;
}

// ── command handle — (cmd, {send,jid,msg,rest,react,download}) same contract as metdn/terabox ──
async function handle(c, ctx) {
    const site = siteOf(c);
    if (!site) return false;
    const { send, jid, msg, rest, react, download } = ctx;
    const arg = rest.join(' ').trim();

    const mNum = arg.match(/^(?:go\s+)?(\d{1,4})$/i);   // .cinesubz 2 / .cineru go 2
    if (mNum) return goPick(site, send, jid, msg, parseInt(mNum[1], 10), download);
    if (!arg) return send(jid, { text: USAGE(site) }, { quoted: msg });

    await react?.('🍿');
    const st = await send(jid, { text: `${site.brand} — search කරනවා…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        // direct link jump → straight into the title flow
        const lnk = isSiteUrl(arg);
        if (lnk) {
            if (lnk.host !== site.host) return await edit(`❌ මේක ${site.host} link එකක් නෙවෙයි — ඒ site එකට ඒගොල්ලෝගෙම command එක පාවිච්චි කරන්න`);
            gcSessions();
            const sctx = { cmd: site.cmd, stage: 'search', url: site.base + lnk.path, kind: /\/episodes\//.test(lnk.path) ? 'series' : (/\/tvshows\//.test(lnk.path) ? 'series' : 'movie'), q: '(link)', at: Date.now(), items: [], cardId: null };
            if (sctx.kind === 'series' && /\/episodes\//.test(lnk.path)) sctx.episodes = [sctx.url], sctx.stage = 'eps';
            remember(jid, sctx);
            if (sctx.stage === 'eps') {
                const epPage = await grabText(sctx.url, { referer: site.base + '/' });
                const info = parseTitle(epPage, site);
                Object.assign(sctx, { title: info.title, poster: info.poster });
                await openEpisode(site, sctx, 1, { send, jid, msg, st });
            } else await openTitle(site, sctx, { send, jid, msg, st });
            return true;
        }
        if (arg.length > 80) throw new Error('search query එක 80 අකුරු ඇතුලේ වෙන්න ඕන');
        const html = await grabText(site.base + '/?s=' + encodeURIComponent(arg), { referer: site.base + '/' });
        const items = parseSearch(html, site);
        if (!items.length) return await edit(`${site.brand} search — "${arg.slice(0, 40)}"\n\n❌ මුකුතු හම්බුණේ නෑ — වෙන නමක් / කෙටි නමක් try කරන්න\n` + foot(site.host));
        remember(jid, { cmd: site.cmd, stage: 'search', q: arg.slice(0, 80), items, at: Date.now(), cardId: null });
        await edit(searchCard(site, arg.slice(0, 40), items));
        sessions.get(jid).cardId = st.key?.id || null;
        return true;
    } catch (e) {
        return await edit('❌ ' + site.brand.slice(2) + ': ' + String((e && e.message) || e).slice(0, 180));
    }
}

// numeric quote bridge (bot.js chain) — card quote එකට number → '.cinesubz go N' / '.cineru go N'
function bridge(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s || !s.cmd) return null;
    if (Date.now() - (s.at || 0) > TTL + 30 * 60e3) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d) || d < 1) return null;
    if (qid && s.cardId && String(qid) !== String(s.cardId)) return null;   // 🔒 reply-only
    return s.cmd + ' go ' + d;
}

// boot health probe — one-shot console log (panel-network truth for both hosts, 8s after boot)
let booted = false;
function healthCheck(delayMs = 8000) {
    if (booted) return;
    booted = true;
    const t = setTimeout(async () => {
        for (const site of Object.values(SITES)) {
            try {
                const r = await fetcher(site.base + '/?s=movie', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15e3) });
                const html = await r.text().catch(() => '');
                const cf = /Just a moment|challenge-platform/.test(html) ? ' CF-WALLED' : '';
                console.log(`[CINESITE] ${site.host} boot probe = ${r.status}${cf}${r.status === 200 && !cf ? ' ✅' : ' ⚠️'}`);
            } catch (e) {
                console.log(`[CINESITE] ${site.host} boot probe FAIL ${String((e && e.message) || e).slice(0, 60)} ⚠️`);
            }
        }
    }, delayMs);
    if (t.unref) t.unref();
}

module.exports = {
    handle, bridge, healthCheck, setFetcher, SITES, siteOf, isSiteUrl,
    parseSearch, parseTitle, parseQualities, seasonSlug, playerAjax, probeSize, resolveQualities,
    _sessions: sessions,
};
