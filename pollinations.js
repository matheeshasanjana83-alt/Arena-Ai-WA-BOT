/**
 * pollinations.js — gen.pollinations.ai client (v2.69) — user's sk_ key
 *
 * FREE capabilities (live-probed 2026-10-19 with key sk_...RASg):
 *   text ✅ (openai/gpt-5.4-nano) · image ✅ (flux) · tts ✅ (nova) · stt ✅ (whisper-large-v3)
 *   embedding ✅ · realtime ✅ — video/3d need paid pollen (❌ for now)
 * Auth: Bearer KEY. Key resolution: env POLLI_API_KEY > settings.json polli > BAKED default.
 * Keys are managed from WhatsApp via .setkey polli <KEY> (ai.js setKey stores settings.polli).
 */
const fs = require('fs');
const path = require('path');
const SETTINGS = path.join(__dirname, 'settings.json');
const BAKED = 'sk_f7xWgHu5fqL38rBeiDW6l6CdDyOhRASg';   // default — .setkey polli <KEY> overrides

function key() {
    if (process.env.POLLI_API_KEY) return String(process.env.POLLI_API_KEY).trim();
    try { const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); if (s.polli) return String(s.polli).trim(); } catch { }
    return BAKED;
}
const hasKey = () => !!key();
const BASE = 'https://gen.pollinations.ai';
const auth = (extra) => ({ Authorization: `Bearer ${key()}`, ...(extra || {}) });

/** chat → text (OpenAI-compatible). model alias 'openai' = free nano-class; 429/402 → honest error.
 *  v2.70: max_tokens option (vision වගේ long answers වලට — නැත්නම් finish_reason=length + empty content) */
async function chat(messages, { model = 'openai', timeout = 60e3, max_tokens = 0 } = {}) {
    const models = [model, 'openai/gpt-5.4-nano'].filter((v, i, a) => v && a.indexOf(v) === i);
    let last = '';
    for (const m of models) {
        const r = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: auth({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ model: m, messages, ...(max_tokens ? { max_tokens } : {}) }),
            signal: AbortSignal.timeout(timeout),
        });
        if (r.ok) {
            const j = await r.json();
            const t = j?.choices?.[0]?.message?.content || '';
            if (t) return { text: t.trim(), model: 'Pollinations ' + m };
            last = 'empty answer';
            continue;
        }
        last = 'Pollinations ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120);
    }
    throw new Error(last || 'Pollinations chat fail');
}

/** image gen → Buffer (flux, keyed — no anonymous 402 roulette) */
async function imageBuf(prompt, { size = '1024x1024', model = 'flux', timeout = 120e3 } = {}) {
    const r = await fetch(`${BASE}/image/${encodeURIComponent(String(prompt || '').slice(0, 400))}?model=${model}&width=${size.split('x')[0]}&height=${size.split('x')[1]}&nologo=true`, {
        headers: auth(), signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) throw new Error('Pollinations image ' + r.status);
    const ct = String(r.headers.get('content-type') || '');
    const buf = Buffer.from(await r.arrayBuffer());
    if (!ct.startsWith('image/') || buf.length < 2000) throw new Error('Pollinations image bad output');
    return buf;
}

/** tts → Buffer mp3 (voices: nova/alloy/echo/fable/onyx/shimmer + 30+ ElevenLabs) */
async function ttsBuf(text, { voice = 'nova', timeout = 90e3 } = {}) {
    const r = await fetch(`${BASE}/audio/${encodeURIComponent(String(text || '').slice(0, 900))}?voice=${voice}`, {
        headers: auth(), signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) throw new Error('Pollinations tts ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 800) throw new Error('Pollinations tts bad output');
    return buf;
}

/** speech → text (whisper-large-v3) — buf: Buffer, mime: audio/mpeg|audio/ogg; opus …
 *  🐛 v2.97 FIX: filename hardcoded as audio.bin නිසා Pollinations whisper 400 'extension "bin" not
 *  supported' — WhatsApp voice notes හැම එකක්ම fail (user screenshot 2026-10-30). Ext එක දැන් mime
 *  එකෙන් derive වෙනවා (whisper allowlist: ogg/oga/opus→ogg, mp3, mp4, m4a, wav, webm, flac…).
 *  ⚡ v2.98: language opt (OpenAI-compatible form field — 'si' forced-decode = Sinhala audio වලට
 *  English-hallucination failure mode එක නැති කරනවා; probe: auto='Oh, yeah.' → lang=si='(empty)').
 *  ⚡ v2.99: prompt opt — whisper-large-v3 සිංහලට පාරම්පරිකව බෑ (probe 2026-10-30: kohomada→'こうまで',
 *  ponnaya→' Be me.', sentence→',,,,,,,…'); ඒත් gpt-4o-transcribe + Sinhala-script prompt = සිංහල
 *  ඇත්තටම ඇහෙනවා (kohomada→'කොහොමද.' ×3 stable, sentence එක word-for-word). prompt field එක whisper
 *  endpoint එකම pass-through — model option එකෙන් gpt-4o-transcribe select වෙනවා. */
function sttExtName(mime = 'audio/ogg') {   // v2.98: exported — Groq STT stage (ai.js transcribeAudio) එකත් ඒකම allowlist එක use කරනවා
    const m = String(mime || 'audio/ogg').split(';')[0].trim().toLowerCase() || 'audio/ogg';
    const sub = m.split('/')[1] || '';
    return STT_EXT[m] || (/^[a-z0-9]{2,5}$/.test(sub) ? sub : 'ogg');   // known mime → map · sane subtype → as-is · garbage → ogg (WhatsApp dominant)
}
const STT_EXT = {
    'audio/ogg': 'ogg', 'audio/oga': 'oga', 'audio/opus': 'ogg', 'application/ogg': 'ogg',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpga': 'mpga', 'audio/mpeg3': 'mp3',
    'audio/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/aacp': 'm4a',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
    'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/webm': 'webm', 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/mpeg': 'mpeg',
};
async function sttText(buf, mime = 'audio/ogg', { model = 'whisper-large-v3', timeout = 120e3, language = '', prompt = '' } = {}) {
    const m = String(mime || 'audio/ogg').split(';')[0].trim().toLowerCase() || 'audio/ogg';
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: m }), 'audio.' + sttExtName(m));
    fd.append('model', model);
    if (language) fd.append('language', String(language));
    if (prompt) fd.append('prompt', String(prompt));   // v2.99 — gpt-4o-transcribe Sinhala-script steering
    const r = await fetch(`${BASE}/v1/audio/transcriptions`, { method: 'POST', headers: auth(), body: fd, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('Pollinations stt ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
    const j = await r.json();
    return String(j?.text || '').trim();
}

module.exports = { key, hasKey, BASE, chat, imageBuf, ttsBuf, sttText, sttExtName };
