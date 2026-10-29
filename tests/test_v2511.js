/**
 * test_v2511.js — 🖼 PHOTO GUARANTEED-DELIVERY FIX
 * Root cause test: ai.ask() dropped res.images — GLM called generate_image, photo never reached bot.js.
 * v2.51.1: images passthrough + provider-independent fallback (AUTO/Gemini/Groq → photo too)
 * Offline (mocked fetch + mocked _generateImage) + LIVE (--live flag with real keys)
 */
const path = require('path');
process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'test-key-z';   // before ai require — offline mock path
process.env.ARENA_REMINDERS_FILE = path.join(require('os').tmpdir(), 'rem_test_v2511_' + Date.now() + '.json');

let pass = 0, fail = 0, livePass = 0, liveFail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const live = (name, cond) => { if (cond) { livePass++; console.log('  🌐 ' + name); } else { liveFail++; console.log('  🌐(fail) ' + name); } };

(async () => {
    console.log('— versions —');
    const pkg = require('../package.json'), man = require('../manifest.json');
    ok('01 pkg semver', /^\d+\.\d+\.\d+$/.test(pkg.version));
    ok('02 manifest semver', /^\d+\.\d+\.\d+$/.test(man.version));
    ok('03 manifest files += test_v2511', man.files.includes('tests/test_v2511.js'));

    console.log('— ai module exports —');
    const ai = require('../ai');
    const T = require('../ai_tools');
    ok('04 looksLikeImageAsk exported', typeof ai.looksLikeImageAsk === 'function');
    ok('05 imgPromptEn exported', typeof ai.imgPromptEn === 'function');
    ok('06 tools still 9', T.TOOLS.length === 9);

    console.log('— image-ask detection —');
    const A = ai.looksLikeImageAsk;
    ok('07 Sinhala ask (user report)', A('මට robot එකක් photo එකක් හදලා දෙන්න'));
    ok('08 Sinhala රූපයක්', A('මට ලස්සන රූපයක් අඳින්න'));
    ok('09 Sinhala පින්තූරයක්', A('පින්තූරයක් හදන්න cat එකක්'));
    ok('10 English ask', A('make me a cool robot photo'));
    ok('11 logo/design', A('මට channel එකට logo එකක් හදාගන්න'));
    ok('12 NOT: how-to question', !A('photo හදන විදිහ කියන්න'));
    ok('13 NOT: කොහොමද', !A('AI photo කොහොමද හදන්නේ app වලින්'));
    ok('14 NOT: plain photo look', !A('මගේ photo එක බලන්න'));
    ok('15 NOT: plain chat', !A('ලංකාවේ අගනුවර මොකක්ද?'));

    console.log('— imgPromptEn English direct (offline) —');
    const keys0 = ai.getKeys();
    ok('16 English passthrough', (await ai.imgPromptEn('a red sports car photo', keys0)) === 'a red sports car photo');
    ok('17 empty → an image', (await ai.imgPromptEn('', keys0)) === 'an image');

    console.log('— mocked ask() flow: fallback + passthrough —');
    const realFetch = global.fetch;
    const genCalls = { n: 0 };
    T._generateImage = async (prompt) => { genCalls.n++; genCalls.prompt = prompt; return Buffer.alloc(5000, 7); };   // ai.js → require lookup at call time
    let zaiReplies = [];
    const fakeRes = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) });
    global.fetch = async (url, opts) => {
        if (/api\.z\.ai\/api\/paas\/v4\/chat\/completions/.test(String(url))) {
            const body = JSON.parse(opts.body);
            const last = body.messages[body.messages.length - 1];
            if (last.role === 'tool') return fakeRes({ choices: [{ message: { content: zaiReplies.tool || 'done' } }] });
            if (String(last.content || '').startsWith('Convert this image request')) return fakeRes({ choices: [{ message: { content: zaiReplies.translate || 'a cute little robot toy, studio lighting, 4k' } }] });
            if (zaiReplies.toolCall) { zaiReplies.toolCall = false; return fakeRes({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'generate_image', arguments: '{"prompt":"a cute robot"}' } }] } }] }); }
            return fakeRes({ choices: [{ message: { content: zaiReplies.main || 'ok' } }] });
        }
        return realFetch(url, opts);
    };

    // 18: GLM lazy refusal + image ask → fallback photo + caption replaced
    zaiReplies = { main: 'සමාවෙන්න, මට image හදන්න බෑ' };
    genCalls.n = 0;
    let r = await ai.ask('v2511-a@s.whatsapp.net', 'මට robot එකක් photo එකක් හදලා දෙන්න');
    ok('18 fallback image buffer', r.images && r.images.length === 1 && r.images[0].length === 5000);
    ok('19 refusal caption replaced', r.text === '🖼 හදලා දුන්නා!');
    ok('20 translate ran (prompt En)', /robot/.test(String(genCalls.prompt)));

    // 21: non-refusal text kept
    zaiReplies = { main: 'මෙන්න ඔයාට 🤖' };
    genCalls.n = 0;
    r = await ai.ask('v2511-b@s.whatsapp.net', 'a cat image make for me');
    ok('21 text kept + image attached', r.text === 'මෙන්න ඔයාට 🤖' && r.images?.length === 1);

    // 22: non-image question → no fallback
    zaiReplies = { main: 'Colombo' };
    genCalls.n = 0;
    r = await ai.ask('v2511-c@s.whatsapp.net', 'ලංකාවේ අගනුවර මොකක්ද?');
    ok('22 no fallback for chat', genCalls.n === 0 && (!r.images || r.images.length === 0));

    // 23: tools OFF → no fallback
    ai.setTools(false);
    zaiReplies = { main: 'හදන්න බෑ දැන්' };
    genCalls.n = 0;
    r = await ai.ask('v2511-d@s.whatsapp.net', 'robot photo එකක් හදලා දෙන්න');
    ok('23 tools off → no fallback', genCalls.n === 0 && (!r.images || r.images.length === 0));
    ai.setTools(true);

    // 24: memory store got the final text (fallback caption, not refusal)
    const hA = ai._history.get('v2511-a@s.whatsapp.net');
    ok('24 memory has replaced caption', hA && hA.some(m => m.role === 'assistant' && m.text === '🖼 හදලා දුන්නා!'));

    global.fetch = realFetch;
    console.log('— LIVE (needs real keys + network) —');
    if (process.argv.includes('--live') && process.env.ZAI_API_KEY !== 'test-key-z') {
        const liveKeys = { gemini: process.env.GEMINI_API_KEY || '', groq: '', zai: process.env.ZAI_API_KEY };
        // 25: real generate_image (Pollinations keyless)
        try {
            const buf = await T._generateImage('a cute robot toy, studio lighting', '');
            live('25 real image buffer', Buffer.isBuffer(buf) && buf.length > 2000);
        } catch (e) { live('25 real image buffer (' + e.message + ')', false); }
        // 26: real .ai image-ask end-to-end (GLM tool path → photo out)
        try {
            const r2 = await ai.ask('v2511-live@s.whatsapp.net', 'මට robot එකක් photo එකක් හදලා දෙන්න');
            live('26 live ask → images out', Array.isArray(r2.images) && r2.images.length >= 1 && r2.images[0].length > 2000);
            console.log('     ↳ text: ' + String(r2.text).replace(/\s+/g, ' ').slice(0, 80));
        } catch (e) { live('26 live ask (' + String(e.message).slice(0, 60) + ')', false); }
    } else {
        console.log('  ⏭ skip live (run with --live + ZAI_API_KEY)');
    }

    console.log(`\n═══ v2.51.1: ${pass} pass · ${fail} fail · live ${livePass}/${livePass + liveFail} ═══`);
    process.exit(fail || liveFail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
