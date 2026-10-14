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
const autoupdate = require('./autoupdate');
const netx = require('./net');
const guard = require('./guard');
const features = require('./features');
const tools = require('./tools');
const moviedex = require('./moviedex');
const antibug = require('./antibug');
const antispam = require('./antispam');
const { BRAND, foot, cut } = require('./style');
const reminders = require('./reminders');

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
🍿 *.moviedex* <movie/series name> — movie & 📺 TV download
🎬 *.yts* <නම> · *.song* <නම/link> · *.video* <නම/link> [2160..144]
📱 *.tiktok* · *.fb* · *.ig* · *.x* <link>
🖼️ *.s* (reply) · *.take* Pack | Author
🔍 *.wiki* <මාතෘකාව>
🛠️ *.tr* · *.tts* · *.weather* · *.lyrics* · *.imagine* · *.toimg* · *.tourl* · *.ss* · *.qr* · *.short* · *.calc* · *.github* · *.del* · *.setpp*
🎉 *.joke* · *.fact* · *.quote* · *.8ball*
👥 *.groupinfo* · *.grouplink* · *.tagall* · *.kick* · *.promote* · *.demote* · *.mute* · *.resetlink* · *.jid*
🤖 *.ai <ප්‍රශ්නය>* (reply කරලත් · *.ai reset* · *.ai memory*)
⏰ *.remind 10m <note>* · 👁 photo/PDF reply + *.ai* · 🎨 *.ai* — "image එකක් හදලා දෙන්න"
🔧 *.net* · *.setproxy* · *.proxies* · *.setcookies* · *.setkey* · *.keys*
⚙️ *.setting* (panel) · *.mode* · *.react* · *.maxmb* · *.setlogo* · *.autoupdate* · *.update* · *.version* · *.restart*
🛡️ *.antibug* · *.block* · *.unblock* · *.blocklist* · *.antispam* · *.spamlog*

