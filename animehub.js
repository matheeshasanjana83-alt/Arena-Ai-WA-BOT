/**
 * animehub.js — KAVIZ MD V1 v2.75.0
 * 🎌 .aniworld — AniWorld-Downloader (github.com/phoenixthrush/AniWorld-Downloader) → in-bot Node port
 *      search → series → season → episode → real provider extraction (Vidmoly HLS / Dood mp4 best-effort)
 *      NOTE: aniworld h4 labels LIE — every /redirect/<id> is resolved and routed by FINAL HOST.
 *      VOE/do7go = Cloudflare-walled, filemoon = JS shell → listed as browser-only, never faked.
 * 🔞 sulvii/hentai-api style NSFW → in-bot port on LIVE-verified free source nekobot.xyz
 *      (repo's hanime/rule34 endpoints are dead/CF-walled since 2025 — verified 2026-10-20)
 *      .hentai · .hneko · .hmidriff · .pgif — 18+ disclaimers on every result
 * No new deps: global fetch (undici) only. Sessions = same quote-reply grammar as moviedex.
 */
const { foot, cut } = require('./style');

const AW = 'https://aniworld.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TTL = 10 * 60e3;                     // session / card TTL (moviedex parity)
const EP_CAP = 120;                        // max episode rows per card

const sessions = new Map();                // jid → { stage:'series'|'season'|'ep', items:[{label,url}], title, at, cardId }
const gcSessions = () => { const now = Date.now(); for (const [k, s] of sessions) if (now - (s.at || 0) > TTL + 30 * 60e3) sessions.delete(k); };

// ───────── http ─────────
async function get(url, { referer, timeout = 25000, manual = false, method = 'GET', body, ct } = {}) {
    const headers = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: '*/*' };
    if (referer) headers.referer = referer;
    if (ct) headers['content-type'] = ct;
    const res = await fetch(url, { method, headers, body, redirect: manual ? 'manual' : 'follow', signal: AbortSignal.timeout(timeout) });
    return res;
}
const getText = async (url, o = {}) => { const r = await get(url, o); if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url.slice(0, 80)); return r.text(); };
const locOf = async (url, referer) => { const r = await get(url, { referer, manual: true }); return r.headers.get('location') || ''; };

// ───────── AniWorld scrapers ─────────
const stripEm = (s) => String(s || '').replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '').trim();

/** POST /ajax/search → [{title, description, link}] */
async function searchAW(q) {
    const raw = await getText(AW + '/ajax/search', { method: 'POST', body: 'keyword=' + encodeURIComponent(q), ct: 'application/x-www-form-urlencoded; charset=UTF-8', referer: AW + '/', timeout: 20000 });
    let arr; try { arr = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 10).map((x) => ({ title: stripEm(x.title), desc: cut(stripEm(x.description), 80), link: AW + x.link })).filter((x) => x.link && /\/anime\/stream\//.test(x.link));
}

/** series page → [{label:'📺 Staffel N'|'🎬 Filme', url}] (staffel sorted + filme last) — hrefs are RELATIVE */
async function seasonsOf(seriesUrl) {
    const html = await getText(seriesUrl, { referer: AW + '/' });
    const path = seriesUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');   // '/anime/stream/naruto'
    const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seen = new Set(); const out = [];
    const re = new RegExp('href="((?:https?://[^/"]+)?' + esc + '\/staffel-(\\d+)(?:\\?[^"/]*)?)"', 'g');   // end-quote anchored — episode links must NOT match
    let m;
    while ((m = re.exec(html))) {
        const url = m[1].startsWith('http') ? m[1].split('?')[0] : AW + m[1].split('?')[0];
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ label: '📺 Staffel ' + m[2], url, n: parseInt(m[2], 10) });
    }
    // safety net: same label twice (mixed absolute/relative) → keep first
    const byLabel = new Set();
    const uniq = out.filter((x) => (byLabel.has(x.label) ? false : (byLabel.add(x.label), true)));
    uniq.sort((a, b) => a.n - b.n);
    if (new RegExp('href="(?:https?://[^"]+)?' + esc + '\/filme"').test(html)) {
        const fm = AW + path + '/filme';
        if (!seen.has(fm)) { seen.add(fm); uniq.push({ label: '🎬 Filme', url: fm }); }
    }
    return uniq;
}

