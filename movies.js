'use strict';
/**
 * movies.js — .moviepro for KAVIZ MD V1 (v2.19)
 *
 *  v2.19 — "movie එකම එනවා" upgrade (abc-repo system වගේ, but our own design):
 *    .moviepro <නම>            → Cinemeta (Stremio, free/no-key) search → numbered list
 *    .moviepro <අංකය>          → info card + CineSubz quality list (480p/720p/1080p + size)
 *    .moviepro <අංකය> <q#>     → 🎬 MOVIE FILE එකම chat එකට (CineSubz → zt-links gate decode
 *                                 → real CDN URL → live-check → download engine → document)
 *    .moviepro <අංකය> trailer  → trailer video via the bot's yt pipeline
 *    bare number reply         → picks from the last list (like the .menu numbers)
 *
 *  CineSubz pipeline (verified Oct 2026):
 *    search page /?s= → movie page → /zt-links/<id>/ gate page → masked
 *    https://google.com/serverN/... link → mapped to drive.csplayer2.space/serverN/...
 *    (.mp4 → ?ext=mp4; bot=cscloud2bot&code= passthrough) → /api/download-data live-check
 *    → downloader streams file → WhatsApp document.
 *    If the CDN serves its protected player instead of the file → clean fallback:
 *    direct CDN link + cscloud2bot Telegram link + gate link.
 */
const { smartFetch } = require('./net');
const { human, maxMB } = require('./downloader');

const API = 'https://v3-cinemeta.strem.io/catalog/movie/top/search=';
const SESSION_TTL = 15 * 60e3;
const sessions = new Map();   // jid → { list, at, movie? }

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

