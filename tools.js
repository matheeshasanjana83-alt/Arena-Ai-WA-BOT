/**
 * tools.js — KAVIZ MD V1 v2.12 tools & fun (ideas from Knightbot-MD, rewritten with stable free APIs)
 *   .tts .tr .weather .lyrics .toimg .tourl .ss .qr .short .calc .github .imagine .del .setpp
 *   .joke .fact .quote .8ball
 * Owner-only (checked in bot.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const media = require('./media');
const { foot, cut, bar } = require('./style');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const TMP = () => process.env.DL_TMP || os.tmpdir();
const URL_RE = /https?:\/\/\S+/i;
const SI = /[\u0D80-\u0DFF]/, TA = /[\u0B80-\u0BFF]/;
const getJson = async (u, h = {}) => { const r = await fetch(u, { headers: { ...UA, ...h } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const fmtNum = (n) => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

function unwrap(m) {
    for (let i = 0; i < 5 && m; i++) {
        const n = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message;
        if (!n) break; m = n;
    }
    return m || {};
}
const ctxOf = (msg) => { const m = unwrap(msg.message); return m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || m.stickerMessage?.contextInfo || null; };
function quotedText(msg) {
    const q = unwrap(ctxOf(msg)?.quotedMessage || {});
    return (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || q.documentMessage?.caption || '').trim();
}
/** media from this message or the replied one → { kind, src } */
function mediaOf(msg, kinds = ['image', 'video', 'sticker', 'audio', 'document']) {
    const pick = (m) => kinds.find((k) => m?.[k + 'Message']);
    const own = unwrap(msg.message);
    if (pick(own)) return { kind: pick(own), src: { key: msg.key, message: own } };
    const ci = ctxOf(msg), q = unwrap(ci?.quotedMessage);
    if (q && pick(q)) return { kind: pick(q), src: { key: { remoteJid: msg.key.remoteJid, id: ci.stanzaId, participant: ci.participant, fromMe: false }, message: q } };
    return null;
}
let mediaDownloader = null;

// ───────── languages ─────────
const LANGS = { si: 'Sinhala', en: 'English', ta: 'Tamil', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian', it: 'Italian', pt: 'Portuguese', ms: 'Malay', id: 'Indonesian', th: 'Thai', tr: 'Turkish', ur: 'Urdu', bn: 'Bengali' };
function splitLang(args) {
    const a = (args[0] || '').toLowerCase();
    if (LANGS[a]) return { lang: a, text: args.slice(1).join(' ').trim() };
    return { lang: null, text: args.join(' ').trim() };
}

// ───────── translate ─────────
async function translate(text, tl) {
    const q = encodeURIComponent(text.slice(0, 2000));
    try {   // 1) Google (chrome extension endpoint)
        const j = await getJson(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}&q=${q}`);
        const t = Array.isArray(j) ? j.map((x) => Array.isArray(x) ? x[0] : x).join(' ') : j?.sentences?.map((s) => s.trans).join('');
        if (t) return { text: t, from: Array.isArray(j?.[0]) ? j[0][1] : '' };
    } catch { }
    try {   // 2) Google gtx
        const j = await getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${q}`);
        const t = (j?.[0] || []).map((x) => x[0]).join('');
        if (t) return { text: t, from: j?.[2] || '' };
    } catch { }
    const src = SI.test(text) ? 'si' : TA.test(text) ? 'ta' : 'en';   // 3) MyMemory
    const j = await getJson(`https://api.mymemory.translated.net/get?q=${q}&langpair=${src === tl ? 'en' : src}|${tl}`);
    if (!j?.responseData?.translatedText) throw new Error('translate fail');
    return { text: j.responseData.translatedText, from: src };
}
async function cmdTr(send, jid, msg, args) {
    let { lang, text } = splitLang(args);
    text = text || quotedText(msg);
    if (!text) return send(jid, { text: '🌐 *.tr <භාෂාව> <text>*\nඋදා: .tr si good morning  •  .tr en සුභ උදෑසනක්\nනැත්නම් message එකකට reply කරලා *.tr si*\n\nභාෂා: ' + Object.keys(LANGS).join(' ') }, { quoted: msg });
    lang ||= SI.test(text) ? 'en' : 'si';
    const r = await translate(text, lang);
    return send(jid, { text: `🌐 *${LANGS[lang] || lang}*${r.from ? '  (' + r.from + ' →)' : ''}\n\n${r.text}` }, { quoted: msg });
}

