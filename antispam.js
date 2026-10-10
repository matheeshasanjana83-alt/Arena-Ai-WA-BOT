/**
 * antispam.js — KAVIZ MD V1 🚫 Anti-spam + block toolkit (v2.20)
 *
 * Spammers ලාට එරෙහිව owner ට තියෙන හැම tool එකක්ම මෙතන (හැම එකක්ම owner විතරයි):
 *   .block <number|reply>   — number එක block (ඒ කෙනාගෙ messages ආයෙත් එන්නෙම නෑ)
 *   .unblock <number|reply> — ආයෙත් unblock කරන්න
 *   .blocklist              — block කරලා තියෙන ලැයිස්තුව
 *   .antispam on|off|<N>    — DM flood guard: මිනිත්තුවකට N ට වැඩියෙන් messages එවන
 *                             කෙනෙක් → auto block + log + ඔයාට notice එකක්
 *   .spamlog                — auto-block වුණ අලුත්ම සිදුවීම්
 *
 * ⚠️ Report ගැන සත්‍යය: WhatsApp "report" කරන එකට තියෙන එකම පාර phone එකේ
 *    Report button එක (ඒක යවන්නෙ ඔයාගෙ අන්තිම messages 5 ම evidence විදිහට,
 *    WhatsApp එකේ කණ්ඩායමක් බලනවා). Bot එකෙන් report flood කරන එක:
 *      • එක number එකකින් යවන reports ගණන් කරන්නෙ නෑ (same-reporter dedupe)
 *      • automated report messages = WhatsApp anti-abuse flag → ඔයාගෙම number එක ban
 *    ඒ නිසා මෙතන block (server-side, 100% legal) විතරයි — report flood නෑ.
 *    Spammer කෙනෙක්ට: phone එකෙන් Report button එක ඔබන්න (1 පාර) + .block.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'antispam.json');
const WINDOW_MS = 60e3;          // flood window: 1 minute
const FRESH_MS = 5 * 60e3;       // messages older than this never count (history-sync false blocks වළක්වන්න)
const CAP = 300;                 // blocked/log list caps

// ── persistence ───────────────────────────────────────────
const readState = () => {
    try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { on: !!d.on, perMin: clampN(d.perMin, 10), blocked: Array.isArray(d.blocked) ? d.blocked : [], log: Array.isArray(d.log) ? d.log : [] }; }
    catch { return { on: false, perMin: 10, blocked: [], log: [] }; }
};
const writeState = (d) => { try { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); } catch { } };
function clampN(v, def) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(120, Math.max(3, n)) : def; }

const flood = new Map();         // sender jid → timestamps[] (memory only)

// ── jid helpers ───────────────────────────────────────────
const bare = (j) => String(j || '').split('@')[0].split(':')[0];
const fullJid = (j) => { const s = String(j || '').split('@'); return (s[0] || '').split(':')[0] + '@' + (s[1] || 's.whatsapp.net'); };

/** .block 9476xxxxxxx / 076xxxxxxx / +94-76-xxxxxxx / jid@lid → full jid (or null) */
function normTarget(raw) {
    if (!raw) return null;
    const t = String(raw).trim();
    if (!t) return null;
    if (t.includes('@')) { const [u, s] = t.split('@'); return bare(u) + '@' + (s || 's.whatsapp.net'); }
    let d = t.replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('0') && d.length === 10) d = '94' + d.slice(1);   // 076xxxxxxx → 9476xxxxxxx
    if (d.length < 7 || d.length > 15) return null;
    return d + '@s.whatsapp.net';
}

/** reply කරපු message එකේ sender (group member කෙනෙක්ව block කරන්නත් වැඩ) */
function replyTarget(msg) {
    const p = msg?.message?.extendedTextMessage?.contextInfo?.participant;
    if (!p) return null;
    return bare(p) + '@' + (String(p).includes('@') ? String(p).split('@')[1] : 's.whatsapp.net');
}

const isBlocked = (jid) => readState().blocked.some((b) => b.jid === jid);
const push = (arr, item) => { arr.push(item); while (arr.length > CAP) arr.shift(); };

// ── flood guard (auto) ────────────────────────────────────
/**
 * හැම non-owner message එකකටම call වෙනවා (bot.js එකෙන්).
 * @returns {Promise<boolean>} true = මේ message එකෙන් auto-block වුණා
 */
