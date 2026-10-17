/**
 * test_v263.js — REGION-BLOCK FALLBACK (user screenshot: ".mdx black clover" →
 * "MovieBox API fail: HTTP 406 Not Acceptable")
 *
 * Root cause (proven live via pairsite /diag A/B, 2026-10-18): MovieBox soft-blocked the
 * panel's datacenter IP (Linode-SG) — every subject-api call answers HTTP 406
 * {"reason":"Not Acceptable","message":"find no content"} while visitor-login still 200s and
 * the SAME call through any residential proxy 200s. 406 is NOT the empty-result code
 * (garbage searches 200 with fuzzy hits). Fix: mbApi dispatcher plan [direct → pool proxies],
 * STICKY working proxy, 30-min direct re-probe cooldown, logins ride the same dispatcher.
 *
 * Run: node test_v263.js   (fully OFFLINE — mocked fetch + injected test pool)
 *  [1] direct 406 → pool proxy fallback (sticky set, cooldown armed)
 *  [2] sticky: next call skips direct entirely (all attempts carry a dispatcher)
 *  [3] blocked sticky proxy → unstuck + spare takes over
 *  [3b] poisoned registered token → fresh proxy-born visitor token (issue-IP = region anchor)
 *  [3c] all round-1 candidates dead → round 2 pulls fresh candidates
 *  [4] login rides the SAME dispatcher as the 401'd call
 *  [5] login impossible on every dispatcher → "MovieBox re-login fail"
 *  [6] no pool → old behavior: fail with the 406 message + direct cooldown armed
 *  [7] direct auto-heal after reset (direct success clears proxy + cooldown)
 *  [8] garbage search still a normal 200 (no region-block drama on empty-ish results)
 *  [9] version + source pins
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const mdx = require('./moviedex.js');

let pass = 0, fail = 0;
async function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return await r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

/* ── mock world ── */
const P1 = 'http://198.51.100.11:3128', P2 = 'http://198.51.100.22:8080';
const mkPool = (urls) => {
    const bad = new Set();
    return {
        enabled: () => true, hasCandidates: () => urls.some(u => !bad.has(u)),
        candidates: (n) => urls.filter(u => !bad.has(u)).slice(0, n),
        markGood: (u) => bad.delete(u), markBad: (u) => bad.add(u),
    };
};
const MODE = { direct406: false, blockedProxies: new Set(), deadProxies: new Set(), one401: false, one401Any: false, loginFail: false, poisonedReg: false };
const CALLS = [];   // { kind: 'login'|'search'|'other', via: 'direct'|proxyUrl, host }
let LOGIN_VIA_PROXY = 0;

const SEARCH_OK = () => Response.json({ code: 0, data: { results: [{ subjects: [{ subjectId: 'S1', title: 'Black Clover', subjectType: 2 }] }] } });
const LOGIN_OK = () => Response.json({ code: 0, data: { token: 'mock.visitor.token' } });
const R406 = () => Response.json({ code: 406, reason: 'Not Acceptable', message: 'find no content', metadata: {} }, { status: 406 });

const _origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const via = opts.dispatcher ? (mdx._mbProxyOf(opts.dispatcher) || 'unknown-proxy') : 'direct';
    const kind = u.includes('visitor-login') ? 'login' : (u.includes('/search/v2') ? 'search' : 'other');
    CALLS.push({ kind, via, host: new URL(u).host });
    if (kind === 'login') {
        if (via !== 'direct') LOGIN_VIA_PROXY++;
        if (MODE.loginFail) throw new Error('HTTP 500');
        return LOGIN_OK();
    }
    if (kind === 'search') {
        if (via !== 'direct') {
            if (MODE.deadProxies.has(via)) throw new TypeError('fetch failed');
            if (MODE.blockedProxies.has(via)) return R406();
            if (MODE.poisonedReg && !LOGIN_VIA_PROXY) return R406();   // registered token born via blocked IP → 406 even via proxy
        } else if (MODE.direct406) return R406();
        if (MODE.one401Any || (MODE.one401 && via === 'direct')) { MODE.one401 = false; return Response.json({ code: 441, message: 'miss token' }, { status: 441 }); }
        return SEARCH_OK();
    }
    return Response.json({ code: 0, data: {} });
};

/* silence the module's real background register/login timers during tests */
const SEARCH = '/wefeed-mobile-bff/subject-api/search/v2';

