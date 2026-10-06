// ── Panel (Pterodactyl: HeavenCloud etc.) support ── must run before anything uses os.tmpdir()
{
    const _fs = require('fs'), _path = require('path');
    const onPanel = !!process.env.P_SERVER_UUID || process.cwd() === '/home/container' || process.env.ARENA_PANEL === '1';
    if (onPanel && !process.env.DL_TMP) {
        const t = _path.join(__dirname, '.tmp');           // container /tmp is a tiny tmpfs → use server disk
        try { _fs.rmSync(t, { recursive: true, force: true }); } catch { }
        _fs.mkdirSync(t, { recursive: true });
        process.env.TMPDIR = t; process.env.TMP = t; process.env.DL_TMP = t;
    }
    let _maxMB = ''; try { _maxMB = String(JSON.parse(_fs.readFileSync(_path.join(__dirname, 'settings.json'), 'utf8')).maxMB || ''); } catch { }
    if (!process.env.DL_MAX_MB && /^\d+$/.test(_maxMB)) process.env.DL_MAX_MB = _maxMB;   // settings.json {"maxMB": 2000}
    if (onPanel && !process.env.DL_MAX_MB) process.env.DL_MAX_MB = '350';   // small free panels: file + encrypted copy
    process.env.ARENA_ON_PANEL = onPanel ? '1' : '';
}
/**
 * Arena AI — private WhatsApp bot:  .ai <question>  +  .download <link> [link2 ...]
 * Works only for YOU (messages you send). Others are ignored silently.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pino = require('pino');
// Baileys v7 (ESM-only) — LID support. v6 could not decrypt LID-addressed messages (Bad MAC) and sent ACKs that WhatsApp bans.
let B = null;
const loadBaileys = async () => (B ||= await import('baileys'));
const { download, human, MAX_BYTES } = require('./downloader');
const ai = require('./ai');
const updater = require('./updater');
const netx = require('./net');
const guard = require('./guard');
const features = require('./features');
const tools = require('./tools');

const AUTH = path.join(__dirname, 'auth');
const LOGO = path.join(__dirname, 'logo.img');        // your own photo (.setlogo) — never touched by .update
const BANNER = path.join(__dirname, 'banner.jpg');    // default Arena AI banner
const ANNOUNCE_NEXT = path.join(__dirname, '.announce-next');
let SOCK = null;
const sentIds = new Set();
const msgStore = new Map();          // recent messages → getMessage() for retry requests ("Waiting for this message" fix)
const seen = new Set();              // processed message ids (dedupe notify/append)
const STARTED = Math.floor(Date.now() / 1000);
let announced = false;
const ME = { pn: null, lid: null };
function saveSettingsPhone(num) {
    const f = require('path').join(__dirname, 'settings.json');
    try { let d = {}; try { d = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch { } if (d.phone !== num) { d.phone = num; require('fs').writeFileSync(f, JSON.stringify(d, null, 2)); } } catch { }
}
function readSettingsPhone() { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'settings.json'), 'utf8')).phone || ''; } catch { return ''; } }   // our own JIDs (set on connect)

// strip device part:  "9476xxxx:12@s.whatsapp.net" → "9476xxxx@s.whatsapp.net"
const bareJid = (j) => { if (!j) return j; const [u, srv] = String(j).split('@'); return u.split(':')[0] + '@' + srv; };

/**
 * Where to send replies.  Baileys v7 gives self-chat messages a DEVICE / LID jid as remoteJid
 * (e.g. "35189220741167:0@lid") — replying there shows "Waiting for this message" on the phone.
 * → self chat always goes to our own phone-number JID; other @lid chats use their PN alt if known.
 */
function replyJid(key) {
    const rj = key?.remoteJid || '';
    if (rj.endsWith('@g.us')) return rj;
    const b = bareJid(rj), alt = bareJid(key?.remoteJidAlt);
    const isMe = (j) => !!j && (j === ME.pn || j === ME.lid);
    if (isMe(b) || isMe(alt)) return ME.pn || (b.endsWith('@s.whatsapp.net') ? b : alt) || b;
    if (b.endsWith('@lid') && alt && alt.endsWith('@s.whatsapp.net')) return alt;
    return b;
}
const retryCache = (() => { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => { m.set(k, v); if (m.size > 1000) m.delete(m.keys().next().value); }, del: (k) => m.delete(k), flushAll: () => m.clear() }; })();
function remember(msg) {
    if (!msg?.key?.id || !msg.message) return;
    msgStore.set(msg.key.id, msg.message);
    if (msgStore.size > 500) msgStore.delete(msgStore.keys().next().value);
}
const log = (t) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] ${t}`);
let pairingAsked = false;

function ask(q) {
    console.log('\n' + q.trim() + '\n   (panel එකේ නම් "Type a command" box එකේ number එක ගහලා Enter)');   // panels hide prompts without newline
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a); }));
}

function getText(m) {
    let x = m;
    for (let i = 0; i < 5 && x; i++) {
        const inner = x.deviceSentMessage?.message || x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.documentWithCaptionMessage?.message || x.editedMessage?.message;
        if (!inner) break;
        x = inner;
    }
    return (x?.conversation || x?.extendedTextMessage?.text || x?.imageMessage?.caption || x?.documentMessage?.caption || '').trim();
}

const HELP = `🤖 *Arena AI* — ඔක්කොම commands

