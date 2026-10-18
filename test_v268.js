/**
 * test_v268.js — Sachi-MD v1.1.0 PORT: .apk / .getdp / .vv + yt-dlp freshness fix (v2.68.0)
 * User ask: "මෙකෙ තියෙ මගෙ එකෙ නැති command .video .song එකත් තියෙ හොදට — මෙකෙ තියෙන එවා ඇඩ් කරන්න"
 * Delta found: .apk (APK downloader) · .getdp (profile photo) · .vv (view-once reveal) — the rest
 * (.video/.song engine, quality menus, tikwm, yt-search) KAVIZ already has, more advanced.
 * Bonus root-cause fix: panel GitHub API = 0/60 rate-limited → checkUpdate() silently NEVER ran
 * → stale yt-dlp = 2026 YouTube enforcement. Fix: quota-free releases/latest REDIRECT version check.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const R = __dirname;
let pass = 0, fail = 0;
const ok = (name, fn) => {
    try { fn(); pass++; console.log('  ✅', name); }
    catch (e) { fail++; console.log('  ❌', name, '—', e.message.slice(0, 160)); }
};

// ── ① source pins: apk.js ──
ok('apk.js: PK magic check + curl WAF resolve + all 3 search sources', () => {
    const s = fs.readFileSync(path.join(R, 'apk.js'), 'utf8');
    assert.ok(s.includes('0x50') && s.includes('0x4b'), 'PK magic missing');
    assert.ok(s.includes('d.apkpure.com/b/APK/'), 'APKPure endpoint missing');
    assert.ok(s.includes('curlResolve') && s.includes("execFile('curl'"), 'curl WAF resolve missing');
    assert.ok(s.includes('ws75.aptoide.com'), 'Aptoide missing');
    assert.ok(s.includes('searchFdroid') && s.includes('f-droid.org'), 'F-Droid missing');
    assert.ok(s.includes('play.google.com/store/search'), 'Play search missing');
    assert.ok(s.includes('fetchToFile'), 'must download via media.fetchToFile (file-based, not RAM)');
});
ok('apk.js: resolveInput matrix (empty/url/package/query)', () => {
    const a = require(path.join(R, 'apk.js'));
    assert.deepStrictEqual(a.resolveInput(''), { type: 'empty' });
    assert.deepStrictEqual(a.resolveInput('https://x/y.apk'), { type: 'url', value: 'https://x/y.apk' });
    assert.deepStrictEqual(a.resolveInput('com.whatsapp'), { type: 'package', value: 'com.whatsapp' });
    assert.strictEqual(a.resolveInput('whatsapp app').type, 'query');
    assert.strictEqual(a.PACKAGE_RE.test('com.whatsapp'), true);
    assert.strictEqual(a.PACKAGE_RE.test('whatsapp'), false, 'bare word is NOT a package');
});
ok('apk.js: metaFromLocation parses APKPure signed header (name/version/size)', () => {
    const a = require(path.join(R, 'apk.js'));
    const m = a.metaFromLocation('https://d.winudf.com/d?filename=com.test.app_2.3.4_APKPure.apk&full_size=52428800');
    assert.deepStrictEqual(m, { name: 'com.test.app', version: '2.3.4', sizeBytes: 52428800 });
    assert.strictEqual(a.metaFromLocation('https://x/y'), null);
});
ok('apk.js: XAPK → Aptoide-first preference + downloadApk fallback chains', () => {
    const s = fs.readFileSync(path.join(R, 'apk.js'), 'utf8');
    assert.ok(/\.xapk/i.test(s), 'xapk detection missing');
    const seg = s.slice(s.indexOf('async function downloadApk'));
    const iPure = seg.indexOf("['apkpure', 'aptoide']"), iFd = seg.indexOf("['fdroid', 'aptoide']"), iApt = seg.indexOf("['aptoide', 'apkpure']");
    assert.ok(iPure >= 0 && iFd >= 0 && iApt >= 0, 'fallback chains missing');
    assert.ok(seg.includes('size limit'), 'size cap must not retry');
});

// ── ② source pins: features.js wiring ──
ok('features.js: .apk bridge grammar — pick → ".apk __go" + pending stash, 0 → cancel, stale → usage', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    assert.ok(s.includes("apkPending.set(jid, { item, at: Date.now() })"), 'pending stash missing');
    assert.ok(s.includes("return '.apk __go'"), '__go missing');
    assert.ok(s.includes("return '.apk __cancel'"), '__cancel missing');
    assert.ok(s.includes('APK_TTL'), 'TTL missing');
});
ok('features.js: CMDS += apk/app/apkdl/getdp/dp/pp/vv/viewonce/reveal + handle cases + exports', () => {
    const f = require(path.join(R, 'features.js'));
    for (const c of ['.apk', '.app', '.apkdl', '.getdp', '.dp', '.pp', '.vv', '.viewonce', '.reveal']) assert.ok(f.CMDS.includes(c), c + ' missing from CMDS');
    assert.strictEqual(typeof f.apkMenuBridge, 'function');
    assert.strictEqual(typeof f.getdp, 'function');
    assert.strictEqual(typeof f.vv, 'function');
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    assert.ok(s.includes("case '.apk': case '.app': case '.apkdl':"), 'handle case missing');
    assert.ok(s.includes("case '.getdp': case '.dp': case '.pp':"), 'getdp case missing');
    assert.ok(s.includes("case '.vv': case '.viewonce': case '.reveal':"), 'vv case missing');
});
ok('features.js: .apk document send = fileName SIBLING key (Baileys contract) + APK mime', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    assert.ok(s.includes("document: { url: r.path }, fileName: r.fileName, mimetype: APK_MIME"), 'document shape wrong (fileName must be a sibling, not nested)');
    assert.ok(s.includes("application/vnd.android.package-archive"), 'APK mime missing');
});
ok('features.js: .video/.song "best" keyword → 2160 ladder / m4a original (Sachi parity)', () => {
    const f = require(path.join(R, 'features.js'));
    assert.deepStrictEqual(f.parseYtArgs('https://youtu.be/x best', 'video'), { query: 'https://youtu.be/x', height: 2160, aBit: null });
    assert.deepStrictEqual(f.parseYtArgs('song auto', 'audio'), { query: 'song', height: null, aBit: 'm4a' });
    assert.deepStrictEqual(f.parseYtArgs('x 64', 'audio'), { query: 'x', height: null, aBit: 64 });
    assert.deepStrictEqual(f.parseYtArgs('x 160k', 'audio'), { query: 'x', height: null, aBit: 160 });
});
ok('features.js: .vv reuses the shared mediaDownloader + view-once unwrap + usage guard', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    const seg = s.slice(s.indexOf('.vv — view-once'), s.indexOf('───────── Sticker'));
    assert.ok(seg.includes('mediaDownloader(src)'), 'must use the shared Baileys downloader');
    assert.ok(seg.includes('viewOnceMessageV2Extension') === false && s.includes('viewOnceMessageV2Extension'), 'unwrap helper must stay the shared one');
    assert.ok(seg.includes('if (!src)'), 'usage guard missing');
});
ok('features.js: .getdp = onWhatsApp check → profilePictureUrl → privacy-error guard', () => {
    const s = fs.readFileSync(path.join(R, 'features.js'), 'utf8');
    const seg = s.slice(s.indexOf('.getdp — profile photo'), s.indexOf('.vv — view-once'));
    assert.ok(seg.includes('onWhatsApp'), 'onWhatsApp check missing');
    assert.ok(seg.includes("profilePictureUrl(hit.jid, 'image')"), 'profilePictureUrl missing');
    assert.ok(seg.includes('not-authorized'), 'privacy guard missing');
});

// ── ③ bot.js wiring ──
ok('bot.js: apkMenuBridge FIRST in the number-reply chain (before yt/moviedex)', () => {
    const s = fs.readFileSync(path.join(R, 'bot.js'), 'utf8');
    const i = s.indexOf('features.apkMenuBridge(jid0, qid, text)');
    const y = s.indexOf('features.ytMenuBridge(jid0, qid, text)');
    const m = s.indexOf('moviedex.bridgeReply(jid0, qid, text)');
    assert.ok(i >= 0 && y > i && m > y, 'bridge order wrong: ' + [i, y, m]);
});
ok('bot.js: HEAVY += apk family + getdp family + vv family', () => {
    const s = fs.readFileSync(path.join(R, 'bot.js'), 'utf8');
    const seg = s.slice(s.indexOf('const HEAVY'), s.indexOf('const SITE_DL'));
    assert.ok(seg.length > 50, 'HEAVY slice empty');
    for (const c of ["'.apk'", "'.app'", "'.apkdl'", "'.getdp'", "'.dp'", "'.pp'", "'.vv'", "'.viewonce'", "'.reveal'"]) assert.ok(seg.includes(c), c + ' not HEAVY');
});
ok('bot.js: HELP + CATS menu cards carry .apk / .getdp / .vv', () => {
    const s = fs.readFileSync(path.join(R, 'bot.js'), 'utf8');
    assert.ok(/\*\.apk <app>\*/.test(s), 'HELP .apk missing');
    assert.ok(/✦ \*\.apk <app නම \/ package \/ url>\* — 📦 APK downloader/.test(s), 'CATS[0] .apk missing');
    assert.ok(/✦ \*\.getdp <number>\* — 🖼️ profile photo/.test(s), 'CATS[6] .getdp missing');
    assert.ok(/✦ \*\.vv\* — 🕵️ view-once reveal/.test(s), 'CATS[6] .vv missing');
});

