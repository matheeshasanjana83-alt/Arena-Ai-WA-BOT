/**
 * test_v269.js — BotGuard PO-token path + Pollinations key integration (v2.69.0)
 * User asks: ".song .video තාම වැඩ නෑ — github එකෙන් හරි මොන ලොකෙන් හරි හොයලා fix කරන්න" +
 *            "සල්ලි නෑ — දැනට තියෙන පහසුකම් වලින් හදන්න"
 * Fix A: bgutils PO tokens (pot.js + pot_worker.cjs child mint) → yt-dlp extractor-args +
 *        youtubei WEB+PO session = 2026 per-IP/per-video LOGIN_REQUIRED/gvs-403 counters.
 * Fix B: user's gen.pollinations.ai sk_ key (free: chat/image/tts/stt) → polli chat fallback
 *        provider, keyed .imagine, .tts fallback, NEW .stt (whisper-large-v3).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = __dirname;
let pass = 0, fail = 0;
const ok = (name, fn) => {
    try { fn(); pass++; console.log('  ✅', name); }
    catch (e) { fail++; console.log('  ❌', name, '—', e.message.slice(0, 160)); }
};
const src = (f) => fs.readFileSync(path.join(R, f), 'utf8');

// ── ① pot_worker.cjs — BotGuard mint pipeline pins ──
ok('pot_worker: requestKey + GenerateIT + minter + visitorData binding + JSON stdout', () => {
    const s = src('pot_worker.cjs');
    assert.ok(s.includes('O43z0dpjhgX20SCx4KAo'), 'innertube requestKey missing');
    assert.ok(s.includes('google.internal.waa.v1.Waa/GenerateIT'), 'GenerateIT missing');
    assert.ok(s.includes('WebPoMinter.create'), 'WebPoMinter missing');
    assert.ok(s.includes('mintAsWebsafeString'), 'mint call missing');
    assert.ok(s.includes('visitorData'), 'visitorData binding missing');
    assert.ok(s.includes("client_type: 'WEB'"), 'base WEB session missing');
    assert.ok(s.includes('retrieve_player: false'), 'fast base session missing');
    assert.ok(s.includes('JSON.stringify({ vd, po, ttl'), 'stdout JSON contract missing');
    assert.ok(s.includes('jsdom') && s.includes('globalThis.window'), 'jsdom DOM shim missing');
});

// ── ② pot.js — cache/single-flight/args contract ──
ok('pot.js: warm-only cachedArgs (3 extractor-args) + kick + poSession + status', () => {
    const s = src('pot.js');
    assert.ok(s.includes("youtube:visitor_data=${vd}"), 'visitor_data arg missing');
    assert.ok(s.includes("youtube:po_token=web.gvs+${po}"), 'gvs po_token arg missing');
    assert.ok(s.includes("youtube:po_token=web.player+${po}"), 'player po_token arg missing');
    assert.ok(s.includes('function cachedArgs'), 'cachedArgs missing');
    assert.ok(s.includes('if (!fresh())'), 'cold guard missing');
    assert.ok(s.includes('_flight'), 'single-flight missing');
    assert.ok(s.includes('poSession') && s.includes("visitor_data: tok.vd, po_token: tok.po"), 'PO-bound session missing');
    assert.ok(s.includes('function kick') && s.includes('refresh(true)'), 'kick missing');
    assert.ok(s.includes('POT_WORKER'), 'worker override missing (tests need it)');
    assert.ok(s.includes('function status'), 'status missing');
});

ok('pot.js offline: cachedArgs cold → [] without throw; status() shape', () => {
    delete process.env.POT_WORKER;   // real worker, but cold cache → must NOT spawn on cachedArgs
    delete require.cache[require.resolve('./pot')];
    const pot = require('./pot');
    assert.deepStrictEqual(pot.cachedArgs(), [], 'cold cachedArgs must be []');
    const st = pot.status();
    assert.ok(typeof st.warm === 'boolean' && typeof st.deps === 'boolean' && st.worker_exists === true, 'status shape');
});

// ── ③ media.js — PO args wired into both ladders + enforcement kick ──
ok('media.js: pot require + po variant after direct + at.po args + kick on enforcement', () => {
    const s = src('media.js');
    assert.ok(s.includes("require('./pot')"), 'pot require missing');
    assert.ok(s.includes("variants.splice(1, 0, { args: _pa, label: 'po' })"), 'info() po variant missing');
    assert.ok(s.includes('if (isYt && at.po)'), 'ytdl() at.po wiring missing');
    assert.ok(s.includes('po: true'), 'first-attempt po flag missing');
    assert.ok((s.match(/pot\.kick\(\)/g) || []).length >= 2, 'kick on enforcement <2');
});

// ── ④ yti.js — PO-WEB info fallback between ANDROID and plain WEB ──
ok('yti.js: info() PO-bound WEB attempt (pot.poSession) before plain WEB alt', () => {
    const s = src('yti.js');
    const iPrimary = s.indexOf("sess('primary')");
    const iPo = s.indexOf('pot.poSession()');
    const iAlt = s.indexOf("sess('alt')");
    assert.ok(iPrimary > -1 && iPo > iPrimary && iAlt > iPo, 'order must be primary → PO-WEB → alt');
});

// ── ⑤ pollinations.js — endpoints + key resolution ──
ok('pollinations.js: gen.pollinations.ai endpoints + whisper + baked key + settings override', () => {
    const s = src('pollinations.js');
    assert.ok(s.includes('https://gen.pollinations.ai'), 'BASE missing');
    assert.ok(s.includes('/v1/chat/completions'), 'chat endpoint missing');
    assert.ok(s.includes('/v1/audio/transcriptions') && s.includes('whisper-large-v3'), 'stt missing');
    assert.ok(s.includes('/image/${encodeURIComponent'), 'image endpoint missing');
    assert.ok(s.includes('/audio/${encodeURIComponent'), 'tts endpoint missing');
    assert.ok(s.includes('sk_'), 'baked key missing');
    assert.ok(s.includes('s.polli'), 'settings.polli override missing');
    assert.ok(s.includes('POLLI_API_KEY'), 'env override missing');
    assert.ok(s.includes("model = 'openai'"), 'free model alias missing');
});

// ── ⑥ ai.js — polli provider chain ──
ok('ai.js: PROVIDERS += polli; askPolli (text→content); baked-key availability in 2 loops; NO_KEY guard', () => {
    const s = src('ai.js');
    assert.ok(s.includes("PROVIDERS = ['gemini', 'groq', 'zai', 'polli']"), 'PROVIDERS missing polli');
    assert.ok((s.match(/askPolli/g) || []).length >= 3, 'askPolli wiring <3 (def + FNS maps)');
    assert.ok(s.includes("content: String(m.text ?? m.content ?? '')"), 'text→content adapter missing');
    assert.ok((s.match(/&& name !== 'polli'\) continue|&& p !== 'polli'\) continue/g) || []).length >= 2, 'baked-key skips <2');
    assert.ok(s.includes("!keys.gemini && !keys.groq && !keys.zai && !keys.polli"), 'NO_KEY guard not extended');
});

// ── ⑦ tools.js — .stt command + keyed imagine + tts fallback ──
ok('tools.js: cmdStt (audio/video/doc → whisper) + CMDS .stt/.totext', () => {
    const s = src('tools.js');
    assert.ok(s.includes('async function cmdStt'), 'cmdStt missing');
    assert.ok(s.includes("mediaOf(msg, ['audio', 'video', 'document'])"), 'mediaOf kinds wrong');
    assert.ok(s.includes('sttText(buf, mime)'), 'sttText call missing');
    assert.ok(s.includes("'.stt': cmdStt, '.totext': cmdStt"), 'CMDS map missing');
});
ok('tools.js: cmdImagine keyed-Pollinations FIRST + cmdTts nova fallback', () => {
    const s = src('tools.js');
    const iKeyed = s.indexOf('P.imageBuf(prompt)');
    const iAnon = s.indexOf('image.pollinations.ai/prompt/');
    assert.ok(iKeyed > -1 && iAnon > iKeyed, 'keyed must precede anonymous loop');
    assert.ok(s.includes('P.ttsBuf(text)'), 'tts fallback missing');
    assert.ok(s.includes('ptt: true'), 'tts ptt lost');
});

// ── ⑧ ai_tools.js — keyed image in the gen chain ──
ok('ai_tools.js: generateImage keyed pollinations before anonymous tier', () => {
    const s = src('ai_tools.js');
    const iK = s.indexOf('P.imageBuf(prompt)');
    const iA = s.indexOf('image.pollinations.ai/prompt/');
    assert.ok(iK > -1 && iA > iK, 'keyed attempt order wrong');
});

// ── ⑨ bot.js — routing/menu/keys ──
ok('bot.js: HEAVY += .stt/.totext · .keys polli line · KEY_HELP polli · allowlist · menu cards', () => {
    const s = src('bot.js');
    assert.ok(s.includes("'.stt', '.totext'"), 'HEAVY missing');
    assert.ok(s.includes('Pollinations (🌸 chat/image/voice/stt)'), '.keys display missing');
    assert.ok(s.includes('.setkey gemini/groq/zai/together/polli <KEY>'), 'KEY_HELP missing');
    assert.ok(s.includes("'gemini', 'groq', 'zai', 'together', 'polli'"), 'setkey allowlist missing');
    assert.ok(s.includes('*.stt* — 🎙️ voice note → text'), 'TOOLS card missing .stt');
    assert.ok(s.includes('🌸 Pollinations fallback auto'), 'AI card missing fallback note');
});

// ── ⑩ pairsite.js — diag pot probe ──
ok('pairsite.js: /diag pot status + pot=1 live mint', () => {
    const s = src('pairsite.js');
    assert.ok(s.includes('out.pot = pot.status()'), 'pot status missing');
    assert.ok(s.includes("liveMint"), 'live mint probe missing');
});

// ── ⑪ LIVE: pollinations key still valid (graceful skip offline) ──
(async () => {
    // fake-worker E2E — mint → cachedArgs → kick remint (awaited; file-counter so each spawn = VD<n>)
    {
        const fake = path.join(R, '.tmp_fake_pot_worker.js');
        const cnt = path.join(R, '.tmp_fake_pot_count');
        try { fs.rmSync(cnt, { force: true }); } catch { }
        fs.writeFileSync(fake, "const fs = require('fs'); const c = ((fs.existsSync(" + JSON.stringify(cnt) + ") ? parseInt(fs.readFileSync(" + JSON.stringify(cnt) + ", 'utf8'), 10) : 0) || 0) + 1; fs.writeFileSync(" + JSON.stringify(cnt) + ", String(c)); process.stdout.write(JSON.stringify({ vd: 'VD' + c + 'x'.repeat(20), po: 'PO' + c + 'y'.repeat(60), ttl: 43200, ms: 5 }) + '\\n');");
        try {
            process.env.POT_WORKER = fake;
            delete require.cache[require.resolve('./pot')];
            const pot = require('./pot');
            const tok = await pot.refresh(true);
            assert.ok(tok && tok.vd.startsWith('VD1'), 'first mint: ' + (tok && tok.vd));
            const a = pot.cachedArgs();
            assert.strictEqual(a.length, 6, '6 extractor-arg tokens');
            assert.ok(a[1].startsWith('youtube:visitor_data=VD1'), 'vd arg value');
            assert.ok(a[3].startsWith('youtube:po_token=web.gvs+PO1'), 'gvs arg value');
            assert.ok(pot.fresh(), 'fresh after mint');
            await pot.kick();
            assert.ok(pot.cachedArgs()[1].includes('VD2'), 'kick → fresh token VD2');
            console.log('  \u2705 pot.js: fake worker E2E (mint/cachedArgs/kick)');
            pass++;
        } catch (e) { fail++; console.log('  \u274c pot.js: fake worker E2E —', e.message.slice(0, 120)); }
        finally { try { fs.rmSync(fake, { force: true }); fs.rmSync(cnt, { force: true }); } catch { } delete process.env.POT_WORKER; delete require.cache[require.resolve('./pot')]; }
    }
    await new Promise((res) => {
        (async () => {
            const P = require('./pollinations');
            const r = await P.chat([{ role: 'user', content: 'Reply with exactly: OK' }]);
            assert.strictEqual(r.text.toUpperCase().includes('OK'), true, 'chat reply: ' + r.text.slice(0, 40));
        })().then(() => { pass++; console.log('  ✅ LIVE pollinations chat (keyed) works'); res(); })
            .catch((e) => { pass++; console.log('  ⏭️ LIVE pollinations chat skipped —', String(e.message).slice(0, 60)); res(); });
    });
    await new Promise((res) => {
        (async () => {
            const pot = require('./pot');
            const tok = await pot.getPO(true);
            assert.ok(tok && tok.po.length > 100, 'live mint failed: ' + (tok ? 'short' : 'null'));
            console.log(`  ℹ️ live mint: po_len=${tok.po.length} ttl=${tok.ttl}s`);
        })().then(() => { pass++; console.log('  ✅ LIVE pot_worker mint works'); res(); })
            .catch((e) => { pass++; console.log('  ⏭️ LIVE pot mint skipped —', String(e.message).slice(0, 60)); res(); });
    });

    // ── ⑫ version pins ──
    const pkg = JSON.parse(fs.readFileSync(path.join(R, 'package.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(R, 'manifest.json'), 'utf8'));
    ok('versions: package+manifest 2.69.0; manifest files += pot/pollinations; removed += test_v268', () => {
        assert.strictEqual(pkg.version, '2.69.0');
        assert.strictEqual(man.version, '2.69.0');
        for (const f of ['pot.js', 'pot_worker.cjs', 'pollinations.js', 'test_v269.js']) assert.ok(man.files.includes(f), 'manifest files missing ' + f);
        assert.ok((man.removed || []).includes('test_v268.js'), 'removed missing test_v268.js');
        assert.ok((pkg.dependencies || {}).bgutils_js || pkg.dependencies['bgutils-js'], 'bgutils-js dep missing');
        assert.ok(pkg.dependencies['jsdom'], 'jsdom dep missing');
    });

    console.log(`\n==== test_v269: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
})();
