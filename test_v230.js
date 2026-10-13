'use strict';
/**
 * test_v230.js — MovieDex 360p + honest delivery (v2.30.0)
 * v2.29 base + ① synthetic 360p re-encode row (source ladders stop at 480p) ② quality menus
 * merge ALL play-info streams (MPD-dedupe) ③ honest progress (real bytes, no instant fake 99%,
 * CDN-stall watchdog) ④ WhatsApp upload timeout in pacer (stuck-99% / silent-bot fix).
 * run: node test_v230.js   (offline — REAL HTTP against a local DASH server + real ffmpeg)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, execFileSync } = require('child_process');

let failed = false;
process.chdir(__dirname);
const TMP = path.join(__dirname, '.tmp-v230');
const ASSETS = path.join(TMP, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });
process.env.DL_TMP = path.join(TMP, 'dl');
fs.mkdirSync(process.env.DL_TMP, { recursive: true });

/** ffmpeg → tiny real DASH assets (SegmentTimeline → drain mode) — generated lazily; skipped sections degrade gracefully */
let assetsReady = false;
function genAssets() {
    if (assetsReady) return;
    assetsReady = true;
    execSync(`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc=size=128x96:rate=10:duration=6" -f lavfi -i "sine=frequency=440:duration=6" -c:v libx264 -preset ultrafast -b:v 1500k -c:a aac -b:a 32k -f dash -seg_duration 0.5 ${JSON.stringify(path.join(ASSETS, 'index.mpd'))}`);
    // counted-mode MPD (aoneroom style: duration attr, no timeline) pointing at the same files
    fs.writeFileSync(path.join(ASSETS, 'counted.mpd'), `<MPD profiles="urn:mpeg:dash:profile:isoff-live:2011" mediaPresentationDuration="PT6.0S"><Period>
<AdaptationSet contentType="video"><Representation id="0" mimeType="video/mp4" codecs="avc1.64000d" bandwidth="1500000" width="128" height="96"><SegmentTemplate timescale="10240" duration="61440" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"/></Representation></AdaptationSet>
<AdaptationSet contentType="audio"><Representation id="1" mimeType="audio/mp4" codecs="mp4a.40.2" bandwidth="32000"><SegmentTemplate timescale="44100" duration="22050" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"/></Representation></AdaptationSet>
</Period></MPD>`);
    // ladder mpds for mergedQualities (no downloads happen on these)
    const tpl = `<SegmentTemplate timescale="10240" duration="61440" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"/>`;
    fs.writeFileSync(path.join(ASSETS, 'ladder.mpd'), `<MPD mediaPresentationDuration="PT1433.8S"><Period>
<AdaptationSet contentType="video"><Representation id="0" bandwidth="1707000" codecs="hev1" width="1920" height="1080">${tpl}</Representation><Representation id="2" bandwidth="1000000" codecs="hev1" width="1280" height="720">${tpl}</Representation><Representation id="3" bandwidth="500000" codecs="hev1" width="854" height="480">${tpl}</Representation></AdaptationSet>
<AdaptationSet contentType="audio"><Representation id="1" bandwidth="128000" codecs="mp4a.40.2">${tpl}</Representation></AdaptationSet></Period></MPD>`);
    fs.writeFileSync(path.join(ASSETS, 'ladder360.mpd'), fs.readFileSync(path.join(ASSETS, 'ladder.mpd'), 'utf8').replace('</AdaptationSet>\n<AdaptationSet contentType="audio">', `<Representation id="4" bandwidth="300000" codecs="hev1" width="640" height="360">${tpl}</Representation></AdaptationSet>\n<AdaptationSet contentType="audio">`));
    fs.writeFileSync(path.join(ASSETS, 'ladder1080.mpd'), fs.readFileSync(path.join(ASSETS, 'ladder.mpd'), 'utf8').split('\n').filter(l => !l.includes('id="2"') && !l.includes('id="3"')).join('\n'));
}

