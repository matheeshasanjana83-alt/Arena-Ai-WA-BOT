'use strict';
/**
 * autoupdate.js — bot එක තනියම GitHub එකේ අලුත් version check කරලා install කරන system එක (v2.31.0).
 * Manual *.update* විතරයි තිබුණ එකේ ඊසානදිය: startup එකෙන් ටිකකින් + වෙලාවකට සැරයක් auto check →
 * අලුත් version එකක් තිබ්බොත් owner ට කියලා install කරලා restart (exit 100 → launcher rollback safety).
 *
 * Settings (settings.json — .update වෙද්දි overwrite වෙන්නේ නෑ):
 *   "autoUpdate": true|false        — default true (key එක නැත්නම් ON)
 *   "autoUpdateMinutes": 60         — check interval (15–1440 min, default 60)
 * Command: .autoupdate on|off|status — manual *.update* / *.version* එකත් එහෙමම වැඩ.
 *
 * Safety rules:
 *   • busy (download/AI/update run වෙද්දි) → install කරන්නේ නෑ, මිනිත්තු 5 න් ආයෙ බලනවා
 *   • pairing ඉවර නැත්නම් (owner jid නෑ) → touch කරන්නේ නෑ — restart loop risk නෑ
 *   • එක sha එකක් install fail වුණොත් ඒක මතක තියාගෙන ආයෙ ආයෙ try කරන්නේ නෑ (අලුත් sha එකක් ආවම විතරයි)
 *   • GitHub fail/rate-limit → backoff (interval × fail streak, max ×6)
 *   • check interval වලට ±10% jitter — GitHub API spikes avoid
 */
const fs = require('fs');
const path = require('path');
const updater = require('./updater');

const SETTINGS = path.join(__dirname, 'settings.json');
const START_DELAY_MIN = 3;      // startup → මුල් check එක (bot එක settle වෙනකම් ඉන්න)
const BUSY_RETRY_MIN = 5;       // update තියෙනවා ඒත් bot busy → ඊළඟ try
const MIN_MIN = 15, MAX_MIN = 1440;
const BACKOFF_MAX = 6;          // consecutive check fails → interval × 6 max
const FAIL_SHA_KEEP = 5;        // අන්තිම failed shas ටිකක් විතරයි මතක තියාගන්නේ

const state = { opts: null, timers: [], nextAt: 0, nextKind: '', lastCheck: 0, lastResult: 'තාම check කරලා නෑ', failStreak: 0, failedShas: new Set(), pendingVersion: '' };

const readS = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const writeS = (d) => { try { fs.writeFileSync(SETTINGS, JSON.stringify(d, null, 2) + '\n'); return true; } catch { return false; } };

/** key එක නැත්නම් ON (අලුත් install එකක් settings නැතුව ආවත් auto-update වැඩ) */
const enabled = () => readS().autoUpdate !== false;
const intervalMin = () => {
    const n = Number(readS().autoUpdateMinutes);
    if (!Number.isFinite(n) || n <= 0) return 60;                       // invalid → default 60
    return Math.min(Math.max(Math.floor(n), MIN_MIN), MAX_MIN);         // clamp 15..1440
};
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function clearTimers() { for (const t of state.timers) clearTimeout(t); state.timers = []; }
function stop() { clearTimers(); state.nextAt = 0; state.nextKind = ''; }

/** next check timer — enabled නැත්නම් schedule කරන්නේ නෑ */
function schedule(opts, delayMin, kind) {
    clearTimers();
    if (!enabled()) return;
    const jitter = 1 + (Math.random() * 0.2 - 0.1);                     // ±10%
    const ms = Math.max(5000, Math.round(delayMin * 60000 * jitter));
    state.timers.push(setTimeout(() => tick(state.opts || opts).catch(() => { }), ms));
    state.nextAt = Date.now() + ms;
    state.nextKind = kind;
}

