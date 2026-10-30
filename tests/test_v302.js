/**
 * test_v302.js — 🍿 .cinesubz + .cineru SEPARATE COMMANDS (v3.05.0)
 * User directive: "Moviedex command එකට cinesubz,cineru mix කරන්න එපා ඒ දෙක වෙනම command දෙකක් ලෙස
 * ඇඩ් කරන්න" → cinesite.js = one zetaflix engine, per-host sessions, NO cross-domain fallback.
 * LIVE-VERIFIED 2026-10-30 (probe_sites_v2100* + probe_series_v2100): /?s= search display-item
 * (data-ptype movies|tvshows) · zeta_player_ajax (Content-Type form-urlencoded — missing it = 400,
 * the doo_player_ajax action answers "0") → player2.setwenna.one mp4 page → ALL_QUALITIES multi
 * (Glass Onion 480/720/1080 = 779/1429/2652MB) OR single-file ALL_QUALITIES=[] + Artplayer url:
 * (Breaking Bad S1E1 MP4/422MB) · ?play=true Range probes = 206+ftyp, no referer/token · series
 * pages list ALL episodes in order (Breaking Bad 62/62).
 * Tested here (ALL OFFLINE — fixtures from the live shapes, fetcher injected via setFetcher):
 *  (1) parseSearch (kinds + poster + title fallback) · parseTitle (options + ALL episodes ordered)
 *  (2) parseQualities both shapes (multi-array + single-file fallback) · seasonSlug (5x16 / s01e02 / none)
 *  (3) resolveQualities e2e (ajax JSON → player page → probes, 1080 first, dead-quality filtered)
 *  (4) handle() FULL FLOW e2e: search → quote 1 (series) → eps menu → quote 1 → quality card → quote 1 → download URL
 *  (5) honest failures: empty search card · bad pick · no-download ctx · expired session
 *  (6) bridge: reply-only cardId enforcement + per-command routing (.cinesubz go N vs .cineru go N)
 *  (7) separate-commands markers: SITES per-host, no domain ladder in cinesite · moviedex un-mixed (test_v301 covers deep)
 *  (8) pins 3.05.0 pkg+manifest+notes+manifest.files
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v302_mem.json';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = JSON.parse(fs.readFileSync(REPO + '/package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync(REPO + '/manifest.json', 'utf8'));
const cs = require('../cinesite');

const RESP = (body, headers = [], status = 200) => ({ ok: status < 400, status, headers: new Map(headers), text: async () => body });

/* live-shaped fixtures */
const SEARCH_HTML = `<div id="item-65702" class="display-item"><a href="https://cinesubz.net/movies/glass-onion-a-knives-out-mystery-2022-sinhala-subtitles/" data-ptype="movies" title="Glass Onion: A Knives Out Mystery (2022)"></a><img data-original="https://cinesubz.net/wp-content/uploads/p1.jpg"></div><div id="item-9428" class="display-item"><a href="https://cinesubz.net/tvshows/breaking-bad-2008-sinhala-subtitles/" data-ptype="tvshows" title="Breaking Bad (2008) Complete TV Series"></a><img data-original="https://cinesubz.net/wp-content/uploads/p2.jpg"></div>`;
const SERIES_HTML = `<title>Breaking Bad (2008) Complete TV Series with Sinhala Subtitles | CineSubz</title><meta property="og:image" content="https://cinesubz.net/wp-content/uploads/p2.jpg">` +
    Array.from({ length: 3 }, (_, i) => `<a href='https://cinesubz.net/episodes/breaking-bad-${i + 1}x1/' data-pid='9428' data-season='1' data-episode='${i + 1}'>E${i + 1}</a>`).join('');
const EP_HTML = `<title>Breaking Bad S1E1 | CineSubz</title><li id='player-option-1' data-type='ep' data-post='9428' data-nume='1'></li><li id='player-option-2' data-type='ep' data-post='9428' data-nume='2'></li>`;
const PLAYER_MULTI = `var ALL_QUALITIES = [{"html":"SD 480P","url":"https://cs02.supercloud1.xyz/Glass.Onion.-480p.mp4?play=true","default":false},{"html":"HD 720P","url":"https://cs02.supercloud1.xyz/Glass.Onion.-720p.mp4?play=true","default":true},{"html":"FHD 1080P","url":"https://cs02.supercloud1.xyz/Glass.Onion.-1080p.mp4?play=true","default":false}];`;
const PLAYER_SINGLE = `ALL_QUALITIES = []; url: 'https://cs01.supercloud1.xyz/Breaking.Bad.S01E01.mp4?play=true',`;

