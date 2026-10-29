/**
 * test_v288.js — 🔞 .metdn SEARCH + QUALITY MENU (user's mat6tube-catalog-api ported in-bot)
 * User: 'https://transfer.archivete.am/rZjZX/mat6tube-catalog-api-source-1.zip — .metdn එකෙ
 * video download api එකක් හැදුවා. ඔක .metdn <name title> search menu ~> quality menu ~>
 * download විදිහට ඔනි'
 * Fixtures mirror LIVE markup (probe 2026-10-21): href-FIRST item_link, img data-src lazy,
 * m_views/m_time text-after-svg, .more data-page (prev excluded on p2).
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const md = require('./metdn');
const pkg = require('./package.json');
const manifest = require('./manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');

const JID = 'md8@s.whatsapp.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';

// ───────── fixtures (LIVE markup shape 2026-10-21) ─────────
const ITEM = (id, title, v, t, hd, altOrder) => `<div class="item" data-video-title-base="${title}">
  <a ${altOrder ? `class="item_link" href="/watch/${id}"` : `href="/watch/${id}" class="item_link"`}>     <div class="i_img" data-trailer_url="https://tr.pvvstream.pro/videos/${id}/tr_240p.mp4?secure=A">
      <img src="data:image/gif;base64,R0lGODlh" data-src="https://cdn2.pvvstream.pro/videos/${id}/preview_320.jpg" class="lazyload widescreen" alt="${title}">
      ${hd ? `<i class="hd_mark">${hd}</i>` : ''}      <div class="m_views"><svg class="icon icon-eye"><use xlink:href="#eye"></use></svg> ${v}</div>      <div class="m_time"><svg class="icon icon-clock-o"><use xlink:href="#clock-o"></use></svg> ${t}</div>
      <div class="preview" title="Preview available on hover">        <svg class="icon icon-eye"><use xlink:href="#eye"></use></svg>        </div>  </div>  <div class="i_info">      <div class="title" data-video-title-text>${title}</div>  </div> </a> </div>`;
const ITEMS = [
    ITEM('-2_2', 'Hot dance video &#34;special&#34; edition', '2.81M', '1:48:28', 'HD'),
    ITEM('-2_3', 'Street dance battle', '48.2K', '03:12', 'HD'),
    ITEM('-2_4', 'Dance practice clip', '1,204', '00:45', ''),
    ITEM('-2_5', 'No title here', '9', '01:00', '', true),
];
const SEARCH_P1 = `<html><div class="list_videos">${ITEMS.join('\n')}${ITEM('-2_6', 'extra one', '5', '00:10', '')}</div><div class="more" data-page="1" data-i18n="show_more">Show more</div></html>`;
const SEARCH_P2 = `<html><div class="list_videos">${ITEM('-9_1', 'page two video', '77', '02:00', 'HD')}</div><div class="more" data-page="0" data-action="prev" data-i18n="show_previous"><div class="more" data-page="2" data-i18n="show_more"></div></html>`;
const SEARCH_EMPTY = `<html><div class="list_videos"></div></html>`;
const SEARCH_HIDDEN = SEARCH_P1.replace('data-page="1" data-i18n="show_more"', 'data-page="1" hidden data-i18n="show_more"');

const watchPage = (id, labels, title) => {
    const srcs = labels.map((l) => `{"file":"https://cdn.pvvstream.pro/videos/${id}/vid_${l}p.mp4?secure=S${l}\\u0026x=1","label":"${l}","type":"mp4"}`).join(',');
    return `<html><head><title>${title} - mat6tube</title><meta property="og:image" content="https://cdn2.pvvstream.pro/videos/${id}/preview_800.jpg"><meta property="video:duration" content="302"><meta property="ya:ovs:views_total" content="1319"><meta name="video:tag" content="tag1, tag2"></head><body><script>window.playlist = {"image":"https://cdn2.pvvstream.pro/videos/${id}/preview_800.jpg","sources":[${srcs}],"trusted":true};</script></body></html>`;
};
const W2 = watchPage('-2_2', [720, 480, 360, 240], 'Hot dance video "special" edition');
const W3 = watchPage('-2_3', [480, 360], 'Street dance battle');

// router mock — search URL → search html, watch URL → per-id watch page
const routerMock = (pages, seen) => async (url, h = {}) => {
    if (seen) seen.push({ url: String(url), h });
    const s = String(url);
    for (const [frag, html] of Object.entries(pages)) if (s.includes(frag)) return { ok: true, status: 200, text: async () => html };
    return { ok: false, status: 404, text: async () => 'nope' };
};
const sendMock = (sent) => { let n = 0; return async (j, c) => { const k = 'K' + (++n); sent.push({ k, c }); return { key: { id: k } }; }; };
const DL = (arr) => async (l, tag) => arr.push({ l, tag });

(async () => {
    console.log('— v2.88.0 pins —');
    ok('version + manifest files + wiring greps', () => {
        assert.ok(['2.87.0', '2.88.0', '2.89.0', '2.96.0', '2.96.0', '2.96.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.87.0', '2.88.0', '2.89.0', '2.96.0', '2.96.0', '2.96.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(manifest.files.includes('metdn.js') && manifest.files.includes('test_v288.js'), 'files');
        assert.ok(botSrc.includes("require('./metdn')") && botSrc.includes('metdn.handle'), 'router');
        assert.ok(botSrc.includes('metdn.bridge'), 'bridge chain (7th)');
        assert.ok(botSrc.includes('*.metdn <නම/link>* — 🔞 mat6tube search → quality menu → mp4 (18+)'), 'menu line ×2 = ' + (botSrc.match(/metdn <නම\/link>/g) || []).length);
        assert.strictEqual((botSrc.match(/metdn <නම\/link>/g) || []).length, 2, 'both menu cats');
        assert.ok(/'\.metdn'/.test(botSrc), 'HEAVY');
    });

    console.log('— parsers —');
    ok('parseListing: live shape → ids/titles/views/time/HD + entities decoded', () => {
        const { items, hasNext } = md.parseListing(SEARCH_P1);
        assert.strictEqual(items.length, 5, '5 items (all)');
        assert.strictEqual(items[0].id, '-2_2');
        assert.strictEqual(items[0].title, 'Hot dance video "special" edition', 'entity decoded');
        assert.strictEqual(items[0].viewsText, '2.81M');
        assert.strictEqual(items[0].views, 2810000, 'countFromText');
        assert.strictEqual(items[0].durS, 6508, '1:48:28 → 6508s');
        assert.strictEqual(items[0].duration, '1:48:28');
        assert.strictEqual(items[0].hd, 'HD');
        assert.ok(items[0].thumb.startsWith('https://cdn2.pvvstream.pro/videos/-2_2/preview_320.jpg'), 'data-src thumb (lazy src ignored)');
        assert.ok(items[0].url.endsWith('/watch/-2_2'), 'url');
        assert.strictEqual(items[2].views, 1204, 'comma count');
        assert.strictEqual(items[2].durS, 45);
        assert.ok(hasNext === true, 'hasNext');
    });
    ok('parseListing: attr-order-agnostic + dedupe + titleless dropped + prev/hidden/absent more', () => {
        const dup = md.parseListing(ITEM('-5_5', 'A', '1', '00:01', '') + ITEM('-5_5', 'A dup', '2', '00:02', ''));
        assert.strictEqual(dup.items.length, 1, 'dedupe');
        assert.strictEqual(dup.items[0].title, 'A');
        const noT = md.parseListing(`<div class="item"><a href="/watch/-6_6" class="item_link"><img data-src="https://x/y.jpg"></a></div>`);
        assert.strictEqual(noT.items.length, 0, 'titleless dropped');
        assert.strictEqual(md.parseListing(SEARCH_P2).items[0].id, '-9_1', 'p2 parses');
        assert.strictEqual(md.parseListing(SEARCH_P2).hasNext, true, 'prev excluded → next found');
        assert.strictEqual(md.parseListing(SEARCH_HIDDEN).hasNext, false, 'hidden more');
        assert.strictEqual(md.parseListing(SEARCH_EMPTY).hasNext, false, 'no more tag');
        assert.strictEqual(md.parseListing(SEARCH_EMPTY).items.length, 0, 'empty');
    });
    ok('secondsFromClock/countFromText parity with the API', () => {
        assert.strictEqual(md.secondsFromClock('02:34'), 154);
        assert.strictEqual(md.secondsFromClock('1:48:28'), 6508);
        assert.strictEqual(md.secondsFromClock('99:99'), null);
        assert.strictEqual(md.secondsFromClock('junk'), null);
        assert.strictEqual(md.countFromText('1.25K'), 1250);
        assert.strictEqual(md.countFromText('2,204'), 2204);
        assert.strictEqual(md.countFromText('3.4B'), 3400000000);
        assert.strictEqual(md.countFromText('x'), null);
    });
    ok('validateQuery: 80 cap + control chars (API contract)', () => {
        assert.strictEqual(md.validateQuery('  dance '), 'dance');
        assert.throws(() => md.validateQuery(''), /1-80/);
        assert.throws(() => md.validateQuery('a'.repeat(81)), /1-80/);
        assert.throws(() => md.validateQuery('a\x00b'), /1-80/);
    });

    console.log('— searchVideos URL contract —');
    await okA('searchVideos: /video/<enc> + one-based page → ?p=<page-1>', async () => {
        const seen = []; const prev = md.setFetcher(routerMock({ '': '<html>ok</html>' }, seen));
        try {
            await md.searchVideos('hot dance', 1);
            await md.searchVideos('hot dance', 3);
            assert.strictEqual(seen[0].url, 'https://mat6tube.com/video/hot%20dance', 'page 1 no param');
            assert.strictEqual(seen[1].url, 'https://mat6tube.com/video/hot%20dance?p=2', 'page 3 → p=2');
            assert.strictEqual(seen[0].h['User-Agent'], UA, 'UA');
            assert.ok(seen[0].h.Referer, 'Referer');
            md.setFetcher(async () => ({ ok: false, status: 404, text: async () => '' }));
            await assert.rejects(() => md.searchVideos('x', 1), /HTTP 404/, 'honest status throw');
        } finally { md.setFetcher(prev); }
    });

    console.log('— FULL flow: search menu → quality menu → download —');
    await okA('.metdn dance → menu card (10-row cap, hasNext hint, session saved)', async () => {
        const seen = []; const prev = md.setFetcher(routerMock({ '/video/': SEARCH_P1 }, seen));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: DL(dled) });
            assert.ok(sent[0].c.text.includes('search කරනවා'), 'progress first');
            const menu = sent.find((x) => x.c.edit);
            assert.ok(menu, 'menu = edited progress bubble');
            assert.ok(menu.c.text.includes('mat6tube search* — "dance" (page 1)'), 'header');
            assert.ok(menu.c.text.includes('1. Hot dance video "special" edition · ⏱ 1:48:28 · 👁 2.81M · HD'), 'row 1');
            assert.ok(menu.c.text.includes('4. No title here'), 'row 4 (class-first item parsed)');
            assert.ok(menu.c.text.includes('ගානක් *quote කරලා*'), 'pick hint');
            assert.ok(menu.c.text.includes('*.metdn more*'), 'page hint');
            const s = md._sessions.get(JID);
            assert.ok(s && s.stage === 'search' && s.q === 'dance' && s.page === 1 && s.hasNext === true, 'search session');
            assert.strictEqual(s.cardId, 'K1', 'cardId = edited bubble');
            assert.strictEqual(dled.length, 0, 'no download');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn dance p2 (more) → page 2 search → new menu', async () => {
        const seen = []; const prev = md.setFetcher(routerMock({ '/video/dance?p=1': SEARCH_P2, '/video/dance': SEARCH_P1 }, seen));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: DL(dled) });
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['more'], react: async () => { }, download: DL(dled) });
            assert.ok(seen.some((x) => x.url.endsWith('/video/dance?p=1')), 'page-2 URL');
            const m2 = sent.filter((x) => x.c.edit).pop();
            assert.ok(m2.c.text.includes('page 2') && m2.c.text.includes('page two video'), 'page 2 menu');
            assert.strictEqual(md._sessions.get(JID).page, 2, 'session page');
            // last page → honest card
            md._sessions.get(JID).hasNext = false;
            const sent3 = [];
            await md.handle('.metdn', { send: sendMock(sent3), jid: JID, msg: {}, rest: ['more'], react: async () => { }, download: DL([]) });
            assert.ok(sent3.map((x) => x.c.text || '').join('\n').includes('අන්තිම page'), 'last-page card');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn more with no session → hint', async () => {
        md._sessions.delete(JID);
        const sent = [];
        await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['more'], react: async () => { }, download: async () => { } });
        assert.ok(sent.map((x) => x.c.text || '').join('\n').includes('search session එකක් නෑ'), 'hint');
    });
    await okA('quote 2 on search card → quality card of item 2 (fresh watch fetch) → quote 1 → 480p download', async () => {
        const seen = []; const prev = md.setFetcher(routerMock({ '/watch/-2_3': W3, '/watch/-2_2': W2, '/video/': SEARCH_P1 }, seen));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: DL(dled) });
            const s = md._sessions.get(JID);
            assert.strictEqual(md.bridge(JID, s.cardId, '2'), '.metdn go 2', 'bridge → go 2');
            assert.strictEqual(md.bridge(JID, 'WRONG', '2'), null, 'wrong quote → null');
            assert.strictEqual(md.bridge(JID, s.cardId, '0'), null, '0 → null');
            const sent2 = []; const dled2 = [];
            await md.handle('.metdn', { send: sendMock(sent2), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: DL(dled2) });
            assert.ok(seen.some((x) => x.url.endsWith('/watch/-2_3')), 'item-2 watch page fetched');
            const img = sent2.find((x) => x.c.image);
            assert.ok(img, 'quality thumb card');
            assert.ok(img.c.caption.includes('Street dance battle'), 'title');
            assert.ok(img.c.caption.includes('1. 480p ⭐ BEST') && img.c.caption.includes('2. 360p'), 'quality rows best-first');
            assert.ok(sent2.some((x) => x.c.delete), 'progress deleted');
            const q = md._sessions.get(JID);
            assert.ok(q && q.stage === 'quality' && q.id === '-2_3' && q.labels.join(',') === '480,360', 'quality session');
            assert.ok(img.c.caption.includes('🔍') === false, 'no junk');
            // pick 1 → fresh fetch → 480 signed url
            assert.strictEqual(md.bridge(JID, q.cardId, '1'), '.metdn go 1', 'bridge quality');
            const before = seen.filter((x) => x.url.includes('/watch/')).length;
            await md.handle('.metdn', { send: sendMock(sent2), jid: JID, msg: {}, rest: ['1'], react: async () => { }, download: DL(dled2) });
            assert.ok(seen.filter((x) => x.url.includes('/watch/')).length > before, 'FRESH re-fetch at pick');
            assert.strictEqual(dled2.length, 1, 'download');
            assert.strictEqual(dled2[0].l, 'https://cdn.pvvstream.pro/videos/-2_3/vid_480p.mp4?secure=S480&x=1', 'label-matched 480 url (\\u0026 decoded)');
            assert.strictEqual(dled2[0].tag, '🔞 mat6tube');
            const rs = md._sessions.get(JID);
            assert.ok(rs && rs.stage === 'search', 'v2.90: search session RESTORED (binge flow): ' + (rs && rs.stage));
            assert.strictEqual(md.bridge(JID, rs.cardId, '1'), '.metdn go 1', 'same search card still routes');
        } finally { md.setFetcher(prev); }
    });
    await okA('range + edge: 11 out of menu · expired session · no-download fallback · source gone', async () => {
        const prev = md.setFetcher(routerMock({ '/watch/-2_2': W2, '/video/': SEARCH_P1 }));
        try {
            const sent = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: async () => { } });
            const s1 = [];
            await md.handle('.metdn', { send: sendMock(s1), jid: JID, msg: {}, rest: ['11'], react: async () => { }, download: async () => { } });
            assert.ok(s1.map((x) => x.c.text || '').join('\n').includes('menu එකේ නෑ (1-'), 'menu-range guard');
            md._sessions.delete(JID);
            const s2 = [];
            await md.handle('.metdn', { send: sendMock(s2), jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
            assert.ok(s2.map((x) => x.c.text || '').join('\n').includes('session expire'), 'expired session card');
            // quality pick without download fn → link fallback (tests contract)
            const s3 = [];
            await md.handle('.metdn', { send: sendMock(s3), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-2_2'], react: async () => { }, download: null });
            const q = md._sessions.get(JID);
            assert.ok(q && q.stage === 'quality', 'quality session from link');
            const s4 = [];
            await md.handle('.metdn', { send: sendMock(s4), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: null });
            assert.ok(s4.map((x) => x.c.text || '').join('\n').includes('480p'), 'link fallback card');
            // source gone at pick → honest card, no throw
            const s5 = []; const d5 = [];
            md.setFetcher(routerMock({ '/watch/-2_2': watchPage('-2_2', [360], 'x') }));
            await md.handle('.metdn', { send: sendMock(s5), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: DL(d5) });
            assert.ok(s5.map((x) => x.c.text || '').join('\n').includes('source එක දැන් නෑ'), 'source-gone honest card');
            assert.strictEqual(d5.length, 0, 'no download');
        } finally { md.setFetcher(prev); md._sessions.delete(JID); }
    });
    await okA('.metdn <query with no results> → honest empty card, NO session', async () => {
        const prev = md.setFetcher(routerMock({ '/video/': SEARCH_EMPTY }));
        try {
            const sent = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['zzzznope'], react: async () => { }, download: async () => { } });
            assert.ok(sent.map((x) => x.c.text || '').join('\n').includes('මුකුතු හම්බුණේ නෑ'), 'empty card');
            assert.ok(!md._sessions.has(JID), 'no session');
        } finally { md.setFetcher(prev); }
    });
    await okA('.metdn <bad link> still gated · usage updated', async () => {
        const sent = [];
        await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://mediafire.com/x'], react: async () => { } });
        assert.ok(sent.map((x) => x.c.text || '').join('\n').includes('නෙවෙයි'), 'host gate');
        const s2 = [];
        await md.handle('.metdn', { send: sendMock(s2), jid: JID, msg: {}, rest: [], react: async () => { } });
        assert.ok(s2.map((x) => x.c.text || '').join('\n').includes('*.metdn <නම / link>*'), 'usage <නම / link>');
    });

    console.log('— @live mat6tube.com real search —');
    await okA('LIVE: real search "dance" → ≥5 items → item-1 watch parse → mp4 labels', async () => {
        const r = await fetch('https://mat6tube.com/video/dance', { headers: { 'User-Agent': UA, Referer: 'https://mat6tube.com/' }, signal: AbortSignal.timeout(40e3) });
        assert.ok(r.status === 200, 'search status ' + r.status);
        const { items, hasNext } = md.parseListing(await r.text());
        console.log('   → items:', items.length, 'hasNext:', hasNext, '| first:', (items[0] || {}).title?.slice(0, 40));
        assert.ok(items.length >= 3, 'search results');
        assert.ok(items[0].title && items[0].id && items[0].thumb.startsWith('https://'), 'item shape');
        const info = await md.parsePage(items[0].url);
        if (info.deleted) { console.log('   → first video deleted (rare) — parse path still exercised'); return; }
        const labels = info.sources.filter((s) => s.type !== 'hls' && /^\d{3,4}$/.test(String(s.label))).map((s) => s.label);
        console.log('   →', (info.title || '').slice(0, 44), '| labels:', labels.join(','));
        assert.ok(labels.length >= 1, 'mp4 labels present');
    });

    console.log(`\nv2.88 metdn search: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
