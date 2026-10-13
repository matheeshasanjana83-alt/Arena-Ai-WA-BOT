'use strict';
/* test_v239 — MovieDex EPISODE PACKS (v2.39.0) + range-command REMOVAL
 *  Behavioral: handle('.moviedex', …) with SEEDED sessions + HOOKS (fake mbPlay/mergedQualities/
 *  downloadDash) → no network:
 *   ① tvRows: pack rows 1.1=EP1-12 / 1.2=EP13-24 … (24+ ep seasons only), integer numbering
 *      NEVER shifts (EP1=2, EP13=14 …), multi-season, short-season = no packs
 *   ② seriesText renders pack rows (1.1 | 🧳 S01 EP1-EP12 ✅) + unchanged episode numbers
 *   ③ pack flow E2E: reply 1.1 → quality menu → files 1..12 (12 docs, chosen quality, pack
 *      header, next-pack hint '1.2') · pack 1.2 → eps 13..24 (NO restart from 1)
 *   ④ probe path (no cached qualities) → HOOKS probe → pack menu cached under '1.1'
 *   ⑤ last pack (1.15 = 169-170) → 2 files, NO continuation hint
 *   ⑥ season row regression: 50-cap pack + next ×4 (1..170 full sweep, from advances) + ඉවර් guard
 *   ⑦ bridgeReply: pack token "1.1" rides through raw; season-card q# routing with pack rowNo
 *   ⑧ range command REMOVED: no rangeOf, no range token in pick regex (direct regex test),
 *      no '70-80' menu/usage/hints anywhere, search-level strip + pack hint present
 *   ⑨ parseMpd/chunkCount/expandTpl + antibug selfTest
 */
const path = require('path');
const fs = require('fs');

