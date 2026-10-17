/**
 * test_v262.js — EPISODE NUMBERS + REAL SIZES (user screenshots 2026-10-16 13:16)
 * Bug 1 (off-by-one): reply "123" on the Black Clover card opened "Season 1 Episode 122" —
 *   the old tvRows put the 📦 season-pack row FIRST, stealing pick #1 so every episode sat
 *   at pick N+1 (menu printed "*123* E122"). FIX: episodes first → pick N = episode N on
 *   single-season shows; each season's pack row takes the number AFTER its episodes.
 * Bug 2 ("~1 MB" everywhere): MovieBox resource LIST `size` went junk — every row reports
 *   the same ~0.8MB preview byte-count (live: E1 1080p == E1 360p == "824720"). FIX: exact
 *   size per row via resource-position/v2 (the download-time call; E122 720p → 94475173 =
 *   90.1MB), rid-cached; junk fallback guarded out (bitrate/2MB sanity) instead of lying.
 * Run: node test_v262.js   (fully OFFLINE — mocked fetch, no MovieBox calls)
 *  [1] tvRows — pick N = E N, pack row = maxEp+1, multi-season continuation
 *  [2] seriesText — menu prints row 1 = E1, user-bug pin row 123 = E123, pack last
 *  [3] sizes — position exact / junk hidden on position-fail / plausible kept / rid cache
 *  [4] REAL handle() E2E — reply "123" → Season 1 Episode 123 menu + REAL MB shown
 *  [5] bridgeReply — quoted "123" on the series card routes ".moviedex 1 123" (WYSIWYG)
 *  [6] version + source pins
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const mdx = require('./moviedex.js');

let pass = 0, fail = 0;
async function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return await r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

/* ── mock world: resource list = JUNK sizes (the live 2026-10 shape), position = real ── */
const B = 1048576;
const JUNK = '824720';   // identical across resolutions — the exact live junk value
const row = (res, ep) => ({ se: 1, ep, resolution: res, size: JUNK, duration: 1434, resourceId: `R${res}E${ep}`, codecName: 'hevc', vipInfo: { requireMemberType: 0 } });
const REAL = { 1080: 244 * B, 720: 94475173, 480: 52 * B, 360: 38 * B };   // position/v2 exact bytes (720 from the live probe)
const POS_REQS = [];
let POSITION_FAIL = false;

const EPS = Array.from({ length: 170 }, (_, i) => i + 1);
const _origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/subject-api/resource?')) {
        const q = new URL(u);
        const res = Number(q.searchParams.get('resolution')) || 0;
        const page = Number(q.searchParams.get('page')) || 1;
        const list = EPS.slice((page - 1) * 20, page * 20).map(ep => row(res, ep));
        return Response.json({ code: 0, data: { list, totalCount: EPS.length } });
    }
    if (u.includes('/subject-api/resource-position/v2?')) {
        const q = new URL(u);
        const rid = String(q.searchParams.get('resourceId') || '');
        POS_REQS.push(rid);
        if (POSITION_FAIL) return Response.json({ code: 500, message: 'boom' });
        const m = /^R(\d+)E\d+$/.exec(rid);
        return Response.json({ code: 0, data: { list: [{ resourceId: rid, size: String(m ? REAL[Number(m[1])] || 0 : 0) }] } });
    }
    if (u.includes('/subject-api/play-info/v2?')) return Response.json({ code: 0, data: { streams: [] } });
    if (u.includes('/subject-api/get-ext-captions?')) {
        return Response.json({ code: 0, data: { extCaptions: [{ url: 'https://x/en.srt', lan: 'en', lanName: 'English', size: 24000 }] } });
    }
    return _origFetch(url, opts);
};

const SELF = '94771234567@s.whatsapp.net';
const SENT = [];
let GID = 0, N = 0;
const send = async (jid, content, opts) => { SENT.push({ jid, content, opts }); return { key: { id: 's' + (++GID), remoteJid: jid } }; };
const lastText = () => String((SENT[SENT.length - 1] || {}).content?.text || '');
const mk = (text) => ({ key: { remoteJid: SELF, fromMe: true, id: 'm' + (++N) + Math.random().toString(36).slice(2, 8) }, message: { conversation: text } });