🎬 *.yts* <නම>  •  *.song* <නම/link>  •  *.video* <නම/link>
📱 *.tiktok*  •  *.fb*  •  *.ig*  •  *.x*  <link>
🔍 *.wiki* <මාතෘකාව>  •  🐙 *.gitclone* user/repo
🖼️ *.s* (photo/video reply)  •  *.take* Pack | Author
👥 *.groupinfo*  •  *.grouplink*  •  *.tagall*  •  *.kick*  •  *.promote*  •  *.demote*  •  *.jid*
🛠️ *.tr*  •  *.tts*  •  *.weather*  •  *.lyrics*  •  *.imagine*  •  *.toimg*  •  *.tourl*  •  *.ss*  •  *.qr*  •  *.short*  •  *.calc*  •  *.github*  •  *.del*  •  *.setpp*
🎉 *.joke*  •  *.fact*  •  *.quote*  •  *.8ball*
👥 *.mute*  •  *.unmute*  •  *.tagadmins*  •  *.resetlink*
🔄 *.restart*

*.ai <ප්‍රශ්නය>*  — AI එකෙන් අහන්න (සිංහල OK)
  • message එකකට reply කරලා *.ai* ගැහුවොත් ඒ message එක ගැන අහනවා
  • *.ai reset* — කතාව අලුතෙන් පටන් ගන්න
*.download <link>*  — file එක download කරලා එවනවා (*.dl*)
  • links කිහිපයක් එකට (5 දක්වා): .download link1 link2
*.setkey gemini <KEY>*  /  *.setkey groq <KEY>*  — free API key දාන්න
*.keys*  — keys තියෙනවද බලන්න
*.net <link>*  — download fail නම් හේතුව බලන්න (DNS / IP block)
*.setproxy <url|off>*  — block වෙන sites වලට proxy
*.update*  — bot එක GitHub එකෙන් update කරන්න (pair කරන්න ඕනේ නෑ)
*.version*  — දැන් තියෙන version එක
*.ping*  — bot එක වැඩද බලන්න
*.alive*  — bot status card එක
*.menu*  — photo menu (number reply කරලා category)
*.react on|off*  — commands වලට auto react
*.setlogo*  — photo එකකට reply කරලා ගහන්න → online card එකේ logo එක
*.mode self|all*  — commands වැඩ කරන chats (default: Message yourself විතරයි)

🔒 Commands පාවිච්චි කරන්න පුළුවන් *ඔයාට විතරයි*  •  🛡️ Anti-ban ON

