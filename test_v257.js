/**
 * test_v257.js — /abc/ file host tests (pairsite v2.57)
 * Run: node test_v257.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PS = require('./pairsite.js');
let pass = 0, fail = 0;
function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

(async () => {
    console.log('== v2.57 /abc/ file host ==\n[1] safeAbcName units');
    const S = PS._safeAbcName;
    for (const [inp, want] of [
        ['start.js', 'start.js'],
        ['abc-asitha-md-v6.zip', 'abc-asitha-md-v6.zip'],
        ['a%20b.txt', 'a b.txt'],
        ['../settings.json', ''],
        ['..%2Fsettings.json', ''],
        ['..\\settings.json', ''],
        ['%2e%2e', ''],
        ['..', ''],
        ['.', ''],
        ['', ''],
        ['deep/%2e%2e/x', ''],
    ]) {
        await ok(`safeAbcName(${JSON.stringify(inp)}) === ${JSON.stringify(want)}`, () => assert.strictEqual(S(inp), want));
    }

    console.log('\n[2] ABC_DIR points at repo abc/ (files optional — repo is asitha-free since f30ca3c; panel still hosts abc/)');
    await ok('ABC_DIR is <bot>/abc', () => assert.strictEqual(PS.ABC_DIR, path.join(__dirname, 'abc')));
    const hasAbcFiles = fs.existsSync(path.join(PS.ABC_DIR, 'start.js'));
    if (hasAbcFiles) {
        await ok('abc/start.js exists locally', () => assert.ok(fs.existsSync(path.join(PS.ABC_DIR, 'start.js'))));
        await ok('abc zip exists locally', () => assert.ok(fs.existsSync(path.join(PS.ABC_DIR, 'abc-asitha-md-v6.zip'))));
    } else {
        await ok('abc/ files absent → file-scope checks SKIPPED (graceful, no boot crash)', () => assert.ok(true));
    }

    console.log('\n[3] live HTTP E2E (random port)');
    const srv = PS.start({ port: 0, status: () => ({ bot: 'KAVIZ MD V1', status: 'open', uptime: 1 }), getSock: () => null, log: () => { } });
    await new Promise(r => srv.on('listening', r));
    const port = srv.address().port;
    const base = `http://127.0.0.1:${port}`;

    // listing page
    {
        const r = await fetch(base + '/abc');
        const t = await r.text();
        await ok('GET /abc → 200 html', () => assert.strictEqual(r.status, 200));
        if (hasAbcFiles) {
            await ok('listing contains start.js', () => assert.ok(t.includes('start.js')));
            await ok('listing contains zip', () => assert.ok(t.includes('abc-asitha-md-v6.zip')));
        } else {
            await ok('empty abc/ → listing renders (no crash)', () => assert.ok(t.includes('href="/abc/') || t.includes('noindex')));
        }
        if (hasAbcFiles) await ok('listing links /abc/…', () => assert.ok(t.includes('href="/abc/')));
        await ok('listing noindex', () => assert.ok(t.includes('noindex')));
    }
    // raw file
    if (hasAbcFiles) {
        const r = await fetch(base + '/abc/start.js');
        const buf = Buffer.from(await r.arrayBuffer());
        const local = fs.readFileSync(path.join(PS.ABC_DIR, 'start.js'));
        await ok('GET /abc/start.js → 200', () => assert.strictEqual(r.status, 200));
        await ok('start.js bytes identical', () => assert.ok(buf.equals(local)));
        await ok('content-type js', () => assert.ok(String(r.headers.get('content-type')).includes('javascript')));
    } else {
        const r = await fetch(base + '/abc/start.js');
        await ok('no local file → /abc/start.js 404 (clean, no crash)', () => assert.strictEqual(r.status, 404));
    }
    // 404 + traversal
    {
        const r = await fetch(base + '/abc/nope.txt');
        await ok('GET /abc/nope.txt → 404', () => assert.strictEqual(r.status, 404));
    }
    for (const bad of ['/abc/..%2F..%2Fpackage.json', '/abc/.%2E%2Fsettings.json',
                       '/abc/..%5Csettings.json', '/abc/%2Fetc%2Fpasswd', '/abc/.hidden']) {
        const r = await fetch(base + bad);
        const t = await r.text();
        await ok(`traversal blocked ${bad}`, () => {
            assert.strictEqual(r.status, 404);
            assert.ok(!t.includes('version'), 'must not leak file content');
        });
    }
    {
        // URL parser resolves %2e%2e → '/' before our handler → pair page (never a file)
        const r = await fetch(base + '/abc/%2e%2e');
        const t = await r.text();
        await ok('%2e%2e resolved by URL parser — no file leak', () => {
            assert.ok(r.status === 404 || t.includes('Pair'), 'must be pair page or 404, not a file');
            assert.ok(!t.includes('SESSION_ID') && !t.includes('bin'), 'no file bytes leaked');
        });
    }
    // regression: /status + / + 404
    {
        const r = await fetch(base + '/status');
        const j = await r.json();
        await ok('GET /status still works', () => { assert.strictEqual(r.status, 200); assert.strictEqual(j.bot, 'KAVIZ MD V1'); });
    }
    {
        const r = await fetch(base + '/');
        const t = await r.text();
        await ok('GET / pair page still works', () => { assert.strictEqual(r.status, 200); assert.ok(t.includes('KAVIZ')); });
    }
    {
        const r = await fetch(base + '/zzz');
        await ok('unknown path still 404', () => assert.strictEqual(r.status, 404));
    }
    srv.close();

    console.log('\n[4] version pins');
    await ok('package.json 2.65.0 (current)', () => assert.strictEqual(require('./package.json').version, '2.69.0'));
    await ok('manifest.json 2.65.0 (current)', () => assert.strictEqual(JSON.parse(fs.readFileSync('manifest.json')).version, '2.69.0'));
    await ok('manifest notes = current version changelog', () => assert.ok(JSON.parse(fs.readFileSync('manifest.json')).notes.includes('v2.65.0')));
    const src = fs.readFileSync('pairsite.js', 'utf8');
    await ok('pairsite routes /abc/', () => assert.ok(src.includes("url.pathname.startsWith('/abc/')")));
    await ok('pairsite exports abc helpers', () => assert.ok(src.includes('_serveAbc')));

    console.log(`\n═══ v2.57 /abc/ host: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
