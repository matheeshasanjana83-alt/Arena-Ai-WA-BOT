'use strict';
/**
 * test_v217.js — v2.17.0 offline checks
 *  1. resolvers.js — eporner dload/mp4 → http+referer, video page → yt-dlp kind
 *  2. proxypool.js — addFetched parse/dedupe/cap + stats.fetched
 *  3. net.js — explain() pool hint (.proxies check) on CDN-block + NO_POOL
 *  4. bot.js / all modules load clean
 * Run: node test_v217.js
 */
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ✅', name); }, (e) => { fail++; console.log('  ❌', name, '—', e.message); });

(async () => {
    console.log('v2.17.0 tests\n');

    // 1 ── resolvers: eporner routing
    const { resolve } = require('./resolvers');
    const dload = await resolve('https://www.eporner.com/dload/aICv3nuGtah/240/11710053-240p.mp4');
    await ok('eporner /dload/ → http + referer', () => {
        assert.strictEqual(dload.kind, 'http');
        assert.strictEqual(dload.referer, 'https://www.eporner.com/');
    });
    await ok('eporner direct .mp4 → http + referer', async () => {
        const r = await resolve('https://vid-s11-s50-fr-cdn.eporner.com/x/y/11710053-240p.mp4?dload=1');
        assert.strictEqual(r.kind, 'http');
        assert.strictEqual(r.referer, 'https://www.eporner.com/');
    });
    await ok('eporner video page → kind video (yt-dlp)', async () => {
        const r = await resolve('https://www.eporner.com/video-aICv3nuGtah/some-title/');
        assert.strictEqual(r.kind, 'video');
        assert.strictEqual(r.url.includes('eporner.com'), true);
    });
    await ok('generic link unchanged (http, no referer)', async () => {
        const r = await resolve('https://example.com/file.zip');
        assert.strictEqual(r.kind, 'http');
        assert.ok(!r.referer);
    });

    // 2 ── proxypool: addFetched + stats
    const pool = require('./proxypool');
    const before = pool.stats().total;
    const r1 = `10.${201 + Math.floor(Math.random() * 40)}.${1 + Math.floor(Math.random() * 40)}:8081`;
    const r2 = `10.${201 + Math.floor(Math.random() * 40)}.${1 + Math.floor(Math.random() * 40)}:3129`;
    const expect = [r1, r2, r1, 'not-a-proxy', '# comment'].filter(Boolean).filter((v, i, a) => !pool.isPool(v) && a.indexOf(v) === i).length;
    const added = pool.addFetched([r1, r2, r1, 'not-a-proxy', '# comment'].join('\n'));
    await ok('addFetched: parse + dedupe + junk-skip (+FETCH_MAX cap)', () => {
        const capReached = pool.stats().fetched - added >= 2500;   // fetched map full → nothing added
        assert.strictEqual(added, capReached ? 0 : expect);        // dupe + junk + comment skipped
        assert.strictEqual(pool.stats().total, before + added);
        assert.ok(pool.stats().fetched >= added);
    });
    await ok('addFetched: shipped dedupe (ip already in proxies.txt)', async () => {
        const shipped = require('fs').readFileSync(path.join(__dirname, 'proxies.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
        const n = pool.addFetched(shipped + '\n');
        assert.strictEqual(n, 0);                           // already in all → not re-added
    });
    await ok('ensureReady returns bool (offline-safe)', async () => {
        const r = await pool.ensureReady(1500);
        assert.strictEqual(typeof r, 'boolean');
    });

    // 3 ── net.explain: pool hint on CDN block
    const { explain } = require('./net');
    const err = explain('https://www.eporner.com/dload/x/1-240p.mp4', [
        { kind: 'direct', code: 'UND_ERR_CONNECT_TIMEOUT', msg: 'connect timeout' },
        { kind: 'doh', code: 'UND_ERR_CONNECT_TIMEOUT', msg: 'connect timeout' },
        { kind: 'ipv6', code: 'ETIMEDOUT', msg: 'timeout' },
        { kind: 'poolproxy', code: 'NO_POOL', msg: 'pool' },
    ]);
    await ok('explain: mentions .proxies check + pool line', () => {
        assert.ok(err.message.includes('.proxies check'), 'missing .proxies check hint');
        assert.ok(err.message.includes('Free proxy pool'), 'missing pool line');
        assert.ok(err.message.includes('setproxy'), 'missing setproxy hint');
    });

    // 4 ── modules load
    await ok('bot.js module loads', () => { require('./bot'); });
    await ok('downloader.js + media.js + features.js load', () => {
        require('./downloader'); require('./media'); require('./features');
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
