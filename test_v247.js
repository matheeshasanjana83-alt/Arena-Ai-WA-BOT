/* test_v247 — AI PERSISTENT MEMORY (offline)
   • save/load: ai_memory.json atomic write + fresh-require restore
   • TTL: 3d+ old messages pruned on access + on save/load
   • cap: MAX_TURNS window (env-driven) + text 2000 cap
   • reset persists, stats() shape, bot wiring (.ai memory) + version 2.47.0
*/
process.env.ARENA_NO_DELAY = '1';
process.env.DL_TMP = require('os').tmpdir();

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETF = path.join(__dirname, 'settings.json');
const SET_BACK = fs.existsSync(SETF) ? fs.readFileSync(SETF, 'utf8') : null;
const MEMF = path.join(os.tmpdir(), 'ai_memory_test_' + Date.now() + '.json');
process.env.ARENA_AI_MEMORY_FILE = MEMF;
process.env.ARENA_AI_TURNS = '10';
process.env.ARENA_AI_MEMORY_DAYS = '3';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

// settings isolation (gemini fake key → askGemini path, fetch mocked)
fs.writeFileSync(SETF, JSON.stringify({ react: false, autoUpdate: false, gemini: 'FAKE-KEY' }, null, 2));

// mock fetch → Gemini-style reply (NO network)
global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'AI-TEST-REPLY' }] } }] }) });

const ai = require('./ai');

(async () => {
    // 1. ask flow stores messages with timestamps
    const r1 = await ai.ask('chatA@s.whatsapp.net', 'question one');
    ok('01 ask returns text', r1.text === 'AI-TEST-REPLY');
    const ha = ai._history.get('chatA@s.whatsapp.net');
    ok('02 history has 2 msgs', !!ha && ha.length === 2);
    ok('03 msgs have t timestamp', ha.every(m => typeof m.t === 'number' && m.t > 0));

    // 2. flush → file written (atomic)
    ai._flush();
    ok('04 memory file exists', fs.existsSync(MEMF));
    const j = JSON.parse(fs.readFileSync(MEMF, 'utf8'));
    ok('05 file has chatA with 2 msgs', !!j.chats && !!j.chats['chatA@s.whatsapp.net'] && j.chats['chatA@s.whatsapp.net'].msgs.length === 2);

    // 3. fresh require → memory restored (restart simulation)
    delete require.cache[require.resolve('./ai')];
    const ai2 = require('./ai');
    ok('06 restore: chatA back after reload', ai2._history.has('chatA@s.whatsapp.net') && ai2._history.get('chatA@s.whatsapp.net').length === 2);

    // 4. TTL prune on access (4d-old message dropped during ask)
    const hA = ai2._history.get('chatA@s.whatsapp.net');
    hA.unshift({ role: 'user', text: 'OLD MSG', t: Date.now() - 4 * 86400e3 });
    const r2 = await ai2.ask('chatA@s.whatsapp.net', 'q2');
    ok('07 TTL: old msg pruned on ask', !ai2._history.get('chatA@s.whatsapp.net').some(m => m.text === 'OLD MSG'));
    ok('08 ask#2 works', r2.text === 'AI-TEST-REPLY');

    // 5. turn cap (ARENA_AI_TURNS=10 → max 20 msgs)
    const hB = [];
    for (let i = 0; i < 25; i++) hB.push({ role: i % 2 ? 'assistant' : 'user', text: 'm' + i, t: Date.now() });
    ai2._history.set('chatB@s.whatsapp.net', hB);
    await ai2.ask('chatB@s.whatsapp.net', 'cap q');
    ok('09 cap: ≤ MAX_TURNS*2 msgs', ai2._history.get('chatB@s.whatsapp.net').length <= 20);

    // 6. text cap 2000 chars on save
    ai2._history.get('chatB@s.whatsapp.net').push({ role: 'assistant', text: 'x'.repeat(5000), t: Date.now() });
    ai2._flush();
    const j2 = JSON.parse(fs.readFileSync(MEMF, 'utf8'));
    ok('10 text capped to 2000', j2.chats['chatB@s.whatsapp.net'].msgs.some(m => m.text.length === 2000));

    // 7. reset persists (file updated)
    ai2.reset('chatB@s.whatsapp.net');
    ai2._flush();
    const j3 = JSON.parse(fs.readFileSync(MEMF, 'utf8'));
    ok('11 reset removes chat from file', !j3.chats['chatB@s.whatsapp.net']);

    // 8. stats() shape
    const st = ai2.stats('chatA@s.whatsapp.net');
    ok('12 stats: chats ≥ 1', st.chats >= 1);
    ok('13 stats: myMsgs > 0', st.myMsgs > 0);
    ok('14 stats: ttlDays=3 turns=10', st.ttlDays === 3 && st.turns === 10);
    ok('15 stats: fileKB > 0', st.fileKB > 0);

    // 9. load filters ANCIENT msgs, keeps FRESH
    const j4 = JSON.parse(fs.readFileSync(MEMF, 'utf8'));
    j4.chats['chatC@s.whatsapp.net'] = { msgs: [{ role: 'user', text: 'ANCIENT', t: Date.now() - 10 * 86400e3 }, { role: 'user', text: 'FRESH', t: Date.now() }], updated: Date.now() };
    fs.writeFileSync(MEMF, JSON.stringify(j4));
    delete require.cache[require.resolve('./ai')];
    const ai3 = require('./ai');
    const hC = ai3._history.get('chatC@s.whatsapp.net');
    ok('16 load: ANCIENT dropped, FRESH kept', !!hC && hC.length === 1 && hC[0].text === 'FRESH');

    // 10. save re-filters TTL (ANCIENT never hits disk via saveMemoryNow)
    ai3._history.get('chatC@s.whatsapp.net').push({ role: 'user', text: 'OLD2', t: Date.now() - 5 * 86400e3 });
    ai3._flush();
    const j5 = JSON.parse(fs.readFileSync(MEMF, 'utf8'));
    ok('17 save: TTL filter excludes OLD2', !j5.chats['chatC@s.whatsapp.net'].msgs.some(m => m.text === 'OLD2'));

    // 11. bot wiring + version (source regex — no bot require needed)
    const botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    ok('18 bot: .ai memory route wired', /\^\(memory\|mem\)\$\/i\.test\(question\)/.test(botSrc) && botSrc.includes('ai.stats(jid)'));
    ok('19 bot: help mentions .ai memory', botSrc.includes('*.ai memory*'));
    ok('20 bot: settings panel AI MEMORY line', botSrc.includes('*AI MEMORY:*'));
    ok('21 ai.js: atomic write (tmp+rename)', fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf8').includes("renameSync(tmp, MEM_FILE)"));
    const pkg = require('./package.json');
    ok('22 version 2.47.0', pkg.version === '2.47.0');

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).then(() => {
    if (SET_BACK !== null) fs.writeFileSync(SETF, SET_BACK); else { try { fs.unlinkSync(SETF); } catch { } }
    try { fs.unlinkSync(MEMF); } catch { }
    try { fs.unlinkSync(MEMF + '.tmp'); } catch { }
    console.log('settings + temp memory restored');
});
