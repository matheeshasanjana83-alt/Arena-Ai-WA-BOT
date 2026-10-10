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
    if (/^\d+$/.test(_maxMB)) process.env.DL_MAX_MB = _maxMB;   // settings.json {"maxMB": 2000}  (.maxmb wins over env)
    // v2.12.1: big files are streamed (1× disk), so no more 350 MB panel default → 2000 MB (WhatsApp max)
    process.env.ARENA_ON_PANEL = onPanel ? '1' : '';
}
/**
 * KAVIZ MD V1 — private WhatsApp bot:  .ai <question>  +  .download <link> [link2 ...]
 * Works only for YOU (messages you send). Others are ignored silently.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pino = require('pino');
// Baileys v7 (ESM-only) — LID support. v6 could not decrypt LID-addressed messages (Bad MAC) and sent ACKs that WhatsApp bans.
let B = null;
// 🔒 v2.12.2: libsignal prints whole sessions (incl. PRIVATE KEYS) to the console → never show them
{
    const SECRET = /^(Closing session|Opening session|Removing old closed session|Session already (closed|open)|Closing open session|Decrypted message with closed session|Migrating session|Failed to decrypt message with any known session|Session error)/;
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
        const orig = console[k].bind(console);
        console[k] = (...a) => { if (typeof a[0] === 'string' && SECRET.test(a[0])) return; orig(...a); };
    }
}
const loadBaileys = async () => (B ||= await import('baileys'));
const { download, human, maxBytes, maxMB, freeDisk, WA_MAX_MB } = require('./downloader');
const { resolve } = require('./resolvers');
const ai = require('./ai');
const updater = require('./updater');
const netx = require('./net');
const guard = require('./guard');
const features = require('./features');
const tools = require('./tools');
const antibug = require('./antibug');
const antispam = require('./antispam');
const { BRAND, foot, cut } = require('./style');

const AUTH = path.join(__dirname, 'auth');
const LOGO = path.join(__dirname, 'logo.img');        // your own photo (.setlogo) — never touched by .update
const BANNER = path.join(__dirname, 'banner.jpg');    // default KAVIZ MD V1 banner
const ANNOUNCE_NEXT = path.join(__dirname, '.announce-next');
let SOCK = null;
// 📨 v2.12.2: KAVIZ agent → your WhatsApp. The agent writes agent-msg.txt on the panel (panel API) → bot sends it to "Message yourself"
const AGENT_MSG = path.join(__dirname, 'agent-msg.txt');
let agentTimer = null;
async function agentTick(send) {
    try {
        if (!ME.pn || !fs.existsSync(AGENT_MSG)) return false;
        const tmp = AGENT_MSG + '.sending';
        fs.renameSync(AGENT_MSG, tmp);
        const t = fs.readFileSync(tmp, 'utf8').trim(); fs.rmSync(tmp, { force: true });
        if (!t) return false;
        for (const part of ai.splitLong(t.slice(0, 12000))) await send(ME.pn, { text: '🤖 *KAVIZ Agent*\n\n' + part });
        log('📨 KAVIZ agent message → Message yourself');
        return true;
    } catch (e) { log('agent inbox: ' + e.message); return false; }
}
function startAgentInbox(send) {
    if (agentTimer) clearInterval(agentTimer);
    agentTimer = setInterval(() => agentTick(send), 5000);
    agentTimer.unref?.();
}
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

const HELP = `*◈ KAVIZ MD V1 ◈* — commands

📥 *.download <link>* (*.dl*) · *.mirror <link>* · *.gitclone user/repo*
🎬 *.yts* <නම> · *.song* <නම/link> · *.video* <නම/link> [2160..144]
📱 *.tiktok* · *.fb* · *.ig* · *.x* <link>
🖼️ *.s* (reply) · *.take* Pack | Author
🔍 *.wiki* <මාතෘකාව>
🛠️ *.tr* · *.tts* · *.weather* · *.lyrics* · *.imagine* · *.toimg* · *.tourl* · *.ss* · *.qr* · *.short* · *.calc* · *.github* · *.del* · *.setpp*
🎉 *.joke* · *.fact* · *.quote* · *.8ball*
👥 *.groupinfo* · *.grouplink* · *.tagall* · *.kick* · *.promote* · *.demote* · *.mute* · *.resetlink* · *.jid*
🤖 *.ai <ප්‍රශ්නය>* (reply කරලත් · *.ai reset*)
🔧 *.net* · *.setproxy* · *.proxies* · *.setcookies* · *.setkey* · *.keys*
⚙️ *.mode* · *.react* · *.maxmb* · *.setlogo* · *.update* · *.version* · *.restart*
🛡️ *.antibug* · *.block* · *.unblock* · *.blocklist* · *.antispam* · *.spamlog*

> 📥 direct · GitHub · Drive · MediaFire · MEGA · Dropbox · Pixeldrain…
> 📏 max ${human(maxBytes())} / file — *.maxmb* වෙනස් කරන්න
${foot('*.menu* — categories වලින්')}`;

let botStatus = 'starting';
if (process.env.SERVER_PORT || process.env.ARENA_ON_PANEL) {
    try {
        require('http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ bot: 'KAVIZ MD V1', status: botStatus, uptime: Math.floor(process.uptime()) })); })
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
            startAgentInbox(send);
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
                if (msg.message && msg.key?.fromMe !== true) { await antibug.guard(msg, { sock: SOCK, me: ME, send, log }); antispam.see(msg, { sock: SOCK, me: ME, send, log }).catch(() => { }); continue; }   // 🛡️ anti-bug + 🚫 anti-spam (others' messages are never run as commands)
                if (!msg.message || msg.key?.fromMe !== true) continue;        // 🔒 PRIVATE: only messages YOU send
                if (guard.ignoredChat(msg.key.remoteJid)) continue;              // status / channels / broadcast
                if (!isFromOwner(msg.key)) continue;                              // 🔒 double check the sender
                if (sentIds.has(msg.key.id) || seen.has(msg.key.id)) continue; // own replies / already handled
                const ts = Number(msg.messageTimestamp || 0);
                if (type !== 'notify' && ts && ts < STARTED - 60) continue;   // old history — don't re-run old commands
                seen.add(msg.key.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
                let text = getText(msg.message);
                if (/^\d{1,3}$/.test(text)) {                                   // number reply → .menu category
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
                msg.key = { ...msg.key, remoteJid: jid };   // quote/delete with the normalized chat jid too
                const [cmd, ...rest] = text.split(/\s+/);
                const c = cmd.toLowerCase();
                const heavy = HEAVY.has(c);
                if (reactOn()) {   // ⏳ working → ✅/❌ done (heavy) · ✨ light commands
                    if (heavy) reactTo(msg.key, '⏳');
                    else { try { await send(jid, { react: { text: REACTS[Math.floor(Math.random() * REACTS.length)], key: msg.key } }); } catch { } }
                }
                const react = (e) => reactTo(msg.key, e);
                log(`📩 command: ${guard.maskLog(text.slice(0, 60))}  (${type})  ${msg.key.remoteJid}${jid !== msg.key.remoteJid ? ' → ' + jid : ''}`);

                if (c === '.alive' || c === '.status') { await sendAlive(send, jid, msg, 'alive'); continue; }
                if (c === '.setlogo') { await handleSetLogo(send, jid, msg); continue; }
                if (c === '.dellogo') { fs.rmSync(LOGO, { force: true }); await send(jid, { text: '🗑️ logo reset — default banner එක පාවිච්චි වෙනවා' }, { quoted: msg }); continue; }
                if (c === '.mode') { await handleMode(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.ping') { const ms = Math.max(1, Date.now() - Number(msg.messageTimestamp) * 1000); await send(jid, { text: `🏓 *Pong!* ${ms} ms` }, { quoted: msg }); continue; }
                if (c === '.menu') { await handleMenu(send, jid, msg, rest[0]); continue; }
                if (c === '.help' || c === '.commands') { await send(jid, { text: HELP }, { quoted: msg }); continue; }
                if (c === '.maxmb' || c === '.setmax' || c === '.limit') { await handleMaxMB(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.antibug') { await send(jid, { text: await antibug.command(rest[0], rest[1]) }, { quoted: msg }); continue; }
                if (c === '.antispam') { await send(jid, { text: antispam.command(rest[0], rest[1]) }, { quoted: msg }); continue; }
                if (c === '.block') { await send(jid, { text: await antispam.blockCommand(SOCK, msg, rest[0], ME) }, { quoted: msg }); continue; }
                if (c === '.unblock') { await send(jid, { text: await antispam.unblockCommand(SOCK, msg, rest[0], ME) }, { quoted: msg }); continue; }
                if (c === '.blocklist') { await send(jid, { text: antispam.listText() }, { quoted: msg }); continue; }
                if (c === '.spamlog') { await send(jid, { text: antispam.logText() }, { quoted: msg }); continue; }
                if (c === '.react') { await handleReact(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.ai' || c === '.ask' || c === '.gpt') { await handleAI(send, jid, msg, rest.join(' ')); continue; }
                if (c === '.setkey' || c === '.delkey') { await handleKey(send, del, jid, msg, c, rest); continue; }
                if (c === '.update') { await handleUpdate(send, jid, msg, rest[0] === 'force'); continue; }
                if (c === '.version') {
                    const cur = updater.localInfo();
                    let t = `🤖 *KAVIZ MD V1* v${cur.version}${cur.sha ? ' (' + cur.sha.slice(0, 7) + ')' : ''}`;
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
                if (c === '.proxies' || c === '.proxypool') { await handleProxies(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.setcookies') { await handleCookies(send, del, jid, msg, rest.join(' ').trim()); continue; }
                if (c === '.keys') { const k = ai.getKeys(); await send(jid, { text: `🔑 *API keys*\nGemini: ${k.gemini ? '✅ ' + mask(k.gemini) : '❌ නෑ'}\nGroq: ${k.groq ? '✅ ' + mask(k.groq) : '❌ නෑ'}` }, { quoted: msg }); continue; }
                if (c === '.restart') { await send(jid, { text: '🔄 Restart වෙනවා... තත්පර 10 කින් *.ping*' }, { quoted: msg }); setTimeout(() => process.exit(process.env.ARENA_LAUNCHER ? 100 : 0), 1500); continue; }
                if (await tools.handle(c, { send, jid, msg, rest, sock: SOCK, me: ME, react })) continue;
                if (await features.handle(c, { send, jid, msg, rest, sock: SOCK, me: ME, download, react })) continue;
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
const reactTo = (key, emoji) => {   // ⏳ → ✅/❌ pro-bot feedback (respects .react off)
    if (!reactOn() || !key?.id) return;
    try { SOCK?.sendMessage(key.remoteJid, { react: { text: emoji, key } }).catch(() => { }); } catch { }
};
const HEAVY = new Set(['.download', '.dl', '.dn', '.song', '.play', '.yta', '.video', '.ytv', '.yt', '.fb', '.facebook', '.faceboock', '.fbvid', '.ig', '.insta', '.x', '.twitter', '.tiktok', '.tt', '.mirror', '.link', '.tourl', '.url', '.gitclone', '.ai', '.ask', '.gpt', '.imagine', '.img', '.s', '.sticker', '.take', '.tts', '.say', '.ss', '.setcookies', '.setlogo', '.update']);
async function handleMaxMB(send, jid, msg, arg) {
    const free = freeDisk(process.env.DL_TMP || require('os').tmpdir());
    const freeTxt = free == null ? '' : `\n💾 Disk free: ${human(free)}`;
    if (!arg) return send(jid, { text: `📏 Download limit: *${maxMB()} MB* / file${freeTxt}\n\n*.maxmb 1000*  → 1 GB\n*.maxmb 2000*  → 2 GB (WhatsApp උපරිමය)\n\n💡 100 MB ට ලොකු files disk එකේ save නොකර කෙලින්ම WhatsApp එකට stream වෙනවා — disk එකේ file size එකට වඩා ටිකක් ඉඩ තිබුණාම ඇති.` }, { quoted: msg });
    let n = /^\d+(\.\d+)?gb?$/.test(arg) ? Math.round(parseFloat(arg) * 1024) : parseInt(arg, 10);
    if (!n || n < 1) return send(jid, { text: '❌ MB ගණනක් දෙන්න. උදා: *.maxmb 1000*  හෝ  *.maxmb 2gb*' }, { quoted: msg });
    const capped = n > WA_MAX_MB;
    n = Math.min(n, WA_MAX_MB);
    const f = path.join(__dirname, 'settings.json'); const d = readSettings(); d.maxMB = n;
    try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch { }
    process.env.DL_MAX_MB = String(n);
    return send(jid, { text: `✅ Download limit = *${n} MB*${capped ? `\n\n⚠️ WhatsApp එකෙන් යවන්න පුළුවන් උපරිමය ≈ 2 GB. ඒ නිසා ${WA_MAX_MB} MB ට සීමා කළා (6 GB වගේ files WhatsApp එකට යවන්න බෑ).` : ''}${freeTxt}` }, { quoted: msg });
}
async function handleReact(send, jid, msg, arg) {
    if (arg === 'on' || arg === 'off') {
        const f = path.join(__dirname, 'settings.json'); const d = readSettings(); d.react = arg === 'on';
        try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch { }
        return send(jid, { text: arg === 'on' ? '✨ Auto react *ON*' : '🚫 Auto react *OFF*' }, { quoted: msg });
    }
    return send(jid, { text: `✨ Auto react: *${reactOn() ? 'ON' : 'OFF'}*\n*.react on* / *.react off*` }, { quoted: msg });
}

const CATS = [
    ['📥', 'Download', `*📥 DOWNLOAD*\n\n✦ *.download <link>* — file එක එවනවා\n✦ *.dl link1 link2* — links 5 දක්වා\n✦ *.mirror <link>* — 🔗 direct share link\n✦ *.gitclone user/repo* — repo → zip\n\n> 📏 max {MAX} / file · *.maxmb* වෙනස් කරන්න`],
    ['🎬', 'YouTube', `*🎬 YOUTUBE*\n\n✦ *.yts <නම>* — search\n✦ *.song <නම / link>* — audio (*.play*)\n✦ *.video <නම / link>* — video (*.yt*)\n✦ *.video <link> 1080* — quality pick\n\n> 2160p → 144p · quality නැත්නම් best`],
    ['📱', 'Social', `*📱 SOCIAL*\n\n✦ *.tiktok <link>* — watermark නෑ (*.tt*)\n✦ *.fb <link>* — Facebook (*.facebook*)\n✦ *.ig <link>* — Instagram\n✦ *.x <link>* — X / Twitter`],
    ['🔍', 'Search', `*🔍 SEARCH*\n\n✦ *.wiki <මාතෘකාව>* — Wikipedia\n✦ *.wiki si <මාතෘකාව>* — සිංහල wiki\n✦ *.yts <නම>* — YouTube search`],
    ['🖼️', 'Sticker', `*🖼️ STICKER*\n\n✦ *.s* — photo/video reply → sticker\n✦ *.take Pack | Author* — නම වෙනස් කරන්න\n\n> video sticker — තත්පර 6 දක්වා`],
    ['🛠️', 'Tools', `*🛠️ TOOLS*\n\n✦ *.tr <භාෂාව> <text>* — translate\n✦ *.tts <text>* — voice (සිංහල OK)\n✦ *.weather <නගරය>* — කාලගුණය · දින 3\n✦ *.lyrics <සින්දුව>* — lyrics\n✦ *.imagine <විස්තරය>* — AI image\n✦ *.toimg* — sticker → photo\n✦ *.tourl* — media → 🔗 link\n✦ *.ss <site>* · *.qr* · *.short* · *.calc*\n✦ *.github <user>* · *.del* · *.setpp*`],
    ['🎉', 'Fun', `*🎉 FUN*\n\n✦ *.joke* · *.fact* · *.quote*\n✦ *.8ball <ප්‍රශ්නය>* — 🎱`],
    ['👥', 'Group', `*👥 GROUP* — group එකේ ඔයා ගහන්න\n\n✦ *.groupinfo* · *.grouplink* · *.jid*\n✦ *.tagall [msg]* — විනාඩි 10 කට 1\n✦ *.kick @user* · *.promote* · *.demote*\n✦ *.mute* · *.unmute* · *.tagadmins* · *.resetlink*\n\n> @mention නැත්නම් message එකකට reply කරන්න`],
    ['🤖', 'AI', `*🤖 AI*\n\n✦ *.ai <ප්‍රශ්නය>* — සිංහල OK\n✦ message එකකට reply + *.ai* — ඒක ගැනම\n✦ *.ai reset* — අලුත් කතාවක්\n✦ *.setkey gemini/groq <KEY>* · *.keys*`],
    ['🔧', 'Network', `*🔧 NETWORK*\n\n✦ *.net <link>* — fail වුණොත් හේතුව\n✦ *.setproxy <url|off>* — block sites වලට\n✦ *.proxies* — free pool status · *.proxies check*\n✦ *.setcookies* — YouTube bot-check fix`],
    ['⚙️', 'Settings', `*⚙️ SETTINGS*\n\n✦ *.setlogo* / *.dellogo* — menu logo\n✦ *.react on|off* — auto react\n✦ *.maxmb <MB>* — download limit\n✦ *.mode self|all* — වැඩ කරන chats\n✦ *.update* · *.restart* · *.version*`],
    ['🛡️', 'Security', `*🛡️ SECURITY*\n\n✦ commands — ඔයාට විතරයි (owner-only)\n✦ anti-ban — rate limit · human delay · backoff\n✦ *.antibug on|off|scan* — bug messages auto delete\n✦ *.block <නම්බර්|reply>* · *.unblock* · *.blocklist*\n✦ *.antispam on|off|<N>* · *.spamlog* — flood guard`],
    ['📊', 'Status', null],
];
function menuCaption(name) {
    const v = (() => { try { return updater.localInfo().version; } catch { return require('./package.json').version; } })();
    const ram = Math.round(process.memoryUsage().rss / 1048576);
    return [
        '*◈ KAVIZ MD V1 · MENU ◈*',
        `👋 ʜɪ *${String(name || 'Boss').slice(0, 25)}*`,
        '',
        '╭─〔 ⚡ *INFO* 〕',
        `│ ⚡ v${v} · ⏱ ${fmtUptime(process.uptime())}`,
        `│ 💾 ${ram} MB · 🖥️ ${process.env.ARENA_ON_PANEL ? 'Panel' : 'Termux'}`,
        '╰────────────⊷',
        '',
        '╭─〔 📂 *CATEGORIES* 〕',
        ...CATS.map(([e, n], i) => `│ *${i + 1}* ┃ ${e} ${n}`),
        '╰────────────⊷',
        '',
        foot('🔢 number එකක් reply කරන්න'),
    ].join('\n');
}
async function handleMenu(send, jid, msg, arg) {
    const n = parseInt(arg, 10);
    if (n) {
        const cat = CATS[n - 1];
        if (!cat) return send(jid, { text: `❌ 1 – ${CATS.length} අතර number එකක් ගහන්න` }, { quoted: msg });
        if (!cat[2]) return sendAlive(send, jid, msg, 'alive');
        return send(jid, { text: cat[2].replace('{MAX}', human(maxBytes())) + '\n' + foot('↩️ *.menu*') }, { quoted: msg });
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
    const head = kind === 'updated' ? '🔄 ᴜᴘᴅᴀᴛᴇᴅ' : kind === 'alive' ? '💠 sᴛɪʟʟ ʜᴇʀᴇ' : '🟢 ᴏɴʟɪɴᴇ';
    return [
        `*◈ KAVIZ MD V1 ◈*  ${head}`,
        `┊ ⚡ v${v} · ⏱ ${fmtUptime(process.uptime())}`,
        `┊ 🕒 ${nowLK()}  ·  🖥️ ${process.env.ARENA_ON_PANEL ? 'Panel' : 'Termux'}`,
        `┊ 🔒 private  ·  🛡️ anti-ban  ·  🧬 anti-bug ${antibug.cfg().on ? 'ON' : 'OFF'}`,
        foot('*.menu* — commands'),
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
    const st = await send(jid, { text: '🖼️ logo…' }, { quoted: msg });
    try {
        const buf = await mediaDownloader(target);
        if (!buf || buf.length < 1000) throw new Error('photo එක හිස්');
        if (buf.length > 5 * 1024 * 1024) throw new Error('photo එක 5 MB ට වඩා ලොකුයි');
        fs.writeFileSync(LOGO, buf);
        await send(jid, { text: '✅ logo save · preview 👇', edit: st.key });
        await sendAlive(send, jid, null, 'online');
    } catch (e) {
        await send(jid, { text: `❌ ${e.message}\n> photo එක ආයෙත් යවලා reply කරන්න *.setlogo*`, edit: st.key });
    }
}

async function handleMode(send, jid, msg, arg) {
    if (arg === 'all' || arg === 'self') {
        guard.setChatMode(arg);
        return send(jid, { text: arg === 'all'
            ? foot('🔓 mode: all — ඕනෑම chat එකක commands වැඩ · පාවිච්චි කරන්නේ ඔයාට විතරයි')
            : foot('🔒 mode: self — Message yourself chat එකේ විතරයි') }, { quoted: msg });
    }
    return send(jid, { text: `🔒 *mode: ${guard.chatMode()}*\n> *.mode self* — Message yourself විතරයි (default)\n> *.mode all* — ඕනෑම chat එකක\n> කොහොම වුණත් — ඔයාට විතරයි` }, { quoted: msg });
}

// ───────── .proxies — free proxy pool (stats / check / on / off) ─────────
async function handleProxies(send, jid, msg, sub) {
    const pool = require('./proxypool');
    if (sub === 'on' || sub === 'off') {
        const f = path.join(__dirname, 'settings.json'); const d = readSettings(); d.proxyPool = sub === 'on';
        try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch { }
        pool.resetSettingsCache();
        return send(jid, { text: sub === 'on' ? '🧩 Free proxy pool *ON* ✅\nBlock වෙන sites වලට auto fallback විදිහට පාවිච්චි වෙනවා.' : '🚫 Free proxy pool *OFF*' }, { quoted: msg });
    }
    if (sub === 'check' || sub === 'update' || sub === 'refresh') {
        await send(jid, { text: '🔍 Proxy pool එක check කරනවා... alive අඩු නම් internet එකෙන් අලුත් free proxies ගෙනියනවා (විනාඩි 1-2 ක් විතර යනවා)' }, { quoted: msg });
        try { const r = await pool.checkNow('manual'); return send(jid, { text: `✅ *${r.alive}/${r.total}* proxies alive · block වෙන downloads වලට auto fallback` }, { quoted: msg }); }
        catch (e) { return send(jid, { text: '❌ Check fail: ' + String(e.message).slice(0, 150) }, { quoted: msg }); }
    }
    const s = pool.stats();
    const t = `🧩 *Free proxy pool*  ${s.enabled ? '✅ ON' : '⛔ OFF'}
📦 මුළු proxies: *${s.total}*  (list: ${s.shipped} • ඔයාගේ: ${s.user} • auto: ${s.fetched})
🔍 Check කරලා: ${s.alive ? `*${s.alive}* alive${s.checkedAgo != null ? ` (${s.checkedAgo} min කින් කලින්)` : ''}` : 'තාම check කරලා නෑ'}
✅ දැන් usable: *${s.usable}*
${s.checking ? '⏳ දැන් check එකක් run වෙනවා...' : s.usable ? `🔁 ඊළඟට පාවිච්චි වෙන්නේ: ${s.next}` : '💡 *.proxies check* ගහලා check කරන්න'}

*.proxies check* — දැන්ම check කරන්න
*.proxies on* / *.proxies off*

💡 ඔයාගේම proxies: bot folder එකේ *proxies.user.txt* file එකක් හදලා line එකකට එකක් (ip:port) — .update වෙද්දි මැකෙන්නේ නෑ
🔄 Auto: alive අඩු වුණාම free proxy lists වලින් (monosans/TheSpeedX/proxyscrape) අලුත් ඒවා auto ගන්නවා
🔒 Pool එකෙන් try කරන්නේ direct / DoH / IPv6 / proxy ඔක්කොම fail වුණාම විතරයි`;
    return send(jid, { text: t }, { quoted: msg });
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

// ───────── .setcookies — YouTube bot-check fix (cookies.txt) ─────────
const COOKIES_FILE = () => require('path').join(__dirname, 'cookies.txt');
const looksLikeCookies = (t) => /# (Netscape )?HTTP Cookie File|# Netscape/i.test(t) || (/\.youtube\.com\s+\w+\t/.test(t) && t.includes('\t'));

async function handleCookies(send, del, jid, msg, arg) {
    const fsx = require('fs');
    if (/^(off|delete|remove)$/i.test(arg)) { fsx.rmSync(COOKIES_FILE(), { force: true }); return send(jid, { text: '🍪 Cookies අයින් කළා ✅' }, { quoted: msg }); }
    // cookies.txt file එකක් attach කරලා (caption එකේ .setcookies)
    const doc = msg.message?.documentMessage;
    if (doc) {
        try {
            const buf = await mediaDownloader({ key: msg.key, message: msg.message });
            const txt = Buffer.from(buf).toString('utf8');
            if (!looksLikeCookies(txt)) return send(jid, { text: '❌ මේක cookies.txt file එකක් වගේ නෑ. Browser extension එකෙන් export කරපු file එක එවන්න (විස්තර: *.setcookies* හිස්ව ගහන්න).' }, { quoted: msg });
            fsx.writeFileSync(COOKIES_FILE(), txt);
            try { await del(msg.key); } catch { }   // cookies තියෙන message එක මකනවා (privacy)
            return send(jid, { text: `🍪 YouTube cookies save කළා ✅ (${(txt.length / 1024).toFixed(0)} KB)\n🔒 ඔයා එවපු message එක මකලා දැම්මා.\nදැන් *.yt / .video* ආයෙත් try කරන්න — bot check එක pass වෙන්න ඕනේ.` });
        } catch (e) { return send(jid, { text: '❌ File එක ගන්න බැරි වුණා: ' + String(e.message).slice(0, 150) }, { quoted: msg }); }
    }
    // cookies.txt content එක paste කරලා:  .setcookies <paste>  (format check එක තමයි real gate එක)
    if (arg && arg.length > 50) {
        if (!looksLikeCookies(arg)) return send(jid, { text: '❌ මේක cookies.txt content එකක් වගේ නෑ. File එක ඇතුළේ text එක සම්පූර්ණයෙන් paste කරන්න.' }, { quoted: msg });
        fsx.writeFileSync(COOKIES_FILE(), arg.endsWith('\n') ? arg : arg + '\n');
        try { await del(msg.key); } catch { }
        return send(jid, { text: `🍪 Cookies save කළා ✅ (${(arg.length / 1024).toFixed(0)} KB)\n🔒 message එක මකලා දැම්මා.\nදැන් *.yt / .video* ආයෙත් try කරන්න.` });
    }
    const has = fsx.existsSync(COOKIES_FILE());
    if (has) return send(jid, { text: '🍪 YouTube cookies දැනටමත් දාලා තියෙනවා ✅\nඅයින් කරන්න: *.setcookies off*\nආයෙත් අලුත් ඒවා දාන්න: cookies.txt file එකක් යවලා caption එකට *.setcookies* ලියන්න' }, { quoted: msg });
    return send(jid, { text: `🍪 *YouTube bot-check fix — cookies දාන හැටි:*
\nYouTube මේ server එකේ IP එක block කරද්දී ("Sign in to confirm you're not a bot") මේකෙන් fix වෙනවා:\n\n1️⃣ PC browser එකෙන් *youtube.com* එකට login වෙන්න (ඔයාගේ Google account එකෙන්)\n2️⃣ "Get cookies.txt LOCALLY" extension එක install කරන්න (Chrome / Edge / Firefox)\n3️⃣ YouTube page එකේ extension icon එක ඔබලා *Export* → cookies.txt file එක ගන්න\n4️⃣ ඒ file එක *මේ chat එකට* යවන්න — caption එකට *.setcookies* ලියන්න\n\n✅ Save වුණාම *.yt / .video* වලට YouTube එකේ block එක pass වෙනවා\n🔒 Cookies message එක auto මකලා දානවා (privacy)\n🗑️ අයින් කරන්න: *.setcookies off*\n\n💡 cookies දාලා 1-2 සැරයක් වැඩ කරලා නැවතුණොත් අලුතෙන් export කරලා දාන්න (YouTube cookies ටිකකින් expire වෙනවා)` }, { quoted: msg });
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
        await send(jid, { text: parts[0] + (parts.length === 1 ? `\n\n${foot('ᴀɪ')}` : ''), edit: status.key });
        for (let i = 1; i < parts.length; i++) await send(jid, { text: parts[i] + (i === parts.length - 1 ? `\n\n${foot('ᴀɪ')}` : '') });
        reactTo(msg.key, '✅');
        log(`🤖 ${model}: ${question.slice(0, 60)}`);
    } catch (e) {
        if (e.noKey) return send(jid, { text: '⚠️ AI key එකක් තවම දාලා නෑ.\n\n' + KEY_HELP, edit: status.key });
        reactTo(msg.key, '❌');
        await send(jid, { text: `❌ ${String(e.message).slice(0, 200)}\n> *.keys* — key check · ටිකකින් ආයෙත් try`, edit: status.key });
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
        if (!r.updated) { updating = false; reactTo(msg.key, '✅'); return edit(`✅ v${r.current.version} — up to date`); }
        reactTo(msg.key, '✅');
        await edit(`✅ v${r.from} → *v${r.to}*\n📝 ${r.notes}\n${foot('🔄 restart වෙනවා — තත්පර 10 කින් *.ping*')}`);
        log(`🔄 Updated v${r.from} → v${r.to} — restarting`);
        if (!process.env.ARENA_LAUNCHER) await send(jid, { text: '⚠️ Bot එක *npm start* එකෙන් start කරලා නැති නිසා auto restart වෙන්නේ නෑ. Termux එකේ CTRL+C කරලා *npm start* ගහන්න.' });
        try { fs.writeFileSync(ANNOUNCE_NEXT, '1'); } catch { }   // show the online card after restart
        setTimeout(() => process.exit(100), 2500);
    } catch (e) {
        updating = false;
        reactTo(msg.key, '❌');
        await edit(`❌ ${String(e.message).slice(0, 200)}\n> පරණ version එක එහෙමම වැඩ`);
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
        const r = await resolve(link);
        if (r.kind === 'video') {
            // video page (eporner etc.) → yt-dlp: formats + free-proxy pool fallback built in (media.ytdl)
            await edit('🎬 Video එක හොයනවා (yt-dlp)... block වෙලා නම් free proxy pool එකෙනුත් try කරනවා');
            const f = await require('./media').ytdl(r.url, { mode: 'video', maxMB: maxMB() });
            files = [{ path: f.path, name: `video-${Date.now().toString(36)}.${f.ext || 'mp4'}`, size: f.size, mime: f.ext === 'mp4' ? 'video/mp4' : 'video/' + f.ext }];
        } else {
            files = await download(link, onProgress, { stream: true });   // 🌊 big files → straight to WhatsApp (1× disk)
        }
        for (const f of files) {
            await edit(`📤 WhatsApp එකට යවනවා... (${f.name}, ${human(f.size)})`);
            await send(jid, { document: f.open ? { stream: f.open() } : { url: f.path }, fileName: f.name, mimetype: f.mime, caption: `*${f.name}*\n${foot(human(f.size))}` }, { quoted: msg });
        }
        try { await send(jid, { delete: status.key }); } catch { }   // progress bubble අයින් — file එකම ප්‍රමාණවත්
        reactTo(msg.key, '✅');
        log(`✅ ${link} → ${files.map(f => f.name + ' ' + human(f.size)).join(', ')}`);
    } catch (e) {
        await edit(`❌ ${String(e.message).slice(0, 200)}`);
        reactTo(msg.key, '❌');
        log(`❌ ${link}: ${e.message}`);
    } finally {
        for (const f of files) if (f.path) fs.rm(f.path, { force: true }, () => { });
    }
}

process.on('unhandledRejection', (e) => log('unhandled: ' + (e?.message || e)));
process.on('uncaughtException', (e) => log('uncaught: ' + e.message));
module.exports = { _agentTick: agentTick, AGENT_MSG, handleDownload, getText, onMessages, replyJid, ME, aliveCaption, _setMediaDownloader: (f) => { mediaDownloader = f; }, _setSock: (x) => { SOCK = x; } };
if (require.main === module) {
    console.log('🚀 KAVIZ MD V1 starting...');
    require('./media').checkUpdate(true).catch(() => { });   // yt-dlp fresh → FB "Cannot parse data" / YT format errors fix (max 1 check/hour)
    require('./proxypool').warmup();                          // free-proxy pool check in background (net.js / yt-dlp fallback)
    start().catch((e) => { log('Startup fail: ' + e.message); process.exit(1); });
}
