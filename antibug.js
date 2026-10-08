/**
 * antibug.js — Arena AI 🛡️ Anti-Bug (v2.13)
 *
 * "Bug" messages = messages built to freeze/crash WhatsApp: giant texts full of invisible /
 * combining characters, thousands of mentions, huge contact cards, absurdly deep nesting,
 * giant fields inside buttons/lists/polls/locations, or a flood of messages.
 *
 * When one arrives (from SOMEONE ELSE, never your own messages):
 *   1. delete it "for me" → WhatsApp syncs that to your phone, so the chat opens again
 *   2. group + bot is admin → delete it for everyone
 *   3. private chat + severe bug → block the sender   (.antibug block off to disable)
 *   4. a short report in your "Message yourself" chat (never the bug text itself)
 *
 * Limits (honest): the phone receives the message at the same moment as the bot, so if that chat
 * is open on screen it can still lag for a second or two before the delete arrives. Detection is
 * pattern-based — a brand-new kind of bug can slip through.
 */
const fs = require('fs');
const path = require('path');

const SET = path.join(__dirname, 'settings.json');
const readSet = () => { try { return JSON.parse(fs.readFileSync(SET, 'utf8')); } catch { return {}; } };
const writeSet = (d) => { try { fs.writeFileSync(SET, JSON.stringify(d, null, 2)); } catch { } };

function cfg() { const a = readSet().antibug || {}; return { on: a.on !== false, block: a.block !== false }; }
function setCfg(patch) { const d = readSet(); d.antibug = { ...cfg(), ...patch }; writeSet(d); return d.antibug; }

const L = {
    text: 12000,        // one text/caption longer than this (normal chats rarely pass 4k)
    field: 20000,       // any single string field anywhere in the message
    total: 100000,      // all strings together
    weirdMin: 800,      // at least this many invisible/combining chars ...
    weirdRatio: 0.3,    // ... and they are 30%+ of the text
    mentions: 256,
    contacts: 40,
    options: 60,        // poll options / list rows / buttons
    depth: 14,          // object nesting
    floodN: 25, floodMs: 10000,
};

// invisible / combining / direction-control characters used by "virtex" bugs.
// (Sinhala vowel signs U+0D80–0DFF are NOT in here, and a normal emoji ZWJ is far below the limits)
const WEIRD = /[\u0300-\u036F\u0483-\u0489\u0591-\u05C7\u0610-\u061A\u064B-\u065F\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u1AB0-\u1AFF\u1DC0-\u1DFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F\uFEFF]|\uDB40[\uDC00-\uDC7F]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72]/g;
const TEXT_KEYS = new Set(['conversation', 'text', 'caption', 'contentText', 'description', 'footerText', 'body', 'title', 'name', 'displayName']);

/** pure check — returns { bug, severe, reasons[] } (no network, safe to unit-test) */
function detect(message) {
    const reasons = [];
    let severe = false;
    if (!message || typeof message !== 'object') return { bug: false, severe, reasons };
    let total = 0, maxField = 0, maxDepth = 0, weird = 0, textLen = 0, mentions = 0, contacts = 0, options = 0;
    const seen = new Set();
    const walk = (o, d, key) => {
        if (d > maxDepth) maxDepth = d;
        if (d > 64) return;                                     // stop walking absurd depth
        if (typeof o === 'string') {
            total += o.length; if (o.length > maxField) maxField = o.length;
            if (TEXT_KEYS.has(key) || o.length > 2000) { textLen = Math.max(textLen, o.length); const m = o.length > 300 ? o.match(WEIRD) : null; if (m) weird = Math.max(weird, m.length); }
            return;
        }
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) return;   // thumbnails / media keys
        seen.add(o);
        if (Array.isArray(o)) {
            if (key === 'mentionedJid' || key === 'groupMentions') mentions += o.length;
            else if (key === 'contacts') contacts += o.length;
            else if (/^(options|rows|buttons|sections|cards|pollOptions)$/.test(key || '')) options += o.length;
            for (let i = 0; i < o.length && i < 5000; i++) walk(o[i], d + 1, key);
            return;
        }
        for (const k of Object.keys(o)) walk(o[k], d + 1, k);
    };
    walk(message, 0, '');

    if (textLen > L.text) reasons.push(`text දිග අකුරු ${textLen}`);
    if (weird >= L.weirdMin && weird / Math.max(textLen, 1) >= L.weirdRatio) { reasons.push(`නොපෙනෙන/crash අකුරු ${weird}`); severe = true; }
    if (maxField > L.field) { reasons.push(`field එකක් අකුරු ${maxField}`); severe = true; }
    if (total > L.total) { reasons.push(`message size ${Math.round(total / 1000)}k`); severe = true; }
    if (mentions > L.mentions) { reasons.push(`mentions ${mentions}`); severe = true; }
    if (contacts > L.contacts) { reasons.push(`contacts ${contacts}`); severe = true; }
    if (options > L.options) { reasons.push(`buttons/options ${options}`); severe = true; }
    if (maxDepth > L.depth) { reasons.push(`nesting ${maxDepth}`); severe = true; }
    return { bug: reasons.length > 0, severe, reasons };
}

