/**
 * test_v283.js — .javdn: JavBus search → cover+details → magnets (javbus.com in-bot port)
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const hub = require('./animehub');
const pkg = require('./package.json');
const manifest = require('./manifest.json');
const botSrc = require('fs').readFileSync('./bot.js', 'utf8');

const JID = 'jv1@s.whatsapp.net';

// ───────── fixtures ─────────
const SEARCH_HTML = `<html><div id="waterfall"><div id="waterfall">
<div class="item"><a class="movie-box" href="https://www.javbus.com/TEST-001"><div class="photo-frame"><img src="/pics/thumb/a1.jpg" title="Test Movie One"></div><div class="photo-info"><span>Test Movie One<br /><date>TEST-001</date><date>2025-01-02</date></span></div><div class="item-tag"><button>高清</button><button>字幕</button></div></a></div>
<div class="item"><a class="movie-box" href="https://www.javbus.com/TEST-002"><div class="photo-frame"><img src="/pics/thumb/a2.jpg" title="Test Movie Two"></div><div class="photo-info"><span>Two<br /><date>TEST-002</date><date>2025-02-03</date></span></div></a></div>
</div></div></html>`;
const DETAIL_HTML = `<html><div class="container"><h3>TEST-001 Test Movie One Full Title</h3>
<div class="movie"><a class="bigImage" href="/pics/cover/test_b.jpg"><img src="/pics/cover/test_b.jpg"></a>
<div class="info"><p><span class="header">識別碼:</span> TEST-001</p>
<p><span class="header">發行日期:</span> 2025-01-02</p>
<p><span class="header">長度:</span> 120分鐘</p>
<p><span class="header">製作商:</span> <a href="/studio/XXX">Test Studio</a></p>
<p><span class="header">類別:</span> <span class="genre"><label><a href="/genre/g1">Genre One</a></label><label><a href="/genre/g2">Genre Two</a></label></span></p>
<p><span class="header">演員:</span> <span class="genre"><label><a href="/star/s1">Star One</a></label><label><a href="/star/s2">Star Two</a></label></span></p>
</div></div></div><script>var gid = 555111;var uc = 0;</script></html>`;
const MAGNETS_HTML = `<table>
<tr onmouseover="x"><td width="70%"><a href="magnet:?xt=urn:btih:AAAA111&dn=TEST-001">TEST-001 <a href="#">高清字幕</a> extra</a></td><td><a>2.02GB</a></td><td><a>2025-10-28</a></td></tr>
<tr><td><a href="magnet:?xt=urn:btih:BBBB222&dn=TEST-001">TEST-001-UC</a></td><td><a>6.48GB</a></td><td><a>2025-08-10</a></td></tr>
<tr><td>no magnet row</td></tr>
</table>`;
const EMPTY_SEARCH = '<html><div id="waterfall"></div></html>';
const COVER_BUF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// fetch mock routing on URL
function jvMock(over = {}) {
    return async (url, opts = {}) => {
        const u = String(url);
        const html = over.html || SEARCH_HTML;
        if (u.includes('/ajax/uncledatoolsbyajax.php')) {
            assert.ok((opts.headers || {}).Referer, 'magnets ajax needs Referer');
            return { ok: true, status: 200, text: async () => over.magnets ?? MAGNETS_HTML, headers: new Map() };
        }
        if (/javbus\.com\/TEST-[\w-]+$/.test(u)) return { ok: true, status: 200, text: async () => over.detail ?? DETAIL_HTML, headers: new Map() };
        if (u.includes('/search/')) {
            assert.ok((opts.headers || {}).Cookie?.includes('existmag=mag'), 'search needs existmag=mag cookie');
            return { ok: true, status: 200, text: async () => html, headers: new Map() };
        }
        if (u.includes('/pics/')) return { ok: true, status: 200, arrayBuffer: async () => COVER_BUF.buffer.slice(COVER_BUF.byteOffset, COVER_BUF.byteOffset + COVER_BUF.byteLength), headers: new Map() };
        throw new Error('jvMock unhandled URL: ' + u);
    };
}
const sendMock = (sent) => async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };

(async () => {
    console.log('— v2.83.0 pins —');
    ok('version + manifest', () => {
        assert.ok(['2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(/JAVDN|javbus/i.test(manifest.notes), 'notes');
        assert.ok(manifest.files.includes('test_v283.js'), 'files');
    });
    ok('exports + cards', () => {
        for (const f of ['jvSearch', 'jvDetail', 'jvMagnets', 'jvCover', 'jvGo']) assert.strictEqual(typeof hub[f], 'function', f);
        assert.ok(hub._cards.jvSearchCard && hub._cards.jvDetailCard && hub._cards.jvMagnetCard, 'cards');
    });
    ok('jvBytes parser', () => {
        assert.strictEqual(hub._cards ? 1 : 0, 1); // sanity guard
        const jb = (s) => { const m = /([\d.]+)\s*(TB|GB|MB|KB)/i.exec(s || ''); return m ? Math.round(parseFloat(m[1]) * { TB: 1099511627776, GB: 1073741824, MB: 1048576, KB: 1024 }[m[2].toUpperCase()]) : null; };
        assert.strictEqual(jb('2.02GB'), 2168958484);
        assert.strictEqual(jb('6.48GB'), 6957847020);
        assert.strictEqual(jb('700MB'), 734003200);
        assert.strictEqual(jb(''), null);
    });
    ok('bot.js wiring: HEAVY + menu', () => {
        assert.ok(/'\.javdn'/.test(botSrc), 'HEAVY');
        assert.ok(botSrc.includes('*.javdn') && botSrc.includes('javbus'), 'menu');
    });

    console.log('— parsers (fixtures) —');
    await okA('jvSearch: items → id/title/date/hd/sub', async () => {
        const orig = global.fetch;
        try { global.fetch = jvMock(); const list = await hub.jvSearch('TEST');
            assert.strictEqual(list.length, 2);
            assert.strictEqual(list[0].id, 'TEST-001'); assert.strictEqual(list[0].title, 'Test Movie One'); assert.strictEqual(list[0].date, '2025-01-02');
            assert.ok(list[0].hd && list[0].sub, 'tags row1');
            assert.strictEqual(list[1].id, 'TEST-002'); assert.ok(!list[1].hd && !list[1].sub, 'row2 no tags');
        } finally { global.fetch = orig; }
    });
    await okA('jvDetail: title/img/gid/uc/stars/genres/date/length/producer', async () => {
        const orig = global.fetch;
        try { global.fetch = jvMock(); const d = await hub.jvDetail('TEST-001');
            assert.strictEqual(d.title, 'TEST-001 Test Movie One Full Title');
            assert.strictEqual(d.img, 'https://www.javbus.com/pics/cover/test_b.jpg');
            assert.strictEqual(d.gid, '555111'); assert.strictEqual(d.uc, '0');
            assert.deepStrictEqual(d.stars, ['Star One', 'Star Two']);
            assert.deepStrictEqual(d.genres, ['Genre One', 'Genre Two']);
            assert.strictEqual(d.date, '2025-01-02'); assert.strictEqual(d.length, 120);
            assert.strictEqual(d.producer, 'Test Studio');
        } finally { global.fetch = orig; }
    });
    await okA('jvMagnets: rows → link/title/tags/size/date + no-magnet row skipped', async () => {
        const orig = global.fetch;
        try { global.fetch = jvMock(); const mags = await hub.jvMagnets('TEST-001', '555111', '0');
            assert.strictEqual(mags.length, 2, '3 rows → 2 magnets');
            assert.ok(mags[0].link.startsWith('magnet:?xt=urn:btih:AAAA111&dn=TEST-001'), mags[0].link);
            assert.strictEqual(mags[0].title, 'TEST-001 extra');   // nested tag anchor stripped
            assert.ok(mags[0].hd && mags[0].sub, 'tags from nested anchors');
            assert.strictEqual(mags[0].size, '2.02GB'); assert.strictEqual(mags[0].numberSize, 2168958484);
            assert.strictEqual(mags[0].date, '2025-10-28');
            assert.strictEqual(mags[1].title, 'TEST-001-UC'); assert.strictEqual(mags[1].numberSize, 6957847020);
        } finally { global.fetch = orig; }
    });
    await okA('jvMagnets: no gid → [] (no fetch)', async () => {
        const orig = global.fetch; let called = 0;
        try { global.fetch = async () => { called++; return { ok: true, status: 200, text: async () => '' }; };
            assert.deepStrictEqual(await hub.jvMagnets('X', null, '0'), []);
            assert.strictEqual(called, 0);
        } finally { global.fetch = orig; }
    });
    ok('jvMagnetCard: no-crash when mags passed separately (regression: d.magnets undefined)', () => {
        const d = { id: 'TEST-001' };
        const card = hub._cards.jvMagnetCard(d, [{ link: 'magnet:?xt=urn:btih:X1', size: '1GB', hd: true }]);
        assert.ok(card.includes('magnet:?xt=urn:btih:X1') && card.includes('1GB') && card.includes('HD'), card.slice(0, 80));
        assert.ok(hub._cards.jvMagnetCard(d, []).includes('— magnets'));
    });

    console.log('— session flow (cmd jv) —');
    await okA('.javdn search → card + session (cardId on menu card)', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = [];
            await hub.handle('.javdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['TEST'], react: async () => { } });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('JavBus — "TEST"') && card.includes('TEST-001') && card.includes('Test Movie One'), card.slice(0, 100));
            const s = hub._sessions.get(JID);
            assert.ok(s && s.cmd === 'jv' && s.stage === 'search' && s.items.length === 2, 'session stored');
            assert.strictEqual(s.cardId, 'K2', 'cardId = menu card');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('jvGo search pick → COVER image + details caption + gallery stage (cardId on image)', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = []; let nK = 0, imgKey = null;
            const send = async (j, c) => { const k = 'K' + (++nK); if (c.image) imgKey = k; sent.push({ k, c }); return { key: { id: k } }; };
            hub._sessions.set(JID, { cmd: 'jv', stage: 'search', items: [{ label: 'TEST-001', id: 'TEST-001' }], title: 'TEST', at: Date.now(), cardId: 'K1' });
            await hub.handle('.javdn', { send, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { } });
            const img = sent.find((x) => x.c.image);
            assert.ok(img, 'cover image sent');
            assert.strictEqual(img.c.caption.includes('TEST-001'), true, 'caption id');
            assert.ok(img.c.caption.includes('Star One') && img.c.caption.includes('120 min'), 'caption details');
            assert.ok(img.c.caption.includes('*1* — 🧲 magnets') && img.c.caption.includes('*2* — javbus link'), 'options');
            assert.strictEqual(img.k, imgKey);
            const s = hub._sessions.get(JID);
            assert.ok(s && s.stage === 'gallery' && s.cardId === imgKey, 'stage gallery + cardId on image');
            assert.strictEqual(s.magnets.length, 2, 'magnets cached in session');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('jvGo gallery 1 → magnet card + session cleared', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = [];
            hub._sessions.set(JID, { cmd: 'jv', stage: 'gallery', items: [{ label: 'magnets' }, { label: 'link' }], title: 'TEST-001', detail: { id: 'TEST-001', title: 'T' }, magnets: [{ link: 'magnet:?xt=urn:btih:AAAA111&dn=TEST-001', title: 'TEST-001 extra', size: '2.02GB', hd: true, sub: true, date: '2025-10-28' }, { link: 'magnet:?xt=urn:btih:BBBB222&dn=TEST-001', title: 'TEST-001-UC', size: '6.48GB', hd: false, sub: false, date: '2025-08-10' }], at: Date.now(), cardId: 'K1' });
            await hub.handle('.javdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '1'], react: async () => { } });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('🧲 *TEST-001* — magnets'), card.slice(0, 80));
            assert.ok(card.includes('magnet:?xt=urn:btih:AAAA111&dn=TEST-001') && card.includes('magnet:?xt=urn:btih:BBBB222&dn=TEST-001'), 'both links');
            assert.ok(card.includes('2.02GB · HD · 字幕') || (card.includes('2.02GB') && card.includes('HD') && card.includes('字幕')), 'tags');
            assert.ok(!hub._sessions.get(JID), 'session cleared');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('jvGo gallery 2 → javbus link card + cleared', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = [];
            hub._sessions.set(JID, { cmd: 'jv', stage: 'gallery', items: [{ label: 'magnets' }, { label: 'link' }], title: 'TEST-001', detail: { id: 'TEST-001' }, magnets: [], at: Date.now(), cardId: 'K1' });
            await hub.handle('.javdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { } });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('https://www.javbus.com/TEST-001'), card);
            assert.ok(!hub._sessions.get(JID), 'cleared');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('.javdn no results → honest miss card (no session)', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock({ html: EMPTY_SEARCH });
            const sent = [];
            await hub.handle('.javdn', { send: sendMock(sent), jid: 'jv2@s', msg: {}, rest: ['zzz'], react: async () => { } });
            assert.ok(sent.map((c) => c.text || '').join('\n').includes('හොයාගන්න බැරි'), 'miss card');
            assert.ok(!hub._sessions.get('jv2@s'), 'no session');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('jvGo out-of-range → friendly error', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = [];
            hub._sessions.set(JID, { cmd: 'jv', stage: 'search', items: [{ label: 'TEST-001', id: 'TEST-001' }], title: 'T', at: Date.now(), cardId: null });
            await hub.handle('.javdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '9'], react: async () => { } });
            assert.ok(sent.map((c) => c.text || '').join('\n').includes('අංකේ නෑ'), 'error card');
        } finally { global.fetch = orig; hub._reset(); }
    });

    console.log('— bridge + cross-delegation —');
    ok('bridge: jv session → .javdn go N (quote-enforced)', () => {
        hub._reset();
        hub._sessions.set(JID, { cmd: 'jv', stage: 'search', items: [{ label: 'a' }, { label: 'b' }], at: Date.now(), cardId: 'K2' });
        assert.strictEqual(hub.bridge(JID, 'K2', '1'), '.javdn go 1');
        assert.strictEqual(hub.bridge(JID, 'WRONG', '1'), null, 'wrong quote blocked');
        hub._reset();
    });
    await okA('cross-delegation: .javdn go on ep session → epGo runs', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = [];
            hub._sessions.set('x1@s', { cmd: 'ep', stage: 'search', items: [{ title: 'T', url: 'https://www.eporner.com/video-abc/' }], title: 'q', at: Date.now(), cardId: null });
            await hub.handle('.javdn', { send: sendMock(sent), jid: 'x1@s', msg: {}, rest: ['go', '1'], react: async () => { } });
            const all = sent.map((c) => (c.text || '') + (c.caption || '')).join('\n');
            assert.ok(all.includes('Eporner') || all.includes('quality'), 'ep flow: ' + all.slice(0, 100));
            assert.ok(!hub._sessions.get('x1@s')?.cmd || hub._sessions.get('x1@s').cmd !== 'jv', 'no jv session created');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('cross-delegation: .hentaiv go on jv session → hvGo runs', async () => {
        const orig = global.fetch; hub._reset();
        try {
            global.fetch = jvMock();
            const sent = [];
            hub._sessions.set('x2@s', { cmd: 'jv', stage: 'search', items: [{ label: 'TEST-001', id: 'TEST-001' }], title: 'T', at: Date.now(), cardId: null });
            await hub.handle('.hentaiv', { send: sendMock(sent), jid: 'x2@s', msg: {}, rest: ['go', '1'], react: async () => { } });
            const all = sent.map((c) => (c.text || '') + (c.caption || '')).join('\n');
            assert.ok(all.includes('JavBus') || all.includes('TEST-001'), 'jv flow ran: ' + all.slice(0, 100));
            assert.ok(hub._sessions.get('x2@s')?.cmd === 'jv', 'still jv session');
        } finally { global.fetch = orig; hub._reset(); }
    });

    console.log('— @live javbus.com real chain —');
    await okA('live search("SSIS") ≥ 1 rows', async () => {
        const list = await hub.jvSearch('SSIS');
        console.log('   →', list.length, 'rows, first', list[0] && list[0].id);
        assert.ok(list.length >= 1 && /^[A-Z]+-\d+$/i.test(list[0].id), 'id shape');
    });
    await okA('live detail + magnets + cover', async () => {
        const list = await hub.jvSearch('SSIS');
        const d = await hub.jvDetail(list[0].id);
        console.log('   →', d.id, 'gid', d.gid, 'stars', d.stars.slice(0, 2).join(','));
        assert.ok(d.gid, 'gid');
        const mags = await hub.jvMagnets(d.id, d.gid, d.uc);
        console.log('   → magnets', mags.length, 'first', mags[0] && mags[0].size);
        assert.ok(mags.length >= 1 && mags[0].link.startsWith('magnet:?xt=urn:btih:'), 'magnet link');
        if (d.img) { const b = await hub.jvCover(d.img); assert.ok(b.length > 10000 && b.slice(0, 2).toString('hex') === 'ffd8', 'cover jpeg ' + b.length); }
        else { console.log('   (no cover img — skipped)'); }
    });

    console.log(`\nv2.83 javdn: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
