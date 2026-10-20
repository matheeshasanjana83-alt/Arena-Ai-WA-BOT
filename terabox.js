/**
 * terabox.js — ☁️ TeraBox downloader (v2.84.0)
 * Port of abhinai2244/TeraBox-Dl contract (its Bun API = share page → jsToken → /share/list → dlink).
 * LIVE-PROBED 2026-10-20: anonymous jsToken + share/list work (errno 0, metadata + signed thumbs);
 * dlink ONLY comes back with a valid ndus session cookie (anon /share/download = errno 400310
 * "need verify_v2" — there is no anonymous path; every serious implementation needs ndus).
 *   .terabox <link>            → info card (name · size · resolution · duration) → file
 *   .terabox <N> / go <N>      → folder share: pick a file from the list card
 *   .tbcookie <ndus> / off / '' → owner-only: save · clear · status (LIVE-verified on save)
 * Cookie lives in settings.json "teraboxNdus" — read by resolvers.js for every *.terabox.* URL,
 * so plain .download <terabox-link> also works once the cookie is set.
 */
const fs = require('fs');
const path = require('path');
const { smartFetch } = require('./net');
const { foot } = require('./style');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const SETTINGS = path.join(__dirname, 'settings.json');
// repo ALLOWED_HOSTS + the sibling domains terabox serves share links on
const HOST_RE = /^(?:[\w-]+\.)*(?:terabox\.app|terabox\.com|teraboxshare\.com|1024terabox\.com|teraboxlink\.com|4funbox\.com|mirrobox\.com|nephobox\.com)$/i;
const TTL = 30 * 60e3;
const CAP = 40;
const CARD_MAX = 15;
const VERIFY_SURL = '1HSEb8PZRUE7Z1Tvd3ZtT0g';   // repo README's example share — LIVE (errno 0, 2026-10-20)

let fetcher = (u, h) => smartFetch(u, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(30e3) });
const setFetcher = (f) => { const prev = fetcher; fetcher = f; return prev; };   // returns previous → restore pattern

