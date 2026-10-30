/**
 * test_v295.js — 👥🎨 AI GROUP CHAT + MEDIA AI (user: 'Group වලට ai chat එක හොදට chat කරන විදිහට හදන්න ඉක්මනට
 * සහ sticker එකක් දැම්මොත් මව mention කරලා එකටත් reply කරන්න ඔනි stiker එක බලලා තව document,music,video වලෙ එවා
 * බලලා seep reply කරන්න ai chat bot එක හොදට නැසනල් විදිහට හදන්න ඔනි').
 * Tested here (ALL OFFLINE — fetch + mediaDownloader + stt mocked):
 *  (1) 👥 GROUP CONTEXT: groupName cache + pushName → CHAT CONTEXT in real system payload (mocked Gemini e2e)
 *  (2) 🎨 MEDIA AI: sticker (DM, no question) → vision webp · audio → stt transcript → ai.ask song-identify ·
 *      text document → content → ai.ask · group sticker WITHOUT mention → silent · big video → honest cap card
 *  (3) getText video caption + quotedMediaOf sticker/video extension (.ai command)
 *  (4) PROFESSIONAL QUALITY + GROUP CHATS SYSTEM rules + .define dictionary command
 */
process.env.ARENA_NO_REACT = '1';
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v295_mem.json';
process.env.GEMINI_API_KEY = 'AIzaTEST_v295_media_ai_key_0000000';
try { fs.unlinkSync(__dirname + '/../.test_v295_mem.json'); } catch { }   // exit-handler re-creates it AFTER our end-unlink — stale history would break the fresh-chat asserts
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pkg = require('../package.json');
const manifest = require('../manifest.json');
const ai = require('../ai');
ai._history.clear();   // deterministic — no stale in-memory history from loadMemory
require('../antibug')._state.lockdownUntil = 0;   // 🐛 v3.03.0: storm-lock from earlier antibug suites (v255/v277) silently killed every maybeAiReply gate (0 sends) — order-independent e2e
const bot = require('../bot');
const tools = require('../tools');
const P = require('../pollinations');           // monkey-patch target (require cache shared with bot.js)
const aiSrc = fs.readFileSync(__dirname + '/../ai.js', 'utf8');
const botSrc = fs.readFileSync(__dirname + '/../bot.js', 'utf8');
const toolsSrc = fs.readFileSync(__dirname + '/../tools.js', 'utf8');

// ── fetch mock: Gemini chat + vision + dictionary ──
const captured = [];
const realFetch = globalThis.fetch;
function mockFetch(url, opts) {
    const u = String(url);
    if (/generativelanguage/.test(u)) {
        captured.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'මම KAVIZ MD V1 🧠 — මේක sticker එකක් වගේ පේන්නේ!' }] } }] }) });
    }
    if (/dictionaryapi\.dev/.test(u)) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [{ word: 'serendipity', phonetic: '/ˌsɛr.ənˈdɪp.ɪ.ti/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'The occurrence of events by chance in a happy way.', example: 'We found the cafe by pure serendipity.' }] }] }] });
    }
    return Promise.reject(new Error('unexpected fetch: ' + u));
}
const stickerMsg = (extra = {}) => ({ key: { remoteJid: 'dm295@s.whatsapp.net', id: 'S1' }, pushName: 'Suziy', message: { stickerMessage: { mimetype: 'image/webp', fileLength: 42000, ...extra } } });
const audioMsg = (over = {}) => ({ key: { remoteJid: 'dm295b@s.whatsapp.net', id: 'A1' }, pushName: 'Suziy', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: 90000, ...over } } });
const docMsg = (over = {}) => ({ key: { remoteJid: 'dm295c@s.whatsapp.net', id: 'D1' }, pushName: 'Suziy', message: { documentMessage: { mimetype: 'text/plain', fileName: 'notes.txt', fileLength: 220, ...over } } });
const videoMsg = (over = {}) => ({ key: { remoteJid: 'dm295d@s.whatsapp.net', id: 'V1' }, pushName: 'Suziy', message: { videoMessage: { mimetype: 'video/mp4', fileLength: 30 * 1048576, ...over } } });

