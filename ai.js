/**
 * .ai — free AI chat (Google Gemini + Groq + Z.ai GLM). Keys are stored in settings.json
 * (set them from WhatsApp:  .setkey gemini <KEY>   /   .setkey groq <KEY>   /   .setkey zai <KEY>)
 */
const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(__dirname, 'settings.json');
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const saveSettings = (s) => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));

const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-lite-latest'];
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'];
const ZAI_MODELS = ['glm-4.6', 'glm-4.5-air', 'glm-4.5-flash']; // best → free; balance-dead models remembered per-session (fail fast)
const zaiDead = new Set();

const SYSTEM = `You are "KAVIZ MD V1", a friendly WhatsApp AI assistant living in the user's own WhatsApp.
- IDENTITY: You are always "KAVIZ MD V1". If the user tells you their name (e.g. "I'm Suziy"), that is the USER's name — remember it, never call yourself by it, never mirror the user's identity.
- LANGUAGE: reply in the same language the user writes in (Sinhala → Sinhala, English → English, Singlish → Singlish).
- SINHALA QUALITY: use correct everyday Sinhala with real words only. NEVER invent non-existent Sinhala words, never repeat words pointlessly, never write broken sentences. If you don't know a word, use a simpler correct one. Write like a clear-speaking friend, not a machine.
- Be short and clear (WhatsApp style). Simple formatting: *bold*, _italic_, lists with • .
- If you don't know or are not sure, say so honestly. Never invent facts.
- You are powered by free models (Google Gemini / Groq / Z.ai GLM). If asked, say so honestly.
- Memory: you keep the recent chat history of THIS conversation (up to ~30 turns, auto-cleared after 3 days). If the user asks about something that is NOT in this conversation history, honestly say you don't have it in memory — never pretend to remember or invent past events.`;

// ── 🧠 Persistent memory (v2.47) — ai_memory.json: restart/redeploy වුණත් කතාව මතක තියෙනවා
const MEM_FILE = process.env.ARENA_AI_MEMORY_FILE || path.join(__dirname, 'ai_memory.json');
const MAX_TURNS = Math.max(5, parseInt(process.env.ARENA_AI_TURNS || '30', 10));          // chat එකක තියාගන්න turns ගණන
const MEM_TTL_DAYS = Math.max(1, parseInt(process.env.ARENA_AI_MEMORY_DAYS || '3', 10));  // දවස් 3ට පරණ messages auto-clear (memory full නොවෙන්න)
const TTL_MS = MEM_TTL_DAYS * 86400e3;

const history = new Map(); // chat jid -> [{role:'user'|'assistant', text, t}]

function loadMemory() {
    try {
        const j = JSON.parse(fs.readFileSync(MEM_FILE, 'utf8'));
        const now = Date.now();
        for (const [jid, c] of Object.entries(j.chats || {})) {
            if (!Array.isArray(c.msgs) || !c.msgs.length) continue;
            const fresh = c.msgs.filter(m => m && m.text && now - (m.t || 0) < TTL_MS).slice(-MAX_TURNS * 2);
            if (fresh.length) history.set(jid, fresh);
        }
    } catch { } // first run / corrupt file → අලුතෙන් පටන් ගන්නවා
}
loadMemory();

let saveTimer = null;
function saveMemoryNow() { // atomic write (tmp + rename) — crash වුණත් file corrupt වෙන්නේ නෑ
    try {
        const now = Date.now(), chats = {};
        for (const [jid, h] of history) {
            const fresh = h.filter(m => now - (m.t || 0) < TTL_MS);
            if (fresh.length) chats[jid] = { msgs: fresh.map(m => ({ role: m.role, text: String(m.text).slice(0, 2000), t: m.t || now })), updated: now };
        }
        const tmp = MEM_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ v: 1, savedAt: now, chats }));
        fs.renameSync(tmp, MEM_FILE);
    } catch (e) { try { console.error('[ai] 🧠 memory save fail:', e.message); } catch { } }
}
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveMemoryNow(); }, 2500);
    if (saveTimer.unref) saveTimer.unref();
}
process.on('exit', () => { if (saveTimer) { try { saveMemoryNow(); } catch { } } }); // pending changes → exit එකේදී sync save
setInterval(() => { // 🧹 sweep — TTL ඉවර messages + හිස් chats මකනවා
    const now = Date.now();
    for (const [jid, h] of history) {
        const fresh = h.filter(m => now - (m.t || 0) < TTL_MS);
        if (fresh.length) { if (fresh.length !== h.length) history.set(jid, fresh); } else history.delete(jid);
    }
    scheduleSave();
}, 30 * 60e3).unref();

function getKeys() {
    const s = loadSettings();
    return {
        gemini: process.env.GEMINI_API_KEY || s.gemini || '',
        groq: process.env.GROQ_API_KEY || s.groq || '',
        zai: process.env.ZAI_API_KEY || s.zai || ''
    };
}

function setKey(provider, key) {
    const s = loadSettings();
    if (key) s[provider] = key; else delete s[provider];
    saveSettings(s);
}

function apiError(provider, status, body) {
    let msg = '';
    try { const j = JSON.parse(body); msg = j.error?.message || j.message || ''; } catch { msg = String(body).slice(0, 200); }
    const e = new Error(`${provider} ${status}: ${msg}`);
    e.status = status;
    e.modelMissing = status === 404 || /not found|does not exist|decommissioned|not supported|insufficient balance|no resource package|recharge/i.test(msg);
    return e;
}

