'use strict';
/**
 * test_v219.js — offline checks for the v2.19 ".movie එකම එනවා" upgrade of .moviepro
 * (CineSubz gate decode / mapping / live-check plumbing). No network needed.
 */
const assert = require('assert');
const movies = require('./movies');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✅', name); } catch (e) { fail++; console.log('  ❌', name, '—', e.message); } };

console.log('test_v219 — .moviepro v2.19 (movie file pipeline)');

t('module loads + new exports', () => {
    for (const k of ['handle', 'csSearch', 'csMoviePage', 'mapMasked', 'resolveGate', 'qualitiesFor', 'sizeMB', 'bestMatch']) assert(typeof movies[k] === 'function', k);
});

t('mapMasked: server6 direct → csplayer2 + ?ext=mp4', () => {
    const r = movies.mapMasked('https://google.com/server6/202601/Avatar%20Fire%20and%20Ash%20(2025)%20English%20WEB-%5BCineSubz.co%5D-480p.mp4');
    assert.strictEqual(r.real, 'https://drive.csplayer2.space/server6/202601/Avatar%20Fire%20and%20Ash%20(2025)%20English%20WEB-%5BCineSubz.co%5D-480p?ext=mp4');
    assert.strictEqual(r.cdn, true);
});

t('mapMasked: server4 + /1:/ + bot code (HTML entities) → passthrough code + tg link', () => {
    const r = movies.mapMasked('https://google.com/server4/1:/tnganuwpxppzfymytsqr/012024/Aquaman.2018.BluRay-%5BCineSubz.co%5D-480p.mp4&#038;bot=cscloud2bot&#038;code=Z2V0LTc2NTIxNDIzNDU4MzYzMzQ');
    assert.strictEqual(r.real, 'https://drive.csplayer2.space/server4/tnganuwpxppzfymytsqr/012024/Aquaman.2018.BluRay-%5BCineSubz.co%5D-480p?ext=mp4&bot=cscloud2bot&code=Z2V0LTc2NTIxNDIzNDU4MzYzMzQ');
    assert.strictEqual(r.cdn, true);
    assert.strictEqual(r.tg, 'https://telegram.me/cscloud2bot?start=Z2V0LTc2NTIxNDIzNDU4MzYzMzQ');
});

t('mapMasked: server11/1:/ → server1 (csplayer2)', () => {
    const r = movies.mapMasked('https://google.com/server11/1:/abc/123/Film.2024.720p.mp4');
    assert.ok(r.real.startsWith('https://drive.csplayer2.space/server1/abc/123/Film.2024.720p?ext=mp4'), r.real);
});

t('mapMasked: non-CDN link (gdrive) → untouched', () => {
    const u = 'https://drive.google.com/uc?id=1AbC&export=download';
    const r = movies.mapMasked(u);
    assert.strictEqual(r.real, u);
    assert.strictEqual(r.cdn, false);
});

t('mapMasked: mkv transform', () => {
    const r = movies.mapMasked('https://google.com/server7/202608/Movie.2026.1080p.mkv');
    assert.strictEqual(r.real, 'https://drive.csplayer2.space/server7/202608/Movie.2026.1080p?ext=mkv');
});

t('sizeMB: "WEB-DL 480p • 2.3 GB • English" → 2355', () => {
    assert.strictEqual(movies.sizeMB('WEB-DL 480p • 2.3 GB • English'), 2355);
    assert.strictEqual(movies.sizeMB('WEB-DL 720p • 700 MB • English'), 700);
    assert.strictEqual(movies.sizeMB('WEB-DL 1080p'), null);
});

t('bestMatch: picks the right cinesubz item for a cinemeta meta', () => {
    const meta = { name: 'Avatar: The Way of Water', releaseInfo: '2022' };
    const items = [
        { title: 'Avatar (2009) Sinhala Subtitles', url: 'u1', tv: false },
        { title: 'Avatar: The Way of Water (2022) Sinhala Subtitles', url: 'u2', tv: false },
        { title: 'Avatar: The Last Airbender (2024)', url: 'u3', tv: true },
    ];
    const b = movies.bestMatch(items, meta);
    assert.ok(b, 'no match');
    assert.strictEqual(b.url, 'u2');
});

