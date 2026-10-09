// v2.14.0 fixes — real-world test of new features
process.env.ARENA_NO_DELAY = '1';
const fs = require('fs');
const path = require('path');
const media = require('./media');

(async () => {
    let ok = 0, bad = 0;
    const t = (name, cond) => { cond ? ok++ : bad++; console.log(`  ${cond ? '✅' : '❌'} ${name}`); };

    // 1. TikTok server-side download (fetchToFile)
    try {
        const r = await fetch('https://tikwm.com/api/?hd=1&url=' + encodeURIComponent('https://www.tiktok.com/@scout2015/video/6718335390845095173'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const j = await r.json();
        const d = j.data;
        const vurl = d.hdplay || d.play;
        const p = await media.fetchToFile(vurl, 'tiktok', { referer: 'https://www.tiktok.com/' });
        const size = fs.statSync(p).size;
        t(`TikTok server-side download (${(size / 1048576).toFixed(1)} MB)`, size > 100 * 1024);
        fs.rmSync(p, { force: true });
    } catch (e) { t('TikTok server-side download — ' + e.message.slice(0, 80), false); }

    // 2. resolveRedirects (fb.watch style redirect chain) — youtu.be → youtube.com/watch
    try {
        const out = await media.resolveRedirects('https://youtu.be/kJQP7kiw5Fk');
        t('resolveRedirects (redirect chain) → ' + out.slice(0, 40), /youtube\.com/.test(out));
    } catch (e) { t('resolveRedirects — ' + e.message.slice(0, 80), false); }

    // 3. Quality parse logic (Q_RE) — simulate features.js behavior
    {
        const Q_RE = /\s(2160|1440|1080|720|480|360|240|144)p?\s*$/i;
        let q = '.video https://youtu.be/xxxx 1080'.replace(/^\.\S+\s*/, '');
        const m = q.match(Q_RE);
        t('quality parse "1080" → ' + (m ? m[1] : 'null'), m && m[1] === '1080');
        q = '.video https://youtu.be/xxxx 720p'.replace(/^\.\S+\s*/, '');
        const m2 = q.match(Q_RE);
        t('quality parse "720p" → ' + (m2 ? m2[1] : 'null'), m2 && m2[1] === '720');
        q = '.video https://youtu.be/xxxx'.replace(/^\.\S+\s*/, '');
        t('quality parse none → null', !q.match(Q_RE));
        // height chain
        const ALL_H = [2160, 1440, 1080, 720, 480, 360];
        const chain = [...ALL_H.filter((x) => x <= 1440), ...ALL_H.filter((x) => x > 1440)];
        t('height chain for 1440: ' + chain.join(','), JSON.stringify(chain) === JSON.stringify([1440, 1080, 720, 480, 360, 2160]));
    }

    // 4. cookies file handling
    {
        const ck = media.cookiesFile();
        t('cookiesFile() null when no file', ck === null);
        fs.writeFileSync(path.join(__dirname, 'cookies.txt'), '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tKEY\tVAL\n');
        const ck2 = media.cookiesFile();
        t('cookiesFile() found after write', !!ck2);
        // yt-dlp accepts the cookies file (arg parsing works) — metadata of FB video should still work
        try {
            const yt = await media.getBin('yt-dlp');
            const r = await media._run(yt, ['--cookies', ck2, '-J', '--no-playlist', '--no-warnings', '--skip-download', 'https://www.facebook.com/facebook/videos/10153231379946729/'], 90e3);
            const parsed = r.code === 0 && JSON.parse(r.out).id === '10153231379946729';
            t('yt-dlp --cookies flag accepted (FB metadata)', parsed);
        } catch (e) { t('yt-dlp --cookies flag — ' + e.message.slice(0, 70), false); }
        fs.rmSync(path.join(__dirname, 'cookies.txt'), { force: true });
        t('cookiesFile() null again after delete', media.cookiesFile() === null);
    }

    // 5. auto-update logic runs without crash (throttled — just verify function exists & resolves)
    try {
        await media.checkUpdate(false);
        t('checkUpdate() runs (throttled) without crash', true);
    } catch (e) { t('checkUpdate() — ' + e.message.slice(0, 70), false); }

    console.log(`\n${ok} passed, ${bad} failed`);
    process.exit(bad ? 1 : 0);
})();
