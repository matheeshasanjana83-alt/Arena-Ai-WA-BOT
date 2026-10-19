/**
 * test_v274.js — 🥊 GROK-CLASS ANSWERS (v2.74.0)
 * User: "තාම නෑ grok නිවැරැදි අපෙ එකා නෑ උට හරියට පහසුකම් ලබා දෙන්න."
 * (S2 ep3: bot said "The Door to Hell" + Yami/Mereoleona — WRONG title from v2.73 KB anchor; truth = ep3
 *  "Black Guardian" Oct 17 2026: Lilith & Naamah vs Nacht+Jack, Triad 100%, second giant devil → Clover,
 *  Julius ages himself + Damnatio Scale Magic, ASTA DEVIL UNION DEBUT (5-min) splits the devil)
 * ① anime_kb.js: S2 anchors CORRECTED (ep1 Battle Begins / ep2 Door to Hell / ep3 Black Guardian) + negative anchor
 * ② chat SYSTEM: "BE SHORT 1-4 lines" → adaptive ANSWER DEPTH (knowledge = numbered Grok-style, casual = short)
 * ③ WEB_RULES: DEPTH clause (no more "WhatsApp-short")
 * ④ 📖 PAGE-FETCH grounding: buildWebCtx reads top result PAGES (_readUrl) — real recap text, blocked domains skipped, ctxCache
 * ⑤ webQueries: "S2 ep3" → "season 2 episode 3" expand
 * ⑥ max_tokens 4096 (Gemini/Groq/Z.ai) · 3072 (Polli)
 * ⑦ bot.js auto-chat sends ALL splitLong parts (was [0] only)
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
    const H = new Map([['content-type', 'text/html; charset=utf-8']]);
    global.fetch = async (url, opts = {}) => {
        const u = String(url), body = opts.body || '';
        CALLS.push({ u, body: typeof body === 'string' ? body : '' });
        for (const r of ROUTES) if (r.match(u, body)) {
            const txt = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
            return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => txt, json: async () => JSON.parse(txt), headers: H };
        }
        return { ok: false, status: 599, text: async () => 'no route', json: async () => { throw new Error('no route'); }, headers: H };
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
const OA_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const POLLI_OK = OA_OK;
const DDG_HTML = `<html><body>
<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fblackclover.fandom.com%2Fwiki%2FBlack_Guardian&amp;rut=x">Black Guardian | Black Clover Wiki - Fandom</a>
<a class="result__snippet" href="#">Asta debuts Devil Union. Lilith and Naamah overwhelm Nacht and Jack.</a></div>
<div class="result"><a rel="nofollow" class="result__a" href="https://www.facebook.com/groups/bcrecaps">BC recap group</a>
<a class="result__snippet" href="#">facebook recap snip</a></div>
</body></html>`;
const FANDOM_PAGE = `<html><head><title>Black Guardian | Black Clover Wiki | Fandom</title></head><body><nav>${'menu junk '.repeat(90)}</nav><p>${'Nacht struggles to evade the twin devils Lilith and Naamah while the second giant devil attacks the Clover Kingdom. '.repeat(24)}Asta arrives in full Devil Union, which can now last 5 minutes, nullifies the devil's magic and splits it in half.</p></body></html>`;
const ddgRoute = () => ({ match: (u) => u.includes('duckduckgo'), body: DDG_HTML });
const fandomRoute = () => ({ match: (u) => u.includes('blackclover.fandom.com'), body: FANDOM_PAGE });
const forcePolli = (ai) => { for (const p of ['gemini', 'groq', 'zai']) ai.setKey(p, null); ai.setKey('polli', 'POLLIKEY'); };

(async () => {
    console.log('\n══ test_v274 — 🥊 GROK-CLASS ANSWERS ══\n');

    // ── ① KB: S2 anchors corrected ──
    ok('anime_kb.js: S2 anchors CORRECTED — ep3 = "Black Guardian" + full verified plot', () => {
        const bc = require('./anime_kb').BLACK_CLOVER;
        for (const fact of ['"Black Guardian"', 'The Battle Begins', '"The Door to Hell"', 'Oct 17, 2026', 'Lilith & Naamah', 'DEVIL UNION DEBUT', '5 MINUTES', 'Damnatio', 'AGES HIMSELF 10 years', 'True Lightning', 'Kienai Riy\u016b', 'Yellow Brick Road'])
            assert.ok(bc.includes(fact), 'missing: ' + fact);
        assert.ok(/"The Door to Hell" is EP 2's title/.test(bc), 'negative anchor missing');
        assert.ok(/NO "The Gate of the Underworld" episode title/.test(bc), 'Gate-of-Underworld negative anchor missing');
        // negative-anchor hygiene: title facts must be attributed to the right episode numbers
        assert.ok(/ep 2 \(172\) "The Door to Hell"/.test(bc), 'ep2 title mapping missing');
        assert.ok(/ep 3 \(173\) "Black Guardian"/.test(bc), 'ep3 title mapping missing');
    });

    ok('anime_kb.js: contextFor("black clover s2 ep3") → carries Black Guardian truth', () => {
        const kb = require('./anime_kb');
        const ctx = kb.contextFor('black clover s2 ep3 eka monawada wenne');
        assert.ok(ctx.includes('Black Guardian'), 'ctx missing ep3 truth');
        assert.ok(ctx.includes('ANIME KNOWLEDGE BASE'), 'ctx header missing');
    });

    // ── ② SYSTEM detail overhaul ──
    ok('chat SYSTEM: BE SHORT rule REMOVED → adaptive ANSWER DEPTH (numbered Grok-style)', () => {
        const ai = freshAi();
        assert.ok(!ai._system || true, 'noop');
        const srcAi = src('ai.js');
        assert.ok(!/^- BE SHORT like a friend texting on WhatsApp: 1-4 short lines by default\. NO long lectures/m.test(srcAi), 'BE SHORT rule still present');
        assert.ok(srcAi.includes('- ANSWER DEPTH (v2.74'), 'ANSWER DEPTH section missing');
        assert.ok(srcAi.includes('NUMBERED points (1. 2. 3. ...)'), 'numbered points rule missing');
        assert.ok(srcAi.includes('කෙටි සාරාංශය'), 'summary tail rule missing');
        assert.ok(srcAi.includes('Casual chat (greetings'), 'casual-short exception missing');
        assert.ok(srcAi.includes('"කෙටියෙන්" (shortly) → 1-2 lines max'), 'explicit-short override missing');
    });

    // ── ③ WEB_RULES depth ──
    ok('WEB_RULES: "WhatsApp-short" REMOVED → FULL DETAILED clause', () => {
        const srcAi = src('ai.js');
        assert.ok(!srcAi.includes('WhatsApp-short'), 'old WhatsApp-short rule still present');
        assert.ok(srcAi.includes('DEPTH: knowledge/episode questions get the FULL DETAILED treatment'), 'depth clause missing');
    });

    // ── ⑤ webQueries expansion ──
    ok('webQueries: "S2 ep3" → "season 2 episode 3" expand; ep-shape → recap-targeted 2nd slot; ep N normalized', () => {
        const ai = freshAi();
        const q1 = ai.webQueries('black clover S2 ep3 eka mokakda');
        assert.strictEqual(q1[0], 'black clover season 2 episode 3 eka mokakda', 's2ep3 not expanded: ' + q1[0]);
        assert.ok(q1[1] === 'black clover season 2 episode 3 eka mokakda recap plot summary', 'recap-targeted 2nd slot missing: ' + q1[1]);
        const q2 = ai.webQueries('black clover episode 160 monawada');
        assert.strictEqual(q2[0], 'black clover episode 160 monawada', 'already-expanded question must stay stable');
        const q3 = ai.webQueries('one piece ep 1120 eka');
        assert.strictEqual(q3[0], 'one piece episode 1120 eka', 'ep N normalize: ' + q3[0]);
        const q4 = ai.webQueries('who won the 2026 election news');
        assert.ok(!/recap/.test(q4.join(' ')), 'non-episode question must not get recap suffix');
    });

    // ── ④ page-fetch grounding ──
    ok('pageUrls: fandom/wiki/recap FIRST, login-wall domains (facebook/reddit/x) skipped, max 2', () => {
        const ai = freshAi();
        const lines = [
            '1. FB group\n   https://www.facebook.com/groups/123\n   snip',
            '2. Wiki\n   https://blackclover.fandom.com/wiki/Black_Guardian\n   snip',
            '3. X post\n   https://x.com/bc/status/1\n   snip',
            '4. CBR\n   https://www.cbr.com/black-clover-s2-ep3\n   snip',
            '5. Wiki2\n   https://en.wikipedia.org/wiki/Black_Clover_season_2\n   snip'
        ];
        const ai_tools = require('./ai_tools');
        // pageUrls is module-internal — verify behavior through buildWebCtx instead; here test PAGE_SKIP_RE indirectly via source
        const srcAi = src('ai.js');
        assert.ok(srcAi.includes('facebook|reddit|instagram|x|twitter|tiktok|youtube|pinterest|quora|linkedin'), 'PAGE_SKIP_RE missing');
        assert.ok(srcAi.includes('fandom|wiki|recap|review|cbr|crunchyroll|otaku|episode'), 'content-rich preference regex missing');
        assert.ok(typeof ai_tools._readUrl === 'function', '_readUrl not exported from ai_tools');
    });

    await okA('buildWebCtx: snippets + 📖 PAGE CONTENT (real recap text) + DEPTH rule', async () => {
        const ai = freshAi();
        mockFetch([ddgRoute(), fandomRoute()]);
        const ctx = await ai.buildWebCtx('black clover S2 ep3 eka mokakda');
        assert.ok(ctx.includes('🌍 LIVE WEB RESULTS'), 'header missing');
        assert.ok(ctx.includes('TRUTH RULES'), 'truth rules missing');
        assert.ok(ctx.includes('📖 PAGE CONTENT'), 'page content block missing');
        assert.ok(ctx.includes('Black Guardian | Black Clover Wiki'), 'page title missing');
        assert.ok(ctx.includes('Lilith and Naamah'), 'page recap text missing');
        assert.ok(!ctx.includes('menu junk menu junk menu junk menu junk menu junk menu junk'), 'nav junk not windowed out (junk > 600c must be cut)');
        const pgIdx = ctx.indexOf('📖 PAGE CONTENT');
        assert.ok(!ctx.slice(pgIdx).includes('facebook'), 'blocked-domain used for page fetch');   // snippets may list fb — only PAGE FETCH must skip it
        assert.ok(ctx.includes('FULL DETAILED'), 'DEPTH rule missing in ctx');
    });

    await okA('buildWebCtx: page fetch fails (599) → graceful, snippets still returned', async () => {
        const ai = freshAi();
        mockFetch([ddgRoute()]);   // fandom → 599 no route
        const ctx = await ai.buildWebCtx('black clover S2 ep3 monawada wenne 2');
        assert.ok(ctx.includes('🌍 LIVE WEB RESULTS'), 'snippets lost when pages fail');
        assert.ok(!ctx.includes('📖 PAGE CONTENT'), 'page block should be absent');
    });

    await okA('ctxCache: same question twice → DDG + fandom fetched ONCE each', async () => {
        const ai = freshAi();
        mockFetch([ddgRoute(), fandomRoute(), { match: (u) => u.includes('pollinations'), ...POLLI_OK('උත්තර') }]);
        forcePolli(ai);
        await ai.ask('ka-g1@test', 'black clover S2 ep3 eka monawada wenne');
        const n1 = CALLS.filter(c => c.u.includes('duckduckgo')).length, f1 = CALLS.filter(c => c.u.includes('fandom')).length;
        await ai.ask('ka-g1@test', 'black clover S2 ep3 eka monawada wenne');
        const n2 = CALLS.filter(c => c.u.includes('duckduckgo')).length, f2 = CALLS.filter(c => c.u.includes('fandom')).length;
        assert.strictEqual(n2, n1, 'DDG re-called: ' + n1 + '→' + n2);
        assert.strictEqual(f2, f1, 'page re-fetched: ' + f1 + '→' + f2);
        assert.ok(n1 >= 1 && f1 >= 1, 'nothing fetched at all');
    });

    // ── ask() e2e: 📖 page content reaches provider context ──
    await okA('ask() polli path → system msgs carry KB + WEB + 📖 PAGE CONTENT; max_tokens 3072', async () => {
        const ai = freshAi();
        forcePolli(ai);
        mockFetch([ddgRoute(), fandomRoute(), { match: (u) => u.includes('pollinations'), ...POLLI_OK('S2 ep3 උත්තරය') }]);
        const r = await ai.ask('ka-g2@test', 'black clover S2 ep3 eka monawada wenne');
        assert.ok(/S2 ep3 උත්තරය/.test(r.text), 'answer missing');
        const body = JSON.parse(CALLS.find(c => c.u.includes('pollinations')).body);
        const sysMsgs = body.messages.filter(m => m.role === 'system');
        assert.ok(sysMsgs.some(m => m.content.includes('ANIME KNOWLEDGE BASE')), 'KB system msg missing');
        const web = sysMsgs.find(m => m.content.includes('fresher than any KB or memory'));   // unique WEB_OVERRIDE header (KB rule 1b also contains literal 'LIVE WEB RESULTS' — v2.73 gotcha)
        assert.ok(web, 'WEB system msg missing');
        assert.ok(web.content.includes('Black Guardian'), 'ep3 truth not in web ctx');
        assert.ok(web.content.includes('📖 PAGE CONTENT'), 'page content missing from polli ctx');
        assert.strictEqual(body.max_tokens, 3072, 'polli max_tokens not 3072: ' + body.max_tokens);
    });

    // ── ⑥ max_tokens pins ──
    await okA('max_tokens: Gemini 4096 · Groq 4096 · Z.ai 4096 (Grok-class detail)', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY'); ai.setKey('groq', 'DUMMY'); ai.setKey('zai', 'DUMMY'); ai.setKey('polli', null);
        mockFetch([
            { match: (u) => u.includes(':generateContent'), ...GEM_OK('g') },
            { match: (u) => u.includes('api.groq.com'), ...OA_OK('q') },
            { match: (u) => u.includes('api.z.ai'), ...OA_OK('z') }
        ]);
        await ai.ask('ka-g3@test', 'hi');
        const gBody = JSON.parse(CALLS.find(c => c.u.includes(':generateContent')).body);
        assert.strictEqual(gBody.generationConfig.maxOutputTokens, 4096, 'gemini tokens');
        await ai.ask('ka-g3b@test', 'hi2');
        const qBody = JSON.parse(CALLS.find(c => c.u.includes('api.groq.com')).body);
        assert.strictEqual(qBody.max_tokens, 4096, 'groq tokens');
        await ai.ask('ka-g3c@test', 'hi3');
        const zBody = JSON.parse(CALLS.find(c => c.u.includes('api.z.ai')).body);
        assert.strictEqual(zBody.max_tokens, 4096, 'zai tokens');
    });

    // ── vision untouched ──
    ok('VISION_SYSTEM untouched (vision depth separate from chat depth)', () => {
        const ai = freshAi();
        assert.ok(ai.VISION_SYSTEM.includes('SUPER VISION'), 'vision brain missing');
        assert.ok(!ai.VISION_SYSTEM.includes('ANSWER DEPTH (v2.74'), 'chat depth leaked into vision');
        const srcAi = src('ai.js');
        assert.ok(/askVision[\s\S]*?maxOutputTokens: 4096/.test(srcAi), 'vision gemini budget changed');
    });

    // ── ⑦ bot.js wiring ──
    ok('bot.js: auto-chat sends ALL splitLong parts (was [0] only) + .ai path still splits', () => {
        const b = src('bot.js');
        assert.ok(b.includes('const ps = ai.splitLong(out)'), 'auto-chat all-parts missing');
        assert.ok(!/ai\.splitLong\(out\)\[0\]/.test(b), 'old [0]-only truncation still present');
        assert.ok(b.includes('const parts = ai.splitLong(text)'), '.ai command path split missing');
        assert.ok(b.includes('🔎 අන්තර්ජාලයෙන් ඇත්ත හොයලා බලනවා'), 'search status missing');
    });

    // ── needsWeb regression guard ──
    ok('needsWeb: anime/fact still trigger; hi/image-asks/roast-immune cases still quiet', () => {
        const ai = freshAi();
        for (const q of ['black clover S2 ep3 eka mokakda', 'black clover season 2 episode 3', 'one piece 2027', 'asta devil union kohomada']) assert.ok(ai.needsWeb(q), 'should trigger: ' + q);
        for (const q of ['hi', 'menu', 'photo එකක් හදලා දීන්න cat', 'kohomada ඔයාට']) assert.ok(!ai.needsWeb(q), 'should NOT trigger: ' + q);
    });

    ok('version 2.74.0 pins + manifest notes', () => {
        assert.strictEqual(JSON.parse(src('package.json')).version, '2.74.0', 'package version');
        assert.strictEqual(JSON.parse(src('manifest.json')).version, '2.74.0', 'manifest version');
        assert.ok(src('manifest.json').includes('GROK-CLASS'), 'manifest notes missing');
    });

    console.log(`\n══ ${pass} passed, ${fail} failed ══\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAIL:', e); process.exit(1); });
