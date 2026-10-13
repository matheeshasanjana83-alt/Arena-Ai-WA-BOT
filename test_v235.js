/**
 * test_v235 — AI Z.ai (GLM) provider (offline: mock fetch + temp settings.json)
 *  • key wiring (settings.json zai / setKey / getKeys)
 *  • balance fallback: glm-4.6 (429/1113) → glm-4.5-air → glm-4.5-flash
 *  • zaiDead session memory (dead models skipped → fail fast)
 *  • request shape: endpoint, Bearer, thinking:disabled, system, temperature
 *  • reasoning_content NEVER in reply (content only)
 *  • provider order Gemini → Groq → Z.ai intact
 *  • bot.js wiring: .keys / KEY_HELP / AI menu / handleKey whitelist+aliases
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };

const SET = path.join(__dirname, 'settings.json');
const backup = fs.existsSync(SET) ? fs.readFileSync(SET) : null;
try { fs.unlinkSync(SET); } catch { }
delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.ZAI_API_KEY;

// version bump
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
console.log('\n— version —');
t('package.json = 2.35.0', pkg.version === '2.35.0');
t('manifest.json = 2.35.0', man.version === '2.35.0');
t('manifest: test_v235 in files, test_v234 removed', man.files.includes('test_v235.js') && man.removed.includes('test_v234.js'));

// fresh ai module + zai-only settings
let ai = require('./ai');
ai.setKey('zai', '09ee99f588f141929c9f3fbf5abc5c63.G0f41dKhaC4iFUUB');
console.log('\n— key wiring —');
t('getKeys().zai = settings එකෙන්', ai.getKeys().zai === '09ee99f588f141929c9f3fbf5abc5c63.G0f41dKhaC4iFUUB');
t('gemini/groq නෑ', !ai.getKeys().gemini && !ai.getKeys().groq);

// mock fetch — Z.ai balance story: glm-4.6 + glm-4.5-air = 429 code 1113, flash works
const calls = [];
const J = (st, o) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
const BAL = { error: { code: '1113', message: 'Insufficient balance or no resource package. Please recharge.' } };
let flashMode = 'ok'; // 'ok' | 'empty' | 'balance'
let geminiOk = false;
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
    url = String(url);
    if (url.includes('api.z.ai')) {
        const body = JSON.parse(opt.body);
        calls.push({ url, body, auth: opt.headers?.Authorization || opt.headers?.authorization });
        if (body.model === 'glm-4.5-flash' && flashMode !== 'ok') {
            if (flashMode === 'balance') return J(429, BAL);
            return J(200, { choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'hmm' } }] });
        }
        if (body.model === 'glm-4.5-flash') return J(200, {
            choices: [{ finish_reason: 'stop', message: {
                content: '**ආයුබෝවන්!** මම KAVIZ AI — ඔයා ඇහුවේ: ' + body.messages.at(-1).content + ' (turns=' + (body.messages.length - 1) + ')',
                reasoning_content: 'SECRET THINKING — reply එකේ පෙන්න එන්නේ නෑ' } }] });
        return J(429, BAL); // glm-4.6 / glm-4.5-air
    }
    if (url.includes('generativelanguage')) {
        const body = JSON.parse(opt.body); calls.push({ url, body, auth: 'gemini' });
        if (!geminiOk) return J(503, { error: { message: 'overloaded' } });
        return J(200, { candidates: [{ content: { parts: [{ text: 'Gemini උත්තරය ✅' }] } }] });
    }
    return realFetch(url, opt);
};

console.log('\n— ask() via Z.ai (balance fallback) —');
(async () => {
    let r = await ai.ask('test-chat', 'හායි');
    t('glm-4.6/air balance-fail → glm-4.5-flash උත්තරය', r.model === 'GLM glm-4.5-flash' && /ආයුබෝවන්/.test(r.text) && /හායි/.test(r.text));
    t('calls: 4.6 + air + flash = 3', calls.length === 3);
    const c1 = calls[0];
    t('endpoint = api.z.ai/api/paas/v4/chat/completions', c1.url === 'https://api.z.ai/api/paas/v4/chat/completions');
    t('Bearer auth key එකමද', c1.auth === 'Bearer 09ee99f588f141929c9f3fbf5abc5c63.G0f41dKhaC4iFUUB');
    t('thinking: disabled (reasoning OFF)', c1.body.thinking?.type === 'disabled');
    t('system message = KAVIZ MD V1', c1.body.messages[0].role === 'system' && c1.body.messages[0].content.includes('KAVIZ MD V1'));
    t('temperature 0.7 + max_tokens 2048', c1.body.temperature === 0.7 && c1.body.max_tokens === 2048);
    t('reasoning_content reply එකේ නෑ', !r.text.includes('SECRET') && !r.text.includes('THINKING'));
    t('markdown → WhatsApp bold', /\*ආයුබෝවන්/.test(r.text) && !/\*\*/.test(r.text));

    // zaiDead session memory: 2nd ask → straight to flash
    calls.length = 0;
    r = await ai.ask('test-chat', 'ආයෙත් හායි');
    t('2වෙනි ask → 4.6/air SKIP (zaiDead memory) → flash 1 call', calls.length === 1 && calls[0].body.model === 'glm-4.5-flash');
    t('memory: turns=3 (system+2 history+1)', /turns=3/.test(r.text));

    // flash also dies → honest error
    flashMode = 'balance';
    let err = null;
    try { await ai.ask('x-chat', 'hi'); } catch (e) { err = e; }
    t('ඔක්කොම balance-dead → Insufficient balance error', !!err && /Insufficient balance/i.test(err.message));

    // provider order: gemini key + gemini ok → gemini first
    flashMode = 'ok'; geminiOk = true;
    ai.setKey('gemini', 'AIzaSyTESTKEY1234567890abcdef');
    calls.length = 0;
    r = await ai.ask('g-chat', 'hello');
    t('Gemini key+ok → Gemini මුලින්ම (order intact)', r.model.startsWith('Gemini') && calls[0].auth === 'gemini');

    // empty content path (fresh module — zaiDead reset)
    delete require.cache[require.resolve('./ai')];
    ai = require('./ai');
    ai.setKey('zai', '09ee99f588f141929c9f3fbf5abc5c63.G0f41dKhaC4iFUUB');
    ai.setKey('gemini', ''); // gemini OUT → zai path forced
    flashMode = 'empty';
    err = null;
    try { await ai.ask('e-chat', 'hi'); } catch (e) { err = e; }
    t('empty content + finish_reason → error message එකේ', !!err && /Z.ai empty answer \(stop\)/.test(err.message));
    flashMode = 'ok';

    // splitLong / reset regression
    t('splitLong regression', ai.splitLong('a'.repeat(8000)).length === 3);
    ai.reset('test-chat'); ai.reset('g-chat'); ai.reset('e-chat'); ai.reset('x-chat');

    // bot.js wiring (source-level)
    console.log('\n— bot.js wiring —');
    const bot = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    t('.keys → Z.ai (GLM) line', /Z\.ai \(GLM\): \$\{k\.zai/.test(bot));
    t('handleKey whitelist = gemini,groq,zai', /!?\['gemini', 'groq', 'zai'\]\.includes\(provider\)/.test(bot));
    t('handleKey z.ai/glm/z aliases', /raw === 'z\.ai' \|\| raw === 'glm' \|\| raw === 'z'/.test(bot));
    t('KEY_HELP Z.ai block', /Z\.ai \(GLM\):\*\\?n?1\. https:\/\/z\.ai/.test(bot) || bot.includes('*Z.ai (GLM):*'));
    t('AI menu setkey gemini/groq/zai', bot.includes('*.setkey gemini/groq/zai <KEY>*'));

    // ai.js syntax + noKey path
    t('.ai no key → NO_KEY error (ai.js direct)', await (async () => {
        delete require.cache[require.resolve('./ai')];
        const a2 = require('./ai');
        const s = JSON.parse(fs.readFileSync(SET, 'utf8')); delete s.zai; delete s.gemini; delete s.groq;
        fs.writeFileSync(SET, JSON.stringify(s));
        try { await a2.ask('nk', 'hi'); return false; } catch (e) { return e.noKey === true; }
    })());

    // cleanup
    try { fs.unlinkSync(SET); } catch { }
    if (backup) fs.writeFileSync(SET, backup);
    global.fetch = realFetch;

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
