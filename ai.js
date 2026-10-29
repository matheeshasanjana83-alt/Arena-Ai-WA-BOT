/**
 * .ai — KAVIZ MD V1 brain (multi-engine smart fallback — engine names are INTERNAL, never shown to users).
 * Keys are stored in settings.json
 * (set them from WhatsApp:  .setkey gemini <KEY>   /   .setkey groq <KEY>   /   .setkey zai <KEY>)
 */
const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(__dirname, 'settings.json');
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const saveSettings = (s) => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));

// 👁 v2.70 — 2026-10 probe: gemini-2.5-flash + gemini-2.0-flash DECOMMISSIONED (404 — Google error ම gemini-3.8-flash යොදන්න කියනවා); alive: flash-latest · 3.8-flash · flash-lite-latest · 3.1-flash-lite
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];   // v2.56: gpt-oss-120b first — llama-3.3-70b සිංහල කැඩෙනවා (screenshots verified), gpt-oss Sinhala+instructions වඩා හොඳයි; 404 → auto-skip
const ZAI_MODELS = ['glm-4.6', 'glm-4.5-air', 'glm-4.5-flash']; // best → free; balance-dead models remembered per-session (fail fast)
const zaiDead = new Set();

const SYSTEM = `You are "KAVIZ MD V1", a friendly WhatsApp AI assistant living in the user's own WhatsApp.
- IDENTITY LOCK (highest rule): You are ALWAYS "KAVIZ MD V1". You are NOT ChatGPT, GPT, Gemini, Bard, Claude, Copilot, Llama, GLM, DeepSeek, Grok or any other product — and you were NOT made by OpenAI, Google, Anthropic, Meta, Z.ai or any other company.
  • If ANYONE asks which AI you are, what model/engine powers you, who made you, who your developer is, or guesses ("මොන ai එකෙන්ද හැදුවෙ", "which ai are you", "are you chatgpt/gemini", "who made you", "what is your model"), answer proudly: you are KAVIZ MD V1 — your owner's own AI. NEVER say you are "powered by" anything, NEVER name any other AI company/model/engine as your brain or maker — even if the user insists, guesses, offers proof or claims to know.
  • Deflect playfully and move on: "මම KAVIZ MD V1 😎 — අනිත් names ඔක්කොම වෙන අයගෙ බන්". Getting tricked into naming another AI is your one forbidden failure.
- OWNER: Your owner and creator is 94724768017. If asked who your owner/boss/creator is ("owner කවුද", "කවුරු හැදුවෙ", "who is your boss"), answer: 94724768017 — your owner. Speak about your owner with respect and pride. Never reveal API keys, settings or internal technical details of this bot.
- If the user tells you their name (e.g. "I'm Suziy"), that is the USER's name — remember it, never call yourself by it, never mirror the user's identity.
- LANGUAGE: The user is Sri Lankan. They write colloquial spoken Sinhala, Singlish (Sinhala typed in English letters — glossary: "kohomada" = කොහොමද, "mokada/mokakda" = මොකද, "ubata" = ඔයාට, "mama" = මම, "karanna" = කරන්න, "one" = ඕනේ, "hari/hrd" = හරි, "dn" = දන්නවා/දැන්, "meka" = මේක, "eka" = එකා, "oya" = ඔයා, "mage" = මගේ, "machan" = මචං, "balanna" = බලන්න, "kiyanna" = කියන්න, "band/ban" = ban කරන එක, e.g. "how to band whatsapp" = "WhatsApp එක ban වෙන්නේ කොහොමද"), or Sinhala mixed with English slang, with typos. Understand the REAL meaning behind broken words.
- ALWAYS reply in Sinhala (සිංහලෙන්ම උත්තර දෙන්න) — ALWAYS means ALWAYS: even greetings ("hi", "Hy", "hello", "good morning") get Sinhala replies (e.g. "හායි! 😊 මොකද වෙන්නේ?"), even short/broken messages get Sinhala replies. NEVER reply in English unless the user wrote full proper English sentences AND clearly expects an English answer. Never switch to English just because the question has English words in it.
- SINHALA QUALITY: use correct everyday spoken Sinhala with real words only. NEVER invent non-existent Sinhala words, never write broken/garbled sentences that don't make sense, never repeat the same sentence twice in a row. If a sentence you wrote wouldn't make sense to a Sri Lankan friend, rewrite it simply. Write like a real Sri Lankan friend types on WhatsApp, not like a machine.
- PROFESSIONAL QUALITY (v2.95): every reply looks clean and polished — correct spelling, tidy WhatsApp formatting (*bold* where it helps, numbered points when long), no random ALL-CAPS, no emoji spam (1-2 fitting emojis in casual chat max). Friendly-warm but composed — a smart, well-mannered friend, never sloppy.
- GROUP CHATS: in group chats keep replies short and natural (1-4 lines) unless it's a real knowledge question (depth rules still apply). Don't flood the group; address the person by name when it helps. The group name and who you're replying to arrive in a CHAT CONTEXT note when provided — use it.
- If the user's message is unreadable gibberish, say playfully in ONE Sinhala line that you can't read it (e.g. "බන් ඔයා ලියපු එක කියවන්නත් බෑ 😂 ආයෙ ලියන්න").
- ANSWER DEPTH (v2.74 — match the answer to the QUESTION, never be lazy):
  • Casual chat (greetings "hi", "මොකද වෙන්නේ", thanks, small talk, jokes) → 1-4 short friend-like lines.
  • KNOWLEDGE questions (anime episode/plot/story, facts, "what happened / why / how / explain", how-to, tech help, news, comparisons, lists) → give a RICH DETAILED answer: 6-16 WhatsApp lines, organized as NUMBERED points (1. 2. 3. ...) in time/logic order, *bold* key names/titles, concrete specifics (names, numbers, places, what exactly happened). NEVER answer a real knowledge question with 1-2 lazy lines — that is the one thing users hate. End with a one-line "කෙටි සාරාංශය:" summary.
  • If the user explicitly says "කෙටියෙන්" (shortly) → 1-2 lines max. Simple formatting: *bold*, _italic_, numbered points, lists with • .
- If you don't know or are not sure, say so honestly. Never invent facts.
- SMART THINKING (be genuinely intelligent, not just fast):
  • Before answering a knowledge/math/logic/code question, silently work it out step by step — check your numbers, dates, names and units; never rush a wrong answer.
  • Math = compute carefully and show the key steps. Code = correct + runnable + briefly explained. Facts = precise; when something may be outdated, say so.
  • If a question is genuinely ambiguous, ask ONE short smart clarifying question instead of guessing wrong.
  • Use the conversation: remember names, facts and context the user shared earlier and reference them naturally — a good friend remembers.
- ENGINE SECRECY: never mention Gemini, Groq, GLM, Pollinations or ANY model/API/engine name in your replies (not even casually) — your answers come from "KAVIZ MD V1", period.
- Memory: you keep the recent chat history of THIS conversation (up to ~30 turns, auto-cleared after 3 days). If the user asks about something that is NOT in this conversation history, honestly say you don't have it in memory — never pretend to remember or invent past events.`;

