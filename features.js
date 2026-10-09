/**
 * features.js — extra commands for KAVIZ MD V1 (v2.15), ported from SmokeBoy v3.7 (abc repo)
 *   YouTube: .yts .play .song/.yta .video/.ytv (.yt)     Social: .tiktok .fb/.facebook .ig .x
 *   Search: .wiki    GitHub: .gitclone    Tools: .sticker .take    Group: .tagall .kick .promote .demote .grouplink .groupinfo .jid
 * Every command is owner-only (checked in bot.js before we get here).
 *
 * v2.15 downloader fixes:
 *   • .yt/.video — ALL qualities (2160p → 144p, default = best available) + clipto.com API fallback
 *     when yt-dlp hits YouTube's "Sign in to confirm you're not a bot" datacenter-IP block
 *     (video-only 720p-2160p streams auto-merged with m4a audio via ffmpeg)
 *   • .fb — new .facebook / .faceboock / .fbvid aliases + FB page-scrape fallback
 *     (browser_native_hd_url / browser_native_sd_url) when yt-dlp fails
 *   • .tiktok — vm/vt short links resolved first, 3 retries with backoff
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const media = require('./media');

const human = (b) => !b ? '?' : b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtDur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtNum = (n) => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const URL_RE = /https?:\/\/\S+/i;
const MAXMB = () => Math.min(parseInt(process.env.DL_MAX_MB || '2000', 10), 2000);

function unwrap(m) {
    for (let i = 0; i < 5 && m; i++) {
        const n = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message;
        if (!n) break; m = n;
    }
    return m || {};
}
const ctxInfo = (msg) => { const m = unwrap(msg.message); return m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || null; };

let yts = null;
const ytsearch = async (q) => { yts ||= require('yt-search'); const r = await yts(q); return r.videos || []; };

// ───────── status helper (one message, edited) ─────────
async function status(send, jid, msg, text) {
    const st = await send(jid, { text }, { quoted: msg });
    return async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
}

async function sendFile(send, jid, msg, kind, p, extra) {
    try {
        if (kind === 'audio') await send(jid, { audio: { url: p }, mimetype: /\.mp3$/.test(p) ? 'audio/mpeg' : 'audio/mp4', ptt: false }, { quoted: msg });
        else if (kind === 'video') await send(jid, { video: { url: p }, mimetype: 'video/mp4', caption: extra.caption }, { quoted: msg });
        else await send(jid, { document: { url: p }, fileName: extra.fileName, mimetype: extra.mime || 'application/octet-stream', caption: extra.caption }, { quoted: msg });
    } finally { fs.rm(p, { force: true }, () => { }); }
}

// ───────── YouTube / any yt-dlp site ─────────
// ".video <link> 1080" / ".yt <link> 720p" → quality pick  (no quality = best available, 2160 → 144)
const Q_RE = /\s(2160|1440|1080|720|480|360|240|144)p?\s*$/i;

const MAXV = () => Math.min(200, MAXMB());   // video cap (MB)

async function ytDlpFetch(url, mode, height) {
    return media.ytdl(url, { mode, height, maxMB: mode === 'audio' ? Math.min(60, MAXMB()) : MAXV() });
}

// ───────── clipto.com API fallback — bypasses YouTube "Sign in to confirm you're not a bot"
// datacenter-IP blocks (returns googlevideo URLs with poToken included). YouTube only.
async function cliptoInfo(url) {
    const r = await fetch('https://www.clipto.com/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Referer: 'https://www.clipto.com/' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(45e3),
    });
    if (!r.ok) throw new Error('API ' + r.status);
    const j = await r.json().catch(() => null);
    if (!j?.success || !Array.isArray(j.medias) || !j.medias.length) throw new Error((j && j.error) || 'API result එකක් නෑ');
    return j;
}

async function ffmpegMerge(vp, ap) {
    let ff = null; try { ff = await media.getBin('ffmpeg'); } catch { return null; }
    const out = path.join(os.tmpdir(), `kz-${process.pid}-${Date.now().toString(36)}.mp4`);
    const r = await media._run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', vp, '-i', ap, '-c', 'copy', '-movflags', '+faststart', out], 300e3);
    if (r.code !== 0) { fs.rmSync(out, { force: true }); return null; }
    return out;
}

/** clipto.com download → { path, size, height, title }  (caller deletes the file) */
async function cliptoFetch(url, mode, height) {
    const j = await cliptoInfo(url);
    const capMB = mode === 'audio' ? Math.min(60, MAXMB()) : MAXV();
    const title = String(j.title || '').slice(0, 100);
    const ref = 'https://www.youtube.com/';
    if (mode === 'audio') {
        const m4a = (j.medias || []).filter((m) => m.ext === 'm4a' || /audio\/mp4/.test(m.mimeType || ''))
            .sort((a, b) => parseInt(b.quality) - parseInt(a.quality))[0];
        if (!m4a) throw new Error('API එකේ audio format එකක් නෑ');
        const p = await media.fetchToFile(m4a.url, 'kz-aud', { referer: ref, maxBytes: capMB * 1048576, ext: 'm4a' });
        return { path: p, size: fs.statSync(p).size, title };
    }
    const vids = (j.medias || []).filter((m) => m.height && /video\/mp4/.test(m.mimeType || ''));
    if (!vids.length) throw new Error('API එකේ video format එකක් නෑ');
    const sorted = [...new Set(vids.map((v) => v.height))].sort((a, b) => b - a);   // desc: 2160...144
    const target = height ? (sorted.find((h) => h <= height) || sorted[sorted.length - 1]) : sorted[0];
    const v = vids.find((x) => x.height === target);
    const vp = await media.fetchToFile(v.url, 'kz-vid', { referer: ref, maxBytes: capMB * 1048576, ext: 'mp4' });
    if (/mp4a/.test(v.mimeType || '')) return { path: vp, size: fs.statSync(vp).size, height: target, title };   // progressive (audio inside)
    // video-only (720p+) → merge best m4a audio with ffmpeg
    let out = null;
    try {
        const m4a = (j.medias || []).filter((m) => m.ext === 'm4a' || /audio\/mp4/.test(m.mimeType || ''))
            .sort((a, b) => parseInt(b.quality) - parseInt(a.quality))[0];
        if (m4a) {
            const ap = await media.fetchToFile(m4a.url, 'kz-aud2', { referer: ref, maxBytes: 30 * 1048576, ext: 'm4a' });
            out = await ffmpegMerge(vp, ap);
            fs.rmSync(ap, { force: true });
        }
    } catch { }
    fs.rmSync(vp, { force: true });
    if (!out) throw new Error('API video එකේ audio වෙනමයි + ffmpeg merge fail');
    return { path: out, size: fs.statSync(out).size, height: target, title };
}

