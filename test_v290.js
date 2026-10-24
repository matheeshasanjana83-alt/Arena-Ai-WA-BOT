/**
 * test_v290.js — 🕰️ FLOW TIME-MACHINE (user video lv_0_20261024211911.mp4)
 * User video: .hentaiv kazoku flow — EP menu එකට '1' → EP1 quality ✓, ඒම EP card එකටම '2'
 * (quality card ආවට පස්සේ) → '🔢 menu එකක් active නෑ' ✗, search card එකට ආපහු '1' (වෙන series)
 * → ඒම error එකම ✗. ROOT: animehub/metdn bridge kept ONLY the newest cardId (moviedex v2.28
 * s.cards ring pattern never ported). FIX: card ring + stage rewind + flow keep-alive after
 * download/actions + 'AniWorld බලනවා' mislabel → 'WatchHentai බලනවා'.
 * Offline: global.fetch monkey-patched (watch/player/HEAD fixtures — ld+json contentUrl path).
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const hub = require('./animehub');
const md = require('./metdn');
const pkg = require('./package.json');
const manifest = require('./manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');
const hubSrc = fs.readFileSync('./animehub.js', 'utf8');
const mdSrc = fs.readFileSync('./metdn.js', 'utf8');

const JID = 'tm@s.whatsapp.net';
const sendMock = (sent) => { let n = 0; return async (j, c) => { const k = 'K' + (++n); sent.push({ k, c }); return { key: { id: k } }; }; };

// ───────── offline fetch fixtures (qualitiesWH last-resort-free path: player page ld+json) ─────────
const watchPage = (title, player) => `<html><head><meta property="og:title" content="${title}"></head><body><iframe data-primary-player-url="${player}"></iframe></body></html>`;
const playerPage = (src) => `<html><script type="application/ld+json">{"contentUrl":"${src}","name":"x"}</script></html>`;
const SERIES_HTML = `<div class="titlex">junk <a href="https://watchhentai.net/videos/related-1">pollution</a></div>
<ul class="episodios"><li><a href='/videos/kazoku-episode-1'>EP 1</a></li><li><a href='/videos/kazoku-episode-2'>EP 2</a></li></ul>`;

let fetchLog = [];
const realFetch = global.fetch;
global.fetch = async (url, o = {}) => {
    const s = String(url);
    fetchLog.push(s);
    const mk = (text, len) => ({ ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? len : null) }, text: async () => text });
    if (s.includes('wh.example/player/ep1')) return mk(playerPage('https://hstorage.xyz/a/a_720p.mp4'), '95000000');
    if (s.includes('wh.example/player/ep2')) return mk(playerPage('https://hstorage.xyz/b/b_720p.mp4'), '88000000');
    if (s.includes('/videos/kazoku-episode-1')) return mk(watchPage('Kazoku EP 1', 'https://wh.example/player/ep1'));
    if (s.includes('/videos/kazoku-episode-2')) return mk(watchPage('Kazoku EP 2', 'https://wh.example/player/ep2'));
    if (s.includes('/videos/paihame')) return mk(`<ul class="episodios"><li><a href='/videos/paihame-episode-1'>EP 1</a></li><li><a href='/videos/paihame-episode-2'>EP 2</a></li></ul>`);
    if (o && o.method === 'HEAD') return mk('', s.includes('/a/') ? '95000000' : '88000000');   // hstorage size probe
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope' };
};

(async () => {
    console.log('— v2.90.0 pins —');
    ok('version + manifest + wiring greps', () => {
        assert.ok(['2.88.0', '2.89.0', '2.90.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.88.0', '2.89.0', '2.90.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(manifest.files.includes('test_v290.js'), 'manifest files');
        assert.ok(hubSrc.includes('🕰️ v2.90') && hubSrc.includes("s.cards = [{ id: String(m.key.id)"), 'animehub card ring in done()');
        assert.ok(hubSrc.includes('const hit = (s.cards || []).find'), 'animehub bridge rewind');
        assert.ok(hubSrc.includes("status(send, jid, msg, 'WatchHentai')"), 'hv status label fixed');
        assert.ok(!hubSrc.includes('sessions.delete(jid)'), 'animehub: zero mid-flow deletes (keep-alive)');
        assert.ok(mdSrc.includes('regCard') && mdSrc.includes('const hit = (s.cards || []).find'), 'metdn ring + rewind');
        assert.ok(mdSrc.includes("s.at = Date.now();   // 🕰️ v2.90: session එක මැරෙන්නේ නෑ"), 'metdn keep-alive');
        assert.ok(botSrc.includes('sentIds.has(String(qid))'), 'bot.js stale hint unchanged');
    });

    console.log('— animehub: THE video bug (EP menu re-quote after quality card) —');
    await okA('bridge(old EP card) → rewind to ep stage → go 2 → EP2 quality card (was: null + "menu active නෑ")', async () => {
        hub._reset();
        try {
            const eps = [{ n: 1, url: 'https://watchhentai.net/videos/kazoku-episode-1', label: 'EP 1' }, { n: 2, url: 'https://watchhentai.net/videos/kazoku-episode-2', label: 'EP 2' }];
            hub._sessions.set(JID, {
                cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/a/a_720p.mp4', bytes: 95e6 }], title: 'Kazoku', at: Date.now(), cardId: 'QK',
                cards: [{ id: 'SK', stage: 'series', items: [{ label: 'Kazoku', url: 'https://watchhentai.net/videos/kazoku' }], title: 'kazoku', at: Date.now() },
                        { id: 'EK', stage: 'ep', items: eps, title: 'Kazoku', at: Date.now() }],
            });
            // THE BUG: quote the EPISODES card (older than the quality card) with 2
            assert.strictEqual(hub.bridge(JID, 'EK', '2'), '.hentaiv go 2', 'rewind bridge (v2.89 → null)');
            const s = hub._sessions.get(JID);
            assert.strictEqual(s.stage, 'ep', 'session rewound to ep');
            assert.strictEqual(s.items[1].url, eps[1].url, 'ep items restored');
            assert.strictEqual(s.cardId, 'EK', 'cardId = quoted card');
            // execute → EP2 quality card (offline fixtures)
            fetchLog = [];
            const sent = [];
            await hub.handle('.hentaiv', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { } });
            assert.ok(fetchLog.some((u) => u.includes('/videos/kazoku-episode-2')), 'EP2 watch page fetched');
            const card = sent.map((x) => x.c.text || '').find((t) => t.includes('quality එක තෝරන්න'));
            assert.ok(card, 'quality card sent');
            assert.ok(card.includes('Kazoku EP 2'), 'EP2 title');
            assert.ok(card.includes('720p') && card.includes('84 MB'), 'quality row + HEAD size (88000000B → 84 MB)');
            assert.strictEqual(hub._sessions.get(JID).stage, 'quality', 'session at quality');
        } finally { hub._reset(); }
    });

    await okA('search card re-pick after flow advanced (video t23/t26) → rewind to series → new series flow', async () => {
        hub._reset();
        try {
            const series = [{ label: 'Paihame Kazoku', title: 'Paihame Kazoku', url: 'https://watchhentai.net/videos/paihame' }];
            hub._sessions.set(JID, {
                cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/z/z_720p.mp4', bytes: 1 }], title: 'Old', at: Date.now(), cardId: 'QK2',
                cards: [{ id: 'SK2', stage: 'series', items: series, title: 'kazoku', at: Date.now() }],
            });
            assert.strictEqual(hub.bridge(JID, 'SK2', '1'), '.hentaiv go 1', 'search-card rewind');
            assert.strictEqual(hub._sessions.get(JID).stage, 'series', 'at series');
            const sent = [];
            await hub.handle('.hentaiv', { send: sendMock(sent), jid: JID, msg: {}, rest: ['go', '1'], react: async () => { } });
            assert.ok(fetchLog.concat([]).length >= 0, 'no throw');
            const card = sent.map((x) => x.c.text || '').find((t) => t.includes('Episodes'));
            assert.ok(card, 'EPISODES card of the NEW series');
            assert.ok(card.includes('Paihame Kazoku') && card.includes('EP 1') && card.includes('EP 2'), 'series title + eps from ul.episodios');
        } finally { hub._reset(); }
    });

    await okA('keep-alive: quality pick WITHOUT download fn → session survives (v2.89 deleted it) + foreign quote still null', async () => {
        hub._reset();
        try {
            let sent = [];
            const send = async (j, c) => { sent.push(c); return { key: { id: 'K' + sent.length } }; };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/b_720p.mp4', bytes: 50 }], title: 'T', at: Date.now(), cardId: 'QK9', cards: [] });
            await hub.handle('.hentaiv', { send, jid: JID, msg: {}, rest: ['go', '1'] });
            assert.ok(sent.some((c) => c.text && c.text.includes('_720p.mp4')), 'link text (graceful)');
            const s = hub._sessions.get(JID);
            assert.ok(s, '🕰️ session ALIVE after pick (v2.89: deleted)');
            assert.strictEqual(s.cmd, 'hv', 'same session');
            assert.ok(Date.now() - s.at < 5000, 'at refreshed');
            // newest card quote → normal; foreign quote → null (v2.58/v2.89 semantics preserved)
            s.cardId = 'KC';
            assert.strictEqual(hub.bridge(JID, 'KC', '1'), '.hentaiv go 1', 'newest-card quote unchanged');
            assert.strictEqual(hub.bridge(JID, 'FOREIGN', '1'), null, 'foreign quote → null');
            assert.strictEqual(hub.bridge(JID, 'KC', '0'), null, '0 → null');
        } finally { hub._reset(); }
    });

    await okA('done() ring: cap 12 + dedupe + stage snapshot (exported as _done)', async () => {
        hub._reset();
        try {
            let n = 0;
            const send = async (j, c) => ({ key: { id: 'D' + (++n) } });
            const st = { del: async () => { } };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1' }], title: 'T', at: Date.now(), cardId: null, cards: [] });
            for (let i = 0; i < 15; i++) {
                hub._sessions.set(JID, Object.assign(hub._sessions.get(JID), { stage: i % 2 ? 'ep' : 'quality', at: Date.now() }));
                await hub._done(st, send, JID, {}, 'card ' + i, null);
            }
            const s = hub._sessions.get(JID);
            assert.strictEqual(s.cards.length, 12, 'ring capped at 12');
            assert.strictEqual(s.cards[0].id, 'D15', 'newest first');
            assert.strictEqual(s.cardId, 'D15', 'cardId synced');
            assert.ok(s.cards.every((c) => c.id && c.stage && c.items && typeof c.at === 'number'), 'snapshot shape');
        } finally { hub._reset(); }
    });

    console.log('— metdn: same fix —');
    await okA('search card ring seed → quality → re-quote SEARCH card → rewind → item-1 quality (was: null)', async () => {
        md._reset ? md._reset() : md._sessions.clear();
        const seen = [];
        const prev = md.setFetcher(async (url, h = {}) => {
            seen.push(String(url));
            const s = String(url);
            if (s.includes('/video/')) return { ok: true, status: 200, text: async () => SEARCH_P1_FIX };
            return { ok: true, status: 200, text: async () => watchPageFix(s.includes('-2_3') ? 'Street dance battle' : 'Hot dance video', s.includes('-2_3') ? ['480', '360'] : ['720', '480']) };
        });
        try {
            const sent = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: async () => { } });
            let s = md._sessions.get(JID);
            assert.ok(s.cards && s.cards.length === 1 && s.cards[0].stage === 'search' && s.cards[0].id === String(s.cardId), 'search card ringed');
            assert.strictEqual(md.bridge(JID, s.cardId, '2'), '.metdn go 2', 'newest quote');
            const sent2 = [];
            await md.handle('.metdn', { send: sendMock(sent2), jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async () => { } });
            s = md._sessions.get(JID);
            assert.strictEqual(s.stage, 'quality' && s.stage, 'quality stage');
            assert.strictEqual(s.stage, 'quality', 'at quality');
            assert.ok(s.cards.length >= 2, 'ring: search + quality');
            assert.ok(s.cards.some((c) => c.stage === 'search'), 'search entry kept');
            // THE metdn variant of the bug: re-quote the SEARCH card after quality card
            const searchEntry = s.cards.find((c) => c.stage === 'search');
            assert.strictEqual(md.bridge(JID, searchEntry.id, '1'), '.metdn go 1', 'search-card rewind (v2.89 → null)');
            const s2 = md._sessions.get(JID);
            assert.strictEqual(s2.stage, 'search', 'rewound to search');
            // pick item 1 → its quality card (different watch page)
            const sent3 = [];
            await md.handle('.metdn', { send: sendMock(sent3), jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
            const q = md._sessions.get(JID);
            assert.strictEqual(q.stage, 'quality', 'quality again');
            assert.strictEqual(q.id, '-2_2', 'item-1 wid');
            assert.ok(q.cards.some((c) => c.stage === 'search'), 'ring survived the new quality session');
        } finally { md.setFetcher(prev); md._sessions.clear(); }
    });

    await okA('quality re-pick post-download keep-alive: download → session alive → re-quote quality card → 2nd download other label', async () => {
        md._sessions.clear();
        const prev = md.setFetcher(async (url) => ({ ok: true, status: 200, text: async () => watchPageFix('X', ['720', '480']) }));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-4_1'], react: async () => { }, download: async (l, t) => dled.push({ l, t }) });
            let s = md._sessions.get(JID);
            assert.ok(s && s.stage === 'quality', 'quality session (link flow)');
            const qid = String(s.cardId);
            assert.strictEqual(md.bridge(JID, qid, '1'), '.metdn go 1', 'bridge quality');
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['1'], react: async () => { }, download: async (l, t) => dled.push({ l, t }) });
            assert.strictEqual(dled.length, 1, '1st download');
            assert.ok(dled[0].l.includes('_720p'), '720p');
            s = md._sessions.get(JID);
            assert.ok(s, '🕰️ session ALIVE after download (v2.89: deleted)');
            assert.strictEqual(md.bridge(JID, qid, '2'), '.metdn go 2', 're-quote SAME quality card → other label');
            await md.handle('.metdn', { send: sendMock(sent), jid: JID, msg: {}, rest: ['2'], react: async () => { }, download: async (l, t) => dled.push({ l, t }) });
            assert.strictEqual(dled.length, 2, '2nd download');
            assert.ok(dled[1].l.includes('_480p'), '480p without re-typing .metdn');
        } finally { md.setFetcher(prev); md._sessions.clear(); }
    });

    ok('metdn bridge: foreign quote + 0 + expired semantics unchanged', () => {
        md._sessions.clear();
        md._sessions.set(JID, { stage: 'quality', id: '-4_1', labels: ['720', '480'], at: Date.now(), cardId: 'QQ', cards: [] });
        assert.strictEqual(md.bridge(JID, 'NOPE', '1'), null, 'foreign → null');
        assert.strictEqual(md.bridge(JID, 'QQ', '0'), null, '0 → null');
        md._sessions.get(JID).at = Date.now() - 61 * 60e3;
        assert.strictEqual(md.bridge(JID, 'QQ', '1'), null, 'expired → null');
    });

    global.fetch = realFetch;
    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); global.fetch = realFetch; process.exit(1); });

// ───────── metdn fixtures (v2.88 shapes) ─────────
const ITEM = (id, title, v, t, hd, altOrder) => `<div class="item" data-video-title-base="${title}">
  <a ${altOrder ? `class="item_link" href="/watch/${id}"` : `href="/watch/${id}" class="item_link"`}>     <div class="i_img" data-trailer_url="https://tr.pvvstream.pro/videos/${id}/tr_240p.mp4?secure=A">
      <img src="data:image/gif;base64,R0lGODlh" data-src="https://cdn2.pvvstream.pro/videos/${id}/preview_320.jpg" class="lazyload widescreen" alt="${title}">
      ${hd ? `<i class="hd_mark">${hd}</i>` : ''}      <div class="m_views"><svg class="icon icon-eye"><use xlink:href="#eye"></use></svg> ${v}</div>      <div class="m_time"><svg class="icon icon-clock-o"><use xlink:href="#clock-o"></use></svg> ${t}</div>
      <div class="preview" title="Preview available on hover">        <svg class="icon icon-eye"><use xlink:href="#eye"></use></svg>        </div>  </div>  <div class="i_info">      <div class="title" data-video-title-text>${title}</div>  </div> </a> </div>`;
const SEARCH_P1_FIX = `<html><div class="list_videos">${ITEM('-2_2', 'Hot dance video', '2.81M', '1:48:28', 'HD')}${ITEM('-2_3', 'Street dance battle', '48.2K', '03:12', 'HD')}</div><div class="more" data-page="1" data-i18n="show_more">Show more</div></html>`;
const watchPageFix = (title, labels) => {
    const srcs = labels.map((l) => `{"file":"https://cdn.pvvstream.pro/videos/x/vid_${l}p.mp4?secure=S${l}\\u0026x=1","label":"${l}","type":"mp4"}`).join(',');
    return `<html><head><title>${title} - mat6tube</title><meta property="og:image" content="https://cdn2.pvvstream.pro/x/preview_800.jpg"></head><body><script>window.playlist = {"image":"https://cdn2.pvvstream.pro/x/preview_800.jpg","sources":[${srcs}],"trusted":true};</script></body></html>`;
};
