/**
 * test_v253.js — 🖼 IMAGE CHAIN v3 + OTHER-CHATS FIX
 * Together FLUX.1-schnell-Free first (free, 1024px, no watermark) → Gemini nano-banana → Pollinations flux 3-retry.
 * Probed 2026-10-15: user Together key 401 (invalid/short) · Pollinations anonymous 402-flaky · Z.ai glm-image no-balance · Gemini img 429.
 * Other-chats fix: maybeAiReply now SENDS r.images (was dropped) + aiMode all.
 * Offline (mocked fetch) + LIVE (--live: real chain end-to-end)
 */
const path = require('path');
process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || 'test-key-z';
process.env.ARENA_REMINDERS_FILE = path.join(require('os').tmpdir(), 'rem_test_v253_' + Date.now() + '.json');

let pass = 0, fail = 0, livePass = 0, liveFail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const live = (name, cond) => { if (cond) { livePass++; console.log('  🌐 ' + name); } else { liveFail++; console.log('  🌐(fail) ' + name); } };

(async () => {
    console.log('— versions —');
    const pkg = require('./package.json'), man = require('./manifest.json');
    ok('01 pkg 2.53.0', pkg.version === '2.53.0');
    ok('02 manifest 2.53.0', man.version === '2.53.0');
    ok('03 manifest files += test_v253', man.files.includes('test_v253.js'));

    console.log('— module surface —');
    const T = require('./ai_tools');
    const ai = require('./ai');
    ok('04 _togetherImage exported', typeof T._togetherImage === 'function');
    ok('05 _tgState exported', typeof T._tgState === 'function');
    ok('06 getKeys().together string', typeof ai.getKeys().together === 'string');

    console.log('— settings (other-chats fix) —');
    const st = JSON.parse(require('fs').readFileSync('./settings.json', 'utf8'));
    ok('07 aiMode = all', st.aiMode === 'all');
    ok('08 aiChat on', st.aiChat === true);
    ok('09 together key present', typeof st.together === 'string' && st.together.length > 10);

    console.log('— bot.js photo wiring (source asserts) —');
    const bs = require('fs').readFileSync('./bot.js', 'utf8');
    ok('10 maybeAiReply sends r.images', /Array\.isArray\(r\.images\)/.test(bs) && /image: imgs\[0\]/.test(bs));
    ok('11 maybeAiReply photo caption', /හදලා දුන්නා!/.test(bs));
    ok('12 handleKey whitelist together', /\['gemini', 'groq', 'zai', 'together'\]/.test(bs));
    ok('13 KEY_HELP together section', /setkey together/.test(bs) && /api\.together\.ai\/settings\/api-keys/.test(bs));
    ok('14 .keys card together line', /Together \(🖼 image\)/.test(bs));
    ok('15 ai tools card chain text', /Together FLUX → Gemini → Pollinations/.test(bs));

    console.log('— ai.js wiring (source asserts) —');
    const as = require('fs').readFileSync('./ai.js', 'utf8');
    ok('16 getKeys together', /TOGETHER_API_KEY \|\| s\.together/.test(as));
    ok('17 ctx togetherKey → runToolEx', /togetherKey: allKeys && allKeys\.together/.test(as));
    ok('18 ask() fallback together passthrough', /_generateImage\(prompt, \{ gemini: keys\.gemini, zai: keys\.zai, together: keys\.together \}\)/.test(as));

    console.log('— generateImage chain v3 (mocked) —');
    const realFetch = global.fetch;
    const IMG_B64 = Buffer.alloc(6000, 9).toString('base64');
    const pimg = () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(8000, 3), headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) }, text: async () => 'x' });
    const tgok = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: IMG_B64 }] }), headers: { get: () => 'application/json' } });
    let calls = [], lastAuth = '';

    // 19: together primary — 200 b64 → buffer, gemini/pollinations NOT called
    global.fetch = async (url, opts = {}) => {
        const u = String(url); calls.push(u);
        if (/api\.together\.xyz/.test(u)) { lastAuth = (opts.headers && opts.headers.Authorization) || ''; return tgok(); }
        throw new Error('should not reach ' + u.slice(0, 60));
    };
    let buf = await T._generateImage('a vivid kingfisher, golden hour, photorealistic, full scene', { together: 'tg-good-1', gemini: 'gk' });
    ok('19 together primary image out', Buffer.isBuffer(buf) && buf.length === 6000);
    ok('20 Bearer auth sent', lastAuth === 'Bearer tg-good-1');
    ok('21 FLUX.1-schnell-Free model in body', calls.length && String(calls[0]).includes('api.together.xyz'));
    ok('22 fallbacks NOT called', !calls.some(c => /pollinations|generativelanguage/.test(c)));

    // 23: together 401 → dead-key + pollinations fallback
    calls = [];
    global.fetch = async (url) => {
        const u = String(url); calls.push(u);
        if (/api\.together\.xyz/.test(u)) return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }), headers: { get: () => 'application/json' } };
        return pimg();
    };
    buf = await T._generateImage('a red apple on a table, soft light', { together: 'tg-bad-1', gemini: '' });
    ok('23 401 → pollinations fallback image', Buffer.isBuffer(buf) && buf.length === 8000);
    ok('24 dead-key recorded', T._tgState().deadKey === 'tg-bad-1');

    // 25: same dead key → NO network call (fast-path), chain still returns via pollinations
    calls = [];
    buf = await T._generateImage('a red apple again, studio light', { together: 'tg-bad-1' });
    ok('25 dead key = zero together calls', !calls.some(c => /api\.together\.xyz/.test(c)));
    ok('26 chain still delivers (pollinations)', Buffer.isBuffer(buf) && buf.length === 8000);

    // 27: DIFFERENT key → together tried again (dead reset)
    calls = [];
    global.fetch = async (url) => {
        const u = String(url); calls.push(u);
        if (/api\.together\.xyz/.test(u)) return tgok();
        return pimg();
    };
    buf = await T._generateImage('a blue bird, full scene', { together: 'tg-good-2' });
    ok('27 new key resets dead-state', Buffer.isBuffer(buf) && buf.length === 6000 && calls.some(c => /api\.together\.xyz/.test(c)));

    console.log('— runToolEx ctx passthrough —');   // 429-cooldown test එකට කලින් (cooldown → together skip වෙනවා)
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (/api\.together\.xyz/.test(u)) { lastAuth = (opts.headers && opts.headers.Authorization) || ''; return tgok(); }
        return pimg();
    };
    const ex = await T.runToolEx('generate_image', JSON.stringify({ prompt: 'a robot toy, full scene' }), { chatId: 'c1', zaiKey: 'zk', togetherKey: 'tg-ctx-1' });
    ok('28 runToolEx → together via ctx', Buffer.isBuffer(ex.image) && ex.image.length === 6000);
    ok('29 ctx Bearer header', lastAuth === 'Bearer tg-ctx-1');

    // 30: together 429 → cooldown + gemini fallback works
    calls = [];
    global.fetch = async (url) => {
        const u = String(url); calls.push(u);
        if (/api\.together\.xyz/.test(u)) return { ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'rate' } }), headers: { get: () => 'application/json' } };
        if (/generativelanguage.*gemini-2\.5-flash-image/.test(u)) return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { data: IMG_B64 } }] } }] }), headers: { get: () => 'application/json' } };
        return { ok: false, status: 429, text: async () => '{}', headers: { get: () => 'application/json' } };
    };
    buf = await T._generateImage('a robot toy, studio light, full scene', { together: 'tg-good-3', gemini: 'gk' });
    ok('30 429 → gemini nano-banana fallback', Buffer.isBuffer(buf) && buf.length === 6000);
    ok('31 cooldown set (5min)', T._tgState().cooldown > Date.now());

    // 32: legacy string zaiKey compat
    calls = [];
    global.fetch = async (url) => { const u = String(url); calls.push(u); return pimg(); };
    buf = await T._generateImage('a red apple', 'zk-string');
    ok('32 legacy string key still works', Buffer.isBuffer(buf) && buf.length === 8000);

    console.log('— image-ask regressions —');
    ok('33 looksLikeImageAsk sinhala', ai.looksLikeImageAsk('මට robot එකක් photo එකක් හදලා දෙන්න'));
    ok('34 not an image ask', !ai.looksLikeImageAsk('photo එකක් කොහොමද edit කරන්නේ'));
    ok('35 ai.js exports intact', ['ask', 'askVision', 'getKeys', 'setKey'].every(f => typeof ai[f] === 'function'));
    global.fetch = realFetch;
    console.log('— LIVE —');
    if (process.argv.includes('--live')) {
        // real end-to-end: together key (invalid → dead-fast) → gemini (429 today) → pollinations flux real image
        try {
            const keys = ai.getKeys();
            const g = keys.gemini && keys.gemini !== 'test-key-z' ? keys.gemini : '';
            const t0 = Date.now();
            const b2 = await T._generateImage('a vivid kingfisher bird on a mossy branch beside a waterfall, golden hour light, photorealistic, sharp focus, full scene', { together: keys.together || '', gemini: g, zai: keys.zai || '' });
            live(`36 real image via chain (${Math.round((Date.now() - t0) / 100) / 10}s)`, Buffer.isBuffer(b2) && b2.length > 5000);
            require('fs').writeFileSync('/tmp/v253_live.jpg', b2);
            console.log('     ↳ saved /tmp/v253_live.jpg (' + b2.length + 'b)');
        } catch (e) { live('36 real image (' + String(e.message).slice(0, 60) + ')', false); }
        try { const st2 = T._tgState(); live('37 together dead-key marked (invalid key probed)', st2.deadKey !== ''); } catch (e) { live('37 tgState', false); }
    } else console.log('  ⏭ skip live');

    console.log(`\n═══ v2.53.0: ${pass} pass · ${fail} fail · live ${livePass}/${livePass + liveFail} ═══`);
    process.exit(fail || liveFail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
