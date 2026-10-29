/**
 * test_v286.js — 🔞 .metdn — mat6tube.com downloader (yt-dlp #14613 port, wontfix → in-bot)
 * Live facts (2026-10-21): watch page → window.playlist {sources:[{file,label,type:'mp4'}]},
 * signed pvvstream.pro mp4 = srcIp-locked to page-fetcher IP, 206 + ftyp, no Referer needed.
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const md = require('../metdn');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');

const JID = 'md1@s.whatsapp.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';

// ───────── fixtures (REAL markup shape captured from mat6tube, trimmed) ─────────
const CLEAN_480 = 'https://cdn77-pr.pvvstream.pro/videos/480/-1_2.mp4?url=dmt2\\u0026sig=B';
const CLEAN_360 = 'https://cdn77-pr.pvvstream.pro/videos/360/-1_2.mp4?url=x\\u0026y=1';
const CLEAN_240 = 'https://cdn77-pr.pvvstream.pro/videos/240/-1_2.mp4?url=dmt2\\u0026sig=A';
const CLEAN_144 = 'https://cdn77-pr.pvvstream.pro/videos/144/-1_2.mp4?url=z';
const PAGE = `<!DOCTYPE html><html prefix="og: http://ogp.me/ns# video: http://ogp.me/ns/video# ya: http://webmaster.yandex.ru/vocabularies/">
<head><title>Girl b j + sex - mat6tube</title>
<meta property="og:title" content="Girl b j + sex - mat6tube">
<meta property="og:image" content="https://img.pvvstream.pro/preview/x/-1_2/451/p.jpg">
<meta property="video:duration" content="302">
<meta property="ya:ovs:views_total" content="1319">
<meta name="video:tag" content="tag1, tag2, tag3"></head>
<body><script>window.playlist = {"image":"https://img.pvvstream.pro/preview/x/-1_2/451/p.jpg","sources":[{"file":"${CLEAN_144}","label":"144","type":"mp4"},{"file":"${CLEAN_240}","label":"240","type":"mp4"},{"file":"${CLEAN_480}","label":"480","type":"mp4"},{"file":"${CLEAN_360}","label":"360","type":"mp4"}],"tracks":[{"file":"/vtt/v/2-41/-1_2?m=abc","kind":"thumbnails"}],"trusted":true,"cdn":0};</script></body></html>`;
const PAGE_NOIMG = PAGE.replace(/<meta property="og:image"[^>]*>/, '').replace(/"image":"[^"]*",/, '');
const PAGE_DELETED = '<html><head><title>Video deleted</title></head><body></body></html>';
const PAGE_HLS = `<html><title>hls only</title><script>window.playlist = {"sources":[{"file":"https://pvvstream.pro/h/idx.m3u8","label":"auto","type":"hls"}]};</script></html>`;

const mockFetcher = (html, seen) => async (url, h = {}) => {
    if (seen) seen.push({ url: String(url), h });
    return { ok: true, status: 200, text: async () => html, json: async () => { throw new Error('no json'); } };
};
const sendMock = (sent) => { let n = 0; return async (j, c) => { const k = 'K' + (++n); sent.push({ k, c }); return { key: { id: k } }; }; };

(async () => {
    console.log('— v2.86.0 pins —');
    ok('version + manifest + notes + wiring greps', () => {
        assert.ok(['2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '2.98.0', '2.98.0', '2.98.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '2.98.0', '2.98.0', '2.98.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(/METDN/i.test(manifest.notes), 'notes');
        assert.ok(manifest.files.includes('metdn.js') && manifest.files.includes('tests/test_v286.js'), 'files');
        assert.ok(botSrc.includes("require('./metdn')") && botSrc.includes('metdn.handle'), 'router');
        assert.ok(/'\.metdn'/.test(botSrc), 'HEAVY');
        assert.ok(botSrc.includes('*.metdn <නම/link>* — 🔞 mat6tube search → quality menu → mp4 (18+)'), 'Download cat');
        assert.ok(botSrc.includes('metdn.bridge'), 'bridge chain');
        assert.ok(botSrc.includes('*.metdn*'), 'HELP summary');
    });

    console.log('— idOf + playlistJson —');
    ok('idOf: host gate + id shapes', () => {
        assert.strictEqual(md.idOf('https://mat6tube.com/watch/-114054493_456243244'), '-114054493_456243244');
        assert.strictEqual(md.idOf('https://www.mat6tube.com/watch/-68355713_456239357'), '-68355713_456239357');
        assert.strictEqual(md.idOf('https://adult.noodlemagazine.com/watch/-67421364_456239604'), '-67421364_456239604');
        assert.strictEqual(md.idOf('https://mat6tube.com/video/-1_2'), null, 'wrong path');
        assert.strictEqual(md.idOf('https://evil.com/watch/-1_2'), null, 'host gate');
        assert.strictEqual(md.idOf('nope'), null);
    });
    ok('playlistJson: brace-balance + }-inside-string + \\u0026 unescape', () => {
        assert.deepStrictEqual(md.playlistJson('<script>window.playlist = {"a":"x}y{z","sources":[]};</script>'), { a: 'x}y{z', sources: [] });
        assert.strictEqual(md.playlistJson('no playlist here'), null);
        assert.strictEqual(md.playlistJson('window.playlist = broken{'), null);
        const pl = md.playlistJson(PAGE);
        assert.ok(pl && pl.trusted === true && pl.sources.length === 4, 'real shape');
    });

    console.log('— parsePage + bestSrc + cards —');
    await okA('parsePage: meta + sorted sources (480→144) + title strip', async () => {
        const prev = md.setFetcher(mockFetcher(PAGE));
        try {
            const info = await md.parsePage('https://mat6tube.com/watch/-1_2');
            assert.strictEqual(info.deleted, false);
            assert.strictEqual(info.title, 'Girl b j + sex');
            assert.strictEqual(info.duration, 302);
            assert.strictEqual(info.views, 1319);
            assert.deepStrictEqual(info.tags, ['tag1', 'tag2', 'tag3']);
            assert.strictEqual(info.sources.length, 4);
            assert.deepStrictEqual(info.sources.map((s) => s.label), [480, 360, 240, 144]);
            const b = md.bestSrc(info);
            assert.strictEqual(b.label, 480);
            assert.ok(!b.file.includes('\\u0026') && b.file.includes('&sig=B'), 'u0026 unescaped');
            const c = md.infoCard(info);
            assert.ok(c.includes('480p') && c.includes('5:02') && c.includes('1.3K') && c.includes('tag1, tag2'), c.slice(0, 140));
        } finally { md.setFetcher(prev); }
    });
    await okA('parsePage: deleted page → deleted flag (honest path exists)', async () => {
        const prev = md.setFetcher(mockFetcher(PAGE_DELETED));
        try {
            const info = await md.parsePage('https://mat6tube.com/watch/-1_2');
            assert.strictEqual(info.deleted, true);
        } finally { md.setFetcher(prev); }
    });
    ok('bestSrc: hls-only → null; infoCard honest m3u8 text', () => {
        const info = { title: 'hls only', duration: 0, views: 0, tags: [], image: '', sources: [{ label: 0, type: 'hls', file: 'https://x/idx.m3u8' }], hlsOnly: true };
        assert.strictEqual(md.bestSrc(info), null);
        assert.ok(md.infoCard(info).includes('m3u8'), 'honest card');
    });

    console.log('— flow (.metdn handle) —');
    await okA('.metdn <link> → progress + thumb image card + QUALITY MENU (no auto-download) → go 1 = BEST 480p', async () => {
        const seen = []; const prev = md.setFetcher(mockFetcher(PAGE, seen));
        try {
            const sent = []; const dled = [];
            const ctx = { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-1_2'], react: async () => { }, download: async (l, tag) => dled.push({ l, tag }) };
            await md.handle('.metdn', ctx);
            const prog = sent[0].c;
            assert.ok(prog.text.includes('page එක කියවනවා'), 'progress first');
            const img = sent.find((x) => x.c.image);
            assert.ok(img, 'thumb image card');
            assert.ok(img.c.caption.includes('480p') && img.c.caption.includes('Girl b j + sex') && img.c.caption.includes('Quality එක තෝරන්න'), 'quality menu caption');
            assert.ok(img.c.caption.includes('1. 480p ⭐ BEST'), 'best first');
            assert.ok(sent.some((x) => x.c.delete), 'progress bubble deleted');
            assert.strictEqual(dled.length, 0, 'NO auto-download (v2.88 quality menu)');
            assert.ok(seen.every((s) => s.h['User-Agent'] === UA), 'UA sent');
            // quote pick 1 (bridge grammar) → fresh fetch → 480p download
            const st = md._sessions.get(JID);
            assert.ok(st && st.stage === 'quality' && st.labels[0] === 480, 'quality session');
            assert.strictEqual(md.bridge(JID, st.cardId, '1'), '.metdn go 1', 'bridge ok');
            const d2 = [];
            await md.handle('.metdn', { send: sendMock([]), jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l, tag) => d2.push({ l, tag }) });
            assert.strictEqual(d2.length, 1, 'picked download');
            assert.strictEqual(d2[0].l, 'https://cdn77-pr.pvvstream.pro/videos/480/-1_2.mp4?url=dmt2&sig=B', 'BEST signed url (fresh fetch)');
            assert.strictEqual(d2[0].tag, '🔞 mat6tube');
            assert.ok(!md._sessions.has(JID), 'no prev → cleaned (v2.90 restoreBack semantics)');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn no-image page → edited text quality card, NO download', async () => {
        const prev = md.setFetcher(mockFetcher(PAGE_NOIMG));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-1_2'], react: async () => { }, download: async (l) => dled.push(l) });
            const edited = sent.find((x) => x.c.edit);
            assert.ok(edited && edited.c.text.includes('480p') && edited.c.text.includes('mat6tube'), 'text quality card');
            assert.strictEqual(dled.length, 0, 'no download until pick');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn deleted video → honest card, NO download', async () => {
        const prev = md.setFetcher(mockFetcher(PAGE_DELETED));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-1_2'], react: async () => { }, download: async (l) => dled.push(l) });
            assert.ok(sent.some((x) => (x.c.text || '').includes('delete වෙලා')), 'honest card');
            assert.strictEqual(dled.length, 0, 'no download');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn hls-only → honest m3u8 card, NO download', async () => {
        const prev = md.setFetcher(mockFetcher(PAGE_HLS));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-1_2'], react: async () => { }, download: async (l) => dled.push(l) });
            assert.ok(sent.some((x) => (x.c.text || '').includes('m3u8')), 'honest card');
            assert.strictEqual(dled.length, 0, 'no download');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn usage + wrong-host gate + fetch-error honest card', async () => {
        const prev = md.setFetcher(async () => { throw new Error('boom'); });
        try {
            const sent = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: [], react: async () => { } });
            assert.ok(sent.map((x) => x.c.text || '').join('\n').includes('*.metdn <නම / link>*'), 'usage');
            const s2 = [];
            await md.handle('.metdn', { send: sendMock(s2), jid: JID, msg: {}, rest: ['https://mediafire.com/file/x'], react: async () => { } });
            assert.ok(s2.map((x) => x.c.text || '').join('\n').includes('නෙවෙයි'), 'host gate');
            const s3 = [];
            await md.handle('.metdn', { send: sendMock(s3), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-9_9'], react: async () => { } });
            assert.ok(s3.map((x) => x.c.text || '').join('\n').includes('boom'), 'error surfaced');
        } finally { md.setFetcher(prev); }
    });

    console.log('— @live mat6tube.com real chain —');
    const p2t = (t) => t + '';
    await okA('LIVE: /recent → fresh id → parsePage → signed mp4 Range 206 + ftyp', async () => {
        const r = await fetch('https://mat6tube.com/recent', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40e3) });
        assert.ok(r.status === 200, 'recent ' + r.status);
        const id = ((await r.text()).match(/\/watch\/(-?\d+_\d+)/) || [])[1];
        assert.ok(id, 'fresh watch id');
        const info = await md.parsePage('https://mat6tube.com/watch/' + id);
        console.log('   →', (info.title || 'deleted').slice(0, 48), '| sources:', info.sources.map((s) => s.label + p2t(s.type)).join(','));
        if (info.deleted) { console.log('   → top video deleted (rare) — flow still exercised'); return; }
        const b = md.bestSrc(info);
        assert.ok(b && b.label >= 144, 'best source present');
        assert.ok(!b.type || b.type === 'mp4', 'mp4 source');
        const mr = await fetch(b.file, { headers: { 'User-Agent': UA, Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(40e3) });
        assert.ok([200, 206].includes(mr.status), 'media status ' + mr.status);
        const buf = Buffer.from(await mr.arrayBuffer());
        assert.ok(buf.length > 100, 'bytes ' + buf.length);
        assert.strictEqual(buf.slice(4, 8).toString('latin1'), 'ftyp', 'ftyp magic');
    });

    console.log(`\nv2.86 metdn: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
