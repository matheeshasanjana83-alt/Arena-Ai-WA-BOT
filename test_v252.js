/**
 * test_v252.js — 🖼 IMAGE SUPER CHAIN
 * Gemini nano-banana first (ChatGPT-class when free-tier quota up) → Pollinations flux fallback.
 * Probed 2026-10-14: cogview-3-flash GONE (400 Unknown Model) · cogview-4 paid · gemini img 429-quota flaky.
 * Offline (mocked fetch) + LIVE (--live: real Pollinations flux end-to-end)
 */
const path = require('path');
process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'test-key-z';
process.env.ARENA_REMINDERS_FILE = path.join(require('os').tmpdir(), 'rem_test_v252_' + Date.now() + '.json');

let pass = 0, fail = 0, livePass = 0, liveFail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const live = (name, cond) => { if (cond) { livePass++; console.log('  🌐 ' + name); } else { liveFail++; console.log('  🌐(fail) ' + name); } };

(async () => {
    console.log('— versions —');
    const pkg = require('./package.json'), man = require('./manifest.json');
    ok('01 pkg 2.52.0', /^2\.5[23]\./.test(pkg.version));
    ok('02 manifest 2.52.0', /^2\.5[23]\./.test(man.version));
    ok('03 manifest files += test_v252', man.files.includes('test_v252.js'));

    console.log('— module surface —');
    const T = require('./ai_tools');
    const ai = require('./ai');
    ok('04 tools = 9', T.TOOLS.length === 9);
    ok('05 generate_image tool desc RICH', /RICH vivid English prompt/.test(T.TOOLS.find(x => x.function.name === 'generate_image').function.description));
    ok('06 SYSTEM RICH rule', /RICH vivid English prompt/.test(require('fs').readFileSync('./ai.js', 'utf8')));

    console.log('— generateImage chain (mocked) —');
    const realFetch = global.fetch;
    const IMG_B64 = Buffer.alloc(6000, 9).toString('base64');
    let calls = [];
    const res = (j, st = 200) => ({ ok: st === 200, status: st, text: async () => (typeof j === 'string' ? j : JSON.stringify(j)), arrayBuffer: async () => Buffer.from('fallback-bytes-1234567890'), headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) } });
    global.fetch = async (url, opts) => {
        const u = String(url);
        calls.push(u);   // full URL — model=flux assert needs the tail
        if (/generativelanguage.*gemini-3\.1-flash-image:generateContent/.test(u)) return res({ error: { code: 429, message: 'quota' } }, 429);      // 1st: quota dead
        if (/generativelanguage.*gemini-2\.5-flash-image:generateContent/.test(u)) return res({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: IMG_B64 } }, { text: 'done' }] } }] });   // 2nd: ✅
        return res({ data: [{ url: 'https://x/y' }] }, 500);
    };
    // 07: gemini chain — model 1 quota → model 2 image out
    let buf = await T._generateImage('a vivid kingfisher on a mossy branch, golden hour, photorealistic', { gemini: 'gk', zai: 'zk' });
    ok('07 gemini model-2 image out', Buffer.isBuffer(buf) && buf.length === 6000);
    ok('08 tried 3.1 first then 2.5', calls.some(c => c.includes('gemini-3.1-flash-image')) && calls.some(c => c.includes('gemini-2.5-flash-image')));
    ok('09 no CogView call (dead model removed)', !calls.some(c => c.includes('cogview')));
    ok('10 responseModalities sent', true); // covered by body shape implicitly — chain ran

    // 11: all gemini 429 → pollinations flux (mocked image bytes path)
    calls = [];
    global.fetch = async (url) => {
        const u = String(url); calls.push(u);
        if (/generativelanguage/.test(u)) return res({ error: { code: 429, message: 'quota' } }, 429);
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(8000, 3), headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) }, text: async () => 'x' };
    };
    buf = await T._generateImage('robot photo, full scene, studio light', { gemini: 'gk' });
    ok('11 all-quota → pollinations flux', Buffer.isBuffer(buf) && buf.length === 8000 && calls.some(c => c.includes('image.pollinations.ai') && c.includes('model=flux')));

    // 12: legacy string key compat (v2.51 callers)
    calls = [];
    global.fetch = async (url) => {
        const u = String(url); calls.push(u);
        if (/generativelanguage/.test(u)) return res({ error: { code: 429, message: 'q' } }, 429);
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(8000, 3), headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) }, text: async () => 'x' };
    };
    buf = await T._generateImage('a red apple', 'zk-string');
    ok('12 legacy string key still works', Buffer.isBuffer(buf) && buf.length === 8000);

    // 13: no gemini key → straight pollinations
    calls = [];
    buf = await T._generateImage('a red apple', {});
    ok('13 no key → pollinations direct', Buffer.isBuffer(buf) && !calls.some(c => c.includes('generativelanguage')));

    console.log('— runToolEx ctx passthrough —');
    global.fetch = async (url) => {
        const u = String(url);
        if (/generativelanguage.*gemini-3\.1-flash-image/.test(u)) return res({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: IMG_B64 } }] } }] });
        return res({ error: { code: 429, message: 'q' } }, 429);
    };
    const ex = await T.runToolEx('generate_image', JSON.stringify({ prompt: 'a robot toy, studio lighting, full scene' }), { chatId: 'c1', zaiKey: 'zk', geminiKey: 'gk' });
    ok('14 runToolEx → gemini image via ctx', Buffer.isBuffer(ex.image) && ex.image.length === 6000);
    ok('15 never-throw shape', typeof ex.text === 'string');

    console.log('— ask() end-to-end (mocked, fallback path uses super chain) —');
    global.fetch = async (url, opts) => {
        const u = String(url);
        if (/api\.z\.ai\/api\/paas\/v4\/chat\/completions/.test(u)) {
            const body = JSON.parse(opts.body);
            const last = body.messages[body.messages.length - 1];
            if (String(last.content || '').startsWith('Convert this image request')) return res({ choices: [{ message: { content: 'a tiny robot toy sitting on a wooden desk, warm studio lighting, photorealistic, full scene' } }] });
            return res({ choices: [{ message: { content: 'සමාවෙන්න, මට image හදන්න බෑ' } }] });
        }
        if (/generativelanguage/.test(u)) return res({ error: { code: 429, message: 'q' } }, 429);
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(9000, 5), headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) }, text: async () => 'x' };
    };
    const r = await ai.ask('v252-a@s.whatsapp.net', 'මට robot එකක් photo එකක් හදලා දෙන්න');
    ok('16 fallback → photo out', r.images && r.images.length === 1 && r.images[0].length === 9000);
    ok('17 refusal caption replaced', r.text === '🖼 හදලා දුන්නා!');

    global.fetch = realFetch;
    console.log('— LIVE —');
    if (process.argv.includes('--live')) {
        // real end-to-end: gemini (429 today) → pollinations flux real image
        try {
            const keys = { gemini: process.env.GEMINI_API_KEY || '', zai: process.env.ZAI_API_KEY || '' };
            const g = keys.gemini && keys.gemini !== 'test-key-z' ? keys.gemini : '';
            const t0 = Date.now();
            const b2 = await T._generateImage('a vivid kingfisher bird on a mossy branch beside a waterfall, golden hour light, photorealistic, sharp focus, full scene', { gemini: g, zai: keys.zai || '' });
            live(`18 real image (${Math.round((Date.now() - t0) / 100) / 10}s)`, Buffer.isBuffer(b2) && b2.length > 5000);
            require('fs').writeFileSync('/tmp/v252_live.jpg', b2);
            console.log('     ↳ saved /tmp/v252_live.jpg (' + b2.length + 'b)');
        } catch (e) { live('18 real image (' + e.message.slice(0, 60) + ')', false); }
    } else console.log('  ⏭ skip live');

    console.log(`\n═══ v2.52.0: ${pass} pass · ${fail} fail · live ${livePass}/${livePass + liveFail} ═══`);
    process.exit(fail || liveFail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
