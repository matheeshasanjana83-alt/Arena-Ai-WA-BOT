/**
 * test_v261.js — DEEP EPISODES FIX: mbResourceItems walks past the old 6-page cap.
 * User bug (Black Clover): E124/125 → "streams නෑ"; E123 quality menu showed ONLY 720p
 * (360p/1080p/480p rows live on resource page 7+, the old walk stopped at page 6 = 120 rows).
 * Run: node test_v261.js   (fully OFFLINE — mocked fetch, no MovieBox calls)
 *  [1] pagination — deep ep (page 7) found on ALL resolutions; totalCount stop (no empty-page walk)
 *  [2] early-exit — early ep (page 1 hit) = exactly 1 request per resolution
 *  [3] 15-page safety cap — 400-row season, ep on page 18 → graceful []
 *  [4] VIP row skipped, other resolutions still found
 *  [5] fallback-label safety — row keeps its OWN resolution (query param never mislabels)
 *  [6] REAL handle() E2E — deep-episode quality menu (E124: 360p present, no "streams නෑ")
 *      + E123 menu shows BOTH 720p and 360p + subtitle section present
 *  [7] version pins
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const mdx = require('../moviedex.js');

let pass = 0, fail = 0;
async function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return await r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

/* ── mock MovieBox resource world ── */
const B = 1048576;
const row = (res, ep, extra = {}) => ({ se: 1, ep, resolution: res, size: res * 90 * B / 1000 * 1000, resourceId: `R${res}E${ep}`, codecName: 'H264', vipInfo: { requireMemberType: 0 }, ...extra });

// per-sid worlds: resolution → sorted ep list (mirrors the verified live shape: se/ep ignored, ep-sorted, 20/page, totalCount present)
const WORLDS = (() => {
    const full = Array.from({ length: 170 }, (_, i) => i + 1);
    const miss26 = new Set([4, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 114, 116, 120, 124, 125, 132, 133, 139, 150, 155, 160, 165, 168, 170]);
    return {
        SID_MAIN: {                                            // Black Clover shape: 1080/480/360 = 172 rows, 720 = 144
            sets: { 1080: full, 480: full, 360: full, 720: full.filter(e => !miss26.has(e)) },
            vip1080: new Set(), fallback: null,
        },
        SID_VIP: { sets: { 1080: full, 480: full, 360: full, 720: full.filter(e => !miss26.has(e)) }, vip1080: new Set([126]), fallback: null },
        SID_FALLBACK: { sets: { 1080: full, 480: full, 360: full, 720: full.filter(e => !miss26.has(e)) }, vip1080: new Set(), fallback: 1080 },   // 1080-query returns 360-labeled rows
        SID_CAP: { sets: { 1080: Array.from({ length: 400 }, (_, i) => i + 1), 480: [], 360: [], 720: [] }, vip1080: new Set(), fallback: null },  // ep 350 = page 18
    };
})();

const REQS = [];
const _origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/subject-api/resource?')) {
        const q = new URL(u);
        const sid = q.searchParams.get('subjectId'), res = Number(q.searchParams.get('resolution')) || 0;
        const page = Number(q.searchParams.get('page')) || 1;
        REQS.push({ sid, res, page });
        const w = WORLDS[sid];
        if (!w) return Response.json({ code: 0, data: { list: [], totalCount: 0 } });
        let eps = w.sets[res] || [];
        let labelRes = res;
        if (w.fallback === res) { eps = w.sets[360]; labelRes = 360; }   // server falls back to the default listing for a dead resolution
        const totalCount = eps.length;
        const list = eps.slice((page - 1) * 20, page * 20).map(ep => row(labelRes, ep, labelRes === 1080 && w.vip1080.has(ep) ? { vipInfo: { requireMemberType: 1 } } : {}));
        return Response.json({ code: 0, data: { list, totalCount } });
    }
    if (u.includes('/subject-api/play-info/v2?')) return Response.json({ code: 0, data: { streams: [] } });   // legacy DASH dead — same as live
    if (u.includes('/subject-api/resource-position/v2?')) {   // v2.62: per-row exact-size call (rid R<res>E<ep> → res*90 MB)
        const q = new URL(u);
        const rid = String(q.searchParams.get('resourceId') || '');
        const mres = /^R(\d+)E\d+$/.exec(rid);
        const bytes = mres ? Number(mres[1]) * 90 * 1000 * 1000 : 0;
        return Response.json({ code: 0, data: { list: [{ resourceId: rid, size: String(bytes), resolution: mres ? Number(mres[1]) : 0 }] } });
    }
    if (u.includes('/subject-api/get-ext-captions?')) {
        return Response.json({ code: 0, data: { extCaptions: [
            { url: 'https://x/en.srt', lan: 'en', lanName: 'English', size: 24000 },
            { url: 'https://x/si.srt', lan: 'si', lanName: 'Sinhala', size: 31000 },
        ] } });
    }
    return _origFetch(url, opts);
};

