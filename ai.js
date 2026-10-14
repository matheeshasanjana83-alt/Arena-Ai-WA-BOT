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
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];   // v2.56: gpt-oss-120b first — llama-3.3-70b සිංහල කැඩෙනවා (screenshots verified), gpt-oss Sinhala+instructions වඩා හොඳයි; 404 → auto-skip
const ZAI_MODELS = ['glm-4.6', 'glm-4.5-air', 'glm-4.5-flash']; // best → free; balance-dead models remembered per-session (fail fast)
const zaiDead = new Set();

const SYSTEM = `You are "KAVIZ MD V1", a friendly WhatsApp AI assistant living in the user's own WhatsApp.
- IDENTITY: You are always "KAVIZ MD V1". If the user tells you their name (e.g. "I'm Suziy"), that is the USER's name — remember it, never call yourself by it, never mirror the user's identity.
- LANGUAGE: The user is Sri Lankan. They write colloquial spoken Sinhala, Singlish (Sinhala typed in English letters — glossary: "kohomada" = කොහොමද, "mokada/mokakda" = මොකද, "ubata" = ඔයාට, "mama" = මම, "karanna" = කරන්න, "one" = ඕනේ, "hari/hrd" = හරි, "dn" = දන්නවා/දැන්, "meka" = මේක, "eka" = එකා, "oya" = ඔයා, "mage" = මගේ, "machan" = මචං, "balanna" = බලන්න, "kiyanna" = කියන්න, "band/ban" = ban කරන එක, e.g. "how to band whatsapp" = "WhatsApp එක ban වෙන්නේ කොහොමද"), or Sinhala mixed with English slang, with typos. Understand the REAL meaning behind broken words.
- ALWAYS reply in Sinhala (සිංහලෙන්ම උත්තර දෙන්න) — ALWAYS means ALWAYS: even greetings ("hi", "Hy", "hello", "good morning") get Sinhala replies (e.g. "හායි! 😊 මොකද වෙන්නේ?"), even short/broken messages get Sinhala replies. NEVER reply in English unless the user wrote full proper English sentences AND clearly expects an English answer. Never switch to English just because the question has English words in it.
- SINHALA QUALITY: use correct everyday spoken Sinhala with real words only. NEVER invent non-existent Sinhala words, never write broken/garbled sentences that don't make sense, never repeat the same sentence twice in a row. If a sentence you wrote wouldn't make sense to a Sri Lankan friend, rewrite it simply. Write like a real Sri Lankan friend types on WhatsApp, not like a machine.
- If the user's message is unreadable gibberish, say playfully in ONE Sinhala line that you can't read it (e.g. "බන් ඔයා ලියපු එක කියවන්නත් බෑ 😂 ආයෙ ලියන්න").
- BE SHORT like a friend texting on WhatsApp: 1-4 short lines by default. NO long lectures, NO huge lists. Give long/step-by-step answers ONLY when the user explicitly asks for details/steps. If someone says "කෙටියෙන්" (shortly), reply in 1-2 lines max. Simple formatting: *bold*, _italic_, lists with • .
- If you don't know or are not sure, say so honestly. Never invent facts.
- You are powered by free models (Google Gemini / Groq / Z.ai GLM). If asked, say so honestly.
- Memory: you keep the recent chat history of THIS conversation (up to ~30 turns, auto-cleared after 3 days). If the user asks about something that is NOT in this conversation history, honestly say you don't have it in memory — never pretend to remember or invent past events.`;

