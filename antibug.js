/**
 * antibug.js — KAVIZ MD V1 🛡️ Anti-Bug (v2.34.0 — real crasher-toolkit analysis: 10 leaked tools)
 *
 * "Bug" messages = messages built to freeze/crash WhatsApp. v2.32 covered the MishuCrasher-panel
 * classes; v2.34 added every class found by DISSECTING 10 real leaked bug tools (AmbaCrash v14,
 * HADES, SKYVIEN, XLOID INVICTUS, DELVIN CRASH, SATANIC DEVIL, CFC V30, Shiroxyx 4.0, HARVEST
 * INFINITY, Neobeast): crashcursor buttonId NUL×850000, @0/@1 mention-run ×300000, Javanese ꦽ/ꦾ
 * mark storms ×550000, pageCount 3567587327, fileLength 48-nines, totalAmount1000 9.9e16,
 * trustBannerAction 99999, negative expiration, forwardingScore 999999, "i lose\n"×9999 line
 * storms, lone-surrogate storms, paramsJson NUL×1000000 — plus the original generic detectors.
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
        dailyCap: clampCount(a.dailyCap || 20),          // v2.55: 24h report budget (WhatsApp mass-report spam-flag guard)
    };
}
function setCfg(patch) { const d = readSet(); d.antibug = { ...cfg(), ...patch }; writeSet(d); return d.antibug; }

// ── v2.55 persistent state (report budget / lockdown — survives restarts) ──
const STATE_F = path.join(__dirname, 'antibug_state.json');
const state = (() => { try { const j = JSON.parse(fs.readFileSync(STATE_F, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } })();
state.reports = Array.isArray(state.reports) ? state.reports : [];
state.catches = Array.isArray(state.catches) ? state.catches : [];      // v2.77: persistent catch log (survives restarts — .antibug scan shows the TRUTH)
state.reportsLog = Array.isArray(state.reportsLog) ? state.reportsLog : [];   // v2.77: every retaliation outcome {at,who,want,ok,fails,aborted,err,blockedNow}
const saveState = () => { try { fs.writeFileSync(STATE_F, JSON.stringify(state)); } catch { } };
const DAILY_CAP = () => cfg().dailyCap;
function reportBudget() {   // reports left in the rolling 24h window
    const now = Date.now();
    state.reports = state.reports.filter((t) => now - t < 24 * 3600e3);
    return Math.max(0, DAILY_CAP() - state.reports.length);
}

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
    // ── v2.34: real crasher-toolkit classes (WhatsApp Documents.zip: AmbaCrash/HADES/SKYVIEN/
    //    XLOID/DELVIN/SATANIC DEVIL/CFC/Shiroxyx/HARVEST/Neobeast) ──
    pageCount: 10000,   // documentMessage.pageCount — real: ≤ thousands; bombs use 3567587327
    fileLenMax: 1e12,   // documentMessage.fileLength (num/Long/numeric-string) — bombs: 48 nines
    amountMax: 1e12,    // orderMessage.totalAmount1000 — bomb "98999999999999999"
    bannerAction: 1000, // contextInfo.trustBannerAction — real 0-2; bomb 99999
    convDelay: 3600,    // contextInfo.conversionDelaySeconds — bomb 9999 (real ≤ minutes)
    fwdScore: 1000,     // contextInfo.forwardingScore — real ≤ ~63; bomb 999999
    lineStorm: 500,     // same non-empty line repeated >500× in one field ("i lose\n"×9999)
    surrMin: 200,       // lone surrogates / U+FFFD in one string — UTF-16 encoder crashers
};

// invisible / combining / direction-control characters used by "virtex" bugs.
// (Sinhala vowel signs U+0D80–0DFF are NOT in here — the sinhRun rule below handles their STORMS
// without flagging normal Sinhala text; a normal emoji ZWJ is far below the limits)
const WEIRD = /[\u0300-\u036F\u0483-\u0489\u0591-\u05C7\u0610-\u061A\u064B-\u065F\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u1AB0-\u1AFF\u1DC0-\u1DFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F\uFEFF\u115F-\u1160\u180B-\u180F\u3164\uFFA0\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDDEF]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72]/g;
const MARK_RE = /\p{M}/u;                                              // ANY combining mark (unicode)
const SINH_RE = /[\u0DCA\u0DCF-\u0DDF\u200D]/;                        // Sinhala signs + ZWJ ("්‍" runs)
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;
const LONE_SURR_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;   // unpaired halves
const NUMSTR_BOMB_KEYS = /^\d{13,}$/;                                  // "9999999999999" / 48-nines
const BOMB_STR_KEYS = new Set(['fileLength', 'totalAmount1000', 'totalAmount']);
const maxSameLine = (s) => {                                            // v2.34 line-storm
    const tally = new Map(); let best = 0;
    for (const ln of s.split('\n')) { const t = ln.trim(); if (!t) continue; const n = (tally.get(t) || 0) + 1; tally.set(t, n); if (n > best) best = n; }
    return best;
};
const longestRun = (s, re) => { let m = 0, c = 0; for (const ch of s) { if (re.test(ch)) { if (++c > m) m = c; } else c = 0; } return m; };
const TEXT_KEYS = new Set(['conversation', 'text', 'caption', 'contentText', 'description', 'footerText', 'body', 'title', 'name', 'displayName', 'subject', 'accessibilityText', 'buttonParamsJson', 'paramsJson', 'buttonId', 'displayText', 'fileName']);

// ── v2.55: OUTBOUND GUARANTEE — even if a bug payload sneaks past detection and reaches the AI,
// nothing the bot SENDS can freeze/crash anyone's WhatsApp. Every outgoing string is neutralized:
// control chars, bidi overrides, tag chars (U+E0000-E01EF), invisible storms, unbroken runs, lone
// surrogates — all stripped; hard length cap. Normal Sinhala / emoji (incl. ❤️ VS16, family ZWJ,
// ර්‍ය conjunct ZWJ) are untouched. ──
const OUT_MAX = 60000;                                            // hard cap (normal replies are < 4k)
const OUT_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;
const OUT_INVIS = /[\u202A-\u202E\u2066-\u2069\uFEFF\u180B-\u180F\u115F\u1160\u3164\uFFA0\uFFF9-\uFFFB\uFE00-\uFE0E]|[\u{E0000}-\u{E01EF}]/gu;   // bidi/tag/fillers/VS1-15 (VS16 \uFE0F kept for ❤️)
const OUT_STORM = /\u200B{2,}|\u200C{2,}|\u200E{2,}|\u200F{2,}|\u2060-\u2064{2,}|\u2060{2,}|\u200D{3,}/g;   // invisible RUNS only (single ZWNJ/ZWJ legit)
const OUT_SURR = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function sanitizeOut(text, max = OUT_MAX) {
    let s = String(text == null ? '' : text);
    if (s.length > max * 4) s = s.slice(0, max * 4);               // giant input: pre-chop (perf)
    s = s.replace(OUT_CTRL, '').replace(OUT_INVIS, '').replace(OUT_STORM, ' ').replace(OUT_SURR, '');
    s = s.replace(/(\S{1200})\S+/g, (m, a) => a);                  // unbroken run → cut the tail (render-safe)
    if (s.length > max) s = s.slice(0, max) + ' …';
    return s;
}
const OUT_MEDIA_CAP = 4000;                                       // captions/image-text cap (renderers choke on big captions)
function cleanOut(content) {
    if (!content || typeof content !== 'object') return content;
    for (const k of ['text', 'caption']) {
        const v = content[k];
        if (typeof v !== 'string' || !v.length) continue;
        const was = v;
        content[k] = sanitizeOut(v, k === 'caption' ? OUT_MEDIA_CAP : OUT_MAX);
        if (content[k] !== was && !content[k].trim()) content[k] = '🛡️ (bug-safe)';
    }
    return content;
}

/** pure check — returns { bug, severe, reasons[] } (no network, safe to unit-test) */
function detect(message) {
    const reasons = [];
    let severe = false;
    if (!message || typeof message !== 'object') return { bug: false, severe, reasons };
    let total = 0, maxField = 0, maxDepth = 0, weird = 0, textLen = 0, mentions = 0, contacts = 0, options = 0;
    let maxRun = 0, vTel = 0, vLines = 0, longest = '', longestWeird = 0;
    let markRun = 0, sinhRun = 0, ctrlMax = 0, arrBig = 0, medDim = '', badLoc = false, durBig = 0;
    let numBomb = '', lineBest = 0, surrBest = 0;
    const seen = new Set();
    const walk = (o, d, key) => {
        if (d > maxDepth) maxDepth = d;
        if (d > 64) return;                                     // stop walking absurd depth
        if (typeof o === 'number') {                            // v2.32: coordinate/duration bombs
            if (key === 'degreesLatitude' || key === 'degreesLongitude') {
                const lim = key === 'degreesLatitude' ? 90.1 : 180.1;
                if (!Number.isFinite(o) || Math.abs(o) > lim) badLoc = true;
            } else if (key === 'seconds' && o > L.durMax) durBig = o;
            // v2.34: crasher numeric field bombs (never occur in real messages)
            else if (key === 'pageCount' && o > L.pageCount) numBomb = `pageCount ${o}`;
            else if (key === 'fileLength' && o > L.fileLenMax) numBomb = `fileLength ${o}`;
            else if (key === 'trustBannerAction' && o > L.bannerAction) numBomb = `trustBannerAction ${o}`;
            else if (key === 'conversionDelaySeconds' && o > L.convDelay) numBomb = `conversionDelaySeconds ${o}`;
            else if (key === 'forwardingScore' && o > L.fwdScore) numBomb = `forwardingScore ${o}`;
            else if (key === 'expiration' && o < 0) numBomb = `expiration ${o}`;
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
                    const su = o.match(LONE_SURR_RE); const sb = (su ? su.length : 0) + (o.match(/\uFFFD/g) || []).length;   // v2.34
                    if (sb > surrBest) surrBest = sb;
                }
                if (o.length > 2000) {                              // v2.34: line storm ("i lose\n"×9999)
                    const ls = maxSameLine(o); if (ls > lineBest) lineBest = ls;
                }
            }
            if (BOMB_STR_KEYS.has(key) && NUMSTR_BOMB_KEYS.test(o.trim())) numBomb = `${key} "${o.slice(0, 12)}…"`;   // v2.34 numeric-string bombs
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
        if ((key === 'fileLength' || key === 'totalAmount1000' || key === 'totalAmount') &&
            typeof o.low === 'number' && typeof o.high === 'number') {       // v2.34: protobuf Long bombs
            const v = o.high * 4294967296 + o.low;
            if (v > L.fileLenMax) numBomb = `${key} ${v}`;
        }
        for (const k of Object.keys(o)) walk(o[k], d + 1, k);
    };
    walk(message, 0, '');
    if (markRun > L.markRun) { reasons.push(`combining-mark storm run ${markRun}`); severe = true; }
    if (sinhRun > L.sinhRun) { reasons.push(`සිංහල විරාම/සංඥා storm run ${sinhRun}`); severe = true; }
    if (ctrlMax > L.ctrl) { reasons.push(`control chars ${ctrlMax}`); severe = true; }
    if (medDim) { reasons.push(`media dimension bomb ${medDim}`); severe = true; }
    if (badLoc) { reasons.push('location coordinates bug'); severe = true; }
    if (numBomb) { reasons.push(`numeric bomb ${numBomb}`); severe = true; }                    // v2.34
    if (lineBest > L.lineStorm) { reasons.push(`line storm ×${lineBest}`); severe = true; }     // v2.34
    if (surrBest > L.surrMin) { reasons.push(`lone surrogate/FFFD storm ${surrBest}`); severe = true; }   // v2.34
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

