/**
 * guard.js — KAVIZ MD V1 safety + anti-ban helpers (v2.8)
 *
 *  🔒 Owner-only:  commands run ONLY for messages YOU send (fromMe + participant check)
 *                  default = "Message yourself" chat only  (.mode all → your commands work in any chat)
 *  🛡️ Anti-ban:    rate limit, human-like reply delay, paced sending (one message at a time),
 *                  reconnect backoff, stop on ban / 2nd instance, no spam announcements
 *  🙈 Privacy:     secrets masked in logs, no phone number on the status page
 *
 *  ⚠️ No bot can be 100% ban-proof — WhatsApp does not allow unofficial clients.
 *     This keeps the account looking like a normal, quiet linked device.
 */
const fs = require('fs');
const path = require('path');

const SET = path.join(__dirname, 'settings.json');
const readSet = () => { try { return JSON.parse(fs.readFileSync(SET, 'utf8')); } catch { return {}; } };
const writeSet = (d) => { try { fs.writeFileSync(SET, JSON.stringify(d, null, 2)); } catch { } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── chat mode ─────────────────────────────────────────────
// v2.41: 4 modes - public / private / inbox / groups (legacy all->public, self->private)
const CHAT_MODES = ['public', 'private', 'inbox', 'groups'];
function chatMode() {
    const v = String(process.env.ARENA_CHATS || readSet().chats || 'private').toLowerCase();
    if (v === 'all') return 'public';       // v2.40- legacy
    if (v === 'self') return 'private';     // v2.40- legacy
    return CHAT_MODES.includes(v) ? v : 'private';
}
function setChatMode(m) { const d = readSet(); d.chats = CHAT_MODES.includes(m) ? m : (m === 'all' ? 'public' : 'private'); writeSet(d); }

/** v2.41 access matrix - who can run commands WHERE (owner ALWAYS passes):
 *  public  -> everyone, DM + groups | private -> owner only | inbox -> everyone in DMs only
 *  groups  -> everyone in groups only (owner keeps DM for control commands) */
function botAccess(jid, isOwner) {
    if (isOwner) return true;
    const m = chatMode();
    if (m === 'public') return true;
    if (m === 'private') return false;
    const g = !!jid && jid.endsWith('@g.us');
    return m === 'inbox' ? !g : m === 'groups' ? g : false;
}

// v2.41 AI chat: auto AI replies - on/off + 6 modes
const AI_MODES = ['inbox_public', 'inbox_self', 'inbox_private', 'groups_only', 'all', 'all_public'];
function aiChatOn() { return readSet().aiChat === true; }
function setAiChat(on) { const d = readSet(); d.aiChat = !!on; writeSet(d); }
function aiMode() { const m = readSet().aiMode; return AI_MODES.includes(m) ? m : 'all'; }
function setAiMode(m) { if (!AI_MODES.includes(m)) return false; const d = readSet(); d.aiMode = m; d.aiChat = true; writeSet(d); return true; }   // picking a mode = AI chat ON
/** who gets an AI auto-reply: jid normalized, selfChat = the bot's own "Message yourself" chat.
 *  groups need a mention/reply-to-bot check (bot.js passes those in only). */
function aiAllowed(jid, isOwner, selfChat) {
    if (!aiChatOn()) return false;
    if (!jid || ignoredChat(jid)) return false;
    const m = aiMode();
    if (jid.endsWith('@g.us')) return m === 'groups_only' || m === 'all' || m === 'all_public';
    if (selfChat) return m === 'inbox_self' || m === 'all';      // 12 / 15 - the "Bot" chat
    if (isOwner) return false;                                    // owner's outgoing msgs in other chats - never AI'd
    return m === 'inbox_public' || m === 'inbox_private' || m === 'all' || m === 'all_public';
}

/** never react in these chats (status updates, channels, broadcast lists) */
const ignoredChat = (jid) => !jid || jid === 'status@broadcast' || /@(newsletter|broadcast)$/.test(jid);

// ── rate limit (commands) ─────────────────────────────────
const hits = [];
let lastWarn = 0;
function rateCheck(now = Date.now()) {
    const perMin = parseInt(process.env.ARENA_RATE_MIN || '10', 10);
    const perHour = parseInt(process.env.ARENA_RATE_HOUR || '120', 10);
    while (hits.length && now - hits[0] > 3600e3) hits.shift();
    const inMin = hits.filter((t) => now - t < 60e3);
    let wait = 0;
    if (inMin.length >= perMin) wait = 60e3 - (now - inMin[0]);
    else if (hits.length >= perHour) wait = 3600e3 - (now - hits[0]);
    if (wait > 0) {
        const warn = now - lastWarn > 60e3;          // warn at most once a minute (no reply spam)
        if (warn) lastWarn = now;
        return { ok: false, wait: Math.ceil(wait / 1000), warn };
    }
    hits.push(now);
    return { ok: true };
}

// ── human-like pacing for outgoing messages ───────────────
/** run send jobs one by one, with a minimum gap between them.
 *  timeoutMs (optional, per call) — media uploads can hang forever on a flaky
 *  socket (Baileys has no upload timeout); without this ONE hung 200 MB document
 *  deadlocks the whole chain and the bot goes silent (v2.30 fix). On timeout the
 *  job keeps running in the background — the file may still arrive late. */
function pacer(minGap = parseInt(process.env.ARENA_SEND_GAP || '1200', 10)) {
    let chain = Promise.resolve(), last = 0;
    const DEF_T = parseInt(process.env.ARENA_PACE_DEFAULT || '120000', 10);   // v2.45: timeout නැති call එකකුත් chain එක සදාකාලිකව block කරන්නේ නෑ (text-send deadlock fix)
    return (fn, timeoutMs) => {
        if (!timeoutMs) timeoutMs = DEF_T;
        const p = chain.then(async () => {
            const w = last + minGap - Date.now();
            if (w > 0) await sleep(w);
            if (!timeoutMs) {
                try { return await fn(); } finally { last = Date.now(); }
            }
            const bg = fn();
            bg.catch(() => { });                 // late failure must not hit unhandledRejection
            let timer;
            const t = new Promise((_, rej) => {
                timer = setTimeout(() => rej(new Error('upload timeout — WhatsApp upload එක hang වෙලා (' + Math.round(timeoutMs / 60e3) + ' min)')), timeoutMs);
            });
            try { return await Promise.race([bg, t]); } finally { clearTimeout(timer); last = Date.now(); }
        });
        chain = p.catch(() => { });
        return p;
    };
}
/** small random "typing" delay before the FIRST reply to a command (not for edits) */
const humanDelay = () => process.env.ARENA_NO_DELAY ? Promise.resolve() : sleep(700 + Math.floor(Math.random() * 1300));

// ── reconnect backoff ─────────────────────────────────────
const backoff = (n) => Math.min(3000 * 2 ** n, 5 * 60e3) + Math.floor(Math.random() * 2000);

// ── announce "online" at most once every 6 h (restarts don't spam) ──
function shouldAnnounce(now = Date.now()) {
    const d = readSet();
    if (d.lastAnnounce && now - d.lastAnnounce < 6 * 3600e3) return false;
    d.lastAnnounce = now; writeSet(d); return true;
}

// ── hide secrets in console logs ──────────────────────────
function maskLog(t) {
    return String(t)
        .replace(/(\.(?:setkey|delkey)\s+\S+\s+)\S+/i, '$1••••')
        .replace(/\/\/[^@/\s]*@/g, '//***@')
        .replace(/\b(AIza[\w-]{6})[\w-]+/g, '$1••••')
        .replace(/\b(gsk_\w{4})\w+/g, '$1••••');
}

module.exports = { chatMode, setChatMode, botAccess, aiChatOn, setAiChat, aiMode, setAiMode, aiAllowed, AI_MODES, CHAT_MODES, ignoredChat, rateCheck, pacer, humanDelay, backoff, shouldAnnounce, maskLog, sleep, _hits: hits };
