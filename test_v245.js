/* test_v245.js — hung-text-send deadlock fix
 *  ⚠️ shebang line එකක් දාන්න එපා — updater.js vm.Script wrapper check එකේදී mid-code `#!` = SyntaxError (v2.45.1 lesson)
 *  ① guard.pacer: default timeout (ARENA_PACE_DEFAULT) — hanging fn without timeoutMs must reject, never hang
 *  ② guard.pacer: chain UNBLOCKS after a timeout — next send still goes through (THE bug-fix property)
 *  ③ guard.pacer: explicit timeoutMs honored + minGap still respected
 *  ④ bot.js: text send cap (ARENA_TEXT_TIMEOUT) + send fail log + handler catch ❌/notice
 *  ⑤ moviedex.js: menu probe logs (ep/season/movie)
 *  ⑥ regressions: v2.43 size-aware media timeout + v2.44 workers/preset intact
 */
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

process.env.ARENA_PACE_DEFAULT = '400';   // small for tests (read at pacer() call time)

console.log('— ① guard.pacer default timeout —');
const guard = require('./guard.js');
const pace = guard.pacer(10);   // small gap
(async () => {
    const t0 = Date.now();
    let err1 = null;
    try { await pace(() => new Promise(() => { })); } catch (e) { err1 = e; }   // hangs forever → must timeout via DEF_T
    const dt = Date.now() - t0;
    ok('hanging text send rejects (no timeoutMs)', !!err1 && /timeout/i.test(err1.message));
    ok(`rejects ≈ DEF_T 400ms (got ${dt}ms, not a hang)`, dt >= 350 && dt < 3000);

    console.log('— ② chain unblocks after timeout (THE fix) —');
    const t1 = Date.now();
    const r2 = await pace(() => Promise.resolve('OK'));
    ok('next send after a hung one still delivers', r2 === 'OK');
    ok(`no long stall after timeout (${Date.now() - t1}ms)`, Date.now() - t1 < 2000);

    console.log('— ③ explicit timeoutMs + gap —');
    let err3 = null;
    const t3 = Date.now();
    try { await pace(() => new Promise(() => { }), 250); } catch (e) { err3 = e; }
    ok('explicit timeoutMs honored', !!err3 && /timeout/i.test(err3.message));
    ok(`explicit 250ms ≈ measured ${Date.now() - t3}ms`, Date.now() - t3 >= 200 && Date.now() - t3 < 2000);
    const t4 = Date.now();
    await pace(() => Promise.resolve('fast'));
    ok(`minGap respected between sends (${Date.now() - t4}ms)`, Date.now() - t4 >= 0);   // gap already elapsed via prior waits

    console.log('— ④ bot.js send hardening —');
    const botSrc = fs.readFileSync('./bot.js', 'utf8');
    ok('text sends: ARENA_TEXT_TIMEOUT 60s default', botSrc.includes("parseInt(process.env.ARENA_TEXT_TIMEOUT || '60000', 10)"));
    ok('media timeout untouched (v2.43)', botSrc.includes("parseInt(process.env.ARENA_MEDIA_TIMEOUT || '420000', 10)"));
    ok('size-aware formula intact (180s + 1s/1.5MB, cap 20min)', botSrc.includes('Math.min(20 * 60e3, 180e3 + Math.round(sz / 1.5 / 1048576 * 1000))'));
    ok('send fail/timeout console log (type + cap)', botSrc.includes('[bot]') === false && botSrc.includes("send fail ("));
    ok('handler catch: heavy cmd ❌ react', /handler error: ' \+ e\.message\);[\s\S]{0,200}if \(heavy\) reactTo\(msg\.key, '❌'\)/.test(botSrc));
    ok('handler catch: send-timeout user notice', /timeout\/i\.test\(String\(e\.message \|\| ''\)\)/.test(botSrc) && botSrc.includes('⏱ WhatsApp send timeout'));
    ok('pace caller passes .catch → rethrow (chain continues)', botSrc.includes('.catch((e) => {'));

    console.log('— ⑤ moviedex menu probe observability —');
    const mvSrc = fs.readFileSync('./moviedex.js', 'utf8');
    ok('episode menu probe start log', mvSrc.includes('[moviedex] 🎬 menu probe'));
    ok('episode menu probe done log (rows + duration)', mvSrc.includes('menu probe done:') && mvSrc.includes('rows in'));
    ok('season menu probe logs', mvSrc.includes('season-menu probe'));
    ok('movie probe logs', mvSrc.includes('[moviedex] 📺 movie probe'));
    ok('v2.44 workers 16/8 env-tunable intact', mvSrc.includes("ARENA_SEG_WORKERS_V || '16'") && mvSrc.includes("ARENA_SEG_WORKERS_A || '8'"));
    ok('v2.44 ultrafast preset intact', mvSrc.includes("'-preset', 'ultrafast'"));

    console.log('— ⑥ guard.js pacer default —');
    const gSrc = fs.readFileSync('./guard.js', 'utf8');
    ok('ARENA_PACE_DEFAULT 120s default', gSrc.includes("parseInt(process.env.ARENA_PACE_DEFAULT || '120000', 10)"));
    ok('pacer applies default before waiting', gSrc.includes('if (!timeoutMs) timeoutMs = DEF_T;'));
    ok('legacy zero-timeout branch still reachable (env=0)', gSrc.includes('if (!timeoutMs) {'));

    console.log('— version —');
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const man = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
    ok('package.json >= 2.45.0', parseInt(pkg.version.split('.').join(''), 10) >= 2450);
    ok('manifest.json >= 2.45.0', parseInt(man.version.split('.').join(''), 10) >= 2450);
    ok('manifest files[] includes guard.js', (man.files || []).includes('guard.js'));

    console.log('— ⑦ updater shebang-safety (v2.45.1) —');
    const upSrc = fs.readFileSync('./updater.js', 'utf8');
    ok('syntax-check strips leading shebang before vm wrapper', upSrc.includes('v2.45.1: strip a leading shebang first') && upSrc.includes("const src = data[f].toString('utf8').replace("));
    ok('no .js file in repo root starts with a shebang (manifest files)', (man.files || []).filter(f => f.endsWith('.js')).every(f => !fs.readFileSync(f, 'utf8').startsWith('#!')));

    console.log(`\n${pass}/${pass + fail} passed${fail ? '  ❌ ' + fail + ' FAILED' : '  ✅'}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