// ───────── text to speech (Google, ≤200 chars per piece) ─────────
function chunks(text, n = 190) {
    const out = []; let cur = '';
    for (const w of text.split(/(\s+)/)) { if ((cur + w).length > n && cur.trim()) { out.push(cur.trim()); cur = ''; } cur += w; }
    if (cur.trim()) out.push(cur.trim());
    return out.flatMap((c) => c.length > n ? c.match(new RegExp(`.{1,${n}}`, 'g')) : [c]).slice(0, 15);
}
async function cmdTts(send, jid, msg, args) {
    let { lang, text } = splitLang(args);
    text = text || quotedText(msg);
    if (!text) return send(jid, { text: '🗣️ *.tts <text>*  — text එක voice එකක් කරනවා\nඋදා: .tts ආයුබෝවන්  •  .tts en hello  •  .tts ja konnichiwa\nනැත්නම් message එකකට reply කරලා *.tts*' }, { quoted: msg });
    lang ||= SI.test(text) ? 'si' : TA.test(text) ? 'ta' : 'en';
    try {
        const bufs = [];
        for (const c of chunks(text.slice(0, 2500))) {
            const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(c)}`, { headers: UA, signal: AbortSignal.timeout(30e3) });
            if (!r.ok) throw new Error('TTS fail (' + r.status + ')');
            bufs.push(Buffer.from(await r.arrayBuffer()));
        }
        return send(jid, { audio: Buffer.concat(bufs), mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
    } catch (e) {
        // 🌸 v2.69 — Google translate_tts 429/rate-limit වෙලාද? → Pollinations neural voice (nova) fallback
        try {
            const P = require('./pollinations');
            if (!P.hasKey()) throw e;
            const buf = await P.ttsBuf(text);
            return send(jid, { audio: buf, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
        } catch { throw e; }   // fallback එකත් fail → original error එකම
    }
}

// 🎙️ v2.69 — .stt — voice note → text (Pollinations whisper-large-v3, free)
async function cmdStt(send, jid, msg) {
    const m = mediaOf(msg, ['audio', 'video', 'document']);
    if (!m) return send(jid, { text: '🎙️ Voice note එකකට reply කරලා *.stt* ගහන්න — කථාව text වෙලා එනවා' }, { quoted: msg });
    const buf = await mediaDownloader(m.src);
    if (!buf || !buf.length) throw new Error('media download fail');
    const mime = m.kind === 'video' ? 'video/mp4' : (m.src.message.documentMessage?.mimetype || 'audio/ogg');
    const text = await require('./pollinations').sttText(buf, mime);
    if (!text) return send(jid, { text: '🤷 හඬ හම්බුණේ නෑ — audio එක හිස්ද බලන්න' }, { quoted: msg });
    return send(jid, { text: `🎙️→📝\n${text.slice(0, 1500)}` }, { quoted: msg });
}

// ───────── weather (Open-Meteo, no key) ─────────
const WMO = { 0: '☀️ පැහැදිලියි', 1: '🌤️ වැඩිපුර පැහැදිලියි', 2: '⛅ වලාකුළු ටිකක්', 3: '☁️ වලාකුළු', 45: '🌫️ මීදුම', 48: '🌫️ මීදුම', 51: '🌦️ පොද වැස්ස', 53: '🌦️ පොද වැස්ස', 55: '🌦️ පොද වැස්ස', 61: '🌧️ පොඩි වැස්ස', 63: '🌧️ වැස්ස', 65: '🌧️ තද වැස්ස', 71: '🌨️ හිම', 73: '🌨️ හිම', 75: '❄️ තද හිම', 80: '🌦️ වැසි', 81: '🌧️ වැසි', 82: '⛈️ තද වැසි', 95: '⛈️ ගිගුරුම් සහිත වැසි', 96: '⛈️ ගිගුරුම් + අයිස්', 99: '⛈️ ගිගුරුම් + අයිස්' };
async function cmdWeather(send, jid, msg, args) {
    const city = args.join(' ').trim() || 'Colombo';
    const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(city)}`);
    const p = g?.results?.[0];
    if (!p) return send(jid, { text: `❓ "${city}" කියන තැන හම්බුණේ නෑ` }, { quoted: msg });
    const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=3&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`);
    const c = w.current, d = w.daily;
    const days = d.time.map((t, i) => `┃ ${new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' })}  ${WMO[d.weather_code[i]] || '🌡️'}  ${Math.round(d.temperature_2m_min[i])}°–${Math.round(d.temperature_2m_max[i])}°  ☔ ${d.precipitation_probability_max[i] ?? '—'}%`).join('\n');
    return send(jid, { text: `🌍 *${p.name}*${p.admin1 ? ', ' + p.admin1 : ''}${p.country ? ', ' + p.country : ''}\n\n${WMO[c.weather_code] || '🌡️'}\n🌡️ ${c.temperature_2m}°C  (දැනෙන්නේ ${c.apparent_temperature}°C)\n💧 Humidity ${c.relative_humidity_2m}%  •  💨 ${c.wind_speed_10m} km/h  •  ☔ ${c.precipitation} mm\n\n*📅 දින 3*\n${days}` }, { quoted: msg });
}

// ───────── lyrics (lrclib.net) ─────────
async function cmdLyrics(send, jid, msg, args) {
    const q = args.join(' ').trim();
    if (!q) return send(jid, { text: '🎤 *.lyrics <සින්දුවේ නම>*\nඋදා: .lyrics faded alan walker' }, { quoted: msg });
    const list = await getJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { 'Lrclib-Client': 'kaviz-md-bot' });
    const s = (list || []).find((x) => x.plainLyrics) || null;
    if (!s) return send(jid, { text: `😢 "${q}" lyrics හම්බුණේ නෑ` }, { quoted: msg });
    const ly = s.plainLyrics.length > 3500 ? s.plainLyrics.slice(0, 3500) + '\n...' : s.plainLyrics;
    return send(jid, { text: `🎤 *${s.trackName}*\n👤 ${s.artistName}${s.albumName ? '  •  💿 ' + s.albumName : ''}\n\n${ly}` }, { quoted: msg });
}

