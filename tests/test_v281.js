/**
 * test_v281.js — .hentaimng/.hmanga (hitomi.la via node-hitomi port:
 * galleriesindex B-tree + nozomi + gg.js image URLs → pages as images)
 * Live checks @live (skipped when ARENA_OFFLINE=1).
 */
process.env.ARENA_NO_REACT = '1';
process.env.ARENA_HM_DELAY = '1';
const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); } };

const hub = require('../animehub');
const pkg = require('../package.json');
const manifest = require('../manifest.json');

// ── helpers ──
const termKey = (w) => crypto.createHash('sha256').update(w).digest().subarray(0, 4);
function buildNode(keys, datas, subs) {
    let size = 4;
    for (const k of keys) size += 4 + k.length;
    size += 4 + datas.length * 12 + 17 * 8;
    const buf = Buffer.alloc(size);
    buf.writeInt32BE(keys.length, 0);
    let o = 4;
    for (const k of keys) { buf.writeInt32BE(k.length, o); o += 4; Buffer.from(k).copy(buf, o); o += k.length; }
    buf.writeInt32BE(datas.length, o); o += 4;
    for (const [a, l] of datas) { buf.writeBigUInt64BE(BigInt(a), o); buf.writeInt32BE(l, o + 8); o += 12; }
    for (let i = 0; i < 17; i++) { buf.writeBigUInt64BE(BigInt(subs[i] || 0), o); o += 8; }
    return buf;
}
const idsBuf = (ids) => { const b = Buffer.alloc(ids.length * 4); ids.forEach((v, i) => b.writeInt32BE(v, i * 4)); return b; };
const GG_MOCK = "var o = 0;\nfunction m(c){switch(c){case 2878:case 2545:return !0}return !1}\nvar a = {b: '1792465201/'}";
const GJ = (g) => 'var galleryinfo = ' + JSON.stringify(g);
const galleryJson = (id, pages, extra = {}) => ({ id: String(id), type: 'doujinshi', language: 'english', language_localname: 'English', title: 'Test Manga ' + id, japanese_title: 'テスト' + id, artists: [{ artist: 'shindol' }], groups: [{ group: 'circle' }], parodys: [{ parody: 'naruto' }], characters: [], tags: [{ tag: 'sole female', female: 1 }, { tag: 'sole male', male: 1 }], files: pages.map((h, i) => ({ hash: h, name: String(i + 1).padStart(3, '0') + '.jpg', width: 1200, height: 1700, hasavif: 1 })), languages: [], related: [], blocked: 0, date: '2026-10-20 10:00:00-05:00', datepublished: '2026-10-20 10:00:00-05:00', videofilename: null, ...extra });
// normalized gallery (hmGallery output shape) for session.gallery fixtures
const normG = (id, hashes) => ({ ...galleryJson(id, hashes), pages: hashes.map((h) => ({ hash: h, w: 1200, h: 1700 })) });
const HASH1 = 'dc793712c5331440d39a79bd20f25e93f19127f889531445043eecaab1109f19';   // → code 0x9f1=2545 (in GG_MOCK codes → w2)
const HASH2 = 'ab113712c5331440d39a79bd20f25e93f19127f889531445043eecaab1109aa7';   // → '7aa' → 1962 (not in codes → w1)
const WEBP = Buffer.concat([Buffer.from('RIFF0000WEBPVP8 '), Buffer.alloc(64)]);
// root node via the CURRENT global.fetch mock (call after installing it)
const hitomiRoot = async () => { const r = await fetch('https://ltn.gold-usergeneratedcontent.net/galleriesindex/galleries.1792464791.index', { headers: { range: 'bytes=0-463' } }); return Buffer.from(await r.arrayBuffer()); };

// exact standalone-buffer response (Buffer.from(str).buffer is POOLED — must slice to exact bytes)
const R = (data, status = 200) => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    return { status, ok: status < 400, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), headers: { get: () => null } };
};