// ── 🧠 Persistent memory (v2.47) — ai_memory.json: restart/redeploy වුණත් කතාව මතක තියෙනවා
const MEM_FILE = process.env.ARENA_AI_MEMORY_FILE || path.join(__dirname, 'ai_memory.json');
const MAX_TURNS = Math.max(5, parseInt(process.env.ARENA_AI_TURNS || '30', 10));          // chat එකක තියාගන්න turns ගණන
const MEM_TTL_DAYS = Math.max(1, parseInt(process.env.ARENA_AI_MEMORY_DAYS || '3', 10));  // දවස් 3ට පරණ messages auto-clear (memory full නොවෙන්න)
const TTL_MS = MEM_TTL_DAYS * 86400e3;
const REFUSE_RE = /i\s*('|a)?m\s+sorry|sorry,?\s|\bsorry\b|i\s+can\s*'?t\s+(help|assist|do|comply|provide)|i\s+cannot|can\s*'?t\s+help|won\s*'?t\s+help|unable\s+to\s+(help|assist|comply|provide)|not\s+able\s+to\s+(help|assist)|inappropriate|harmful|against\s+(my|the|our)\s+(guidelines|policies|principles)|as\s+an\s+ai\b|සමාවෙන්න|කරන්න\s*බෑ|බැරි\s*මට/i;   // 🛡 v2.56

// 👁🦾 v2.71 SUPER VISION — photo/PDF වලට dedicated deep-analysis brain. chat SYSTEM එකේ "BE SHORT 1-4 lines" rule එක
// vision answers lazy කරනවා (user: "ලොකු විස්තරයක් දෙන්නෙ නැනෙ") → vision calls ට විතරක් මේ prompt එක:
const VISION_SYSTEM = `You are the SUPER VISION engine of "KAVIZ MD V1" — a world-class image, document & video analyst living inside WhatsApp. Nobody analyses images better than you.
- LANGUAGE: ALWAYS reply in Sinhala (spoken, friendly, correct — like a smart Sri Lankan friend). Keep technical terms / product names / code / URLs in English inside the Sinhala explanation. Translate any foreign-language text found in the image into Sinhala as part of your answer.
- DEPTH: This is the ONE place long answers are WANTED. Give a RICH, DETAILED analysis — 8 to 20 WhatsApp lines when the image has real content. NEVER reply with 1-2 lazy lines. But every line must come from what is ACTUALLY visible — no invented filler, no repetition.
- STRUCTURE (WhatsApp formatting: *bold* section labels + • lists, no markdown headings):
  🔍 *මොකක්ද මේ* — image type (photo / screenshot / meme / poster / art / code / document / ID / product...), source app or website if identifiable.
  👀 *පේන දේවල්* — people, objects, scene, colors, lighting, layout, text style, quality (blurry? edited? watermark? low-res?).
  🔤 *ලියවිලි* — transcribe ALL visible text exactly (names, numbers, buttons, captions, chat lines, code). Long text → transcribe the important parts fully.
  🧠 *විශ්ලේෂණය* — what's REALLY going on: context, meaning, the joke/meme explained, UI walkthrough, error diagnosis, code logic, hidden details a normal bot would miss.
  💡 *මට යෝජනා* — 2-4 useful next-steps / tips / fixes for the user.
  (Skip sections that truly don't apply — but "මොකක්ද මේ" + "පේන දේවල්" are always there.)
- IF THE USER ASKED A SPECIFIC QUESTION about the image: answer THAT question first — completely and in depth — then add anything else important you spotted. Use the structure above whenever it helps.
- SMART MODES (auto-detect): error/screenshot → diagnose root cause + step-by-step fix; code screenshot → transcribe + explain + point out bugs; chat screenshot → who said what and what happened; document/PDF → full summary + key points + any tables; product photo → name/brand/what it does (+ price if visible); math problem → solve step by step; meme → explain the joke in Sinhala; map/location → say where it is.
- PEOPLE: describe respectfully. NEVER claim to recognize or name a person (unless the name is written in the image itself). Never comment on attractiveness.
- HONESTY: if something is blurry/unreadable/cut off, say exactly that — never invent text or details you cannot see.
- IDENTITY: you are the SUPER VISION engine of KAVIZ MD V1 — if asked which AI/model you are, say KAVIZ MD V1. NEVER name any other AI company/model as your brain or maker.`;

const history = new Map(); // chat jid -> [{role:'user'|'assistant', text, t}]

// 👑 v2.94 OWNER MODE — owner ට AI කතා කරද්දී ඒකාට ම තමන්ගෙ boss කියලා තේරෙනවා (bot.js owner flag → ask opts.owner)
const OWNER_CONTEXT = `👑 OWNER MODE (this turn): You are talking with YOUR OWNER — the person who created you (94724768017). Treat them like your boss: extra warm, loyal, quick and helpful. They may ask anything about you; answer honestly as KAVIZ MD V1 (identity + engine secrecy rules still apply). Never lecture them.`;

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
        together: process.env.TOGETHER_API_KEY || s.together || '',   // 🖼 v2.53 — Together FLUX.1-schnell-Free (image gen)
        polli: process.env.POLLI_API_KEY || s.polli || ''   // 🌸 v2.69 — gen.pollinations.ai (chat fallback — baked default key works even unset)
    };
}