// ───────── sticker → image ─────────
async function cmdToImg(send, jid, msg) {
    const m = mediaOf(msg, ['sticker']);
    if (!m) return send(jid, { text: '🖼️ Sticker එකකට reply කරලා *.toimg* ගහන්න' }, { quoted: msg });
    if (m.src.message.stickerMessage?.isAnimated) return send(jid, { text: '⚠️ Animated stickers image එකක් කරන්න බෑ — සාමාන්‍ය sticker එකක් try කරන්න' }, { quoted: msg });
    const buf = await mediaDownloader(m.src);
    const ff = await media.getBin('ffmpeg');
    const i = path.join(TMP(), `ti-${Date.now().toString(36)}.webp`), o = i.replace(/\.webp$/, '.png');
    fs.writeFileSync(i, buf);
    try {
        const r = await media._run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', i, o], 60e3);
        if (r.code !== 0 || !fs.existsSync(o)) throw new Error('convert fail');
        return await send(jid, { image: fs.readFileSync(o), caption: '🖼️ Sticker → Image' }, { quoted: msg });
    } finally { fs.rmSync(i, { force: true }); fs.rmSync(o, { force: true }); }
}

// ───────── media → link ─────────
const mirror = require('./mirror');
async function upload(buf, name) {
    const r = await mirror.uploadBuffer(buf, name);
    return { url: r.url, perm: false, days: r.days, host: r.host };
}
async function cmdToUrl(send, jid, msg, args, react) {
    const m = mediaOf(msg);
    if (!m) return send(jid, { text: `🔗 media එකකට reply කරලා *.tourl*\n${foot('photo · video · audio · file → 🔗 link')}` }, { quoted: msg });
    const buf = await mediaDownloader(m.src);
    if (buf.length > 190 * 1048576) return send(jid, { text: '❌ 190 MB ට වඩා ලොකුයි' }, { quoted: msg });
    const mm = m.src.message[m.kind + 'Message'] || {};
    const ext = (mm.fileName && path.extname(mm.fileName)) || ({ image: '.jpg', video: '.mp4', sticker: '.webp', audio: '.mp3' }[m.kind] || '.bin');
    const r = await upload(buf, 'kaviz-' + Date.now().toString(36) + ext);
    react?.('✅');
    return send(jid, { text: `🔗 ${r.url}\n${foot(`${(buf.length / 1048576).toFixed(1)} MB · ${r.days}d · ${r.host} · public`)}` }, { quoted: msg });
}

