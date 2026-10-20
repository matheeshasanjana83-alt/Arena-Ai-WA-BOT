/**
 * test_v280.js — .ep/.eporner (Eporner official API v2: search → quality menu → file)
 * Live checks @live (skipped when ARENA_OFFLINE=1).
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); } };

const hub = require('./animehub');
const pkg = require('./package.json');
const manifest = require('./manifest.json');

(async () => {
    console.log('— v2.80.0 .ep/.eporner: pins + structure —');
    ok('version 2.80 pins', () => {
        assert.ok(['2.80.0', '2.81.0'].includes(pkg.version), 'pkg: ' + pkg.version);
        assert.ok(['2.80.0', '2.81.0'].includes(manifest.version), 'manifest: ' + manifest.version);
        assert.ok(manifest.notes.includes('.ep/.eporner') && manifest.notes.includes('eporner/API'), 'notes updated');
        assert.ok(manifest.files.includes('animehub.js') && manifest.files.includes('test_v280.js'), 'files listed');
    });
    ok('eporner exports + cards', () => {
        assert.strictEqual(typeof hub.searchEP, 'function');
        assert.strictEqual(typeof hub.qualitiesEP, 'function');
        assert.strictEqual(typeof hub.epCalcHash, 'function');
        assert.strictEqual(typeof hub.epVideoId, 'function');
        assert.ok(hub._cards.epSearchCard && hub._cards.epQCard, 'cards exported');
    });

    console.log('— calcHash (site scheme) + id extraction —');
    ok('epCalcHash known vector (live-recon 2026-10-20)', () => {
        assert.strictEqual(hub.epCalcHash('4025397e83917625b970a5489d4a1450'), 'hsqav210i74th1fgb42017n4b4g');
        assert.strictEqual(hub.epCalcHash('00000000000000000000000000000000'), '0000');
    });
    ok('epVideoId: video- / hd-porn / embed / non-eporner', () => {
        assert.strictEqual(hub.epVideoId('https://www.eporner.com/video-MqUKATM9kZ3/slug/'), 'MqUKATM9kZ3');
        assert.strictEqual(hub.epVideoId('https://www.eporner.com/hd-porn/AbCdEf123/x/'), 'AbCdEf123');
        assert.strictEqual(hub.epVideoId('https://www.eporner.com/embed/IVGbf9PHS6M/'), 'IVGbf9PHS6M');
        assert.strictEqual(hub.epVideoId('https://example.com/video-xyz/'), '');
        assert.strictEqual(hub.epVideoId(''), '');
    });

    console.log('— searchEP mocked —');
    await okA('searchEP: API JSON → ≤10 mapped items (empty title filtered)', async () => {
        const orig = global.fetch;
        try {
            global.fetch = async (url) => {
                const u = String(url);
                assert.ok(u.includes('/api/v2/video/search/'), 'API url: ' + u.slice(0, 90));
                assert.ok(/query=anime%20parody|query=anime\+parody/.test(u), 'query encoded: ' + u.slice(0, 100));
                return { ok: true, status: 200, json: async () => ({ total_count: 2, videos: [
                    { id: 'A1', title: 'Video One', url: 'https://www.eporner.com/video-A1/one/', length_min: '5:00', views: 1234 },
                    { id: 'B2', title: '', url: 'https://www.eporner.com/video-B2/x/' },
                    { id: 'C3', title: 'Video Three', url: 'https://www.eporner.com/video-C3/three/', length_min: '12:26', views: 105 },
                ] }) };
            };
            const l = await hub.searchEP('anime parody');
            assert.strictEqual(l.length, 2, 'filtered: ' + l.length);
            assert.strictEqual(l[0].title, 'Video One');
            assert.strictEqual(l[1].len, '12:26');
            assert.ok(l[0].url.includes('/video-A1/'));
        } finally { global.fetch = orig; }
    });
    await okA('searchEP: HTTP error → throws', async () => {
        const orig = global.fetch;
        try {
            global.fetch = async () => ({ ok: false, status: 503 });
            await assert.rejects(() => hub.searchEP('x'), /HTTP 503/);
        } finally { global.fetch = orig; }
    });

    console.log('— qualitiesEP mocked (page → hash → xhr → HEAD sizes) —');
    await okA('qualitiesEP full chain mocked: labels + bytes + sort', async () => {
        const orig = global.fetch;
        try {
            const pageHtml = '<meta property="og:title" content="Test Video"/><script>var hash = "4025397e83917625b970a5489d4a1450";</script>';
            const xhrJson = { available: true, sources: { mp4: {
                '240p': { src: 'https://vid-x-cdn.eporner.com/v2/t/1-240p.mp4' },
                '1080p HD': { src: 'https://vid-x-cdn.eporner.com/v2/t/1-1080p.mp4' },
                '720p HD': { src: 'https://vid-x-cdn.eporner.com/v2/t/1-720p.mp4' },
                bad: {},
            } } };
            global.fetch = async (url, o = {}) => {
                const u = String(url);
                if (/eporner\.com\/video-/.test(u)) return { ok: true, status: 200, text: async () => pageHtml };
                if (/\/xhr\/video\//.test(u)) {
                    assert.ok(/hash=hsqav210i74th1fgb42017n4b4g/.test(u), 'calcHash in xhr url: ' + u.slice(0, 110));
                    assert.ok(String((o.headers || {}).referer || '').includes('/video-'), 'xhr referer = page url');
                    return { ok: true, status: 200, json: async () => xhrJson };
                }
                if (/cdn\.eporner\.com/.test(u)) {
                    assert.strictEqual(o.method, 'HEAD', 'size probe = HEAD');
                    const len = u.includes('1080p') ? '300000000' : u.includes('720p') ? '150000000' : '40000000';
                    return { ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? len : null) } };
                }
                throw new Error('unexpected ' + u);
            };
            const r = await hub.qualitiesEP('https://www.eporner.com/video-Z9/test/');
            assert.strictEqual(r.title, 'Test Video');
            assert.strictEqual(r.sources.length, 3, 'empty-src entries dropped: ' + r.sources.length);
            assert.strictEqual(r.sources[0].label, '1080p HD');
            assert.strictEqual(r.sources[0].bytes, 300000000, 'sorted best-first');
            assert.strictEqual(r.sources[2].label, '240p');
            assert.ok(r.sources[0].src.endsWith('.mp4'));
        } finally { global.fetch = orig; }
    });
    await okA('qualitiesEP: no hash on page → honest error', async () => {
        const orig = global.fetch;
        try {
            global.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>no hash here</html>' });
            await assert.rejects(() => hub.qualitiesEP('https://www.eporner.com/video-Z9/x/'), /hash/);
        } finally { global.fetch = orig; }
    });
    await okA('qualitiesEP: available:false → honest error', async () => {
        const orig = global.fetch;
        try {
            const pageHtml = '<meta property="og:title" content="T"/><script>var hash = "4025397e83917625b970a5489d4a1450";</script>';
            global.fetch = async (url) => {
                const u = String(url);
                if (/\/xhr\/video\//.test(u)) return { ok: true, status: 200, json: async () => ({ available: false, message: 'removed video' }) };
                return { ok: true, status: 200, text: async () => pageHtml };
            };
            await assert.rejects(() => hub.qualitiesEP('https://www.eporner.com/video-Z9/x/'), /removed video/);
        } finally { global.fetch = orig; }
    });

    console.log('— session flow (cmd ep) —');
    await okA('handleEP search → session cmd ep + search card + cardId', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            global.fetch = async (url) => {
                assert.ok(String(url).includes('/api/v2/video/search/'), 'search API hit');
                return { ok: true, status: 200, json: async () => ({ videos: [
                    { id: 'A1', title: 'Video One', url: 'https://www.eporner.com/video-A1/one/', length_min: '5:00', views: 1234 },
                ] }) };
            };
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            await hub.handle('.ep', { send, jid: 'e1@s', msg: {}, rest: ['parody'], react: async () => { } });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('Eporner — "parody"'), card.slice(0, 90));
            assert.ok(card.includes('Video One') && card.includes('5:00'), 'title + length');
            assert.ok(card.includes('1.2K views'), 'views humanized');
            const s = hub._sessions.get('e1@s');
            assert.ok(s && s.cmd === 'ep' && s.stage === 'search' && s.items.length === 1, 'session stored');
            assert.strictEqual(s.cardId, 'K2', 'cardId = menu card key (K1 bubble, K2 card)');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('epGo: search pick → quality card → quality pick → download', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            const pageHtml = '<meta property="og:title" content="Test Video"/><script>var hash = "4025397e83917625b970a5489d4a1450";</script>';
            const xhrJson = { available: true, sources: { mp4: { '1080p HD': { src: 'https://vid-x-cdn.eporner.com/v2/t/1-1080p.mp4' } } } };
            global.fetch = async (url) => {
                const u = String(url);
                if (/eporner\.com\/video-/.test(u)) return { ok: true, status: 200, text: async () => pageHtml };
                if (/\/xhr\/video\//.test(u)) return { ok: true, status: 200, json: async () => xhrJson };
                if (/cdn\.eporner\.com/.test(u)) return { ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? '300000000' : null) } };
                throw new Error('unexpected ' + u);
            };
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('e2@s', { cmd: 'ep', stage: 'search', items: [{ label: 'Video One', url: 'https://www.eporner.com/video-A1/one/', title: 'Video One' }], title: 'parody', at: Date.now(), cardId: null });
            await hub.handle('.eporner', { send, jid: 'e2@s', msg: {}, rest: ['go', '1'], download });
            const card = sent.map((c) => c.text || '').join('\n');
            assert.ok(card.includes('quality එක තෝරන්න'), 'quality card');
            assert.ok(card.includes('1080p HD') && card.includes('286 MB'), 'label + size: ' + card.slice(0, 160));
            const s = hub._sessions.get('e2@s');
            assert.ok(s && s.stage === 'quality', 'stage advanced');
            await hub.handle('.ep', { send, jid: 'e2@s', msg: {}, rest: ['go', '1'], download });
            assert.strictEqual(dlArgs.length, 1, 'download called');
            assert.ok(dlArgs[0].link.includes('1-1080p.mp4'));
            assert.strictEqual(dlArgs[0].tag, '🔞 Eporner');
            assert.ok(!hub._sessions.has('e2@s'), 'session cleared after pick');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('epGo without download fn → link text (graceful)', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set('e3@s', { cmd: 'ep', stage: 'quality', items: [{ label: '720p HD', src: 'https://vid-x-cdn.eporner.com/v2/t/1-720p.mp4', bytes: 50 }], title: 'T', at: Date.now(), cardId: null });
            await hub.handle('.ep', { send, jid: 'e3@s', msg: {}, rest: ['go', '1'] });
            assert.ok(sent.some((c) => c.text && c.text.includes('1-720p.mp4')), 'link fallback sent');
        } finally { hub._reset(); }
    });
    await okA('.ep without args → usage card', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' } }; };
            await hub.handle('.ep', { send, jid: 'e4@s', msg: {}, rest: [] });
            assert.ok(sent.some((c) => c.text && c.text.includes('.ep <query>') && c.text.includes('.eporner')), 'usage');
        } finally { hub._reset(); }
    });
    await okA('.ep go N out of range → friendly error', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' } }; };
            hub._sessions.set('e5@s', { cmd: 'ep', stage: 'search', items: [{ label: 'V', url: 'https://www.eporner.com/video-A1/one/', title: 'V' }], title: 'q', at: Date.now(), cardId: null });
            await hub.handle('.ep', { send, jid: 'e5@s', msg: {}, rest: ['go', '9'] });
            assert.ok(sent.some((c) => c.text && c.text.includes('අංකේ නෑ')), 'range error');
            assert.ok(hub._sessions.has('e5@s'), 'session kept');
        } finally { hub._reset(); }
    });

    console.log('— session cmd routing —');
    ok('bridge: ep session → .ep go N', () => {
        hub._reset();
        hub._sessions.set('r1@s', { cmd: 'ep', stage: 'quality', items: [{ label: 'x', src: 'u' }], title: 'T', at: Date.now(), cardId: 'C1' });
        hub._sessions.set('r1b@s', { cmd: 'hv', stage: 'quality', items: [{ label: 'x', src: 'u' }], title: 'T', at: Date.now(), cardId: 'C9' });
        assert.strictEqual(hub.bridge('r1@s', 'C1', '3'), '.ep go 3');
        assert.strictEqual(hub.bridge('r1b@s', 'C9', '1'), '.hentaiv go 1');
    });
    await okA('.hentaiv go on ep session → epGo runs (cross-delegation)', async () => {
        hub._reset();
        try {
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('r2@s', { cmd: 'ep', stage: 'quality', items: [{ label: '1080p HD', src: 'https://vid-x-cdn.eporner.com/v2/t/1-1080p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'C2' });
            await hub.handle('.hentaiv', { send, jid: 'r2@s', msg: {}, rest: ['go', '1'], download });
            assert.strictEqual(dlArgs.length, 1, 'ep quality flow ran via .hentaiv go');
            assert.strictEqual(dlArgs[0].tag, '🔞 Eporner');
        } finally { hub._reset(); }
    });
    await okA('.ep go on hv session → hvGo runs', async () => {
        hub._reset();
        try {
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('r3@s', { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/c_720p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'C3' });
            await hub.handle('.ep', { send, jid: 'r3@s', msg: {}, rest: ['go', '1'], download });
            assert.strictEqual(dlArgs.length, 1, 'hv quality flow ran via .ep go');
            assert.strictEqual(dlArgs[0].tag, '🔞 WatchHentai');
        } finally { hub._reset(); }
    });
    await okA('.aniworld go on ep session → epGo runs (link fallback — AW path has no download fn)', async () => {
        hub._reset();
        try {
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('r4@s', { cmd: 'ep', stage: 'quality', items: [{ label: '480p', src: 'https://vid-x-cdn.eporner.com/v2/t/1-480p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'C4' });
            await hub.handle('.aniworld', { send, jid: 'r4@s', msg: {}, rest: ['go', '1'], download });
            assert.strictEqual(dlArgs.length, 0, 'AW path passes download=null (v2.76 parity)');
            assert.ok(sent.some((c) => c.text && c.text.includes('1-480p.mp4')), 'link text sent instead');
        } finally { hub._reset(); }
    });

    console.log('— bot.js + resolvers wiring —');
    ok('router: HEAVY + menu + bridge chain + download wrapper', () => {
        const src = fs.readFileSync('./bot.js', 'utf8');
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.ep'/.test(src), 'HEAVY has .ep');
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.eporner'/.test(src), 'HEAVY has .eporner');
        assert.ok(src.includes('*.ep <query>* — 🔞 eporner video + quality menu'), 'menu Tools line');
        assert.ok(src.includes('animehub.bridge'), 'bridge chain intact');
        assert.ok(src.includes("download: (link, tag) => dlQueue(() => handleDownload(send, jid, msg, link, tag))"), 'download wrapper');
        assert.ok(src.includes("require('./animehub')"), 'animehub required');
    });
    ok('resolvers: eporner referer rule (mp4 → http + referer)', () => {
        const src = fs.readFileSync('./resolvers.js', 'utf8');
        assert.ok(src.includes("host.endsWith('.eporner.com')"), 'eporner host rule');
        assert.ok(src.includes("referer: 'https://www.eporner.com/'"), 'referer value');
    });

    console.log('— @live eporner real chain —');
    if (!process.env.ARENA_OFFLINE) {
        await okA('live search "hentai parody"', async () => {
            const l = await hub.searchEP('hentai parody');
            assert.ok(l.length >= 1 && l[0].title, 'hits: ' + l.length);
        });
        await okA('live full chain: search → page hash → xhr → qualities with sizes', async () => {
            const l = await hub.searchEP('hentai parody');
            assert.ok(l.length >= 1, 'search empty');
            const { title, sources } = await hub.qualitiesEP(l[0].url);
            assert.ok(sources.length >= 1, 'no sources');
            assert.ok(/^https:\/\/vid-[^/]*cdn\.eporner\.com\/.+\.mp4$/.test(sources[0].src), sources[0].src.slice(0, 90));
            assert.ok(sources[0].bytes > 1e6, 'size: ' + sources[0].bytes);
            console.log(`   → "${title.slice(0, 50)}" · ${sources.map((s) => s.label + ' ' + Math.round((s.bytes || 0) / 1048576) + 'MB').join(' · ')}`);
        });
    } else console.log('  (ARENA_OFFLINE=1 — live skipped)');

    console.log(`\nv2.80 eporner: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
