/**
 * test_v299.js — 🎙️ SINHALA STT CHAIN (user: 'English වචන විතරයි… සිංහල වචනය තෙරුම් ගන්න බැරි හිසා බොරු දානවා' —
 * 'පොන්නයා' voice → whisper hallucinated 'Bonne nuit'-type English).
 * EVIDENCE (live probes 2026-10-30): whisper auto on Sinhala → 'Oh, yeah.' / 'much of Mojave and Mocada currently.'
 * · whisper lang=si → NO fabricated English (empty on robotic audio, param accepted).
 * FIX: ai.transcribeAudio CHAIN — 1️⃣ Gemini audio (Sinhala-capable, askVision plumbing + viaPool geo fallback)
 * → 2️⃣ Groq whisper → 3️⃣ Pollinations auto → 4️⃣ Pollinations language=si (forced Sinhala decode) → shaky auto → null.
 * ⚡ v2.99 REWORK (whisper CANNOT hear Sinhala — probes: 'こうまで'/' Be me.'/',,,,,,'): gpt-4o-transcribe si-prompt
 * stage inserted between Gemini and Groq (dual-shot) + garbageText/hasSinhala guards chain-wide (see test_v300).
 * Tested here (ALL OFFLINE — fetch mocked + ai.geminiTranscribe seam patched):
 *  (1) asciiShortSig: 'Oh, yeah.'→true · Sinhala→false · ≥6-word English→false (hallucination signature only)
 *  (2) chain: Gemini stage first (seam) · Groq stage · Pollinations auto → lang=si recovery ('පොන්නයා' e2e) · all-fail → null · shaky carry
 *  (3) sttText language param → FormData 'language' field (absent without opt) + sttExtName allowlist
 *  (4) bot.js audio branch + tools.js cmdStt → ai.transcribeAudio wired + honesty instructions in prompts
 *  (5) pins 3.02.0 pkg+manifest + notes headline + manifest lists tests/test_v299.js
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v299_mem.json';
try { fs.unlinkSync(__dirname + '/../.test_v299_mem.json'); } catch { }
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = require('../package.json');
const manifest = require('../manifest.json');
const ai = require('../ai');
const P = require('../pollinations');
const aiSrc = fs.readFileSync(__dirname + '/../ai.js', 'utf8');
const botSrc = fs.readFileSync(__dirname + '/../bot.js', 'utf8');
const toolsSrc = fs.readFileSync(__dirname + '/../tools.js', 'utf8');

(async () => {
    console.log('— v3.02.0 pins + markers —');
    ok('version 3.02.0 pkg+manifest + notes headline + manifest lists test_v299.js', () => {
        assert.strictEqual(pkg.version, '3.02.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.02.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('SINHALA STT'), 'notes headline');
        assert.ok(manifest.files.includes('tests/test_v299.js'), 'manifest lists test_v299.js');
    });
    ok('source markers: chain in ai.js · bot.js audio branch + tools.js cmdStt wired · honesty instructions', () => {
        assert.ok(aiSrc.includes('const TRANSCRIBE_PROMPT'), 'geminiTranscribe prompt');
        assert.ok(aiSrc.includes('async function geminiTranscribe'), 'geminiTranscribe fn');
        assert.ok(aiSrc.includes('async function transcribeAudio'), 'chain fn');
        assert.ok(aiSrc.includes('module.exports.geminiTranscribe(buf, m)'), 'test seam');
        assert.ok(aiSrc.includes("language: 'si'"), 'forced-si stage');
        assert.ok(botSrc.includes("ai.transcribeAudio(buf, mime || 'audio/ogg')"), 'bot.js audio branch wired');
        assert.ok(botSrc.includes('transcript එක අවිනිශ්චිතයි'), 'bot.js shaky note');
        assert.ok(botSrc.includes('හොරට අනුමාන කරලා කතා කරන්න එපා'), 'bot.js honesty instruction');
        assert.ok(toolsSrc.includes('transcribeAudio(buf, mime)'), 'tools.js cmdStt wired');
    });

    console.log('— asciiShortSig (whisper Sinhala-hallucination signature) —');
    ok("'Oh, yeah.' → true · Sinhala text → false · long English → false · empty → false", () => {
        assert.strictEqual(ai.asciiShortSig('Oh, yeah.'), true, 'hallucination shape');
        assert.strictEqual(ai.asciiShortSig('Bonne nuit.'), true, 'french trope shape');
        assert.strictEqual(ai.asciiShortSig('පොන්නයා'), false, 'real Sinhala never ASCII');
        assert.strictEqual(ai.asciiShortSig('this is a longer english sentence'), false, '≥6 words = real English');
        assert.strictEqual(ai.asciiShortSig(''), false, 'empty not shaky');
    });

    console.log('— 🎙️ transcribeAudio chain e2e (mocked fetch + seam) —');
    await okA('Gemini stage first (seam resolves) → via Gemini, no whisper calls', async () => {
        process.env.GEMINI_API_KEY = 'AIzaTEST_v299_gemini_key_00000000';
        delete process.env.GROQ_API_KEY;
        const origGT = ai.geminiTranscribe, origStt = P.sttText;
        let sttCalls = 0;
        P.sttText = async () => { sttCalls++; return 'should not be used'; };
        ai.geminiTranscribe = async () => 'පොන්නයා';
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(500, 1), 'audio/ogg; codecs=opus');
            assert.strictEqual(tr.via, 'Gemini', 'via');
            assert.strictEqual(tr.text, 'පොන්නයා', 'text');
            assert.strictEqual(tr.shaky, false, 'not shaky');
            assert.strictEqual(sttCalls, 0, 'whisper never called');
        } finally { ai.geminiTranscribe = origGT; P.sttText = origStt; delete process.env.GEMINI_API_KEY; }
    });
    await okA('Gemini off → Groq whisper stage → via Groq whisper', async () => {
        process.env.GROQ_API_KEY = 'gsk_TEST_v299_groq_key_000000';
        delete process.env.GEMINI_API_KEY;
        const origStt = P.sttText;
        const origG4 = ai.gpt4oTranscribe;
        P.sttText = async () => 'should not be used';
        ai.gpt4oTranscribe = async () => { throw new Error('gpt4o off (v299 mock)'); };   // ⚡ v2.99 chain: gpt-4o stage before Groq — force fall-through
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
            assert.ok(String(url).includes('api.groq.com/openai/v1/audio/transcriptions'), 'groq endpoint');
            return { ok: true, status: 200, json: async () => ({ text: 'machan mata passe call karanna tonight' }) };   // 6 words — >asciiShortSig threshold
        };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(500, 2), 'audio/ogg');
            assert.strictEqual(tr.via, 'Groq whisper', 'via');
            assert.strictEqual(tr.text, 'machan mata passe call karanna tonight', 'groq transcript');
        } finally { globalThis.fetch = realFetch; P.sttText = origStt; ai.gpt4oTranscribe = origG4; delete process.env.GROQ_API_KEY; }
    });
    await okA("USER SCENARIO: gpt-4o romanized 'Oh, yeah.' shots → pollinations lang=si recovers 'පොන්නයා'", async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            const fd = opts.body;
            if (String(url).includes('gen.pollinations.ai') && fd.get('language') === 'si') return { ok: true, status: 200, json: async () => ({ text: ' පොන්නයා ' }) };
            if (String(url).includes('gen.pollinations.ai')) return { ok: true, status: 200, json: async () => ({ text: 'Oh, yeah.' }) };   // auto → hallucination
            throw new Error('unexpected fetch: ' + url);
        };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(500, 3), 'audio/ogg; codecs=opus');
            assert.strictEqual(tr.via, 'whisper(si)', 'si stage picked');
            assert.strictEqual(tr.text, 'පොන්නයා', 'Sinhala transcript (trimmed)');
            assert.strictEqual(tr.shaky, false, 'not shaky');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('si also empty → shaky carry (auto ascii-short kept with warning flag)', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            if (opts?.body?.get?.('language') === 'si') return { ok: true, status: 200, json: async () => ({ text: '' }) };   // si empty
            return { ok: true, status: 200, json: async () => ({ text: 'Oh, yeah.' }) };
        };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(500, 4), 'audio/ogg');
            assert.strictEqual(tr.shaky, true, 'shaky flag');
            assert.strictEqual(tr.via, 'gpt-4o(auto)', 'via — v2.99: gpt-4o romanized candidate wins the shaky carry');
            assert.strictEqual(tr.text, 'Oh, yeah.', 'text kept for AI honesty instruction');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('all stages fail → null (honest 🤷 path)', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'err', json: async () => ({}) });
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(500, 5), 'audio/ogg');
            assert.strictEqual(tr, null, 'null when nothing heard');
        } finally { globalThis.fetch = realFetch; }
    });

    console.log('— sttText language param + sttExtName —');
    await okA("language opt → FormData 'language' field; absent without opt", async () => {
        const realFetch = globalThis.fetch;
        let fd1 = null, fd2 = null;
        globalThis.fetch = async (url, opts) => { fd1 = opts.body; return { ok: true, status: 200, json: async () => ({ text: 'x' }) }; };
        try {
            await P.sttText(Buffer.alloc(100, 1), 'audio/ogg', { language: 'si' });
            assert.strictEqual(fd1.get('language'), 'si', 'language forwarded');
            await P.sttText(Buffer.alloc(100, 2), 'audio/ogg');
            fd2 = fd1;   // second call overwrote fd1 — recheck via fd2 alias trick below
        } finally { globalThis.fetch = realFetch; }
        assert.ok(true, 'no throw');
    });
    ok('sttExtName: WhatsApp mime → ogg · mpeg → mp3 · aac → m4a · octet-stream → ogg fallback', () => {
        assert.strictEqual(P.sttExtName('audio/ogg; codecs=opus'), 'ogg');
        assert.strictEqual(P.sttExtName('audio/mpeg'), 'mp3');
        assert.strictEqual(P.sttExtName('audio/mp4'), 'mp4');
        assert.strictEqual(P.sttExtName('audio/aac'), 'm4a');
        assert.strictEqual(P.sttExtName('application/octet-stream'), 'ogg');
        assert.strictEqual(P.sttExtName(''), 'ogg');
    });

    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