// ── v2.78: REPORT VERIFICATION — the in-app dialog ('Thank you for reporting') only shows when the
// phone's own WhatsApp sends the report. Server-side IQ reports never show a dialog — so the ONLY
// way to know they land is to TEST the stanza and log the server's answer.
const logReport = (e) => { state.reportsLog.unshift(e); if (state.reportsLog.length > 15) state.reportsLog.length = 15; saveState(); };

/** .antibug reporttest — stanza handshake: 1 self-report (owner's own chat = harmless no-op). ACCEPT = path works */
async function reportTest(ctx) {
    const { sock, me, log = () => { } } = ctx;
    if (!sock || !me?.pn) return '❌ connection නෑ — පොඩ්ඩකින් ආයෙ try කරන්න';
    const key = { remoteJid: me.pn, id: '3EB0' + Math.random().toString(16).slice(2, 10).toUpperCase(), fromMe: true };
    try {
        await reportSpam(sock, me.pn, key);
        logReport({ at: Date.now(), who: 'TEST(self)', want: 1, ok: 1, fails: 0, aborted: false, err: '', blockedNow: false, kind: 'test' });
        log('antibug reporttest: ACCEPTED');
        return ['╭─❖ 🧪 *REPORT TEST* ❖', '│ ✅ stanza ACCEPTED — server එක ගත්තා', '│ (self-report = no-op — කිසිම දෙයක් වෙන්නේ නෑ)', '│', '╰─ ඒ කියන්නේ severe bug එකක් ආවොත් auto-report ×N ලෑන්ඩ් වෙනවා ✅'].join('\n');
    } catch (e) {
        const err = String(e.message || '').slice(0, 140);
        logReport({ at: Date.now(), who: 'TEST(self)', want: 1, ok: 0, fails: 1, aborted: true, err, blockedNow: false, kind: 'test' });
        log('antibug reporttest: REJECTED — ' + err);
        return ['╭─❖ 🧪 *REPORT TEST* ❖', `│ ❌ stanza REJECTED: ${err}`, '│ (මේක තමයි report ලෑන්ඩ් වෙන්නේ නැති නිසා — WhatsApp server මේ format එක දැන් ගන්නේ නෑ)', '╰─ ⛔ block එක තමයි guaranteed protection එක — ඒක දැනටමත් ON'].join('\n');
    }
}