// ── ④ media.js yt-dlp freshness fix ──
ok('media.js: latestViaRedirect = quota-free version probe (API rate-limit 0/60 bypass)', () => {
    const s = fs.readFileSync(path.join(R, 'media.js'), 'utf8');
    assert.ok(s.includes('releases/latest'), 'redirect URL missing');
    assert.ok(/redirect: 'manual'/.test(s), 'must NOT follow the redirect (Location header = the version)');
    assert.ok(s.includes('/tag\\/v?('), 'tag regex missing');
    assert.ok(s.includes('if (!latest) latest = await latestViaRedirect()'), 'fallback wiring missing');
    const m = require(path.join(R, 'media.js'));
    assert.strictEqual(typeof m.latestViaRedirect, 'function', 'not exported');
});
ok('media.js: YouTube enforcement errors → background checkUpdate(true) (stale extractor heals)', () => {
    const s = fs.readFileSync(path.join(R, 'media.js'), 'utf8');
    assert.ok(s.includes('const YT_ENFORCED'), 'YT_ENFORCED missing');
    assert.ok(/EXTRACT_BROKEN\.test\(msg\) \|\| YT_ENFORCED\.test\(msg\)/.test(s), 'info() wiring missing');
    assert.ok(/EXTRACT_BROKEN\.test\(lastErr\) \|\| YT_ENFORCED\.test\(lastErr\)/.test(s), 'ytdl() wiring missing');
});

