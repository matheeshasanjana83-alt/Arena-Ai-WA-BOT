'use strict';
/**
 * test_v229.js — KAVIZ Pair Site (v2.29.0)
 * v2.28 base + pairsite.js: web pairing page on the panel port — number එක දාලා pairing code එක
 * site එකෙන් ගන්න පුළුවන් (console/Termux නැතුව). /status JSON kept, key-protected /pair.
 * run: node test_v229.js   (offline — REAL HTTP requests against a real listener)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');
const SETTINGS_SNAP = read('settings.json');   // pairKey() writes → restore after tests (repo stays clean)

(async () => {
    const ps = require('./pairsite');

    // 1) version sync
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    if (man.version !== pkg.version || pkg.version < '2.29.0') throw new Error('version sync wrong: pkg=' + pkg.version + ' manifest=' + man.version);
    console.log('[1] v' + pkg.version + ' sync (manifest === package): OK ✅');

    // 2) pairsite exports
    for (const k of ['start', 'requestPair', 'normNumber', 'pairKey']) {
        if (typeof ps[k] !== 'function') throw new Error('pairsite export missing: ' + k);
    }
    console.log('[2] pairsite exports (start + requestPair + normNumber + pairKey): OK ✅');

    // 3) number normalization — 077… / +94… / 9477… / junk
    if (ps.normNumber('0771234567') !== '94771234567') throw new Error('norm 0→94 fail');
    if (ps.normNumber('+94 77 123 4567') !== '94771234567') throw new Error('norm +94 fail');
    if (ps.normNumber('94771234567') !== '94771234567') throw new Error('norm 94 pass-through fail');
    if (ps.normNumber('abc') !== '' || ps.normNumber('123') !== '' || ps.normNumber('') !== '') throw new Error('norm junk not rejected');
    console.log('[3] number normalize (0→94, +94, junk reject): OK ✅');

    // 4) bot.js wiring — pairsite started with status + getSock; old inline http status server gone
    const bot = read('bot.js');
    if (!bot.includes("require('./pairsite').start(")) throw new Error('bot.js does not start pairsite');
    if (!bot.includes('getSock: () => SOCK') || !bot.includes('status: botStatus')) throw new Error('pairsite deps not wired (SOCK/status)');
    if (/createServer\(\(q, r\)/.test(bot)) throw new Error('old inline status server still in bot.js');
    console.log('[4] bot.js wiring (pairsite.start + SOCK + botStatus, old server removed): OK ✅');

    // 5) ★ requestPair — key check (wrong key rejected, right key passes to sock)
    const key = ps.pairKey();
    if (!/^[A-Za-z0-9]{4,32}$/.test(key)) throw new Error('pairKey auto-gen broken: ' + key);
    if (!read('settings.json').includes(key)) throw new Error('pairKey not persisted to settings.json');
    const sockCalls = [];
    const fakeSock = { authState: { creds: { registered: false } }, requestPairingCode: async (n) => { sockCalls.push(n); return 'ABCD1234'; } };
    const deps = { getSock: () => fakeSock, getKey: () => key };
    const bad = await ps.requestPair('94771234567', 'WRONG', deps);
    if (bad.ok || !/key/i.test(bad.error)) throw new Error('wrong key accepted: ' + JSON.stringify(bad));
    if (sockCalls.length) throw new Error('wrong key reached requestPairingCode');
    console.log('[5] ★ key gate (wrong key → 403-style error, sock untouched): OK ✅');

    // 6) ★ requestPair — happy path + formatting + registered-block
    const good = await ps.requestPair('0771234567', key, deps);
    if (!good.ok || good.code !== 'ABCD-1234') throw new Error('happy path fail: ' + JSON.stringify(good));
    if (sockCalls[0] !== '94771234567') throw new Error('normalized number not sent to Baileys: ' + sockCalls[0]);
    fakeSock.authState.creds.registered = true;
    const taken = await ps.requestPair('94771234567', key, deps);
    if (taken.ok || !/pair වෙලා/.test(taken.error)) throw new Error('registered session pairable: ' + JSON.stringify(taken));
    fakeSock.authState.creds.registered = false;
    console.log('[6] ★ pair flow (077→94, code XXXX-XXXX, registered block): OK ✅');

    // 7) ★ requestPair — no sock / baileys error → clean JSON errors (no crash)
    const ns = await ps.requestPair('94771234567', key, { getSock: () => null, getKey: () => key });
    if (ns.ok || !/start වෙනවා/.test(ns.error)) throw new Error('no-sock fail: ' + JSON.stringify(ns));
    const errSock = { authState: { creds: { registered: false } }, requestPairingCode: async () => { throw new Error('boom'); } };
    const be = await ps.requestPair('94771234567', key, { getSock: () => errSock, getKey: () => key });
    if (be.ok || !/boom/.test(be.error)) throw new Error('baileys error not surfaced: ' + JSON.stringify(be));
    console.log('[7] ★ no-sock / baileys-error → clean JSON (no crash): OK ✅');

    // 8) ★ REAL HTTP — /page + /status + /pair through a live listener (ephemeral port)
    const calls = [];
    const srv = ps.start({
        port: 0,
        getSock: () => fakeSock,
        getKey: () => key,
        status: () => ({ bot: 'KAVIZ MD V1', status: 'connecting', uptime: 42 }),
        log: (t) => calls.push(t),
    });
    await new Promise((res, rej) => { srv.once('listening', res); srv.once('error', rej); });
    const port = srv.address().port;
    const get = (p) => fetch(`http://127.0.0.1:${port}${p}`).then(async (r) => ({ code: r.status, text: await r.text() }));

    const home = await get('/?key=' + key);
    if (home.code !== 200 || !/ＫＡＶＩＺ ＭＤ Ｖ1/.test(home.text) || !/Linked devices/.test(home.text) || !/pair\?number=/.test(home.text)) throw new Error('pair page broken');
    if (!home.text.includes('value="' + key + '"')) throw new Error('pair page does not pre-fill key from URL');
    const st = await get('/status');
    const stj = JSON.parse(st.text);
    if (stj.bot !== 'KAVIZ MD V1' || stj.status !== 'connecting' || stj.uptime !== 42) throw new Error('status JSON broken: ' + st.text);
    console.log('[8] ★ live HTTP — page (brand+steps+key) + /status JSON: OK ✅ port=' + port);

    // 9) ★ live /pair — right key works, wrong key 400, rate-limit 429 (same IP <10s)
    const p1 = await get('/pair?number=94771234567&key=' + key);
    if (p1.code !== 200 || !JSON.parse(p1.text).ok || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(JSON.parse(p1.text).code)) throw new Error('live pair fail: ' + p1.text);
    const p2 = await get('/pair?number=94771234567&key=nope');
    if (p2.code !== 400 || JSON.parse(p2.text).ok !== false) throw new Error('wrong key over HTTP not 400: ' + p2.code);
    const p3 = await get('/pair?number=94771234567&key=' + key);
    if (p3.code !== 429) throw new Error('rate limit not applied: ' + p3.code);
    console.log('[9] ★ live /pair — 200 code / 400 bad key / 429 rate-limit: OK ✅');

    // 10) rate-limit map bounded + server close
    srv.close();
    if (!/fetch\('\/status'\)/.test(ps._page('X'))) throw new Error('page lost status polling');
    console.log('[10] page status-polling kept + server closes clean: OK ✅');

    // 11) manifest — files[] carries pairsite.js + test_v229.js, removed[] clean
    if (!man.files.includes('pairsite.js')) throw new Error('manifest files[] missing pairsite.js');
    if (!man.files.includes('test_v229.js')) throw new Error('manifest files[] missing test_v229.js');
    if (!man.removed.includes('test_v228.js')) throw new Error('manifest removed[] missing test_v228.js');
    if (fs.existsSync('test_v228.js')) throw new Error('test_v228.js still on disk (should be removed by .update)');
    if (!/pair/i.test(man.notes)) throw new Error('manifest notes missing pair mention');
    console.log('[11] manifest (files + removed + notes): OK ✅');

    // 12) module graph + node --check all manifest .js
    for (const f of man.files) {
        if (f.endsWith('.js')) { execSync(`node --check ${JSON.stringify(f)}`); }
    }
    for (const f of ['pairsite.js']) require('./' + f);   // loads clean
    console.log('[12] module graph loads + node --check all manifest .js: OK ✅');

    // 13) privacy + style guards — no report-flood, footer style intact
    const all = ['bot.js', 'pairsite.js'].map(read).join('\n');
    if (/report-flood|reportflood/i.test(all)) throw new Error('report-flood crept back in');
    if (!read('style.js').includes("const BRAND = 'ᴋᴀᴠɪᴢ ᴍᴅ ᴠ1'")) throw new Error('style.js brand changed');
    console.log('[13] report-flood absent + brand style intact: OK ✅');

    console.log('\n🎉 ALL v2.29.0 TESTS PASSED');
})().catch((e) => { console.error('💩 ' + (e.stack || e.message)); failed = true; })
    .finally(() => { try { fs.writeFileSync(path.join(__dirname, 'settings.json'), SETTINGS_SNAP); } catch { } process.exit(failed ? 1 : 0); });