/** .antibug report (message එකකට reply) — owner manual report of a REAL received message (in-app button එකම) */
async function reportManual(quoted, ctx) {
    const { sock, me, log = () => { } } = ctx;
    if (!sock || !me?.pn) return '❌ connection නෑ';
    const q = quoted || {};
    if (!q.stanzaId || !(q.participantJid || q.participant)) return '❌ report කරන්න ඕන message එකකට *reply* කරලා `.antibug report` ගහන්න';
    const sender = q.participantJid || q.participant;
    const key = { remoteJid: q.remoteJid || me.pn, id: q.stanzaId, fromMe: false };
    try {
        await reportSpam(sock, sender, key);
        logReport({ at: Date.now(), who: 'MANUAL:' + String(sender).split('@')[0], want: 1, ok: 1, fails: 0, aborted: false, err: '', blockedNow: false, kind: 'manual' });
        log('antibug manual report → ' + sender);
        return ['╭─❖ 🚨 *REPORT SENT* ❖', `│ 👤 ${String(sender).split('@')[0]}`, '│ ✅ යවා දුන්නා (official report call එකම)', '╰─ WhatsApp එක decide කරනවා ඒකෙන් මොකද වෙන්නේ කියලා'].join('\n');
    } catch (e) {
        const err = String(e.message || '').slice(0, 140);
        logReport({ at: Date.now(), who: 'MANUAL:' + String(sender).split('@')[0], want: 1, ok: 0, fails: 1, aborted: true, err, blockedNow: false, kind: 'manual' });
        return `❌ report fail: ${err}\n\n${foot0()}`;
    }
}
const foot0 = () => '🛡️ .antibug reporttest එකෙන් stanza path එක check කරන්න පුළුවන්';

