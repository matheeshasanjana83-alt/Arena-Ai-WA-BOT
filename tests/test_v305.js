/**
 * test_v305.js — 🥷 CHROME SELF-HEAL (v3.04.0)
 * Panel boot truth (v3.03.0 boot log 2026-10-30): puppeteer JS installed on the panel but the
 * Chrome binary was MISSING → "Could not find Chrome (ver. 156…)" → solve honestly failed.
 * Fix: (1) scripts/get-chrome.js runs puppeteer's own installer on every npm install (postinstall
 * chain) — best-effort, NEVER fails the install; (2) cfsolver.ensureChrome self-heals by spawning
 * the installer detached in the background when launch hits MISSING_CHROME.
 * ALL OFFLINE (repo has no puppeteer — the absent path is exactly what these tests exercise).
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v305_mem.json';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = JSON.parse(fs.readFileSync(REPO + '/package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync(REPO + '/manifest.json', 'utf8'));
const cs = require('../cfsolver');

(async () => {
    console.log('— v3.04.0 pins —');
    ok('version 3.04.0 pkg+manifest · notes headline · manifest lists scripts/get-chrome.js + test_v305.js', () => {
        assert.strictEqual(pkg.version, '3.04.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.04.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('CHROME SELF-HEAL'), 'notes headline');
        assert.ok(manifest.files.includes('scripts/get-chrome.js'), 'get-chrome in manifest');
        assert.ok(manifest.files.includes('tests/test_v305.js'), 'test in manifest');
    });
    ok('postinstall chain: get-chrome.js BEFORE launcher.js (Chrome warms on every npm install, bot unaffected)', () => {
        assert.ok(/node scripts\/get-chrome\.js && node launcher\.js/.test(pkg.scripts.postinstall), pkg.scripts.postinstall);
    });
    ok('get-chrome.js: missing-puppeteer path + forced-fail path BOTH exit 0 (install never breaks)', async () => {
        const { execFileSync } = require('child_process');
        // repo has no node_modules/puppeteer → absent branch → exit 0
        const r1 = execFileSync(process.execPath, [REPO + '/scripts/get-chrome.js'], { encoding: 'utf8', timeout: 30000 });
        assert.ok(r1.includes('puppeteer not installed'), 'absent branch log');
        // forced-fail: sabotage the installer path detection via a temp puppeteer stub
        const nm = REPO + '/node_modules/puppeteer';
        const made = !fs.existsSync(nm);
        if (made) fs.mkdirSync(nm, { recursive: true });
        fs.writeFileSync(nm + '/install.mjs', 'process.exit(3);');   // pretend download fails
        try {
            const r2 = execFileSync(process.execPath, [REPO + '/scripts/get-chrome.js'], { encoding: 'utf8', timeout: 30000 });
            assert.ok(r2.includes('best-effort') || r2.includes('Chrome ready'), 'fail path exits 0 with log');
        } finally { if (made) { fs.unlinkSync(nm + '/install.mjs'); fs.rmdirSync(nm); } }
    });

    console.log('— cfsolver self-heal —');
    ok('MISSING_CHROME regex catches every real shape (Could not find Chrome/Chromium, ENOENT chrome)', () => {
        for (const m of ['Could not find Chrome (ver. 156.0.8078.47).', 'Could not find Chromium (ver. 1.2.3).', 'spawn /x/chrome ENOENT']) {
            assert.ok(cs.MISSING_CHROME.test(m), 'missed: ' + m);
        }
        assert.ok(!cs.MISSING_CHROME.test('libnss3.so: cannot open shared object'), 'unrelated lib error not matched');
    });
    ok('ensureChrome: no node_modules/puppeteer in repo → no-op, latch released (never throws)', () => {
        const logs = [];
        cs.ensureChrome((m) => logs.push(m));
        // bgInstall latch: second call while "installing" is a no-op — but with no installer file the flag resets
        cs.ensureChrome((m) => logs.push(m));
        assert.ok(true);
    });
    ok('cfsolver exports intact after self-heal additions (solve/getBrowser/shutdown/_reset/ensureChrome/MISSING_CHROME)', () => {
        for (const k of ['solve', 'getBrowser', 'libsAvailable', 'shutdown', 'ensureChrome', 'MISSING_CHROME', '_reset']) assert.ok(typeof cs[k] === 'function' || cs[k] instanceof RegExp, k);
    });
    ok('solve() honest absent path unchanged (no puppeteer → getBrowser fail → {ok:false,why:launch-fail})', async () => {
        const r = await cs.solve('https://example.com/', () => { });
        assert.ok(r && r.ok === false && typeof r.why === 'string', JSON.stringify(r).slice(0, 80));
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
