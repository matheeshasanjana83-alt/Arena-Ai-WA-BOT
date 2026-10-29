/**
 * test_v278.js — report verification: .antibug reporttest (stanza handshake) + .antibug report (manual)
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

(async () => {
    const STATE_F = './antibug_state.json';
    const SNAP = fs.existsSync(STATE_F) ? fs.readFileSync(STATE_F, 'utf8') : null;
    process.on('exit', () => { try { if (SNAP === null) fs.rmSync(STATE_F, { force: true }); else fs.writeFileSync(STATE_F, SNAP); } catch { } });

    console.log('— v2.78.0 pins —');
    ok('version + manifest', () => {
        assert.ok(['2.78.0', '2.79.0', '2.80.0', '2.81.0', '2.82.0', '2.83.0', '2.84.0', '2.85.0', '2.86.0', '2.87.0', '2.88.0', '2.89.0', '2.94.0', '2.94.0', '2.94.0'].includes(pkg.version), 'pkg ' + pkg.version);
        assert.ok(manifest.notes.includes('REPORT VERIFICATION'));
        assert.ok(manifest.files.includes('test_v278.js'));
    });
    ok('exports reportTest + reportManual', () => {
        assert.strictEqual(typeof antibug.reportTest, 'function');
        assert.strictEqual(typeof antibug.reportManual, 'function');
    });

    console.log('— .antibug reporttest —');
    await okA('ACCEPT path: stanza ok → kind:test logged ok:1', async () => {
        antibug._state.reportsLog.length = 0;
        const ctx = { sock: { query: async (iq) => { assert.strictEqual(iq.attrs.to, 's.whatsapp.net'); return {}; } }, me: { pn: '94724768017@s.whatsapp.net' }, log: () => { } };
        const out = await antibug.reportTest(ctx);
        assert.ok(/ACCEPTED/.test(out), out.split('\n')[1]);
        const e = antibug._state.reportsLog[0];
        assert.strictEqual(e.kind, 'test'); assert.strictEqual(e.ok, 1); assert.strictEqual(e.who, 'TEST(self)');
    });
    await okA('REJECT path: stanza throws → err captured + honest card', async () => {
        const ctx = { sock: { query: async () => { throw new Error('closed'); } }, me: { pn: '94724768017@s.whatsapp.net' }, log: () => { } };
        const out = await antibug.reportTest(ctx);
        assert.ok(/REJECTED/.test(out) && /closed/.test(out));
        const e = antibug._state.reportsLog[0];
        assert.strictEqual(e.ok, 0); assert.ok(/closed/.test(e.err));
    });

    console.log('— .antibug report (manual) —');
    await okA('no reply → usage hint', async () => {
        const ctx = { sock: { query: async () => ({}) }, me: { pn: '94724768017@s.whatsapp.net' }, log: () => { } };
        const out = await antibug.reportManual(null, ctx);
        assert.ok(/reply/.test(out));
    });
    await okA('with quoted msg → report sent to the quoted sender', async () => {
        antibug._state.reportsLog.length = 0;
        let seen = null;
        const ctx = { sock: { query: async (iq) => { seen = iq; return {}; } }, me: { pn: '94724768017@s.whatsapp.net' }, log: () => { } };
        const quoted = { stanzaId: 'MSGID123', participantJid: '94779999999:5@s.whatsapp.net', remoteJid: '94779999999@s.whatsapp.net' };
        const out = await antibug.reportManual(quoted, ctx);
        assert.ok(/REPORT SENT/.test(out) && /94779999999/.test(out));
        assert.ok(seen && seen.content[0].content[0].attrs.msg_id === 'MSGID123', 'msg_id = quoted stanzaId');
        const e = antibug._state.reportsLog[0];
        assert.strictEqual(e.kind, 'manual'); assert.strictEqual(e.ok, 1);
        assert.ok(e.who.startsWith('MANUAL:94779999999'), e.who);
    });
    await okA('manual fail → logged with err', async () => {
        const ctx = { sock: { query: async () => { throw new Error('timeout'); } }, me: { pn: '94724768017@s.whatsapp.net' }, log: () => { } };
        const out = await antibug.reportManual({ stanzaId: 'X', participantJid: '94770000000@s.whatsapp.net' }, ctx);
        assert.ok(/fail/.test(out) && /timeout/.test(out));
        assert.strictEqual(antibug._state.reportsLog[0].ok, 0);
    });

    console.log('— scan shows kind tags + bot wiring —');
    ok('scan 🧪TEST/🚨MANUAL tags', async () => {
        const t = await antibug.command('scan');
        assert.ok(/🧪TEST|🚨MANUAL/.test(t), t.split('\n')[1]);
    });
    ok('bot.js: reporttest + report cases wired', () => {
        const src = fs.readFileSync('./bot.js', 'utf8');
        assert.ok(src.includes("sub === 'reporttest'"));
        assert.ok(src.includes("sub === 'report'"));
        assert.ok(src.includes('antibug.reportTest({ sock: SOCK, me: ME, log })'));
        assert.ok(src.includes('antibug.reportManual(quoted'));
        assert.ok(src.includes('contextInfo'));
    });

    console.log(`\nv2.78 report-verification: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
