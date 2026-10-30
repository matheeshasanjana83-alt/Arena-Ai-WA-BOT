/**
 * test_v300.js — 🎙️ SINHALA STT V2: gpt-4o-transcribe stage (user: 'තාම බෑ බන් සිංහල… ඔබට කොමද කියලා ඇහුවා එකත් බෑ කියවන්න').
 * EVIDENCE (live probes 2026-10-30, real Sinhala edge-tts si-LK clips + production panel keys):
 *  · v2.98 chain DEAD in production: Gemini key 429 quota · Groq key 403 Forbidden · whisper-large-v3 CANNOT hear
 *    Sinhala even with language=si → kohomada 'こうまで' / si 'හැතින්න්න්න්…' · ponnaya ' Be me.'/'' ·
 *    sentence ',,,,,,,,,,,, …' · gahanna 'හිතින්තින් හිතින්…' — user's honest-🤷 + fabrication class both alive.
 *  · gpt-4o-transcribe (Pollinations transcriptions endpoint, baked key) + Sinhala-script prompt REALLY decodes
 *    Sinhala: kohomada → 'කොහොමද.' ×3 STABLE · sentence → near word-for-word · OGG direct accepted (no transcode) ·
 *    English clip unaffected ('Hey bro, what's up?…') · lang=si param → HTTP 400 'not recognized' (prompt steers, not param).
 * FIX (v3.03.1): pollinations.js sttText prompt opt → ai.gpt4oTranscribe seam → chain: Gemini → gpt-4o si-shot
 * (dual-shot on non-Sinhala) → Latin ≥4-word English pass → Groq → Pollinations auto → Pollinations si (garbage-gated)
 * → shaky carry → null+logged. garbageText kills: comma-spam / char-loop / word-loop / CJK-misfire / HTML blob.
 * Tested here (ALL OFFLINE — P.sttText + seams patched, no network):
 *  (1) hasSinhala ×4 · garbageText ×9 (every probed garbage shape + real Sinhala/English kept)
 *  (2) gpt4oTranscribe → P.sttText(model gpt-4o-transcribe, prompt forwarded)
 *  (3) chain e2e ×7: si-shot win · dual-shot 'Ping me.'→'පින්නි.' · English pass-through · gemini precedence ·
 *      gpt4o-throw → Groq · all-garbage → null + 'STT chain fail' log · shaky 'gpt-4o(auto)'
 *  (4) pins 3.03.1 pkg+manifest + notes headline + manifest lists test_v300.js + source markers
 */
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v300_mem.json';
try { fs.unlinkSync(__dirname + '/../.test_v300_mem.json'); } catch { }
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
const polliSrc = fs.readFileSync(__dirname + '/../pollinations.js', 'utf8');