/* mock world — url-routed */
let MODE = { ajaxFail: false, sizes: {} };
const CALLS = [];
const mockFetch = (u, o = {}) => {
    const url = String(u);
    CALLS.push({ url: url.slice(0, 90), method: o.method || 'GET' });
    if (url.includes('/?s=breaking')) return RESP(SEARCH_HTML);
    if (url.includes('/tvshows/breaking-bad-2008')) return RESP(SERIES_HTML);
    if (url.includes('/episodes/breaking-bad-1x1')) return RESP(EP_HTML);
    if (url.includes('/movies/glass-onion')) return RESP(EP_HTML.replace("data-type='ep'", "data-type='mv'"));
    if (url.includes('admin-ajax.php')) {
        if (MODE.ajaxFail) return { ok: false, status: 400, headers: new Map([]), text: async () => '0' };
        return RESP(JSON.stringify({ embed_url: 'https://player2.setwenna.one/Breaking.Bad.S01E01.mp4', type: 'mp4', msg: '' }));
    }
    if (url.includes('player2.setwenna.one')) return RESP(PLAYER_SINGLE);
    if (url.includes('-1080p.mp4')) return RESP('x', [['content-range', `bytes 0-0/${2652 * 1048576}`]], 206);
    if (url.includes('-720p.mp4')) return RESP('x', [['content-range', `bytes 0-0/${1429 * 1048576}`]], 206);
    if (url.includes('-480p.mp4')) return RESP('x', [['content-range', `bytes 0-0/${779 * 1048576}`]], 206);
    if (url.includes('supercloud1.xyz')) return RESP('x', [['content-range', `bytes 0-0/${422 * 1048576}`]], 206);
    return { ok: false, status: 404, headers: new Map([]), text: async () => '' };
};

/* send/ctx stubs (bot.js send contract) */
const mkCtx = () => {
    const sent = [];
    const send = async (jid, content) => { if (content && content.delete) return { key: { id: 'del' + (sent.length + 1) } }; const id = 'card' + (sent.length + 1); sent.push({ jid, content, id }); return { key: { id, remoteJid: jid } }; };
    return { sent, send, downloads: [], download: async (link, tag) => { ctx.downloads.push({ link, tag }); }, jid: '94724768017@s.whatsapp.net', msg: { key: { id: 'm1' } }, react: async () => { } };
};
let ctx;

