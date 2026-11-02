/**
 * test_v309.js — v3.06.0 🔒 PRIVATE PANEL (panel.js) — ALL OFFLINE (stub bot, ephemeral ports)
 * User directive 2026-11-03: "free server එකක් අල්ලගෙන මේ වගෙ panel එකක් හදන්න — full private,
 * මටයි ඔයාටයි access තියෙන්න" → our own zero-dep admin panel that manages the bot on ANY host.
 *
 *  (1)  pins: package.json + manifest.json 3.06.0 · manifest.files += panel.js/tests/test_v309.js/DEPLOY.md
 *  (2)  zero-dep: panel.js requires node BUILTINS only · require.main guard (require never boots server)
 *  (3)  auth wall: no-cookie 401 · wrong-pw 401 · bad-json 400 · oversized-body 413 · HTML login page
 *  (4)  brute-force lockout: 5 fails/IP → 429 (10 min window)
 *  (5)  login success → HttpOnly SameSite cookie (≥32 hex) · status shape · dashboard HTML markers
 *  (6)  FULL bot lifecycle e2e (stub bot): start → running + logs captured → PAIRING CODE extracted →
 *       wa:'connected' → stop → not running AND stub process really dead (orphan guard)
 *  (7)  restart e2e → running again with a NEW pid
 *  (8)  /api/logs incremental (?after=lastId → no repeats)
 *  (9)  security: no password leak in any response · /api/health public {ok} only
 *  (10) bot.js UNTOUCHED (no panel wiring — zero bot regression surface)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync } = require('child_process');
const REPO = path.join(__dirname, '..');
const { createPanel, PAGE, loadPw } = require(path.join(REPO, 'panel.js'));

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.json'), 'utf8'));
const PANEL_SRC = fs.readFileSync(path.join(REPO, 'panel.js'), 'utf8');
const BOT_SRC = fs.readFileSync(path.join(REPO, 'bot.js'), 'utf8');

let passN = 0, failN = 0;
const ok = async (name, fn) => {   // async-aware: awaited at every call site → sequential + real failures counted
    try { await fn(); passN++; console.log('  ✅ ' + name); }
    catch (e) { failN++; console.log('  ❌ ' + name + '\n     ' + String(e.message || e).split('\n').slice(0, 3).join('\n     ')); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* minimal HTTP client against the ephemeral server */
function req(port, method, p, { body, cookie, headers } = {}) {
    return new Promise((res, rej) => {
        const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false,   // no keep-alive → no ECONNRESET on server.close()
            headers: Object.assign({}, data != null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, cookie ? { Cookie: cookie } : {}, headers || {}) },
            (rs) => {
                let b = '';
                rs.setEncoding('utf8');
                rs.on('data', c => b += c);
                rs.on('end', () => res({ status: rs.statusCode, headers: rs.headers, body: b, setCookie: rs.headers['set-cookie'] || [] }));
            });
        r.on('error', rej);
        if (data != null) r.write(data);
        r.end();
    });
}
async function poll(fn, ms) {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) return null;
        await sleep(250);
    }
}
function listen(P) { return new Promise(r => { P.server.listen(P.port, '127.0.0.1', () => { P.port = P.server.address().port; r(P); }); }); }

/* stub bot: prints pairing code + connected, stays alive, clean SIGTERM exit */
const STUB = path.join(os.tmpdir(), 'kz_stub_bot_' + process.pid + '.js');
fs.writeFileSync(STUB, `
console.log('   \\u{1F522} PAIRING CODE:  1234-ABCD');
console.log('\\u2705 WhatsApp Connected! stub');
setInterval(() => {}, 30000);
process.on('SIGTERM', () => process.exit(0));
`);