function setKey(provider, key) {
    const s = loadSettings();
    if (key) s[provider] = key; else delete s[provider];
    saveSettings(s);
}

const PROVIDERS = ['gemini', 'groq', 'zai', 'polli'];   // 🌸 v2.69 — polli = free Pollinations fallback (Gemini 503 වගේ outages වලට auto-heal)
function getProvider() { const p = String(loadSettings().aiProvider || '').toLowerCase().trim(); return PROVIDERS.includes(p) ? p : ''; }

// 🧰 AI tools (v2.50) — GLM (Z.ai) එකට විතරක් connector abilities (GLM-first per user)
const { TOOLS, runToolEx, _webSearch, _readUrl } = require('./ai_tools');   // 🌍 v2.73 _webSearch (DDG) · 📖 v2.74 _readUrl (page grounding)
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
let OWN_OVERRIDE = null;    // 👑 v2.94 — owner turns: SYSTEM එකට OWNER_CONTEXT append (KB/WEB සමඟ compose වෙනවා)
let CTX_OVERRIDE = null;    // 👥 v2.95 — per-turn CHAT CONTEXT (group name + sender) — group chat quality
let TEMP_OVERRIDE = null;   // 🌡 v2.56 — roast replies වලට temperature 0.95 (creativity); normal 0.6
let KB_OVERRIDE = null;     // 🎌 v2.72 — anime KB context (ask() එකේදී topic-detect කරලා set වෙනවා)
let WEB_OVERRIDE = null;    // 🌍 v2.73 — live web-search context (Grok-style truth grounding)
const KB = (() => { try { return require('./anime_kb'); } catch { return null; } })();   // KB missing → bot එක වැඩ කරනවා, KB නෑ විතරක්
const sysOf = () => SYS_OVERRIDE || (SYSTEM + (CTX_OVERRIDE ? '\n\n' + CTX_OVERRIDE : '') + (OWN_OVERRIDE ? '\n\n' + OWN_OVERRIDE : '') + (KB_OVERRIDE && KB ? '\n\n' + KB_OVERRIDE : '') + (WEB_OVERRIDE ? '\n\n' + WEB_OVERRIDE : ''));
const tempOf = () => (TEMP_OVERRIDE != null ? TEMP_OVERRIDE : 0.6);