// ───────── media → transfer.archivete.am link (.uploadtra — v2.82, bounded v2.87) ─────────
async function cmdUploadTra(send, jid, msg, args, react) {
    const m = mediaOf(msg);
    if (!m) return send(jid, { text: `📤 media එකකට reply කරලා *.uploadtra*\n${foot('photo · video · audio · file → transfer.archivete.am 🔗')}` }, { quoted: msg });
    const st = await send(jid, { text: '📤 transfer upload…' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const buf = await mediaDownloader(m.src);
        if (!buf || !buf.length) throw new Error('media එක හිස්');
        if (buf.length > 190 * 1048576) return await edit('❌ 190 MB ට වඩා ලොකුයි — මේ host එකට upload කරන්න බෑ');
        const mm = m.src.message[m.kind + 'Message'] || {};
        const base = (mm.fileName && path.basename(mm.fileName)) || ('kaviz-' + Date.now().toString(36) + ({ image: '.jpg', video: '.mp4', sticker: '.webp', audio: '.mp3' }[m.kind] || '.bin'));
        const mb = (buf.length / 1048576).toFixed(1);
        // v2.87 FIX: 104MB upload එකක් හැම වෙලාවෙම hang වෙනවා — undici fetch වල total-timeout නෑ,
        // slow/blocked host එකක් (හෝ route-cache එකේ හොරට poolproxy තියෙනවා නම්) card එක හිමින්ම තියනවා.
        // හැම attempt එකකටම bounded budget + liveness tick + one fresh-route retry → කවදාවත් hang නෑ.
        const budgetMs = buf.length > 50 * 1048576 ? 420e3 : 150e3;
        const t0 = Date.now();
        await edit(`📤 ${mb} MB upload…`);
        const tick = setInterval(() => edit(`📤 ${mb} MB upload… ⏱ ${Math.round((Date.now() - t0) / 1000)}s (ලොකු files වලට වෙලා යන්න පුළුවන්)`), 20000);
        let r;
        try {
            r = await mirror.upTransfer(buf, base, { signal: AbortSignal.timeout(budgetMs) });
        } catch (e1) {
            clearInterval(tick);
            try {
                await edit(`📤 ${mb} MB retry… (පළවෙනි attempt එක slow වෙලා)`);
                r = await mirror.upTransfer(buf, base, { signal: AbortSignal.timeout(180e3) });
            } catch (e2) {
                clearInterval(tick);
                // v2.90: transfer දෙකම fail → gofile auto-fallback ("කැඩිලා" host එකට upload එක නැති වෙන්නේ නෑ)
                try {
                    await edit(`📤 ${mb} MB gofile fallback… (transfer.archivete.am මේ file එකට slow/block)`);
                    const g = await mirror.upGofile(buf, base, { signal: AbortSignal.timeout(180e3) });
                    react?.('✅');
                    return await edit(`🔗 ${g.url}\n${foot(`${mb} MB · gofile.io (transfer fallback) · ~10d inactive`)}`);
                } catch (e3) {
                    return await edit(`❌ upload fail: transfer: ${String(e2.message || e2).slice(0, 90)} · gofile: ${String(e3.message || e3).slice(0, 90)}\n> ටිකකින් නැවත try කරන්න, නැත්නම් *.uploadtm* / *.tourl* (qu.ax)`);
                }
            }
        }
        clearInterval(tick);
        react?.('✅');
        return await edit(`🔗 ${r.url}\n${foot(`${mb} MB · ~${r.days}d · ${r.host === 'transfer' ? 'transfer.archivete.am' : r.host}${r.del ? '\n🗑️ delete: ' + r.del : ''}`)}`);
    } catch (e) {
        return await edit(`❌ upload fail: ${String(e.message || e).slice(0, 140)}\n> ආයෙත් try කරන්න, නැත්නම් *.tourl* (qu.ax host එක)`);
    }
}

// ───────── media → gofile.io link (.uploadgo — v2.90) ─────────
async function cmdUploadGo(send, jid, msg, args, react) {
    const m = mediaOf(msg);
    if (!m) return send(jid, { text: `📤 media එකකට reply කරලා *.uploadgo*\n${foot('photo · video · audio · file → gofile.io 🔗')}` }, { quoted: msg });
    const st = await send(jid, { text: '📤 gofile upload…' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const buf = await mediaDownloader(m.src);
        if (!buf || !buf.length) throw new Error('media එක හිස්');
        if (buf.length > 190 * 1048576) return await edit('❌ 190 MB ට වඩා ලොකුයි — මේ host එකට upload කරන්න බෑ');
        const mm = m.src.message[m.kind + 'Message'] || {};
        const base = (mm.fileName && path.basename(mm.fileName)) || ('kaviz-' + Date.now().toString(36) + ({ image: '.jpg', video: '.mp4', sticker: '.webp', audio: '.mp3' }[m.kind] || '.bin'));
        const mb = (buf.length / 1048576).toFixed(1);
        // bounded budget + liveness tick + one retry (v2.87 .uploadtra pattern — host එක කොහෙ හරි slow උනත් card එක හිමින්ම තියන්නේ නෑ)
        const budgetMs = buf.length > 50 * 1048576 ? 420e3 : 150e3;
        const t0 = Date.now();
        await edit(`📤 ${mb} MB gofile upload…`);
        const tick = setInterval(() => edit(`📤 ${mb} MB gofile upload… ⏱ ${Math.round((Date.now() - t0) / 1000)}s (ලොකු files වලට වෙලා යන්න පුළුවන්)`), 20000);
        let r;
        try {
            r = await mirror.upGofile(buf, base, { signal: AbortSignal.timeout(budgetMs) });
        } catch (e1) {
            clearInterval(tick);
            try {
                await edit(`📤 ${mb} MB retry… (පළවෙනි attempt එක slow වෙලා)`);
                r = await mirror.upGofile(buf, base, { signal: AbortSignal.timeout(180e3) });
            } catch (e2) {
                return await edit(`❌ gofile upload fail: ${String(e2.message || e2).slice(0, 120)}\n> ටිකකින් නැවත try කරන්න, නැත්නම් *.uploadtra* / *.uploadtm* / *.tourl*`);
            }
        }
        clearInterval(tick);
        react?.('✅');
        return await edit(`🔗 ${r.url}\n${foot(`${mb} MB · gofile.io · ~10d inactive · ${path.basename(base)}`)}\n> 💾 මේ link එක browser එකෙන් download කරන්න (gofile bot downloads block කරනවා) · bot-uploadable: *.uploadtm* / *.uploadtra*`);
    } catch (e) {
        return await edit(`❌ upload fail: ${String(e.message || e).slice(0, 140)}\n> ආයෙත් try කරන්න, නැත්නම් *.tourl* (qu.ax host එක)`);
    }
}

// ───────── media → tmpfiles.org link (.uploadtm — v2.90) ─────────
async function cmdUploadTm(send, jid, msg, args, react) {
    const m = mediaOf(msg);
    if (!m) return send(jid, { text: `📤 media එකකට reply කරලා *.uploadtm*\n${foot('photo · video · audio · file → tmpfiles.org 🔗 (60 min)')}` }, { quoted: msg });
    const st = await send(jid, { text: '📤 tmpfiles upload…' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const buf = await mediaDownloader(m.src);
        if (!buf || !buf.length) throw new Error('media එක හිස්');
        if (buf.length > mirror.TMPFILES_MAX) return await edit(`❌ tmpfiles cap = 100 MB — මේ file එක ${(buf.length / 1048576).toFixed(1)} MB\n> *.uploadgo* / *.uploadtra* use කරන්න`);
        const mm = m.src.message[m.kind + 'Message'] || {};
        const base = (mm.fileName && path.basename(mm.fileName)) || ('kaviz-' + Date.now().toString(36) + ({ image: '.jpg', video: '.mp4', sticker: '.webp', audio: '.mp3' }[m.kind] || '.bin'));
        const mb = (buf.length / 1048576).toFixed(1);
        const budgetMs = buf.length > 50 * 1048576 ? 420e3 : 150e3;
        const t0 = Date.now();
        await edit(`📤 ${mb} MB tmpfiles upload…`);
        const tick = setInterval(() => edit(`📤 ${mb} MB tmpfiles upload… ⏱ ${Math.round((Date.now() - t0) / 1000)}s`), 20000);
        let r;
        try {
            r = await mirror.upTmpfiles(buf, base, { signal: AbortSignal.timeout(budgetMs) });
        } catch (e1) {
            clearInterval(tick);
            try {
                await edit(`📤 ${mb} MB retry… (පළවෙනි attempt එක slow වෙලා)`);
                r = await mirror.upTmpfiles(buf, base, { signal: AbortSignal.timeout(180e3) });
            } catch (e2) {
                return await edit(`❌ tmpfiles upload fail: ${String(e2.message || e2).slice(0, 120)}\n> ටිකකින් නැවත try කරන්න, නැත්නම් *.uploadgo* / *.uploadtra* / *.tourl*`);
            }
        }
        clearInterval(tick);
        react?.('✅');
        return await edit(`🔗 ${r.url}\n${foot(`${mb} MB · tmpfiles.org · ⏳ ~60 min (${path.basename(base)})`)}\n> ⚠️ file එක මිනිත්තු 60කින් auto-delete — ඉක්මනට share කරන්න\n> 🤖 bot download වලටත් වැඩ: *.download ${r.url}*`);
    } catch (e) {
        return await edit(`❌ upload fail: ${String(e.message || e).slice(0, 140)}\n> ආයෙත් try කරන්න, නැත්නම් *.uploadgo* / *.tourl*`);
    }
}

// ───────── URL → mirror link (අනිත් bots වල /dl link UX එක) ─────────
async function cmdMirror(send, jid, msg, args, react) {
    const u = (args.join(' ').match(URL_RE) || [])[0];
    if (!u) {
        if (mediaOf(msg)) return cmdToUrl(send, jid, msg, args, react);   // media reply → .tourl වගේම
        return send(jid, { text: `🪞 *.mirror <link>* — file එක → 🔗 direct share link\n${foot('media reply එකකට ගහුවොත් .tourl වගේම')}` }, { quoted: msg });
    }
    const { download } = require('./downloader');
    const st = await send(jid, { text: `🪞 ${cut(u, 100)}…` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    let last = 0;
    const onProgress = (loaded, total) => {
        const now = Date.now();
        if (now - last < 8000) return;
        last = now;
        const pct = total ? Math.floor(loaded * 100 / total) : null;
        edit(`🪞 ${pct === null ? '' : bar(pct) + ` ${pct}%\n`}${(loaded / 1048576).toFixed(1)} MB`);
    };
    const files = await download(u, onProgress, { stream: false });
    let out = '';
    for (const f of files) {
        await edit(`🪞 upload… (${(f.size / 1048576).toFixed(1)} MB)`);
        const r = await mirror.uploadFile(f.path, f.name);
        out += `${out ? '\n' : ''}🔗 *${f.name}*\n${r.url}\n${foot(`${(f.size / 1048576).toFixed(1)} MB · ${r.days}d · ${r.host}`)}\n`;
        if (f.path) fs.rm(f.path, { force: true }, () => { });
    }
    react?.('✅');
    await edit(out + foot('public link — sensitive files එපා'));
}

// ───────── web tools ─────────
async function cmdSs(send, jid, msg, args) {
    const u = (args.join(' ').match(URL_RE) || [])[0] || (args[0] && /^[\w.-]+\.[a-z]{2,}/i.test(args[0]) ? 'https://' + args[0] : null);
    if (!u) return send(jid, { text: '📸 *.ss <website>*  — website එකේ screenshot\nඋදා: .ss google.com' }, { quoted: msg });
    const r = await fetch(`https://image.thum.io/get/width/1280/crop/900/noanimate/${u}`, { headers: UA });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) throw new Error('screenshot fail (' + r.status + ')');
    return send(jid, { image: Buffer.from(await r.arrayBuffer()), caption: `📸 ${u}` }, { quoted: msg });
}
async function cmdQr(send, jid, msg, args) {
    const t = args.join(' ').trim() || quotedText(msg);
    if (!t) return send(jid, { text: '🔳 *.qr <text / link>*  — QR code එකක් හදනවා' }, { quoted: msg });
    const r = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data=${encodeURIComponent(t.slice(0, 900))}`);
    if (!r.ok) throw new Error('QR fail');
    return send(jid, { image: Buffer.from(await r.arrayBuffer()), caption: '🔳 ' + t.slice(0, 200) }, { quoted: msg });
}
async function cmdShort(send, jid, msg, args) {
    const u = (args.join(' ').match(URL_RE) || [])[0] || (quotedText(msg).match(URL_RE) || [])[0];
    if (!u) return send(jid, { text: '✂️ *.short <link>*  — link එක කෙටි කරනවා' }, { quoted: msg });
    const t = (await (await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`)).text()).trim();
    if (!/^https?:\/\//.test(t)) throw new Error(t.slice(0, 100));
    return send(jid, { text: `✂️ ${t}` }, { quoted: msg });
}
function cmdCalc(send, jid, msg, args) {
    const raw = args.join(' ').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').trim();
    if (!raw) return send(jid, { text: '🧮 *.calc <ගණනය>*\nඋදා: .calc (25+15)*3  •  .calc 2^10  •  .calc 15% of 2000  •  .calc sqrt(144)' }, { quoted: msg });
    let e = raw.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)').replace(/\^/g, '**').replace(/\bpi\b/g, 'PI');
    if (!/^[\d+\-*/().\s]*$/.test(e.replace(/\b(sqrt|sin|cos|tan|log|log10|abs|round|floor|ceil|PI)\b/g, ''))) return send(jid, { text: '❌ ඉලක්කම් සහ + − × ÷ ^ % ( ) විතරයි' }, { quoted: msg });
    e = e.replace(/\b(sqrt|sin|cos|tan|log10|log|abs|round|floor|ceil|PI)\b/g, 'Math.$1');
    let v; try { v = Function('"use strict";return (' + e + ')')(); } catch { v = NaN; }
    if (typeof v !== 'number' || !isFinite(v)) return send(jid, { text: '❌ ගණනය වැරදියි' }, { quoted: msg });
    return send(jid, { text: `🧮 ${raw}\n= *${+v.toPrecision(12)}*` }, { quoted: msg });
}
async function cmdGithub(send, jid, msg, args) {
    const u = (args[0] || '').replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').split('/')[0];
    if (!u) return send(jid, { text: '🐙 *.github <username>*  — GitHub profile එක' }, { quoted: msg });
    const r = await fetch(`https://api.github.com/users/${encodeURIComponent(u)}`, { headers: { 'User-Agent': 'kaviz-md-bot' } });
    if (r.status === 404) return send(jid, { text: `❌ "${u}" කියලා GitHub user කෙනෙක් නෑ` }, { quoted: msg });
    const d = await r.json();
    const cap = `🐙 *${d.name || d.login}*  (@${d.login})\n${d.bio ? '📝 ' + d.bio + '\n' : ''}\n📦 Repos: ${d.public_repos}  •  👥 Followers: ${fmtNum(d.followers)}  •  ➡️ Following: ${d.following}\n${d.location ? '📍 ' + d.location + '\n' : ''}${d.blog ? '🌐 ' + d.blog + '\n' : ''}📅 ${new Date(d.created_at).toLocaleDateString('en-GB')}\n🔗 ${d.html_url}`;
    try { return await send(jid, { image: { url: d.avatar_url }, caption: cap }, { quoted: msg }); } catch { return send(jid, { text: cap }, { quoted: msg }); }
}
async function cmdImagine(send, jid, msg, args) {
    const p = args.join(' ').trim() || quotedText(msg);
    if (!p) return send(jid, { text: '🎨 *.imagine <විස්තරය>*  — AI image එකක් හදනවා\nඋදා: .imagine a cute robot drinking tea, anime style' }, { quoted: msg });
    let prompt = p;
    if (SI.test(p)) { try { prompt = (await translate(p, 'en')).text; } catch { } }
    // 🌸 v2.69 — KEYED Pollinations first (gen.pollinations.ai — no anonymous 402 roulette, faster + reliable)
    try {
        const P = require('./pollinations');
        if (P.hasKey()) {
            const buf = await P.imageBuf(prompt);
            return send(jid, { image: buf, caption: `🎨 ${p.slice(0, 200)}` }, { quoted: msg });
        }
    } catch { }   // keyed fail → old anonymous loop එකට
    let last = '';
    for (let i = 0; i < 3; i++) {   // free tier = rate limited → wait + retry
        if (i) await new Promise((r) => setTimeout(r, 8000 * i));
        const seed = Math.floor(Math.random() * 1e9);
        try {
            const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 400))}?width=1024&height=1024&nologo=true&safe=true&seed=${seed}`, { headers: UA, signal: AbortSignal.timeout(90e3) });
            const ct = r.headers.get('content-type') || '';
            const buf = Buffer.from(await r.arrayBuffer());
            if (r.ok && ct.startsWith('image/') && buf.length > 2000) return send(jid, { image: buf, caption: `🎨 ${p.slice(0, 200)}` }, { quoted: msg });
            last = String(r.status);
        } catch (e) { last = e.name === 'TimeoutError' ? 'timeout' : e.message; }
    }
    throw new Error(`AI image server එක busy (${last}) — විනාඩියකින් විතර ආයෙත් try කරන්න`);
}

// ───────── WhatsApp tools ─────────
async function cmdDel(send, jid, msg, sock, me) {
    const ci = ctxOf(msg);
    if (!ci?.stanzaId) return send(jid, { text: '🗑️ මකන්න ඕනේ message එකට reply කරලා *.del* ගහන්න' }, { quoted: msg });
    const bare = (j) => j ? j.split('@')[0].split(':')[0] + '@' + j.split('@')[1] : j;
    const mine = !ci.participant || [me.pn, me.lid].includes(bare(ci.participant));
    const key = { remoteJid: jid, id: ci.stanzaId, fromMe: mine, ...(jid.endsWith('@g.us') && ci.participant ? { participant: ci.participant } : {}) };
    await sock.sendMessage(jid, { delete: key });
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch { }   // remove the .del command too
}
async function cmdSetPp(send, jid, msg, sock, me) {
    const m = mediaOf(msg, ['image']);
    if (!m) return send(jid, { text: '🖼️ Photo එකකට reply කරලා *.setpp* ගහන්න → ඔයාගේ WhatsApp profile photo එක' }, { quoted: msg });
    const buf = await mediaDownloader(m.src);
    await sock.updateProfilePicture(me.pn, buf);
    return send(jid, { text: '✅ Profile photo එක වෙනස් කළා' }, { quoted: msg });
}

// ───────── fun ─────────
async function cmdJoke(send, jid, msg) { const j = await getJson('https://icanhazdadjoke.com/', { Accept: 'application/json' }); return send(jid, { text: '😂 ' + j.joke }, { quoted: msg }); }
async function cmdFact(send, jid, msg, args) {
    let t = null;
    for (const [u, pick] of [['https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', (j) => j.text], ['https://api.popcat.xyz/fact', (j) => j.fact], ['https://catfact.ninja/fact', (j) => j.fact]]) {
        try { t = pick(await getJson(u)); if (t) break; } catch { }
    }
    if (!t) throw new Error('Fact servers busy — ටිකකින් ආයෙත් try කරන්න');
    const en = t; if ((args[0] || '') !== 'en') { try { t += '\n\n🇱🇰 ' + (await translate(en, 'si')).text; } catch { } }
    return send(jid, { text: '🧠 *Fact*\n\n' + t }, { quoted: msg });
}
async function cmdQuote(send, jid, msg) { const j = await getJson('https://zenquotes.io/api/random'); return send(jid, { text: `💬 _"${j[0].q}"_\n\n— *${j[0].a}*` }, { quoted: msg }); }
const BALL = ['✅ ඔව්, අනිවාර්යයෙන්ම', '✅ ඔව්', '🤔 බොහෝවිට ඔව්', '🔮 ලකුණු හොඳයි', '😶 දැන් කියන්න බෑ, ආයෙත් අහන්න', '🤷 පස්සේ අහන්න', '🙅 මම හිතන්නේ නෑ', '❌ නෑ', '❌ කොහෙත්ම නෑ', '😬 ලකුණු එච්චර හොඳ නෑ'];
function cmd8ball(send, jid, msg, args) {
    if (!args.length) return send(jid, { text: '🎱 *.8ball <ප්‍රශ්නය>*' }, { quoted: msg });
    return send(jid, { text: `🎱 _${args.join(' ').slice(0, 200)}_\n\n${BALL[Math.floor(Math.random() * BALL.length)]}` }, { quoted: msg });
}

const CMDS = { '.tts': cmdTts, '.say': cmdTts, '.stt': cmdStt, '.totext': cmdStt, '.tr': cmdTr, '.translate': cmdTr, '.weather': cmdWeather, '.lyrics': cmdLyrics, '.toimg': cmdToImg, '.tourl': cmdToUrl, '.url': cmdToUrl, '.uploadtra': cmdUploadTra, '.uploadgo': cmdUploadGo, '.uploadtm': cmdUploadTm, '.mirror': cmdMirror, '.link': cmdMirror, '.ss': cmdSs, '.qr': cmdQr, '.short': cmdShort, '.calc': cmdCalc, '.github': cmdGithub, '.imagine': cmdImagine, '.img': cmdImagine, '.joke': cmdJoke, '.fact': cmdFact, '.quote': cmdQuote, '.8ball': cmd8ball, '.del': null, '.delete': null, '.setpp': null };

async function handle(c, { send, jid, msg, rest, sock, me, react }) {
    if (!(c in CMDS)) return false;
    try {
        if (c === '.del' || c === '.delete') { if (!sock) throw new Error('WhatsApp connect වෙලා නෑ'); await cmdDel(send, jid, msg, sock, me); }
        else if (c === '.setpp') { if (!sock) throw new Error('WhatsApp connect වෙලා නෑ'); await cmdSetPp(send, jid, msg, sock, me); }
        else await CMDS[c](send, jid, msg, rest, react);
    } catch (e) { react?.('❌'); await send(jid, { text: '❌ ' + String(e.message).slice(0, 200) }, { quoted: msg }); }
    return true;
}

module.exports = { handle, CMDS: Object.keys(CMDS), translate, setMediaDownloader: (f) => { mediaDownloader = f; } };
