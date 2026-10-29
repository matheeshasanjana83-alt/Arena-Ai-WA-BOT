/**
 * test_v255.js — POWERFUL ANTI-BUG v5: OUT-GUARD sanitizer + echo-hole close + report budget
 * + storm lockdown + stuck-chat rescue. All offline (fake sock / source asserts / pure fns).
 * Run: node test_v255.js
 */
process.env.ANTIBUG_TEST_FAST = '1';
const fs = require('fs');
const path = require('path');
const ab = require('../antibug.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };
const srcBot = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
const srcAb = fs.readFileSync(path.join(__dirname, '..', 'antibug.js'), 'utf8');

(async () => {

// ── version pins ──
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
console.log('— versions —');
ok('01 pkg 2.55.x+', /^2\.5[5-9]\./.test(pkg.version));
ok('02 manifest 2.55.x+', /^2\.5[5-9]\./.test(man.version));
ok('03 manifest files += test_v255', man.files.includes('tests/test_v255.js') || man.files.includes('tests/test_v256.js'));
ok('04 manifest removed += test_v254', (man.removed || []).includes('test_v254.js'));
ok('05 manifest notes = current version changelog', String(man.notes || '').includes('v' + require('../package.json').version));   // single-note convention (d211e86) — pin follows the version, not a feature keyword

// ── OUT-GUARD: sanitizeOut ──
console.log('— sanitizeOut (outbound guarantee) —');
ok('06 control chars stripped', !ab.sanitizeOut('a\u0000\u0007b\u001Fc').includes(/[\u0000-\u001F]/.source && '\u0000'));
const bidi = ab.sanitizeOut('hi\u202EretpadA\u2066x\u2069');
ok('07 bidi overrides stripped', !/[\u202A-\u202E\u2066-\u2069]/.test(bidi) && bidi.startsWith('hi'));
const tag = '\uDB40\uDD00';   // U+E0100 (tag plane, surrogate pair)
const tagOut = ab.sanitizeOut('ok' + tag.repeat(2000));
ok('08 tag chars stripped', tagOut === 'ok');
const inv = ab.sanitizeOut('\u200B'.repeat(5000) + ' ආයුබෝවන්');
ok('09 invisible storm → clean text', inv.trim() === 'ආයුබෝවන්');
const run = ab.sanitizeOut('X'.repeat(9000));
ok('10 unbroken run cut to 1200', run.length === 1200);
const mixedRun = ab.sanitizeOut('word '.repeat(400) + 'Y'.repeat(8000) + ' tail');
ok('11 normal words kept + run cut', mixedRun.startsWith('word ') && mixedRun.includes(' tail'));
const surr = ab.sanitizeOut('a\uDC80b\uD83Cx');
ok('12 lone surrogates removed', surr === 'abx');
const giant = ab.sanitizeOut('මෙක '.repeat(60000));
ok('13 60k hard cap', giant.length <= 60001 + 2);
const sinh = 'මම ගෙදර යනවා ර්‍යාංශ කියලා — සිංහල හරි!';
ok('14 Sinhala conjunct ZWJ preserved', ab.sanitizeOut(sinh) === sinh);
const emo = ab.sanitizeOut('❤️ 👨‍👩‍👧‍👦 🇱🇰 ok');
ok('15 ❤️ VS16 + family ZWJ + flag preserved', emo === '❤️ 👨‍👩‍👧‍👦 🇱🇰 ok');
const vs15 = ab.sanitizeOut('a\uFE0Eb');
ok('16 VS15 stripped (VS16 kept)', vs15 === 'ab' && ab.sanitizeOut('❤️') === '❤️');
ok('17 sanitizeOut null-safe', ab.sanitizeOut(null) === '' && ab.sanitizeOut(undefined) === '');

// ── OUT-GUARD: cleanOut (content objects) ──
console.log('— cleanOut (every send) —');
const c1 = ab.cleanOut({ text: 'hi\u0000\u200B\u200B\u200Bthere' });
ok('18 text sanitized (storm → space)', c1.text === 'hi there');
const c2 = ab.cleanOut({ image: Buffer.alloc(2), caption: 'cap '.repeat(3000) });   // 12k caption
ok('19 caption capped 4000(+…)', c2.caption.length <= 4002 && c2.caption.startsWith('cap cap '));
const c3 = ab.cleanOut({ text: '\u200C'.repeat(5000) });
ok('20 pure-invisible text → bug-safe marker', c3.text === '🛡️ (bug-safe)');
const c4 = ab.cleanOut({ video: 1, caption: 'සාමාන්‍ය caption 🎬' });
ok('21 normal caption untouched', c4.caption === 'සාමාන්‍ය caption 🎬');
ok('22 media field preserved', c4.video === 1);
ok('23 non-object passthrough', ab.cleanOut(null) === null);

// ── echo-hole closed (source asserts) ──
console.log('— echo hole closed (bot.js wiring) —');
ok('24 guard return → continue', /if \(await antibug\.guard\(msg, \{ sock: SOCK, me: ME, send, log \}\)\) continue;/.test(srcBot));
ok('25 send() = cleanOut FIRST', /const send = async \(jid, content, opts\) => \{\s*\n\s*content = antibug\.cleanOut\(content\);/.test(srcBot));
ok('26 maybeAiReply lockdown gate', /if \(antibug\.lockedDown\(\)\) return;\s*\/\/ 🌩️/.test(srcBot));
ok('27 .antibug clearchat routing', srcBot.includes("sub === 'clearchat'") && srcBot.includes('antibug.clearChat(SOCK, jid)'));
ok('28 .antibug unblock routing', srcBot.includes("sub === 'unblock'") && srcBot.includes('antibug.unblockAll(SOCK)'));

// ── retaliation: 24h budget + abort + block-still-lands ──
console.log('— report budget / abort / block —');
ab.setCfg({ dailyCap: 5, report: true, reportCount: 30, block: true });
ok('29 dailyCap clamped+persisted', ab.cfg().dailyCap === 5);
ab._state.reports = [];   // fresh budget
let iqCalls = 0, blocks = [];
const fakeSock = { query: async () => { iqCalls++; return {}; }, updateBlockStatus: async (j, s) => { blocks.push(s); } };
const me = { pn: '947600000000@s.whatsapp.net', lid: '111@s.whatsapp.net' };
const ctx = { sock: fakeSock, me, send: async () => { }, log: () => { } };
const attacker = '947611111111@s.whatsapp.net';
const r1 = await ab.retaliate(attacker, ctx, { canBlock: true });
ok('30 budget caps want (30→5)', r1.ok === 5 && r1.want === 5 && iqCalls === 5);
ok('31 block lands after reports', r1.blockedNow === true && blocks.includes('block'));
ab._retaliated.delete(attacker);
const r2 = await ab.retaliate('947622222222@s.whatsapp.net', ctx, { canBlock: true });
ok('32 budget exhausted → 0 reports', r2.want === 0 && r2.ok === 0 && iqCalls === 5);
ok('33 block STILL lands when budget empty', r2.blockedNow === true);
// abort: 3 server-rejects → stop hammering + block still lands
ab._state.reports = []; ab._retaliated.clear();
const errSock = { query: async () => { throw new Error('server reject'); }, updateBlockStatus: async (j, s) => { blocks.push('block:' + j); } };
const r3 = await ab.retaliate('947633333333@s.whatsapp.net', { sock: errSock, me, send: async () => { }, log: () => { } }, { canBlock: true });
ok('34 abort after 3 fails', r3.ok === 0 && r3.want > 0 && r3.aborted === true);
let tries = 0;
const countSock = { query: async () => { tries++; throw new Error('still dead'); }, updateBlockStatus: async () => { } };
const r4 = await ab.retaliate('947644444444@s.whatsapp.net', { sock: countSock, me, send: async () => { }, log: () => { } }, { canBlock: true });
ok('35 paused → zero report attempts + block lands', tries === 0 && r4.ok === 0 && r4.blockedNow === true);

// ── storm lockdown ──
console.log('— storm lockdown —');
ab._state.lockdownUntil = 0; ab._state.reports = [];
ok('36 clean → not locked', ab.lockedDown() === false);
ok('37 severe ×2 → not locked yet', ab.noteSevere() === false && ab.noteSevere() === false && ab.lockedDown() === false);
ok('38 severe ×3 → LOCKDOWN', ab.noteSevere() === true && ab.lockedDown() === true && ab._state.lockdownUntil > Date.now());
ok('39 lock persists (no re-fire)', ab.noteSevere() === false && ab.lockedDown() === true);

// ── stuck-chat rescue + unblock recovery (fake sock) ──
console.log('— clearchat / unblock —');
const mods = [];
const ccSock = { chatModify: async (m, j) => { mods.push({ m, j }); }, updateBlockStatus: async (j, s) => { blocks.push(s + ':' + j); } };
await ab.clearChat(ccSock, '947655555555@s.whatsapp.net');
ok('40 clearChat = delete:true account-wide', mods.length === 1 && mods[0].m.delete === true && mods[0].j === '947655555555@s.whatsapp.net');
ab._blocked.clear();
ab._blocked.add('947611111111@s.whatsapp.net');
ab._blocked.add('947622222222@s.whatsapp.net');
const un = await ab.unblockAll(ccSock);
ok('41 unblockAll frees session blocks', un.length === 2 && ab._blocked.size === 0 && blocks.filter((b) => String(b).startsWith('unblock')).length === 2);

// ── selfTest grew ──
const st = ab.selfTest();
ok('42 selfTest has invincible-50k + all pass', st.includes('invincible bug 50k') && !st.includes('❌'));
ok('43 guard card has clearchat rescue hint', srcAb.includes('.antibug clearchat yes'));
ok('44 command card shows budget + outguard', srcAb.includes('24h budget') && srcAb.includes('sanitize'));

// ── cleanup: reset state + remove runtime file ──
ab._state.reports = []; ab._state.lockdownUntil = 0;
try { fs.rmSync(path.join(__dirname, '..', 'antibug_state.json'), { force: true }); } catch { }

console.log(`\n═══ v2.55.0: ${pass} pass · ${fail} fail ═══`);
process.exit(fail ? 1 : 0);

})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