// shared mock router for the hitomi endpoints
function hitomiMock({ galleries = {}, extraIndex = null, tagSets = {}, latest = null } = {}) {
    const calls = [];
    const ks = [termKey('naruto'), termKey('kage')];
    let zi = 0; while (zi < 2 && hub.hmCmp(termKey('zzzz'), ks[zi]) === 1) zi++;   // walk stop index for 'zzzz'
    const subsArr = [];
    if (extraIndex) subsArr[zi] = 5000;                                            // subnode at the index walk lands on
    const root = buildNode(ks, [[100, 12], [200, 12]], subsArr);
    const sub = extraIndex || buildNode([termKey('zzzz')], [[300, 8]], []);
    const f = async (url, o = {}) => {
        const u = String(url);
        const range = String((o.headers || {}).range || '').replace(/^bytes=/, '');
        calls.push({ u, range });
        if (u.includes('/galleriesindex/version')) return R('1792464791');
        if (/galleriesindex\/galleries\.1792464791\.index/.test(u)) {
            if (range === '0-463') return R(root);
            if (range.startsWith('5000-')) return R(sub, 206);
        }
        if (/galleriesindex\/galleries\.1792464791\.data/.test(u)) {
            if (range === '104-111') return R(idsBuf([111001, 111002]), 206);   // [100,12]: start=104, end=100+12-1
            if (range === '204-211') return R(idsBuf([111002, 111003]), 206);
            if (range === '304-307') return R(idsBuf([111001]), 206);           // [300,8]: 1 id
            throw new Error('unexpected data range ' + range);
        }
        if (u.includes('/gg.js')) return R(GG_MOCK);
        for (const [id, g] of Object.entries(galleries)) {
            if (u.includes('/galleries/' + id + '.js')) return R(GJ(g));
        }
        for (const [path, ids] of Object.entries(tagSets)) {
            if (u.includes(path)) return R(idsBuf(ids));
        }
        if (u.includes('/n/index-all.nozomi') && latest) return R(idsBuf(latest));
        if (/w[12]\.gold-usergeneratedcontent\.net/.test(u)) return R(WEBP);
        throw new Error('unexpected url ' + u.slice(0, 120));
    };
    f.calls = calls;
    return f;
}

