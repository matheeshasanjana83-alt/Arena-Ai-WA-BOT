/**
 * test_v265.js — .SONG 403 FIX + MENU SPEED + EPORNER CDN MIRROR ROTATION (panel-diag driven)
 *  [1] media.firstOk — race semantics (first success wins, all-fail rejects, empty rejects)
 *  [2] media.info() — fake-yt-dlp binary: direct wins FAST while alt/proxies still dying (parallel race);
 *      all-fail → Sinhala bot-check error; args carry --socket-timeout 15
 *  [3] media.ytdl() ladder — YouTube: direct → proxies → alt LAST (probe: "page needs to be reloaded");
 *      non-YouTube (eporner): NO alt attempt, height-continue on blocked/connect errors, 2 fresh rounds
 *  [4] features.cliptoRows — real clipto JSON shape: mp4-only heights, webm excluded, progressive vs
 *      video-only sizes (bitrate×duration), audio M4A/320/128, cap hiding, max 6
 *  [5] REAL handle() E2E — info hangs → 1s deadline → clipto.com fallback rows → menu card → bridge pick
 *      (video + audio); .ytmenu re-show rides the same fallback
 *  [6] source pins — DoH invalidate, eporner hint, socket timeouts, deadline env
 *  [7] version pins (manifest notes keep old keywords; README keeps the v2.64 entry)
 * Run: node test_v265.js   (fully OFFLINE — fake yt-dlp binary + patched proxypool/fetch)
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dl = require('./downloader.js');
const features = require('./features.js');
const media = require('./media.js');
const pool = require('./proxypool.js');

let pass = 0, fail = 0;
async function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return await r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

const B = 1048576;
const YID = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const EPID = 'https://www.eporner.com/video-testx/clip/';

/* ── fake yt-dlp binary: arg-driven behavior + spawn log ── */
const TMPD = os.tmpdir();
const KZ_LOG = path.join(TMPD, `kz265-log-${Date.now()}.jsonl`);
process.env.KZ_YT_LOG = KZ_LOG;   // the fake binary appends one JSON line per spawn
const FAKE = path.join(TMPD, `kz265-fake-ytdlp-${Date.now()}.js`);
fs.writeFileSync(FAKE, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const mark = args.includes('-J') ? 'info' : 'dl';
const proxy = args.includes('--proxy');
const alt = args.some(a => /player_client=/.test(a));
const sti = args.indexOf('--socket-timeout');
const st = sti >= 0 ? args[sti + 1] : '';
if (process.env.KZ_YT_LOG) fs.appendFileSync(process.env.KZ_YT_LOG, JSON.stringify({ mark, proxy, alt, st, url: args[args.length - 1] }) + '\\n');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, false, ms);
if (args.includes('--version')) { console.log('2026.10.01-test'); process.exit(0); }
const mode = process.env.KZ_YT_MODE || '';
if (mark === 'info') {
    if (mode === 'botcheck') { process.stderr.write("ERROR: [youtube] Sign in to confirm you're not a bot.\\n"); process.exit(1); }
    if (proxy) { sleep(1500); process.stderr.write('ERROR: proxy dead\\n'); process.exit(1); }
    if (alt) { sleep(400); process.stderr.write('ERROR: The page needs to be reloaded.\\n'); process.exit(1); }
    console.log(JSON.stringify({ title: 'Fake', duration: 10, formats: [{ height: 360, vcodec: 'avc1', acodec: 'mp4a.40.2', filesize: ${B} }] }));
    process.exit(0);
}
const err = { botcheck: "ERROR: Sign in to confirm you're not a bot.", 403: 'ERROR: unable to download video data: HTTP Error 403: Forbidden' }[mode] || 'ERROR: generic fail';
sleep(150);
process.stderr.write(err + '\\n');
process.exit(1);
`);
fs.chmodSync(FAKE, 0o755);
const FAKEDL = path.join(TMPD, `kz265-fake-ffmpeg-${Date.now()}`);
fs.writeFileSync(FAKEDL, '#!/bin/sh\nexit 0\n');
fs.chmodSync(FAKEDL, 0o755);
process.env.YTDLP_PATH = FAKE;
process.env.FFMPEG_PATH = FAKEDL;
delete process.env.DL_PROXY;

/* ── deterministic proxypool: 2 fixed dead proxies ── */
const ORIG_POOL = { candidates: pool.candidates, isPool: pool.isPool, markGood: pool.markGood, markBad: pool.markBad };
pool.candidates = (n) => ['http://127.0.0.1:39991', 'http://127.0.0.1:39992'].slice(0, Math.min(2, n));
pool.isPool = (p) => String(p).includes('127.0.0.1:3999');
pool.markGood = () => { };
pool.markBad = () => { };

const logLines = () => fs.existsSync(KZ_LOG) ? fs.readFileSync(KZ_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const clearLog = () => { try { fs.rmSync(KZ_LOG, { force: true }); } catch { } };

/* shared chat-mock (declared before first use in [4]) */
const sent = [];
const send = async (jid, content, opts) => { const m = { key: { id: 'BOTMSG-' + sent.length, remoteJid: jid }, content, opts }; sent.push(m); return m; };
const JID = '94710000000@s.whatsapp.net';
const lastText = () => { const t = [...sent].reverse().find(x => x.content?.text); return t ? t.content.text : ''; };

(async () => {
    console.log('== v2.65 .song fix + menu speed + eporner CDN rotation ==');

    console.log('\n[1] media.firstOk — race semantics');
    await ok('first success wins (slow failer still pending)', async () => {
        const t0 = Date.now();
        const v = await media.firstOk([
            new Promise((_, rej) => setTimeout(() => rej(new Error('slow fail')), 2000)),
            new Promise((res) => setTimeout(() => res('fast win'), 50)),
        ]);
        assert.strictEqual(v, 'fast win');
        assert.ok(Date.now() - t0 < 1500, 'must not wait for the slow failer');
    });
    await ok('all fail → rejects with the LAST settled error', async () => {
        await assert.rejects(() => media.firstOk([
            new Promise((_, rej) => setTimeout(() => rej(new Error('e1')), 30)),
            new Promise((_, rej) => setTimeout(() => rej(new Error('e2')), 60)),
        ]), /e2/);
    });
    await ok('empty jobs → rejects', async () => assert.rejects(() => media.firstOk([])));

    console.log('\n[2] media.info() — parallel variant race (fake yt-dlp)');
    process.env.KZ_YT_MODE = '';
    clearLog();
    const settle = (ms = 2200) => new Promise(r => setTimeout(r, ms));   // losers log AFTER the winner returns (race!)
    await ok('direct wins FAST while alt/proxies are still dying (was: sequential 120s cascade)', async () => {
        const t0 = Date.now();
        const j = await media.info(YID);
        assert.strictEqual(j.title, 'Fake');
        const ms = Date.now() - t0;
        assert.ok(ms < 1500, `info must return via direct in <1.5s (parallel race), took ${ms}ms`);
        await settle();
    });
    await ok('variants raced: direct + alt + 2 pool proxies all spawned', () => {
        const calls = logLines().filter(c => c.mark === 'info');
        assert.strictEqual(calls.length, 4, 'expected direct + alt + 2 proxies, got ' + calls.length);
        assert.strictEqual(calls.filter(c => c.proxy).length, 2);
        assert.strictEqual(calls.filter(c => c.alt).length, 1);
    });
    await ok('info args carry --socket-timeout 15 (fast bail on dead sockets)', async () => {
        clearLog();
        await media.info(YID).catch(() => { });
        await settle();
        const calls = logLines();
        assert.ok(calls.length && calls.every(c => c.st === '15'), 'every info spawn must set socket-timeout 15');
    });
    await ok('all variants fail → Sinhala bot-check error (direct error reported)', async () => {
        process.env.KZ_YT_MODE = 'botcheck';
        clearLog();
        await assert.rejects(() => media.info(YID), /bot check/);
        await settle();   // stragglers from the PREVIOUS winner-return could still be logging
        const calls = logLines().filter(c => c.mark === 'info');
        assert.strictEqual(calls.length, 4, 'all 4 variants must be attempted');
        process.env.KZ_YT_MODE = '';
    });

    console.log('\n[3] media.ytdl() — attempt ladder (fake yt-dlp)');
    await ok('YouTube audio: direct → proxy ×2 → alt LAST (probe: alt clients = "page needs to be reloaded")', async () => {
        process.env.KZ_YT_MODE = 'botcheck';
        clearLog();
        await assert.rejects(() => media.ytdl(YID, { mode: 'audio', maxMB: 20 }), /bot check/);
        const calls = logLines().filter(c => c.mark === 'dl');
        assert.strictEqual(calls.length, 4, `direct + 2 proxies + alt = 4 calls, got ${calls.length}`);
        assert.strictEqual(calls[0].proxy, false && calls[0].alt, false, 'first = plain direct');
        assert.ok(calls[0].proxy === false && calls[0].alt === false);
        assert.strictEqual(calls[1].proxy, true, '2nd = pool proxy');
        assert.strictEqual(calls[2].proxy, true, '3rd = pool proxy');
        assert.strictEqual(calls[3].alt, true, 'alt clients LAST');
    });
    await ok('YouTube video 403 (IP block) → break heights → next attempt (4 calls, alt last)', async () => {
        process.env.KZ_YT_MODE = '403';
        clearLog();
        await assert.rejects(() => media.ytdl(YID, { mode: 'video', maxMB: 50 }), /403/);
        const calls = logLines().filter(c => c.mark === 'dl');
        assert.strictEqual(calls.length, 4, `1 call per attempt (blocked breaks heights), got ${calls.length}`);
        assert.strictEqual(calls[3].alt, true);
    });
    await ok('eporner video 403/dead CDN → NO alt, height-continue, 2 fresh rounds (3 attempts × 6 heights × 2)', async () => {
        process.env.KZ_YT_MODE = '403';
        clearLog();
        await assert.rejects(() => media.ytdl(EPID, { mode: 'video', maxMB: 50 }), /403/);
        const calls = logLines().filter(c => c.mark === 'dl');
        assert.strictEqual(calls.length, 36, `3 attempts × 6 heights × 2 rounds = 36, got ${calls.length}`);
        assert.ok(calls.every(c => c.alt === false), 'non-YouTube must never waste alt-client attempts');
        assert.strictEqual(calls.filter(c => c.proxy).length, 24, '2 proxies × 6 heights × 2 rounds');
        assert.ok(calls.every(c => c.st === '12'), 'non-YouTube socket-timeout 12 (fast bail)');
    });
    await ok('eporner height-continue: a mid-ladder height failing does NOT abort the ladder', async () => {
        // the 36-call count above proves it; here assert the ORDER: direct ladder repeats per round
        const calls = logLines().filter(c => c.mark === 'dl');
        const directIdx = calls.map((c, i) => (!c.proxy && !c.alt) ? i : -1).filter(i => i >= 0);
        assert.strictEqual(directIdx.length, 12, 'direct ladder = 6 heights × 2 rounds');
        assert.strictEqual(directIdx[6] - directIdx[0], 18, 'round 2 direct starts after the full round-1 ladder (3 attempts × 6)');
    });

    console.log('\n[4] features.cliptoRows — clipto API JSON → menu rows');
    const CLIPTO_JSON = {
        success: true, title: 'Fake clip', duration: 60,
        medias: [
            { type: 'video', ext: 'mp4', height: 2160, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 4000000, duration: 60 },
            { type: 'video', ext: 'mp4', height: 1080, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 2000000, duration: 60 },
            { type: 'video', ext: 'mp4', height: 360, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_LOW', bitrate: 700000, duration: 60 },
            { type: 'audio', ext: 'm4a', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000, duration: 60 },
            { type: 'video', ext: 'webm', height: 1440, mimeType: 'video/webm; codecs="vp9"', bitrate: 3000000, duration: 60 },
        ],
    };
    await ok('video rows: desc heights, webm excluded, video-only adds audio estimate, progressive not', () => {
        const rows = features.cliptoRows(CLIPTO_JSON, 'video');
        assert.deepStrictEqual(rows.map(r => r.label), ['2160p', '1080p', '360p']);
        assert.strictEqual(rows[0].pick, '2160');
        assert.strictEqual(rows[0].size, Math.round(4000000 / 8) * 60 + 60 * 16 * 1024);   // video-only + audio
        assert.strictEqual(rows[1].size, Math.round(2000000 / 8) * 60 + 60 * 16 * 1024);
        assert.strictEqual(rows[2].size, Math.round(700000 / 8) * 60);                     // progressive (mp4a + audioQuality)
    });
    await ok('audio rows: M4A from bitrate, MP3 320/128 from duration', () => {
        const rows = features.cliptoRows(CLIPTO_JSON, 'audio');
        assert.deepStrictEqual(rows.map(r => r.pick), ['m4a', '320k', '128k']);
        assert.strictEqual(rows[0].size, Math.round(131000 / 8) * 60);
        assert.strictEqual(rows[1].size, 60 * 40 * 1024);
        assert.strictEqual(rows[2].size, 60 * 16 * 1024);
    });
    await ok('capMB hides big rows (2160p 30MB vs cap 20)', () => {
        const rows = features.cliptoRows(CLIPTO_JSON, 'video', 20);
        assert.deepStrictEqual(rows.map(r => r.label), ['1080p', '360p']);
    });
    await ok('empty medias → [] (caller falls through to best-download)', () => {
        assert.deepStrictEqual(features.cliptoRows({}, 'video'), []);
        assert.deepStrictEqual(features.cliptoRows({ medias: [] }, 'audio'), []);
    });
    await ok('same row shape as ytRows → SAME bridge grammar', () => {
        const rows = features.cliptoRows(CLIPTO_JSON, 'video');
        features.ytRemember(JID, { key: { id: 'CARD-C' } }, YID, 'Fake clip', 'video', rows);
        assert.strictEqual(features.ytMenuBridge(JID, 'CARD-C', '1'), `.video ${YID} 2160`);
    });

    console.log('\n[5] REAL handle() E2E — info hang → deadline → clipto fallback menu');
    const ORIG_MEDIA = { info: media.info, ytdl: media.ytdl, _run: media._run };
    const ORIG_FETCH = global.fetch;
    process.env.YT_MENU_DEADLINE = '1';   // 1s deadline — fast test
    global.fetch = async (url, opts) => {
        if (String(url).includes('clipto.com/api/youtube')) return { ok: true, status: 200, json: async () => CLIPTO_JSON };
        return ORIG_FETCH(url, opts);
    };
    media.info = () => new Promise((res) => setTimeout(() => res({ title: 'too late', duration: 60, formats: [] }), 20000));   // the 4-min-bug simulation
    media.ytdl = async (url, opts) => {
        ytdlCalls.push({ url, opts });
        const p = path.join(TMPD, `kz265-out-${Date.now()}.${opts.mode === 'audio' ? 'm4a' : 'mp4'}`);
        fs.writeFileSync(p, 'M');
        return { path: p, ext: opts.mode === 'audio' ? 'm4a' : 'mp4', height: opts.height, size: B };
    };
    media._run = async (bin, args) => {
        ffRuns.push(args);
        if (args.includes('libmp3lame')) { const out = args[args.length - 1]; fs.writeFileSync(out, 'ID3MOCK'); return { code: 0, out: '', err: '' }; }
        return { code: 1, out: '', err: 'mock fail' };
    };
    let ytdlCalls = [], ffRuns = [];
    features._infoCache.clear();
    await ok('.video (info hang) → menu card STILL arrives via clipto in <4s', async () => {
        sent.length = 0; features._ytMenus.clear();
        const t0 = Date.now();
        await features.handle('.video', { send, jid: JID, msg: {}, rest: [YID], react: () => { } });
        const ms = Date.now() - t0;
        const card = sent.find(x => x.content?.text?.includes('Quality එකක් තෝරන්න'));
        assert.ok(card, 'menu card missing');
        assert.ok(ms < 4000, `menu must arrive fast via clipto fallback, took ${ms}ms`);
        assert.match(card.content.text, /2160p/);
        assert.match(card.content.text, /Fake clip/);
        assert.ok(features._ytMenus.has(card.key.id), 'card not remembered');
        assert.strictEqual(ytdlCalls.length, 0, 'menu path must not download');
    });
    await ok('bridge pick on the clipto card → download runs with the picked height', async () => {
        const pick = features.ytMenuBridge(JID, [...features._ytMenus.keys()][0], '2');   // 1080p row
        assert.strictEqual(pick, `.video ${YID} 1080`);
        await features.handle('.video', { send, jid: JID, msg: {}, rest: pick.split(' ').slice(1), react: () => { } });
        assert.strictEqual(ytdlCalls.length, 1);
        assert.strictEqual(ytdlCalls[0].opts.height, 1080);
        const v = sent.find(x => x.content?.video);
        assert.ok(v, 'video send missing');
    });
    await ok('.song (info fails fast) → clipto AUDIO menu (M4A/320/128) → 320k pick converts', async () => {
        sent.length = 0; ytdlCalls.length = 0; ffRuns.length = 0;
        media.info = async () => { throw new Error('dead'); };
        await features.handle('.song', { send, jid: JID, msg: {}, rest: [YID], react: () => { } });
        const card = sent.find(x => x.content?.text?.includes('Format එකක් තෝරන්න'));
        assert.ok(card, 'audio menu missing');
        assert.match(card.content.text, /M4A original/);
        assert.match(card.content.text, /MP3 320kbps/);
        const pick = features.ytMenuBridge(JID, card.key.id, '2');
        assert.strictEqual(pick, `.song ${YID} 320k`);
        await features.handle('.song', { send, jid: JID, msg: {}, rest: pick.split(' ').slice(1), react: () => { } });
        assert.ok(ffRuns.some(a => a.includes('libmp3lame') && a.includes('320k')), 'mp3 convert missing');
        const au = sent.find(x => x.content?.audio);
        assert.ok(au, 'audio send missing');
    });
    await ok('clipto ALSO down → graceful best-download fallback (never dead-ends, old v2.64 path)', async () => {
        sent.length = 0; ytdlCalls.length = 0;
        global.fetch = async () => { throw new Error('clipto dead'); };
        await features.handle('.video', { send, jid: JID, msg: {}, rest: [YID], react: () => { } });
        assert.strictEqual(ytdlCalls.length, 1, 'must fall through to the best download');
        const v = sent.find(x => x.content?.video);
        assert.ok(v, 'video must still be sent');
        assert.ok(!/❌/.test(lastText()), 'no error bubble expected — got: ' + lastText());
    });
    await ok('.ytmenu re-show rides the same clipto fallback', async () => {
        sent.length = 0;
        global.fetch = async (url) => String(url).includes('clipto.com') ? { ok: true, status: 200, json: async () => CLIPTO_JSON } : ORIG_FETCH(url);
        await features.handle('.ytmenu', { send, jid: JID, msg: {}, rest: [YID, 'video'], react: () => { } });
        const card = sent.find(x => x.content?.text?.includes('Quality එකක් තෝරන්න'));
        assert.ok(card, 're-show card missing');
        assert.match(card.content.text, /2160p/);
    });
    // restore
    media.info = ORIG_MEDIA.info; media.ytdl = ORIG_MEDIA.ytdl; media._run = ORIG_MEDIA._run;
    global.fetch = ORIG_FETCH;
    delete process.env.YT_MENU_DEADLINE;

    console.log('\n[6] source pins — DoH invalidate / eporner hint / ladder markers');
    await ok('net.js — doh-route failure invalidates the cached edge IPs', () => {
        const src = fs.readFileSync('net.js', 'utf8');
        assert.ok(src.includes("dohCache.delete(host + '/A')"), 'DoH cache invalidate missing');
    });
    await ok('downloader.js — eporner CDN mirror hint on connect failures', () => {
        const src = fs.readFileSync('downloader.js', 'utf8');
        assert.ok(src.includes('vid-.*\\.eporner\\.com'), 'eporner CDN host match missing');
        assert.ok(src.includes('video page* link'), 'page-link hint missing');
    });
    await ok('media.js — socket-timeout 15 (info) / 20 vs 12 (yt vs non-yt) + firstOk export', () => {
        const src = fs.readFileSync('media.js', 'utf8');
        assert.ok(src.includes("'--socket-timeout', '15'"), 'info socket-timeout missing');
        assert.ok(src.includes("isYt ? '20' : '12'"), 'ladder socket-timeout switch missing');
        assert.ok(src.includes('function firstOk') && src.includes('firstOk,'), 'firstOk not exported');
        assert.ok(src.includes('const rounds = isYt ? 1 : 2'), 'non-YouTube round rotation missing');
    });
    await ok('features.js — deadline env + clipto fallback in both menu paths + transient retry', () => {
        const src = fs.readFileSync('features.js', 'utf8');
        assert.ok(src.includes('YT_MENU_DEADLINE'), 'menu deadline env missing');
        assert.ok(src.includes('function cliptoRows'), 'cliptoRows missing');
        assert.ok(/ytMenuResend[\s\S]*cliptoRows\(await cliptoInfo/.test(src), 'ytMenuResend clipto fallback missing');
        assert.ok(src.includes('function fetchToFileRetry'), 'clipto transient retry missing');
    });

    console.log('\n[7] version pins');
    await ok('package.json 2.65.0', () => assert.strictEqual(require('./package.json').version, '2.65.0'));
    await ok('manifest.json 2.65.0 + notes keep old keywords + new markers', () => {
        const m = JSON.parse(fs.readFileSync('manifest.json'));
        assert.strictEqual(m.version, '2.65.0');
        assert.ok(/FAST DOWNLOADS|YT QUALITY MENU/i.test(m.notes));
        assert.ok(/REGION-BLOCK|406/i.test(m.notes));
        assert.ok(/SONG 403|MENU SPEED|EPORNER CDN/i.test(m.notes));
        assert.ok(m.files.includes('test_v265.js'));
    });
    await ok('README-SI keeps v2.64 entry AND gains the v2.65 entry', () => {
        const rd = fs.readFileSync('README-SI.txt', 'utf8');
        assert.ok(rd.includes('v2.65.0 — 🎵 .SONG FIX + ⚡ MENU SPEED + 🌐 EPORNER CDN FIX'));
        assert.ok(rd.includes('v2.64.0 — ⚡ FAST DOWNLOADS + 📋 YT QUALITY MENU'));
    });

    console.log(`\n═══ v2.65: ${pass} pass · ${fail} fail ═══`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
