/**
 * test_v301.js — 🎬 CINESUBZ/CINERU ENGINE (v3.00 zeta mirror → v3.01 SEPARATE commands).
 * HISTORY (live probes 2026-10-30): MovieBox VIP-blocked ALL mashle sids × resolutions × both paths
 * ('VIP-only' throw) while Asitha-MD MoviePro downloads the same series — its API docs list /cinesubz/*
 * + /cineru/* (zetaflix-family Sri-Lankan sites). cinesubz.net verified END-TO-END from sandbox:
 * search (zetaflix API + nonce) → tvshow page episode anchors (data-pid/data-season/data-episode) →
 * episode page zt-links + download-meta → link-page urlMappings → drive.csplayer2.space real MP4
 * (S1E1 720p 280MB · S2E1 480p 150MB constructed-slug · The Flash movie 480p 900MB).
 * v3.01 USER DIRECTIVE: 'Moviedex command එකට cinesubz,cineru mix කරන්න එපා ඒ දෙක වෙනම command දෙකක් ලෙස'
 * → moviedex UN-MIXED (zero zeta refs — VIP-only honest error again); zetaDownload engine MOVED to
 * zetasub.js; .cinesubz/.cineru commands = cinesite.js (own suite test_v302).
 * Tested here (ALL OFFLINE — fixtures from the live-captured shapes, fetch mocked):
 *  (1) parseNonce / parseSearch / parseTv (slug base incl. trailing slash) / parseLinks (episode +
 *      movie meta variants) / parseLinkPage (mask+mappings+ext fix + entity decode + already-direct)
 *  (2) matchScore fuzzy title matching
 *  (3) zetaDownload engine (now in zetasub): ranged-parallel write + CF-challenge honest throw
 *  (4) UN-MIX markers: moviedex has ZERO zeta references · zetasub exports zetaDownload
 *  (5) pins 3.02.0 pkg+manifest + notes headline + manifest lists zetasub.js + cinesite.js + test_v302
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v301_mem.json';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = JSON.parse(fs.readFileSync(REPO + '/package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync(REPO + '/manifest.json', 'utf8'));
const Z = require('../zetasub');
const mvSrc = fs.readFileSync(REPO + '/moviedex.js', 'utf8');
const zetaSrc = fs.readFileSync(REPO + '/zetasub.js', 'utf8');

(async () => {
    console.log('— v3.02.0 pins + markers —');
    ok('version 3.02.0 pkg+manifest · notes headline · manifest lists zetasub.js + cinesite.js + test_v302.js', () => {
        assert.strictEqual(pkg.version, '3.02.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.02.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('CINESUBZ + CINERU SEPARATE COMMANDS'), 'notes headline');
        assert.ok(manifest.files.includes('zetasub.js'), 'manifest lists zetasub.js');
        assert.ok(manifest.files.includes('cinesite.js'), 'manifest lists cinesite.js');
        assert.ok(manifest.files.includes('tests/test_v302.js'), 'manifest lists test_v302.js');
    });
    ok('UN-MIX markers: moviedex has ZERO zeta refs · zetasub owns zetaDownload · cinesite wired in bot.js', () => {
        assert.ok(!mvSrc.includes("require('./zetasub')"), 'moviedex zeta require GONE');
        assert.ok(!mvSrc.includes('zetaDownload'), 'moviedex zetaDownload GONE');
        assert.ok(!mvSrc.includes('zetaRow'), 'moviedex zetaRow GONE');
        assert.ok(!mvSrc.includes('_zetaTried'), 'moviedex _zetaTried GONE');
        assert.ok(!mvSrc.includes('zetaCache'), 'moviedex zetaCache GONE');
        assert.ok(mvSrc.includes('row.direct) return directDownload'), 'downloadDash direct route intact');
        assert.ok(zetaSrc.includes('async function zetaDownload'), 'zetaDownload now in zetasub.js');
        const botSrc = fs.readFileSync(REPO + '/bot.js', 'utf8');
        assert.ok(botSrc.includes("require('./cinesite')"), 'bot.js requires cinesite');
        assert.ok(botSrc.includes("cinesite.handle(c"), 'bot.js dispatches cinesite.handle');
        assert.ok(botSrc.includes('cinesite.bridge(jid0, qid, text)'), 'bot.js numeric bridge chain');
        assert.ok(botSrc.includes("'.cinesubz', '.cineru'"), 'HEAVY has both commands');
        assert.ok(botSrc.includes('cinesite.healthCheck(8000)'), 'boot health probe wired');
        assert.ok(zetaSrc.includes("DOMAINS = ['https://cinesubz.net', 'https://cineru.lk']"), 'domain ladder');
        assert.ok(zetaSrc.includes('cfHit') && zetaSrc.includes('cf-mitigated'), 'CF challenge detection in zetasub downloader (cfHit + cf-mitigated regex)');
        assert.ok(!mvSrc.includes('cf-mitigated') && !mvSrc.includes('zetaRow'), 'moviedex stays CF/zeta-free');
    });

    console.log('— pure parsers (live-shaped fixtures) —');
    ok('parseNonce: picks "nonce":"<hex>" pairs', () => {
        const html = 'var ss_l18n = {"nonce":"1258f3b157","url":"/wp-admin/admin-ajax.php"}; x={"nonce":"11c13d6e10"}';
        assert.deepStrictEqual(Z.parseNonce(html), ['1258f3b157', '11c13d6e10']);
        assert.deepStrictEqual(Z.parseNonce('no nonce here'), []);
    });
    ok('parseSearch: zetaflix JSON → typed rows (tv/movies only, title cleaned, imdb/date)', () => {
        const j = {
            '81811': { title: 'Solo Leveling (2024) TV S01 & S02 Complete', url: 'https://cinesubz.net/tvshows/solo-leveling-2024-tv-s01/', img: 'x.jpg', extra: { date: '2024', imdb: '8.8' } },
            '74297': { title: 'ONE PIECE (2023) TV Series | Sinhala Subtitles | සිංහල උපසිරැසි සමඟ', url: 'https://cinesubz.net/tvshows/one-piece-2023/', extra: { date: '2023', imdb: '8.1' } },
            '999': { title: 'The Flash (2023) Sinhala Subtitles | සිංහල උපසිරැසි', url: 'https://cinesubz.net/movies/the-flash-2023-sinhala-subtitles/', extra: { date: '2023', imdb: '6.8' } },
            '888': { title: 'no type', url: 'https://cinesubz.net/release/2023/' },
        };
        const rows = Z.parseSearch(j);
        assert.strictEqual(rows.length, 3, '3 typed rows (int-like keys reorder — find by id)');
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        assert.strictEqual(byId['81811'].type, 'tv');
        assert.strictEqual(byId['81811'].name, 'Solo Leveling (2024) TV S01 & S02 Complete');
        assert.strictEqual(byId['74297'].name.includes('Sinhala Subtitles'), false, 'subtitle suffix stripped');
        assert.strictEqual(byId['999'].type, 'movie');
        assert.strictEqual(byId['999'].imdb, '6.8');
    });
    ok('parseTv: episode anchors → slug base (trailing slash safe) + seasons + rows', () => {
        const html = "<button class='season-btn active' data-snum='1'>Season 01</button><button class='season-btn ' data-snum='2'>Season 02</button>" +
            "<ul id='season-listep-1' class='episodes-list active' data-season='1'>" +
            "<li><a class='episode-link' href='https://cinesubz.net/episodes/solo-leveling-1x1/' data-pid='81815' data-season='1' data-episode='1'>E1</a></li>" +
            "<li><a class='episode-link' href='https://cinesubz.net/episodes/solo-leveling-1x2/' data-pid='81816' data-season='1' data-episode='2'>E2</a></li></ul>";
        const p = Z.parseTv(html);
        assert.strictEqual(p.epSlugBase, 'solo-leveling', 'slug base (trailing / stripped)');
        assert.deepStrictEqual(p.seasons, [1, 2]);
        assert.strictEqual(p.epRows.length, 2);
        assert.strictEqual(p.epRows[1].se + 'x' + p.epRows[1].ep, '1x2');
    });
    ok('parseLinks: episode (download-button/download-meta) + movie (movie-download-button/movie-download-meta) variants', () => {
        const ep = "<div class='download-link-item' id='link-row-167592'><a href='https://cinesubz.net/zt-links/lnrvacw77i/' target='_blank' class='download-button' rel='nofollow noopener'><span class='download-icon'><i class='fa-solid fa-arrow-down'></i></span><span class='download-info'><span class='download-type'>Direct &amp; Telegram Download Links</span><span class='download-meta'>WEBRip SD 480p \u2022 130 MB \u2022 Japanese</span></span></a></div>" +
            "<div class='download-link-item'><a href='https://cinesubz.net/zt-links/kcnb7uw6wz/' target='_blank' class='download-button'><span class='download-info'><span class='download-meta'>WEBRip HD 720p \u2022 280 MB \u2022 Japanese</span></span></a></div>";
        const rows = Z.parseLinks(ep);
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].label, '480p');
        assert.strictEqual(rows[0].sizeMB, 130);
        assert.strictEqual(rows[0].lang, 'Japanese');
        assert.ok(rows[0].linkUrl.endsWith('/zt-links/lnrvacw77i/'));
        const mv = "<div class='movie-download-link-item'><a href='https://cinesubz.net/zt-links/zmtvhku2he/' target='_blank' class='movie-download-button'><span class='movie-download-info'><span class='movie-download-meta'>BluRay SD 480p \u2022 900 MB \u2022 English</span></span></a></div>";
        const rows2 = Z.parseLinks(mv);
        assert.strictEqual(rows2.length, 1, 'movie variant parsed');
        assert.strictEqual(rows2[0].sizeMB, 900);
    });
    ok('parseLinkPage: masked google/server + urlMappings → real CDN + ext fix + entity decode', () => {
        const html = "<a href=\"https://google.com/server3/1:/lyppijeepgwshlzadesu/Drive03/Solo.Leveling.S01E01.JAPANESE.WEBRip-%5BCineSubz.co%5D-480p.mp4&#038;bot=cscloud2bot&#038;code=Z2V0LTczNTU1\" target=\"_blank\">Click</a>" +
            "<script>var urlMappings = [\n{search:[\"https://google.com/server11/1:/\",\"https://google.com/server12/1:/\"],replace:\"https://drive.csplayer2.space/server1/\"},{search:[\"https://google.com/server3/1:/\"],replace:\"https://drive.csplayer2.space/server3/\"}];</script>";
        const res = Z.parseLinkPage(html);
        assert.ok(res, 'resolved');
        assert.ok(res.url.startsWith('https://drive.csplayer2.space/server3/'), 'mapping applied: ' + res.url.slice(0, 60));
        assert.ok(res.url.includes('?ext=mp4&bot=cscloud2bot&code='), 'ext fix: ' + res.url.slice(-45));
        assert.ok(res.fname.startsWith('Solo.Leveling.S01E01'), 'fname from path');
    });
    ok('parseLinkPage: already-direct external mp4 href passes through · non-file page → null', () => {
        const direct = "<a href=\"https://cdn.example.net/file/Movie.2024.720p.mp4?token=abc\">dl</a>";
        const r1 = Z.parseLinkPage(direct);
        assert.ok(r1 && r1.url.startsWith('https://cdn.example.net/') && r1.url.includes('?ext=mp4'), 'direct url + ext');
        assert.strictEqual(Z.parseLinkPage("<a href='https://t.me/CineSubzAdmin'>tg</a>"), null, 'no file → null');
    });
    ok('matchScore: fuzzy title matching ≥0.33 gate', () => {
        assert.ok(Z.matchScore('Mashle: Magic and Muscles [English]', 'Mashle: Magic and Muscles (2023)') >= 0.34, 'same-title overlap');
        assert.ok(Z.matchScore('Solo Leveling', 'Solo Leveling (2024) TV S01 & S02 Complete') >= 0.33, 'season-suffixed variant (2/6 = 0.333)');
        assert.ok(Z.matchScore('One Piece', 'The Flash (2023)') < 0.34, 'different title low');
    });

    console.log('— zetaDownload engine (fetch mocked, ranged-parallel) —');
    await okA('ranged download writes ordered chunks → complete file + bytes', async () => {
        const total = 10 * 1024 * 1024;   // 10MB → 3 chunks (4+4+2)
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts = {}) => {
            const range = String((opts.headers || {}).Range || '');
            const m = range.match(/bytes=(\d+)-(\d+)/);
            const s = m ? Number(m[1]) : 0, e = m ? Number(m[2]) : total - 1;
            const buf = Buffer.alloc(e - s + 1, 0x41);
            return { status: 206, ok: true, headers: new Map([['content-range', `bytes ${s}-${e}/${total}`]]), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), body: { cancel: async () => { } } };
        };
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeta-test-'));
        try {
            const res = await Z.zetaDownload({ url: 'https://cdn.test/file.mp4?ext=mp4' }, { tmpDir, finalName: 'test.mp4', onProgress: null });
            assert.strictEqual(res.bytes, total, 'bytes complete');
            const st = fs.statSync(res.path);
            assert.strictEqual(st.size, total, 'file size');
        } finally { globalThis.fetch = realFetch; fs.rmSync(tmpDir, { recursive: true, force: true }); }
    });
    await okA('CF-challenge (403 + cf-mitigated) → honest throw, empty pool → never fakes', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ status: 403, ok: false, headers: new Map([['cf-mitigated', 'challenge']]), body: { cancel: async () => { } } });
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeta-cf-'));
        try {
            let msg = '';
            try { await Z.zetaDownload({ url: 'https://cdn.test/x.mp4' }, { tmpDir, finalName: 'x.mp4', onProgress: null }); }
            catch (e) { msg = String(e.message || e); }
            assert.ok(/CF-block/.test(msg), 'honest CF error: ' + msg);
        } finally { globalThis.fetch = realFetch; fs.rmSync(tmpDir, { recursive: true, force: true }); }
    });

    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
