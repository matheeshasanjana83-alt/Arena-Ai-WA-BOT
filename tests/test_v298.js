/**
 * test_v298.js — 🎙️ VOICE NOTE STT FIX (user: 'මෙ voice අහන්න බැනෙ' — screenshot: two voice notes
 * → '❌ Pollinations stt 400 {"error":{"message":"extension \\"bin\\" not supported"}}' twice).
 * ROOT CAUSE: pollinations.js sttText() hardcoded multipart filename 'audio.bin' → Pollinations
 * whisper endpoint validates file EXTENSION → rejects .bin → EVERY WhatsApp voice note
 * (audio/ogg; codecs=opus) + every .stt/.totext call 400'd. Transcript→AI path never ran.
 * Tested here (ALL OFFLINE — fetch mocked, FormData captured):
 *  (1) ext mapping: WhatsApp-exact 'audio/ogg; codecs=opus'→audio.ogg · mpeg→mp3 · mp4→mp4 ·
 *      aac→m4a · x-m4a→m4a · webm→webm · video/mp4→mp4 · octet-stream→ogg fallback · ''→ogg fallback
 *  (2) Blob type params stripped (no '; codecs=…' leak into content-type) + model forwarded
 *  (3) 400 → honest throw 'Pollinations stt 400' (never silent)
 *  (4) markers: no 'audio.bin' anywhere · STT_EXT map present · bot.js audio branch + tools.js
 *      cmdStt call-sites unchanged (single fix covers both)
 *  (5) pins 2.97.0 pkg+manifest + notes headline + manifest lists tests/test_v298.js
 */
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = require('../package.json');
const manifest = require('../manifest.json');
const P = require('../pollinations');
const polliSrc = fs.readFileSync(__dirname + '/../pollinations.js', 'utf8');
const botSrc = fs.readFileSync(__dirname + '/../bot.js', 'utf8');
const toolsSrc = fs.readFileSync(__dirname + '/../tools.js', 'utf8');

const realFetch = globalThis.fetch;
let captured = null, respond = null;
function mockFetch(url, opts) {
    assert.ok(String(url).includes('/v1/audio/transcriptions'), 'transcriptions endpoint');
    captured = opts.body;   // FormData instance
    return Promise.resolve(respond());
}

(async () => {
    console.log('— v2.97.0 pins + markers —');
    ok('version 2.97.0 pkg+manifest + notes headline + manifest lists test_v298.js', () => {
        assert.strictEqual(pkg.version, '2.97.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '2.97.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('VOICE NOTE STT FIX'), 'notes headline');
        assert.ok(manifest.files.includes('tests/test_v298.js'), 'manifest lists test_v298.js');
    });
    ok('source markers: STT_EXT map present · audio.bin GONE · bot.js+tools.js call-sites unchanged', () => {
        assert.ok(polliSrc.includes('STT_EXT'), 'STT_EXT map');
        assert.ok(!polliSrc.includes("'audio.bin'"), 'audio.bin filename gone');
        assert.ok(polliSrc.includes("'audio.' + ext"), 'derived filename');
        assert.ok(botSrc.includes("sttText(buf, mime || 'audio/ogg')"), 'bot.js aiMediaReply audio branch intact');
        assert.ok(toolsSrc.includes('sttText(buf, mime)'), 'tools.js cmdStt intact');
    });

    console.log('— 🎙️ mime → whisper extension mapping (FormData captured) —');
    await okA('WhatsApp-exact voice note: audio/ogg; codecs=opus → audio.ogg + clean blob type', async () => {
        globalThis.fetch = mockFetch;
        respond = () => ({ ok: true, status: 200, json: async () => ({ text: 'ok transcript' }) });
        try {
            const t = await P.sttText(Buffer.alloc(1000, 1), 'audio/ogg; codecs=opus');
            assert.strictEqual(t, 'ok transcript', 'transcript passthrough');
            const f = captured.get('file');
            assert.strictEqual(f.name, 'audio.ogg', 'filename audio.ogg — was audio.bin (the 400 bug)');
            assert.strictEqual(f.type, 'audio/ogg', 'blob type params stripped: ' + f.type);
            assert.strictEqual(captured.get('model'), 'whisper-large-v3', 'model forwarded');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('mapping table: mpeg→mp3 · mp3→mp3 · audio/mp4→mp4 · video/mp4→mp4 · aac→m4a · x-m4a→m4a · webm→webm · flac→flac', async () => {
        globalThis.fetch = mockFetch;
        respond = () => ({ ok: true, status: 200, json: async () => ({ text: 'x' }) });
        const cases = [
            ['audio/mpeg', 'audio.mp3'], ['audio/mp3', 'audio.mp3'],
            ['audio/mp4', 'audio.mp4'], ['video/mp4', 'audio.mp4'],
            ['audio/aac', 'audio.m4a'], ['audio/x-m4a', 'audio.m4a'],
            ['audio/webm', 'audio.webm'], ['audio/flac', 'audio.flac'],
            ['application/ogg', 'audio.ogg'],
        ];
        try {
            for (const [mime, want] of cases) {
                await P.sttText(Buffer.alloc(500, 2), mime);
                assert.strictEqual(captured.get('file').name, want, mime + ' → ' + want);
            }
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('garbage/empty mime → ogg fallback (WhatsApp dominant) — never .bin again', async () => {
        globalThis.fetch = mockFetch;
        respond = () => ({ ok: true, status: 200, json: async () => ({ text: 'x' }) });
        try {
            await P.sttText(Buffer.alloc(500, 3), 'application/octet-stream');
            assert.strictEqual(captured.get('file').name, 'audio.ogg', 'octet-stream fallback');
            await P.sttText(Buffer.alloc(500, 4), '');
            assert.strictEqual(captured.get('file').name, 'audio.ogg', 'empty mime fallback');
            await P.sttText(Buffer.alloc(500, 5));
            assert.strictEqual(captured.get('file').name, 'audio.ogg', 'default param fallback');
        } finally { globalThis.fetch = realFetch; }
    });

    console.log('— honest failure —');
    await okA('API 400 (extension rejected) → throw with status + server message, never silent', async () => {
        globalThis.fetch = mockFetch;
        respond = () => ({ ok: false, status: 400, text: async () => JSON.stringify({ success: false, error: { message: 'extension "bin" not supported' } }) });
        try {
            await assert.rejects(
                () => P.sttText(Buffer.alloc(500, 6), 'audio/ogg'),
                (e) => /Pollinations stt 400/.test(e.message) && /extension/.test(e.message),
                'expected Pollinations stt 400 throw'
            );
        } finally { globalThis.fetch = realFetch; }
    });

    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
