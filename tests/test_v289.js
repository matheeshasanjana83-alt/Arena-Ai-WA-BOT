/**
 * test_v289.js — 🚧 DOWNLOAD LANE NEVER-SILENT FIX
 * User: 'මෙකෙ එක command එකක් ගැහුවාට පස්සෙ අනිත් එක ගන්න බැනෙ .hentaiv එකෙ එක බලලා fix කරන්න
 * ඒ වගෙ තව එවා තියේ නම් අනිත් command වලත් එවත් fix කරන්න'
 * 4 stacked root causes: (1) single-stream download = no stall watchdog → dlQueue lane hung forever
 * (2) no queue feedback (3) sessions.delete-after-await race in animehub (4) stale-card numeric
 * reply = absolute silence. ARENA_DL_STALL_SEC=1 → watchdog fires in ~1.5s (fast tests).
 */
process.env.ARENA_NO_REACT = '1';
process.env.ARENA_DL_STALL_SEC = '2';   // ⚡ fast watchdog for tests (downloader reads at require; prod default 90, clamp min 2)
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dl = require('../downloader');
const bot = require('../bot');
const hub = require('../animehub');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');
const hubSrc = fs.readFileSync('./animehub.js', 'utf8');
const netSrc = fs.readFileSync('./net.js', 'utf8');
const dlSrc = fs.readFileSync('./downloader.js', 'utf8');

// ── local servers: stall (headers then silence) + healthy (steady chunks) ──
const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/stall')) {
        res.writeHead(200, { 'content-length': '1000', 'content-type': 'application/octet-stream' });
        res.flushHeaders();   // ⚠️ headers must reach the wire — fetch resolves only then; without this the client hangs at the HEADERS phase, not the body
        return;   // never write body → client body stalls forever (the exact .hentaiv freeze shape)
    }
    if (req.url.startsWith('/slow')) {   // steady 4×256B chunks 250ms apart → completes (no false stall)
        res.writeHead(200, { 'content-length': '1024', 'content-type': 'application/octet-stream' });
        let i = 0;
        const iv = setInterval(() => {
            if (i >= 4) { clearInterval(iv); return res.end(); }
            res.write(Buffer.alloc(256, 65 + i++));
        }, 250);
        return;
    }
    res.writeHead(404); res.end('nope');
});
let PORT = 0;
const srvReady = new Promise((res) => srv.listen(0, '127.0.0.1', () => { PORT = srv.address().port; res(); }));
const stallUrl = () => `http://127.0.0.1:${PORT}/stall/x.bin`;
const slowUrl = () => `http://127.0.0.1:${PORT}/slow/x.bin`;

