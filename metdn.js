/**
 * metdn.js — 🔞 mat6tube.com downloader (v2.86.0)
 * User: 'https://github.com/yt-dlp/yt-dlp/issues/14613 මෙක add කරන්න .metdn' — that issue =
 * mat6tube.com support request, closed as wontfix ("not planned", Jan 2026; generic extractor
 * got 404 on /videofile/, noted as a noodlemagazine.com clone). yt-dlp's NoodleMagazineIE
 * contract ports 1:1 to mat6tube — LIVE-PROBED 2026-10-21:
 *   watch page → window.playlist = { image, sources:[{file, label:'480'|'360'|'240'|'144', type:'mp4'}] }
 *   meta: og:title · video:duration · ya:ovs:views_total · video:tag
 *   signed media (pvvstream.pro) = srcIp-locked to the PAGE-fetcher IP → page fetch + media
 *   download must both be direct (no proxy); media = 206 + ftyp magic, Referer NOT required,
 *   Range OK → the battle-tested parallel downloader pipeline works as-is (generic .mp4 rule).
 *   .metdn <link> → info card (title · quality · duration · views · tags + thumb) → BEST mp4
 * Deleted videos ("Video deleted" page) + hls-only sources get honest error cards.
 * noodlemagazine.com hosts accepted too (same engine per the issue) — unverified from this
 * sandbox (0-byte responses), so failures there surface as the honest error card.
 */
const { foot } = require('./style');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const HOST_RE = /^(?:[\w-]+\.)*(?:mat6tube\.com|noodlemagazine\.com)$/i;
const REFERER = 'https://mat6tube.com/';

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

const METDN_USAGE = `🔞 *mat6tube* — *.metdn <link>*
උදා: \`.metdn https://mat6tube.com/watch/-114054493_456243244\`

✦ watch link → details card → BEST quality mp4 එක එවනවා
✦ deleted video → අවංක error card එකක්\n${foot('yt-dlp #14613')}`;

// ── command handle (same contract as terabox.handle: (cmd, {send,jid,msg,rest,react,download})) ──
async function handle(c, ctx) {
    if (c !== '.metdn') return false;
    const { send, jid, msg, rest, react, download } = ctx;
    const arg = rest.join(' ').trim();
    if (!arg) return send(jid, { text: METDN_USAGE }, { quoted: msg });

    const link = (arg.match(/https?:\/\/\S+/) || [])[0];
    if (!link || !idOf(link)) return send(jid, { text: '❌ මේක mat6tube watch link එකක් නෙවෙයි\n\n✦ mat6tube.com/watch/… link එකක් එවන්න\n✦ අනිත් sites: *.download <link>*' }, { quoted: msg });

    await react?.('🔞');
    const st = await send(jid, { text: '🔞 mat6tube — page එක කියවනවා…' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const info = await parsePage(link);
        if (info.deleted) return await edit('❌ මේ video එක delete වෙලා (site එකේම "Video deleted" පෙන්නනවා)');
        if (!bestSrc(info)) return await edit(infoCard(info));
        const cap = infoCard(info);
        if (info.image) {
            try {
                const im = await send(jid, { image: { url: info.image }, caption: cap + '\n18+ 🔞' }, { quoted: msg });
                try { await send(jid, { delete: st.key }); } catch { }   // progress bubble අයින් — image card එකම ඇති
                if (download) await download(bestSrc(info).file, '🔞 mat6tube');
                return true;
            } catch { }   // thumb send fail → edited text card එකට
        }
        await edit(cap);
        if (download) await download(bestSrc(info).file, '🔞 mat6tube');
        return true;
    } catch (e) {
        return await edit('❌ mat6tube: ' + String((e && e.message) || e).slice(0, 180));
    }
}

module.exports = { handle, parsePage, idOf, bestSrc, playlistJson, infoCard, setFetcher, HOST_RE, METDN_USAGE };
