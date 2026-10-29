/**
 * test_v259.js — NEW DOWNLOAD COMMANDS: .mediafire / .mega / .gdrive (site-locked) + DOWNLOAD menu rework
 * Run: node test_v259.js
 *  [1] SITE_DL regex matrix — right site passes, wrong site rejected (cross-site too)
 *  [2] REAL bot.onMessages E2E — usage msg (no link), wrong-site msg, routing order (tools/features/moviedex first)
 *  [3] universal .download path intact — local HTTP file → document sent (offline, no external network)
 *  [4] source pins — router wiring, HEAVY, DOWNLOAD menu lists all 5 commands, HELP, branded progress
 *  [5] version pins (follows package.json — current at time of bump)
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
process.env.ARENA_RATE_MIN = '1000'; process.env.ARENA_RATE_HOUR = '10000';

const assert = require('assert');
const fs = require('fs');
const http = require('http');

let pass = 0, fail = 0;
function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

const bot = require('../bot.js');
const SITE_DL = bot.SITE_DL;

const SELF = '94771234567@s.whatsapp.net';
bot.ME.pn = SELF; bot.ME.lid = null;

const SETF = require('path').join(__dirname, '..', 'settings.json');
const SET_BACK = fs.existsSync(SETF) ? fs.readFileSync(SETF, 'utf8') : null;
const writeSettings = (d) => fs.writeFileSync(SETF, JSON.stringify(d, null, 2));

const SENT = [];
let GID = 0;
const send = async (jid, content, opts) => { SENT.push({ jid, content, opts }); return { key: { id: 's' + (++GID), remoteJid: jid } }; };
const del = async () => { };
const lastText = () => String((SENT[SENT.length - 1] || {}).content?.text || (SENT[SENT.length - 1] || {}).content?.caption || '');

let N = 0;
const mk = (text, o = {}) => ({
    key: { remoteJid: o.jid || SELF, fromMe: o.fromMe !== false, id: 'm' + (++N) + Math.random().toString(36).slice(2, 8) },
    message: o.ctx ? { extendedTextMessage: { text, contextInfo: o.ctx } } : { conversation: text }
});
const run = (m) => bot.onMessages({ messages: [m], type: 'notify' }, send, del);

(async () => {
    writeSettings({ chats: 'private', aiChat: false, react: false, autoUpdate: false });

    console.log('== v2.59 site-locked download commands ==\n[1] SITE_DL regex matrix');
    const CASES = [
        // [cmd, link, shouldPass]
        ['.mediafire', 'https://www.mediafire.com/file/abc/file.zip/file', true],
        ['.mediafire', 'https://mediafire.com/download/xyz', true],
        ['.mediafire', 'http://www.mediafire.com/file/abc', true],
        ['.mediafire', 'https://download1588.mediafire.com/xxx/file.zip', true],    // CDN direct link — resolvers passes it through as http
        ['.mediafire', 'https://mega.nz/file/abc#key', false],
        ['.mediafire', 'https://drive.google.com/file/d/ID/view', false],
        ['.mediafire', 'https://mediafire.com.evil.io/file', false],                // suffix spoof must NOT pass
        ['.mega', 'https://mega.nz/file/abc#key', true],
        ['.mega', 'https://mega.co.nz/folder/abc#key', true],
        ['.mega', 'https://www.mega.nz/file/abc', true],
        ['.mega', 'https://mega.nz.evil.io/file', false],
        ['.mega', 'https://mediafire.com/f', false],
        ['.gdrive', 'https://drive.google.com/file/d/FILE_ID/view', true],
        ['.gdrive', 'https://docs.google.com/document/d/ID/edit', true],
        ['.gdrive', 'https://drive.usercontent.google.com/download?id=X', true],
        ['.gdrive', 'https://drive.google.com.evil.io/f', false],
        ['.gdrive', 'https://mega.nz/file/abc#key', false],
    ];
    for (const [c, link, want] of CASES) {
        await ok(`${c} ${link.slice(0, 48)}… → ${want ? 'PASS' : 'reject'}`, () => assert.strictEqual(SITE_DL[c].re.test(link), want));
    }
    await ok('SITE_DL has exactly 3 site commands', () => assert.deepStrictEqual(Object.keys(SITE_DL).sort(), ['.gdrive', '.mediafire', '.mega']));
    await ok('each site has label/tag/host/example', () => Object.entries(SITE_DL).forEach(([k, v]) => assert.ok(v.label && v.tag && v.host && v.re && v.ex, k)));

    // ═══ [2] E2E via the REAL router ═══
    console.log('\n[2] E2E — router validation paths');
    SENT.length = 0;
    await run(mk('.mediafire'));
    ok('.mediafire (no link) → usage + example', () => assert.ok(SENT.length === 1 && /MediaFire/.test(lastText()) && /mediafire\.com\/file/.test(lastText()), 'sent=' + SENT.length + ' ' + lastText().slice(0, 80)));
    SENT.length = 0;
    await run(mk('.mega'));
    ok('.mega (no link) → usage + example', () => assert.ok(SENT.length === 1 && /MEGA/.test(lastText()) && /mega\.nz/.test(lastText()), 'sent=' + SENT.length + ' ' + lastText().slice(0, 80)));
    SENT.length = 0;
    await run(mk('.gdrive'));
    ok('.gdrive (no link) → usage + example', () => assert.ok(SENT.length === 1 && /Google Drive/.test(lastText()) && /drive\.google\.com/.test(lastText()), 'sent=' + SENT.length + ' ' + lastText().slice(0, 80)));
    SENT.length = 0;
    await run(mk('.mediafire https://youtube.com/watch?v=x'));
    ok('.mediafire + youtube link → wrong-site error', () => assert.ok(SENT.length === 1 && /MediaFire.*link එකක් නෙවෙයි/.test(lastText()) && /\.download <link>/.test(lastText()), lastText().slice(0, 80)));
    SENT.length = 0;
    await run(mk('.mega https://mediafire.com/file/f'));
    ok('.mega + mediafire link → wrong-site error (cross-site)', () => assert.ok(SENT.length === 1 && /MEGA.*link එකක් නෙවෙයි/.test(lastText()), lastText().slice(0, 80)));
    SENT.length = 0;
    await run(mk('.gdrive https://pixeldrain.com/u/abc'));
    ok('.gdrive + pixeldrain link → wrong-site error (cross-site)', () => assert.ok(SENT.length === 1 && /Google Drive.*link එකක් නෙවෙයි/.test(lastText()), lastText().slice(0, 80)));

    // ═══ [3] universal .download — local file E2E (offline) ═══
    console.log('\n[3] .download universal path — local HTTP file → document');
    const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 11 });
        res.end('HELLO-V259\n');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    SENT.length = 0;
    await run(mk(`.download http://127.0.0.1:${port}/testfile.bin`));
    const doc = SENT.find(x => x.content?.document);
    ok('.download sends the file as a document', () => assert.ok(!!doc && doc.content.fileName === 'testfile.bin', 'documents=' + SENT.filter(x => x.content?.document).length + ' contentKeys=' + JSON.stringify(Object.keys(doc?.content || {}))));
    ok('progress bubble deleted after send (file itself is enough)', () => assert.ok(!!doc && !!SENT[SENT.length - 1].content?.delete, 'last=' + JSON.stringify(Object.keys(SENT[SENT.length - 1]?.content || {}))));
    srv.close();

    // ═══ [4] source pins ═══
    console.log('\n[4] source pins');
    const src = fs.readFileSync('bot.js', 'utf8');
    await ok('router: SITE_DL branch sits BEFORE the .download check', () => assert.ok(src.indexOf('if (SITE_DL[c])') >= 0 && src.indexOf('if (SITE_DL[c])') < src.indexOf("if (!['.download', '.dl', '.dn'].includes(c)) continue")));
    await ok('router: site cmd → dlQueue(handleDownload …, tag)', () => assert.ok(src.includes('handleDownload(send, jid, msg, link, SITE_DL[c].tag)')));
    await ok('handleDownload accepts siteTag (branded progress)', () => assert.ok(src.includes('async function handleDownload(send, jid, msg, link, siteTag)') && src.includes('${siteTag ? siteTag + \' — \' : \'\'}')));
    await ok('HEAVY includes .mediafire/.mega/.gdrive (⏳→✅/❌)', () => {
        const m = src.match(/const HEAVY = new Set\(\[([^\]]+)\]\)/);
        const set = new Set(m[1].split(',').map(s => s.trim().replace(/'/g, '')));
        ['.mediafire', '.mega', '.gdrive'].forEach(c => assert.ok(set.has(c), c + ' missing from HEAVY'));
    });
    await ok('DOWNLOAD menu lists all: download/mediafire/mega/gdrive/video/song', () => {
        const cat = src.match(/\['📥', 'Download', `([^`]+)`\]/)[1];
        ['.download <link>', '.mediafire <link>', '.mega <link>', '.gdrive <link>', '.video <link/නම>', '.song <link/නම>', '{MAX}'].forEach(s => assert.ok(cat.includes(s), s + ' missing from menu'));
    });
    await ok('HELP line lists the new commands', () => assert.ok(src.includes('*.download <link>* (*.dl*) · *.mediafire* · *.mega* · *.gdrive* · *.video* (yt) · *.song* (yt)')));
    await ok('bot.js exports SITE_DL (tests + future panels)', () => assert.ok(src.includes('SITE_DL, _setMediaDownloader')));

    // ═══ [5] version pins ═══
    console.log('\n[5] version pins');
    await ok('package.json 2.65.0 (current)', () => assert.strictEqual(require('../package.json').version, '2.69.0'));
    await ok('manifest.json 2.65.0 (current)', () => assert.strictEqual(JSON.parse(fs.readFileSync('manifest.json')).version, '2.69.0'));
    await ok('manifest notes = current changelog', () => assert.ok(JSON.parse(fs.readFileSync('manifest.json')).notes.includes('v2.65.0')));

    // restore settings
    if (SET_BACK != null) fs.writeFileSync(SETF, SET_BACK); else fs.rmSync(SETF, { force: true });

    console.log(`\n═══ v2.59 new download commands: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); if (SET_BACK != null) { try { fs.writeFileSync(SETF, SET_BACK); } catch { } } process.exit(1); });
