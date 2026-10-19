/**
 * test_v270.js — Vision 503 fix (v2.70.0)
 * User: "මේ ai photo බලනකොට error එකක් එනවා බන් හරියට හදපන්කො" (screenshot: Gemini 503 model overloaded)
 * Root cause: askVision() = single Gemini call, NO model ladder, NO provider fallback → 503 dumped raw to chat.
 * Fix: ① Gemini ladder refresh (2.5/2.0-flash decommissioned 2026-10 → 3.8-flash + 3.1-flash-lite)
 *      ② askGemini transient 503/429/500 → next model (text path too)
 *      ③ askVision chain: Gemini ladder → Groq llama-4 vision (viaPool geo) → Pollinations (baked key) → friendly Sinhala error
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

// ── mock fetch plumbing ──
const REAL_FETCH = global.fetch;
let ROUTES = [];          // [{match(url,body), status, body}]
let CALLS = [];
function mockFetch(routes) {
    ROUTES = routes; CALLS = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        const body = opts.body || '';
        CALLS.push({ u, body: typeof body === 'string' ? body : '' });
        for (const r of ROUTES) {
            if (r.match(u, body)) {
                if (r.pool) return REAL_FETCH(url, opts);      // viaPool passthrough (should NOT happen in tests — net pool is external)
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
process.on('exit', () => restoreSettings());   // process.exit() skips .finally — restore MUST survive it

function freshAi() {
    for (const k of Object.keys(require.cache)) if (/\\(ai|pollinations|net|ai_tools)\.js$/.test(k)) delete require.cache[k];
    return require('./ai');
}
const GEM_URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const GEM_OK = (text) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const POLLI_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

(async () => {
    process.env.PROXY_POOL = '0';   // hermetic — viaPool → NO_POOL instantly (no real network)
    // write temp settings: fake keys so all providers get tried
    fs.writeFileSync(path.join(R, 'settings.json'), JSON.stringify({ gemini: 'AIzaTest', groq: 'gskTest', polli: 'skTest', aiMode: 'on', aiChat: 'off', proxyPool: false }));

    // ── ① static pins — ladder refresh + chain structure ──
    ok('ai.js: GEMINI_MODELS refreshed — dead 2.5/2.0-flash OUT, 3.8-flash + 3.1-flash-lite IN', () => {
        const s = src('ai.js');
        assert.ok(!/GEMINI_MODELS\s*=\s*\[[^\]]*gemini-2\.5-flash/.test(s), 'dead gemini-2.5-flash still in ladder');
        assert.ok(!/GEMINI_MODELS\s*=\s*\[[^\]]*gemini-2\.0-flash/.test(s), 'dead gemini-2.0-flash still in ladder');
        assert.ok(s.includes("'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'"), 'new ladder missing');
    });
    ok('ai.js: askGemini transient retry — 429/500/503 continue to next model', () => {
        const s = src('ai.js');
        assert.ok(/\[429, 500, 503\]\.includes\(lastErr\.status\)\) continue/.test(s.replace(/\n/g, ' ')), 'askGemini transient ladder missing');
    });
    ok('ai.js: GROQ_VISION_MODELS llama-4 scout+maverick pinned', () => {
        const s = src('ai.js');
        assert.ok(s.includes('meta-llama/llama-4-scout-17b-16e-instruct'), 'scout missing');
        assert.ok(s.includes('meta-llama/llama-4-maverick-17b-128e-instruct'), 'maverick missing');
    });
    ok('pollinations.js: chat() max_tokens option wired into body', () => {
        const s = src('pollinations.js');
        assert.ok(s.includes('max_tokens = 0'), 'option default missing');
        assert.ok(s.includes('...(max_tokens ? { max_tokens } : {})'), 'body spread missing');
    });
    ok('bot.js: vision status text neutral (not Gemini-only)', () => {
        // v2.71 SUPER VISION: status upgraded to deep-vision text — assert current + old gone
        assert.ok(src('bot.js').includes('බලලා විස්තරේ ලියනවා'), 'status text not updated (v2.71 deep vision)');
    });

    // ── ② LIVE behavior — Gemini ladder survives 503 ──
    await okA('vision: Gemini 503 on flash-latest → 3.8-flash answers (ladder works)', async () => {
        mockFetch([
            { match: (u) => u.includes('gemini-flash-latest'), status: 503, body: { error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } } },
            { match: (u) => u.includes('gemini-3.8-flash'), status: 200, body: { candidates: [{ content: { parts: [{ text: 'cat picture' }] } }] } },
        ]);
        const ai = freshAi();
        const r = await ai.askVision('c1', 'මේක මොකක්ද?', { mime: 'image/jpeg', b64: IMG_B64 });
        assert.strictEqual(r.model, 'Gemini vision');
        assert.ok(r.text.includes('cat picture'), 'wrong text');
        assert.strictEqual(CALLS.filter(c => c.u.includes('generateContent')).length, 2, 'expected 2 gemini calls');
    });

    await okA('vision: whole Gemini ladder 503 → Groq llama-4-scout fallback answers', async () => {
        mockFetch([
            { match: (u) => u.includes('generativelanguage.googleapis.com'), status: 503, body: { error: { code: 503, message: 'The model is overloaded.' } } },
            { match: (u, b) => u === GROQ_URL && b.includes('scout'), status: 200, body: { choices: [{ message: { content: 'groq saw a cat' } }] } },
        ]);
        const ai = freshAi();
        const r = await ai.askVision('c2', 'what is this?', { mime: 'image/jpeg', b64: IMG_B64 });
        assert.ok(/Groq vision/.test(r.model), 'model should be Groq vision, got ' + r.model);
        assert.ok(r.text.includes('groq saw a cat'));
        assert.ok(CALLS.some(c => c.u === GROQ_URL && c.body.includes('image_url')), 'groq call must carry image_url data URI');
    });

    await okA('vision: Gemini + Groq dead → Pollinations baked-key vision answers', async () => {
        mockFetch([
            { match: (u) => u.includes('generativelanguage.googleapis.com'), status: 503, body: { error: { code: 503, message: 'overloaded' } } },
            { match: (u) => u.includes('api.groq.com'), status: 403, body: { error: { message: 'Forbidden' } } },
            { match: (u) => u.includes('gen.pollinations.ai/v1/chat/completions'), status: 200, body: { choices: [{ message: { content: 'polli saw a cat' } }] } },
        ]);
        const ai = freshAi();
        const r = await ai.askVision('c3', 'what is this?', { mime: 'image/jpeg', b64: IMG_B64 });
        assert.strictEqual(r.model, 'Pollinations vision');
        assert.ok(r.text.includes('polli saw a cat'));
        const pc = CALLS.find(c => c.u.includes('gen.pollinations.ai'));
        assert.ok(pc.body.includes('"max_tokens":3072'), 'polli vision must send max_tokens 3072 (v2.71 deep)');
        assert.ok(pc.body.includes('image_url'), 'polli vision must carry image part');
    });

    await okA('vision: ALL providers dead → friendly Sinhala busy error (no raw 503 dump)', async () => {
        mockFetch([
            { match: (u) => u.includes('generativelanguage.googleapis.com'), status: 503, body: { error: { code: 503, message: 'The model is overloaded. Please try again later.' } } },
            { match: (u) => u.includes('api.groq.com'), status: 403, body: { error: { message: 'Forbidden' } } },
            { match: (u) => u.includes('gen.pollinations.ai'), status: 502, body: 'bad gateway' },
        ]);
        const ai = freshAi();
        try {
            await ai.askVision('c4', 'බලන්න', { mime: 'image/jpeg', b64: IMG_B64 });
            throw new Error('should have thrown');
        } catch (e) {
            assert.ok(/busy.*try කරන්න|ටිකක් busy/s.test(e.message), 'not friendly: ' + e.message.slice(0, 80));
            assert.ok(!/^Gemini 503/.test(e.message), 'raw 503 leaked: ' + e.message.slice(0, 60));
        }
    });

    await okA('vision: PDF + gemini dead → NO groq/polli calls (images only) + friendly error', async () => {
        mockFetch([
            { match: (u) => u.includes('generativelanguage.googleapis.com'), status: 503, body: { error: { code: 503, message: 'overloaded' } } },
            { match: () => true, status: 200, body: { choices: [{ message: { content: 'WRONG PATH' } }] } },
        ]);
        const ai = freshAi();
        try {
            await ai.askVision('c5', 'pdf?', { mime: 'application/pdf', b64: IMG_B64 });
            throw new Error('should have thrown');
        } catch (e) {
            assert.ok(/busy/.test(e.message), 'pdf all-dead should be friendly busy, got: ' + e.message.slice(0, 60));
        }
        assert.ok(!CALLS.some(c => c.u.includes('api.groq.com') || c.u.includes('gen.pollinations.ai')), 'PDF must NOT hit groq/polli');
    });

    await okA('vision: PDF + groq/polli route present but gemini answers → single gemini call', async () => {
        mockFetch([
            { match: (u) => u.includes('gemini-flash-latest'), status: 200, body: { candidates: [{ content: { parts: [{ text: 'pdf read ok' }] } }] } },
            { match: () => true, status: 200, body: { choices: [{ message: { content: 'WRONG' } }] } },
        ]);
        const ai = freshAi();
        const r = await ai.askVision('c6', 'read', { mime: 'application/pdf', b64: IMG_B64 });
        assert.strictEqual(r.model, 'Gemini vision');
        assert.ok(CALLS.every(c => !c.u.includes('api.groq.com')), 'no groq needed');
    });

    await okA('vision: PDF + no gemini key → noGemini flag (bot.js hint path)', async () => {
        mockFetch([{ match: () => true, status: 200, body: { choices: [{ message: { content: 'WRONG' } }] } }]);
        for (const k of Object.keys(require.cache)) if (/\\(ai|pollinations|net|ai_tools)\.js$/.test(k)) delete require.cache[k];
        fs.writeFileSync(path.join(R, 'settings.json'), JSON.stringify({ groq: 'gskTest', polli: 'skTest', proxyPool: false }));
        const ai = require('./ai');
        try {
            await ai.askVision('c7', 'pdf?', { mime: 'application/pdf', b64: IMG_B64 });
            throw new Error('should have thrown');
        } catch (e) {
            assert.ok(e.noGemini === true, 'noGemini flag missing: ' + e.message.slice(0, 80));
            assert.ok(/Gemini key/.test(e.message));
        }
        assert.ok(!CALLS.some(c => c.u.includes('api.groq.com')), 'PDF never hits groq');
        fs.writeFileSync(path.join(R, 'settings.json'), JSON.stringify({ gemini: 'AIzaTest', groq: 'gskTest', polli: 'skTest', aiMode: 'on', aiChat: 'off', proxyPool: false }));   // restore for later tests
    });

    await okA('vision: vision memory — answer lands in history store (provider මොකක වුණත්)', async () => {
        mockFetch([
            { match: (u) => u.includes('generativelanguage.googleapis.com'), status: 503, body: { error: { message: 'overloaded' } } },
            { match: (u) => u.includes('api.groq.com'), status: 403, body: { error: { message: 'Forbidden' } } },
            { match: (u) => u.includes('gen.pollinations.ai'), status: 200, body: { choices: [{ message: { content: 'mem check ok' } }] } },
        ]);
        const ai = freshAi();
        await ai.askVision('c8', 'remember this pic', { mime: 'image/jpeg', b64: IMG_B64 });
        const st = ai.stats('c8');
        assert.ok(st.msgs >= 2, 'memory not stored — msgs=' + st.msgs);
    });

    await okA('vision: image ask carries inline_data + question (gemini request body sanity)', async () => {
        mockFetch([
            { match: (u) => u.includes('gemini-flash-latest'), status: 200, body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } },
        ]);
        const ai = freshAi();
        await ai.askVision('c9', 'මේ පික් එකේ මොකද තියෙන්නේ?', { mime: 'image/png', b64: IMG_B64 });
        const c = CALLS.find(x => x.u.includes('gemini-flash-latest'));
        assert.ok(c.body.includes('"inline_data"') && c.body.includes('image/png'), 'inline_data missing');
        assert.ok(c.body.includes('මේ පික් එකේ'), 'question missing');
        assert.ok(c.body.includes('"systemInstruction"'), 'system prompt missing');
    });

    // ── ③ text path — askGemini transient ladder ──
    await okA('text: .ai ask — gemini 503 ×2 → 3rd model answers (no groq needed)', async () => {
        mockFetch([
            { match: (u) => u.includes('gemini-flash-latest') || u.includes('gemini-3.8-flash'), status: 503, body: { error: { code: 503, message: 'overloaded' } } },
            { match: (u) => u.includes('gemini-flash-lite-latest'), status: 200, body: { candidates: [{ content: { parts: [{ text: 'lite උත්තර' }] } }] } },
        ]);
        const ai = freshAi();
        const r = await ai.ask('c10', 'hello test');
        assert.ok(r.text.includes('lite උත්තර'), 'text answer wrong');
        assert.ok(/Gemini gemini-flash-lite-latest/.test(r.model), 'model: ' + r.model);
    });

    await okA('text: gemini bad key 400 → hard throw reaches provider chain (groq answers)', async () => {
        mockFetch([
            { match: (u) => u.includes('generativelanguage.googleapis.com'), status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } },
            { match: (u) => u.includes('api.groq.com'), status: 200, body: { choices: [{ message: { content: 'groq text ok' } }] } },
        ]);
        const ai = freshAi();
        const r = await ai.ask('c11', 'hello again');
        assert.ok(r.text.includes('groq text ok'), 'groq fallback failed: ' + r.model);
    });

    // ── ④ version pins ──
    const pkg = JSON.parse(fs.readFileSync(path.join(R, 'package.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(R, 'manifest.json'), 'utf8'));
    ok('versions: package+manifest 2.70.0; manifest files += test_v270', () => {
        assert.strictEqual(pkg.version, '2.70.0');
        assert.strictEqual(man.version, '2.70.0');
        for (const f of ['test_v270.js', 'pollinations.js', 'ai.js']) assert.ok(man.files.includes(f), 'manifest files missing ' + f);
        assert.ok((man.removed || []).includes('test_v269.js'), 'removed missing test_v269.js');
    });

    console.log(`\n==== test_v270: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
})().finally(() => {
    global.fetch = REAL_FETCH;
    restoreSettings();
});