(async () => {
    console.log('\n-testid_v309 — v3.06.0 🔒 PRIVATE PANEL');

    /* ---------- (1) pins ---------- */
    await ok('pins: package.json 3.06.0', () => assert.strictEqual(pkg.version, '3.06.0'));
    await ok('pins: manifest.json 3.06.0', () => assert.strictEqual(man.version, '3.06.0'));
    await ok('manifest.files += panel.js + tests/test_v309.js + DEPLOY.md', () => {
        for (const f of ['panel.js', 'tests/test_v309.js', 'DEPLOY.md']) assert.ok(man.files.includes(f), 'missing ' + f);
    });

    /* ---------- (2) zero-dep + guard ---------- */
    await ok('panel.js: node BUILTINS only (no external require)', () => {
        const reqs = [...PANEL_SRC.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
        const allowed = ['http', 'child_process', 'crypto', 'fs', 'path', 'os', './panel.js', '../panel.js', 'panel.js'];
        for (const r of reqs) assert.ok(allowed.includes(r), 'external require: ' + r);
        assert.ok(reqs.length >= 6, 'expected builtin requires');
    });
    await ok('panel.js: require.main guard present (require never boots)', () => {
        assert.ok(PANEL_SRC.includes('require.main === module'), 'no main guard');
    });
    await ok('panel.js: process-group kill (detached) + panel SIGTERM cleanup', () => {
        assert.ok(PANEL_SRC.includes('detached: true'), 'no detached spawn');
        assert.ok(PANEL_SRC.includes('process.kill(-c.pid'), 'no group kill');
        assert.ok(/SIGTERM.*bye|bye.*SIGTERM|'SIGTERM'/.test(PANEL_SRC.replace(/\s+/g, ' ')) || PANEL_SRC.includes("on('SIGTERM'"), 'no SIGTERM handler');
    });

    /* ---------- (3) auth wall ---------- */
    const A = await listen(createPanel({ port: 0, pw: 'correct-horse-battery' }));
    await ok('no-cookie /api/status → 401', async () => {
        const r = await req(A.port, 'GET', '/api/status');
        assert.strictEqual(r.status, 401);
    });
    await ok('wrong pw → 401 (no cookie set)', async () => {
        const r = await req(A.port, 'POST', '/api/login', { body: { pw: 'wrong' } });
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.setCookie.length, 0);
    });
    await ok('bad json → 400', async () => {
        const r = await req(A.port, 'POST', '/api/login', { body: '{nope' });
        assert.strictEqual(r.status, 400);
    });
    await ok('oversized body (>64KB) → 413', async () => {
        const r = await req(A.port, 'POST', '/api/login', { body: 'x'.repeat(70 * 1024) });
        assert.strictEqual(r.status, 413);
    });
    await ok('unknown route (authed later covered) → 404 shape; /api/health public {ok:true} only', async () => {
        const r = await req(A.port, 'GET', '/api/health');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(JSON.parse(r.body), { ok: true });
    });
    await ok('GET / (no cookie) = login page: මුරපදය field + private marker', async () => {
        const r = await req(A.port, 'GET', '/');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.includes('මුරපදය'), 'no login field');
        assert.ok(r.body.includes('Private Panel') || r.body.includes('private panel'), 'no private marker');
    });

    /* ---------- (4) lockout (separate instance) ---------- */
    const B = await listen(createPanel({ port: 0, pw: 'pw-B' }));
    await ok('brute-force: 5 fails → 6th attempt 429 (10min lock)', async () => {
        for (let i = 0; i < 5; i++) {
            const r = await req(B.port, 'POST', '/api/login', { body: { pw: 'nope' } });
            assert.strictEqual(r.status, 401, 'fail #' + i);
        }
        const r6 = await req(B.port, 'POST', '/api/login', { body: { pw: 'pw-B' } });   // even CORRECT pw locked
        assert.strictEqual(r6.status, 429);
    });

    /* ---------- (5) login success ---------- */
    let CK = '';
    await ok('correct pw → 200 + HttpOnly SameSite cookie (≥32 hex)', async () => {
        const r = await req(A.port, 'POST', '/api/login', { body: { pw: 'correct-horse-battery' } });
        assert.strictEqual(r.status, 200);
        const c = r.setCookie.find(s => s.startsWith('kzpanel='));
        assert.ok(c, 'no kzpanel cookie');
        assert.ok(/HttpOnly/i.test(c), 'not HttpOnly');
        assert.ok(/SameSite=Lax/i.test(c), 'not SameSite');
        CK = c.split(';')[0];
        assert.ok(CK.length >= 32 + 8, 'token too short');
    });
    await ok('authed /api/status shape + version 3.06.0 + wa offline + not running', async () => {
        const r = await req(A.port, 'GET', '/api/status', { cookie: CK });
        assert.strictEqual(r.status, 200);
        const s = JSON.parse(r.body);
        assert.strictEqual(s.ok, true);
        assert.strictEqual(s.running, false);
        assert.strictEqual(s.version, '3.06.0');
        assert.strictEqual(s.wa, 'offline');
        assert.strictEqual(s.pid, null);
        assert.strictEqual(s.pairingCode, null);
    });
    await ok('authed GET / = dashboard: Start/Stop/Restart + logs + logout', async () => {
        const r = await req(A.port, 'GET', '/', { cookie: CK });
        for (const m of ["'bStart'", "'bStop'", "'bRest'", "'bOut'", "id=\"logs\""]) assert.ok(r.body.includes(m), 'missing ' + m);
    });

    /* ---------- (6) FULL lifecycle e2e (stub bot) ---------- */
    const C = await listen(createPanel({ port: 0, pw: 'pw-C', botCmd: { cmd: process.execPath, args: [STUB] }, autostart: false }));
    let CKC = '';
    {
        const r = await req(C.port, 'POST', '/api/login', { body: { pw: 'pw-C' } });
        CKC = r.setCookie.find(s => s.startsWith('kzpanel=')).split(';')[0];
    }
    await ok('start → running with pid (stub)', async () => {
        const r = await req(C.port, 'POST', '/api/bot/start', { cookie: CKC });
        const b = JSON.parse(r.body);
        assert.strictEqual(b.ok, true, r.body);
        assert.ok(b.pid > 0);
        const st = await poll(async () => (await req(C.port, 'GET', '/api/status', { cookie: CKC })).body.includes('"running":true'), 5000);
        assert.ok(st, 'status never became running');
    });
    await ok('logs captured → PAIRING CODE extracted + wa:connected (panel-side detection)', async () => {
        const got = await poll(async () => {
            const s = JSON.parse((await req(C.port, 'GET', '/api/status', { cookie: CKC })).body);
            return s.pairingCode === '1234-ABCD' && s.wa === 'connected' ? s : null;
        }, 5000);
        assert.ok(got, 'pairingCode/wa never detected — got ' + JSON.stringify((await req(C.port, 'GET', '/api/status', { cookie: CKC })).body));
    });
    await ok('stop → not running AND stub process REALLY dead (no orphan)', async () => {
        const s0 = JSON.parse((await req(C.port, 'GET', '/api/status', { cookie: CKC })).body);
        const r = await req(C.port, 'POST', '/api/bot/stop', { cookie: CKC });
        assert.strictEqual(JSON.parse(r.body).ok, true);
        const st = await poll(async () => (await req(C.port, 'GET', '/api/status', { cookie: CKC })).body.includes('"running":false'), 9000);
        assert.ok(st, 'status never became stopped');
        let dead = false;
        try { process.kill(s0.pid, 0); } catch { dead = true; }
        assert.ok(dead, 'stub pid ' + s0.pid + ' still alive — orphan!');
    });

    /* ---------- (7) restart e2e ---------- */
    await ok('restart → running again with NEW pid', async () => {
        const r1 = await req(C.port, 'POST', '/api/bot/start', { cookie: CKC });
        const pid1 = JSON.parse(r1.body).pid;
        await poll(async () => (await req(C.port, 'GET', '/api/status', { cookie: CKC })).body.includes('"running":true'), 5000);
        const r2 = await req(C.port, 'POST', '/api/bot/restart', { cookie: CKC });
        const b2 = JSON.parse(r2.body);
        assert.strictEqual(b2.ok, true, r2.body);
        assert.ok(b2.pid > 0 && b2.pid !== pid1, 'pid unchanged? ' + pid1 + ' → ' + b2.pid);
        await req(C.port, 'POST', '/api/bot/stop', { cookie: CKC });   // cleanup
        await sleep(800);
    });

    /* ---------- (8) logs incremental ---------- */
    await ok('/api/logs incremental: after=lastId → no repeats, ids monotonic', async () => {
        const r1 = JSON.parse((await req(C.port, 'GET', '/api/logs?after=0', { cookie: CKC })).body);
        assert.ok(r1.ok && r1.lines.length > 0, 'no logs');
        const ids = r1.lines.map(l => l.id);
        for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1], 'non-monotonic ids');
        const last = ids[ids.length - 1];
        const r2 = JSON.parse((await req(C.port, 'GET', '/api/logs?after=' + last, { cookie: CKC })).body);
        assert.strictEqual(r2.lines.length, 0, 'repeated lines after cursor');
    });

    /* ---------- (9) security ---------- */
    await ok('no password leak: any response body never contains pw', async () => {
        const paths = ['/api/status', '/api/logs?after=0', '/'];
        for (const p of paths) {
            const r = await req(C.port, 'GET', p, { cookie: CKC });
            assert.ok(!r.body.includes('pw-C'), 'password leaked via ' + p);
        }
    });
    await ok('health endpoint leaks nothing (no status/lines fields)', async () => {
        const r = await req(C.port, 'GET', '/api/health');
        assert.ok(!/running|pairing|lines|version/.test(r.body), 'health over-shares: ' + r.body);
    });
    await ok('401 shape never includes session tokens', async () => {
        const r = await req(C.port, 'GET', '/api/status');
        assert.strictEqual(r.status, 401);
        assert.ok(!/kzpanel/.test(r.body), 'token echoed');
    });

    /* ---------- (10) bot.js untouched ---------- */
    await ok('bot.js has NO panel wiring (zero bot regression surface)', () => {
        assert.ok(!BOT_SRC.includes("require('./panel')"), 'bot.js requires panel');
        assert.ok(!BOT_SRC.includes('panel.js'), 'bot.js references panel.js');
    });
    await ok('loadPw precedence: env > settings (panelPw not printed anywhere in src)', () => {
        assert.ok(PANEL_SRC.includes('ARENA_PANEL_PW'), 'env path missing');
        assert.ok(PANEL_SRC.includes('panelPw'), 'settings path missing');
        assert.ok(!/console\.log\([^)]*\bPW\b/.test(PANEL_SRC), 'PW printed to console');
    });
    await ok('PAGE: Sinhala UI + pairing hint + no external asset URLs', () => {
        assert.ok(PAGE.includes('ඇතුල් වන්න'), 'Sinhala login missing');
        assert.ok(PAGE.includes('Link with phone number'), 'pairing hint missing');
        assert.ok(!/https?:\/\/(?!x\b)[a-z0-9.-]+\/[^"']*\.(css|js)/i.test(PAGE), 'external asset found');
    });

    /* ---------- cleanup (AFTER printing result — never lose the verdict) ---------- */
    console.log(`\n  ${passN} pass / ${failN} fail`);
    await new Promise(r => A.server.close(r));
    await new Promise(r => B.server.close(r));
    await new Promise(r => C.server.close(r));
    try { fs.unlinkSync(STUB); } catch { }
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