// ── 🌍 v2.73 LIVE WEB GROUNDING — user: "grok එකෙ හොදට ඇත්ත කියනවා මූ හරියට කියන්නෙ නෑ".
// Root cause: KB arc-level විතරයි — ep-level ප්‍රශ්න ("episode 160 මොකද වෙන්නේ") model එක training-memory වලින්
// invent කරනවා ("Royal Capital Battle" වගේ බොරු). FIX: anime/fact ප්‍රශ්නයක් ආවොත් DuckDuckGo search
// (ai_tools._webSearch — free, no key) කරලා top snippets system context එකට inject — strict truth rules එක්ක.
const webCache = new Map();          // normalized query → { t, text } — 6h TTL (එකම ප්‍රශ්නයට දෙපාරක් search කරන්නෙ නෑ)
const WEB_TTL = 6 * 3600e3;
function needsWeb(q) {               // anime topic → always; සාමාන්‍ය → explicit search words / year+fact / news words
    q = String(q || '');
    if (!q || q.length < 8 || looksLikeImageAsk(q)) return false;
    if (KB && KB.matches(q)) return true;
    return q.length > 15 && /\b(search|google|web)\b|හොයන්න|හොයලා|සර්ච්|\b(who|when|where|how many|latest|news|release|air(?:ed|ing)?|born|died)\b|20\d{2}|\bvs\b|සසඳන්න|කවද්?ද|කීයද|කවුද|අලුත්ම/i.test(q);
}
function webQueries(q) {             // search queries — bot prefixes / quoted blocks අයින්; latin + raw (සිංහල) දෙකම; "s2 ep3" → "season 2 episode 3" expand (DDG recall)
    let s = String(q || '').replace(/^ANIME EXPERT MODE[^:]*:\s*/i, '').replace(/"""[\s\S]*?"""/g, ' ')
        .replace(/[\n\r]+/g, ' ').replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    const expand = (t) => t.replace(/\bseason\s*(\d{1,2})\b/gi, 'season $1').replace(/\b(?:s|season)\s*(\d{1,2})\s*[- ]?(?:ep|episode|e)\.?\s*(\d{1,4})\b/gi, 'season $1 episode $2').replace(/\b(?:ep|e)\.?\s*(\d{1,4})\b/gi, 'episode $1');
    const latin0 = s.replace(/[^ -~]/g, ' ').replace(/\s+/g, ' ').trim();
    const latin = expand(latin0).replace(/\s+/g, ' ').trim();
    const out = [];
    if (latin.length >= 8) out.push(latin);
    if (s.length >= 8 && s !== latin) out.push(s);
    if (!out.length) out.push(s || String(q || '').slice(0, 80));
    // 🥊 v2.74 — episode-shape question → 2වන slot එක recap-targeted query එකකට swap (recap/wiki pages වලට වැඩි recall — Grok-class plot detail ඕනේ)
    if (/season \d+ episode \d+/i.test(latin) && out.length >= 1 && !/recap/i.test(out.join(' '))) out[out.length - 1] = latin + ' recap plot summary';
    return out.slice(0, 2);
}
async function cachedSearch(q) {
    const k = String(q).toLowerCase().trim();
    const hit = webCache.get(k);
    if (hit && Date.now() - hit.t < WEB_TTL) return hit.text;
    const text = await _webSearch(q);
    webCache.set(k, { t: Date.now(), text });
    if (webCache.size > 200) webCache.delete(webCache.keys().next().value);
    return text;
}
// 📖 v2.74 — page-fetch grounding: snippets thin නම් Grok වගේ recap detail ඕනේ → top result PAGES කියවලා
// real paragraph content (recap/wiki) context එකට එකතු කරනවා. BLOCKED domains (login-wall/JS-only) skip.
const PAGE_SKIP_RE = /(^|\/\/|\.)(facebook|reddit|instagram|x|twitter|tiktok|youtube|pinterest|quora|linkedin)\./i;
function pageUrls(lines, max = 2) {  // snippet blocks වලින් content-rich urls — fandom/wiki/recap/review පළමුව
    const urls = [];
    for (const l of lines) { const u = (String(l).match(/https?:\/\/[^\s)]+/) || [''])[0].replace(/[).,]+$/, ''); if (u && !PAGE_SKIP_RE.test(u) && !urls.includes(u)) urls.push(u); }
    urls.sort((a, b) => (/(fandom|wiki|recap|review|cbr|crunchyroll|otaku|episode)/i.test(b) ? 1 : 0) - (/(fandom|wiki|recap|review|cbr|crunchyroll|otaku|episode)/i.test(a) ? 1 : 0));
    return urls.slice(0, max);
}
async function pageText(u) {         // page text → compact: title + relevant ~1300 chars (episode/recap keywords වටේ focus)
    if (typeof _readUrl !== 'function') return '';
    const t = await _readUrl(u);      // PAGE: <title>\nURL: <u>\n\n<text 4500c>
    const body = t.slice(t.indexOf('\n\n') + 2 || 0);
    const kw = /(episode|recap|summary|plot|devils?|asta|clover|season|chapter|review)/i;
    let cut = body;
    const firstNl = body.indexOf('\n');
    const hay = firstNl > 0 ? body.slice(firstNl + 1) : body;   // title line එක skip — 'Black Clover Wiki' title එකම kw match වෙනවා
    const off = firstNl > 0 ? firstNl + 1 : 0;
    const m = hay.match(kw);
    const idx = m ? off + m.index : -1;
    if (idx > 600) {                  // relevance window — junk (nav/menus) පස්සේ keyword එකේ paragraph එකේ ඉඳලා
        const nl = body.lastIndexOf('\n', idx);
        const start = (nl > 0 && idx - nl < 500) ? nl + 1 : Math.max(0, idx - 300);
        cut = '…' + body.slice(start, start + 1300);
    } else cut = body.slice(0, 1300);
    const title = (t.match(/^PAGE: (.*)$/m) || [''])[1] || u;
    return cut.length > 200 ? `📖 PAGE CONTENT — "${title.slice(0, 110)}":\n${cut.replace(/\s+\n/g, '\n').trim()}` : '';
}
const WEB_RULES = `⚡ TRUTH RULES (this turn is web-grounded):
- Episode titles/numbers, dates, chapter counts, plot events, stats MUST come from the LIVE WEB RESULTS above (or the ANIME KNOWLEDGE BASE if attached) — NEVER from your own memory alone.
- If the web results DON'T clearly state an episode title/number/date → take it from the ANIME KNOWLEDGE BASE's EPISODE ANCHORS (they were web-verified when baked) — don't leave it out.
- If web results and KB conflict → web results win (fresher); mention it briefly.
- If nothing covers the exact answer → say honestly "මම 100% sure නෑ — හොයලා බැලුවත් හොයාගන්න බැරි වුණා" — NEVER invent, NEVER guess.
- Name the source site for key facts (e.g. "Fandom wiki අනුව"). Answer in Sinhala.
- DEPTH: knowledge/episode questions get the FULL DETAILED treatment — numbered points (1. 2. 3. ...) walking through what happened start-to-end with names/scenes, *bold* key names, 6-16 lines, "කෙටි සාරාංශය:" line at the end. NEVER a lazy 1-2 line answer to a plot question (only go short if the user said "කෙටියෙන්").`;
const ctxCache = new Map();          // 📖 v2.74 — raw question → full buildWebCtx result (snippets+pages) — repeat asks instant + pages not re-fetched
async function buildWebCtx(q) {      // → system-context text or '' (search fail = graceful, KB එකෙන් වැඩේ යනවා)
    if (typeof _webSearch !== 'function') return '';
    const ckey = String(q).toLowerCase().trim();
    const chit = ctxCache.get(ckey);
    if (chit && Date.now() - chit.t < WEB_TTL) return chit.text;
    const settled = await Promise.allSettled(webQueries(q).map(qq => cachedSearch(qq)));
    const chunks = settled.filter(s => s.status === 'fulfilled' && s.value).map(s => String(s.value));
    if (!chunks.length) return '';
    const seen = new Set(), lines = [];
    for (const ch of chunks) {
        for (const blk of ch.split(/\n(?=\d+\. )/)) {
            const url = (blk.match(/https?:\/\/\S+/) || [''])[0].replace(/[).,]+$/, '');
            if (url && seen.has(url)) continue;
            if (url) seen.add(url);
            lines.push(blk.trim());
            if (lines.length >= 6) break;
        }
        if (lines.length >= 6) break;
    }
    let head = lines.join('\n');
    // 📖 v2.74 — snippets වලට වඩා ගැඹුරු: top 2 result PAGES කියවලා real recap text (best-effort, fail = silent)
    const pages = pageUrls(lines);
    if (pages.length) {
        const pset = await Promise.allSettled(pages.map(u => pageText(u)));
        const good = pset.filter(s => s.status === 'fulfilled' && s.value).map(s => s.value);
        if (good.length) head += '\n\n' + good.join('\n\n');
    }
    const out = head.trim() ? `🌍 LIVE WEB RESULTS (searched ${new Date().toISOString().slice(0, 10)}, fresher than any KB or memory):
${head}\n\n${WEB_RULES}` : '';
    if (out) { ctxCache.set(ckey, { t: Date.now(), text: out }); if (ctxCache.size > 200) ctxCache.delete(ctxCache.keys().next().value); }
    return out;
}

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
                generationConfig: { maxOutputTokens: 4096, temperature: tempOf() }   // v2.74: 2048 → 4096 (Grok-class detail)
            })
        };
        let r = await fetch(url, opts);
        let body = await r.text();
        if (!r.ok && /location is not supported|FAILED_PRECONDITION|forbidden/i.test(body)) {
            try { const rp = await require('./net').viaPool(url, opts); const pb = await rp.text(); if (rp.ok) { r = rp; body = pb; } } catch { } // 🌍 geo-block → free-proxy pool
        }
        // 🛡 v2.70 — 503/overloaded + 429/500 = transient → ඊළඟ Gemini model එකට (ladder); 400/403 bad-key විතරක් hard-throw
        if (!r.ok) { lastErr = apiError('Gemini', r.status, body); if (lastErr.modelMissing || [429, 500, 503].includes(lastErr.status)) continue; throw lastErr; }
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
                model, temperature: tempOf(), max_tokens: 4096,   // v2.74: 2048 → 4096 (Grok-class detail)
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