(async () => {
    console.log('== v2.62 episode numbers + real sizes ==\n[1] tvRows — pick N = episode N');
    const rows170 = mdx.tvRows([{ se: 1, maxEp: 170 }]);
    await ok('reply 123 → Season 1 Episode 123 (THE user bug: was E122)', () => assert.deepStrictEqual(rows170[122], { kind: 'ep', season: 1, ep: 123 }));
    await ok('reply 1 → E1 (was the season pack)', () => assert.deepStrictEqual(rows170[0], { kind: 'ep', season: 1, ep: 1 }));
    await ok('reply 170 → E170', () => assert.strictEqual(rows170[169].ep, 170));
    await ok('pack row moved AFTER its episodes: pick 171 = 📦 Season 1', () => assert.deepStrictEqual(rows170[170], { kind: 'season', season: 1, maxEp: 170 }));
    const rowsBC = mdx.tvRows([{ se: 1, maxEp: 170 }, { se: 2, maxEp: 2 }]);
    await ok('multi-season: S2 episodes continue after the S1 pack row (172-173)', () => { assert.deepStrictEqual(rowsBC[171], { kind: 'ep', season: 2, ep: 1 }); assert.deepStrictEqual(rowsBC[172], { kind: 'ep', season: 2, ep: 2 }); });
    await ok('multi-season: S2 pack row LAST (174)', () => assert.deepStrictEqual(rowsBC[173], { kind: 'season', season: 2, maxEp: 2 }));

    console.log('\n[2] seriesText — the printed menu matches the pick map');
    const M = { name: 'Black Clover', year: '2017', desc: 'x', poster: 'http://x/p.jpg' };
    const t = mdx.seriesText(M, 1, rowsBC);
    await ok('menu prints row 1 = E1', () => assert.ok(/\*1\* E1\b/.test(t)));
    await ok('menu prints row 123 = E123 (screenshot bug pin)', () => assert.ok(/\*123\* E123\b/.test(t)));
    await ok('menu prints the pack row AFTER its episodes (row 171)', () => assert.ok(/\*171\* \| 📦 Download Season 1 \(All Episodes\)/.test(t)));

    console.log('\n[3] sizes — position/v2 exact, junk guarded');
    mdx.MB_POS_SIZE?.clear?.();
    POS_REQS.length = 0;
    let qrows = await mdx.mbDirectRows('SID_SIZES', 1, 123);
    await ok('720p row carries the EXACT position size (90MB, was ~1MB junk)', () => { const r = qrows.find(x => x.h === 720); assert.strictEqual(r.sizeMB, Math.round(REAL[720] / B)); });
    await ok('1080p row exact (244MB)', () => { const r = qrows.find(x => x.h === 1080); assert.strictEqual(r.sizeMB, Math.round(REAL[1080] / B)); });
    await ok('one position call per row (4 rows → 4 position fetches)', () => assert.strictEqual(POS_REQS.length, 4));
    POS_REQS.length = 0;
    await mdx.mbDirectRows('SID_SIZES', 1, 123);
    await ok('rid cache: same episode re-probe = 0 new position fetches', () => assert.strictEqual(POS_REQS.length, 0));
    POSITION_FAIL = true;
    mdx.MB_POS_SIZE?.clear?.();
    qrows = await mdx.mbDirectRows('SID_SIZES', 1, 123);
    await ok('position fail + junk list size → sizeMB hidden (0), never "~1 MB"', () => assert.ok(qrows.every(r => r.sizeMB === 0), JSON.stringify(qrows.map(r => r.sizeMB))));
    POSITION_FAIL = false;
    mdx.MB_POS_SIZE?.clear?.();
    // plausible list size + position fail → kept (future-proof: if MovieBox fixes list sizes)
    const origFetch2 = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('/subject-api/resource?')) {
            const q = new URL(u);
            const res = Number(q.searchParams.get('resolution')) || 0;
            return Response.json({ code: 0, data: { list: [{ se: 1, ep: 5, resolution: res, size: String(90 * B), duration: 1434, resourceId: `P${res}`, vipInfo: { requireMemberType: 0 } }], totalCount: 1 } });
        }
        if (u.includes('/subject-api/resource-position/v2?')) return Response.json({ code: 500, message: 'boom' });
        return origFetch2(url, opts);
    };
    qrows = await mdx.mbDirectRows('SID_PLAUSIBLE', 1, 5);
    await ok('position fail + PLAUSIBLE list size (90MB/24min) → kept', () => assert.ok(qrows.every(r => r.sizeMB === 90), JSON.stringify(qrows.map(r => r.sizeMB))));
    await ok('mbSizePlausible: junk 0.8MB/24min = false, 90MB/24min = true, 0/unknown = false', () => {
        assert.strictEqual(mdx.mbSizePlausible(0.8, 1434), false);
        assert.strictEqual(mdx.mbSizePlausible(90, 1434), true);
        assert.strictEqual(mdx.mbSizePlausible(0.8, 0), false);
        assert.strictEqual(mdx.mbSizePlausible(0, 1434), false);
    });
    globalThis.fetch = origFetch2;

    console.log('\n[4] handle() E2E — reply 123 → Episode 123 menu with real MB');
    const J1 = 'v262-a@s.whatsapp.net';
    mdx._testSession(J1, {
        list: [{ sid: 'SID_SIZES', name: 'Black Clover', type: 'series' }],
        detail: { 1: { sid: 'SID_SIZES', name: 'Black Clover', type: 'series', at: Date.now() } },
        tv: { 1: { at: Date.now(), seasons: [{ se: 1, maxEp: 170 }] } },
        mv: {}, at: Date.now(),
    });
    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 123'), rest: ['1', '123'], react: () => { } });
    await ok('reply "123" → header Season 1 Episode 123 (was E122)', () => assert.ok(/SELECT DOWNLOAD OPTION.*Season 1 Episode 123/s.test(lastText()), lastText().slice(0, 90)));
    await ok('menu shows the REAL 720p size "~90 MB" (was "~1 MB")', () => assert.ok(/720p · ~90 MB/.test(lastText()), lastText().split('\n').filter(l => l.includes('720p'))[0] || ''));
    await ok('no "~1 MB" junk anywhere on the menu', () => assert.ok(!/· ~1 MB/.test(lastText())));
    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 2'), rest: ['1', '2'], react: () => { } });
    await ok('reply "2" → Episode 2 menu (was E1)', () => assert.ok(/Season 1 Episode 2\b/.test(lastText()), lastText().slice(0, 90)));
    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 171'), rest: ['1', '171'], react: () => { } });
    await ok('reply "171" → 📦 Season pack quality card (pack = maxEp+1)', () => assert.ok(/SEASON 1 — SELECT DOWNLOAD OPTION/.test(lastText()), lastText().slice(0, 90)));
    await ok('season pack card shows per-ep size too', () => assert.ok(/\/ep/.test(lastText())));

    console.log('\n[5] bridgeReply — quoted digits stay WYSIWYG');
    const J2 = 'v262-b@s.whatsapp.net';
    mdx._testSession(J2, {
        list: [{ sid: 'SID_SIZES', name: 'Black Clover', type: 'series' }],
        at: Date.now(),
        ui: { key: 'CARD1', kind: 'tv', n: 1, rowNo: null, at: Date.now() },
        cards: [{ key: 'CARD1', kind: 'tv', n: 1, rowNo: null, at: Date.now() }],
    });
    await ok('quoted "123" on the series card → .moviedex 1 123', () => assert.strictEqual(mdx.bridgeReply(J2, 'CARD1', '123'), '.moviedex 1 123'));
    await ok('quoted "5" on an ep menu → .moviedex 1 5 5 (row + quality grammar unchanged)', () => {
        const s = mdx._sessions.get(J2);
        s.ui = { key: 'CARD2', kind: 'ep', n: 1, rowNo: 5, at: Date.now() };
        s.cards = [{ key: 'CARD2', kind: 'ep', n: 1, rowNo: 5, at: Date.now() }];
        assert.strictEqual(mdx.bridgeReply(J2, 'CARD2', '5'), '.moviedex 1 5 5');
    });

    console.log('\n[6] version + source pins');
    await ok('package.json 2.65.0', () => assert.strictEqual(require('./package.json').version, '2.65.0'));
    await ok('manifest.json 2.65.0 + notes mention episode numbers / real sizes', () => { const m = JSON.parse(fs.readFileSync('manifest.json')); assert.strictEqual(m.version, '2.65.0'); assert.ok(/EPISODE NUMBERS|REAL SIZES/i.test(m.notes)); });
    await ok('moviedex.js pins: episodes-first tvRows + position-size helpers present', () => {
        const src = fs.readFileSync('moviedex.js', 'utf8');
        assert.ok(src.includes('function mbPositionSize'));
        assert.ok(src.includes('function mbSizePlausible'));
        assert.ok(src.includes('EPISODES FIRST, each season\'s 📦 pack row LAST'.replace("\\'", "'")));
        const trIdx = src.indexOf('function tvRows');
        assert.ok(trIdx > 0);
        const body = src.slice(trIdx, trIdx + 400);
        assert.ok(body.indexOf("kind: 'ep'") < body.indexOf("kind: 'season'"), 'tvRows pushes eps before the pack row');
    });
    await ok('manifest files list includes test_v262.js', () => assert.ok(JSON.parse(fs.readFileSync('manifest.json')).files.includes('test_v262.js')));

    globalThis.fetch = _origFetch;
    console.log(`\n═══ v2.62 episode numbers + real sizes: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); globalThis.fetch = _origFetch; process.exit(1); });
