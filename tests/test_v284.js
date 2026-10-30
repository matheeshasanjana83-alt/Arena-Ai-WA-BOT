/**
 * test_v284.js — ☁️ .terabox: TeraBox-Dl port (jsToken → share/list → dlink) + ndus cookie
 * Live probe facts (2026-10-20): anon list works (errno 0, metadata+thumbs); dlink needs valid ndus.
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const tb = require('../terabox');
const dl = require('../downloader');
const resolvers = require('../resolvers');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');
const dnSrc = fs.readFileSync('./downloader.js', 'utf8');

const JID = 'tb1@s.whatsapp.net';
const SETTINGS = require('path').join(__dirname, '..', 'settings.json');

// ───────── fixtures ─────────
const PAGE_HTML = `<html><body><script>try{fn%28%22TOKEN123ABCDEF%22%29}catch(e){}</script></body></html>`;
const PAGE_NO_TOK = '<html>captcha challenge</html>';
const FILE_ANON = { fs_id: '375033477530196', server_filename: 'video.mp4', size: '8071052', isdir: '0', path: '/2025-06-21 21-56/video.mp4', thumbs: { url3: 'https://data.terabox.app/thumbnail/big', url1: 'https://data.terabox.app/thumbnail/small' }, duration: 174, width: 352, height: 640, dlink: '' };
const LIST_ANON = { errno: 0, title: 'My Videos', uk: 4400609552707, share_id: 54404273244, list: [FILE_ANON] };
const LIST_CK = { errno: 0, title: 'My Videos', uk: 4400609552707, share_id: 54404273244, list: [{ ...FILE_ANON, dlink: 'https://d.terabox.app/file/1166e5?fid=1&sign=SDX' }] };
const LIST_MULTI = { errno: 0, title: 'Series Pack', uk: 4400609552707, share_id: 54404273244, list: [FILE_ANON, { ...FILE_ANON, fs_id: '222', server_filename: 'ep2.mp4', size: '104857600', dlink: 'https://d.terabox.app/file/ep2?sign=Y' }, { ...FILE_ANON, fs_id: '333', server_filename: 'sub.srt', size: '2048', width: 0, height: 0, duration: 0 }] };
const LIST_ERR = { errno: -9, list: [] };

// fetcher mock — routes on URL, records headers (terabox fetcher signature: (url, headersObject))
function tbMock({ page = PAGE_HTML, list = LIST_ANON, headersSeen = null } = {}) {
    let pageSurl = null;
    return async (url, h = {}) => {
        const u = String(url);
        if (headersSeen) headersSeen.push({ u, h });
        if (u.includes('/sharing/link?surl=')) {
            assert.ok(h['User-Agent'], 'page needs UA');
            pageSurl = new URL(u).searchParams.get('surl');
            return { ok: true, status: 200, text: async () => page, json: async () => { throw new Error('no json'); } };
        }
        if (u.includes('/share/list')) {
            assert.ok(h['User-Agent'] && h.Referer?.includes('/sharing/link?surl='), 'list needs UA+Referer');
            const q = new URL(u).searchParams;
            assert.strictEqual(q.get('app_id'), '250528', 'app_id');
            assert.strictEqual(q.get('web'), '1'); assert.strictEqual(q.get('channel'), 'dubox');
            assert.strictEqual(q.get('clienttype'), '0'); assert.strictEqual(q.get('root'), '1');
            assert.strictEqual(q.get('jsToken'), 'TOKEN123ABCDEF', 'token from page');
            const want = pageSurl && pageSurl.startsWith('1') ? pageSurl.slice(1) : pageSurl;
            assert.strictEqual(q.get('shorturl'), want, 'shorturl = surl minus leading 1');
            return { ok: true, status: 200, json: async () => list, text: async () => JSON.stringify(list) };
        }
        if (u.includes('terabox.app/thumbnail')) return { ok: true, status: 200, text: async () => 'img', json: async () => { } };
        throw new Error('tbMock unhandled URL: ' + u);
    };
}
const sendMock = (sent) => async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };

(async () => {
    console.log('— v2.84.0 pins —');
    ok('version + manifest + wiring greps', () => {
        assert.ok(['2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '3.02.0', '3.02.0', '3.02.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '3.02.0', '3.02.0', '3.02.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(/TERABOX/i.test(manifest.notes), 'notes');
        assert.ok(manifest.files.includes('terabox.js') && manifest.files.includes('tests/test_v284.js'), 'files');
        assert.ok(/'\.terabox'/.test(botSrc) && /'\.tbcookie'/.test(botSrc), 'HEAVY');
        assert.ok(botSrc.includes('terabox.bridge') && botSrc.includes('terabox.handle') && botSrc.includes('terabox.cmdCookie'), 'router');
        assert.ok(botSrc.includes('*.terabox <link>*'), 'menu');
        assert.ok((dnSrc.match(/tbx\(r/g) || []).length === 4, 'downloader cookie sites x4');
    });

    console.log('— surl + cookie —');
    ok('surlOf: multi-host shapes', () => {
        assert.strictEqual(tb.surlOf('https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g'), '1HSEb8PZRUE7Z1Tvd3ZtT0g');
        assert.strictEqual(tb.surlOf('https://www.terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g?saut=1'), '1HSEb8PZRUE7Z1Tvd3ZtT0g');
        assert.strictEqual(tb.surlOf('https://1024terabox.com/s/1abcDEF123?pwd=x'), '1abcDEF123');
        assert.strictEqual(tb.surlOf('https://teraboxshare.com/s/1xyz456'), '1xyz456');
        assert.strictEqual(tb.surlOf('https://terabox.app/surl/HSEb8PZRUE7Z1Tvd3ZtT0g?surl=HSEb8PZRUE7Z1Tvd3ZtT0g'), 'HSEb8PZRUE7Z1Tvd3ZtT0g');
        assert.strictEqual(tb.surlOf('https://evil.com/s/1HSEb8PZRUE7Z1Tvd3ZtT0g'), null, 'host gate');
        assert.strictEqual(tb.surlOf('https://terabox.app/downloads'), null, 'no /s/');
        assert.strictEqual(tb.surlOf('not a url'), null);
    });
    ok('ndus cookie save/read/clear (settings.json roundtrip, backup-restore)', () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8');
        try {
            tb.saveNdus('NDUS_TEST_1');
            assert.strictEqual(tb.readNdus(), 'NDUS_TEST_1');
            assert.ok(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).teraboxNdus === 'NDUS_TEST_1', 'persisted');
            tb.clearNdus();
            assert.strictEqual(tb.readNdus(), '');
        } finally { fs.writeFileSync(SETTINGS, backup); }
    });

    console.log('— shareList (fixtures) —');
    await okA('jsToken: page regex + honest error without token', async () => {
        let prev = tb.setFetcher(tbMock());
        try { assert.strictEqual(await tb.jsToken('1HSEb8PZRUE7Z1Tvd3ZtT0g'), 'TOKEN123ABCDEF'); } finally { tb.setFetcher(prev); }
        prev = tb.setFetcher(tbMock({ page: PAGE_NO_TOK }));
        try { await tb.jsToken('1HSEb8PZRUE7Z1Tvd3ZtT0g'); assert.fail('should throw'); }
        catch (e) { assert.ok(/jsToken/.test(e.message), e.message); }
        finally { tb.setFetcher(prev); }
    });
    await okA('shareList anon: files mapped, no dlink, hasCookie=false, URL contract asserted', async () => {
        const seen = []; const prev = tb.setFetcher(tbMock({ list: LIST_ANON, headersSeen: seen }));
        try {
            const info = await tb.shareList('1HSEb8PZRUE7Z1Tvd3ZtT0g');
            assert.strictEqual(info.title, 'My Videos'); assert.strictEqual(info.uk, '4400609552707');
            assert.strictEqual(info.files.length, 1);
            const f = info.files[0];
            assert.strictEqual(f.name, 'video.mp4'); assert.strictEqual(f.bytes, 8071052);
            assert.strictEqual(f.dlink, ''); assert.strictEqual(f.h, 640); assert.strictEqual(f.duration, 174);
            assert.strictEqual(f.thumb, 'https://data.terabox.app/thumbnail/big');
            assert.strictEqual(info.hasCookie, false);
            assert.ok(seen.every((s) => !s.h.Cookie), 'anon = no Cookie header');
        } finally { tb.setFetcher(prev); }
    });
    await okA('shareList + ndus: Cookie header sent → dlink present', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8');
        const seen = [];
        try {
            tb.saveNdus('NDUS_TEST_1');
            const prev = tb.setFetcher(tbMock({ list: LIST_CK, headersSeen: seen }));
            const info = await tb.shareList('1HSEb8PZRUE7Z1Tvd3ZtT0g');
            assert.ok(info.hasCookie, 'hasCookie');
            assert.ok(seen.some((s) => s.h.Cookie === 'ndus=NDUS_TEST_1'), 'Cookie header on list call');
            assert.strictEqual(info.files[0].dlink, 'https://d.terabox.app/file/1166e5?fid=1&sign=SDX');
            tb.setFetcher(prev);
        } finally { fs.writeFileSync(SETTINGS, backup); }
    });
    await okA('shareList errno != 0 → honest error', async () => {
        const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); });
        tb.setFetcher(tbMock({ list: LIST_ERR }));
        try { await tb.shareList('1HSEb8PZRUE7Z1Tvd3ZtT0g'); assert.fail('should throw'); }
        catch (e) { assert.ok(/errno -9/.test(e.message), e.message); }
        finally { tb.setFetcher(orig); }
    });

    console.log('— cards —');
    ok('infoCard: single w/o cookie → cookie help; with dlink → download note', () => {
        const info1 = { title: 'T', files: [{ name: 'video.mp4', bytes: 8071052, dlink: '', h: 640, duration: 174, w: 352 }], hasCookie: false };
        const c1 = tb.infoCard(info1);
        assert.ok(c1.includes('video.mp4') && c1.includes('7.7 MB') && c1.includes('480p') && c1.includes('2:54'), c1);
        assert.ok(c1.includes('.tbcookie') && c1.includes('ndus'), 'cookie help');
        const c2 = tb.infoCard({ ...info1, files: [{ ...info1.files[0], dlink: 'https://d.terabox.app/x' }] });
        assert.ok(c2.includes('එවනවා'), 'auto-download note');
    });
    ok('infoCard: multi-file rows + qres ladder', () => {
        const c = tb.infoCard({ title: 'Series Pack', files: [{ name: 'ep1.mp4', bytes: 8071052, dlink: '', h: 1080, duration: 174 }, { name: 'ep2.mp4', bytes: 104857600, dlink: '', h: 640 }, { name: 'sub.srt', bytes: 2048 }], hasCookie: true });
        assert.ok(c.includes('files: 3') && c.includes('ep2.mp4') && c.includes('1080p') && c.includes('go <N>'), c.slice(0, 120));
    });

    console.log('— resolvers + downloader cookie plumbing —');
    await okA('resolve(): terabox host → cookie attached / absent by ndus', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8');
        try {
            tb.clearNdus();
            const r0 = await resolvers.resolve('https://d.terabox.app/file/1166e5?fid=1&sign=SDX');
            assert.strictEqual(r0.kind, 'http'); assert.strictEqual(r0.cookie, undefined, 'no ndus → no cookie');
            tb.saveNdus('NDUS_TEST_1');
            const r1 = await resolvers.resolve('https://d.terabox.app/file/1166e5?fid=1&sign=SDX');
            assert.strictEqual(r1.cookie, 'ndus=NDUS_TEST_1', 'ndus → cookie');
            assert.strictEqual((await resolvers.resolve('https://www.terabox.app/s/1HSEb8/file?dlink=1')).cookie, 'ndus=NDUS_TEST_1');
        } finally { fs.writeFileSync(SETTINGS, backup); }
    });
    await okA('httpGet: Cookie header reaches the wire (local server 200/403)', async () => {
        const srv = http.createServer((req, res) => {
            if (req.headers.cookie === 'ndus=NDUS_WIRE') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('OKDATA'); }
            else { res.writeHead(403); res.end('NO'); }
        });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const port = srv.address().port;
        try {
            const good = await dl._httpGet(`http://127.0.0.1:${port}/f.bin`, 'UA', null, { Cookie: 'ndus=NDUS_WIRE' });
            assert.strictEqual(good.status, 200, 'with cookie → 200');
            assert.strictEqual(await good.text(), 'OKDATA');
            const bad = await dl._httpGet(`http://127.0.0.1:${port}/f.bin`, 'UA', null);
            assert.strictEqual(bad.status, 403, 'without → 403');
        } finally { srv.close(); }
    });

    console.log('— session flow (cmd .terabox) —');
    await okA('.terabox <link> single file + cookie → thumb image card + auto-download', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8'); const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); });
        tb._sessions.clear();
        try {
            tb.saveNdus('NDUS_TEST_1'); tb.setFetcher(tbMock({ list: LIST_CK }));
            const sent = []; let nK = 0, imgKey = null;
            const send = async (j, c) => { const k = 'K' + (++nK); if (c.image) imgKey = k; sent.push({ k, c }); return { key: { id: k } }; };
            const dled = [];
            await tb.handle('.terabox', { send, jid: JID, msg: {}, rest: ['https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g'], react: async () => { }, download: async (link, tag) => dled.push({ link, tag }) });
            const img = sent.find((x) => x.c.image);
            assert.ok(img, 'thumb image card');
            assert.ok(img.c.caption.includes('video.mp4') && img.c.caption.includes('එවනවා'), 'caption');
            assert.strictEqual(img.k, imgKey);
            assert.strictEqual(dled.length, 1, 'auto-download');
            assert.strictEqual(dled[0].link, 'https://d.terabox.app/file/1166e5?fid=1&sign=SDX');
            assert.strictEqual(dled[0].tag, '☁️ TeraBox');
            assert.ok(!tb._sessions.get(JID), 'session cleared after download');
        } finally { fs.writeFileSync(SETTINGS, backup); tb.setFetcher(orig); tb._sessions.clear(); }
    });
    await okA('.terabox single file no cookie → honest cookie card (no download)', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8'); const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); });
        tb._sessions.clear();
        try {
            tb.clearNdus(); tb.setFetcher(tbMock({ list: LIST_ANON }));
            const sent = []; const dled = [];
            await tb.handle('.terabox', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g'], react: async () => { }, download: async (l) => dled.push(l) });
            const card = sent.map((c) => (c.text || '') + (c.caption || '')).join('\n');
            assert.ok(card.includes('video.mp4') && card.includes('.tbcookie'), card.slice(0, 120));
            assert.strictEqual(dled.length, 0, 'no download without cookie');
            assert.ok(tb._sessions.get(JID), 'session kept (go 1 retry path)');
            assert.strictEqual(tb._sessions.get(JID)?.cardId, 'K2', 'cardId = edited card (or image) id');
        } finally { fs.writeFileSync(SETTINGS, backup); tb.setFetcher(orig); tb._sessions.clear(); }
    });
    await okA('.terabox multi-file → list card; go 2 → download dlink; out-of-range honest', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8'); const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); });
        tb._sessions.clear();
        try {
            tb.saveNdus('NDUS_TEST_1'); tb.setFetcher(tbMock({ list: LIST_MULTI }));
            const sent = [];
            await tb.handle('.terabox', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g'], react: async () => { }, download: async () => { } });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('Series Pack') && card.includes('ep2.mp4') && card.includes('100.0 MB') && card.includes('sub.srt'), card.slice(0, 150));
            const sent9 = [];
            await tb.handle('.terabox', { send: sendMock(sent9), jid: JID, msg: {}, rest: ['9'], react: async () => { }, download: async () => { } });
            assert.ok(sent9.map((c) => c.text || '').join('\n').includes('file එකක් නෑ'), 'range card');
            const dled = [];
            await tb.handle('.terabox', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async (l) => dled.push(l) });
            assert.strictEqual(dled.length, 1, 'go 2 → download');
            assert.strictEqual(dled[0], 'https://d.terabox.app/file/ep2?sign=Y', 'go 2 dlink (item 2 = ep2)');
        } finally { fs.writeFileSync(SETTINGS, backup); tb.setFetcher(orig); tb._sessions.clear(); }
    });
    await okA('.terabox go w/o dlink (no cookie) → 🔑 honest card; w/o session → expire card', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8'); const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); });
        tb._sessions.clear();
        try {
            tb.clearNdus(); tb.setFetcher(tbMock({ list: LIST_ANON }));
            const sent = [];
            await tb.handle('.terabox', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g'], react: async () => { }, download: async () => { } });
            await tb.handle('.terabox', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
            assert.ok(sent.map((c) => c.text || '').join('\n').includes('dlink එක එන්නේ නෑ'), 'no-dlink card');
            const sent2 = [];
            await tb.handle('.terabox', { send: sendMock(sent2), jid: 'nosesh@s', msg: {}, rest: ['go', '1'], react: async () => { } });
            assert.ok(sent2.map((c) => c.text || '').join('\n').includes('expire'), 'expire card');
        } finally { fs.writeFileSync(SETTINGS, backup); tb.setFetcher(orig); tb._sessions.clear(); }
    });
    await okA('.terabox no args → usage; bad host → honest card; errno → error card', async () => {
        const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); }); tb._sessions.clear();
        try {
            tb.setFetcher(tbMock({ list: LIST_ERR }));
            const sent = [];
            await tb.handle('.terabox', { send: sendMock(sent), jid: JID, msg: {}, rest: [], react: async () => { } });
            assert.ok(sent.map((c) => c.text || '').join('\n').includes('*.terabox <link>*'), 'usage');
            const sent2 = [];
            await tb.handle('.terabox', { send: sendMock(sent2), jid: JID, msg: {}, rest: ['https://mediafire.com/file/xyz'], react: async () => { } });
            assert.ok(sent2.map((c) => c.text || '').join('\n').includes('TeraBox link එකක් නෙවෙයි'), 'host gate');
            const sent3 = [];
            await tb.handle('.terabox', { send: sendMock(sent3), jid: JID, msg: {}, rest: ['https://terabox.app/s/1deadLINK9'], react: async () => { } });
            assert.ok(sent3.map((c) => c.text || '').join('\n').includes('errno -9'), 'errno card');
        } finally { tb.setFetcher(orig); tb._sessions.clear(); }
    });

    console.log('— bridge + .tbcookie —');
    ok('bridge: quote-enforced → .terabox go N', () => {
        tb._sessions.clear();
        tb._sessions.set(JID, { files: [{}], surl: 'x', at: Date.now(), cardId: 'K3' });
        assert.strictEqual(tb.bridge(JID, 'K3', '2'), '.terabox go 2');
        assert.strictEqual(tb.bridge(JID, 'WRONG', '2'), null, 'wrong quote blocked');
        assert.strictEqual(tb.bridge('other@s', 'K3', '2'), null, 'other jid → null');
        tb._sessions.clear();
    });
    await okA('.tbcookie: status / off / set+verify-OK / set+verify-FAIL', async () => {
        const backup = fs.readFileSync(SETTINGS, 'utf8'); const orig = tb.setFetcher(() => { throw new Error('fetcher unset in this test'); });
        try {
            tb.clearNdus();
            const sent = [];
            await tb.cmdCookie(sendMock(sent), JID, {}, '');
            assert.ok(sent[0].text.includes('❌ නෑ') && sent[0].text.includes('F12'), 'status card');
            await tb.cmdCookie(sendMock(sent), JID, {}, 'off');
            assert.ok(sent[1].text.includes('අයින්'), 'off card');
            tb.setFetcher(tbMock({ list: LIST_CK }));
            await tb.cmdCookie(sendMock(sent), JID, {}, 'NDUS_GOOD');
            assert.ok(sent[2].text.includes('LIVE verify OK'), 'verify ok');
            assert.strictEqual(tb.readNdus(), 'NDUS_GOOD');
            tb.setFetcher(tbMock({ list: LIST_ANON }));   // dlink empty = dead cookie
            await tb.cmdCookie(sendMock(sent), JID, {}, 'NDUS_DEAD');
            assert.ok(sent[3].text.includes('expire'), 'verify fail honest');
        } finally { fs.writeFileSync(SETTINGS, backup); tb.setFetcher(orig); }
    });

    console.log('— @live terabox.com real chain —');
    await okA('live shareList (anon): real file metadata, no dlink', async () => {
        const info = await tb.shareList('1HSEb8PZRUE7Z1Tvd3ZtT0g');
        console.log('   →', info.title, '| files:', info.files.length, '| f0:', info.files[0] && info.files[0].name, info.files[0] && info.files[0].bytes);
        assert.ok(info.files.length >= 1, 'files');
        assert.strictEqual(info.files[0].bytes, 8071052, 'size matches probe');
        assert.ok(info.files[0].name.includes('.mp4'), 'name');
        assert.ok(!info.files[0].dlink, 'anon = no dlink (honest)');
        assert.ok(info.files[0].thumb.startsWith('http'), 'thumb url');
    });

    console.log(`\nv2.84 terabox: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