/** season/filme page → items sorted by N (episode-N = 'EP N' · film-N = '🎬 Film N') — hrefs are RELATIVE */
async function episodesOf(seasonUrl) {
    const html = await getText(seasonUrl, { referer: AW + '/' });
    const path = seasonUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
    const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seen = new Set(); const out = [];
    const re = new RegExp('href="((?:https?://[^"]+)?' + esc + '\\/(?:episode-|film-)(\\d+)(?:\\?[^"/]*)?)"', 'g');   // end-quote anchored
    let m;
    while ((m = re.exec(html))) {
        const url = m[1].startsWith('http') ? m[1].split('?')[0] : AW + m[1].split('?')[0];
        if (seen.has(url)) continue;
        seen.add(url);
        const isFilm = /\/film-\d+/.test(url);
        out.push({ n: parseInt(m[2], 10), url, label: (isFilm ? '🎬 Film ' : 'EP ') + m[2] });
    }
    out.sort((a, b) => a.n - b.n);
    return out;
}

/** episode page HTML → langkey → [{name, rid}] — every provider <li> carries
 *  class="episodeLink<id>" + data-lang-key + data-link-target.
 *  ⚠️ h4/icon names LIE about the real host (verified: li says VOE, redirect → vidmoly) —
 *  truth comes from resolveRedirect() by final host. Labels are display hints only. */
function providersFromHtml(html) {
    const map = { 1: [], 2: [], 3: [] };
    for (const m of html.matchAll(/<li[^>]*class="[^"]*episodeLink[^"]*"[^>]*>/g)) {
        const tag = m[0];
        const lk = /data-lang-key="(\d)"/.exec(tag);
        const tg = /data-link-target="([^"]+)"/.exec(tag);
        if (!lk || !tg) continue;
        const lang = parseInt(lk[1], 10);
        if (!map[lang]) continue;
        const end = html.indexOf('</li>', m.index);
        const block = html.slice(m.index, end > m.index ? end + 5 : m.index + 600);
        const h4 = /<h4>([^<]+)<\/h4>/.exec(block);
        const ic = /class="icon ([^"]+)"/.exec(block);
        map[lang].push({ name: (h4 ? h4[1].trim() : (ic ? ic[1].trim() : 'Hoster')), rid: tg[1] });
    }
    return map;
}

/** episode page → langkey → [{host, rid}]  (parse order = DOM order) */
async function providersOf(epUrl) {
    const html = await getText(epUrl, { referer: AW + '/' });
    return { html, map: providersFromHtml(html) };
}

const LANGS = { 1: '🇩🇪 Ger Dub', 2: '🇯🇵 JP + 🇬🇧 Eng Sub', 3: '🇯🇵 JP + 🇩🇪 Ger Sub' };
const LANG_ORDER = [2, 3, 1];

/** resolve /redirect/<id> → classify by REAL host (labels lie) */
async function resolveRedirect(rid) {
    const loc = await locOf(AW + rid, AW + '/');
    if (!loc) return { kind: 'dead', url: '' };
    if (/vidmoly/i.test(loc)) return { kind: 'vidmoly', url: loc };
    if (/dood/i.test(loc)) return { kind: 'dood', url: loc };
    if (/voe\.|do7go|megawg|wishfast/i.test(loc)) return { kind: 'voe', url: loc };
    if (/filemoon|byse|moonplayer/i.test(loc)) return { kind: 'filemoon', url: loc };
    return { kind: 'other', url: loc };
}

/** Vidmoly embed → master.m3u8 (plain fetch works — verified live 2026-10-20) */
async function vidmolyHls(embedUrl) {
    const html = await getText(embedUrl, { referer: AW + '/' });
    const m = /sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/.exec(html) || /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/.exec(html);
    return m ? m[1] : '';
}

/** Dood embed → direct .mp4 (pass_md5 flow, ported from AniWorld-Downloader doodstream.py) */
async function doodMp4(embedUrl) {
    const html = await getText(embedUrl, { referer: 'https://dood.li/' });
    const pm = /\$\.get\('([^']*pass_md5\/[^']*)'/.exec(html);
    if (!pm) return '';
    const base = new URL(pm[1], embedUrl).toString();
    const host = new URL(embedUrl).origin;
    const body = (await getText(base, { referer: host + '/' })).trim();
    if (!/^https?:\/\//.test(body)) return '';
    const tok = (/token=([a-zA-Z0-9]+)/.exec(html) || [])[1] || '';
    let rand = ''; for (let i = 0; i < 10; i++) rand += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)];
    return body + rand + (tok ? '?directly=1&token=' + tok : '?directly=1');
}