(async () => {
    console.log('— v3.03.1 pins + source markers —');
    ok('version 3.03.1 pkg+manifest · notes headline · manifest lists test_v300.js', () => {
        assert.strictEqual(pkg.version, '3.03.1', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.03.1', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('SINHALA STT V2'), 'notes headline');
        assert.ok(manifest.files.includes('tests/test_v300.js'), 'manifest lists test_v300.js');
    });
    ok('markers: gpt4oTranscribe seam + GPT4O_SI_PROMPTS + garbageText/hasSinhala + sttText prompt opt', () => {
        assert.ok(aiSrc.includes('async function gpt4oTranscribe'), 'gpt4oTranscribe fn');
        assert.ok(aiSrc.includes('module.exports.gpt4oTranscribe(buf, m'), 'chain uses test seam');
        assert.ok(aiSrc.includes('GPT4O_SI_PROMPTS'), 'dual-shot prompts');
        assert.ok(aiSrc.includes('function garbageText'), 'garbage fn');
        assert.ok(aiSrc.includes('const hasSinhala'), 'hasSinhala fn');
        assert.ok(aiSrc.includes("'gpt-4o (si×2)'"), 'dual-shot via label');
        assert.ok(aiSrc.includes('STT chain fail'), 'never-blind log');
        assert.ok(polliSrc.includes("prompt = ''"), 'sttText prompt opt');
        assert.ok(polliSrc.includes("fd.append('prompt'"), 'prompt multipart field');
    });

    console.log('— hasSinhala / garbageText (probed garbage shapes) —');
    ok('hasSinhala: Sinhala→true · English→false · mixed→true · empty→false', () => {
        assert.strictEqual(ai.hasSinhala('කොහොමද'), true, 'sinhala');
        assert.strictEqual(ai.hasSinhala('Kumeda.'), false, 'latin');
        assert.strictEqual(ai.hasSinhala('machan කොහොමද'), true, 'mixed');
        assert.strictEqual(ai.hasSinhala(''), false, 'empty');
    });
    ok("garbage: '' · ',,,,,,, ,' · char-loop 'හැතින්න්න්…' · word-loop 'හිතින් හිතින් ×5' · CJK 'こうまで' · HTML blob → true", () => {
        assert.strictEqual(ai.garbageText(''), true, 'empty');
        assert.strictEqual(ai.garbageText('   '), true, 'whitespace only');
        assert.strictEqual(ai.garbageText(',,,,,,,,,,, ,, ,, ,, , , ,'), true, 'comma-spam (sentence clip probe)');
        assert.strictEqual(ai.garbageText(' හැතින්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්'), true, 'char-loop (kohomada si probe)');
        assert.strictEqual(ai.garbageText('හිතින්තින් හිතින් හිතින් හිතින් හිතින්'), true, 'word-loop (gahanna probe)');
        assert.strictEqual(ai.garbageText('こうまで'), true, 'CJK misfire (kohomada auto probe)');
        assert.strictEqual(ai.garbageText('<!DOCTYPE html><html><body>error</body>'), true, 'HTML blob (gpt-audio wav probe)');
    });
    ok('garbage: real Sinhala sentence · short English · romanized Sinhala · " Oh, yeah." → false (never kill real speech)', () => {
        assert.strictEqual(ai.garbageText('මචෝය අද මොකද කරන්නේ පැත්තෙන් කියලා මට තේරුම් ගන්න බැහැ.'), false, 'real Sinhala');
        assert.strictEqual(ai.garbageText("Hey bro, what's up? How are you doing today?"), false, 'real English');
        assert.strictEqual(ai.garbageText('Kumeda.'), false, 'romanized — shaky path decides, not garbage');
        assert.strictEqual(ai.garbageText(' Oh, yeah.'), false, 'ascii-short shape');
    });

    console.log('— gpt4oTranscribe → P.sttText plumbing —');
    await okA('model gpt-4o-transcribe + prompt forwarded to P.sttText', async () => {
        const orig = P.sttText;
        let seen = null;
        P.sttText = async (buf, mime, opts) => { seen = opts; return 'කොහොමද.'; };
        try {
            const t = await ai.gpt4oTranscribe(Buffer.alloc(100, 1), 'audio/ogg; codecs=opus');
            assert.strictEqual(t, 'කොහොමද.', 'transcript');
            assert.strictEqual(seen.model, 'gpt-4o-transcribe', 'model');
            assert.ok(seen.prompt && /Sinhala/.test(seen.prompt), 'si prompt forwarded');
        } finally { P.sttText = orig; }
    });

    console.log('— 🎙️ chain e2e (seams patched, no network) —');
    await okA('USER SCENARIO v2: gpt-4o si-shot returns කොහොමද. → via gpt-4o (si), whisper never burned', async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;
        const orig = P.sttText;
        let calls = 0;
        P.sttText = async () => { calls++; return 'කොහොමද.'; };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 1), 'audio/ogg; codecs=opus');
            assert.strictEqual(tr.via, 'gpt-4o (si)', 'via');
            assert.strictEqual(tr.text, 'කොහොමද.', 'text');
            assert.strictEqual(tr.shaky, false, 'not shaky');
            assert.strictEqual(calls, 1, 'single shot — no whisper stages');
        } finally { P.sttText = orig; }
    });
    await okA("dual-shot: shot1 'Ping me.' (latin short) → shot2 'පින්නි.' → via gpt-4o (si×2)", async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;
        const orig = P.sttText;
        const seq = ['Ping me.', 'පින්නි.'];
        let n = 0;
        P.sttText = async () => seq[n++] || 'extra';
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 2), 'audio/ogg');
            assert.strictEqual(tr.via, 'gpt-4o (si×2)', 'second shot wins');
            assert.strictEqual(tr.text, 'පින්නි.', 'Sinhala recovery');
            assert.strictEqual(n, 2, 'exactly two shots');
        } finally { P.sttText = orig; }
    });
    await okA('English voice note: ≥4-word latin → via gpt-4o, single shot', async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;
        const orig = P.sttText;
        let calls = 0;
        P.sttText = async () => { calls++; return "Hey bro, what's up? How are you doing today?"; };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 3), 'audio/ogg');
            assert.strictEqual(tr.via, 'gpt-4o', 'via');
            assert.strictEqual(tr.shaky, false, 'not shaky');
            assert.strictEqual(calls, 1, 'no second shot for real English');
        } finally { P.sttText = orig; }
    });
    await okA('Gemini key + seam resolves → via Gemini, gpt-4o stage never called', async () => {
        process.env.GEMINI_API_KEY = 'AIzaTEST_v300_gemini_key_00000000';
        const origGT = ai.geminiTranscribe;
        const origG4 = ai.gpt4oTranscribe;
        let g4 = 0;
        ai.geminiTranscribe = async () => 'පොන්නයා (gemini)';
        ai.gpt4oTranscribe = async () => { g4++; return 'nope'; };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 4), 'audio/ogg');
            assert.strictEqual(tr.via, 'Gemini', 'via');
            assert.strictEqual(g4, 0, 'gpt4o skipped');
        } finally { ai.geminiTranscribe = origGT; ai.gpt4oTranscribe = origG4; delete process.env.GEMINI_API_KEY; }
    });
    await okA('gpt4o seam throws → Groq whisper stage (fetch mock) → via Groq whisper', async () => {
        process.env.GROQ_API_KEY = 'gsk_TEST_v300_groq_key_000000';
        delete process.env.GEMINI_API_KEY;
        const origG4 = ai.gpt4oTranscribe;
        ai.gpt4oTranscribe = async () => { throw new Error('gpt4o 502 (v300 mock)'); };
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
            assert.ok(String(url).includes('api.groq.com'), 'groq endpoint');
            return { ok: true, status: 200, json: async () => ({ text: 'machan mata passe call karanna tonight' }) };
        };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 5), 'audio/ogg');
            assert.strictEqual(tr.via, 'Groq whisper', 'via');
        } finally { ai.gpt4oTranscribe = origG4; globalThis.fetch = realFetch; delete process.env.GROQ_API_KEY; }
    });
    await okA("whisper garbage gated: gpt4o ',,,,,' garbage ×2 + whisper auto ',,,,,' → NOT a transcript → null + 'STT chain fail' log", async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;
        const orig = P.sttText;
        P.sttText = async () => ',,,,,,,,,,, ,, ,, ,, ,';
        const realLog = console.log;
        let logged = '';
        console.log = (...a) => { logged += a.join(' '); };
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 6), 'audio/ogg');
            assert.strictEqual(tr, null, 'garbage never becomes a transcript');
            assert.ok(/STT chain fail/.test(logged), 'never-blind log fired');
        } finally { console.log = realLog; P.sttText = orig; }
    });
    await okA("shaky carry: gpt4o 'Ping me.' ×2 (latin short) + whisper same → via gpt-4o(auto) shaky=true", async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY;
        const orig = P.sttText;
        P.sttText = async (buf, mime, opts) => (opts && opts.model === 'gpt-4o-transcribe' ? 'Ping me.' : ' Oh, yeah.');
        try {
            const tr = await ai.transcribeAudio(Buffer.alloc(400, 7), 'audio/ogg');
            assert.strictEqual(tr.shaky, true, 'shaky flag');
            assert.strictEqual(tr.via, 'gpt-4o(auto)', 'gpt4o romanized candidate preferred');
            assert.strictEqual(tr.text, 'Ping me.', 'text carried for AI honesty instruction');
        } finally { P.sttText = orig; }
    });

    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