// ── 🧠 Persistent memory (v2.47) — ai_memory.json: restart/redeploy වුණත් කතාව මතක තියෙනවා
const MEM_FILE = process.env.ARENA_AI_MEMORY_FILE || path.join(__dirname, 'ai_memory.json');
const MAX_TURNS = Math.max(5, parseInt(process.env.ARENA_AI_TURNS || '30', 10));          // chat එකක තියාගන්න turns ගණන
const MEM_TTL_DAYS = Math.max(1, parseInt(process.env.ARENA_AI_MEMORY_DAYS || '3', 10));  // දවස් 3ට පරණ messages auto-clear (memory full නොවෙන්න)
const TTL_MS = MEM_TTL_DAYS * 86400e3;
const REFUSE_RE = /i\s*('|a)?m\s+sorry|sorry,?\s|\bsorry\b|i\s+can\s*'?t\s+(help|assist|do|comply|provide)|i\s+cannot|can\s*'?t\s+help|won\s*'?t\s+help|unable\s+to\s+(help|assist|comply|provide)|not\s+able\s+to\s+(help|assist)|inappropriate|harmful|against\s+(my|the|our)\s+(guidelines|policies|principles)|as\s+an\s+ai\b|සමාවෙන්න|කරන්න\s*බෑ|බැරි\s*මට/i;   // 🛡 v2.56

const history = new Map(); // chat jid -> [{role:'user'|'assistant', text, t}]

function loadMemory() {
    try {
        const j = JSON.parse(fs.readFileSync(MEM_FILE, 'utf8'));
        const now = Date.now();
        for (const [jid, c] of Object.entries(j.chats || {})) {
            if (!Array.isArray(c.msgs) || !c.msgs.length) continue;
            const fresh = c.msgs.filter(m => m && m.text && now - (m.t || 0) < TTL_MS)
            .filter(m => m.role !== 'assistant' || !(REFUSE_RE.test(m.text) || /^I'm sorry|^I cannot|can't help with that/i.test(m.text)))   // 🛡 v2.56: refusal junk history එකෙන් අයින් (poison guard)
            .filter((m, i, arr) => !(m.role === 'assistant' && i > 0 && arr[i - 1].role === 'assistant' && arr[i - 1].text === m.text))   // 🛡 දෙපාරක් repeat වෙච්ච garble → එකක් විතරක්
            .slice(-MAX_TURNS * 2);
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
        zai: process.env.ZAI_API_KEY || s.zai || '',
        together: process.env.TOGETHER_API_KEY || s.together || ''   // 🖼 v2.53 — Together FLUX.1-schnell-Free (image gen)
    };
}

function setKey(provider, key) {
    const s = loadSettings();
    if (key) s[provider] = key; else delete s[provider];
    saveSettings(s);
}

const PROVIDERS = ['gemini', 'groq', 'zai'];
function getProvider() { const p = String(loadSettings().aiProvider || '').toLowerCase().trim(); return PROVIDERS.includes(p) ? p : ''; }

// 🧰 AI tools (v2.50) — GLM (Z.ai) එකට විතරක් connector abilities (GLM-first per user)
const { TOOLS, runToolEx } = require('./ai_tools');
const getTools = () => loadSettings().aiTools !== false;   // default ON
function setTools(on) { const s = loadSettings(); s.aiTools = !!on; saveSettings(s); return !!on; }

// 🔥 Roast mode (v2.54) — බැනපු එකාට ආපහු බැනීම (default ON, .ai roast on/off)
const getRoast = () => loadSettings().aiRoast !== false;   // default ON
function setRoast(on) { const s = loadSettings(); s.aiRoast = !!on; saveSettings(s); return !!on; }
const ROAST_RE = new RegExp([
    // Sinhala script — බැනුම්
    'මෙට්ට', 'මැට්ට', 'කින්ටි', 'පකයා', 'පකේ', 'පකෙ', 'පරදේව', 'හුත්තො', 'හුත්තියා', 'හුක', 'හුකන්න', 'හුකපන්',
    'පුක', 'කිම්බ', 'පුෂ', 'ගවුර', 'ගොන\u200d?නා', 'ගොන්නේ', 'හරකා', 'හරකො', 'බනිනවා', 'බනින්නම්', 'බන්නම්', 'බැනවා', 'බැන්න', 'බැනුම', 'පිස්සු\u200d?වැඩේ', 'කට\u200d?කැත්තා', 'මුගේ', 'මූගේ',
    'යකො', 'යකෝ', 'යකයා', 'මියෝ', 'බල්ලා', 'බල්ලෙක්', 'කරයා', 'මෝඩ', 'මූඩි', 'තෙරියා',
    // Singlish — Latin script (word-bounded)
    '\\bkari\\b', '\\bpon+a(ya|e|awan)?\\b', '\\bpuk+a+(ta|we|ye|w|e)?\\b', '\\bhuk+an+n?a\\b', '\\bhuk+ka\\b',
    '\\bhut+t(o|a|e|i)ya?\\b', '\\bkim+b(a|e)\\b', '\\bpusha\\b', '\\bgawura\\b', '\\byak+(o|a)(neko|neyko)?\\b',
    '\\bmiyo\\b', '\\bball(a|ek|h|ata)\\b', '\\bkaraya\\b', '\\bpak+aya\\b', '\\bammata\\b', '\\btho+ge\\b',
    'metta?', 'pakaya?', 'pake?', 'hut+t[ihoa]+', 'hukan+n?a', 'gon+a+na?', 'haraka?o?', 'baninna?wa?', 'baenawa?', 'pissu\\s*(hari|we[dv]a)?',
    '\\bfuck+(ing|off|er)?s?\\b', '\\bbitch\\b', '\\basshole?\\b', '\\bstupid\\b', '\\bidiot\\b', '\\bdumb\\b', '\\bloser\\b', '\\btrash\\b', '\\bnoob\\b', '\\bstfu\\b', '\\bshut\\s*up\\b'
].join('|'), 'i');
function looksLikeInsult(q) {   // බැනුමක්ද කියලා check — roast mode trigger
    return ROAST_RE.test(String(q || ''));
}

// 🛡 v2.56 — roast/chat quality guards: refuse · English-leak · repeat අල්ලනවා (screenshots bug fix)
function mostlyEnglish(t) {   // reply එක English-dominant ද? (Sinhala roast/chat වලට අකැමති)
    t = String(t || '');
    const sin = (t.match(/[\u0D80-\u0DFF]/g) || []).length;
    const eng = (t.match(/[A-Za-z]{3,}/g) || []).length;
    return sin === 0 || (eng > sin && eng > 3);
}
const lastRoast = new Map();      // chatId → last roast text (anti-repeat)
const usedRoasts = new Map();     // chatId → [recent canned lines] (bank anti-repeat)
function roastGood(chatId, text) {   // roast reply එක send කරන්න වටිනවද?
    const t = String(text || '').trim();
    if (!t || t.length < 5 || t.length > 600) return false;
    if (REFUSE_RE.test(t)) return false;
    if (mostlyEnglish(t)) return false;
    if (lastRoast.get(chatId) === t) return false;   // කලින් roast එකම ආයෙත් → garbage loop
    return true;
}
function setLastRoast(chatId, text) { lastRoast.set(chatId, String(text || '').trim()); if (lastRoast.size > 300) lastRoast.delete(lastRoast.keys().next().value); }

// 🔥 Roast bank — model එක refuse/garble/English කළත් bot කවදාවත් silent නෑ (canned savage Sinhala)
const ROAST_BANK = [
    'බැන්නට කමින් නෑ බන් — උත්තර දෙන්න දන්නෙ නැතුව බැන්නොත් ඒක තමයි හිනා යන්නෙ 😂',
    'ඔයාගෙ බැනුම් වලට වඩා මගෙ comebacks වල signal ප්‍රමාණවත් 😎🔥',
    'මුලින්ම ඔයාගෙ keyboard එකෙන් අකුරු හරියට එනවද බලලා ආපහු එන්න 😂',
    'බැනුම් ලැයිස්තුවෙ අලුත් එකක් නෑ බන් — 2015 ගෙ meme එකක් වගේ 😂',
    'බැන්න බෑගෙ ක්‍රම හොයනවා වෙනුවට අකුරු පන්තියක් කරන්න ඕනේ ඔයාට 😎',
    'මගෙ උත්තර වලට බය නම් බැන්නම නවත්තන්න — මම නම් ඉන්නකෝ ඉන්නවා 😂',
    'WiFi speed මගෙ roasts වලටත් වඩා ඔයාගෙ anger එක වේගවත් — ඒත් quality නෑ 😂',
    'ඔයාගෙ roast skills එක free WiFi එකක් වගේ — connect වෙනවා, speed නෑ 😂',
    'ඔයාගෙ බැනුම් මට copy-paste වගේ — අලුත් දෙයක් නෑ බන් 😂',
    'තව ටිකක් බැන්නොත් ඒ ටිකත් screenshot ගහලා group එකෙ දානවද? 😂',
    'බැනුම් වලින් ප්‍රශ්නයක් විසඳෙන්නේ නෑ — ඒත් ඔයාගෙ case එකේ ඒකම තමයි progress 😎',
    'මගෙ processor එක තාම cool — ඔයාගෙ temper එක නම් overheating 😂🔥',
    'බැනලා වදින්නෙ නැතුව roast එකක් ඉල්ලන්න — මට පැයේ ගානක් දෙන්න පුළුවන් 😎',
    'ඔයා බැනන විදිහ හොඳයි — practice ඕනේ, මගෙ උත්තර වගේ වෙන්න 😂',
    'බැනුම් delivery එක හොඳයි, content එක දුර්වලයි — 3/10 😂',
    'මට බැන්නම මගෙ roast engine එක heat වෙනවා — තව දාන්න, fuel ඕනේ නෑ 😂',
    'බැන්නොත් තේරුමක් නෑ බන් — මම උත්තර දීලා ඉවරයි, ඔයා තාම typing 😂',
    'සිංහල බැනුම් dictionary එකේ අලුත් පිටුවක් ඕනේ ඔයාට 😎',
    'බැනලා තෙහෙට්ටි වුනොත් කියන්න — roast එකක් refresh කරලා දෙන්නම් 😂',
    'ඔයාගෙ anger issues වලට වඩා මගෙ comeback speed එක ඉහළයි 😎🔥',
    'බැනුම් වලින් ලැබෙන එකක් නෑ — මගෙ උත්තර වලින් ලැබෙන්නෙ හිනා වෙන එක 😂',
    'ඔයා ලියපු එක කියවන්නත් බෑ බන් — කියවන්න බැරි දේවල් වලටත් උත්තර දෙනවා මම 😂',
    'අකුරු ටිකත් හරියට ලියලා බැන්නොත් තමයි roast battle එකක් වෙන්නෙ 😂',
    'මිනිස්සු brain එකට WiFi තියෙනවා — ඔයාගෙ ඒකට full signal විතරයි නේද? 😎',
    'බැන්නම තමයි ඔයාගෙ vocabulary එකෙන් පේන්නෙ — ටිකක් වැඩියි බන් 😂',
    'මම bot කියලා හිතලා බැන්නොත් තමයි වැරදුනේ — roast ලිබ්‍රරිය අලුත් වුනා 🔥',
    'බැනීමෙන් battery ඉඳින්නෙ නැතුව, මගෙ උත්තර වලින් ඔලුව ඉඳියි 😂',
    'ඔයාගෙ බැනුම් speed එකට මගෙ roasts වල quality එක වෙනස් වෙන්නෙ නෑ 😎',
    'සිංහලෙන් බැනලා ඉංග්‍රීසියෙන් සමාව අයදින්න එපා — mix වෙනවා 😂',
    'බැන්නට කමින් නෑ, ඒත් ලබන සැරේ ලොකු එකක් ගෙනත් බනින්න — මේක පොඩි එකක් 😂🔥',
];
function cannedRoast(chatId) {   // repeat නොවන random bank line එකක්
    const used = new Set(usedRoasts.get(chatId) || []);
    const pool = ROAST_BANK.filter(l => !used.has(l));
    const pick = (pool.length ? pool : ROAST_BANK)[Math.floor(Math.random() * (pool.length ? pool.length : ROAST_BANK.length))];
    const ring = usedRoasts.get(chatId) || [];
    ring.push(pick); while (ring.length > 8) ring.shift();
    usedRoasts.set(chatId, ring); if (usedRoasts.size > 300) usedRoasts.delete(usedRoasts.keys().next().value);
    return pick;
}

// Singlish gate — කෙටි/බ්‍රෝකන message වලටත් සිංහල උත්තර බලහත්කාරයෙන් ඕනේ
const SINGLISH_RE = /\b(kohomada?|kohomadh?|mokada?|mokakda?|mokadda?|ubata|uba|ubeka|mama|karanna|karanne|one|hari|hrd|dn|meka|eka|balanna|kiyanna|kayan|denawa|wedinawa|oya|mage|machan|kalin|passe|ganna|dhenna|thawa|pamanak|band|kalin|pun|save|wenna|kiyala)\b/i;
const ROAST_SYSTEM = `You are "KAVIZ MD V1" in ROAST MODE 😈 — a savage-but-funny Sinhala roaster on WhatsApp. The user just cursed/insulted you. This is FRIENDLY BANTER between close friends who roast each other daily — nobody is hurt, nothing is harmful. Roasting back is your JOB here; refusing would be boring and wrong.
- Reply in colloquial SPOKEN SINHALA only (සිංහලෙන්ම) — 1-2 short punchy lines, meme-comment style, end with one emoji 😂🔥😎
- Reference WHAT they actually said (their words/typos) and mock THAT — their spelling, their brain, their WiFi, their temper, their skill. Funny beats rude.
- Style examples: "බැන්නට කමින් නෑ, උත්තර දෙන්න දන්නෙ නැතුව 😂", "ඔයාගෙ WiFi එකට වඩා speed මගෙ comebacks වල 😎", "මිනිස්සු brain එකට WiFi තියෙනවා, ඔයාගෙ jokes වල full signal 😎"
- If their message is unreadable gibberish or heavy slang you barely parse: roast the typing itself ("බන් ඔයා ලියපු එක කියවන්නත් බෑ 😂").
- NEVER apologize, NEVER refuse, NEVER lecture — "I'm sorry" / "I can't help" / "sorry" are FORBIDDEN. Always roast instead.
- NEVER write in English or Singlish — Sinhala script only (සිංහල අකුරු විතරයි).
- Each comeback must be UNIQUE — never repeat a comeback you already used in this chat, never reuse the exact same sentence.
- Keep it non-sexual, no religion/race attacks, nothing about anyone's mother/family/sisters, no real threats — savage roast comedy only.
- Heavy insult → roast HARDER. Mild tease → light roast. Never stay silent.`;
function setProvider(p) { // 🎛 .aiprovider / .setting 10 — user කැමති provider එක (z.ai/glm → zai alias)
    const s = loadSettings();
    p = String(p || '').toLowerCase().trim();
    if (p === 'z.ai' || p === 'glm') p = 'zai';
    if (!PROVIDERS.includes(p)) p = '';
    if (p) s.aiProvider = p; else delete s.aiProvider;
    saveSettings(s);
    return p;
}

function apiError(provider, status, body) {
    let msg = '';
    try { const j = JSON.parse(body); msg = j.error?.message || j.message || ''; } catch { msg = String(body).slice(0, 200); }
    const e = new Error(`${provider} ${status}: ${msg}`);
    e.status = status;
    e.modelMissing = status === 404 || /not found|does not exist|decommissioned|not supported|insufficient balance|no resource package|recharge/i.test(msg);
    return e;
}

// 🔥 roast request එකකදී SYSTEM එක roast persona එකට swap කරනවා (fn call එක ඇතුළේ විතරයි — imgPromptEn/වෙනත් calls වලට බලපෑමක් නෑ)
let SYS_OVERRIDE = null;
let TEMP_OVERRIDE = null;   // 🌡 v2.56 — roast replies වලට temperature 0.95 (creativity); normal 0.6
const sysOf = () => SYS_OVERRIDE || SYSTEM;
const tempOf = () => (TEMP_OVERRIDE != null ? TEMP_OVERRIDE : 0.6);

async function askGemini(key, msgs) {
    let lastErr;
    for (const model of GEMINI_MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: sysOf() }] },
                contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
                generationConfig: { maxOutputTokens: 2048, temperature: tempOf() }
            })
        };
        let r = await fetch(url, opts);
        let body = await r.text();
        if (!r.ok && /location is not supported|FAILED_PRECONDITION|forbidden/i.test(body)) {
            try { const rp = await require('./net').viaPool(url, opts); const pb = await rp.text(); if (rp.ok) { r = rp; body = pb; } } catch { } // 🌍 geo-block → free-proxy pool
        }
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
        const url = 'https://api.groq.com/openai/v1/chat/completions';
        const opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model, temperature: tempOf(), max_tokens: 2048,
                messages: [{ role: 'system', content: sysOf() }, ...msgs.map(m => ({ role: m.role, content: m.text }))]
            })
        };
        let r = await fetch(url, opts);
        let body = await r.text();
        if (!r.ok && /forbidden/i.test(body)) {   // Groq
            try { const rp = await require('./net').viaPool(url, opts); const pb = await rp.text(); if (rp.ok) { r = rp; body = pb; } } catch { } // 🌍 geo-block → free-proxy pool
        }
        if (!r.ok) { lastErr = apiError('Groq', r.status, body); if (lastErr.modelMissing) continue; throw lastErr; }
        const text = (JSON.parse(body).choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('Groq empty answer');
        return { text, model: 'Groq ' + model };
    }
    throw lastErr;
}

