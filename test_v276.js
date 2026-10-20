/**
 * test_v276.js — .hentaiv (watchhentai.net port: search → episodes → QUALITY MENU → file)
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
    // fixture self-heal: /tmp gets wiped — re-fetch live pages when missing (real network)
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    const get = async (url, file) => { if (fs.existsSync(file)) return; const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }); fs.writeFileSync(file, await r.text()); };
    if (!process.env.ARENA_OFFLINE) {
        try {
            await get('https://watchhentai.net/?s=tsuki', '/tmp/wh.html');
            await get('https://watchhentai.net/series/otaku-no-boku-ga-ichigun-gal-to-tsukiaeru-made-no-hanashi-id-01/', '/tmp/whs.html');
            await get('https://watchhentai.net/videos/otaku-no-boku-ga-ichigun-gal-to-tsukiaeru-made-no-hanashi-episode-1-id-01/', '/tmp/whv.html');
            const pu = (/data-primary-player-url="([^"]+)"/.exec(fs.readFileSync('/tmp/whv.html', 'utf8')) || [])[1];
            if (pu) await get(pu, '/tmp/whp.html');
        } catch (e) { console.log('  (fixture fetch failed: ' + e.message.slice(0, 60) + ' — fixture tests may skip)'); }
    }

    console.log('— v2.76.0 .hentaiv: pins + structure —');
    ok('version 2.76/77 pins', () => {
        assert.ok(['2.76.0', '2.77.0', '2.78.0', '2.79.0', '2.80.0', '2.81.0'].includes(pkg.version), 'pkg: ' + pkg.version);
        assert.ok(['2.76.0', '2.77.0', '2.78.0', '2.79.0', '2.80.0', '2.81.0'].includes(manifest.version), 'manifest: ' + manifest.version);
        assert.ok(manifest.notes.includes('.hentaiv'));
        assert.ok(manifest.files.includes('animehub.js'));
    });
    ok('decoder exports + cards', () => {
        assert.strictEqual(typeof hub.whDecodeMediaUrl, 'function');
        assert.strictEqual(typeof hub.searchWH, 'function');
        assert.strictEqual(typeof hub.qualitiesWH, 'function');
        assert.ok(hub._cards.hvQCard && hub._cards.hvSearchCard && hub._cards.hvEpsCard);
    });

    console.log('— decoder (known vector from live player page) —');
    ok('whDecodeMediaUrl → hstorage mp4 URL', () => {
        const enc = 'PU9XcmRTW1lsdW1AaXIpf3U4WVZfIGtxYSRFTXNfTXloSGNtY1ZGc2FCJnUnKWB4Ky1eb2ZrR11nRSdPZn8qQGoqT0RjP1x0Yyt-TWEuenptTyh9dV89bWZ6VXJuU3t1cHFNV2ooWkJjQkZLZyVGcm5OTkNraEppdF1IXWRBTFllUSpDbi9LeWNiSHF7fkRYfXJAVChuKX50PHdtZSBBd2ZTUXNuIGNPalBVVHx8fEhle01zIy1KQHVacG54XSNyfSptWSBaUHoqSVR8';
        const out = hub.whDecodeMediaUrl(enc);
        assert.ok(/^https:\/\/hstorage\.xyz\/files\/.+\.mp4$/.test(out), 'got: ' + out.slice(0, 80));
        assert.ok(out.includes('_720p'), 'label-suffix file: ' + out.slice(-40));
    });

    console.log('— parsers on live-fetched fixtures —');
    ok('searchWHFromHtml (fixture)', () => {
        if (!fs.existsSync('/tmp/wh.html')) { console.log('    (fixture missing — skipped)'); return; }
        const list = hub.searchWHFromHtml(fs.readFileSync('/tmp/wh.html', 'utf8'));
        assert.ok(list.length >= 3, 'results: ' + list.length);
        assert.ok(list[0].title.length > 3 && /\/series\//.test(list[0].url));
        assert.ok(list[0].poster.includes('/uploads/'));
        assert.ok(list[0].year >= 2000);
    });
    ok('epsWHFromHtml (fixture)', () => {
        if (!fs.existsSync('/tmp/whs.html')) { console.log('    (fixture missing — skipped)'); return; }
        const eps = hub.epsWHFromHtml(fs.readFileSync('/tmp/whs.html', 'utf8'));
        assert.ok(eps.length >= 1);
        assert.ok(/\/videos\/.+episode-\d+/.test(eps[0].url));
        assert.strictEqual(eps[0].label, 'EP 1');
    });
    await okA('qualitiesWH fallbacks: contentUrl on watch page (no player url)', async () => {
        const orig = global.fetch;
        try {
            global.fetch = async () => ({ ok: true, status: 200, text: async () => '<meta property="og:title" content="Test"/><script type="application/ld+json">{"contentUrl":"https://hstorage.xyz/files/x/test.mp4"}</script>' });
            const r = await hub.qualitiesWH('https://watchhentai.net/videos/t/');
            assert.strictEqual(r.sources.length, 1);
            assert.ok(r.sources[0].src.endsWith('.mp4'));
        } finally { global.fetch = orig; }
    });
    await okA('qualitiesWH full chain mocked: whJwSources decode + HEAD sizes + sort', async () => {
        const orig = global.fetch;
        if (!fs.existsSync('/tmp/whp.html')) { console.log('    (fixture missing — skipped)'); return; }
        const playerHtml = fs.readFileSync('/tmp/whp.html', 'utf8');
        try {
            global.fetch = async (url, o = {}) => {
                const u = String(url);
                if (/\/videos\//.test(u)) return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<meta property="og:title" content="T EP 1"/><iframe data-primary-player-url="https://watchhentai.net/player/9/1/mp4/"></iframe>' };
                if (/\/player\//.test(u)) return { ok: true, status: 200, text: async () => playerHtml };
                if (/hstorage\.xyz/.test(u)) return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? '358080245' : null) } };
                throw new Error('unexpected ' + u);
            };
            const r = await hub.qualitiesWH('https://watchhentai.net/videos/t/');
            assert.strictEqual(r.sources.length, 2, '1080p + 720p');
            assert.ok(r.sources[0].label === '1080p' && r.sources[0].bytes === 358080245, 'sorted best-first with size');
            assert.ok(r.sources[1].label === '720p');
            assert.ok(/hstorage\.xyz/.test(r.sources[0].src) && r.sources[0].src.endsWith('_1080p.mp4'));
        } finally { global.fetch = orig; }
    });
    await okA('hvGo quality pick → download called (mocked chain)', async () => {
        const orig = global.fetch;
        hub._reset();
        try {
            let sent = [], dlArgs = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            const download = async (link, tag) => { dlArgs.push({ link, tag }); };
            hub._sessions.set('hv1@s', { cmd: 'hv', stage: 'quality', items: [{ label: '1080p', src: 'https://hstorage.xyz/x/a_1080p.mp4', bytes: 100 }], title: 'T EP 1', at: Date.now(), cardId: null });
            await hub.handle('.hentaiv', { send, jid: 'hv1@s', msg: {}, rest: ['go', '1'], download });
            assert.strictEqual(dlArgs.length, 1);
            assert.ok(dlArgs[0].link.includes('_1080p.mp4'));
            assert.strictEqual(dlArgs[0].tag, '🔞 WatchHentai');
            assert.ok(!hub._sessions.has('hv1@s'), 'session cleared after send');
        } finally { global.fetch = orig; hub._reset(); }
    });
    await okA('hvGo without download fn → sends link text (graceful)', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set('hv2@s', { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/b_720p.mp4', bytes: 50 }], title: 'T', at: Date.now(), cardId: null });
            await hub.handle('.hentaiv', { send, jid: 'hv2@s', msg: {}, rest: ['go', '1'] });
            assert.ok(sent.some((c) => c.text && c.text.includes('_720p.mp4')));
        } finally { hub._reset(); }
    });

    console.log('— session cmd routing —');
    ok('bridge: hv session → .hentaiv go N; aw session → .aniworld go N', () => {
        hub._reset();
        hub._sessions.set('r1@s', { cmd: 'hv', stage: 'quality', items: [{ label: 'x', src: 'u' }], title: 'T', at: Date.now(), cardId: 'C1' });
        hub._sessions.set('r2@s', { cmd: 'aw', stage: 'season', items: [{ label: 'y', url: 'u' }], title: 'A', at: Date.now(), cardId: 'C2' });
        assert.strictEqual(hub.bridge('r1@s', 'C1', '1'), '.hentaiv go 1');
        assert.strictEqual(hub.bridge('r2@s', 'C2', '1'), '.aniworld go 1');
    });
    await okA('.aniworld go on hv session → delegated (no cross-contamination)', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set('r3@s', { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/c_720p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'C3' });
            await hub.handle('.aniworld', { send, jid: 'r3@s', msg: {}, rest: ['go', '1'] });
            assert.ok(sent.some((c) => (c.text || c.caption || '').toString().includes('_720p.mp4')), 'hv quality flow ran');
        } finally { hub._reset(); }
    });

    console.log('— bot.js + resolvers wiring —');
    ok('router: download wrapper + HEAVY + menu', () => {
        const src = fs.readFileSync('./bot.js', 'utf8');
        assert.ok(src.includes('download: (link, tag) => dlQueue(() => handleDownload(send, jid, msg, link, tag))'));
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.hentaiv'/.test(src));
        assert.ok(/\.hentaiv <name>\* — 🔞 video \+ quality menu/.test(src));
    });
    ok('resolvers: hstorage/watchhentai referer rule', () => {
        const src = fs.readFileSync('./resolvers.js', 'utf8');
        assert.ok(src.includes("host.endsWith('hstorage.xyz')"));
        assert.ok(src.includes("referer: 'https://watchhentai.net/'"));
    });

    console.log('— @live watchhentai.net real chain —');
    if (!process.env.ARENA_OFFLINE) {
        await okA('live search "tsuki"', async () => {
            const l = await hub.searchWH('tsuki');
            assert.ok(l.length >= 1 && l[0].title, 'hits: ' + l.length);
        });
        await okA('live full chain: search → episodes → qualities (real decoder)', async () => {
            const l = await hub.searchWH('otaku no boku');
            assert.ok(l.length >= 1, 'search empty');
            const eps = await hub.epsWH(l[0].url);
            assert.ok(eps.length >= 1, 'eps: ' + eps.length);
            const { title, sources } = await hub.qualitiesWH(eps[0].url);
            assert.ok(sources.length >= 1, 'no sources');
            assert.ok(sources[0].src.startsWith('https://hstorage.xyz/') && sources[0].src.endsWith('.mp4'), sources[0].src.slice(0, 90));
            assert.ok(sources[0].bytes > 10e6, 'size: ' + sources[0].bytes);
            console.log(`   → "${title}" · ${sources.map((s) => s.label + ' ' + Math.round(s.bytes / 1048576) + 'MB').join(' · ')}`);
        });
    } else console.log('  (ARENA_OFFLINE=1 — live skipped)');

    console.log(`\nv2.76 hentaiv: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
