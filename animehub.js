/**
 * animehub.js — KAVIZ MD V1 v2.81.0
 * 🎌 .aniworld — AniWorld-Downloader (github.com/phoenixthrush/AniWorld-Downloader) → in-bot Node port
 *      search → series → season → episode → real provider extraction (Vidmoly HLS / Dood mp4 best-effort)
 *      NOTE: aniworld h4 labels LIE — every /redirect/<id> is resolved and routed by FINAL HOST.
 *      VOE/do7go = Cloudflare-walled, filemoon = JS shell → listed as browser-only, never faked.
 * 🔞 sulvii/hentai-api style NSFW → in-bot port on LIVE-verified free source nekobot.xyz
 *      (repo's hanime/rule34 endpoints are dead/CF-walled since 2025 — verified 2026-10-20)
 *      .hentai · .hneko · .hmidriff · .pgif — 18+ disclaimers on every result
 *      v2.79 FIX: .hentaiv episode menu — Dooplay ul.episodios single-quoted hrefs now parsed
 *      (title → episode menu → quality menu; single-episode still auto-jumps straight to quality)
 * 🔞 v2.80: .ep/.eporner — Eporner OFFICIAL public API v2 (github.com/eporner/API, keyless JSON)
 *      search → video → quality menu (page hash → site's own calcHash → /xhr/video/<id> → cdn mp4)
 *      ⚠️ CDN ETIMEDOUTs without Referer (verified 2026-10-20) — resolvers rule sends it.
 * 🔞 v2.81: .hentaimng/.hmanga — hitomi.la (github.com/h2owater425/node-hitomi → in-bot port)
 *      title search = galleriesindex B-tree (sha256 word keys) + nozomi tag lists → gallery info
 *      → cover card → pages sent as webp images. gg.js `b:` = ephemeral epoch dir → 10-min cache.
 * No new deps: global fetch (undici) only. Sessions = same quote-reply grammar as moviedex.
 */
const { foot, cut } = require('./style');

const AW = 'https://aniworld.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TTL = 10 * 60e3;                     // session / card TTL (moviedex parity)
const EP_CAP = 120;                        // max episode rows per card

const sessions = new Map();                // jid → { stage:'series'|'season'|'ep', items:[{label,url}], title, at, cardId }
const gcSessions = () => { const now = Date.now(); for (const [k, s] of sessions) if (now - (s.at || 0) > TTL + 30 * 60e3) sessions.delete(k); };
// 🆕 v2.90: download එක ඉවර උනාම session එක එක පියවරක් ආපසු — පරණ menu card එක ආයෙත් active (binge flow: EP1 → EP2 → EP3 ආයෙ .hentaiv ගහන්නේ නැතුව)
const restoreBack = (jid, mySess) => {
    if (sessions.get(jid) !== mySess) return false;   // 🛑 v2.89 identity guard: අතරේ අලුත් search එකක් ආවා නම් කිසිම දෙයක් නෑ
    const back = mySess.prev;
    if (back && back.items?.length) { back.at = Date.now(); sessions.set(jid, back); return true; }
    try { sessions.delete(jid); } catch { }   // prev නැත්නම් (link-flow / old session) → පරන විදිහම clean
    return false;
};

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

// ───────── 🔞 .hentaiv — WatchHentai (senpaiorbit/watchhentai-api in-bot port) ─────────
// repo targets watchhentai.net: search → watch page → JW player page → whJwSources[{file(ENCODED), label}]
// 2026-10-20 site reality: player files are OBFUSCATED — whDecodeMediaUrl (base64url → XOR(13+i%17) → reverse → base64)
// is embedded in the player page itself; ported verbatim + verified live. hstorage CDN needs Referer: watchhentai.net/
const WH = 'https://watchhentai.net';

function whDecodeMediaUrl(s) {
    s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const x = Buffer.from(s, 'base64').toString('latin1');          // atob(s)
    let r = '';
    for (let i = 0; i < x.length; i++) r += String.fromCharCode(x.charCodeAt(i) ^ ((13 + i % 17) & 255));
    return Buffer.from(r.split('').reverse().join(''), 'base64').toString('utf8');   // atob(reverse(r))
}

