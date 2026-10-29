/* test_v249 — AI PROVIDER SELECTOR + geo-block bypass (offline)
   • setProvider/getProvider: alias (z.ai→zai), invalid → auto('')
   • ask(): preferred provider first, per-URL mock (gemini/groq style), fallback when key missing
   • net.js viaPool export + ai.js geo-block retry wiring (source asserts)
   • bot.js: .setting option 10, caption lines, 1-10 error, .aiprovider route, AI menu line
   • version >= 2.49.0
*/
process.env.ARENA_NO_DELAY = '1';
process.env.DL_TMP = require('os').tmpdir();

const fs = require('fs');
const path = require('path');
const SETF = path.join(__dirname, '..', 'settings.json');
const SET_BACK = fs.existsSync(SETF) ? fs.readFileSync(SETF, 'utf8') : null;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

fs.writeFileSync(SETF, JSON.stringify({ react: false, autoUpdate: false, gemini: 'FAKE-GEM', groq: 'FAKE-GROQ' }, null, 2));

let urlsHit = [];
global.fetch = async (url) => {
    urlsHit.push(String(url));
    if (String(url).includes('api.groq.com')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'OK-GROQ' } }] }) };
    }
    if (String(url).includes('generativelanguage')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK-GEMINI' }] } }] }) };
    }
    return { ok: false, status: 500, text: async () => 'mock-no-route' };
};

const ai = require('../ai');

(async () => {
    // 1. provider pref basics
    ai.setProvider('groq');
    ok('01 setProvider groq → getProvider groq', ai.getProvider() === 'groq');
    ai.setProvider('z.ai');
    ok('02 alias z.ai → zai', ai.getProvider() === 'zai');
    ai.setProvider('bogus');
    ok('03 invalid → auto (empty)', ai.getProvider() === '');
    ok('04 settings.aiProvider removed for auto', !JSON.parse(fs.readFileSync(SETF, 'utf8')).aiProvider);

    // 2. default order: gemini first
    urlsHit = [];
    const r1 = await ai.ask('c1@s.whatsapp.net', 'q1');
    ok('05 default: gemini answers first', urlsHit[0].includes('generativelanguage') && r1.text === 'OK-GEMINI');

    // 3. preferred provider: groq first
    ai.setProvider('groq');
    urlsHit = [];
    const r2 = await ai.ask('c2@s.whatsapp.net', 'q2');
    ok('06 preferred groq: groq URL first', urlsHit[0].includes('api.groq.com'));
    ok('07 preferred groq: groq answer', r2.text === 'OK-GROQ');

    // 4. fallback: pref zai but no zai key → gemini answers (default order)
    ai.setProvider('zai');
    urlsHit = [];
    const r3 = await ai.ask('c3@s.whatsapp.net', 'q3');
    ok('08 pref zai + no key → falls to gemini', urlsHit[0].includes('generativelanguage') && r3.text === 'OK-GEMINI');

    // 5. back to auto
    ai.setProvider('');
    ok('09 setProvider("") → auto', ai.getProvider() === '');

    // 6. geo-block bypass wiring (source asserts — offline safe)
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'ai.js'), 'utf8');
    const netSrc = fs.readFileSync(path.join(__dirname, '..', 'net.js'), 'utf8');
    ok('10 net.js exports viaPool', /module\.exports = \{ smartFetch, diagnose, dohResolve, getProxy, explain, hasUndici: \(\) => !!undici, viaPool,/.test(netSrc));
    ok('11 ai.js gemini geo-block → viaPool retry', /location is not supported\|FAILED_PRECONDITION\|forbidden/.test(aiSrc) && aiSrc.includes("require('./net').viaPool(url, opts)"));
    ok('12 ai.js groq 403 → viaPool retry', (aiSrc.match(/require\('\.\/net'\)\.viaPool\(url, opts\)/g) || []).length >= 2);
    ok('13 ask(): pref sort before loop', /const pref = getProvider\(\)/.test(aiSrc) && /order\.sort\(\(a, b\) => \(b\[0\] === pref\)/.test(aiSrc));

    // 7. bot wiring (source asserts)
    const botSrc = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
    ok('14 bot: .setting case 10 cycles provider', /case 10: \{[^]*ai\.setProvider\(nxt\)/.test(botSrc));
    ok('15 bot: caption option 10 line', botSrc.includes('10 | AI Provider:'));
    ok('16 bot: caption AI PROVIDER line', botSrc.includes('*AI PROVIDER:*'));
    ok('17 bot: error text 1 – 10', botSrc.includes('1 – 10 අතර'));
    ok('18 bot: .aiprovider route', botSrc.includes("c === '.aiprovider'") && botSrc.includes('ai.setProvider(arg2)'));
    ok('19 bot: AI menu provider line', botSrc.includes('*.aiprovider gemini/groq/zai/auto*'));
    ok('19b bot: .ai log shows WA reply preview (panel log ≠ WhatsApp display)', botSrc.includes('→ ${String(text)'));

    // 8. version
    const pkg = require('../package.json');
    const [maj, min] = String(pkg.version).split('.').map(Number);
    ok('20 version >= 2.49.0', maj > 2 || (maj === 2 && (min > 49 || (min === 49))));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).then(() => {
    if (SET_BACK !== null) fs.writeFileSync(SETF, SET_BACK); else { try { fs.unlinkSync(SETF); } catch { } }
    console.log('settings restored');
});
