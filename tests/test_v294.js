/**
 * test_v294.js — 👑 AI REBRAND (user: 'කට්ටිය අහනවා මන් මොන ai එකෙන්ද හැදුවෙ කියලා එතකොට z.ai GLM කියන්නෙ නැතුව
 * හැම එකටම Kaviz md කියලා කියන්න ඔනි... 94724768017 owner කියලා ai එකට කියන්න').
 * Tested here: (1) SYSTEM identity lock + owner + engine secrecy (leak line REMOVED) (2) VISION_SYSTEM rebrand
 * (3) 👑 OWNER MODE: ai.ask opts.owner → OWNER_CONTEXT reaches the REAL system payload (mocked Gemini fetch e2e)
 * (4) askPolli gets full SYSTEM via sysOf() (was: zero identity on polli fallback — real leak path) (5) needsWeb
 * vs/සසඳන්න triggers (6) bot.js card rebrands + owner plumbing ×2. ALL OFFLINE (fetch mocked).
 */
process.env.ARENA_NO_REACT = '1';
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v294_mem.json';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = require('../package.json');
const manifest = require('../manifest.json');
const ai = require('../ai');
const aiSrc = fs.readFileSync(__dirname + '/../ai.js', 'utf8');
const botSrc = fs.readFileSync(__dirname + '/../bot.js', 'utf8');