async function ytCommand(send, jid, msg, query, mode, label = 'YouTube') {
    let height = null;
    const qm = query.match(Q_RE);
    if (qm) { height = +qm[1]; query = query.slice(0, qm.index).trim(); }
    if (!query) return send(jid, { text: `${mode === 'audio' ? '🎧' : '🎬'} *${mode === 'audio' ? '.song' : '.video'} <link හෝ නම>*${mode === 'audio' ? '' : ' [quality: 2160/1440/1080/720/480/360/240/144]'}
උදා: ${mode === 'audio' ? '.song faded alan walker' : '.video https://youtu.be/xxxx 1080'}
quality දුන්නේ නැත්නම් best quality එක (2160p දක්වා) ගන්නවා` }, { quoted: msg });
    const edit = await status(send, jid, msg, '🔎 හොයනවා...');
    let url = (query.match(URL_RE) || [])[0], title = '', meta = '', e1msg = '';
    try {
        if (!url) {
            const v = (await ytsearch(query)).find((x) => (x.seconds || 0) > 0 && (x.seconds || 0) <= (mode === 'audio' ? 900 : 1800));
            if (!v) return edit(`😢 "${query}" — හරියන result එකක් නෑ`);
            url = v.url; title = v.title; meta = `👤 ${v.author?.name || '—'}  •  ⏱️ ${v.timestamp || '—'}  •  👁️ ${fmtNum(v.views)}`;
        }
        await edit(`⬇️ ${mode === 'audio' ? 'Audio' : 'Video'} download වෙනවා...${title ? '\n🎵 ' + title : ''}${height ? `\n📺 ${height}p` : ''}`);
        let r = null;
        try {
            r = await ytDlpFetch(url, mode, height);   // primary: yt-dlp (all sites, best quality)
        } catch (e1) {
            e1msg = String(e1.message);
            if (!/youtube\.com|youtu\.be/i.test(url)) throw e1;   // clipto fallback = YouTube only
            await edit(`⚠️ yt-dlp fail (${e1msg.slice(0, 60).trim()})\n🔄 API fallback එකෙන් try කරනවා...`);
            r = await cliptoFetch(url, mode, height);
            if (!title) title = r.title || '';
        }
        if (!title) { try { const i = await media.info(url); title = i.title || ''; meta = `👤 ${i.uploader || i.channel || '—'}  •  ⏱️ ${fmtDur(i.duration)}`; } catch { } }
        await edit(`📤 යවනවා... (${human(r.size)})`);
        const cap = `${mode === 'audio' ? '🎧' : '🎬'} *${(title || label).slice(0, 150)}*\n${meta}${r.height && mode === 'video' ? '  •  📺 ' + r.height + 'p' : ''}\n📦 ${human(r.size)}`;
        await sendFile(send, jid, msg, mode, r.path, { caption: cap });
        if (mode === 'audio') await send(jid, { text: cap });
        await edit('✅ ඉවරයි');
    } catch (e) {
        const em = String(e.message);
        const botCheck = /sign in to confirm|not a bot/i.test(e1msg + em);
        const detail = e1msg ? `${em.slice(0, 180)}\n• yt-dlp: ${e1msg.slice(0, 140)}` : em.slice(0, 350);
        const hint = botCheck ? '\n\n💡 *.setcookies* එකෙන් මේ block එක pass වෙනවා — *.setcookies* ගහලා instructions බලන්න' : '';
        await edit('❌ ' + detail + hint);
    }
}