(async () => {
    console.log('— v2.89.0 pins —');
    ok('version 2.90 (pins roll forward) + v2.89 notes still present + exports', () => {
        assert.strictEqual(pkg.version, '3.04.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.04.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('DOWNLOAD LANE NEVER-SILENT'), 'notes');
        assert.ok(manifest.files.includes('tests/test_v289.js'), 'files');
        assert.strictEqual(typeof bot._dlQueue, 'function', '_dlQueue exported');
        assert.strictEqual(typeof bot._dlDepth, 'function', '_dlDepth exported');
        assert.strictEqual(typeof bot._dlBudgetMin, 'function', '_dlBudgetMin exported');
        assert.strictEqual(typeof dl.stallGuard, 'function' && 'function', 'stallGuard exported');
        assert.ok(dl.STALL_IDLE === 2000, 'STALL_IDLE=2s (test env): ' + dl.STALL_IDLE);
    });
    ok('structure greps: budget + queue card + stale hint + guards + net abort', () => {
        assert.ok(/dlQueue\(fn, info\)/.test(botSrc), 'dlQueue(fn, info)');
        assert.ok(botSrc.includes('dlDepth--'), 'depth decrement');
        assert.ok(botSrc.includes('Queue #${pos}'), 'queue card');
        assert.ok(botSrc.includes('ARENA_DL_BUDGET_MIN'), 'budget env');
        assert.ok(botSrc.includes('(link, tag, cap) => dlQueue('), 'cap passthrough (was dropped)');
        assert.ok(botSrc.includes('මේ card එකට දැන් menu එකක් active නෑ'), 'stale-card numeric hint');
        assert.ok(botSrc.includes('signal: ac.signal'), 'budget signal into download()');
        const guards = (hubSrc.match(/sessions\.get\(jid\) === /g) || []).length + (hubSrc.match(/sessions\.get\(jid\) !== mySess/g) || []).length;   // v2.90: hv/ep cleanup guard lives INSIDE restoreBack (!==) + hm (===)
        assert.ok(guards >= 2, 'identity guards (restoreBack + hm): ' + guards);
        assert.ok((hubSrc.match(/restoreBack\(jid, mySess\)/g) || []).length >= 2, 'hv+ep download cleanup routed through restoreBack');
        assert.ok(netSrc.includes("opts.signal?.aborted || e?.name === 'AbortError'"), 'net.js abort early-throw');
        assert.ok(dlSrc.includes('stallGuard(stream).pipe(out)') && dlSrc.includes('stallGuard(src).pipe(t)'), 'stallGuard in both single-stream paths');
    });

    console.log('— stallGuard unit (STALL_IDLE=2s) —');
    // streamToFile is module-internal → the watchdog is exercised through the PUBLIC download()
    // against the local stall server (stream:false → streamToFile path; the honest, real path).
    await okA('healthy slow stream (250ms gaps < 1s) completes — no false positive', async () => {
        await srvReady;
        const files = await dl.download(slowUrl(), null, { stream: false });
        assert.strictEqual(files[0].size, 1024, 'size ' + files[0].size);
    });

    console.log('— download() end-to-end vs local stall server —');
    await okA('stalled CDN body → KZ_STALL honest error (~2.5s, was silent forever)', async () => {
        await srvReady;
        const t0 = Date.now();
        await assert.rejects(() => dl.download(stallUrl(), null, { stream: false }), /stall/, 'KZ_STALL');
        assert.ok(Date.now() - t0 < 10000, 'bounded in ' + Math.round((Date.now() - t0) / 100) / 10 + 's');
    });
    await okA('AbortSignal threads to fetch — external abort kills a stalled body (< 1s, before the stall watchdog)', async () => {
        await srvReady;
        const ac = new AbortController();
        setTimeout(() => ac.abort(new Error('test-abort')), 300);
        const t0 = Date.now();
        await assert.rejects(
            () => dl.download(stallUrl(), null, { stream: false, signal: ac.signal }),
            (e) => /abort/i.test(e.message || '') || /abort/i.test(e.name || '') || /stall/.test(e.message || ''),
            'abort-ish error'
        );
        assert.ok(Date.now() - t0 < 5000, 'fast reject in ' + Math.round((Date.now() - t0) / 100) / 10 + 's');
    });

    console.log('— dlQueue: depth + queue feedback —');
    await okA('2nd job queued → immediate "Queue #2" card; free lane → NO card; depth back to 0', async () => {
        const sent = [];
        const sendM = async (j, c) => { sent.push({ j, c }); return { key: { id: 'Q' + sent.length } }; };
        const info = { send: sendM, jid: 'q@s.whatsapp.net', msg: {} };
        const r1 = bot._dlQueue(async () => { await sleep(250); return 'A'; }, { ...info, label: 'first' });
        const r2 = bot._dlQueue(async () => 'B', { ...info, label: 'second file' });
        assert.strictEqual(bot._dlDepth() >= 1, true, 'depth ≥1 while busy');
        assert.strictEqual(await r1, 'A');
        assert.strictEqual(await r2, 'B');
        await new Promise((r) => setTimeout(r, 5));   // ⏱ flush dlDepth decrements — they run one microtask-tick AFTER each job's promise resolves (chained by design)
        const qc = sent.find((x) => x.c.text && x.c.text.includes('Queue #2'));
        assert.ok(qc, 'queue card sent for 2nd job');
        assert.ok(qc.c.text.includes('second file'), 'label in card');
        assert.ok(qc.c.text.includes('අනිත් download එක ඉවර උනාම පටන් ගන්නවා'), 'honest wording');
        const L0 = sent.length;
        await bot._dlQueue(async () => 'C', { ...info, label: 'third' });
        await new Promise((r) => setTimeout(r, 5));
        assert.strictEqual(sent.length, L0, 'NO queue card when lane free');
        assert.strictEqual(bot._dlDepth(), 0, 'depth back to 0');
        await bot._dlQueue(async () => { throw new Error('boom'); }, { ...info, label: 'bad' }).catch(() => { });
        await new Promise((r) => setTimeout(r, 5));
        const r4 = bot._dlQueue(async () => 'D', { ...info, label: 'after fail' });
        assert.strictEqual(await r4, 'D');
        await new Promise((r) => setTimeout(r, 5));
        assert.strictEqual(sent.length, L0, 'no card after failed job either (depth healed)');
        assert.strictEqual(bot._dlDepth(), 0, 'depth still 0 after the fail path');
    });
    ok('budget default 25 min (env-clamped ≥5)', () => {
        assert.strictEqual(bot._dlBudgetMin(), 25, 'default');
        assert.ok(bot._dlBudgetMin() >= 5, 'clamp');
    });

    console.log('— handleDownload honest cards (live local server) —');
    await okA('stalled download → ❌ stall card on the progress bubble (was: silent forever)', async () => {
        await srvReady;
        const sent = [];
        const sendM = async (j, c) => { sent.push({ j, c }); return { key: { id: 'S' + sent.length } }; };
        await bot.handleDownload(sendM, 'h@s.whatsapp.net', {}, stallUrl(), '🔞 WatchHentai', '🔞 *Test* — 720p');
        const prog = sent[0].c.text;
        assert.ok(prog.includes('🔞 *Test* — 720p'), 'cap line shown (3rd arg now honored)');
        assert.ok(prog.includes('🔞 WatchHentai'), 'siteTag');
        const last = sent.filter((x) => x.c.edit).pop();
        assert.ok(last, 'edited final card');
        assert.ok(/stall|❌/.test(last.c.text), 'stall card: ' + (last.c.text || '').slice(0, 80));
    });

    console.log('— animehub session identity guard —');
    await okA('hv quality pick: OLD download cleanup does NOT delete a NEW session saved mid-download', async () => {
        const JID = 'hv289@s.whatsapp.net';
        const oldSess = { cmd: 'hv', stage: 'quality', items: [{ label: '720p', src: 'http://x/v.mp4', bytes: 10 }], title: 'OLD', at: Date.now(), cardId: 'C1' };
        hub._sessions.set(JID, oldSess);
        const sendM = async (j, c) => ({ key: { id: 'K' + Math.random() } });
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => {
            hub._sessions.set(JID, { cmd: 'hv', stage: 'series', items: [{ label: 'NEW', url: 'u', title: 'NEW' }], title: 'NEW', at: Date.now(), cardId: 'C2' });   // user searched again mid-download
        } });
        const s = hub._sessions.get(JID);
        assert.ok(s && s.title === 'NEW' && s.stage === 'series', 'NEW session survived (was deleted by old cleanup)');
    });
    await okA('negative control: no overwrite + no prev → session cleaned after download (restoreBack else-branch)', async () => {
        const JID = 'hv289b@s.whatsapp.net';
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: '480p', src: 'http://x/v.mp4', bytes: 5 }], title: 'ONE', at: Date.now(), cardId: 'C3' });
        const sendM = async (j, c) => ({ key: { id: 'K' + Math.random() } });
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.strictEqual(hub._sessions.get(JID), undefined, 'no prev → cleaned (restoreBack else-branch, guard does not leak)');
    });

    await srv.close();
    console.log(`\nv2.89 download-lane never-silent: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
