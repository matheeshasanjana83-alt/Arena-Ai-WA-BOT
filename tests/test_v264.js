/**
 * test_v264.js — FAST DOWNLOADS + YT QUALITY MENU
 *  [1] planRanges — parallel ranged-download chunk math (contiguous, no gaps/overlaps, caps)
 *  [2] MediaFire resolve cache — cache hit skips the page scrape, TTL expiry, resolve() integration
 *  [3] parseYtArgs — .video 1080/720p · .song 320k/m4a/mp3/128 · menu fallback (no quality)
 *  [4] ytRows — real sizes (video file + audio track), DASH dedupe, cap-hidden rows, max 6, audio rows
 *  [5] ytMenuText — numbering, sizes, footer, reply hint
 *  [6] ytMenuBridge — quoted digit → .video/.song pick, wrong digit → .ytmenu re-show, wrong qid/jid → null
 *  [7] REAL handle() E2E — .video → menu card → bridge pick → instant download (info CACHED: 1 info call total)
 *      .song 320k → ytdl + ffmpeg mp3 convert → audio/mpeg send; ffmpeg fail → M4A fallback (never dead-ends)
 *  [8] version + source pins (manifest notes keep REGION-BLOCK / DEEP EPISODES / REAL SIZES / SUBTITLES words)
 * Run: node test_v264.js   (fully OFFLINE — media.info/ytdl/ffmpeg mocked)
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dl = require('../downloader.js');
const resolvers = require('../resolvers.js');
const features = require('../features.js');
const media = require('../media.js');

let pass = 0, fail = 0;
async function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return await r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

const B = 1048576;
const YID = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

/* ── mock media (features requires the SAME module instance → patch works) ── */
const VIDEO_INFO = {
    title: 'Me at the zoo', duration: 19, view_count: 250000000,
    formats: [
        { height: 2160, vcodec: 'avc1.640028', acodec: 'none', filesize: 900 * B },
        { height: 1080, vcodec: 'avc1.640028', acodec: 'none', filesize: 100 * B },
        { height: 1080, vcodec: 'av01.0.08M.08', acodec: 'none', filesize: 80 * B },      // same height, smaller → deduped
        { height: 720, vcodec: 'avc1.4d401f', acodec: 'none', filesize_approx: 50 * B },
        { height: 360, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', filesize: 20 * B },     // progressive (audio inside)
        { height: 144, vcodec: 'avc1.42001E', acodec: 'none', filesize: 3 * B },
        { acodec: 'mp4a.40.2', vcodec: 'none', filesize: 4 * B },                          // audio track (DASH)
    ],
};
const AUDIO_INFO = { title: 'Song', duration: 210, formats: [{ acodec: 'mp4a.40.2', vcodec: 'none', filesize: Math.round(3.3 * B) }] };

let infoCalls = 0, ytdlCalls = [], ffRuns = [];
const ORIG = { info: media.info, ytdl: media.ytdl, getBin: media.getBin, _run: media._run };
media.info = async (url) => { infoCalls++; return url.includes('audio-only') ? AUDIO_INFO : VIDEO_INFO; };
media.ytdl = async (url, opts) => { ytdlCalls.push({ url, opts }); return { path: path.join(os.tmpdir(), `kz264-${Date.now()}.${opts.mode === 'audio' ? 'm4a' : 'mp4'}`), ext: opts.mode === 'audio' ? 'm4a' : 'mp4', height: opts.height, size: 104 * B }; };
media.getBin = async (name) => '/fake/ffmpeg';
media._run = async (bin, args) => {
    ffRuns.push(args);
    if (args.includes('libmp3lame')) { const out = args[args.length - 1]; fs.writeFileSync(out, 'ID3MOCKMP3'); return { code: 0, out: '', err: '' }; }
    return { code: 1, out: '', err: 'mock fail' };
};

const sent = [];
const send = async (jid, content, opts) => { const m = { key: { id: 'BOTMSG-' + sent.length, remoteJid: jid }, content, opts }; sent.push(m); return m; };
const JID = '94710000000@s.whatsapp.net';
const lastText = () => { const t = [...sent].reverse().find(x => x.content?.text); return t ? t.content.text : ''; };

(async () => {
    console.log('== v2.64 fast downloads + yt quality menu ==');

    console.log('\n[1] planRanges — parallel chunk math');
    await ok('200 MB → 6 chunks covering [0..total-1] with no gaps/overlaps', () => {
        const parts = dl.planRanges(200 * B);
        assert.strictEqual(parts.length, 6);
        assert.strictEqual(parts[0][0], 0);
        assert.strictEqual(parts[parts.length - 1][1], 200 * B - 1);
        for (let i = 1; i < parts.length; i++) assert.strictEqual(parts[i][0], parts[i - 1][1] + 1, 'gap/overlap at ' + i);
    });
    await ok('10 MB (< PAR_CHUNK×2) → single chunk', () => assert.deepStrictEqual(dl.planRanges(10 * B), [[0, 10 * B - 1]]));
    await ok('50 MB → chunks ≈ 8 MB each, all ≤ 6', () => {
        const parts = dl.planRanges(50 * B);
        assert.ok(parts.length >= 4 && parts.length <= 6, 'len=' + parts.length);
        assert.strictEqual(parts[parts.length - 1][1], 50 * B - 1);
    });
    await ok('custom caps: planRanges(100MB, 2, 10MB) → 2 chunks', () => assert.strictEqual(dl.planRanges(100 * B, 2, 10 * B).length, 2));
    await ok('PAR_MIN 8MB · PAR_MAX 6 · PAR_CHUNK 8MB exported', () => { assert.strictEqual(dl.PAR_MIN, 8 * B); assert.strictEqual(dl.PAR_MAX, 6); assert.strictEqual(dl.PAR_CHUNK, 8 * B); });

    console.log('\n[1b] downloadHttp END-TO-END (mocked fetch) — parallel REALLY runs, byte-perfect');
    const crypto = require('crypto');
    const SRC = crypto.randomBytes(20 * B);   // 20 MB → floor(20/8)=2 chunks
    const SRC_MD5 = crypto.createHash('md5').update(SRC).digest('hex');
    let chunkCalls = 0, mode300 = false, mode500 = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
        const range = opts.headers && opts.headers.Range;
        if (!range) return new Response(SRC, { status: mode500 ? 500 : 200, headers: { 'content-type': 'application/zip', 'content-length': String(SRC.length), 'accept-ranges': 'bytes' } });
        chunkCalls++;
        if (mode300) return new Response(SRC, { status: 200, headers: { 'content-type': 'application/zip' } });   // host ignores Range → NOT 206
        const m = /bytes=(\d+)-(\d+)/.exec(range);
        const slice = SRC.subarray(+m[1], +m[2] + 1);
        return new Response(slice, { status: 206, headers: { 'content-type': 'application/zip', 'content-length': String(slice.length), 'content-range': `bytes ${m[1]}-${m[2]}/${SRC.length}` } });
    };
    await ok('20MB → 2 parallel 206 chunks → md5 byte-perfect (chunk count PROVES parallel path)', async () => {
        chunkCalls = 0;
        const files = await dl.download('http://mock.local/file.bin', null, { stream: false });
        assert.strictEqual(chunkCalls, 2, 'expected 2 ranged chunk GETs, got ' + chunkCalls);
        assert.strictEqual(files[0].size, SRC.length);
        assert.strictEqual(crypto.createHash('md5').update(fs.readFileSync(files[0].path)).digest('hex'), SRC_MD5);
        fs.rmSync(files[0].path, { force: true });
    });
    await ok('chunk answers 200 (no 206) → silent single-stream fallback, file still perfect', async () => {
        chunkCalls = 0; mode300 = true;
        const files = await dl.download('http://mock.local/file.bin', null, { stream: false });
        assert.ok(chunkCalls >= 1, 'chunk attempt missing');
        assert.strictEqual(crypto.createHash('md5').update(fs.readFileSync(files[0].path)).digest('hex'), SRC_MD5);
        fs.rmSync(files[0].path, { force: true });
    });
    await ok('chunk fail + retry 500 → clear error (never streams a canceled body)', async () => {
        mode500 = true;
        await assert.rejects(() => dl.download('http://mock.local/file.bin', null, { stream: false }), /server එකෙන් 500/);
    });
    globalThis.fetch = origFetch; mode300 = mode500 = false;

    console.log('\n[2] MediaFire resolve cache');
    await ok('mfCacheSet/Get roundtrip', () => {
        resolvers.mfCacheSet('https://www.mediafire.com/file/aaa/f.zip/file', 'https://download999.mediafire.com/f.zip');
        assert.strictEqual(resolvers.mfCacheGet('https://www.mediafire.com/file/aaa/f.zip/file').link, 'https://download999.mediafire.com/f.zip');
    });
    await ok('TTL expiry → null', async () => {
        resolvers.mfCacheSet('https://www.mediafire.com/file/old/f.zip/file', 'https://download1.mediafire.com/old.zip');
        resolvers._mfCache.get('https://www.mediafire.com/file/old/f.zip/file').at = Date.now() - resolvers.MF_TTL - 1000;
        assert.strictEqual(resolvers.mfCacheGet('https://www.mediafire.com/file/old/f.zip/file'), null);
    });
    await ok('resolve() uses the cache — CDN link returned WITHOUT any page fetch', async () => {
        const page = 'https://www.mediafire.com/file/cached/file.zip/file';
        resolvers.mfCacheSet(page, 'https://download777.mediafire.com/cached.zip');
        const r = await resolvers.resolve(page);
        assert.strictEqual(r.kind, 'http');
        assert.strictEqual(r.url, 'https://download777.mediafire.com/cached.zip');
        assert.strictEqual(r.referer, page);
    });
    await ok('resolve() cache miss → falls to network → clear Sinhala error (offline here)', async () => {
        await assert.rejects(() => resolvers.resolve('https://www.mediafire.com/file/nope/f.zip/file'));
    });

    console.log('\n[3] parseYtArgs — quality flags');
    await ok('.video <url> 1080 → height 1080', () => {
        const p = features.parseYtArgs(YID + ' 1080', 'video');
        assert.strictEqual(p.height, 1080); assert.strictEqual(p.query, YID); assert.strictEqual(p.aBit, null);
    });
    await ok('.video <url> 720p → 720 (p optional)', () => assert.strictEqual(features.parseYtArgs(YID + ' 720p', 'video').height, 720));
    await ok('.video <url> → no height (menu)', () => assert.strictEqual(features.parseYtArgs(YID, 'video').height, null));
    await ok('.video <url> 1080 extra → no match (must be last token)', () => assert.strictEqual(features.parseYtArgs(YID + ' 1080 extra', 'video').height, null));
    await ok('.song <url> 320k → aBit 320', () => { const p = features.parseYtArgs(YID + ' 320k', 'audio'); assert.strictEqual(p.aBit, 320); assert.strictEqual(p.query, YID); });
    await ok('.song <url> 128 → 128 · 192kbps → 192', () => { assert.strictEqual(features.parseYtArgs(YID + ' 128', 'audio').aBit, 128); assert.strictEqual(features.parseYtArgs(YID + ' 192kbps', 'audio').aBit, 192); });
    await ok('.song <url> m4a / orig / original → "m4a" (no convert)', () => {
        assert.strictEqual(features.parseYtArgs(YID + ' m4a', 'audio').aBit, 'm4a');
        assert.strictEqual(features.parseYtArgs(YID + ' orig', 'audio').aBit, 'm4a');
        assert.strictEqual(features.parseYtArgs(YID + ' original', 'audio').aBit, 'm4a');
    });
    await ok('.song <url> mp3 → default 320', () => assert.strictEqual(features.parseYtArgs(YID + ' mp3', 'audio').aBit, 320));
    await ok('.song <name> → no aBit (menu), name intact', () => {
        const p = features.parseYtArgs('faded alan walker', 'audio');
        assert.strictEqual(p.aBit, null); assert.strictEqual(p.query, 'faded alan walker');
    });

    console.log('\n[4] ytRows — real sizes from info JSON');
    await ok('video rows: desc, deduped per height, DASH audio added, progressive not', () => {
        const rows = features.ytRows(VIDEO_INFO, 'video', 200);
        assert.deepStrictEqual(rows.map(r => r.label), ['1080p', '720p', '360p', '144p']);   // 2160 dropped (cap)
        assert.strictEqual(rows[0].size, Math.round((100 * B + 4 * B) / B) * B);             // 1080 = 100MB video + 4MB audio
        assert.strictEqual(rows[1].size, 50 * B + 4 * B);                                    // 720 = filesize_approx + audio
        assert.strictEqual(rows[2].size, 20 * B);                                            // 360 progressive — audio inside, NOT added
        assert.strictEqual(rows[0].pick, '1080');
    });
    await ok('rows over cap hidden (2160p 900MB vs cap 200MB)', () => {
        const rows = features.ytRows(VIDEO_INFO, 'video', 200);
        assert.ok(!rows.some(r => r.label === '2160p'));
    });
    await ok('max 6 rows (8 heights → 6)', () => {
        const tall = { formats: [2160, 1440, 1080, 720, 480, 360, 240, 144].map(h => ({ height: h, vcodec: 'avc1', acodec: 'none', filesize: 10 * B })) };
        assert.strictEqual(features.ytRows(tall, 'video', 9e9).length, 6);
    });
    await ok('audio rows: M4A original / MP3 320 / MP3 128 with duration-based sizes', () => {
        const rows = features.ytRows(AUDIO_INFO, 'audio');
        assert.deepStrictEqual(rows.map(r => r.pick), ['m4a', '320k', '128k']);
        assert.strictEqual(rows[0].size, Math.round(3.3 * B));
        assert.strictEqual(rows[1].size, 210 * 40 * 1024);   // 320k ≈ 40 KB/s
        assert.strictEqual(rows[2].size, 210 * 16 * 1024);   // 128k ≈ 16 KB/s
    });
    await ok('audio rows survive empty formats (sizes null → menu still shows)', () => {
        const rows = features.ytRows({ title: 'x' }, 'audio');
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0].size, null);
    });

    console.log('\n[5] ytMenuText');
    await ok('video menu: numbering, ~sizes, reply hint, footer, 60-min TTL note', () => {
        const t = features.ytMenuText('Me at the zoo', features.ytRows(VIDEO_INFO, 'video', 200), 'video', '0:19 · 👁️ 250.0M');
        assert.match(t, /🎬 \*Me at the zoo\*/);
        assert.match(t, /\*1\.\* 🎞️ 1080p · ~104\.0 MB/);
        assert.match(t, /Quality එකක් තෝරන්න — මේ message එකට \*අංකය reply\* කරන්න/);
        assert.match(t, /මිනිත්තු 60 ඇතුලත reply කරන්න/);
        assert.match(t, /ᴋᴀᴠɪᴢ ᴍᴅ ᴠ1/);
        assert.match(t, /0:19 · 👁️ 250\.0M/);
    });
    await ok('audio menu: 🎵 rows + Format wording', () => {
        const t = features.ytMenuText('Song', features.ytRows(AUDIO_INFO, 'audio'), 'audio', '3:30');
        assert.match(t, /🎧 \*Song\*/);
        assert.match(t, /\*1\.\* 🎵 M4A original · ~3\.3 MB/);
        assert.match(t, /Format එකක් තෝරන්න/);
    });

    console.log('\n[6] ytMenuBridge — quote routing');
    const rowsV = features.ytRows(VIDEO_INFO, 'video', 200);
    features.ytRemember(JID, { key: { id: 'CARD-V' } }, YID, 'Me at the zoo', 'video', rowsV);
    features.ytRemember(JID, { key: { id: 'CARD-A' } }, YID, 'Song', 'audio', features.ytRows(AUDIO_INFO, 'audio'));
    await ok('video card quote 1 → .video <url> 1080 (row 1)', () =>
        assert.strictEqual(features.ytMenuBridge(JID, 'CARD-V', '1'), `.video ${YID} 1080`));
    await ok('video card quote 4 → .video <url> 144', () =>
        assert.strictEqual(features.ytMenuBridge(JID, 'CARD-V', String(rowsV.length)), `.video ${YID} 144`));
    await ok('audio card quote 2 → .song <url> 320k', () =>
        assert.strictEqual(features.ytMenuBridge(JID, 'CARD-A', '2'), `.song ${YID} 320k`));
    await ok('wrong digit → .ytmenu re-show (never silence)', () =>
        assert.strictEqual(features.ytMenuBridge(JID, 'CARD-V', '99'), `.ytmenu ${YID} video`));
    await ok('unknown qid → null (panels/moviedex free to claim)', () => assert.strictEqual(features.ytMenuBridge(JID, 'NOPE', '1'), null));
    await ok('jid mismatch → null', () => assert.strictEqual(features.ytMenuBridge('other@jid', 'CARD-V', '1'), null));
    await ok('non-digit → null', () => assert.strictEqual(features.ytMenuBridge(JID, 'CARD-V', 'abc'), null));
    await ok('expired card → .ytmenu re-show (60-min TTL)', () => {
        features.ytRemember(JID, { key: { id: 'CARD-OLD' } }, YID, 'T', 'video', rowsV);
        features._ytMenus.get('CARD-OLD').at = Date.now() - 61 * 60e3;
        assert.strictEqual(features.ytMenuBridge(JID, 'CARD-OLD', '1'), `.ytmenu ${YID} video`);
    });
    await ok('YT_CAP 40 — oldest card evicted', () => {
        for (let i = 0; i < 45; i++) features.ytRemember(JID, { key: { id: 'R' + i } }, YID, 'T', 'video', rowsV);
        assert.ok(!features._ytMenus.has('R0') && features._ytMenus.has('R44'));
    });

    console.log('\n[7] REAL handle() E2E (mocked media)');
    await ok('.video <link> → 📋 menu card sent, NO download yet, info cached', async () => {
        sent.length = 0; ytdlCalls.length = 0; infoCalls = 0; features._ytMenus.clear();
        await features.handle('.video', { send, jid: JID, msg: {}, rest: [YID], react: () => { } });
        const card = sent.find(x => x.content?.text?.includes('Quality එකක් තෝරන්න'));
        assert.ok(card, 'menu card missing');
        assert.match(card.content.text, /1080p · ~104\.0 MB/);
        assert.ok(features._ytMenus.has(card.key.id), 'card id not remembered');
        assert.strictEqual(ytdlCalls.length, 0, 'menu path must not download');
        assert.strictEqual(infoCalls, 1);
    });
    await ok('bridge pick → instant download with cached info (infoCalls stays 1 — ZERO extra yt-dlp -J)', async () => {
        const pick = features.ytMenuBridge(JID, [...features._ytMenus.keys()][0], '2');   // 720p row
        assert.strictEqual(pick, `.video ${YID} 720`);
        const parts = pick.split(' ');
        await features.handle('.video', { send, jid: JID, msg: {}, rest: parts.slice(1), react: () => { } });
        assert.strictEqual(ytdlCalls.length, 1);
        assert.strictEqual(ytdlCalls[0].opts.height, 720);
        assert.strictEqual(infoCalls, 1, 'info must come from cache');
        const v = sent.find(x => x.content?.video);
        assert.ok(v, 'video send missing');
        assert.match(v.content.caption || '', /Me at the zoo/);
        assert.match(v.content.caption || '', /720p/);
    });
    await ok('.song <link> 320k → ytdl(m4a) + ffmpeg libmp3lame 320k → audio/mpeg send', async () => {
        sent.length = 0; ytdlCalls.length = 0; ffRuns.length = 0;
        await features.handle('.song', { send, jid: JID, msg: {}, rest: [YID, '320k'], react: () => { } });
        assert.strictEqual(ytdlCalls.length, 1);
        assert.ok(ffRuns.some(a => a.includes('libmp3lame') && a.includes('320k')), 'ffmpeg mp3 run missing');
        const au = sent.find(x => x.content?.audio);
        assert.ok(au, 'audio send missing');
        assert.strictEqual(au.content.mimetype, 'audio/mpeg');
        assert.match(au.content.audio.url, /-320\.mp3$/);
        await new Promise(r => setTimeout(r, 120));
        assert.ok(!fs.existsSync(au.content.audio.url), 'sendFile must delete the temp file');
    });
    await ok('.song ffmpeg fail → M4A fallback still sends (never dead-ends)', async () => {
        sent.length = 0; ffRuns.length = 0;
        media._run = async () => ({ code: 1, out: '', err: 'no lame' });
        await features.handle('.song', { send, jid: JID, msg: {}, rest: [YID, '320k'], react: () => { } });
        const au = sent.find(x => x.content?.audio);
        assert.ok(au, 'fallback audio missing');
        assert.strictEqual(au.content.mimetype, 'audio/mp4');
        assert.ok(/M4A/.test(lastText()), 'status bubble must explain the M4A fallback — got: ' + lastText());
    });
    await ok('.song <link> (no quality) → 📋 audio format menu (3 rows)', async () => {
        sent.length = 0;
        await features.handle('.song', { send, jid: JID, msg: {}, rest: [YID], react: () => { } });
        const card = sent.find(x => x.content?.text?.includes('Format එකක් තෝරන්න'));
        assert.ok(card, 'audio menu missing');
        assert.match(card.content.text, /M4A original/);
        assert.match(card.content.text, /MP3 320kbps/);
        assert.match(card.content.text, /MP3 128kbps/);
        assert.ok(features.ytMenuBridge(JID, card.key.id, '3') === `.song ${YID} 128k`);
    });
    await ok('.ytmenu re-show — new card registered, old bridge NOT valid', async () => {
        const before = [...features._ytMenus.keys()];
        await features.handle('.ytmenu', { send, jid: JID, msg: {}, rest: [YID, 'video'], react: () => { } });
        const card = sent.find(x => x.content?.text?.includes('Quality එකක් තෝරන්න'));
        assert.ok(card && !before.includes(card.key.id), 'new card not sent');
        assert.ok(features._ytMenus.has(card.key.id));
    });

    console.log('\n[8] version + source pins');
    await ok('package.json 2.64.0', () => assert.strictEqual(require('../package.json').version, '2.69.0'));
    await ok('manifest.json 2.64.0 + notes mention FAST / YT QUALITY MENU (and keeps old keywords)', () => {
        const m = JSON.parse(fs.readFileSync('manifest.json'));
        assert.strictEqual(m.version, '2.69.0');
        assert.ok(/FAST DOWNLOADS|YT QUALITY MENU/i.test(m.notes));
        assert.ok(/REGION-BLOCK|406/i.test(m.notes));
        assert.ok(/DEEP EPISODES|EPISODE NUMBERS|REAL SIZES|SUBTITLES/i.test(m.notes));
        assert.ok(m.files.includes('tests/test_v264.js'));
    });
    await ok('media.js — yt-dlp concurrent fragments + lean retries', () => {
        const src = fs.readFileSync('media.js', 'utf8');
        assert.ok(src.includes("'--concurrent-fragments', '5'"));
        assert.ok(src.includes("'--retries', '2'") && src.includes("'--fragment-retries', '3'"));
    });
    await ok('downloader.js — parallel ranged download wired into downloadHttp', () => {
        const src = fs.readFileSync('downloader.js', 'utf8');
        assert.ok(src.includes('downloadParallel'), 'downloadParallel missing');
        assert.ok(src.includes('accept-ranges'), 'accept-ranges gate missing');
        assert.ok(src.includes("status !== 206"), '206 verification missing');
        assert.ok(dl.planRanges && dl.downloadParallel, 'exports missing');
    });
    await ok('resolvers.js — MediaFire cache wired', () => {
        const src = fs.readFileSync('resolvers.js', 'utf8');
        assert.ok(src.includes('mfCacheGet(raw)') && src.includes('mfCacheSet(raw, link)'));
    });
    await ok('bot.js — ytMenuBridge wired BEFORE moviedex.bridgeReply (panels first)', () => {
        const src = fs.readFileSync('bot.js', 'utf8');
        const y = src.indexOf('features.ytMenuBridge(jid0, qid, text)');
        const m = src.indexOf('moviedex.bridgeReply(jid0, qid, text)');
        const p = src.indexOf("settingState.get(jid0)");
        assert.ok(y > 0 && m > y && p < y, `order panels(${p}) < yt(${y}) < moviedex(${m})`);
        assert.ok(src.includes("'.ytmenu'"), '.ytmenu missing from HEAVY');
    });
    await ok('bot.js menus mention the quality menu', () => {
        const src = fs.readFileSync('bot.js', 'utf8');
        assert.ok(src.includes('YouTube quality menu'), 'DOWNLOAD card');
        assert.ok(src.includes('format menu — M4A / MP3 320 / 128'), 'YOUTUBE card');
    });
    await ok('features.js exports the bridge + helpers', () => {
        assert.strictEqual(typeof features.ytMenuBridge, 'function');
        assert.strictEqual(typeof features.ytRows, 'function');
        assert.strictEqual(typeof features.ytMenuResend, 'function');
        assert.ok(features.CMDS.includes('.ytmenu'));
    });
    await ok('README-SI v2.64 changelog entry', () =>
        assert.ok(fs.readFileSync('docs/README-SI.txt', 'utf8').includes('v2.64.0 — ⚡ FAST DOWNLOADS + 📋 YT QUALITY MENU')));

    /* restore mocks (clean process for anything else loading these modules) */
    Object.assign(media, ORIG);
    console.log(`\n═══ v2.64: ${pass} pass · ${fail} fail ═══`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
