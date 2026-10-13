/**
 * antibug.js — KAVIZ MD V1 🛡️ Anti-Bug (v2.33.0 — auto report ×30 → block retaliation)
 *
 * "Bug" messages = messages built to freeze/crash WhatsApp. Covers EVERY class the
 * MishuCrasher-style bug-panel APKs offer (virama/sign storms, combining-mark storms,
 * invisible floods, RTL/control/filler storms, media dimension bombs, location coordinate
 * bugs, giant waveform arrays, mention/contact/option bombs, deep nesting, giant texts,
 * vCard bombs, message floods) — plus the original generic size/structure detectors.
 *
 * When one arrives (from SOMEONE ELSE, never your own messages):
 *   1. delete it "for me" → WhatsApp syncs that to your phone, so the chat opens again
 *   2. group + bot is admin → delete it for everyone
 *   3. SEVERE bug / flood → 🚀 auto REPORT the bug sender ×30 (background, ~1s apart —
 *      the same "Report" action you do by hand) and WHEN THE REPORTS FINISH → ⛔ block.
 *      ONLY the bug sender — you / your own messages are never touched.
 *      (.antibug report on|off · .antibug count <1-100> · .antibug block on|off)
 *   4. a short report in your "Message yourself" chat (never the bug text itself)
 *   5. `.antibug scan` lists the bugs caught recently
 *
 * Statuses (status@broadcast) and newsletters are scanned too — a bug there is deleted for you
 * and the sender reported, but NEVER blocked (blocking happens in private chats only).
 *
 * Limits (honest): the report is the same server call the official app sends when you report —
 * WhatsApp decides what it does with it; the BLOCK is the guaranteed hammer. The phone receives
 * the message at the same moment as the bot, so if that chat is open on screen it can still lag
 * for a second or two before the delete arrives. Detection is pattern-based — a brand-new kind
 * of bug can slip through. Statuses are only fetched when you open the Status tab — keep it
 * closed until the bot reports clean. The bot cannot scan your phone's saved contacts; delete
 * unknown recently-saved contacts if the Contacts app lags.
 */
const fs = require('fs');
const path = require('path');

const SET = path.join(__dirname, 'settings.json');
const readSet = () => { try { return JSON.parse(fs.readFileSync(SET, 'utf8')); } catch { return {}; } };
const writeSet = (d) => { try { fs.writeFileSync(SET, JSON.stringify(d, null, 2)); } catch { } };

const clampCount = (n) => { const v = Number(n); if (!Number.isFinite(v) || v <= 0) return 30; return Math.min(Math.max(Math.floor(v), 1), 100); };
function cfg() {
    const a = readSet().antibug || {};
    return {
        on: a.on !== false,
        block: a.block !== false,
        report: a.report !== false,
        reportCount: clampCount(a.reportCount),
    };
}
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
    run: 8000,          // one unbroken run (no whitespace) longer than this
    invMin: 2000,       // invisible-only: text at least this long ...
    invVisible: 50,     // ... but fewer visible characters than this
    vcardTel: 20,       // one contact card with more phone numbers than this
    vcardLines: 200,    // one vCard with more lines than this
    // ── v2.32: crasher-panel classes (MishuCrasher-style bug tools) ──
    markRun: 20,        // ≥20 consecutive combining marks (\p{M}) — virama/Arabic/Balinese/Indic storms
    sinhRun: 15,        // ≥15 consecutive Sinhala signs (් ා ැ … + ZWJ) — the local classic bug
    ctrl: 200,          // control chars (NUL/ESC…) in one string — normal text has 0
    arrLen: 2048,       // giant arrays (waveform bombs etc.)
    mediaDim: 10000,    // image/video/sticker width|height above this = bitmap OOM bomb
    mediaPix: 40000000, // …or total pixels absurd (4K frame = 8.3M — safe)
    durMax: 604800,     // audio/video duration above 7 days = UI glitch bomb
};