(async () => {
    console.log('— v2.96.0 pins + markers —');
    ok('version 2.95 pkg+manifest + notes + source markers', () => {
        assert.strictEqual(pkg.version, '3.03.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.03.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('MEDIA AI'), 'notes headline');
        assert.ok(manifest.files.includes('tests/test_v295.js'), 'manifest lists test_v295.js');
        assert.ok(aiSrc.includes('CTX_OVERRIDE'), 'ai.js chat-context slot');
        assert.ok(botSrc.includes('aiMediaOf'), 'bot.js media detector');
        assert.ok(botSrc.includes('groupName'), 'bot.js group-name helper');
        assert.ok(toolsSrc.includes("'.define': cmdDefine"), 'tools .define wired');
    });
    ok('SYSTEM: PROFESSIONAL QUALITY + GROUP CHATS rules; vision covers video', () => {
        assert.ok(aiSrc.includes('PROFESSIONAL QUALITY'), 'professional rule');
        assert.ok(aiSrc.includes('GROUP CHATS: in group chats keep replies short'), 'group rule');
        assert.ok(aiSrc.includes('image, document & video analyst'), 'VISION_SYSTEM video');
        assert.ok(aiSrc.includes("opts.context) ? '👥 CHAT CONTEXT: '"), 'ctx injection');
        assert.ok(botSrc.includes("x?.videoMessage?.caption"), 'getText video caption');
        assert.ok(botSrc.includes('sm ? (sm.mimetype') && botSrc.includes('20 * 1048576'), 'quotedMediaOf sticker+video20MB');
    });

    console.log('— 👥 CHAT CONTEXT e2e (mocked Gemini — real ai.ask path) —');
    await okA('context reaches systemInstruction; absent without it', async () => {
        captured.length = 0;
        globalThis.fetch = mockFetch;
        try {
            await ai.ask('ctx295@s.whatsapp.net', 'hello boss', { context: 'group "Test GP" · replying to Suziy' });
            const sys1 = captured[0].systemInstruction.parts[0].text;
            assert.ok(sys1.includes('👥 CHAT CONTEXT'), 'ctx marker');
            assert.ok(sys1.includes('Test GP') && sys1.includes('Suziy'), 'group + sender in payload');
            await ai.ask('ctx295b@s.whatsapp.net', 'hello boss');
            assert.ok(!captured[1].systemInstruction.parts[0].text.includes('👥 CHAT CONTEXT'), 'no ctx without opts');
        } finally { globalThis.fetch = realFetch; }
    });

    console.log('— 🎨 MEDIA AI e2e (maybeAiReply: sticker/audio/document/group-silence/big-video) —');
    await okA('DM sticker → status bubble → vision(webp) → deep reply', async () => {
        const sends = [];
        bot._setMediaDownloader(async () => Buffer.alloc(2048, 7));
        captured.length = 0;
        globalThis.fetch = mockFetch;
        try {
            bot.maybeAiReply({ msg: stickerMsg(), jid: 'dm295@s.whatsapp.net', text: '', owner: false, send: async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; } });
            await sleep(400);
            assert.ok(sends.length >= 2, 'status + reply sends: ' + sends.length);
            assert.ok(sends[0].text.includes('👀 බලනවා'), 'status bubble first');
            const reply = sends.map((s) => s.text || '').join(' ');
            assert.ok(reply.includes('sticker එකක්'), 'AI sticker reply text');
            const vis = captured.find((c) => (c.contents?.[0]?.parts || []).some((p) => p.inline_data));
            assert.ok(vis, 'vision call captured (captured=' + captured.length + ' keys=' + JSON.stringify(captured.map((c) => Object.keys(c))) + ' sends=' + sends.length);
            assert.strictEqual(vis.contents[0].parts.find((p) => p.inline_data).inline_data.mime_type, 'image/webp', 'webp passthrough');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('DM voice note → stt transcript → ai.ask song-identify question', async () => {
        const sends = [];
        const origStt = P.sttText;
        const origGT = ai.geminiTranscribe;
        P.sttText = async () => 'what does the fox say... the fox song lyrics line';
        ai.geminiTranscribe = async () => { throw new Error('gemini stt off (v295 mock)'); };   // ⚡ v2.98 chain: Gemini stage first — force fall-through to the whisper mock
        captured.length = 0;
        globalThis.fetch = mockFetch;
        try {
            bot.maybeAiReply({ msg: audioMsg(), jid: 'dm295b@s.whatsapp.net', text: '', owner: false, send: async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; } });
            await sleep(400);
            assert.ok(sends.length >= 2, 'status + reply: ' + sends.length);
            assert.ok(sends[0].text.includes('🎙️ ඇහනවා'), 'listening bubble');
            const q = captured[0].contents[0].parts[0].text;
            assert.ok(q.includes('voice/audio transcript') && q.includes('fox song'), 'transcript injected into question');
        } finally { globalThis.fetch = realFetch; P.sttText = origStt; ai.geminiTranscribe = origGT; }
    });
    await okA('DM text document → file content → ai.ask', async () => {
        const sends = [];
        bot._setMediaDownloader(async () => Buffer.from('TODO fix the login bug in auth.js'));
        captured.length = 0;
        globalThis.fetch = mockFetch;
        try {
            bot.maybeAiReply({ msg: docMsg(), jid: 'dm295c@s.whatsapp.net', text: '', owner: false, send: async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; } });
            await sleep(400);
            assert.ok(sends.length >= 2, 'status + reply: ' + sends.length);
            assert.ok(sends[0].text.includes('📄 කියවනවා'), 'reading bubble');
            const q = captured[0].contents[0].parts[0].text;
            assert.ok(q.includes('notes.txt') && q.includes('login bug'), 'filename + content in question');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('group sticker WITHOUT mention → silent (anti-flood)', async () => {
        const sends = [];
        bot._setMediaDownloader(async () => Buffer.alloc(2048, 7));
        bot.maybeAiReply({ msg: { key: { remoteJid: 'gp295@g.us', id: 'G1' }, pushName: 'Suziy', message: { stickerMessage: { mimetype: 'image/webp', fileLength: 42000 } } }, jid: 'gp295@g.us', text: '', owner: false, send: async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; } });
        await sleep(300);
        assert.strictEqual(sends.length, 0, 'no sends: ' + JSON.stringify(sends));
    });
    await okA('big video (>20MB) → honest cap card, no download', async () => {
        const sends = [];
        let dlCalled = false;
        bot._setMediaDownloader(async () => { dlCalled = true; return Buffer.alloc(2048, 7); });
        bot.maybeAiReply({ msg: videoMsg(), jid: 'dm295d@s.whatsapp.net', text: '', owner: false, send: async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; } });
        await sleep(400);
        assert.ok(sends.length >= 2, 'status + cap card: ' + sends.length);
        assert.ok(sends.map((s) => s.text || '').join(' ').includes('20 MB cap'), 'honest 20MB card');
        assert.strictEqual(dlCalled, false, 'never downloaded');
    });

    console.log('— 📖 .define command —');
    await okA('.define serendipity → dictionary card; unknown word → honest miss', async () => {
        const sends = [];
        const S = async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; };
        globalThis.fetch = mockFetch;
        try {
            await tools.handle('.define', { send: S, jid: 'dm295e@s.whatsapp.net', msg: {}, rest: ['serendipity'] });
            assert.ok(sends[0].text.includes('serendipity') && sends[0].text.includes('by chance'), 'definition card');
            assert.ok(sends[0].text.includes('.ai serendipity'), 'deep-dive hint');
            sends.length = 0;
            globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
            await tools.handle('.define', { send: S, jid: 'dm295e@s.whatsapp.net', msg: {}, rest: ['zzzunknownzz'] });
            assert.ok(sends[0].text.includes('හම්බුණේ නෑ'), 'honest miss');
            sends.length = 0;
            await tools.handle('.define', { send: S, jid: 'dm295e@s.whatsapp.net', msg: {}, rest: [] });
            assert.ok(sends[0].text.includes('.define <word>'), 'usage card');
        } finally { globalThis.fetch = realFetch; }
    });

    try { fs.unlinkSync(__dirname + '/../.test_v295_mem.json'); } catch { }
    try { fs.unlinkSync(__dirname + '/../.test_v295_mem.json.tmp'); } catch { }
    console.log(`\n${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
