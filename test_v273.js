/**
 * test_v273.js — 🌍 LIVE WEB GROUNDING (v2.73.0)
 * User: "grok එකෙ හොදට ඇත්ත කියනවා මූ හරියට කියන්නෙ නෑ එක බලලා හදපන්"
 * (screenshot proof: bot hallucinated ep160 "Royal Capital Battle" — truth = "The Messenger from the Spade Kingdom")
 * ① ai.js: needsWeb/webQueries/cachedSearch/buildWebCtx → WEB_OVERRIDE into sysOf + askPolli system msg
 * ② TRUTH RULES: facts from web/KB only, conflict → web wins, else honest "100% sure නෑ"
 * ③ anime_kb.js: BC EPISODE ANCHORS + S2 weekly progress (web-verified)
 * ④ bot.js: '🔎 අන්තර්ජාලයෙන් ඇත්ත හොයලා බලනවා' status via ai.needsWeb
 * ⑤ graceful: search fail → KB-only answer, roast immune, 6h cache
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = __dirname;
let pass = 0, fail = 0;
const ok = (name, fn) => {
    try { fn(); pass++; console.log('  ✅', name); }
    catch (e) { fail++; console.log('  ❌', name, '—', e.message.slice(0, 170)); }
};
const okA = async (name, fn) => fn().then(() => { pass++; console.log('  ✅', name); }, (e) => { fail++; console.log('  ❌', name, '—', String(e.message).slice(0, 170)); });
const src = (f) => fs.readFileSync(path.join(R, f), 'utf8');

const REAL_FETCH = global.fetch;
let ROUTES = [], CALLS = [];
function mockFetch(routes) {
    ROUTES = routes; CALLS = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url), body = opts.body || '';
        CALLS.push({ u, body: typeof body === 'string' ? body : '' });
        for (const r of ROUTES) if (r.match(u, body)) {
            const txt = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
            return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => txt, json: async () => JSON.parse(txt), headers: new Map() };
        }
        return { ok: false, status: 599, text: async () => 'no route', json: async () => { throw new Error('no route'); }, headers: new Map() };
    };
}
const SETTINGS_PATH = path.join(R, 'settings.json');
const settingsBackup = fs.existsSync(SETTINGS_PATH) ? fs.readFileSync(SETTINGS_PATH, 'utf8') : null;
process.on('exit', () => { if (settingsBackup !== null) fs.writeFileSync(SETTINGS_PATH, settingsBackup); else { try { fs.unlinkSync(SETTINGS_PATH); } catch { } } });
function freshAi() {
    for (const k of Object.keys(require.cache)) if (/\/(ai|pollinations|net|ai_tools|anime_kb)\.js$/.test(k)) delete require.cache[k];
    return require('./ai');
}

const GEM_OK = (text) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
const POLLI_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const DDG_HTML = `<html><body>
<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fblackclover.fandom.com%2Fwiki%2FEpisode_160&amp;rut=x">Episode 160 - Black Clover Wiki - Fandom</a>
<a class="result__snippet" href="#">The Messenger from the Spade Kingdom. Yuno starts questioning Ralph... Zenon attacks the Golden Dawn HQ.</a></div>
<div class="result"><a rel="nofollow" class="result__a" href="https://www.imdb.com/title/tt13654316">"Black Clover" The Messenger from the Spade Kingdom</a>
<a class="result__snippet" href="#">Ralph tells Yuno to take a look at his past while Zenon Zogratis attacks the Golden Dawn HQ.</a></div>
</body></html>`;
const ddgRoute = () => ({ match: (u) => u.includes('duckduckgo'), body: DDG_HTML });
const forcePolli = (ai) => { for (const p of ['gemini', 'groq', 'zai']) ai.setKey(p, null); ai.setKey('polli', 'POLLIKEY'); };

(async () => {
    console.log('\n══ test_v273 — 🌍 LIVE WEB GROUNDING ══\n');

    // ── KB: verified episode anchors + S2 progress ──
    ok('anime_kb.js: BC EPISODE ANCHORS + S2 WEEKLY PROGRESS (web-verified 2026-10)', () => {
        const bc = require('./anime_kb').BLACK_CLOVER;
        for (const fact of ['EPISODE ANCHORS S1', 'The Messenger from the Spade Kingdom', 'SPADE PRINCE', 'King Loyce', 'Golden Dawn HQ', 'The Five-Leaf Clover', 'S2 WEEKLY PROGRESS', 'The Gate of the Underworld', 'The Door to Hell', 'Oct 17, 2026'])
            assert.ok(bc.includes(fact), 'missing: ' + fact);
        assert.ok(/NO "Royal Capital Battle" at ep 160/.test(bc), 'anti-hallucination anchor missing');
        assert.ok(!/Royal Capital Battle.*160\s*[-—]\s/.test(bc.replace(/NO "Royal Capital Battle" at ep 160/g, '')), 'false anchor leaked');
    });

    // ── needsWeb ──
    ok('needsWeb: anime topics always; fact/search questions; NOT hi/image-asks', () => {
        const ai = freshAi();
        for (const q of ['black clover episode 160 eka monawada wenne', 'asta ගේ powers මොනවද', 'one piece 2027 return', 'one piece latest episode', 'sri lanka president 2026 who won', 'weather colombo eka search karanna', 'google black clover season 2'])
            assert.ok(ai.needsWeb(q), 'should trigger: ' + q);
        for (const q of ['hi', 'menu', 'photo එකක් හදලා දීන්න cat', '.imagine a cat', 'kohomada ඔයාට', 'short'])
            assert.ok(!ai.needsWeb(q), 'should NOT trigger: ' + q);
    });

    // ── webQueries cleanup ──
    ok('webQueries: ANIME EXPERT MODE prefix + """blocks strip; latin + raw', () => {
        const ai = freshAi();
        const q1 = ai.webQueries('ANIME EXPERT MODE — anime+manga දෙකම cover කරන්න: black clover episode 160?');
        assert.deepStrictEqual(q1, ['black clover episode 160'], 'prefix/? strip fail: ' + JSON.stringify(q1));
        const q2 = ai.webQueries('මේක බලන්න"""some long quoted text""" black clover');
        assert.ok(!q2.some(s => s.includes('quoted text')), 'quoted block not stripped');
        const q3 = ai.webQueries('black clover episode 160 මොකද වෙන්නේ?');
        assert.strictEqual(q3.length, 2, 'latin+raw split: ' + JSON.stringify(q3));
        assert.ok(/black clover/.test(q3[0]), 'latin first');
    });

    // ── buildWebCtx with mocked DDG ──
    await okA('buildWebCtx: DDG html parsed → LIVE WEB RESULTS + TRUTH RULES + uddg-decoded url', async () => {
        const ai = freshAi();
        mockFetch([ddgRoute()]);
        const ctx = await ai.buildWebCtx('black clover episode 160 monawada wenne');
        assert.ok(ctx.includes('🌍 LIVE WEB RESULTS'), 'header missing');
        assert.ok(ctx.includes('TRUTH RULES'), 'truth rules missing');
        assert.ok(ctx.includes('https://blackclover.fandom.com/wiki/Episode_160'), 'uddg decode fail');
        assert.ok(ctx.includes('Messenger from the Spade Kingdom'), 'snippet missing');
        assert.ok(ctx.includes('NEVER invent'), 'anti-invent rule missing');
        assert.ok(ctx.includes('100% sure නෑ'), 'honest-fallback rule missing');
    });

    // ── ask() end-to-end (polli path) ──
    await okA('ask() anime ep question → DDG searched + KB & WEB both in polli system msgs', async () => {
        const ai = freshAi();
        forcePolli(ai);
        mockFetch([ddgRoute(), { match: (u) => u.includes('pollinations'), ...POLLI_OK('ep 160 උත්තරය') }]);
        const r = await ai.ask('ka-w1@test', 'black clover episode 160 eka monawada wenne');
        assert.ok(/ep 160 උත්තරය/.test(r.text), 'answer missing');
        assert.ok(CALLS.some(c => c.u.includes('duckduckgo')), 'DDG not called');
        const body = JSON.parse(CALLS.find(c => c.u.includes('pollinations')).body);
        const sysMsgs = body.messages.filter(m => m.role === 'system');
        assert.ok(sysMsgs.some(m => m.content.includes('ANIME KNOWLEDGE BASE')), 'KB system msg missing');
        assert.ok(sysMsgs.some(m => m.content.includes('LIVE WEB RESULTS') && m.content.includes('Messenger from the Spade Kingdom')), 'WEB system msg missing');
        assert.ok(body.messages.some(m => m.role === 'user' && /episode 160/.test(m.content)), 'user question missing');
    });

    await okA('ask() "hi" → NO search calls (zero DDG)', async () => {
        const ai = freshAi();
        forcePolli(ai);
        mockFetch([{ match: (u) => u.includes('pollinations'), ...POLLI_OK('හායි! 😊') }]);
        await ai.ask('ka-w2@test', 'hi ඔයාට කොහොමද?');
        assert.ok(!CALLS.some(c => c.u.includes('duckduckgo')), 'DDG called for greeting!');
        const body = JSON.parse(CALLS.find(c => c.u.includes('pollinations')).body);
        assert.ok(!body.messages.some(m => (m.content || '').includes('LIVE WEB RESULTS')), 'WEB leaked into greeting');
    });

    await okA('ask() roast insult (has 2026 trigger word) → NO search, roast reply (immune)', async () => {
        const ai = freshAi();
        forcePolli(ai);
        mockFetch([{ match: (u) => u.includes('pollinations'), ...POLLI_OK('බැන්නට කමින් නෑ 😂') }]);
        const r = await ai.ask('ka-w3@test', '2026 වලදීත් ඔයා මෙට්ට බන්, හරකා');
        assert.ok(!CALLS.some(c => c.u.includes('duckduckgo')), 'DDG called during roast!');
        assert.ok(r.text.includes('බැන්නට'), 'roast reply missing');
    });

    await okA('search totally fails → graceful: answer still comes, NO WEB context', async () => {
        const ai = freshAi();
        forcePolli(ai);
        mockFetch([{ match: (u) => u.includes('pollinations'), ...POLLI_OK('KB එකෙන් උත්තර') }]);   // DDG → 599 no-route
        const r = await ai.ask('ka-w4@test', 'black clover episode 160 eka monawada wenne');
        assert.ok(r.text.includes('KB එකෙන්'), 'answer missing');
        assert.ok(CALLS.some(c => c.u.includes('duckduckgo')), 'DDG should have been attempted');
        const body = JSON.parse(CALLS.find(c => c.u.includes('pollinations')).body);
        assert.ok(!body.messages.some(m => (m.content || '').includes('fresher than any KB or memory')), 'WEB context leaked despite search fail');
        assert.ok(body.messages.some(m => m.role === 'system' && m.content.includes('ANIME KNOWLEDGE BASE')), 'KB should still be there');
    });

    await okA('6h cache: same question twice → DDG called ONCE', async () => {
        const ai = freshAi();
        forcePolli(ai);
        mockFetch([ddgRoute(), { match: (u) => u.includes('pollinations'), ...POLLI_OK('උත්තර') }]);
        await ai.ask('ka-w5@test', 'black clover episode 160 eka monawada wenne');
        const d1 = CALLS.filter(c => c.u.includes('duckduckgo')).length;
        await ai.ask('ka-w5@test', 'black clover episode 160 eka monawada wenne');
        const d2 = CALLS.filter(c => c.u.includes('duckduckgo')).length;
        assert.strictEqual(d2, d1, 'cache miss on repeat: ' + d1 + '→' + d2);
        assert.ok(d1 >= 1, 'no DDG at all');
    });

    // ── Gemini path: WEB lands in systemInstruction ──
    await okA('ask() gemini path → systemInstruction contains KB + LIVE WEB RESULTS', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY'); for (const p of ['groq', 'zai', 'polli']) ai.setKey(p, null);
        mockFetch([ddgRoute(), { match: (u) => u.includes(':generateContent'), ...GEM_OK('gemini උත්තර') }]);
        await ai.ask('ka-w6@test', 'one piece latest episode කීයද?');
        const sys = JSON.parse(CALLS.find(c => c.u.includes(':generateContent')).body).systemInstruction.parts[0].text;
        assert.ok(sys.includes('ANIME KNOWLEDGE BASE'), 'KB missing in gemini sys');
        assert.ok(sys.includes('LIVE WEB RESULTS') && sys.includes('Messenger from the Spade Kingdom'), 'WEB missing in gemini sys');
        assert.ok(sys.includes('TRUTH RULES'), 'truth rules missing in gemini sys');
    });

    // ── bot.js wiring ──
    ok('bot.js: search status text + ai.needsWeb routing', () => {
        const b = src('bot.js');
        assert.ok(b.includes('🔎 අන්තර්ජාලයෙන් ඇත්ත හොයලා බලනවා'), 'search status missing');
        assert.ok(b.includes('ai.needsWeb(question)'), 'needsWeb not used in bot.js');
        assert.ok(/needsWeb\(question\)\)\s*\?\s*['`]🔎/.test(b), 'status not conditional');
    });

    // ── no cross-contamination of old tests' expectations ──
    ok('VISION_SYSTEM untouched by web grounding (vision stays separate)', () => {
        const ai = freshAi();
        assert.ok(!ai.VISION_SYSTEM.includes('LIVE WEB RESULTS'), 'web ctx leaked into VISION_SYSTEM');
        assert.ok(ai.VISION_SYSTEM.includes('SUPER VISION'), 'vision brain missing');
    });

    ok('version 2.74.0 in package.json + manifest.json', () => {
        assert.strictEqual(JSON.parse(src('package.json')).version, '2.74.0', 'package version');   // v2.74 pin modernized
        assert.strictEqual(JSON.parse(src('manifest.json')).version, '2.74.0', 'manifest version');
        assert.ok(src('manifest.json').includes('LIVE WEB GROUNDING'), 'manifest notes missing');
    });

    console.log(`\n══ ${pass} passed, ${fail} failed ══\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAIL:', e); process.exit(1); });