// invisible / combining / direction-control characters used by "virtex" bugs.
// (Sinhala vowel signs U+0D80–0DFF are NOT in here — the sinhRun rule below handles their STORMS
// without flagging normal Sinhala text; a normal emoji ZWJ is far below the limits)
const WEIRD = /[\u0300-\u036F\u0483-\u0489\u0591-\u05C7\u0610-\u061A\u064B-\u065F\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u1AB0-\u1AFF\u1DC0-\u1DFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F\uFEFF\u115F-\u1160\u180B-\u180F\u3164\uFFA0\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDDEF]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72]/g;
const MARK_RE = /\p{M}/u;                                              // ANY combining mark (unicode)
const SINH_RE = /[\u0DCA\u0DCF-\u0DDF\u200D]/;                        // Sinhala signs + ZWJ ("්‍" runs)
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;
const longestRun = (s, re) => { let m = 0, c = 0; for (const ch of s) { if (re.test(ch)) { if (++c > m) m = c; } else c = 0; } return m; };
const TEXT_KEYS = new Set(['conversation', 'text', 'caption', 'contentText', 'description', 'footerText', 'body', 'title', 'name', 'displayName', 'subject']);

/** pure check — returns { bug, severe, reasons[] } (no network, safe to unit-test) */
function detect(message) {
    const reasons = [];
    let severe = false;
    if (!message || typeof message !== 'object') return { bug: false, severe, reasons };
    let total = 0, maxField = 0, maxDepth = 0, weird = 0, textLen = 0, mentions = 0, contacts = 0, options = 0;
    let maxRun = 0, vTel = 0, vLines = 0, longest = '', longestWeird = 0;
    let markRun = 0, sinhRun = 0, ctrlMax = 0, arrBig = 0, medDim = '', badLoc = false, durBig = 0;
    const seen = new Set();
    const walk = (o, d, key) => {
        if (d > maxDepth) maxDepth = d;
        if (d > 64) return;                                     // stop walking absurd depth
        if (typeof o === 'number') {                            // v2.32: coordinate/duration bombs
            if (key === 'degreesLatitude' || key === 'degreesLongitude') {
                const lim = key === 'degreesLatitude' ? 90.1 : 180.1;
                if (!Number.isFinite(o) || Math.abs(o) > lim) badLoc = true;
            } else if (key === 'seconds' && o > L.durMax) durBig = o;
            return;
        }
        if (typeof o === 'string') {
            total += o.length; if (o.length > maxField) maxField = o.length;
            if (key === 'vcard') {                                   // contact-card bombs
                const t = (o.match(/TEL/gi) || []).length; if (t > vTel) vTel = t;
                const nl = (o.match(/\r?\n/g) || []).length; if (nl > vLines) vLines = nl;
            }
            if (TEXT_KEYS.has(key) || o.length > 2000) {
                textLen = Math.max(textLen, o.length);
                const m = o.length > 300 ? o.match(WEIRD) : null; if (m) weird = Math.max(weird, m.length);
                if (o.length >= longest.length) { longest = o; longestWeird = m ? m.length : 0; }
                if (o.length > 2000 && maxRun <= L.run) {           // longest unbroken run
                    let run = 0;
                    for (const ch of o) { if (/\s/.test(ch)) run = 0; else if (++run > maxRun) { maxRun = run; if (maxRun > L.run) break; } }
                }
                if (o.length > 300) {                               // v2.32: mark/sign/control storms
                    if (MARK_RE.test(o)) { const mr = longestRun(o, MARK_RE); if (mr > markRun) markRun = mr; }
                    if (o.includes('\u0DCA') || o.includes('\u200D')) { const sr = longestRun(o, SINH_RE); if (sr > sinhRun) sinhRun = sr; }
                    const cm = o.match(CTRL_RE); if (cm && cm.length > ctrlMax) ctrlMax = cm.length;
                }
            }
            return;
        }
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) return;   // thumbnails / media keys
        seen.add(o);
        if (Array.isArray(o)) {
            if (key === 'mentionedJid' || key === 'groupMentions') mentions += o.length;
            else if (key === 'contacts') contacts += o.length;
            else if (/^(options|rows|buttons|sections|cards|pollOptions)$/.test(key || '')) options += o.length;
            if (o.length > L.arrLen && key !== 'mentionedJid' && key !== 'groupMentions' && key !== 'contacts') arrBig = Math.max(arrBig, o.length);
            for (let i = 0; i < o.length && i < 5000; i++) walk(o[i], d + 1, key);
            return;
        }
        if (typeof o.width === 'number' && typeof o.height === 'number') {   // v2.32: media dimension bombs
            const mx = Math.max(o.width, o.height);
            if (mx > L.mediaDim || o.width * o.height > L.mediaPix) medDim = `${o.width}x${o.height}`;
        }
        for (const k of Object.keys(o)) walk(o[k], d + 1, k);
    };
    walk(message, 0, '');
    if (markRun > L.markRun) { reasons.push(`combining-mark storm run ${markRun}`); severe = true; }
    if (sinhRun > L.sinhRun) { reasons.push(`සිංහල විරාම/සංඥා storm run ${sinhRun}`); severe = true; }
    if (ctrlMax > L.ctrl) { reasons.push(`control chars ${ctrlMax}`); severe = true; }
    if (medDim) { reasons.push(`media dimension bomb ${medDim}`); severe = true; }
    if (badLoc) { reasons.push('location coordinates bug'); severe = true; }
    if (arrBig > L.arrLen) reasons.push(`giant array ${arrBig}`);
    if (durBig) reasons.push(`duration ${Math.round(durBig / 3600)}h`);
    if (maxRun > L.run) { reasons.push(`long unbroken run ${maxRun}`); severe = true; }
    if (longest.length >= L.invMin && longest.length - longestWeird < L.invVisible) { reasons.push('pure invisible message'); severe = true; }
    if (vTel > L.vcardTel) { reasons.push(`contact card TEL ${vTel}`); severe = true; }
    if (vLines > L.vcardLines) { reasons.push(`vCard lines ${vLines}`); severe = true; }

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
const recent = [];   // last handled bugs, for `.antibug scan`
const blocked = new Set();