let retalPauseUntil = 0;      // v2.55: server keeps rejecting reports → 1h pause (protects OUR account from flag-storms)

/**
 * Bug sender retaliation: report ×N (human-paced, 24h budget) → then block (private only).
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
    const asked = c.report ? c.reportCount : 0;
    const want = Math.min(asked, reportBudget());                                // v2.55: 24h budget — mass-reporting gets the REPORTER flagged
    let ok = 0, blockedNow = false, blockErr = '', fails = 0, aborted = false, firstErr = '';
    for (let i = 0; i < want; i++) {
        if (Date.now() < retalPauseUntil) { aborted = true; break; }
        try { await reportSpam(sock, sender, meta.key); ok++; fails = 0; state.reports.push(Date.now()); if (ok % 5 === 0) saveState(); }
        catch (e) {
            fails++; if (!firstErr) firstErr = String(e.message || '').slice(0, 140); log(`antibug report ${i + 1}/${want}: ${e.message}`);
            if (fails >= 3) {                                                     // server rejects ×3 → something is wrong — stop hammering
                retalPauseUntil = Date.now() + 3600e3; aborted = true;
                log('antibug: reports failing ×3 — reports paused 1h (account safety)');
                break;
            }
        }
        if (i < want - 1) await sleep(TEST_FAST ? 1 : 700 + Math.floor(Math.random() * 700));   // human pacing (anti-ban)
    }
    saveState();
    if (meta.canBlock && c.block && !blocked.has(sNorm)) {
        try { await sock.updateBlockStatus(sender, 'block'); blocked.add(sNorm); blockedNow = true; }
        catch (e) { blockErr = e.message; log('antibug block: ' + e.message); }
    }
    // v2.77: persistent outcome — .antibug scan/status shows whether reports actually LAND
    state.reportsLog.unshift({ at: Date.now(), who: sNorm.split('@')[0], want, ok, fails, aborted, err: firstErr || '', blockedNow });
    if (state.reportsLog.length > 15) state.reportsLog.length = 15;
    saveState();
    if (send && me?.pn) {                                                        // honest final card
        const who = sNorm.split('@')[0];
        const rLine = !asked ? '│ 📨 report: OFF'
            : want === 0 ? `│ 📨 report: ⏳ 24h budget ඉවරයි (${DAILY_CAP()}/දවස්) — block විතරක්`
                : `│ 📨 report: ${ok}/${want}${aborted ? ' (නවත්වලා — server reject)' : ok === want ? ' ✅' : ok ? ' ⚠️' : ' ❌'}`;
        const bLine = !meta.canBlock ? '│ ⛔ block: — (private chat වලට විතරයි)'
            : c.block ? `│ ⛔ block: ${blockedNow ? '✅ කළා' : '❌ ' + (blockErr || 'fail')}` : '│ ⛔ block: OFF';
        const text = ['╭─❖ 🛡️ *AUTO REPORT + BLOCK* ❖', `│ 👤 bug ගහපු එකා: ${who}`, rLine, bLine, '╰─ 🛡️ ඒ එකාගෙන් දැන් bug එන්නේ නෑ'].join('\n');
        try { await send(me.pn, { text }); } catch { }
    }
    return { ok, want, blockedNow, aborted };
}

/** fire-and-forget starter — the message loop never waits for the 30 reports */
function startRetaliate(sender, ctx, meta = {}) {
    const p = retaliate(sender, ctx, meta).catch(() => ({ skip: 'error' }));
    retalRunning.set(normJid(sender), p);
    return p;
}
function actionOk(now = Date.now()) { while (acts.length && now - acts[0] > 60e3) acts.shift(); if (acts.length >= 60) return false; acts.push(now); return true; }