/** Cinemeta search → top n movie metas (one retry on flaky cold-start) */
async function search(q, n = 8) {
    let lastE;
    for (let i = 0; i < 2; i++) {
        try { const j = await fetchJson(API + enc(q) + '.json'); return (j.metas || []).slice(0, n); }
        catch (e) { lastE = e; if (!/timeout|EAI|ENOTFOUND|reset/i.test(String(e.message))) break; }
    }
    throw lastE;
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
/** best cinesubz match for a cinemeta meta */
function bestMatch(items, m) {
    const name = norm(m.name), yr = yearOf(m);
    let best = null, bestScore = 0;
    for (const it of items) {
        const t = norm(it.title);
        const tokens = name.split(' ').filter(w => w.length > 1);
        let hit = tokens.filter(w => t.includes(w)).length;
        let score = tokens.length ? hit / tokens.length : 0;
        if (yr && it.title.includes(yr)) score += 0.25;
        if (it.tv) score -= 0.3;                       // prefer movies for a movie search
        if (score > bestScore) { bestScore = score; best = it; }
    }
    return bestScore >= 0.5 ? best : null;
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
    return `🎬 *MoviePro — "${q}"*\n\n` + list.map((m, i) =>
        `*${i + 1}.* ${m.name}${m.releaseInfo ? ' (' + m.releaseInfo + ')' : ''}${m.imdbRating ? '  ⭐' + m.imdbRating : ''}`).join('\n')
        + `\n\n➡️ අභිමතය තෝරන්න: *.moviepro <අංකය>*  (උදා: *.moviepro 1*)\n(අංකය විතරක් reply කළත් වැඩ)`;
}

function cardText(m, n, quals) {
    const cast = (m.cast || []).slice(0, 3).join(', ');
    const desc = String(m.description || '').trim().slice(0, 380) || '—';
    const rows = [`🎬 *${m.name}*${m.releaseInfo ? ` (${m.releaseInfo})` : ''}`,
        `⭐ ${m.imdbRating || '—'}/10 IMDb${m.runtime ? '  •  ⏱ ' + m.runtime : ''}`,
        m.genres?.length ? `🎭 ${m.genres.slice(0, 4).join(', ')}` : '',
        cast ? `👥 ${cast}` : '', '', `📝 ${desc}`, ''];
    if (quals && quals.items.length) {
        rows.push(`⬇️ *Download — CineSubz*`);
        quals.items.forEach((l, i) => rows.push(`*${i + 1}.* ${l.label}`));
        rows.push('', `🎬 *Movie file එකම chat එකට:* *.moviepro ${n} <quality#>*`, `   උදා: *.moviepro ${n} 1*`);
    } else {
        rows.push(`⬇️ Download page: ${dlUrl(m)}`, `🇱🇰 සිංහල උපසිරැසි: ${subsUrl(m)}`);
    }
    rows.push('', ytLink(m) ? `🎥 Trailer video එකට: *.moviepro ${n} trailer*` : '',
        m.imdb_id ? `🌐 IMDb: https://www.imdb.com/title/${m.imdb_id}/` : '');
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

/** trailer video via features.ytCommand (yt-dlp → clipto fallback → cookies/pool) */
async function trailerCmd(send, jid, msg, m) {
    const yt = ytLink(m);
    if (!yt) return send(jid, { text: '😢 මේ movie එකට trailer link එකක් හම්බුණේ නෑ' }, { quoted: msg });
    await require('./features').ytCommand(send, jid, msg, yt + ' 720', 'video', `Trailer — ${m.name}`);
}

/* ───────────────────────── movie file download ───────────────────────── */

async function movieFileCmd(send, jid, msg, m, qi, quals, linkMode = false) {
    const item = quals.items[qi - 1];
    if (!item) return send(jid, { text: `❌ ${qi} කියලා quality එකක් නෑ (1-${quals.items.length})` }, { quoted: msg });
    const label = item.label || 'movie';
    const mb = sizeMB(label);
    const status = await send(jid, { text: `🎯 *${label}*\n🔗 Link එක resolve කරනවා (CineSubz)...` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const r = await resolveGate(item.gate);
        if (!r.live) {
            await edit(`❌ මේ quality එකේ file එක server එකෙන් අයින් වෙලා 😕\nඅනිත් quality එකක් try කරන්න — *.moviepro <අංකය> <quality#>*`);
            return;
        }
        if (mb && mb > maxMB()) {
            await edit(`📦 File එක ${human(mb * 1024 * 1024)} — bot limit එක ${human(maxMB() * 1024 * 1024)} නිසා chat එකට යවන්න බැරි (.maxmb වෙනස් කරන්න පුළුවන්)\n\n🔗 Direct link:\n${r.real}`);
            return;
        }
        let last = 0;
        const onProgress = (loaded, total) => {
            const now = Date.now();
            if (now - last < 8000) return;
            last = now;
            const pct = total ? Math.floor(loaded * 100 / total) : null;
            const bar = pct === null ? '' : '▰'.repeat(Math.round(pct / 10)) + '▱'.repeat(10 - Math.round(pct / 10)) + ` ${pct}%\n`;
            edit(`⬇️ Movie download වෙනවා...\n${bar}${human(loaded)} / ${human(total) || '?'}  •  ${label}`);
        };
        await edit(`⏳ Movie එක download වෙනවා...\n${label}`);
        const { download } = require('./downloader');
        const files = await download(r.real, onProgress, { stream: !linkMode });   // 🌊 file mode → straight to WA; link mode → temp file → mirror
        for (const f of files) {
            if (linkMode) {
                await edit(`📤 Mirror upload වෙනවා... (${human(f.size)})`);
                const rel = await require('./mirror').uploadFile(f.path, f.name);
                await edit(`✅ *${m.name}* — direct link! 🔗\n\n🔗 ${rel.url}\n\n📦 ${human(f.size)}  •  ${label}\n⭐ ${m.imdbRating || '—'} IMDb  •  ⏳ දින ${rel.days} (${rel.host})\n⚠️ Public link එකක් — sensitive files එපා`);
            } else {
                await edit(`📤 WhatsApp එකට යවනවා... (${human(f.size)})`);
                await send(jid, {
                    document: f.open ? { stream: f.open() } : { url: f.path }, fileName: f.name, mimetype: f.mime,
                    caption: `🎬 *${m.name}*${m.releaseInfo ? ` (${m.releaseInfo})` : ''}\n📦 ${human(f.size)}  •  ${label}\n⭐ ${m.imdbRating || '—'} IMDb`,
                }, { quoted: msg });
            }
            if (f.path) require('fs').rm(f.path, { force: true }, () => { });
        }
        if (!linkMode) await edit(`✅ Movie එක ආවා! 🍿`);
    } catch (e) {
        const msgTxt = String(e.message || '');
        // CDN served its protected player instead of the file → clean link fallback
        try {
            const r = await resolveGate(item.gate);
            let t = `⚠️ File එක chat එකට ගන්න බැරි වුණා (${msgTxt.slice(0, 120)})\n\n🔗 *Direct link* (${label}):\n${r.real}`;
            if (r.tg) t += `\n\n✈️ Telegram download: ${r.tg}`;
            t += `\n🌐 CineSubz page: ${quals.page?.url || item.gate}\n\n💡 Browser එකෙන් open කරලා download කරන්න — IDM වගේ downloader එකකටත් link එක දෙන්න පුළුවන්`;
            await edit(t);
        } catch {
            await edit(`❌ Fail වුණා: ${msgTxt.slice(0, 200)}`);
        }
    }
}

/* ───────────────────────── command handler ───────────────────────── */

const hasSession = (jid) => { const s = sessions.get(jid); return !!(s && Date.now() - s.at < SESSION_TTL && s.list?.length); };

async function handle(c, ctx) {
    if (c !== '.moviepro' && c !== '.mvpro' && c !== '.movie') return false;
    const { send, jid, msg, rest } = ctx;
    const arg = rest.join(' ').trim();
    const pick = arg.match(/^(\d{1,2})(?:\s+(trailer|t))?(?:\s+(\d{1,2}))?(?:\s+(link|l))?$/i);

    if (pick) {
        const s = sessions.get(jid);
        if (!hasSession(jid)) return send(jid, { text: '⏳ Search session එක expire වෙලා — මුලින්ම *.moviepro <movie නම>* ගහන්න' }, { quoted: msg });
        const n = +pick[1], m = s.list[n - 1];
        if (!m) return send(jid, { text: `❌ ${n} කියලා result එකක් නෑ (1-${s.list.length})` }, { quoted: msg });
        if (pick[2]) { await trailerCmd(send, jid, msg, m); return true; }

        const full = await enrichMeta(m);
        const idx = s.list.indexOf(m); if (idx >= 0) s.list[idx] = full;   // cache the enriched meta

        // quality pick (.moviepro 2 1) → send the MOVIE FILE itself
        if (pick[3]) {
            if (!s.movie || !s.movie.items?.length) {
                return send(jid, { text: '⏳ Quality list එක load වෙලා නෑ — මුලින්ම *.moviepro ' + n + '* ගහලා list එක එනකම් ඉන්න' }, { quoted: msg });
            }
            s.movie.picked = full;
            await movieFileCmd(send, jid, msg, full, +pick[3], s.movie, !!(pick[4] && /^l/i.test(pick[4])));
            return true;
        }
        if (pick[4]) return send(jid, { text: '🔗 Link mode එකට quality අංකය එකත් ඕනෙ — උදා: *.moviepro ' + n + ' 1 link*' }, { quoted: msg });

        // info card + CineSubz quality list
        const st = await send(jid, { text: `🔎 *${full.name}* — download links හොයනවා...` }, { quoted: msg });
        const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
        const quals = await qualitiesFor(full);
        if (quals) { s.movie = { page: quals.page, items: quals.items, at: Date.now() }; }
        else s.movie = null;
        await edit('📋 Info card එක යවනවා...');
        await sendCard(send, jid, msg, full, n, quals);
        try { await send(jid, { text: ' ', edit: st.key }); } catch { }   // clear status
        return true;
    }

    if (!arg) {
        return send(jid, {
            text: `🎬 *MoviePro* — search කරලා *movie එකම* chat එකට ගන්න\n\n*.moviepro <movie නම>* — search\n   උදා: *.moviepro avatar way of water*\n*.moviepro <අංකය>* — details + quality list (480p/720p/1080p)\n*.moviepro <අංකය> <quality#>* — 🎬 movie file එකම එනවා\n*.moviepro <අංකය> <quality#> link* — 🔗 direct download link එකක් (status/grp share වලට)\n*.moviepro <අංකය> trailer* — trailer එක video විදිහට`,
        }, { quoted: msg });
    }

    const st = await send(jid, { text: `🔎 "${arg}" හොයනවා...` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const list = await search(arg);
        if (!list.length) return edit(`😢 "${arg}" — results නෑ. Movie නම ටිකක් වෙනස් කරලා try කරන්න.`);
        sessions.set(jid, { list, at: Date.now() });
        if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
        edit(listText(arg, list));
    } catch (e) {
        edit('❌ Search fail: ' + String(e.message).slice(0, 180) + '\n(ටිකකින් ආයෙත් try කරන්න)');
    }
    return true;
}

module.exports = { handle, search, cardText, listText, hasSession, csSearch, csMoviePage, mapMasked, resolveGate, qualitiesFor, sizeMB, bestMatch, enrichMeta };
