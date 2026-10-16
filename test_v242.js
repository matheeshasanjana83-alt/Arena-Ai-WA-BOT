/* test_v242 — .forward REWRITE + .jid upgrade (offline)
   • THE v2.41 bug: contextInfo read raw → ephemeral/viewOnce/edited wrapped replies missed → usage text
   • v2.42: unwrapCtx() (getText-style) + nova-md proven forward shape + force:true + safe edit fallback
   • targets: +94 / dashed / wa.me link / @g.us / @lid / me / dedupe / ≤5 / bad-flag / per-target errors
   • .jid: chat + 👤 sender + 🧾 msg id (ctxInfo unwrap reuse)
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

const bot = require('./bot');
const features = require('./features');

// settings isolation
fs.writeFileSync(SETF, JSON.stringify({ chats: 'private', react: false, autoUpdate: false }, null, 2));

const SELF = '94771234567@s.whatsapp.net';
const OTHER = '94711111111@s.whatsapp.net';
bot.ME.pn = SELF; bot.ME.lid = null;

let THROW_FOR = new Set();       // sock jids that must throw
let EDIT_THROW = false;          // send(edit) throws → fallback path
const sockCalls = [];
const FAKE_SOCK = {
    sendMessage: async (to, content) => {
        sockCalls.push({ to, content });
        if (THROW_FOR.has(to)) throw new Error('item-not-found (fake)');
        return { key: { id: 'sk' + sockCalls.length, remoteJid: to } };
    },
    user: { id: SELF }
};
bot._setSock(FAKE_SOCK);

const SENT = [];
const send = async (jid, content, opts) => {
    if (EDIT_THROW && content.edit) throw new Error('edit fail (fake)');
    SENT.push({ jid, content, opts });
    return { key: { id: 's' + SENT.length, remoteJid: jid } };
};
const last = () => (SENT[SENT.length - 1] || {}).content || {};
const lastText = () => String(last().text || last().caption || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, tries = 30) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return fn(); };
const reset = () => { SENT.length = 0; sockCalls.length = 0; THROW_FOR = new Set(); EDIT_THROW = false; };

let N = 0;
const mk = (text, o = {}) => ({
    key: { remoteJid: o.jid || SELF, fromMe: o.fromMe !== false, id: 'm' + (++N) + Math.random().toString(36).slice(2, 5), participant: o.participant },
    ...(o.raw ? { message: o.raw } : o.ctx
        ? { message: { extendedTextMessage: { text, contextInfo: o.ctx } } }
        : { message: { conversation: text } })
});
const ctx = (extra = {}) => ({ stanzaId: 'QID' + (++N), participant: OTHER, quotedMessage: { conversation: 'fwd me' }, ...extra });
const run = (m) => bot.onMessages({ messages: [m], type: 'notify' }, send, async () => { });

(async () => {

    // ═══ 1) THE BUG — wrapped replies (v2.41 missed these) ═══
    console.log('\n— wrapper unwrap (THE v2.41 bug) —');
    reset();
    await run(mk('.forward 0771234567', { raw: { ephemeralMessage: { message: { extendedTextMessage: { text: '.forward 0771234567', contextInfo: ctx({ stanzaId: 'EPH1' }) } } } } }));
    ok('ephemeral-wrapped reply → forwards (v2.41 sent usage instead)', await poll(() => sockCalls.some((c) => c.to === '94771234567@s.whatsapp.net' && c.content && c.content.forward)));
    const eph = sockCalls.find((c) => c.content && c.content.forward);
    ok('ephemeral fwd keeps stanzaId + participant', !!eph && eph.content.forward.key.id === 'EPH1' && eph.content.forward.key.participant === OTHER);
    ok('ephemeral fwd keeps quoted content', !!eph && eph.content.forward.message.conversation === 'fwd me');

    reset();
    await run(mk('.forward 0771234567', { raw: { viewOnceMessageV2: { message: { extendedTextMessage: { text: '.forward 0771234567', contextInfo: ctx({ stanzaId: 'VO1' }) } } } } }));
    ok('viewOnceV2-wrapped reply → forwards', await poll(() => sockCalls.some((c) => c.content.forward && c.content.forward.key.id === 'VO1')));

    reset();
    await run(mk('.forward 0771234567', { raw: { deviceSentMessage: { message: { extendedTextMessage: { text: '.forward 0771234567', contextInfo: ctx({ stanzaId: 'DS1' }) } } } } }));
    ok('deviceSent-wrapped reply → forwards', await poll(() => sockCalls.some((c) => c.content.forward && c.content.forward.key.id === 'DS1')));

    reset();
    await run(mk('.forward 0771234567', { raw: { editedMessage: { message: { extendedTextMessage: { text: '.forward 0771234567', contextInfo: ctx({ stanzaId: 'ED1' }) } } } } }));
    ok('edited-wrapped reply → forwards', await poll(() => sockCalls.some((c) => c.content.forward && c.content.forward.key.id === 'ED1')));

    // ═══ 2) plain reply — proven forward shape ═══
    console.log('\n— forward shape —');
    reset();
    const QUOTED = { imageMessage: { caption: 'pic', url: 'https://cdn.example/x.jpg' } };
    await run(mk('.forward 0771234567', { ctx: { stanzaId: 'QID1', participant: OTHER, quotedMessage: QUOTED } }));
    const f1 = sockCalls.find((c) => c.content && c.content.forward) || null;   // run() awaits runJob → forward already done
    ok('plain reply → forwards', !!f1 && f1.to === '94771234567@s.whatsapp.net');
    ok('nova-md shape: {key:{remoteJid, id: stanzaId, participant}, message}', !!f1 && !!f1.content.forward && f1.content.forward.key.remoteJid === SELF && f1.content.forward.key.id === 'QID1' && f1.content.forward.key.participant === OTHER && f1.content.forward.message === QUOTED);
    ok('force: true → Forwarded label always', !!f1 && f1.content.force === true);
    ok('result card ✅ target', SENT.some((x) => String(x.content.text || '').includes('✅ 94771234567@s.whatsapp.net')));

    // ═══ 3) target formats ═══
    console.log('\n— target formats —');
    reset();
    await run(mk('.forward +94772345678 077-123-4567', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 2);
    ok('+94 → 94772345678@s.whatsapp.net', sockCalls.some((c) => c.to === '94772345678@s.whatsapp.net'));
    ok('dashed 077-123-4567 → 94771234567@s.whatsapp.net', sockCalls.some((c) => c.to === '94771234567@s.whatsapp.net'));

    reset();
    await run(mk('.forward https://wa.me/94779876543', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 1);
    ok('wa.me link → 94779876543@s.whatsapp.net', sockCalls.some((c) => c.to === '94779876543@s.whatsapp.net'));

    reset();
    const G = '12036302XXXX@g.us', L = '994433221100@lid';
    await run(mk(`.forward ${G} ${L}`, { ctx: ctx() }));
    await poll(() => sockCalls.length >= 2);
    ok('@g.us passthrough', sockCalls.some((c) => c.to === G));
    ok('@lid passthrough', sockCalls.some((c) => c.to === L));

    reset();
    await run(mk('.forward me', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 1);
    ok('"me" → self chat', sockCalls.some((c) => c.to === SELF));

    // ═══ 4) dedupe + caps + errors ═══
    console.log('\n— dedupe / caps / errors —');
    reset();
    await run(mk('.forward 0771234567 94771234567 +94771234567', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 1);
    await wait(100);
    ok('dedupe after normalize (3 forms → 1 send)', sockCalls.length === 1);

    reset();
    await run(mk('.forward 94771111111 94772222222 94773333333 94774444444 94775555555 94776666666 94777777777', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 5);
    await wait(100);
    ok('>5 targets → capped at 5', sockCalls.length === 5);
    await poll(() => SENT.some((x) => String(x.content.text || '').includes('skip කළා')));   // card after 5×600ms loop
    ok('overflow flagged (ℹ️ skip note)', SENT.some((x) => String(x.content.text || '').includes('ℹ️ ඉතුරු 2 ක් skip කළා')));

    reset();
    await run(mk('.forward abc', { ctx: ctx() }));
    ok('all-invalid → error, zero sends', /JID \/ number වලින් දෙන්න/.test(lastText()) && sockCalls.length === 0);

    reset();
    await run(mk('.forward', { ctx: ctx() }));
    ok('no arg → target error', /target JID \/ number/.test(lastText()) && sockCalls.length === 0);

    reset();
    await run(mk('.forward 0771234567'));
    ok('no reply → usage help', /FORWARD/.test(lastText()) && /reply කරලා/.test(lastText()) && sockCalls.length === 0);

    reset();
    THROW_FOR = new Set(['94771111111@s.whatsapp.net']);
    await run(mk('.forward 94771111111 94772222222', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 2);
    await wait(100);
    const cardTxt = SENT.map((x) => String(x.content.text || '')).find((t) => t.includes('❌'));
    ok('per-target error → ❌ + other still ✅', !!cardTxt && /❌ 94771111111@s\.whatsapp\.net — item-not-found/.test(cardTxt) && cardTxt.includes('✅ 94772222222@s.whatsapp.net'));

    // ═══ 5) edit-fail → fallback card ═══
    console.log('\n— edit fallback —');
    reset();
    EDIT_THROW = true;
    await run(mk('.forward 0771234567', { ctx: ctx() }));
    await poll(() => sockCalls.length >= 1);
    await wait(100);
    ok('edit throws → plain result card still sent', SENT.filter((x) => String(x.content.text || '').includes('✅ 94771234567@s.whatsapp.net') && !x.content.edit).length === 1);
    EDIT_THROW = false;

    // ═══ 6) .jid upgrade ═══
    console.log('\n— .jid —');
    reset();
    const fsend = async (j, c) => { SENT.push({ jid: j, content: c }); return { key: { id: 'f' + SENT.length, remoteJid: j } }; };
    await features.handle('.jid', { send: fsend, jid: SELF, msg: mk('x', { ctx: { stanzaId: 'MID9', participant: OTHER, quotedMessage: { conversation: 'q' } } }), rest: [], sock: FAKE_SOCK, me: bot.ME, react: async () => { } });
    ok('.jid plain reply → Chat + 👤 sender + 🧾 msg id', /Chat/.test(lastText()) && lastText().includes('👤 ' + OTHER) && lastText().includes('🧾 MID9'));

    reset();
    await features.handle('.jid', { send: fsend, jid: SELF, msg: mk('x', { raw: { ephemeralMessage: { message: { extendedTextMessage: { text: '.jid', contextInfo: { stanzaId: 'WMID', participant: OTHER, quotedMessage: { conversation: 'q' } } } } } } }), rest: [], sock: FAKE_SOCK, me: bot.ME, react: async () => { } });
    ok('.jid ephemeral-wrapped reply → still shows 👤 (unwrap)', lastText().includes('👤 ' + OTHER) && lastText().includes('🧾 WMID'));

    reset();
    await features.handle('.jid', { send: fsend, jid: SELF, msg: mk('.jid'), rest: [], sock: FAKE_SOCK, me: bot.ME, react: async () => { } });
    ok('.jid no-reply → chat jid only', /^🆔 \*Chat:\* /.test(lastText()) && !lastText().includes('👤'));

    // ═══ done ═══
    console.log(`\n════════ test_v242: ${pass} pass / ${fail} fail ════════`);
    if (SET_BACK !== null) fs.writeFileSync(SETF, SET_BACK);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); if (SET_BACK !== null) fs.writeFileSync(SETF, SET_BACK); process.exit(1); });
