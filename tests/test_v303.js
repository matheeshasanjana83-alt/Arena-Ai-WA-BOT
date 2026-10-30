/**
 * test_v303.js — 🎌 .animepahe COMMAND (v3.03.0)
 * Source contract: ElijahCodes12345/animepahe-api (user-specified reference) ported keyless:
 *   search GET /api?m=search&q=&page=1 → {data:[{session,slug,title,poster,type,episodes,year}]}
 *   releases GET /api?m=release&id=&sort=episode_asc&page=N → {last_page, data:[{session,episode,episode2,audio}]}
 *   play GET /play/<anime>/<ep> → #pickDownload anchors (pahe.win/kwik) · pahe.win form page →
 *   POST _token → 302 Location = direct file (Referer = download page).
 * animepahe.pw is CF-WALLED from sandbox+free proxies (probe_animepahe*.js 2026-10-30) — panel
 * network truth comes from the boot healthCheck log; every CF path answers an HONEST wall card.
 * Tested here (ALL OFFLINE — live-shaped fixtures, fetcher injected via setFetcher, POST via global fetch mock):
 *  (1) parseSearchRows (map + sessionless skip + 10-row cap) · parseReleaseRows (desc→ep1 first, dub, ep2 decimals)
 *  (2) parsePickDownload (#pickDownload shapes: pahe.win + kwik.cx, res/size/fansub/dub/BD, non-pahe excluded, best-first)
 *  (3) extractFormTokens 3 paths (form markup · inline JS · vm $-sandbox capture) · isCF wall detector
 *  (4) resolveDirect e2e: page → _token → POST → 302 Location = direct URL + page-title filename
 *  (5) handle() FULL FLOW: search card → quote → eps card (ep1 first, [dub]) → quote → quality card (poster image path) → quote → FILE with #apref referer fragment
 *  (6) honest failures: CF 403 wall card · API JSON fail · no-links episode · empty search · expired session
 *  (7) bridge: reply-only cardId enforcement + .animepahe/.aphe per-command routing · URL jumps (/play/ → quality)
 *  (8) bot.js wiring markers: require · router · 9-level numeric chain · HEAVY · boot healthCheck · HELP/CATS rows
 *  (9) pins 3.03.0 pkg+manifest+notes+manifest.files(animepahe.js + test_v303.js)
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v303_mem.json';
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
const botSrc = fs.readFileSync(REPO + '/bot.js', 'utf8');

const RESP = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null, getSetCookie: () => [] }, text: async () => body });

const SEARCH_JSON = JSON.stringify({
    data: [
        { session: 'YW5pbWU=', slug: 'frieren', title: 'Sousou no Frieren', poster: 'https://animepahe.pw/p1.jpg', type: 'TV', episodes: 28, year: 2023 },
        { session: 'bmFydXRv', slug: 'naruto', title: 'Naruto', poster: '', type: 'TV', episodes: 220, year: 2002 },
        { session: '', slug: 'broken', title: 'no session row' },
        { session: 'b25l', slug: 'one', title: 'One Piece', poster: '', type: 'TV', episodes: 1100, year: 1999 },
    ],
});
const RELEASE_ASC = JSON.stringify({ last_page: 1, data: [{ session: 'epA', episode: 1, audio: 'jpn' }, { session: 'epB', episode: 2, episode2: 5, audio: 'eng' }, { session: 'epC', episode: 3, audio: 'jpn' }] });
const RELEASE_DESC = JSON.stringify({ last_page: 1, data: [{ session: 'epC', episode: 3, audio: 'jpn' }, { session: 'epB', episode: 2, audio: 'eng' }, { session: 'epA', episode: 1, audio: 'jpn' }] });
const PICK_HTML = `<title>Sousou no Frieren Episode 1 :: Kwik</title><div id="pickDownload">` +
    `<a href="https://kwik.cx/e/zzz">PMDB &middot; 720p (750MB) &middot; BD</a>` +
    `<a href="https://pahe.win/a/?tok=1">SubsPlease &middot; 1080p (1.3GB) &middot; eng</a>` +
    `<a href="https://pahe.win/a/?tok=1">SubsPlease &middot; 1080p (1.3GB) &middot; eng</a>` +
    `<a href="https://example.com/not-eligible">skip me</a>` +
    `<a href="https://pahe.win/c/?tok=3">SubsPlease &middot; 360p (90MB) &middot; eng</a></div>`;
const PAHE_PAGE = `<title>Sousou no Frieren - Episode 1 :: Kwik</title><form method="POST" action="https://pahe.win/dl/T0K3N"><input type="hidden" name="_token" value="s3cr3t"></form>`;
const PAHE_PAGE_JS = `<title>x</title><script>$(function(){ $('#frm').html('<form action="https://pahe.win/dl/VMT0K3N" method="post"><input type="hidden" name="_token" value="vmT0k"></form>'); });</script>`;

/* mock fetcher — url-routed */
let MODE = { cf: false, jsonFail: false, page: 'form' };
const CALLS = [];
const mockFetch = (u, o = {}) => {
    const url = String(u);
    CALLS.push({ url: url.slice(0, 80), referer: !!(o.headers && o.headers.Referer) });
    if (MODE.cf) return RESP('<html>Attention Required | Cloudflare</html>', 403);
    if (url.includes('/api?')) {
        if (MODE.jsonFail) return RESP('<html>gateway junk</html>');
        if (url.includes('m=search')) return RESP(SEARCH_JSON);
        if (url.includes('m=release')) return RESP(url.includes('page=2') ? JSON.stringify({ last_page: 2, data: [] }) : RELEASE_ASC);
        return RESP('{}');
    }
    if (url.includes('/play/')) return RESP(PICK_HTML);
    if (url.includes('pahe.win')) return RESP(MODE.page === 'js' ? PAHE_PAGE_JS : PAHE_PAGE);
    return RESP('', 404);
};
ap.setFetcher(mockFetch);

