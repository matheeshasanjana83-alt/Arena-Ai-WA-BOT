'use strict';
/**
 * test_v232.js — Anti-Bug v2: crasher-panel hardening (v2.32.0)
 * MishuCrasher-style bug-panel APKs (WebView → remote panel, key-gated) ship classes the old
 * detector missed: Sinhala virama/sign storms, combining-mark storms, control/filler storms,
 * media dimension bombs, location coordinate bugs, giant waveform arrays. This suite proves
 * every class is caught (severe where it should be) AND that normal chat never triggers.
 * run: node test_v232.js   (offline — pure detect() fixtures, no network, no sending)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');
const ab = require('./antibug');

(async () => {
    // 1) version sync 2.32.0
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    if (man.version !== pkg.version || pkg.version < '2.32.0') throw new Error('version sync wrong: pkg=' + pkg.version + ' manifest=' + man.version);
    console.log('[1] v' + pkg.version + ' sync (manifest === package): OK \u2705');

    // 2) old test gone, manifest clean, antibug shipped
    if (fs.existsSync('test_v231.js')) throw new Error('test_v231.js still exists');
    for (const f of man.removed || []) {
        if (man.files.includes(f)) throw new Error(f + ' in both files and removed');
        if (/^(auth|node_modules|\.backup)/.test(f) || f.includes('..') || path.isAbsolute(f)) throw new Error('unsafe removed path: ' + f);
    }
    if (!man.files.includes('antibug.js') || !man.files.includes('test_v232.js')) throw new Error('manifest missing antibug.js/test_v232.js');
    console.log('[2] test_v231 deleted + manifest clean (antibug.js shipped): OK \u2705');

    // 3) new limits present
    for (const k of ['markRun', 'sinhRun', 'ctrl', 'arrLen', 'mediaDim', 'mediaPix', 'durMax']) {
        if (!(k in ab.L)) throw new Error('antibug.L missing ' + k);
    }
    console.log('[3] new crasher-class limits in antibug.L: OK \u2705');

    // 4) every new bug class caught (fixtures independent of selfTest)
    const mustBug = (name, msg, severe) => {
        const r = ab.detect(msg);
        if (!r.bug) throw new Error(name + ' NOT detected');
        if (severe && !r.severe) throw new Error(name + ' detected but not severe');
        return r;
    };
    mustBug('sinhala virama storm', { conversation: '්ා'.repeat(600) }, true);
    mustBug('sinhala sign+ZWJ storm', { conversation: '්‍'.repeat(300) }, true);
    mustBug('mark storm (arabic)', { conversation: 'ا' + 'ًٌٍَُِّ'.repeat(500) }, true);
    mustBug('mark storm (balinese-ish deep stack)', { conversation: 'ᬅ' + '\u0334\u0334\u0334\u0334'.repeat(200) }, true);
    mustBug('control storm', { conversation: 'a\u0000'.repeat(400) }, true);
    mustBug('filler flood', { conversation: '\u3164'.repeat(3000) }, true);
    mustBug('image dim bomb', { imageMessage: { width: 99999, height: 99999 } }, true);
    mustBug('sticker dim bomb', { stickerMessage: { width: 1, height: 999999 } }, true);
    mustBug('pixel bomb (8K x 8K)', { imageMessage: { width: 8000, height: 8000 } }, true);
    mustBug('location lat bug', { locationMessage: { degreesLatitude: 1e300, degreesLongitude: 90 } }, true);
    mustBug('location lng bug', { locationMessage: { degreesLatitude: 6.9, degreesLongitude: 9999 } }, true);
    const g = mustBug('giant waveform array', { audioMessage: { seconds: 30, waveform: new Array(5000).fill(9) } }, false);
    if (g.severe) throw new Error('giant array must not block-severe');
    const d = mustBug('duration bomb', { videoMessage: { seconds: 1e9, width: 1280, height: 720 } }, false);
    if (d.severe) throw new Error('duration bomb must not block-severe');
    console.log('[4] crasher classes: virama/sign/mark/ctrl/filler storms + dim/pixel/location/array/duration bombs all caught: OK \u2705');

    // 5) false positives — normal chat must NEVER trigger
    const mustClean = (name, msg) => {
        const r = ab.detect(msg);
        if (r.bug) throw new Error('FALSE POSITIVE on ' + name + ': ' + r.reasons.join(', '));
    };
    mustClean('සාමාන්‍ය සිංහල (ර්‍ය ZWJ cluster එක්ක)', { conversation: 'මම ගෙදර යනවා යාළුවෙන් එක්ක පාරට. ඔයා හොඳට ඉන්න. ර්‍යාංශ මිටියාවත ගිනිකෙළිය වගේ වැඩ.' });
    mustClean('Quran tashkeel', { conversation: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' });
    mustClean('family emoji ZWJ', { conversation: '👨‍👩‍👧‍👦 ❤️ 🇱🇰 කට්ටිය හැමෝටම ජය!' });
    mustClean('4K video', { videoMessage: { width: 3840, height: 2160, seconds: 600 } });
    mustClean('8K video (33MP < 40MP cap)', { videoMessage: { width: 7680, height: 4320 } });
    mustClean('normal location', { locationMessage: { degreesLatitude: 6.9271, degreesLongitude: 79.8612 } });
    mustClean('normal voice note', { audioMessage: { seconds: 180, waveform: new Array(64).fill(3) } });
    mustClean('long normal message', { conversation: 'මේක නිකන් දිග message එකක්. '.repeat(200) });
    mustClean('group subject normal', { conversation: 'x', groupMetadataMessage: { subject: 'අපේ කණ්ඩායම 🎉' } });
    console.log('[5] false positives: Sinhala/Quran/emoji/4K/8K/locations/waveform/long text all clean: OK \u2705');

    // 6) .antibug test — self-test must be 100% green
    const st = ab.selfTest();
    if (/❌/.test(st)) throw new Error('selfTest has failures:\n' + st);
    if (!/22\/22/.test(st)) throw new Error('selfTest count wrong: ' + (st.match(/(\d+\/\d+)/) || [])[1]);
    console.log('[6] .antibug test self-test 22/22 green: OK \u2705');

    // 7) command wiring — test + menu
    (async () => {
        const menu = await ab.command('');
        if (!/test/.test(menu)) throw new Error('menu missing .antibug test');
        const t = await ab.command('test');
        if (!/SELF-TEST/.test(t) || /❌/.test(t)) throw new Error('command(test) broken');
        console.log('[7] .antibug command: test + menu line wired: OK \u2705');

        // 8) bot.js guard wiring intact
        const botSrc = read('bot.js');
        if (!/antibug\.guard\(msg, \{ sock: SOCK, me: ME, send, log \}\)/.test(botSrc)) throw new Error('bot.js antibug.guard wiring missing');
        if (!/\.antibug/.test(botSrc)) throw new Error('.antibug dispatch missing');
        console.log('[8] bot.js guard + dispatch wiring intact: OK \u2705');

        // 9) syntax on all shipped .js
        for (const f of man.files.filter((x) => x.endsWith('.js'))) {
            execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
        }
        console.log('[9] node --check all manifest .js files: OK \u2705');

        console.log('\n\ud83c\udf89 ALL v2.32.0 TESTS PASSED');
    })().catch((e) => { console.error('\ud83d\udca5 ' + (e.stack || e.message)); failed = true; process.exit(failed ? 1 : 0); });
})().catch((e) => { console.error('\ud83d\udca5 ' + (e.stack || e.message)); failed = true; process.exit(failed ? 1 : 0); });