> 📥 direct · GitHub · Drive · MediaFire · MEGA · Dropbox · Pixeldrain…
> 📏 max ${human(maxBytes())} / file — *.maxmb* වෙනස් කරන්න
${foot('*.menu* — categories වලින්')}`;

// 🗒️ v2.43: console ring — last 250 console lines readable via /logs?key=<pairkey> (remote debug via pairsite)
const LOGS = [];
{
    const _fmt = (...a) => a.map((x) => (typeof x === 'string' ? x : require('util').format(x))).join(' ');
    for (const k of ['log', 'warn', 'error']) {
        const orig = console[k].bind(console);
        console[k] = (...a) => {
            try { const s = _fmt(...a); if (s) { LOGS.push(s); if (LOGS.length > 250) LOGS.shift(); } } catch { }
            orig(...a);
        };
    }
}
let botStatus = 'starting';
// 🌐 v2.29: pair site — panel port එකේම web page එකක් (number එක දාලා pairing code ගන්න) + /status JSON (පරණ behavior)
try {
    require('./pairsite').start({
        status: () => ({ bot: 'KAVIZ MD V1', status: botStatus, uptime: Math.floor(process.uptime()) }),
        getSock: () => SOCK,
        log,
        logs: () => LOGS.join('\n'),
    });
} catch (e) { log && console.log('pairsite: ' + e.message); }
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
        // v2.30: media uploads get a hard timeout — one hung 200MB document used to
        // deadlock the pacer chain and silence the WHOLE bot (stuck "99%" symptom).
        const isMedia = content && ['document', 'video', 'image', 'audio', 'sticker', 'ptt'].some(k => content[k]);
        let t = isMedia ? parseInt(process.env.ARENA_MEDIA_TIMEOUT || '420000', 10) : parseInt(process.env.ARENA_TEXT_TIMEOUT || '60000', 10);   // v2.45: text send එකකුත් hang වෙන්න පුළුවන් — 60s hard cap නැත්නම් pacer chain එක සදාකාලිකව block වෙනවා
        if (isMedia && !process.env.ARENA_MEDIA_TIMEOUT) {   // v2.43: big files need >7 min — size-aware cap (3 min base + 1s/1.5MB ≈ 1.5 MB/s uplink, max 20 min)
            const p = content.document?.url || content.video?.url || content.image?.url || content.audio?.url || content.sticker?.url || content.ptt?.url;
            if (typeof p === 'string' && !p.startsWith('http')) {
                try { const sz = fs.statSync(p).size; t = Math.min(20 * 60e3, 180e3 + Math.round(sz / 1.5 / 1048576 * 1000)); } catch { }
            }
        }
        const s = await pace(() => sock.sendMessage(jid, content, opts), t).catch((e) => {   // 🛡️ one message at a time, human-like gap
            log(`📤 send fail (${isMedia ? 'media cap ' + Math.round(t / 60000) + 'min' : 'text cap ' + Math.round(t / 1000) + 's'}): ${e.message}`);
            throw e;
        });
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
            autoupdate.start({                                        // 🔄 GitHub auto-update — reconnect වුණත් timers refresh (idempotent)
                log, send,
                getJid: () => ME.pn,
                isBusy: () => updating || JOBS > 0,
                performUpdate: (o = {}) => { if (updating) throw new Error('update එකක් දැනටමත් run වෙනවා'); return runUpdate({ send, jid: ME.pn, auto: true, ...o }); },
            });
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
                const fromMe = msg.key?.fromMe === true;
                const owner = fromMe && isFromOwner(msg.key);                    // 🔒 owner = our own messages (pn/lid check)
                if (!fromMe && msg.message) {                                    // 🛡️ anti-bug + 🚫 anti-spam watch EVERY outside message
                    await antibug.guard(msg, { sock: SOCK, me: ME, send, log });
                    antispam.see(msg, { sock: SOCK, me: ME, send, log }).catch(() => { });
                }
                if (!msg.message) continue;
                if (guard.ignoredChat(msg.key.remoteJid)) continue;              // status / channels / broadcast
                const accessible = guard.botAccess(replyJid(msg.key), owner);   // 🌐 COMMANDS gate — public/private/inbox/groups (AI chat has its OWN 11-16 modes, independent — v2.41)
                if (sentIds.has(msg.key.id) || seen.has(msg.key.id)) continue; // own replies / already handled
                const ts = Number(msg.messageTimestamp || 0);
                if (type !== 'notify' && ts && ts < STARTED - 60) continue;   // old history — don't re-run old commands
                seen.add(msg.key.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
                let text = getText(msg.message);
                if (accessible && /^\d{1,3}$/.test(text)) {                      // number reply → .mode / .setting / .menu panel · .moviedex card (v2.41: 3 panels)
                    const jid0 = replyJid(msg.key), qid = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
                    const fresh = (x) => x && (qid ? qid === x.id : Date.now() - x.at < 180e3);
                    const panels = [[settingState.get(jid0), '.setting '], [menuState.get(jid0), '.menu '], [modeState.get(jid0), '.mode ']].filter(([x]) => fresh(x));
                    if (panels.length) {
                        const exact = qid && panels.find(([x]) => x.id === qid);
                        text = (exact || panels.sort((a, b) => (b[0].at || 0) - (a[0].at || 0))[0])[1] + text;   // exact quote wins, else the newest panel
                    }
else { const b = moviedex.bridgeReply(jid0, qid, text); if (b) text = b; }
                }
                if (!text.startsWith('.')) { maybeAiReply({ msg, jid: replyJid(msg.key), text, owner, send }); continue; }   // 🤖 AI chat (v2.41 — own modes, works even when bot commands are private)
                if (!accessible) continue;                                       // 🌐 others: bot commands locked by bot mode
                const jid = replyJid(msg.key);
                const c0 = text.split(/\s+/)[0].toLowerCase();
                if (!owner && (OWNER_CMDS.has(c0) || features.GROUP_CMDS.includes(c0))) {   // 🔒 v2.41: owner-only commands hidden from others
                    await send(jid, { text: '🔒 මේ command එක bot owner ට විතරයි' }, { quoted: msg });
                    continue;
                }
   // 🔒 default: "Message yourself" chat only (.mode all)
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
                if (c === '.setting' || c === '.settings') { await handleSetting(send, jid, msg, rest[0]); continue; }   // ⚙️ settings panel (අංක reply)
                if (c === '.help' || c === '.commands') { await send(jid, { text: HELP }, { quoted: msg }); continue; }
                if (c === '.maxmb' || c === '.setmax' || c === '.limit') { await handleMaxMB(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.antibug') { await send(jid, { text: await antibug.command(rest[0], rest[1]) }, { quoted: msg }); continue; }
                if (c === '.antispam') { await send(jid, { text: antispam.command(rest[0], rest[1]) }, { quoted: msg }); continue; }
                if (c === '.block') { await send(jid, { text: await antispam.blockCommand(SOCK, msg, rest[0], ME) }, { quoted: msg }); continue; }
                if (c === '.unblock') { await send(jid, { text: await antispam.unblockCommand(SOCK, msg, rest[0], ME) }, { quoted: msg }); continue; }
                if (c === '.blocklist') { await send(jid, { text: antispam.listText() }, { quoted: msg }); continue; }
                if (c === '.spamlog') { await send(jid, { text: antispam.logText() }, { quoted: msg }); continue; }
                if (c === '.react') { await handleReact(send, jid, msg, (rest[0] || '').toLowerCase()); continue; }
                if (c === '.ai' || c === '.ask' || c === '.gpt') { await runJob(() => handleAI(send, jid, msg, rest.join(' '))); continue; }
                if (c === '.setkey' || c === '.delkey') { await handleKey(send, del, jid, msg, c, rest); continue; }
                if (c === '.autoupdate') { await send(jid, { text: autoupdate.command(rest[0]) }, { quoted: msg }); continue; }
                if (c === '.update') { await handleUpdate(send, jid, msg, rest[0] === 'force'); continue; }
                if (c === '.version') {
                    const cur = updater.localInfo();
                    let t = `🤖 *KAVIZ MD V1* v${cur.version}${cur.sha ? ' (' + cur.sha.slice(0, 7) + ')' : ''}`;
                    try { const ch = await updater.check(); t += ch.upToDate ? '\n✅ අලුත්ම version එක' : `\n🆕 Update එකක් තියෙනවා: v${ch.latest.manifest.version}\n➡️ *.update* ගහන්න`; } catch (e) { t += '\n(update check fail: ' + e.message + ')'; }
                    t += `\n🔄 auto-update: ${autoupdate.statusText()}`;
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
                if (c === '.forward') { await runJob(() => handleForward(send, jid, msg, rest.join(' ').trim())); continue; }   // 🧭 owner-only (v2.41)
                if (c === '.keys') { const k = ai.getKeys(); await send(jid, { text: `🔑 *API keys*\nGemini: ${k.gemini ? '✅ ' + mask(k.gemini) : '❌ නෑ'}\nGroq: ${k.groq ? '✅ ' + mask(k.groq) : '❌ නෑ'}\nZ.ai (GLM): ${k.zai ? '✅ ' + mask(k.zai) : '❌ නෑ'}` }, { quoted: msg }); continue; }
                if (c === '.aiprovider') { // 🎛 AI provider selector (v2.49)
                    const arg2 = (rest[0] || '').toLowerCase();
                    if (!arg2 || arg2 === 'auto' || arg2 === 'list' || arg2 === '?') {
                        const cur = ai.getProvider();
                        return send(jid, { text: `🤖 *AI PROVIDER*\n\n✦ දැන්: *${cur ? cur.toUpperCase() : 'AUTO'}*\n✦ AUTO order: Gemini → Groq → Z.ai\n\nවෙනස් කරන්න: *.aiprovider gemini* / *.aiprovider groq* / *.aiprovider zai* / *.aiprovider auto*\n✦ *.setting* → 10 එකෙනුත් පුළුවන්` }, { quoted: msg });
                    }
                    const set2 = ai.setProvider(arg2);
                    const label2 = { '': 'AUTO (Gemini → Groq → Z.ai)', gemini: 'GEMINI', groq: 'GROQ', zai: 'Z.AI' }[set2];
                    const hint2 = set2 && !ai.getKeys()[set2] ? `\n⚠️ ඒ provider එකේ key එක නෑ — .setkey ${set2} <KEY>` : '';
                    return send(jid, { text: `✅ AI provider: *${label2}*${hint2}` }, { quoted: msg });
                }
                if (c === '.remind') { await handleRemind(send, jid, msg, rest.join(' ')); continue; }   // ⏰ reminders (v2.51)
                if (c === '.restart') { await send(jid, { text: '🔄 Restart වෙනවා... තත්පර 10 කින් *.ping*' }, { quoted: msg }); setTimeout(() => process.exit(process.env.ARENA_LAUNCHER ? 100 : 0), 1500); continue; }
                if (await runJob(() => tools.handle(c, { send, jid, msg, rest, sock: SOCK, me: ME, react }))) continue;
                if (await runJob(() => features.handle(c, { send, jid, msg, rest, sock: SOCK, me: ME, download, react }))) continue;
                if (await runJob(() => moviedex.handle(c, { send, jid, msg, rest, react }))) continue;
                if (!['.download', '.dl', '.dn'].includes(c)) continue;

                const links = (text.match(/https?:\/\/\S+/g) || []).slice(0, 5);   // 🛡️ max 5 per command
                if (!links.length) { await send(jid, { text: HELP }, { quoted: msg }); continue; }
                for (const link of links) await dlQueue(() => runJob(() => handleDownload(send, jid, msg, link)));   // one download at a time
            } catch (e) {
                log('handler error: ' + e.message);
                try { if (heavy) reactTo(msg.key, '❌'); } catch { }   // v2.45: hang/fail command එකේ ⏳ එක ❌ වෙනවා — silence නෙවෙයි
                if (/timeout/i.test(String(e.message || ''))) { try { await send(jid, { text: `⏱ WhatsApp send timeout — connection එක stall වෙලා. ආයෙත් try කරන්න.` }, { quoted: msg }); } catch { } }
            }
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
const settingState = new Map();   // jid → { id, at } of the last .setting panel (number replies)
const modeState = new Map();   // jid → { id, at } of the last .mode panel (number replies) — v2.41
const OWNER_CMDS = new Set(['.mode', '.setting', '.settings', '.setkey', '.delkey', '.keys', '.autoupdate', '.update', '.restart', '.block', '.unblock', '.blocklist', '.spamlog', '.antibug', '.antispam', '.maxmb', '.setmax', '.limit', '.setlogo', '.dellogo', '.setproxy', '.proxies', '.proxypool', '.net', '.netcheck', '.setcookies', '.del', '.delete', '.react', '.forward']);   // 🔒 never for others (v2.41)
const REACTS = ['⚡', '🔥', '✨', '💠', '🚀', '😎', '🤖', '💫', '🌟', '🎯', '💎', '🫡', '👌', '🌀', '🍃'];
const readSettings = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')); } catch { return {}; } };
const reactOn = () => !process.env.ARENA_NO_REACT && readSettings().react !== false;
const reactTo = (key, emoji) => {   // ⏳ → ✅/❌ pro-bot feedback (respects .react off)
    if (!reactOn() || !key?.id) return;
    try { SOCK?.sendMessage(key.remoteJid, { react: { text: emoji, key } }).catch(() => { }); } catch { }
};
const HEAVY = new Set(['.download', '.dl', '.dn', '.moviedex', '.mdx', '.song', '.play', '.yta', '.video', '.ytv', '.yt', '.fb', '.facebook', '.faceboock', '.fbvid', '.ig', '.insta', '.x', '.twitter', '.tiktok', '.tt', '.mirror', '.link', '.tourl', '.url', '.gitclone', '.ai', '.ask', '.gpt', '.imagine', '.img', '.s', '.sticker', '.take', '.tts', '.say', '.ss', '.setcookies', '.setlogo', '.update']);
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
    ['🍿', 'MovieDex', `*🍿 MOVIEDEX* — movies + 📺 series\n\n✦ *.moviedex <නම>* — search (*.mdx*)\n✦ අංකය reply — card → options\n✦ *.moviedex <n> <q#>* — 🍿 movie file\n✦ series: season 🧳 pack files · episode 🎬 files\n✦ *.moviedex <n> <q#> link* — 🔗 share link\n\n> DASH 1080p/720p/480p · ffmpeg mux · *.maxmb* limit`],
    ['📱', 'Social', `*📱 SOCIAL*\n\n✦ *.tiktok <link>* — watermark නෑ (*.tt*)\n✦ *.fb <link>* — Facebook (*.facebook*)\n✦ *.ig <link>* — Instagram\n✦ *.x <link>* — X / Twitter`],
    ['🔍', 'Search', `*🔍 SEARCH*\n\n✦ *.wiki <මාතෘකාව>* — Wikipedia\n✦ *.wiki si <මාතෘකාව>* — සිංහල wiki\n✦ *.yts <නම>* — YouTube search`],
    ['🖼️', 'Sticker', `*🖼️ STICKER*\n\n✦ *.s* — photo/video reply → sticker\n✦ *.take Pack | Author* — නම වෙනස් කරන්න\n\n> video sticker — තත්පර 6 දක්වා`],
    ['🛠️', 'Tools', `*🛠️ TOOLS*\n\n✦ *.tr <භාෂාව> <text>* — translate\n✦ *.remind <time> <note>* — ⏰ reminders\n✦ *.tts <text>* — voice (සිංහල OK)\n✦ *.weather <නගරය>* — කාලගුණය · දින 3\n✦ *.lyrics <සින්දුව>* — lyrics\n✦ *.imagine <විස්තරය>* — AI image\n✦ *.toimg* — sticker → photo\n✦ *.tourl* — media → 🔗 link\n✦ *.ss <site>* · *.qr* · *.short* · *.calc*\n✦ *.github <user>* · *.del* · *.setpp*`],
    ['🎉', 'Fun', `*🎉 FUN*\n\n✦ *.joke* · *.fact* · *.quote*\n✦ *.8ball <ප්‍රශ්නය>* — 🎱`],
    ['👥', 'Group', `*👥 GROUP* — group එකේ ඔයා ගහන්න\n\n✦ *.groupinfo* · *.grouplink* · *.jid*\n✦ *.tagall [msg]* — විනාඩි 10 කට 1\n✦ *.kick @user* · *.promote* · *.demote*\n✦ *.mute* · *.unmute* · *.tagadmins* · *.resetlink*\n\n> @mention නැත්නම් message එකකට reply කරන්න`],
    ['🤖', 'AI', `*🤖 AI*\n\n✦ *.ai <ප්‍රශ්නය>* — සිංහල OK\n✦ message එකකට reply + *.ai* — ඒක ගැනම\n✦ *.ai reset* — අලුත් කතාවක්
✦ *.ai memory* — මතකය status · save state
✦ photo/PDF එකකට reply + *.ai* — 👁 බලලා කියනවා
✦ *.remind 10m <note>* — ⏰ මතක් කරන්න
✦ *.ai tools* — GLM connector (search/weather/YT)
✦ AI provider තෝරන්න — *.aiprovider gemini/groq/zai/auto* · *.setting* → 10\n✦ AI chat auto-reply — *.mode* → 5/6 on·off · 11-16 modes
✦ *.setkey gemini/groq/zai <KEY>* · *.keys*`],
    ['🔧', 'Network', `*🔧 NETWORK*\n\n✦ *.net <link>* — fail වුණොත් හේතුව\n✦ *.setproxy <url|off>* — block sites වලට\n✦ *.proxies* — free pool status · *.proxies check*\n✦ *.setcookies* — YouTube bot-check fix`],
    ['⚙️', 'Settings', `*⚙️ SETTINGS*\n\n✦ *.setlogo* / *.dellogo* — menu logo\n✦ *.react on|off* — auto react\n✦ *.maxmb <MB>* — download limit\n✦ *.setting* — ⚙️ settings panel (අංක reply → toggle)
✦ *.mode* — 🛡 mode panel (public / private / inbox / groups + AI chat modes)\n✦ *.autoupdate on|off* — GitHub එකෙන් auto update (default on)\n✦ *.update* · *.restart* · *.version*`],
    ['🛡️', 'Security', `*🛡️ SECURITY*\n\n✦ commands — ඔයාට විතරයි (owner-only)\n✦ anti-ban — rate limit · human delay · backoff\n✦ *.antibug* — bug → delete + 🚀 auto report ×30 → ඉවර උනාම ⛔ block (bug ගහපු එකාට විතරයි)\n✦ *.antibug report on|off* · *.antibug count <1-100>*\n✦ *.antibug scan|test* — caught bugs · self-test\n✦ *.block <නම්බර්|reply>* · *.unblock* · *.blocklist*\n✦ *.antispam on|off|<N>* · *.spamlog* — flood guard`],
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

