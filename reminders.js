/**
 * reminders.js — ⏰ AI Reminders (v2.51)
 * .remind <time> <note> · .remind list · .remind del <n>
 * AI tool path: set_reminder / list_reminders (GLM connector එකෙන් — ai_tools.js)
 * reminders.json — restart-proof (atomic tmp+rename write)
 */
const fs = require('fs');
const path = require('path');
const FILE = process.env.ARENA_REMINDERS_FILE || path.join(__dirname, 'reminders.json');

const MIN_MS = 15e3;                 // අනාගත 15s ට වඩා තියෙන්න ඕන
const MAX_MS = 90 * 86400e3;         // උපරිම 90 දවසක් ඉස්සරහට
const MAX_PER_CHAT = 20;             // chat එකක reminders උපරිමය (anti-spam)
const MAX_NOTE = 200;

let items = [];                      // { id, chatId, at, note, by }
let getSock = () => null;
let _log = () => { };

function load() {
    try {
        const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        items = Array.isArray(j.items) ? j.items.filter(r => r && r.chatId && r.at && r.note) : [];
    } catch { items = []; }          // first run / corrupt → අලුතෙන්
}
function save() {                    // atomic — crash වුණත් file corrupt වෙන්නේ නෑ
    try {
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ v: 1, items }));
        fs.renameSync(tmp, FILE);
    } catch (e) { try { _log('⚠️ reminders save fail: ' + e.message); } catch { } }
}

const mine = (chatId) => items.filter(r => r.chatId === chatId).sort((a, b) => a.at - b.at);

function add(chatId, atMs, note, by) {
    atMs = Math.floor(Number(atMs));
    note = String(note || '').trim().slice(0, MAX_NOTE);
    if (!chatId) throw new Error('chat එකක් නෑ');
    if (!isFinite(atMs)) throw new Error('time එක වැරදියි');
    if (atMs < Date.now() + MIN_MS) throw new Error('time එක අතීතයේ (ඉස්සරහට 15s+ ඕන)');
    if (atMs > Date.now() + MAX_MS) throw new Error('too far — උපරිම දවස් 90කට');
    if (!note) throw new Error('note එකක් දෙන්න');
    if (mine(chatId).length >= MAX_PER_CHAT) throw new Error('limit — reminders 20ක් දැනටමත් තියෙනවා');
    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), chatId, at: atMs, note, by: by || 'cmd' };
    items.push(r); save();
    return r;
}

function del(chatId, n) {
    const list = mine(chatId);
    const r = list[parseInt(n, 10) - 1];
    if (!r) return null;
    items = items.filter(x => x !== r); save();
    return r;
}

function clearAll(chatId) {
    const before = items.length;
    items = items.filter(r => r.chatId !== chatId); save();
    return before - items.length;
}

// ⏱ time parser — .remind සහ AI tool දෙකටම
//   30s · 10m · 2h · 1d · 1h30m · 08:30 (අද/හෙට SL) · 2026-10-15 · ISO 8601 (+05:30 / Z)
function parseWhen(s) {
    s = String(s || '').trim().toLowerCase();
    if (!s) return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2})?(\+05:30|z)?$/.test(s)) {
        let iso = s.replace(' ', 'T').replace('t', 'T');
        if (/z$/.test(iso) || /\+05:30$/.test(iso)) { iso = iso.replace(/z$/, 'Z'); }   // already absolute
        else if (/T\d{2}:\d{2}$/.test(iso)) iso += ':00+05:30';
        else if (/T\d{2}:\d{2}:\d{2}$/.test(iso)) iso += '+05:30';
        else iso += 'T12:00:00+05:30';   // date-only → දවල් 12 (SL)
        const t = Date.parse(iso);
        if (isFinite(t)) return t;
    }
    const m = s.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);   // relative
    if (m && /[dhms]/.test(s)) {
        const d = +(m[1] || 0), h = +(m[2] || 0), mi = +(m[3] || 0), se = +(m[4] || 0);
        if (d + h + mi + se > 0) return Date.now() + ((d * 86400 + h * 3600 + mi * 60 + se) * 1000);
    }
    const hm = s.match(/^(\d{1,2}):(\d{2})$/);   // HH:MM — SL time, past → හෙට
    if (hm && +hm[1] < 24 && +hm[2] < 60) {
        const sl = new Date(Date.now() + 5.5 * 3600e3);
        let t = Date.UTC(sl.getUTCFullYear(), sl.getUTCMonth(), sl.getUTCDate(), +hm[1], +hm[2]) - 5.5 * 3600e3;
        if (t < Date.now() + MIN_MS) t += 86400e3;
        return t;
    }
    return NaN;
}