// ── v2.33: RETALIATION — bug ගහපු එකාට විතරයි: auto report ×N → ඉවර උනාම block ──
const RETAL_COOLDOWN_MS = 10 * 60e3;         // one retaliation per sender / 10 min
const retaliated = new Map();                // sender → last retaliation ts
const retalRunning = new Map();              // sender → promise (tests await it)
const normJid = (j) => String(j || '').replace(/:\d+@/, '@');   // strip device suffix (baileys style)
const TEST_FAST = process.env.ANTIBUG_TEST_FAST === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** raw WhatsApp "Report" — the same moderation IQ the official app sends when you report a message */
function reportSpam(sock, sender, key) {
    return sock.query({
        tag: 'iq',
        attrs: { to: 's.whatsapp.net', type: 'set', xmlns: 'jabber:client' },
        content: [{
            tag: 'moderation',
            attrs: { xmlns: 'urn:xmp:mex:action?moderation:1' },
            content: [{
                tag: 'content',
                attrs: { type: 'message', msg_id: key && key.id, participant: sender },
                content: [{ tag: 'report', attrs: { reason: 'spam' } }],
            }],
        }],
    });
}

/**
 * Bug sender retaliation: report ×N (human-paced) → then block (private only).
 * NEVER touches the owner/bot itself. Returns { ok, want, blockedNow } or { skip }.
 */
