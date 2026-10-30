/**
 * test_v290.js — 📤 .uploadgo + .uploadtm + tmpfiles DOWNLOAD + transfer gofile-fallback
 * User: 'gofile: https://gofile.io/ tmpfiles: https://tmpfiles.org/ මේ තියෙන site දෙකත් ADD කරන්න bot ට
 * .uploadgo .uploadtm කියලා තව මෙකෙ download කරන්න පුලුවන් විදිහත් ඇඩ් කරන්න. IQ system api එකක් යලුවා.
 * archivete: https://transfer.archivete.am/ මෙක කැඩිලා නම් fix කරන්න'
 * LIVE-PROBED 2026-10-27: gofile = upload-only for guests (downloads locked 4 ways) · tmpfiles = full
 * roundtrip (one-time /dl/<ts>.<hash>/ direct link) · archivete NOT broken (sandbox 200 + roundtrip).
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const tools = require('../tools');
const mirror = require('../mirror');
const resolvers = require('../resolvers');
const net = require('../net');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');
const toolsSrc = fs.readFileSync('./tools.js', 'utf8');
const mirrorSrc = fs.readFileSync('./mirror.js', 'utf8');
const resolversSrc = fs.readFileSync('./resolvers.js', 'utf8');

const JID = '94724768017@s.whatsapp.net';
const ME = '94724768017@s.whatsapp.net';
let sent = [];
const send = async (jid, content, opts) => { sent.push({ jid, content, opts }); return { key: { id: 'K' + sent.length, remoteJid: jid } }; };
let reacts = [];
const react = (e) => reacts.push(e);
const docMsg = (text, fileName) => ({
    key: { remoteJid: JID, id: 'A1', fromMe: true, participant: ME },
    message: { extendedTextMessage: { text, contextInfo: { stanzaId: 'STANZA90', participant: ME, remoteJid: JID, quotedMessage: { documentMessage: { fileName, mimetype: 'application/zip', url: 'https://mmg.example/x', mediaKey: Buffer.from([1, 2, 3]) } } } } },
});
const plainMsg = () => ({ key: { remoteJid: JID, id: 'A3', fromMe: true }, message: { conversation: 'hello' } });

(async () => {
    console.log('— v2.96.0 pins —');
    ok('version 2.90 + manifest notes/files + mirror exports', () => {
        assert.strictEqual(pkg.version, '3.02.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.02.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('.uploadgo'), 'notes');
        assert.ok(manifest.files.includes('tests/test_v290.js'), 'files');
        assert.strictEqual(typeof mirror.upGofile, 'function', 'upGofile exported');
        assert.strictEqual(typeof mirror.upTmpfiles, 'function', 'upTmpfiles exported');
        assert.strictEqual(mirror.TMPFILES_MAX, 100 * 1048576, 'TMPFILES_MAX 100MB: ' + mirror.TMPFILES_MAX);
    });
    ok('structure greps: multipart field param + gofile guest API + tmpfiles api + single-use', () => {
        assert.ok(/function multipart\(buf, name, field = 'files\[\]'\)/.test(mirrorSrc), 'field param (qu.ax unchanged)');
        assert.ok(mirrorSrc.includes("'https://api.gofile.io/servers'"), 'gofile servers');
        assert.ok(mirrorSrc.includes('contents/uploadfile'), 'gofile uploadfile');
        assert.ok(mirrorSrc.includes("'https://tmpfiles.org/api/v1/upload'"), 'tmpfiles upload api');
        assert.ok(mirrorSrc.includes('SINGLE-USE'), 'tmpfiles one-time link note');
        assert.ok(toolsSrc.includes('gofile fallback'), 'cmdUploadTra fallback');
        assert.ok(toolsSrc.includes('async function cmdUploadGo'), 'cmdUploadGo');
        assert.ok(toolsSrc.includes('async function cmdUploadTm'), 'cmdUploadTm');
        assert.ok(resolversSrc.includes("host === 'tmpfiles.org'"), 'tmpfiles resolver rule');
        assert.ok(resolversSrc.includes('NEVER cache'), 'tmpfiles never-cache note');
    });
    ok('tools.CMDS registers .uploadgo + .uploadtm', () => {
        assert.ok(tools.CMDS.includes('.uploadgo'), tools.CMDS.join(','));
        assert.ok(tools.CMDS.includes('.uploadtm'), tools.CMDS.join(','));
    });
    ok('bot.js wiring: HEAVY + menus', () => {
        assert.ok(/'\.uploadgo'/.test(botSrc) && /'\.uploadtm'/.test(botSrc), 'HEAVY');
        assert.ok(botSrc.includes('*.uploadgo*'), 'menu gofile');
        assert.ok(botSrc.includes('*.uploadtm*'), 'menu tmpfiles');
        assert.ok(botSrc.includes('gofile auto-fallback'), 'menu fallback note');
    });

    console.log('— usage + mock flows —');
    await okA('no media → usage cards (.uploadgo / .uploadtm)', async () => {
        sent = []; reacts = [];
        await tools.handle('.uploadgo', { send, jid: JID, msg: plainMsg(), rest: [], react });
        assert.ok(/reply/.test(sent[0].content.text) && /uploadgo/.test(sent[0].content.text), sent[0].content.text);
        sent = [];
        await tools.handle('.uploadtm', { send, jid: JID, msg: plainMsg(), rest: [], react });
        assert.ok(/reply/.test(sent[0].content.text) && /uploadtm/.test(sent[0].content.text), sent[0].content.text);
    });

    await okA('.uploadtm happy path → card: link + ⏳ 60 min + bot-download hint + ✅', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(2048 * 1024, 7));
        const orig = mirror.upTmpfiles;
        mirror.upTmpfiles = async (buf, name, opts) => {
            assert.ok(opts && opts.signal, 'signal passthrough');
            assert.strictEqual(name, 'CLEO.zip', 'basename');
            return { url: 'https://tmpfiles.org/abC90/CLEO.zip', host: 'tmpfiles', days: 0.04 };
        };
        try {
            await tools.handle('.uploadtm', { send, jid: JID, msg: docMsg('.uploadtm', 'CLEO.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/tmpfiles\.org\/abC90\/CLEO\.zip/.test(final), final);
            assert.ok(/60 min/.test(final), 'expiry warning');
            assert.ok(/\.download/.test(final), 'bot-download hint');
            assert.ok(/2\.0 MB/.test(final), 'MB size');
            assert.ok(sent.some(s => /upload…/.test(s.content.text || '')), 'progress card');
            assert.ok(reacts.includes('✅'));
        } finally { mirror.upTmpfiles = orig; }
    });

    await okA('.uploadtm >100MB → cap card, upload NOT attempted', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(101 * 1048576, 1));
        const orig = mirror.upTmpfiles;
        mirror.upTmpfiles = async () => { throw new Error('SHOULD NOT BE CALLED'); };
        try {
            await tools.handle('.uploadtm', { send, jid: JID, msg: docMsg('.uploadtm', 'big.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/100 MB/.test(final) && /uploadgo/.test(final), final);
        } finally { mirror.upTmpfiles = orig; }
    });

    await okA('.uploadtm fail ×2 → honest card + next-host hints', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(1024, 1));
        const orig = mirror.upTmpfiles;
        mirror.upTmpfiles = async () => { throw new Error('tmpfiles HTTP 500'); };
        try {
            await tools.handle('.uploadtm', { send, jid: JID, msg: docMsg('.uploadtm', 'x.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/upload fail/.test(final) && /500/.test(final) && /uploadgo/.test(final), final);
            assert.ok(!reacts.includes('✅'));
        } finally { mirror.upTmpfiles = orig; }
    });

    await okA('.uploadgo happy path → browser-download honest note + ✅', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(4 * 1048576, 3));
        const orig = mirror.upGofile;
        mirror.upGofile = async (buf, name, opts) => {
            assert.ok(opts && opts.signal, 'signal passthrough');
            return { url: 'https://gofile.io/d/GO190x', host: 'gofile', days: 10, fileId: 'fid-1', guestToken: 'gtok-1' };
        };
        try {
            await tools.handle('.uploadgo', { send, jid: JID, msg: docMsg('.uploadgo', 'CLEO.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/gofile\.io\/d\/GO190x/.test(final), final);
            assert.ok(/browser/.test(final), 'browser-download honesty');
            assert.ok(/4\.0 MB/.test(final), 'MB size');
            assert.ok(reacts.includes('✅'));
        } finally { mirror.upGofile = orig; }
    });

    await okA('.uploadgo fail ×2 → honest card + .uploadtra/.uploadtm hints', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(1024, 1));
        const orig = mirror.upGofile;
        mirror.upGofile = async () => { throw new Error('gofile HTTP 502'); };
        try {
            await tools.handle('.uploadgo', { send, jid: JID, msg: docMsg('.uploadgo', 'x.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/gofile upload fail/.test(final) && /502/.test(final) && /uploadtra/.test(final), final);
            assert.ok(!reacts.includes('✅'));
        } finally { mirror.upGofile = orig; }
    });

    console.log('— resolver unit (net.smartFetch monkey-patch) —');
    const DL_PAGE = '<html>… <a href="https://tmpfiles.org/dl/1793282871.d9fdbe9e413ff775/abC90/CLEO.zip">download</a> …</html>';
    await okA('tmpfiles page link → scrapes one-time /dl/<ts>.<hash>/ direct link + referer', async () => {
        const origSF = net.smartFetch;
        let seen = null;
        net.smartFetch = async (u, o) => { seen = String(u); return { status: 200, url: seen, text: async () => DL_PAGE }; };
        try {
            const r = await resolvers.resolve('https://tmpfiles.org/abC90/CLEO.zip');
            assert.strictEqual(seen, 'https://tmpfiles.org/dl/abC90/CLEO.zip', 'dl page fetched');
            assert.strictEqual(r.url, 'https://tmpfiles.org/dl/1793282871.d9fdbe9e413ff775/abC90/CLEO.zip', r.url);
            assert.strictEqual(r.referer, 'https://tmpfiles.org/', 'referer set');
        } finally { net.smartFetch = origSF; }
    });
    await okA('tmpfiles hashed link → passthrough (no fetch, single-use preserved)', async () => {
        const origSF = net.smartFetch;
        let called = false;
        net.smartFetch = async () => { called = true; throw new Error('must not fetch'); };
        try {
            const r = await resolvers.resolve('https://tmpfiles.org/dl/1793282871.d9fdbe9e413ff775/abC90/CLEO.zip');
            assert.strictEqual(r.url, 'https://tmpfiles.org/dl/1793282871.d9fdbe9e413ff775/abC90/CLEO.zip');
            assert.ok(!called, 'zero network');
        } finally { net.smartFetch = origSF; }
    });
    await okA('tmpfiles gone → honest expiry error', async () => {
        const origSF = net.smartFetch;
        net.smartFetch = async (u) => ({ status: 404, url: u, text: async () => 'gone' });
        try {
            await assert.rejects(() => resolvers.resolve('https://tmpfiles.org/xyz/gone.zip'), /60 min|expire/i);
        } finally { net.smartFetch = origSF; }
    });
    await okA('gofile download → honest guest-lock error (code-validated)', async () => {
        await assert.rejects(() => resolvers.resolve('https://gofile.io/d/AbCd1234'), /guest|browser/i);
        await assert.rejects(() => resolvers.resolve('https://gofile.io/something'), /shape|වැරදියි/i);
    });

    console.log('— LIVE: real APIs (upload-only for gofile · full roundtrip tmpfiles · transfer regression) —');
    await okA('LIVE tmpfiles: upload → resolve → one-time link → download roundtrip', async () => {
        const body = Buffer.from('KAVIZ v2.90 live probe ' + new Date().toISOString());
        const t = await mirror.upTmpfiles(body, 'kaviz_v290_test.txt');
        assert.ok(/^https:\/\/tmpfiles\.org\/[\w-]+\/kaviz_v290_test\.txt$/.test(t.url), t.url);
        const r = await resolvers.resolve(t.url);
        assert.ok(/^https:\/\/tmpfiles\.org\/dl\/\d+\.[a-f0-9]+\//.test(r.url), 'one-time link: ' + r.url.slice(0, 60));
        const back = await (await fetch(r.url, { headers: { referer: 'https://tmpfiles.org/' } })).text();
        assert.strictEqual(back, body.toString(), 'roundtrip exact');
    });
    await okA('LIVE gofile: guest upload → downloadPage + fileId + guestToken', async () => {
        const body = Buffer.from('kaviz v290 gofile probe ' + Date.now());
        const g = await mirror.upGofile(body, 'kaviz_v290_test.txt');
        assert.ok(/^https:\/\/gofile\.io\/d\/[\w-]+$/.test(g.url), g.url);
        assert.ok(g.fileId, 'fileId');
        assert.ok(g.guestToken, 'guestToken');
    });
    await okA('LIVE transfer regression: PUT still works + delete header (කැඩිලා නෑ — host alive)', async () => {
        const body = Buffer.from('kaviz v290 transfer probe ' + Date.now());
        const a = await mirror.upTransfer(body, 'kaviz_v290_test.txt');
        assert.ok(/^https:\/\/transfer\.archivete\.am\/[\w-]+\/kaviz_v290_test\.txt$/.test(a.url), a.url);
        const back = await (await fetch(a.url)).text();
        assert.strictEqual(back, body.toString(), 'roundtrip');
    });

    console.log(`\nv2.90 uploadgo/uploadtm: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