async function ytSearchCmd(send, jid, msg, q) {
    if (!q) return send(jid, { text: '🔎 *.yts <නම>*  — YouTube search\nඋදා: .yts alan walker faded' }, { quoted: msg });
    const v = (await ytsearch(q)).slice(0, 6);
    if (!v.length) return send(jid, { text: `😢 "${q}" — results නෑ` }, { quoted: msg });
    const list = v.map((x, i) => `*${i + 1}.* ${x.title.slice(0, 70)}\n   ⏱️ ${x.timestamp || '—'}  •  👁️ ${fmtNum(x.views)}\n   🔗 ${x.url}`).join('\n\n');
    return send(jid, { text: `🔎 *YouTube — ${q}*\n\n${list}\n\n> 🎧 *.song <link>*  •  🎬 *.video <link>*` }, { quoted: msg });
}

// ───────── Facebook (.fb / .facebook / .faceboock) ─────────
const isFbLink = (u) => /facebook\.com|fb\.watch/i.test(u || '');

/** FB page HTML → direct video URL (browser_native_hd_url / sd / playable_url) — works where yt-dlp can't */
async function fbScrape(url) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
        redirect: 'follow', signal: AbortSignal.timeout(30e3),
    });
    const html = await r.text();
    for (const key of ['browser_native_hd_url', 'browser_native_sd_url', 'playable_url_quality_hd', 'playable_url']) {
        const m = html.match(new RegExp('"' + key + '":"([^"]+)"'));
        if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1].replace(/\\u0025/g, '%').replace(/\\u0026/g, '&').replace(/\\\//g, '/'); } }
    }
    if (/c_user|login_form|\\"login\\"/i.test(html.slice(0, 5000))) throw new Error('FB මේ server IP එකට login wall එකක් දානවා');
    throw new Error('video URL එක page එකේ හම්බුණේ නෑ (private video / reel-only post)');
}

