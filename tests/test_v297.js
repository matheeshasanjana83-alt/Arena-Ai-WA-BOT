/**
 * test_v297.js — 🐛 TEXT AUTO-REPLY RESURRECTION + AI FAIL VISIBILITY
 * (user: 'Sticker බලලා reply කරනවා විතරයි නොමල් මැසෙජ් වලට reply නෑ' — bot replied to stickers
 *  but NEVER to normal text messages, in DMs AND groups).
 * ROOT CAUSE (v2.96.0 regression, commit 4948ee8): maybeAiReply's text path called
 *   ai.ask(jid, text, { owner, context: chatCtx, group: !!group })  ← `group` UNDEFINED (it's `isGroup`)
 * → ReferenceError EVERY call → swallowed by `catch { }` → every TEXT auto-reply died silently.
 * Media branch returned early (line ~989) → stickers/photos/voice/video/doc kept replying.
 * Panel logs 19:13–19:18: 10× 'AI media(sticker)' replies, 0× 'AI chat' — exact match.
 * Tested here (ALL OFFLINE — ai.ask spied / fetch + mediaDownloader mocked):
 *  (1) 🐛 THE FIX e2e: DM text → ai.ask called ONCE (group:false) + reply sent (buggy code: spy never called)
 *  (2) group text REPLY-TO-BOT → ai.ask called with group:true
 *  (3) group text @MENTION → ai.ask called with group:true
 *  (4) group text NO mention/reply → still silent (v2.96 gate intact)
 *  (5) bare number → still silent (v2.58 quota guard intact)
 *  (6) 👁 FAIL VISIBILITY: ai.ask throw → '🤖❌ AI chat fail' log line with the error (never blind again)
 *  (7) 🎨 media path untouched: sticker → vision branch (ai.ask NOT called), status bubble + reply
 *  (8) source markers: `group: isGroup` in ask call, NO `!!group`, single zai signal, 3 fail-log lines
 */
process.env.ARENA_NO_REACT = '1';
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v297_mem.json';
process.env.GEMINI_API_KEY = 'AIzaTEST_v297_textfix_gem_000000000';
process.env.GROQ_API_KEY = 'gskTEST_v297_textfix_groq_000000000';
process.env.ARENA_AI_MS = '700';
const assert = require('assert');
const fs = require('fs');
try { fs.unlinkSync(__dirname + '/../.test_v297_mem.json'); } catch { }
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pkg = require('../package.json');
const manifest = require('../manifest.json');
const ai = require('../ai');
ai._history.clear();
require('../antibug')._state.lockdownUntil = 0;   // 🐛 v3.01.0: storm-lock from earlier antibug suites silently killed maybeAiReply gates (order-independent e2e)
const bot = require('../bot');
const aiSrc = fs.readFileSync(__dirname + '/../ai.js', 'utf8');
const botSrc = fs.readFileSync(__dirname + '/../bot.js', 'utf8');
const realFetch = globalThis.fetch;
bot.ME.pn = '94724768017@s.whatsapp.net';
bot.ME.lid = '165053179915940@lid';
bot._setSock({
    groupMetadata: async (jid) => ({ subject: 'Death Legion' }),
    sendPresenceUpdate: async () => { },
    sendMessage: async () => ({ key: { id: 'X' } }),
});
const sendCap = (sends) => async (j, c) => { sends.push(c); return { key: { id: 'K' + sends.length } }; };

// ai.ask spy — THE observable for the text path (bot.js calls ai.ask through the shared module object)
let askCalls = [], askReply = { text: 'හරි මචං, මම KAVIZ MD V1! 😎', model: 'Spy' };
const realAsk = ai.ask;
function spyAsk(chatId, question, opts) { askCalls.push({ chatId, question, opts: opts || {} }); return Promise.resolve({ ...askReply }); }
ai.ask = spyAsk;
const stickerVisionFetch = (url) => {
    const u = String(url);
    if (/generativelanguage/.test(u)) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '😂 Toby sticker එක මචං!' }] } }] }) });
    return Promise.reject(new Error('unexpected fetch: ' + u));
};