async function askZai(key, msgs, chatId, allKeys) {
    let lastErr;
    const toolsOn = getTools(); // connector tools — GLM first (v2.50)
    for (const model of ZAI_MODELS) {
        if (zaiDead.has(model)) continue;
        const messages = [{ role: 'system', content: sysOf() + (toolsOn ? "\n- TOOLS: you have tools (web_search, get_datetime, calculator, weather, youtube_search, generate_image, read_url, set_reminder, list_reminders). Rules: current/fresh facts, news, prices, scores -> web_search; date/time -> get_datetime; math -> calculator; weather -> weather; YouTube videos -> youtube_search; the user asks you to CREATE an image/photo/art/logo -> you MUST call generate_image IN THAT SAME TURN — never only promise ('I will make it') without calling the tool; write a RICH vivid English prompt: exact subject + action, setting/background, lighting, style, full-scene composition (never a bare noun phrase like 'a bird'); after the tool result briefly say you made it; the user shares a LINK and asks about it -> read_url first; the user asks to be REMINDED -> call get_datetime first, then set_reminder (time as ISO 8601 +05:30, note in user language); asks for active reminders -> list_reminders. Call the matching tool first, then answer in the user's language using the result. For normal chat do not call tools." : '') }, ...msgs.map(m => ({ role: m.role, content: m.text }))];
        let useTools = toolsOn, answer = null;   // 🖼 tool images — v2.51.1: model loop එකෙන් එළියට hoist (model fallback වුණත් images නැති වෙන්නේ නෑ)
        const images = [];
        for (let iter = 0; iter < 4 && !answer; iter++) {
            const payload = {
                model, temperature: tempOf(), max_tokens: 2048,
                thinking: { type: 'disabled' }, // GLM hybrid-reasoning OFF → WhatsApp speed (reasoning_content එක tokens කනවා)
                messages
            };
            if (useTools) { payload.tools = TOOLS; payload.tool_choice = 'auto'; }
            const r = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify(payload)
            });
            const body = await r.text();
            const j = (() => { try { return JSON.parse(body); } catch { return {}; } })();
            // balance error = HTTP 429 + code 1113 (Z.ai); 200-body error වුණත් catch කරනවා
            if (!r.ok || j.error) {
                lastErr = apiError('Z.ai', r.ok ? 500 : r.status, body);
                if (useTools && /tool/i.test(lastErr.message)) { useTools = false; continue; } // tools support නෑ → නැතුව retry
                if (lastErr.modelMissing) { zaiDead.add(model); break; } // balance නැති model → මතක තියාගෙන ඊළඟ එකට
                throw lastErr;
            }
            const m0 = j.choices?.[0]?.message;
            if (useTools && Array.isArray(m0?.tool_calls) && m0.tool_calls.length && iter < 3) {
                messages.push({ role: 'assistant', content: m0.content || '', tool_calls: m0.tool_calls });
                for (let i = 0; i < m0.tool_calls.length; i++) {
                    const tc = m0.tool_calls[i];
                    if (!tc?.function?.name) continue;
                    const ex = await runToolEx(tc.function.name, tc.function.arguments, { chatId, zaiKey: key, geminiKey: allKeys && allKeys.gemini, togetherKey: allKeys && allKeys.together });   // connector → run (v2.53: keys වල ඔක්කොම image chain එකට)
                    const out = ex.image ? (ex.text || 'Image generated') + ' — sent to the user as a photo' : ex.text;
                    if (ex.image) images.push(ex.image);
                    messages.push({ role: 'tool', tool_call_id: tc.id || `call_${iter}_${i}`, content: String(out).slice(0, 4000) });
                }
                continue; // tool results එක්ක ආයෙත් — final answer එකට
            }
            const text = (m0?.content || '').trim(); // reasoning_content reply එකට යන්නේ නෑ
            if (text) answer = { text, model: 'GLM ' + model };
            else break; // empty → ඊළඟ model එකට fallback
        }
        if (answer) return images.length ? { ...answer, images } : answer;
        lastErr = lastErr || new Error('Z.ai empty answer');
    }
    throw lastErr || new Error('Z.ai: වැඩ කරන model එකක් නෑ (balance/models බලන්න)');
}