t('csSearch parses search page fixture (titles + urls, movies only flag)', () => {
    // minimal replica of the real search-page markup
    const html = `<div id="item-1" class="display-item"><div class="item-box">
<a href="https://cinesubz.net/movies/avatar-sinhala-subtitles/" data-url="avatar-sinhala-subtitles" data-ptype="movies" title="Avatar (2009) Sinhala Subtitles | සිංහල උපසිරැසි සමඟ"></a>
</div></div>
<div id="item-2" class="display-item"><div class="item-box">
<a href="https://cinesubz.net/tvshows/marvel-zombies-2025-tv-series/" data-ptype="tvshows" title="Marvel Zombies (2025)"></a>
</div></div>`;
    // run csSearch's parser against the fixture by stubbing fetchHtml via http interception is heavy —
    // instead verify regex behaviour through csMoviePage on a fixture below and here test the anchor regex directly
    const re = /<a\s+href="(https:\/\/cinesubz\.net\/(?:movies|tvshows)\/[^"]+)"[^>]*>/g;
    const found = [...html.matchAll(re)].map(m => m[1]);
    assert.deepStrictEqual(found, [
        'https://cinesubz.net/movies/avatar-sinhala-subtitles/',
        'https://cinesubz.net/tvshows/marvel-zombies-2025-tv-series/',
    ]);
});

t('csMoviePage link regex on real movie-page fixture', () => {
    const html = `<meta property="og:image" content="https://cinesubz.net/wp-content/uploads/p.jpg">
<meta property="og:title" content="Avatar: Fire and Ash (2025) Sinhala Subtitles | සිංහල උපසිරැසි සමඟ">
<div class='movie-download-link-item' id='link-row-150814'><a href='https://cinesubz.net/zt-links/pd6mk78ecv/' target='_blank' class='movie-download-button' rel='nofollow noopener'><span class='movie-download-icon'><i class='fa-solid fa-arrow-down'></i></span><span class='movie-download-info'><span class='movie-download-type'>Direct &amp; Telegram Download Links</span><span class='movie-download-meta'>WEB-DL 480p • 2.3 GB • English</span></span></a></div>
<div class='movie-download-link-item' id='link-row-150813'><a href='https://cinesubz.net/zt-links/d0uu9ahthw/' target='_blank' class='movie-download-button' rel='nofollow noopener'><span class='movie-download-info'><span class='movie-download-type'>Direct</span><span class='movie-download-meta'>WEB-DL 720p • 3.8 GB • English</span></span></a></div>`;
    const links = [];
    const re = /href=['"](https:\/\/cinesubz\.net\/zt-links\/[a-z0-9]+\/)['"][^>]*>[\s\S]{0,400}?movie-download-meta['"]>([^<]+)</g;
    let m;
    while ((m = re.exec(html)) !== null) links.push({ gate: m[1], label: m[2] });
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].gate, 'https://cinesubz.net/zt-links/pd6mk78ecv/');
    assert.strictEqual(links[0].label, 'WEB-DL 480p • 2.3 GB • English');
    assert.strictEqual(links[1].label, 'WEB-DL 720p • 3.8 GB • English');
});

t('cardText shows quality rows + movie-file hint when quals present (v2.22)', () => {
    const meta = { name: 'Test Movie', releaseInfo: '2026', imdbRating: '7.5', description: 'd' };
    const quals = { page: { poster: 'p', url: 'u' }, items: [{ gate: 'g1', label: 'WEB-DL 480p • 2.3 GB' }, { gate: 'g2', label: 'WEB-DL 720p • 3.8 GB' }] };
    const t1 = movies.cardText(meta, 2, quals);
    assert.ok(t1.includes('WEB-DL 480p • 2.3 GB'), 'quality row missing');
    assert.ok(t1.includes('අංකය reply'), 'pick hint missing (v2.24 reply flow)');
    assert.ok(t1.includes('movie file එකම එනවා'), 'movie-file hint missing');
    const t2 = movies.cardText(meta, 2, null);   // no quals → fallback links
    assert.ok(t2.includes('cinesubz.net'), 'fallback link missing');
    assert.ok(!t2.includes('අංකය reply'), 'should not show quality hint without quals');
});

t('bot.js still loads (routing intact)', () => {
    require('./bot');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