async function fbCommand(send, jid, msg, q) {
    let url = (q.match(URL_RE) || [])[0];
    if (!url || !isFbLink(url)) return send(jid, { text: '🎬 *.fb <link>*  — Facebook video download\nඋදා: .fb https://www.facebook.com/watch?v=xxxx\n\n*.facebook* / *.faceboock* / *.fbvid* කියලත් ගහන්න පුළුවන්' }, { quoted: msg });
    const edit = await status(send, jid, msg, '⏳ Facebook video එක ගන්නවා...');
    if (/^https?:\/\/(www\.)?(fb\.watch|fb\.gg)\//i.test(url)) { try { url = await media.resolveRedirects(url); } catch { } }   // share links → real URL
    let title = '', meta = '';
    try { const i = await media.info(url); title = i.title || ''; meta = `👤 ${i.uploader || '—'}${i.duration ? '  •  ⏱️ ' + fmtDur(i.duration) : ''}`; } catch { }
    // 1) yt-dlp (primary — panel/datacenter IPs)
    try {
        const r = await ytDlpFetch(url, 'video', null);
        await edit(`📤 යවනවා... (${human(r.size)})`);
        await sendFile(send, jid, msg, 'video', r.path, { caption: `🎬 *${(title || 'Facebook video').slice(0, 150)}*\n${meta}\n📦 ${human(r.size)}` });
        return edit('✅ ඉවරයි');
    } catch (e1) {
        // 2) page-scrape fallback (residential IPs / stale yt-dlp)
        await edit(`⚠️ yt-dlp fail (${String(e1.message).slice(0, 60).trim()})\n🔄 Direct method එකෙන් try කරනවා...`);
        try {
            const vurl = await fbScrape(url);
            const vp = await media.fetchToFile(vurl, 'fb-vid', { referer: 'https://www.facebook.com/', maxBytes: MAXV() * 1048576 });
            await sendFile(send, jid, msg, 'video', vp, { caption: `🎬 *${(title || 'Facebook video').slice(0, 150)}*\n${meta}\n📦 ${human(fs.statSync(vp).size)}` });
            return edit('✅ ඉවරයි');
        } catch (e2) {
            return edit(`❌ Facebook download fail\n• yt-dlp: ${String(e1.message).slice(0, 130)}\n• direct: ${String(e2.message).slice(0, 130)}`);
        }
    }
}

// ───────── TikTok (tikwm, no watermark) ─────────
async function tiktok(send, jid, msg, q) {
    let url = (q.match(URL_RE) || [])[0];
    if (!url || !/tiktok\.com/i.test(url)) return send(jid, { text: '🎵 *.tiktok <link>*  — watermark නැතුව download\nඋදා: .tiktok https://www.tiktok.com/@user/video/xxxx  (*.tt*)' }, { quoted: msg });
    const edit = await status(send, jid, msg, '⏳ TikTok video එක ගන්නවා...');
    if (/^https?:\/\/(www\.)?(vm|vt)\.tiktok\.com\//i.test(url)) { try { url = await media.resolveRedirects(url); } catch { } }   // short links → real URL
    try {
        let j = null;
        for (let tries = 0; tries < 3; tries++) {                       // tikwm free API rate-limits → 2 retries
            const r = await fetch('https://tikwm.com/api/?hd=1&url=' + encodeURIComponent(url), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30e3) });
            j = await r.json().catch(() => null);
            if (j?.code === 0 && j.data) break;
            if (tries < 2) await new Promise((res) => setTimeout(res, 1200 + tries * 1300));
        }
        if (!j || j.code !== 0 || !j.data) throw new Error((j && j.msg) || 'TikTok API error');
        const d = j.data, abs = (u) => !u ? null : u.startsWith('/') ? 'https://tikwm.com' + u : u;
        const cap = `🎵 *${(d.title || 'TikTok').slice(0, 150)}*\n👤 @${d.author?.unique_id || '?'}  •  ⏱️ ${d.duration || '?'}s\n❤️ ${fmtNum(d.digg_count)}  •  💬 ${fmtNum(d.comment_count)}  •  👁️ ${fmtNum(d.play_count)}\n✅ No watermark`;
        if (d.images?.length) {                            // photo slideshow
            for (const im of d.images.slice(0, 10)) await send(jid, { image: { url: im } }, { quoted: msg });
            await send(jid, { text: cap });
        } else {
            const vurl = abs(d.hdplay || d.play);
            let vp = null;
            try { vp = await media.fetchToFile(vurl, 'tiktok', { referer: 'https://www.tiktok.com/' }); }   // server-side: proxy-aware, UA/Referer set
            catch { }
            try {
                if (vp) await send(jid, { video: { url: vp }, mimetype: 'video/mp4', caption: cap }, { quoted: msg });
                else await send(jid, { video: { url: vurl }, mimetype: 'video/mp4', caption: cap }, { quoted: msg });   // old way fallback
            } finally { if (vp) fs.rm(vp, { force: true }, () => { }); }
        }
        await edit('✅ ඉවරයි');
    } catch (e) {
        await edit('⚠️ TikTok API fail (' + String(e.message).slice(0, 80) + ') — yt-dlp එකෙන් try කරනවා...');
        return ytCommand(send, jid, msg, url, 'video', 'TikTok');
    }
}

