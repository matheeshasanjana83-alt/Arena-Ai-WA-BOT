'use strict';
/**
 * test_v227.js — MovieDex full-menu + fast-fail (v2.27.0)
 * v2.26 base + FULL series menu in one message + probe fast-fail + stale-session tombstone.
 * run: node test_v227.js   (offline — live probe guarded by RUN_LIVE=1)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');

(async () => {
    const md = require('./moviedex');

    // 1) version sync
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    if (man.version !== pkg.version || pkg.version < '2.27.0') throw new Error('version sync wrong: pkg=' + pkg.version + ' manifest=' + man.version);
    console.log('[1] v' + pkg.version + ' sync (manifest === package): OK ✅');

    // 2) module shape — all exports present
    for (const k of ['handle', 'bridgeReply', 'hasSession', 'mbSearch', 'mbDetails', 'mbSeasons', 'mbPlay', 'dashFrom', 'parseMpd', 'tvRows', 'listText', 'cardText', 'seriesText', 'seasonOptText', 'epFileName', 'epCaption', 'packStat', '_sessions']) {
        if (typeof md[k] === 'undefined') throw new Error('moviedex export missing: ' + k);
    }
    console.log('[2] moviedex exports (client + builders + bridge): OK ✅');

    // 3) bot.js wiring — require, dispatch, bridge, HEAVY, CATS, HELP — and still zero moviepro traces
    const bot = read('bot.js');
    if (!bot.includes("require('./moviedex')")) throw new Error('bot.js does not require ./moviedex');
    if (!bot.includes('moviedex.handle(c,') || !bot.includes('moviedex.bridgeReply(replyJid(msg.key), qid, text)')) throw new Error('bot.js dispatch/bridge not wired');
    if (!bot.includes("'.menu ' + text")) throw new Error('.menu number bridge lost (menu precedence)');
    if (!/\.moviedex|\.mdx/.test(bot.match(/const HEAVY = new Set\(\[([^\]]+)\]/)?.[1] || '')) throw new Error('.moviedex not in HEAVY');
    if (!bot.includes("'MovieDex'")) throw new Error('CATS has no MovieDex');
    if (!bot.includes('*.moviedex*')) throw new Error('HELP missing .moviedex');
    if (/moviepro|mvpro/i.test(bot)) throw new Error('bot.js mentions moviepro/mvpro');
    console.log('[3] bot.js wired (dispatch + bridge + HEAVY + CATS + HELP, moviepro-free): OK ✅');

    // 4) bridgeReply semantics (offline session fixture) + v2.27 stale-session tombstone
    const JID = '947xxxxxxxx@s.whatsapp.net';
    md._testSession(JID, { list: [{ sid: '1', name: 'A', type: 'movie' }, { sid: '2', name: 'B', type: 'series' }], at: Date.now(), ui: { key: 'K1', kind: 'list', n: null, at: Date.now() } });
    if (md.bridgeReply(JID, 'K1', '2') !== '.moviedex 2') throw new Error('bridge list pick wrong');
    md._sessions.get(JID).ui = { key: 'K2', kind: 'movie', n: 2, rowNo: null, at: Date.now() };
    if (md.bridgeReply(JID, 'K2', '1') !== '.moviedex 2 1') throw new Error('bridge movie pick wrong');
    md._sessions.get(JID).ui = { key: 'K3', kind: 'season', n: 2, rowNo: 3, at: Date.now() };
    if (md.bridgeReply(JID, 'K3', '2') !== '.moviedex 2 3 2') throw new Error('bridge season pick wrong');
    if (md.bridgeReply(JID, null, '5') !== '.moviedex 2 3 5') throw new Error('bridge bare fallback should map through the season card UI');
    if (md.bridgeReply('947000000000@s.whatsapp.net', null, '5') !== null) throw new Error('bridge foreign chat should be null');
    // tombstone: expired ≤30 min still routes (user gets the expire hint, never silence); >30 min → null
    md._testSession(JID, { list: [{ sid: '1', name: 'A', type: 'movie' }], at: Date.now() - 15 * 60e3 - 20 * 60e3 });
    if (md.bridgeReply(JID, null, '2') !== '.moviedex 2') throw new Error('tombstone: recent-expired reply should still route to the hint');
    md._testSession(JID, { list: [{ sid: '1', name: 'A', type: 'movie' }], at: Date.now() - 50 * 60e3 });
    if (md.bridgeReply(JID, null, '2') !== null) throw new Error('tombstone: long-expired reply should be null');
    console.log('[4] bridgeReply kinds + stale-session tombstone (no silence): OK ✅');

    // 5) dashFrom — real signCookie from the verified live stream
    const sc = 'Edge-Cache-Cookie=urlprefix=aHR0cHM6Ly9zYmNkbjMuaGFrdW5heW1hdGF0YS5jb20vZGFzaC8zMjg1MTc3NDg5OTQwNjk0MzA0XzBfMF8xMDgwX2gyNjVfMzIxLw:sign=1bd4ee0fa473e76e89b4bc7cf321dc98:t=1791836699';
    const d = md.dashFrom(sc);
    if (!d || d.mpd !== 'https://sbcdn3.hakunaymatata.com/dash/3285177489940694304_0_0_1080_h265_321/index.mpd') throw new Error('dashFrom urlprefix decode wrong: ' + (d && d.mpd));
    if (!/Edge-Cache-Cookie=urlprefix=/.test(d.cookie)) throw new Error('dashFrom cookie rebuild wrong');
    if (md.dashFrom('garbage') !== null || md.dashFrom('') !== null) throw new Error('dashFrom garbage should be null');
    // url-safe b64 + trailing *
    const d2 = md.dashFrom('Edge-Cache-Cookie=urlprefix=' + Buffer.from('https://sbcdn9.example.com/dash/123_0_0_720_h265_9/*').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + ':sign=x:t=1');
    if (!d2 || d2.mpd !== 'https://sbcdn9.example.com/dash/123_0_0_720_h265_9/index.mpd') throw new Error('dashFrom urlsafe variant wrong');
    console.log('[5] dashFrom (urlprefix b64 / urlsafe / garbage): OK ✅');

    // 6) parseMpd — synthetic manifest (video reps + audio, isoff-live template)
    const mpdTxt = `<?xml version="1.0"?><MPD mediaPresentationDuration="PT1H0M0S" profiles="urn:mpeg:dash:profile:isoff-live:2011"><Period id="0">
<AdaptationSet contentType="video" segmentAlignment="true"><SegmentTemplate timescale="10000" duration="50000" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" initialization="init-stream$RepresentationID$.m4s" startNumber="1"/>
<Representation id="0" mimeType="video/mp4" codecs="hev1" bandwidth="2200000" width="2580" height="1080"/><Representation id="1" mimeType="video/mp4" bandwidth="1000000" height="720"/><Representation id="2" mimeType="video/mp4" bandwidth="500000" height="480"/></AdaptationSet>
<AdaptationSet contentType="audio"><SegmentTemplate timescale="48000" duration="192000" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" initialization="init-stream$RepresentationID$.m4s"/><Representation id="3" mimeType="audio/mp4" codecs="mp4a.40.2" bandwidth="128000" audioSamplingRate="48000"/></AdaptationSet>
</Period></MPD>`;
    const man2 = md.parseMpd(mpdTxt);
    if (man2.durSec !== 3600) throw new Error('parseMpd duration wrong: ' + man2.durSec);
    if (man2.video.length !== 3 || man2.video[0].h !== 1080 || man2.video[2].h !== 480) throw new Error('parseMpd video reps wrong: ' + JSON.stringify(man2.video));
    if (!man2.audio || man2.audio.id !== '3' || man2.audio.bw !== 128000) throw new Error('parseMpd audio rep wrong');
    if (!/\$RepresentationID\$/.test(man2.video[0].seg.media) || !/\$Number%05d\$/.test(man2.video[0].seg.media)) throw new Error('parseMpd segment template not picked up');
    if (man2.video[0].seg.dur !== 50000 || man2.video[0].seg.timescale !== 10000 || man2.video[0].seg.start !== 1) throw new Error('parseMpd template attrs wrong');
    console.log('[6] parseMpd (reps sorted + audio + template attrs + duration): OK ✅');

    // 7) builders — tvRows interleaving, epFileName/caption/packStat, seasonOptText
    const rows = md.tvRows([{ se: 1, maxEp: 2 }, { se: 2, maxEp: 2 }]);
    if (rows.length !== 6 || rows[0].kind !== 'season' || rows[1].kind !== 'ep' || rows[1].ep !== 1 || rows[2].ep !== 2 || rows[3].season !== 2) throw new Error('tvRows interleave wrong: ' + JSON.stringify(rows));
    if (md.epFileName('Breaking Bad', 1, 1, 720, true) !== 'Breaking Bad S01E01 [720p].mkv') throw new Error('epFileName wrong');
    if (!/S1E1[\s\S]*720p/.test(md.epCaption('X', 1, 1, 720, 2, 7, 1))) throw new Error('epCaption wrong');
    if (!/✅ 3/.test(md.packStat('X', 2, 3, 1, 4, 7))) throw new Error('packStat wrong');
    const so = md.seasonOptText({ name: 'X' }, 5, 1, 1, [{ h: 720, label: '720p', sizeMB: 300 }]);
    if (!/SEASON 1/.test(so) || !/720p/.test(so)) throw new Error('seasonOptText wrong');
    console.log('[7] tvRows + epFileName/epCaption/packStat + seasonOptText: OK ✅');

    // 8) v2.27 FULL MENU — normal series (≤200 rows) shows ALL seasons + episodes in ONE message
    const blackClover = md.tvRows([{ se: 1, maxEp: 170 }, { se: 2, maxEp: 2 }]);   // real MovieBox shape (174 rows)
    const st = md.seriesText({ name: 'BB', year: '2008', rating: '9.5', desc: 'chem' }, 2, blackClover, 0);
    if (!/Download Season 1/.test(st) || !/Season 1 Episode 1/.test(st)) throw new Error('seriesText wrong');
    if (!/\*174\* \| Season 2 Episode 2/.test(st)) throw new Error('full menu: last row (174) missing — menu is still paginated');
    if (/next/.test(st)) throw new Error('full menu: 174-row series must NOT show a next-page hint');
    if (!/full menu/.test(st)) throw new Error('full menu: single-page hint missing');
    if (st.length > 9999) throw new Error('full menu caption exceeds the 9999 slice guard');
    // mega series (>200 rows) still paginates with the next hint
    const onePiece = md.tvRows([{ se: 1, maxEp: 1100 }]);
    const st2 = md.seriesText({ name: 'One Piece', year: '1999', desc: 'x' }, 3, onePiece, 0);
    if ((st2.match(/^\*\d+\* \|/gm) || []).length !== 200) throw new Error('mega series page rows != 200');
    if (!/next/.test(st2) || !/6 pages/.test(st2)) throw new Error('mega series: next-page hint wrong');
    console.log('[8] FULL series menu (174 rows one message) + mega-series pagination: OK ✅');

    // 8b) listText / cardText basics
    const lt = md.listText('fast', [{ name: 'Fast X', type: 'movie', year: '2023', rating: '7.1' }, { name: 'BB', type: 'series', year: '2008' }]);
    if (!/MovieDex/.test(lt) || !/📺/.test(lt)) throw new Error('listText wrong');
    const ct = md.cardText({ name: 'Fast X', year: '2023', rating: '7.1', desc: 'Dom.', genres: ['Action'], poster: 'x' }, 1, [{ h: 720, label: '720p', sizeMB: 900 }]);
    if (!/Download Options/.test(ct) || !/720p/.test(ct)) throw new Error('cardText wrong');
    console.log('[8b] listText + cardText: OK ✅');

    // 9) v2.27 fast-fail probes + manifest — files include moviedex.js + test, removed[] still clean
    const mx = read('moviedex.js');
    if (!mx.includes('await mbPlay(full.sid, row.season, row.ep, 2)')) throw new Error('episode quality probe not fast-fail (tries=2)');
    if (!mx.includes('await mbPlay(full.sid, row.season, 1, 2)')) throw new Error('season quality probe not fast-fail (tries=2)');
    if (!mx.includes('await mbPlay(full.sid, null, null, 3)')) throw new Error('movie card probe not bounded (tries=3)');
    if (!mx.includes('mbLogin(tries <= 3 ? 2 : 6)')) throw new Error('probe-mode re-login not shortened');
    if (!mx.includes('EP_PAGE_ROWS = 200')) throw new Error('EP_PAGE_ROWS not 200 (full menu)');
    if (!mx.includes('caption: text.slice(0, 9999)')) throw new Error('series caption slice not raised to 9999');
    if (!man.files.includes('moviedex.js') || !man.files.includes('test_v227.js')) throw new Error('manifest missing moviedex files');
    if (man.files.includes('test_v226.js') || !(man.removed || []).includes('test_v226.js')) throw new Error('test_v226.js must be in removed[] (auto-delete on .update)');
    for (const f of man.removed || []) if (man.files.includes(f)) throw new Error(f + ' in both files and removed');
    if (man.files.includes('movies.js')) throw new Error('movies.js back in manifest?!');
    console.log('[9] fast-fail probes + manifest files/removed consistency: OK ✅');

    // 10) report-flood still absent (standing policy)
    const allSrc = ['bot.js', 'features.js', 'tools.js', 'mirror.js', 'style.js', 'updater.js', 'moviedex.js'].map(read).join('\n');
    if (/report30|report50|report100|report-flood|\.report \d/.test(allSrc)) throw new Error('report-flood strings appeared');
    console.log('[10] no report-flood strings (policy held): OK ✅');

    // 11) module graph + syntax on all shipped .js
    require('./bot.js');
    for (const f of man.files.filter((x) => x.endsWith('.js'))) execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
    console.log('[11] bot.js module graph loads + node --check all manifest .js: OK ✅');

    // 12) guarded LIVE probe (RUN_LIVE=1 node test_v227.js)
    if (process.env.RUN_LIVE === '1') {
        console.log('[12] LIVE probe…');
        const list = await md.mbSearch('Fast X', 5);
        if (!list.length) throw new Error('LIVE: search empty');
        console.log('     search:', list.slice(0, 3).map(x => x.name).join(' | '));
        const movie = list.find(x => x.type === 'movie');
        const streams = await md.mbPlay(movie.sid);
        if (!streams.length || !streams[0].signCookie) throw new Error('LIVE: no movie streams');
        const dash = md.dashFrom(streams[0].signCookie);
        if (!dash) throw new Error('LIVE: signCookie decode fail');
        console.log('     mpd:', dash.mpd);
        const q = await md.streamQualities(streams[0]);
        if (!q || !q.rows.length) throw new Error('LIVE: qualities fail');
        console.log('     qualities:', q.rows.map(r => `${r.label}~${r.sizeMB}MB`).join(' '));
        console.log('[12] LIVE MovieBox search+play+qualities: OK ✅');
    } else {
        console.log('[12] LIVE probe skipped (RUN_LIVE=1 to enable) — OK ✅');
    }

    console.log('\n🎉 ALL v2.27.0 TESTS PASSED');
})().catch((e) => { console.error('💩 ' + (e.stack || e.message)); failed = true; })
    .finally(() => process.exit(failed ? 1 : 0));
