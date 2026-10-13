'use strict';
/* test_v237 — MovieDex download SPEED (v2.37.0)
 *  ① source: parallel A/V grabs · workers 8/6 · async mux (no execFileSync call)
 *  ② E2E: local HTTP "CDN" serves MPD + init + chunks (video 5 / audio 5) → dashDownload()
 *     with a FAKE ffmpeg binary (POSIX sh — copies first -i input to output):
 *       - both tracks downloaded (server sees video AND audio requests)
 *       - audio request starts BEFORE video finishes (true parallel)
 *       - concurrent requests peak > 1 (parallel workers live)
 *       - ordered append: output bytes = init + chunk1..5 in ORDER (markers V1..V5)
 *       - progress: onProgress fires with rising pct, ends 99 → 100
 *       - async mux: event-loop timer answers DURING a 600 ms fake mux
 *  ③ parseMpd / chunkCount / expandTpl / dashFrom regressions
 *  ④ antibug.selfTest() still green
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const RESULTS = [];
const ok = (name, cond, extra) => { RESULTS.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

/* POSIX sh (panel uses dash — no ${@: -1} bashism). Copies FIRST -i input → LAST arg.
 * @SLEEP@ → injected delay (used for the async-mux event-loop proof). */
const POSIX_FF = '#!/bin/sh\nprev=""; src=""; out=""; for a in "$@"; do if [ "$prev" = "-i" ] && [ -z "$src" ]; then src="$a"; fi; out="$a"; prev="$a"; done; @SLEEP@cp "$src" "$out"\n';