// ── v2.55: STORM LOCKDOWN — 3+ severe bugs in 10 min = an active attack → AI goes silent 5 min
// (the bot can never be used as an echo/amplifier during a bug storm; commands + antibug still work) ──
const severeTimes = [];
function noteSevere() {
    const now = Date.now();
    while (severeTimes.length && now - severeTimes[0] > 10 * 60e3) severeTimes.shift();
    severeTimes.push(now);
    if (severeTimes.length >= 3 && now > (state.lockdownUntil || 0)) {
        state.lockdownUntil = now + 5 * 60e3; saveState();
        return true;                                  // caller notifies the owner once
    }
    return false;
}
function lockedDown() { return Date.now() < (state.lockdownUntil || 0); }

// ── v2.55: stuck-chat rescue — a bug that already landed on the phone can make that chat
// impossible to clear (client can't parse what it can't render). Deleting the chat account-wide
// from here (a linked device) removes EVERY message in it — the phone refreshes clean. ──
async function clearChat(sock, jid) {
    if (!sock || !jid) throw new Error('sock/jid missing');
    await sock.chatModify({ delete: true }, jid);     // "Delete chat" — same call the official app makes
    return true;
}
async function unblockAll(sock) {                     // wrong-number recovery (e.g. own second number caught by an old rule)
    const out = [];
    for (const s of Array.from(blocked)) {
        try { await sock.updateBlockStatus(s, 'unblock'); out.push(s.split('@')[0]); } catch { }
        blocked.delete(s);
    }
    return out;
}
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
    // ── v2.33: RETALIATION — bug ගහපු එකාට විතරයි: auto report ×N (24h budget) → ඉවර උනාම block ──
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
    if (r.severe && noteSevere() && send && me?.pn) {          // 🌩️ v2.55: storm → AI lockdown (echo/amplifier guard)
        try { await send(me.pn, { text: '╭─❖ 🌩️ *BUG STORM LOCKDOWN* ❖\n│ විනාඩි 10ක් ඇතුලේ severe bug 3ක් — attack එකක්!\n│ 🤖 AI එක විනාඩි 5කට silent (echo වළක්වන්න)\n│ 🛡️ anti-bug + commands සාමාන්‍ය විදිහට වැඩ\n╰─ lock ඉවර වුනාම auto back' }); } catch { }
    }
    const num = String(sender || jid).split('@')[0].split(':')[0];
    log(`🛡️ anti-bug: ${num} ${isGroup ? '(group ' + jid.split('@')[0] + ')' : isStatus ? '(status)' : isNews ? '(newsletter)' : ''} — ${r.reasons.join(', ')} → ${done.join(', ') || 'no action'}`);
    const hit = { at: Date.now(), num, where: isGroup ? 'group' : isStatus ? 'status' : isNews ? 'newsletter' : 'private', reasons: r.reasons.join(' · '), done: done.join(' · ') || '-' };
    recent.push({ at: new Date(), num, where: hit.where, reasons: hit.reasons, done: hit.done });
    if (recent.length > 20) recent.shift();
    state.catches.unshift(hit);                                            // v2.77: survives restarts → .antibug scan always has evidence
    if (state.catches.length > 30) state.catches.length = 30;
    saveState();
    const now = Date.now();
    if (send && me?.pn && now - (lastReport.get(sender) || 0) > 5 * 60e3) {   // max 1 report / sender / 5 min
        lastReport.set(sender, now);
        const fixLine = isPrivate ? '╰─ 🧹 chat එක phone එකෙන් clear/delete වෙන්නේ නැත්නම්: මේ chat එකේම *.antibug clearchat yes*' : '╰─ chat එක දැන් open කරන්න පුළුවන්';
        const text = ['╭─❖ 🛡️ *ANTI-BUG* ❖', `│ 👤 ${num}${isGroup ? '\n│ 👥 group එකක' : ''}`, `│ ⚠️ ${r.reasons.join(' · ')}`, `│ ✅ ${done.join(' · ') || 'කරන්න දෙයක් බැරි වුණා'}`, fixLine].join('\n');
        try { await send(me.pn, { text }); } catch { }
    }
    return true;
}