(async () => {
    console.log('— v3.01.0 pins + markers —');
    ok('version 3.01.0 pkg+manifest + manifest lists test_v297.js', () => {
        assert.strictEqual(pkg.version, '3.01.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.01.0', 'manifest ' + manifest.version);
        assert.ok(manifest.files.includes('tests/test_v297.js'), 'manifest lists test_v297.js');
        assert.ok(manifest.notes.includes('TEXT'), 'notes headline mentions TEXT fix');
    });
    ok('source markers — the fix + never-blind logging + zai signal dedupe', () => {
        assert.ok(botSrc.includes('group: isGroup });   // 👑 v2.94 owner'), 'ai.ask now passes isGroup');
        assert.ok(!botSrc.includes('group: !!group'), 'NO undefined `!!group` left in bot.js');
        assert.ok(botSrc.includes('🤖❌ AI chat fail:'), 'runJob catch logs failures');
        assert.ok(botSrc.includes('🤖❌ AI job fail:'), 'runJob .catch logs failures');
        assert.ok(botSrc.includes('🤖❌ AI gate fail:'), 'outer catch logs failures');
        assert.strictEqual((aiSrc.match(/signal: AbortSignal\.timeout\(T_ZAI\(\)\)/g) || []).length, 1, 'exactly ONE zai signal (dup removed)');
    });

    console.log('— 🐛 THE BUG e2e (text auto-reply was silently dead) —');
    await okA('(1) DM text message → ai.ask CALLED + reply sent (buggy v2.96.0/1: ReferenceError → 0 calls)', async () => {
        askCalls = []; const sends = [];
        bot.maybeAiReply({
            msg: { key: { remoteJid: '94771234567@s.whatsapp.net', id: 'D1', fromMe: false }, pushName: 'බී', message: { conversation: 'බන් මොකද කාරනේ 😄' } },
            jid: '94771234567@s.whatsapp.net', text: 'බන් මොකද කාරනේ 😄', owner: false, send: sendCap(sends),
        });
        await sleep(400);
        assert.strictEqual(askCalls.length, 1, 'ai.ask calls: ' + askCalls.length);
        assert.strictEqual(askCalls[0].opts.group, false, 'DM → group:false');
        assert.strictEqual(askCalls[0].opts.owner, false, 'owner flag passthrough');
        assert.ok(askCalls[0].question.includes('මොකද කාරනේ'), 'question text intact');
        assert.ok(sends.some((s) => String(s.text || '').includes('KAVIZ MD V1')), 'AI reply reached the chat');
    });
    await okA('(2) group text REPLY-TO-BOT → ai.ask with group:true (v2.96 gate → text path alive)', async () => {
        askCalls = []; const sends = [];
        bot.maybeAiReply({
            msg: { key: { remoteJid: 'gp297a@g.us', id: 'G1', participant: '94771234567@s.whatsapp.net' }, pushName: 'Suziy', message: { extendedTextMessage: { text: 'මොඩයා 😡', contextInfo: { participant: bot.ME.pn, stanzaId: 'BOTMSG9', quotedMessage: { conversation: 'sticker reply' } } } } },
            jid: 'gp297a@g.us', text: 'මොඩයා 😡', owner: false, send: sendCap(sends),
        });
        await sleep(400);
        assert.strictEqual(askCalls.length, 1, 'ai.ask calls: ' + askCalls.length);
        assert.strictEqual(askCalls[0].opts.group, true, 'group reply → group:true');
        assert.ok(String(askCalls[0].opts.context || '').includes('Suziy'), 'sender pushName in chat ctx');
        assert.ok(sends.some((s) => String(s.text || '').includes('KAVIZ')), 'reply sent to group');
    });
    await okA('(3) group text @MENTION → ai.ask with group:true', async () => {
        askCalls = []; const sends = [];
        bot.maybeAiReply({
            msg: { key: { remoteJid: 'gp297b@g.us', id: 'G2', participant: '94771234567@s.whatsapp.net' }, pushName: 'Kasun', message: { extendedTextMessage: { text: '@94724768017 කොහොමද බන්', contextInfo: { mentionedJid: [bot.ME.lid] } } } },
            jid: 'gp297b@g.us', text: '@94724768017 කොහොමද බන්', owner: false, send: sendCap(sends),
        });
        await sleep(400);
        assert.strictEqual(askCalls.length, 1, 'ai.ask calls: ' + askCalls.length);
        assert.strictEqual(askCalls[0].opts.group, true, 'mention → group:true');
    });
    await okA('(4) group text NO mention / NO reply-to-bot → still silent (anti-flood intact)', async () => {
        askCalls = []; const sends = [];
        bot.maybeAiReply({
            msg: { key: { remoteJid: 'gp297c@g.us', id: 'G3', participant: '94771234567@s.whatsapp.net' }, pushName: 'Kasun', message: { conversation: 'random flood text' } },
            jid: 'gp297c@g.us', text: 'random flood text', owner: false, send: sendCap(sends),
        });
        await sleep(300);
        assert.strictEqual(askCalls.length, 0, 'ai.ask must NOT fire');
        assert.strictEqual(sends.length, 0, 'no sends');
    });
    await okA('(5) bare number text → still silent (v2.58 stray menu-pick guard intact)', async () => {
        askCalls = []; const sends = [];
        bot.maybeAiReply({
            msg: { key: { remoteJid: '94771234568@s.whatsapp.net', id: 'D2', fromMe: false }, message: { conversation: '1' } },
            jid: '94771234568@s.whatsapp.net', text: '1', owner: false, send: sendCap(sends),
        });
        await sleep(300);
        assert.strictEqual(askCalls.length, 0, 'bare digit must NOT fire ai.ask');
    });
    await okA('(6) 👁 ai.ask throw → log line 🤖❌ AI chat fail + error text (never blind again)', async () => {
        askCalls = []; const sends = [];
        const lines = [];
        const origLog = console.log;
        console.log = (...a) => { lines.push(a.join(' ')); origLog(...a); };
        ai.ask = async () => { throw new Error('boom-test-297'); };
        try {
            bot.maybeAiReply({
                msg: { key: { remoteJid: '94771234569@s.whatsapp.net', id: 'D3', fromMe: false }, message: { conversation: 'make it fail' } },
                jid: '94771234569@s.whatsapp.net', text: 'make it fail', owner: false, send: sendCap(sends),
            });
            await sleep(300);
        } finally { console.log = origLog; ai.ask = spyAsk; }
        const joined = lines.join('\n');
        assert.ok(joined.includes('AI chat fail'), 'fail log emitted');
        assert.ok(joined.includes('boom-test-297'), 'error message visible in log');
    });
    await okA('(7) 🎨 media path untouched: group sticker reply-to-bot → vision branch (ai.ask NOT called)', async () => {
        askCalls = []; const sends = [];
        bot._setMediaDownloader(async () => Buffer.alloc(2048, 7));
        globalThis.fetch = stickerVisionFetch;
        try {
            bot.maybeAiReply({
                msg: { key: { remoteJid: 'gp297d@g.us', id: 'G4', participant: '94771234567@s.whatsapp.net' }, pushName: 'Suziy', message: { stickerMessage: { mimetype: 'image/webp', fileLength: 42000, contextInfo: { participant: bot.ME.pn, stanzaId: 'BOTMSG10', quotedMessage: { conversation: 'hi' } } } } },
                jid: 'gp297d@g.us', text: '', owner: false, send: sendCap(sends),
            });
            await sleep(600);
        } finally { globalThis.fetch = realFetch; }
        assert.strictEqual(askCalls.length, 0, 'sticker must take vision branch, not ai.ask');
        assert.ok(sends[0] && String(sends[0].text || '').includes('👀 බලනවා'), 'status bubble');
        assert.ok(sends.some((s) => String(s.text || '').includes('Toby')), 'vision reply sent');
    });
    ai.ask = realAsk;   // restore

    console.log(`\n${pass} pass / ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS:', e); process.exit(1); });
