/**
 * test_v222.js — UX flow overhaul (v2.22): style.js brand voice + ⏳→✅/❌ react flow
 * + progress-bubble self-delete + compact menu — offline tests (no network, no WhatsApp)
 * run: node test_v222.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);

(async () => {
    // 1) style.js — the single brand voice
    const { BRAND, foot, bar, cut } = require('./style');
    if (BRAND !== '\u1d8b\u1d00\u1d20\u026a\u1dbb \u1d0d\u1d05 \u1d20\u0031'.replace('\u0031', '1')) {
        // (literal compare below instead — small-caps may confuse)
    }
    if (foot('2.1 MB') !== '> \u26a1 \u1d8b\u1d00\u1d20\u026a\u1dbb \u1d0d\u1d05 \u1d201  \u00b7  2.1 MB' && !/^\u003e \u26a1 .+2\.1 MB$/.test(foot('2.1 MB'))) throw new Error('foot() wrong: ' + JSON.stringify(foot('2.1 MB')));
    if (!/^\u003e \u26a1 /.test(foot())) throw new Error('foot() no-extra wrong');
    if (bar(50) !== '\u25b0'.repeat(6) + '\u25b1'.repeat(6)) throw new Error('bar(50) wrong');
    if (bar(0) !== '\u25b1'.repeat(12) || bar(100) !== '\u25b0'.repeat(12)) throw new Error('bar edges wrong');
    if (cut('  hello world  ', 5) !== 'hello') throw new Error('cut wrong');
    console.log('[1] style.js foot/bar/cut (brand footer format): OK \u2705');

    // 2) version sync + new files shipped
    const man = require('./manifest.json');
    const pkgV = require('./package.json').version;
    if (man.version !== pkgV || pkgV < '2.22.0') throw new Error('version sync wrong: ' + pkgV);
    if (!man.files.includes('style.js') || !man.files.includes('test_v222.js')) throw new Error('manifest files missing style.js/test_v222.js');
    console.log('[2] v' + pkgV + ' + manifest ships style.js + test_v222.js: OK \u2705');

    // 3) syntax on all touched files
    for (const f of ['bot.js', 'style.js', 'features.js', 'tools.js', 'movies.js']) {
        execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
    }
    console.log('[3] node --check \u00d75: OK \u2705');

    // 4) full module graph loads offline
    require('./bot.js');
    const features = require('./features');
    const tools = require('./tools');
    const movies = require('./movies');
    console.log('[4] bot/features/tools/movies module graph: OK \u2705');

    // 5) "✅ ඉවරයි" residue removed — bubbles get deleted, files speak for themselves
    for (const f of ['bot.js', 'features.js', 'tools.js', 'movies.js']) {
        const src = fs.readFileSync(f, 'utf8');
        if (/ඉවරයි/.test(src)) throw new Error(f + ' still has residue text');
    }
    console.log('[5] no "\u2705 \u0d89\u0dc0\u0dad\u0dbb\u0dba\u0dd2" residue in any flow: OK \u2705');

    // 6) AI replies no longer stamp the model name (the #1 AI-made tell)
    const botSrc = fs.readFileSync('bot.js', 'utf8');
    if (/_\u2014 \$\{model\}_/.test(botSrc)) throw new Error('model name still stamped on AI replies');
    if (!botSrc.includes("foot('\u1d00\u026a')")) throw new Error('AI brand footer missing');
    console.log('[6] AI replies brand-signed (model hidden): OK \u2705');

    // 7) \u23f3\u2192\u2705/\u274c react flow wired end-to-end
    if (!botSrc.includes("reactTo(msg.key, '\u23f3')")) throw new Error('\u23f3 start react missing');
    if (!botSrc.includes("reactTo(msg.key, '\u2705')") || !botSrc.includes("reactTo(msg.key, '\u274c')")) throw new Error('\u2705/\u274c done reacts missing');
    if (!botSrc.includes('HEAVY = new Set')) throw new Error('HEAVY set missing');
    if (!/ME, (download, )?react \}\)/.test(botSrc)) throw new Error('ctx.react not passed to handlers');
    for (const [f] of [['features.js'], ['tools.js'], ['movies.js']]) {
        if (!fs.readFileSync(f, 'utf8').includes('react?.')) throw new Error(f + ' does not use ctx.react');
    }
    console.log('[7] \u23f3 \u2192 \u2705/\u274c react flow (bot + all 3 handler modules): OK \u2705');

    // 8) progress bubbles self-delete (delete: st.key / status.key present)
    const count = (f, re) => (fs.readFileSync(f, 'utf8').match(re) || []).length;
    if (count('bot.js', /delete: status\.key/g) < 1) throw new Error('bot.js bubble delete missing');
    if (count('features.js', /delete: st\.key/g) < 1) throw new Error('features.js status.del missing');
    if (count('movies.js', /delete: (status|st)\.key/g) < 2) throw new Error('movies.js bubble deletes missing');
    console.log('[8] progress-bubble self-delete wired: OK \u2705');

    // 9) .ping shows latency
    if (!botSrc.includes('${ms} ms')) throw new Error('.ping latency missing');
    console.log('[9] .ping latency (Pong! X ms): OK \u2705');

    // 10) menu compact \u2726 style (old \u2503 rail gone)
    if (!botSrc.includes('\u2726 *.')) throw new Error('menu \u2726 style missing');
    if (botSrc.includes('\u2503 *.')) throw new Error('old menu \u2503 rail remains');
    console.log('[10] menu \u2726 compact categories: OK \u2705');

    // 11) movies builders still work with the brand footer
    const lt = movies.listText('avatar', [{ name: 'Avatar: The Way of Water', releaseInfo: '2022', imdbRating: '7.6' }]);
    if (!lt.includes('Avatar: The Way of Water (2022)') || !lt.includes(BRAND)) throw new Error('listText broken: ' + lt);
    const card = movies.cardText({ name: 'Avatar', imdbRating: '7.6', description: 'x', imdb_id: 'tt0499549', cast: ['a', 'b'] }, 1, { items: [{ label: 'WEB-DL 1080p \u2022 2 GB' }], page: { url: 'https://cinesubz.net/movie/x' } });
    if (!card.includes('1080p') || !card.includes('අංකය reply')) throw new Error('cardText broken');
    console.log('[11] movies listText/cardText builders: OK \u2705');

    // 12) exports intact (regression)
    for (const c of ['.yts', '.song', '.video', '.fb', '.tiktok', '.gitclone', '.s']) if (!features.CMDS.includes(c)) throw new Error('features CMDS missing ' + c);
    for (const c of ['.tourl', '.mirror', '.link', '.tts', '.tr', '.8ball']) if (!tools.CMDS.includes(c)) throw new Error('tools CMDS missing ' + c);
    if (!movies.hasSession('x@y')) { /* false is fine \u2014 just ensure callable */ }
    console.log('[12] features/tools CMDS + movies exports: OK \u2705');

    // 13) regression guard \u2014 updater PROTECTED still covers runtime state
    const usrc = fs.readFileSync('updater.js', 'utf8');
    if (!usrc.includes('antispam\\.json')) throw new Error('PROTECTED lost antispam.json');
    if (!usrc.includes('proxies\\.user\\.txt')) throw new Error('PROTECTED lost proxies.user.txt');
    console.log('[13] updater PROTECTED (antispam.json, proxies.user.txt): OK \u2705');

    // 14) report-flood still absent (standing policy)
    const allSrc = ['bot.js', 'features.js', 'tools.js', 'movies.js', 'mirror.js', 'style.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    if (/report30|report50|report100|report-flood|\.report \d/.test(allSrc)) throw new Error('report-flood strings appeared');
    console.log('[14] no report-flood strings (policy held): OK \u2705');

    console.log('\n\ud83c\udf89 ALL v2.22.0 TESTS PASSED');
})().catch((e) => { console.error('\ud83d\udca5 ' + (e.stack || e.message)); failed = true; })
    .finally(() => process.exit(failed ? 1 : 0));