async function see(msg, { sock, me, send, log } = {}) {
    try {
        const key = msg?.key;
        if (!key || key.fromMe === true || !msg.message) return false;
        const chat = String(key.remoteJid || '');
        if (!chat || chat.endsWith('@g.us') || chat.endsWith('@broadcast') || chat.endsWith('@newsletter')) return false;
        const sender = fullJid(key.remoteJidAlt || chat);
        if (bare(sender) === bare(me?.pn) || bare(sender) === bare(me?.lid)) return false;
        const st = readState();
        if (st.blocked.some((b) => b.jid === sender)) return false;   // දැනටමත් block — flood track කරන්නෙ නෑ
        if (!st.on) return false;
        const ts = Number(msg.messageTimestamp || 0) * 1000;
        const now = Date.now();
        if (!ts || Math.abs(now - ts) > FRESH_MS) return false;       // පරණ history sync — ignore
        const arr = (flood.get(sender) || []).filter((t) => now - t < WINDOW_MS);
        arr.push(now);
        flood.set(sender, arr);
        if (arr.length <= st.perMin) return false;
        // 🚫 flood → auto block
        if (sock?.updateBlockStatus) await sock.updateBlockStatus(sender, 'block');
        push(st.blocked, { jid: sender, at: now, reason: `flood ${arr.length} msg/min` });
        push(st.log, { jid: sender, at: now, reason: `auto-block (flood ${arr.length} msg/min, limit ${st.perMin})` });
        writeState(st);
        flood.delete(sender);
        if (log) log(`🚫 anti-spam: ${sender} auto-block (${arr.length} msg/min)`);
        if (send && me?.pn) send(me.pn, {
            text: `🚫 *Anti-spam*\n\n${sender} — මිනිත්තුවක් ඇතුළත messages *${arr.length}* ක් එව්වා (limit ${st.perMin}).\nඒ number එක *block* කළා ✅ — ඒ chat එකෙන් ආයෙ messages එන්නෙ නෑ.\n\nආයෙ unblock කරන්න: *.unblock ${sender.split('@')[0]}*`
        }).catch(() => { });
        return true;
    } catch { return false; }
}

// ── .block / .unblock (manual) ────────────────────────────
async function blockCommand(sock, msg, raw, me) {
    if (!sock || !sock.updateBlockStatus) return '❌ WhatsApp connect වෙලා නෑ — ටිකකින් ආයෙ try කරන්න.';
    let jid = normTarget(raw) || replyTarget(msg);
    if (!jid) return '🚫 *Block කරන්න*\n\n*.block <නම්බර්>*  (උදා: .block 94761234567)\n*.block* — spam message එකකට *reply* කරලා ගහන්න\n\nBlock කරපු ලැයිස්තුව: *.blocklist*';
    if (bare(jid) === bare(me?.pn) || bare(jid) === bare(me?.lid)) return '😅 ඔයාටම block කරන්න බෑ — ඒ ඔයාගෙම නම්බර් එක.';
    try { await sock.updateBlockStatus(jid, 'block'); } catch (e) { return '❌ Block fail: ' + e.message; }
    const st = readState();
    if (!st.blocked.some((b) => b.jid === jid)) push(st.blocked, { jid, at: Date.now(), reason: 'manual (.block)' });
    push(st.log, { jid, at: Date.now(), reason: 'manual .block' });
    writeState(st);
    return `🚫 Block කළා ✅ *${jid.split('@')[0]}*\nඒ number එකෙන් ආයෙ messages / calls ඔයාට එන්නෙ නෑ.\n\n💡 ඒ කෙනා phone එකෙනුත් report කරන්න ඕනෙ නම්: chat එක open කරලා ⋮ → *Report* (අන්තිම messages 5 WhatsApp එකට යනවා — ඒක තමයි report කරන එකම පාර).\nලැයිස්තුව: *.blocklist* • ආපහු: *.unblock ${jid.split('@')[0]}*`;
}