async function retaliate(sender, ctx, meta = {}) {
    const { sock, me, send, log = () => { } } = ctx;
    const c = cfg();
    if (!sender || !sock) return { skip: 'no sender/sock' };
    const sNorm = normJid(sender);
    const meKeys = [me && me.pn, me && me.lid].filter(Boolean).map(normJid);
    if (meKeys.includes(sNorm)) return { skip: 'owner' };                        // NEVER report/block yourself
    if (retaliated.has(sNorm) && Date.now() - retaliated.get(sNorm) < RETAL_COOLDOWN_MS) return { skip: 'cooldown' };
    retaliated.set(sNorm, Date.now());
    const want = c.report ? c.reportCount : 0;
    let ok = 0, blockedNow = false, blockErr = '';
    for (let i = 0; i < want; i++) {
        try { await reportSpam(sock, sender, meta.key); ok++; }
        catch (e) { log(`antibug report ${i + 1}/${want}: ${e.message}`); }
        if (i < want - 1) await sleep(TEST_FAST ? 1 : 700 + Math.floor(Math.random() * 700));   // human pacing (anti-ban)
    }
    if (meta.canBlock && c.block && !blocked.has(sNorm)) {
        try { await sock.updateBlockStatus(sender, 'block'); blocked.add(sNorm); blockedNow = true; }
        catch (e) { blockErr = e.message; log('antibug block: ' + e.message); }
    }
    if (send && me?.pn) {                                                        // honest final card
        const who = sNorm.split('@')[0];
        const rLine = want ? `│ 📨 report: ${ok}/${want}${ok === want ? ' ✅' : ok ? ' ⚠️' : ' ❌ (server reject)'}` : '│ 📨 report: OFF';
        const bLine = !meta.canBlock ? '│ ⛔ block: — (private chat වලට විතරයි)'
            : c.block ? `│ ⛔ block: ${blockedNow ? '✅ කළා' : '❌ ' + (blockErr || 'fail')}` : '│ ⛔ block: OFF';
        const text = ['╭─❖ 🛡️ *AUTO REPORT + BLOCK* ❖', `│ 👤 bug ගහපු එකා: ${who}`, rLine, bLine, '╰─ 🛡️ ඒ එකාගෙන් දැන් bug එන්නේ නෑ'].join('\n');
        try { await send(me.pn, { text }); } catch { }
    }
    return { ok, want, blockedNow };
}

/** fire-and-forget starter — the message loop never waits for the 30 reports */
function startRetaliate(sender, ctx, meta = {}) {
    const p = retaliate(sender, ctx, meta).catch(() => ({ skip: 'error' }));
    retalRunning.set(normJid(sender), p);
    return p;
}
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
    if (!jid || (jid.endsWith('@broadcast') && jid !== 'status@broadcast')) return false;   // old broadcast lists skipped; status IS scanned
    const isStatus = jid === 'status@broadcast', isNews = jid.endsWith('@newsletter');
    const isGroup = jid.endsWith('@g.us');
    const isPrivate = !isGroup && !isStatus && !isNews;
    const sender = isGroup ? (msg.key.participantAlt || msg.key.participant || '') : isStatus ? (msg.key.participant || '') : (msg.key.remoteJidAlt || jid);
    const r = detect(msg.message);
    const isFlood = isPrivate && floodCheck(sender || jid);   // statuses arrive in bursts — never flood-check those
    if (!r.bug && !isFlood) return false;
    if (!r.bug) r.reasons.push(`flood: 10s messages ${L.floodN}+`);
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
    // ── v2.33: RETALIATION — bug ගහපු එකාට විතරයි: auto report ×N → ඉවර උනාම block ──
    // (background run — the message loop never waits for the reports; block lands AFTER them)
    if ((r.severe || isFlood) && sender) {
        const c = cfg();
        const bits = [];
        if (c.report) bits.push(`🚀 auto-report ×${c.reportCount}`);
        if (isPrivate && c.block) bits.push('⛔ block');
        if (bits.length) {
            done.push(bits.join(' → '));
            startRetaliate(sender, ctx, { key: msg.key, canBlock: isPrivate });
        }
    }
    const num = String(sender || jid).split('@')[0].split(':')[0];
    log(`🛡️ anti-bug: ${num} ${isGroup ? '(group ' + jid.split('@')[0] + ')' : isStatus ? '(status)' : isNews ? '(newsletter)' : ''} — ${r.reasons.join(', ')} → ${done.join(', ') || 'no action'}`);
    recent.push({ at: new Date(), num, where: isGroup ? 'group' : isStatus ? 'status' : isNews ? 'newsletter' : 'private', reasons: r.reasons.join(' · '), done: done.join(' · ') || '-' });
    if (recent.length > 20) recent.shift();
    const now = Date.now();
    if (send && me?.pn && now - (lastReport.get(sender) || 0) > 5 * 60e3) {   // max 1 report / sender / 5 min
        lastReport.set(sender, now);
        const text = ['╭─❖ 🛡️ *ANTI-BUG* ❖', `│ 👤 ${num}${isGroup ? '\n│ 👥 group එකක' : ''}`, `│ ⚠️ ${r.reasons.join(' · ')}`, `│ ✅ ${done.join(' · ') || 'කරන්න දෙයක් බැරි වුණා'}`, '╰─ chat එක දැන් open කරන්න පුළුවන්'].join('\n');
        try { await send(me.pn, { text }); } catch { }
    }
    return true;
}

