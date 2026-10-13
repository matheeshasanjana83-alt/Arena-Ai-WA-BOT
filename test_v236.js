/**
 * test_v236 — .setting panel (offline, simulated WhatsApp via onMessages)
 *  • panel caption: K A V I Z - V 1 🍁 + all real settings rows + 9 options
 *  • number reply (quoted stanzaId) → toggle each option 1-9
 *  • plain-number routing: .setting fresh → setting; .menu newer → menu
 *  • invalid number → error, no crash
 *  • bot.js wiring: dispatch / HELP / CATS / routing
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_RATE_MIN = '100000'; process.env.ARENA_RATE_HOUR = '1000000';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };

const SET = path.join(__dirname, 'settings.json');
const backup = fs.existsSync(SET) ? fs.readFileSync(SET) : null;
try { fs.unlinkSync(SET); } catch { }

const bot = require('./bot');
const guard = require('./guard');
const antibug = require('./antibug');
const { onMessages } = bot;

let n = 0;
const JID = '94771234567@s.whatsapp.net';
const out = [];
const send = async (jid, c) => { const e = { jid, ...c }; out.push(e); return { key: { id: 'OUT' + (++n) } }; };
const run = async (msg) => { out.length = 0; await onMessages({ type: 'notify', messages: [msg] }, send); return out; };
const mk = (text) => ({ key: { id: 'IN' + (++n), remoteJid: JID, fromMe: true }, message: { conversation: String(text) } });
const mkNum = (num, quoteId) => ({ key: { id: 'IN' + (++n), remoteJid: JID, fromMe: true }, message: { extendedTextMessage: { text: String(num), contextInfo: { stanzaId: quoteId } } } });
const panels = (r) => r.filter(x => x.caption && /SETTINGS PANEL/.test(x.caption));
const cap = (r) => panels(r)[0]?.caption || '';
const lastId = (r) => r[r.length - 1]?.key?.id;

(async () => {
    // version bump
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    t('package.json = 2.36.0', pkg.version === '2.36.0');
    t('manifest.json = 2.36.0', man.version === '2.36.0');
    t('manifest: test_v236 in files, test_v235 removed', man.files.includes('test_v236.js') && man.removed.includes('test_v235.js'));

    // 1. .setting → panel
    console.log('\n— panel —');
    let r = await run(mk('.setting'));
    t('.setting → image + caption panel (banner)', !!panels(r).length && !!r.find(x => x.image));
    const c0 = cap(r);
    t('BOT NAME = K A V I Z - V 1 🍁', c0.includes('*BOT NAME:* K A V I Z - V 1 🍁'));
    t('ඇත්ත settings rows: WORK TYPE / AI KEYS / ANTI-BUG / AUTO REPORT / AUTO BLOCK / AUTO UPDATE / MAX FILE / AUTO REACT / PROXY',
        ['WORK TYPE', 'AI KEYS', 'ANTI-BUG', 'AUTO REPORT', 'AUTO BLOCK', 'AUTO UPDATE', 'MAX FILE', 'AUTO REACT', 'PROXY'].every(k => c0.includes(k)));
    t('options 1-9 + SELECT OPTION', ['1 | Mode: All', '2 | Mode: Self', '3 | Anti-Bug', '4 | Auto Report', '5 | Report Count', '6 | Auto Block', '7 | Auto-Update', '8 | Max File', '9 | Auto React', 'SELECT OPTION'].every(k => c0.includes(k)));
    t('AI KEYS: Z.ai ✅ (key දාලා නැති නිසා test එකේ ❌)', /Z\.ai ❌/.test(c0));

    // state registered?
    const panelId0 = lastId(r);

    // 2. mode toggles (quoted number reply)
    console.log('\n— mode (1/2) —');
    r = await run(mkNum(1, panelId0));
    t('1 → mode all (confirm)', r.some(x => /mode: all/.test(x.text || '')));
    t('panel refresh එනවා', !!panels(r).length && /WORK TYPE:\* all/.test(cap(r)));
    r = await run(mkNum(2, lastId(r)));
    t('2 → mode self (panel: self)', /WORK TYPE:\* self/.test(cap(r)));

    // 3. anti-bug toggles
    console.log('\n— anti-bug (3-6) —');
    const a0 = antibug.cfg();
    r = await run(mkNum(3, lastId(r)));
    t('3 → anti-bug flip', antibug.cfg().on === !a0.on);
    r = await run(mkNum(3, lastId(r)));
    t('3 → ආපහු original', antibug.cfg().on === a0.on);
    r = await run(mkNum(4, lastId(r)));
    t('4 → report flip', antibug.cfg().report === !a0.report);
    r = await run(mkNum(4, lastId(r)));
    t('4 → ආපහු', antibug.cfg().report === a0.report);
    const cStart = antibug.cfg().reportCount;
    const seq = []; for (let i = 0; i < 5; i++) { r = await run(mkNum(5, lastId(r))); seq.push(antibug.cfg().reportCount); }
    t(`5 → count cycle ${cStart}→${seq.join('→')} (10,20,30,50,100 steps)`, seq.length === 5 && new Set(seq).size === 5);
    t('5 → cycle අවසානයේ ආපහු original ට', seq[seq.length - 1] === cStart);
    r = await run(mkNum(6, lastId(r)));
    t('6 → block flip', antibug.cfg().block === !a0.block);
    r = await run(mkNum(6, lastId(r)));
    t('6 → ආපහු', antibug.cfg().block === a0.block);

    // 4. bot toggles
    console.log('\n— bot (7-9) —');
    const s0 = JSON.parse(fs.readFileSync(SET, 'utf8'));
    r = await run(mkNum(7, lastId(r)));
    const auAfter = JSON.parse(fs.readFileSync(SET, 'utf8')).autoUpdate;
    t('7 → autoUpdate settings flip', auAfter === false);
    r = await run(mkNum(7, lastId(r)));
    t('7 → ආපහු (true = ON)', JSON.parse(fs.readFileSync(SET, 'utf8')).autoUpdate === true);
    const mb0 = require('./downloader').maxMB();
    r = await run(mkNum(8, lastId(r)));
    const s8 = JSON.parse(fs.readFileSync(SET, 'utf8'));
    t('8 → maxMB → ඊළඟ step', s8.maxMB && s8.maxMB !== mb0, );
    t('8 → DL_MAX_MB env sync', process.env.DL_MAX_MB === String(s8.maxMB));
    // react toggle — ARENA_NO_REACT ඉවත් කරලා
    const hadNoReact = process.env.ARENA_NO_REACT; delete process.env.ARENA_NO_REACT;
    const r0 = JSON.parse(fs.readFileSync(SET, 'utf8')).react;
    r = await run(mkNum(9, lastId(r)));
    const r1 = JSON.parse(fs.readFileSync(SET, 'utf8')).react;
    t('9 → react settings flip', r1 === !(r0 !== false));
    r = await run(mkNum(9, lastId(r)));
    if (hadNoReact !== undefined) process.env.ARENA_NO_REACT = hadNoReact;

    // 5. invalid number
    console.log('\n— invalid + routing —');
    r = await run(mkNum(99, lastId(r)));
    t('99 → error, no crash', r.some(x => /1 – 9/.test(x.text || '')));
    // plain number (no quote) — .setting fresh → setting toggle
    const beforeCnt = antibug.cfg().reportCount;
    r = await run(mk(5));
    t('plain number එකක් (no quote) → .setting එකටම යනවා (recency)', antibug.cfg().reportCount !== beforeCnt);
    // .menu අලුත් නම් → menu wins
    r = await run(mk('.menu'));
    r = await run(mk(1));
    t('.menu පස්සේ plain number → menu category (DOWNLOAD)', r.some(x => /DOWNLOAD/.test(x.text || '')) && !panels(r).length);

    // 6. wiring
    console.log('\n— wiring —');
    const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
    t('dispatch .setting/.settings', src.includes("c === '.setting' || c === '.settings'"));
    t('HELP වල .setting', /\.setting\* \(panel\)/.test(src));
    t('Settings category .setting line', src.includes('⚙️ settings panel (අංක reply → toggle)'));
    t('number routing .setting', src.includes("text = '.setting ' + text"));

    // cleanup — original state එකට
    guard.setChatMode('self');
    try { fs.unlinkSync(SET); } catch { }
    if (backup) fs.writeFileSync(SET, backup);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
