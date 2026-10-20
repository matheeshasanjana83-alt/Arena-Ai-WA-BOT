/**
 * test_v275.js — animehub.js ( AniWorld port + NSFW suite ) + bot.js wiring
 * 22 checks. Live-network checks marked @live (skipped when ARENA_OFFLINE=1).
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { if (typeof fn === 'function') { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async test must be awaited via okA'); } pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); } };

const hub = require('./animehub');
const pkg = require('./package.json');
const manifest = require('./manifest.json');
const fs = require('fs');

(async () => {
    // fixture self-heal: /tmp gets wiped — re-fetch live pages when missing (real network)
    const get = async (url, file) => { if (fs.existsSync(file)) return; const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36' }, signal: AbortSignal.timeout(30000) }); fs.writeFileSync(file, await r.text()); };
    if (!process.env.ARENA_OFFLINE) {
        try {
            await get('https://aniworld.to/anime/stream/naruto/staffel-1/episode-1', '/tmp/ep2.html');
        } catch (e) { console.log('  (fixture fetch failed: ' + e.message.slice(0, 60) + ' — fixture tests may skip)'); }
    }

    console.log('— v2.75.0 animehub: module structure —');
    ok('exports handle+bridge+hooks', () => {
        assert.strictEqual(typeof hub.handle, 'function');
        assert.strictEqual(typeof hub.bridge, 'function');
        assert.strictEqual(typeof hub.searchAW, 'function');
        assert.strictEqual(typeof hub.providersOf, 'function');
        assert.strictEqual(typeof hub.resolveEpisode, 'function');
        assert.strictEqual(typeof hub.nekobot, 'function');
    });
    ok('no new deps in package.json', () => {
        const d = pkg.dependencies;
        assert.ok(!Object.keys(d).some((k) => /cheerio|puppeteer|curl_cffi|hono|redis|mongo/i.test(k)), 'no scrap-fat deps');
    });
    ok('version pins (modernized v2.76/77 era)', () => {
        assert.ok(['2.75.0', '2.76.0', '2.77.0', '2.78.0', '2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0'].includes(pkg.version), 'pkg: ' + pkg.version);
        assert.ok(['2.75.0', '2.76.0', '2.77.0', '2.78.0', '2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0'].includes(manifest.version), 'manifest: ' + manifest.version);
        assert.ok(manifest.files.includes('animehub.js'), 'manifest has animehub.js');
        assert.ok(manifest.notes.includes('.aniworld'), 'manifest notes mention aniworld');
    });

    console.log('— cards & bridge grammar (no network) —');
    ok('searchCard lists numbered series + reply hint', () => {
        const t = hub._cards.searchCard('naruto', [{ title: 'Naruto', desc: 'fox', link: 'x' }, { title: 'Naruto Shippuden', desc: '', link: 'y' }]);
        assert.ok(/\*1\.\* Naruto/.test(t) && /\*2\.\* Naruto Shippuden/.test(t));
        assert.ok(/අංකය reply/.test(t));
    });
    ok('seasonsCard + filme label', () => {
        const t = hub._cards.seasonsCard('Naruto', [{ label: '📺 Staffel 1', url: 'u' }, { label: '🎬 Filme', url: 'f' }]);
        assert.ok(/📺 Staffel 1/.test(t) && /🎬 Filme/.test(t) && /Naruto/.test(t));
    });
    ok('epsCard caps 120 + note', () => {
        const many = Array.from({ length: 130 }, (_, i) => ({ label: 'EP ' + (i + 1), url: 'u' + i }));
        const t = hub._cards.epsCard('X', many, '');
        assert.ok(/තව 10 පාරක් තියෙනවා/.test(t));
        assert.strictEqual((t.match(/EP \d+/g) || []).length, 120);
    });
    ok('linksCard: HLS label + browser-only section + page link', () => {
        const t = hub._cards.linksCard('Naruto S1 EP1', 'https://aniworld.to/anime/stream/naruto/staffel-1/episode-1',
            [{ lang: 2, name: 'Vidmoly', url: 'https://x/master.m3u8?a=1', mp4: false }], ['🇩🇪 Ger Dub → VOE']);
        assert.ok(/Vidmoly.*HLS/.test(t) && /master\.m3u8/.test(t));
        assert.ok(/Browser-only hosters/.test(t) && /VOE/.test(t));
        assert.ok(/VLC \/ MX Player \/ 1DM/.test(t));
        assert.ok(/aniworld\.to\/anime\/stream\/naruto/.test(t));
    });
    ok('linksCard: mp4 variant label', () => {
        const t = hub._cards.linksCard('T', 'u', [{ lang: 1, name: 'Doodstream', url: 'https://d/x.mp4', mp4: true }], []);
        assert.ok(/direct MP4/.test(t) && /download කරන්න පුළුවන්/.test(t));
    });
    ok('bridge: quote-match + expiry + bad digits', () => {
        hub._reset();
        const J = 'jid1@s.whatsapp.net';
        const now = Date.now();
        hub._sessions.set(J, { stage: 'season', items: [{ label: '📺 Staffel 1', url: 'u' }], title: 'N', at: now, cardId: 'CARD1' });
        assert.strictEqual(hub.bridge(J, 'CARD1', '1'), '.aniworld go 1');
        assert.strictEqual(hub.bridge(J, 'OTHERCARD', '1'), null, 'wrong quote → null');
        assert.strictEqual(hub.bridge(J, 'CARD1', 'abc'), null);
        assert.strictEqual(hub.bridge(J, 'CARD1', '0'), null);
        assert.strictEqual(hub.bridge(J, 'CARD1', '5'), '.aniworld go 5', 'range check happens in goStep');
    });
    ok('bridge: expired session → null', () => {
        const J = 'jid2@s.whatsapp.net';
        hub._sessions.set(J, { stage: 'series', items: [{ label: 'x', url: 'u' }], title: 'x', at: Date.now() - hub.TTL - 31 * 60e3, cardId: 'C' });
        assert.strictEqual(hub.bridge(J, 'C', '1'), null);
    });
    ok('bridge: no session → null (bare numbers never hijacked)', () => {
        assert.strictEqual(hub.bridge('nobody@x', 'q', '1'), null);
    });

    console.log('— NSFW routing (mocked fetch) —');
    await okA('nekobot ok → image send', async () => {
        const orig = global.fetch;
        let sent = [];
        try {
            global.fetch = async (url) => {
                if (/nekobot\.xyz/.test(url)) return { ok: true, status: 200, json: async () => ({ success: true, message: 'https://i0.nekobot.xyz/x/hneko.jpeg' }) };
                throw new Error('unexpected ' + url);
            };
            const send = async (j, content) => { sent.push(content); return { key: { id: 'K1' } }; };
            await hub.handle('.hneko', { send, jid: 'j@s', msg: {}, rest: [] });
            assert.strictEqual(sent.length, 1);
            assert.ok(sent[0].image.url.includes('nekobot.xyz'));
            assert.ok(/18\+/.test(sent[0].caption));
        } finally { global.fetch = orig; }
    });
    await okA('pgif → video gifPlayback', async () => {
        const orig = global.fetch;
        let sent = [];
        try {
            global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, message: 'https://i0.nekobot.xyz/x/p.gif' }) });
            const send = async (j, content) => { sent.push(content); return { key: { id: 'K2' } }; };
            await hub.handle('.pgif', { send, jid: 'j@s', msg: {}, rest: [] });
            assert.ok(sent[0].video && sent[0].gifPlayback === true);
        } finally { global.fetch = orig; }
    });
    await okA('nekobot down → friendly error, no crash', async () => {
        const orig = global.fetch;
        try {
            global.fetch = async () => { throw new Error('dead'); };
            let sent = [];
            const send = async (j, content) => { sent.push(content); return { key: { id: 'K3' } }; };
            await hub.handle('.hentai', { send, jid: 'j@s', msg: {}, rest: [] });
            assert.ok(/down/.test(sent[0].text));
        } finally { global.fetch = orig; }
    });

    console.log('— AniWorld parsing (fixture HTML, no network) —');
    ok('providersFromHtml fixture: 4 hosts × 3 langs (page labels — real host = redirect truth)', () => {
        if (!fs.existsSync('/tmp/ep2.html')) { console.log('    (fixture missing — skipped)'); return; }
        const html = fs.readFileSync('/tmp/ep2.html', 'utf8');
        const map = hub.providersFromHtml(html);
        assert.strictEqual(map[1].length, 4, 'lang1 4 hosts');
        assert.strictEqual(map[2].length, 4, 'lang2 4 hosts');
        assert.strictEqual(map[3].length, 4, 'lang3 4 hosts');
        // page labels (they LIE about host — verified) but rid targets are real:
        assert.ok(map[2].some((p) => p.rid === '/redirect/3523796' && p.name === 'VOE'), 'page label of 3523796 = VOE (redirect truth = vidmoly, checked in resolveEpisode live)');
        assert.ok(map[2].some((p) => p.rid === '/redirect/3697379'));
        assert.ok(map[1].some((p) => p.rid === '/redirect/2626179' && p.name === 'VOE'));
    });
    await okA('resolveRedirect host routing (mocked manual fetch)', async () => {
        const orig = global.fetch;
        global.fetch = async (url, o = {}) => {
            if (/\/redirect\/1$/.test(url)) return { headers: new Map([['location', 'https://vidmoly.net/embed-x.html']]), headersGet: 'vidmoly' };
            if (/\/redirect\/2$/.test(url)) return { headers: new Map([['location', 'https://voe.sx/e/y']]) };
            if (/\/redirect\/3$/.test(url)) return { headers: new Map([['location', 'https://filemoon.to/d/z']]) };
            if (/\/redirect\/4$/.test(url)) return { headers: new Map([['location', 'https://dood.li/e/w']]) };
            throw new Error('unexpected ' + url);
        };
        // undici Headers-like: our code calls r.headers.get('location') — shim
        const H = (l) => ({ get: (k) => (k === 'location' ? l : null) });
        global.fetch = async (url) => {
            const table = { 1: 'https://vidmoly.net/embed-x.html', 2: 'https://voe.sx/e/y', 3: 'https://filemoon.to/d/z', 4: 'https://dood.li/e/w' };
            const n = url.match(/\/redirect\/(\d+)$/)[1];
            return { headers: H(table[n]) };
        };
        try {
            assert.strictEqual((await hub.resolveRedirect('/redirect/1')).kind, 'vidmoly');
            assert.strictEqual((await hub.resolveRedirect('/redirect/2')).kind, 'voe');
            assert.strictEqual((await hub.resolveRedirect('/redirect/3')).kind, 'filemoon');
            assert.strictEqual((await hub.resolveRedirect('/redirect/4')).kind, 'dood');
            assert.strictEqual((await hub.resolveRedirect('/redirect/9')).kind, 'dead');
        } finally { global.fetch = orig; }
    });
    await okA('vidmolyHls tolerant regex', async () => {
        const orig = global.fetch;
        global.fetch = async () => ({ ok: true, status: 200, text: async () => 'jwplayer("x").setup({ sources: [{ file: \'https://cdn/host/hls2/x/master.m3u8?t=abc\' }] });' });
        try { assert.ok((await hub.vidmolyHls('https://vidmoly.net/embed-x.html')).includes('master.m3u8')); } finally { global.fetch = orig; }
    });
    await okA('vidmolyHls alt spacing + double-quoted json form', async () => {
        const orig = global.fetch;
        global.fetch = async () => ({ ok: true, status: 200, text: async () => 'var s = {"file":"https://cdn/y/master.m3u8?z=1"};' });
        try { assert.ok((await hub.vidmolyHls('u')).includes('?z=1')); } finally { global.fetch = orig; }
    });
    await okA('doodMp4 pass_md5 chain (mocked)', async () => {
        const orig = global.fetch;
        global.fetch = async (url, o = {}) => {
            const u = String(url);
            if (/\/e\/embed123/.test(u)) return { ok: true, status: 200, text: async () => `$.get('https://dood.li/pass_md5/2890721/TOKEN123')  token=ab12cd34ef` };
            if (/pass_md5/.test(u)) return { ok: true, status: 200, text: async () => 'https://vk1.dood.li/vh1/09/x/' };
            throw new Error('unexpected ' + u);
        };
        try {
            const mp4 = await hub.doodMp4('https://dood.li/e/embed123');
            assert.ok(/^https:\/\/vk1\.dood\.li\/vh1\/09\/x\/[A-Za-z0-9]{10}\?directly=1&token=ab12cd34ef$/.test(mp4), 'mp4 shape: ' + mp4);
        } finally { global.fetch = orig; }
    });
    await okA('resolveEpisode: lang2 vidmoly picked, other langs fall to pageOnly (mocked full chain)', async () => {
        const orig = global.fetch;
        const epHtml = [
            '<li class="col-md-3 episodeLink11" data-lang-key="2" data-link-id="11" data-link-target="/redirect/11"><a href="/redirect/11"><i class="icon VOE"></i><h4>VOE</h4></a></li>',
            '<li class="col-md-3 episodeLink12" data-lang-key="2" data-link-id="12" data-link-target="/redirect/12"><a href="/redirect/12"><i class="icon Vidmoly"></i><h4>Vidmoly</h4></a></li>',
            '<li class="col-md-3 episodeLink13" data-lang-key="1" data-link-id="13" data-link-target="/redirect/13"><a href="/redirect/13"><i class="icon Filemoon"></i><h4>Filemoon</h4></a></li>',
        ].join('\n');
        try {
            global.fetch = async (url, o = {}) => {
                const u = String(url);
                if (/staffel-1\/episode-1$/.test(u)) return { ok: true, status: 200, text: async () => epHtml };
                if (/\/redirect\/11/.test(u)) return { headers: { get: (k) => (k === 'location' ? 'https://voe.sx/e/a' : null) } };
                if (/\/redirect\/12/.test(u)) return { headers: { get: (k) => (k === 'location' ? 'https://vidmoly.net/embed-b.html' : null) } };
                if (/\/redirect\/13/.test(u)) return { headers: { get: (k) => (k === 'location' ? 'https://filemoon.to/d/c' : null) } };
                if (/vidmoly\.net/.test(u)) return { ok: true, status: 200, text: async () => "sources: [{ file: 'https://c/b.m3u8?t=1'" };
                throw new Error('unexpected ' + u);
            };
            const r = await hub.resolveEpisode('https://aniworld.to/anime/stream/foo/staffel-1/episode-1');
            assert.strictEqual(r.streams.length, 1);
            assert.strictEqual(r.streams[0].lang, 2);
            assert.ok(r.streams[0].url.includes('.m3u8'));
            assert.ok(r.pageOnly.length, 'pageOnly has hosters from other langs');
        } finally { global.fetch = orig; }
    });

    console.log('— bot.js wiring —');
    ok('router calls animehub.handle + bridge chained + HEAVY', () => {
        const src = fs.readFileSync('./bot.js', 'utf8');
        assert.ok(src.includes("require('./animehub')"));
        assert.ok(src.includes('animehub.handle(c, { send, jid, msg, rest, react'), 'router calls animehub.handle');
        assert.ok(src.includes('animehub.bridge(jid0, qid, text)'));
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.aniworld'/.test(src), 'HEAVY has .aniworld');
        assert.ok(/HEAVY = new Set\(\[[^\]]*'\.aw'/.test(src), 'HEAVY has .aw alias');
    });
    ok('menu has aniworld + NSFW lines', () => {
        const src = fs.readFileSync('./bot.js', 'utf8');
        assert.ok(/\.aniworld <anime>\* — 🎌 AniWorld/.test(src));
        assert.ok(/\.hentai\* · \*\.hneko\* · \*\.hmidriff\* · \*\.pgif\* — 🔞 NSFW/.test(src));
    });
    ok('VISION_SYSTEM untouched (v2.71 brain intact)', () => {
        const ai = fs.readFileSync('./ai.js', 'utf8');
        assert.ok(ai.includes('VISION_SYSTEM'));
    });

    console.log('— @live AniWorld real network —');
    if (!process.env.ARENA_OFFLINE) {
        await okA('live search "naruto" → ≥1 hit', async () => {
            const list = await hub.searchAW('naruto');
            assert.ok(list.length >= 1 && list[0].link.includes('/anime/stream/'));
        });
        await okA('live seasonsOf naruto → staffel 1..4 + filme', async () => {
            const s = await hub.seasonsOf('https://aniworld.to/anime/stream/naruto');
            assert.ok(s.length >= 4);
            assert.ok(s.some((x) => x.label === '📺 Staffel 1') && s.some((x) => x.label === '🎬 Filme'));
        });
        await okA('live episodesOf S1 → ≥50 eps sorted', async () => {
            const e = await hub.episodesOf('https://aniworld.to/anime/stream/naruto/staffel-1');
            assert.ok(e.length >= 50 && e[0].label === 'EP 1' && e[1].label === 'EP 2');
        });
        await okA('live providersOf ep1 → lang2 has ≥3 hosts', async () => {
            const { map } = await hub.providersOf('https://aniworld.to/anime/stream/naruto/staffel-1/episode-1');
            assert.ok((map[2] || []).length >= 3);
        });
        await okA('live resolveEpisode → ≥1 stream (vidmoly m3u8 or dood mp4)', async () => {
            const r = await hub.resolveEpisode('https://aniworld.to/anime/stream/naruto/staffel-1/episode-1');
            assert.ok(r.streams.length >= 1, 'streams: ' + JSON.stringify(r.pageOnly));
            assert.ok(/m3u8|\.mp4/.test(r.streams[0].url));
        });
        await okA('live nekobot .hentai type', async () => {
            const u = await hub.nekobot('hentai');
            assert.ok(/^https?:\/\//.test(u));
        });
    } else console.log('  (ARENA_OFFLINE=1 — live checks skipped)');

    console.log(`\nv2.75 animehub: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
