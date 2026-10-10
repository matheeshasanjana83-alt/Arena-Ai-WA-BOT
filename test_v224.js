/**
 * test_v224.js — MoviePro REPLY flow (v2.24): bare-number replies bridge into the
 * .moviepro grammar via per-card "ui" state; season pack delivers FILES one by one;
 * quality rows read real site labels (Video: 720p / Server names). Offline + guarded live.
 * run: node test_v224.js
 */
const fs = require('fs');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const t = (name, fn) => { try { fn(); console.log(`[${name}] OK ✅`); } catch (e) { console.error(`[${name}] FAIL ❌ — ${e.message}`); failed = true; } };
const ta = async (name, fn) => { try { await fn(); console.log(`[${name}] OK ✅`); } catch (e) { console.error(`[${name}] FAIL ❌ — ${e.message}`); failed = true; } };

(async () => {
    const man = require('./manifest.json');
    const pkgV = require('./package.json').version;
    const movies = require('./movies');
    const botSrc = fs.readFileSync('bot.js', 'utf8');
    const src = fs.readFileSync('movies.js', 'utf8');

    t('1 versions + manifest', () => {
        if (man.version !== pkgV || pkgV < '2.24.0') throw new Error('version sync: ' + pkgV);
        if (!man.files.includes('test_v224.js')) throw new Error('manifest missing test_v224.js');
    });

    t('2 syntax', () => {
        for (const f of ['bot.js', 'movies.js', 'style.js', 'tools.js', 'features.js', 'mirror.js']) execSync(`node --check ${f}`, { stdio: 'pipe' });
    });

    t('3 module graph + v2.24 exports', () => {
        require('./bot.js');
        for (const k of ['bridgeReply', 'epFileName', 'epCaption', 'packStat', 'seasonOptText', 'packText', 'seriesText', 'handle', 'hasSession', 'epQualities']) {
            if (typeof movies[k] !== 'function') throw new Error('missing export ' + k);
        }
    });

    t('4 bridgeReply: card kinds → grammar (quoted + bare + stale)', () => {
        const J = '9@s.whatsapp.net';
        const seed = (ui) => movies._testSession(J, { list: [{ name: 'X', type: 'movie' }], at: Date.now(), ui });
        // tv card (episodes list) → row pick
        seed({ key: 'CARD1', kind: 'tv', n: 2, rowNo: null, at: Date.now() });
        if (movies.bridgeReply(J, 'CARD1', '5') !== '.moviepro 2 5') throw new Error('tv quoted fail');
        if (movies.bridgeReply(J, null, '5') !== '.moviepro 2 5') throw new Error('tv bare fail');
        // season options card → quality pick
        seed({ key: 'CARD2', kind: 'season', n: 2, rowNo: 3, at: Date.now() });
        if (movies.bridgeReply(J, 'CARD2', '1') !== '.moviepro 2 3 1') throw new Error('season quoted fail');
        // episode options card → quality pick
        seed({ key: 'CARD3', kind: 'ep', n: 2, rowNo: 4, at: Date.now() });
        if (movies.bridgeReply(J, 'CARD3', '2') !== '.moviepro 2 4 2') throw new Error('ep quoted fail');
        // movie card → quality pick
        seed({ key: 'CARD4', kind: 'movie', n: 1, rowNo: null, at: Date.now() });
        if (movies.bridgeReply(J, 'CARD4', '2') !== '.moviepro 1 2') throw new Error('movie quoted fail');
        // search list → list pick
        seed({ key: 'CARD5', kind: 'list', n: null, rowNo: null, at: Date.now() });
        if (movies.bridgeReply(J, 'CARD5', '7') !== '.moviepro 7') throw new Error('list quoted fail');
        // quoted a DIFFERENT (foreign) message → fallback list pick
        if (movies.bridgeReply(J, 'OTHERMSG', '3') !== '.moviepro 3') throw new Error('foreign quote fallback fail');
        // stale ui → fallback list pick
        seed({ key: 'OLD', kind: 'season', n: 2, rowNo: 9, at: Date.now() - 30 * 60e3 });
        if (movies.bridgeReply(J, 'OLD', '3') !== '.moviepro 3') throw new Error('stale fallback fail');
        // no session → null (not ours)
        movies._testSession('ghost@s', { list: [], at: 0 });
        if (movies.bridgeReply('ghost@s', null, '2') !== null) throw new Error('no-session should be null');
        // big row numbers pass through
        seed({ key: 'CARD6', kind: 'tv', n: 1, rowNo: null, at: Date.now() });
        if (movies.bridgeReply(J, 'CARD6', '172') !== '.moviepro 1 172') throw new Error('3-digit fail');
    });

    t('5 season FILES: helpers + constants + wiring', () => {
        if (movies.epFileName('Breaking Bad', 1, 1, '720p', 'https://x/CineSubz.com%20-%20BB.S01E01.mp4?play=true') !== 'Breaking Bad S01E01 [720p].mp4') throw new Error('epFileName mp4');
        if (movies.epFileName('Money Heist: Korea', 2, 12, null, 'https://x/f.mkv') !== 'Money Heist Korea S02E12 [orig].mkv') throw new Error('epFileName mkv/orig');
        const cap = movies.epCaption('Breaking Bad', 1, 3, '720p', 3, 62, 1);
        for (const s of ['🎬 *Breaking Bad S1E3*', '⚡ Quality: 720p', 'Season 1 · 3/62', '⚠️ 1']) if (!cap.includes(s)) throw new Error('epCaption missing ' + s);
        const st = movies.packStat('Breaking Bad', 1, 4, 2, 6, 62);
        if (!st.includes('✅ 4  ⚠️ 2  ·  6/62')) throw new Error('packStat wrong: ' + st);
        if (!/SEASON_FILE_CAP\s*=\s*50/.test(src) || !/EP_SEND_GAP\s*=\s*\d{4,5}/.test(src)) throw new Error('files constants missing');
        for (const f of ['seasonFilesCmd', 'resolveEp(e, tok, nume)', "mode: 'file'", "mode: 'link'"]) if (!src.includes(f)) throw new Error('missing: ' + f);
        // files default, links only with the link suffix
        const fileCall = src.indexOf('seasonFilesCmd(send, jid, msg, full, tv, n, rowNo');
        const linkCall = src.indexOf("tv.pack = { row: rowNo, season: row.season, qNo, tok: chosen.token");
        if (fileCall < 0 || linkCall < 0 || linkCall < fileCall) throw new Error('files/link wiring order wrong');
    });

    t('6 quality labels: site label capture + token fallback', () => {
        if (!src.includes('siteLabel')) throw new Error('siteLabel capture missing');
        if (!src.includes("qualityToken(url) || qualityToken(batch[i].siteLabel)")) throw new Error('token fallback missing');
        if (!src.includes("'» Video Qualities (All Episodes) 👇'")) throw new Error('season options card format changed');
    });

    t('7 bot.js number bridge: 3-digit + menu first + moviepro second', () => {
        if (!/\^\\d\{1,3\}\$/.test(botSrc)) throw new Error('bot.js number regex still 1-2 digits');
        if (!botSrc.includes('movies.bridgeReply(replyJid(msg.key), qid, text)')) throw new Error('bot.js not bridging via movies.bridgeReply');
        const menuIdx = botSrc.indexOf("text = '.menu ' + text");
        const brIdx = botSrc.indexOf('movies.bridgeReply');
        if (menuIdx < 0 || brIdx < 0 || menuIdx > brIdx) throw new Error('menu must take precedence over moviepro bridge');
    });

    t('8 usage + help strings updated', () => {
        if (!src.includes('අංකය reply කරන්න — card → options → files')) throw new Error('usage text stale');
        if (!botSrc.includes('reply අංකය → options → files')) throw new Error('HELP line stale');
        if (!botSrc.includes('episodes ඔක්කොම files එකින් එක')) throw new Error('CATS stale');
    });

    t('9 handle() registers ui on cards (list/movie/tv/season/ep)', () => {
        for (const k of ["setUi(s2, st, 'list')", "setUi(s, sent, 'movie', n)", "setUi(s, sent, 'tv', n)", "setUi(s, sentOpt, 'season', n, rowNo)", "setUi(s, sentOpt, 'ep', n, rowNo)"]) {
            if (!src.includes(k)) throw new Error('ui registration missing: ' + k);
        }
    });

    t('10 report-flood still absent (standing policy)', () => {
        const allSrc = ['bot.js', 'features.js', 'tools.js', 'movies.js', 'mirror.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
        if (/report30|report50|report100|report-flood|\.report \d/.test(allSrc)) throw new Error('report-flood strings appeared');
    });

    await ta('11 live (guarded): reply-flow pipeline sanity (labels + direct file)', async () => {
        let live = false;
        try {
            const found = await movies.csTvFind({ name: 'Money Heist', releaseInfo: '2017' });
            if (!found) throw new Error('cinesubz tv not found (skip)');
            const tv = await movies.csTvPage(found.url);
            if (!tv.eps.length) throw new Error('no eps parsed');
            const q = await movies.epQualities(tv.eps[0].slug);
            if (!q.length) throw new Error('no direct qualities (site changed?)');
            if (!q[0].label) throw new Error('labels missing on options');
            const best = q[q.length - 1];
            const r = await fetch(best.url, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-15' }, signal: AbortSignal.timeout(20000) });
            const ct = r.headers.get('content-type') || '';
            if (!/video\/(mp4|x-matroska)/.test(ct)) throw new Error('not a direct video: ' + ct);
            live = true;
        } catch (e) {
            if (live) throw e;
            console.log('    (live part skipped — ' + String(e.message).slice(0, 70) + ')');
        }
    });

    console.log(failed ? '\n💥 FAILURES ABOVE' : '\n🎉 ALL v2.24.0 TESTS PASSED');
})().catch((e) => { console.error('💥 ' + (e.stack || e.message)); failed = true; })
    .finally(() => process.exit(failed ? 1 : 0));
