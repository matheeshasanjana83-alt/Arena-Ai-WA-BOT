/**
 * test_v304.js — 🥷 CF STEALTH SOLVER LADDER (v3.03.2)
 * User directive (2026-10-30): "වැඩි කල් පවතින ක්‍රමය: Puppeteer + Stealth" — real stealth Chrome
 * solves the Cloudflare wall, cf_clearance (IP+UA-bound) + its exact UA are cached and reused with
 * plain fetch. cfsolver.js holds ALL puppeteer code (lazy require — absent install = honest wall).
 * LIVE EVIDENCE (sandbox): cfsolver.solve vs real animepahe.pw wall = { ok:false, why:'ip-blocked',
 * status:403 } in 658ms — hard WAF block honestly detected, never faked. Panel verdict = boot log
 * ([ANIMEPAHE] stealth SOLVE OK / FAILED).
 * Tested here (ALL OFFLINE — solver stub injected via setSolver, mock fetcher):
 *  (1) pins 3.03.2 · optionalDependencies (puppeteer/extra/stealth) · cfsolver source markers
 *  (2) FULL ladder e2e: 403 CF → solve → retry with Cookie+exact-UA → 200 JSON → search card
 *  (3) cookie cache: second wall uses cached clearance, solver NOT called again (RAM guard)
 *  (4) honest fallbacks: solver ABSENT → wall card · solver throws → wall card · non-CF 403 → plain HTTP error, solver untouched
 *  (5) RAM guards: solve cooldown (≤1/90s) · fail give-up (5 fails → 15min backoff) · backoff expiry re-tries
 *  (6) resolveDirect pahe.win POST reuses cached clearance (Cookie + UA on the POST)
 *  (7) typo aliases .anemepahe/.animepahae handled
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v304_mem.json';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = JSON.parse(fs.readFileSync(REPO + '/package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync(REPO + '/manifest.json', 'utf8'));
const ap = require('../animepahe');
const solverSrc = fs.readFileSync(REPO + '/cfsolver.js', 'utf8');

const RESP = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: () => null, getSetCookie: () => [] }, text: async () => body });
const SEARCH_JSON = JSON.stringify({ data: [{ session: 'YW5pbWU=', slug: 'solo-leveling', title: 'Solo Leveling', poster: '', type: 'TV', episodes: 12, year: 2024 }] });

/* mock world */
let solveCalls = 0;
const SOLVER_OK = async () => { solveCalls++; return { ok: true, cookie: 'cf_clearance=T0K304', ua: 'TestStealthUA/1.0' }; };
let MODE = {};
const CALLS = [];
const mockFetch = (u, o = {}) => {
    const url = String(u);
    CALLS.push({ url: url.slice(0, 70), cookie: !!(o.headers && o.headers.Cookie), ua: (o.headers && o.headers['User-Agent']) || '' });
    if (MODE.cf403 && !o.headers?.Cookie) return RESP('<html>Attention Required | Cloudflare</html>', 403);
    if (url.includes('m=search')) return RESP(SEARCH_JSON);
    if (url.includes('m=release')) return RESP(JSON.stringify({ last_page: 1, data: [{ session: 'epA', episode: 1, audio: 'jpn' }] }));
    if (url.includes('/play/')) return RESP('<title>Solo Leveling 1</title><div id="pickDownload"><a href="https://pahe.win/a/?t=1">SubsPlease &middot; 1080p (1.3GB) &middot; eng</a></div>');
    if (url.includes('pahe.win')) return RESP('<title>Solo Leveling - 1</title><form method="POST" action="https://pahe.win/dl/T0K"><input name="_token" value="tk"></form>');
    return RESP('{}');
};
ap.setFetcher(mockFetch);

const mkCtx = () => {
    const sent = [];
    const send = async (jid, content) => { if (content && content.delete) return { key: { id: 'd' } }; const id = 'c' + (sent.length + 1); sent.push({ jid, content, id }); return { key: { id, remoteJid: jid } }; };
    return { sent, send, downloads: [], download: async (l, t) => { }, jid: '94724768017@s.whatsapp.net', msg: { key: { id: 'm1' } }, react: async () => { } };
};
const last = (c) => c.sent[c.sent.length - 1].content.text || '';
const JID = '94724768017@s.whatsapp.net';
const resetState = () => { ap._cfCache.clear(); ap._cfTest({ failStreak: 0, lastSolveAt: 0, lastFailAt: 0 }); };

