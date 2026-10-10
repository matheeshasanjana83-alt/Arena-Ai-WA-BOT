'use strict';
/**
 * test_v225.js — MoviePro removal (v2.25.0)
 * .moviepro/.mvpro/.movie + movies.js + its test files are GONE everywhere,
 * updater now honours manifest "removed" (auto-delete on .update, rollback-safe).
 * run: node test_v225.js   (offline — no network, no WhatsApp)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');

(async () => {
    // 1) version sync 2.25.0
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    if (man.version !== pkg.version || pkg.version < '2.25.0') throw new Error('version sync wrong: pkg=' + pkg.version + ' manifest=' + man.version);
    console.log('[1] v' + pkg.version + ' sync (manifest === package): OK \u2705');

    // 2) moviepro files actually deleted
    for (const f of ['movies.js', 'test_v218.js', 'test_v219.js', 'test_v223.js', 'test_v224.js']) {
        if (fs.existsSync(f)) throw new Error(f + ' still exists');
    }
    console.log('[2] movies.js + test_v218/v219/v223/v224 deleted: OK \u2705');

    // 3) manifest: removed list correct, files list clean
    for (const f of man.removed || []) {
        if (man.files.includes(f)) throw new Error(f + ' in both files and removed');
        if (/^(auth|node_modules|\.backup)/.test(f) || f.includes('..') || path.isAbsolute(f)) throw new Error('unsafe removed path: ' + f);
    }
    for (const f of ['movies.js', 'test_v218.js', 'test_v219.js', 'test_v223.js', 'test_v224.js']) {
        if (man.files.includes(f)) throw new Error('manifest still ships ' + f);
    }
    if (!man.files.includes('test_v225.js') || !man.files.includes('bot.js')) throw new Error('manifest missing bot.js/test_v225.js');
    console.log('[3] manifest removed[] list + files[] clean (rollback-safe paths): OK \u2705');

    // 4) bot.js has zero moviepro traces (require/handler/bridge/HEAVY/CATS/HELP)
    const botSrc = read('bot.js');
    if (/moviepro|mvpro/i.test(botSrc)) throw new Error('bot.js still mentions moviepro');
    if (/require\(['"]\.\/movies['"]\)/.test(botSrc)) throw new Error('bot.js still requires ./movies');
    if (/movies\.handle|movies\.bridgeReply|movies\.hasSession/.test(botSrc)) throw new Error('bot.js still calls movies.*');
    // bare-number bridge still wired for .menu categories (must not break menu replies)
    if (!botSrc.includes("'.menu ' + text")) throw new Error('menu number bridge broken');
    console.log('[4] bot.js zero moviepro refs + .menu number bridge intact: OK \u2705');

    // 5) no other module references movies.js
    for (const f of fs.readdirSync('.').filter((x) => x.endsWith('.js') && x !== 'test_v225.js')) {
        if (/require\(['"]\.\/movies['"]\)|movies\.bridgeReply/.test(read(f))) throw new Error(f + ' still references movies.js');
    }
    console.log('[5] no module references movies.js anymore: OK \u2705');

    // 6) full module graph loads offline (bot without movies)
    require('./bot.js');
    const features = require('./features');
    const tools = require('./tools');
    const updater = require('./updater');
    console.log('[6] bot/features/tools/updater module graph loads: OK \u2705');

    // 7) remaining feature commands untouched (regression)
    for (const c of ['.yts', '.song', '.video', '.fb', '.tiktok', '.gitclone', '.s']) if (!features.CMDS.includes(c)) throw new Error('features CMDS missing ' + c);
    for (const c of ['.tourl', '.mirror', '.link', '.tts', '.tr', '.8ball']) if (!tools.CMDS.includes(c)) throw new Error('tools CMDS missing ' + c);
    console.log('[7] features/tools CMDS regression: OK \u2705');

    // 8) updater honours manifest.removed (apply-time delete + safe paths) + rollback backup covers removed
    const usrc = read('updater.js');
    if (!usrc.includes('manifest.removed') && !usrc.includes('removed = manifest.removed')) throw new Error('updater does not read manifest.removed');
    if (!usrc.includes('[...files, ...removed]')) throw new Error('updater safety check / backup does not cover removed files');
    if (!usrc.includes("rmSync(path.join(ROOT, f), { force: true })")) throw new Error('updater removed-file delete missing');
    // PROTECTED paths can never be removed (auth/settings/cookies…)
    if (!usrc.includes('PROTECTED.test(f)')) throw new Error('removed path safety missing');
    console.log('[8] updater removed[] auto-delete (protected paths safe, rollback keeps them): OK \u2705');

    // 9) HELP/menu/cat text mentions gone from user-facing surfaces
    if (botSrc.includes('MOVIEPRO')) throw new Error('menu still has MOVIEPRO category');
    if (!read('README.md').match(/moviepro/i)) console.log('      (README.md clean)'); else throw new Error('README.md still lists .moviepro');
    console.log('[9] HELP / menu / README surfaces clean: OK \u2705');

    // 10) report-flood still absent (standing policy)
    const allSrc = ['bot.js', 'features.js', 'tools.js', 'mirror.js', 'style.js', 'updater.js'].map(read).join('\n');
    if (/report30|report50|report100|report-flood|\.report \d/.test(allSrc)) throw new Error('report-flood strings appeared');
    console.log('[10] no report-flood strings (policy held): OK \u2705');

    // 11) syntax on all shipped .js files
    for (const f of man.files.filter((x) => x.endsWith('.js'))) {
        execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
    }
    console.log('[11] node --check all manifest .js files: OK \u2705');

    console.log('\n\ud83c\udf89 ALL v2.25.0 TESTS PASSED');
})().catch((e) => { console.error('\ud83d\udca5 ' + (e.stack || e.message)); failed = true; })
    .finally(() => process.exit(failed ? 1 : 0));