/** local DASH server — serves ASSETS under /dash/..., counts mpd hits, 404 otherwise */
function startServer() {
    let mpdHits = 0;
    const srv = http.createServer((req, res) => {
        const rel = String(req.url || '').split('/dash/')[1] || '';
        const parts = rel.split('/').filter(Boolean);
        const MAP = { 'x/index.mpd': 'index.mpd', 'c/index.mpd': 'counted.mpd', 'l/index.mpd': 'ladder.mpd', 'l3/index.mpd': 'ladder360.mpd', 'l1/index.mpd': 'ladder1080.mpd' };
        const f = parts.length === 2 && parts[1] === 'index.mpd'
            ? path.join(ASSETS, MAP[rel] || '__missing__')
            : path.join(ASSETS, parts[parts.length - 1] || '__missing__');   // segments live flat in ASSETS
        if (f.startsWith(ASSETS) && fs.existsSync(f)) {
            if (f.endsWith('.mpd')) mpdHits++;
            res.writeHead(200, { 'content-type': 'application/octet-stream' });
            res.end(fs.readFileSync(f));
        } else { res.writeHead(404); res.end('nope'); }
    });
    return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, hits: () => mpdHits })));
}

(async () => {
    const mx = require('./moviedex');
    const guard = require('./guard');
    const read = (f) => fs.readFileSync(f, 'utf8');

    // 1) version sync
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    if (man.version !== pkg.version || pkg.version < '2.30.0') throw new Error('version sync wrong: pkg=' + pkg.version + ' manifest=' + man.version);
    console.log('[1] v' + pkg.version + ' sync (manifest === package): OK ✅');

    // 2) moviedex v2.30 exports
    for (const k of ['mergedQualities', 'downloadDash', 'transcode360', 'streamQualities', 'dashDownload']) {
        if (typeof mx[k] !== 'function') throw new Error('moviedex export missing: ' + k);
    }
    console.log('[2] moviedex exports (mergedQualities + downloadDash + transcode360): OK ✅');

    // 3) ★ pacer upload-timeout — hung upload rejects in time AND the chain survives (stuck-99% fix)
    {
        const pace = guard.pacer(10);
        let rel;
        const hang = () => new Promise((r) => { rel = r; });
        const err = await pace(hang, 120).catch((e) => e);
        if (!/upload timeout/i.test(err.message)) throw new Error('pacer timeout did not fire: ' + err.message);
        const t0 = Date.now();
        const next = await pace(async () => 'ok');                       // chain not deadlocked
        if (next !== 'ok' || Date.now() - t0 > 5000) throw new Error('pacer chain deadlocked after timeout');
        rel('late');                                                     // late resolve must NOT crash the process
        const fast = await pace(async () => 'fast', 5000);               // healthy call with timeout still works
        if (fast !== 'fast') throw new Error('pacer timeout broke healthy calls');
    }
    console.log('[3] ★ pacer timeout (hang rejects + chain unblocks + late-resolve safe): OK ✅');

    // 4) bot.js wiring — media timeout + pacer timeout arg; guard carries the timeout impl
    const botSrc = read('bot.js');
    if (!botSrc.includes('ARENA_MEDIA_TIMEOUT')) throw new Error('bot.js missing ARENA_MEDIA_TIMEOUT');
    if (!botSrc.includes("['document', 'video', 'image', 'audio', 'sticker', 'ptt']")) throw new Error('bot.js media detection missing');
    if (!botSrc.includes('sock.sendMessage(jid, content, opts), t)')) throw new Error('bot.js does not pass timeout to pacer');
    if (!read('guard.js').includes('upload timeout')) throw new Error('guard.js pacer timeout impl missing');
    console.log('[4] bot.js media-send timeout wiring (doc/video → pacer timeout): OK ✅');

    // 5) local DASH server + ffmpeg assets + mbPlay MPD-dedupe (duplicate play-info entries → one stream)
    genAssets();
    const { srv, port, hits } = await startServer();
    // MovieBox-style urlprefix: dir AFTER /dash/ (base must keep '/dash/' after trailing-slash strip)
    const sc = (dir) => `Edge-Cache-Cookie=T; urlprefix=${Buffer.from(`http://127.0.0.1:${port}/dash/${dir}`).toString('base64')}:s`;
    const mpdUrl = (dir) => `http://127.0.0.1:${port}/dash/${dir}/index.mpd`;
    const cookie = sc('x');
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ code: 0, data: { streams: [
        { signCookie: cookie, url: 'http://x/a.mp4', resolutions: '1080,720,480', size: 100 },
        { signCookie: cookie, url: 'http://x/b.mp4', resolutions: '1080,720,480', size: 100 },   // same MPD → duplicate
    ] } }) });
    const streams = await mx.mbPlay('sid', 1, 1);
    global.fetch = realFetch;
    if (streams.length !== 1) throw new Error('mbPlay dedupe fail: ' + streams.length + ' streams (want 1)');
    console.log('[5] ★ mbPlay duplicate-MPD dedupe (2 entries → 1 stream): OK ✅');

    // 6) ★ mergedQualities — merged rows + synthetic 360p re-encode row (typical 1080/720/480 ladder)
    const lRows = await mx.mergedQualities([{ signCookie: sc('l') }]);
    const labels = lRows.map(r => r.label);
    if (labels.join(',') !== '1080p,720p,480p,360p') throw new Error('ladder rows wrong: ' + labels.join(','));
    const t360 = lRows.find(r => r.h === 360);
    if (!t360 || !t360.transcode || t360.srcH !== 480 || !t360.dash || !(t360.sizeMB > 0)) throw new Error('synthetic 360p row wrong: ' + JSON.stringify(t360));
    if (t360.sizeMB >= lRows.find(r => r.h === 480).sizeMB) throw new Error('360p est must be smaller than 480p');
    console.log('[6] ★ mergedQualities ladder + synthetic 360p (transcode row, srcH=480, smaller est): OK ✅');

    // 7) native-360 → NO synthetic row · 1080-only → no 360 at all
    const r360 = await mx.mergedQualities([{ signCookie: sc('l3') }]);
    if (r360.filter(r => r.h === 360).length !== 1 || r360.find(r => r.h === 360)?.transcode) throw new Error('native 360 must not get a synthetic twin');
    const r1080 = await mx.mergedQualities([{ signCookie: sc('l1') }]);
    if (r1080.some(r => r.h === 360)) throw new Error('1080-only ladder must not offer 360p (too heavy src)');
    console.log('[7] native 360 kept / 1080-only → no 360 row: OK ✅');

    // 8) ★ dashDownload E2E (counted mode) — honest %, real bytes, clean finish
    const prog = [];
    const res1 = await mx.dashDownload({ mpd: mpdUrl('c'), cookie: 'Edge-Cache-Cookie=T', height: 96, outPath: path.join(TMP, 'e2e.mkv'), onProgress: (p, b) => prog.push([p, b]) });
    if (!(res1.bytes > 100 * 1024)) throw new Error('mux output too small: ' + res1.bytes);
    if (prog[prog.length - 1][0] !== 100) throw new Error('final progress must be 100');
    if (prog.filter(([p]) => p === 99).length !== 1) throw new Error('exactly one post-download 99 expected (drain-mode spam = fake-99 bug)');
    const mid = [...prog];
    while (mid.length && mid[mid.length - 1][0] >= 96) mid.pop();   // trailing 99/100 = post-download milestones
    for (const [p] of mid) if (p > 95) throw new Error('download progress must cap at 95 (got ' + p + ')');   // no fake 99 mid-download
    const rb = prog.map(([, b]) => b);
    const i99 = prog.findIndex(([p]) => p === 99);
    const seg = rb.slice(0, i99);                                     // download-phase bytes must grow
    if (!(rb[i99] > 0) || seg.some((b, i) => i && b < seg[i - 1])) throw new Error('realBytes must grow during download and end > 0');
    if (!(rb[rb.length - 1] > 0)) throw new Error('muxed file bytes missing');   // post-mux size may differ slightly from raw segments
    console.log('[8] ★ dashDownload E2E counted (cap 95 → 100, real growing bytes, mux >100KB): OK ✅');

    // 9) manifest cache — second call with man+mpdTxt does NOT re-fetch the MPD
    const txt = (await (await fetch(mpdUrl('c'))).text());
    const man2 = mx.parseMpd(txt);
    const beforeHits = hits();
    await mx.dashDownload({ mpd: mpdUrl('c'), cookie: 'Edge-Cache-Cookie=T', height: 96, outPath: path.join(TMP, 'e2e2.mkv'), man: man2, mpdTxt: txt });
    if (hits() !== beforeHits) throw new Error('cached man/mpdTxt still re-fetched the MPD');
    console.log('[9] dashDownload manifest cache (no second MPD fetch): OK ✅');

    // 10) ★ transcode360 E2E — real ffmpeg, output is a true 360p mp4
    const tOut = path.join(TMP, 't360.mp4');
    const tBytes = await mx.transcode360(res1.path, tOut, { durSec: 6, onProgress: () => { } });
    if (!(tBytes > 100 * 1024)) throw new Error('transcode output too small: ' + tBytes);
    const h360 = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', tOut]).toString().trim();
    if (h360 !== '360') throw new Error('transcoded height = ' + h360 + ' (want 360)');
    console.log('[10] ★ transcode360 E2E (ffmpeg 360p mp4, ffprobe-verified): OK ✅');

    // 11) ★ downloadDash transcode row — final clean name, raw source cleaned up
    const dlDir = path.join(process.env.DL_TMP, 'mdx-test');
    const dres = await mx.downloadDash({ h: 360, label: '360p', sizeMB: 1, transcode: true, srcH: 96, dash: { mpd: mpdUrl('c'), cookie: 'Edge-Cache-Cookie=T' }, man: man2, mpdTxt: txt }, { tmpDir: dlDir, finalName: 'Show S01E01 [360p].mp4', onProgress: () => { } });
    if (!fs.existsSync(dres.path) || path.basename(dres.path) !== 'Show S01E01 [360p].mp4') throw new Error('downloadDash final name wrong: ' + dres.path);
    if (fs.readdirSync(dlDir).some(f => f.startsWith('src-'))) throw new Error('raw source not cleaned after transcode');
    console.log('[11] ★ downloadDash 360p row (clean final name, raw cleaned): OK ✅');

    // 12) ★ deliverStream E2E — WhatsApp document with CLEAN filename + right mimetype
    const mkSend = () => {
        const sent = [];
        const send = async (jid, content) => { sent.push(content); return { key: { id: 'K' + sent.length } }; };
        return { send, sent };
    };
    {
        const { send, sent } = mkSend();
        const rowsL = await mx.mergedQualities([{ signCookie: sc('c') }]);
        const native = rowsL.find(r => !r.transcode);
        const mkOpts = (extra) => ({ status: { key: { id: 'K0' } }, edit: async (t) => { sent.push({ text: t, __edit: true }); }, ...extra });
        await mx.__deliver(send, 'j', {}, mkOpts({ qrow: native, show: 'Show', season: 1, ep: 1 }));
        const doc = sent.find(c => c.document);
        if (!doc) throw new Error('no document sent');
        if (doc.fileName !== 'Show S01E01 [96p].mkv') throw new Error('dirty filename: ' + doc.fileName);
        if (/-\d{10,}\./.test(doc.fileName)) throw new Error('timestamp junk still in filename');
        if (doc.mimetype !== 'video/x-matroska') throw new Error('mimetype wrong: ' + doc.mimetype);
        const trans = rowsL.find(r => r.transcode);
        const { send: s2, sent: sent2 } = mkSend();
        await mx.__deliver(s2, 'j', {}, { qrow: trans, status: { key: { id: 'K0' } }, edit: async (t) => { sent2.push({ text: t, __edit: true }); }, show: 'Show', season: 1, ep: 1 });
        const doc2 = sent2.find(c => c.document);
        if (!doc2 || doc2.fileName !== 'Show S01E01 [360p].mp4' || doc2.mimetype !== 'video/mp4') throw new Error('360p delivery wrong: ' + JSON.stringify(doc2 || {}));
        if (!String(doc2.caption || '').includes('360p')) throw new Error('caption lost 360p label');
    }
    console.log('[12] ★ deliverStream E2E (clean names, mkv/mp4 mimetypes, 360p caption): OK ✅');

    // 13) watchdog + old dirty-name pattern gone + manifest hygiene
    const mvSrc = read('moviedex.js');
    if (!mvSrc.includes('CDN stall')) throw new Error('stall watchdog missing');
    if (!mvSrc.includes("'-vf', 'scale=-2:360'")) throw new Error('360p scale arg missing');
    if (/\+\s*'-'\s*\+\s*Date\.now\(\)\s*\+\s*'\.mkv'/.test(mvSrc)) throw new Error('old dirty -<ts>.mkv naming still present');
    if (!man.files.includes('test_v230.js') || !man.files.includes('moviedex.js') || !man.files.includes('guard.js')) throw new Error('manifest files[] incomplete');
    if (!man.removed.includes('test_v229.js') || fs.existsSync('test_v229.js')) throw new Error('test_v229 not retired');
    if (!/360p/.test(man.notes)) throw new Error('manifest notes missing 360p');
    for (const f of man.files) if (f.endsWith('.js')) execSync(`node --check ${JSON.stringify(f)}`);
    require('./guard'); require('./style');
    console.log('[13] watchdog + dirty-name gone + manifest + node --check all: OK ✅');

    srv.close();
    console.log('\n🎉 ALL v2.30.0 TESTS PASSED');
})().catch((e) => { console.error('💩 ' + (e.stack || e.message)); failed = true; })
    .finally(() => {
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { }
        process.exit(failed ? 1 : 0);
    });