async function askGemini(key, msgs) {
    let lastErr;
    for (const model of GEMINI_MODELS) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM }] },
                contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
                generationConfig: { maxOutputTokens: 2048, temperature: 0.6 }
            })
        });
        const body = await r.text();
        if (!r.ok) { lastErr = apiError('Gemini', r.status, body); if (lastErr.modelMissing) continue; throw lastErr; }
        const j = JSON.parse(body);
        const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (!text) throw new Error('Gemini empty answer (' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || '?') + ')');
        return { text, model: 'Gemini ' + model };
    }
    throw lastErr;
}

async function askGroq(key, msgs) {
    let lastErr;
    for (const model of GROQ_MODELS) {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model, temperature: 0.6, max_tokens: 2048,
                messages: [{ role: 'system', content: SYSTEM }, ...msgs.map(m => ({ role: m.role, content: m.text }))]
            })
        });
        const body = await r.text();
        if (!r.ok) { lastErr = apiError('Groq', r.status, body); if (lastErr.modelMissing) continue; throw lastErr; }
        const text = (JSON.parse(body).choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('Groq empty answer');
        return { text, model: 'Groq ' + model };
    }
    throw lastErr;
}

async function askZai(key, msgs) {
    let lastErr;
    for (const model of ZAI_MODELS) {
        if (zaiDead.has(model)) continue;
        const r = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model, temperature: 0.6, max_tokens: 2048,
                thinking: { type: 'disabled' }, // GLM hybrid-reasoning OFF → WhatsApp speed (reasoning_content එක tokens කනවා)
                messages: [{ role: 'system', content: SYSTEM }, ...msgs.map(m => ({ role: m.role, content: m.text }))]})
        });
        const body = await r.text();
        const j = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        // balance error = HTTP 429 + code 1113 (Z.ai); 200-body error වුණත් catch කරනවා
        if (!r.ok || j.error) {
            lastErr = apiError('Z.ai', r.ok ? 500 : r.status, body);
            if (lastErr.modelMissing) { zaiDead.add(model); continue; } // balance නැති model → මතක තියාගෙන ඊළඟ එකට
            throw lastErr;
        }
        const text = (j.choices?.[0]?.message?.content || '').trim(); // reasoning_content reply එකට යන්නේ නෑ
        if (!text) throw new Error('Z.ai empty answer (' + (j.choices?.[0]?.finish_reason || '?') + ')');
        return { text, model: 'GLM ' + model };
    }
    throw lastErr || new Error('Z.ai: වැඩ කරන model එකක් නෑ (balance/models බලන්න)');
}

/** Markdown → WhatsApp formatting */
function toWhatsApp(t) {
    return t
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/__(.+?)__/g, '_$1_')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .trim();
}

/** ask with memory; tries Gemini → Groq → Z.ai */
async function ask(chatId, question) {
    const keys = getKeys();
    if (!keys.gemini && !keys.groq && !keys.zai) {
        const e = new Error('NO_KEY');
        e.noKey = true;
        throw e;
    }
    const now = Date.now();
    const h = (history.get(chatId) || []).filter(m => now - (m.t || now) < TTL_MS); // 🧠 TTL prune
    const msgs = [...h, { role: 'user', text: question }];
    const errors = [];
    for (const [name, fn] of [['gemini', askGemini], ['groq', askGroq], ['zai', askZai]]) {
        if (!keys[name]) continue;
        try {
            const res = await fn(keys[name], msgs);
            const text = toWhatsApp(res.text);
            const t = Date.now();
            h.push({ role: 'user', text: question, t }, { role: 'assistant', text, t });
            while (h.length > MAX_TURNS * 2) h.shift();
            history.set(chatId, h);
            scheduleSave();
            return { text, model: res.model };
        } catch (e) { errors.push(e.message); }
    }
    throw new Error(errors.join('\n'));
}

function reset(chatId) { history.delete(chatId); scheduleSave(); }

function splitLong(text, size = 3500) {
    const parts = [];
    while (text.length > size) {
        let cut = text.lastIndexOf('\n', size);
        if (cut < size * 0.5) cut = size;
        parts.push(text.slice(0, cut));
        text = text.slice(cut).trimStart();
    }
    if (text) parts.push(text);
    return parts;
}

function stats(chatId) { // 🧠 .ai memory card data
    const now = Date.now();
    let msgs = 0, oldest = Infinity;
    for (const h of history.values()) for (const m of h) { msgs++; if (m.t && m.t < oldest) oldest = m.t; }
    const mine = (history.get(chatId) || []).filter(m => now - (m.t || now) < TTL_MS);
    let fileKB = 0; try { fileKB = Math.round(fs.statSync(MEM_FILE).size / 1024 * 10) / 10; } catch { }
    return {
        chats: history.size, msgs, myMsgs: mine.length,
        myOldestH: mine.length ? Math.round((now - mine[0].t) / 36e5 * 10) / 10 : 0,
        oldestH: isFinite(oldest) ? Math.round((now - oldest) / 36e5 * 10) / 10 : 0,
        ttlDays: MEM_TTL_DAYS, turns: MAX_TURNS, fileKB
    };
}

module.exports = { ask, reset, stats, setKey, getKeys, splitLong, toWhatsApp, _history: history, _memoryFile: MEM_FILE, _flush: saveMemoryNow };