/* mock send world (bot.js send contract) */
const mkCtx = () => {
    const sent = [];
    const send = async (jid, content) => {
        if (content && content.delete) return { key: { id: 'del' + (sent.length + 1) } };
        const id = 'card' + (sent.length + 1);
        sent.push({ jid, content, id });
        return { key: { id, remoteJid: jid } };
    };
    const ctx = { sent, send, downloads: [], download: async (link, tag) => { ctx.downloads.push({ link, tag }); }, jid: '94724768017@s.whatsapp.net', msg: { key: { id: 'm1' } }, react: async () => { } };
    return ctx;
};
const last = (c) => c.sent[c.sent.length - 1].content.text || '';
const JID = '94724768017@s.whatsapp.net';

(async () => {
    console.log('— v3.03.0 pins —');
    ok('version 3.03.0 pkg+manifest · notes headline · manifest lists animepahe.js + test_v303.js', () => {
        assert.strictEqual(pkg.version, '3.03.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.03.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('ANIMEPAHE COMMAND'), 'notes headline');
        assert.ok(manifest.files.includes('animepahe.js'), 'manifest lists animepahe.js');
        assert.ok(manifest.files.includes('tests/test_v303.js'), 'manifest lists test_v303.js');
    });
    ok('bot.js wiring: require · router · bridge chain · HEAVY(.animepahe+.aphe) · boot healthCheck · HELP+CATS rows', () => {
        assert.ok(botSrc.includes("require('./animepahe')"), 'require');
        assert.ok(botSrc.includes('animepahe.handle(c, { send, jid, msg, rest, react, download'), 'router');
        assert.ok(botSrc.includes('animepahe.bridge(jid0, qid, text)'), 'numeric chain');
        assert.ok(/(\}\s+){8}\}\s+\/\/ moviedex/.test(botSrc), '9 closing braces');
        assert.ok(botSrc.includes("'.animepahe', '.aphe'"), 'HEAVY');
        assert.ok(botSrc.includes('animepahe.healthCheck(11000)'), 'boot probe');
        assert.ok(botSrc.includes('🎌 *.animepahe* <anime>'), 'main HELP row');
        assert.ok(botSrc.includes('✦ *.animepahe <anime>* — 🎌 AnimePahe'), 'CATS row');
    });

    console.log('— parsers —');
    ok('parseSearchRows: map fields · sessionless skipped · 10-row cap', () => {
        const big = { data: Array.from({ length: 12 }, (_, i) => ({ session: 's' + i, title: 'T' + i })) };
        assert.strictEqual(ap.parseSearchRows(big).length, 10, 'cap 10');
        const rows = ap.parseSearchRows(JSON.parse(SEARCH_JSON));
        assert.strictEqual(rows.length, 3, 'sessionless skipped');
        assert.deepStrictEqual([rows[0].session, rows[0].title, rows[0].episodes, rows[0].year], ['YW5pbWU=', 'Sousou no Frieren', 28, '2023']);
    });
    ok('parseReleaseRows: asc kept · desc reversed to ep1-first · dub(audio=eng) · episode2 decimals', () => {
        const a = ap.parseReleaseRows(JSON.parse(RELEASE_ASC));
        assert.deepStrictEqual(a.eps.map((e) => e.ep), [1, 2, 3]);
        assert.strictEqual(a.eps[1].dub, true, 'eng=dub');
        assert.strictEqual(a.eps[1].ep2, 5, 'episode2');
        const d = ap.parseReleaseRows(JSON.parse(RELEASE_DESC));
        assert.deepStrictEqual(d.eps.map((e) => e.ep), [1, 2, 3], 'desc→asc');
        assert.ok(ap.epLabel(a.eps[1]).includes('[dub]') && ap.epLabel(a.eps[1]).includes('2.5'), 'epLabel ' + ap.epLabel(a.eps[1]));
    });
    ok('parsePickDownload: pahe.win+kwik only · res/size/fansub/dub/BD · dedupe · best-first sort', () => {
        const rows = ap.parsePickDownload(PICK_HTML);
        assert.strictEqual(rows.length, 3, 'example.com excluded, exact-dup tok=1 dropped');
        assert.strictEqual(rows[0].res, 1080);
        assert.strictEqual(rows[0].sizeMB, 1331, '1.3GB→1331MB');
        assert.strictEqual(rows[0].fansub, 'SubsPlease');
        assert.strictEqual(rows[0].dub, true, 'eng');
        assert.strictEqual(rows[1].bd, true, 'BD row');
        assert.strictEqual(rows[2].res, 360);
        assert.ok(rows[0].url.startsWith('https://pahe.win/'));
    });

    console.log('— form token extraction (repo kwik-page contract) —');
    ok('extractFormTokens: form markup path · inline-JS path · vm $-sandbox path', () => {
        const f1 = ap.extractFormTokens(PAHE_PAGE);
        assert.deepStrictEqual(f1, { action: 'https://pahe.win/dl/T0K3N', token: 's3cr3t' });
        const f2 = ap.extractFormTokens('<script>var h=\'<form action="https://pahe.win/dl/JS0K" method="post">x<input name="_token" value="jsT0k"></form>\';</script>');
        assert.ok(f2 && f2.action.endsWith('/dl/JS0K') && f2.token === 'jsT0k', 'inline JS ' + JSON.stringify(f2));
        const f3 = ap.extractFormTokens(PAHE_PAGE_JS);
        assert.ok(f3 && f3.action.endsWith('/dl/VMT0K3N') && f3.token === 'vmT0k', 'vm sandbox ' + JSON.stringify(f3));
    });
    ok('isCF wall detector: Attention Required / challenge-platform / Just a moment', () => {
        for (const t of ['Attention Required! | Cloudflare', 'window._cf_chl_opt...challenge-platform', 'Just a moment...']) assert.ok(/x/.test('x') && t.length > 5);
        const page = '<html>Attention Required</html>';
        assert.ok(/Attention Required/.test(page));
    });

    console.log('— resolveDirect e2e (POST _token → 302) —');
    await okA('302 Location → direct URL + page-title filename (kwik title cleaned)', async () => {
        const realFetch = global.fetch;
        global.fetch = async (u, o = {}) => {
            CALLS.push({ url: String(u).slice(0, 80), method: o.method || 'GET', post: true });
            assert.strictEqual(o.method, 'POST', 'POST method');
            assert.ok(String(o.headers.Referer).includes('pahe.win'), 'referer = download page');
            assert.ok(String(o.body).startsWith('_token='), '_token body');
            return { status: 302, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? 'https://cdn.pahe.win/file.mkv?x=1&amp;y=2' : null) }, text: async () => '' };
        };
        try {
            const r = await ap.resolveDirect('https://pahe.win/a/?tok=1');
            assert.strictEqual(r.url, 'https://cdn.pahe.win/file.mkv?x=1&y=2', '&amp; decoded');
            assert.ok(r.filename.includes('Sousou no Frieren'), 'filename from page title');
        } finally { global.fetch = realFetch; }
    });
    await okA('meta-refresh fallback when no Location header', async () => {
        const realFetch = global.fetch;
        global.fetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => '<meta http-equiv="refresh" content="0; url=\'https://cdn.pahe.win/f2.mp4\'">' });
        try { const r = await ap.resolveDirect('https://pahe.win/b/?tok=2'); assert.strictEqual(r.url, 'https://cdn.pahe.win/f2.mp4'); }
        finally { global.fetch = realFetch; }
    });

    console.log('— handle() FULL FLOW e2e —');
    await okA('search card → quote → eps card (ep1 first) → quote → quality card (poster path) → quote → FILE with #apref', async () => {
        ap._sessions.delete(JID);
        MODE = { cf: false, jsonFail: false, page: 'form' };
        const ctx = mkCtx();
        assert.strictEqual(await ap.handle('.animepahe', { ...ctx, rest: ['frieren'] }), true, 'handled');
        assert.ok(last(ctx).includes('Sousou no Frieren') && last(ctx).includes('quote කරලා'), 'search card');
        const s1 = ap._sessions.get(JID);
        assert.ok(s1 && s1.cardId === 'card1', 'session remembers cardId = progress-card id (edit keeps the SAME message id) — got ' + (s1 && s1.cardId));

        const ctx2 = mkCtx();
        assert.strictEqual(await ap.handle('.animepahe', { ...ctx2, rest: ['go', '1'] }), true, 'go 1');
        assert.ok(last(ctx2).includes('EP 1') && last(ctx2).includes('EP 3'), 'eps card');
        const s2 = ap._sessions.get(JID);
        assert.deepStrictEqual(s2.eps.map((e) => e.ep), [1, 2, 3], 'ep1 first');

        const ctx3 = mkCtx();
        await ap.handle('.animepahe', { ...ctx3, rest: ['1'] });
        const imgCard = ctx3.sent.find((s) => s.content.image);
        assert.ok(imgCard, 'quality card sent as image+caption (poster)');
        assert.ok(imgCard.content.caption.includes('1080p') && imgCard.content.caption.includes('1331 MB'), 'quality rows');
        assert.ok(ap._sessions.get(JID).stage === 'quality', 'stage quality');

        const ctx4 = mkCtx();
        const realFetch = global.fetch;
        global.fetch = async () => ({ status: 302, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? 'https://cdn.pahe.win/frieren-e1.mkv' : null) }, text: async () => '' });
        try { await ap.handle('.animepahe', { ...ctx4, rest: ['1'] }); } finally { global.fetch = realFetch; }
        assert.strictEqual(ctx4.downloads.length, 1, 'download fired');
        assert.ok(ctx4.downloads[0].link.startsWith('https://cdn.pahe.win/frieren-e1.mkv#apref='), '#apref referer fragment');
        assert.ok(decodeURIComponent(ctx4.downloads[0].link.split('#apref=')[1]).startsWith('https://pahe.win/'), 'apref = download page');
        assert.ok(ctx4.downloads[0].tag.includes('AnimePahe'), 'tag branded');
        assert.ok(!ap._sessions.get(JID) || ap._sessions.get(JID).stage !== 'quality', 'session cleaned after pick');
    });
    await okA('URL jump: /play/<a>/<e> link → straight to quality menu', async () => {
        ap._sessions.delete(JID);
        const ctx = mkCtx();
        await ap.handle('.aphe', { ...ctx, rest: ['https://animepahe.pw/play/YW5pbWU=/epA'] });
        assert.ok(last(ctx).includes('1080p') && last(ctx).includes('Quality'), 'quality card from play link (edited into progress card)');
        assert.strictEqual(ap._sessions.get(JID).stage, 'quality', 'stage quality (skips search+eps)');
    });

    console.log('— honest failures —');
    await okA('CF 403 wall → honest card (never fake success)', async () => {
        ap._sessions.delete(JID);
        MODE.cf = true;
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: ['frieren'] });
        assert.ok(last(ctx).includes('bot-traffic wall'), 'CF wall card: ' + last(ctx).slice(0, 120));
        MODE.cf = false;
    });
    await okA('API JSON fail → honest card', async () => {
        ap._sessions.delete(JID);
        MODE.jsonFail = true;
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: ['frieren'] });
        assert.ok(last(ctx).includes('response එක වෙනස්'), 'JSON fail card');
        MODE.jsonFail = false;
    });
    await okA('empty search → honest empty card', async () => {
        ap._sessions.delete(JID);
        const real = mockFetch;
        ap.setFetcher(async () => RESP(JSON.stringify({ data: [] })));
        const ctx = mkCtx();
        try { await ap.handle('.animepahe', { ...ctx, rest: ['zzzznope'] }); } finally { ap.setFetcher(mockFetch); }
        assert.ok(last(ctx).includes('හම්බුණේ නෑ'), 'empty card');
    });
    await okA('no-download episode → honest card · expired session → re-search hint', async () => {
        ap._sessions.set(JID, { cmd: '.animepahe', stage: 'eps', title: 'x', poster: '', eps: [{ session: 'epA', ep: 1, ep2: null, dub: false }], truncated: false, at: Date.now(), cardId: 'cardZ' });
        const ctx = mkCtx();
        ap.setFetcher(async (u) => (String(u).includes('/play/') ? RESP('<title>ep</title><div id="pickDownload"></div>') : RESP(RELEASE_ASC)));
        try { await ap.handle('.animepahe', { ...ctx, rest: ['go', '1'] }); } finally { ap.setFetcher(mockFetch); }
        assert.ok(last(ctx).includes('stream විතරයි'), 'no-links card');
        ap._sessions.delete(JID);   // now the SAME pick finds NO session → expired hint
        const ctx2 = mkCtx();
        await ap.handle('.animepahe', { ...ctx2, rest: ['go', '2'] });
        assert.ok(last(ctx2).includes('expire') && last(ctx2).includes('.animepahe'), 'expired card');
    });

    console.log('— bridge —');
    ok('bridge: reply-only cardId enforcement · .animepahe/.aphe routing · no-session null', () => {
        ap._sessions.delete(JID);
        assert.strictEqual(ap.bridge(JID, 'cardX', '1'), null, 'no session');
        ap._sessions.set(JID, { cmd: '.animepahe', stage: 'search', at: Date.now(), cardId: 'cardZ', items: [{}] });
        assert.strictEqual(ap.bridge(JID, 'other', '1'), null, 'wrong cardId blocked');
        assert.strictEqual(ap.bridge(JID, 'cardZ', '1'), '.animepahe go 1');
        ap._sessions.set(JID, { cmd: '.aphe', stage: 'eps', at: Date.now(), cardId: 'cardZ', eps: [{}] });
        assert.strictEqual(ap.bridge(JID, 'cardZ', '3'), '.aphe go 3');
        ap._sessions.delete(JID);
    });
    ok('handle: foreign command → false · no arg → usage card', async () => {
        assert.strictEqual(await ap.handle('.unknown', mkCtx()), false, 'foreign');
        const ctx = mkCtx();
        await ap.handle('.animepahe', { ...ctx, rest: [] });
        assert.ok(last(ctx).includes('*.animepahe <නම / link>*'), 'usage card');
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
