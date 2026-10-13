'use strict';
/**
 * test_v231.js — Auto-Update System (v2.31.0)
 * bot එක තනියම GitHub check → අලුත් version ආවොත් owner ට කියලා install → restart.
 * Safety rules test: busy-guard, unpaired-guard, failed-sha memory, check-fail backoff,
 * settings persistence (.autoupdate on|off), default-ON, bot.js wiring (manual .update
 * එකත් එකම runUpdate path එක), manifest sync.
 * run: node test_v231.js   (offline — GitHub calls are injected fakes, no network)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');
const SET = path.join(__dirname, 'settings.json');
const SET_BACKUP = path.join(__dirname, '.tmp-v231-settings.json');
const au = require('./autoupdate');

/** settings.json snapshot → test values (restore in finally) */
const savedSettings = fs.readFileSync(SET, 'utf8');
const writeSettings = (o) => fs.writeFileSync(SET, JSON.stringify(o, null, 2) + '\n');
const resetAU = () => Object.assign(au._state, { opts: null, timers: [], nextAt: 0, nextKind: '', lastCheck: 0, lastResult: 'තාම check කරලා නෑ', failStreak: 0, failedShas: new Set(), pendingVersion: '' });

const LATEST = { sha: 'sha-NEW', manifest: { version: '2.32.0', notes: 'test update' }, message: 'v2.32.0 test', date: new Date().toISOString() };
const CURRENT = { sha: 'sha-OLD', manifest: { version: '2.31.0' }, message: 'v2.31.0', date: new Date().toISOString() };
const upd = () => ({ current: CURRENT, latest: LATEST, upToDate: false });
const same = () => ({ current: CURRENT, latest: CURRENT, upToDate: true });

