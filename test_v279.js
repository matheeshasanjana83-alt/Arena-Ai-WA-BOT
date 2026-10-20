/**
 * test_v279.js — .hentaiv EPISODE MENU FIX (Dooplay ul.episodios single-quoted hrefs)
 * Old parser caught 1 stray double-quoted link → fake "single episode" → quality menu
 * skipped the episode step. Now: title → EPISODES → quality. Live checks @live (skipped
 * when ARENA_OFFLINE=1). Fixtures self-heal via live refetch. All async asserts awaited
 * (un-awaited ok() = the recurring fetch-mock leak — never again).
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
const WH = 'https://watchhentai.net';

// inverse of whDecodeMediaUrl — build fresh encoded vectors for mock player pages
function whEncode(url) {
    const b = Buffer.from(url, 'utf8').toString('base64');
    const r = b.split('').reverse().join('');
    let x = '';
    for (let i = 0; i < r.length; i++) x += String.fromCharCode(r.charCodeAt(i) ^ ((13 + i % 17) & 255));
    return Buffer.from(x, 'latin1').toString('base64url');
}

(async () => {
// fixture self-heal (real network, /tmp gets wiped between runs)
const F_SER = '/tmp/wh51s.html', F_VID = '/tmp/wh51v.html';
if (!process.env.ARENA_OFFLINE) {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    const grab = async (url, file) => { if (fs.existsSync(file)) return; const r = await fetch(url, { headers: { 'user-agent': UA, referer: WH + '/' }, signal: AbortSignal.timeout(30000) }); fs.writeFileSync(file, await r.text()); };
    try {
        await grab(WH + '/series/kazoku-haha-to-shimai-no-kyousei-id-01/', F_SER);
        await grab(WH + '/videos/kazoku-haha-to-shimai-no-kyousei-episode-1-id-01/', F_VID);
    } catch (e) { console.log('  (fixture fetch failed: ' + e.message.slice(0, 60) + ' — fixture tests may skip)'); }
}

console.log('— v2.79.0 pins —');
ok('version + manifest', () => {
    assert.ok(['2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0'].includes(pkg.version), 'pkg ' + pkg.version);
    assert.ok(['2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0'].includes(manifest.version), 'manifest ' + manifest.version);
    assert.ok(manifest.notes.includes('EPISODE MENU FIX'), 'notes');
    assert.ok(manifest.files.includes('animehub.js') && manifest.files.includes('test_v279.js'), 'files');
    assert.ok(typeof hub.epsWHFromHtml === 'function' && hub._cards.hvEpsCard, 'exports');
});

console.log('— epsWHFromHtml rewrite —');
ok('decoder inverse round-trip (vector builder sane)', () => {
    const u = 'https://hstorage.xyz/files/K/kazoku-haha-to-shimai-no-kyousei/kazoku-haha-to-shimai-no-kyousei-1.mp4';
    assert.strictEqual(hub.whDecodeMediaUrl(whEncode(u)), u);
});
ok('fixture: kazoku SERIES page → 6 eps EP1..EP6 (was 1 before fix)', () => {
    if (!fs.existsSync(F_SER)) { console.log('    (fixture missing — skipped)'); return; }
    const eps = hub.epsWHFromHtml(fs.readFileSync(F_SER, 'utf8'));
    assert.strictEqual(eps.length, 6, 'eps: ' + eps.length);
    assert.deepStrictEqual(eps.map((e) => e.label), ['EP 1', 'EP 2', 'EP 3', 'EP 4', 'EP 5', 'EP 6']);
    assert.ok(eps.every((e) => /episode-\d+-id-01\/$/.test(e.url)), 'url shape');
    assert.ok(!eps.some((e) => /\/feed\//.test(e.url)), 'no feed links');
});
ok('fixture: kazoku VIDEO watch page → scoped 6 eps, ZERO related pollution', () => {
    if (!fs.existsSync(F_VID)) { console.log('    (fixture missing — skipped)'); return; }
    const eps = hub.epsWHFromHtml(fs.readFileSync(F_VID, 'utf8'));
    assert.strictEqual(eps.length, 6, 'eps: ' + eps.length);
    assert.ok(eps.every((e) => e.url.includes('kazoku-haha-to-shimai')), 'all same series: ' + eps.map((e) => e.url).join(' | '));
});
ok('synthetic: single + double quotes both parsed, deduped', () => {
    const html = `<ul class='episodios'>` +
        `<li><a class='tv-ep-card-link' href='${WH}/videos/x-episode-1-id-01/' title='Episode 1'><span class='eptitle'>Episode 1</span></a></li>` +
        `<li><a class="tv-ep-card-link" href="${WH}/videos/x-episode-2-id-01/" title="Episode 2"><span class="eptitle">Episode 2</span></a></li>` +
        `<li><a class='tv-ep-card-link' href='${WH}/videos/x-episode-1-id-01/'>dup</a></li>` +
        `</ul>`;
    const eps = hub.epsWHFromHtml(html);
    assert.strictEqual(eps.length, 2, 'dedupe: ' + eps.length);
    assert.deepStrictEqual(eps.map((e) => e.label), ['EP 1', 'EP 2']);
});
ok('synthetic: /feed/ links inside episodios excluded', () => {
    const html = `<ul class='episodios'>` +
        `<li><a href='${WH}/videos/x-episode-1-id-01/'>E1</a></li>` +
        `<li><a href='${WH}/videos/x-episode-1-id-01/feed/'>rss</a></li>` +
        `<li><a href="${WH}/videos/x-episode-2-id-01/feed/">rss2</a></li>` +
        `</ul>`;
    const eps = hub.epsWHFromHtml(html);
    assert.strictEqual(eps.length, 1, 'eps: ' + eps.length);
    assert.strictEqual(eps[0].label, 'EP 1');
});
ok('synthetic: season-N slug → S2 EP label + cross-season ordering', () => {
    const html = `<ul class='episodios'>` +
        `<li><a href='${WH}/videos/x-season-2-episode-1-id-01/'>S2E1</a></li>` +
        `<li><a href='${WH}/videos/x-season-1-episode-3-id-01/'>S1E3</a></li>` +
        `<li><a href='${WH}/videos/x-season-1-episode-10-id-01/'>S1E10</a></li>` +
        `</ul>`;
    const eps = hub.epsWHFromHtml(html);
    assert.deepStrictEqual(eps.map((e) => e.label), ['S1 EP 3', 'S1 EP 10', 'S2 EP 1'], 'sorted: ' + eps.map((e) => e.label).join(','));
});
ok('synthetic: no episodios container → whole-page fallback still works', () => {
    const html = `<div class='other'><a href="${WH}/videos/y-episode-4-id-01/">E4</a>` +
        `<a href='${WH}/videos/y-episode-12-id-01/'>E12</a></div>`;
    const eps = hub.epsWHFromHtml(html);
    assert.deepStrictEqual(eps.map((e) => e.label), ['EP 4', 'EP 12']);
});

console.log('— mocked session flow: series → EPISODES → quality → download —');
const mkSend = (sent) => async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
const epsHtmlN = (slugs) => `<ul class='episodios'>` + slugs.map((s) => `<li><a class='tv-ep-card-link' href='${WH}/videos/${s}/' title='Episode ${s}'><span class='eptitle'>Episode</span></a></li>`).join('') + `</ul>`;
const playerHtmlFor = (urls) => `<script>var whJwSources=[${urls.map((u) => `{"file":"${whEncode(u)}"}`).join(',')}];</script>`;
const routeFetch = (map) => async (url, o = {}) => {
    const u = String(url);
    for (const [re, resp] of map) if (re.test(u)) return typeof resp === 'function' ? resp(u, o) : resp;
    throw new Error('unexpected ' + u);
};
const HEADOK = { ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? '104857600' : null) }, text: async () => '' };

await okA('series pick with 3 eps → EPISODE menu card (stage ep)', async () => {
    hub._reset();
    const orig = global.fetch;
    try {
        let sent = [];
        global.fetch = routeFetch([
            [/\/series\/t-id-01\//, { ok: true, status: 200, headers: { get: () => null }, text: async () => epsHtmlN(['t-episode-1-id-01', 't-episode-2-id-01', 't-episode-3-id-01']) }],
        ]);
        hub._sessions.set('f1@s', { cmd: 'hv', stage: 'series', items: [{ label: 'T', url: WH + '/series/t-id-01/' }], title: 'kazoku test', at: Date.now(), cardId: null });
        await hub.handle('.hentaiv', { send: mkSend(sent), jid: 'f1@s', msg: {}, rest: ['go', '1'] });
        const s = hub._sessions.get('f1@s');
        assert.strictEqual(s.stage, 'ep', 'stage: ' + s.stage);
        assert.strictEqual(s.items.length, 3);
        const card = sent.map((c) => c.text || '').find((t) => t.includes('Episodes'));
        assert.ok(card && card.includes('Episodes (3)'), 'card: ' + (card || '').slice(0, 120));
        assert.ok(card.includes('EP 2'), 'EP 2 listed');
        assert.ok(card.includes('quality menu'), 'menu promises next step');
    } finally { global.fetch = orig; hub._reset(); }
});
await okA('episode pick → quality card → quality pick → download (full chain)', async () => {
    hub._reset();
    const orig = global.fetch;
    try {
        let sent = [], dl = [];
        const p1080 = 'https://hstorage.xyz/files/T/t-episode-1_1080p.mp4';
        const p720 = 'https://hstorage.xyz/files/T/t-episode-2_720p.mp4';
        global.fetch = routeFetch([
            [/\/videos\/t-episode-\d/, { ok: true, status: 200, headers: { get: () => null }, text: async () => `<meta property="og:title" content="T EP 1"/><iframe data-primary-player-url="${WH}/player/5/1/mp4/"></iframe>` }],
            [/\/player\//, { ok: true, status: 200, headers: { get: () => null }, text: async () => playerHtmlFor([p1080, p720]) }],
            [/hstorage\.xyz/, HEADOK],
        ]);
        hub._sessions.set('f2@s', { cmd: 'hv', stage: 'ep', items: [{ n: 1, label: 'EP 1', url: WH + '/videos/t-episode-1-id-01/' }, { n: 2, label: 'EP 2', url: WH + '/videos/t-episode-2-id-01/' }], title: 'T', at: Date.now(), cardId: null });
        await hub.handle('.hentaiv', { send: mkSend(sent), jid: 'f2@s', msg: {}, rest: ['go', '2'] });
        let s = hub._sessions.get('f2@s');
        assert.strictEqual(s.stage, 'quality', 'stage after ep pick: ' + s.stage);
        assert.strictEqual(s.items.length, 2, 'qualities: ' + s.items.length);
        assert.strictEqual(s.items[0].label, '1080p', 'sorted best-first: ' + s.items[0].label);
        assert.ok(s.items[0].bytes === 104857600, 'bytes from HEAD');
        await hub.handle('.hentaiv', { send: mkSend(sent), jid: 'f2@s', msg: {}, rest: ['go', '1'], download: async (link, tag) => dl.push({ link, tag }) });
        assert.strictEqual(dl.length, 1, 'download called');
        assert.ok(dl[0].link === p1080, 'picked _1080p');
        assert.strictEqual(dl[0].tag, '🔞 WatchHentai');
        assert.ok(!hub._sessions.has('f2@s'), 'session cleared after send');
    } finally { global.fetch = orig; hub._reset(); }
});
await okA('single-episode series → auto-jump straight to quality (kept)', async () => {
    hub._reset();
    const orig = global.fetch;
    try {
        let sent = [];
        const only = 'https://hstorage.xyz/files/S/single_720p.mp4';
        global.fetch = routeFetch([
            [/\/series\/one-id-01\//, { ok: true, status: 200, headers: { get: () => null }, text: async () => epsHtmlN(['one-episode-1-id-01']) }],
            [/\/videos\/one-episode-1/, { ok: true, status: 200, headers: { get: () => null }, text: async () => `<meta property="og:title" content="One EP 1"/><iframe data-primary-player-url="${WH}/player/7/1/mp4/"></iframe>` }],
            [/\/player\//, { ok: true, status: 200, headers: { get: () => null }, text: async () => playerHtmlFor([only]) }],
            [/hstorage\.xyz/, HEADOK],
        ]);
        hub._sessions.set('f3@s', { cmd: 'hv', stage: 'series', items: [{ label: 'One', url: WH + '/series/one-id-01/' }], title: 'x', at: Date.now(), cardId: null });
        await hub.handle('.hentaiv', { send: mkSend(sent), jid: 'f3@s', msg: {}, rest: ['go', '1'] });
        const s = hub._sessions.get('f3@s');
        assert.ok(s, 'session alive');
        assert.strictEqual(s.stage, 'quality', 'jumped to quality: ' + s.stage);
        assert.strictEqual(s.items.length, 1, 'one quality');
        assert.strictEqual(s.items[0].src, only, 'src');
        const card = sent.map((c) => c.text || '').find((t) => t.includes('quality'));
        assert.ok(card, 'quality card sent');
    } finally { global.fetch = orig; hub._reset(); }
});
await okA('series page with NO episodes + no player → honest fail card (no crash, no throw)', async () => {
    hub._reset();
    const orig = global.fetch;
    try {
        let sent = [];
        global.fetch = routeFetch([
            [/\/series\/empty-id-01\//, { ok: true, status: 200, headers: { get: () => null }, text: async () => `<html><body>No videos here</body></html>` }],
        ]);
        hub._sessions.set('f4@s', { cmd: 'hv', stage: 'series', items: [{ label: 'Empty', url: WH + '/series/empty-id-01/' }], title: 'x', at: Date.now(), cardId: null });
        await hub.handle('.hentaiv', { send: mkSend(sent), jid: 'f4@s', msg: {}, rest: ['go', '1'] });
        const card = sent.map((c) => c.text || '').find((t) => t.includes('❌'));
        assert.ok(card && card.includes('video sources'), 'honest error: ' + (card || '').slice(0, 100));
    } finally { global.fetch = orig; hub._reset(); }
});

console.log('— @live watchhentai.net real chain (post-fix) —');
if (!process.env.ARENA_OFFLINE) {
    await okA('live: kazoku search → series → 6-episode menu (the reported bug)', async () => {
        const l = await hub.searchWH('kazoku');
        assert.ok(l.length >= 1, 'search hits: ' + l.length);
        const eps = await hub.epsWH(l[0].url);
        assert.ok(eps.length >= 2, 'episodes found: ' + eps.length + ' (fix must find >1)');
        console.log(`   → "${l[0].title}" · ${eps.map((e) => e.label).join(' · ')}`);
    });
    await okA('live: episode 1 → decoded real qualities with sizes', async () => {
        const l = await hub.searchWH('kazoku');
        const eps = await hub.epsWH(l[0].url);
        const { title, sources } = await hub.qualitiesWH(eps[0].url);
        assert.ok(sources.length >= 1, 'no sources');
        assert.ok(sources[0].src.startsWith('https://hstorage.xyz/') && sources[0].src.endsWith('.mp4'), sources[0].src.slice(0, 80));
        assert.ok(sources[0].bytes > 10e6, 'size: ' + sources[0].bytes);
        console.log(`   → "${title}" · ${sources.map((s) => s.label + ' ' + Math.round(s.bytes / 1048576) + 'MB').join(' · ')}`);
    });
} else console.log('  (ARENA_OFFLINE=1 — live skipped)');

console.log(`\nv2.79 hentaiv episode menu: ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