📥 Download support: direct links, GitHub, Google Drive, MediaFire, MEGA, Dropbox, Pixeldrain, litterbox/catbox, x0.at, filebin...
📏 Max: ${human(MAX_BYTES)} per file`;

let botStatus = 'starting';
if (process.env.SERVER_PORT || process.env.ARENA_ON_PANEL) {
    try {
        require('http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ bot: 'Arena AI', status: botStatus, uptime: Math.floor(process.uptime()) })); })
            .on('error', () => { }).listen(parseInt(process.env.SERVER_PORT || '3000', 10), '0.0.0.0');
    } catch { }
}
const pace = guard.pacer();
let reconnects = 0, replaced = 0;
async function start() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = await loadBaileys();
    fs.mkdirSync(AUTH, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch { version = [2, 3000, 1043857760]; }
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
        version, logger,
        browser: Browsers.macOS('Chrome'),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        msgRetryCounterCache: retryCache,
        getMessage: async (key) => msgStore.get(key?.id),
    });
    SOCK = sock;
    sock.ev.on('creds.update', saveCreds);

    const send = async (jid, content, opts) => {
        const s = await pace(() => sock.sendMessage(jid, content, opts));   // 🛡️ one message at a time, human-like gap
        if (s?.key?.id) { sentIds.add(s.key.id); if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value); remember(s); }
        return s;
    };

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !sock.authState.creds.registered && !pairingAsked) {
            pairingAsked = true;
            let num = String(process.env.WA_PHONE_NUMBER || readSettingsPhone() || '').replace(/\D/g, '');
            if (!num) num = String(await ask('📱 ඔයාගේ WhatsApp number එක (උදා 94771234567): ')).replace(/\D/g, '');
            if (num.startsWith('0')) num = '94' + num.slice(1);
            if (num.length < 9 || num.length > 15) { log(`❌ "${num}" හරි number එකක් නෙවෙයි (උදා 94771234567). Restart කරලා ආයෙත් ගහන්න.`); pairingAsked = false; return; }
            saveSettingsPhone(num);   // reconnects / expired codes → new code automatically, no retyping
            log(`⏳ ${num} එකට pairing code එකක් ඉල්ලනවා...`);
            try {
                let code;
                for (let i = 0; i < 3 && !code; i++) {
                    try { code = await sock.requestPairingCode(num); }
                    catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 3000)); }
                }
                code = code.match(/.{1,4}/g).join('-');
                console.log('\n════════════════════════════════════');
                console.log(`   🔢 PAIRING CODE:  ${code}`);
                console.log('════════════════════════════════════');
                console.log('WhatsApp → Linked devices → Link a device →');
                console.log('"Link with phone number instead" → මේ code එක ගහන්න\n');
                console.log('⏳ Code එක ගහනකම් ඉන්නවා (විනාඩියකින් expire වුණොත් අලුත් code එකක් auto එනවා)\n');
            } catch (e) { log(`❌ Pairing code fail: ${e.message} (code ${e?.output?.statusCode ?? '?'})`); pairingAsked = false; }
        }
        if (connection) botStatus = connection;
        if (connection === 'open') {
            ME.pn = bareJid(sock.user?.id); ME.lid = bareJid(sock.user?.lid);
            log(`👤 me: ${ME.pn}${ME.lid ? '  /  ' + ME.lid : ''}`);
            log('✅ WhatsApp Connected! "Message yourself" chat එකේ .ping ගහලා බලන්න');
            reconnects = 0; replaced = 0;
            if (announced) return;
            announced = true;
            const afterUpdate = fs.existsSync(ANNOUNCE_NEXT); fs.rmSync(ANNOUNCE_NEXT, { force: true });
            if (guard.shouldAnnounce() || afterUpdate) { try { await sendAlive(send, ME.pn, null, afterUpdate ? 'updated' : 'online'); } catch (e) { log('alive: ' + e.message); } }   // 🛡️ max once / 6h (+ after .update)
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                log('❌ Logged out (device එක unlink කළා). Session එක මකලා නවත්තනවා — ආයෙත් npm start කරලා pair කරන්න.');
                fs.rmSync(AUTH, { recursive: true, force: true });
                process.exit(0);
            }
            if (code === 403) {   // 🛡️ banned / blocked — don't keep hammering WhatsApp
                log('🚫 WhatsApp මේ number එක block/restrict කරලා (403). Bot එක නවත්තනවා — ආයෙත් connect වෙන්න try කරන්නේ නෑ (ban එක දිග් වෙන්න පුළුවන් නිසා). WhatsApp app එක check කරන්න.');
                process.exit(0);
            }
            if (code === DisconnectReason.connectionReplaced) {   // 440 — another bot/session uses the SAME login
                replaced++;
                if (replaced >= 3) { log('🛑 වෙන තැනක (Termux / වෙන panel එකක්) මේ bot එකම run වෙනවා. Instances දෙකක් එකට run කළොත් ban වෙන්න පුළුවන් — මේක නවත්තනවා. එකක් විතරක් run කරන්න.'); process.exit(0); }
                log(`⚠️ වෙන තැනක මේ session එකෙන්ම bot එකක් connect වුණා (440) — විනාඩි 2 කින් ආයෙත් බලනවා (${replaced}/3)`);
                return setTimeout(() => start().catch(e => log('start error: ' + e.message)), 120000);
            }
            pairingAsked = code === 515 ? pairingAsked : false;
            const wait = code === 515 ? 2000 : guard.backoff(reconnects++);   // 🛡️ backoff: 3s, 6s, 12s ... max 5min
            log(`⚠️ Connection වැහුණා (${code ?? '?'}) — තත්පර ${Math.round(wait / 1000)} කින් ආයෙත් connect වෙනවා...`);
            setTimeout(() => start().catch(e => log('start error: ' + e.message)), wait);
        }
    });

    sock.ev.on('messages.upsert', (u) => onMessages(u, send, (key) => sock.sendMessage(key.remoteJid, { delete: key }).catch(() => { })));
}

async function onMessages({ messages, type }, send, del = async () => { }) {
        for (const msg of messages || []) {
            try {
                remember(msg);
                if (msg.key?.fromMe && !msg.message && msg.messageStubType) log(`⚠️ message එකක් decrypt කරගන්න බැරි වුණා (stub ${msg.messageStubType}) — phone එකෙන් ආයෙත් එවයි`);
                if (!msg.message || msg.key?.fromMe !== true) continue;        // 🔒 PRIVATE: only messages YOU send
                if (guard.ignoredChat(msg.key.remoteJid)) continue;              // status / channels / broadcast
                if (!isFromOwner(msg.key)) continue;                              // 🔒 double check the sender
                if (sentIds.has(msg.key.id) || seen.has(msg.key.id)) continue; // own replies / already handled
                const ts = Number(msg.messageTimestamp || 0);
                if (type !== 'notify' && ts && ts < STARTED - 60) continue;   // old history — don't re-run old commands
                seen.add(msg.key.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
                let text = getText(msg.message);
                if (/^\d{1,2}$/.test(text)) {                                   // number reply to .menu → category
                    const st = menuState.get(replyJid(msg.key)), qid = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
                    if (st && (qid ? qid === st.id : Date.now() - st.at < 180e3)) text = '.menu ' + text;
                }
                if (!text.startsWith('.')) continue;
                const jid = replyJid(msg.key);
                const c0 = text.split(/\s+/)[0].toLowerCase();
                const groupOk = (jid.endsWith('@g.us') && features.GROUP_CMDS.includes(c0)) || c0 === '.del' || c0 === '.delete';   // group tools work in groups, .del anywhere
                if (guard.chatMode() === 'self' && ME.pn && jid !== ME.pn && !groupOk) continue;   // 🔒 default: "Message yourself" chat only (.mode all)
                const rl = guard.rateCheck();
                if (!rl.ok) {                                                     // 🛡️ anti-ban rate limit
                    log(`⏳ rate limit — command ignore කළා (${rl.wait}s)`);
                    if (rl.warn) await send(jid, { text: `⏳ Commands ගොඩක් ඉක්මනට ආවා (ban වෙන එක වළක්වන්න). තත්පර ${rl.wait} කින් ආයෙත් ගහන්න.` });
                    continue;
                }
                await guard.humanDelay();
                if (reactOn()) { try { await send(jid, { react: { text: REACTS[Math.floor(Math.random() * REACTS.length)], key: msg.key } }); } catch { } }   // ✨ auto react
                log(`📩 command: ${guard.maskLog(text.slice(0, 60))}  (${type})  ${msg.key.remoteJid}${jid !== msg.key.remoteJid ? ' → ' + jid : ''}`);
                msg.key = { ...msg.key, remoteJid: jid };   // quote/delete with the normalized chat jid too
                const [cmd, ...rest] = text.split(/\s+/);
                const c = cmd.toLowerCase();

                if (c === '.alive' || c === '.status') { await sendAlive(send, jid, msg, 'alive'); continue; }
                if (c === '.setlogo') { await handleSetLogo(send, jid, msg); continue; }
                if (c === '.dellogo') { fs.rmSync(LOGO, { force: true }); await send(jid, { text: '🗑️ Logo එක අයින් කළා — default Arena AI banner එක පාවිච්චි වෙනවා' }, { quoted: msg }); continue; }
                if (c === '.mode') { await handleMode(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.ping') { await send(jid, { text: '🏓 Pong! Arena AI වැඩ ✅' }, { quoted: msg }); continue; }
                if (c === '.menu') { await handleMenu(send, jid, msg, rest[0]); continue; }
                if (c === '.help' || c === '.commands') { await send(jid, { text: HELP }, { quoted: msg }); continue; }
                if (c === '.react') { await handleReact(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.ai' || c === '.ask' || c === '.gpt') { await handleAI(send, jid, msg, rest.join(' ')); continue; }
                if (c === '.setkey' || c === '.delkey') { await handleKey(send, del, jid, msg, c, rest); continue; }
                if (c === '.update') { await handleUpdate(send, jid, msg, rest[0] === 'force'); continue; }
                if (c === '.version') {
                    const cur = updater.localInfo();
                    let t = `🤖 *Arena AI* v${cur.version}${cur.sha ? ' (' + cur.sha.slice(0, 7) + ')' : ''}`;
                    try { const ch = await updater.check(); t += ch.upToDate ? '\n✅ අලුත්ම version එක' : `\n🆕 Update එකක් තියෙනවා: v${ch.latest.manifest.version}\n➡️ *.update* ගහන්න`; } catch (e) { t += '\n(update check fail: ' + e.message + ')'; }
                    await send(jid, { text: t }, { quoted: msg }); continue;
                }
                if (c === '.net' || c === '.netcheck') {
                    const u = (text.match(/https?:\/\/\S+/) || [])[0];
                    if (!u) { await send(jid, { text: '🔧 *.net <link>* — මේ server එකෙන් ඒ site එකට යන්න පුළුවන්ද බලනවා (DNS / IP block)' }, { quoted: msg }); continue; }
                    const st = await send(jid, { text: '🔧 Network check කරනවා... (තත්පර 30 ක් විතර)' }, { quoted: msg });
                    let rep; try { rep = await netx.diagnose(u); } catch (e) { rep = '❌ ' + e.message; }
                    await send(jid, { text: '🔧 *Network check*\n\n' + rep, edit: st.key }); continue;
                }
                if (c === '.setproxy') { await handleProxy(send, del, jid, msg, rest.join(' ').trim()); continue; }
                if (c === '.keys') { const k = ai.getKeys(); await send(jid, { text: `🔑 *API keys*\nGemini: ${k.gemini ? '✅ ' + mask(k.gemini) : '❌ නෑ'}\nGroq: ${k.groq ? '✅ ' + mask(k.groq) : '❌ නෑ'}` }, { quoted: msg }); continue; }
                if (c === '.restart') { await send(jid, { text: '🔄 Restart වෙනවා... තත්පර 10 කින් *.ping*' }, { quoted: msg }); setTimeout(() => process.exit(process.env.ARENA_LAUNCHER ? 100 : 0), 1500); continue; }
                if (await tools.handle(c, { send, jid, msg, rest, sock: SOCK, me: ME })) continue;
                if (await features.handle(c, { send, jid, msg, rest, sock: SOCK, me: ME, download })) continue;
                if (!['.download', '.dl', '.dn'].includes(c)) continue;

                const links = (text.match(/https?:\/\/\S+/g) || []).slice(0, 5);   // 🛡️ max 5 per command
                if (!links.length) { await send(jid, { text: HELP }, { quoted: msg }); continue; }
                for (const link of links) await dlQueue(() => handleDownload(send, jid, msg, link));   // one download at a time
            } catch (e) { log('handler error: ' + e.message); }
        }
}

/** 🔒 sender must be US (pn or lid) — extra safety on top of fromMe */
function isFromOwner(key) {
    const p = key?.participant, pa = key?.participantAlt;
    if (!p && !pa) return true;                          // 1:1 / self chat → fromMe is enough
    if (!ME.pn && !ME.lid) return true;                  // not connected yet (tests)
    const mine = (j) => !!j && (bareJid(j) === ME.pn || bareJid(j) === ME.lid);
    return mine(p) || mine(pa);
}

let dlChain = Promise.resolve();
function dlQueue(fn) { const p = dlChain.then(fn, fn); dlChain = p.catch(() => { }); return p; }

// ───────── .menu (photo + info box + categories) ─────────
const menuState = new Map();   // jid → { id, at } of the last menu (for number replies)
const REACTS = ['⚡', '🔥', '✨', '💠', '🚀', '😎', '🤖', '💫', '🌟', '🎯', '💎', '🫡', '👌', '🌀', '🍃'];
const readSettings = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); } catch { return {}; } };
const reactOn = () => !process.env.ARENA_NO_REACT && readSettings().react !== false;
async function handleReact(send, jid, msg, arg) {
    if (arg === 'on' || arg === 'off') {
        const f = path.join(__dirname, 'settings.json'); const d = readSettings(); d.react = arg === 'on';
        try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch { }
        return send(jid, { text: arg === 'on' ? '✨ Auto react *ON*' : '🚫 Auto react *OFF*' }, { quoted: msg });
    }
    return send(jid, { text: `✨ Auto react: *${reactOn() ? 'ON' : 'OFF'}*\n*.react on* / *.react off*` }, { quoted: msg });
}

const CATS = [
    ['📥', 'Download', `*📥 DOWNLOAD*\n\n┃ *.download <link>*  (*.dl*)  — file එක එවනවා\n┃ *.dl link1 link2*  — links 5 දක්වා\n┃ *.gitclone user/repo*  — GitHub repo → zip\n\n✅ Direct, GitHub, Google Drive, MediaFire, MEGA, Dropbox, Pixeldrain, catbox...\n📏 Max: ${human(MAX_BYTES)} / file`],
    ['🎬', 'YouTube', '*🎬 YOUTUBE*\n\n┃ *.yts <නම>*  — search\n┃ *.song <නම / link>*  — audio (*.play*, *.yta*)\n┃ *.video <නම / link>*  — video (*.ytv*)\n\n📺 720p → 480p → 360p (size එකට ගැලපෙන විදියට)'],
    ['📱', 'Social', '*📱 SOCIAL MEDIA*\n\n┃ *.tiktok <link>*  — watermark නැතුව (*.tt*)\n┃ *.fb <link>*  — Facebook video\n┃ *.ig <link>*  — Instagram reel / video\n┃ *.x <link>*  — X / Twitter video\n\n🔓 Public videos විතරයි'],
    ['🔍', 'Search', '*🔍 SEARCH*\n\n┃ *.wiki <මාතෘකාව>*  — Wikipedia\n┃ *.wiki si <මාතෘකාව>*  — සිංහල Wikipedia\n┃ *.yts <නම>*  — YouTube search'],
    ['🖼️', 'Sticker', '*🖼️ STICKER*\n\n┃ *.s*  — photo / video එකකට reply කරලා (නැත්නම් caption එකට)\n┃ *.take Pack | Author*  — sticker එකක නම වෙනස් කරන්න\n\n🎞️ Video stickers තත්පර 6 දක්වා'],
    ['🛠️', 'Tools', '*🛠️ TOOLS*\n\n┃ *.tr <භාෂාව> <text>*  — translate (reply කරලත්)\n┃ *.tts <text>*  — voice එකක් (සිංහල OK)\n┃ *.weather <නගරය>*  — කාලගුණය (දින 3)\n┃ *.lyrics <සින්දුව>*  — lyrics\n┃ *.imagine <විස්තරය>*  — AI image\n┃ *.toimg*  — sticker → photo\n┃ *.tourl*  — media → download link\n┃ *.ss <website>*  — screenshot\n┃ *.qr <text>*  •  *.short <link>*  •  *.calc <ගණනය>*\n┃ *.github <user>*  — GitHub profile\n┃ *.del*  — reply කරපු message එක මකන්න\n┃ *.setpp*  — photo reply → profile photo'],
    ['🎉', 'Fun', '*🎉 FUN*\n\n┃ *.joke*  — විහිළුවක්\n┃ *.fact*  — රසවත් කරුණක් (+සිංහල)\n┃ *.quote*  — quote එකක්\n┃ *.8ball <ප්‍රශ්නය>*  — 🎱'],
    ['👥', 'Group', '*👥 GROUP*  (group එකේ ඔයා ගහන්න)\n\n┃ *.groupinfo*  — group විස්තර\n┃ *.grouplink*  — invite link (admin)\n┃ *.tagall [message]*  — ඔක්කොටම mention (විනාඩි 10 කට 1)\n┃ *.kick @user*  — අයින් කරන්න (admin)\n┃ *.promote @user*  /  *.demote @user*\n┃ *.mute*  /  *.unmute*  — admins only / open\n┃ *.tagadmins*  •  *.resetlink*\n┃ *.jid*  — chat ID එක\n\n💡 @mention නැත්නම් message එකකට reply කරලා ගහන්න'],
    ['🤖', 'AI', '*🤖 AI*\n\n┃ *.ai <ප්‍රශ්නය>*  — Gemini / Groq (සිංහල OK)\n┃ message එකකට reply කරලා *.ai*  — ඒ message එක ගැන\n┃ *.ai reset*  — කතාව අලුතෙන්\n┃ *.setkey gemini <KEY>*  /  *.setkey groq <KEY>*\n┃ *.keys*  — keys බලන්න'],
    ['🔧', 'Network', '*🔧 NETWORK*\n\n┃ *.net <link>*  — download fail නම් හේතුව (DNS / IP block)\n┃ *.setproxy <url>*  — block sites වලට proxy (YouTube වලටත්)\n┃ *.setproxy off*'],
    ['⚙️', 'Settings', '*⚙️ SETTINGS*\n\n┃ *.setlogo*  — photo එකකට reply කරලා → menu logo\n┃ *.dellogo*  — default banner\n┃ *.react on|off*  — auto react\n┃ *.mode self|all*  — commands වැඩ කරන chats\n┃ *.update*  — GitHub එකෙන් update\n┃ *.restart*  — bot restart\n┃ *.version*'],
    ['🛡️', 'Security', '*🛡️ SECURITY*\n\n┃ 🔒 Commands පාවිච්චි කරන්න පුළුවන් *ඔයාට විතරයි*\n┃ 🔒 Default: Message yourself chat එකේ විතරයි (*.mode*)\n┃ 👥 Group tools: ඔයා group එකේ ගැහුවොත් විතරයි\n┃ 🛡️ Anti-ban: rate limit, human delay, backoff, tagall limit\n┃ 🙈 Keys / passwords logs වල පේන්නේ නෑ'],
    ['📊', 'Status', null],
];
function menuCaption(name) {
    const v = (() => { try { return updater.localInfo().version; } catch { return require('./package.json').version; } })();
    const ram = Math.round(process.memoryUsage().rss / 1048576);
    return [
        '*◈ ARENA AI · MENU ◈*',
        `👋 ʜɪ *${String(name || 'Boss').slice(0, 25)}*`,
        '',
        '╭─〔 🤖 *BOT INFO* 〕',
        `│ ⚡ Version › ${v}`,
        `│ ⏱️ Uptime › ${fmtUptime(process.uptime())}`,
        `│ 💾 RAM › ${ram} MB`,
        `│ 🖥️ Host › ${process.env.ARENA_ON_PANEL ? 'Panel' : 'Termux'}`,
        '│ 🔣 Prefix › .',
        '╰────────────⊷',
        '',
        '╭─〔 📂 *CATEGORIES* 〕',
        ...CATS.map(([e, n], i) => `│ *${i + 1}* ┃ ${e} ${n}`),
        '╰────────────⊷',
        '',
        '> 🔢 *number එක reply කරන්න* (උදා: 1)',
    ].join('\n');
}
async function handleMenu(send, jid, msg, arg) {
    const n = parseInt(arg, 10);
    if (n) {
        const cat = CATS[n - 1];
        if (!cat) return send(jid, { text: `❌ 1 – ${CATS.length} අතර number එකක් ගහන්න` }, { quoted: msg });
        if (!cat[2]) return sendAlive(send, jid, msg, 'alive');
        return send(jid, { text: cat[2] + '\n\n> ↩️ *.menu* — ආපහු menu එකට' }, { quoted: msg });
    }
    const caption = menuCaption(msg.pushName);
    const img = fs.existsSync(LOGO) ? LOGO : fs.existsSync(BANNER) ? BANNER : null;
    const sent = await send(jid, img ? { image: fs.readFileSync(img), caption } : { text: caption }, { quoted: msg });
    if (sent?.key?.id) menuState.set(jid, { id: sent.key.id, at: Date.now() });
}

// ───────── online / alive card ─────────
function fmtUptime(sec) { sec = Math.floor(sec); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${sec % 60}s`; }
function nowLK() {
    try { return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); }
    catch { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
}
function aliveCaption(kind = 'online') {
    const v = (() => { try { return updater.localInfo().version; } catch { return require('./package.json').version; } })();
    const head = kind === 'updated' ? '🔄 ᴜᴘᴅᴀᴛᴇᴅ & ᴏɴʟɪɴᴇ' : kind === 'alive' ? '💠 sᴛɪʟʟ ʜᴇʀᴇ' : '🟢 ᴏɴʟɪɴᴇ';
    return [
        `*◈ ARENA AI ◈*  ${head}`,
        '',
        `┊ ⚡ *v${v}*`,
        `┊ 🕒 ${nowLK()}`,
        `┊ 🖥️ ${process.env.ARENA_ON_PANEL ? 'Panel server' : 'Termux'}${kind === 'alive' ? '  •  ⏱️ ' + fmtUptime(process.uptime()) : ''}`,
        `┊ 🔒 Private  •  🛡️ Anti-ban`,
        '',
        '> 💬 *.menu* — commands',
    ].join('\n');
}
async function sendAlive(send, jid, quoted, kind) {
    const caption = aliveCaption(kind);
    const img = fs.existsSync(LOGO) ? LOGO : fs.existsSync(BANNER) ? BANNER : null;
    const opts = quoted ? { quoted } : undefined;
    if (img) return send(jid, { image: fs.readFileSync(img), caption }, opts);
    return send(jid, { text: caption }, opts);
}