(async () => {
    console.log('— v3.03.2 pins & markers —');
    ok('version 3.03.2 pkg+manifest · notes headline · manifest lists cfsolver.js + test_v304.js', () => {
        assert.strictEqual(pkg.version, '3.03.2', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.03.2', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('CF STEALTH SOLVER'), 'notes headline');
        assert.ok(manifest.files.includes('cfsolver.js') && manifest.files.includes('tests/test_v304.js'), 'manifest files');
    });
    ok('package.json deps: @sparticuz/chromium + puppeteer-core + puppeteer-extra + stealth (npm-registry browser — CDN chrome dropped)', () => {
        const od = pkg.optionalDependencies || {};
        for (const k of ['@sparticuz/chromium', 'puppeteer-core', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth']) assert.ok(pkg.dependencies[k], 'dependency missing ' + k);
        assert.ok(!od['puppeteer'], 'full puppeteer (CDN chrome) dropped from optional');
    });
    ok('cfsolver.js markers: lazy require · ip-blocked honest detect · persistent browser · launch-fail no-throw · _reset', () => {
        assert.ok(solverSrc.includes("require('puppeteer-extra')"), 'lazy require');
        assert.ok(solverSrc.includes("why: 'ip-blocked'") || solverSrc.includes("return { ok: false, why: 'ip-blocked'"), 'ip-blocked');
        assert.ok(solverSrc.includes('browserFailed = true'), 'launch-fail latch');
        assert.ok(solverSrc.includes('browser.on'), 'disconnected latch');
        assert.ok(solverSrc.includes('module.exports = { solve'), 'exports');
        assert.ok(!/require\('puppeteer'\)/.test(fs.readFileSync(REPO + '/bot.js', 'utf8')), 'bot.js never requires puppeteer directly');
    });
    ok('healthCheck v3.03 markers: stealth SOLVE OK / FAILED honest boot log + ARENA_APHE_SOLVER kill-switch', () => {
        const src = fs.readFileSync(REPO + '/animepahe.js', 'utf8');
        assert.ok(src.includes('stealth SOLVE OK'), 'solve-ok log');
        assert.ok(src.includes('stealth solve failed'), 'solve-fail log');
        assert.ok(src.includes("process.env.ARENA_APHE_SOLVER === '0'"), 'kill-switch');
    });

    console.log('— FULL ladder e2e —');
    await okA('403 CF → stealth solve → retry with Cookie+exact-UA → 200 JSON → search card', async () => {
        resetState();
        ap.setSolver({ solve: SOLVER_OK }); solveCalls = 0; MODE = { cf403: true }; CALLS.length = 0;
        ap._sessions.delete(JID);
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: ['solo'] });
        assert.ok(solveCalls === 1, 'solver called once, got ' + solveCalls);
        assert.ok(CALLS.some((c) => c.cookie && c.ua === 'TestStealthUA/1.0'), 'retry carried Cookie + solved UA');
        assert.ok(last(ctx).includes('Solo Leveling'), 'search card after unblock');
        assert.ok(ap._cfCache.get('animepahe.pw'), 'clearance cached');
    });
    await okA('cache hit: second wall reuses clearance — solver NOT called again', async () => {
        MODE = { cf403: true }; solveCalls = 0; CALLS.length = 0;
        ap._sessions.delete(JID);
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: ['solo'] });
        assert.ok(solveCalls === 0, 'no new solve (cache hit)');
        assert.ok(CALLS.some((c) => c.cookie), 'fetch still carried the cached cookie');
        assert.ok(last(ctx).includes('Solo Leveling'), 'works from cache');
    });

    console.log('— honest fallbacks —');
    await okA('solver ABSENT → honest wall card (never fake)', async () => {
        resetState();
        ap.setSolver(false);   // false = absent (getSolver → null)
        ap._sessions.delete(JID);
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: ['solo'] });
        assert.ok(last(ctx).includes('bot-traffic wall'), 'wall card: ' + last(ctx).slice(0, 90));
    });
    await okA('solver THROWS → honest wall card', async () => {
        resetState();
        ap.setSolver({ solve: async () => { throw new Error('boom'); } });
        ap._sessions.delete(JID);
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: ['solo'] });
        assert.ok(last(ctx).includes('bot-traffic wall'), 'wall card');
    });
    await okA('non-CF 403 → plain HTTP error, solver untouched', async () => {
        resetState();
        ap.setSolver({ solve: SOLVER_OK }); solveCalls = 0; MODE = {};
        ap.setFetcher(async () => RESP('<html>normal 403 page</html>', 403));
        try {
            await assert.rejects(() => ap.clearance === null ? Promise.resolve() : ap.resolveDirect('https://pahe.win/x/1'), (e) => /HTTP 403/.test(e.message) || /form එක/.test(e.message));
        } finally { ap.setFetcher(mockFetch); }
        assert.ok(solveCalls === 0, 'no solve on non-CF 403');
    });

    console.log('— RAM guards —');
    await okA('solve cooldown: within 90s of a solve → null without calling solver', async () => {
        resetState();
        ap._cfTest({ lastSolveAt: Date.now() });
        ap.setSolver({ solve: SOLVER_OK }); solveCalls = 0;
        const c = await ap.clearance('animepahe.pw');
        assert.strictEqual(c, null, 'cooldown null');
        assert.ok(solveCalls === 0, 'solver untouched');
    });
    await okA('fail give-up: 5 fails → 15min backoff, no browser churn', async () => {
        resetState();
        ap._cfTest({ failStreak: 5, lastFailAt: Date.now() });
        ap.setSolver({ solve: SOLVER_OK }); solveCalls = 0;
        assert.strictEqual(await ap.clearance('animepahe.pw'), null, 'give-up null');
        assert.ok(solveCalls === 0, 'no solve call');
    });
    await okA('backoff expiry: failStreak 5 but 16min old → solve retried, success resets streak', async () => {
        resetState();
        ap._cfTest({ failStreak: 5, lastFailAt: Date.now() - 16 * 60e3 });
        ap.setSolver({ solve: SOLVER_OK }); solveCalls = 0;
        const c = await ap.clearance('animepahe.pw');
        assert.ok(c && c.cookie === 'cf_clearance=T0K304', 'retried + cached');
        assert.strictEqual(ap._cfTest().failStreak, 0, 'streak reset');
    });

    console.log('— resolveDirect POST clearance reuse —');
    await okA('pahe.win POST carries cached Cookie + solved UA', async () => {
        resetState();
        ap.setSolver({ solve: SOLVER_OK });
        await ap.clearance('pahe.win');   // warm cache for pahe.win host
        let captured = null;
        const realFetch = global.fetch;
        global.fetch = async (u, o = {}) => { captured = o.headers; return { status: 302, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? 'https://cdn.pahe.win/f.mkv' : null) }, text: async () => '' }; };
        try { await ap.resolveDirect('https://pahe.win/a/?t=1'); } finally { global.fetch = realFetch; }
        assert.ok(captured.Cookie && captured.Cookie.includes('cf_clearance=T0K304'), 'POST Cookie: ' + captured.Cookie);
        assert.strictEqual(captured['User-Agent'], 'TestStealthUA/1.0', 'POST UA = solved UA');
    });

    console.log('— typo aliases —');
    await okA('.anemepahe / .animepahae (user typos) route to the same flow', async () => {
        resetState(); MODE = {};
        ap.setSolver(false);
        for (const cmd of ['.anemepahe', '.animepahae']) {
            ap._sessions.delete(JID);
            const ctx = mkCtx();
            assert.strictEqual(await ap.handle(cmd, { ...ctx, rest: ['solo'] }), true, cmd + ' handled');
            assert.ok(last(ctx).includes('AnimePahe'), cmd + ' branded card');
        }
    });

    ap.setSolver(null);   // restore lazy
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
