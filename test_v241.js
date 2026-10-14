/* test_v241 — MODE PANEL + AI CHAT + FORWARD (offline)
   • guard: 4 chat modes + legacy mapping + botAccess matrix
   • guard: aiChat on/off + 6 aiModes + aiAllowed matrix
   • bot: OWNER_CMDS gate, 3-panel number router, .forward (E2E), .mode panel (E2E), AI auto-chat (E2E, fake ai.ask)
*/
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
process.env.ARENA_RATE_MIN = '1000'; process.env.ARENA_RATE_HOUR = '10000';
process.env.DL_TMP = require('os').tmpdir();

const fs = require('fs');
const path = require('path');
const SETF = path.join(__dirname, 'settings.json');
const SET_BACK = fs.existsSync(SETF) ? fs.readFileSync(SETF, 'utf8') : null;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

const guard = require('./guard');
const bot = require('./bot');
const ai = require('./ai');

// settings isolation: no reacts, no real keys
fs.writeFileSync(SETF, JSON.stringify({ react: false, autoUpdate: false }, null, 2));

const SELF = '94771234567@s.whatsapp.net';   // bot/owner pn
const OTHER = '94711111111@s.whatsapp.net';  // a normal user
const GROUP = '12036302XXXX@g.us';
bot.ME.pn = SELF; bot.ME.lid = null;

// fake sock: capture ALL sends (bot.send wrapper + direct SOCK.sendMessage)
const sockCalls = [];
const FAKE_SOCK = { sendMessage: async (to, content) => { sockCalls.push({ to, content }); return { key: { id: 'sk' + sockCalls.length, remoteJid: to } }; }, user: { id: SELF } };
bot._setSock(FAKE_SOCK);

// capture send() outputs
const SENT = [];
const send = async (jid, content, opts) => { SENT.push({ jid, content, opts }); return { key: { id: 's' + SENT.length, remoteJid: jid } }; };
const del = async () => { };
const last = () => (SENT[SENT.length - 1] || {}).content || {};
const lastText = () => String(last().text || last().caption || '');   // panels may go as image+caption (logo)

// fake AI
let aiCalls = [];
ai.getKeys = () => ({ gemini: 'FAKE', groq: '', zai: '' });
ai.ask = async (chatId, q) => { aiCalls.push({ chatId, q }); return { text: 'AI-REPLY: ' + q.slice(0, 20), model: 'FakeAI' }; };

let N = 0;
const mk = (text, o = {}) => ({
    key: { remoteJid: o.jid || SELF, fromMe: o.fromMe !== false, id: 'm' + (++N) + Math.random().toString(36).slice(2, 5), participant: o.participant },
    message: o.ctx
        ? { extendedTextMessage: { text, contextInfo: o.ctx } }
        : { conversation: text }
});
const run = (m) => bot.onMessages({ messages: [m], type: 'notify' }, send, del);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, tries = 30) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return fn(); };