// 🖨 readable SL time + relative — "Wed 15/10 08:00 SL (1.2h)"
function fmtWhen(at) {
    const sl = new Date(Number(at) + 5.5 * 3600e3);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const p = (n) => String(n).padStart(2, '0');
    const txt = `${days[sl.getUTCDay()]} ${sl.getUTCDate()}/${sl.getUTCMonth() + 1} ${p(sl.getUTCHours())}:${p(sl.getUTCMinutes())}`;
    const rel = Number(at) - Date.now();
    const relTxt = rel < 0 ? 'පරක්කු' : rel < 60e3 ? `${Math.max(1, Math.round(rel / 1000))}s`
        : rel < 3600e3 ? `${Math.round(rel / 60e3)}m`
            : rel < 86400e3 ? `${(rel / 3600e3).toFixed(1)}h` : `${(rel / 86400e3).toFixed(1)}d`;
    return `${txt} SL (${relTxt})`;
}

// 🔁 scheduler — due වෙච්ච reminders WhatsApp එකට යවනවා
async function tick() {
    const now = Date.now();
    const due = items.filter(r => r.at <= now);
    if (!due.length) return 0;
    const sock = getSock();
    let fired = 0, changed = false;
    for (const r of due) {
        if (now - r.at > 7 * 86400e3) { items = items.filter(x => x !== r); changed = true; continue; }   // දවස් 7ට වඩා පරණ → drop
        if (!sock) continue;   // connect නෑ → ඊළඟ tick එකේ ආයෙත් try
        items = items.filter(x => x !== r); changed = true;
        const late = now - r.at;
        const lateTxt = late > 10 * 60e3 ? `\n⚠️ පරක්කු — ${fmtWhen(r.at)} ට දාපු එක` : '';
        const card = `⏰ *මතක් කිරීම*\n\n✦ ${r.note}${lateTxt}\n\n> ${fmtWhen(r.at)} ට දාපු reminder එකක්`;
        try { await sock.sendMessage(r.chatId, { text: card }); fired++; _log(`⏰ reminder fired → ${r.chatId}: ${r.note.slice(0, 50)}`); }
        catch (e) { _log('⚠️ reminder send fail: ' + e.message); }
    }
    if (changed) save();
    return fired;
}

function start(opts = {}) {
    getSock = opts.getSock || getSock;
    _log = opts.log || _log;
    load();
    const iv = setInterval(() => { tick().catch(() => { }); }, 20e3);
    if (iv.unref) iv.unref();
    tick().catch(() => { });   // restart එකේදී miss වෙච්ච (පරක්කු වෙච්ච) ඒවා කෙලින්ම fire
    return items.length;
}

// 🤖 AI tool wrappers — ai_tools.js set_reminder / list_reminders වලින් call වෙනවා
function toolAdd(chatId, timeStr, note) {
    const t = parseWhen(timeStr);
    if (!isFinite(t)) throw new Error('bad time — ISO 8601 ඕන (උදා 2026-10-15T08:00:00+05:30)');
    const r = add(chatId, t, note, 'ai');
    return `Reminder set ✓\n⏰ ${fmtWhen(r.at)}\n📝 ${r.note}`;
}
function toolList(chatId) {
    const l = mine(chatId);
    if (!l.length) return 'Active reminders නෑ.';
    return l.map((r, i) => `${i + 1}. ${fmtWhen(r.at)} — ${r.note}`).join('\n');
}

module.exports = { add, del, clearAll, list: mine, parseWhen, fmtWhen, tick, start, toolAdd, toolList, _load: load, _save: save, _file: FILE, _items: () => items };
