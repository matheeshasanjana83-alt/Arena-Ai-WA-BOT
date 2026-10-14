/**
 * test_v250.js — v2.50.0 suite
 *   • ai_tools.js: TOOLS schema (5), calculator (safe/inject-block), get_datetime (Colombo default)
 *   • runTool: never throws (unknown name / bad JSON args), dispatcher coverage
 *   • ai.js per-model memory: _memKey split, reset() clears all 4 stores, stats() myPerProv, tools toggle
 *   • bot.js wiring: .ai tools route, caption AI TOOLS line, memory card model stores, menu line
 *   • live (best-effort, separate count): web_search / weather / youtube_search
 */
process.env.ARENA_NO_DELAY = '1';
process.env.DL_TMP = require('os').tmpdir();
const fs = require('fs'), path = require('path');
const SETF = path.join(__dirname, 'settings.json');
const SET_BACK = fs.existsSync(SETF) ? fs.readFileSync(SETF, 'utf8') : null;
const MEMF = path.join(require('os').tmpdir(), 'ai_mem_v250_' + Date.now() + '.json');
process.env.ARENA_AI_MEMORY_FILE = MEMF;

let pass = 0, fail = 0, livePass = 0, liveFail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const live = (name, cond) => { if (cond) { livePass++; console.log('  🌐 ' + name); } else { liveFail++; console.log('  🌐(fail) ' + name); } };

const ai = require('./ai');
const T = require('./ai_tools');