(async () => {
    console.log('— v2.81.0 .hentaimng/.hmanga: pins + structure —');
    ok('version 2.81 pins', () => {
        assert.ok(['2.81.0','2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '3.04.0', '3.04.0', '3.04.0'].includes(pkg.version), 'pkg: ' + pkg.version);
        assert.ok(['2.81.0','2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '3.04.0', '3.04.0', '3.04.0'].includes(manifest.version), 'manifest: ' + manifest.version);
        assert.ok(manifest.notes.includes('.hentaimng') && manifest.notes.includes('node-hitomi'), 'notes updated');
        assert.ok(manifest.files.includes('animehub.js') && manifest.files.includes('tests/test_v281.js'), 'files listed');
    });
    ok('hitomi exports + cards', () => {
        for (const k of ['hmGallery', 'hmSearch', 'hmList', 'hmImageUrl', 'hmImageCtx', 'hmNode', 'hmTermIds', 'hmNozomiIds', 'hmCmp']) assert.strictEqual(typeof hub[k], 'function', k);
        assert.ok(hub._cards.hmSearchCard && hub._cards.hmGalleryCard, 'cards exported');
    });
    ok('hmCmp byte order', () => {
        assert.strictEqual(hub.hmCmp(new Uint8Array([1, 2]), new Uint8Array([1, 2])), 0);
        assert.strictEqual(hub.hmCmp(new Uint8Array([1, 2]), new Uint8Array([1, 3])), -1);
        assert.strictEqual(hub.hmCmp(new Uint8Array([2]), new Uint8Array([1, 9])), 1);
        assert.strictEqual(hub.hmCmp(new Uint8Array([1]), new Uint8Array([1, 0])), -1);
    });

    console.log('— hmNode decode (synthetic 464-style node) —');
    ok('hmNode: keys/data/subnodes big-endian decode', () => {
        const k1 = termKey('naruto'), k2 = termKey('kage');
        const buf = buildNode([k1, k2], [[100, 8], [200, 4]], [0, 5000]);
        const n = hub.hmNode(buf);
        assert.strictEqual(n.ks.length, 2);
        assert.ok(Buffer.from(n.ks[0]).equals(Buffer.from(k1)), 'key0');
        assert.ok(Buffer.from(n.ks[1]).equals(Buffer.from(k2)), 'key1');
        assert.strictEqual(n.ds.length, 2);
        assert.strictEqual(n.ds[0][0], 100n);
        assert.strictEqual(n.ds[0][1], 8);
        assert.strictEqual(n.ds[1][0], 200n);
        assert.strictEqual(n.ds[1][1], 4);
        assert.strictEqual(n.ss.length, 17);
        assert.strictEqual(n.ss[1], 5000n);
        assert.strictEqual(n.ss[0], 0n);
    });

    console.log('— gg.js context + image URL —');
    await okA('hmImageCtx: gg.js parse (codes/o/epoch base)', async () => {
        const orig = global.fetch;
        try {
            global.fetch = hitomiMock();
            const c = await hub.hmImageCtx(true);
            assert.strictEqual(c.o, 0);
            assert.strictEqual(c.b, '1792465201/');
            assert.ok(c.codes.has(2878) && c.codes.has(2545), 'codes parsed');
        } finally { global.fetch = orig; }
    });
    await okA('hmImageUrl: nxor subdomain + epoch base path (live-verified scheme)', async () => {
        const orig = global.fetch;
        try {
            global.fetch = hitomiMock();
            const url1 = await hub.hmImageUrl(HASH1);   // code 2545 IN codes, o=0 → isSuffix=true → true===true → w2
            assert.ok(url1.startsWith('https://w2.gold-usergeneratedcontent.net/1792465201/2545/'), url1);
            assert.ok(url1.endsWith(HASH1 + '.webp'), 'webp ext');
            const url2 = await hub.hmImageUrl(HASH2);   // code 1962 NOT in codes → false===true → w1
            assert.ok(url2.startsWith('https://w1.gold-usergeneratedcontent.net/1792465201/1962/'), url2);
        } finally { global.fetch = orig; }
    });

    console.log('— hmGallery + hmTermIds (B-tree) —');
    await okA('hmGallery: .js slice → normalized fields', async () => {
        const orig = global.fetch;
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1, HASH2]) } });
            const g = await hub.hmGallery(111001);
            assert.strictEqual(g.id, 111001);
            assert.strictEqual(g.title, 'Test Manga 111001');
            assert.strictEqual(g.jp, 'テスト111001');
            assert.strictEqual(g.type, 'doujinshi');
            assert.strictEqual(g.lang, 'english');
            assert.deepStrictEqual(g.artists, ['shindol']);
            assert.deepStrictEqual(g.series, ['naruto']);
            assert.deepStrictEqual(g.tags, ['♀ sole female', '♂ sole male']);
            assert.strictEqual(g.pages.length, 2);
            assert.strictEqual(g.blocked, false);
            assert.strictEqual(g.date, '2026-10-20');
        } finally { global.fetch = orig; }
    });
    await okA('hmTermIds: root hit → data range ids (big-endian)', async () => {
        const orig = global.fetch;
        try {
            const f = hitomiMock();
            global.fetch = f;
            const ids = await hub.hmTermIds('1792464791', 'naruto', hub.hmNode(await hitomiRoot()));
            assert.deepStrictEqual(ids, [111001, 111002]);
            assert.ok(f.calls.some((c) => c.range === '104-111'), 'data range addr+4..addr+4+len-1');
        } finally { global.fetch = orig; }
    });
    await okA('hmTermIds: miss at root → descend subnode → hit', async () => {
        const orig = global.fetch;
        try {
            const f = hitomiMock({ extraIndex: buildNode([termKey('zzzz')], [[300, 8]], []) });
            global.fetch = f;
            const ids = await hub.hmTermIds('1792464791', 'zzzz', hub.hmNode(await hitomiRoot()));
            assert.deepStrictEqual(ids, [111001]);
            assert.ok(f.calls.some((c) => c.range.startsWith('5000-')), 'subnode fetched');
        } finally { global.fetch = orig; }
    });
    await okA('hmTermIds: total miss → []', async () => {
        const orig = global.fetch;
        try {
            const f = hitomiMock();
            global.fetch = f;
            const ids = await hub.hmTermIds('1792464791', 'nothere', hub.hmNode(await hitomiRoot()));
            assert.deepStrictEqual(ids, []);
        } finally { global.fetch = orig; }
    });

    console.log('— hmSearch: words AND / tags / latest —');
    await okA('hmSearch: 2 words → intersection keeps first-word order', async () => {
        const orig = global.fetch;
        try {
            global.fetch = hitomiMock();
            const ids = await hub.hmSearch('naruto kage');
            assert.deepStrictEqual(ids, [111002]);   // [111001,111002] ∩ [111002,111003]
        } finally { global.fetch = orig; }
    });
    await okA('hmSearch: artist: tag → nozomi path', async () => {
        const orig = global.fetch;
        try {
            const f = hitomiMock({ tagSets: { '/n/artist/shindol-all.nozomi': [111001] }, galleries: { 111001: galleryJson(111001, [HASH1]) } });
            global.fetch = f;
            const ids = await hub.hmSearch('artist:shindol');
            assert.deepStrictEqual(ids, [111001]);
            assert.ok(f.calls.some((c) => c.u.includes('/n/artist/shindol-all.nozomi')), 'nozomi path');
        } finally { global.fetch = orig; }
    });
    await okA('hmSearch: male:/female: → tag/ prefix + parody→series alias', async () => {
        const orig = global.fetch;
        try {
            const f = hitomiMock({ tagSets: { '/n/tag/male:sole%20male-all.nozomi': [111001], '/n/series/naruto-all.nozomi': [111001] } });
            global.fetch = f;
            await hub.hmSearch('male:sole_male');
            await hub.hmSearch('parody:naruto');
            assert.ok(f.calls.some((c) => c.u.includes('/n/tag/male:sole%20male-all.nozomi')), 'male area: ' + f.calls.map((c) => c.u).join('|'));
            assert.ok(f.calls.some((c) => c.u.includes('/n/series/naruto-all.nozomi')), 'parody→series');
        } finally { global.fetch = orig; }
    });
    await okA('hmSearch: bare → index-all latest first 30', async () => {
        const orig = global.fetch;
        try {
            const f = hitomiMock({ latest: [222001, 222002, 222003] });
            global.fetch = f;
            const ids = await hub.hmSearch('');
            assert.deepStrictEqual(ids, [222001, 222002, 222003]);
            assert.ok(f.calls.some((c) => c.u.includes('/n/index-all.nozomi')), 'latest nozomi');
        } finally { global.fetch = orig; }
    });
    await okA('hmList: ≤10, blocked filtered', async () => {
        const orig = global.fetch;
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1, HASH2]), 111002: galleryJson(111002, [HASH1], { blocked: 1 }) } });
            const list = await hub.hmList('naruto');
            assert.strictEqual(list.length, 1, 'blocked filtered: ' + list.length);
            assert.strictEqual(list[0].id, 111001);
        } finally { global.fetch = orig; }
    });

    console.log('— session flow (cmd hm) —');
    await okA('.hmanga search → card + session + cardId', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1, HASH2]), 111002: galleryJson(111002, [HASH1], { blocked: 1 }) } });
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            await hub.handle('.hmanga', { send, jid: 'h1@s', msg: {}, rest: ['naruto'], react: async () => { } });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('Hitomi — "naruto"'), card.slice(0, 80));
            assert.ok(card.includes('Test Manga 111001') && card.includes('doujinshi · english · 2p') && card.includes('shindol'), 'row meta');
            const s = hub._sessions.get('h1@s');
            assert.ok(s && s.cmd === 'hm' && s.stage === 'search' && s.items.length === 1, 'session stored');
            assert.strictEqual(s.cardId, 'K2', 'cardId = menu card (K1 bubble, K2 card)');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('hmGo search pick → cover image + gallery stage (cardId on image)', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1, HASH2]) } });
            let sent = [], nK = 0, imgKey = null;
            const send = async (j, c) => { const k = 'K' + (++nK); if (c.image) imgKey = k; sent.push({ k, c }); return { key: { id: k } }; };
            hub._sessions.set('h2@s', { cmd: 'hm', stage: 'search', items: [{ label: 'Test Manga 111001', id: 111001 }], title: 'naruto', at: Date.now(), cardId: 'K1' });
            await hub.handle('.hentaimng', { send, jid: 'h2@s', msg: {}, rest: ['go', '1'], react: async () => { } });
            const img = sent.find((x) => x.c.image);
            assert.ok(img, 'cover image sent');
            assert.ok(img.c.caption.includes('Test Manga 111001') && img.c.caption.includes('2 pages'), 'details caption');
            assert.ok(img.c.caption.includes('*1* — pages') && img.c.caption.includes('*2* — link'), 'options');
            const s = hub._sessions.get('h2@s');
            assert.ok(s && s.stage === 'gallery' && s.gallery && s.gallery.pages.length === 2, 'gallery stage');
            assert.strictEqual(s.cardId, imgKey, 'cardId = cover image key');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('hmGo gallery 1 → pages sent sequential + summary + session cleared', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1, HASH2]) } });
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set('h3@s', { cmd: 'hm', stage: 'gallery', items: [{ label: 'pages' }, { label: 'link' }], title: 'Test Manga 111001', gallery: normG(111001, [HASH1, HASH2]), at: Date.now(), cardId: 'K1' });
            await hub.handle('.hmanga', { send, jid: 'h3@s', msg: {}, rest: ['go', '1'] });
            const imgs = sent.filter((c) => c.image);
            assert.strictEqual(imgs.length, 2, '2 pages: ' + imgs.length);
            assert.ok(imgs[0].caption && imgs[0].caption.includes('1/2'), 'first page captioned');
            assert.ok(!imgs[1].caption, 'second page uncaptioned (<10)');
            const summary = sent.find((c) => c.text && c.text.includes('pages 2/2'));
            assert.ok(summary, 'summary sent');
            assert.ok(hub._sessions.has('h3@s'), 'session ALIVE (v2.90 keep-alive)');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('hmGo gallery 2 → link text + session cleared', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set('h4@s', { cmd: 'hm', stage: 'gallery', items: [{ label: 'pages' }, { label: 'link' }], title: 'T', gallery: normG(111001, [HASH1]), at: Date.now(), cardId: 'K1' });
            await hub.handle('.hmanga', { send, jid: 'h4@s', msg: {}, rest: ['go', '2'] });
            assert.ok(sent.some((c) => c.text && c.text.includes('hitomi.la/galleries/111001.html')), 'gallery link');
            assert.ok(hub._sessions.has('h4@s'), 'alive (v2.90 keep-alive)');
        } finally { hub._reset(); }
    });
    await okA('.hmanga no results → honest miss card', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = hitomiMock({ galleries: {} });
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            await hub.handle('.hmanga', { send, jid: 'h5@s', msg: {}, rest: ['nothere'], react: async () => { } });
            assert.ok(sent.some((c) => c.text && c.text.includes('හොයාගන්න බැරි වුණා (hitomi.la)')), 'miss card');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('.hmanga go N out of range → friendly error', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' } }; };
            hub._sessions.set('h6@s', { cmd: 'hm', stage: 'search', items: [{ label: 'T', id: 1 }], title: 'q', at: Date.now(), cardId: null });
            await hub.handle('.hentaimng', { send, jid: 'h6@s', msg: {}, rest: ['go', '9'] });
            assert.ok(sent.some((c) => c.text && c.text.includes('අංකේ නෑ')), 'range error');
            assert.ok(hub._sessions.has('h6@s'), 'session kept');
        } finally { hub._reset(); }
    });

    console.log('— session cmd routing —');
    ok('bridge: hm session → .hentaimng go N', () => {
        hub._reset();
        hub._sessions.set('r1@s', { cmd: 'hm', stage: 'search', items: [{ label: 'x', id: 1 }], title: 'T', at: Date.now(), cardId: 'C1' });
        hub._sessions.set('r1b@s', { cmd: 'hv', stage: 'quality', items: [{ label: 'x', src: 'u' }], title: 'T', at: Date.now(), cardId: 'C9' });
        hub._sessions.set('r1c@s', { cmd: 'ep', stage: 'quality', items: [{ label: 'x', src: 'u' }], title: 'T', at: Date.now(), cardId: 'C8' });
        assert.strictEqual(hub.bridge('r1@s', 'C1', '2'), '.hentaimng go 2');
        assert.strictEqual(hub.bridge('r1b@s', 'C9', '1'), '.hentaiv go 1');
        assert.strictEqual(hub.bridge('r1c@s', 'C8', '3'), '.ep go 3');
    });
    await okA('.hentaimng go on ep session → epGo runs (cross-delegation)', async () => {
        hub._reset();
        try {
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('r2@s', { cmd: 'ep', stage: 'quality', items: [{ label: '1080p HD', src: 'https://vid-x-cdn.eporner.com/v2/t/1-1080p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'C2' });
            await hub.handle('.hentaimng', { send, jid: 'r2@s', msg: {}, rest: ['go', '1'], download });
            assert.strictEqual(dlArgs.length, 1, 'ep flow ran via .hentaimng go');
            assert.strictEqual(dlArgs[0].tag, '🔞 Eporner');
        } finally { hub._reset(); }
    });
    await okA('.ep go on hm session → hmGo runs (cross-delegation back)', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1]) } });
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('r3@s', { cmd: 'hm', stage: 'gallery', items: [{ label: 'pages' }, { label: 'link' }], title: 'T', gallery: normG(111001, [HASH1, HASH2]), at: Date.now(), cardId: 'C3' });
            await hub.handle('.ep', { send, jid: 'r3@s', msg: {}, rest: ['go', '2'], download });
            assert.strictEqual(dlArgs.length, 0, 'link option has no download');
            assert.ok(sent.some((c) => c.text && c.text.includes('111001.html')), 'hm link flow ran via .ep go');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('.aniworld go on hm session → hmGo runs', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = hitomiMock({ galleries: { 111001: galleryJson(111001, [HASH1]) } });
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set('r4@s', { cmd: 'hm', stage: 'gallery', items: [{ label: 'pages' }, { label: 'link' }], title: 'T', gallery: normG(111001, [HASH1, HASH2]), at: Date.now(), cardId: 'C4' });
            await hub.handle('.aniworld', { send, jid: 'r4@s', msg: {}, rest: ['go', '1'] });
            const imgs = sent.filter((c) => c.image);
            assert.strictEqual(imgs.length, 2, 'pages flow ran via .aniworld go');
        } finally { global.fetch = orig; hub._reset(); }
    });

    console.log('— bot.js wiring —');
    ok('router: HEAVY + menu + bridge chain intact', () => {
        const src = fs.readFileSync('./bot.js', 'utf8');
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.hentaimng'/.test(src), 'HEAVY has .hentaimng');
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.hmanga'/.test(src), 'HEAVY has .hmanga');
        assert.ok(src.includes('*.hentaimng <name>* — 🔞 hitomi manga'), 'menu Tools line');
        assert.ok(src.includes('animehub.bridge'), 'bridge chain intact');
    });

    console.log('— @live hitomi.la real chain —');
    if (!process.env.ARENA_OFFLINE) {
        await okA('live hmSearch("naruto") ≥ 1 ids', async () => {
            const ids = await hub.hmSearch('naruto');
            assert.ok(ids.length >= 1, 'ids: ' + ids.length);
            console.log('   → ' + ids.length + ' ids, first ' + ids[0]);
        });
        await okA('live bare search (latest) ≥ 1', async () => {
            const ids = await hub.hmSearch('');
            assert.ok(ids.length >= 1, 'ids: ' + ids.length);
        });
        await okA('live hmList("naruto") → rows with title + pages', async () => {
            const list = await hub.hmList('naruto');
            assert.ok(list.length >= 1, 'rows: ' + list.length);
            const g = list[0];
            assert.ok(g.title && g.pages.length > 0, 'meta ok');
            console.log('   → "' + g.title.slice(0, 50) + '" · ' + g.type + ' · ' + g.lang + ' · ' + g.pages.length + 'p');
        });
        await okA('live page image: URL → 200 WEBP magic', async () => {
            const list = await hub.hmList('naruto');
            const g = list[0];
            const buf = await hub.hmImageBuf(g.pages[0].hash);
            assert.ok(buf.byteLength > 10000, 'bytes: ' + buf.byteLength);
            assert.strictEqual(buf.subarray(8, 12).toString(), 'WEBP', 'webp magic');
            console.log('   → ' + buf.byteLength + 'B webp');
        });
        await okA('live tag search: artist:shindol ≥ 1', async () => {
            const ids = await hub.hmSearch('artist:shindol');
            assert.ok(ids.length >= 1, 'ids: ' + ids.length);
        });
    } else console.log('  (ARENA_OFFLINE=1 — live skipped)');

    console.log(`\nv2.81 hitomi: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
