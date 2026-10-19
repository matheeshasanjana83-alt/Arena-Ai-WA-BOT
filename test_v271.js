/**
 * test_v271.js — SUPER VISION (v2.71.0)
 * User: "Ai එකෙ photo එක බලලා ලොකු විස්තරයක් දෙන්නෙ නැනෙ ... නියමට සුපියට කාගවත් නැති ai එකක් විදිහට හදන්න"
 * Root cause of shallow photo answers: askVision() used the chat SYSTEM prompt whose rule
 * "BE SHORT like a friend texting on WhatsApp: 1-4 short lines by default. NO long lectures"
 * made every vision answer 1-2 lazy lines + weak default question + 900-2048 token caps.
 * Fix: dedicated VISION_SYSTEM deep-analysis brain (structured Sinhala sections, smart modes)
 *      + deep default question + token budgets 4096/4096/3072 + bot.js splitLong for long answers.
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
const okA = async (name, fn) => fn().then(() => { pass++; console.log('  ✅', name); }, (e) => { fail++; console.log('  ❌', name, '—', String(e.message).slice(0, 160)); });
const src = (f) => fs.readFileSync(path.join(R, f), 'utf8');

// ── mock fetch plumbing (same harness as test_v270) ──
const REAL_FETCH = global.fetch;
let ROUTES = [];
let CALLS = [];
function mockFetch(routes) {
    ROUTES = routes; CALLS = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        const body = opts.body || '';
        CALLS.push({ u, body: typeof body === 'string' ? body : '' });
        for (const r of ROUTES) {
            if (r.match(u, body)) {
                if (r.pool) return REAL_FETCH(url, opts);
                const txt = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
                return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => txt, json: async () => JSON.parse(txt), headers: new Map() };
            }
        }
        return { ok: false, status: 599, text: async () => 'no route: ' + u.slice(0, 80), json: async () => { throw new Error('no route'); }, headers: new Map() };
    };
}
const IMG_B64 = Buffer.from('fakeimgbytes-'.repeat(30)).toString('base64');
const SETTINGS_PATH = path.join(R, 'settings.json');
const settingsBackup = fs.existsSync(SETTINGS_PATH) ? fs.readFileSync(SETTINGS_PATH, 'utf8') : null;
function restoreSettings() {
    if (settingsBackup !== null) fs.writeFileSync(SETTINGS_PATH, settingsBackup);
    else { try { fs.unlinkSync(SETTINGS_PATH); } catch { } }
}
process.on('exit', () => restoreSettings());

function freshAi() {
    for (const k of Object.keys(require.cache)) if (/\\(ai|pollinations|net|ai_tools)\.js$/.test(k)) delete require.cache[k];
    return require('./ai');
}
const GEM_URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const GEM_OK = (text) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const POLLI_URL = 'https://gen.pollinations.ai/v1/chat/completions';
const POLLI_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

const DEEP = 'සම්පූර්ණ විස්තරාත්මක';   // fragment of the deep default question
const LONG_REPLY = [
    '🔍 *මොකක්ද මේ* — WhatsApp screenshot එකක්',
    '👀 *පේන දේවල්* — chat bubbles දෙකක්',
    '🔤 *ලියවිලි* — "v2.71.0 live!"',
    '🧠 *විශ්ලේෂණය* — version announcement එකක්',
    '💡 *මට යෝජනා* — update කරන්න'
].join('\n');

(async () => {
    console.log('\n══ test_v271 — SUPER VISION 🦾 ══\n');

    // ── static: VISION_SYSTEM exists & is the vision brain ──
    ok('VISION_SYSTEM exported with deep-analysis structure', () => {
        const ai = freshAi();
        const v = String(ai.VISION_SYSTEM || '');
        assert.ok(v.length > 800, 'VISION_SYSTEM too short: ' + v.length);
        for (const frag of ['මොකක්ද මේ', 'පේන දේවල්', 'ලියවිලි', 'විශ්ලේෂණය', 'මට යෝජනා']) assert.ok(v.includes(frag), 'missing section: ' + frag);
        assert.ok(/ALWAYS reply in Sinhala/i.test(v), 'must force Sinhala');
        assert.ok(/8 to 20 WhatsApp lines/i.test(v), 'must demand depth');
        assert.ok(!/BE SHORT like a friend texting/i.test(v), 'chat BE-SHORT rule leaked into vision prompt');
    });
    ok('ai.js: all 3 vision layers use VISION_SYSTEM (not chat SYSTEM)', () => {
        const s = src('ai.js');
        const vis = s.slice(s.indexOf('async function askVision'), s.indexOf('/** Markdown → WhatsApp formatting'));
        assert.ok(vis.includes('VISION_SYSTEM'), 'askVision does not reference VISION_SYSTEM');
        const sysUses = [...vis.matchAll(/text: SYSTEM|content: SYSTEM/g)];
        assert.strictEqual(sysUses.length, 0, 'askVision still uses chat SYSTEM: ' + sysUses.length + ' hits');
    });
    ok('ai.js: token budgets raised (Gemini 4096 / Groq 4096 / Polli 3072)', () => {
        const s = src('ai.js');
        const vis = s.slice(s.indexOf('async function askVision'), s.indexOf('/** Markdown → WhatsApp formatting'));
        assert.ok(vis.includes('maxOutputTokens: 4096'), 'Gemini maxOutputTokens not 4096');
        assert.ok(vis.includes('max_tokens: 4096'), 'Groq max_tokens not 4096');
        assert.ok(vis.includes('max_tokens: 3072'), 'Pollinations max_tokens not 3072');
        assert.ok(!vis.includes('max_tokens: 900') && !vis.includes('maxOutputTokens: 2048'), 'old low caps still present');
    });
    ok('bot.js: vision send splits long deep answers (splitLong)', () => {
        const s = src('bot.js');
        const vis = s.slice(s.indexOf('බලලා විස්තරේ ලියනවා'), s.indexOf('❌ AI vision:'));
        assert.ok(vis.includes('ai.splitLong(text)'), 'vision path has no splitLong');
        assert.ok(vis.includes('for (let i2 = 1'), 'no follow-up parts loop');
    });
    ok('bot.js: deep status text', () => {
        assert.ok(src('bot.js').includes('බලලා විස්තරේ ලියනවා'), 'status text not updated');
    });

    // ── live-ish: Gemini layer gets VISION_SYSTEM + deep default question + 4096 ──
    await okA('askVision (no question) → Gemini gets VISION_SYSTEM + deep default q + 4096 tokens', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([{ match: (u) => u.includes(':generateContent'), ...GEM_OK(LONG_REPLY) }]);
        const r = await ai.askVision('c1@test', '', { mime: 'image/jpeg', b64: IMG_B64 });
        const call = CALLS.find(c => c.u.includes(':generateContent'));
        assert.ok(call, 'no gemini call');
        const j = JSON.parse(call.body);
        assert.ok(j.systemInstruction?.parts?.[0]?.text?.includes('SUPER VISION'), 'systemInstruction is not VISION_SYSTEM');
        assert.strictEqual(j.generationConfig.maxOutputTokens, 4096);
        const qText = j.contents[j.contents.length - 1].parts[0].text;
        assert.ok(qText.includes(DEEP), 'default question not deep: ' + qText.slice(0, 60));
        assert.ok(qText.includes('ලියවිලි/text'), 'default q missing transcribe instruction');
        assert.ok(j.contents[j.contents.length - 1].parts[1].inline_data.data === IMG_B64, 'image not attached');
        assert.ok(r.text.includes('🔍'), 'deep reply mangled');
        assert.ok(r.model === 'Gemini vision');
    });
    await okA('askVision (specific question) → user question passes through verbatim', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([{ match: (u) => u.includes(':generateContent'), ...GEM_OK('උත්තර') }]);
        await ai.askVision('c2@test', 'මේ error එක fix කරන්නේ කොහොමද?', { mime: 'image/png', b64: IMG_B64 });
        const j = JSON.parse(CALLS.find(c => c.u.includes(':generateContent')).body);
        assert.strictEqual(j.contents[j.contents.length - 1].parts[0].text, 'මේ error එක fix කරන්නේ කොහොමද?', 'user question replaced');
    });
    await okA('Gemini 503 ladder → Groq gets VISION_SYSTEM + max_tokens 4096', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        ai.setKey('groq', 'GROQDUMMY');
        mockFetch([
            { match: (u) => u.includes(':generateContent'), status: 503, body: { error: { message: 'model overloaded' } } },
            { match: (u) => u.includes('api.groq.com'), ...GROQ_OK(LONG_REPLY) },
        ]);
        const r = await ai.askVision('c3@test', 'මොකක්ද මේක?', { mime: 'image/jpeg', b64: IMG_B64 });
        assert.ok(r.text.includes('🔍'), 'groq reply missing');
        const gc = JSON.parse(CALLS.find(c => c.u.includes('api.groq.com')).body);
        assert.strictEqual(gc.max_tokens, 4096, 'groq max_tokens not 4096');
        assert.ok(gc.messages[0].role === 'system' && gc.messages[0].content.includes('SUPER VISION'), 'groq system not VISION_SYSTEM');
        assert.ok(/llama-4-(scout|maverick)/.test(gc.model), 'groq model wrong');
    });
    await okA('Gemini+Groq dead → Pollinations gets VISION_SYSTEM msg + max_tokens 3072', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        ai.setKey('groq', 'GROQDUMMY');
        mockFetch([
            { match: (u) => u.includes(':generateContent'), status: 503, body: { error: { message: 'overloaded' } } },
            { match: (u) => u.includes('api.groq.com'), status: 403, body: 'forbidden' },
            { match: (u) => u.includes('gen.pollinations.ai'), ...POLLI_OK(LONG_REPLY) },
        ]);
        const r = await ai.askVision('c4@test', '', { mime: 'image/jpeg', b64: IMG_B64 });
        assert.ok(r.text.includes('🔍'), 'polli reply missing');
        assert.strictEqual(r.model, 'Pollinations vision');
        const pc = JSON.parse(CALLS.find(c => c.u.includes('gen.pollinations.ai')).body);
        assert.strictEqual(pc.max_tokens, 3072, 'polli max_tokens not 3072');
        assert.ok(pc.messages[0].role === 'system' && pc.messages[0].content.includes('SUPER VISION'), 'polli system msg missing');
        assert.ok(Array.isArray(pc.messages[1].content) && pc.messages[1].content.some(p => p.type === 'image_url'), 'polli image part missing');
    });
    await okA('all layers dead → friendly Sinhala busy error (no raw dump)', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([
            { match: (u) => u.includes(':generateContent'), status: 503, body: { error: { message: 'overloaded' } } },
            { match: (u) => u.includes('gen.pollinations.ai'), status: 502, body: 'bad gateway' },
        ]);
        try {
            await ai.askVision('c5@test', '', { mime: 'image/jpeg', b64: IMG_B64 });
            assert.fail('should have thrown');
        } catch (e) {
            assert.ok(/AI servers .*busy/.test(e.message), 'not the friendly error: ' + e.message.slice(0, 80));
            assert.ok(e.message.length < 300, 'error too long/leaky');
        }
    });
    await okA('PDF still routes Gemini-only (noGroq/Polli) with VISION_SYSTEM', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([{ match: (u) => u.includes(':generateContent'), ...GEM_OK('PDF සාරාංශය') }]);
        const r = await ai.askVision('c6@test', 'මේක සාරාංශ කරන්න', { mime: 'application/pdf', b64: IMG_B64 });
        assert.ok(r.text.includes('PDF'), 'pdf reply missing');
        assert.ok(!CALLS.some(c => c.u.includes('api.groq.com')), 'PDF leaked to Groq');
    });
    await okA('vision memory push keeps deep Q&A for follow-ups', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([
            { match: (u) => u.includes(':generateContent'), ...GEM_OK('මේක බල්ලෙක්') },
            { match: (u) => u.includes(':generateContent'), ...GEM_OK('පාට දෙකක්') },
        ]);
        await ai.askVision('c7@test', '', { mime: 'image/jpeg', b64: IMG_B64 });
        await ai.askVision('c7@test', 'පාට කීයද?', { mime: 'image/jpeg', b64: IMG_B64 });
        const j = JSON.parse(CALLS.findLast(c => c.u.includes(':generateContent')).body);
        assert.ok(j.contents.length >= 3, 'history not passed: ' + j.contents.length);
        assert.ok(j.contents.some(c => c.role === 'model' && c.parts[0].text === 'මේක බල්ලෙක්'), 'previous vision answer not in history');
    });

    console.log(`\n${'═'.repeat(46)}\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
