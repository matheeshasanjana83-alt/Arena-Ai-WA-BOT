/**
 * test_v220.js — antispam.js offline tests (no network, no WhatsApp)
 * run: node test_v220.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join(__dirname, 'antispam.json');
const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
let failed = false;

(async () => {
    const antispam = require('./antispam');

    const now = Math.floor(Date.now() / 1000);
    const mkMsg = (sender, ts = now) => ({
        key: { remoteJid: sender, remoteJidAlt: sender, fromMe: false, id: 'T' + Math.random().toString(36).slice(2) },
        message: { conversation: 'spam ' + Math.random() },
        messageTimestamp: ts,
    });
    const mkSock = (calls) => ({ updateBlockStatus: async (j, a) => { calls.push([j, a]); return true; } });
    const sent = [];
    const me = { pn: '94700000000@s.whatsapp.net', lid: null };
    const ctx = (sock) => ({ sock, me, send: async (j, c) => { sent.push([j, c]); }, log: () => { } });

    // fresh state
    fs.rmSync(FILE, { force: true });

    // 1) default state (off, 10/min)
    const st0 = antispam.command('');
    if (!/OFF/.test(st0) || !/\*10\*/.test(st0)) throw new Error('defaults wrong: ' + st0);
    console.log('[1] default state (OFF, 10/min): OK ✅');

    // 2) command on/off/threshold
    let t = antispam.command('on');
    if (!/ON/.test(t)) throw new Error('.antispam on failed');
    t = antispam.command('15');
    if (!/15/.test(t)) throw new Error('.antispam 15 failed');
    t = antispam.command('');
    if (!/15/.test(t) || !/ON/.test(t)) throw new Error('status wrong');
    console.log('[2] .antispam on / threshold 15 / status: OK ✅');

    // 3) flood → auto block (limit 15 → 16th message triggers)
    const calls = [];
    const sock = mkSock(calls);
    const SENDER = '94761234567@s.whatsapp.net';
    let blocked = false;
    for (let i = 0; i < 15; i++) blocked = await antispam.see(mkMsg(SENDER), ctx(sock)) || blocked;
    if (blocked) throw new Error('blocked before threshold');
    blocked = await antispam.see(mkMsg(SENDER), ctx(sock));
    if (!blocked) throw new Error('16th message did not trigger auto-block');
    if (calls.length !== 1 || calls[0][0] !== SENDER || calls[0][1] !== 'block') throw new Error('updateBlockStatus call wrong: ' + JSON.stringify(calls));
    if (!antispam.isBlocked(SENDER)) throw new Error('not in blocked list');
    if (!sent.some(([j]) => j === me.pn)) throw new Error('no self-chat notice');
    console.log('[3] flood auto-block (16 msg/min > 15) + notice: OK ✅');

    // 4) already-blocked sender → no more block calls
    await antispam.see(mkMsg(SENDER), ctx(sock));
    await antispam.see(mkMsg(SENDER), ctx(sock));
    if (calls.length !== 1) throw new Error('re-block happened');
    console.log('[4] blocked sender short-circuit: OK ✅');

    // 5) normTarget variants
    const nt = antispam.normTarget;
    if (nt('0761234567') !== '94761234567@s.whatsapp.net') throw new Error('0-prefix normalize failed: ' + nt('0761234567'));
    if (nt('+94 76-123-4567') !== '94761234567@s.whatsapp.net') throw new Error('spaced normalize failed');
    if (nt('94761234567@lid') !== '94761234567@lid') throw new Error('lid kept failed');
    if (nt('abc') !== null || nt('') !== null) throw new Error('garbage not rejected');
    console.log('[5] normTarget (0-prefix / +94 / lid / garbage): OK ✅');

    // 6) .block explicit + self-block refused
    const calls2 = [];
    const sock2 = mkSock(calls2);
    const t2 = await antispam.blockCommand(sock2, mkMsg(SENDER), '0779876543', me);
    if (!/Block කළා/.test(t2) || !calls2.some(([j, a]) => j === '94779876543@s.whatsapp.net' && a === 'block')) throw new Error('.block explicit failed: ' + t2);
    const t3 = await antispam.blockCommand(sock2, mkMsg(SENDER), '94700000000', me);
    if (!/ඔයාටම/.test(t3)) throw new Error('self-block not refused: ' + t3);
    console.log('[6] .block explicit + self-block refuse: OK ✅');

    // 7) .block via reply context (group member)
    const calls3 = [];
    const replyMsg = { key: { remoteJid: '12345-67890@g.us', fromMe: true }, message: { extendedTextMessage: { text: '.block', contextInfo: { participant: '94765550001@s.whatsapp.net' } } }, messageTimestamp: now };
    const t4 = await antispam.blockCommand(mkSock(calls3), replyMsg, '', me);
    if (!/Block කළා/.test(t4) || !calls3.some(([j]) => j === '94765550001@s.whatsapp.net')) throw new Error('reply-block failed: ' + t4);
    console.log('[7] .block reply-context: OK ✅');

    // 8) .unblock removes + calls unblock
    const calls4 = [];
    const t5 = await antispam.unblockCommand(mkSock(calls4), mkMsg(SENDER), '94779876543', me);
    if (!/Unblock කළා/.test(t5) || !calls4.some(([j, a]) => j === '94779876543@s.whatsapp.net' && a === 'unblock')) throw new Error('.unblock failed: ' + t5);
    if (antispam.isBlocked('94779876543@s.whatsapp.net')) throw new Error('still in list after unblock');
    console.log('[8] .unblock: OK ✅');

    // 9) listText / logText
    const lt = antispam.listText(), sl = antispam.logText();
    if (!/94761234567/.test(lt)) throw new Error('blocklist missing jid');
    if (!/flood/.test(sl)) throw new Error('spamlog missing flood entry');
    console.log('[9] .blocklist + .spamlog: OK ✅');

    // 10) old history-sync messages never count
    const calls5 = [];
    const sock5 = mkSock(calls5);
    const OLD = now - 3600;
    for (let i = 0; i < 20; i++) await antispam.see(mkMsg('94761110000@s.whatsapp.net', OLD), ctx(sock5));
    if (calls5.length) throw new Error('old messages triggered block');
    console.log('[10] history-sync false-block guard: OK ✅');

    // 11) group / status / own messages skipped
    const calls6 = [];
    const sock6 = mkSock(calls6);
    const gm = { key: { remoteJid: '111-222@g.us', participant: '94761234567@s.whatsapp.net', fromMe: false }, message: { conversation: 'hi' }, messageTimestamp: now };
    for (let i = 0; i < 20; i++) await antispam.see(gm, ctx(sock6));
    const own = mkMsg(me.pn); own.key.fromMe = true;
    for (let i = 0; i < 20; i++) await antispam.see(own, ctx(sock6));
    if (calls6.length) throw new Error('group/own messages counted');
    console.log('[11] group + own-message skip: OK ✅');

    // 12) syntax + module graph + manifest/package
    for (const f of ['bot.js', 'antispam.js', 'updater.js']) {
        execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
    }
    require('./bot.js');   // full module graph loads offline
    const m = require('./manifest.json');
    const pkgV = require('./package.json').version;
    if (m.version !== pkgV || m.version < '2.20.0' || !m.files.includes('antispam.js') || !m.files.includes('test_v220.js')) throw new Error('manifest wrong');
    if (pkgV < '2.20.0') throw new Error('package.json version wrong');
    if (!fs.readFileSync('updater.js', 'utf8').includes('antispam\\.json')) throw new Error('updater PROTECTED missing antispam.json');
    const src = fs.readFileSync('bot.js', 'utf8');
    for (const cmd of [".block", ".unblock", ".blocklist", ".spamlog", ".antispam"]) if (!src.includes(`'${cmd}'`)) throw new Error('bot.js route missing: ' + cmd);
    console.log('[12] node --check + bot.js load + manifest/package/PROTECTED/routes: OK ✅');

    console.log('\n🎉 ALL v2.20.0 TESTS PASSED');
})().catch((e) => { console.error('💥 ' + (e.stack || e.message)); failed = true; })
    .finally(() => {   // restore repo state (runs even after process.exit-proof failures)
        try { if (backup !== null) fs.writeFileSync(FILE, backup); else fs.rmSync(FILE, { force: true }); } catch { }
        process.exit(failed ? 1 : 0);
    });
