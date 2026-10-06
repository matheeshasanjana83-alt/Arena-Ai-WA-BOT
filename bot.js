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

const AUTH = path.join(__dirname, 'auth');
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

const HELP = `🤖 *Arena AI*

*.ai <ප්‍රශ්නය>*  — AI එකෙන් අහන්න (සිංහල OK)
  • message එකකට reply කරලා *.ai* ගැහුවොත් ඒ message එක ගැන අහනවා
  • *.ai reset* — කතාව අලුතෙන් පටන් ගන්න
*.download <link>*  — file එක download කරලා එවනවා (*.dl*)
  • links කිහිපයක් එකට: .download link1 link2
*.setkey gemini <KEY>*  /  *.setkey groq <KEY>*  — free API key දාන්න
*.keys*  — keys තියෙනවද බලන්න
*.net <link>*  — download fail නම් හේතුව බලන්න (DNS / IP block)
*.setproxy <url|off>*  — block වෙන sites වලට proxy
*.update*  — bot එක GitHub එකෙන් update කරන්න (pair කරන්න ඕනේ නෑ)
*.version*  — දැන් තියෙන version එක
*.ping*  — bot එක වැඩද බලන්න

📥 Download support: direct links, GitHub, Google Drive, MediaFire, MEGA, Dropbox, Pixeldrain, litterbox/catbox, x0.at, filebin...
📏 Max: ${human(MAX_BYTES)} per file`;

let botStatus = 'starting';
if (process.env.SERVER_PORT || process.env.ARENA_ON_PANEL) {
    try {
        require('http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ bot: 'Arena AI', status: botStatus, number: ME.pn, uptime: Math.floor(process.uptime()) })); })
            .on('error', () => { }).listen(parseInt(process.env.SERVER_PORT || '3000', 10), '0.0.0.0');
    } catch { }
}
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
    sock.ev.on('creds.update', saveCreds);

    const send = async (jid, content, opts) => {
        const s = await sock.sendMessage(jid, content, opts);
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
            if (announced) return;
            announced = true;
            try { await send(ME.pn, { text: '✅ *Arena AI online!*\n\n' + HELP }); } catch { }
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                log('❌ Logged out (device එක unlink කළා). Session එක මකලා නවත්තනවා — ආයෙත් npm start කරලා pair කරන්න.');
                fs.rmSync(AUTH, { recursive: true, force: true });
                process.exit(0);
            }
            log(`⚠️ Connection වැහුණා (${code ?? '?'}) — තත්පර 3 කින් ආයෙත් connect වෙනවා...`);
            pairingAsked = code === 515 ? pairingAsked : false;
            setTimeout(() => start().catch(e => log('start error: ' + e.message)), 3000);
        }
    });

    sock.ev.on('messages.upsert', (u) => onMessages(u, send, (key) => sock.sendMessage(key.remoteJid, { delete: key }).catch(() => { })));
}

async function onMessages({ messages, type }, send, del = async () => { }) {
        for (const msg of messages || []) {
            try {
                remember(msg);
                if (msg.key?.fromMe && !msg.message && msg.messageStubType) log(`⚠️ message එකක් decrypt කරගන්න බැරි වුණා (stub ${msg.messageStubType}) — phone එකෙන් ආයෙත් එවයි`);
                if (!msg.message || !msg.key?.fromMe) continue;        // 🔒 PRIVATE: only messages YOU send
                if (sentIds.has(msg.key.id) || seen.has(msg.key.id)) continue; // own replies / already handled
                const ts = Number(msg.messageTimestamp || 0);
                if (type !== 'notify' && ts && ts < STARTED - 60) continue;   // old history — don't re-run old commands
                seen.add(msg.key.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
                const text = getText(msg.message);
                if (!text.startsWith('.')) continue;
                const jid = replyJid(msg.key);
                log(`📩 command: ${text.slice(0, 60)}  (${type})  ${msg.key.remoteJid}${jid !== msg.key.remoteJid ? ' → ' + jid : ''}`);
                msg.key = { ...msg.key, remoteJid: jid };   // quote/delete with the normalized chat jid too
                const [cmd, ...rest] = text.split(/\s+/);
                const c = cmd.toLowerCase();

                if (c === '.ping') { await send(jid, { text: '🏓 Pong! Arena AI වැඩ ✅' }, { quoted: msg }); continue; }
                if (c === '.help' || c === '.menu') { await send(jid, { text: HELP }, { quoted: msg }); continue; }
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
                if (!['.download', '.dl', '.dn'].includes(c)) continue;

                const links = (text.match(/https?:\/\/\S+/g) || []).slice(0, 10);
                if (!links.length) { await send(jid, { text: HELP }, { quoted: msg }); continue; }
                for (const link of links) await handleDownload(send, jid, msg, link);
            } catch (e) { log('handler error: ' + e.message); }
        }
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
        if (now - last < 4000) return;
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
module.exports = { handleDownload, getText, onMessages, replyJid, ME };
if (require.main === module) {
    console.log('🚀 Arena AI starting...');
    start().catch((e) => { log('Startup fail: ' + e.message); process.exit(1); });
}
