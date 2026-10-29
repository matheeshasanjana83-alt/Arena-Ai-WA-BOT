/**
 * test_v282.js — .uploadtra: media reply → transfer.archivete.am link (+ delete link)
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const tools = require('../tools');
const mirror = require('../mirror');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const botSrc = require('fs').readFileSync('./bot.js', 'utf8');

const JID = '94724768017@s.whatsapp.net';
const ME = '94724768017@s.whatsapp.net';

// send mock — captures every call, returns editable key
let sent = [];
const send = async (jid, content, opts) => { sent.push({ jid, content, opts }); return { key: { id: 'K' + sent.length, remoteJid: jid } }; };
let reacts = [];
const react = (e) => reacts.push(e);

// reply-to-document fixture
const docMsg = (fileName) => ({
    key: { remoteJid: JID, id: 'A1', fromMe: true, participant: ME },
    message: { extendedTextMessage: { text: '.uploadtra', contextInfo: { stanzaId: 'STANZA9', participant: ME, remoteJid: JID, quotedMessage: { documentMessage: { fileName, mimetype: 'application/zip', url: 'https://mmg.example/x', mediaKey: Buffer.from([1, 2, 3]) } } } } },
});
// reply-to-image fixture (no fileName field exists on imageMessage)
const imgMsg = () => ({
    key: { remoteJid: JID, id: 'A2', fromMe: true, participant: ME },
    message: { extendedTextMessage: { text: '.uploadtra', contextInfo: { stanzaId: 'STANZA8', participant: ME, remoteJid: JID, quotedMessage: { imageMessage: { mimetype: 'image/jpeg', url: 'https://mmg.example/y', mediaKey: Buffer.from([4, 5]) } } } } },
});
// plain text, no media anywhere
const plainMsg = () => ({ key: { remoteJid: JID, id: 'A3', fromMe: true }, message: { conversation: 'hello' } });

(async () => {
    console.log('— v2.82.0 pins —');
    ok('version + manifest', () => {
        assert.ok(['2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '3.00.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(['2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '3.00.0'].includes(manifest.version), 'manifest ' + manifest.version);
        assert.ok(/UPLOADTRA/i.test(manifest.notes), 'notes');
        assert.ok(manifest.files.includes('tests/test_v282.js'), 'files');
    });
    ok('tools.CMDS registers .uploadtra', () => {
        assert.ok(tools.CMDS.includes('.uploadtra'), tools.CMDS.join(','));
    });
    ok('bot.js wiring: HEAVY + HELP + menu', () => {
        assert.ok(/'\.uploadtra'/.test(botSrc), 'HEAVY');
        assert.ok(botSrc.includes('*.uploadtra*'), 'HELP/menu');
        assert.ok(botSrc.includes('transfer.archivete.am'), 'menu host');
    });
    ok('mirror.js returns x-url-delete as del', () => {
        assert.ok(require('fs').readFileSync('./mirror.js', 'utf8').includes("r.headers.get('x-url-delete')"), 'del capture');
    });

    console.log('— usage + mock flow —');
    await okA('no media → usage card', async () => {
        sent = []; reacts = [];
        const done = await tools.handle('.uploadtra', { send, jid: JID, msg: plainMsg(), rest: [], react });
        assert.strictEqual(done, true);
        assert.ok(/reply/.test(sent[0].content.text) && /uploadtra/.test(sent[0].content.text), sent[0].content.text);
    });

    await okA('document reply: fileName used → link card with size + delete link + ✅', async () => {
        sent = []; reacts = [];
        const BUF = Buffer.alloc(2048 * 1024, 7);
        tools.setMediaDownloader(async () => BUF);
        let got = null;
        const orig = mirror.upTransfer;
        mirror.upTransfer = async (buf, name) => { got = { buf, name }; return { url: 'https://transfer.archivete.am/he1TI/CLEO.zip', host: 'transfer', days: 7, del: 'https://transfer.archivete.am/he1TI/CLEO.zip/DELTKN' }; };
        try {
            const done = await tools.handle('.uploadtra', { send, jid: JID, msg: docMsg('CLEO.zip'), rest: [], react });
            assert.strictEqual(done, true);
            assert.ok(got, 'upTransfer called');
            assert.strictEqual(got.name, 'CLEO.zip');
            assert.strictEqual(got.buf.length, BUF.length);
            const final = sent[sent.length - 1].content.text;
            assert.ok(/transfer\.archivete\.am\/he1TI\/CLEO\.zip/.test(final), final);
            assert.ok(/DELTKN/.test(final), 'delete link in card');
            assert.ok(/2\.0 MB/.test(final), 'MB size');
            assert.ok(sent.some(s => /upload…/.test(s.content.text)), 'progress edit');
            assert.ok(reacts.includes('✅'), 'react');
        } finally { mirror.upTransfer = orig; }
    });

    await okA('image reply (no fileName) → kaviz-*.jpg generated name', async () => {
        sent = []; let gotName = null;
        tools.setMediaDownloader(async () => Buffer.alloc(1024, 1));
        const orig = mirror.upTransfer;
        mirror.upTransfer = async (buf, name) => { gotName = name; return { url: 'https://transfer.archivete.am/tA1x/' + name, host: 'transfer', days: 7, del: null }; };
        try {
            await tools.handle('.uploadtra', { send, jid: JID, msg: imgMsg(), rest: [], react });
            assert.ok(/^kaviz-[a-z0-9]+\.jpg$/.test(gotName), gotName);
            const final = sent[sent.length - 1].content.text;
            assert.ok(/transfer\.archivete\.am/.test(final), final);
        } finally { mirror.upTransfer = orig; }
    });

    await okA('upload error → gofile fallback (v2.90) → link delivered', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(10, 1));
        const orig = mirror.upTransfer, origG = mirror.upGofile;
        mirror.upTransfer = async () => { throw new Error('transfer HTTP 503 boom'); };
        mirror.upGofile = async (buf, name) => ({ url: 'https://gofile.io/d/FB282', host: 'gofile', days: 10, fileId: 'f1', guestToken: 'g1' });
        try {
            await tools.handle('.uploadtra', { send, jid: JID, msg: docMsg('x.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/gofile\.io\/d\/FB282/.test(final) && /fallback/.test(final), final);
            assert.ok(reacts.includes('✅'), 'fallback success reacts ✅');
        } finally { mirror.upTransfer = orig; mirror.upGofile = origG; }
    });

    await okA('transfer + gofile both fail → honest combined card', async () => {
        sent = []; reacts = [];
        tools.setMediaDownloader(async () => Buffer.alloc(10, 1));
        const orig = mirror.upTransfer, origG = mirror.upGofile;
        mirror.upTransfer = async () => { throw new Error('transfer HTTP 503 boom'); };
        mirror.upGofile = async () => { throw new Error('gofile HTTP 503 dead'); };
        try {
            await tools.handle('.uploadtra', { send, jid: JID, msg: docMsg('x.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/upload fail/.test(final) && /503/.test(final) && /gofile/.test(final) && /tourl/.test(final), final);
            assert.ok(!reacts.includes('✅'), 'no ✅ on total failure');
        } finally { mirror.upTransfer = orig; mirror.upGofile = origG; }
    });

    await okA('empty buffer → error card (media හිස්)', async () => {
        sent = [];
        tools.setMediaDownloader(async () => Buffer.alloc(0));
        const orig = mirror.upTransfer;
        mirror.upTransfer = async () => { throw new Error('SHOULD NOT BE CALLED'); };
        try {
            await tools.handle('.uploadtra', { send, jid: JID, msg: docMsg('e.zip'), rest: [], react });
            const final = sent[sent.length - 1].content.text;
            assert.ok(/fail/.test(final) && /හිස්/.test(final), final);
        } finally { mirror.upTransfer = orig; }
    });

    console.log('— LIVE: real transfer.archivete.am roundtrip —');
    await okA('upTransfer: real PUT → URL + del header + GET roundtrip', async () => {
        const body = Buffer.from('KAVIZ v2.82 .uploadtra live probe ' + new Date().toISOString());
        const r = await mirror.upTransfer(body, 'kaviz_v282_probe.txt');
        assert.ok(/^https:\/\/transfer\.archivete\.am\/[A-Za-z0-9]+\/kaviz_v282_probe\.txt$/.test(r.url), r.url);
        assert.ok(r.del && /^https:\/\//.test(r.del), 'del: ' + r.del);
        const back = await (await fetch(r.url)).text();
        assert.strictEqual(back, body.toString(), 'roundtrip');
    });

    console.log(`\nv2.82 uploadtra: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