// ── ⑤ OFFLINE E2E: local HTTP server → apk full download path (PK pass + PK fail) ──
(async () => {
    const APK_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64 * 1024, 7)]);
    const srv = http.createServer((req, res) => {
        if (req.url === '/good.apk') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(APK_BYTES); }
        else if (req.url === '/bad.apk') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>blocked by WAF' + 'x'.repeat(20 * 1024) + '</html>'); }   // >10KB so fetchToFile's tiny-file guard doesn't fire first — PK magic must be the rejecter
        else { res.writeHead(404); res.end('nope'); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
        const a = require(path.join(R, 'apk.js'));
        const statuses = [];
        await run1('E2E: downloadApk direct URL → PK pass → shaped result', () => a.downloadApk({ url: `http://127.0.0.1:${port}/good.apk`, source: 'direct' }, { maxMB: 5, onStatus: (t) => statuses.push(t) })
            .then((r) => { assert.ok(fs.existsSync(r.path), 'file missing'); assert.strictEqual(r.size, APK_BYTES.length); assert.strictEqual(r.fileName, 'good.apk'); assert.ok(statuses.length >= 1, 'onStatus never fired'); fs.rmSync(r.path, { force: true }); }));
        await run1('E2E: HTML error page → PK magic REJECTS (never ships a fake APK)', async () => {
            await assert.rejects(() => a.downloadApk({ url: `http://127.0.0.1:${port}/bad.apk`, source: 'direct' }, { maxMB: 5 }), /valid APK file එකක් නෙවෙයි|bad file signature/i);
        });
        await run1('E2E: HTTP 404 → error surfaces (no infinite retry)', async () => {
            await assert.rejects(() => a.downloadApk({ url: `http://127.0.0.1:${port}/nope.apk`, source: 'direct' }, { maxMB: 5 }), /HTTP 404/);
        });

        // ── ⑥ FULL-STACK bridge E2E: search-card → quote digit → .apk __go → document sent ──
        const f = require(path.join(R, 'features.js'));
        const sent = [];
        const jid = 'test@s.whatsapp.net';
        const msg = { key: { remoteJid: jid, id: 'M1', fromMe: true }, message: { conversation: '.apk __go' } };
        const mkSend = async (j, content, opts) => { sent.push({ j, content, opts }); return { key: { id: 'S' + sent.length } }; };
        f.apkRemember(jid, { key: { id: 'APKCARD' } }, [{ url: `http://127.0.0.1:${port}/good.apk`, source: 'direct', name: 'Good App' }]);
        const pick = f.apkMenuBridge(jid, 'APKCARD', '1');
        await run1('E2E: bridge digit → ".apk __go" → handle() downloads + sends document', async () => {
            assert.strictEqual(pick, '.apk __go', 'bridge must resolve digit 1');
            const handled = await f.handle('.apk', { send: mkSend, jid, msg, rest: ['__go'], sock: null, me: {}, download: null, react: () => { } });
            assert.strictEqual(handled, true);
            const doc = sent.find((x) => x.content.document);
            assert.ok(doc, 'no document sent: ' + JSON.stringify(sent.map((x) => Object.keys(x.content))));
            assert.strictEqual(doc.content.fileName, 'Good App.apk', 'fileName from spec name');
            assert.strictEqual(doc.content.mimetype, 'application/vnd.android.package-archive');
            assert.ok(/Good App/.test(doc.content.caption), 'caption must carry the app name');
            for (const p of (global.__apkTmp || [])) fs.rmSync(p, { force: true });
        });
    } finally { srv.close(); }

    // ── ⑦ version pins ──
    ok('package.json + manifest.json = 2.68.0', () => {
        assert.strictEqual(require(path.join(R, 'package.json')).version, '2.68.0');
        assert.strictEqual(require(path.join(R, 'manifest.json')).version, '2.68.0');
    });
    ok('manifest: apk.js in files + v2.68 notes', () => {
        const m = require(path.join(R, 'manifest.json'));
        assert.ok(m.files.includes('apk.js'), 'apk.js not in manifest files');
        assert.ok(/v2\.68\.0/.test(m.notes || ''), 'notes missing');
    });
    ok('README-SI.txt carries the v2.68 entry', () => {
        assert.ok(fs.readFileSync(path.join(R, 'README-SI.txt'), 'utf8').includes('v2.68.0'));
    });

    console.log(`\n== test_v268: ${pass} pass, ${fail} fail ==`);
    process.exit(fail ? 1 : 0);

    // helper: async-aware ok()
    async function run1(name, fn) {
        try { await fn(); pass++; console.log('  ✅', name); }
        catch (e) { fail++; console.log('  ❌', name, '—', String(e.message).slice(0, 160)); }
    }
})();