// ───────── .setting — settings panel (Asitha-style, K A V I Z - V 1 🍁) ─────────
const MAXMB_STEPS = [100, 200, 300, 500, 1000, 2000];
const COUNT_STEPS = [10, 20, 30, 50, 100];
function verStr() { try { return updater.localInfo().version; } catch { return require('./package.json').version; } }
function settingCaption() {
    const s = readSettings(), k = ai.getKeys(), a = antibug.cfg(), m = ai.stats();
    const oo = (v) => (v ? 'on' : 'off');
    return [
        '🎀 ≡ *BOT SETTINGS PANEL* ≡ 🍁',
        '',
        '🍀 | *BOT NAME:* K A V I Z - V 1 🍁',
        `🍀 | *VERSION:* v${verStr()}`,
        `🍀 | *WORK TYPE:* ${guard.chatMode()}`,
        `🍀 | *AI KEYS:* Gemini ${k.gemini ? '✅' : '❌'} · Groq ${k.groq ? '✅' : '❌'} · Z.ai ${k.zai ? '✅' : '❌'}`,
        `🧠 | *AI MEMORY:* ${m.msgs} msgs · ${m.chats} chats · TTL ${m.ttlDays}d`,
        `🤖 | *AI PROVIDER:* ${ai.getProvider() ? ai.getProvider().toUpperCase() : 'AUTO (Gemini → Groq → Z.ai)'}`,
        `🧰 | *AI TOOLS:* ${ai.getTools() ? '✅ ON' : '⛔ OFF'} (GLM)`,
        `🍀 | *ANTI-BUG:* ${oo(a.on)}`,
        `🍀 | *AUTO REPORT:* ${a.report ? 'on ×' + a.reportCount : 'off'}`,
        `🍀 | *AUTO BLOCK:* ${oo(a.block)}`,
        `🍀 | *AUTO UPDATE:* ${oo(s.autoUpdate !== false)}`,
        `🍀 | *MAX FILE:* ${maxMB()} MB`,
        `🍀 | *AUTO REACT:* ${oo(reactOn())}`,
        `🍀 | *PROXY:* ${oo(!!s.proxy)}`,
        '',
        '⟶ *SELECT OPTION* 🌸',
        '',
        '» 🔧 *MAIN SETTINGS* 👇',
        '1 | Mode: All (Public)',
        '2 | Mode: Self (Private)',
        '',
        '» 🛡️ *ANTI-BUG* 👇',
        `3 | Anti-Bug: ${a.on ? 'ON' : 'OFF'}`,
        `4 | Auto Report: ${a.report ? 'ON' : 'OFF'}`,
        `5 | Report Count: ×${a.reportCount} → next`,
        `6 | Auto Block: ${a.block ? 'ON' : 'OFF'}`,
        '',
        '» ⚙️ *BOT* 👇',
        `7 | Auto-Update: ${s.autoUpdate !== false ? 'ON' : 'OFF'}`,
        `8 | Max File: ${maxMB()} MB → next`,
        `9 | Auto React: ${reactOn() ? 'ON' : 'OFF'}`,
        `10 | AI Provider: ${ai.getProvider() ? ai.getProvider().toUpperCase() : 'AUTO'} → next`,
        '',
        foot('🔢 option එකේ number එක reply කරන්න'),
    ].join('\n');
}
function applySetting(n) {
    const cyc = (v, steps) => steps[(steps.indexOf(v) + 1) % steps.length] || steps[0];
    const save = (d) => { try { fs.writeFileSync(path.join(__dirname, 'settings.json'), JSON.stringify(d, null, 2)); } catch { } };
    const a = antibug.cfg();
    switch (n) {
        case 1: guard.setChatMode('all'); return '🔓 mode: all — ඕනෑම chat එකක commands වැඩ';
        case 2: guard.setChatMode('self'); return '🔒 mode: self — Message yourself විතරයි';
        case 3: antibug.setCfg({ on: !a.on }); return `🧬 anti-bug: ${!a.on ? 'ON' : 'OFF'}`;
        case 4: antibug.setCfg({ report: !a.report }); return `🚀 auto report: ${!a.report ? 'ON' : 'OFF'}`;
        case 5: { const c = cyc(a.reportCount, COUNT_STEPS); antibug.setCfg({ reportCount: c }); return `🔢 report count: ×${c}`; }
        case 6: antibug.setCfg({ block: !a.block }); return `⛔ auto block: ${!a.block ? 'ON' : 'OFF'}`;
        case 7: return autoupdate.command(readSettings().autoUpdate === false ? 'on' : 'off').split('\n')[0];
        case 8: { const m = cyc(maxMB(), MAXMB_STEPS); const d = readSettings(); d.maxMB = m; save(d); process.env.DL_MAX_MB = String(m); return `📏 max file: ${m} MB`; }
        case 9: { const nv = !reactOn(); const d = readSettings(); d.react = nv; save(d); return nv ? '✨ auto react ON' : '🚫 auto react OFF'; }
        case 10: { // 🤖 AI provider cycle: AUTO → GEMINI → GROQ → Z.AI
            const nxt = cyc(ai.getProvider() || '', ['', 'gemini', 'groq', 'zai']);
            ai.setProvider(nxt);
            const label = { '': 'AUTO (Gemini → Groq → Z.ai)', gemini: 'GEMINI', groq: 'GROQ', zai: 'Z.AI' }[nxt];
            const hint = nxt && !ai.getKeys()[nxt] ? ' ⚠️ ඒ provider එකේ key නෑ — .setkey ' + nxt + ' <KEY>' : '';
            return `🤖 AI provider: ${label}${hint}`;
        }
        default: return null;
    }
}
async function handleSetting(send, jid, msg, arg) {
    const n = parseInt(arg, 10);
    if (n) {
        const done = applySetting(n);
        if (!done) return send(jid, { text: '❌ 1 – 10 අතර number එකක් reply කරන්න' }, { quoted: msg });
        await send(jid, { text: '✅ ' + done }, { quoted: msg });   // toggle confirm → පස්සේ panel refresh
    }
    const caption = settingCaption();
    const img = fs.existsSync(LOGO) ? LOGO : fs.existsSync(BANNER) ? BANNER : null;
    const sent = await send(jid, img ? { image: fs.readFileSync(img), caption } : { text: caption }, { quoted: msg });
    if (sent?.key?.id) settingState.set(jid, { id: sent.key.id, at: Date.now()});   // number replies → අලුත් panel එකටම
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

/** v2.41 — 🛡 BOT MODE panel: numbered bot modes 1-4 · AI chat 5/6 · AI modes 11-16 */
function modeCaption() {
    const cur = guard.chatMode(), aiOn = guard.aiChatOn(), aim = guard.aiMode();
    const mark = (x) => (x ? ' ✅' : '');
    return [
        '🛡 ≡ *BOT MODE PANEL* ≡ 🍁',
        '',
        `🍀 | *WORK TYPE:* ${cur.toUpperCase()}`,
        `🍀 | *AI CHAT:* ${aiOn ? 'ON ✅' : 'OFF ❌'} (${aim.replace(/_/g, ' ')})`,
        '',
        '⟶ *SELECT OPTION* 🌸',
        '',
        '» 🌐 *BOT MODES* 👇',
        `*1 |* Public Mode${mark(cur === 'public')} — හැමොටම use කරන්න පුළුවන්`,
        `*2 |* Private Mode${mark(cur === 'private')} — මට විතරයි`,
        `*3 |* Inbox Only${mark(cur === 'inbox')} — inbox වල විතරයි`,
        `*4 |* Groups Only${mark(cur === 'groups')} — groups වල විතරයි`,
        '',
        '» 🤖 *AI & TOOLS* 👇',
        `*5 |* Enable AI Chat${mark(aiOn)}`,
        `*6 |* Disable AI Chat${mark(!aiOn)}`,
        '',
        '» 🤖 *AI CHAT MODES* 👇',
        `*11 |* AI: Inbox Public (Everyone)${mark(aim === 'inbox_public')}`,
        `*12 |* AI: Inbox Self (Owner Only)${mark(aim === 'inbox_self')}`,
        `*13 |* AI: Inbox Private (Others Only)${mark(aim === 'inbox_private')}`,
        `*14 |* AI: Groups Only (Everyone)${mark(aim === 'groups_only')}`,
        `*15 |* AI: All (Inbox + Group + Bot)${mark(aim === 'all')}`,
        `*16 |* AI: All Public (No Bot Reply)${mark(aim === 'all_public')}`,
        '',
        foot('🔢 option එකේ number එක reply කරන්න'),
    ].join('\n');
}
const MODE_LABELS = { 1: '🌐 Public — හැමොටම (inbox + groups)', 2: '🔒 Private — මට විතරයි', 3: '💬 Inbox Only — inbox වල විතරයි', 4: '👥 Groups Only — groups වල විතරයි' };
async function handleMode(send, jid, msg, arg) {
    const n = parseInt(arg, 10);
    if (n >= 1 && n <= 4) {
        guard.setChatMode(['public', 'private', 'inbox', 'groups'][n - 1]);
        await send(jid, { text: '✅ mode: ' + MODE_LABELS[n] }, { quoted: msg });
    } else if (n === 5 || n === 6) {
        guard.setAiChat(n === 5);
        await send(jid, { text: n === 5 ? `✅ 🤖 AI Chat *ON* — mode: ${guard.aiMode().replace(/_/g, ' ')}` : '🚫 🤖 AI Chat *OFF*' }, { quoted: msg });
    } else if (n >= 11 && n <= 16) {
        guard.setAiMode(guard.AI_MODES[n - 11]);   // mode pick = AI chat ON
        await send(jid, { text: `✅ 🤖 AI mode: *${guard.aiMode().replace(/_/g, ' ')}* — AI Chat ON` }, { quoted: msg });
    } else if (['all', 'public'].includes(arg)) {
        guard.setChatMode('public');
        await send(jid, { text: '✅ mode: ' + MODE_LABELS[1] }, { quoted: msg });
    } else if (['self', 'private'].includes(arg)) {
        guard.setChatMode('private');
        await send(jid, { text: '✅ mode: ' + MODE_LABELS[2] }, { quoted: msg });
    } else if (arg === 'inbox' || arg === 'groups') {
        guard.setChatMode(arg);
        await send(jid, { text: '✅ mode: ' + MODE_LABELS[arg === 'inbox' ? 3 : 4] }, { quoted: msg });
    }
    const caption = modeCaption();
    const img = fs.existsSync(LOGO) ? LOGO : fs.existsSync(BANNER) ? BANNER : null;
    const sent = await send(jid, img ? { image: fs.readFileSync(img), caption } : { text: caption }, { quoted: msg });
    if (sent?.key?.id) modeState.set(jid, { id: sent.key.id, at: Date.now() });   // number replies → අලුත් panel එකටම
}

// ───────── .forward — reply කරපු message එක JID/number එකකට forward (owner-only, v2.42 rewrite) ─────────
// 2026 MD-bot proven forward shape (nova-md /save): sendMessage(t, { forward: {key:{remoteJid, id: stanzaId, participant}, message: quotedMessage}, force: true })
function unwrapCtx(m) {   // reply contextInfo එක wrapper එකක් ඇතුළේ හැංගිලා තියෙන්නත් පුළුවන් — getText() වගේම unwrap (v2.42 fix)
    let x = m;
    for (let i = 0; i < 6 && x; i++) {
        const ci = x.extendedTextMessage?.contextInfo || x.imageMessage?.contextInfo || x.videoMessage?.contextInfo || x.documentMessage?.contextInfo || x.audioMessage?.contextInfo || x.stickerMessage?.contextInfo;
        if (ci) return ci;
        x = x.deviceSentMessage?.message || x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.viewOnceMessageV2Extension?.message || x.editedMessage?.message;
    }
    return null;
}
async function handleForward(send, jid, msg, arg) {
    const ci = unwrapCtx(msg.message);
    const quoted = ci?.quotedMessage;
    if (!quoted) return send(jid, { text: '🧭 *FORWARD*\n\n✦ message එකකට reply කරලා *.forward <number|jid>*\n✦ උදා: *.forward 94771234567* · *.forward 9477…@g.us* · *.forward https://wa.me/9477…*\n✦ *.jid* — chat එකේ jid එක බලලා copy කරන්න\n\n> targets 5 දක්වා එකපාර' }, { quoted: msg });
    if (!arg) return send(jid, { text: '❌ target JID / number එක දෙන්න — උදා: *.forward 94771234567*\n> *.jid* — jid එක බලන්න' }, { quoted: msg });
    const norm = (t) => {
        t = String(t || '').trim();
        if (/^me$/i.test(t)) return ME.pn;
        const link = t.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?(\d{8,15})/i);   // wa.me / click-to-chat links
        if (link) return link[1].replace(/^0/, '94') + '@s.whatsapp.net';
        if (/@(g\.us|s\.whatsapp\.net|lid)$/i.test(t)) {
            if (t.toLowerCase().endsWith('@g.us')) return t;
            const user = t.split('@')[0].split(':')[0];   // device (:NN) suffix එකත් අයින් — v2.41 double-suffix bug fix (@lid@lid / @s.whatsapp.net@s.whatsapp.net)
            return user + (t.toLowerCase().endsWith('@lid') ? '@lid' : '@s.whatsapp.net');
        }
        const plain = t.replace(/[\s\-()]/g, '');   // "077-123 4567" වගේ ඒවත් ගන්න
        if (/^\+?\d{8,15}$/.test(plain)) return plain.replace(/^\+/, '').replace(/^0/, '94') + '@s.whatsapp.net';
        return null;
    };
    const allTargets = [...new Set(arg.split(/\s+/).filter(Boolean))];
    const targets = allTargets.slice(0, 5);
    const jids = []; const bad = []; const seenT = new Set();
    for (const t of targets) { const j = norm(t); if (!j) { bad.push(t); continue; } if (seenT.has(j)) continue; seenT.add(j); jids.push(j); }   // dedupe AFTER normalize (9477… = 077… = me)
    if (!jids.length) return send(jid, { text: '❌ JID / number වලින් දෙන්න — 947XXXXXXXX / xxx@g.us / xxx@lid / wa.me link' }, { quoted: msg });
    const fwd = { key: { remoteJid: jid, id: ci.stanzaId, participant: ci.participant || undefined }, message: quoted };   // stanzaId = quoted msg එකේම real id (fake fallback එක අයින් — v2.42)
    const st = await send(jid, { text: `🧭 forward වෙනවා → ${jids.length} target…` }, { quoted: msg });
    const out = [];
    const FT = parseInt(process.env.ARENA_FWD_TIMEOUT || '30000', 10);   // v2.43: hang-proof per-target send
    for (const t of jids) {
        const t0 = Date.now();
        let to; const win = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('forward send timeout (' + Math.round(FT / 1000) + 's)')), FT); });
        try {
            await Promise.race([SOCK.sendMessage(t, { forward: fwd, force: true }), win]);   // force → "Forwarded" label එක හැමවෙලාවෙම
            out.push(`✅ ${t}`); console.log('[forward] ✅ ' + t + ' (' + (Date.now() - t0) + 'ms)');
        } catch (e) {
            out.push(`❌ ${t} — ${String(e.message).slice(0, 60)}`); console.log('[forward] ❌ ' + t + ' — ' + String(e.message).slice(0, 80));
        } finally { clearTimeout(to); }
        await guard.sleep(600);   // anti-ban pace
    }
    if (bad.length) out.push(`⚠️ වලංගු නෑ: ${bad.join(', ')}`);
    if (allTargets.length > 5) out.push(`ℹ️ ඉතුරු ${allTargets.length - 5} ක් skip කළා (එකපාර max 5)`);
    const card = '🧭 *Forward*\n' + out.join('\n');
    try { await send(jid, { text: card, edit: st?.key }); } catch { await send(jid, { text: card }, { quoted: msg }); }   // edit fail → plain send (v2.42)
}

