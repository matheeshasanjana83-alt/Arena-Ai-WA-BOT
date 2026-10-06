// npm test  → simulated WhatsApp messages (no real account needed)
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_RATE_MIN = '1000'; process.env.ARENA_RATE_HOUR = '10000';
const fs = require('fs');
const { onMessages, getText } = require('./bot');
let n = 0, ok = 0, bad = 0;
const t = (name, cond) => { cond ? ok++ : bad++; console.log(`  ${cond ? '✅' : '❌'} ${name}`); };
const ME = '94771234567@s.whatsapp.net';
const mk = (text, fromMe = true, jid = ME) => ({ key: { id: 'IN' + (++n), remoteJid: jid, fromMe }, message: { conversation: text } });
(async () => {
    const out = [];
    const send = async (jid, c) => { const e = { jid, ...c }; if (c.document) { e.size = fs.statSync(c.document.url).size; e.exists = true; } out.push(e); return { key: { id: 'OUT' + (++n) } }; };
    const run = async (msg) => { out.length = 0; await onMessages({ type: 'notify', messages: [msg] }, send); return out; };

    let r = await run(mk('.ping')); t('.ping → Pong', r.length === 1 && /Pong/.test(r[0].text));
    r = await run(mk('.ping', false, '94770000000@s.whatsapp.net')); t('🔒 වෙන කෙනෙක් .ping → ignore', r.length === 0);
    r = await run(mk('.download https://x0.at/D07z.zip', false, '120363@g.us')); t('🔒 group එකේ වෙන කෙනෙක් .download → ignore', r.length === 0);
    r = await run(mk('hello')); t('සාමාන්‍ය message → ignore', r.length === 0);
    r = await run(mk('.download')); t('.download link නැතුව → help', r.length === 1 && /Arena AI/.test(r[0].text));
    r = await run(mk('.download https://raw.githubusercontent.com/matheeshasanjana83-alt/abc/main/downloads/Joystick-Layout-NoCLEO-v1.zip'));
    const doc = r.find(x => x.document);
    t('.download GitHub → document එවනවා', !!doc && doc.fileName === 'Joystick-Layout-NoCLEO-v1.zip' && doc.size === 3127);
    t('progress/status edit message', r.some(x => x.edit && /ඉවරයි/.test(x.text)));
    t('temp file එක delete වෙනවා', await new Promise(res => setTimeout(() => res(!fs.existsSync(doc.document.url)), 300)));
    r = await run(mk('.dl https://raw.githubusercontent.com/matheeshasanjana83-alt/abc/main/downloads/Joystick-Layout-NoCLEO-v1.zip https://github.com/matheeshasanjana83-alt/abc/blob/main/downloads/SmokeBoy.zip'));
    t('.dl links 2ක් → documents 2ක්', r.filter(x => x.document).length === 2);
    r = await run(mk('.download https://www.google.com/')); t('web page link → පැහැදිලි error', r.some(x => x.edit && /web page/.test(x.text)) && !r.some(x => x.document));
    t('getText: extendedTextMessage', getText({ extendedTextMessage: { text: ' .ping ' } }) === '.ping');
    t('getText: ephemeral wrapper', getText({ ephemeralMessage: { message: { conversation: '.dl x' } } }) === '.dl x');

    // ───────── v2.1 fixes ─────────
    const ap = mk('.ping'); r = await (async () => { out.length = 0; await onMessages({ type: 'append', messages: [ap] }, send); return out; })();
    t("type 'append' (phone එකෙන් එන) .ping → වැඩ", r.some(x => /Pong/.test(x.text || '')));
    r = await (async () => { out.length = 0; await onMessages({ type: 'notify', messages: [ap] }, send); return out; })();
    t('එකම message එක දෙපාරක් ආවොත් → එක පාරයි', r.length === 0);
    const old = mk('.ping'); old.messageTimestamp = Math.floor(Date.now() / 1000) - 3600;
    r = await (async () => { out.length = 0; await onMessages({ type: 'append', messages: [old] }, send); return out; })();
    t('පැයකට කලින් history .ping (append) → run කරන්නේ නෑ', r.length === 0);
    const ds = mk(''); ds.message = { deviceSentMessage: { destinationJid: ME, message: { conversation: '.ping' } } };
    r = await run(ds); t('deviceSentMessage wrapper → .ping වැඩ', r.some(x => /Pong/.test(x.text || '')));

    // ───────── v2.3: self-chat reply JID ("Waiting for this message" fix) ─────────
    const { replyJid, ME: me } = require('./bot');
    me.pn = '94760552994@s.whatsapp.net'; me.lid = '35189220741167@lid';
    t('self chat device LID → phone JID', replyJid({ remoteJid: '35189220741167:0@lid' }) === me.pn);
    t('self chat device PN → bare phone JID', replyJid({ remoteJid: '94760552994:0@s.whatsapp.net' }) === me.pn);
    t('self chat LID + alt → phone JID', replyJid({ remoteJid: '35189220741167@lid', remoteJidAlt: '94760552994@s.whatsapp.net' }) === me.pn);
    t('other @lid chat with PN alt → PN', replyJid({ remoteJid: '1234567890123@lid', remoteJidAlt: '94771112222@s.whatsapp.net' }) === '94771112222@s.whatsapp.net');
    t('group jid unchanged', replyJid({ remoteJid: '120363000@g.us' }) === '120363000@g.us');
    out.length = 0;
    await onMessages({ type: 'notify', messages: [{ key: { id: 'LID1', remoteJid: '35189220741167:0@lid', fromMe: true }, message: { conversation: '.ping' } }] }, send);
    t('.ping from device-LID self chat → reply sent to phone JID', out.length > 0 && out.every(x => x.jid === me.pn));
    me.pn = null; me.lid = null;

    // ───────── v2.6: .setproxy / .net ─────────
    {
        const fs = require('fs'), sp = require('path').join(__dirname, 'settings.json');
        const had = fs.existsSync(sp) ? fs.readFileSync(sp) : null;
        const run = async (txt) => { out.length = 0; await onMessages({ type: 'notify', messages: [{ key: { id: 'P' + Math.random(), remoteJid: '94771234567@s.whatsapp.net', fromMe: true }, message: { conversation: txt } }] }, send, async () => { }); return out.map(x => x.text || '').join('\n'); };
        t('.setproxy bad format → error', /Format/.test(await run('.setproxy socks5://1.2.3.4')));
        await run('.setproxy http://u:p@10.0.0.1:8080');
        t('.setproxy saves proxy', JSON.parse(fs.readFileSync(sp, 'utf8')).proxy === 'http://u:p@10.0.0.1:8080');
        t('.setproxy hides password', /\*\*\*@/.test(await run('.setproxy')));
        await run('.setproxy off');
        t('.setproxy off removes', !JSON.parse(fs.readFileSync(sp, 'utf8')).proxy);
        t('.net without link → help', /\.net <link>/.test(await run('.net')));
        if (had) fs.writeFileSync(sp, had); else fs.rmSync(sp, { force: true });
    }

    // ───────── AI tests (fake Gemini/Groq servers) ─────────
    const ai = require('./ai');
    const realFetch = global.fetch; const calls = [];
    let geminiMode = 'ok';
    global.fetch = async (url, opt) => {
        url = String(url);
        if (url.includes('generativelanguage') || url.includes('api.groq.com')) {
            const body = JSON.parse(opt.body); calls.push({ url, body });
            const J = (st, o) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
            if (url.includes('generativelanguage')) {
                if (geminiMode === 'down') return J(503, { error: { message: 'overloaded' } });
                if (geminiMode === 'oldmodel' && url.includes('gemini-flash-latest')) return J(404, { error: { message: 'models/gemini-flash-latest is not found' } });
                const last = body.contents.at(-1).parts[0].text;
                return J(200, { candidates: [{ content: { parts: [{ text: `## උත්තරය\n**හායි!** ඔයා ඇහුවේ: ${last} (turns=${body.contents.length})` }] } }] });
            }
            return J(200, { choices: [{ message: { content: 'Groq answer ✅' } }] });
        }
        return realFetch(url, opt);
    };
    const fs2 = require('fs'); const SET = require('path').join(__dirname, 'settings.json');
    const backup = fs2.existsSync(SET) ? fs2.readFileSync(SET) : null; try { fs2.unlinkSync(SET); } catch { }
    delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
    const deleted = [];
    const run2 = async (msg) => { out.length = 0; await onMessages({ type: 'notify', messages: [msg] }, send, async (k) => deleted.push(k.id)); return out; };

    r = await run2(mk('.ai hello')); t('.ai key නැතුව → key ගන්න විදිය කියනවා', r.some(x => /aistudio\.google\.com/.test(x.text || '')));
    const km = mk('.setkey gemini AIzaSyTESTKEY1234567890abcdef'); r = await run2(km);
    t('.setkey gemini → save + message එක මකනවා', ai.getKeys().gemini === 'AIzaSyTESTKEY1234567890abcdef' && deleted.includes(km.key.id) && r.some(x => /save/.test(x.text)));
    r = await run2(mk('.keys')); t('.keys → key එක mask කරලා පෙන්නනවා', r.some(x => /AIza••••def/.test(x.text || '')) && !r.some(x => /TESTKEY/.test(x.text || '')));
    r = await run2(mk('.ai GTA cheats මොනවද?'));
    const ans = r.find(x => x.edit && /උත්තරය/.test(x.text || ''));
    t('.ai → Gemini උත්තරය (edit)', !!ans && /GTA cheats/.test(ans.text));
    t('markdown → WhatsApp (*bold*, heading)', !!ans && /\*හායි!\*/.test(ans.text) && /^\*උත්තරය\*/.test(ans.text) && !/\*\*/.test(ans.text));
    t('system prompt = Arena AI', calls.at(-1).body.systemInstruction.parts[0].text.includes('Arena AI'));
    r = await run2(mk('.ai තව කියන්න')); t('memory: 2nd question එකට කලින් කතාව යවනවා (turns=3)', r.some(x => /turns=3/.test(x.text || '')));
    r = await run2(mk('.ai reset')); r = await run2(mk('.ai අලුත් එකක්')); t('.ai reset → memory clear (turns=1)', r.some(x => /turns=1/.test(x.text || '')));
    const qm = mk('.ai'); qm.message = { extendedTextMessage: { text: '.ai', contextInfo: { quotedMessage: { conversation: 'Hello world message' } } } };
    r = await run2(qm); t('message එකකට reply කරලා .ai → ඒ message එක ගැන අහනවා', r.some(x => /Hello world message/.test(x.text || '')));
    geminiMode = 'oldmodel'; calls.length = 0; r = await run2(mk('.ai test'));
    t('Gemini model එක නැත්නම් ඊළඟ model එකට යනවා', calls.length === 2 && calls[1].url.includes('gemini-2.5-flash') && r.some(x => /gemini-2\.5-flash/.test(x.text || '')));
    geminiMode = 'down'; r = await run2(mk('.ai test')); t('Gemini down + Groq key නෑ → error message', r.some(x => /AI error/.test(x.text || '')));
    await run2(mk('.setkey groq gsk_TESTKEY1234567890abcdefgh')); r = await run2(mk('.ai test'));
    t('Gemini down → Groq එකෙන් උත්තරය (fallback)', r.some(x => /Groq answer/.test(x.text || '')));
    r = await run2(mk('.ai hi', false, '94770000000@s.whatsapp.net')); t('🔒 වෙන කෙනෙක් .ai → ignore', r.length === 0);
    t('long answer split', ai.splitLong('a'.repeat(8000)).length === 3);
    try { fs2.unlinkSync(SET); } catch { } if (backup) fs2.writeFileSync(SET, backup);
    global.fetch = realFetch;

    // ───────── v2.8: owner-only + anti-ban ─────────
    {
        const guard = require('./guard');
        const { ME: me2 } = require('./bot');
        me2.pn = ME; me2.lid = '35189220741167@lid';
        delete process.env.ARENA_CHATS;
        const sp = require('path').join(__dirname, 'settings.json');
        const had = fs.existsSync(sp) ? fs.readFileSync(sp) : null;
        try { const d = had ? JSON.parse(had) : {}; delete d.chats; fs.writeFileSync(sp, JSON.stringify(d)); } catch { }
        r = await run(mk('.ping')); t('🔒 mode self: Message yourself .ping → Pong', r.some(x => /Pong/.test(x.text || '')));
        r = await run(mk('.ping', true, '94770000000@s.whatsapp.net')); t('🔒 mode self: මම යාලුවෙක්ගේ chat එකේ .ping → ignore (එතන reply නෑ)', r.length === 0);
        r = await run(mk('.ping', true, '120363@g.us')); t('🔒 mode self: group එකේ මගේ .ping → ignore', r.length === 0);
        r = await run(mk('.mode all')); t('.mode all → confirm', r.some(x => /Mode: all/.test(x.text || '')));
        r = await run(mk('.ping', true, '94770000000@s.whatsapp.net')); t('🔓 mode all: මගේ command වෙන chat එකක → වැඩ', r.some(x => /Pong/.test(x.text || '')));
        r = await run(mk('.ping', false, '94770000000@s.whatsapp.net')); t('🔒 mode all: යාලුවා .ping → තාමත් ignore', r.length === 0);
        const spoof = mk('.ping', true, '120363@g.us'); spoof.key.participant = '94779999999@s.whatsapp.net';
        r = await run(spoof); t('🔒 group: fromMe කියලා ආවත් participant වෙන කෙනෙක් → ignore', r.length === 0);
        const mineG = mk('.ping', true, '120363@g.us'); mineG.key.participant = '35189220741167:3@lid';
        r = await run(mineG); t('mode all: group එකේ මගේ LID participant → වැඩ', r.some(x => /Pong/.test(x.text || '')));
        r = await run(mk('.ping', true, 'status@broadcast')); t('status@broadcast → ignore', r.length === 0);
        r = await run(mk('.mode self')); t('.mode self → confirm', r.some(x => /Mode: self/.test(x.text || '')));
        r = await run(mk('.ping', true, '94770000000@s.whatsapp.net')); t('.mode self ආපහු → වෙන chat ignore', r.length === 0);
        // rate limit
        process.env.ARENA_RATE_MIN = '3'; guard._hits.length = 0;
        const res = []; for (let i = 0; i < 5; i++) { out.length = 0; await onMessages({ type: 'notify', messages: [mk('.ping')] }, send); res.push(out.map(x => x.text).join('|')); }
        t('🛡️ rate limit: විනාඩියට 3 → 4 වෙනි එකට warning, 5 වෙනි එකට කිසිම reply එකක් නෑ', /Pong/.test(res[2]) && /ඉක්මනට/.test(res[3]) && res[4] === '');
        process.env.ARENA_RATE_MIN = '1000'; guard._hits.length = 0;
        t('🙈 maskLog: setkey', guard.maskLog('.setkey gemini AIzaSyABCDEFGHIJKLMNOP') === '.setkey gemini ••••');
        t('🙈 maskLog: proxy password', guard.maskLog('.setproxy http://user:pw@1.2.3.4:80') === '.setproxy http://***@1.2.3.4:80');
        t('🛡️ backoff grows + capped', guard.backoff(0) < 6000 && guard.backoff(3) >= 24000 && guard.backoff(20) <= 302000);
        let ran = 0; const pc = guard.pacer(150); const t0 = Date.now(); await Promise.all([1, 2, 3].map(() => pc(async () => ran++)));
        t('🛡️ pacer: messages එකින් එක gap එකක් එක්ක', ran === 3 && Date.now() - t0 >= 280);
        const d0 = guard.shouldAnnounce(), d1 = guard.shouldAnnounce(); t('🛡️ online message පැය 6 කට එක පාරයි', d1 === false);
        if (had) fs.writeFileSync(sp, had); else try { fs.unlinkSync(sp); } catch { }
        me2.pn = null; me2.lid = null;
    }

    console.log(bad ? `\n⚠️ ${ok} passed, ${bad} failed` : `\n🎉 ALL ${ok} TESTS PASSED`);
    process.exit(bad ? 1 : 0);
})();