(async () => {
    console.log('— v2.96.0 pins —');
    ok('version 2.94 pkg+manifest + notes + markers', () => {
        assert.strictEqual(pkg.version, '3.02.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.02.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('AI REBRAND'), 'notes headline');
        assert.ok(aiSrc.includes('👑 OWNER MODE'), 'ai.js owner-mode marker');
        assert.ok(aiSrc.includes('IDENTITY LOCK (highest rule)'), 'ai.js identity-lock marker');
        assert.ok(botSrc.includes('v2.94'), 'bot.js v2.94 marker');
    });

    console.log('— identity: SYSTEM leaks are GONE, brand + owner baked in —');
    ok('SYSTEM: no "powered by free models" / no engine names as identity', () => {
        assert.ok(!aiSrc.includes('You are powered by free models'), 'old leak line still in ai.js');
        assert.ok(!aiSrc.includes('Z.ai GLM). If asked, say so honestly'), 'old "say so honestly" leak');
        assert.ok(!String(ai.VISION_SYSTEM).includes('powered by free models'), 'vision leak');
        assert.ok(String(ai.VISION_SYSTEM).includes('KAVIZ MD V1'), 'vision identity');
    });
    ok('SYSTEM: IDENTITY LOCK + OWNER 94724768017 + ENGINE SECRECY + SMART THINKING', () => {
        assert.ok(aiSrc.includes('You are ALWAYS "KAVIZ MD V1"'), 'identity lock');
        assert.ok(aiSrc.includes('94724768017'), 'owner number in SYSTEM');
        assert.ok(aiSrc.includes('Your owner and creator is 94724768017'), 'owner rule');
        assert.ok(aiSrc.includes('ENGINE SECRECY'), 'engine secrecy rule');
        assert.ok(aiSrc.includes('SMART THINKING'), 'intelligence rules');
        // test_v247 asserted phrases survive (memory honesty / identity mirror / sinhala quality)
        assert.ok(aiSrc.includes('never pretend to remember'), 'v247 honesty phrase kept');
        assert.ok(aiSrc.includes('never call yourself by it'), 'v247 mirror phrase kept');
        assert.ok(aiSrc.includes('NEVER invent non-existent Sinhala words'), 'v247 sinhala phrase kept');
        assert.ok(aiSrc.includes('මොන ai එකෙන්ද හැදුවෙ'), 'real user question shape covered');
    });

    console.log('— 👑 OWNER MODE e2e (mocked Gemini fetch — real ask() path) —');
    await okA('owner:true → systemInstruction carries OWNER MODE + number; default turn → NOT', async () => {
        process.env.GEMINI_API_KEY = 'AIzaTEST_v294_owner_mode_key_000000';
        const captured = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            if (!/generativelanguage/.test(String(url))) throw new Error('unexpected fetch: ' + url);
            captured.push(JSON.parse(opts.body));
            return {
                ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'හායි boss! 😎 මම KAVIZ MD V1' }] } }] })
            };
        };
        try {
            const r1 = await ai.ask('owner294@s.whatsapp.net', 'hello boss', { owner: true });
            assert.ok(r1 && r1.text, 'owner turn replied');
            const sys1 = captured[0].systemInstruction.parts[0].text;
            assert.ok(sys1.includes('OWNER MODE'), 'OWNER MODE in payload');
            assert.ok(sys1.includes('94724768017'), 'owner number in payload');
            assert.ok(sys1.includes('IDENTITY LOCK'), 'identity still on');
            const r2 = await ai.ask('user294@s.whatsapp.net', 'hello boss');
            assert.ok(r2 && r2.text, 'normal turn replied');
            const sys2 = captured[1].systemInstruction.parts[0].text;
            assert.ok(!sys2.includes('OWNER MODE'), 'no owner context for normal user');
            assert.ok(sys2.includes('IDENTITY LOCK'), 'identity on for normal user too');
        } finally { globalThis.fetch = realFetch; try { fs.unlinkSync(__dirname + '/../.test_v294_mem.json'); } catch { } }
    });

    console.log('— polli fallback identity fix (was: NO system prompt at all) —');
    ok('askPolli body starts with sysOf() (SYSTEM + OWNER + KB + WEB)', () => {
        assert.ok(aiSrc.includes("const body = [{ role: 'system', content: sysOf() }"), 'askPolli uses sysOf()');
        assert.ok(!aiSrc.includes("...(KB_OVERRIDE ? [{ role: 'system'"), 'old KB-only injection removed');
    });

    console.log('— needsWeb triggers widened (vs / සසඳන්න) —');
    ok('comparison questions get live-web grounding', () => {
        assert.strictEqual(ai.needsWeb('iphone vs samsung මොකද හොඳ'), true, 'vs trigger');
        assert.strictEqual(ai.needsWeb('redmi එක samsung එක සසඳන්න'), true, 'සසඳන්න trigger');
        assert.strictEqual(ai.needsWeb('hi'), false, 'short chat stays off web');
        assert.strictEqual(ai.needsWeb('මෙක හොඳද'), false, 'casual stays off web');
    });

    console.log('— bot.js public cards rebrand + owner plumbing —');
    ok('cards: smart connector / built-in abilities / multi-engine / M1-M3 memory', () => {
        assert.ok(botSrc.includes('*.ai tools* — smart connector'), 'menu AI tools line');
        assert.ok(!botSrc.includes('GLM connector'), 'old GLM connector gone');
        assert.ok(botSrc.includes('KAVIZ AI එකේ built-in abilities'), 'tools card');
        assert.ok(!botSrc.includes('GLM (Z.ai) එකට connect'), 'old tools card gone');
        assert.ok(botSrc.includes('AUTO (KAVIZ multi-engine)'), 'provider display');
        assert.ok(!botSrc.includes('AUTO (Gemini → Groq → Z.ai)'), 'old provider chain gone');
        assert.ok(botSrc.includes('Smart multi-engine fallback auto'), 'AI card fallback line');
        assert.ok(botSrc.includes('M1: ${st.myPerProv.gemini}'), 'memory card M-labels');
        assert.ok(!botSrc.includes('Z.ai: ${st.myPerProv.zai}'), 'old memory labels gone');
        assert.ok(botSrc.includes('smart image engine (auto fallback)'), 'image chain rebrand');
        assert.ok(!/Together FLUX → Gemini → Pollinations \(auto fallback\)/.test(botSrc), 'old chain gone');
    });
    ok('owner plumbing: auto-chat + .ai command both pass { owner }', () => {
        assert.ok(botSrc.includes('ai.ask(jid, text, { owner, context: chatCtx, group: isGroup })'), 'maybeAiReply passes owner+ctx (v3.02.0 shape — !!group was the ReferenceError bug)');   // v3.02.0: pin follows the FIX
        assert.ok(botSrc.includes('ai.ask(jid, question, { owner: isFromOwner(msg.key), context: gctx || undefined, fast: false })'), 'handleAI passes owner (v2.96 shape)');
    });

    console.log(`\n${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