/** full episode resolve → { streams:[{lang,name,url,mp4}], pageOnly:[names] } — per-lang best chain */
async function resolveEpisode(epUrl) {
    const { map } = await providersOf(epUrl);
    const streams = []; const pageOnly = [];
    for (const lang of LANG_ORDER) {
        const list = map[lang] || [];
        let got = false;
        for (const p of list.slice(0, 6)) {
            if (got) break;
            let r; try { r = await resolveRedirect(p.rid); } catch { continue; }
            if (r.kind === 'vidmoly') {
                try { const hls = await vidmolyHls(r.url); if (hls) { streams.push({ lang, name: 'Vidmoly', url: hls, mp4: false }); got = true; } } catch { }
            } else if (r.kind === 'dood') {
                try { const mp4 = await doodMp4(r.url); if (mp4) { streams.push({ lang, name: 'Doodstream', url: mp4, mp4: true }); got = true; } } catch { }
            }
        }
        if (!got && list.length) pageOnly.push(LANGS[lang] + ' → ' + [...new Set(list.map((p) => p.name))].join(', '));
    }
    return { streams, pageOnly };
}

// ───────── NSFW (nekobot.xyz — live-verified free source) ─────────
const NEKO_TYPES = {
    '.hentai': { t: 'hentai', label: 'Hentai' },
    '.hneko': { t: 'hneko', label: 'Hentai Neko' },
    '.hmidriff': { t: 'hmidriff', label: 'Hentai Midriff' },
    '.pgif': { t: 'pgif', label: 'Porn GIF' },
};
async function nekobot(type) {
    for (let i = 0; i < 2; i++) {
        try {
            const r = await get('https://nekobot.xyz/api/image?type=' + type, { timeout: 20000 });
            const j = await r.json();
            if (j && j.success && j.message && /^https?:\/\//.test(j.message)) return j.message;
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 800));
    }
    return '';
}