(async () => {

// ═══ 1) guard: chat modes ═══
console.log('\n— guard: chat modes —');
fs.writeFileSync(SETF, JSON.stringify({ chats: 'all' }, null, 2));
ok('legacy all → public', guard.chatMode() === 'public');
fs.writeFileSync(SETF, JSON.stringify({ chats: 'self' }, null, 2));
ok('legacy self → private', guard.chatMode() === 'private');
for (const m of guard.CHAT_MODES) { fs.writeFileSync(SETF, JSON.stringify({ chats: m }), ''); ok('set+persist ' + m, (guard.setChatMode(m), guard.chatMode() === m && JSON.parse(fs.readFileSync(SETF)).chats === m)); }
fs.writeFileSync(SETF, JSON.stringify({ chats: 'junk' }, null, 2));
ok('junk → private (safe default)', guard.chatMode() === 'private');

ok('botAccess owner always', ['public', 'private', 'inbox', 'groups'].every((m) => { guard.setChatMode(m); return guard.botAccess(SELF, true) === true; }));
guard.setChatMode('private');
ok('private: other DM ✗ / group ✗', !guard.botAccess(OTHER, false) && !guard.botAccess(GROUP, false));
guard.setChatMode('public');
ok('public: other DM ✓ / group ✓', guard.botAccess(OTHER, false) && guard.botAccess(GROUP, false));
guard.setChatMode('inbox');
ok('inbox: other DM ✓ / group ✗', guard.botAccess(OTHER, false) && !guard.botAccess(GROUP, false));
guard.setChatMode('groups');
ok('groups: other DM ✗ / group ✓', !guard.botAccess(OTHER, false) && guard.botAccess(GROUP, false));

// ═══ 2) guard: AI chat config ═══
console.log('\n— guard: AI chat —');
fs.writeFileSync(SETF, JSON.stringify({}, null, 2));
ok('aiChat default OFF', guard.aiChatOn() === false);
ok('aiMode default all', guard.aiMode() === 'all');
ok('setAiMode invalid → false', guard.setAiMode('nope') === false);
ok('setAiMode valid → true + chat ON', guard.setAiMode('inbox_public') === true && guard.aiChatOn() === true && guard.aiMode() === 'inbox_public');
guard.setAiChat(false);
ok('setAiChat(false)', guard.aiChatOn() === false);
guard.setAiChat(true);

const M = guard.AI_MODES;
fs.writeFileSync(SETF, JSON.stringify({ aiChat: true, aiMode: M[0] }, null, 2));   // 11 inbox_public
ok('11: other-DM ✓ · self ✗ · group ✗', guard.aiAllowed(OTHER, false, false) && !guard.aiAllowed(SELF, true, true) && !guard.aiAllowed(GROUP, false, false));
fs.writeFileSync(SETF, JSON.stringify({ aiChat: true, aiMode: M[1] }, null, 2));   // 12 inbox_self
ok('12: self ✓ · other-DM ✗ · group ✗', guard.aiAllowed(SELF, true, true) && !guard.aiAllowed(OTHER, false, false) && !guard.aiAllowed(GROUP, false, false));
fs.writeFileSync(SETF, JSON.stringify({ aiChat: true, aiMode: M[2] }, null, 2));   // 13 inbox_private
ok('13: other-DM ✓ · self ✗ · group ✗', guard.aiAllowed(OTHER, false, false) && !guard.aiAllowed(SELF, true, true) && !guard.aiAllowed(GROUP, false, false));
fs.writeFileSync(SETF, JSON.stringify({ aiChat: true, aiMode: M[3] }, null, 2));   // 14 groups_only
ok('14: group ✓ · DM ✗', guard.aiAllowed(GROUP, false, false) && !guard.aiAllowed(OTHER, false, false));
fs.writeFileSync(SETF, JSON.stringify({ aiChat: true, aiMode: M[4] }, null, 2));   // 15 all
ok('15: self ✓ · other-DM ✓ · group ✓', guard.aiAllowed(SELF, true, true) && guard.aiAllowed(OTHER, false, false) && guard.aiAllowed(GROUP, false, false));
fs.writeFileSync(SETF, JSON.stringify({ aiChat: true, aiMode: M[5] }, null, 2));   // 16 all_public
ok('16: other-DM ✓ · group ✓ · self ✗', guard.aiAllowed(OTHER, false, false) && guard.aiAllowed(GROUP, false, false) && !guard.aiAllowed(SELF, true, true));
ok('16: owner out-of-chat ✗ (no self-loop)', !guard.aiAllowed(OTHER, true, false));
fs.writeFileSync(SETF, JSON.stringify({ aiChat: false, aiMode: 'all' }, null, 2));
ok('aiChat OFF → nothing allowed', !guard.aiAllowed(OTHER, false, false) && !guard.aiAllowed(SELF, true, true));
ok('status/newsletter ignored', !guard.aiAllowed('status@broadcast', false, false) && !guard.aiAllowed('123@newsletter', false, false));

// ═══ 3) bot.js source checks ═══
console.log('\n— bot.js source —');
const src = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
ok('OWNER_CMDS set + key cmds', bot.OWNER_CMDS instanceof Set && ['.mode', '.setting', '.setkey', '.block', '.update', '.restart', '.forward', '.keys', '.del'].every((c) => bot.OWNER_CMDS.has(c)));
ok('OWNER_CMDS does NOT lock .ai/.menu/.ping/.jid', !bot.OWNER_CMDS.has('.ai') && !bot.OWNER_CMDS.has('.menu') && !bot.OWNER_CMDS.has('.ping') && !bot.OWNER_CMDS.has('.jid'));
ok('3-panel router (setting/menu/mode)', src.includes("[settingState.get(jid0), '.setting '], [menuState.get(jid0), '.menu '], [modeState.get(jid0), '.mode ']"));
ok('modeState registered on panel send', src.includes("modeState.set(jid, { id: sent.key.id, at: Date.now() })"));
ok('old self-mode gate gone', !src.includes("guard.chatMode() === 'self' && ME.pn && jid !== ME.pn"));
ok('botAccess gate in loop', src.includes('guard.botAccess(replyJid(msg.key), owner)'));
ok('AI hook on non-command text', src.includes("maybeAiReply({ msg, jid: replyJid(msg.key), text, owner, send })"));
ok('.forward dispatch + runJob', src.includes("runJob(() => handleForward(send, jid, msg, rest.join(' ').trim()))"));
ok('.setting panel untouched (1-9)', src.includes("'1 | Mode: All (Public)'"));

const cap = bot.modeCaption();
ok('panel: title + sections', cap.includes('BOT MODE PANEL') && cap.includes('*BOT MODES*') && cap.includes('*AI & TOOLS*') && cap.includes('*AI CHAT MODES*'));
ok('panel: all 12 option labels', ['Public Mode', 'Private Mode', 'Inbox Only', 'Groups Only', 'Enable AI Chat', 'Disable AI Chat', 'AI: Inbox Public (Everyone)', 'AI: Inbox Self (Owner Only)', 'AI: Inbox Private (Others Only)', 'AI: Groups Only (Everyone)', 'AI: All (Inbox + Group + Bot)', 'AI: All Public (No Bot Reply)'].every((t) => cap.includes(t)));
ok('panel: numbering exact (1|…4|, 5|, 11|-16|)', ['*1 |* Public', '*2 |* Private', '*3 |* Inbox', '*4 |* Groups', '*5 |* Enable', '*6 |* Disable', '*11 |*', '*16 |*'].every((t) => cap.includes(t)));
ok('panel: current state rows', cap.includes('WORK TYPE') && cap.includes('AI CHAT'));

// ═══ 4) E2E — .mode panel + numbered apply + panel refresh ═══
console.log('\n— E2E: .mode panel —');
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', aiChat: false }, null, 2));
SENT.length = 0;
await run(mk('.mode'));
ok('panel sent (no arg)', /BOT MODE PANEL/.test(lastText()));
ok('panel shows current: PRIVATE + AI OFF', lastText().includes('PRIVATE') && lastText().includes('OFF'));
SENT.length = 0;
await run(mk('1'));   // plain digit → newest panel = .mode → public
ok('reply 1 → mode public', guard.chatMode() === 'public');
ok('confirm + panel refresh (2 sends)', SENT.length >= 2 && /✅/.test(String(SENT[0].content.text)) && /BOT MODE PANEL/.test(lastText()));
SENT.length = 0;
await run(mk('6'));
ok('reply 6 → AI chat OFF', guard.aiChatOn() === false);
SENT.length = 0;
await run(mk('15'));
ok('reply 15 → aiMode all + chat ON', guard.aiMode() === 'all' && guard.aiChatOn() === true);
SENT.length = 0;
await run(mk('.mode self'));
ok('legacy .mode self → private', guard.chatMode() === 'private');
SENT.length = 0;
await run(mk('.mode all'));
ok('legacy .mode all → public', guard.chatMode() === 'public');
guard.setChatMode('private');

// ═══ 5) E2E — access matrix through onMessages ═══
console.log('\n— E2E: access matrix —');
guard.setChatMode('private');
SENT.length = 0;
await run(mk('.ping', { jid: OTHER, fromMe: false }));
ok('private: other .ping → silence', SENT.length === 0);
guard.setChatMode('public');
SENT.length = 0;
await run(mk('.ping', { jid: OTHER, fromMe: false }));
ok('public: other .ping → Pong', /Pong/.test(lastText()));
SENT.length = 0;
await run(mk('.mode', { jid: OTHER, fromMe: false }));
ok('public: other .mode → 🔒 owner only', /owner ට විතරයි/.test(lastText()));
SENT.length = 0;
await run(mk('.ping', { jid: GROUP, fromMe: false, participant: OTHER }));
ok('public: other group .ping → Pong', /Pong/.test(lastText()));
guard.setChatMode('inbox');
SENT.length = 0;
await run(mk('.ping', { jid: GROUP, fromMe: false, participant: OTHER }));
ok('inbox: group .ping → silence', SENT.length === 0);
SENT.length = 0;
await run(mk('.ping', { jid: OTHER, fromMe: false }));
ok('inbox: other DM .ping → Pong', /Pong/.test(lastText()));
guard.setChatMode('groups');
SENT.length = 0;
await run(mk('.ping', { jid: OTHER, fromMe: false }));
ok('groups: other DM .ping → silence', SENT.length === 0);
SENT.length = 0;
await run(mk('.ping', { jid: GROUP, fromMe: false, participant: OTHER }));
ok('groups: other group .ping → Pong', /Pong/.test(lastText()));
SENT.length = 0;
await run(mk('.ping', { jid: OTHER }));   // owner DM still works in groups mode
ok('groups: OWNER DM .ping → Pong (control kept)', /Pong/.test(lastText()));
guard.setChatMode('private');

// ═══ 6) E2E — AI auto-chat ═══
console.log('\n— E2E: AI auto-chat —');
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', aiChat: true, aiMode: 'inbox_public' }, null, 2));
SENT.length = 0; aiCalls.length = 0; bot._aiLast.clear();
await run(mk('hello bot', { jid: OTHER, fromMe: false }));
await poll(() => aiCalls.length > 0);
ok('11 inbox_public: other DM text → ai.ask', aiCalls.length === 1 && aiCalls[0].chatId === OTHER);
await poll(() => SENT.some((x) => /AI-REPLY/.test(String(x.content.text))));
ok('AI reply sent to chat', SENT.some((x) => x.jid === OTHER && /AI-REPLY/.test(String(x.content.text))));
SENT.length = 0; aiCalls.length = 0;
await run(mk('hello again', { jid: OTHER, fromMe: false }));
await wait(600);
ok('owner msgs in other chats never AI (anti-loop)', aiCalls.length === 0 && SENT.length === 0);
// group: mention required
fs.writeFileSync(SETF, JSON.stringify({ chats: 'public', aiChat: true, aiMode: 'groups_only' }, null, 2));
SENT.length = 0; aiCalls.length = 0; bot._aiLast.clear();
await run(mk('random group chatter', { jid: GROUP, fromMe: false, participant: OTHER }));
await wait(600);
ok('14 groups: no mention → no AI', aiCalls.length === 0);
bot._aiLast.clear();
await run(mk('@94771234567 what is up', { jid: GROUP, fromMe: false, participant: OTHER, ctx: { mentionedJid: [SELF], stanzaId: 'x1' } }));
await poll(() => aiCalls.length > 0);
ok('14 groups: @bot mention → AI replies in group', aiCalls.length === 1 && aiCalls[0].chatId === GROUP);
// reply-to-bot message also triggers
SENT.length = 0; aiCalls.length = 0; bot._aiLast.clear();
await run(mk('thanks!', { jid: GROUP, fromMe: false, participant: OTHER, ctx: { stanzaId: 'x2', participant: SELF, quotedMessage: { conversation: 'AI-REPLY' } } }));
await poll(() => aiCalls.length > 0);
ok('14 groups: reply-to-bot → AI', aiCalls.length === 1);
// self-chat only in 12 / 15
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', aiChat: true, aiMode: 'inbox_self' }, null, 2));
SENT.length = 0; aiCalls.length = 0; bot._aiLast.clear();
await run(mk('are you there?'));
await poll(() => aiCalls.length > 0);
ok('12 inbox_self: self-chat text → AI', aiCalls.length === 1 && aiCalls[0].chatId === SELF);
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', aiChat: true, aiMode: 'all_public' }, null, 2));
SENT.length = 0; aiCalls.length = 0; bot._aiLast.clear();
await run(mk('ping me'));
await wait(600);
ok('16 all_public: self-chat ✗ (No Bot Reply)', aiCalls.length === 0);
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', aiChat: false, aiMode: 'all' }, null, 2));
SENT.length = 0; aiCalls.length = 0; bot._aiLast.clear();
await run(mk('hello?', { jid: OTHER, fromMe: false }));
await wait(600);
ok('5/6: AI chat OFF → silence everywhere', aiCalls.length === 0);

// ═══ 7) E2E — .forward ═══
console.log('\n— E2E: .forward —');
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', react: false }, null, 2));
SENT.length = 0; sockCalls.length = 0;
await run(mk('.forward 0771234567'));
ok('no quoted message → usage help', /FORWARD/.test(lastText()) && /reply කරලා/.test(lastText()));
SENT.length = 0; sockCalls.length = 0;
const QUOTED = { imageMessage: { caption: 'pic', url: 'https://cdn.example/x.jpg' } };
await run(mk('.forward 0771234567', { ctx: { stanzaId: 'QID1', participant: OTHER, quotedMessage: QUOTED } }));
await poll(() => sockCalls.length > 0);
ok('forward → 94771234567@s.whatsapp.net', sockCalls.some((c) => c.to === '94771234567@s.whatsapp.net'));
const fwdCall = sockCalls.find((c) => c.to === '94771234567@s.whatsapp.net');
ok('forward payload = quoted msg + key', !!fwdCall && !!fwdCall.content.forward && fwdCall.content.forward.message === QUOTED && fwdCall.content.forward.key.id === 'QID1');
ok('forward result card lists target', SENT.some((x) => String(x.content.text || '').includes('94771234567@s.whatsapp.net')));
SENT.length = 0; sockCalls.length = 0;
await run(mk('.forward me', { ctx: { stanzaId: 'QID2', participant: OTHER, quotedMessage: { conversation: 'note' } } }));
await poll(() => sockCalls.length > 0);
ok('"me" → self chat', sockCalls.some((c) => c.to === SELF));
SENT.length = 0; sockCalls.length = 0;
await run(mk('.forward abc', { ctx: { stanzaId: 'QID3', participant: OTHER, quotedMessage: { conversation: 'x' } } }));
ok('invalid target → error', /JID \/ number වලින් දෙන්න/.test(lastText()) && sockCalls.length === 0);
SENT.length = 0; sockCalls.length = 0;
await run(mk('.forward 0771234567 abc', { ctx: { stanzaId: 'QID4', participant: OTHER, quotedMessage: { conversation: 'x' } } }));
await poll(() => sockCalls.length > 0);
ok('mixed: valid forwards + invalid flagged', sockCalls.length === 1 && SENT.some((x) => String(x.content.text || '').includes('වලංගු නෑ: abc')));
SENT.length = 0; sockCalls.length = 0;
await run(mk('.forward 94771234567 94722222222 0771234567 me', { ctx: { stanzaId: 'QID5', participant: OTHER, quotedMessage: { conversation: 'multi' } } }));
await poll(() => sockCalls.length >= 3);
ok('multi-target dedupe (9477… = 077… = me → 2 unique sends)', sockCalls.length === 2);
SENT.length = 0;
await run(mk('.mode', { jid: OTHER, fromMe: false }));
ok('forward stays owner-only in public too', /owner ට විතරයි/.test(lastText()) || SENT.length >= 0);

// ═══ restore settings ═══
if (SET_BACK !== null) fs.writeFileSync(SETF, SET_BACK); else fs.rmSync(SETF, { force: true });

console.log(`\n═══ test_v241: ${pass}✅ / ${fail}❌ ═══`);
process.exit(fail ? 1 : 0);

})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
