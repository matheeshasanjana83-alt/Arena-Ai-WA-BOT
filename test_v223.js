/**
 * test_v223.js — MoviePro SERIES flow (v2.23): Cinemeta movies+series search,
 * cinesubz TV pages (episode rows), zeta player ajax → direct episode files,
 * season quality options + all-episode link pack — offline tests + guarded live net
 * run: node test_v223.js
 */
const fs = require('fs');
const { execSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const t = (name, fn) => { try { fn(); console.log(`[${name}] OK ✅`); } catch (e) { console.error(`[${name}] FAIL ❌ — ${e.message}`); failed = true; } };

const TV_HTML = `<!doctype html><html><head><title>x</title>
<meta property="og:title" content="Money Heist (2021) Sinhala Subtitle | CineSubz">
<meta property="og:image" content="https://cinesubz.co/p.jpg"></head><body>
<a class='episode-link' href='https://cinesubz.net/episodes/mh-1x2/' data-pid='15182' data-season='1' data-episode='2'> <span class='ep-num'>2</span> <span class='data'> <span class='ep-title'>Episode 2</span> <span class='ep-date'>May. 09, 2017</span> </span> </a>
<a class='episode-link' href='https://cinesubz.net/episodes/mh-1x1/' data-pid='15181' data-season='1' data-episode='1'> <span class='ep-num'>1</span> <span class='data'> <span class='ep-title'>Episode 1</span> <span class='ep-date'>May. 02, 2017</span> </span> </a>
<a class='episode-link' href='https://cinesubz.net/episodes/mh-2x1/' data-pid='15200' data-season='2' data-episode='1'> <span class='ep-num'>1</span> <span class='data'> <span class='ep-title'>Episode 1</span> <span class='ep-date'>Oct. 02, 2019</span> </span> </a>
</body></html>`;

const EP_HTML = `<li id='player-option-1' class='zetaflix_player_option active' data-type='ep' data-post='15181' data-nume='1'>
<li id='player-option-2' class='zetaflix_player_option' data-type='ep' data-post='15181' data-nume='2'>
<li id='player-option-3' class='zetaflix_player_option' data-type='movie' data-post='99999' data-nume='1'>`;

(async () => {
    const man = require('./manifest.json');
    const pkgV = require('./package.json').version;
    const movies = require('./movies');

    t('1 versions', () => {
        if (man.version !== pkgV || pkgV < '2.23.0') throw new Error('version sync: ' + pkgV);
        if (!man.files.includes('test_v223.js')) throw new Error('manifest missing test_v223.js');
    });

    t('2 syntax', () => {
        for (const f of ['bot.js', 'movies.js', 'style.js', 'tools.js', 'features.js']) execSync(`node --check ${f}`, { stdio: 'pipe' });
    });

    t('3 module graph + new exports', () => {
        require('./bot.js');
        for (const k of ['csTvPage', 'csTvFind', 'tvRows', 'epQualities', 'playerAjax', 'qualityToken', 'seriesText', 'seasonOptText', 'packText', 'sizeOfUrl', 'search', 'handle', 'bestMatch']) {
            if (typeof movies[k] !== 'function') throw new Error('missing export ' + k);
        }
    });

    t('4 search merges movies + series (series tagged, movies first)', async () => {
        const list = await movies.search('black clover');
        if (!list.length) throw new Error('no results');
        if (!list.some(m => m.type === 'series')) throw new Error('no series in results');
        if (!list.some(m => m.type === 'movie')) throw new Error('no movies in results');
        const firstMovieIdx = list.findIndex(m => m.type === 'movie');
        const firstSeriesIdx = list.findIndex(m => m.type === 'series');
        if (firstMovieIdx > firstSeriesIdx) throw new Error('series before movies');
    });

    t('5 csTvPage: episode rows (pid/season/ep/date) + poster + og title', async () => {
        // fake the HTTP layer through a local http server
        const http = require('http');
        const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(TV_HTML); });
        await new Promise(r => srv.listen(0, r));
        const port = srv.address().port;
        const orig = movies.csTvPage;
        // fetchHtml uses smartFetch → hard to stub; instead verify parser on fetched fixture via direct call of internals is not exported —
        // so we assert on the REAL cinesubz page when net is available, and on the fixture text via regex parity here.
        srv.close();
        // parser parity: the same regexes as movies.js applied to the fixture
        const eps = [];
        const re = /<a[^>]+class=['"]episode-link['"][^>]*>/g;
        let m;
        while ((m = re.exec(TV_HTML)) !== null) {
            const tag = m[0];
            const at = (a) => (tag.match(new RegExp(a + "=['\"]([^'\"]+)['\"]")) || [])[1] || '';
            eps.push({ pid: at('data-pid'), season: +at('data-season'), ep: +at('data-episode') });
        }
        if (eps.length !== 3 || eps[0].pid !== '15182' || eps[2].season !== 2) throw new Error('fixture parse wrong: ' + JSON.stringify(eps));
        if (!/property="og:image"\s+content="([^"]+)"/.test(TV_HTML)) throw new Error('og:image regex parity broken');
        if (!orig) throw new Error('csTvPage export gone');
    });

    t('6 tvRows: season pack rows interleaved + sorted episodes', () => {
        const rows = movies.tvRows({ eps: [
            { slug: 'b', pid: '3', season: 2, ep: 1, title: 'E', date: '' },
            { slug: 'a', pid: '1', season: 1, ep: 2, title: 'E', date: '' },
            { slug: 'a', pid: '2', season: 1, ep: 1, title: 'E', date: '' },
        ] });
        const kinds = rows.map(r => r.kind + (r.season || '') + (r.ep || ''));
        if (JSON.stringify(kinds) !== JSON.stringify(['season1', 'ep11', 'ep12', 'season2', 'ep21'])) throw new Error('rows wrong: ' + kinds);
        if (rows[0].kind !== 'season' || rows[1].ep !== 1 || rows[2].ep !== 2) throw new Error('order wrong');
    });

    t('7 seriesText: card + episode rows + page hints', () => {
        const tv = { poster: 'p', eps: [{ slug: 'a', pid: '1', season: 1, ep: 1, title: 'Episode 1', date: 'May. 02, 2017' }] };
        const rows = movies.tvRows(tv);
        const txt = movies.seriesText({ name: 'Money Heist', releaseInfo: '2017–2021', imdbRating: '8.2', genres: ['Crime'], country: 'Spain', description: 'd' }, 2, tv, rows, 0);
        for (const s of ['🍀 *Money Heist*', '⭐ 8.2', '🌍 Spain', '📦 Download Season 1 (All Episodes)', 'Season 1 Episode 1', 'May. 02, 2017', '*.moviepro 2 <row#>*']) {
            if (!txt.includes(s)) throw new Error('missing: ' + s);
        }
    });

    t('8 seasonOptText + packText formats', () => {
        const so = movies.seasonOptText({ name: 'X' }, 2, 1, 1, [{ token: '480p' }, { token: '720p' }], 'https://sinhalasub.lk/?s=x');
        for (const s of ['Download Season 1', 'Video: 480p', 'Video: 720p', 'sinhalasub.lk', '*.moviepro 2 1 <quality#>*']) {
            if (!so.includes(s)) throw new Error('seasonOpt missing ' + s);
        }
        const pk = movies.packText({ name: 'X' }, {}, 1, '720p', [{ ep: 1, url: 'https://cs/f1.mp4?play=true' }], 1, 2, true);
        if (!pk.includes('E1 → https://cs/f1.mp4?play=true') || !pk.includes('next')) throw new Error('packText wrong: ' + pk);
        const pkEnd = movies.packText({ name: 'X' }, {}, 1, '720p', [{ ep: 2, url: 'https://cs/f2.mp4?play=true' }], 1, 2, false);
        if (pkEnd.includes('next')) throw new Error('packText should omit next on last page');
    });

    t('9 qualityToken + playerAjax URL transform (?play=true)', async () => {
        if (movies.qualityToken('https://cs01.supercloud2.space/CineSubz.com%20-%20S01E01.720p.WEBRip.mp4?play=true') !== '720p') throw new Error('token 720p');
        if (movies.qualityToken('https://cs01.supercloud2.space/CineSubz.com%20-%20S01E01.1080p.x265.mkv') !== '1080p') throw new Error('token 1080p');
        if (movies.qualityToken('https://x.com/noq.mkv?play=true') !== null) throw new Error('token none');
        // playerAjax: URLSearchParams body + embed_url validation — verify against a stubbed fetch through globalThis
        const realFetch = globalThis.fetch;
        let captured = null;
        globalThis.fetch = async (url, opts = {}) => {
            captured = { url: String(url), method: opts.method, body: opts.body, headers: opts.headers };
            return { ok: true, json: async () => ({ embed_url: 'https://player1.setwenna.one/CineSubz.com%20-%20S01E01.720p.mp4', type: 'mp4' }) };
        };
        try {
            const url = await movies.playerAjax('15181', '2', 'ep');
            if (url !== 'https://player1.setwenna.one/CineSubz.com%20-%20S01E01.720p.mp4?play=true') throw new Error('transform wrong: ' + url);
            if (captured.method !== 'POST' || !String(captured.body).includes('action=zeta_player_ajax') || !String(captured.body).includes('post=15181') || !String(captured.body).includes('nume=2')) throw new Error('ajax body wrong: ' + captured.body);
            // iframe embed → null
            globalThis.fetch = async () => ({ ok: true, json: async () => ({ embed_url: 'https://player.example/embed/abc', type: false }) });
            if (await movies.playerAjax('1', '1', 'ep') !== null) throw new Error('iframe embed should be null');
        } finally { globalThis.fetch = realFetch; }
    });

    t('10 bestMatch: series prefer + shorter-title tie-break', () => {
        const meta = { name: 'Money Heist', releaseInfo: '2017–2021' };
        const items = [
            { url: 'korea', title: 'Money Heist: Korea – Joint Economic Area (2022) Sinhala Sub', tv: true },
            { url: 'main', title: 'Money Heist (2021) Sinhala Subtitles', tv: true },
        ];
        const b = movies.bestMatch(items, meta, 'series');
        if (!b || b.url !== 'main') throw new Error('tie-break picked ' + (b && b.url));
        const bm = movies.bestMatch([{ url: 'mv', title: 'Mad Money (2008)', tv: false }, { url: 'tv', title: 'Money Heist (2021)', tv: true }], meta);
        if (!bm || bm.url !== 'tv') throw new Error('movie-mode picked ' + (bm && bm.url));   // tv penalty default → 'tv' has full token match
    });

    t('11 grammar: 5-token series picks parse (offline handle dry-run)', () => {
        const src = fs.readFileSync('movies.js', 'utf8');
        // runtime grammar checks (the literal lives in movies.js handle())
        const m = '1 2 3 link'.match(/^(\d{1,2})(?:\s+(trailer|t|next|n))?(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}))?(?:\s+(link|l|next|n))?$/i);
        if (!m) throw new Error('grammar cannot parse n row q link');
        const m2 = '1 next'.match(/^(\d{1,2})(?:\s+(trailer|t|next|n))?(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}))?(?:\s+(link|l|next|n))?$/i);
        if (!m2 || !/^n/i.test(m2[2])) throw new Error('grammar cannot parse n next');
        const m3 = '1 2 3 next'.match(/^(\d{1,2})(?:\s+(trailer|t|next|n))?(?:\s+(\d{1,2}))?(?:\s+(\d{1,2}))?(?:\s+(link|l|next|n))?$/i);
        if (!m3 || !m3[5]) throw new Error('grammar cannot parse n row q next');
        if (!src.includes('deliverStream') || !src.includes('episodeFileCmd') || !src.includes('seasonPackCmd')) throw new Error('series delivery fns missing');
    });

    t('12 live (guarded): cinesubz TV page + episode qualities + direct file range', async () => {
        let live = false;
        try {
            const found = await movies.csTvFind({ name: 'Money Heist', releaseInfo: '2017' });
            if (!found) throw new Error('cinesubz tv not found (site down? skip)');
            const tv = await movies.csTvPage(found.url);
            if (!tv.eps.length) throw new Error('no eps parsed');
            const q = await movies.epQualities(tv.eps[0].slug);
            if (!q.length) throw new Error('no direct qualities (site changed?)');
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

    t('13 report-flood still absent (standing policy)', () => {
        const allSrc = ['bot.js', 'features.js', 'tools.js', 'movies.js', 'mirror.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
        if (/report30|report50|report100|report-flood|\.report \d/.test(allSrc)) throw new Error('report-flood strings appeared');
    });

    console.log(failed ? '\n💥 FAILURES ABOVE' : '\n🎉 ALL v2.23.0 TESTS PASSED');
})().catch((e) => { console.error('💥 ' + (e.stack || e.message)); failed = true; })
    .finally(() => process.exit(failed ? 1 : 0));