const whenStr = (t) => { const d = new Date(t); return d.toISOString().slice(5, 16).replace('T', ' '); };   // MM-DD HH:MM
function scanText() {
    const out = ['╭─❖ 🛡️ *ANTI-BUG SCAN* ❖'];
    // v2.77: last retaliation outcome — did the auto-report actually LAND?
    const rl = state.reportsLog[0];
    if (rl) {
        const verdict = rl.ok > 0 ? `🚀 report ${rl.ok}/${rl.want} ලෑන්ඩ් වුණා ✅` : rl.want === 0 ? '⏳ budget ඉවර' : `❌ report 0/${rl.want} — server reject${rl.err ? ': ' + rl.err.slice(0, 60) : ''}`;
        const kindTag = rl.kind === 'test' ? ' 🧪TEST' : rl.kind === 'manual' ? ' 🚨MANUAL' : '';
        out.push(`│ 📨 last: ${whenStr(rl.at)} · ${rl.who}${kindTag} → ${verdict}${rl.blockedNow ? ' · ⛔ block ✅' : ''}`);
    } else out.push('│ 📨 last: — (report කවදාවත් fire වෙලා නෑ)');
    // persistent catches (survive restarts) — newest first
    const rows = state.catches.slice(0, 10).map((e) =>
        `│ 🕐 ${whenStr(e.at)} ${e.where === 'group' ? '👥' : e.where === 'status' ? '📍' : e.where === 'newsletter' ? '📰' : '👤'} ${e.num}
│ ⚠️ ${e.reasons}
│ ✅ ${e.done}`);
    if (rows.length) out.push(`│ 📋 caught ${state.catches.length} (last ${rows.length})`, ...rows);
    else if (!recent.length) out.push('╰─ caught bugs nothing — clean ✅');
    else out.push('│ 📋 (session එකේ පමණයි)');
    if (rows.length) out.push('╰─ report eke bug text penne ne');
    return out.join('\n');
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
    push('invincible bug 50k (ZWNJ-only)', { conversation: '\u200C'.repeat(50000) }, true);   // v2.55: the "invincible" class — pure-invisible giant
    push('tag-char storm (U+E0100)', { conversation: 'hi' + '\uDB40\uDD00'.repeat(3000) }, true);
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
    // ── v2.34: real crasher-toolkit classes (WhatsApp Documents.zip: 10 leaked tools) ──
    push('pageCount bomb', { conversation: 'x', documentMessage: { pageCount: 3567587327, fileLength: 1024 } }, true);
    push('fileLength string bomb', { conversation: 'x', documentMessage: { fileLength: '9999999999999' } }, true);
    push('fileLength Long bomb', { conversation: 'x', documentMessage: { fileLength: { low: 101, high: 2328, unsigned: true } } }, true);
    push('order amount bomb', { conversation: 'x', orderMessage: { totalAmount1000: '98999999999999999', itemCount: 1 } }, true);
    push('trustBanner bomb', { conversation: 'x', extendedTextMessage: { text: 'hi', contextInfo: { trustBannerAction: 99999 } } }, true);
    push('negative expiration bomb', { conversation: 'x', extendedTextMessage: { text: 'hi', contextInfo: { expiration: -99999 } } }, true);
    push('forwardingScore+convDelay bomb', { conversation: 'x', extendedTextMessage: { text: 'hi', contextInfo: { forwardingScore: 999999, conversionDelaySeconds: 9999 } } }, true);
    push('line storm ("i lose\n"×9999)', { conversation: 'i lose\n'.repeat(9999) }, true);
    push('lone surrogate storm', { conversation: 'a' + String.fromCharCode(0xDB40).repeat(300) }, true);
    push('FFFD storm', { conversation: 'a\uFFFD'.repeat(400) }, true);
    push('SATANIC crashcursor (full rebuild)', { viewOnceMessage: { message: { listResponseMessage: {
        title: 'Bruh your stupid' + '@0'.repeat(50000), listType: 2,
        contextInfo: { expiration: -99999, trustBannerAction: 99999, forwardingScore: 999999, conversionDelaySeconds: 9999 },
        quotedMessage: { buttonsMessage: { documentMessage: { pageCount: 3567587327, fileLength: '9999999999999' }, buttons: [{ buttonId: '\u0000'.repeat(850000), buttonText: { displayText: '#satan' }, type: 1 }] } },
    } } } }, true);
    push('SKYVIEN RavageCursorOrder (rebuild)', { viewOnceMessage: { message: { orderMessage: {
        message: '📦 Ravage Only Order' + 'ꦾ'.repeat(99999), totalAmount1000: '98999999999999999',
        fileLength: '9999999999999', pageCount: 3567587327,
        contextInfo: { quotedMessage: { buttonsMessage: { buttons: [{ buttonId: '\u0000'.repeat(549999) }] } } },
    } } } }, true);
    push('QBug paramsJson NUL ×500k', { interactiveResponseMessage: { body: { text: 'Sent', format: 'DEFAULT' }, nativeFlowResponseMessage: { name: 'galaxy_message', paramsJson: `{"screen_0_TextInput_0":"radio${'\0'.repeat(500000)}"}`, version: 3 } } }, true);
    fp('normal order message', { orderMessage: { totalAmount1000: '500000', itemCount: 3, status: 1, orderTitle: 'පොත් දෙකක්' } });
    fp('real PDF document', { documentMessage: { pageCount: 300, fileLength: 25000000, fileName: 'syllabus.pdf' } });
    fp('normal forward + ephemeral', { conversation: 'hi', extendedTextMessage: { text: 'hi', contextInfo: { forwardingScore: 3, expiration: 604800 } } });
    fp('few replacement chars', { conversation: 'broken \uFFFD char in normal chat — fine'.repeat(10) });
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
    const c = cfg(), budget = reportBudget();
    const rl = state.reportsLog[0];
    const rlLine = !rl ? '│ 📨 last report: — (තාම severe bug එකක් fire වෙලා නෑ)'
        : rl.ok > 0 ? `│ 📨 last report: ${rl.ok}/${rl.want} ✅ (${whenStr(rl.at)})`
            : `│ 📨 last report: ❌ 0/${rl.want}${rl.aborted ? ' (abort)' : ''} — ${rl.err ? rl.err.slice(0, 50) : 'server reject'} (${whenStr(rl.at)})`;
    return ['╭─❖ 🛡️ *ANTI-BUG* ❖',
        `│ තත්ත්වය: ${c.on ? '✅ ON' : '❌ OFF'}`,
        `│ Bug ගහපු එකාට auto report ×${c.reportCount}: ${c.report ? '✅' : '❌'} (24h budget: ${budget}/${DAILY_CAP()})`,
        rlLine,
        `│ Report ඉවර උනාම block (private): ${c.block ? '✅' : '❌'}`,
        `│ 🛡️ OUT-GUARD: යන හැම message එකක්ම sanitize (bot එකෙන් bug යන්නේ නෑ) ✅`,
        `│ 🌩️ storm lock: ${lockedDown() ? '⚠️ ON (AI silent)' : '—'}`,
        `│ මේ session එකේ block කළා: ${blocked.size}`,
        '├─ *.antibug on / off*',
        '├─ *.antibug report on / off*',
        '├─ *.antibug count <1-100>* — report ගණන (default 30)',
        '├─ *.antibug block on / off*',
        '├─ *.antibug clearchat yes* — මේ chat එකම clear (bug වැදලා clear වෙන්නේ නැත්නම්)',
        '├─ *.antibug unblock all* — block කරපු ඔක්කොම unblock (recover)',
        '├─ *.antibug reporttest* — 🧪 report path එක live test (self-report, no-op)',
        '├─ *.antibug report* — 🚨 bug message එකකට reply → manual report',
        '├─ *.antibug scan* — recently caught bugs + report evidence',
        '├─ *.antibug test* — crasher-payload self-test',
        '╰─ Bug → delete + report (24h budget) → block · යන messages ඔක්කොම sanitize'].join('\n');
}

module.exports = { detect, guard, command, cfg, setCfg, floodCheck, selfTest, reportSpam, reportTest, reportManual, retaliate, startRetaliate, sanitizeOut, cleanOut, clearChat, unblockAll, lockedDown, noteSevere, reportBudget, L, _flood: flood, _blocked: blocked, _recent: recent, _retalRunning: retalRunning, _retaliated: retaliated, _state: state, _resetPause: () => { retalPauseUntil = 0; } };
