/**
 * test_v308.js — v3.05.0 🎌 .animepahe — CONSUMET-ONLY rewrite (ALL OFFLINE)
 * User directive 2026-10-30: "Rewrite animepahe.js completely. Delete the massive CF solver, vm
 * sandbox, and direct scraping logic. Hardcode the new base URL. ONLY use this new API."
 *
 *  (1)  negative markers: NO vm sandbox · NO cfsolver/cf_clearance · NO direct-scrape (search/release
 *       api, pickDownload, pahe.win forms, resolveDirect) — the solver stack is DELETED repo-wide
 *  (2)  hardcoded default base = https://api-consumet-org.vercel.app (env > settings > default)
 *  (3)  consumet parsers ×3 (search/info/watch — m3u8 dropped, best-first, Referer carried)
 *  (4)  probeConsumetBase 4 shapes (bad-url · HTTP fail · parked non-JSON · JSON-OK)
 *  (5)  cInfo/cWatch dual-form fallback (path-first ↔ query form for older instances)
 *  (6)  FULL flow e2e: search → eps → quality → FILE with #apref=<referer> + caption asserts
 *  (7)  URL jumps: /anime/<id> → eps menu · /play/<a>/<e> → quality (episodeId = a/e)
 *  (8)  unreachable-verdict skip (fail fast within TTL) + retry after expiry
 *  (9)  non-direct source guard (raw kwik page → honest short error, no wall commentary)
 *  (10) neutral error cards — NO 'Cloudflare/dead/blocked' words (user directive #6)
 *  (11) bridge reply-only + cardId guard · isApUrl · epLabel
 *  (12) repo hygiene: package.json solver deps GONE, postinstall clean, manifest/pins 3.05.0
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const ap = require('../animepahe');

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.json'), 'utf8'));
const AP_SRC = fs.readFileSync(path.join(REPO, 'animepahe.js'), 'utf8');
const BOT_SRC = fs.readFileSync(path.join(REPO, 'bot.js'), 'utf8');

let passN = 0, failN = 0;
const ok = (name, fn) => {
    try { fn(); passN++; console.log('  ✅ ' + name); }
    catch (e) { failN++; console.log('  ❌ ' + name + '\n     ' + String(e.message || e).split('\n').slice(0, 3).join('\n     ')); }
};
const okA = async (name, fn) => {
    try { await fn(); passN++; console.log('  ✅ ' + name); }
    catch (e) { failN++; console.log('  ❌ ' + name + '\n     ' + String(e.message || e).split('\n').slice(0, 3).join('\n     ')); }
};

// ── mock plumbing ──
let CALLS = [];                                   // [{url, opts}]
let MODE = { search: 200, searchBody: null, info: 200, watch: 200 };
let prevFetcher = null;
function setMode(m) { Object.assign(MODE, m); }
function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
function mockFetcher(u, o = {}) {
    CALLS.push({ url: String(u), opts: o });
    if (u.includes('/anime/animepahe/info')) {
        if (MODE.infoAlt && !u.includes('info/')) return jsonResponse(MODE.info, MODE.infoBody);   // ?id= form
        return jsonResponse(MODE.info, MODE.infoBody);
    }
    if (u.includes('/anime/animepahe/watch')) return jsonResponse(MODE.watch, MODE.watchBody);
    if (/\/anime\/animepahe\/[^/]+$/.test(u.split('?')[0]) || u.includes('/anime/animepahe/naruto')) return jsonResponse(MODE.search, MODE.searchBody);
    if (u.endsWith('/anime/animepahe/a')) return jsonResponse(MODE.probe ?? 200, MODE.probeBody ?? { intro: 'provider' });
    return jsonResponse(404, { message: 'not found' });
}

const mkCtx = () => {
    const sent = [];
    const send = async (jid, content, opts) => { sent.push({ jid, content, opts }); return { key: { id: 'MSG' + sent.length } }; };
    const downloads = [];
    return { sent, downloads, ctx: (rest) => ({ send, jid: 'J1@s.whatsapp.net', msg: { key: { id: 'IN' } }, rest, react: async () => { }, download: async (link, tag) => { downloads.push({ link, tag }); } }) };
};
const lastText = (sent) => sent[sent.length - 1].content.text;

// ── fixtures (consumet.ts contract shapes) ──
const SEARCH_JSON = { results: [
    { id: 'sessNaruto1', title: 'Naruto', image: 'https://img.example/n.jpg', type: 'TV', year: '2007', episodes: 220 },
    { id: 'sessFrieren', title: 'Frieren', type: 'TV', year: '2023', episodes: 28 },
    { id: null, title: 'broken' },
] };
const INFO_JSON = { id: 'sessNaruto1', title: 'Naruto', episodes: [
    { id: 'e10x', number: 10 }, { id: 'e9x', number: 9 }, { id: 'e1x', number: 1 },
] };
const WATCH_JSON = { headers: { Referer: 'https://kwik.cx/' }, sources: [
    { url: 'https://kwik.cx/f/1080.mp4', quality: '1080p', isM3U8: false },
    { url: 'https://kwik.cx/f/master.m3u8', quality: 'default', isM3U8: true },
    { url: 'https://kwik.cx/f/720.mp4', quality: '720p', isM3U8: false },
] };

(async () => {
    console.log('— v3.05.0 consumet-only animepahe suite —');

    await ok('pins: package.json + manifest.json = 3.05.0', () => {
        assert.strictEqual(pkg.version, '3.05.0');
        assert.strictEqual(man.version, '3.05.0');
    });

    await ok('NEGATIVE markers: vm sandbox · cfsolver · cf_clearance · direct-scrape machinery ALL GONE', () => {
        for (const bad of ["require('vm')", 'cfsolver', 'cf_clearance', 'extractFormTokens', 'resolveDirect', "m: 'search'", "m: 'release'", 'pickDownload', 'bot-traffic', 'Cloudflare', 'clearance(']) {
            assert.ok(!AP_SRC.includes(bad), `animepahe.js must not contain "${bad}"`);
        }
        assert.ok(!fs.existsSync(path.join(REPO, 'cfsolver.js')), 'cfsolver.js deleted');
        assert.ok(!fs.existsSync(path.join(REPO, 'scripts', 'get-chrome.js')), 'scripts/get-chrome.js deleted');
        for (const f of ['test_v303.js', 'test_v304.js', 'test_v305.js', 'test_v306.js', 'test_v307.js']) {
            assert.ok(!fs.existsSync(path.join(REPO, 'tests', f)), `superseded suite ${f} deleted`);
        }
    });

    await ok('hardcoded default base + precedence env > settings.json > default', () => {
        assert.strictEqual(ap.CONSUMET_DEFAULT, 'https://api-consumet-org.vercel.app');
        delete process.env.ARENA_CONSUMET_BASE;
        assert.strictEqual(ap.consumetBase(), 'https://api-consumet-org.vercel.app');
        process.env.ARENA_CONSUMET_BASE = 'https://env-base.example.com/';
        assert.strictEqual(ap.consumetBase(), 'https://env-base.example.com');
        delete process.env.ARENA_CONSUMET_BASE;
    });

    await ok('parsers: search fields + broken row skipped + 10 cap · info desc→ep1-first · watch m3u8 dropped + best-first + Referer', () => {
        const big = { results: Array.from({ length: 14 }, (_, i) => ({ id: 's' + i, title: 'T' + i })) };
        assert.strictEqual(ap.parseConsumetSearch(big).length, 10, 'cap 10');
        const rows = ap.parseConsumetSearch(SEARCH_JSON);
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].session, 'sessNaruto1');
        assert.strictEqual(rows[0].poster, 'https://img.example/n.jpg');
        const eps = ap.parseConsumetInfo(INFO_JSON);
        assert.deepStrictEqual(eps.map(e => e.ep), [1, 9, 10], 'ep1 first');
        assert.strictEqual(eps[0].session, 'e1x');
        const qs = ap.parseConsumetWatch(WATCH_JSON);
        assert.deepStrictEqual(qs.map(q => q.res), [1080, 720], 'm3u8 dropped, best-first');
        assert.strictEqual(qs[0].referer, 'https://kwik.cx/');
    });

    await ok('probeConsumetBase: bad-url · HTTP-fail · parked non-JSON · JSON-OK', async () => {
        prevFetcher = ap.setFetcher(mockFetcher);
        try {
            let p = await ap.probeConsumetBase('not-a-url');
            assert.strictEqual(p.ok, false);
            setMode({ probe: 500, probeBody: 'err' });
            p = await ap.probeConsumetBase('https://b.example.com');
            assert.strictEqual(p.ok, false, 'HTTP 500');
            assert.ok(/HTTP 500/.test(p.why));
            setMode({ probe: 200, probeBody: '<html>PARKED</html>' });
            p = await ap.probeConsumetBase('https://b.example.com');
            assert.strictEqual(p.ok, false, 'parked html');
            assert.strictEqual(p.shape, 'html');
            setMode({ probe: 200, probeBody: { intro: 'ok' } });
            p = await ap.probeConsumetBase('https://b.example.com');
            assert.ok(p.ok && p.shape === 'json');
        } finally { ap.setFetcher(prevFetcher); }
    });

    await ok('cInfo/cWatch dual-form: 404 on preferred form falls back to the alt form', async () => {
        prevFetcher = ap.setFetcher((u, o) => {
            CALLS.push({ url: String(u), opts: o });
            if (u.includes('/watch?episodeId=')) return jsonResponse(404, { message: 'not found' });
            if (u.includes('/anime/animepahe/watch/')) return jsonResponse(200, WATCH_JSON);
            if (u.includes('/anime/animepahe/info/')) return jsonResponse(404, { message: 'not found' });
            if (u.includes('info?id=')) return jsonResponse(200, INFO_JSON);
            return jsonResponse(404, {});
        });
        try {
            const info = await ap.cInfo('x1');
            assert.strictEqual(info.episodes.length, 3, 'info via ?id= fallback');
            const w = await ap.cWatch('x2');
            assert.strictEqual(w.sources.length, 3, 'watch via path fallback');
        } finally { ap.setFetcher(prevFetcher); }
    });

    await okA('FULL flow e2e: search → eps → quality → FILE with #apref=<referer> + caption', async () => {
        prevFetcher = ap.setFetcher(mockFetcher);
        CALLS = []; setMode({ searchBody: SEARCH_JSON, infoBody: INFO_JSON, watchBody: WATCH_JSON });
        const { sent, downloads, ctx } = mkCtx();
        try {
            ap._cTest({ reset: true });
            assert.ok(await ap.handle('.animepahe', ctx(['frieren test'])), 'handle true');
            const sc = lastText(sent);
            assert.ok(sc.includes('Naruto'), 'search card lists Naruto');
            assert.ok(await ap.handle('.animepahe', ctx(['2'])), 'pick 2 (no-poster row)');
            const ec = lastText(sent);
            assert.ok(ec.includes('Episodes 3') && ec.includes('EP 1'), 'eps card ep1-first');
            assert.ok(await ap.handle('.animepahe', ctx(['1'])), 'pick ep1');
            const qc = lastText(sent);
            assert.ok(qc.includes('1080p') && !qc.includes('m3u8'), 'quality card mp4 only');
            assert.ok(await ap.handle('.animepahe', ctx(['go 1'])), 'quality pick 1');
            assert.strictEqual(downloads.length, 1, 'FILE dispatched');
            assert.strictEqual(downloads[0].link, 'https://kwik.cx/f/1080.mp4#apref=' + encodeURIComponent('https://kwik.cx/'), '#apref referer fragment');
            assert.ok(downloads[0].tag.includes('AnimePahe') && downloads[0].tag.includes('1080p'), 'caption tag');
            // session consumed after download → expire card
            await ap.handle('.animepahe', ctx(['go 2']));
            assert.ok(/session expire/.test(lastText(sent)), 'session gone after FILE');
        } finally { ap.setFetcher(prevFetcher); }
    });

    await okA('URL jumps: /anime/<id> → eps · /play/<a>/<e> → quality with episodeId=a/e', async () => {
        prevFetcher = ap.setFetcher(mockFetcher);
        CALLS = []; setMode({ searchBody: SEARCH_JSON, infoBody: INFO_JSON, watchBody: WATCH_JSON });
        const { sent, ctx } = mkCtx();
        try {
            ap._cTest({ reset: true });
            await ap.handle('.animepahe', ctx(['https://animepahe.com/anime/sessNaruto1']));
            assert.ok(lastText(sent).includes('Episodes 3'), 'anime jump → eps card');
            await ap.handle('.aphe', ctx(['https://animepahe.pw/play/sessNaruto1/e9x']));
            const wcall = CALLS.filter(c => c.url.includes('/watch'))[0];
            assert.ok(wcall && wcall.url.includes('episodeId=sessNaruto1%2Fe9x'), 'play jump → watch episodeId=a/e');
            assert.ok(lastText(sent).includes('Quality'), 'play jump → quality card');
        } finally { ap.setFetcher(prevFetcher); }
    });

    await okA('unreachable verdict: fail fast within TTL (no fetch), retried after expiry', async () => {
        prevFetcher = ap.setFetcher(mockFetcher);
        CALLS = []; setMode({ searchBody: SEARCH_JSON });
        const { sent, ctx } = mkCtx();
        try {
            ap._cTest({ ok: false, at: Date.now(), status: 503 });
            assert.ok(!(await ap.handle('.animepahe', ctx(['naruto']))), 'fast-fail');
            assert.strictEqual(CALLS.filter(c => c.url.includes('naruto')).length, 0, 'no fetch while verdict fresh');
            assert.ok(/reply එකක් නෑ/.test(lastText(sent)), 'neutral card');
            ap._cTest({ ok: false, at: Date.now() - 11 * 60e3, status: 503 });
            assert.ok(await ap.handle('.animepahe', ctx(['naruto'])), 'expired verdict → retried');
            assert.strictEqual(CALLS.filter(c => c.url.includes('naruto')).length, 1, 'fetch attempted after TTL');
        } finally { ap.setFetcher(prevFetcher); ap._cTest({ reset: true }); }
    });

    await okA('non-direct source guard: raw kwik page → honest short error, no download', async () => {
        prevFetcher = ap.setFetcher(mockFetcher);
        setMode({ searchBody: SEARCH_JSON, infoBody: INFO_JSON, watchBody: { sources: [{ url: 'https://kwik.cx/e/abc123', quality: '720p' }] } });
        const { sent, downloads, ctx } = mkCtx();
        try {
            ap._cTest({ reset: true });
            await ap.handle('.animepahe', ctx(['naruto']));
            await ap.handle('.animepahe', ctx(['1']));
            await ap.handle('.animepahe', ctx(['1']));
            await ap.handle('.animepahe', ctx(['1']));
            assert.strictEqual(downloads.length, 0, 'no FILE');
            assert.ok(/resolve වුණේ නෑ/.test(lastText(sent)), 'guard card');
            assert.ok(!/Cloudflare|bot-traffic|wall/i.test(lastText(sent)), 'no wall commentary');
        } finally { ap.setFetcher(prevFetcher); }
    });

    await ok('neutral error wording — no dead-API / CF messages anywhere in module or bot.js consumet card', () => {
        for (const w of ['451', 'DEAD', 'dead 🪦', 'legal reasons', 'walled', 'CF-WALLED']) {
            assert.ok(!AP_SRC.includes(w), `animepahe.js free of "${w}"`);
        }
        assert.ok(!BOT_SRC.includes('451'), 'bot.js consumet card free of 451');
    });

    await ok('bridge: reply-only cardId guard + cmd mapping · isApUrl · epLabel · looksDirect', () => {
        assert.strictEqual(ap.bridge('J1', null, '2'), null, 'no session');
        const s = ap._sessions;
        s.set('J1', { cmd: '.animepahe', cardId: 'C1', at: Date.now() });
        assert.strictEqual(ap.bridge('J1', 'C1', '2'), '.animepahe go 2');
        assert.strictEqual(ap.bridge('J1', 'OTHER', '2'), null, 'reply-only');
        assert.strictEqual(ap.bridge('J1', null, '0'), null);
        assert.deepStrictEqual(ap.isApUrl('https://animepahe.com/anime/sess1'), { kind: 'anime', path: '/anime/sess1' });
        assert.strictEqual(ap.isApUrl('https://example.com/anime/x'), null);
        assert.strictEqual(ap.epLabel({ ep: 3, ep2: 5, dub: true }), 'EP 3.5 [dub]');
        assert.strictEqual(ap.looksDirect('https://cdn.example/file.mp4'), true);
        assert.strictEqual(ap.looksDirect('https://kwik.cx/e/abc'), false);
        assert.strictEqual(ap.looksDirect('https://pahe.win/a/?t=1'), false);
    });

    await ok('bot.js wiring: require + bridge chain + HEAVY + HELP + healthCheck + .setconsumet — NO puppeteer', () => {
        assert.ok(BOT_SRC.includes("require('./animepahe')"));
        assert.ok(BOT_SRC.includes('animepahe.healthCheck(11000)'));
        assert.ok(BOT_SRC.includes('animepahe.bridge('));
        assert.ok(BOT_SRC.includes('animepahe.handle('));
        assert.ok(BOT_SRC.includes("'.animepahe', '.aphe'"), 'HEAVY set');
        assert.ok(BOT_SRC.includes('*.animepahe*'), 'HELP entry');
        assert.ok(BOT_SRC.includes('handleConsumet') && BOT_SRC.includes('.setconsumet'));
        assert.ok(!/require\(['"]puppeteer/.test(BOT_SRC), 'no puppeteer in bot.js');
    });

    await ok('repo hygiene: package.json solver deps gone · postinstall clean · manifest files sane', () => {
        for (const d of ['puppeteer', '@sparticuz/chromium']) {
            assert.ok(!Object.keys(pkg.dependencies).some(k => k.includes(d)), `no ${d} in dependencies`);
            assert.ok(!pkg.optionalDependencies || !Object.keys(pkg.optionalDependencies).some(k => k.includes(d)), `no ${d} in optionalDependencies`);
        }
        assert.strictEqual(pkg.scripts.postinstall, 'node launcher.js');
        assert.ok(!man.files.includes('cfsolver.js'), 'cfsolver out of manifest');
        assert.ok(!man.files.includes('scripts/get-chrome.js'), 'get-chrome out of manifest');
        assert.ok(man.files.includes('tests/test_v308.js'), 'test_v308 in manifest');
        assert.ok(!man.files.some(f => /^tests\/test_v30[3-7]\.js$/.test(f)), 'old suites out of manifest');
    });

    console.log(`\n${passN} pass / ${failN} fail`);
    process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