function scanText() {
    if (!recent.length) return ['╭─❖ 🛡️ *ANTI-BUG SCAN* ❖', '╰─ caught bugs nothing — clean ✅'].join('\n');
    const rows = recent.slice(-10).reverse().map((e) =>
        `│ 🕐 ${e.at.toTimeString().slice(0, 8)} ${e.where === 'group' ? '👥 group' : e.where === 'status' ? '📍 status' : e.where === 'newsletter' ? '📰 newsletter' : '👤 private'} ${e.num}\n│ ⚠️ ${e.reasons}\n│ ✅ ${e.done}`);
    return ['╭─❖ 🛡️ *ANTI-BUG SCAN* ❖', `│ caught bugs ${recent.length} (last 10)`, ...rows, '╰─ report eke bug text penne ne'].join('\n');
}

// ── .antibug test — synthetic crasher-payload self-test (IN-MEMORY ONLY, nothing is ever sent) ──
function selfTest() {
    const R = [];
    const push = (name, msg, expectSevere) => {
        const r = detect(msg);
        R.push({ name, ok: r.bug && (!expectSevere || r.severe), bug: r.bug, severe: r.severe, why: r.reasons.join(', ') || '-' });
    };
    const fp = (name, msg) => {
        const r = detect(msg);
        R.push({ name, ok: !r.bug, bug: r.bug, severe: r.severe, why: r.reasons.join(', ') || '-' });   // normal → NO detection = pass
    };
    // ── bug classes (MishuCrasher-panel menu equivalents) ──
    push('සිංහල විරාම storm', { conversation: '්ා'.repeat(600) }, true);
    push('combining-mark storm', { conversation: 'ا' + 'ًٌٍَُِّ'.repeat(500) }, true);
    push('ZWSP flood', { conversation: 'a\u200B'.repeat(2000) }, true);
    push('pure invisible', { conversation: '\u200B'.repeat(3000) }, true);
    push('RTL override storm', { conversation: 'a\u202E'.repeat(1200) }, true);
    push('control-char storm', { conversation: 'a\u0000'.repeat(400) }, true);
    push('filler flood (U+3164)', { conversation: '\u3164'.repeat(3000) }, true);
    push('image dimension bomb', { imageMessage: { width: 99999, height: 99999, caption: 'x' } }, true);
    push('video dimension bomb', { videoMessage: { width: 1, height: 999999, seconds: 10 } }, true);
    push('location coordinate bug', { locationMessage: { degreesLatitude: 1e300, degreesLongitude: 90 } }, true);
    push('giant waveform array', { audioMessage: { seconds: 30, waveform: new Array(5000).fill(9) } }, false);
    push('unbroken run', { conversation: 'X'.repeat(9000) }, true);
    push('huge text', { conversation: 'word '.repeat(4000) }, false);   // bug (delete) but NOT block-severe
    push('vCard bomb', { contactMessage: { displayName: 'v', vcard: Array.from({ length: 40 }, (_, i) => `TEL;TYPE=CELL:+94${i}\n`).join('') } }, true);
    push('mention bomb', { conversation: 'hi', extendedTextMessage: { text: 'hi', mentionedJid: Array.from({ length: 300 }, (_, i) => `${i}@s.whatsapp.net`) } }, false);
    // ── false positives (normal chat must NEVER trigger) ──
    fp('සාමාන්‍ය සිංහල', { conversation: 'මම ගෙදර යනවා යාළුවෙන් එක්ක පාරට. ඔයා හොඳට ඉන්න, ෆෝන් එකත් බලාගන්න. ර්‍යාංශ මිටියාවත ගිනිකෙළිය.' });
    fp('Quran tashkeel', { conversation: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ مَالِكِ يَوْمِ الدِّينِ' });
    fp('family emoji ZWJ', { conversation: '👨‍👩‍👧‍👦 ❤️ 🇱🇰 කට්ටිය හැමෝටම ජය! ඔයාගේ photo එක ලස්සනයි 👌' });
    fp('4K video', { videoMessage: { width: 3840, height: 2160, seconds: 600 } });
    fp('normal location', { locationMessage: { degreesLatitude: 6.9271, degreesLongitude: 79.8612 } });
    fp('long normal message', { conversation: 'මේක නිකන් දිග message එකක්. '.repeat(200) });
    fp('normal voice note', { audioMessage: { seconds: 180, waveform: new Array(64).fill(3) } });
    const pass = R.filter((r) => r.ok).length;
    const lines = ['╭─❖ 🛡️ *ANTI-BUG SELF-TEST* ❖'];
    for (const r of R) lines.push(`│ ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : ' ← ' + r.why}`);
    lines.push(`╰─ ${pass}/${R.length} — ${pass === R.length ? 'හැම bug class එකක්ම detect ✅' : 'කැඩුණු cases තියෙනවා ⚠️'} (test = memory only, කිසිවක් යවන්නේ නෑ)`);
    return lines.join('\n');
}

async function command(arg, arg2) {
    const a = (arg || '').toLowerCase(), b = (arg2 || '').toLowerCase();
    if (a === 'scan') return scanText();
    if (a === 'test') return selfTest();
    if (a === 'on' || a === 'off') setCfg({ on: a === 'on' });
    else if (a === 'block' && (b === 'on' || b === 'off')) setCfg({ block: b === 'on' });
    else if (a === 'report' && (b === 'on' || b === 'off')) setCfg({ report: b === 'on' });
    else if ((a === 'count' || a === 'reports') && /^\d+$/.test(b)) setCfg({ reportCount: Number(b) });
    const c = cfg();
    return ['╭─❖ 🛡️ *ANTI-BUG* ❖',
        `│ තත්ත්වය: ${c.on ? '✅ ON' : '❌ OFF'}`,
        `│ Bug ගහපු එකාට auto report ×${c.reportCount}: ${c.report ? '✅' : '❌'}`,
        `│ Report ඉවර උනාම block (private): ${c.block ? '✅' : '❌'}`,
        `│ මේ session එකේ block කළා: ${blocked.size}`,
        '├─ *.antibug on / off*',
        '├─ *.antibug report on / off*',
        '├─ *.antibug count <1-100>* — report ගණන (default 30)',
        '├─ *.antibug block on / off*',
        '├─ *.antibug scan* — recently caught bugs',
        '├─ *.antibug test* — crasher-payload self-test',
        '╰─ Bug → delete + auto report ×30 → block (bug ගහපු එකාට විතරයි)'].join('\n');
}

module.exports = { detect, guard, command, cfg, setCfg, floodCheck, selfTest, reportSpam, retaliate, startRetaliate, L, _flood: flood, _blocked: blocked, _recent: recent, _retalRunning: retalRunning, _retaliated: retaliated };
