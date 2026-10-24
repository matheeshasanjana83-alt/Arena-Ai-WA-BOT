/**
 * test_v272.js — 🎌 ANIME KNOWLEDGE BASE (v2.72.0)
 * User: "anime ගැන ගොඩක් දැනුමක් — විශේෂයෙන් Black Clover — anime+manga දෙකේම —
 *        web searcher එකෙන් හොයලා 100% නිවරදි — බොරු කියන්නෙ නෑ කවදාවත්"
 * ① anime_kb.js: BC master fact sheet (web-verified 2026-10) + 15 title entries + classics + anti-hallucination rules
 * ② ai.js: KB_OVERRIDE topic-detect injection → sysOf (Gemini/Groq/Z.ai) + system msg (askPolli); roast immune
 * ③ bot.js: .anime/.manga command (HEAVY + menu)
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
    for (const k of Object.keys(require.cache)) if (/\\(ai|pollinations|net|ai_tools|anime_kb)\.js$/.test(k)) delete require.cache[k];
    return require('./ai');
}

const GEM_OK = (text) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
const POLLI_OK = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

(async () => {
    console.log('\n══ test_v272 — 🎌 ANIME KB ══\n');

    // ── KB module: verified facts ──
    ok('anime_kb.js loads + Black Clover master sheet present', () => {
        const KB = require('./anime_kb');
        const bc = KB.BLACK_CLOVER;
        assert.ok(bc.length > 2500, 'BC sheet too thin: ' + bc.length);
        for (const fact of ['Yūki Tabata', 'May 1, 2026', '392', 'Oct 3, 2026', 'Ayataka Tanemura', 'Studio Pierrot', 'Sword of the Wizard King', 'Spade Kingdom Raid', 'ANTI-MAGIC', 'Liebe', 'Lucius', '170 episodes', '268-270'])
            assert.ok(new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(bc), 'BC missing fact: ' + fact);
    });
    ok('BC ending accurate (verified web facts, no invention)', () => {
        const bc = require('./anime_kb').BLACK_CLOVER;
        assert.ok(/ASTA WINS/i.test(bc), 'final duel winner missing');
        assert.ok(/youngest Wizard King/i.test(bc), 'youngest WK missing');
        assert.ok(/co-Wizard Kings/i.test(bc), 'co-WK report missing');
        assert.ok(/Jump GIGA 2026 SPRING/.test(bc), 'final chapter venue missing');
        assert.ok(/ch 268-270/.test(bc), 'ep170→ch mapping missing');
        assert.ok(!/Chapter 400|395 chapters|season 6/i.test(bc), 'fact contamination!');
    });
    ok('15 title entries + anti-hallucination rules', () => {
        const KB = require('./anime_kb');
        assert.strictEqual(KB.ENTRIES.length, 15, 'entries: ' + KB.ENTRIES.length);
        const all = KB._all() + KB.contextFor('anime');
        for (const fact of ['1180 episodes', 'Summer 2027', 'The Culling Game: Part 1', 'The Calamity', 'Oct 12, 2025', '179 ch', 'Jan 16', 'Assassins Arc', 'Two Blue Vortex', '139 ch', '430 ch', 'NEVER invent', 'web_search', '100% sure නෑ']) assert.ok(all.includes(fact), 'missing: ' + fact);
        assert.ok(/as of 2026-10-20/.test(all), 'as-of stamp missing');
    });

    // ── topic detection ──
    ok('topic detection: Sinhala/Singlish/English/names', () => {
        const KB = require('./anime_kb');
        for (const q of ['black clover season 2', 'asta ගේ powers මොනවද', 'ඇනිමේ හොඳම එක මොකක්ද', 'manga end වුණේ කවදද black clover', 'gojo vs sukuna', 'one piece ep count', 'සොලෝ ලෙවලින් season 3', 'yuno star magic', 'anime recommendations'])
            assert.ok(KB.matches(q), 'should match: ' + q);
        for (const q of ['download මේ link එක', '.song lullaby', 'weather colombo', 'hi', 'menu'])
            assert.ok(!KB.matches(q), 'should NOT match: ' + q);
    });
    ok('contextFor: BC query → BC sheet; other-anime query → that entry; non-anime → empty', () => {
        const KB = require('./anime_kb');
        const bcCtx = KB.contextFor('asta powers මොනවද?');
        assert.ok(bcCtx.includes('BLACK CLOVER') && bcCtx.includes('GROUND RULES'), 'BC ctx missing');
        const opCtx = KB.contextFor('one piece දැන් episodes කීයද?');
        assert.ok(opCtx.includes('ONE PIECE') && opCtx.includes('1180'), 'One Piece ctx missing');
        assert.ok(!KB.contextFor('weather in colombo'), 'non-anime should be empty');
        assert.ok(KB.contextFor('ඇනිමේ එකක් recommend කරන්න').includes('BLACK CLOVER'), 'generic anime ask should include BC flaghship');
        assert.ok(bcCtx.length < 11000, 'ctx too big for every turn: ' + bcCtx.length);   // v2.74: S2 corrected anchors + ep3 full plot added (Grok-class depth)
    });

    // ── ai.js wiring: KB reaches Gemini/Groq/Z.ai system + Polli system msg; roast immune ──
    await okA('ask() anime question → Gemini system contains KB + verified facts', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([{ match: (u) => u.includes(':generateContent'), ...GEM_OK('ඇනිමේ උත්තරයක්') }]);
        await ai.ask('ka1@test', 'black clover season 2 කවදද?');
        const j = JSON.parse(CALLS.find(c => c.u.includes(':generateContent')).body);
        const sys = j.systemInstruction.parts[0].text;
        assert.ok(sys.includes('ANIME KNOWLEDGE BASE'), 'KB not in gemini system');
        assert.ok(sys.includes('Oct 3, 2026'), 'BC facts not in system');
        assert.ok(sys.includes('NEVER invent'), 'anti-hallucination rule missing');
    });
    await okA('ask() non-anime question → NO KB in system', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        mockFetch([{ match: (u) => u.includes(':generateContent'), ...GEM_OK('හායි!') }]);
        await ai.ask('ka2@test', 'කොහොමද ඔයාට?');
        const sys = JSON.parse(CALLS.find(c => c.u.includes(':generateContent')).body).systemInstruction.parts[0].text;
        assert.ok(!sys.includes('ANIME KNOWLEDGE BASE'), 'KB leaked into non-anime ask');
    });
    await okA('askPolli anime question → system msg first with KB', async () => {
        const ai = freshAi();
        for (const p of ['gemini', 'groq', 'zai']) ai.setKey(p, null); ai.setKey('polli', 'POLLIKEY');   // force polli path
        mockFetch([{ match: (u) => u.includes('gen.pollinations.ai'), ...POLLI_OK('polli උත්තර') }]);
        await ai.ask('ka3@test', 'gojo ගේ powers මොකක්ද?');
        const body = JSON.parse(CALLS.find(c => c.u.includes('gen.pollinations.ai')).body);
        assert.ok(body.messages[0].role === 'system' && body.messages[0].content.includes('JUJUTSU KAISEN'), 'polli system KB missing');
    });
    await okA('roast mode → KB never injected (banter stays banter)', async () => {
        const ai = freshAi();
        ai.setKey('gemini', 'DUMMY');
        ai.setRoast(true);
        mockFetch([{ match: (u) => u.includes(':generateContent'), ...GEM_OK('😂') }]);
        await ai.ask('ka4@test', 'black clover eka ponnaya ban manga ekak');
        const sys = JSON.parse(CALLS.find(c => c.u.includes(':generateContent')).body).systemInstruction.parts[0].text;
        assert.ok(!sys.includes('ANIME KNOWLEDGE BASE'), 'KB leaked into roast');
        ai.setRoast(false);
    });

    // ── bot.js routing ──
    ok('.anime/.manga routed + HEAVY + menu', () => {
        const bs = src('bot.js');
        assert.ok(/c === '\.anime' \|\| c === '\.manga'/.test(bs), 'no .anime route');
        assert.ok(/ANIME EXPERT MODE/.test(bs), 'anime prefix missing');
        assert.ok(bs.includes("'.anime', '.manga'"), 'not in HEAVY');
        assert.ok(/\.anime <ප්‍රශ්නය>\* — 🎌/.test(bs), 'menu line missing');
    });
    ok('manifest 2.72.0 + anime_kb.js deployed file', () => {
        const man = JSON.parse(src('manifest.json'));
        assert.strictEqual(man.version, '2.74.0');   // v2.74 pin modernized
        assert.ok(man.files.includes('anime_kb.js'), 'anime_kb.js not in manifest.files');
        const pkg = JSON.parse(src('package.json'));
        assert.strictEqual(pkg.version, '2.90.0');   // v2.74 pin modernized
    });

    console.log(`\n${'═'.repeat(46)}\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