// ── flood (same sender, many messages fast) ──────────────────
const flood = new Map();
function floodCheck(sender, now = Date.now()) {
    const a = (flood.get(sender) || []).filter((t) => now - t < L.floodMs);
    a.push(now); flood.set(sender, a);
    if (flood.size > 2000) flood.delete(flood.keys().next().value);
    return a.length >= L.floodN;
}

// ── throttles so a bug attack can't make US spam (anti-ban) ──
const lastReport = new Map(), acts = [];
const blocked = new Set();
function actionOk(now = Date.now()) { while (acts.length && now - acts[0] > 60e3) acts.shift(); if (acts.length >= 60) return false; acts.push(now); return true; }
const adminCache = new Map();
async function botIsAdmin(sock, gid, me) {
    const c = adminCache.get(gid); if (c && Date.now() - c.at < 10 * 60e3) return c.ok;
    let ok = false;
    try { const md = await sock.groupMetadata(gid); ok = md.participants.some((p) => [me.pn, me.lid].includes(String(p.id).replace(/:\d+@/, '@')) && p.admin); } catch { }
    adminCache.set(gid, { ok, at: Date.now() }); return ok;
}

/**
 * Called for every incoming message that is NOT ours. Returns true if it was a bug (handled).
 * ctx = { sock, me:{pn,lid}, send, log }
 */
async function guard(msg, ctx) {
    if (!cfg().on || !msg?.message || msg.key?.fromMe) return false;
    const jid = msg.key.remoteJid || '';
    if (!jid || jid === 'status@broadcast' || /@(newsletter|broadcast)$/.test(jid)) return false;
    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? (msg.key.participantAlt || msg.key.participant || '') : (msg.key.remoteJidAlt || jid);
    const r = detect(msg.message);
    const isFlood = floodCheck(sender || jid);
    if (!r.bug && !(isFlood && !isGroup)) return false;
    if (!r.bug) r.reasons.push(`තත්පර 10ට messages ${L.floodN}+ (flood)`);
    const { sock, me, send, log = () => { } } = ctx;
    if (!sock || !actionOk()) return true;
    const done = [];
    if (r.bug) {
        try {
            await sock.chatModify({ deleteForMe: { deleteMedia: true, key: msg.key, timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000) } }, jid);
            done.push('🗑️ delete (මට)');
        } catch (e) { log('antibug delete: ' + e.message); }
        if (isGroup && await botIsAdmin(sock, jid, me)) {
            try { await sock.sendMessage(jid, { delete: msg.key }); done.push('🗑️ delete (හැමෝටම)'); } catch { }
        }
    }
    if (!isGroup && cfg().block && (r.severe || isFlood) && sender && !blocked.has(sender)) {
        try { await sock.updateBlockStatus(sender, 'block'); blocked.add(sender); done.push('⛔ block'); } catch (e) { log('antibug block: ' + e.message); }
    }
    const num = String(sender || jid).split('@')[0].split(':')[0];
    log(`🛡️ anti-bug: ${num} ${isGroup ? '(group ' + jid.split('@')[0] + ')' : ''} — ${r.reasons.join(', ')} → ${done.join(', ') || 'no action'}`);
    const now = Date.now();
    if (send && me?.pn && now - (lastReport.get(sender) || 0) > 5 * 60e3) {   // max 1 report / sender / 5 min
        lastReport.set(sender, now);
        const text = ['╭─❖ 🛡️ *ANTI-BUG* ❖', `│ 👤 ${num}${isGroup ? '\n│ 👥 group එකක' : ''}`, `│ ⚠️ ${r.reasons.join(' · ')}`, `│ ✅ ${done.join(' · ') || 'කරන්න දෙයක් බැරි වුණා'}`, '╰─ chat එක දැන් open කරන්න පුළුවන්'].join('\n');
        try { await send(me.pn, { text }); } catch { }
    }
    return true;
}

async function command(arg, arg2) {
    const a = (arg || '').toLowerCase(), b = (arg2 || '').toLowerCase();
    if (a === 'on' || a === 'off') setCfg({ on: a === 'on' });
    else if (a === 'block' && (b === 'on' || b === 'off')) setCfg({ block: b === 'on' });
    const c = cfg();
    return ['╭─❖ 🛡️ *ANTI-BUG* ❖',
        `│ තත්ත්වය: ${c.on ? '✅ ON' : '❌ OFF'}`,
        `│ Private chat එකේ bug එව්වොත් block: ${c.block ? '✅' : '❌'}`,
        `│ අද block කළා: ${blocked.size}`,
        '├─ *.antibug on / off*',
        '├─ *.antibug block on / off*',
        '╰─ Bug message → auto delete + report'].join('\n');
}

module.exports = { detect, guard, command, cfg, setCfg, floodCheck, L, _flood: flood, _blocked: blocked };