(async () => {
    console.log('== v2.63 region-block proxy fallback ==\n[1] direct 406 → pool proxy fallback');
    mdx._mbReset(); mdx._mbTestPool(mkPool([P1, P2]));
    CALLS.length = 0; MODE.direct406 = true;
    let j = await mdx.mbApi(SEARCH, { keyword: 'black clover' }, 4);
    await ok('search succeeds THROUGH the pool after direct 406', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));
    await ok('a DIRECT attempt was made first (healthy-direct-first)', () => assert.ok(CALLS.some(c => c.via === 'direct' && c.kind === 'search'), JSON.stringify(CALLS)));
    await ok('a PROXY attempt followed (dispatcher attached)', () => assert.ok(CALLS.some(c => c.via !== 'direct' && c.kind === 'search'), JSON.stringify(CALLS)));
    const st1 = mdx._mbState();
    await ok('STICKY proxy set to the working candidate (P1)', () => assert.strictEqual(st1.proxy, P1));
    await ok('direct cooldown armed (30-min re-probe)', () => assert.ok(st1.directBadUntil > Date.now() + 25 * 60e3, String(st1.directBadUntil)));

    console.log('\n[2] sticky — later calls skip direct');
    CALLS.length = 0;
    j = await mdx.mbApi(SEARCH, { keyword: 'naruto' }, 4);
    await ok('second call: ZERO direct attempts (cooldown honored)', () => assert.ok(CALLS.length && CALLS.every(c => c.via !== 'direct'), JSON.stringify(CALLS)));
    await ok('second call rode the SAME sticky proxy', () => assert.ok(CALLS.every(c => c.via === P1), JSON.stringify(CALLS)));
    await ok('search #2 returns rows', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));

    console.log('\n[3] blocked sticky → unstuck + spare takes over');
    MODE.blockedProxies.add(P1);
    CALLS.length = 0;
    j = await mdx.mbApi(SEARCH, { keyword: 'one piece' }, 4);
    await ok('P1 blocked (406 through proxy) → P2 spare serves the call', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));
    await ok('sticky moved to P2', () => assert.strictEqual(mdx._mbState().proxy, P2));
    MODE.blockedProxies.delete(P1);

    console.log('\n[3b] poisoned registered token → fresh proxy-born token (THE live discovery)');
    mdx._mbReset(); mdx._mbTestPool(mkPool([P1]));
    CALLS.length = 0; LOGIN_VIA_PROXY = 0; MODE.direct406 = true; MODE.poisonedReg = true;
    j = await mdx.mbApi(SEARCH, { keyword: 'black clover' }, 4);
    await ok('registered-token 406 via proxy → wipe + proxy re-login → search OK', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));
    await ok('a visitor-login happened THROUGH the proxy (issue-IP = region anchor)', () => assert.ok(CALLS.some(c => c.kind === 'login' && c.via !== 'direct'), JSON.stringify(CALLS)));
    await ok('working proxy became sticky', () => assert.strictEqual(mdx._mbState().proxy, P1));
    await ok('direct cooldown armed (direct 406 first)', () => assert.ok(mdx._mbState().directBadUntil > Date.now()));
    MODE.poisonedReg = false; MODE.direct406 = false;

    console.log('\n[3c] ALL round-1 candidates dead → round 2 pulls fresh candidates');
    mdx._mbReset();
    const round2 = mkPool([P1, P2]);
    let picks = 0;
    const origCand = round2.candidates.bind(round2);
    round2.candidates = (n) => (++picks === 1 ? [P1] : origCand(n));   // round 1 serves only the dead P1, round 2 the real (bad-marked) filter → P2
    mdx._mbTestPool(round2);
    CALLS.length = 0; MODE.deadProxies.add(P1); MODE.direct406 = true;
    j = await mdx.mbApi(SEARCH, { keyword: 'black clover' }, 3);
    await ok('round-2 candidate (P2) serves after round-1 death', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));
    await ok('sticky moved to P2', () => assert.strictEqual(mdx._mbState().proxy, P2));
    MODE.deadProxies.delete(P1); MODE.direct406 = false;

    console.log('\n[4] login rides the SAME dispatcher as the failing call');
    mdx._mbReset(); mdx._mbTestPool(mkPool([P1]));
    CALLS.length = 0; MODE.direct406 = false; MODE.one401 = true;   // direct search 441s ONCE
    j = await mdx.mbApi(SEARCH, { keyword: 'black clover' }, 4);
    await ok('call with 401 recovered via re-login on the same path', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));
    await ok('a visitor-login happened (recorded)', () => assert.ok(CALLS.some(c => c.kind === 'login'), JSON.stringify(CALLS)));
    await ok('login rode DIRECT — the same dispatcher as the 401\'d call', () => assert.ok(CALLS.filter(c => c.kind === 'login').every(c => c.via === 'direct'), JSON.stringify(CALLS)));
    await ok('direct recovery keeps proxy EMPTY (no sticky needed)', () => assert.strictEqual(mdx._mbState().proxy, ''));
    MODE.one401 = false;

    console.log('\n[5] login impossible everywhere → re-login fail');
    mdx._mbReset(); mdx._mbTestPool(mkPool([P1]));
    CALLS.length = 0; MODE.direct406 = false; MODE.loginFail = true; MODE.one401Any = true;   // EVERY search 441s
    let err5 = null;
    try { await mdx.mbApi(SEARCH, { keyword: 'x' }, 4); } catch (e) { err5 = e; }
    await ok('throws "MovieBox re-login fail" when no dispatcher can login', () => assert.ok(/re-login fail/i.test(String(err5)), String(err5)));
    await ok('login attempts were made (both dispatchers tried)', () => assert.ok(CALLS.filter(c => c.kind === 'login').length >= 2, JSON.stringify(CALLS.length)));
    MODE.loginFail = false; MODE.one401Any = false;

    console.log('\n[6] no pool → old 406 failure shape (cooldown armed, message kept)');
    mdx._mbReset(); mdx._mbTestPool(null);
    process.env.PROXY_POOL = '0';   // disable the REAL pool too (repo cache may have live candidates)
    delete require.cache[require.resolve('./proxypool.js')];
    CALLS.length = 0; MODE.direct406 = true;
    let err6 = null;
    try { await mdx.mbApi(SEARCH, { keyword: 'x' }, 2); } catch (e) { err6 = e; }
    await ok('error keeps the "MovieBox API fail: HTTP 406 …" shape', () => assert.ok(/MovieBox API fail: HTTP 406/.test(String(err6)), String(err6)));
    await ok('direct cooldown armed even without a pool', () => assert.ok(mdx._mbState().directBadUntil > Date.now()));
    MODE.direct406 = false; delete process.env.PROXY_POOL;

    console.log('\n[7] direct auto-heal (reset = cooldown gone → direct first again)');
    mdx._mbReset(); mdx._mbTestPool(mkPool([P1]));
    CALLS.length = 0;
    j = await mdx.mbApi(SEARCH, { keyword: 'black clover' }, 4);
    await ok('healthy direct serves the call directly', () => assert.strictEqual(j.data.results[0].subjects[0].title, 'Black Clover'));
    await ok('direct success keeps proxy EMPTY (no sticky)', () => assert.strictEqual(mdx._mbState().proxy, ''));
    await ok('cooldown cleared', () => assert.strictEqual(mdx._mbState().directBadUntil, 0));

    console.log('\n[8] garbage search — 200 passthrough (406 is NOT empty-result semantics)');
    CALLS.length = 0;
    j = await mdx.mbApi(SEARCH, { keyword: 'zzqqxx12345garbage' }, 4);
    await ok('garbage keyword still returns a normal 200 payload', () => assert.ok(j.data && j.data.results !== undefined));

    console.log('\n[9] version + source pins');
    await ok('package.json 2.65.0', () => assert.strictEqual(require('./package.json').version, '2.65.0'));
    await ok('manifest.json 2.65.0 + notes mention the region-block fix', () => { const m = JSON.parse(fs.readFileSync('manifest.json')); assert.strictEqual(m.version, '2.65.0'); assert.ok(/REGION-BLOCK|406/i.test(m.notes)); });
    await ok('README-SI v2.63 changelog entry', () => assert.ok(fs.readFileSync('README-SI.txt', 'utf8').includes('v2.63.0 — 🛡️ MOVIEDEX REGION-BLOCK FIX')));
    const mv = fs.readFileSync('moviedex.js', 'utf8');
    await ok('v2.63 header marker', () => assert.ok(mv.includes('v2.63 — REGION-BLOCK FALLBACK')));
    await ok('v246 pin intact (visitor-login anonymous)', () => assert.ok(mv.includes('delete _vh.Authorization')));
    await ok('regPost rides the sticky proxy', () => assert.ok(mv.includes('if (mbProxy) opt.dispatcher = mbAgentFor(mbProxy);')));
    await ok('406 NOT treated as auth-fail anymore (old bug: mbLogin loop on every 406)', () => assert.ok(!/HTTP 441\|HTTP 401\|HTTP 406\|miss token/.test(mv)));
    await ok('region-block regex covers 406/451/403-region', () => assert.ok(mv.includes('/HTTP 406|HTTP 451|not available in current region/i')));
    await ok('dispatcher plan prefers direct when healthy', () => assert.ok(mv.includes("if (Date.now() >= mbDirectBadUntil) list.push({ kind: 'direct' })")));
    await ok('test hooks exported (state/reset/pool/proxyOf)', () => assert.ok(typeof mdx._mbState === 'function' && typeof mdx._mbReset === 'function' && typeof mdx._mbTestPool === 'function' && typeof mdx._mbProxyOf === 'function'));

    mdx._mbReset(); mdx._mbTestPool(null);
    globalThis.fetch = _origFetch;
    console.log(`\n═══ v2.63: ${pass} pass · ${fail} fail ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
