/**
 * Link resolvers: turn a share link into something we can download.
 * Supported: any direct link, GitHub (blob/raw/releases), Google Drive,
 * MediaFire, Dropbox, Pixeldrain, MEGA (megajs), catbox/litterbox, x0.at,
 * transfer.archivete.am, filebin, OneDrive-style direct links...
 */
const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const UA_CURL = 'curl/8.5.0';

async function fetchText(url, ua = UA_BROWSER) {
    const r = await require('./net').smartFetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow' });
    return { status: r.status, url: r.url, text: await r.text() };
}

function driveId(u) {
    const m = u.pathname.match(/\/file\/d\/([\w-]{10,})/) || u.pathname.match(/\/d\/([\w-]{10,})/);
    return (m && m[1]) || u.searchParams.get('id');
}

// ⚡ v2.64 MediaFire resolve cache (page url → { link, at }) — 10-min TTL, capped
const MF_TTL = 10 * 60e3;
const mfCache = new Map();
const mfCacheGet = (k) => { const c = mfCache.get(k); return c && Date.now() - c.at < MF_TTL ? c : null; };
const mfCacheSet = (k, link) => { mfCache.set(k, { link, at: Date.now() }); if (mfCache.size > 200) mfCache.delete(mfCache.keys().next().value); };

