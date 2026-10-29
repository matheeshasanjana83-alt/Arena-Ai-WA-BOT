/* test_v244 — download SPEED II (offline)
   • ① segment workers 16 (video) / 8 (audio), env-tunable ARENA_SEG_WORKERS_V/A
   • ② 360p re-encode ultrafast (was veryfast), maxrate cap unchanged
   • ③ phase timing logs: ⬇️ chunks ... in Ns + 🎞️ 360p re-encode ... in Ns
   • ④ version 2.44.0 in package.json + manifest.json
   • ⑤ regression: v2.43 send hardening pieces still intact
*/
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
process.env.ARENA_RATE_MIN = '1000'; process.env.ARENA_RATE_HOUR = '10000';
process.env.DL_TMP = require('os').tmpdir();

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const movSrc = fs.readFileSync(path.join(__dirname, '..', 'moviedex.js'), 'utf8');

/* ── 1. worker count ── */
ok('v2.44: video workers default 16 (env-tunable)', movSrc.includes("parseInt(process.env.ARENA_SEG_WORKERS_V || '16', 10) || 16"));
ok('v2.44: audio workers default 8 (env-tunable)', movSrc.includes("parseInt(process.env.ARENA_SEG_WORKERS_A || '8', 10) || 8"));
ok('v2.44: worker kind split kept (v vs a)', movSrc.includes("kind === 'v'\n                ? (parseInt(process.env.ARENA_SEG_WORKERS_V"));
ok('v2.44: old 8/6 hardcoded split gone', !movSrc.includes("kind === 'v' ? 8 : 6"));

// actual runtime: two dashDownload runs with different env → worker count respected
// (structural check via source + parseMpd/chunkCount still exported for the engine)
ok('engine exports intact (parseMpd/chunkCount/expandTpl/dashDownload)', (() => {
    const mv = require('../moviedex.js');
    return typeof mv.parseMpd === 'function' && typeof mv.chunkCount === 'function'
        && typeof mv.expandTpl === 'function' && typeof mv.dashDownload === 'function';
})());

/* ── 2. ultrafast transcode ── */
ok('v2.44: 360p preset ultrafast', movSrc.includes("'-preset', 'ultrafast'"));
ok('v2.44: old veryfast preset gone from args', !movSrc.includes("'-preset', 'veryfast'"));
ok('v2.44: maxrate 450k cap unchanged (size guard)', movSrc.includes("'-maxrate', '450k'") && movSrc.includes("'-bufsize', '900k'"));
ok('v2.44: crf 27 unchanged', movSrc.includes("'-crf', '27'"));
ok('v2.44: scale -2:360 unchanged', movSrc.includes("'scale=-2:360'"));

/* ── 3. phase timing logs ── */
ok('v2.44: chunks phase log', movSrc.includes('⬇️ chunks ${row.transcode ? row.srcH + \'p src\' : row.label} (${human(res.bytes)}) in ${Math.round((Date.now() - tChunk0) / 1000)}s'));
ok('v2.44: re-encode phase log', movSrc.includes('🎞️ 360p re-encode (${human(bytes)}) in ${Math.round((Date.now() - tEnc0) / 1000)}s'));
ok('v2.44: tChunk0 timer before dashDownload', movSrc.includes('const tChunk0 = Date.now();   // v2.44 phase timing') && movSrc.indexOf('tChunk0') < movSrc.indexOf('await dashDownload('));
ok('v2.44: tEnc0 timer before transcode360', movSrc.includes('const tEnc0 = Date.now();'));

/* ── 4. version ── */
ok('v2.44+: package.json >= 2.44.0', parseInt(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version.split('.').join(''), 10) >= 2440);
const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
ok('v2.44+: manifest.json >= 2.44.0', parseInt(man.version.split('.').join(''), 10) >= 2440);
ok('v2.44+: manifest notes mention benchmark + env (v2.44 notes or later)', (man.notes.includes('per-connection') && man.notes.includes('ARENA_SEG_WORKERS_V')) || man.notes.includes('v2.44 speed patches') || parseInt(man.version.split('.').join(''), 10) >= 2470);
ok('v2.44.0: moviedex.js listed in manifest files', man.files.includes('moviedex.js'));

/* ── 5. regression: v2.43 pieces still intact ── */
ok('regression: size-aware media timeout formula intact', movSrc.includes('Math.min(20 * 60e3, 180e3 + Math.round(sz / 1.5 / 1048576 * 1000))') || fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8').includes('Math.min(20 * 60e3, 180e3 + Math.round(sz / 1.5 / 1048576 * 1000))'));
ok('regression: upload heartbeat intact', movSrc.includes('📤 WhatsApp… (${human(f.size)}) · ${secs}s…'));
ok('regression: upload start/sent logs intact', movSrc.includes('📤 upload start: ${f.name} (${human(f.size)}) → ${jid}') && movSrc.includes('✅ sent ${f.name} in ${Math.round((Date.now() - t0) / 1000)}s'));
ok('regression: video+audio parallel grab intact', movSrc.includes('await Promise.all([\n            grab(\'v\', rep.seg, rep.id, counts.v, vFile),'));
ok('regression: async mux execFile intact', movSrc.includes('execFile(ffmpeg, a,') || movSrc.includes('execFile(ffmpeg, a,'.slice(0, 20)));
ok('regression: CDN stall watchdog intact', movSrc.includes("Date.now() - lastSegAt > 120e3"));

console.log(`\n${'='.repeat(50)}\ntest_v244: ${pass} passed, ${fail} failed\n${'='.repeat(50)}`);
process.exit(fail ? 1 : 0);