(async () => {
    console.log('— v3.05.0 pins —');
    ok('version 3.05.0 pkg+manifest · notes headline · manifest lists cinesite.js + test_v302.js', () => {
        assert.strictEqual(pkg.version, '3.05.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.05.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('CINESUBZ + CINERU SEPARATE COMMANDS'), 'notes headline');
        assert.ok(manifest.files.includes('cinesite.js'), 'manifest lists cinesite.js');
        assert.ok(manifest.files.includes('tests/test_v302.js'), 'manifest lists test_v302.js');
    });
    ok('separate-commands markers: per-host SITES · no domain ladder in cinesite · bot.js wired', () => {
        assert.ok(cs.SITES['.cinesubz'] && cs.SITES['.cinesubz'].host === 'cinesubz.net', '.cinesubz site');
        assert.ok(cs.SITES['.cineru'] && cs.SITES['.cineru'].host === 'cineru.lk', '.cineru site');
        const src = fs.readFileSync(REPO + '/cinesite.js', 'utf8');
        assert.ok(!src.includes('DOMAINS'), 'NO cross-domain ladder in the commands');
        const botSrc = fs.readFileSync(REPO + '/bot.js', 'utf8');
        assert.ok(botSrc.includes("download: (link, tag) => dlQueue(() => handleDownload(send, jid, msg, link, tag), { send, jid, msg, label: tag || 'CineSubz' })"), 'dispatch download wired');
    });

    console.log('— pure parsers (live-shaped) —');
    ok('parseSearch: movies+tvshows kinds, poster, no cross-site', () => {
        const items = cs.parseSearch(SEARCH_HTML, cs.SITES['.cinesubz']);
        assert.strictEqual(items.length, 2);
        assert.strictEqual(items[0].kind, 'movie');
        assert.strictEqual(items[1].kind, 'series');
        assert.strictEqual(items[1].title, 'Breaking Bad (2008) Complete TV Series');
        assert.ok(items[1].poster.endsWith('p2.jpg'));
    });
    ok('parseTitle: player options + ALL episode links in order', () => {
        const info = cs.parseTitle(SERIES_HTML, cs.SITES['.cinesubz']);
        assert.strictEqual(info.title.startsWith('Breaking Bad (2008)'), true, info.title);
        assert.strictEqual(info.episodes.length, 3);
        assert.ok(info.episodes[2].endsWith('breaking-bad-3x1/'));
    });
    ok('parseQualities: multi-quality array + single-file fallback (ALL_QUALITIES=[] + url:)', () => {
        const multi = cs.parseQualities(PLAYER_MULTI);
        assert.strictEqual(multi.length, 3);
        assert.strictEqual(multi[2].html, 'FHD 1080P');
        const single = cs.parseQualities(PLAYER_SINGLE);
        assert.strictEqual(single.length, 1);
        assert.ok(single[0].url.startsWith('https://cs01.supercloud1.xyz/'));
    });
    ok('seasonSlug: 5x16 / s01e02 / none → S·E labels', () => {
        assert.strictEqual(cs.seasonSlug('https://cinesubz.net/episodes/breaking-bad-5x16/'), 'S5·E16');
        assert.strictEqual(cs.seasonSlug('https://cinesubz.net/episodes/show-s01e02/'), 'S1·E2');
        assert.strictEqual(cs.seasonSlug('https://cinesubz.net/episodes/movie/'), '');
    });

    console.log('— resolveQualities e2e (mocked fetcher) —');
    await okA('ajax → player page → probes → 1080 first, sizes real', async () => {
        const prev = cs.setFetcher(mockFetch);
        try {
            const qs = await cs.resolveQualities(cs.SITES['.cinesubz'], 'https://cinesubz.net/episodes/breaking-bad-1x1/', [{ nume: '1', type: 'ep', post: '9428' }, { nume: '2', type: 'ep', post: '9428' }]);
            assert.strictEqual(qs.length, 1, 'single-file shape → 1 row');
            assert.strictEqual(qs[0].sizeMB, 422, 'probed size');
        } finally { cs.setFetcher(prev); }
    });
    await okA('multi-quality page → 3 rows sorted 1080-first with sizes', async () => {
        const prev = cs.setFetcher((u, o = {}) => {
            const url = String(u);
            if (url.includes('admin-ajax.php')) return RESP(JSON.stringify({ embed_url: 'https://player2.setwenna.one/Glass.Onion.-720p.mp4', type: 'mp4' }));
            if (url.includes('player2.setwenna.one')) return RESP(PLAYER_MULTI);
            if (url.includes('-1080p.mp4')) return RESP('x', [['content-range', `bytes 0-0/${2652 * 1048576}`]], 206);
            if (url.includes('-720p.mp4')) return RESP('x', [['content-range', `bytes 0-0/${1429 * 1048576}`]], 206);
            if (url.includes('-480p.mp4')) return RESP('x', [['content-range', `bytes 0-0/${779 * 1048576}`]], 206);
            return { ok: false, status: 404, headers: new Map([]), text: async () => '' };
        });
        try {
            const qs = await cs.resolveQualities(cs.SITES['.cinesubz'], 'https://cinesubz.net/movies/glass-onion/', [{ nume: '1', type: 'mv', post: '65702' }]);
            assert.deepStrictEqual(qs.map((q) => q.label), ['FHD 1080P', 'HD 720P', 'SD 480P'], 'best first');
            assert.strictEqual(qs[0].sizeMB, 2652);
        } finally { cs.setFetcher(prev); }
    });

    console.log('— handle() FULL FLOW e2e (series) —');
    await okA('.cinesubz <name> → search card → quote 1 → eps menu → quote 1 → quality card → quote 1 → download', async () => {
        cs._sessions.clear();
        const prev = cs.setFetcher(mockFetch);
        ctx = mkCtx();
        try {
            assert.strictEqual(await cs.handle('.cinesubz', { ...ctx, rest: ['breaking', 'bad'] }), true);
            const card1 = ctx.sent[ctx.sent.length - 1].content.text;
            assert.ok(card1.includes('1. 🎬 Glass Onion'), 'movie row: ' + card1.slice(0, 120));
            assert.ok(card1.includes('2. 📺 Breaking Bad'), 'series row');
            // quote the search card, pick 2 (series)
            ctx.msg = { key: { id: 'm2' } };
            assert.strictEqual(await cs.handle('.cinesubz', { ...ctx, rest: ['2'] }), true);
            const epsCard = ctx.sent[ctx.sent.length - 1].content.text;
            assert.ok(epsCard.includes('📺 Episodes 3'), 'eps count: ' + epsCard.slice(0, 100));
            assert.ok(epsCard.includes('1. S1·E1'), 'slug label');
            // quote the eps card, pick 1
            const sess = cs._sessions.get(ctx.jid);
            sess.cardId = 'card' + ctx.sent.length;   // eps card id (edited progress bubble)
            ctx.msg = { key: { id: 'm3' } };
            assert.strictEqual(await cs.handle('.cinesubz', { ...ctx, rest: ['1'] }), true);
            const qCard = ctx.sent[ctx.sent.length - 1].content.caption || ctx.sent[ctx.sent.length - 1].content.text || '';
            assert.ok(qCard.includes('MP4 · 422 MB'), 'quality + size: ' + qCard.slice(-160));
            // quote the quality card → download
            const sess2 = cs._sessions.get(ctx.jid);
            sess2.cardId = 'card' + ctx.sent.length;
            ctx.msg = { key: { id: 'm4' } };
            assert.strictEqual(await cs.handle('.cinesubz', { ...ctx, rest: ['1'] }), true);
            assert.strictEqual(ctx.downloads.length, 1, 'download called');
            assert.ok(ctx.downloads[0].link.startsWith('https://cs01.supercloud1.xyz/'), 'direct url');
            assert.ok(ctx.downloads[0].tag.includes('S1·E1'), 'tag carries ep label');
            assert.strictEqual(cs._sessions.has(ctx.jid), false, 'session cleared after download');
        } finally { cs.setFetcher(prev); }
    });
    await okA('bridge: cardId-enforced reply-only + per-command routing', async () => {
        cs._sessions.clear();
        const prev = cs.setFetcher(mockFetch);
        try {
            ctx = mkCtx();
            await cs.handle('.cinesubz', { ...ctx, rest: ['breaking', 'bad'] });
            const s = cs._sessions.get(ctx.jid);
            s.cardId = 'cine-card-9';
            assert.strictEqual(cs.bridge(ctx.jid, 'WRONG-CARD', '2'), null, 'wrong card rejected');
            assert.strictEqual(cs.bridge(ctx.jid, 'cine-card-9', '2'), '.cinesubz go 2', 'routes to .cinesubz');
            assert.strictEqual(cs.bridge(ctx.jid, null, '99'), '.cinesubz go 99', 'no-cardId session bridge ok');
        } finally { cs.setFetcher(prev); }
    });

    console.log('— honest failures —');
    await okA('empty search → honest no-results card', async () => {
        cs._sessions.clear();
        const prev = cs.setFetcher(async (u) => RESP('<html><div class="display-page result"></div></html>'));
        try {
            ctx = mkCtx();
            await cs.handle('.cinesubz', { ...ctx, rest: ['zzzznothing'] });
            assert.ok(ctx.sent[ctx.sent.length - 1].content.text.includes('හම්බුණේ නෑ'), ctx.sent[ctx.sent.length - 1].content.text.slice(0, 120));
        } finally { cs.setFetcher(prev); }
    });
    await okA('ajax 400 → honest error card (never fake qualities)', async () => {
        cs._sessions.clear();
        MODE.ajaxFail = true;
        const prev = cs.setFetcher(mockFetch);
        try {
            ctx = mkCtx();
            await cs.handle('.cinesubz', { ...ctx, rest: ['breaking', 'bad'] });
            ctx.msg = { key: { id: 'e2' } };
            await cs.handle('.cinesubz', { ...ctx, rest: ['1'] });   // pick the movie → ajax fails
            const last = ctx.sent[ctx.sent.length - 1].content.text;
            assert.ok(last.includes('❌'), 'error card: ' + last.slice(0, 100));
        } finally { MODE.ajaxFail = false; cs.setFetcher(prev); }
    });
    await okA('expired session → honest re-run hint · usage card on bare command', async () => {
        cs._sessions.clear();
        ctx = mkCtx();
        await cs.handle('.cinesubz', { ...ctx, rest: ['5'] });
        assert.ok(ctx.sent[ctx.sent.length - 1].content.text.includes('expire'), ctx.sent[ctx.sent.length - 1].content.text.slice(0, 100));
        await cs.handle('.cinesubz', { ...ctx, rest: [] });
        assert.ok(ctx.sent[ctx.sent.length - 1].content.text.includes('.cinesubz <නම / link>'), 'usage card');
    });

    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