const stripEnt = (s) => String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** search watchhentai.net — /?s=<q> → <article class="item ..."> (site markup 2026-10: h3>a + data-src poster + year) */
function searchWHFromHtml(html) {
    const out = [];
    for (const m of html.matchAll(/<article[^>]*class="item[^"]*"[^>]*>([\s\S]*?)<\/article>/g)) {
        const b = m[1];
        const a = /<h3>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
        if (!a) continue;
        const url = a[1].startsWith('http') ? a[1] : WH + a[1];
        const poster = (/data-src="(https?:\/\/[^"]+\/uploads\/[^"]+)"/.exec(b) || [])[1] || '';
        const year = (/<span[^>]*>(\d{4})<\/span>/.exec(b) || [])[1] || '';
        const title = stripEnt(a[2].replace(/<[^>]+>/g, ' '));
        if (title && /\/(series|videos)\//.test(url)) out.push({ title, url, poster, year });
    }
    return out.slice(0, 10);
}
async function searchWH(q) {
    const html = await getText(WH + '/?s=' + encodeURIComponent(q), { referer: WH + '/' });
    return searchWHFromHtml(html);
}

/** series page → episode list (EP N sorted)
 * v2.79 FIX: watchhentai is Dooplay-style — episode cards live in <ul class='episodios'> with
 * SINGLE-quoted hrefs. Old double-quote-only regex caught just 1 stray link → false "single
 * episode" → auto-jumped past the episode menu (Kazoku 6-eps bug, user report 2026-10-20).
 * Now: quote-agnostic + scoped to ul.episodios (kills related-video noise on watch pages)
 * + /feed/ links excluded + season-aware labels (S2 EP1) when season-N in slug. */
function epsWHFromHtml(html) {
    let scope = html;
    const blocks = [...html.matchAll(/<ul[^>]*class=['"][^'"]*episodios[^'"]*['"][^>]*>([\s\S]*?)<\/ul>/g)];
    if (blocks.length) scope = blocks.map((b) => b[1]).join('\n');   // real episode list only
    const seen = new Set(); const out = [];
    for (const m of scope.matchAll(/<a\s[^>]*href=(['"])\s*((?:https?:\/\/[^'"]*watchhentai\.net)?\/videos\/[^'">]+?)\s*\1/g)) {
        const url = m[2].startsWith('http') ? m[2] : WH + m[2];
        if (/\/feed\/?([?#]|$)/.test(url)) continue;                 // watch pages link their own RSS
        if (seen.has(url)) continue;
        seen.add(url);
        const sn = /season-(\d+)/i.exec(url), n = /episode-(\d+)/i.exec(url);
        const num = n ? parseInt(n[1], 10) : out.length + 1;
        out.push({ n: (sn ? parseInt(sn[1], 10) * 1000 : 0) + num, url, label: (sn ? 'S' + parseInt(sn[1], 10) + ' ' : '') + 'EP ' + num });
    }
    out.sort((a, b) => a.n - b.n);
    return out;
}
async function epsWH(seriesUrl) {
    const html = await getText(seriesUrl, { referer: WH + '/' });
    return epsWHFromHtml(html);
}

/** watch page → player url → player page → decoded quality sources [{label, src, bytes}] (best first) */
async function qualitiesWH(videoUrl) {
    const html = await getText(videoUrl, { referer: WH + '/' });
    const playerUrl = (/data-primary-player-url="([^"]+)"/.exec(html) || [])[1]
        || (/itemprop="contentUrl"\s+content="([^"]+)"/.exec(html) || [])[1] || '';
    let sources = [];
    let title = stripEnt((/property="og:title"\s+content="([^"]+)"/.exec(html) || [])[1] || '');
    if (playerUrl && /\/player\//.test(playerUrl)) {
        try {
            const p = await getText(playerUrl, { referer: videoUrl });
            const arr = /var\s+whJwSources\s*=\s*(\[[\s\S]*?\]);/.exec(p);
            if (arr) {
                for (const s of JSON.parse(arr[1])) {
                    try {
                        const src = whDecodeMediaUrl(s.file);
                        if (/^https?:\/\//.test(src)) sources.push({ label: s.label || (src.match(/_(\d{3,4}p)\./) || [])[1] || 'default', src });   // v2.79: site dropped labels on newer uploads — URL suffix carries the quality
                    } catch { }
                }
            }
            if (!sources.length) {   // older layout: plain jw.file / ld+json
                const cf = /"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/.exec(p);
                if (cf) sources.push({ label: (cf[1].match(/_(\d+p)\./) || [])[1] || 'default', src: cf[1].replace(/\\\//g, '/') });
            }
        } catch { /* fall through */ }
    }
    if (!sources.length && playerUrl) {   // direct ?source= style player URLs
        try { const s = new URL(playerUrl).searchParams.get('source'); if (s) sources.push({ label: 'default', src: s }); } catch { }
    }
    if (!sources.length) {   // last resort: ld+json on the watch page itself
        const cf = /"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/.exec(html);
        if (cf) sources.push({ label: 'default', src: cf[1].replace(/\\\//g, '/') });
    }
    if (!sources.length) throw new Error('video sources හොයාගන්න බැරි වුණා');
    // sizes (HEAD, parallel, 6s cap) — hstorage needs Referer
    await Promise.allSettled(sources.map(async (s) => {
        try { const r = await get(s.src, { referer: WH + '/', method: 'HEAD', timeout: 6000 }); s.bytes = parseInt(r.headers.get('content-length') || '0', 10) || 0; } catch { s.bytes = 0; }
    }));
    sources.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    return { title, sources };
}

const humanMB = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : b ? Math.max(1, Math.round(b / 1024)) + ' KB' : '? MB';
const hvSearchCard = (q, list) => `🔞 *WatchHentai — "${cut(q, 40)}"*\n\n` +
    list.map((x, i) => `*${i + 1}.* ${x.title}${x.year ? '  (' + x.year + ')' : ''}`).join('\n') +
    `\n\nSeries එකක් තෝරන්න — මේ message එකට *අංකය reply* කරන්න\n${foot('18+ only · watchhentai.net · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const hvEpsCard = (title, list) => `🔞 *${cut(title, 60)}* — Episodes (${list.length})\n\n` +
    list.slice(0, EP_CAP).map((x, i) => `*${i + 1}.* ${x.label}`).join('  ·  ') +
    (list.length > EP_CAP ? `\n\n_තව ${list.length - EP_CAP}ක් තියෙනවා — පළවෙනි ${EP_CAP} විතරයි පෙන්නුවේ_` : '') +
    `\n\nEpisode එකක් තෝරන්න — *අංකය reply* කරන්න → ඊට පස්සේ quality menu\n${foot('18+ only · watchhentai.net')}`;
const hvQCard = (title, list) => `🔞 *${cut(title, 60)}*\n\nquality එක තෝරන්න — *අංකය reply* කරන්න:\n\n` +
    list.map((x, i) => `*${i + 1}.* ${x.label}  (${humanMB(x.bytes)})`).join('\n') +
    `\n\n${foot('තෝරාගත්තම file එක WhatsApp එකට එවනවා · 18+ only')}`;
const HV_USAGE = `🔞 *.hentaiv <name / title>* — watchhentai.net video + quality menu\n\nඋදා: \`.hentaiv tsuki kagerou\`\n\n${foot('search → series → episode → quality → file')}`;

async function handleHV(send, jid, msg, arg, react, download) {
    const arg0 = (arg || '').trim();
    if (/^go\s+\d{1,3}$/i.test(arg0)) return hvGo(send, jid, msg, parseInt(arg0.split(/\s+/)[1], 10), download);
    if (!arg0) return send(jid, { text: HV_USAGE }, { quoted: msg });

    gcSessions();
    const st = await status(send, jid, msg);
    try {
        const list = searchWHFromHtml(await getText(WH + '/?s=' + encodeURIComponent(arg0), { referer: WH + '/' }));
        if (!list.length) return done(st, send, jid, msg, `❌ *"${cut(arg0, 40)}"* හොයාගන්න බැරි වුණා (watchhentai.net)\n\n${foot('අඩු වචන වලින් try කරන්න — උදා: .hentaiv tsuki')}`, react);
        sessions.set(jid, { cmd: 'hv', stage: 'series', items: list.map((x) => ({ label: x.title, url: x.url, title: x.title })), title: arg0, at: Date.now(), cardId: null });
        return done(st, send, jid, msg, hvSearchCard(arg0, list), react);
    } catch (e) { return fail(st, send, jid, msg, e, 'watchhentai.net slow වෙලා'); }
}

async function hvGo(send, jid, msg, n, download) {
    gcSessions();
    const s = sessions.get(jid);
    if (s && s.cmd === 'ep') return epGo(send, jid, msg, n, download);   // v2.80: manual .hentaiv go on eporner session → route right
    if (s && s.cmd === 'hm') return hmGo(send, jid, msg, n, download);   // v2.81: …on hitomi session
    if (s && s.cmd === 'jv') return jvGo(send, jid, msg, n, download);   // v2.83: …on javbus session
    if (s && s.cmd === 'aw') return goStep(send, jid, msg, n);
    if (!s || s.cmd !== 'hv' || !s.items?.length) return send(jid, { text: HV_USAGE }, { quoted: msg });
    const pick = s.items[n - 1];
    if (!pick) return send(jid, { text: `❌ ${n} කියන අංකේ නෑ — list එකේ අංකයක් එවන්න (1-${s.items.length})` }, { quoted: msg });
    const st = await status(send, jid, msg);
    try {
        if (s.stage === 'series') {
            const eps = epsWHFromHtml(await getText(pick.url, { referer: WH + '/' }));
            const title = pick.title || s.title;
            if (eps.length > 1) {   // v2.79: real episode menu (was silently skipped — quote bug)
                sessions.set(jid, { cmd: 'hv', stage: 'ep', items: eps.slice(0, EP_CAP), title, at: Date.now(), cardId: null });
                return done(st, send, jid, msg, hvEpsCard(title, eps), null);
            }
            // 1 episode (or none) → pick IS the video → straight to quality menu
            await st.edit(eps.length === 1 ? '🔎 Qualities හොයනවා...' : '🔎 Episode list එකක් නෑ — Qualities හොයනවා...');
            const { title: t, sources } = await qualitiesWH(eps.length === 1 ? eps[0].url : pick.url);
            sessions.set(jid, { cmd: 'hv', stage: 'quality', items: sources, title: t || title, at: Date.now(), cardId: null, prev: s });   // 🆕 v2.90 prev — download ඉවර උනාම series card එකට ආපසු
            return done(st, send, jid, msg, hvQCard(t || title, sources), null);
        }
        if (s.stage === 'ep') {
            await st.edit('🔎 Qualities හොයනවා...');
            const { title, sources } = await qualitiesWH(pick.url);
            sessions.set(jid, { cmd: 'hv', stage: 'quality', items: sources, title, at: Date.now(), cardId: null, prev: s });   // 🆕 v2.90 prev — download ඉවර උනාම EPISODES card එකට ආපසු
            return done(st, send, jid, msg, hvQCard(title, sources), null);
        }
        if (s.stage === 'quality') {
            const mySess = s;   // 🛑 v2.89 identity guard: download එක අතරේ අලුත් search එකක් ආවොත් session එක overwrite වෙනවා — පරණ download එකේ cleanup එකෙන් අලුත් session එක මැකෙන්න පුළුවන් තිබුණා
            await st.edit(`⏳ ${pick.label} download වෙනවා... file එක ලොකු නම් වෙලා යනවා`);
            const cap = `🔞 *${cut(s.title, 60)}* — ${pick.label}`;
            if (typeof download === 'function') await download(pick.src, '🔞 WatchHentai', cap);
            else await send(jid, { text: `🔞 *${cut(s.title, 60)}* — ${pick.label}\n${pick.src}\n\n${foot('18+ · hstorage CDN — 1DM/browser වලින් download කරන්න')}` }, { quoted: msg });
            // 🆕 v2.90: session delete ❌ → එක පියවරක් ආපසු restore ✅ — EPISODES/series card එක ජීවමානයි (ඊළඟ EP එකට ආයෙ command ඕන නෑ)
            if (restoreBack(jid, mySess)) await st.edit('✅ ලෑස්ති — අර menu card එකටම ඊළඟ අංකය reply කරන්න (ආයෙ command එකක් ඕන නෑ)');
            return;
        }
    } catch (e) { return fail(st, send, jid, msg, e); }
}

// ───────── 🔞 .ep — Eporner (official public API v2 · github.com/eporner/API) ─────────
// search API (JSON, keyless) → video page → 32-hex hash → site's own calcHash (4× 8-hex chunks → base36)
// → /xhr/video/<id>?hash=… → sources.mp4 {label:{src}} → quality menu (HEAD sizes) → direct cdn mp4.
// ⚠️ CDN (vid-*-cdn.eporner.com) ETIMEDOUTs requests WITHOUT Referer (live-verified 2026-10-20 —
// that, not datacenter-IP blocking, was the old v2.19 'residential proxy needed' failure).
// resolvers.js *.eporner.com rule already sends Referer 'https://www.eporner.com/' → downloader.
const EP_API = 'https://www.eporner.com/api/v2/video';
const EP_REF = 'https://www.eporner.com/';

/** site's own hash scheme: 32-hex → 4× 8-hex chunks → each parsed as hex, re-encoded base36, concatenated */
function epCalcHash(s) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let out = '';
    for (let lb = 0; lb < 32; lb += 8) {
        let num = parseInt(s.slice(lb, lb + 8), 16), res = num === 0 ? '0' : '';
        while (num > 0) { res = chars[num % 36] + res; num = Math.floor(num / 36); }
        out += res;
    }
    return out;
}
const epVideoId = (pageUrl) => (/eporner\.com\/(?:video-|hd-porn\/|embed\/)([A-Za-z0-9]+)/.exec(pageUrl || '') || [])[1] || '';

const epHuman = (n) => !n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

/** API v2 search → [{id,title,url,len,views}] (keyless; order top-weekly) */
async function searchEP(q) {
    const r = await get(`${EP_API}/search/?query=${encodeURIComponent(q)}&per_page=10&thumbsize=big&order=top-weekly&format=json`, { referer: EP_REF });
    if (!r.ok) throw new Error('Eporner API HTTP ' + r.status);
    const j = await r.json();
    return (j.videos || []).slice(0, 10).map((v) => ({ id: v.id, title: String(v.title || '').trim(), url: v.url, len: v.length_min || '', views: v.views || 0 })).filter((x) => x.title && x.url);
}

/** video page → hash → xhr → [{label, src, bytes}] (best first). Labels = xhr keys ("1080p HD"…"240p") */
async function qualitiesEP(pageUrl) {
    const html = await getText(pageUrl, { referer: EP_REF });
    const id = epVideoId(pageUrl);
    const raw = (/hash\s*[:=]\s*['"]([a-f0-9]{32})['"]/i.exec(html) || [])[1];
    if (!id || !raw) throw new Error('video hash හොයාගන්න බැරි වුණා');
    const title = stripEnt((/property="og:title"\s+content="([^"]+)"/.exec(html) || [])[1] || '');
    const xr = await get(`https://www.eporner.com/xhr/video/${id}?hash=${epCalcHash(raw)}&device=generic&domain=www.eporner.com&fallback=false`, { referer: pageUrl });
    const xj = await xr.json();
    if (xj.available === false) throw new Error(xj.message || 'video එක available නෑ');
    const mp4 = (xj.sources && xj.sources.mp4) || {};
    const sources = [];
    for (const [label, info] of Object.entries(mp4)) if (info && info.src && /^https?:\/\//.test(info.src)) sources.push({ label: String(label), src: info.src });
    if (!sources.length) throw new Error('video sources හොයාගන්න බැරි වුණා');
    // sizes (HEAD, parallel, 6s cap) — CDN drops no-referer probes
    await Promise.allSettled(sources.map(async (s) => {
        try { const r = await get(s.src, { referer: EP_REF, method: 'HEAD', timeout: 6000 }); s.bytes = parseInt(r.headers.get('content-length') || '0', 10) || 0; } catch { s.bytes = 0; }
    }));
    sources.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    return { title, sources };
}

const epSearchCard = (q, list) => `🔞 *Eporner — "${cut(q, 40)}"*\n\n` +
    list.map((x, i) => `*${i + 1}.* ${x.title}\n    _${x.len || '?'} · ${epHuman(x.views)} views_`).join('\n') +
    `\n\nVideo එකක් තෝරන්න — මේ message එකට *අංකය reply* කරන්න\n${foot('18+ only · eporner.com · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const epQCard = (title, list) => `🔞 *${cut(title, 60)}*\n\nquality එක තෝරන්න — *අංකය reply* කරන්න:\n\n` +
    list.map((x, i) => `*${i + 1}.* ${x.label}  (${humanMB(x.bytes)})`).join('\n') +
    `\n\n${foot('තෝරාගත්තම file එක WhatsApp එකට එවනවා · 18+ only')}`;
const EP_USAGE = `🔞 *.ep <query>* — eporner.com video + quality menu\n\nඋදා: \`.ep sakamoto days\`\n\n${foot('search → video → quality → file · alias .eporner · 18+ only')}`;

async function handleEP(send, jid, msg, arg, react, download) {
    const arg0 = (arg || '').trim();
    if (/^go\s+\d{1,3}$/i.test(arg0)) return epGo(send, jid, msg, parseInt(arg0.split(/\s+/)[1], 10), download);
    if (!arg0) return send(jid, { text: EP_USAGE }, { quoted: msg });

    gcSessions();
    const st = await status(send, jid, msg, 'Eporner');
    try {
        const list = await searchEP(arg0);
        if (!list.length) return done(st, send, jid, msg, `❌ *"${cut(arg0, 40)}"* හොයාගන්න බැරි වුණා (eporner.com)\n\n${foot('අඩු වචන වලින් try කරන්න — උදා: .ep hentai parody')}`, react);
        sessions.set(jid, { cmd: 'ep', stage: 'search', items: list.map((x) => ({ label: x.title, url: x.url, title: x.title })), title: arg0, at: Date.now(), cardId: null });
        return done(st, send, jid, msg, epSearchCard(arg0, list), react);
    } catch (e) { return fail(st, send, jid, msg, e, 'eporner API slow වෙලා', 'Eporner'); }
}

async function epGo(send, jid, msg, n, download) {
    gcSessions();
    const s = sessions.get(jid);
    if (s && s.cmd === 'hv') return hvGo(send, jid, msg, n, download);   // manual .ep go on hv session → route right
    if (s && s.cmd === 'hm') return hmGo(send, jid, msg, n, download);   // v2.81: …on hitomi session
    if (s && s.cmd === 'jv') return jvGo(send, jid, msg, n, download);   // v2.83: …on javbus session
    if (s && s.cmd === 'aw') return goStep(send, jid, msg, n);
    if (!s || s.cmd !== 'ep' || !s.items?.length) return send(jid, { text: EP_USAGE }, { quoted: msg });
    const pick = s.items[n - 1];
    if (!pick) return send(jid, { text: `❌ ${n} කියන අංකේ නෑ — list එකේ අංකයක් එවන්න (1-${s.items.length})` }, { quoted: msg });
    const st = await status(send, jid, msg, 'Eporner');
    try {
        if (s.stage === 'search') {
            await st.edit('🔎 Qualities හොයනවා...');
            const { title, sources } = await qualitiesEP(pick.url);
            sessions.set(jid, { cmd: 'ep', stage: 'quality', items: sources, title: title || pick.title || s.title, at: Date.now(), cardId: null, prev: s });   // 🆕 v2.90 prev — download ඉවර උනාම search card එකට ආපසු
            return done(st, send, jid, msg, epQCard(title || pick.title || s.title, sources), null);
        }
        if (s.stage === 'quality') {
            const mySess = s;   // 🛑 v2.89 identity guard (same race as .hentaiv quality pick)
            await st.edit(`⏳ ${pick.label} download වෙනවා... file එක ලොකු නම් වෙලා යනවා`);
            const cap = `🔞 *${cut(s.title, 60)}* — ${pick.label}`;
            if (typeof download === 'function') await download(pick.src, '🔞 Eporner', cap);
            else await send(jid, { text: `🔞 *${cut(s.title, 60)}* — ${pick.label}\n${pick.src}\n\n${foot('18+ · eporner CDN — browser/1DM වලින් download කරන්න')}` }, { quoted: msg });
            // 🆕 v2.90: search card එක ආයෙත් active — ඊළඟ video එකට ආයෙ command ඕන නෑ
            if (restoreBack(jid, mySess)) await st.edit('✅ ලෑස්ති — අර search card එකටම ඊළඟ අංකය reply කරන්න (ආයෙ command එකක් ඕන නෑ)');
            return;
        }
    } catch (e) { return fail(st, send, jid, msg, e, null, 'Eporner'); }
}

// ───────── 🔞 .hentaimng/.hmanga — hitomi.la (h2owater425/node-hitomi → in-bot port) ─────────
// title search = galleriesindex B-tree: sha256(word)[0..4) keys, 464-byte nodes (keys → data
// [addr,len] → 17 subnode addrs), id blocks in galleries.{ver}.data (big-endian int32).
// nozomi files = binary id lists, byte-range reads. gg.js gives the EPHEMERAL image base dir
// (`b: '1792465201/'` — rotates!) + subdomain bit → image URLs live for hours, not forever
// → gg.js cached 10 min + 1 force-refresh retry on image 403/404. Images are WEBP-only
// (hitomi dropped jpeg serving) — sent as WhatsApp image messages (webp renders fine).
// tagindex.hitomi.la = CF-walled from datacenter IPs (live 2026-10-20) → tag suggest skipped.
const HM_RES = 'ltn.gold-usergeneratedcontent.net';
const HM_REF = 'https://hitomi.la';
const HM_URL = 'https://hitomi.la/galleries/';
const PG_CAP = 50;                                        // max pages per gallery send (anti-flood)
const HM_DELAY = parseInt(process.env.ARENA_HM_DELAY || '1200', 10);   // pacing between page sends (antiban)
const crypto = require('crypto');

const hmReq = async (path, { range, timeout = 25000 } = {}) => {
    const headers = { referer: HM_REF, 'user-agent': UA, accept: '*/*' };
    if (range) headers.range = 'bytes=' + range;
    const r = await fetch('https://' + HM_RES + path, { headers, signal: AbortSignal.timeout(timeout) });
    if (r.status !== 200 && r.status !== 206) throw new Error('HTTP ' + r.status + ' @ ' + path.slice(0, 60));
    return Buffer.from(await r.arrayBuffer());
};

/** gg.js → { codes:Set, o, b } — b: is the rotating epoch base dir (verified live 2026-10-20) */
let hmCtx = null;
async function hmImageCtx(force) {
    if (!force && hmCtx && Date.now() - hmCtx.at < 10 * 60e3) return hmCtx;
    const s = (await hmReq('/gg.js')).toString();
    const codes = new Set();
    let ci = 0;
    while ((ci = s.indexOf('case ', ci) + 5) !== 4) {
        const ni = s.indexOf(':', ci);
        if (ni === -1) break;
        const code = +s.slice(ci, ni);
        if (Number.isInteger(code)) codes.add(code);
    }
    const oi = s.indexOf('var o = ');
    const o = oi === -1 ? 0 : +s.slice(oi + 8, s.indexOf(';', oi));
    const bi = s.lastIndexOf("b: '") + 4;
    const b = bi === 3 ? '' : s.slice(bi, s.indexOf("'", bi));
    if (!codes.size || !b) throw new Error('gg.js parse fail');
    hmCtx = { codes, o: o || 0, b, at: Date.now() };
    return hmCtx;
}

/** full-size webp URL (real_full_path_from_hash + gg.js context — node-hitomi Image.resolveUrl port) */
async function hmImageUrl(hash) {
    const c = await hmImageCtx(false);
    const code = parseInt(hash.slice(-1) + hash.slice(-3, -1), 16);
    const sub = 'w' + (c.codes.has(code) === !c.o ? '2' : '1');
    return `https://${sub}.gold-usergeneratedcontent.net/${c.b}${code}/${hash}.webp`;
}

async function hmImageBuf(hash) {
    for (let i = 0; i < 2; i++) {                 // retry 2: epoch dir may have rotated → force re-fetch gg.js
        if (i) { hmCtx = null; }
        try {
            const url = await hmImageUrl(hash);
            const r = await fetch(url, { headers: { referer: HM_REF, 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
            if (!r.ok) throw new Error('image HTTP ' + r.status);
            return Buffer.from(await r.arrayBuffer());
        } catch (e) { if (i) throw e; }
    }
}

/** galleries/{id}.js (var galleryinfo = JSON) → normalized gallery */
async function hmGallery(id) {
    const s = (await hmReq('/galleries/' + id + '.js')).toString();
    const g = JSON.parse(s.slice(s.indexOf('{')));
    return {
        id: +g.id, title: g.title || '', jp: g.japanese_title || '', type: g.type || '',
        lang: g.language || '',
        artists: (g.artists || []).map((a) => a.artist), groups: (g.groups || []).map((a) => a.group),
        series: (g.parodys || []).map((a) => a.parody), chars: (g.characters || []).map((a) => a.character),
        tags: (g.tags || []).map((t) => (t.female ? '♀ ' : t.male ? '♂ ' : '') + t.tag),
        pages: (g.files || []).map((f) => ({ hash: f.hash, w: f.width, h: f.height })),
        blocked: !!g.blocked, date: (g.date || '').slice(0, 10),
    };
}

const hmCmp = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return a.length - b.length; };

/** 464-byte B-tree node → { ks:[Uint8Array], ds:[[addr,len]], ss:[17 addr] } (decode_node port) */
function hmNode(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const kc = dv.getInt32(0); let o = 4; const ks = [], ds = [], ss = [];
    for (let i = 0; i < kc; i++) { const sz = dv.getInt32(o); o += 4; ks.push(new Uint8Array(buf.buffer, buf.byteOffset + o, sz)); o += sz; }
    const dc = dv.getInt32(o); o += 4;
    for (let i = 0; i < dc; i++) { ds.push([dv.getBigUint64(o), dv.getInt32(o + 8)]); o += 12; }
    for (let i = 0; i < 17; i++) { ss.push(dv.getBigUint64(o)); o += 8; }
    return { ks, ds, ss };
}

const HM_NODE_RE = /\bgalleries\.(\d+)\.index/;   // test/hooks: index node url version capture

/** one word → int32 ids from galleries.{ver}.data (binarySearch port: sha256(word)[0..4) keys) */
async function hmTermIds(version, word, root) {
    const key = crypto.createHash('sha256').update(word).digest().subarray(0, 4);
    const hit = await (async function walk(node) {
        let i = 0, c = -1;
        for (; i < node.ks.length && (c = hmCmp(key, node.ks[i])) === 1; i++);
        if (c === 0) return node.ds[i];
        const sub = node.ss[i];
        if (!sub || !node.ss.some(Boolean)) return null;
        return walk(hmNode(await hmReq(`/galleriesindex/galleries.${version}.index`, { range: sub + '-' + (sub + 463n) })));
    })(root);
    if (!hit || hit[1] < 8) return [];   // len = 4-byte count prefix + ≥1 int32 id → <8 = empty
    const buf = await hmReq(`/galleriesindex/galleries.${version}.data`, { range: (hit[0] + 4n) + '-' + (hit[0] + BigInt(hit[1]) - 1n) });
    const ids = [];
    for (let i = 0; i + 4 <= buf.byteLength; i += 4) ids.push(buf.readInt32BE(i));
    return ids;
}

const hmNozomiIds = async (path) => {
    const buf = await hmReq(path);
    const ids = [];
    for (let i = 0; i + 4 <= buf.byteLength; i += 4) ids.push(buf.readInt32BE(i));
    return ids;
};

/** query → ordered gallery ids (newest first). plain words → B-tree AND; type:name → nozomi AND;
 *  bare → /n/index-all.nozomi first 30 (latest) */
async function hmSearch(q) {
    const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const plain = [], tags = [];
    for (const w of words) {
        const m = /^(artist|group|series|parody|character|male|female|tag):(.+)$/.exec(w);
        if (m && m[2]) tags.push({ type: m[1] === 'parody' ? 'series' : m[1], name: m[2].replace(/_/g, ' ') });
        else plain.push(w);
    }
    let order = null;
    if (plain.length) {
        const ver = (await hmReq('/galleriesindex/version')).toString().trim();
        const root = hmNode(await hmReq(`/galleriesindex/galleries.${ver}.index`, { range: '0-463' }));
        const sets = [];
        for (const w of plain) sets.push(new Set(await hmTermIds(ver, w, root)));
        order = [...sets[0]];
        for (let i = 1; i < sets.length; i++) order = order.filter((id) => sets[i].has(id));
    }
    if (tags.length) {
        const tsets = [];
        for (const t of tags) {
            const area = (t.type === 'male' || t.type === 'female') ? 'tag/' + t.type + ':' : t.type + '/';
            tsets.push(new Set(await hmNozomiIds(`/n/${area}${encodeURIComponent(t.name)}-all.nozomi`)));
        }
        if (order) order = order.filter((id) => tsets.every((s) => s.has(id)));
        else { order = [...tsets[0]]; for (let i = 1; i < tsets.length; i++) order = order.filter((id) => tsets[i].has(id)); }
    }
    if (!order) order = await hmNozomiIds('/n/index-all.nozomi').then((a) => a.slice(0, 30));
    return order.slice(0, 30);
}

/** ids → ≤10 non-blocked gallery metas (parallel info fetch) */
async function hmList(q) {
    const ids = await hmSearch(q);
    const metas = await Promise.allSettled(ids.map((id) => hmGallery(id)));
    return metas.filter((m) => m.status === 'fulfilled' && m.value && !m.value.blocked).map((m) => m.value).slice(0, 10);
}

const hmMeta = (g) => [g.type, g.lang, g.pages.length + 'p'].filter(Boolean).join(' · ');
const hmSearchCard = (q, list) => `🔞 *Hitomi — "${cut(q || 'latest', 40)}"*\n\n` +
    list.map((g, i) => `*${i + 1}.* ${cut(g.title || g.jp, 70)}\n    _${hmMeta(g)}${g.artists.length ? ' · ' + g.artists.slice(0, 2).join(', ') : ''}_`).join('\n') +
    `\n\nManga එකක් තෝරන්න — මේ message එකට *අංකය reply* කරන්න\n${foot('18+ only · hitomi.la · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const hmGalleryCard = (g) => `🔞 *${cut(g.title || g.jp, 60)}*\n` +
    (g.jp && g.jp !== g.title ? `_${cut(g.jp, 60)}_\n` : '') +
    (g.artists.length ? `👩 ${g.artists.join(', ')}\n` : '') +
    `📚 ${g.type || '?'} · 🌐 ${g.lang || '?'} · 📄 ${g.pages.length} pages\n` +
    (g.series.length ? `📺 ${g.series.join(', ')}\n` : '') +
    (g.tags.length ? `🏷 ${g.tags.slice(0, 8).join(', ')}\n` : '') +
    (g.date ? `📅 ${g.date}\n` : '') +
    `\n*1* — pages ටික එවන්න (උපරිම ${PG_CAP})\n*2* — link එක විතරයි\n\n${foot('18+ only · hitomi.la · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const HM_USAGE = `🔞 *.hentaimng <name / tag>* — hitomi.la manga pages\n\nඋදා: \`.hentaimng naruto\`\n     \`.hmanga artist:shindol\` · \`.hmanga\` (අලුත්ම 10)\n\n${foot('search → cover → pages → images · alias .hmanga · 18+ only')}`;

async function handleHM(send, jid, msg, arg, react, download) {
    const arg0 = (arg || '').trim();
    if (/^go\s+\d{1,3}$/i.test(arg0)) return hmGo(send, jid, msg, parseInt(arg0.split(/\s+/)[1], 10), download);
    gcSessions();
    const st = await status(send, jid, msg, 'Hitomi');
    try {
        const list = await hmList(arg0);
        if (!list.length) return done(st, send, jid, msg, `❌ *"${cut(arg0 || 'latest', 40)}"* හොයාගන්න බැරි වුණා (hitomi.la)\n\n${foot('අඩු වචන වලින් try කරන්න — උදා: .hmanga naruto')}`, react);
        sessions.set(jid, { cmd: 'hm', stage: 'search', items: list.map((g) => ({ label: g.title || g.jp, id: g.id })), title: arg0, at: Date.now(), cardId: null });
        return done(st, send, jid, msg, hmSearchCard(arg0, list), react);
    } catch (e) { return fail(st, send, jid, msg, e, 'hitomi.la slow වෙලා', 'Hitomi'); }
}

async function hmGo(send, jid, msg, n, download) {
    gcSessions();
    const s = sessions.get(jid);
    if (s && s.cmd === 'hv') return hvGo(send, jid, msg, n, download);   // manual .hmanga go on hv session → route right
    if (s && s.cmd === 'ep') return epGo(send, jid, msg, n, download);
    if (s && s.cmd === 'jv') return jvGo(send, jid, msg, n, download);   // v2.83: …on javbus session
    if (s && s.cmd === 'aw') return goStep(send, jid, msg, n);
    if (!s || s.cmd !== 'hm' || !s.items?.length) return send(jid, { text: HM_USAGE }, { quoted: msg });
    const pick = s.items[n - 1];
    if (!pick) return send(jid, { text: `❌ ${n} කියන අංකේ නෑ — list එකේ අංකයක් එවන්න (1-${s.items.length})` }, { quoted: msg });
    const st = await status(send, jid, msg, 'Hitomi');
    try {
        if (s.stage === 'search') {
            await st.edit('🔎 Gallery එක බලනවා...');
            const g = await hmGallery(pick.id);
            if (g.blocked) throw new Error('මේ gallery එක hitomi විසින් block කරලා');
            if (!g.pages.length) throw new Error('pages නෑ');
            const cap = hmGalleryCard(g);
            let m = null;
            try { m = await send(jid, { image: await hmImageBuf(g.pages[0].hash), caption: cap }, { quoted: msg }); } catch { m = await send(jid, { text: cap }, { quoted: msg }); }
            sessions.set(jid, { cmd: 'hm', stage: 'gallery', items: [{ label: 'pages' }, { label: 'link' }], title: g.title || g.jp || s.title, gallery: g, at: Date.now(), cardId: (m && m.key && m.key.id) || null });
            await st.del().catch(() => { });
            try { if (react) react('✅'); } catch { }
            return m;
        }
        if (s.stage === 'gallery') {
            const g = s.gallery;
            if (n === 2) {
                try { sessions.delete(jid); } catch { }
                await st.del().catch(() => { });
                return send(jid, { text: `🔞 *${cut(g.title || g.jp, 60)}*\n🌐 ${HM_URL}${g.id}.html\n\n${foot('browser එකෙන් open කරන්න · 18+ only')}` }, { quoted: msg });
            }
            const total = g.pages.length;
            const pages = g.pages.slice(0, PG_CAP);
            await st.edit(`⏳ Pages ${pages.length} එවනවා... ටිකක් වෙලා යනවා`);
            let sentN = 0;
            for (let i = 0; i < pages.length; i++) {
                try {
                    const buf = await hmImageBuf(pages[i].hash);
                    const pcap = i === 0 ? `📖 ${cut(g.title || g.jp, 60)} — 1/${total}` : ((i + 1) % 10 === 0 ? `📖 ${i + 1}/${total}` : undefined);
                    await send(jid, { image: buf, ...(pcap ? { caption: pcap } : {}) }, i === 0 ? { quoted: msg } : undefined);
                    sentN++;
                } catch { /* skip broken page */ }
                await new Promise((r) => setTimeout(r, HM_DELAY));
            }
            if (sessions.get(jid) === s) { try { sessions.delete(jid); } catch { } }   // 🛑 v2.89 identity guard: pages loop අතරේ අලුත් search එකක් ආවොත් ඒක මැකෙන්නේ නෑ
            await st.del().catch(() => { });
            return send(jid, { text: `✅ *${cut(g.title || g.jp, 50)}* — pages ${sentN}/${total} එවුණා${total > PG_CAP ? `\n_⚠️ gallery එක ${total} pages — පළවෙනි ${PG_CAP} විතරයි. ඉතුරු ටික: ${HM_URL}${g.id}.html_` : ''}\n\n${foot('18+ only · hitomi.la')}` }, { quoted: msg });
        }
    } catch (e) { return fail(st, send, jid, msg, e, null, 'Hitomi'); }
}

// ───────── 🔞 .javdn — JavBus search → detail → magnets (javbus.com, v2.83; in-bot port of ovnrain/javbus-api as used by jtl1207/JavBusDownloader) ─────────
const JV_URL = 'https://www.javbus.com';
const JV_MAG_CAP = 8;                                     // magnets shown per card
const jvH = () => ({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7', Cookie: 'existmag=mag' });
const jvStrip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const jvBytes = (sz) => { const m = /([\d.]+)\s*(TB|GB|MB|KB)/i.exec(sz || ''); return m ? Math.round(parseFloat(m[1]) * { TB: 1099511627776, GB: 1073741824, MB: 1048576, KB: 1024 }[m[2].toUpperCase()]) : null; };

async function jvSearch(q) {
    const r = await fetch(JV_URL + '/search/' + encodeURIComponent(q) + '/1&type=1', { headers: jvH(), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('javbus HTTP ' + r.status);
    const html = await r.text();
    const out = [];
    for (const it of html.split('<div class="item">').slice(1)) {
        const id = /<a class="movie-box" href="https:\/\/www\.javbus\.com\/([^"?\/]+)"/.exec(it)?.[1];
        if (!id) continue;
        const title = /<div class="photo-frame">\s*<img src="[^"]*"\s+title="([^"]*)"/.exec(it)?.[1] || '';
        const dates = [...it.matchAll(/<date>\s*([^<]+?)\s*<\/date>/g)].map((x) => x[1]);
        out.push({ id, title: title || id, date: dates[1] || null, hd: /高清/.test(it), sub: /字幕/.test(it) });
        if (out.length >= 10) break;
    }
    return out;
}

async function jvDetail(id) {
    const r = await fetch(JV_URL + '/' + encodeURIComponent(id), { headers: jvH(), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('javbus HTTP ' + r.status);
    const html = await r.text();
    const title = jvStrip(/<h3>([\s\S]*?)<\/h3>/.exec(html)?.[1]) || id;
    const imgRaw = /<a class="bigImage" href="([^"]+)"/.exec(html)?.[1] || null;
    const img = imgRaw ? (/^https?:/.test(imgRaw) ? imgRaw : JV_URL + imgRaw) : null;
    const seg = (label) => { const m = new RegExp('<span class="header">' + label + '<\\/span>([\\s\\S]*?)<\\/p>').exec(html); return m ? jvStrip(m[1]) : null; };
    const date = seg('發行日期:') || null;
    const length = parseInt(/(\d+)/.exec(seg('長度:') || '')?.[1] || '', 10) || null;
    const producer = seg('製作商:') || null;
    const uniq = (arr) => arr.filter((v, i, a) => v && a.indexOf(v) === i);
    const stars = uniq([...html.matchAll(/<a href="(?:https:\/\/www\.javbus\.com)?\/star\/[^"]+"[^>]*>([^<]+)<\/a>/g)].map((x) => x[1].trim()));
    const genres = uniq([...html.matchAll(/<a href="(?:https:\/\/www\.javbus\.com)?\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/g)].map((x) => x[1].trim()));
    const gid = /var gid = (\d+);/.exec(html)?.[1] || null;
    const uc = /var uc = (\d+);/.exec(html)?.[1] || null;
    return { id, title, img, date, length, producer, stars, genres, gid, uc };
}

async function jvMagnets(id, gid, uc) {
    if (!gid) return [];
    const r = await fetch(JV_URL + '/ajax/uncledatoolsbyajax.php?lang=zh&gid=' + gid + '&uc=' + (uc || '0'), { headers: { ...jvH(), Referer: JV_URL + '/' + encodeURIComponent(id) }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('javbus HTTP ' + r.status);
    const html = await r.text();
    const out = [];
    for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const row = m[1];
        const link = /magnet:\?xt=urn:btih:[0-9A-Za-z]+(?:&dn=[^"'\s<>]*)?/.exec(row)?.[0];
        if (!link) continue;
        const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
        const t0 = tds[0] || row;
        const t0c = t0.replace(/<a(?![^>]*magnet:)[^>]*>[\s\S]*?<\/a>/g, ' ');   // drop tag anchors (高清/字幕) — nested or sibling
        const title = jvStrip(/href="magnet:[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(t0c)?.[1]) || jvStrip(t0c.replace(/<a[^>]*>[\s\S]*?<\/a>/g, ' ')) || id;
        const size = jvStrip(tds[1]) || null;
        out.push({ link, title, size, numberSize: jvBytes(size), date: jvStrip(tds[2]) || null, hd: /高清/.test(t0), sub: /字幕/.test(t0) });
        if (out.length >= 30) break;
    }
    return out;
}

async function jvCover(url) {
    const r = await fetch(url, { headers: { 'User-Agent': jvH()['User-Agent'], Referer: JV_URL + '/' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('cover HTTP ' + r.status);
    return Buffer.from(await r.arrayBuffer());
}

const jvSearchCard = (q, list) => `🔞 *JavBus — "${cut(q || '', 40)}"*\n\n` +
    list.map((m, i) => `*${i + 1}.* ${m.id}${m.date ? ' · ' + m.date : ''}${m.hd ? ' · HD' : ''}${m.sub ? ' · 字幕' : ''}\n    _${cut(m.title, 76)}_`).join('\n') +
    `\n\nඑකක් තෝරන්න — මේ message එකට *අංකය reply* කරන්න\n${foot('18+ only · javbus.com · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const jvDetailCard = (d, mags) => `🔞 *${d.id}*\n_${cut(d.title, 84)}_\n` +
    (d.date ? `📅 ${d.date}${d.length ? ' · ⏱ ' + d.length + ' min' : ''}\n` : '') +
    (d.stars.length ? `👩 ${d.stars.slice(0, 4).join(', ')}\n` : '') +
    (d.producer ? `🏢 ${d.producer}\n` : '') +
    (d.genres.length ? `🏷 ${d.genres.slice(0, 8).join(', ')}\n` : '') +
    `\n*1* — 🧲 magnets ටික (ගාන ${mags ? mags.length : '?'} · උපරිම ${JV_MAG_CAP})\n*2* — javbus link එක විතරයි\n\n${foot('18+ only · javbus.com · මිනිත්තු 10 ඇතුලත reply කරන්න')}`;
const jvMagnetCard = (d, mags) => `🧲 *${d.id}* — magnets\n\n` +
    (mags || []).slice(0, JV_MAG_CAP).map((m, i) => `*${i + 1}.* ${m.size || '?'}${m.hd ? ' · HD' : ''}${m.sub ? ' · 字幕' : ''}${m.date ? ' · ' + m.date : ''}\n\`${m.link}\``).join('\n\n') +
    `\n\n${foot('torrent client එකකට magnet link එක paste කරන්න · 18+ only')}`;
const JV_USAGE = `🔞 *.javdn <code / නම>* — JavBus magnets\n\nඋදා: \`.javdn SSIS-001\`\n     \`.javdn SSIS\` · \`.javdn 葵つかさ\`\n\n${foot('search → cover+details → magnets/link · 18+ only')}`;

async function handleJV(send, jid, msg, arg, react, download) {
    const arg0 = (arg || '').trim();
    if (/^go\s+\d{1,3}$/i.test(arg0)) return jvGo(send, jid, msg, parseInt(arg0.split(/\s+/)[1], 10), download);
    gcSessions();
    const st = await status(send, jid, msg, 'JavBus');
    try {
        const list = await jvSearch(arg0);
        if (!list.length) return done(st, send, jid, msg, `❌ *"${cut(arg0, 40)}"* හොයාගන්න බැරි වුණා (javbus.com)\n\n${foot('code එකක් හෝ නමක් try කරන්න — උදා: .javdn SSIS-001')}`, react);
        sessions.set(jid, { cmd: 'jv', stage: 'search', items: list.map((m) => ({ label: m.id, id: m.id })), title: arg0, at: Date.now(), cardId: null });
        return done(st, send, jid, msg, jvSearchCard(arg0, list), react);
    } catch (e) { return fail(st, send, jid, msg, e, 'javbus.com slow වෙලා', 'JavBus'); }
}

async function jvGo(send, jid, msg, n, download) {
    gcSessions();
    const s = sessions.get(jid);
    if (s && s.cmd === 'hv') return hvGo(send, jid, msg, n, download);   // manual .javdn go on hv session → route right
    if (s && s.cmd === 'ep') return epGo(send, jid, msg, n, download);
    if (s && s.cmd === 'hm') return hmGo(send, jid, msg, n, download);
    if (s && s.cmd === 'aw') return goStep(send, jid, msg, n);
    if (!s || s.cmd !== 'jv' || !s.items?.length) return send(jid, { text: JV_USAGE }, { quoted: msg });
    const pick = s.items[n - 1];
    if (!pick) return send(jid, { text: `❌ ${n} කියන අංකේ නෑ — list එකේ අංකයක් එවන්න (1-${s.items.length})` }, { quoted: msg });
    const st = await status(send, jid, msg, 'JavBus');
    try {
        if (s.stage === 'search') {
            await st.edit('🔎 Details බලනවා...');
            const d = await jvDetail(pick.id);
            if (!d.gid) throw new Error('gid හම්බුණේ නෑ (page එක වෙනස් වෙලා ඇති)');
            const mags = await jvMagnets(pick.id, d.gid, d.uc);
            const cap = jvDetailCard(d, mags);
            let m = null;
            try { m = await send(jid, { image: await jvCover(d.img), caption: cap }, { quoted: msg }); } catch { m = await send(jid, { text: cap }, { quoted: msg }); }
            sessions.set(jid, { cmd: 'jv', stage: 'gallery', items: [{ label: 'magnets' }, { label: 'link' }], title: d.id, detail: d, magnets: mags, at: Date.now(), cardId: (m && m.key && m.key.id) || null });
            await st.del().catch(() => { });
            try { if (react) react('✅'); } catch { }
            return m;
        }
        if (s.stage === 'gallery') {
            const d = s.detail;
            if (n === 2) {
                try { sessions.delete(jid); } catch { }
                await st.del().catch(() => { });
                return send(jid, { text: `🔞 *${d.id}*\n🌐 ${JV_URL}/${encodeURIComponent(d.id)}\n\n${foot('browser එකෙන් open කරන්න · 18+ only')}` }, { quoted: msg });
            }
            const mags = s.magnets || [];
            try { sessions.delete(jid); } catch { }
            await st.del().catch(() => { });
            if (!mags.length) return send(jid, { text: `❌ magnets හම්බුණේ නෑ (${d.id})\n\n${foot('මේ එකට තාම magnets share වෙලා නෑ වෙන්න ඇති')}` }, { quoted: msg });
            return send(jid, { text: jvMagnetCard(d, mags) }, { quoted: msg });
        }
    } catch (e) { return fail(st, send, jid, msg, e, null, 'JavBus'); }
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
    const { send, jid, msg, rest, react, download } = ctx;
    if (c === '.aniworld' || c === '.aw') return handleAW(send, jid, msg, rest.join(' ').trim(), react);
    if (c === '.hentaiv') return handleHV(send, jid, msg, rest.join(' ').trim(), react, download);   // 🔞 v2.76 quality menu flow
    if (c === '.ep' || c === '.eporner') return handleEP(send, jid, msg, rest.join(' ').trim(), react, download);   // 🔞 v2.80 eporner API v2 flow
    if (c === '.hentaimng' || c === '.hmanga') return handleHM(send, jid, msg, rest.join(' ').trim(), react, download);   // 🔞 v2.81 hitomi manga pages
    if (c === '.javdn') return handleJV(send, jid, msg, rest.join(' ').trim(), react, download);   // 🔞 v2.83 javbus magnets
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
    if (/^go\s+\d{1,3}$/i.test(arg0)) {
        gcSessions();
        const s = sessions.get(jid);
        const nAW = parseInt(arg0.split(/\s+/)[1], 10);
        if (s && s.cmd === 'hv') return hvGo(send, jid, msg, nAW, null);   // manual .aniworld go while hv session live → route right
        if (s && s.cmd === 'ep') return epGo(send, jid, msg, nAW, null);   // v2.80: …while eporner session live
        if (s && s.cmd === 'hm') return hmGo(send, jid, msg, nAW, null);   // v2.81: …while hitomi session live
        if (s && s.cmd === 'jv') return jvGo(send, jid, msg, nAW, null);   // v2.83: …while javbus session live
        return goStep(send, jid, msg, nAW);
    }
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
                sessions.set(jid, { cmd: 'aw', stage: 'ep', items: [], title, at: Date.now(), cardId: null });
                return done(st, send, jid, msg, linksCard(title, url, streams, pageOnly), react);
            }
            if (/staffel-\d+|film[/-]\d+/.test(url)) {
                const title = decodeURIComponent(url.split('/anime/stream/')[1].split('/')[0]).replace(/-/g, ' ');
                const eps = await episodesOf(url);
                if (!eps.length) throw new Error('no episodes');
                sessions.set(jid, { cmd: 'aw', stage: 'ep', items: eps, title, at: Date.now(), cardId: null });
                return done(st, send, jid, msg, epsCard(title, eps), react);
            }
            return seriesStep(send, jid, msg, st, url, decodeURIComponent(url.split('/anime/stream/')[1] || '').replace(/-/g, ' '), react);
        } catch (e) { return fail(st, send, jid, msg, e, 'link එක open කරන්න බැරි වුණා'); }
    }

    // search
    const list = await searchAW(arg0);
    if (!list.length) return done(st, send, jid, msg, `❌ *"${cut(arg0, 40)}"* හොයාගන්න බැරි වුණා (AniWorld)\n\n${foot('English නමෙන් try කරන්න — උදා: .aniworld solo leveling')}`, react);
    sessions.set(jid, { cmd: 'aw', stage: 'series', items: list.map((x) => ({ label: x.title, url: x.link })), title: arg0, at: Date.now(), cardId: null });
    return done(st, send, jid, msg, searchCard(arg0, list), react);
}

async function goStep(send, jid, msg, n) {
    gcSessions();
    const s = sessions.get(jid);
    if (!s || !s.items?.length) return send(jid, { text: AW_USAGE }, { quoted: msg });
    if (s.cmd === 'hv') return hvGo(send, jid, msg, n, null);   // safety: never run AW logic on a hentaiv session
    if (s.cmd === 'ep') return epGo(send, jid, msg, n, null);   // safety: never run AW logic on an eporner session
    if (s.cmd === 'hm') return hmGo(send, jid, msg, n, null);   // safety: never run AW logic on a hitomi session
    if (s.cmd === 'jv') return jvGo(send, jid, msg, n, null);   // safety: never run AW logic on a javbus session
    const pick = s.items[n - 1];
    if (!pick) return send(jid, { text: `❌ ${n} කියන අංකේ නෑ — list එකේ තියෙන අංකයක් එවන්න (1-${s.items.length})` }, { quoted: msg });
    const st = await status(send, jid, msg);
    try {
        if (s.stage === 'series') return await seriesStep(send, jid, msg, st, pick.url, pick.label, null, pick);
        if (s.stage === 'season') {
            const eps = await episodesOf(pick.url);
            if (!eps.length) throw new Error('no episodes');
            sessions.set(jid, { cmd: 'aw', stage: 'ep', items: eps, title: s.title + ' ' + pick.label.replace('📺 ', '').replace('🎬 ', ''), at: Date.now(), cardId: null });
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
    sessions.set(jid, { cmd: 'aw', stage: 'season', items: seasons, title: title || 'AniWorld', at: Date.now(), cardId: null });
    return done(st, send, jid, msg, seasonsCard(title, seasons), react);
}

const epTitle = async (url) => {
    try { const html = await getText(url, { referer: AW + '/' }); const m = /property="og:title"\s+content="([^"]+)"/.exec(html) || /<h1[^>]*>\s*<span[^>]*>([^<]+)/.exec(html); return m ? m[1].trim() : ''; } catch { return ''; }
};

// status bubble (self-edits, deletes) — moviedex/features pattern
async function status(send, jid, msg, label = 'AniWorld') {
    const s = await send(jid, { text: '🌐 ' + label + ' බලනවා...' }, { quoted: msg });
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
function fail(st, send, jid, msg, e, extra, label) {
    try { st.del(); } catch { }
    return send(jid, { text: `❌ ${label || 'AniWorld'} error — ${extra || cut(e.message, 90)}\n\n${foot('ආයෙ try කරන්න — site එක slow උනොත් මේක එනවා')}` }, { quoted: msg });
}

/** numeric quote bridge — bot.js chain: apkMenuBridge → ytMenuBridge → moviedex.bridgeReply → animehub.bridge */
function bridge(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s || !s.items?.length || !s.stage) return null;
    if (Date.now() - (s.at || 0) > TTL + 30 * 60e3) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d) || d < 1) return null;
    if (qid && s.cardId && String(qid) !== String(s.cardId)) return null;   // 🔒 reply-only: card එකට ම quote කරලා එන්න ඕන
    return (s.cmd === 'hv' ? '.hentaiv go ' : s.cmd === 'ep' ? '.ep go ' : s.cmd === 'hm' ? '.hentaimng go ' : s.cmd === 'jv' ? '.javdn go ' : '.aniworld go ') + d;
}

module.exports = {
    handle, bridge,
    // test hooks
    _sessions: sessions, searchAW, seasonsOf, episodesOf, providersOf, providersFromHtml, resolveEpisode,
    resolveRedirect, vidmolyHls, doodMp4, nekobot, LANGS, TTL,
    searchWH, searchWHFromHtml, epsWH, epsWHFromHtml, qualitiesWH, whDecodeMediaUrl,
    searchEP, qualitiesEP, epCalcHash, epVideoId,
    hmGallery, hmSearch, hmList, hmImageUrl, hmImageBuf, hmImageCtx, hmNode, hmTermIds, hmNozomiIds, hmCmp, _hmCtx: () => hmCtx,
    jvSearch, jvDetail, jvMagnets, jvCover, jvGo,
    _cards: { searchCard, seasonsCard, epsCard, linksCard, hvSearchCard, hvEpsCard, hvQCard, epSearchCard, epQCard, hmSearchCard, hmGalleryCard, jvSearchCard, jvDetailCard, jvMagnetCard },
    _reset: () => sessions.clear(),
};