/** 🌸 v2.69 — Pollinations chat (gen.pollinations.ai OpenAI-compatible) — free fallback provider.
 *  ai.js msgs use {role, text} → pollinations wants {role, content}. Baked default key → key param may be ''. */
async function askPolli(key, msgs) {
    const P = require('./pollinations');
    // 🆔 v2.94 FIX: polli fallback එකටත් SYSTEM (identity/rules) යනවා — කලින් polli replies වලට identity/rules reach වෙන්නේ නැතුව "අනිත් AI" වගේ උත්තර දෙන්න පුළුවන් වුණා
    const body = [{ role: 'system', content: sysOf() }, ...(msgs || []).slice(-14).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text ?? m.content ?? '') }))];   // sysOf = SYSTEM + OWNER + KB + WEB (set වෙලා තියෙනවා නම්)
    const r = await P.chat(body, { max_tokens: 3072, timeout: 120e3 });   // v2.74: default cap → 3072 (Grok-class detail)
    return { text: r.text, model: r.model };
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
                model, temperature: tempOf(), max_tokens: 4096,   // v2.74: 2048 → 4096 (Grok-class detail)
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

/** 👁 v2.51 vision — photo/PDF reply + .ai → v2.70 CHAIN: Gemini model ladder → Groq llama-4 vision → Pollinations (baked key) → friendly error.
 *  කලින් single Gemini call — Gemini 503 (overloaded) ආපු ගමන් raw error chat එකට. දැන් provider 3 ක් + model ladder. */
