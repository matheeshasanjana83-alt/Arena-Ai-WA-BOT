'use strict';
/**
 * test_v221.js — Mirror relay (file/URL → direct share link)
 * qu.ax (30d) → transfer.archivete.am (7d) chain · .tourl fix · .moviepro link mode
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log('  ✅ ' + name); };
const bad = (name, e) => { failed++; console.log('  ❌ ' + name + ' — ' + (e && e.message || e)); };
const check = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, e); } };
const checkA = async (name, fn) => { try { await fn(); ok(name); } catch (e) { bad(name, e); } };

(async () => {
    console.log('\n== v2.21.0 mirror relay ==\n');
    const R = __dirname;

    // [1] mirror.js module shape
    let mirror;
    check('[1] mirror.js loads + exports', () => {
        mirror = require('./mirror');
        for (const k of ['uploadBuffer', 'uploadFile', 'upQuax', 'upTransfer', 'QUAX_MAX', 'BUF_MAX']) assert(typeof mirror[k] !== 'undefined', 'missing ' + k);
    });

    // [2] LIVE: small buffer → qu.ax → link reachable
    let firstUrl = null;
    await checkA('[2] LIVE uploadBuffer (tiny) → link 200', async () => {
        const r = await mirror.uploadBuffer(Buffer.from('kaviz v221 relay test ' + Date.now()), 'kaviz-test.txt');
        assert(/^https?:\/\//.test(r.url), 'no url: ' + r.url);
        assert(r.host === 'qu.ax' || r.host === 'transfer', 'host=' + r.host);
        firstUrl = r.url;
        const head = await fetch(r.url, { method: 'GET' });
        assert(head.ok, 'GET ' + r.url + ' → ' + head.status);
    });

    // [3] LIVE: upTransfer direct (stream path used for big files)
    await checkA('[3] LIVE upTransfer(file) → link 200', async () => {
        const p = path.join(require('os').tmpdir(), 'kaviz-v221-t.txt');
        fs.writeFileSync(p, 'transfer stream test ' + Date.now());
        try {
            const r = await mirror.upTransfer(p, 'kaviz-v221-t.txt');
            assert(/^https?:\/\//.test(r.url), 'no url');
            const head = await fetch(r.url);
            assert(head.ok, 'GET → ' + head.status);
        } finally { fs.rmSync(p, { force: true }); }
    });

    // [4] movies.js link-mode regex (same pattern as handle())
    check('[4] .moviepro <n> <q#> link parsing', () => {
        const re = /^(\d{1,2})(?:\s+(trailer|t))?(?:\s+(\d{1,2}))?(?:\s+(link|l))?$/i;
        let m = '.moviepro 2 1 link'.replace(/^\.moviepro\s*/, '').match(re);
        assert(m && m[1] === '2' && m[3] === '1' && /^l/i.test(m[4]), 'n q link');
        m = '.moviepro 2 1'.replace(/^\.moviepro\s*/, '').match(re);
        assert(m && m[3] === '1' && !m[4], 'n q (no link)');
        m = '.moviepro 2 link'.replace(/^\.moviepro\s*/, '').match(re);
        assert(m && !m[3] && /^l/i.test(m[4]), 'n link → needs quality hint');
        m = '.moviepro 2 trailer'.replace(/^\.moviepro\s*/, '').match(re);
        assert(m && m[2] === 'trailer', 'trailer still works');
    });

    // [5] tools.js routing: .mirror / .link / .tourl / .url
    check('[5] tools CMDS routes', () => {
        const tools = require('./tools');
        for (const c of ['.mirror', '.link', '.tourl', '.url']) assert(tools.CMDS.includes(c), 'no ' + c);
    });

    // [6] bot.js loads + help/menu updated
    check('[6] bot.js loads + menu mentions', () => {
        const bot = require('./bot');
        const src = fs.readFileSync(path.join(R, 'bot.js'), 'utf8');
        assert(src.includes('*.mirror <link>*'), 'HELP .mirror');
        assert(src.includes('q#> link*') || src.includes('link*'), 'CATS MoviePro link');
        assert(src.includes("'.mirror': cmdMirror") || src.includes('.mirror'), 'bot refs');
        assert(typeof bot.handleDownload === 'function', 'bot api');
    });

    // [7] versions + manifest files
    check('[7] version >= 2.21.0 + manifest', () => {
        assert(require('./package.json').version >= '2.21.0', 'pkg version');
        const m = JSON.parse(fs.readFileSync(path.join(R, 'manifest.json'), 'utf8'));
        assert(m.version >= '2.21.0' && m.version === require('./package.json').version, 'manifest version');
        assert(m.files.includes('mirror.js'), 'manifest mirror.js');
        assert(m.files.includes('test_v221.js'), 'manifest test');
    });

    // [8] updater PROTECTED still guards runtime state
    check('[8] updater PROTECTED intact', () => {
        const src = fs.readFileSync(path.join(R, 'updater.js'), 'utf8');
        assert(src.includes('antispam\\.json'), 'antispam.json protected');
        assert(src.includes('proxies\\.user\\.txt'), 'proxies.user.txt protected');
    });

    // [9] syntax: all touched files
    check('[9] node --check all touched', () => {
        for (const f of ['mirror.js', 'tools.js', 'movies.js', 'bot.js']) {
            execFileSync(process.execPath, ['--check', path.join(R, f)]);
        }
    });

    // [10] no report-flood anywhere in new code
    check('[10] no report-flood in mirror/movies/tools', () => {
        for (const f of ['mirror.js', 'movies.js', 'tools.js']) {
            const s = fs.readFileSync(path.join(R, f), 'utf8');
            assert(!/report100|report50|report30/i.test(s), f + ' mentions report-flood');
        }
    });

    console.log(`\n== ${passed} passed, ${failed} failed ==\n`);
    process.exitCode = failed ? 1 : 0;
})();
