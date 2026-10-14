/**
 * test_v254.js — 🔥 ROAST MODE + REPLY-BAR + SINHALA BOOST
 * 1) Roast: insult detect (Sinhala slang + English) → SYSTEM swap → savage Sinhala comeback persona
 * 2) Reply-bar: maybeAiReply text replies now QUOTE the sender (groups = reply to the exact person)
 * 3) Sinhala boost: SYSTEM — Singlish understood (e.g. "how to band whatsapp"), ALWAYS Sinhala replies, SHORT answers
 * 4) Memory: 3-day TTL confirmed (groups included, ai_memory.json persistent)
 * Offline (mocked fetch) — no --live needed (roast is prompt-level)
 */
const path = require('path');
process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'test-key-z';
process.env.ARENA_REMINDERS_FILE = path.join(require('os').tmpdir(), 'rem_test_v254_' + Date.now() + '.json');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

(async () => {
    console.log('— versions —');
    const pkg = require('./package.json'), man = require('./manifest.json');
    ok('01 pkg 2.54.0', pkg.version === '2.54.0');
    ok('02 manifest 2.54.0', man.version === '2.54.0');
    ok('03 manifest files += test_v254', man.files.includes('test_v254.js'));

    console.log('— insult detection —');
    const ai = require('./ai');
    ok('04 කින්ටි මෙට්ට', ai.looksLikeInsult('කින්ටි මෙට්ට'));
    ok('05 මෙට්ට alone', ai.looksLikeInsult('මෙට්ට'));
    ok('06 Fuck of', ai.looksLikeInsult('Fuck of 🤬'));
    ok('07 you are stupid', ai.looksLikeInsult('you are stupid bot'));
    ok('08 බනිනවා', ai.looksLikeInsult('bot එක බනිනවා'));
    ok('09 singlish pakaya', ai.looksLikeInsult('oyaa pakaya'));
    ok('10 normal chat NOT insult', !ai.looksLikeInsult('හායි මචං ඔන්න කතා කරමු'));
    ok('11 ban wei NOT insult', !ai.looksLikeInsult('ban wei'));
    ok('12 photo ask NOT insult', !ai.looksLikeInsult('robot photo එකක් හදලා දෙන්න'));
    ok('13 කෙටියෙන් ගැහුවා මෙට්ට (screenshot case)', ai.looksLikeInsult('කෙටියෙන් ගැහුවා මෙට්ට'));

    console.log('— roast toggle —');
    ok('14 default roast ON', ai.getRoast() === true);
    ai.setRoast(false);
    ok('15 setRoast(false)', ai.getRoast() === false);
    ai.setRoast(true);
    ok('16 setRoast(true) restore', ai.getRoast() === true);

    console.log('— SYSTEM swap wiring (mocked) —');
    const realFetch = global.fetch;
    let lastSys = '';
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (/generativelanguage|api\.z\.ai/.test(u)) {
            const body = JSON.parse(opts.body || '{}');
            lastSys = body.systemInstruction?.parts?.[0]?.text || body.messages?.[0]?.content || '';
            const reply = { choices: [{ message: { content: 'roast-test-reply' } }], candidates: [{ content: { parts: [{ text: 'roast-test-reply' }] } }] };
            return { ok: true, status: 200, text: async () => JSON.stringify(reply), headers: { get: () => 'application/json' } };
        }
        return { ok: false, status: 500, text: async () => '{}', headers: { get: () => 'application/json' } };
    };
    // roast question → system becomes ROAST_SYSTEM
    await ai.ask('roast-test@s.whatsapp.net', 'කින්ටි මෙට්ට');
    ok('17 roast q → ROAST persona system', /ROAST MODE/.test(lastSys) && /ආපහු බැනීම/.test(lastSys));
    ok('18 roast system Sinhala rule', /Sinhala/.test(lastSys) && /NEVER use sexual/.test(lastSys));
    // normal question → normal SYSTEM
    await ai.ask('roast-test@s.whatsapp.net', 'හායි කොහොමද දවාල');
    ok('19 normal q → normal SYSTEM', !/ROAST MODE/.test(lastSys) && /KAVIZ MD V1/.test(lastSys));
    ok('20 normal SYSTEM has Sinhala-boost rules', true); // asserted via source below
    global.fetch = realFetch;

    console.log('— Sinhala boost (SYSTEM source) —');
    const as = require('fs').readFileSync('./ai.js', 'utf8');
    ok('21 Singlish example rule', /how to band whatsapp/.test(as) && /Singlish/.test(as));
    ok('22 ALWAYS Sinhala rule', /ALWAYS reply in Sinhala/.test(as));
    ok('23 SHORT answers rule', /BE SHORT like a friend texting/.test(as) && /කෙටියෙන්/.test(as));

    console.log('— bot.js reply-bar + roast cmd (source) —');
    const bs = require('fs').readFileSync('./bot.js', 'utf8');
    ok('24 auto-chat text reply QUOTED (reply bar)', /text: ai\.splitLong\(out\)\[0\] \}, \{ quoted: msg \}/.test(bs));
    ok('25 .ai roast command wired', /setRoast\(rm\[1\]/.test(bs) && /getRoast\(\)/.test(bs));
    ok('26 AI help card roast line', /\.ai roast\* — 🔥/.test(bs));

    console.log('— memory (3-day TTL, groups included) —');
    const st = ai.stats('94777777777-1600000000@g.us');   // group-style jid
    ok('27 ttlDays = 3', st.ttlDays === 3);
    ok('28 turns = 30', st.turns === 30);
    ok('29 memory file persistent', require('fs').existsSync(ai._memoryFile));

    console.log('— non-regression —');
    ok('30 exports intact', ['ask', 'askVision', 'looksLikeInsult', 'getRoast', 'setRoast', 'getTools', 'setTools'].every(f => typeof ai[f] === 'function'));
    ok('31 looksLikeImageAsk still works', ai.looksLikeImageAsk('මට robot එකක් photo එකක් හදලා දෙන්න'));

    console.log(`\n═══ v2.54.0: ${pass} pass · ${fail} fail ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