(async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    ok('version 2.40.0 (package.json)', pkg.version === '2.40.0');
    ok('version 2.40.0 (manifest.json)', man.version === '2.40.0');

    // ── ① source checks ──
    const src = fs.readFileSync(path.join(__dirname, 'moviedex.js'), 'utf8');
    ok('parallel A/V: Promise.all grabs', /await Promise\.all\(\[\s*\n\s*grab\('v'/.test(src));
    ok('parallel A/V: audio optional arm', /audio \? grab\('a', audio\.seg/.test(src));
    ok('workers: video 8 / audio 6', /length: kind === 'v' \? 8 : 6/.test(src));
    ok('mux async: execFile used', src.includes("const { execFile } = require('child_process')"));
    ok('mux async: no execFileSync CALL left', !/\bexecFileSync\s*\(/.test(src));
    ok('mux async: await runFF', /await runFF\(args\)/.test(src) && /await runFF\(\['-y'/.test(src));
    ok('old sequential grab gone', !src.includes("await grab('a', audio.seg, audio.id, counts.a, aFile);\n    }"));

    const mdx = require('./moviedex.js');
    ok('exports intact (+ chunkCount/expandTpl)', ['dashDownload', 'parseMpd', 'chunkCount', 'expandTpl', 'mergedQualities', 'downloadDash', '_sessions'].every(k => k in mdx));

    // ── ② E2E: local CDN + fake ffmpeg ──
    const CHUNK = 30 * 1024;
    const mk = (tag) => Buffer.concat([Buffer.from(tag), Buffer.alloc(CHUNK - tag.length, 0x61)]);
    const V_INIT = mk('V-INIT'), A_INIT = mk('A-INIT');
    const VCH = Array.from({ length: 5 }, (_, i) => mk('V' + (i + 1)));
    const ACH = Array.from({ length: 5 }, (_, i) => mk('A' + (i + 1)));
    const hits = { v_init: 0, a_init: 0, v: [], a: [] };
    let active = 0, peak = 0;
    let firstAudioAt = Infinity, videoDoneAt = 0;
    const t0 = Date.now();

    const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD mediaPresentationDuration="PT20S" xmlns="urn:mpeg:dash:schema:mpd:2011">
 <Period><AdaptationSet contentType="video">
  <SegmentTemplate media="chunk-stream$RepresentationID$-$Number$.m4s" initialization="init-stream$RepresentationID$.m4s" duration="4" timescale="1" startNumber="1"/>
  <Representation id="v0" bandwidth="1000000" width="1280" height="720"/><Representation id="v1" bandwidth="600000" width="640" height="360"/>
 </AdaptationSet><AdaptationSet contentType="audio">
  <SegmentTemplate media="chunk-stream$RepresentationID$-$Number$.m4s" initialization="init-stream$RepresentationID$.m4s" duration="4" timescale="1" startNumber="1"/>
  <Representation id="a0" bandwidth="128000"/>
 </AdaptationSet></Period></MPD>`;

    const srv = http.createServer((req, res) => {
        active++; peak = Math.max(peak, active);
        const p = req.url.split('?')[0];
        const m = p.match(/^\/chunk-stream(v|a)0-(\d+)\.m4s$/);
        let buf = null;
        if (p === '/index.mpd') buf = Buffer.from(MPD);
        else if (p === '/init-streamv0.m4s') { hits.v_init++; buf = V_INIT; }
        else if (p === '/init-streama0.m4s') { hits.a_init++; buf = A_INIT; }
        else if (m) {
            const tr = m[1], n = +m[2];
            if (tr === 'a') { hits.a.push(n); firstAudioAt = Math.min(firstAudioAt, Date.now()); }
            else hits.v.push(n);
            buf = (tr === 'a' ? ACH : VCH)[n - 1] || null;
            if (!buf) { active--; res.writeHead(404); res.end(); return; }   // beyond last chunk (drain probe)
        }
        setTimeout(() => {   // small latency → overlap visible
            try { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(buf || Buffer.alloc(0)); } catch { }
            active--;
            if (m && m[1] === 'v' && hits.v.length >= 5) videoDoneAt = Math.max(videoDoneAt, Date.now());
        }, 25);
    });
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${srv.address().port}`;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v237-'));
    const media = require('./media');
    const realGetBin = media.getBin;

    const pcts = [];
    const outPath = path.join(tmp, 'Show S01E02 [720p].mkv');
    try {
        const fakeFF = path.join(tmp, 'ffmpeg');
        fs.writeFileSync(fakeFF, POSIX_FF.replace('@SLEEP@', ''));
        fs.chmodSync(fakeFF, 0o755);
        media.getBin = async () => fakeFF;   // dashDownload does require('./media').getBin at call time → patchable

        const res = await mdx.dashDownload({
            mpd: base + '/index.mpd', cookie: '', height: 720, outPath,
            onProgress: (p) => pcts.push(p),
        });
        ok('download ok → muxed file returned', !!res && res.path === outPath && res.bytes > 0, res ? res.bytes + 'B' : 'null');
        const got = fs.readFileSync(res.path);   // fake ffmpeg copied the FIRST -i (video track)
        ok('ordered append: starts with V-INIT', got.slice(0, 6).toString() === 'V-INIT');
        const order = [];
        for (let i = 0; i * CHUNK < got.length; i++) order.push(got.slice(i * CHUNK, i * CHUNK + 2).toString());
        ok('ordered append: V-INIT, V1..V5 in order', JSON.stringify(order) === JSON.stringify(['V-', 'V1', 'V2', 'V3', 'V4', 'V5']), order.join(','));
        ok('video chunks all fetched ×1', hits.v.length === 5 && new Set(hits.v).size === 5, hits.v.slice().sort((a, b) => a - b).join(','));
        ok('audio fetched: 5 chunks + init ×1', hits.a.length === 5 && hits.a_init === 1 && hits.v_init === 1);
        ok('TRUE parallel: audio started before video finished', firstAudioAt < videoDoneAt, `audio@+${firstAudioAt - t0}ms < videoDone@+${videoDoneAt - t0}ms`);
        ok('parallel workers: peak concurrent > 1', peak > 1, 'peak=' + peak);
        ok('progress: rising + 99→100', pcts.length >= 2 && pcts[0] > 0 && pcts.includes(99) && pcts[pcts.length - 1] === 100, '[' + pcts.join(',') + ']');

        // async mux proof — 600 ms fake mux while an event-loop timer waits at 150 ms
        const slowFF = path.join(tmp, 'ffmpeg-slow');
        fs.writeFileSync(slowFF, POSIX_FF.replace('@SLEEP@', 'sleep 0.6; '));
        fs.chmodSync(slowFF, 0o755);
        media.getBin = async () => slowFF;
        const out2 = path.join(tmp, 'slow.mkv');
        let answered = false;
        const t = setTimeout(() => { answered = true; }, 150);
        await mdx.dashDownload({ mpd: base + '/index.mpd', cookie: '', height: 720, outPath: out2 });
        clearTimeout(t);
        ok('mux async: event loop answered during 600ms mux', answered);
    } catch (e) {
        ok('E2E dashDownload run', false, e.message);
    }
    media.getBin = realGetBin;
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    // ── ③ parser regressions ──
    const man2 = mdx.parseMpd(MPD);
    ok('parseMpd: 2 video reps sorted 720→360', man2.video.length === 2 && man2.video[0].h === 720 && man2.video[1].h === 360);
    ok('parseMpd: audio rep picked (best bw)', man2.audio && man2.audio.id === 'a0' && man2.audio.bw === 128000);
    ok('parseMpd: durSec=20', man2.durSec === 20);
    ok('chunkCount: 20s/4s → 5', mdx.chunkCount(man2.video[0].seg, 20) === 5);
    ok('expandTpl: $RepresentationID$+$Number$', mdx.expandTpl('chunk-stream$RepresentationID$-$Number$.m4s', 'v0', 3) === 'chunk-streamv0-3.m4s');
    ok('expandTpl: padded $Number%05d$', mdx.expandTpl('c-$Number%05d$.m4s', 'x', 7) === 'c-00007.m4s');
    const sc = 'path=/dash/live; urlprefix=' + Buffer.from(base + '/dash/live/xyz*').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const d = mdx.dashFrom('k=v; ' + sc + '; other=1');
    ok('dashFrom: signCookie → mpd + cookie', !!d && d.mpd === base + '/dash/live/xyz/index.mpd' && d.cookie.startsWith('k=v; path=/dash/live') && d.cookie.includes('urlprefix=') && d.cookie.endsWith('other=1'), d && d.mpd);

    // ── ④ antibug regression ──
    try {
        const ab = require('./antibug.js');
        const r = ab.selfTest ? ab.selfTest() : null;
        if (r) {
            const good = (r.match(/✅/g) || []).length, bad = (r.match(/❌/g) || []).length;
            ok('antibug selfTest', bad === 0 && good >= 40, `${good}✅/${bad}❌`);
        } else ok('antibug selfTest (n/a)', true);
    } catch (e) { ok('antibug selfTest', false, e.message); }

    const P = RESULTS.filter(Boolean).length, F = RESULTS.length - P;
    console.log(`\n═══ test_v237: ${P}✅ / ${F}❌ ═══`);
    process.exit(F ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