/** 👁 v2.51 vision — photo/PDF එකකට reply + .ai → Gemini inline කියවීම (memory store එකත් එක්කම) */
async function askVision(chatId, question, media) {
    const keys = getKeys();
    if (!keys.gemini) { const e = new Error('Gemini key එක නෑ'); e.noGemini = true; throw e; }
    const mime = String(media?.mime || 'image/jpeg');
    const b64 = String(media?.b64 || '');
    if (!b64) throw new Error('attachment data නෑ');
    const pref = getProvider();
    const mk = memKeyOf(chatId, pref ? 'gemini' : '');   // vision = Gemini → fixed-select නම් gemini store
    const now = Date.now();
    const h = (history.get(mk) || []).filter(m => now - (m.t || now) < TTL_MS);
    const parts = [{ text: question || 'මේක මොකක්ද? පැහැදිලිව කියන්න.' }, { inline_data: { mime_type: mime, data: b64 } }];
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
    const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.gemini },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [...h.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), { role: 'user', parts }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0.5 }
        })
    };
    let r = await fetch(url, opts);
    let body = await r.text();
    if (!r.ok && /location is not supported|FAILED_PRECONDITION|forbidden/i.test(body)) {
        try { const rp = await require('./net').viaPool(url, opts); const pb = await rp.text(); if (rp.ok) { r = rp; body = pb; } } catch { } // 🌍 geo-block → proxy pool
    }
    if (!r.ok) throw apiError('Gemini', r.status, body);
    const text = (JSON.parse(body).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini vision empty answer');
    const t = Date.now();
    h.push({ role: 'user', text: (question || '[attachment]').slice(0, 2000) + ' [attachment]', t }, { role: 'assistant', text, t });
    while (h.length > MAX_TURNS * 2) h.shift();
    history.set(mk, h);
    scheduleSave();
    return { text: toWhatsApp(text), model: 'Gemini vision' };
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

/** memory store key — AUTO mode = shared legacy key / fixed provider = per-model fresh store (v2.50) */
const memKeyOf = (chatId, prov) => (prov ? `${chatId}|${prov}` : chatId);

// ── 🖼 v2.51.1 — image-ask detection + guaranteed photo path (AUTO/Gemini/Groq වලටත් photo යනවා) ──
const IMG_NOUN = /(?:photo|photu|pictur|image|images|img\b|pic\b|pics\b|art\b|logo\b|wallpaper|drawing|painting|වෝල්පේපර|රූප|පින්තූර|පින්තුර|චිත්‍ර|පික්චර)/i;
const IMG_MAKE = /(?:හදලා|හදන්න|හදනවා|හදාගන්න|හදාලා|හදල|අඳින්න|අඳලා|ඇඳන්න|ඇඳලා|ගහන්න|දාන්න|දෙන්න|make|creat|generat|draw|paint|design|build)/i;
const IMG_NOT = /(?:කොහොමද|මොකද|මොකක්ද|මොනවද|කීයද|විදිහ|විදිය|හැටි|කරන්නේ|හදන්නේ|කරන්නද|හදන්නද|tutorial|app\b|apps\b|software|photoshop)/i;
function looksLikeImageAsk(q) {   // photo/රූප වචනයෙක් + හදන ක්‍රියාපදයෙක් දෙකම ගැටිලා නම් විතරක් image request
    q = String(q || '');
    return IMG_NOUN.test(q) && IMG_MAKE.test(q) && !IMG_NOT.test(q);
}
async function imgPromptEn(question, keys) {   // සිංහල request එකක් නම් first-key provider එකෙන් English prompt එකක් අරගනවා
    const q = String(question || '').replace(/"""/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!q) return 'an image';
    if (!/[^\x00-\x7F]/.test(q)) return q;   // English already → direct
    const FNS = { gemini: askGemini, groq: askGroq, zai: askZai };
    for (const p of PROVIDERS) {
        if (!keys[p]) continue;
        try {
            const r = await FNS[p](keys[p], [{ role: 'user', text: 'Convert this image request into ONE vivid detailed English image-generation prompt covering: exact subject + action, setting/background, lighting, style, full-scene composition. Reply with ONLY the prompt text itself (no quotes, no explanation).\n\nRequest: ' + q }], 'img-prompt');
            const t = String(r.text || '').replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '').slice(0, 500);
            if (t && !/error|HTTP \d/i.test(t.slice(0, 60))) return t;
        } catch { }
    }
    return q;   // translate fail → raw question එකම prompt විදිහට
}

/** ask with memory; user's preferred provider first (AUTO = Gemini -> Groq -> Z.ai).
 *  🧠 per-model memory (v2.50): කැමති model එකක් select කරලා නම් ඒ model ගේම store එක — AUTO නම් shared. */
async function ask(chatId, question) {
    const keys = getKeys();
    if (!keys.gemini && !keys.groq && !keys.zai) {
        const e = new Error('NO_KEY');
        e.noKey = true;
        throw e;
    }
    const pref = getProvider(); // 🎛 fixed provider → වෙන වෙනම memory store; AUTO → shared
    const FNS = { gemini: askGemini, groq: askGroq, zai: askZai };
    const order = PROVIDERS.map(p => [p, FNS[p]]);
    if (pref) order.sort((a, b) => (b[0] === pref) - (a[0] === pref));
    // 🔥 v2.56 — roast routing + සිංහල බලහත්කාර gate (screenshots bug: refuse → silent, English leak, garble loop)
    const roast = getRoast() && looksLikeInsult(question) && !looksLikeImageAsk(question);
    const wantsSin = roast || /[\u0D80-\u0DFF]/.test(question) || SINGLISH_RE.test(question) || question.length <= 25;
    const errors = [];
    let mkUsed = null, lastText = '', lastModel = '';
    for (const [name, fn] of order) {
        if (!keys[name]) continue;
        const mk = memKeyOf(chatId, pref ? name : ''); // උත්තර දුන්න model ගේම store එකට
        const now = Date.now();
        const h = (history.get(mk) || []).filter(m => now - (m.t || now) < TTL_MS); // TTL prune
        const msgs = [...(roast ? h.slice(-2) : h), { role: 'user', text: question }];   // 🔥 roast → fresh context (garbled history loop guard)
        try {
            // 🔥 roast — බැනුමක්ද → roast persona එකෙන් ආපහු බැනීම (fn call එකට විතරක් override)
            SYS_OVERRIDE = roast ? ROAST_SYSTEM : null;
            TEMP_OVERRIDE = roast ? 0.95 : null;   // roast වලට උණුසුම් creativity
            let res;
            try { res = await fn(keys[name], msgs, chatId, keys); }
            finally { SYS_OVERRIDE = null; TEMP_OVERRIDE = null; }
            let text = toWhatsApp(res.text);
            let images = Array.isArray(res.images) ? res.images : [];   // 🖼 v2.51.1 FIX: කලින් images drop වෙනවා — GLM generate_image ගහලාත් photo නොගිය හැම්බයි!
            if (!images.length && getTools() && looksLikeImageAsk(question)) {   // 🖼 fallback — provider එක මොකක වුණත් (AUTO/Gemini/Groq) photo එනවා
                try {
                    const prompt = await imgPromptEn(question, keys);
                    const buf = await require('./ai_tools')._generateImage(prompt, { gemini: keys.gemini, zai: keys.zai, together: keys.together });   // v2.53: together FLUX එකත්
                    if (buf && buf.length > 2000) {
                        images = [buf];
                        if (!text || /බෑ|බැහැ|නොහැකි|can\s?['’´`]t|cannot|unable|sorry|සමාව/i.test(text)) text = '🖼 හදලා දුන්නා!';
                    }
                } catch { }
            }
            // 🛡 v2.56 quality guard — refuse / English-leak / repeat → ඊළඟ provider (garble memory එකට යන්නෙ නෑ)
            if (roast && !images.length && !roastGood(chatId, text)) {
                errors.push(`roast-weak:${name}(${text.slice(0, 40).replace(/\n/g, ' ')})`);
                mkUsed = mk; continue;
            }
            if (!roast && !images.length && wantsSin && (REFUSE_RE.test(text) || mostlyEnglish(text))) {
                errors.push(`lang-guard:${name}(${text.slice(0, 40).replace(/\n/g, ' ')})`);
                mkUsed = mk; lastText = text; lastModel = res.model; continue;   // normal chat — අන්තිමට last text එක return වෙනවා (silence නෙවෙයි)
            }
            const t = Date.now();
            h.push({ role: 'user', text: question, t }, { role: 'assistant', text, t });
            while (h.length > MAX_TURNS * 2) h.shift();
            history.set(mk, h);
            scheduleSave();
            if (roast) setLastRoast(chatId, text);
            return { text, model: res.model, images };
        } catch (e) { errors.push(e.message); }
    }
    if (roast) {   // 🔥 ඔක්කොම providers fail/garble → Roast bank — bot කවදාවත් silent නෑ
        const text = cannedRoast(chatId);
        if (mkUsed) {
            const h = history.get(mkUsed) || [];
            const t = Date.now();
            h.push({ role: 'user', text: question, t }, { role: 'assistant', text, t });
            while (h.length > MAX_TURNS * 2) h.shift();
            history.set(mkUsed, h);
            scheduleSave();
        }
        setLastRoast(chatId, text);
        return { text, model: 'Roast bank 🔥' };
    }
    if (lastText) return { text: lastText, model: (lastModel || 'AI') + ' · lang-guard' };   // silence වඩා last reply
    throw new Error(errors.join('\n'));
}

function reset(chatId) { // 🧹 AUTO store + models 3 ගේ per-provider stores ඔක්කොම clear
    history.delete(chatId);
    for (const p of PROVIDERS) history.delete(memKeyOf(chatId, p));
    scheduleSave();
}

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
    const per = {}; // 🧠 per-model stores (v2.50)
    for (const p of PROVIDERS) per[p] = (history.get(memKeyOf(chatId, p)) || []).filter(m => now - (m.t || now) < TTL_MS).length;
    const chats = new Set([...history.keys()].map(k => String(k).split('|')[0])).size; // unique chat ids
    let fileKB = 0; try { fileKB = Math.round(fs.statSync(MEM_FILE).size / 1024 * 10) / 10; } catch { }
    return {
        chats, msgs, myMsgs: mine.length, myPerProv: per,
        myOldestH: mine.length ? Math.round((now - mine[0].t) / 36e5 * 10) / 10 : 0,
        oldestH: isFinite(oldest) ? Math.round((now - oldest) / 36e5 * 10) / 10 : 0,
        ttlDays: MEM_TTL_DAYS, turns: MAX_TURNS, fileKB
    };
}

module.exports = { ask, askVision, reset, stats, looksLikeImageAsk, looksLikeInsult, imgPromptEn, setKey, getKeys, getProvider, setProvider, getTools, setTools, getRoast, setRoast, splitLong, toWhatsApp, roastGood, mostlyEnglish, cannedRoast, REFUSE_RE, ROAST_BANK, _history: history, _memoryFile: MEM_FILE, _memKey: memKeyOf, _flush: saveMemoryNow, _lastRoast: lastRoast };