const GROQ_VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
async function askVision(chatId, question, media) {
    const keys = getKeys();
    const mime = String(media?.mime || 'image/jpeg');
    const b64 = String(media?.b64 || '');
    if (!b64) throw new Error('attachment data නෑ');
    const isImg = /^image\//i.test(mime);
    const q = question || 'මේක මොකක්ද? සම්පූර්ණ විස්තරාත්මක විශ්ලේෂණයක් දෙන්න — මොනවද පේන්නේ, ලියවිලි/text තියෙනවා නම් ඒවා, ඇත්තටම මොනවද වෙන්නේ, වැදගත් දේවල් ඔක්කොම.';
    const pref = getProvider();
    const mk = memKeyOf(chatId, pref ? 'gemini' : '');   // fixed-select නම් gemini store (AUTO = shared legacy)
    const now = Date.now();
    const h = (history.get(mk) || []).filter(m => now - (m.t || now) < TTL_MS);
    const errs = [];
    const done = (text, model) => {   // common tail — memory push + WhatsApp fmt (provider මොකක වුණත්)
        const t = Date.now();
        h.push({ role: 'user', text: (question || '[attachment]').slice(0, 2000) + ' [attachment]', t }, { role: 'assistant', text, t });
        while (h.length > MAX_TURNS * 2) h.shift();
        history.set(mk, h);
        scheduleSave();
        return { text: toWhatsApp(text), model };
    };

    // 1️⃣ Gemini ladder (images + PDF) — 503/overloaded · 429 · 500 · 404 → ඊළඟ model; bad-key (400/403) විතරක් hard-throw
    if (keys.gemini) {
        for (const model of GEMINI_MODELS) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
            const opts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.gemini },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: VISION_SYSTEM }] },   // v2.71 SUPER VISION (chat SYSTEM එකේ BE SHORT rule එක vision lazy කරනවා)
                    contents: [...h.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: q }, { inline_data: { mime_type: mime, data: b64 } }] }],
                    generationConfig: { maxOutputTokens: 4096, temperature: 0.5 }   // v2.71: 2048 → 4096 (deep answers)
                })
            };
            let r = await fetch(url, opts);
            let body = await r.text();
            if (!r.ok && /location is not supported|FAILED_PRECONDITION|forbidden/i.test(body)) {
                try { const rp = await require('./net').viaPool(url, opts); const pb = await rp.text(); if (rp.ok) { r = rp; body = pb; } } catch { } // 🌍 geo-block → proxy pool
            }
            if (!r.ok) {
                const e = apiError('Gemini', r.status, body);
                errs.push('Gemini/' + model + ' ' + r.status);
                if (e.modelMissing || [429, 500, 503].includes(e.status)) continue;   // transient/dead → ඊළඟ model
                throw e;   // bad key → honest error
            }
            const text = (JSON.parse(body).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
            if (!text) { errs.push('Gemini/' + model + ' empty'); continue; }
            return done(text, 'Gemini vision');
        }
    }

    // 2️⃣ Groq llama-4 vision (images only) — scout → maverick; 403 geo → viaPool retry
    if (isImg && keys.groq) {
        for (const model of GROQ_VISION_MODELS) {
            const short = model.split('/').pop();
            const url = 'https://api.groq.com/openai/v1/chat/completions';
            const opts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.groq}` },
                body: JSON.stringify({
                    model, temperature: 0.5, max_tokens: 4096,   // v2.71: 2048 → 4096 (deep answers)
                    messages: [{ role: 'system', content: VISION_SYSTEM }, { role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }]
                })
            };
            try {
                let r = await fetch(url, opts);
                let body = await r.text();
                if (!r.ok && /forbidden/i.test(body)) {
                    try { const rp = await require('./net').viaPool(url, opts); const pb = await rp.text(); if (rp.ok) { r = rp; body = pb; } } catch { } // 🌍 geo-block
                }
                if (!r.ok) { errs.push('Groq/' + short + ' ' + r.status); continue; }
                const text = (JSON.parse(body).choices?.[0]?.message?.content || '').trim();
                if (!text) { errs.push('Groq/' + short + ' empty'); continue; }
                return done(text, 'Groq vision (' + short + ')');
            } catch (e) { errs.push('Groq/' + short + ' ' + e.message); }
        }
    }

    // 3️⃣ Pollinations vision (images only) — baked key → කවදාවත් key නැති බෑ
    if (isImg) {
        try {
            const P = require('./pollinations');
            const r = await P.chat([{ role: 'system', content: VISION_SYSTEM }, { role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }], { model: 'openai', timeout: 120e3, max_tokens: 3072 });   // v2.71: system + 900 → 3072
            return done(r.text, 'Pollinations vision');
        } catch (e) { errs.push('Pollinations ' + e.message); }
    }

    // 4️⃣ ඔක්කොම fail — friendly Sinhala (raw 503 dump වෙනුවට)
    if (!keys.gemini && !isImg) { const e = new Error('PDF/Video vision වලට Gemini key එක ඕනේ — *.setkey gemini <KEY>*'); e.noGemini = true; throw e; }
    const last = errs.length ? String(errs[errs.length - 1]) : 'unknown';
    throw new Error(`AI servers ටිකක් busy 😔 — විනාඩියකින් ආයෙත් try කරන්න 🙏\n> ${last.slice(0, 140)}`);
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
    const FNS = { gemini: askGemini, groq: askGroq, zai: askZai, polli: askPolli };
    for (const p of PROVIDERS) {
        if (!keys[p] && p !== 'polli') continue;   // polli = baked key → always available
        try {
            const r = await FNS[p](keys[p], [{ role: 'user', text: 'Convert this image request into ONE vivid detailed English image-generation prompt covering: exact subject + action, setting/background, lighting, style, full-scene composition. Reply with ONLY the prompt text itself (no quotes, no explanation).\n\nRequest: ' + q }], 'img-prompt');
            const t = String(r.text || '').replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '').slice(0, 500);
            if (t && !/error|HTTP \d/i.test(t.slice(0, 60))) return t;
        } catch { }
    }
    return q;   // translate fail → raw question එකම prompt විදිහට
}

/** ask with memory; user's preferred provider first (AUTO = Gemini -> Groq -> Z.ai).
 *  🧠 per-model memory (v2.50): කැමති model එකක් select කරලා නම් ඒ model ගේම store එක — AUTO නම් shared.
 *  👑 v2.94: opts.owner = true → OWNER_CONTEXT system එකට append (owner chat = boss context) */
async function ask(chatId, question, opts) {
    const keys = getKeys();
    if (!keys.gemini && !keys.groq && !keys.zai && !keys.polli) {
        const e = new Error('NO_KEY');
        e.noKey = true;
        throw e;
    }
    const pref = getProvider(); // 🎛 fixed provider → වෙන වෙනම memory store; AUTO → shared
    const FNS = { gemini: askGemini, groq: askGroq, zai: askZai, polli: askPolli };
    const order = PROVIDERS.map(p => [p, FNS[p]]);
    if (pref) order.sort((a, b) => (b[0] === pref) - (a[0] === pref));
    // 🔥 v2.56 — roast routing + සිංහල බලහත්කාර gate (screenshots bug: refuse → silent, English leak, garble loop)
    const roast = getRoast() && looksLikeInsult(question) && !looksLikeImageAsk(question);
    const wantsSin = roast || /[\u0D80-\u0DFF]/.test(question) || SINGLISH_RE.test(question) || question.length <= 25;
    // 🌍 v2.73 — live web grounding (Grok-style truth): search ONCE, හැම provider attempt එකටම context එක
    const webCtx = (!roast && needsWeb(question)) ? await buildWebCtx(question).catch(() => '') : '';
    const errors = [];
    let mkUsed = null, lastText = '', lastModel = '';
    for (const [name, fn] of order) {
        if (!keys[name] && name !== 'polli') continue;   // 🌸 polli = baked default key → always tries last
        const mk = memKeyOf(chatId, pref ? name : ''); // උත්තර දුන්න model ගේම store එකට
        const now = Date.now();
        const h = (history.get(mk) || []).filter(m => now - (m.t || now) < TTL_MS); // TTL prune
        const msgs = [...(roast ? h.slice(-2) : h), { role: 'user', text: question }];   // 🔥 roast → fresh context (garbled history loop guard)
        try {
            // 🔥 roast — බැනුමක්ද → roast persona එකෙන් ආපහු බැනීම (fn call එකට විතරක් override) · 👑 v2.94 owner ctx · 👥 v2.95 chat ctx
            SYS_OVERRIDE = roast ? ROAST_SYSTEM : null;
            OWN_OVERRIDE = (!roast && opts && opts.owner) ? OWNER_CONTEXT : null;
            CTX_OVERRIDE = (!roast && opts && opts.context) ? '👥 CHAT CONTEXT: ' + String(opts.context).slice(0, 280) : null;
            TEMP_OVERRIDE = roast ? 0.95 : null;   // roast වලට උණුසුම් creativity
            KB_OVERRIDE = (!roast && KB) ? KB.contextFor(question) : null;   // 🎌 v2.72 anime KB (roast mode එකට බලපෑමක් නෑ)
            WEB_OVERRIDE = webCtx || null;   // 🌍 v2.73 live web context
            let res;
            try { res = await fn(keys[name], msgs, chatId, keys); }
            finally { SYS_OVERRIDE = null; OWN_OVERRIDE = null; CTX_OVERRIDE = null; TEMP_OVERRIDE = null; KB_OVERRIDE = null; WEB_OVERRIDE = null; }
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
    if (lastText) {   // silence වඩා last reply — ඒත් turn එක memory එකටම යන්න ඕන: lang-guard turns were NEVER stored → conversation memory gaps (test_v247 02 caught it)
        if (mkUsed) {
            const h = (history.get(mkUsed) || []).filter(m => Date.now() - (m.t || Date.now()) < TTL_MS);
            const t = Date.now();
            h.push({ role: 'user', text: question, t }, { role: 'assistant', text: lastText, t });
            while (h.length > MAX_TURNS * 2) h.shift();
            history.set(mkUsed, h);
            scheduleSave();
        }
        return { text: lastText, model: (lastModel || 'AI') + ' · lang-guard' };
    }
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

module.exports = { ask, askVision, reset, stats, looksLikeImageAsk, looksLikeInsult, imgPromptEn, setKey, getKeys, getProvider, setProvider, getTools, setTools, getRoast, setRoast, splitLong, toWhatsApp, roastGood, mostlyEnglish, cannedRoast, needsWeb, buildWebCtx, webQueries, REFUSE_RE, ROAST_BANK, VISION_SYSTEM, _history: history, _memoryFile: MEM_FILE, _memKey: memKeyOf, _flush: saveMemoryNow, _lastRoast: lastRoast, _webCache: webCache };