// ───────── 🤖 AI auto-chat (v2.41) — mode panel 5/6 + 11-16 වලින් control වෙනවා ─────────
const aiLast = new Map();   // chat jid → last AI auto-reply ts (per-chat 4s gap)
// ───────── .proxies — free proxy pool (stats / check / on / off) ─────────
function maybeAiReply({ msg, jid, text, owner, send }) {
    try {
        if (!text || text.length > 2000) return;
        const isGroup = jid.endsWith('@g.us');
        if (isGroup) {   // groups: @mention the bot or reply to a bot message only — any-text flood නෑ
            const ci = msg.message?.extendedTextMessage?.contextInfo;
            const mentioned = (ci?.mentionedJid || []).some((j) => bareJid(j) === ME.pn || bareJid(j) === ME.lid);
            const repliedToMe = ci?.participant && (bareJid(ci.participant) === ME.pn || bareJid(ci.participant) === ME.lid);
            if (!mentioned && !repliedToMe) return;
        }
        const selfChat = jid === ME.pn;
        if (!guard.aiAllowed(jid, owner, selfChat)) return;
        const k = ai.getKeys();
        if (!k.gemini && !k.groq && !k.zai) return;   // key නෑනම් silent — random texts වලට NO_KEY spam නෑ
        const now = Date.now(), last = aiLast.get(jid) || 0;
        if (now - last < 4000) return;
        aiLast.set(jid, now); if (aiLast.size > 200) aiLast.delete(aiLast.keys().next().value);
        runJob(async () => {
            const r = await ai.ask(jid, text);
            const out = (typeof r === 'string' ? r : r?.text || '').trim();
            if (out) await send(jid, { text: ai.splitLong(out)[0] });
            log(`🤖 AI chat → ${jid.slice(0, 24)}`);
        }).catch(() => { });
    } catch { }
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

*Z.ai (GLM):*
1. https://z.ai → API console → *API Keys* → key එක copy කරන්න
2. *.setkey zai ඔයාගේ_key*  (alias: *.setkey z.ai / glm*)

(එකක් fail වුණොත් අනිත් එක auto පාවිච්චි කරනවා — key දාලා තියෙන හැම provider එකක්ම try වෙනවා)`;

async function handleKey(send, del, jid, msg, c, rest) {
    const raw = (rest[0] || '').toLowerCase();
    const provider = (raw === 'z.ai' || raw === 'glm' || raw === 'z') ? 'zai' : raw; // Z.ai aliases
    if (!['gemini', 'groq', 'zai'].includes(provider)) return send(jid, { text: KEY_HELP }, { quoted: msg });
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

// ── ⏰ .remind — reminders (v2.51) — AI එකෙනුත් දාන්න පුළුවන් (.ai හෙට උදේ 8ට මතක් කරන්න...) ──
async function handleRemind(send, jid, msg, arg) {
    arg = String(arg || '').trim();
    if (!arg || /^(list|ls|\?)$/i.test(arg)) {
        const l = reminders.list(jid);
        if (!l.length) return send(jid, { text: `⏰ *REMINDERS*

✦ Active reminders නෑ

දාන්න: *.remind 10m බත් කාලා ඉන්න*
✦ *.remind 30s / 10m / 2h / 1d / 1h30m <note>*
✦ *.remind 08:30 <note>* — අද/හෙට ඒ වෙලාවට
✦ *.remind 2026-10-20 09:00 <note>*
🤖 නැත්නම් සිංහලෙන්ම — *.ai හෙට උදේ 8ට මතක් කරන්න ...*` }, { quoted: msg });
        const body = l.map((r, i2) => `${i2 + 1}. ${reminders.fmtWhen(r.at)}
   📝 ${r.note}`).join('\n');
        return send(jid, { text: `⏰ *REMINDERS* (${l.length})

${body}

> *.remind del <n>* — අයින් කරන්න` }, { quoted: msg });
    }
    if (/^(del|delete|rm|clear)/i.test(arg)) {
        const m = arg.match(/\d+/);
        if (m) { const r = reminders.del(jid, m[0]); return send(jid, { text: r ? `🗑️ Reminder අයින් කළා: ${r.note.slice(0, 80)}` : '❌ ඒ අංකේ reminder එකක් නෑ — *.remind list*' }, { quoted: msg }); }
        const n = reminders.clearAll(jid);
        return send(jid, { text: n ? `🗑️ Reminders ${n}ක්ම clear කළා` : '⚠️ Clear කරන්න reminders නෑ' }, { quoted: msg });
    }
    const m = arg.match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return send(jid, { text: '⏰ *.remind <time> <note>* — උදා: *.remind 10m බත් කාලා ඉන්න*' }, { quoted: msg });
    let note = m[2];
    let at = reminders.parseWhen(m[1]);
    if (!isFinite(at)) {   // "2026-10-20 09:00 note" — date + time වෙන වෙනම tokens
        const d2 = arg.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+([\s\S]+)$/);
        if (d2) { at = reminders.parseWhen(d2[1] + 'T' + d2[2]); note = d2[3]; }
    }
    if (!isFinite(at)) return send(jid, { text: `❌ Time එක තේරුම් ගන්න බෑ: ${m[1].slice(0, 30)}

✦ *.remind 30s/10m/2h/1d <note>*
✦ *.remind 08:30 <note>*
✦ *.remind 2026-10-20 09:00 <note>*` }, { quoted: msg });
    try {
        const r = reminders.add(jid, at, note, 'cmd');
        await send(jid, { text: `✅ Reminder දැම්මා!

⏰ ${reminders.fmtWhen(r.at)}
📝 ${r.note}` }, { quoted: msg });
        log(`⏰ reminder set: ${new Date(r.at).toISOString()} — ${r.note.slice(0, 50)}`);
    } catch (e) { await send(jid, { text: '❌ ' + e.message }, { quoted: msg }); }
}

// 👁 v2.51 — quoted photo/PDF එකක් download කරලා base64 (8MB cap) — vision path එකට
async function quotedMediaOf(msg) {
    try {
        const unwrap = (m) => m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message || m?.ephemeralMessage?.message || m;
        const own = unwrap(msg.message);
        const ctx = own?.extendedTextMessage?.contextInfo || own?.imageMessage?.contextInfo || own?.documentMessage?.contextInfo || own?.videoMessage?.contextInfo;
        const qm = ctx?.quotedMessage && unwrap(ctx.quotedMessage);
        if (!qm) return null;
        const im = qm.imageMessage, dm = qm.documentMessage;
        const mime = im ? (im.mimetype || 'image/jpeg') : (dm && /pdf/i.test(dm.mimetype || '') ? 'application/pdf' : null);
        if (!mime) return null;
        const fl = Number((im || dm).fileLength || 0);
        if (fl > 8 * 1048576) return null;   // Gemini inline safety cap
        const buf = await mediaDownloader({ key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant }, message: qm });
        if (!buf || buf.length < 100 || buf.length > 9 * 1048576) return null;
        return { mime, b64: Buffer.from(buf).toString('base64') };
    } catch { return null; }
}


async function handleAI(send, jid, msg, question) {
    question = question.trim();
    if (/^(memory|mem)$/i.test(question)) {
        const st = ai.stats(jid);
        return send(jid, { text: `🧠 *AI MEMORY*

✦ AUTO (shared): *${st.myMsgs}* messages${st.myMsgs ? ` — ${st.myOldestH}h ඉඳන් මතකයේ` : ''}
✦ Model stores — Gemini: ${st.myPerProv.gemini} · Groq: ${st.myPerProv.groq} · Z.ai: ${st.myPerProv.zai}
✦ Total: ${st.msgs} msgs · chats ${st.chats}ක් · file ${st.fileKB} KB
✦ Auto-clear: දවස් *${st.ttlDays}*ට පරණ messages මැකෙනවා
✦ Limit: chat එකක turns *${st.turns}*

💾 Bot restart වුණත් මතකය save වෙලා තියෙනවා · 🎛 .aiprovider එකෙන් select කරන model එකට වෙනම memory
🆕 *.ai reset* — models 3 ගේම මතක clear කරන්න` }, { quoted: msg });
    }
    const tm = question.match(/^tools?(?:\s+(on|off))?$/i); // 🧰 GLM connector tools (v2.50)
    if (tm) {
        if (!tm[1]) {
            const on = ai.getTools();
            return send(jid, { text: `🧰 *AI TOOLS* ${on ? '✅ ON' : '⛔ OFF'}

GLM (Z.ai) එකට connect වෙලා තියෙන abilities:
✦ *web search* — අලුත් facts / news
✦ *date/time + calculator*
✦ *image gen* — 🎨 photo / art / anime හදනවා
✦ *link read* — 📖 ඔයා දෙන link එකේ page එක කියවනවා
✦ *reminders* — ⏰ කියපු වෙලාවට මතක් කරනවා
✦ *weather* — කාළගුණය
✦ *YouTube search* — videos / ගීත

AI එකට ඕන වෙලාවට ම මේවා පාවිච්චි වෙනවා.
on/off: *.ai tools on* / *.ai tools off*` }, { quoted: msg });
        }
        const on = ai.setTools(tm[1].toLowerCase() === 'on');
        return send(jid, { text: `🧰 AI tools ${on ? '✅ ON' : '⛔ OFF'} — වැඩ කරන්නේ GLM (Z.ai) එකට විතරයි` }, { quoted: msg });
    }
    if (/^(reset|new|clear)$/i.test(question)) { ai.reset(jid); return send(jid, { text: '🆕 කතාව reset කළා. අලුතෙන් අහන්න!' }, { quoted: msg }); }
    // 👁 v2.51 — photo/PDF එකකට reply කරලා .ai → Gemini vision එකෙන් කියවනවා
    const att = await quotedMediaOf(msg);
    if (att) {
        if (!question) question = 'මේක මොකක්ද? පැහැදිලිව කියන්න.';
        const status = await send(jid, { text: '👁 බලනවා... (Gemini vision)' }, { quoted: msg });
        try {
            const { text, model } = await ai.askVision(jid, question, att);
            await send(jid, { text: text + `\n\n${foot('ᴀɪ')}`, edit: status.key });
            reactTo(msg.key, '✅');
            log(`👁 ${model}: ${question.slice(0, 50)} → ${String(text).replace(/\s+/g, ' ').slice(0, 70)}`);
        } catch (e) {
            reactTo(msg.key, '❌');
            const hint = e.noGemini ? '\n👁 Vision වැඩ කරන්නේ Gemini එකෙන් — *.setkey gemini <KEY>*' : '';
            await send(jid, { text: `❌ ${String(e.message).slice(0, 200)}${hint}\n> photo/PDF එකකට reply කරලා *.ai <ප්‍රශ්නය>*`, edit: status.key });
            log('❌ AI vision: ' + e.message);
        }
        return;
    }

    const q = quotedText(msg);
    if (q) question = question ? `${question}\n\n"""${q}"""` : `මේ message එක ගැන පැහැදිලි කරන්න:\n"""${q}"""`;
    if (!question) return send(jid, { text: '🤖 *.ai <ප්‍රශ්නය>*\nඋදා: .ai GTA SA වල cheats මොනවද?' }, { quoted: msg });
    const status = await send(jid, { text: '🤖 හිතනවා...' }, { quoted: msg });
    try {
        const { text, model, images } = await ai.ask(jid, question);
        if (images?.length) {   // 🖼 AI tool image (generate_image) — photo + reply text එකම caption
            try { await send(jid, { delete: status.key }); } catch { }
            await send(jid, { image: images[0], caption: text + `\n\n${foot('ᴀɪ')}` }, { quoted: msg });
            for (let i2 = 1; i2 < Math.min(images.length, 3); i2++) await send(jid, { image: images[i2] }, { quoted: msg });
        } else {
            const parts = ai.splitLong(text);
            await send(jid, { text: parts[0] + (parts.length === 1 ? `\n\n${foot('ᴀɪ')}` : ''), edit: status.key });
            for (let i2 = 1; i2 < parts.length; i2++) await send(jid, { text: parts[i2] + (i2 === parts.length - 1 ? `\n\n${foot('ᴀɪ')}` : '') });
        }
        log(`🤖 ${model}: ${question.slice(0, 60)} → ${String(text).replace(/\s+/g, ' ').slice(0, 80)}`);
    } catch (e) {
        if (e.noKey) return send(jid, { text: '⚠️ AI key එකක් තවම දාලා නෑ.\n\n' + KEY_HELP, edit: status.key });
        reactTo(msg.key, '❌');
        await send(jid, { text: `❌ ${String(e.message).slice(0, 200)}\n> *.keys* — key check · ටිකකින් ආයෙත් try`, edit: status.key });
        log('❌ AI: ' + e.message);
    }
}

let updating = false;
let JOBS = 0;   // 🔄 heavy jobs in flight (download/moviedex/AI/…) — auto-update idle වෙනකම් ඉන්නවා
const runJob = async (fn) => { JOBS++; try { return await fn(); } finally { JOBS--; } };

/** shared update routine — manual *.update* සහ auto-update දෙකම මේකම පාවිච්චි කරනවා (v2.31).
 *  up-to-date නම් {updated:false} return කරනවා; install success → process exit(100) → launcher restart. */
async function runUpdate({ send, jid, force = false, auto = false, reactOk }) {
    const status = await send(jid, { text: auto ? '🤖 Auto-update — 🔍 අලුත් version බලනවා...' : '🔍 Update තියෙනවද බලනවා...' });
    const edit = async (t) => { try { await send(jid, { text: t, edit: status.key }); } catch { } };
    try {
        const r = await updater.apply({ force, onStatus: edit });
        if (!r.updated) { updating = false; await edit(`✅ v${r.current.version} — up to date`); return r; }
        if (reactOk) { try { reactOk(); } catch { } }
        await edit(`✅ v${r.from} → *v${r.to}*\n📝 ${r.notes}\n${foot('🔄 restart වෙනවා — තත්පර 10 කින් *.ping*')}`);
        log(`🔄 Updated v${r.from} → v${r.to} — restarting${auto ? ' (auto)' : ''}`);
        if (!process.env.ARENA_LAUNCHER) await send(jid, { text: '⚠️ Bot එක *npm start* එකෙන් start කරලා නැති නිසා auto restart වෙන්නේ නෑ. Termux එකේ CTRL+C කරලා *npm start* ගහන්න.' });
        try { fs.writeFileSync(ANNOUNCE_NEXT, '1'); } catch { }   // show the online card after restart
        setTimeout(() => process.exit(100), 2500);
    } catch (e) {
        updating = false;
        await edit(`❌ ${String(e.message).slice(0, 200)}\n> පරණ version එක එහෙමම වැඩ`);
        log('❌ update: ' + e.message);
        throw e;
    }
}

async function handleUpdate(send, jid, msg, force) {
    if (updating) return send(jid, { text: '⏳ Update එකක් දැනටමත් වෙනවා...' }, { quoted: msg });
    updating = true;
    try { const r = await runUpdate({ send, jid, force, reactOk: () => reactTo(msg.key, '✅') }); if (r) reactTo(msg.key, '✅'); }
    catch { reactTo(msg.key, '❌'); }
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
module.exports = { _agentTick: agentTick, AGENT_MSG, handleDownload, getText, onMessages, replyJid, ME, aliveCaption, OWNER_CMDS, modeCaption, handleForward, maybeAiReply, _aiLast: aiLast, _setMediaDownloader: (f) => { mediaDownloader = f; }, _setSock: (x) => { SOCK = x; } };
if (require.main === module) {
    console.log('🚀 KAVIZ MD V1 starting...');
    require('./media').checkUpdate(true).catch(() => { });   // yt-dlp fresh → FB "Cannot parse data" / YT format errors fix (max 1 check/hour)
    require('./proxypool').warmup();                          // free-proxy pool check in background (net.js / yt-dlp fallback)
    reminders.start({ getSock: () => SOCK, log });               // ⏰ reminders scheduler (v2.51)
    start().catch((e) => { log('Startup fail: ' + e.message); process.exit(1); });
}
