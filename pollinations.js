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

/** chat → text (OpenAI-compatible). model alias 'openai' = free nano-class; 429/402 → honest error */
async function chat(messages, { model = 'openai', timeout = 60e3 } = {}) {
    const models = [model, 'openai/gpt-5.4-nano'].filter((v, i, a) => v && a.indexOf(v) === i);
    let last = '';
    for (const m of models) {
        const r = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: auth({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ model: m, messages }),
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

/** speech → text (whisper-large-v3) — buf: Buffer, mime: audio/mpeg|audio/ogg; opus … */
async function sttText(buf, mime = 'audio/ogg', { model = 'whisper-large-v3', timeout = 120e3 } = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), 'audio.bin');
    fd.append('model', model);
    const r = await fetch(`${BASE}/v1/audio/transcriptions`, { method: 'POST', headers: auth(), body: fd, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('Pollinations stt ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
    const j = await r.json();
    return String(j?.text || '').trim();
}

module.exports = { key, hasKey, BASE, chat, imageBuf, ttsBuf, sttText };