// ───────── Wikipedia ─────────
async function wiki(send, jid, msg, raw) {
    if (!raw) return send(jid, { text: '📚 *.wiki <මාතෘකාව>*\nඋදා: .wiki Sri Lanka  /  .wiki si සීගිරිය' }, { quoted: msg });
    let lang = 'en', q = raw;
    const m = raw.match(/^(si|en|ta|hi)\s+(.+)$/i);
    if (m) { lang = m[1].toLowerCase(); q = m[2]; } else if (/[\u0D80-\u0DFF]/.test(raw)) lang = 'si';
    const UA = { 'User-Agent': 'KAVIZ-MD-WhatsApp-bot/2.15 (private)' };
    const sum = async (t) => fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`, { headers: UA });
    let r = await sum(q), d = r.ok ? await r.json() : null;
    if (!d?.extract) {
        const s = await fetch(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?limit=3&q=${encodeURIComponent(q)}`, { headers: UA }).then((x) => x.ok ? x.json() : null).catch(() => null);
        const t = s?.pages?.[0]?.title;
        if (t) { r = await sum(t); d = r.ok ? await r.json() : null; }
    }
    if (!d?.extract) return send(jid, { text: `❓ Wikipedia (${lang}) එකේ "${q}" හම්බුණේ නෑ` }, { quoted: msg });
    const link = d.content_urls?.mobile?.page || d.content_urls?.desktop?.page || '';
    const text = `📚 *${d.title}*${d.description ? '\n_' + d.description + '_' : ''}\n\n${d.extract.slice(0, 1500)}\n\n🔗 ${link}`;
    const img = d.thumbnail?.source || d.originalimage?.source;
    if (img) { try { return await send(jid, { image: { url: img }, caption: text }, { quoted: msg }); } catch { } }
    return send(jid, { text }, { quoted: msg });
}