// ── ndus cookie (settings.json "teraboxNdus") ──
function readNdus() { try { return String(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).teraboxNdus || '').trim(); } catch { return ''; } }
function saveNdus(v) {
    let d; try { d = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { d = {}; }
    d.teraboxNdus = String(v || '').trim();
    fs.writeFileSync(SETTINGS, JSON.stringify(d, null, 2));
}
const clearNdus = () => saveNdus('');

// ── share link → surl (/s/<surl> path or ?surl= param) ──
function surlOf(link) {
    let u; try { u = new URL(String(link).trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || !HOST_RE.test(u.hostname)) return null;
    return u.searchParams.get('surl') || (u.pathname.match(/\/s\/([A-Za-z0-9_-]{6,})/) || [])[1] || null;
}

// ── share page → jsToken (per-page token; no cache — the page load is ~300 ms) ──
async function jsToken(surl) {
    const r = await fetcher(`https://www.terabox.app/sharing/link?surl=${encodeURIComponent(surl)}`, { 'User-Agent': UA });
    const t = await r.text();
    const m = t.match(/fn%28%22(.*?)%22%29/);   // URL-encoded fn("<token>") in the page bundle
    if (!m) throw new Error('TeraBox jsToken එක හම්බුණේ නෑ — site එක දැන් verification check එකක් දාලා වෙන්න පුළුවන්');
    return m[1];
}

// ── share/list (repo contract: app_id 250528, shorturl = surl minus leading "1", root=1) ──
async function shareList(surl) {
    const ndus = readNdus();
    const token = await jsToken(surl);
    const short = surl.startsWith('1') ? surl.slice(1) : surl;
    const u = new URL('https://www.terabox.app/share/list');
    for (const [k, v] of Object.entries({ app_id: '250528', web: '1', channel: 'dubox', clienttype: '0', jsToken: token, shorturl: short, root: '1' })) u.searchParams.append(k, v);
    const h = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest', Referer: `https://www.terabox.app/sharing/link?surl=${surl}` };
    if (ndus) h.Cookie = `ndus=${ndus}`;
    const r = await fetcher(u.toString(), h);
    const j = await r.json();
    if (j.errno !== 0 && j.errno !== '0') throw new Error(`TeraBox errno ${j.errno} — link එක delete වෙලා / private / වැරදියි`);
    const files = (j.list || []).filter((it) => String(it.isdir) !== '1').map((it) => ({
        fsId: String(it.fs_id || ''),
        name: it.server_filename || String(it.path || 'file').split('/').pop(),
        bytes: parseInt(it.size, 10) || 0,
        dlink: it.dlink || '',   // only populated when the ndus cookie is valid
        thumb: (it.thumbs && (it.thumbs.url3 || it.thumbs.url2 || it.thumbs.url1)) || '',
        duration: parseInt(it.duration, 10) || 0,
        w: parseInt(it.width, 10) || 0, h: parseInt(it.height, 10) || 0,
    }));
    return { surl, title: j.title || '', uk: String(j.uk || ''), shareId: String(j.share_id || ''), files, hasCookie: !!ndus };
}

// ── formatting ──
const human = (b) => !b ? '?' : b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const dur = (s) => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
const qres = (h) => !h ? '' : h >= 2000 ? '4K' : h >= 1400 ? '2K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h >= 450 ? '480p' : h >= 350 ? '360p' : h + 'p';
const COOKIE_HELP = '🔑 download කරන්න ndus cookie එකක් ඕනේ:\n1. terabox.com login කරන්න (browser)\n2. F12 → Application → Cookies → ndus value එක copy\n3. *.tbcookie <ndus>* ගහන්න';

function infoCard(info) {
    const fl = info.files;
    if (fl.length === 1) {
        const f = fl[0];
        return `☁️ *TeraBox*\n📄 ${String(f.name).slice(0, 90)}\n📦 ${human(f.bytes)}${f.h ? ' · 🎬 ' + qres(f.h) : ''}${f.duration ? ' · ⏱ ' + dur(f.duration) : ''}\n\n${f.dlink ? '⬇️ එවනවා…' : COOKIE_HELP}`;
    }
    return `☁️ *TeraBox*${info.title ? `\n📁 ${String(info.title).slice(0, 80)}` : ''}\n📦 files: ${fl.length}\n\n${fl.slice(0, CARD_MAX).map((f, i) => `${i + 1}. ${String(f.name).slice(0, 55)}\n    ${human(f.bytes)}${f.h ? ' · ' + qres(f.h) : ''}${f.duration ? ' · ' + dur(f.duration) : ''}`).join('\n')}${fl.length > CARD_MAX ? `\n… +${fl.length - CARD_MAX} තව` : ''}\n\n${info.hasCookie ? '> file එකක අංකය *reply* කරන්න හෝ *.terabox go <N>*' : COOKIE_HELP + '\n> cookie set නැතුව list එක විතරයි පේන්නේ'}`;
}

const TB_USAGE = `☁️ *TeraBox* — *.terabox <link>*
උදා: \`.terabox https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g\`

✦ file link → details card → file එක එවනවා
✦ folder link → file list → අංකය *reply* කරන්න / *.terabox go <N>*
✦ cookie: *.tbcookie <ndus>* · status: *.tbcookie*${foot('terabox.app · teraboxshare.com · 1024terabox.com')}`;

// ── sessions (folder picks) ──
const sessions = new Map();
const gcSessions = () => {
    for (const [k, s] of sessions) if (Date.now() - (s.at || 0) > TTL) sessions.delete(k);
    if (sessions.size > CAP) sessions.delete(sessions.keys().next().value);
};

async function goFile(send, jid, msg, n, download) {
    gcSessions();
    const s = sessions.get(jid);
    if (!s || !s.files?.length) return send(jid, { text: '⏳ session expire වෙලා — *.terabox <link>* ආයෙත් ගහන්න' }, { quoted: msg });
    const f = s.files[n - 1];
    if (!f) return send(jid, { text: `❌ ${n} — file එකක් නෑ (1-${s.files.length})` }, { quoted: msg });
    if (!f.dlink) return send(jid, { text: '🔑 මේ file එකේ dlink එක එන්නේ නෑ — ndus cookie එක valid ද බලන්න (*.tbcookie <ndus>*)' }, { quoted: msg });
    if (!download) return send(jid, { text: `🔗 ${f.dlink}` }, { quoted: msg });   // download fn නෑ (tests / fallback) → link එකම
    sessions.delete(jid);
    await download(f.dlink, '☁️ TeraBox');   // handleDownload → resolve(dlink) → Cookie header → file
    return true;
}

async function handle(c, ctx) {
    if (c !== '.terabox') return false;
    const { send, jid, msg, rest, react, download } = ctx;
    const arg = rest.join(' ').trim();

    const mNum = arg.match(/^(?:go\s+)?(\d{1,3})$/i);   // .terabox 2 / .terabox go 2 — digit from the CAPTURE, not parseInt(arg) ('go 2' → NaN)
    if (mNum) return goFile(send, jid, msg, parseInt(mNum[1], 10), download);
    if (!arg) return send(jid, { text: TB_USAGE }, { quoted: msg });

    const link = (arg.match(/https?:\/\/\S+/) || [])[0];
    const surl = link && surlOf(link);
    if (!surl) return send(jid, { text: '❌ මේක TeraBox link එකක් නෙවෙයි\n\n✦ terabox.app / teraboxshare.com / 1024terabox.com /s/… link එකක් එවන්න\n✦ අනිත් sites: *.download <link>*' }, { quoted: msg });

    const st = await send(jid, { text: '☁️ TeraBox link එක බලනවා…' }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const info = await shareList(surl);
        if (!info.files.length) return await edit('❌ TeraBox share එකේ download කරන්න පුළුවන් files නෑ (හිස් folder එකක් / folder ඇතුළෙ තව folders)');
        gcSessions();
        sessions.set(jid, { files: info.files, surl, at: Date.now(), cardId: null });
        react?.('⚡');
        const single = info.files.length === 1;
        const cap = infoCard(info);
        if (single && info.files[0].thumb) {
            try {
                const im = await send(jid, { image: { url: info.files[0].thumb }, caption: cap }, { quoted: msg });
                sessions.get(jid).cardId = im?.key?.id || null;
                try { await send(jid, { delete: st.key }); } catch { }   // progress bubble අයින් — image card එකම ඇති
                if (info.files[0].dlink && download) { sessions.delete(jid); await download(info.files[0].dlink, '☁️ TeraBox'); }
                return true;
            } catch { }   // thumb send fail → text card එකට
        }
        await edit(cap);
        sessions.get(jid).cardId = st.key?.id || null;   // text card = edited progress bubble
        if (single && info.files[0].dlink && download) { sessions.delete(jid); await download(info.files[0].dlink, '☁️ TeraBox'); }
        return true;
    } catch (e) {
        return await edit('❌ ' + String(e.message || e).slice(0, 180));
    }
}

// numeric quote bridge (bot.js chain) — card එකට QUOTE කරපු number එක → '.terabox go N'
function bridge(jid, qid, digits) {
    const s = sessions.get(jid);
    if (!s || !s.files?.length) return null;
    if (Date.now() - (s.at || 0) > TTL + 30 * 60e3) return null;
    const d = parseInt(digits, 10);
    if (!Number.isFinite(d) || d < 1) return null;
    if (qid && s.cardId && String(qid) !== String(s.cardId)) return null;   // 🔒 reply-only
    return '.terabox go ' + d;
}

// ── .tbcookie (owner-only — bot.js OWNER_CMDS gate) ──
async function cmdCookie(send, jid, msg, arg) {
    const a = (arg || '').trim();
    if (!a) {
        const cur = readNdus();
        return send(jid, { text: `🔑 TeraBox cookie: ${cur ? '✅ set (' + cur.slice(0, 6) + '…)' : '❌ නෑ'}\n\n*.tbcookie <ndus>* — cookie එක set (LIVE verify කරනවා)\n*.tbcookie off* — අයින් කරන්න\n\n${COOKIE_HELP}` }, { quoted: msg });
    }
    if (/^off$/i.test(a)) { clearNdus(); return send(jid, { text: '🗑️ TeraBox cookie එක අයින් කළා' }, { quoted: msg }); }
    saveNdus(a);
    try {
        const info = await shareList(VERIFY_SURL);   // LIVE verify — dlink only comes with a valid cookie
        const ok = info.files.length > 0 && !!info.files[0].dlink;
        return send(jid, { text: ok ? '✅ TeraBox cookie set + LIVE verify OK (dlink එනවා)\n☁️ දැන් *.terabox <link>* files download කරන්න පුළුවන්' : '⚠️ cookie එක save කළා, නමුත් dlink එක එන්නේ නෑ — cookie එක expire වෙලා / වැරදියි. අලුත් ndus එකක් අරගෙන *.tbcookie <ndus>*' }, { quoted: msg });
    } catch (e) {
        return send(jid, { text: '⚠️ cookie save වුණා, verify fail: ' + String(e.message || e).slice(0, 140) }, { quoted: msg });
    }
}

module.exports = {
    handle, bridge, cmdCookie, surlOf, jsToken, shareList, infoCard,
    readNdus, saveNdus, clearNdus, setFetcher, HOST_RE, TTL, TB_USAGE, _sessions: sessions,
};