features.setMediaDownloader((m) => mediaDownloader(m));
tools.setMediaDownloader((m) => mediaDownloader(m));
let mediaDownloader = async (m) => { const b = await loadBaileys(); return b.downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: SOCK?.updateMediaMessage }); };
async function handleSetLogo(send, jid, msg) {
    const unwrap = (m) => m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message || m?.ephemeralMessage?.message || m;
    const own = unwrap(msg.message);
    const ctx = own?.extendedTextMessage?.contextInfo || own?.imageMessage?.contextInfo;
    let target = null;
    if (own?.imageMessage) target = { key: msg.key, message: own };
    else if (ctx?.quotedMessage && unwrap(ctx.quotedMessage)?.imageMessage) target = { key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, fromMe: true, participant: ctx.participant }, message: unwrap(ctx.quotedMessage) };
    if (!target) return send(jid, { text: '🖼️ *.setlogo*\n\n1. ඔයාට ඕනේ photo එක මේ chat එකට යවන්න\n2. ඒ photo එකට *reply* කරලා *.setlogo* ගහන්න\n   (නැත්නම් photo එක යවද්දී caption එකට *.setlogo* දාන්න)\n\nDefault එකට ආපහු: *.dellogo*' }, { quoted: msg });
    const st = await send(jid, { text: '🖼️ Photo එක ගන්නවා...' }, { quoted: msg });
    try {
        const buf = await mediaDownloader(target);
        if (!buf || buf.length < 1000) throw new Error('photo එක හිස්');
        if (buf.length > 5 * 1024 * 1024) throw new Error('photo එක 5 MB ට වඩා ලොකුයි');
        fs.writeFileSync(LOGO, buf);
        await send(jid, { text: '✅ Logo එක save කළා! Preview එක 👇', edit: st.key });
        await sendAlive(send, jid, null, 'online');
    } catch (e) {
        await send(jid, { text: '❌ Photo එක ගන්න බැරි වුණා: ' + e.message + '\n(photo එක ආයෙත් යවලා ඒකට reply කරලා *.setlogo* ගහන්න)', edit: st.key });
    }
}