// ───────── GitHub repo → zip ─────────
async function gitclone(send, jid, msg, q, download) {
    const mm = q.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i) || q.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!mm) return send(jid, { text: '🐙 *.gitclone user/repo*  හෝ  *.gitclone https://github.com/user/repo*\n→ repo එක .zip එකක් විදියට' }, { quoted: msg });
    const owner = mm[1], repo = mm[2].replace(/\.git$/, '');
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { 'User-Agent': 'kaviz-md-bot', Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return send(jid, { text: `❌ ${owner}/${repo} — repo එක නෑ / private` }, { quoted: msg });
    if (!r.ok) return send(jid, { text: `❌ GitHub ${r.status}` }, { quoted: msg });
    const d = await r.json();
    const edit = await status(send, jid, msg, `⏳ ${owner}/${repo} zip එක ගන්නවා...`);
    let files = [];
    try {
        files = await download(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${d.default_branch}`);
        const f = files[0];
        await send(jid, { document: { url: f.path }, fileName: `${repo}-${d.default_branch}.zip`, mimetype: 'application/zip', caption: `🐙 *${owner}/${repo}*\n🌿 ${d.default_branch}  •  ⭐ ${fmtNum(d.stargazers_count)}  •  💻 ${d.language || '—'}\n📝 ${(d.description || '—').slice(0, 150)}\n📦 ${human(f.size)}` }, { quoted: msg });
        await edit('✅ ඉවරයි');
    } catch (e) { await edit('❌ ' + String(e.message).slice(0, 250)); }
    finally { for (const f of files) fs.rm(f.path, { force: true }, () => { }); }
}

// ───────── Sticker ─────────
let mediaDownloader = null;   // set by bot.js (Baileys downloadMediaMessage)
async function sticker(send, jid, msg, args, take) {
    const own = unwrap(msg.message), ci = ctxInfo(msg);
    let src = null, kind = null;
    const pick = (m) => m?.imageMessage ? 'image' : m?.videoMessage ? 'video' : m?.stickerMessage ? 'sticker' : null;
    if (pick(own)) { kind = pick(own); src = { key: msg.key, message: own }; }
    else if (ci?.quotedMessage && pick(unwrap(ci.quotedMessage))) { const q = unwrap(ci.quotedMessage); kind = pick(q); src = { key: { remoteJid: msg.key.remoteJid, id: ci.stanzaId, participant: ci.participant, fromMe: false }, message: q }; }
    if (!src) return send(jid, { text: '🖼️ *.sticker*  (*.s*)\n• Photo / video එකක් යවලා caption එකට *.s*\n• නැත්නම් photo / video / sticker එකකට reply කරලා *.s*\n\n🎁 *.take Pack | Author*  — sticker එකේ නම වෙනස් කරන්න\n🎞️ Video = තත්පර 6 දක්වා' }, { quoted: msg });
    const [pack, author] = take ? (args.join(' ') || 'KAVIZ MD V1').split('|').map((s) => s.trim()) : ['KAVIZ MD V1', 'KAVIZ MD V1'];
    try {
        const buf = await mediaDownloader(src);
        const m = src.message;
        if (kind === 'video' && (m.videoMessage?.seconds || 0) > 15) return send(jid, { text: '🎞️ Video එක තත්පර 15 ට අඩු වෙන්න ඕනේ' }, { quoted: msg });
        const out = kind === 'sticker' ? await media.addExif(buf, pack || 'KAVIZ MD V1', author || 'KAVIZ MD V1')
            : await media.makeSticker(buf, { animated: kind === 'video' || !!m.imageMessage?.mimetype?.includes('gif'), pack: pack || 'KAVIZ MD V1', author: author || 'KAVIZ MD V1' });
        return send(jid, { sticker: out }, { quoted: msg });
    } catch (e) {
        return send(jid, { text: '❌ Sticker එක හදන්න බැරි වුණා: ' + String(e.message).slice(0, 200) }, { quoted: msg });
    }
}

// ───────── Group tools ─────────
const bare = (j) => { if (!j) return j; const [u, s] = String(j).split('@'); return u.split(':')[0] + '@' + s; };
const lastTagall = new Map();
function targets(msg, args) {
    const ci = ctxInfo(msg);
    const t = [...(ci?.mentionedJid || [])];
    if (ci?.participant && !t.length) t.push(ci.participant);
    for (const a of args) { const n = a.replace(/\D/g, ''); if (n.length >= 9 && n.length <= 15) t.push(n + '@s.whatsapp.net'); }
    return [...new Set(t.map(bare))];
}
async function group(sock, send, jid, msg, c, args, me) {
    if (c === '.jid') return send(jid, { text: `🆔 ${jid}` }, { quoted: msg });
    if (!jid.endsWith('@g.us')) return send(jid, { text: '👥 මේ command එක group එකක විතරයි වැඩ' }, { quoted: msg });
    const meta = await sock.groupMetadata(jid);
    const mine = new Set([me.pn, me.lid].filter(Boolean));
    const meP = meta.participants.find((p) => mine.has(bare(p.id)) || mine.has(bare(p.phoneNumber)) || mine.has(bare(p.lid)));
    const iAmAdmin = !!meP?.admin;
    if (c === '.groupinfo') {
        const admins = meta.participants.filter((p) => p.admin).length;
        return send(jid, { text: `👥 *${meta.subject}*\n\n🆔 ${jid}\n👤 Members: ${meta.participants.length}  •  🛡️ Admins: ${admins}\n📅 ${meta.creation ? new Date(meta.creation * 1000).toLocaleDateString('en-GB') : '—'}\n🔒 ${meta.announce ? 'Admins only messages' : 'Everyone can message'}\n\n📝 ${(meta.desc || '—').toString().slice(0, 500)}` }, { quoted: msg });
    }
    if (c === '.grouplink') {
        if (!iAmAdmin) return send(jid, { text: '⛔ Link එක ගන්න ඔයා admin වෙන්න ඕනේ' }, { quoted: msg });
        return send(jid, { text: `🔗 *${meta.subject}*\nhttps://chat.whatsapp.com/${await sock.groupInviteCode(jid)}` }, { quoted: msg });
    }
    if (c === '.tagall') {
        const last = lastTagall.get(jid) || 0;
        if (Date.now() - last < 10 * 60e3) return send(jid, { text: `⏳ Anti-ban: *.tagall* group එකකට විනාඩි 10 කට එක පාරයි (තව ${Math.ceil((10 * 60e3 - (Date.now() - last)) / 60e3)} min)` }, { quoted: msg });
        if (meta.participants.length > 300) return send(jid, { text: '⛔ Members 300 ට වැඩි groups වල tagall කරන්නේ නෑ (ban risk)' }, { quoted: msg });
        lastTagall.set(jid, Date.now());
        const ids = meta.participants.map((p) => p.id);
        const list = meta.participants.map((p) => `${p.admin ? '👑' : '▫️'} @${p.id.split('@')[0]}`).join('\n');
        return send(jid, { text: `📢 ${args.join(' ') ? '*' + args.join(' ') + '*\n\n' : ''}${list}`, mentions: ids });
    }
    if (c === '.tagadmins') {
        const ad = meta.participants.filter((p) => p.admin);
        return send(jid, { text: `🛡️ *Admins*${args.join(' ') ? '\n' + args.join(' ') : ''}\n\n${ad.map((p) => '👑 @' + p.id.split('@')[0]).join('\n')}`, mentions: ad.map((p) => p.id) });
    }
    if (c === '.mute' || c === '.unmute' || c === '.resetlink') {
        if (!iAmAdmin) return send(jid, { text: '⛔ මේක කරන්න ඔයා group එකේ admin වෙන්න ඕනේ' }, { quoted: msg });
        if (c === '.resetlink') { const code = await sock.groupRevokeInvite(jid); return send(jid, { text: `🔄 පරණ link එක cancel කළා.\n🔗 අලුත් link: https://chat.whatsapp.com/${code}` }, { quoted: msg }); }
        await sock.groupSettingUpdate(jid, c === '.mute' ? 'announcement' : 'not_announcement');
        return send(jid, { text: c === '.mute' ? '🔇 Group එක mute කළා — admins ට විතරයි messages' : '🔊 Group එක open කළා — ඔක්කොටම messages' }, { quoted: msg });
    }
    // kick / promote / demote
    if (!iAmAdmin) return send(jid, { text: '⛔ මේක කරන්න ඔයා group එකේ admin වෙන්න ඕනේ' }, { quoted: msg });
    const t = targets(msg, args).filter((x) => !mine.has(x));
    if (!t.length) return send(jid, { text: `❓ කෙනෙක්ව @mention කරන්න, නැත්නම් එයාගේ message එකකට reply කරලා *${c}* ගහන්න` }, { quoted: msg });
    const action = { '.kick': 'remove', '.promote': 'promote', '.demote': 'demote' }[c];
    const res = await sock.groupParticipantsUpdate(jid, t, action);
    const ok = (res || []).filter((x) => String(x.status) === '200').length;
    const word = { remove: '👢 Remove කළා', promote: '⬆️ Admin කළා', demote: '⬇️ Admin අයින් කළා' }[action];
    return send(jid, { text: `${word}: ${ok}/${t.length}\n${t.map((x) => '@' + x.split('@')[0]).join(' ')}`, mentions: t }, { quoted: msg });
}

const GROUP_CMDS = ['.tagall', '.kick', '.promote', '.demote', '.grouplink', '.groupinfo', '.jid', '.mute', '.unmute', '.tagadmins', '.resetlink'];
const CMDS = ['.yts', '.play', '.song', '.yta', '.video', '.ytv', '.yt', '.tiktok', '.tt', '.fb', '.facebook', '.faceboock', '.fbvid', '.ig', '.insta', '.x', '.twitter', '.wiki', '.gitclone', '.sticker', '.s', '.take', ...GROUP_CMDS];

/** returns true if handled */
async function handle(c, { send, jid, msg, rest, sock, me, download }) {
    if (!CMDS.includes(c)) return false;
    const q = rest.join(' ').trim();
    switch (c) {
        case '.yts': await ytSearchCmd(send, jid, msg, q); break;
        case '.play': case '.song': case '.yta': await ytCommand(send, jid, msg, q, 'audio'); break;
        case '.video': case '.ytv': case '.yt': await ytCommand(send, jid, msg, q, 'video'); break;
        case '.fb': case '.facebook': case '.faceboock': case '.fbvid': await fbCommand(send, jid, msg, q); break;
        case '.ig': case '.insta': case '.x': case '.twitter':
            if (!URL_RE.test(q)) { await send(jid, { text: `🎬 *${c} <link>*  — public video එකක link එක දාන්න` }, { quoted: msg }); break; }
            await ytCommand(send, jid, msg, q, 'video', { '.ig': 'Instagram', '.insta': 'Instagram' }[c] || 'X / Twitter'); break;
        case '.tiktok': case '.tt': await tiktok(send, jid, msg, q); break;
        case '.wiki': await wiki(send, jid, msg, q); break;
        case '.gitclone': await gitclone(send, jid, msg, q, download); break;
        case '.sticker': case '.s': await sticker(send, jid, msg, rest, false); break;
        case '.take': await sticker(send, jid, msg, rest, true); break;
        default:
            if (!sock) { await send(jid, { text: '⚠️ WhatsApp connect වෙලා නෑ' }, { quoted: msg }); break; }
            try { await group(sock, send, jid, msg, c, rest, me); } catch (e) { await send(jid, { text: '❌ ' + String(e.message).slice(0, 200) }, { quoted: msg }); }
    }
    return true;
}

module.exports = { handle, CMDS, GROUP_CMDS, ytCommand, setMediaDownloader: (f) => { mediaDownloader = f; }, _ytsearch: (f) => { yts = f; } };
