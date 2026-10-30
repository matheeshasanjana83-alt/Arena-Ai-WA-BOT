/**
 * test_v306.js — 🥷 NPM-SHIPPED CHROMIUM (v3.03.2)
 * Panel truth deepened: v3.03.1 install.mjs "exit 0" twice, yet /.cache/puppeteer/chrome/
 * linux-156.0.8078.47 = EMPTY dir (panel file-list API) — the CDN Chrome download never lands
 * on the panel. v3.03.2 ships the browser from the NPM REGISTRY instead:
 *   @sparticuz/chromium (real Chrome build, self-extracts to /tmp) + puppeteer-core +
 *   puppeteer-extra/stealth via addExtra() — the same channel that installs every bot dep.
 * Sandbox e2e evidence (2026-10-30): sparticuz launch → example.com title OK, UA = real Chrome
 * (no Headless marker) · NEW cfsolver.solve vs animepahe.pw = { ok:false, why:'ip-blocked' }
 * (honest hard-WAF detect through the sparticuz path).
 * ALL OFFLINE (repo has no node_modules — absence paths are exactly what's tested).
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v306_mem.json';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = JSON.parse(fs.readFileSync(REPO + '/package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync(REPO + '/manifest.json', 'utf8'));
const cs = require('../cfsolver');
const solverSrc = fs.readFileSync(REPO + '/cfsolver.js', 'utf8');

(async () => {
    console.log('— v3.03.2 pins —');
    ok('version 3.03.2 pkg+manifest · notes headline · manifest lists test_v306.js + cfsolver.js', () => {
        assert.strictEqual(pkg.version, '3.03.2', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.03.2', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('NPM-SHIPPED CHROMIUM'), 'notes headline');
        assert.ok(manifest.files.includes('tests/test_v306.js') && manifest.files.includes('cfsolver.js'), 'manifest files');
    });
    ok('deps: @sparticuz/chromium + puppeteer-core regular deps · extra/stealth regular · full puppeteer GONE', () => {
        for (const k of ['@sparticuz/chromium', 'puppeteer-core', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth']) assert.ok(pkg.dependencies[k], 'missing dep ' + k);
        assert.ok(!pkg.optionalDependencies || !pkg.optionalDependencies['puppeteer'], 'full puppeteer still optional');
    });
    ok('cfsolver sparticuz PRIMARY: addExtra(puppeteer-core) + stealth use + executablePath + persistent browser latch', () => {
        assert.ok(solverSrc.includes("addExtra(require('puppeteer-core'))"), 'addExtra core');
        assert.ok(solverSrc.includes("require('puppeteer-extra-plugin-stealth')()"), 'stealth used');
        assert.ok(solverSrc.includes('chromium.executablePath()'), 'sparticuz exe');
        assert.ok(solverSrc.includes('@sparticuz/chromium'), 'sparticuz require');
        assert.ok(solverSrc.includes("browser.on('disconnected'"), 'persistent + latch');
    });
    ok('cfsolver FALLBACK retained: full puppeteer ladder on sparticuz failure · dual-fail = honest latch', () => {
        assert.ok(solverSrc.includes('FALLBACK: full puppeteer'), 'fallback marker');
        assert.ok(solverSrc.includes('launch FAIL (sparticuz:'), 'dual-fail log');
        assert.ok(solverSrc.includes('browserFailed = true'), 'latch');
    });
    ok('libsAvailable: sparticuz path first (repo without node_modules → false, never throws)', () => {
        assert.strictEqual(cs.libsAvailable(), false, 'absent libs = false');
    });
    ok('solve() honest path: no browser → { ok:false, why } — never throws, never fakes', async () => {
        const r = await cs.solve('https://example.com/', () => { });
        assert.ok(r && r.ok === false && typeof r.why === 'string' && r.why.length > 0, JSON.stringify(r).slice(0, 80));
    });
    ok('MISSING_CHROME self-heal regex intact (legacy CDN path only) · ensureChrome no-op absent', () => {
        assert.ok(cs.MISSING_CHROME.test('Could not find Chrome (ver. 156.0.8078.47).'), 'match');
        let threw = false;
        try { cs.ensureChrome(() => { }); } catch { threw = true; }
        assert.ok(!threw, 'ensureChrome threw');
    });
    ok('get-chrome.js stays exit-0 legacy no-op (absent puppeteer → log + exit 0)', () => {
        const src = fs.readFileSync(REPO + '/scripts/get-chrome.js', 'utf8');
        assert.ok(src.includes('process.exit(0)'), 'always exit 0');
        const { execFileSync } = require('child_process');
        const out = execFileSync(process.execPath, [REPO + '/scripts/get-chrome.js'], { encoding: 'utf8', timeout: 30000 });
        assert.ok(/puppeteer not installed/.test(out), 'legacy absent log');
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
