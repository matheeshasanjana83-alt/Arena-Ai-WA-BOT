/**
 * test_v290.js — 🔞 BINGE FLOW + 🕰️ FLOW TIME-MACHINE (combined v2.92 merge)
 * User video 2026-10-24 (lv_0_20261024211911.mp4): .hentaiv kazoku → EP1 quality '1' → download OK
 * → replies 2/3/4 quoted to the SAME EPISODES card → v2.89 stale-card hint only. User: 'මන් අනිත්
 * ep ගන්න හදනකොට command වැඩ කරන්නෙ නැනෙ පලවෙනි පාර විතරයි ගන්න පුලුවන් .hentaiv ගහලා'.
 * TWO stacked fixes (parallel sessions, merged in v2.92):
 *  (A) BINGE FLOW — prev-carrying quality sessions + restoreBack(): after download the menu card
 *      comes back → next EP without re-typing (v2.90/91 line).
 *  (B) TIME-MACHINE — done() card ring {id,stage,items,...} cap 12 + bridge() rewind: quoting an
 *      OLDER card (EP menu after the quality card, search card after flow advanced) rewinds to that
 *      stage — fixes the pre-download window prev-restore can't reach.
 * ALL OFFLINE (fake download fns + metdn setFetcher + global.fetch fixtures).
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
const hubSrc = fs.readFileSync('./animehub.js', 'utf8');
const mdSrc = fs.readFileSync('./metdn.js', 'utf8');

const sendM = async (j, c) => ({ key: { id: 'K' + Math.random() } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JID = 'tm92@s.whatsapp.net';   // module-level JID for the time-machine tests (binge tests use per-test JIDs)

// metdn fixtures (test_v288 shapes)
const item = (id, t) => `<div class="item"><a href="/watch/${id}" class="item_link"></a><img src="" data-src="b64"/><div class="i_info"><div class="title">${t}</div></div><div class="m_views">1K</div><div class="m_time">05:00</div></div>`;
const watchPage = (id, labels, title) => `\n<html><head><title>${title} - mat6tube</title><meta property="og:title" content="${title}"/><meta property="og:image" content="https://cdn2.pvvstream.pro/videos/${id}/preview_800.jpg"/><meta property="video:duration" content="300"/></head><body><script>window.playlist = {"image":"https://cdn2.pvvstream.pro/videos/${id}/preview_800.jpg","sources":[${labels.map((l) => `{"file":"https://pvvstream.pro/${id}/vid_${l}p.mp4","label":"${l}","type":"mp4"}`).join(',')}]};</script></body></html>`;
const routerMock = (pages, seen) => async (url, h = {}) => {
    seen.push({ url, h });
    const path = url.replace('https://mat6tube.com', '');
    for (const k of Object.keys(pages)) {
        if (path.startsWith(k) || path === k) return { ok: true, status: 200, text: async () => pages[k] };
    }
    return { ok: false, status: 404, text: async () => '' };
};

// ───────── (B) hentaiv offline fetch fixtures (qualitiesWH player-page ld+json path) ─────────
const whWatchPage = (title, player) => `<html><head><meta property="og:title" content="${title}"></head><body><iframe data-primary-player-url="${player}"></iframe></body></html>`;
const whPlayerPage = (src) => `<html><script type="application/ld+json">{"contentUrl":"${src}","name":"x"}</script></html>`;

(async () => {
    console.log('— v2.95.0 pins (binge + time-machine merged) —');
    ok('version 2.92 pkg+manifest + notes + prev/restore/ring markers', () => {
        assert.strictEqual(pkg.version, '2.95.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '2.95.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('BINGE FLOW'), 'v2.90 note in chain');
        assert.ok(manifest.notes.includes('TIME-MACHINE'), 'v2.92 note in chain');
        assert.ok(hubSrc.includes('const restoreBack'), 'restoreBack helper');
        assert.ok((hubSrc.match(/prev: s /g) || []).length === 3, 'hv/ep quality sessions carry prev ×3: ' + (hubSrc.match(/prev: s /g) || []).length);
        assert.ok(hubSrc.includes('restoreBack(jid, mySess)'), 'hv+ep restore call');
        assert.ok(hubSrc.includes('flow card ring') && hubSrc.includes('const hit = (s.cards || []).find'), '🕰️ ring + bridge rewind');
        assert.ok(hubSrc.includes("status(send, jid, msg, 'WatchHentai')"), 'hv status label');
        assert.ok(mdSrc.includes('prevSess') && mdSrc.includes('regCard') && mdSrc.includes('const hit = (s.cards || []).find'), 'metdn prev + ring + rewind');
        assert.ok(!/goPick[\s\S]*sessions\.delete\(jid\);\s*\n\s*const st = await send/.test(mdSrc), 'metdn upfront delete REMOVED');
    });

    console.log('— .hentaiv BINGE: the exact video flow —');
    await okA('EP1 download → EPISODES card RESTORED → bridge matches reply "2" → EP2 quality menu', async () => {
        const JID = 'binge290@s.whatsapp.net';
        hub._reset();
        try {
            const eps = [{ n: 1, url: 'https://watchhentai.net/videos/kazoku-episode-1', label: 'EP 1' }, { n: 2, url: 'https://watchhentai.net/videos/kazoku-episode-2', label: 'EP 2' }];
            const epSess = { cmd: 'hv', stage: 'ep', items: eps, title: 'Kazoku', at: Date.now(), cardId: 'EP CARD' };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/kazoku-ep1/b_720p.mp4', bytes: 1 }], title: 'Kazoku', at: Date.now(), cardId: 'QK', prev: epSess });
            const dled = [];
            await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (src, tag, cap) => { dled.push({ src, tag, cap }); await sleep(10); } });
            assert.strictEqual(dled.length, 1, 'download fired');
            assert.ok(dled[0].cap.includes('Kazoku'), 'cap carries title');
            const s = hub._sessions.get(JID);
            assert.ok(s && s.stage === 'ep' && s.items.length === 2, 'EPISODES session RESTORED');
            assert.ok(s.at > Date.now() - 5000, 'TTL refreshed');
            assert.strictEqual(hub.bridge(JID, 'EP CARD', '2'), '.hentaiv go 2', 'same EP card quote → next EP');
            const realFetch = global.fetch;
            global.fetch = async (url, o = {}) => {
                const u = String(url);
                const mk = (text, len) => ({ ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? len : null) }, text: async () => text });
                if (u.includes('wh.example/player/ep2')) return mk(whPlayerPage('https://hstorage.xyz/b/b_720p.mp4'), '88000000');
                if (u.includes('/videos/kazoku-episode-2')) return mk(whWatchPage('Kazoku EP 2', 'https://wh.example/player/ep2'));
                if (o && o.method === 'HEAD') return mk('', '88000000');
                return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope' };
            };
            try {
                const sent = [];
                await hub.handle('.hentaiv', { send: (j, c) => { sent.push({ c }); return { key: { id: 'X' + sent.length } }; }, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { } });
                const card = sent.map((x) => (x.c && x.c.text) || '').find((t) => t.includes('quality එක තෝරන්න'));
                assert.ok(card && card.includes('Kazoku EP 2'), 'EP2 quality menu (binge loop closed)');
            } finally { global.fetch = realFetch; }
        } finally { hub._reset(); }
    });

    await okA('hv single-EP series: download → SERIES (search) card restored', async () => {
        const JID = 'single290@s.whatsapp.net';
        hub._reset();
        try {
            const seriesSess = { cmd: 'hv', stage: 'series', items: [{ label: 'Solo', url: 'https://watchhentai.net/videos/solo' }], title: 'solo', at: Date.now(), cardId: 'SK' };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/solo/b_720p.mp4', bytes: 1 }], title: 'Solo', at: Date.now(), cardId: 'QK', prev: seriesSess });
            const dled = [];
            await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l) => { dled.push(l); } });
            const s = hub._sessions.get(JID);
            assert.ok(s && s.stage === 'series', 'series card restored');
            assert.strictEqual(hub.bridge(JID, 'SK', '1'), '.hentaiv go 1', 'series card re-pickable');
        } finally { hub._reset(); }
    });

    await okA('✅ hint bubble: restored download edits the progress bubble', async () => {
        const JID = 'hint290@s.whatsapp.net';
        hub._reset();
        try {
            const epSess = { cmd: 'hv', stage: 'ep', items: [{ n: 1, url: 'u1', label: 'EP 1' }], title: 'T', at: Date.now(), cardId: 'EPC' };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/b_720p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'QK', prev: epSess });
            let n = 0; const edits = [];
            const send = async (j, c) => { n++; if (c && c.edit) edits.push(c.text); return { key: { id: 'K' + n } }; };
            await hub.handle('.hentaiv', { send, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l) => { } });
            assert.ok(edits.some((t) => t && t.includes('අර menu card එකටම')), 'hint text sent: ' + edits.join(' | ').slice(0, 90));
        } finally { hub._reset(); }
    });

    await okA('mid-download NEW search → NO restore, new session untouched', async () => {
        const JID = 'race290@s.whatsapp.net';
        hub._reset();
        try {
            const epSess = { cmd: 'hv', stage: 'ep', items: [{ n: 1, url: 'u1', label: 'EP 1' }], title: 'T', at: Date.now(), cardId: 'EPC' };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/b_720p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'QK', prev: epSess });
            let release; const gate = new Promise((r) => { release = r; });
            const slowDl = async () => { await gate; };
            const p = hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: slowDl });
            await sleep(30);
            hub._sessions.set(JID, { cmd: 'hv', stage: 'series', items: [{ label: 'NEW' }], title: 'new', at: Date.now(), cardId: 'NEWC' });   // user search mid-download
            release();
            await p;
            const s = hub._sessions.get(JID);
            assert.ok(s && s.stage === 'series' && s.cardId === 'NEWC', 'new search session untouched (v2.89 identity semantics)');
        } finally { hub._reset(); }
    });

    await okA('no prev (link flow / legacy) → old delete behavior', async () => {
        const JID = 'noprev290@s.whatsapp.net';
        hub._reset();
        try {
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/b_720p.mp4', bytes: 1 }], title: 'T', at: Date.now(), cardId: 'QK' });
            await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l) => { } });
            assert.strictEqual(hub._sessions.get(JID), undefined, 'no prev → cleaned (v2.89 negative control)');
        } finally { hub._reset(); }
    });

    console.log('— 🕰️ TIME-MACHINE: the pre-download window (this session\'s video finding) —');
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
            const realFetch = global.fetch;
            global.fetch = async (url, o = {}) => {
                const u = String(url);
                const mk = (text, len) => ({ ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? len : null) }, text: async () => text });
                if (u.includes('wh.example/player/ep2')) return mk(whPlayerPage('https://hstorage.xyz/b/b_720p.mp4'), '88000000');
                if (u.includes('/videos/kazoku-episode-2')) return mk(whWatchPage('Kazoku EP 2', 'https://wh.example/player/ep2'));
                if (o && o.method === 'HEAD') return mk('', '88000000');
                return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope' };
            };
            try {
                const sent = [];
                await hub.handle('.hentaiv', { send: (j, c) => { sent.push({ c }); return { key: { id: 'X' + sent.length } }; }, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { } });
                const card = sent.map((x) => (x.c && x.c.text) || '').find((t) => t.includes('quality එක තෝරන්න'));
                assert.ok(card, 'quality card sent');
                assert.ok(card.includes('Kazoku EP 2'), 'EP2 title');
                assert.ok(card.includes('720p') && card.includes('84 MB'), 'quality row + HEAD size (88000000B → 84 MB)');
                assert.strictEqual(hub._sessions.get(JID).stage, 'quality', 'session at quality');
            } finally { global.fetch = realFetch; }
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
            const realFetch = global.fetch;
            global.fetch = async (url) => {
                const u = String(url);
                const mk = (text) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text });
                if (u.includes('/videos/paihame')) return mk(`<ul class="episodios"><li><a href='/videos/paihame-episode-1'>EP 1</a></li><li><a href='/videos/paihame-episode-2'>EP 2</a></li></ul>`);
                return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope' };
            };
            try {
                const sent = [];
                await hub.handle('.hentaiv', { send: (j, c) => { sent.push({ c }); return { key: { id: 'X' + sent.length } }; }, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { } });
                const card = sent.map((x) => (x.c && x.c.text) || '').find((t) => t.includes('Episodes'));
                assert.ok(card, 'EPISODES card of the NEW series');
                assert.ok(card.includes('Paihame Kazoku') && card.includes('EP 1') && card.includes('EP 2'), 'series title + eps from ul.episodios');
            } finally { global.fetch = realFetch; }
        } finally { hub._reset(); }
    });

    await okA('restored EP session (binge) still carries its ring → search-card re-pick works post-download too', async () => {
        hub._reset();
        try {
            const series = [{ label: 'Kazoku', title: 'Kazoku', url: 'https://watchhentai.net/videos/kazoku' }];
            const epSess = { cmd: 'hv', stage: 'ep', items: [{ n: 1, url: 'u1', label: 'EP 1' }], title: 'Kazoku', at: Date.now(), cardId: 'EPC', cards: [{ id: 'SKR', stage: 'series', items: series, title: 'kazoku', at: Date.now() }] };
            hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'https://hstorage.xyz/x/b_720p.mp4', bytes: 1 }], title: 'Kazoku', at: Date.now(), cardId: 'QK', prev: epSess });
            await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l) => { } });
            const s = hub._sessions.get(JID);
            assert.ok(s && s.stage === 'ep', 'restored to ep');
            assert.ok(s.cards && s.cards.some((c) => c.id === 'SKR'), 'ring survived the restore');
            assert.strictEqual(hub.bridge(JID, 'SKR', '1'), '.hentaiv go 1', 'search card alive after download (rewind from restored session)');
            assert.strictEqual(hub._sessions.get(JID).stage, 'series', 'rewound to series');
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

    await okA('foreign quote + 0 → null (v2.58 silence / v2.89 hint preserved)', () => {
        hub._reset();
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'u' }], title: 'T', at: Date.now(), cardId: 'KC', cards: [] });
        assert.strictEqual(hub.bridge(JID, 'KC', '1'), '.hentaiv go 1', 'newest-card quote unchanged');
        assert.strictEqual(hub.bridge(JID, 'FOREIGN', '1'), null, 'foreign quote → null');
        assert.strictEqual(hub.bridge(JID, 'KC', '0'), null, '0 → null');
        hub._reset();
    });

    console.log('— metdn: binge + time-machine —');
    await okA('search card ring seed → quality → re-quote SEARCH card → rewind → item-1 quality (was: null)', async () => {
        md._sessions.clear();
        const prev = md.setFetcher(routerMock({
            '/watch/-2_2': watchPage('-2_2', ['720', '480'], 'Hot dance video'),
            '/watch/-2_3': watchPage('-2_3', ['480', '360'], 'Street dance battle'),
            '/video/': `<html><div class="list_videos">${item('-2_2', 'Hot dance video')}${item('-2_3', 'Street dance battle')}</div><div class="more" data-page="1"></div></html>`,
        }, []));
        try {
            const sent = [];
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: async () => { } });
            let s = md._sessions.get(JID);
            assert.ok(s.cards && s.cards.length === 1 && s.cards[0].stage === 'search' && s.cards[0].id === String(s.cardId), 'search card ringed');
            assert.strictEqual(md.bridge(JID, s.cardId, '2'), '.metdn go 2', 'newest quote');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async () => { } });
            s = md._sessions.get(JID);
            assert.strictEqual(s.stage, 'quality', 'at quality');
            assert.ok(s.cards.length >= 2 && s.cards.some((c) => c.stage === 'search'), 'ring: search + quality');
            const searchEntry = s.cards.find((c) => c.stage === 'search');
            assert.strictEqual(md.bridge(JID, searchEntry.id, '1'), '.metdn go 1', 'search-card rewind (v2.89 → null)');
            assert.strictEqual(md._sessions.get(JID).stage, 'search', 'rewound to search');
            const sent3 = [];
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
            const q = md._sessions.get(JID);
            assert.strictEqual(q.stage, 'quality', 'quality again');
            assert.strictEqual(q.id, '-2_2', 'item-1 wid');
            assert.ok(q.cards.some((c) => c.stage === 'search'), 'ring survived the new quality session');
        } finally { md.setFetcher(prev); md._sessions.clear(); }
    });

    await okA('metdn BINGE: search-pick download → search menu restored → re-pick different row (prev path)', async () => {
        md._sessions.clear();
        const prev = md.setFetcher(routerMock({
            '/watch/-3_1': watchPage('-3_1', ['720', '480'], 'First video'),
            '/watch/-3_2': watchPage('-3_2', ['480', '360'], 'Second video'),
            '/video/': `<html><div class="list_videos">${item('-3_1', 'First video')}${item('-3_2', 'Second video')}</div></html>`,
        }, []));
        try {
            const sent = []; const dled = [];
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['q290'], react: async () => { }, download: async (l, t) => dled.push(l) });
            let s = md._sessions.get(JID);
            const searchCardId = String(s.cardId);
            assert.strictEqual(md.bridge(JID, searchCardId, '1'), '.metdn go 1', 'pick 1');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l, t) => dled.push(l) });   // → quality menu
            assert.strictEqual(md._sessions.get(JID).stage, 'quality', 'quality session');
            const qcard = String(md._sessions.get(JID).cardId);
            assert.strictEqual(md.bridge(JID, qcard, '1'), '.metdn go 1', 'quality pick 1');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l, t) => dled.push(l) });   // → download + restore
            assert.strictEqual(dled.length, 1, '1st download');
            s = md._sessions.get(JID);
            assert.ok(s && s.stage === 'search', 'search menu RESTORED after download (binge)');
            assert.strictEqual(md.bridge(JID, searchCardId, '2'), '.metdn go 2', 'same search card → row 2');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async (l, t) => dled.push(l) });   // → quality menu row 2
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l, t) => dled.push(l) });   // → 2nd download + restore
            assert.strictEqual(dled.length, 2, '2nd download without re-typing');
        } finally { md.setFetcher(prev); md._sessions.clear(); }
    });

    await okA('metdn bridge: foreign quote + 0 + expired semantics unchanged', () => {
        md._sessions.clear();
        md._sessions.set(JID, { stage: 'quality', id: '-4_1', labels: ['720', '480'], at: Date.now(), cardId: 'QQ', cards: [] });
        assert.strictEqual(md.bridge(JID, 'NOPE', '1'), null, 'foreign → null');
        assert.strictEqual(md.bridge(JID, 'QQ', '0'), null, '0 → null');
        md._sessions.get(JID).at = Date.now() - 61 * 60e3;
        assert.strictEqual(md.bridge(JID, 'QQ', '1'), null, 'expired → null');
        md._sessions.clear();
    });

    console.log(`\nv2.92 binge + time-machine: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