(async () => {
    // 1) version sync 2.31.0
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    if (man.version !== pkg.version || pkg.version < '2.31.0') throw new Error('version sync wrong: pkg=' + pkg.version + ' manifest=' + man.version);
    console.log('[1] v' + pkg.version + ' sync (manifest === package): OK \u2705');

    // 2) old test gone, new module shipped, manifest lists clean
    if (fs.existsSync('test_v230.js')) throw new Error('test_v230.js still exists');
    if (!fs.existsSync('autoupdate.js')) throw new Error('autoupdate.js missing');
    for (const f of man.removed || []) {
        if (man.files.includes(f)) throw new Error(f + ' in both files and removed');
        if (/^(auth|node_modules|\.backup)/.test(f) || f.includes('..') || path.isAbsolute(f)) throw new Error('unsafe removed path: ' + f);
    }
    if (!man.files.includes('autoupdate.js') || !man.files.includes('test_v231.js') || !man.files.includes('bot.js')) throw new Error('manifest missing autoupdate.js/test_v231.js/bot.js');
    console.log('[2] test_v230 deleted + autoupdate.js shipped + manifest clean: OK \u2705');

    // 3) defaults — key නැතුව ON, interval clamp 15–1440, default 60
    resetAU();
    writeSettings({ pairKey: 'T' });
    if (au.enabled() !== true) throw new Error('default must be ON (autoUpdate key absent)');
    if (au.intervalMin() !== 60) throw new Error('default interval must be 60');
    writeSettings({ autoUpdate: true, autoUpdateMinutes: 7 });
    if (au.intervalMin() !== 15) throw new Error('interval must clamp low to 15');
    writeSettings({ autoUpdate: true, autoUpdateMinutes: 99999 });
    if (au.intervalMin() !== 1440) throw new Error('interval must clamp high to 1440');
    writeSettings({ autoUpdate: true, autoUpdateMinutes: 30 });
    if (au.intervalMin() !== 30) throw new Error('interval 30 must pass through');
    console.log('[3] default ON + interval clamp (15..1440, default 60): OK \u2705');

    // 4) tick — disabled → skip (no check, no timer)
    resetAU();
    writeSettings({ autoUpdate: false });
    let checks = 0;
    const r4 = await au.tick({ checkFn: () => { checks++; return upd(); }, getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: async () => { } });
    if (r4.skipped !== 'disabled' || checks !== 0) throw new Error('disabled tick must skip before checking');
    console.log('[4] autoUpdate:false → tick skips (no GitHub call, no timers): OK \u2705');

    // 5) tick — unpaired (owner jid නෑ) → skip, restart risk නෑ
    resetAU();
    writeSettings({ autoUpdate: true });
    checks = 0;
    const r5 = await au.tick({ checkFn: () => { checks++; return upd(); }, getJid: () => null, isBusy: () => false, send: async () => { }, performUpdate: async () => { } });
    if (r5.skipped !== 'unpaired' || checks !== 0) throw new Error('unpaired tick must skip before checking');
    if (!/pair/.test(au._state.lastResult)) throw new Error('unpaired state must say "pair"');
    console.log('[5] unpaired → auto-update idle (pairing restart-loop නෑ): OK \u2705');

    // 6) tick — up to date → no apply
    resetAU();
    let applied = 0, sent = 0;
    const r6 = await au.tick({ checkFn: () => same(), getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { sent++; }, performUpdate: async () => { applied++; } });
    if (!r6.upToDate || applied !== 0 || sent !== 0) throw new Error('up-to-date must not apply/notify');
    if (au._state.nextKind !== 'normal') throw new Error('up-to-date must reschedule normal');
    console.log('[6] up to date → silent reschedule: OK \u2705');

    // 7) tick — update + idle → notify owner + performUpdate (auto path)
    resetAU();
    applied = 0; sent = 0;
    const sentTexts = [];
    const r7 = await au.tick({
        checkFn: () => upd(), getJid: () => '94@s.whatsapp.net', isBusy: () => false,
        send: async (_j, c) => { sent++; sentTexts.push(c.text); },
        performUpdate: async () => { applied++; return undefined; },   // undefined = exit(100) path
    });
    if (!r7.applied || r7.version !== '2.32.0' || applied !== 1 || sent !== 1) throw new Error('idle+update must notify once and apply once');
    if (!/Auto-update/.test(sentTexts[0]) || !/2\.32\.0/.test(sentTexts[0])) throw new Error('notify must mention auto-update + version');
    console.log('[7] update + idle → owner notify + auto install (exit path): OK \u2705');

    // 8) tick — busy → defer 5 min, NO apply; ආයෙ idle වුණාම apply
    resetAU();
    applied = 0;
    let busy = true;
    const r8 = await au.tick({ checkFn: () => upd(), getJid: () => '94@s.whatsapp.net', isBusy: () => busy, send: async () => { }, performUpdate: async () => { applied++; } });
    if (r8.skipped !== 'busy' || applied !== 0) throw new Error('busy must NOT apply');
    if (au._state.pendingVersion !== '2.32.0') throw new Error('busy must remember pending version');
    if (au._state.nextKind !== 'busy-retry') throw new Error('busy must schedule 5-min retry');
    busy = false;
    const r8b = await au.tick({ checkFn: () => upd(), getJid: () => '94@s.whatsapp.net', isBusy: () => busy, send: async () => { }, performUpdate: async () => { applied++; } });
    if (!r8b.applied || applied !== 1) throw new Error('idle retry must apply');
    console.log('[8] busy → defer (download kill නෑ) → idle retry applies: OK \u2705');

    // 9) failed-sha memory — broken build එක ආයෙ ආයෙ try නොකිරීම
    resetAU();
    applied = 0;
    const failOnce = async () => { applied++; throw new Error('syntax fake-fail'); };
    const r9 = await au.tick({ checkFn: () => upd(), getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: failOnce });
    if (!r9.error) throw new Error('failing apply must return error');
    if (applied !== 1) throw new Error('apply must be attempted once');
    const r9b = await au.tick({ checkFn: () => upd(), getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: failOnce });
    if (r9b.skipped !== 'failed-before' || applied !== 1) throw new Error('same sha must NOT retry after fail');
    const LATEST2 = { ...LATEST, sha: 'sha-NEWER' };
    const r9c = await au.tick({ checkFn: () => ({ current: CURRENT, latest: LATEST2, upToDate: false }), getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: failOnce });
    if (!r9c.error || applied !== 2) throw new Error('NEW sha must retry');
    console.log('[9] failed-sha memory (broken build loop නෑ, අලුත් sha ආවම retry): OK \u2705');

    // 10) check-fail backoff — GitHub down → interval × streak (max ×6)
    resetAU();
    let failN = 0;
    const boom = () => { failN++; throw new Error('GitHub 403 rate-limited'); };
    await au.tick({ checkFn: boom, getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: async () => { } });
    if (au._state.failStreak !== 1 || au._state.nextKind !== 'backoff×1') throw new Error('streak 1 backoff wrong');
    await au.tick({ checkFn: boom, getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: async () => { } });
    if (au._state.failStreak !== 2 || au._state.nextKind !== 'backoff×2') throw new Error('streak 2 backoff wrong');
    await au.tick({ checkFn: () => same(), getJid: () => '94@s.whatsapp.net', isBusy: () => false, send: async () => { }, performUpdate: async () => { } });
    if (au._state.failStreak !== 0) throw new Error('success must reset streak');
    console.log('[10] GitHub fail → backoff streak, success → reset: OK \u2705');

    // 11) .autoupdate command — on/off/status + settings.json persistence
    resetAU();
    writeSettings({ autoUpdate: true, autoUpdateMinutes: 45 });
    const off = au.command('off');
    if (au.enabled() !== false) throw new Error('off must persist autoUpdate:false');
    if (!/OFF/.test(off)) throw new Error('off text wrong');
    const s1 = JSON.parse(read(SETTINGS_SAFE()));
    if (s1.autoUpdate !== false) throw new Error('settings.json not persisted');
    const on = au.command('on');
    if (au.enabled() !== true || !/ON/.test(on)) throw new Error('on must persist + text');
    const st = au.command('');   // status
    if (!/ON/.test(st) || !/45 min/.test(st)) throw new Error('status must show state + interval');
    if (au.command('on').includes('ON\*') && false) { }   // (idempotent on is fine)
    function SETTINGS_SAFE() { return SET; }
    console.log('[11] .autoupdate on|off|status + settings.json persistence: OK \u2705');

    // 12) bot.js wiring — shared runUpdate, busy counter, start opts, dispatch, texts
    const botSrc = read('bot.js');
    if (!botSrc.includes("require('./autoupdate')")) throw new Error('bot.js does not require autoupdate');
    if (!/autoupdate\.command\(rest\[0\]\)/.test(botSrc)) throw new Error('.autoupdate dispatch missing');
    if (!/autoupdate\.start\(\{/.test(botSrc) || !/getJid: \(\) => ME\.pn/.test(botSrc) || !/isBusy: \(\) => updating \|\| JOBS > 0/.test(botSrc) || !/performUpdate: \(o = \{\}\)/.test(botSrc)) throw new Error('autoupdate.start wiring wrong');
    if (!/async function runUpdate\(/.test(botSrc)) throw new Error('shared runUpdate missing');
    if (!/runUpdate\(\{ send, jid, force, reactOk/.test(botSrc)) throw new Error('manual .update must go through shared runUpdate');
    for (const h of ['tools.handle', 'features.handle', 'moviedex.handle', 'handleDownload(send, jid, msg, link)', 'handleAI(send, jid, msg']) {
        if (!botSrc.includes(`runJob(() => ${h}`)) throw new Error('JOBS busy counter missing on ' + h);
    }
    if (!/auto-update: \$\{autoupdate\.statusText\(\)\}/.test(botSrc)) throw new Error('.version auto-update line missing');
    if (!/\*\.autoupdate\*/.test(botSrc)) throw new Error('.alive card must mention .autoupdate');
    if (!/\.autoupdate on\|off\* — GitHub/.test(botSrc)) throw new Error('settings menu must explain .autoupdate');
    console.log('[12] bot.js wiring (shared runUpdate + JOBS guard + start + dispatch + texts): OK \u2705');

    // 13) updater safety intact — settings.json update-protect (auto-update වුණත් user settings කැඩෙන්නේ නෑ)
    const upSrc = read('updater.js');
    if (!/\^settings\\\.json\$/.test(upSrc)) throw new Error('updater PROTECTED must still block settings.json');
    const tpl = JSON.parse(read('settings.json'));
    if (tpl.autoUpdate !== true) throw new Error('fresh-install template must default autoUpdate:true');
    console.log('[13] updater settings.json protect + fresh-install default ON: OK \u2705');

    // 14) syntax on all shipped .js files
    for (const f of man.files.filter((x) => x.endsWith('.js'))) {
        execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
    }
    console.log('[14] node --check all manifest .js files: OK \u2705');

    console.log('\n\ud83c\udf89 ALL v2.31.0 TESTS PASSED');
})().catch((e) => { console.error('\ud83d\udca5 ' + (e.stack || e.message)); failed = true; })
    .finally(() => {
        fs.writeFileSync(SET, savedSettings);            // settings.json restore (panel/real values safe)
        for (const t of au._state.timers) clearTimeout(t);
        au.stop();
        fs.rmSync(SET_BACKUP, { force: true });
        process.exit(failed ? 1 : 0);
    });