// ───────── cards ─────────
const searchCard = (q, list) => `🎌 *AniWorld — "${cut(q, 40)}"*\n\n` +
    list.map((x, i) => `*${i + 1}.* ${x.title}${x.desc ? '\n    _' + x.desc + '_' : ''}`).join('\n') +
    `\n\nSeries එකක් තෝරන්න — මේ message එකට *අංකය reply* කරන්න\n${foot('AniWorld.to · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const seasonsCard = (title, list) => `📺 *${cut(title, 60)}*\n\n` +
    list.map((x, i) => `*${i + 1}.* ${x.label}`).join('\n') +
    `\n\nSeason එකක් තෝරන්න — *අංකය reply* කරන්න\n${foot('AniWorld.to · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const epsCard = (title, list, note) => `📺 *${cut(title, 60)}* — Episodes\n\n` +
    list.slice(0, EP_CAP).map((x, i) => `*${i + 1}.* ${x.label}`).join('  ·  ') +
    (list.length > EP_CAP ? `\n\n_තව ${list.length - EP_CAP} පාරක් තියෙනවා — පළවෙනි ${EP_CAP} විතරයි පෙන්නුවේ_` : '') +
    `\n\nEpisode එකක් තෝරන්න — *අංකය reply* කරන්න${note ? '\n' + note : ''}\n${foot('AniWorld.to · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;

function linksCard(title, epUrl, streams, pageOnly) {
    let t = `📺 *${cut(title, 60)}*\n\n`;
    if (streams.length) {
        for (const s of streams) {
            t += `${LANGS[s.lang] || ''} — *${s.name}*${s.mp4 ? ' 📥 (direct MP4)' : ' ▶️ (HLS)'}\n${s.url}\n\n`;
        }
    }
    t += `🌐 *aniworld page* (තව hosters)\n${epUrl}\n`;
    if (pageOnly.length) t += `\n⚠️ Browser-only hosters (Cloudflare/JS — bot එකට අරන් එන්න බෑ):\n${pageOnly.map((x) => '• ' + x).join('\n')}\n`;
    const hint = streams.some((s) => s.mp4)
        ? 'MP4 link එක browser/1DM වලින් download කරන්න පුළුවන්'
        : 'HLS link එක *VLC / MX Player / 1DM* වලින් open කරන්න (stream + download දෙකම)';
    return t + `\n${foot(hint)}`;
}

const AW_USAGE = `🎌 *.aniworld <anime නම / aniworld link>*\n\nඋදා: \`.aniworld black clover\`\n     \`.aniworld https://aniworld.to/anime/stream/naruto/staffel-1/episode-1\`\n\n${foot('search → series → season → episode → stream link')}`;

// ───────── handle ─────────
async function handle(c, ctx) {
    const { send, jid, msg, rest, react } = ctx;
    if (c === '.aniworld' || c === '.aw') return handleAW(send, jid, msg, rest.join(' ').trim(), react);
    const nsfw = NEKO_TYPES[c];
    if (nsfw) {
        await react?.('🔞');
        const url = await nekobot(nsfw.t);
        if (!url) return send(jid, { text: `🔞 ${nsfw.label} source එක දැන් down — පොඩ්ඩකින් ආයෙ try කරන්න` }, { quoted: msg });
        const cap = `🔞 *${nsfw.label}*  ·  18+ only\n${foot('nekobot · ලොකු උනොත් ම බලන්න')}`;
        if (/\.(gif|mp4)$/i.test(url) || c === '.pgif') return send(jid, { video: { url }, gifPlayback: true, caption: cap }, { quoted: msg });
        return send(jid, { image: { url }, caption: cap }, { quoted: msg });
    }
    return false;
}

async function handleAW(send, jid, msg, arg, react) {
    const arg0 = (arg || '').trim();
    if (/^go\s+\d{1,3}$/i.test(arg0)) return goStep(send, jid, msg, parseInt(arg0.split(/\s+/)[1], 10));
    if (!arg0) return send(jid, { text: AW_USAGE }, { quoted: msg });

    gcSessions();
    const st = await status(send, jid, msg);

    // URL direct-jump: episode / season / series
    if (/https?:\/\/\S+aniworld\.to\/anime\/stream\/\S+/.test(arg0)) {
        const url = (arg0.match(/https?:\/\/\S+aniworld\.to\/anime\/stream\/[^?\s]+/) || [])[0];
        try {
            if (/episode-\d+/.test(url)) {
                const title = (await epTitle(url)) || 'AniWorld';
                await st.edit('🔎 Hosters හොයනවා...');
                const { streams, pageOnly } = await resolveEpisode(url);
                sessions.set(jid, { stage: 'ep', items: [], title, at: Date.now(), cardId: null });
                return done(st, send, jid, msg, linksCard(title, url, streams, pageOnly), react);
            }
            if (/staffel-\d+|film[/-]\d+/.test(url)) {
                const title = decodeURIComponent(url.split('/anime/stream/')[1].split('/')[0]).replace(/-/g, ' ');
                const eps = await episodesOf(url);
                if (!eps.length) throw new Error('no episodes');
                sessions.set(jid, { stage: 'ep', items: eps, title, at: Date.now(), cardId: null });
                return done(st, send, jid, msg, epsCard(title, eps), react);
            }
            return seriesStep(send, jid, msg, st, url, decodeURIComponent(url.split('/anime/stream/')[1] || '').replace(/-/g, ' '), react);
        } catch (e) { return fail(st, send, jid, msg, e, 'link එක open කරන්න බැරි වුණා'); }
    }

    // search
    const list = await searchAW(arg0);
    if (!list.length) return done(st, send, jid, msg, `❌ *"${cut(arg0, 40)}"* හොයාගන්න බැරි වුණා (AniWorld)\n\n${foot('English නමෙන් try කරන්න — උදා: .aniworld solo leveling')}`, react);
    sessions.set(jid, { stage: 'series', items: list.map((x) => ({ label: x.title, url: x.link })), title: arg0, at: Date.now(), cardId: null });
    return done(st, send, jid, msg, searchCard(arg0, list), react);
}

async function goStep(send, jid, msg, n) {
    gcSessions();
    const s = sessions.get(jid);
    if (!s || !s.items?.length) return send(jid, { text: AW_USAGE }, { quoted: msg });
    const pick = s.items[n - 1];
    if (!pick) return send(jid, { text: `❌ ${n} කියන අංකේ නෑ — list එකේ තියෙන අංකයක් එවන්න (1-${s.items.length})` }, { quoted: msg });
    const st = await status(send, jid, msg);
    try {
        if (s.stage === 'series') return await seriesStep(send, jid, msg, st, pick.url, pick.label, null, pick);
        if (s.stage === 'season') {
            const eps = await episodesOf(pick.url);
            if (!eps.length) throw new Error('no episodes');
            sessions.set(jid, { stage: 'ep', items: eps, title: s.title + ' ' + pick.label.replace('📺 ', '').replace('🎬 ', ''), at: Date.now(), cardId: null });
            return done(st, send, jid, msg, epsCard(s.title, eps), null);
        }
        if (s.stage === 'ep') {
            await st.edit('🔎 Hosters හොයනවා...');
            const { streams, pageOnly } = await resolveEpisode(pick.url);
            return done(st, send, jid, msg, linksCard(s.title + ' ' + (pick.label || ''), pick.url, streams, pageOnly), null);
        }
    } catch (e) { return fail(st, send, jid, msg, e); }
}

async function seriesStep(send, jid, msg, st, seriesUrl, fallbackTitle, react) {
    let title = fallbackTitle;
    try {
        const html = await getText(seriesUrl, { referer: AW + '/' });
        const h1 = /<h1[^>]*>\s*<span[^>]*>([^<]+)<\/span>/.exec(html);
        if (h1) title = stripEm(h1[1]);
    } catch { }
    const seasons = await seasonsOf(seriesUrl);
    if (!seasons.length) throw new Error('no seasons');
    sessions.set(jid, { stage: 'season', items: seasons, title: title || 'AniWorld', at: Date.now(), cardId: null });
    return done(st, send, jid, msg, seasonsCard(title, seasons), react);
}

const epTitle = async (url) => {
    try { const html = await getText(url, { referer: AW + '/' }); const m = /property="og:title"\s+content="([^"]+)"/.exec(html) || /<h1[^>]*>\s*<span[^>]*>([^<]+)/.exec(html); return m ? m[1].trim() : ''; } catch { return ''; }
};

// status bubble (self-edits, deletes) — moviedex/features pattern
async function status(send, jid, msg) {
    const s = await send(jid, { text: '🌐 AniWorld බලනවා...' }, { quoted: msg });
    return {
        key: s.key,
        edit: async (t) => { try { await send(jid, { text: t, edit: s.key }); } catch { } },
        del: async () => { try { await send(jid, { delete: s.key }); } catch { } },
    };
}
async function done(st, send, jid, msg, text, react) {
    const m = await send(jid, { text }, { quoted: msg });
    const s = sessions.get(jid);
    if (s && m?.key) { s.cardId = m.key.id; }   // quote-match target for the NEXT number reply
    await st.del().catch(() => { });
    try { if (react) react('✅'); } catch { }
    return m;
}
function fail(st, send, jid, msg, e, extra) {
    try { st.del(); } catch { }
    return send(jid, { text: `❌ AniWorld error — ${extra || cut(e.message, 90)}\n\n${foot('ආයෙ try කරන්න — site එක slow උනොත් මේක එනවා')}` }, { quoted: msg });
}

/** numeric quote bridge — bot.js chain: apkMenuBridge → ytMenuBridge → moviedex.bridgeReply → animehub.bridge */
function bridge(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s || !s.items?.length || !s.stage) return null;
    if (Date.now() - (s.at || 0) > TTL + 30 * 60e3) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d) || d < 1) return null;
    if (qid && s.cardId && String(qid) !== String(s.cardId)) return null;   // 🔒 reply-only: card එකට ම quote කරලා එන්න ඕන
    return `.aniworld go ${d}`;
}

module.exports = {
    handle, bridge,
    // test hooks
    _sessions: sessions, searchAW, seasonsOf, episodesOf, providersOf, providersFromHtml, resolveEpisode,
    resolveRedirect, vidmolyHls, doodMp4, nekobot, LANGS, TTL,
    _cards: { searchCard, seasonsCard, epsCard, linksCard },
    _reset: () => sessions.clear(),
};
