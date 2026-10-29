/**
 * test_v285.js — 🦊 COOKIE_HELP Firefox + Chrome steps
 * User: 'මෙක හදන්න firefox එකෙන් නෙද' — v2.84 card only said 'F12 → Application → Cookies'
 * (Chrome DevTools; Firefox has NO Application tab — it's Storage → Cookies).
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const tb = require('./terabox');
const pkg = require('./package.json');
const manifest = require('./manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');
const dnSrc = fs.readFileSync('./downloader.js', 'utf8');

(async () => {
    console.log('— v2.85.0 pins —');
    ok('version + manifest + notes + wiring intact', () => {
        assert.ok(['2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '2.95.0', '2.95.0', '2.95.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '2.95.0', '2.95.0', '2.95.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(/FIREFOX/i.test(manifest.notes), 'notes mention Firefox');
        assert.ok(manifest.files.includes('terabox.js') && manifest.files.includes('test_v285.js'), 'files');
        assert.ok(/'\.terabox'/.test(botSrc) && /'\.tbcookie'/.test(botSrc), 'HEAVY lines');
        assert.ok(botSrc.includes('terabox.bridge') && botSrc.includes('terabox.handle') && botSrc.includes('terabox.cmdCookie'), 'router intact');
        assert.ok((dnSrc.match(/tbx\(r/g) || []).length === 4, 'downloader cookie sites x4 intact');
    });

    console.log('— COOKIE_HELP both browsers —');
    ok('exported COOKIE_HELP: Firefox Storage + Chrome Application paths', () => {
        assert.strictEqual(typeof tb.COOKIE_HELP, 'string', 'exported');
        assert.ok(/Firefox: Storage → Cookies/.test(tb.COOKIE_HELP), 'firefox path');
        assert.ok(/Chrome: Application → Cookies/.test(tb.COOKIE_HELP), 'chrome path');
        assert.ok(tb.COOKIE_HELP.includes('F12') && tb.COOKIE_HELP.includes('ndus'), 'F12 + ndus');
        assert.ok(tb.COOKIE_HELP.includes('*.tbcookie <ndus>*'), 'cmd step');
    });

    console.log('— all 3 cards embed the help —');
    ok('infoCard single no-cookie card carries both browsers', () => {
        const c = tb.infoCard({ title: 'T', files: [{ name: 'v.mp4', bytes: 8071052, dlink: '', h: 640, duration: 174 }], hasCookie: false });
        assert.ok(c.includes('Firefox: Storage') && c.includes('Chrome: Application'), c.slice(-220));
    });
    ok('infoCard multi no-cookie list card carries both browsers', () => {
        const c = tb.infoCard({ title: 'Pack', files: [{ name: 'a.mp4', bytes: 1, dlink: '' }, { name: 'b.mp4', bytes: 2, dlink: '' }], hasCookie: false });
        assert.ok(c.includes('Firefox: Storage') && c.includes('Chrome: Application'), c.slice(-220));
    });
    await okA('.tbcookie status card carries both browsers', async () => {
        const sent = [];
        const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
        await tb.cmdCookie(send, 'ff@s', {}, '');
        assert.ok(sent[0].text.includes('Firefox: Storage') && sent[0].text.includes('Chrome: Application'), sent[0].text.slice(-220));
    });

    console.log(`\nv2.85 firefox cookie-help: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