async function unblockCommand(sock, msg, raw, me) {
    if (!sock || !sock.updateBlockStatus) return '❌ WhatsApp connect වෙලා නෑ — ටිකකින් ආයෙ try කරන්න.';
    const jid = normTarget(raw) || replyTarget(msg);
    if (!jid) return '✅ *Unblock කරන්න*\n\n*.unblock <නම්බර්>*  (උදා: .unblock 94761234567)\n*.unblock* — block කරපු chat එකේ message එකකට reply කරලා';
    if (bare(jid) === bare(me?.pn) || bare(jid) === bare(me?.lid)) return '😅 ඔයාටම unblock කරන්න දෙයක් නෑ — ඒ ඔයාගෙම නම්බර් එක.';
    try { await sock.updateBlockStatus(jid, 'unblock'); } catch (e) { return '❌ Unblock fail: ' + e.message; }
    const st = readState();
    st.blocked = st.blocked.filter((b) => b.jid !== jid);
    writeState(st);
    return `✅ Unblock කළා *${jid.split('@')[0]}* — ඒ number එකෙන් ආයෙ messages එන්න පුළුවන්.`;
}

// ── .blocklist / .spamlog / .antispam ─────────────────────
const fmt = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour12: false });

function listText() {
    const { blocked } = readState();
    if (!blocked.length) return '📋 Block list එක හිස්. 🎉\n\nBlock කරන්න: *.block <නම්බර්>* හෝ spam message එකකට reply කරලා *.block*';
    const rows = blocked.slice(-50).reverse().map((b, i) => `${i + 1}. ${b.jid.split('@')[0]} — ${fmt(b.at)}${b.reason ? '  (' + b.reason + ')' : ''}`);
    return `📋 *Block list* — ${blocked.length} ක්\n\n${rows.join('\n')}\n\nUnblock: *.unblock <නම්බර්>*`;
}

function logText() {
    const { log } = readState();
    if (!log.length) return '📜 Spam log එක හිස් — තාම කිසිම block එකක් වෙලා නෑ.\n\nFlood guard on/off: *.antispam on|off*';
    const rows = log.slice(-15).reverse().map((e, i) => `${i + 1}. ${e.jid.split('@')[0]} — ${fmt(e.at)}\n    ${e.reason}`);
    return `📜 *Spam log* (අලුත්ම 15)\n\n${rows.join('\n')}`;
}

function command(sub, arg) {
    const st = readState();
    const s = String(sub || '').toLowerCase().trim();
    if (!s || s === 'status') {
        return `🚫 *Anti-spam* — ${st.on ? '🟢 ON' : '🔴 OFF'}\nFlood limit: මිනිත්තුවකට messages *${st.perMin}* ට වැඩිනම් → auto block\nBlock list: *${st.blocked.length}* ක්  •  Log: *${st.log.length}* ක්\n\n*.antispam on* — guard එක on\n*.antispam off* — off\n*.antispam <N>* — limit එක වෙනස් (උදා: .antispam 15)\nManual block: *.block <නම්බර්|reply>*`;
    }
    if (s === 'on') { st.on = true; writeState(st); return `🟢 Anti-spam *ON* — DM වලින් මිනිත්තුවකට ${st.perMin} ට වැඩි messages එවන උන් auto block වෙනවා (blocklist + spamlog එකට යනවා, ඔයාට notice එකකුත් එනවා).\nLimit වෙනස් කරන්න: *.antispam <N>*`; }
    if (s === 'off') { st.on = false; writeState(st); return '🔴 Anti-spam *OFF* — auto block නෑ. Manual block විතරයි: *.block <නම්බර්|reply>*'; }
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) { st.perMin = clampN(n, 10); writeState(st); return `✅ Flood limit: මිනිත්තුවකට *${st.perMin}* messages.\nGuard එක ${st.on ? '🟢 ON' : '🔴 OFF — on කරන්න *.antispam on*'}\n\n💡 සාමාන්‍ය අය මිනිත්තුවකට 10 ට වැඩියෙන් DM කරන්නෙ නෑ — 10 හොඳ default එකක්.`; }
    return '🚫 *Anti-spam*\n\n*.antispam* — status\n*.antispam on* / *.antispam off*\n*.antispam <N>* — මිනිත්තුවකට limit (3–120)\n*.block <නම්බර්|reply>* — manual block\n*.unblock <නම්බර්|reply>*  •  *.blocklist*  •  *.spamlog*';
}

module.exports = { see, command, blockCommand, unblockCommand, listText, logText, normTarget, replyTarget, isBlocked };
