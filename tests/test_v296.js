/**
 * test_v296.js — ⚡👥 AI GROUP SPEED + UNDERSTANDING
 * (user: 'ගොඩක් slow බන් speed නෑ group වලට හරියට reply කරන්නෙ නෑ තොරන්නෙ නෑ.
 *  voice අහලා reply කරන්න පුලුවන් විදිහට තව sticker එක බලලා reply කරේ inbox එකෙදි විතරයි').
 * Tested here (ALL OFFLINE — fetch + mediaDownloader + stt mocked):
 *  (1) 🐛 GROUP GATE FIX: sticker / voice note REPLY-TO-BOT in a group → AI reacts (was SILENT —
 *      contextInfo was read from extendedTextMessage only, sticker/audio blocks missed)
 *  (2) 🚫 anti-flood: group sticker/voice with NO mention/reply-to-bot → still silent
 *  (3) ⚡ RACE: slow Gemini + fast Groq → Groq answer wins in <300ms, ONE memory write,
 *      loser answer never stored
 *  (4) ⏱ TIMEOUT: hung Gemini aborted via AbortSignal (ARENA_AI_MS) → sequential fallback answers
 *  (5) 👥 GROUP LOG: recent member messages → CHAT CONTEXT (auto path + .ai command)
 *  (6) ⚡ GROUP FAST: needsWeb-strong question skips web grounding in groups (control: DM does it)
 *  (7) GROUP_VISION_SYS short persona used for group media (deep SUPER VISION untouched for DM)
 */
process.env.ARENA_NO_REACT = '1';
process.env.ARENA_AI_MEMORY_FILE = __dirname + '/../.test_v296_mem.json';
process.env.GEMINI_API_KEY = 'AIzaTEST_v296_speed_gem_000000000';
process.env.GROQ_API_KEY = 'gskTEST_v296_speed_groq_000000000';
process.env.ARENA_AI_MS = '700';   // ⚡ short caps — hang abort fires fast in tests
const assert = require('assert');
const fs = require('fs');
try { fs.unlinkSync(__dirname + '/../.test_v296_mem.json'); } catch { }
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pkg = require('../package.json');
const manifest = require('../manifest.json');
const ai = require('../ai');
ai._history.clear();   // deterministic
require('../antibug')._state.lockdownUntil = 0;   // 🐛 v3.02.0: storm-lock persisted by earlier antibug suites (v255/v277) silently killed maybeAiReply gates (0 sends) — order-independent e2e
const bot = require('../bot');
const P = require('../pollinations');
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

// gemini/groq response builders
const gem = (text, ms = 0) => new Promise((res) => setTimeout(() => res({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) }), ms));
const groq = (text) => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });

(async () => {
    console.log('— v2.96.0 pins + markers —');
    ok('version 2.96 pkg+manifest + notes + source markers', () => {
        assert.strictEqual(pkg.version, '3.02.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.02.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('GROUP SPEED'), 'notes headline');
        assert.ok(manifest.files.includes('tests/test_v296.js'), 'manifest lists test_v296.js');
        assert.ok(aiSrc.includes('AbortSignal.timeout(T_CHAT())'), 'chat fetch timeouts');
        assert.ok(aiSrc.includes('Promise.any'), 'provider race');
        assert.ok(aiSrc.includes('GROUP_VISION_SYS'), 'group vision persona');
        assert.ok(aiSrc.includes('EXPLICIT_SEARCH_RE'), 'group fast web gate');
        assert.ok(botSrc.includes("ow?.audioMessage?.contextInfo || ow?.stickerMessage?.contextInfo"), 'group gate reads sticker/audio contextInfo (THE bug)');
        assert.ok(botSrc.includes('function glogPush'), 'group chat memory buffer');
        assert.ok(botSrc.includes("sendPresenceUpdate"), 'composing presence');
        assert.ok(botSrc.includes('group: isGroup'), 'group flag into aiMediaReply');
    });

    console.log('— 🐛 GROUP GATE FIX e2e (sticker/voice reply-to-bot in group) —');
    await okA('group sticker REPLY-TO-BOT → vision with GROUP_VISION_SYS short persona', async () => {
        const sends = [];
        bot._setMediaDownloader(async () => Buffer.alloc(2048, 7));
        const captured = [];
        globalThis.fetch = (url) => {
            const u = String(url);
            if (/generativelanguage/.test(u)) { return gem('😂 මේක Toby ගෙ sticker එකක් මචං!').then((r) => { captured.push(JSON.parse(r._body || '{}')); return r; }).catch(() => gem('😂 මේක Toby ගෙ sticker එකක් මචං!')); }
            throw new Error('unexpected fetch: ' + u);
        };
        // simpler capture: wrap gem text
        let visBody = null;
        globalThis.fetch = (url, opts = {}) => {
            const u = String(url);
            if (/generativelanguage/.test(u)) { visBody = JSON.parse(opts.body); return gem('😂 මේක Toby ගෙ sticker එකක් මචං!'); }
            throw new Error('unexpected fetch: ' + u);
        };
        try {
            bot.maybeAiReply({
                msg: { key: { remoteJid: 'gp296@g.us', id: 'G1', participant: '947761234567@s.whatsapp.net' }, pushName: 'Suziy', message: { stickerMessage: { mimetype: 'image/webp', fileLength: 42000, contextInfo: { participant: bot.ME.pn, stanzaId: 'BOTMSG1', quotedMessage: { conversation: 'hi' } } } } },
                jid: 'gp296@g.us', text: '', owner: false, send: sendCap(sends),
            });
            await sleep(500);
            assert.ok(sends.length >= 2, 'status + reply: ' + sends.length);
            assert.ok(sends[0].text.includes('👀 බලනවා'), 'status bubble');
            assert.ok(sends.map((s) => s.text || '').join(' ').includes('Toby'), 'sticker AI reply');
            assert.ok(visBody, 'vision call captured');
            const p = (visBody.contents?.[0]?.parts || []).find((x) => x.inline_data);
            assert.ok(p && p.inline_data.mime_type === 'image/webp', 'webp to vision');
            assert.ok(visBody.systemInstruction.parts[0].text.includes('reacting to a photo/sticker'), 'GROUP_VISION_SYS persona in payload');
            assert.ok(!visBody.systemInstruction.parts[0].text.includes('SUPER VISION engine of'), 'NOT the deep vision report persona in groups');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('group voice note REPLY-TO-BOT → whisper stt → ai.ask with group ctx', async () => {
        const sends = [];
        bot._setMediaDownloader(async () => Buffer.alloc(1024, 3));
        const origStt = P.sttText;
        const origGT = ai.geminiTranscribe;
        P.sttText = async () => 'machan group eke kohomada';
        ai.geminiTranscribe = async () => { throw new Error('gemini stt off (v296 mock)'); };   // ⚡ v2.98 chain: force fall-through to the whisper mock
        bot._groupLog.set('gp296b@g.us', ['Banti: hukan ban', 'Toji: Meta no bro']);
        let body = null;
        globalThis.fetch = (url, opts = {}) => {
            const u = String(url);
            if (/generativelanguage/.test(u)) { body = JSON.parse(opts.body); return gem('හායි මචං! ඇහුණා!'); }
            throw new Error('unexpected fetch: ' + u);
        };
        try {
            bot.maybeAiReply({
                msg: { key: { remoteJid: 'gp296b@g.us', id: 'A1', participant: '947761234567@s.whatsapp.net' }, pushName: 'Banti', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: 90000, ptt: true, contextInfo: { participant: bot.ME.pn } } } },
                jid: 'gp296b@g.us', text: '', owner: false, send: sendCap(sends),
            });
            await sleep(500);
            assert.ok(sends.length >= 2, 'status + reply: ' + sends.length);
            assert.ok(sends[0].text.includes('🎙️ ඇහනවා'), 'listening bubble');
            assert.ok(body, 'chat call captured');
            const q = body.contents[0].parts[0].text;
            assert.ok(q.includes('voice/audio transcript') && q.includes('machan group eke kohomada'), 'transcript into question');
            const sys = body.systemInstruction.parts[0].text;
            assert.ok(sys.includes('👥 CHAT CONTEXT') && sys.includes('Death Legion'), 'group ctx');
            assert.ok(sys.includes('Banti: hukan ban') && sys.includes('Toji: Meta no bro'), 'recent group chat log injected');
        } finally { globalThis.fetch = realFetch; P.sttText = origStt; ai.geminiTranscribe = origGT; }
    });
    await okA('group sticker/voice with NO mention/reply-to-bot → silent ×2', async () => {
        const sends = [];
        bot._setMediaDownloader(async () => Buffer.alloc(2048, 7));
        bot.maybeAiReply({ msg: { key: { remoteJid: 'gp296c@g.us', id: 'G2' }, message: { stickerMessage: { mimetype: 'image/webp', fileLength: 42000 } } }, jid: 'gp296c@g.us', text: '', owner: false, send: sendCap(sends) });
        await sleep(250);
        bot.maybeAiReply({ msg: { key: { remoteJid: 'gp296c@g.us', id: 'A2' }, message: { audioMessage: { mimetype: 'audio/ogg', fileLength: 5000, ptt: true, contextInfo: { participant: '9477OTHER@s.whatsapp.net' } } } }, jid: 'gp296c@g.us', text: '', owner: false, send: sendCap(sends) });
        await sleep(250);
        assert.strictEqual(sends.length, 0, 'no sends: ' + JSON.stringify(sends.map((s) => s.text)));
    });

    console.log('— ⚡ RACE (slow Gemini vs fast Groq) + memory discipline —');
    await okA('Promise.any: fast Groq wins, ONE memory write, loser answer dropped', async () => {
        ai.setProvider('');   // AUTO
        const calls = [];
        globalThis.fetch = (url) => {
            const u = String(url);
            if (/generativelanguage/.test(u)) { calls.push(['gem', Date.now()]); return gem('මම හොඳයි මචං — gemini slow answer', 450); }
            if (/api\.groq\.com/.test(u)) { calls.push(['groq', Date.now()]); return groq('හරි මචං — groq fast answer'); }
            throw new Error('unexpected fetch: ' + u);
        };
        try {
            const t0 = Date.now();
            const r = await ai.ask('race296@s.whatsapp.net', 'kohomada', {});
            const dt = Date.now() - t0;
            assert.ok(dt < 300, 'race winner fast (' + dt + 'ms — sequential would be ≥450ms)');
            assert.ok(r.text.includes('groq fast answer'), 'fast provider won: ' + r.text);
            assert.ok(/Groq/.test(r.model), 'model ' + r.model);
            await sleep(650);   // slow gemini leg settles
            const h = ai._history.get('race296@s.whatsapp.net') || [];
            assert.strictEqual(h.filter((m) => m.role === 'user').length, 1, 'ONE user turn in memory (got ' + h.length + ')');
            assert.ok(h.some((m) => m.role === 'assistant' && m.text.includes('groq fast answer')), 'winner stored');
            assert.ok(!h.some((m) => m.text.includes('gemini slow answer')), 'loser answer NOT in memory');
            const gs = calls.find((c) => c[0] === 'gem'), qs = calls.find((c) => c[0] === 'groq');
            assert.ok(gs && qs && Math.abs(gs[1] - qs[1]) < 120, 'both legs started in parallel');
        } finally { globalThis.fetch = realFetch; }
    });

    console.log('— ⏱ TIMEOUT (hung Gemini → abort → fallback) —');
    await okA('hung Gemini aborted at ARENA_AI_MS → Groq fallback answers', async () => {
        ai.setProvider('gemini');   // fixed provider → classic sequential ladder (timeout path)
        globalThis.fetch = (url, opts = {}) => {
            const u = String(url);
            if (/generativelanguage/.test(u)) {
                return new Promise((res, rej) => {
                    if (opts.signal) opts.signal.addEventListener('abort', () => rej(new Error('The operation was aborted')), { once: true });
                    // never resolves on its own — hang
                });
            }
            if (/api\.groq\.com/.test(u)) return groq('හරි abort fallback මචං');
            throw new Error('unexpected fetch: ' + u);
        };
        try {
            const t0 = Date.now();
            const r = await ai.ask('hang296@s.whatsapp.net', 'mokakda karanne', {});
            const dt = Date.now() - t0;
            assert.ok(r.text.includes('abort fallback'), 'fallback answer after abort: ' + r.text);
            assert.ok(dt < 5000, 'hang did not freeze the reply (' + dt + 'ms)');
            assert.ok(/Groq/.test(r.model), 'model ' + r.model);
        } finally { globalThis.fetch = realFetch; ai.setProvider(''); }
    });

    console.log('— 👥 GROUP LOG + ⚡ GROUP FAST —');
    ok('glogPush: buffer, command skip, cap 12, format', () => {
        bot._glogPush('gpX@g.us', 'Banti', 'hukan ban');
        bot._glogPush('gpX@g.us', 'Toji', '.download http://x');
        bot._glogPush('gpX@g.us', 'Toji', 'Meta no bro');
        const arr = bot._groupLog.get('gpX@g.us');
        assert.strictEqual(arr.length, 2, 'command line skipped: ' + JSON.stringify(arr));
        assert.strictEqual(arr[0], 'Banti: hukan ban');
        for (let i = 0; i < 20; i++) bot._glogPush('gpY@g.us', 'M', 'msg' + i);
        const y = bot._groupLog.get('gpY@g.us');
        assert.strictEqual(y.length, 12, 'cap 12');
        assert.strictEqual(y[11], 'M: msg19', 'newest kept');
        bot._glogPush('dm296@s.whatsapp.net', 'A', 'no group');   // non-group jid ignored
        assert.ok(!bot._groupLog.has('dm296@s.whatsapp.net'), 'DM never logged');
    });
    await okA('.ai command in group → group name + recent chat in system payload', async () => {
        const sends = [];
        bot._groupLog.set('gp296d@g.us', ['Suziy: ay bro']);
        let body = null;
        globalThis.fetch = (url, opts = {}) => {
            const u = String(url);
            if (/generativelanguage/.test(u)) { body = JSON.parse(opts.body); return gem('හායි Suziy!'); }
            throw new Error('unexpected fetch: ' + u);
        };
        try {
            await bot.handleAI(sendCap(sends), 'gp296d@g.us', { key: { remoteJid: 'gp296d@g.us', id: 'C1' }, pushName: 'Suziy' }, 'kohomada');
            assert.ok(sends.length >= 2, 'status + reply: ' + sends.length);
            const sys = body.systemInstruction.parts[0].text;
            assert.ok(sys.includes('👥 CHAT CONTEXT') && sys.includes('Death Legion') && sys.includes('replying to Suziy'), 'group ctx in .ai');
            assert.ok(sys.includes('Suziy: ay bro'), 'recent chat in .ai ctx');
        } finally { globalThis.fetch = realFetch; }
    });
    await okA('group FAST: needsWeb-strong question skips DDG (DM control does it)', async () => {
        assert.strictEqual(ai.needsWeb('black clover episode 160 මොකද වෙන්නේ'), true, 'sanity: KB question needs web');
        assert.strictEqual(ai.EXPLICIT_SEARCH_RE.test('search black clover ep 160'), true, 'explicit search words');
        assert.strictEqual(ai.EXPLICIT_SEARCH_RE.test('black clover episode 160 මොකද වෙන්නේ'), false, 'no explicit search words');
        const urls = [];
        const ddgHtml = '<html><body><a class="result__a" href="https://blackclover.fandom.com/wiki/Episode_160">BC 160</a><a class="result__snippet">plot</a></body></html>';
        globalThis.fetch = (url, opts = {}) => {
            const u = String(url);
            urls.push(u);
            if (/duckduckgo/.test(u)) return Promise.resolve({ ok: true, status: 200, text: async () => ddgHtml });
            if (/generativelanguage/.test(u)) return gem('KB උත්තරේ මචං');
            if (/fandom\.com/.test(u)) return Promise.resolve({ ok: true, status: 200, text: async () => '<html><title>BC 160</title><body>Episode 160 recap plot summary text here. episode plot</body></html>' });
            throw new Error('unexpected fetch: ' + u);
        };
        try {
            ai._flags.lastWebUsed = false;
            await ai.ask('grpweb296@g.us', 'black clover episode 160 මොකද වෙන්නේ', { group: true });
            assert.strictEqual(ai._flags.lastWebUsed, false, 'group fast → NO web grounding');
            assert.ok(!urls.some((u) => /duckduckgo/.test(u)), 'no DDG fetch in group mode');
            ai._flags.lastWebUsed = false;
            await ai.ask('dmweb296@s.whatsapp.net', 'black clover episode 160 මොකද වෙන්නේ');
            assert.strictEqual(ai._flags.lastWebUsed, true, 'DM → web grounding still on');
            assert.ok(urls.some((u) => /duckduckgo/.test(u)), 'DDG fetch in DM control');
        } finally { globalThis.fetch = realFetch; }
    });

    try { fs.unlinkSync(__dirname + '/../.test_v296_mem.json'); } catch { }
    try { fs.unlinkSync(__dirname + '/../.test_v296_mem.json.tmp'); } catch { }
    console.log(`\n${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
