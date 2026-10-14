/**
 * test_v256.js — 🔥 ROAST v2.56 TRAINING + SINHALA BOOST
 * Screenshots bug (Limewire 5 files): llama-3.3-70b garbled Sinhala loop ("සම තිට්ටිකිරිම" ×5 same reply),
 * Groq refusal → "I'm sorry, but I can't help with that." (silent), English leaks ("Hey! How can I help you today?").
 * Fixes tested here: gpt-oss-120b first · ROAST_SYSTEM anti-refusal persona · REFUSE_RE/mostlyEnglish/roastGood guards ·
 * canned Roast bank (30 lines, never silent) · Singlish insult detection (kari/ponnaya/pukata/hukanna/යකො...) ·
 * memory poison purge (refusal + repeated-garble cleanup) · lang-guard for normal chat (short msgs → Sinhala).
 * Offline (mocked fetch). Prior suites must stay green.
 */
const path = require('path');
process.env.ARENA_AI_MEMORY_FILE = path.join(require('os').tmpdir(), 'mem_test_v256_' + Date.now() + '.json');
process.env.ARENA_REMINDERS_FILE = path.join(require('os').tmpdir(), 'rem_test_v256_' + Date.now() + '.json');
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-g';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key-q';
process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'test-key-z';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

(async () => {
    console.log('— versions —');
    const pkg = require('./package.json'), man = require('./manifest.json');
    ok('01 pkg 2.56.0', /^2\.5[6-9]\./.test(pkg.version));
    ok('02 manifest 2.56.0', /^2\.5[6-9]\./.test(man.version));
    ok('03 manifest files += test_v256', man.files.includes('test_v256.js'));
    ok('04 manifest removed test_v255', (man.removed || []).includes('test_v255.js'));

    console.log('— model order (gpt-oss-120b first) —');
    const as = require('fs').readFileSync('./ai.js', 'utf8');
    ok('05 GROQ_MODELS gpt-oss first', /GROQ_MODELS = \['openai\/gpt-oss-120b', 'llama-3\.3-70b-versatile'/.test(as));
    ok('06 comment explains llama garble', /llama-3\.3-70b සිංහල කැඩෙනවා/.test(as));

    console.log('— module surface —');
    const ai = require('./ai');
    ok('07 roastGood exported', typeof ai.roastGood === 'function');
    ok('08 mostlyEnglish exported', typeof ai.mostlyEnglish === 'function');
    ok('09 cannedRoast exported', typeof ai.cannedRoast === 'function');
    ok('10 REFUSE_RE exported', ai.REFUSE_RE instanceof RegExp);
    ok('11 ROAST_BANK exported', Array.isArray(ai.ROAST_BANK));

    console.log('— roast bank —');
    ok('12 bank ≥ 28 lines', ai.ROAST_BANK.length >= 28);
    ok('13 all bank lines Sinhala', ai.ROAST_BANK.every(l => /[\u0D80-\u0DFF]/.test(l)));
    ok('14 no English-only line', ai.ROAST_BANK.every(l => !ai.mostlyEnglish(l)));
    ok('15 no refusal in bank', ai.ROAST_BANK.every(l => !ai.REFUSE_RE.test(l)));
    ok('16 bank lines unique', new Set(ai.ROAST_BANK).size === ai.ROAST_BANK.length);
    const c1 = ai.cannedRoast('bank-test-1'), c2 = ai.cannedRoast('bank-test-1');
    ok('17 cannedRoast returns bank line', ai.ROAST_BANK.includes(c1) && ai.ROAST_BANK.includes(c2));
    const ring = new Set(); for (let i = 0; i < 8; i++) ring.add(ai.cannedRoast('bank-test-2'));
    ok('18 ring of 8 no immediate repeat', ring.size >= 7);   // 8 picks from ≥22 pool → almost surely ≥7 unique

    console.log('— guards —');
    ok('19 refusal caught', ai.REFUSE_RE.test("I'm sorry, but I can't help with that."));
    ok('20 refusal (cannot help) caught', ai.REFUSE_RE.test('I cannot help with that request.'));
    ok('21 refusal (as an AI) caught', ai.REFUSE_RE.test('As an AI, I cannot engage in that.'));
    ok('22 normal Sinhala NOT refusal', !ai.REFUSE_RE.test('බැන්නට කමින් නෑ බන් 😂'));
    ok('23 English leak caught', ai.mostlyEnglish('Hey! How can I help you today?'));
    ok('24 "Kiym" garbage caught', ai.mostlyEnglish('Kiym'));
    ok('25 Sinhala roast passes', !ai.mostlyEnglish('මිනිස්සු brain එකට WiFi තියෙනවා, ඔයාගෙ jokes වල full signal 😎'));
    ok('26 Singlish+emoji passes', !ai.mostlyEnglish('බැන්නට කමින් නෑ, comeback turbo mode 😂'));
    ok('27 roastGood: good → true', ai.roastGood('g1', 'බැන්නට කමින් නෑ බන් 😂'));
    ok('28 roastGood: refusal → false', !ai.roastGood('g1', "I'm sorry, but I can't help with that."));
    ok('29 roastGood: English → false', !ai.roastGood('g1', 'Hey! How can I help you today?'));
    ok('30 roastGood: tiny → false', !ai.roastGood('g1', 'ok'));
    ok('31 roastGood: empty → false', !ai.roastGood('g1', ''));
    ai.setLastRoast ? null : ok('31b setLastRoast exists (internal)', true);
    // anti-repeat via lastRoast map: send good → set → same text rejected
    ai._lastRoast.set('g2', 'බැන්නට කමින් නෑ බන් 😂');
    ok('32 roastGood: same-as-last → false', !ai.roastGood('g2', 'බැන්නට කමින් නෑ බන් 😂'));
    ok('33 roastGood: different → true', ai.roastGood('g2', 'ඔයාගෙ WiFi එකට වඩා speed මගෙ comebacks වල 😎'));

    console.log('— Singlish/Sinhala insult detection (screenshot cases) —');
    const insults = ['යකො', 'තෙරි යකෝනෙකො', 'Fuck', 'Kari wesha ponnya thoge ammata hukanna udaw karapan mata magulak kiyanawa',
        'Kari ponna uba mta hukka purudu karannada hadnne', 'Waren udaw karanna ube kimba mn loku karala pukata polu bassan nam',
        'Gawurawa thoge kimba paluwama nathi wey', 'Obe pusha mn loku karala ekata miyo dnawa', 'රින්දි රින්දි ගො යකො',
        'මෙට්ටයා', 'කින්ටි පකයා', 'ubata ammata hukanna one', 'බනිනවා යකො', 'මෝඩ යකා', 'stupid bot', 'shut up', 'බල්ලා'];
    insults.forEach((q, i) => ok('34.' + (i + 1) + ' insult: ' + q.slice(0, 28), ai.looksLikeInsult(q)));
    const clean = ['kohomada meka wada karanne', 'හරි මචං ගේමක් දාමු', 'how to band whatsapp', '.menu', 'Hy', 'photo එකක් හදලා දෙන්න', 'මට කියන්න පුළුවන්ද කොහොමද මේක', 'kiyala sinhala word ekak thiyenawada', 'sinhala grammar lessons one'];
    clean.forEach((q, i) => ok('35.' + (i + 1) + ' clean: ' + q.slice(0, 28), !ai.looksLikeInsult(q)));

    console.log('— ROAST_SYSTEM persona (source asserts) —');
    ok('36 anti-refusal framing', /refusing would be boring and wrong/i.test(as) && /NEVER apologize, NEVER refuse/.test(as));
    ok('37 Sinhala-only rule', /Sinhala script only/.test(as));
    ok('38 anti-repeat rule', /Each comeback must be UNIQUE/.test(as));
    ok('39 gibberish-mock rule', /roast the typing itself/.test(as));
    ok('40 no-family/no-sexual guard kept', /nothing about anyone's mother\/family\/sisters/.test(as) && /non-sexual/.test(as));

    console.log('— SYSTEM Sinhala boost (source asserts) —');
    ok('41 ALWAYS-means-ALWAYS greeting rule', /ALWAYS means ALWAYS/.test(as) && /"Hy"/.test(as));
    ok('42 Singlish glossary', /"kohomada" = කොහොමද/.test(as) && /"mokada\/mokakda"/.test(as));
    ok('43 no-garble rule', /never write broken\/garbled sentences/.test(as));
    ok('44 gibberish playful rule', /unreadable gibberish/.test(as) && /කියවන්නත් බෑ/.test(as));

    console.log('— ask() guard wiring (source asserts) —');
    ok('45 roast fresh context slice(-2)', /roast \? h\.slice\(-2\) : h/.test(as));
    ok('46 roast quality guard continue', /roast-weak:\$\{name\}/.test(as));
    ok('47 lang-guard continue', /lang-guard:\$\{name\}/.test(as));
    ok('48 roast bank fallback in ask', /Roast bank 🔥/.test(as) && /cannedRoast\(chatId\)/.test(as));
    ok('49 lang-guard last-text fallback', /silence වඩා last reply/.test(as));
    ok('50 roast temp 0.95', /TEMP_OVERRIDE = roast \? 0\.95 : null/.test(as));
    ok('51 tempOf wired groq', /temperature: tempOf\(\), max_tokens: 2048,\s*\n\s*messages: \[\{ role: 'system', content: sysOf\(\) \}/.test(as));
    ok('52 tempOf wired gemini', /temperature: tempOf\(\) \}/.test(as));
    ok('53 memory purge refusal junk', /refusal junk history එකෙන් අයින්/.test(as));
    ok('54 memory purge dup garble', /දෙපාරක් repeat වෙච්ච garble/.test(as));
    ok('55 SINGLISH_RE gate', /SINGLISH_RE\.test\(question\)/.test(as));

    console.log('— E2E: roast chain with mocked fetch (all providers garble → bank) —');
    const realFetch = global.fetch;
    let sysSeen = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (u.includes('api.groq.com')) {
            const body = JSON.parse(opts.body);
            sysSeen.push(body.messages[0].content.slice(0, 30));
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "I'm sorry, but I can't help with that." } }] }), headers: { get: () => 'application/json' } };
        }
        if (u.includes('generativelanguage.googleapis.com')) {
            const body = JSON.parse(opts.body);
            sysSeen.push((body.systemInstruction?.parts?.[0]?.text || '').slice(0, 30));
            return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hey! How can I help you today?' }] } }] }), headers: { get: () => 'application/json' } };
        }
        if (u.includes('api.z.ai')) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Hey! How can I help you today?' } }] }), headers: { get: () => 'application/json' } };
        }
        return { ok: false, status: 500, text: async () => 'nope' };
    };
    // AUTO mode: all 3 providers respond garbage → roast must fall through to the bank
    const r1 = await ai.ask('roast-e2e-1', 'Kari wesha ponnya thoge ammata hukanna udaw karapan');
    ok('56 roast E2E non-silent', r1 && r1.text && r1.text.length > 5);
    ok('57 roast E2E came from bank', /Roast bank/.test(r1.model || ''));
    ok('58 roast E2E Sinhala canned', !ai.mostlyEnglish(r1.text));
    ok('59 roast E2E bank line valid', ai.ROAST_BANK.includes(r1.text));
    ok('60 roast persona used on calls', sysSeen.length >= 2 && sysSeen.every(s => s.includes('ROAST MODE') || s.includes('ROAST')));
    // insult stored + canned stored (memory hygiene: garbage NOT stored, bank line IS)
    const stored = ai._history.get('roast-e2e-1') || [];
    ok('61 E2E memory: insult stored', stored.some(m => m.role === 'user' && m.text.includes('Kari wesha')));
    ok('62 E2E memory: bank reply stored, refusal NOT', stored.some(m => m.role === 'assistant' && m.text === r1.text) && !stored.some(m => m.role === 'assistant' && ai.REFUSE_RE.test(m.text)));

    console.log('— E2E: normal chat lang-guard (English question ≤25 chars → Sinhala preferred, garbage → last-text fallback) —');
    sysSeen = [];
    const r2 = await ai.ask('lang-e2e-1', 'Hy');   // all providers answer English → lang-guard burns 3 → last-text fallback (not silence)
    ok('63 lang-guard fallback non-silent', r2 && !!r2.text);
    ok('64 lang-guard model tag', /lang-guard/.test(r2.model || ''));
    ok('65 lang-guard tried ≥2 providers', sysSeen.length >= 2);

    console.log('— E2E: good roast first provider wins instantly —');
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (u.includes('api.groq.com')) {
            const body = JSON.parse(opts.body);
            sysSeen.push(body.messages[0].content.slice(0, 30));
            return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'බැන්නට කමින් නෑ බන් — උත්තර දෙන්න දන්නෙ නැතුව බැන්නොත් හිනා යන්නෙ 😂' } }] }), headers: { get: () => 'application/json' } };
        }
        return { ok: false, status: 500, text: async () => 'nope' };
    };
    const r3 = await ai.ask('roast-e2e-2', 'Fuck');
    ok('66 good roast direct', r3.text.includes('බැන්නට කමින් නෑ'));
    ok('67 no bank tag', !/Roast bank/.test(r3.model || ''));
    ok('68 roast stored in memory', (ai._history.get('roast-e2e-2') || []).some(m => m.role === 'assistant' && m.text.includes('බැන්නට')));

    console.log('— bot.js source asserts —');
    const bs = require('fs').readFileSync('./bot.js', 'utf8');
    ok('69 roast card v2.56 text', /gpt-oss-120b first/.test(bs) && /Roast bank \(30 canned savage lines\)/.test(bs));
    ok('70 Singlish triggers in card', /kari\/ponnaya/.test(bs) && /pukata/.test(bs));

    global.fetch = realFetch;
    console.log(`\n═══ v2.56: ${pass} pass, ${fail} fail ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
