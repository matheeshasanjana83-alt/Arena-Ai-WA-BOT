'use strict';
/**
 * test_v233.js — Anti-Bug v3: AUTO RETALIATION (v2.33.0)
 * Proves: bug sender → auto report ×N (correct moderation IQ, human-paced, background)
 *         → WHEN reports finish → block (private only). Owner never touched. Cooldown.
 *         Honest result card. Config (.antibug report on|off / count). Detector regression.
 * run: node test_v233.js   (offline — fake sock spies, NOTHING is sent to WhatsApp)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

process.env.ANTIBUG_TEST_FAST = '1';               // reports 1ms apart — suite stays fast
let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');

// settings.json snapshot — setCfg writes it, we restore on exit
const SET_FILE = path.join(__dirname, 'settings.json');
const SET_SNAP = fs.readFileSync(SET_FILE, 'utf8');
process.on('exit', () => { try { fs.writeFileSync(SET_FILE, SET_SNAP); } catch { } });

const ab = require('./antibug');
const mkSock = (qFail) => {
    const s = { queries: [], blocks: [], chatModifies: [], sends: [] };
    s.query = async (node) => { if (qFail) throw new Error(qFail); s.queries.push(node); return {}; };
    s.updateBlockStatus = async (jid, action) => { s.blocks.push({ jid, action }); };
    s.chatModify = async (p, jid) => { s.chatModifies.push({ jid }); };
    s.sendMessage = async () => { };
    return s;
};
const mkCtx = (sock, extra = {}) => ({
    sock,
    me: { pn: '94760552994@s.whatsapp.net' },
    send: async (jid, content) => { sock.sends.push({ jid, content }); },
    log: () => { },
    ...extra,
});
let uniq = 100;
const senderJid = () => `9477${String(uniq++).padStart(6, '0')}@s.whatsapp.net`;
const severeMsg = (jid) => ({ key: { remoteJid: jid, fromMe: false, id: 'BUGID' + uniq }, message: { conversation: '්ා'.repeat(600) } });
const waitRetal = async (jid) => { const p = ab._retalRunning.get(jid); if (!p) throw new Error('no retaliation promise for ' + jid); return p; };

(async () => {
    try {
        // 1) version sync 2.33.0
        const man = JSON.parse(read('manifest.json'));
        const pkg = JSON.parse(read('package.json'));
        if (man.version !== pkg.version || pkg.version < '2.33.0') throw new Error('version sync wrong: pkg=' + pkg.version);
        console.log('[1] v' + pkg.version + ' sync (manifest === package): OK ✅');

        // 2) old test gone, manifest clean, antibug.js + test_v233.js shipped
        if (fs.existsSync('test_v232.js')) throw new Error('test_v232.js still exists');
        for (const f of man.removed || []) {
            if (man.files.includes(f)) throw new Error(f + ' in both files and removed');
            if (/^(auth|node_modules|\.backup)/.test(f) || f.includes('..') || path.isAbsolute(f)) throw new Error('unsafe removed path: ' + f);
        }
        if (!man.files.includes('antibug.js') || !man.files.includes('test_v233.js')) throw new Error('manifest missing antibug.js/test_v233.js');
        console.log('[2] test_v232 deleted + manifest clean: OK ✅');

        // 3) config defaults — report ON, count 30 (settings absent → defaults)
        fs.writeFileSync(SET_FILE, JSON.stringify({ pairKey: 'X', autoUpdate: true }));
        const c0 = ab.cfg();
        if (!c0.on || !c0.block || !c0.report || c0.reportCount !== 30) throw new Error('defaults wrong: ' + JSON.stringify(c0));
        console.log('[3] defaults: on+block+report ON, reportCount 30: OK ✅');

        // 4) detector regression — key classes still caught, normals clean
        const mustBug = (name, msg, severe) => {
            const r = ab.detect(msg);
            if (!r.bug) throw new Error(name + ' NOT detected');
            if (severe && !r.severe) throw new Error(name + ' not severe');
        };
        mustBug('sinhala storm', { conversation: '්ා'.repeat(600) }, true);
        mustBug('mark storm', { conversation: 'ا' + 'ًٌٍَُِّ'.repeat(500) }, true);
        mustBug('ctrl storm', { conversation: 'a\u0000'.repeat(400) }, true);
        mustBug('filler flood', { conversation: '\u3164'.repeat(3000) }, true);
        mustBug('dim bomb', { imageMessage: { width: 99999, height: 99999 } }, true);
        mustBug('location bug', { locationMessage: { degreesLatitude: 1e300, degreesLongitude: 90 } }, true);
        mustBug('huge text (bug, not severe)', { conversation: 'word '.repeat(4000) }, false);
        const mustClean = (name, msg) => { const r = ab.detect(msg); if (r.bug) throw new Error('FALSE POSITIVE ' + name + ': ' + r.reasons.join(', ')); };
        mustClean('සාමාන්‍ය සිංහල', { conversation: 'මම ගෙදර යනවා යාළුවෙන් එක්ක පාරට. ර්‍යාංශ මිටියාවත ගිනිකෙළිය වගේ වැඩ.' });
        mustClean('Quran tashkeel', { conversation: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' });
        mustClean('4K video', { videoMessage: { width: 3840, height: 2160, seconds: 600 } });
        mustClean('normal location', { locationMessage: { degreesLatitude: 6.9271, degreesLongitude: 79.8612 } });
        console.log('[4] detector regression (bug classes + false positives): OK ✅');

        // 5) .antibug test self-test 22/22
        const st = ab.selfTest();
        if (/❌/.test(st)) throw new Error('selfTest failures:\n' + st);
        if (!/22\/22/.test(st)) throw new Error('selfTest count wrong');
        console.log('[5] .antibug test self-test 22/22 green: OK ✅');

        // 6) E2E — severe bug in private → report ×30 (moderation IQ shape) → THEN block → final card
        ab._retaliated.clear(); ab._blocked.clear();
        const s1 = mkSock(), x1 = mkCtx(s1);
        const sj1 = senderJid();
        const m1 = severeMsg(sj1);
        const g1 = await ab.guard(m1, x1);
        if (g1 !== true) throw new Error('guard did not claim the bug');
        const r1 = await waitRetal(sj1);
        if (s1.queries.length !== 30) throw new Error('expected 30 report IQs, got ' + s1.queries.length);
        const n = s1.queries[0];
        if (n.tag !== 'iq' || n.attrs.to !== 's.whatsapp.net' || n.attrs.xmlns !== 'jabber:client') throw new Error('report IQ attrs wrong: ' + JSON.stringify(n.attrs));
        const mod = n.content[0];
        if (mod.tag !== 'moderation' || mod.attrs.xmlns !== 'urn:xmp:mex:action?moderation:1') throw new Error('moderation node wrong');
        const cnt = mod.content[0];
        if (cnt.tag !== 'content' || cnt.attrs.msg_id !== m1.key.id || cnt.attrs.participant !== sj1) throw new Error('content node wrong: ' + JSON.stringify(cnt.attrs));
        if (cnt.content[0].tag !== 'report' || cnt.content[0].attrs.reason !== 'spam') throw new Error('report child wrong');
        if (r1.ok !== 30 || r1.want !== 30) throw new Error('retaliate result wrong: ' + JSON.stringify(r1));
        // block AFTER the reports (promise resolves post-block, but ordering: block was called)
        if (s1.blocks.length !== 1 || s1.blocks[0].jid !== sj1 || s1.blocks[0].action !== 'block') throw new Error('block wrong: ' + JSON.stringify(s1.blocks));
        const card = s1.sends.find((s) => /AUTO REPORT \+ BLOCK/.test(s.content?.text || ''));
        if (!card || !/30\/30 ✅/.test(card.content.text) || !/⛔ block: ✅ කළා/.test(card.content.text)) throw new Error('final card wrong:\n' + (card && card.content.text));
        console.log('[6] E2E: report ×30 (moderation IQ) → block ×1 → honest 30/30 card: OK ✅');

        // 7) non-severe bug → delete only, NO report, NO block
        ab._retaliated.clear(); ab._blocked.clear();
        const s2 = mkSock(), x2 = mkCtx(s2);
        const sj2 = senderJid();
        await ab.guard({ key: { remoteJid: sj2, fromMe: false, id: 'BIG' + uniq }, message: { conversation: 'word '.repeat(4000) } }, x2);
        await new Promise((r) => setTimeout(r, 20));
        if (s2.queries.length || s2.blocks.length) throw new Error('non-severe bug must not report/block');
        if (!s2.chatModifies.length) throw new Error('non-severe bug should still be deleted for me');
        console.log('[7] non-severe bug → delete only (no report/block): OK ✅');

        // 8) report OFF → 0 IQs, block still lands
        ab.setCfg({ report: false });
        ab._retaliated.clear(); ab._blocked.clear();
        const s3 = mkSock(), x3 = mkCtx(s3);
        const sj3 = senderJid();
        await ab.guard(severeMsg(sj3), x3);
        const r3 = await waitRetal(sj3);
        if (s3.queries.length) throw new Error('report OFF must send 0 IQs');
        if (s3.blocks.length !== 1) throw new Error('report OFF must still block');
        if (r3.ok !== 0 || !r3.blockedNow) throw new Error('report-off result wrong: ' + JSON.stringify(r3));
        ab.setCfg({ report: true });
        console.log('[8] .antibug report off → 0 reports, block still fires: OK ✅');

        // 9) count config — count 5 → exactly 5 IQs
        ab.setCfg({ reportCount: 5 });
        ab._retaliated.clear(); ab._blocked.clear();
        const s4 = mkSock(), x4 = mkCtx(s4);
        const sj4 = senderJid();
        await ab.guard(severeMsg(sj4), x4);
        await waitRetal(sj4);
        if (s4.queries.length !== 5) throw new Error('count 5 wrong: ' + s4.queries.length);
        if (ab.cfg().reportCount !== 5) throw new Error('cfg count not persisted');
        ab.setCfg({ reportCount: 30 });
        console.log('[9] .antibug count 5 → exactly 5 report IQs: OK ✅');

        // 10) OWNER protection — me.pn never reported/blocked
        ab._retaliated.clear(); ab._blocked.clear();
        const s5 = mkSock(), x5 = mkCtx(s5);
        const r5 = await ab.retaliate('94760552994:11@s.whatsapp.net', x5, { key: { id: 'X' }, canBlock: true });
        if (!r5.skip || r5.skip !== 'owner') throw new Error('owner not skipped: ' + JSON.stringify(r5));
        if (s5.queries.length || s5.blocks.length) throw new Error('OWNER was reported/blocked!');
        console.log('[10] owner/bot jid NEVER reported/blocked: OK ✅');

        // 11) cooldown — second retaliation for same sender skipped
        ab._retaliated.clear(); ab._blocked.clear();
        const s6 = mkSock(), x6 = mkCtx(s6);
        const sj6 = senderJid();
        await ab.guard(severeMsg(sj6), x6);
        const nBefore = s6.queries.length;
        const r6b = await ab.retaliate(sj6, x6, { key: { id: 'Y' }, canBlock: true });
        if (s6.queries.length !== nBefore) throw new Error('cooldown violated');
        if (r6b.skip !== 'cooldown') throw new Error('cooldown not reported: ' + JSON.stringify(r6b));
        console.log('[11] 10-min cooldown per sender (no self-spam): OK ✅');

        // 12) reports failing (server reject) → block STILL lands + honest 0/30 card
        ab._retaliated.clear(); ab._blocked.clear();
        const s7 = mkSock('moderation: rejected'), x7 = mkCtx(s7);
        const sj7 = senderJid();
        await ab.guard(severeMsg(sj7), x7);
        const r7 = await waitRetal(sj7);
        if (s7.blocks.length !== 1) throw new Error('block must land even when reports fail');
        if (r7.ok !== 0) throw new Error('ok count wrong: ' + JSON.stringify(r7));
        const card7 = s7.sends.find((s) => /AUTO REPORT \+ BLOCK/.test(s.content?.text || ''));
        if (!card7 || !/0\/30 ❌ \(server reject\)/.test(card7.content.text)) throw new Error('honest fail card wrong:\n' + (card7 && card7.content.text));
        console.log('[12] server-reject → block still fires + honest 0/30 card: OK ✅');

        // 13) group severe bug → report only, NO block
        ab._retaliated.clear(); ab._blocked.clear();
        const s8 = mkSock(), x8 = mkCtx(s8);
        const gj = '94771234567-1600000000@g.us';
        const gm = { key: { remoteJid: gj, fromMe: false, participant: senderJid(), id: 'G' + uniq }, message: { conversation: '්ා'.repeat(600) } };
        await ab.guard(gm, x8);
        await waitRetal(gm.key.participant);
        if (s8.blocks.length) throw new Error('group sender must NOT be blocked');
        if (s8.queries.length !== 30) throw new Error('group sender should be reported ×30: ' + s8.queries.length);
        console.log('[13] group bug → report ×30, never block (private only): OK ✅');

        // 14) command wiring — status card + new subcommands
        const menu = await ab.command('');
        if (!/auto report ×30/.test(menu) || !/count <1-100>/.test(menu) || !/report on \/ off/.test(menu)) throw new Error('menu missing new lines:\n' + menu);
        ab.setCfg({ reportCount: 55 });
        if (ab.cfg().reportCount !== 55) throw new Error('count command broken');
        ab.setCfg({ reportCount: 30 });
        const co = await ab.command('report', 'off');
        if (ab.cfg().report !== false) throw new Error('report off broken');
        ab.setCfg({ report: true });
        const co2 = await ab.command('count', '999');
        if (ab.cfg().reportCount !== 100) throw new Error('count clamp broken (999 → 100)');
        await ab.command('count', '30');
        console.log('[14] .antibug report on|off + count (clamp 1-100) commands: OK ✅');

        // 15) bot.js wiring intact
        const botSrc = read('bot.js');
        if (!/antibug\.guard\(msg, \{ sock: SOCK, me: ME, send, log \}\)/.test(botSrc)) throw new Error('bot.js guard wiring missing');
        if (!/\.antibug/.test(botSrc)) throw new Error('.antibug dispatch missing');
        if (!/auto report ×30/.test(botSrc) || !/antibug count <1-100>/.test(botSrc)) throw new Error('security menu not updated');
        console.log('[15] bot.js guard + dispatch + security menu: OK ✅');

        // 16) syntax on all shipped .js
        for (const f of man.files.filter((x) => x.endsWith('.js'))) {
            execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
        }
        console.log('[16] node --check all manifest .js files: OK ✅');

        console.log('\n\ud83c\udf89 ALL v2.33.0 TESTS PASSED');
    } catch (e) {
        console.error('\ud83d\udca5 ' + (e.stack || e.message));
        failed = true;
        process.exit(1);
    }
})();