async function resolve(raw) {
    let u;
    try { u = new URL(raw); } catch { throw new Error('link එක වැරදියි'); }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    // ── 🎌 v3.04 #apref fragment — animepahe.js final file URL carries #apref=<page-url>;
    // v3.02 appended it but NOTHING stripped it (latent bug — referer-less file GETs would 403
    // on kwik/nextcdn). Strip → the page becomes the download Referer, URL loses the fragment.
    if (u.hash.startsWith('#apref=')) {
        const ref = decodeURIComponent(u.hash.slice(7));
        u.hash = '';
        return { kind: 'http', url: u.toString(), referer: ref };
    }

    // ── MEGA ──
    if (host === 'mega.nz' || host === 'mega.co.nz') return { kind: 'mega', url: raw };

    // ── gofile (v2.90 update): guest UPLOAD works (.uploadgo) but DOWNLOAD is locked at the API —
    //    contents = error-notPremium (guest tier), /download/web/ = 302 page, site uses wt.obf.js anti-bot token
    //    (all 4 paths LIVE-PROBED 2026-10-27) → honest card, code-validated
    if (host === 'gofile.io') {
        const code = (u.pathname.match(/\/d\/([\w-]+)/) || [])[1];
        if (!code) throw new Error('gofile link එක වැරදියි — gofile.io/d/CODE shape එක විතරයි support');
        throw new Error('gofile files API එකෙන් guest download කරන්න බෑ (site එක bots block කරනවා) — browser එකෙන් download කරන්න. bot-uploadable host: *.uploadtm* / *.uploadtra* / *.tourl*');
    }
    if (host === 'limewire.com') throw new Error('LimeWire files encrypt කරලා — browser එකෙන් විතරයි download වෙන්නේ.');

    // ── GitHub ──
    if (host === 'github.com') {
        const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
        if (m) return { kind: 'http', url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` };
        return { kind: 'http', url: raw }; // /raw/..., /releases/download/... redirect fine
    }

    // ── Google Drive ──
    if (host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com') {
        const id = driveId(u);
        if (!id) throw new Error('Google Drive file ID එක හොයාගන්න බෑ (folder links support නෑ)');
        return { kind: 'http', url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, drive: true };
    }

    // ── Dropbox ──
    if (host.endsWith('dropbox.com')) { u.searchParams.set('dl', '1'); return { kind: 'http', url: u.toString() }; }

    // ── Pixeldrain ──
    if (host === 'pixeldrain.com' || host === 'pixeldra.in') {
        const m = u.pathname.match(/\/(?:u|api\/file)\/([\w-]+)/);
        if (m) return { kind: 'http', url: `https://pixeldrain.com/api/file/${m[1]}?download` };
    }

    // ── MediaFire ──  (⚡ v2.64: resolve cache — the CDN link is stable for minutes, so repeat
    // downloads skip the 1-2s page scrape; 10-min TTL keeps expired links out)
    if (host.endsWith('mediafire.com') && !/^download\d*\./.test(host)) {
        if (/\/folder\//.test(u.pathname)) throw new Error('MediaFire folder links support නෑ — file link එකක් එවන්න');
        const cached = mfCacheGet(raw);
        if (cached) return { kind: 'http', url: cached.link, referer: raw };
        const page = await fetchText(raw, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36');
        if (page.status === 404) throw new Error('MediaFire file එක delete වෙලා / private');
        let m = page.text.match(/href="(https?:\/\/download\d*\.mediafire\.com[^"]+)"/);
        let link = m && m[1].replace(/&amp;/g, '&');
        if (!link) {
            const s = page.text.match(/data-scrambled-url="([^"]+)"/);
            if (s) { try { link = Buffer.from(s[1], 'base64').toString('utf8'); } catch { } }
        }
        if (!link) throw new Error('MediaFire download link එක හොයාගන්න බෑ (file එක delete වෙලා හෝ private)');
        mfCacheSet(raw, link);
        return { kind: 'http', url: link, referer: raw };
    }

    // ── Eporner ── (CDN vid-*.eporner.com drops datacenter IPs → net.js pool route handles it;
    //                page links → yt-dlp EpornerIE, direct .mp4/.dload → HTTP with referer)
    if (host === 'eporner.com' || host.endsWith('.eporner.com')) {
        if (/\.(mp4|mkv|webm|mov|ts|m3u8)$/i.test(u.pathname) || /^\/dload\//.test(u.pathname))
            return { kind: 'http', url: raw, referer: 'https://www.eporner.com/' };
        return { kind: 'video', url: raw };   // video page → yt-dlp path (.download handles kind 'video')
    }

    // ── hstorage.xyz / watchhentai.net CDN (v2.76 .hentaiv) ── drops requests without Referer (403)
    if (host.endsWith('hstorage.xyz') || host.endsWith('watchhentai.net'))
        return { kind: 'http', url: raw, referer: 'https://watchhentai.net/' };

    // ── TeraBox (v2.84 .terabox) — dlink URLs need the owner's ndus cookie header ──
    if (/^(?:[\w-]+\.)*(?:terabox\.app|terabox\.com|teraboxshare\.com|1024terabox\.com|teraboxlink\.com|4funbox\.com|mirrobox\.com|nephobox\.com)$/i.test(host)) {
        const ndus = require('./terabox').readNdus();
        return { kind: 'http', url: raw, ...(ndus ? { cookie: 'ndus=' + ndus } : {}) };
    }

    // ── tmpfiles.org (v2.90 .uploadtm) — page link → scrape the /dl/<ts>.<hash>/ direct link.
    //    The hashed direct link is SINGLE-USE (rotates per page fetch) → NEVER cache; every download
    //    re-resolves fresh. Already-hashed links pass through untouched.
    if (host === 'tmpfiles.org') {
        if (/^\/dl\/\d+\.[a-f0-9]+\//.test(u.pathname)) return { kind: 'http', url: raw, referer: 'https://tmpfiles.org/' };
        if (/^\/api/.test(u.pathname)) throw new Error('tmpfiles API link එකක් නෙමෙයි — file page link එකක් එවන්න');
        const p = u.pathname.startsWith('/dl/') ? u.pathname : '/dl' + u.pathname;
        const page = await fetchText('https://tmpfiles.org' + p);
        if (page.status !== 200) throw new Error('tmpfiles file එක නෑ — 60 min expiry එකෙන් පස්සේ auto-delete වෙනවා');
        let m = page.text.match(/https?:\/\/tmpfiles\.org(\/dl\/\d+\.[a-f0-9]+\/[^"'\s<>]+)/);
        if (!m) {   // relative href fallback (site serves both shapes)
            const rel = page.text.match(/["'](\/dl\/\d+\.[a-f0-9]+\/[^"'\s<>]+)["']/);
            if (rel) m = ['https://tmpfiles.org' + rel[1]];
        }
        const link = m && m[0];
        if (!link) throw new Error('tmpfiles direct link එක හොයාගන්න බෑ — file එක expire වෙලා ඇති (60 min)');
        return { kind: 'http', url: link, referer: 'https://tmpfiles.org/' };
    }

    // ── everything else: treat as direct link ──
    return { kind: 'http', url: raw };
}

/** Google Drive "can't scan for viruses" page → follow its form */
function driveConfirmUrl(html) {
    const form = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/);
    if (!form) return null;
    const action = form[1].replace(/&amp;/g, '&');
    const params = new URLSearchParams();
    for (const m of form[0].matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) params.set(m[1], m[2]);
    return action + (action.includes('?') ? '&' : '?') + params.toString();
}

module.exports = { resolve, driveConfirmUrl, UA_BROWSER, UA_CURL, mfCacheGet, mfCacheSet, _mfCache: mfCache, MF_TTL };