(async () => {
    // 1. TOOLS schema
    ok('1 TOOLS: >= 5 entries (v2.51: 9)', Array.isArray(T.TOOLS) && T.TOOLS.length >= 5);
    const names = T.TOOLS.map(t => t.function.name);
    ok('2 TOOLS: names unique + v2.50 five present (v2.51: +4)', new Set(names).size === names.length && ['web_search', 'get_datetime', 'calculator', 'weather', 'youtube_search'].every(n => names.includes(n)));
    ok('3 TOOLS: openai function format', T.TOOLS.every(t => t.type === 'function' && t.function && t.function.parameters && t.function.parameters.type === 'object'));

    // 2. calculator
    ok('4 calc: 12*(3+4)=84', T._calc('12*(3+4)') === '84');
    ok('5 calc: × ÷ symbols', T._calc('6×4÷8') === '3');
    ok('6 calc: decimal 10/4=2.5', T._calc('10/4') === '2.5');
    let threw = false; try { T._calc('process.exit(1)'); } catch { threw = true; }
    ok('7 calc: injection blocked', threw);
    threw = false; try { T._calc('10/0'); } catch { threw = true; }
    ok('8 calc: div-by-zero rejected', threw);

    // 3. datetime
    const dt = T._getDateTime({});
    ok('9 datetime: full format', /\d{1,2} \w+ \d{4}/.test(dt) && /\d{2}:\d{2}/.test(dt) && dt.includes('Asia/Colombo'));
    ok('10 datetime: bogus tz → Colombo fallback', T._getDateTime({ tz: 'Nope/Nowhere' }).includes('Asia/Colombo'));

    // 4. runTool never throws
    ok('11 runTool: unknown → string', (await T.runTool('nope', '{}')).includes('Unknown tool'));
    ok('12 runTool: bad JSON args → Tool error', (await T.runTool('calculator', 'not-json')).startsWith('Tool error'));
    ok('13 runTool: calc via dispatcher', (await T.runTool('calculator', JSON.stringify({ expression: '7×6' }))) === '42');
    ok('14 runTool: datetime via dispatcher', (await T.runTool('get_datetime', '{}')).includes('unix'));

    // 5. per-model memory
    const chat = '94700000001@s.whatsapp.net';
    ok('15 memKey: AUTO = shared', ai._memKey(chat, '') === chat);
    ok('16 memKey: fixed = chat|prov', ai._memKey(chat, 'zai') === chat + '|zai' && ai._memKey(chat, 'gemini') === chat + '|gemini');
    ai._history.set(chat, [{ role: 'user', text: 'auto-msg', t: Date.now() }]);
    for (const p of ['gemini', 'groq', 'zai']) ai._history.set(ai._memKey(chat, p), [{ role: 'user', text: p + '-msg', t: Date.now() }]);
    const st = ai.stats(chat);
    ok('17 stats: myPerProv counts', st.myPerProv.gemini === 1 && st.myPerProv.groq === 1 && st.myPerProv.zai === 1);
    ok('18 stats: chats unique (not store count)', st.chats === 1);
    ok('19 stats: myMsgs = AUTO store', st.myMsgs === 1);
    ai.reset(chat);
    ok('20 reset: all 4 stores cleared', !ai._history.has(chat) && ['gemini', 'groq', 'zai'].every(p => !ai._history.has(ai._memKey(chat, p))));
    ai._flush();

    // 6. tools toggle (settings round-trip)
    const setBefore = JSON.parse(JSON.stringify((() => { try { return JSON.parse(fs.readFileSync(SETF, 'utf8')); } catch { return {}; } })()));
    ok('21 tools: default ON', ai.getTools() === true);
    ai.setTools(false);
    ok('22 tools: off persisted', ai.getTools() === false && JSON.parse(fs.readFileSync(SETF, 'utf8')).aiTools === false);
    ai.setTools(true);
    ok('23 tools: on again', ai.getTools() === true);

    // 7. bot wiring
    const botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    ok('24 bot: .ai tools route', /question\.match\(\^tools\?/.test(botSrc.replace('\\s+', '\\\\s+')) || botSrc.includes("/^tools?") || /tools\?\(\?:\\s\+\(on\|off\)\)\?\$/i.test(botSrc));
    ok('25 bot: ai.setTools wired', botSrc.includes("ai.setTools(tm[1]"));
    ok('26 bot: caption AI TOOLS line', botSrc.includes('*AI TOOLS:*'));
    ok('27 bot: memory card model stores', botSrc.includes('myPerProv.gemini') && botSrc.includes('Model stores'));
    ok('28 bot: reset hint says models 3', botSrc.includes('models 3 ගේම මතක clear'));
    ok('29 bot: AI menu tools line', botSrc.includes('*.ai tools* — GLM connector'));

    // 8. ai.js wiring
    const aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf8');
    ok('30 ai: require ai_tools', aiSrc.includes("require('./ai_tools')"));
    ok('31 ai: payload.tools wiring', aiSrc.includes('payload.tools = TOOLS') && aiSrc.includes("tool_choice = 'auto'"));
    ok('32 ai: tool loop + runToolEx call', aiSrc.includes('await runToolEx(tc.function.name') && aiSrc.includes("role: 'tool'"));
    ok('33 ai: tools-off retry on unsupported', aiSrc.includes("useTools = false; continue"));
    ok('34 ai: per-model hint in SYSTEM when tools on', aiSrc.includes('TOOLS: you have tools'));

    // 9. live best-effort (network — counted separately)
    try { const r = await T.runTool('web_search', JSON.stringify({ query: 'Sri Lanka' })); live('35 LIVE web_search', !r.startsWith('Tool error') && r.includes('http')); } catch (e) { live('35 LIVE web_search', false); }
    try { const r = await T.runTool('weather', JSON.stringify({ location: 'Colombo' })); live('36 LIVE weather', r.includes('°C')); } catch (e) { live('36 LIVE weather', false); }
    try { const r = await T.runTool('youtube_search', JSON.stringify({ query: 'alan walker faded' })); live('37 LIVE youtube_search', r.includes('youtu')); } catch (e) { live('37 LIVE youtube_search', false); }

    // 10. version
    const pkg = require('./package.json');
    const [maj, min] = String(pkg.version).split('.').map(Number);
    ok('38 version >= 2.50.0', maj > 2 || (maj === 2 && min >= 50));

    console.log(`\n${pass} passed, ${fail} failed · live: ${livePass}/${livePass + liveFail}`);
    process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).then(() => {
    if (SET_BACK !== null) fs.writeFileSync(SETF, SET_BACK); else { try { fs.unlinkSync(SETF); } catch { } }
    try { fs.unlinkSync(MEMF); } catch { }
    console.log('settings restored');
});