async function handleMode(send, jid, msg, arg) {
    if (arg === 'all' || arg === 'self') {
        guard.setChatMode(arg);
        return send(jid, { text: arg === 'all'
            ? '🔓 *Mode: all* — ඔයා *ඕනෑම chat එකක* ගහන commands වැඩ (reply එක ඒ chat එකේ අනිත් අයටත් පේනවා).\nවෙන කාටවත් තාමත් commands පාවිච්චි කරන්න බෑ 🔒\nආපහු: *.mode self*'
            : '🔒 *Mode: self* — commands වැඩ කරන්නේ *Message yourself* chat එකේ විතරයි.' }, { quoted: msg });
    }
    return send(jid, { text: `🔒 *Mode: ${guard.chatMode()}*\n\n*.mode self* — "Message yourself" chat එකේ විතරයි (default, ආරක්ෂිතම)\n*.mode all* — ඔයා ඕනෑම chat එකක ගහන commands වැඩ\n\n(කොහොම වුණත් commands පාවිච්චි කරන්න පුළුවන් *ඔයාට විතරයි*)` }, { quoted: msg });
}

async function handleProxy(send, del, jid, msg, arg) {
    const f = require('path').join(__dirname, 'settings.json');
    let d = {}; try { d = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch { }
    const hide = (p) => p.replace(/\/\/[^@/]*@/, '//***@');
    if (!arg) { await send(jid, { text: d.proxy ? `🧩 Proxy: ${hide(d.proxy)}\n(off කරන්න: *.setproxy off*)` : '🧩 Proxy නෑ.\nදාන්න: *.setproxy http://user:pass@host:port*\n(block වෙන sites වලට විතරයි පාවිච්චි වෙන්නේ)' }, { quoted: msg }); return; }
    if (/^(off|delete|remove|none)$/i.test(arg)) { delete d.proxy; require('fs').writeFileSync(f, JSON.stringify(d, null, 2)); await send(jid, { text: '🧩 Proxy අයින් කළා ✅' }, { quoted: msg }); return; }
    if (!/^https?:\/\/[^\s]+:\d+\/?$/i.test(arg)) { await send(jid, { text: '❌ Format එක: *.setproxy http://user:pass@host:port*  (http / https proxy විතරයි)' }, { quoted: msg }); return; }
    d.proxy = arg.replace(/\/$/, ''); require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
    if (/@/.test(arg)) await del(msg.key);   // hide the password
    await send(jid, { text: `🧩 Proxy save කළා ✅ ${hide(d.proxy)}\nBlock වෙන sites වලට ඉබේම පාවිච්චි වෙනවා. Test: *.net <link>*` });
}

const mask = (k) => k.slice(0, 4) + '••••' + k.slice(-3);
const KEY_HELP = `🔑 *Free API key එකක් ගන්න:*

*Gemini (Google):*
1. https://aistudio.google.com/apikey open කරන්න (Google account එකෙන් login)
2. *Create API key* ඔබලා key එක copy කරන්න
3. මෙතන ගහන්න:  *.setkey gemini ඔයාගේ_key*

*Groq:*
1. https://console.groq.com/keys open කරන්න (login)
2. *Create API Key* → copy
3. *.setkey groq ඔයාගේ_key*

(දෙකම දැම්මොත් හොඳයි — එකක් fail වුණොත් අනිත් එක auto පාවිච්චි කරනවා)`;

async function handleKey(send, del, jid, msg, c, rest) {
    const provider = (rest[0] || '').toLowerCase();
    if (!['gemini', 'groq'].includes(provider)) return send(jid, { text: KEY_HELP }, { quoted: msg });
    if (c === '.delkey') { ai.setKey(provider, ''); return send(jid, { text: `🗑️ ${provider} key එක මැකුවා` }); }
    const key = (rest[1] || '').trim();
    if (key.length < 20) return send(jid, { text: KEY_HELP }, { quoted: msg });
    ai.setKey(provider, key);
    await del(msg.key); // key එක තියෙන message එක chat එකෙන් මකනවා (ආරක්ෂාවට)
    await send(jid, { text: `✅ ${provider} key එක save කළා (${mask(key)})\n🔒 key එක තිබ්බ message එක මැකුවා.\n\nදැන් test කරන්න: *.ai හායි*` });
}

function quotedText(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    return ctx?.quotedMessage ? getText(ctx.quotedMessage) : '';
}

async function handleAI(send, jid, msg, question) {
    question = question.trim();
    if (/^(reset|new|clear)$/i.test(question)) { ai.reset(jid); return send(jid, { text: '🆕 කතාව reset කළා. අලුතෙන් අහන්න!' }, { quoted: msg }); }
    const q = quotedText(msg);
    if (q) question = question ? `${question}\n\n"""${q}"""` : `මේ message එක ගැන පැහැදිලි කරන්න:\n"""${q}"""`;
    if (!question) return send(jid, { text: '🤖 *.ai <ප්‍රශ්නය>*\nඋදා: .ai GTA SA වල cheats මොනවද?' }, { quoted: msg });
    const status = await send(jid, { text: '🤖 හිතනවා...' }, { quoted: msg });
    try {
        const { text, model } = await ai.ask(jid, question);
        const parts = ai.splitLong(text);
        await send(jid, { text: parts[0] + (parts.length === 1 ? `\n\n_— ${model}_` : ''), edit: status.key });
        for (let i = 1; i < parts.length; i++) await send(jid, { text: parts[i] + (i === parts.length - 1 ? `\n\n_— ${model}_` : '') });
        log(`🤖 ${model}: ${question.slice(0, 60)}`);
    } catch (e) {
        if (e.noKey) return send(jid, { text: '⚠️ AI key එකක් තවම දාලා නෑ.\n\n' + KEY_HELP, edit: status.key });
        await send(jid, { text: `❌ AI error:\n${String(e.message).slice(0, 400)}\n\n💡 Key එක හරිද බලන්න (*.keys*), නැත්නම් ටිකකින් ආයෙත් try කරන්න (free limit).`, edit: status.key });
        log('❌ AI: ' + e.message);
    }
}

let updating = false;
async function handleUpdate(send, jid, msg, force) {
    if (updating) return send(jid, { text: '⏳ Update එකක් දැනටමත් වෙනවා...' }, { quoted: msg });
    updating = true;
    const status = await send(jid, { text: '🔍 Update තියෙනවද බලනවා...' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const r = await updater.apply({ force, onStatus: edit });
        if (!r.updated) { updating = false; return edit(`✅ දැනටමත් අලුත්ම version එක (v${r.current.version})`); }
        await edit(`✅ *Update වුණා!*  v${r.from} → v${r.to}\n\n📝 ${r.notes}\n\n🔄 Restart වෙනවා... තත්පර 10 කින් *.ping* ගහලා බලන්න.\n(WhatsApp link එක / API keys වෙනස් වෙන්නේ නෑ)`);
        log(`🔄 Updated v${r.from} → v${r.to} — restarting`);
        if (!process.env.ARENA_LAUNCHER) await send(jid, { text: '⚠️ Bot එක *npm start* එකෙන් start කරලා නැති නිසා auto restart වෙන්නේ නෑ. Termux එකේ CTRL+C කරලා *npm start* ගහන්න.' });
        try { fs.writeFileSync(ANNOUNCE_NEXT, '1'); } catch { }   // show the online card after restart
        setTimeout(() => process.exit(100), 2500);
    } catch (e) {
        updating = false;
        await edit(`❌ Update fail වුණා:\n${String(e.message).slice(0, 300)}\n\n(පරණ version එක එහෙමම වැඩ)`);
        log('❌ update: ' + e.message);
    }
}

async function handleDownload(send, jid, msg, link) {
    const status = await send(jid, { text: `⏳ Download වෙනවා...\n${link}` }, { quoted: msg });
    let last = 0;
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    const onProgress = (loaded, total, speed) => {
        const now = Date.now();
        if (now - last < 8000) return;   // 🛡️ fewer edits
        last = now;
        const pct = total ? Math.floor(loaded * 100 / total) : null;
        const bar = pct === null ? '' : '▰'.repeat(Math.round(pct / 10)) + '▱'.repeat(10 - Math.round(pct / 10)) + ` ${pct}%\n`;
        edit(`⬇️ Downloading...\n${bar}${human(loaded)} / ${human(total)}  •  ${human(speed)}/s`);
    };
    let files = [];
    try {
        files = await download(link, onProgress);
        for (const f of files) {
            await edit(`📤 WhatsApp එකට යවනවා... (${f.name}, ${human(f.size)})`);
            await send(jid, { document: { url: f.path }, fileName: f.name, mimetype: f.mime, caption: `✅ ${f.name}\n📦 ${human(f.size)}` }, { quoted: msg });
        }
        await edit(`✅ ඉවරයි — file ${files.length} ක් එව්වා`);
        log(`✅ ${link} → ${files.map(f => f.name + ' ' + human(f.size)).join(', ')}`);
    } catch (e) {
        await edit(`❌ Download fail වුණා\n${link}\n\n${String(e.message).slice(0, 300)}`);
        log(`❌ ${link}: ${e.message}`);
    } finally {
        for (const f of files) fs.rm(f.path, { force: true }, () => { });
    }
}

process.on('unhandledRejection', (e) => log('unhandled: ' + (e?.message || e)));
process.on('uncaughtException', (e) => log('uncaught: ' + e.message));
module.exports = { handleDownload, getText, onMessages, replyJid, ME, aliveCaption, _setMediaDownloader: (f) => { mediaDownloader = f; }, _setSock: (x) => { SOCK = x; } };
if (require.main === module) {
    console.log('🚀 Arena AI starting...');
    start().catch((e) => { log('Startup fail: ' + e.message); process.exit(1); });
}
