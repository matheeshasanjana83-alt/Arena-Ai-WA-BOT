/**
 * test_v290.js — 🔞 BINGE FLOW (session restore-after-download)
 * User video 2026-10-24: .hentaiv kazoku → EP1 quality '1' → 110MB download OK → replies
 * 2/3/4 quoted to the SAME EPISODES card → only the v2.89 stale-card hint. User: 'මන් අනිත්
 * ep ගන්න හදනකොට command වැඩ කරන්නෙ නැනෙ පලවෙනි පාර විතරයි ගන්න පුලුවන්'.
 * Root: quality stage REPLACES the ep/series session + success cleanup deletes the whole chain.
 * Fix: prev-carrying quality sessions + restoreBack() — menu card stays alive for the next pick.
 * ALL OFFLINE (fake download fns + metdn setFetcher fixtures).
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

(async () => {
    console.log('— v2.90.0 pins —');
    ok('version 2.90 pkg+manifest + notes + prev/restore markers', () => {
        assert.strictEqual(pkg.version, '2.90.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '2.90.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('BINGE FLOW'), 'notes headline');
        assert.ok(hubSrc.includes('const restoreBack'), 'restoreBack helper');
        assert.ok((hubSrc.match(/prev: s /g) || []).length === 3, 'hv/ep quality sessions carry prev ×3: ' + (hubSrc.match(/prev: s /g) || []).length);
        assert.ok(hubSrc.includes('restoreBack(jid, mySess)'), 'hv+ep restore call');
        assert.ok(mdSrc.includes('prevSess'), 'metdn qualityMenu prevSess param');
        assert.ok(!/goPick[\s\S]*sessions\.delete\(jid\);\s*\n\s*const st = await send/.test(mdSrc), 'metdn upfront delete REMOVED');
    });

    console.log('— .hentaiv BINGE: the exact video flow —');
    await okA('EP1 download → EPISODES card RESTORED → bridge matches reply "2" → EP2 quality menu', async () => {
        const JID = 'binge290@s.whatsapp.net';
        hub._reset();
        const epSess = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'http://wh/e1' }, { label: 'EP 2', url: 'http://wh/e2' }, { label: 'EP 3', url: 'http://wh/e3' }], title: 'Kazoku', at: Date.now(), cardId: 'CARD-EP' };
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: 'default (110 MB)', src: 'http://cdn/f1.mp4' }], title: 'Kazoku EP1', at: Date.now(), cardId: 'CARD-Q', prev: epSess });
        const dled = [];
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (src, tag, cap) => { dled.push({ src, tag, cap }); await sleep(10); } });
        assert.strictEqual(dled.length, 1, 'download called');
        assert.ok(dled[0].cap.includes('Kazoku'), 'cap carries title');
        const s = hub._sessions.get(JID);
        assert.strictEqual(s, epSess, 'EPISODES session RESTORED (same object)');
        assert.ok(s.at > Date.now() - 5000, 'TTL refreshed');
        assert.strictEqual(hub.bridge(JID, 'CARD-EP', '2'), '.hentaiv go 2', 'reply 2 to the SAME EPISODES card routes');
        // full loop: EP2 pick → new quality session (prev again = epSess) → download → restore again
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async () => { } });
        const s2 = hub._sessions.get(JID);
        assert.strictEqual(s2, epSess, 'binge loop: EP2 → quality → restore AGAIN');
        assert.strictEqual(hub.bridge(JID, 'CARD-EP', '3'), '.hentaiv go 3', 'EP3 still reachable');
    });

    await okA('hv single-EP series: download → SERIES (search) card restored', async () => {
        const JID = 'binge290b@s.whatsapp.net';
        hub._reset();
        const seriesSess = { cmd: 'hv', stage: 'series', items: [{ label: 'Other Title', url: 'http://wh/other' }], title: 'solo', at: Date.now(), cardId: 'CARD-SR' };
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'http://cdn/s.mp4' }], title: 'solo', at: Date.now(), cardId: 'CARD-Q2', prev: seriesSess });
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.strictEqual(hub._sessions.get(JID), seriesSess, 'series card restored');
        assert.strictEqual(hub.bridge(JID, 'CARD-SR', '1'), '.hentaiv go 1', 'next series reachable');
    });

    await okA('✅ hint bubble: restored download edits the progress bubble', async () => {
        const JID = 'binge290c@s.whatsapp.net';
        hub._reset();
        const epSess = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'u1' }], title: 'T', at: Date.now(), cardId: 'E' };
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: 'default', src: 'http://c/v.mp4' }], title: 'T', at: Date.now(), cardId: 'Q', prev: epSess });
        const edits = [];
        const sendEdit = async (j, c) => { if (c && c.edit) edits.push(c.text); return { key: { id: 'K' + Math.random() } }; };
        await hub.handle('.hentaiv', { send: sendEdit, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.ok(edits.some((t) => t && t.includes('අර menu card එකටම')), 'hint text sent: ' + edits.join(' | ').slice(0, 90));
    });

    console.log('— identity guard interplay (v2.89 semantics preserved) —');
    await okA('mid-download NEW search → NO restore, new session untouched', async () => {
        const JID = 'guard290@s.whatsapp.net';
        hub._reset();
        const epSess = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'u' }], title: 'T', at: Date.now(), cardId: 'E' };
        const qSess = { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'http://c/v.mp4' }], title: 'T', at: Date.now(), cardId: 'Q', prev: epSess };
        hub._sessions.set(JID, qSess);
        const NEW = { cmd: 'hv', stage: 'series', items: [{ label: 'NEW', url: 'n', title: 'NEW' }], title: 'NEW', at: Date.now(), cardId: 'C2' };
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { hub._sessions.set(JID, NEW); } });
        assert.strictEqual(hub._sessions.get(JID), NEW, 'NEW session survives');
        assert.strictEqual(hub.bridge(JID, 'C2', '1'), '.hentaiv go 1', 'NEW card bridge works');
        assert.notStrictEqual(hub._sessions.get(JID), epSess, 'NO restore over the new search');
    });

    await okA('no prev (link flow / legacy) → old delete behavior', async () => {
        const JID = 'noprev290@s.whatsapp.net';
        hub._reset();
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'http://c/v.mp4' }], title: 'ONE', at: Date.now(), cardId: 'C3' });
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.strictEqual(hub._sessions.get(JID), undefined, 'session cleaned (v2.89 compat)');
    });

    console.log('— .ep search-card restore —');
    await okA('eporner: download → search card restored → bridge routes next video', async () => {
        const JID = 'ep290@s.whatsapp.net';
        hub._reset();
        const searchSess = { cmd: 'ep', stage: 'search', items: [{ label: 'V1', url: 'http://ep/v1' }, { label: 'V2', url: 'http://ep/v2' }], title: 'q', at: Date.now(), cardId: 'CARD-EPQ' };
        hub._sessions.set(JID, { cmd: 'ep', stage: 'quality', items: [{ label: '1080p HD', src: 'http://epcdn/1.mp4' }], title: 'V1', at: Date.now(), cardId: 'CARD-EQ', prev: searchSess });
        await hub.handle('.ep', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.strictEqual(hub._sessions.get(JID), searchSess, 'search session restored');
        assert.strictEqual(hub.bridge(JID, 'CARD-EPQ', '2'), '.ep go 2', 'next video reachable');
    });

    console.log('— .metdn FULL binge flow (setFetcher offline) —');
    await okA('search menu → quality → download → SEARCH CARD re-pick + .metdn more survives', async () => {
        const JID = 'md290@s.whatsapp.net';
        md._sessions.delete(JID);
        const SEARCH = `<html><div class="list_videos">${item('-2_1', 'Dance one')}${item('-2_2', 'Dance two')}</div><div class="more" data-page="1">Show more</div></html>`;
        const seen = []; const prev = md.setFetcher(routerMock({ '/video/dance': SEARCH, '/watch/-2_1': watchPage('-2_1', [720, 480], 'Dance one'), '/watch/-2_2': watchPage('-2_2', [480], 'Dance two') }, seen));
        try {
            const dled = [];
            const DL = (a) => async (l, tag) => { a.push({ l, tag }); await sleep(5); };
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['dance'], react: async () => { }, download: DL(dled) });
            const searchSess = md._sessions.get(JID);
            assert.ok(searchSess && searchSess.stage === 'search' && searchSess.items.length === 2, 'search session');
            const searchCardId = searchSess.cardId;
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: DL(dled) });   // → quality menu
            const qSess = md._sessions.get(JID);
            assert.ok(qSess.stage === 'quality' && qSess.labels.map(String).includes('720'), 'quality session');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: DL(dled) });   // → download 720p
            assert.strictEqual(dled.length, 1, 'download fired');
            const after = md._sessions.get(JID);
            assert.strictEqual(after, searchSess, 'SEARCH session restored after download');
            assert.strictEqual(after.q, 'dance', '.metdn more query survives restore');
            assert.strictEqual(md.bridge(JID, searchCardId, '2'), '.metdn go 2', 'reply 2 to the SAME search card routes');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: DL(dled) });   // pick video 2 → quality
            assert.ok(md._sessions.get(JID).stage === 'quality', 'video 2 → quality menu');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: DL(dled) });   // download
            assert.strictEqual(dled.length, 2, 'second download fired');
            assert.strictEqual(md._sessions.get(JID), searchSess, 'binge loop closes: search card alive AGAIN');
        } finally { md.setFetcher(prev); md._sessions.delete(JID); }
    });

    await okA('metdn fetch-fail → quality session KEPT (re-pick retry, was: killed upfront)', async () => {
        const JID = 'mdfail290@s.whatsapp.net';
        md._sessions.delete(JID);
        const SEARCH = `<html><div class="list_videos">${item('-3_1', 'X one')}</div></html>`;
        let failNext = false;
        const prev = md.setFetcher(routerMock({ '/video/x': SEARCH, '/watch/-3_1': watchPage('-3_1', [480], 'X one') }, []));
        try {
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['x'], react: async () => { }, download: async () => { } });
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
            assert.ok(md._sessions.get(JID).stage === 'quality', 'quality stage reached');
            md.setFetcher(async () => { throw new Error('network dead'); });   // next fetch fails
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
            const s = md._sessions.get(JID);
            assert.ok(s && s.stage === 'quality', 'quality session SURVIVED the fetch fail (re-pick possible)');
            assert.strictEqual(md.bridge(JID, s.cardId, '1'), '.metdn go 1', 're-pick routes');
        } finally { md.setFetcher(prev); md._sessions.delete(JID); }
    });

    await okA('metdn link-flow (no prev) → old delete behavior after download', async () => {
        const JID = 'mdlink290@s.whatsapp.net';
        md._sessions.delete(JID);
        const prev = md.setFetcher(routerMock({ '/watch/-4_1': watchPage('-4_1', [360], 'Solo') }, []));
        try {
            const dled = [];
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['https://mat6tube.com/watch/-4_1'], react: async () => { }, download: async (l, t) => { dled.push(l); } });
            assert.ok(md._sessions.get(JID).stage === 'quality', 'quality menu from link');
            await md.handle('.metdn', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (l, t) => { dled.push(l); } });
            assert.strictEqual(dled.length, 1, 'download fired');
            assert.strictEqual(md._sessions.get(JID), undefined, 'no prev → cleaned (old behavior)');
        } finally { md.setFetcher(prev); md._sessions.delete(JID); }
    });

    console.log(`\nv2.90 binge flow: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