/** එක check cycle එකක් — tests වලටත් මේකම (checkFn/performUpdate DI) */
async function tick(opts) {
    opts = opts || state.opts || {};
    if (!enabled()) return { skipped: 'disabled' };
    const jid = opts.getJid ? opts.getJid() : null;
    if (!jid) { state.lastResult = 'WhatsApp pair වෙලා නෑ — auto-update idle'; return { skipped: 'unpaired' }; }

    let c;
    try { c = await (opts.checkFn || updater.check)(); state.failStreak = 0; state.lastCheck = Date.now(); }
    catch (e) {
        state.failStreak++;
        state.lastResult = 'check fail: ' + String(e.message).slice(0, 80);
        schedule(opts, intervalMin() * Math.min(state.failStreak, BACKOFF_MAX), 'backoff×' + Math.min(state.failStreak, BACKOFF_MAX));
        opts.log?.(`⚠️ auto-update check fail: ${e.message} (ඊළඟ try: ${intervalMin() * Math.min(state.failStreak, BACKOFF_MAX)} min)`);
        return { error: e.message };
    }

    if (c.upToDate) {
        state.lastResult = '✅ up to date';
        state.pendingVersion = '';
        schedule(opts, intervalMin(), 'normal');
        return { upToDate: true };
    }

    const v = String(c.latest.manifest.version || '?');
    const sha = c.latest.sha;
    state.lastResult = `🆕 v${v} තියෙනවා`;
    if (state.failedShas.has(sha)) { state.pendingVersion = v; schedule(opts, intervalMin(), 'normal'); return { skipped: 'failed-before', version: v }; }

    if (opts.isBusy && opts.isBusy()) {
        state.pendingVersion = v;
        schedule(opts, BUSY_RETRY_MIN, 'busy-retry');
        opts.log?.(`⏳ auto-update: v${v} තියෙනවා ඒත් bot busy — මිනිත්තු ${BUSY_RETRY_MIN} න් ආයෙ බලනවා`);
        return { skipped: 'busy', version: v };
    }

    // ── install ──
    state.pendingVersion = v;
    try { await opts.send(jid, { text: `🤖 *Auto-update*\n\n🆕 v${v} තියෙනවා — auto install කරනවා...\n📝 ${String(c.latest.message || '').split('\n')[0].slice(0, 150)}` }); } catch { }
    try {
        if (!opts.performUpdate) throw new Error('performUpdate සම්බන්ධ වෙලා නෑ');
        const r = await opts.performUpdate({});
        if (r && r.updated === false) { state.pendingVersion = ''; schedule(opts, intervalMin(), 'normal'); return { upToDate: true }; }
        state.lastResult = `✅ v${v} install — restart වෙනවා`;
        return { applied: true, version: v };                            // performUpdate උඩ තියෙනවා → process exit(100)
    } catch (e) {
        state.failedShas.add(sha);
        if (state.failedShas.size > FAIL_SHA_KEEP) state.failedShas.delete(state.failedShas.values().next().value);
        state.pendingVersion = '';
        state.lastResult = `❌ v${v} install fail`;
        opts.log?.(`❌ auto-update install fail (v${v}): ${e.message}`);
        try { await opts.send(jid, { text: `⚠️ Auto-update install fail: ${String(e.message).slice(0, 150)}\n> *.update* ගහලා manually try කරන්න — පරණ version එක එහෙමම වැඩ` }); } catch { }
        schedule(opts, intervalMin(), 'normal');
        return { error: e.message };
    }
}

/** .autoupdate on|off|status — owner command; status text එක return කරනවා */
function command(arg = '') {
    arg = String(arg || '').toLowerCase().trim();
    const on = enabled();
    if (arg === 'on' || arg === 'enable') {
        if (!on) { const d = readS(); d.autoUpdate = true; if (!writeS(d)) return '❌ settings.json write fail — ආයෙ try කරන්න'; }
        if (state.opts) schedule(state.opts, START_DELAY_MIN, 'startup');
        return `✅ *Auto-update ON*\n✦ startup + හැඬෑම ${intervalMin()} min බෙදා GitHub check\n✦ අලුත් version එකක් ආවොත් auto install → restart\n> Manual *.update* / *.version* එකත් එහෙමම වැඩ`;
    }
    if (arg === 'off' || arg === 'disable') {
        if (on) { const d = readS(); d.autoUpdate = false; if (!writeS(d)) return '❌ settings.json write fail — ආයෙ try කරන්න'; }
        stop();
        state.pendingVersion = '';
        return '🛑 *Auto-update OFF* — GitHub auto check නැහැ\n> *.update* / *.version* වලින් manual check කරන්න පුළුවන්';
    }
    // ── status ──
    const lines = [
        '🔄 *Auto-update*',
        `✦ state: ${on ? 'ON' : 'OFF'}${on ? ` (හැඬෑම ${intervalMin()} min)` : ''}`,
    ];
    if (state.lastCheck) lines.push(`✦ last check: ${hhmm(state.lastCheck)} — ${state.lastResult}`);
    else if (state.lastResult) lines.push(`✦ ${state.lastResult}`);
    if (on && state.nextAt) lines.push(`✦ next check: ${hhmm(state.nextAt)} (${state.nextKind})`);
    if (state.pendingVersion) lines.push(`✦ ⏳ v${state.pendingVersion} install කරන්න ඉතුරු (bot busy / fail)`);
    if (state.failStreak) lines.push(`✦ ⚠️ check fails: ${state.failStreak} (backoff)`);
    if (state.failedShas.size) lines.push(`✦ 🚫 skip කරපු broken builds: ${state.failedShas.size}`);
    lines.push(`> ${on ? 'off කරන්න' : 'on කරන්න'}: *.autoupdate ${on ? 'off' : 'on'}* · manual: *.update*`);
    return lines.join('\n');
}

/** .version card එකට පොඩි line එකක් */
const statusText = () => enabled() ? `on (හැඬෑම ${intervalMin()} min)` : 'off (*.autoupdate on*)';

/** connection open → timers start (idempotent — reconnect වුණත් පරණ timers replace වෙනවා) */
function start(opts) {
    state.opts = opts || null;
    stop();
    if (!state.opts) return;
    if (!enabled()) { opts.log?.('⏭️ auto-update OFF (settings.json autoUpdate:false) — *.autoupdate on* වලින් ඕනවිදිම on කරන්න'); return; }
    opts.log?.(`🔄 auto-update ON — මිනිත්තු ${START_DELAY_MIN} න් පස්සේ මුල් check, ඊට පස්සේ හැඬෑම ${intervalMin()} min බෙදා (off: .autoupdate off)`);
    schedule(opts, START_DELAY_MIN, 'startup');
}

module.exports = { start, stop, tick, command, statusText, enabled, intervalMin, _state: state };