const RESULTS = [];
const ok = (name, cond, extra) => { RESULTS.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    ok('version 2.39.0 (package+manifest)', pkg.version === '2.39.0' && man.version === '2.39.0');
    ok('manifest files/removed (v239 in, v238 out)', man.files.includes('test_v239.js') && man.removed.includes('test_v238.js'));

    const src = fs.readFileSync(path.join(__dirname, 'moviedex.js'), 'utf8');
    const botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    ok('REMOVED: no rangeOf helper', !src.includes('rangeOf'));
    ok('REMOVED: pick regex line has NO range token', (() => { const line = src.split('\n').find(l => l.includes('const pick = arg.match(')) || ''; return !/-\\d/.test(line) && line.includes('(?:\\.\\d{1,3})?)'); })());
    ok('REMOVED: no range hint in usage/quality texts', !src.includes('70-80* —') && !src.includes('70-80* (') && !botSrc.includes('<q#> 70-80'));
    ok('REMOVED: seasonOptText has no range hint', !src.includes('*Episode range?*'));
    ok('packs: EP_PACK_SIZE/EP_PACK_MIN constants', src.includes('const EP_PACK_SIZE = 12;') && src.includes('const EP_PACK_MIN = 24;'));
    ok('packs: tvRows pack row builder', src.includes("kind: 'pack', label: se.se + '.'"));
    ok('packs: handle pack branch (quality menu + seasonFilesCmd bounded)', src.includes("if (row.kind === 'pack')") && /row\.from - 1, react, row\.to,/.test(src));
    ok('packs: search-level range strip + pack hint', src.includes('rm = q.match(') && src.includes('rangeHint'));
    ok('packs: nextHint param + unified end', /toEp = 0, nextHint = null\)/.test(src) && /nextHint \? '\\n> ඉතුරු ටිකට — '/.test(src));
    ok('packs: bot.js menu pack line', botSrc.includes('*1.1 / 1.2* reply — 🧳 12-ep pack files'));

    // pick regex behavioral (extracted from source — "70-80" must NOT match the row grammar)
    const rx = src.match(/const pick = arg\.match\((\/.+\/i)\);/);
    ok('pick regex extractable', !!rx);
    if (rx) {
        const pick = eval(rx[1]);
        ok('pick: "1 1 2 70-80" does NOT match (range gone)', pick.test('1 1 2 70-80') === false);
        ok('pick: "1 1.1 2" matches (pack grammar)', !!(pick.test('1 1.1 2')));
        ok('pick: "1 14 2 link" still matches', !!(pick.test('1 14 2 link')));
        ok('pick: "1 1 1 next" still matches (pack-next)', !!(pick.test('1 1 1 next')));
    }

    const mdx = require('./moviedex.js');
    require('./bot.js');
    ok('exports intact', typeof mdx.tvRows === 'function' && typeof mdx.seasonOptText === 'function' && typeof mdx.__hooks === 'function');

    // ── ① tvRows shape ──
    const r170 = mdx.tvRows([{ se: 1, maxEp: 170 }]);
    const packs = r170.filter(r => r.kind === 'pack');
    ok('tvRows 170: 15 packs (1.1..1.15)', packs.length === 15 && packs[0].label === '1.1' && packs[14].label === '1.15', packs.map(p => p.label).join(','));
    ok('tvRows 170: pack ranges 1-12 / 13-24 / 169-170', packs[0].from === 1 && packs[0].to === 12 && packs[1].from === 13 && packs[1].to === 24 && packs[14].from === 169 && packs[14].to === 170);
    ok('tvRows 170: numbering NEVER shifts (season=1, EP1=2, EP12=13, EP13=14, EP170=171)',
        r170[0].no === 1 && r170.find(r => r.kind === 'ep' && r.ep === 1).no === 2 &&
        r170.find(r => r.kind === 'ep' && r.ep === 12).no === 13 && r170.find(r => r.kind === 'ep' && r.ep === 13).no === 14 &&
        r170.find(r => r.kind === 'ep' && r.ep === 170).no === 171);
    ok('tvRows 170: total rows = 1 season + 170 eps + 15 packs', r170.length === 186, String(r170.length));
    ok('tvRows 23: NO packs (short season)', mdx.tvRows([{ se: 1, maxEp: 23 }]).every(r => r.kind !== 'pack'));
    ok('tvRows 24: 2 packs (1.1, 1.2)', mdx.tvRows([{ se: 1, maxEp: 24 }]).filter(r => r.kind === 'pack').length === 2);
    const rMulti = mdx.tvRows([{ se: 1, maxEp: 26 }, { se: 2, maxEp: 5 }]);
    const mp = rMulti.filter(r => r.kind === 'pack');
    ok('tvRows multi-season: S1 packs only + S2 row no=28, S2 EP1 no=29',
        mp.map(p => p.label).join(',') === '1.1,1.2,1.3' && mp[2].from === 25 && mp[2].to === 26 &&
        rMulti.find(r => r.kind === 'season' && r.season === 2).no === 28 && rMulti.find(r => r.kind === 'ep' && r.season === 2 && r.ep === 1).no === 29);

    // ── ② seriesText rendering ──
    const cardM = { name: 'Black Clover', year: 2017, rating: '8.6', desc: 'Asta and Yuno.' };
    const t170 = mdx.seriesText(cardM, 1, r170, 0);
    ok('seriesText: pack row format (1.1 | 🧳 S01 EP1-EP12 ✅)', t170.includes('*1.1* | 🧳 S01 EP1-EP12 ✅') && t170.includes('*1.2* | 🧳 S01 EP13-EP24 ✅'));
    ok('seriesText: season row + episode numbers unchanged', t170.includes('*1* | 📦 Download Season 1 (All Episodes)') && t170.includes('*2* | Season 1 Episode 1') && t170.includes('*14* | Season 1 Episode 13'));

    // ── harness ──
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
    let dl = [], plays = [];
    mdx.__hooks({
        mbPlay: async (sid, se, ep) => { plays.push([sid, se, ep]); return [{ signCookie: 'x', size: 100, resolutions: '720,480' }]; },
        mergedQualities: async () => qRows.map(r => ({ ...r })),
        downloadDash: async (row, { finalName }) => { dl.push({ h: row.h, finalName }); return { path: '/tmp/fake-' + dl.length + '.mkv', bytes: 5 * 1048576 }; },
        gap: 1,
    });
    const JID = 'pack39@s';
    const seed = (jid, maxEp, qualityKeys) => {
        const s = {
            list: [{ sid: 'BC1', name: 'Black Clover', type: 'series', rating: '8.6' }],
            at: Date.now(),
            detail: { 1: { name: 'Black Clover', sid: 'BC1', rating: '8.6', at: Date.now() } },
            tv: { 1: { at: Date.now(), seasons: [{ se: 1, maxEp }], pageIdx: 0 } },
            mv: {},
        };
        for (const k of qualityKeys || []) s.tv[1].qualities = { ...(s.tv[1].qualities || {}), [k]: qRows.map(r => ({ ...r })) };
        mdx._testSession(jid, s);
    };
    const run = async (rest, jid = JID) => {
        const { send, sent } = mkSend();
        await mdx.handle('.moviedex', { send, jid, msg: { key: { id: 'M' + dl.length } }, rest, react: async () => { } });
        return sent;
    };
    const texts = (sent) => sent.filter(s => s.content.text).map(s => s.content.text).join('\n');
    const docs = (sent) => sent.filter(s => s.content.document);

    // ── ③ pack flow E2E ──
    seed(JID, 170, ['1.1']); dl = []; plays = [];
    let sent = await run(['1', '1.1', '2']);
    ok('pack 1.1 q2: 12 downloads', dl.length === 12, String(dl.length));
    ok('pack 1.1 q2: eps 1..12 in order', JSON.stringify(plays.map(p => p[2])) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), plays.map(p => p[2]).join(','));
    ok('pack 1.1 q2: quality #2 (480p)', dl.every(d => d.h === 480));
    ok('pack 1.1 q2: clean filenames S01E01..S01E12', /^Black Clover S01E01 \[480p\]\.mkv$/.test(dl[0].finalName) && /^Black Clover S01E12 \[480p\]\.mkv$/.test(dl[11].finalName), dl[0].finalName);
    ok('pack 1.1: header EP1-EP12 Pack + 1–12/170', texts(sent).includes('EP1-EP12 Pack') && texts(sent).includes('Episodes: 1–12 / 170'));
    ok('pack 1.1: next-pack hint → 1.2', texts(sent).includes('1.2') && texts(sent).includes('ඉතුරු ටිකට'));
    ok('pack 1.1: 12 documents sent', docs(sent).length === 12, String(docs(sent).length));

    // pack 1.2 → eps 13..24 — NO restart from 1 (the classic bug class)
    seed(JID, 170, ['1.2']); dl = []; plays = [];
    sent = await run(['1', '1.2', '1']);
    ok('pack 1.2: eps 13..24 (NO restart from 1)', dl.length === 12 && plays[0][2] === 13 && plays[11][2] === 24, plays.map(p => p[2]).join(','));

    // pack 1.9 → eps 97..108 (mid-pack sanity)
    seed(JID, 170, ['1.9']); dl = []; plays = [];
    sent = await run(['1', '1.9', '3']);
    ok('pack 1.9: eps 97..108 @360p', dl.length === 12 && plays[0][2] === 97 && plays[11][2] === 108 && dl.every(d => d.h === 360));

    // ── ④ probe path (no cached qualities) ──
    seed(JID, 170, []); dl = []; plays = [];
    sent = await run(['1', '1.1']);
    ok('pack probe: HOOKS mbPlay probed S1E1', plays.some(p => p[0] === 'BC1' && p[1] === 1 && p[2] === 1), JSON.stringify(plays[0]));
    ok('pack probe: menu header S01 EP1-EP12 + Pack Episodes', texts(sent).includes('SELECT DOWNLOAD OPTION — S01 EP1-EP12') && texts(sent).includes('Video Qualities (Pack Episodes)'));
    ok('pack probe: usage hint with pack token', texts(sent).includes('.moviedex 1 1.1 <q#>'));
    ok('pack probe: qualities cached under "1.1"', (mdx._sessions.get(JID).tv[1].qualities?.['1.1'] || []).length === 3);
    dl = []; plays = [];
    sent = await run(['1', '1.1', '3']);
    ok('pack after probe: q3 → 12 files @360p', dl.length === 12 && dl.every(d => d.h === 360));

    // ── ⑤ last pack: no continuation hint ──
    seed(JID, 170, ['1.15']); dl = []; plays = [];
    sent = await run(['1', '1.15', '1']);
    ok('pack 1.15: eps 169..170', dl.length === 2 && plays[0][2] === 169 && plays[1][2] === 170);
    ok('pack 1.15: NO continuation hint (series end)', !texts(sent).includes('ඉතුරු ටිකට'));

    // ── ⑥ season row regression (50-cap + next sweep) ──
    seed(JID, 170, ['1']); dl = []; plays = [];
    sent = await run(['1', '1', '1']);
    ok('season row: run1 = eps 1..50 (50 files)', dl.length === 50 && plays[0][2] === 1 && plays[49][2] === 50);
    ok('season row: tv.pack.from advanced (v2.38 FIX kept)', mdx._sessions.get(JID).tv[1].pack?.from === 50);
    ok('season row: continuation hint shows CORRECT grammar (.moviedex 1 1 next)', texts(sent).includes('.moviedex 1 1 next') && !texts(sent).includes('.moviedex 1 next'));
    sent = await run(['1', '1', '1', 'next']);
    ok('season row: next = eps 51..100 (NO restart)', dl.length === 100 && plays[50][2] === 51 && plays[99][2] === 100);
    sent = await run(['1', '1', '1', 'next']);
    ok('season row: next = eps 101..150', dl.length === 150 && plays[100][2] === 101);
    sent = await run(['1', '1', '1', 'next']);
    ok('season row: next = eps 151..170 (20 files)', dl.length === 170 && plays[150][2] === 151 && plays[169][2] === 170);
    sent = await run(['1', '1', '1', 'next']);
    ok('season row: next past end → ඉවර් guard, no re-download', dl.length === 170 && texts(sent).includes('ඉවර්'));

    // ── ⑦ bridgeReply routing ──
    const bj = 'bridge39@s';
    seed(bj, 170, []);
    mdx._sessions.get(bj).cards = [{ key: 'CARD_TV', kind: 'tv', n: 1, rowNo: null, at: Date.now() },
        { key: 'CARD_Q', kind: 'season', n: 1, rowNo: '1.2', at: Date.now() }];
    ok('bridgeReply: tv card + "1.1" → pack grammar', mdx.bridgeReply(bj, 'CARD_TV', '1.1') === '.moviedex 1 1.1');
    ok('bridgeReply: tv card + "14" → episode row grammar', mdx.bridgeReply(bj, 'CARD_TV', '14') === '.moviedex 1 14');
    ok('bridgeReply: pack quality card + "2" → .moviedex 1 1.2 2', mdx.bridgeReply(bj, 'CARD_Q', '2') === '.moviedex 1 1.2 2');

    // ── errors ──
    seed(JID, 170, []); dl = [];
    sent = await run(['1', '9.9', '1']);
    ok('unknown pack token → honest error, 0 downloads', texts(sent).includes('9.9 — row එකක් නෑ') && dl.length === 0);
    seed(JID, 170, ['1.1']); dl = [];
    sent = await run(['1', '1.1', '9']);
    ok('bad quality → error', texts(sent).includes('quality නෑ') && dl.length === 0);
    seed(JID, 170, ['1.1']); dl = [];
    sent = await run(['1', '1.1', '1', 'link']);
    ok('pack+link → files-only note', texts(sent).includes('link mode නෑ') && dl.length === 0);

    // ── ⑨ parser regressions ──
    const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD mediaPresentationDuration="PT20S" xmlns="urn:mpeg:dash:schema:mpd:2011">
 <Period><AdaptationSet contentType="video">
  <SegmentTemplate media="chunk-stream$RepresentationID$-$Number$.m4s" initialization="init-stream$RepresentationID$.m4s" duration="4" timescale="1" startNumber="1"/>
  <Representation id="v0" bandwidth="1000000" width="1280" height="720"/><Representation id="v1" bandwidth="600000" width="640" height="360"/>
 </AdaptationSet><AdaptationSet contentType="audio">
  <SegmentTemplate media="chunk-stream$RepresentationID$-$Number$.m4s" initialization="init-stream$RepresentationID$.m4s" duration="4" timescale="1" startNumber="1"/>
  <Representation id="a0" bandwidth="128000"/>
 </AdaptationSet></Period></MPD>`;
    const man2 = mdx.parseMpd(MPD);
    ok('parseMpd regression', man2.video.length === 2 && man2.video[0].h === 720 && man2.durSec === 20);
    ok('chunkCount regression', mdx.chunkCount(man2.video[0].seg, 20) === 5);
    ok('expandTpl regression', mdx.expandTpl('c-$Number%05d$.m4s', 'x', 7) === 'c-00007.m4s');

    try {
        const ab = require('./antibug.js');
        const r = ab.selfTest ? ab.selfTest() : null;
        if (r) {
            const good = (r.match(/✅/g) || []).length, bad = (r.match(/❌/g) || []).length;
            ok('antibug selfTest', bad === 0 && good >= 40, `${good}✅/${bad}❌`);
        } else ok('antibug selfTest (n/a)', true);
    } catch (e) { ok('antibug selfTest', false, e.message); }

    const P = RESULTS.filter(Boolean).length, F = RESULTS.length - P;
    console.log(`\n═══ test_v239: ${P}✅ / ${F}❌ ═══`);
    process.exit(F ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
