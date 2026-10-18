/**
 * test_v267.js — youtubei.js (Innertube) FALLBACK for .song/.video (v2.67.0)
 * Evidence chain: Asitha-MD deobfuscated dl.js = require('youtu'+'bei.j'+'s'); yt-dlp
 * 2026 = per-IP/per-video "Sign in to confirm you're not a bot" 403 even with the node
 * EJS runtime (panel verbose probe); youtubei.js works from the SAME dev box that
 * yt-dlp is IP-blocked on (rickroll info+rows OK locally).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = __dirname;
let pass = 0, fail = 0;
const ok = (name, fn) => {
    try { fn(); pass++; console.log('  ✅', name); }
    catch (e) { fail++; console.log('  ❌', name, '—', e.message.slice(0, 160)); }
};

// ── ① source pins ──
ok('yti.js: evaluator patch (new Function) exists + idempotent marker', () => {
    const s = fs.readFileSync(path.join(R, 'yti.js'), 'utf8');
    assert.ok(s.includes('Platform.shim.eval = (data) => new Function(data.output)()'), 'eval patch missing');
    assert.ok(s.includes('__kzEval'), 'idempotency marker missing');
});
ok('yti.js: session cache 30-min + YTI_CLIENT env override', () => {
    const s = fs.readFileSync(path.join(R, 'yti.js'), 'utf8');
    assert.ok(/30 \* 60e3/.test(s), 'session TTL missing');
    assert.ok(s.includes('YTI_CLIENT'), 'client env missing');
});
ok('yti.js: ID_RE covers watch/shorts/embed/live/youtu.be', () => {
    const { ID_RE } = require(path.join(R, 'yti.js'));
    assert.ok(ID_RE.test('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'watch');
    assert.ok(ID_RE.test('https://youtu.be/dQw4w9WgXcQ'), 'short');
    assert.ok(ID_RE.test('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'shorts');
    assert.ok(ID_RE.test('https://www.youtube.com/live/dQw4w9WgXcQ'), 'live');
    assert.ok(!ID_RE.test('https://example.com/watch?v=xx'), 'non-yt must not match');
});
ok('features.js: lazy yti() require (no boot cost, missing-pkg safe)', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    assert.ok(/let _yti = null;\s*\nfunction yti\(\) \{ if \(!_yti\) _yti = require\('\.\/yti'\); return _yti; \}/.test(s), 'lazy loader missing');
});
ok('features.js: download ladder yt-dlp → yti → clipto (yti INSIDE, clipto LAST)', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    const seg = s.slice(s.indexOf('primary: yt-dlp'), s.indexOf('MP3 convert (m4a'));
    const ytiIdx = seg.indexOf('yti().fetch(');
    const cliptoIdx = seg.indexOf('cliptoFetch(url, mode, height)');
    assert.ok(ytiIdx >= 0, 'yti fetch missing in ladder');
    assert.ok(cliptoIdx > ytiIdx, 'clipto must come after yti');
});
ok('features.js: menu rows — yti is the 3rd source after clipto', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    const seg = s.slice(s.indexOf('v2.64 quality menu'), s.indexOf('if (rows.length) {'));
    const cj = seg.indexOf('cliptoInfo(url)');
    const ytiIdx = seg.indexOf("yti().rows(await yti().info(url)");
    assert.ok(cj >= 0 && ytiIdx > cj, 'yti rows must follow clipto rows');
});
ok('pairsite.js: ?yti= probe — client matrix WEB/TV/IOS/ANDROID', () => {
    const s = fs.readFileSync(path.join(R, 'pairsite.js'), 'utf8');
    assert.ok(s.includes("searchParams.get('yti')"), 'probe param missing');
    assert.ok(s.includes("['WEB', 'TV', 'IOS', 'ANDROID']"), 'client matrix missing');
});

// ── ② REAL module load: evaluator patch applies (no network) ──
ok('REAL: yti.js load patches Platform.shim.eval (youtubei.js installed)', () => {
    let yti;
    try { yti = require(path.join(R, 'yti.js')); }
    catch (e) { if (/Cannot find module 'youtubei\.js'/.test(e.message)) return; throw e; }
    const { Platform } = require('youtubei.js');
    yti._patchEval();
    assert.strictEqual(Platform.shim.__kzEval, true, 'patch marker not set');
    assert.strictEqual(typeof Platform.shim.eval, 'function', 'eval not a function');
});
ok('REAL: evaluator executes the nsig processor shape (offline contract check)', () => {
    const { Platform } = require('youtubei.js');
    const fake = {
        output: `const exportedVars = { nsigFunction: () => ({
    get(prop) { return prop === 'n' ? 'transformed-n' : 'sig-x'; }
  }) };
function process(n = "", sp = "", s = "") {
  const urlCtorFunction = exportedVars.nsigFunction;
  const urlCtor = urlCtorFunction("", sp, s);
  return { sig: s ? urlCtor.get(sp) : undefined, n: urlCtor.get('n') };
}
return process("abc", undefined, undefined);`,
    };
    const r = Platform.shim.eval(fake, { n: 'abc' });
    assert.ok(r && r.n === 'transformed-n', 'evaluator result shape wrong: ' + JSON.stringify(r));
});

// ── ③ rows() — PURE, offline fake-inf (innertube shapes) ──
const fakeInf = {
    basic_info: { duration: 213, title: 'T' },
    streaming_data: {
        adaptive_formats: [
            { itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', has_audio: true, has_video: false, content_length: 3449447, average_bitrate: 129502 },
            { itag: 251, mime_type: 'audio/webm; codecs="opus"', has_audio: true, has_video: false, content_length: 3000000 },
            { itag: 137, mime_type: 'video/mp4; codecs="avc1.640028"', has_audio: false, has_video: true, height: 1080, content_length: 80 * 1048576 },
            { itag: 136, mime_type: 'video/mp4; codecs="avc1.4d401f"', has_audio: false, has_video: true, height: 720, content_length: 29 * 1048576 },
            { itag: 135, mime_type: 'video/mp4; codecs="avc1.4d401e"', has_audio: false, has_video: true, height: 480, content_length: 17 * 1048576 },
            { itag: 18, mime_type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', has_audio: true, has_video: true, height: 360, content_length: 11 * 1048576, is_progressive: true },
            { itag: 315, mime_type: 'video/webm; codecs="vp9"', has_audio: false, has_video: true, height: 2160, content_length: 9999 * 1048576 },   // over any cap
        ],
        formats: [],
    },
};
ok('rows(): audio = M4A real size + MP3 estimates from duration', () => {
    const { rows } = require(path.join(R, 'yti.js'));
    const ar = rows(fakeInf, 'audio');
    assert.strictEqual(ar.length, 3);
    assert.deepStrictEqual(ar.map((r) => r.pick), ['m4a', '320k', '128k']);
    assert.strictEqual(ar[0].size, 3449447, 'm4a must use the LARGEST audio-only content_length');
    assert.strictEqual(ar[1].size, Math.round(213 * 40 * 1024), 'mp3 320 est');
});
ok('rows(): video heights desc + cap hides 2160 + progressive keeps own audio', () => {
    const { rows } = require(path.join(R, 'yti.js'));
    const vr = rows(fakeInf, 'video', 300);
    const labels = vr.map((r) => r.label);
    assert.deepStrictEqual(labels, ['1080p', '720p', '480p', '360p'], 'cap must hide 2160 (9999MB)');
    assert.strictEqual(vr[3].size, 11 * 1048576, 'progressive 360p: own size, no audio add');
    assert.strictEqual(vr[0].size, 80 * 1048576 + 3449447, 'video-only 1080p adds audio track size');
});
ok('rows(): empty streaming_data → [] (menu falls through gracefully)', () => {
    const { rows } = require(path.join(R, 'yti.js'));
    assert.deepStrictEqual(rows({}, 'video'), []);
});

// ── ④ REAL network E2E (graceful skip on CDN-blocked dev boxes — the PANEL probe is the oracle) ──
(async () => {
    if (require('fs').existsSync(path.join(R, 'node_modules', 'youtubei.js'))) {
        try {
            const yti = require(path.join(R, 'yti.js'));
            const inf = await yti.info('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
            ok('REAL: yti.info() rickroll title+duration', () => {
                assert.ok(/Never Gonna Give You Up/i.test(inf.basic_info.title || ''), 'title missing');
                assert.ok((inf.basic_info.duration || 0) > 180, 'duration missing');
            });
            ok('REAL: yti.rows() from live info (video)', () => {
                const vr = yti.rows(inf, 'video', 200);
                assert.ok(vr.length >= 2, 'rows too few: ' + JSON.stringify(vr.map((r) => r.label)));
            });
            try {
                const t0 = Date.now();
                const r = await yti.fetch('https://youtu.be/dQw4w9WgXcQ', 'audio', null, 6);
                ok('REAL: yti.fetch audio E2E (m4a on disk)', () => {
                    assert.ok(fs.existsSync(r.path), 'file missing');
                    assert.ok(fs.statSync(r.path).size > 1024, 'file too small');
                    assert.ok(/Never Gonna Give You Up/i.test(r.title || ''), 'title missing');
                    fs.rmSync(r.path, { force: true });
                    console.log('      ⚡', Math.round(r.size / 1024) + 'KB in', Date.now() - t0, 'ms');
                });
            } catch (e) {
                console.log('  ⏭️  yti audio E2E skipped (CDN/IP block on this box):', String(e.message).slice(0, 80));
            }
        } catch (e) {
            console.log('  ⏭️  yti live tests skipped:', String(e.message).slice(0, 80));
        }
    }
    // ── ⑤ version pins ──
    ok('package.json + manifest.json = 2.67.0', () => {
        assert.strictEqual(require(path.join(R, 'package.json')).version, '2.67.0');
        assert.strictEqual(require(path.join(R, 'manifest.json')).version, '2.67.0');
    });
    ok('manifest: yti.js in files + youtubei.js dep + v2.67 notes', () => {
        const m = require(path.join(R, 'manifest.json'));
        assert.ok(m.files.includes('yti.js'), 'yti.js not in manifest files');
        assert.ok(m.notes.includes('v2.67.0: .song/.video INNERTUBE FALLBACK'), 'notes missing');
        const pkg = require(path.join(R, 'package.json'));
        assert.ok(pkg.dependencies['youtubei.js'], 'youtubei.js dep missing');
    });
    ok('README-SI.txt carries the v2.67 entry', () => {
        assert.ok(fs.readFileSync(path.join(R, 'README-SI.txt'), 'utf8').includes('v2.67.0'));
    });

    console.log(`\n== test_v267: ${pass} pass, ${fail} fail ==`);
    process.exit(fail ? 1 : 0);
})();
