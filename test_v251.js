/**
 * test_v251.js — 👁 Vision + 🎨 Image gen + 📖 Read URL + ⏰ Reminders
 * offline checks + LIVE network probes (read_url / generate_image / web_search)
 */
const os = require('os');
const path = require('path');
process.env.ARENA_REMINDERS_FILE = path.join(os.tmpdir(), 'rem_test_v251_' + Date.now() + '.json');

let pass = 0, fail = 0, livePass = 0, liveFail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const live = (name, cond) => { if (cond) { livePass++; console.log('  🌐 ' + name); } else { liveFail++; console.log('  🌐(fail) ' + name); } };

(async () => {
    console.log('— modules —');
    const pkg = require('./package.json'), man = require('./manifest.json');
    const rem = require('./reminders');
    const T = require('./ai_tools');
    const ai = require('./ai');
    ok('01 pkg 2.51.0', pkg.version === '2.51.0');
    ok('02 manifest 2.51.0', man.version === '2.51.0');
    ok('03 manifest files += reminders/test_v251', man.files.includes('reminders.js') && man.files.includes('test_v251.js'));
    ok('04 tools = 9', T.TOOLS.length === 9);
    ok('05 runToolEx fn', typeof T.runToolEx === 'function');
    ok('06 runTool compat fn', typeof T.runTool === 'function');
    ok('07 ai.askVision exported', typeof ai.askVision === 'function');

    console.log('— reminders: parseWhen —');
    const now = Date.now();
    const t1 = rem.parseWhen('10m');
    ok('08 10m → future ~10min', isFinite(t1) && t1 > now + 9.5 * 60e3 && t1 < now + 10.5 * 60e3);
    const t2 = rem.parseWhen('1h30m');
    ok('09 1h30m combo', isFinite(t2) && Math.abs((t2 - now) - 90 * 60e3) < 10e3);
    const t3 = rem.parseWhen('08:30');
    ok('10 HH:MM (past → හෙට)', isFinite(t3) && t3 > now);
    const t4 = rem.parseWhen('2030-01-15T08:00:00+05:30');
    ok('11 ISO +05:30', Math.abs(t4 - Date.UTC(2030, 0, 15, 2, 30)) < 2e3);
    const t5 = rem.parseWhen('2030-01-15T08:00:00Z');
    ok('12 ISO Z', Math.abs(t5 - Date.UTC(2030, 0, 15, 8, 0)) < 2e3);
    const t6 = rem.parseWhen('2030-01-15');
    ok('13 date-only → noon SL', isFinite(t6) && Math.abs(t6 - (Date.UTC(2030, 0, 15, 6, 30))) < 2e3);
    ok('14 garbage → NaN', isNaN(rem.parseWhen('next sunday morning x')));

    console.log('— reminders: add/list/del —');
    const r1 = rem.add('c1@s.whatsapp.net', now + 60e3, 'tick test one', 'test');
    ok('15 add → id + note', !!r1.id && r1.note === 'tick test one');
    ok('16 list shows 1', rem.list('c1@s.whatsapp.net').length === 1);
    ok('17 past reject', (() => { try { rem.add('c1', now - 5000, 'x'); return false; } catch { return true; } })());
    ok('18 empty note reject', (() => { try { rem.add('c1', now + 60e3, '  '); return false; } catch { return true; } })());
    ok('19 >90d reject', (() => { try { rem.add('c1', now + 91 * 86400e3, 'x'); return false; } catch { return true; } })());
    ok('20 fmtWhen has SL', /\d{2}:\d{2} SL \(/.test(rem.fmtWhen(now + 60e3)));
    ok('21 del works', !!rem.del('c1@s.whatsapp.net', 1) && rem.list('c1@s.whatsapp.net').length === 0);
    ok('22 toolList empty msg', rem.toolList('nobody@s.whatsapp.net').includes('නෑ'));

    console.log('— reminders: tick scheduler —');
    const sends = [];
    const fakeSock = { sendMessage: async (jid, content) => { sends.push({ jid, text: content.text }); return { key: { id: 'x' } }; } };
    let sockOn = false;
    rem.start({ getSock: () => (sockOn ? fakeSock : null), log: () => { } });   // test hook — start() විතරයි interval එකත් unref
    rem._items().push({ id: 'due1', chatId: 'c1@s.whatsapp.net', at: now - 5e3, note: 'fire me', by: 'test' });
    rem._items().push({ id: 'ancient', chatId: 'c1@s.whatsapp.net', at: now - 8 * 86400e3, note: 'too old', by: 'test' });
    const f1 = await rem.tick();
    ok('23 no-sock → due kept (retry later)', f1 === 0 && sends.length === 0 && rem._items().length === 1);
    ok('24 >7d overdue dropped', !rem._items().some(r => r.id === 'ancient'));
    sockOn = true;
    const f2 = await rem.tick();
    ok('25 sock on → fires', f2 === 1 && sends.length === 1);
    ok('26 tick card = ⏰', sends[0] && sends[0].text.includes('⏰') && sends[0].text.includes('fire me'));
    ok('27 items empty after fire', rem._items().length === 0);

    console.log('— ai_tools: runToolEx —');
    ok('28 unknown tool', (await T.runToolEx('nope', '{}')).text.includes('Unknown tool'));
    ok('29 calculator still OK', (await T.runToolEx('calculator', JSON.stringify({ expression: '6*7' }))).text === '42');
    ok('30 runTool compat string', typeof (await T.runTool('calculator', JSON.stringify({ expression: '1+1' }))) === 'string');
    ok('31 set_reminder no ctx → clean error', (await T.runToolEx('set_reminder', JSON.stringify({ time: '2030-01-01T08:00:00+05:30', note: 'x' }))).text.startsWith('Tool error'));
    const before = rem._items().length;
    const futIso = new Date(now + 3600e3 + 5.5 * 3600e3).toISOString().slice(0, 19) + '+05:30';   // ඉස්සරහට 1h (SL wall time)
    const sr = await T.runToolEx('set_reminder', JSON.stringify({ time: futIso, note: 'ai reminder test' }), { chatId: 'c2@s.whatsapp.net' });
    ok('32 set_reminder via ctx', !sr.text.startsWith('Tool error') && sr.text.includes('Reminder set') && rem._items().length === before + 1);
    ok('33 bad time → Tool error', (await T.runToolEx('set_reminder', JSON.stringify({ time: 'someday', note: 'x' }), { chatId: 'c2' })).text.startsWith('Tool error'));
    ok('34 list_reminders via ctx', (await T.runToolEx('list_reminders', '{}', { chatId: 'c2@s.whatsapp.net' })).text.includes('ai reminder test'));
    ok('35 generate_image empty → clean error', (await T.runToolEx('generate_image', '{}')).text.startsWith('Tool error'));
    ok('36 read_url bad → clean error', (await T.runToolEx('read_url', JSON.stringify({ url: 'ftp://x' }))).text.startsWith('Tool error'));
    ok('37 never throws', (await T.runToolEx('read_url', 'not json')) .text.startsWith('Tool error'));

    console.log('— wiring (source asserts) —');
    const botSrc = require('fs').readFileSync('./bot.js', 'utf8');
    ok('38 bot: .remind dispatch', botSrc.includes("c === '.remind'"));
    ok('39 bot: vision → askVision', botSrc.includes('ai.askVision'));
    ok('40 bot: tool image send', botSrc.includes('image: images[0], caption: text'));
    ok('41 bot: scheduler start', botSrc.includes('reminders.start({ getSock: () => SOCK, log })'));
    ok('42 ai: hint lists 9 tools', require('fs').readFileSync('./ai.js', 'utf8').includes('generate_image, read_url, set_reminder'));
    ok('43 .gitignore reminders.json', require('fs').readFileSync('./.gitignore', 'utf8').includes('reminders.json'));

    console.log('— LIVE network probes —');
    try { const r = await T.runToolEx('read_url', JSON.stringify({ url: 'https://example.com' })); live('44 LIVE read_url', r.text.includes('Example Domain')); } catch { live('44 LIVE read_url', false); }
    try { const r = await T.runToolEx('generate_image', JSON.stringify({ prompt: 'a tiny red cube on white background, minimal 3d render' })); live('45 LIVE generate_image', !!r.image && r.image.length > 2000); } catch { live('45 LIVE generate_image', false); }
    try { const r = await T.runTool('web_search', JSON.stringify({ query: 'Sri Lanka news' })); live('46 LIVE web_search (regression)', !r.startsWith('Tool error') && r.includes('http')); } catch { live('46 LIVE web_search (regression)', false); }

    console.log(`\n${pass} passed, ${fail} failed · live: ${livePass}/${livePass + liveFail}`);
    process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('test crash:', e); process.exit(1); });
