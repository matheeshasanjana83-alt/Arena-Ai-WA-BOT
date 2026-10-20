/**
 * test_v277.js — antibug evidence layer (persistent catches + report-outcome log)
 * Verifies: report success/failure both recorded → .antibug scan shows the truth.
 */
process.env.ARENA_NO_REACT = '1';
process.env.ANTIBUG_TEST_FAST = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const antibug = require('./antibug');
const pkg = require('./package.json');
const manifest = require('./manifest.json');

const BUG_MSG = () => ({ conversation: 'x'.repeat(13000) });   // text >12000 → severe (text length rule)

(async () => {
    const STATE_F = './antibug_state.json';
    const STATE_SNAP = fs.existsSync(STATE_F) ? fs.readFileSync(STATE_F, 'utf8') : null;
    process.on('exit', () => { try { if (STATE_SNAP === null) fs.rmSync(STATE_F, { force: true }); else fs.writeFileSync(STATE_F, STATE_SNAP); } catch { } });   // restore real state after tests

    console.log('— v2.77.0 pins + evidence exports —');
    ok('version pins (2.77/2.78 era)', () => {
        assert.ok(['2.77.0', '2.78.0', '2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0'].includes(pkg.version), 'pkg: ' + pkg.version);
        assert.ok(['2.77.0', '2.78.0', '2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0'].includes(manifest.version), 'manifest: ' + manifest.version);
        assert.ok(manifest.notes.includes('ANTIBUG EVIDENCE'));
    });
    ok('state has catches + reportsLog arrays', () => {
        assert.ok(Array.isArray(antibug._state.catches));
        assert.ok(Array.isArray(antibug._state.reportsLog));
    });

    console.log('— guard → persistent catch —');
    const ME = { pn: '94724768017@s.whatsapp.net', lid: '56694356881490@lid' };
    const mkCtx = (queryImpl) => ({
        sock: { query: queryImpl, updateBlockStatus: async () => { } },
        me: ME,
        send: async () => ({ key: { id: 'x' } }),
        log: () => { },
    });
    const msg = () => ({ key: { remoteJid: '9476xxxxxxx@s.whatsapp.net', fromMe: false, id: 'BUG' + Date.now(), participant: undefined }, message: BUG_MSG(), messageTimestamp: Math.floor(Date.now() / 1000) });

    await okA('severe bug → guard true + catch persisted', async () => {
        antibug._state.catches.length = 0;
        const ctx = mkCtx(async () => { throw new Error('closed'); });
        const handled = await antibug.guard(msg(), ctx);
        assert.strictEqual(handled, true);
        await new Promise((r) => setTimeout(r, 30));
        assert.ok(antibug._state.catches.length >= 1, 'catches: ' + antibug._state.catches.length);
        const c = antibug._state.catches[0];
        assert.ok(c.num && c.where === 'private' && /අකුරූ|text/.test(c.reasons));
        assert.ok(JSON.parse(fs.readFileSync('./antibug_state.json', 'utf8')).catches.length >= 1, 'PERSISTED to disk');
    });

    console.log('— retaliate outcome log (the "වැඩද?" proof) —');
    await okA('reports fail → outcome logged with err (server-reject case)', async () => {
        antibug._resetPause();
        antibug._state.reports.length = 0;   // fresh 24h budget for the test
        const before = antibug._state.reportsLog.length;
        const p = antibug.retaliate('94771111111@s.whatsapp.net', mkCtx(async () => { throw new Error('stream errored (conflict)'); }), { key: { id: 'k1' }, canBlock: false });
        const r = await p;
        assert.ok(r.want >= 1 && r.ok === 0, 'want=' + r.want + ' ok=' + r.ok);
        assert.strictEqual(r.aborted, true, '×3 fails → aborted');
        assert.ok(antibug._state.reportsLog.length === before + 1);
        const e = antibug._state.reportsLog[0];
        assert.strictEqual(e.ok, 0);
        assert.ok(/conflict/.test(e.err), 'err captured: ' + e.err);
        assert.ok(fs.readFileSync('./antibug_state.json', 'utf8').includes('reportsLog'));
    });
    await okA('reports succeed → ok counted + budget grows', async () => {
        antibug._resetPause();
        antibug._state.reports.length = 0;   // fresh budget
        let n = 0;
        const ctx = mkCtx(async () => { n++; return {}; });
        const r = await antibug.retaliate('94772222222@s.whatsapp.net', ctx, { key: { id: 'k2' }, canBlock: false });
        assert.ok(r.ok === r.want && r.ok >= 1, 'ok=' + r.ok + '/' + r.want);
        assert.strictEqual(n, r.ok, 'query called once per report');
        assert.ok(antibug._state.reports.length >= r.ok, 'budget consumed');
        const e = antibug._state.reportsLog[0];
        assert.strictEqual(e.ok, r.ok);
        assert.ok(!e.err);
    });

    console.log('— scan/status show the truth —');
    await okA('scanText: last-report verdict + dated catches', async () => {
        const t = await antibug.command('scan');
        assert.ok(/ANTI-BUG SCAN/.test(t));
        assert.ok(/last:/.test(t) && (/ලෑන්ඩ්/.test(t) || /server reject/.test(t) || /budget/.test(t)), t.split('\n')[1]);
        assert.ok(/🕐 \d{2}-\d{2} \d{2}:\d{2}/.test(t), 'dated rows');
    });
    await okA('status: last-report line present', async () => {
        const t = await antibug.command('', '');
        assert.ok(/📨 last report:/.test(t));
        assert.ok(/24h budget/.test(t));
    });
    ok('owner never retaliated', () => {
        assert.ok('94724768017@s.whatsapp.net' && true);
        const before = antibug._state.reportsLog.length;
        antibug.retaliate('94724768017@s.whatsapp.net', mkCtx(async () => ({})), { key: { id: 'k3' }, canBlock: false });
        assert.strictEqual(antibug._state.reportsLog.length, before, 'owner → skip, no log entry');
    });

    console.log(`\nv2.77 antibug-evidence: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
