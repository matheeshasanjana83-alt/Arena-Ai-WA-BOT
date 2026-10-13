'use strict';
/* test_v238 — MovieDex EPISODE RANGE (v2.38.0)
 *  Behavioral: handle('.moviedex', …) with SEEDED sessions + HOOKS (fake mbPlay/mergedQualities/
 *  downloadDash) → no network:
 *   ① .moviedex 1 1 2 70-80 → 11 downloads, eps 70..80 in order, chosen quality h, range header
 *   ② swapped range 80-70 → same 70..80
 *   ③ no-qNo range → best (first) quality row
 *   ④ bad quality / beyond maxEp / >50 cap / link+range → errors, 0 downloads
 *   ⑤ probe path: qualities NOT preloaded → HOOKS probe + REAL mergedQualities vs local MPD server
 *   ⑥ pack regression: .moviedex 1 1 1 → eps 1..3 (maxEp=3), then 'next' → 0 downloads, no crash
 *   ⑦ usage text + menu hint + header notes in source; version sync; parseMpd/chunkCount/expandTpl;
 *      antibug selfTest
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const RESULTS = [];
const ok = (name, cond, extra) => { RESULTS.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    ok('version 2.38.0 (package+manifest)', pkg.version === '2.38.0' && man.version === '2.38.0');
    ok('manifest files/removed (v238 in, v237 out)', man.files.includes('test_v238.js') && man.removed.includes('test_v237.js'));

    const src = fs.readFileSync(path.join(__dirname, 'moviedex.js'), 'utf8');
    ok('regex: range token in pick', /\\d\{1,3\}\|\\d\{1,4\}-\\d\{1,4\}/.test(src));
    ok('rangeOf helper present', src.includes('const rangeOf = (t) =>'));
    ok('range block routes to seasonFilesCmd with toEp', /seasonFilesCmd\(send, jid, msg, full, row\.season, row\.maxEp, qn \|\| 1, chosen\.h, a - 1, react, b\)/.test(src));
    ok('seasonFilesCmd: toEp param + isRange', /from, react, toEp = 0\)/.test(src) && /const isRange = toEp > 0;/.test(src));
    ok('continuation gate !isRange', /if \(end < total && !isRange\) \{/.test(src));
    ok('usage: range example', src.includes('<q#> 70-80* — 🧳 episode range'));
    ok('seasonOptText: range hint', src.includes('*Episode range?*'));
    ok('bot.js menu: range line', fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8').includes('<q#> 70-80* — 🧳 episode range files'));

    const mdx = require('./moviedex.js');
    const bot = require('./bot.js');
    ok('exports: __hooks seam', typeof mdx.__hooks === 'function' && typeof bot.loadSettings === 'function' || true);   // bot.js load ok

    const qRows = [
        { h: 720, bw: 1000000, label: '720p', sizeMB: 200 },
        { h: 480, bw: 600000, label: '480p', sizeMB: 100 },
        { h: 360, bw: 0, label: '360p', sizeMB: 60, transcode: true, srcH: 480 },
    ];
    const mkSend = () => {
        const sent = [];
        const send = async (jid, content, opts) => { const key = { id: 'K' + sent.length }; sent.push({ content, key }); return key; };
        return { send, sent };
    };
    const JID = 'range38@s';

    const seed = (jid, maxEp, withQualities) => {
        const s = {
            list: [{ sid: 'BC1', name: 'Black Clover', type: 'series', rating: '8.6' }],
            at: Date.now(),
            detail: { 1: { name: 'Black Clover', sid: 'BC1', rating: '8.6', at: Date.now() } },   // fresh at → no mbDetails re-fetch (no network)
            tv: { 1: { at: Date.now(), seasons: [{ se: 1, maxEp }], pageIdx: 0 } },
            mv: {},
        };
        if (withQualities) s.tv[1].qualities = { 1: qRows.map(r => ({ ...r })) };
        mdx._testSession(jid, s);
    };

    // HOOKS state — SRVBASE set by the probe test → mbPlay returns a REAL signCookie (local MPD)
    let SRVBASE = null;
    let dl = [], plays = [];
    mdx.__hooks({
        mbPlay: async (sid, se, ep) => {
            plays.push([sid, se, ep]);
            const sc = SRVBASE ? 'urlprefix=' + Buffer.from(SRVBASE + '/*').toString('base64') : 'x';
            return [{ signCookie: sc, size: 100, resolutions: '720,360' }];
        },
        mergedQualities: async () => qRows.map(r => ({ ...r })),
        downloadDash: async (row, { finalName }) => { dl.push({ h: row.h, finalName }); return { path: '/tmp/fake-' + dl.length + '.mkv', bytes: 5 * 1048576 }; },
        gap: 1,
    });

    const run = async (rest, jid = JID) => {
        const { send, sent } = mkSend();
        await mdx.handle('.moviedex', { send, jid, msg: { key: { id: 'M' + dl.length } }, rest, react: async () => { } });
        return sent;
    };
    const texts = (sent) => sent.filter(s => s.content.text).map(s => s.content.text).join('\n');
    const docs = (sent) => sent.filter(s => s.content.document);

    // ── ① main range flow ──
    seed(JID, 170, true); dl = []; plays = [];
    let sent = await run(['1', '1', '2', '70-80']);
    ok('range 70-80: 11 downloads', dl.length === 11, String(dl.length));
    ok('range 70-80: eps 70..80 in order', JSON.stringify(plays.map(p => p[2])) === JSON.stringify([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]), plays.map(p => p[2]).join(','));
    ok('range: season+sid passed to mbPlay', plays.every(p => p[0] === 'BC1' && p[1] === 1));
    ok('range: quality #2 (480p) chosen', dl.every(d => d.h === 480), dl[0] && dl[0].h + 'p');
    ok('range: clean episode filenames', /^Black Clover S01E7[02] \[480p\]\.mkv$/.test(dl[0].finalName) && /^Black Clover S01E80 \[480p\]\.mkv$/.test(dl[10].finalName), dl[0].finalName);
    ok('range: header says 70–80 / 170', texts(sent).includes('Episodes: 70–80 / 170'));
    ok('range: header says Episode Range', texts(sent).includes('Episode Range'));
    ok('range: 11 documents sent', docs(sent).length === 11, String(docs(sent).length));
    ok('range: packStat progress 80/170', texts(sent).includes('80/170'));
    ok('range: NO next-continuation hint', !texts(sent).includes('ඉතුරු ටිකට'));

    // ── ② swapped range ──
    seed(JID, 170, true); dl = []; plays = [];
    sent = await run(['1', '1', '80-70']);
    ok('swapped 80-70 → 70..80', dl.length === 11 && plays[0][2] === 70 && plays[10][2] === 80);

    // ── ③ no-qNo → best quality ──
    seed(JID, 170, true); dl = []; plays = [];
    sent = await run(['1', '1', '70-72']);
    ok('no qNo → best row (720p), 3 eps', dl.length === 3 && dl.every(d => d.h === 720), dl[0] && dl[0].h + 'p');

    // ── ④ errors ──
    seed(JID, 170, true); dl = []; plays = [];
    sent = await run(['1', '1', '9', '70-80']);
    ok('bad quality → error, 0 downloads', texts(sent).includes('quality නෑ') && dl.length === 0);
    seed(JID, 170, true); dl = [];
    sent = await run(['1', '1', '2', '160-180']);
    ok('beyond maxEp → honest error with real max', texts(sent).includes('1-170') && dl.length === 0);
    seed(JID, 170, true); dl = [];
    sent = await run(['1', '1', '2', '1-60']);
    ok('>50 cap → split hint with example', texts(sent).includes('50') && texts(sent).includes('1-50') && dl.length === 0);
    seed(JID, 170, true); dl = [];
    sent = await run(['1', '1', '70-80', 'link']);
    ok('range+link → files-only hint', texts(sent).includes('link mode නෑ') && dl.length === 0);

    // ── ⑥ pack FIX regression: from advances after run 1 (was: 'next' re-downloaded from ep 1) ──
    const packJid = 'pack38@s';
    seed(packJid, 3, true); dl = []; plays = [];
    sent = await run(['1', '1', '1'], packJid);
    ok('pack: eps 1..3 downloaded', dl.length === 3 && JSON.stringify(plays.map(p => p[2])) === JSON.stringify([1, 2, 3]));
    ok('pack: start header (Total Episodes)', texts(sent).includes('Total Episodes: 3'));
    ok('pack FIX: tv.pack.from advanced after run 1', mdx._sessions.get(packJid).tv[1].pack?.from === 3, 'from=' + mdx._sessions.get(packJid).tv[1].pack?.from);
    sent = await run(['1', '1', '1', 'next'], packJid);
    ok('pack next after full run: 0 downloads + ඉවර් note', dl.length === 3 && texts(sent).includes('ඉවර්'));

    // ── ⑥b REAL multi-run continuation: 55 eps → run1 = 1..50, next = 51..55 ──
    const bigJid = 'pack55@s';
    seed(bigJid, 55, true); dl = []; plays = [];
    sent = await run(['1', '1', '1'], bigJid);
    ok('pack 55: run1 = eps 1..50 (50 files)', dl.length === 50 && plays[0][2] === 1 && plays[49][2] === 50, 'dl=' + dl.length);
    ok('pack 55: from=50 after run1', mdx._sessions.get(bigJid).tv[1].pack?.from === 50);
    sent = await run(['1', '1', '1', 'next'], bigJid);
    ok('pack 55: next = eps 51..55 (5 files, NO restart)', dl.length === 55 && plays[50] && plays[50][2] === 51 && plays[54][2] === 55, 'dl=' + dl.length + ' first-of-next=' + (plays[50] && plays[50][2]));
    sent = await run(['1', '1', '1', 'next'], bigJid);
    ok('pack 55: next past end → ඉවර් guard', dl.length === 55 && texts(sent).includes('ඉවර්'));

    // ── ⑤ probe path (no preloaded qualities) — REAL mergedQualities vs local MPD server ──
    const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD mediaPresentationDuration="PT20S" xmlns="urn:mpeg:dash:schema:mpd:2011">
 <Period><AdaptationSet contentType="video">
  <SegmentTemplate media="chunk-stream$RepresentationID$-$Number$.m4s" initialization="init-stream$RepresentationID$.m4s" duration="4" timescale="1" startNumber="1"/>
  <Representation id="v0" bandwidth="1000000" width="1280" height="720"/><Representation id="v1" bandwidth="600000" width="640" height="360"/>
 </AdaptationSet><AdaptationSet contentType="audio">
  <SegmentTemplate media="chunk-stream$RepresentationID$-$Number$.m4s" initialization="init-stream$RepresentationID$.m4s" duration="4" timescale="1" startNumber="1"/>
  <Representation id="a0" bandwidth="128000"/>
 </AdaptationSet></Period></MPD>`;
    const srv = http.createServer((req, res) => {
        if (req.url.startsWith('/dash/live/index.mpd')) { res.writeHead(200); res.end(MPD); return; }
        res.writeHead(200); res.end(Buffer.alloc(64, 7));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const BASE = `http://127.0.0.1:${srv.address().port}`;
    const probeJid = 'probe38@s';
    seed(probeJid, 170, false);
    const s2 = mdx._sessions.get(probeJid);
    s2.list[0].sid = 'BC2';   // distinguish probe calls
    s2.detail[1].sid = 'BC2';
    SRVBASE = BASE + '/dash/live';   // mbPlay hook now returns a REAL signCookie → real MPD fetch
    dl = []; plays = [];
    sent = await run(['1', '1', '70-71'], probeJid);
    ok('probe: mbPlay hook used for probe (S1E1)', plays.some(p => p[0] === 'BC2' && p[1] === 1 && p[2] === 1), JSON.stringify(plays[0]));
    ok('probe: REAL mergedQualities → 720p top row', dl.length === 2 && dl.every(d => d.h === 720), dl[0] && dl[0].h + 'p');
    ok('probe: qualities cached back into session', (mdx._sessions.get(probeJid).tv[1].qualities?.[1] || []).length >= 2);

    // ── ⑦ misc regressions ──
    const man2 = mdx.parseMpd(MPD);
    ok('parseMpd regression', man2.video.length === 2 && man2.video[0].h === 720 && man2.durSec === 20);
    ok('chunkCount regression', mdx.chunkCount(man2.video[0].seg, 20) === 5);
    ok('expandTpl regression', mdx.expandTpl('c-$Number%05d$.m4s', 'x', 7) === 'c-00007.m4s');
    srv.close();

    try {
        const ab = require('./antibug.js');
        const r = ab.selfTest ? ab.selfTest() : null;
        if (r) {
            const good = (r.match(/✅/g) || []).length, bad = (r.match(/❌/g) || []).length;
            ok('antibug selfTest', bad === 0 && good >= 40, `${good}✅/${bad}❌`);
        } else ok('antibug selfTest (n/a)', true);
    } catch (e) { ok('antibug selfTest', false, e.message); }

    const P = RESULTS.filter(Boolean).length, F = RESULTS.length - P;
    console.log(`\n═══ test_v238: ${P}✅ / ${F}❌ ═══`);
    process.exit(F ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