const countRes = (sid, res) => REQS.filter(r => r.sid === sid && r.res === res).length;
const maxPage = (sid, res) => Math.max(0, ...REQS.filter(r => r.sid === sid && r.res === res).map(r => r.page));

const SELF = '94771234567@s.whatsapp.net';
const SENT = [];
let GID = 0, N = 0;
const send = async (jid, content, opts) => { SENT.push({ jid, content, opts }); return { key: { id: 's' + (++GID), remoteJid: jid } }; };
const lastText = () => String((SENT[SENT.length - 1] || {}).content?.text || '');
const mk = (text) => ({ key: { remoteJid: SELF, fromMe: true, id: 'm' + (++N) + Math.random().toString(36).slice(2, 8) }, message: { conversation: text } });

(async () => {
    console.log('== v2.61 deep episodes ==\n[1] pagination — deep ep found past the old 6-page cap');
    let rows = await mdx.mbDirectRows('SID_MAIN', 1, 124);
    await ok('E124 (rows on page 7): 3 quality rows found (was "streams නෑ" before)', () => assert.deepStrictEqual(rows.map(r => r.h), [1080, 480, 360]));
    await ok('E124 rids carry the ep + resolution (direct download keys intact)', () => assert.ok(rows.every(r => r.direct.rid === `R${r.h}E124` && r.direct.sid === 'SID_MAIN')));
    await ok('360 walk stopped ON the hit page (7), not at the cap', () => assert.strictEqual(maxPage('SID_MAIN', 360), 7));
    await ok('720 walk stopped via totalCount=144 → page 8, NO trailing empty page', () => { assert.strictEqual(countRes('SID_MAIN', 720), 8); assert.strictEqual(maxPage('SID_MAIN', 720), 8); });
    rows = await mdx.mbDirectRows('SID_MAIN', 1, 123);
    await ok('E123: full ladder now — 1080/720/480/360 (was 720p only)', () => assert.deepStrictEqual(rows.map(r => r.h), [1080, 720, 480, 360]));

    console.log('\n[2] early-exit — early ep stays fast');
    REQS.length = 0;
    rows = await mdx.mbDirectRows('SID_MAIN', 1, 5);
    await ok('E5 found with exactly 4 requests (1 per resolution, hit on page 1)', () => { assert.strictEqual(rows.length, 4); assert.strictEqual(REQS.length, 4); });

    console.log('\n[3] 15-page safety cap');
    REQS.length = 0;
    rows = await mdx.mbDirectRows('SID_CAP', 1, 350);   // lives on page 18 — beyond the cap
    await ok('ep beyond the 300-row cap → graceful [] (no hang, no throw)', () => assert.deepStrictEqual(rows, []));
    await ok('each live resolution walked exactly 15 pages then stopped', () => { assert.strictEqual(countRes('SID_CAP', 1080), 15); assert.strictEqual(countRes('SID_CAP', 480), 1); });
    REQS.length = 0;
    rows = await mdx.mbDirectRows('SID_CAP', 1, 20);    // page 1 ep — fast even in a 400-row season
    await ok('early ep in a 400-row season: hit on page 1 (4 requests = 1 per resolution)', () => { assert.strictEqual(rows.length, 1); assert.strictEqual(REQS.length, 4); });

    console.log('\n[4] VIP rows skipped, rest of the ladder kept');
    rows = await mdx.mbDirectRows('SID_VIP', 1, 126);
    await ok('E126 1080p VIP-locked → honest skip, 720/480/360 still offered', () => assert.deepStrictEqual(rows.map(r => r.h), [720, 480, 360]));

    console.log('\n[5] fallback-label safety — row keeps its OWN resolution');
    rows = await mdx.mbDirectRows('SID_FALLBACK', 1, 5);
    await ok('1080-query returning 360-labeled rows → NO fake 1080p row, 360p still present', () => { assert.ok(!rows.some(r => r.h === 1080), JSON.stringify(rows.map(r => r.h))); assert.ok(rows.some(r => r.h === 360)); });

    /* ═══ [6] REAL handle() E2E — deep-episode quality menu ═══ */
    console.log('\n[6] handle() E2E — deep episode menus');
    const J1 = 'deep-a@s.whatsapp.net';
    mdx._testSession(J1, {
        list: [{ sid: 'SID_MAIN', name: 'Black Clover', type: 'series' }],
        detail: { 1: { sid: 'SID_MAIN', name: 'Black Clover', type: 'series', at: Date.now() } },
        tv: { 1: { at: Date.now(), seasons: [{ se: 1, maxEp: 170 }] } },
        mv: {}, at: Date.now(),
    });
    // row 124 = Season 1 Episode 124 (v2.62: pick N = E N — episodes first, pack row last)
    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 124'), rest: ['1', '124'], react: () => { } });
    await ok('E124 menu arrives (no more "streams නෑ")', () => assert.ok(/SELECT DOWNLOAD OPTION.*Episode 124/s.test(lastText()), lastText().slice(0, 80)));
    await ok('E124 menu shows 360p', () => assert.ok(/360p/.test(lastText())));
    await ok('E124 menu carries the ▸ Subtitles section (rid resolved from deep rows)', () => assert.ok(/Subtitles/.test(lastText()) && /en \(English\)/.test(lastText())));
    const e124txt = lastText();
    await ok('E124 numbering: qualities 1-3 then subs 4-5 (continues past qualities)', () => {
        assert.ok(/\*1\* \| 🎥 1080p/.test(e124txt) && /\*3\* \| 🎥 360p/.test(e124txt));
        assert.ok(/\*4\* \| 🗨 en \(English\)/.test(e124txt) && /\*5\* \| 🗨 si \(සිංහල\)/.test(e124txt));
    });

    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 123'), rest: ['1', '123'], react: () => { } });
    await ok('E123 menu now shows BOTH 720p AND 360p (was 720p only)', () => { assert.ok(/720p/.test(lastText()) && /360p/.test(lastText()), lastText().slice(0, 90)); });
    await ok('E123 menu shows the full 1080 ladder too', () => assert.ok(/1080p/.test(lastText())));

    console.log('\n[7] version pins');
    await ok('package.json 2.65.0', () => assert.strictEqual(require('../package.json').version, '2.69.0'));
    await ok('manifest.json 2.65.0 + notes mention deep episodes', () => { const m = JSON.parse(fs.readFileSync('manifest.json')); assert.strictEqual(m.version, '2.69.0'); assert.ok(/DEEP EPISODES|EPISODE NUMBERS|REAL SIZES|SUBTITLES/i.test(m.notes)); });
    await ok('moviedex.js pins: MB_RES_PAGES + totalCount walk present, old page<=6 gone', () => {
        const src = fs.readFileSync('moviedex.js', 'utf8');
        assert.ok(src.includes('MB_RES_PAGES = 15'));
        assert.ok(src.includes("j?.data?.pager?.totalCount"));
        assert.ok(!/page <= 6/.test(src), 'old fixed 6-page walk still present');
    });
    await ok('manifest files list includes test_v261.js', () => assert.ok(JSON.parse(fs.readFileSync('manifest.json')).files.includes('tests/test_v261.js')));

    globalThis.fetch = _origFetch;
    console.log(`\n═══ v2.61→62 deep episodes: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); globalThis.fetch = _origFetch; process.exit(1); });
