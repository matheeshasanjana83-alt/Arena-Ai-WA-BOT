/**
 * pairsite.js — KAVIZ MD V1 v2.29 web pairing site (zero dependencies).
 *
 * One HTTP server on the panel port that serves FIVE things:
 *   GET  /                      → pair page (number එක දාන්න → pairing code)
 *   GET  /abc                   → 📦 v2.57 uploaded-files list (abc/ folder)
 *   GET  /abc/<name>            → 📦 v2.57 download one file (path-traversal safe)
 *   GET  /status                → old JSON status (panel health check — v2.28 behavior kept)
 *   GET  /pair?number=…&key=…   → request a pairing code (JSON)
 *
 * Security:
 *   - key required for /pair — settings.json "pairKey" (auto-generated & printed once)
 *     or env PAIR_KEY.  /?key=… pre-fills the form.
 *   - pairing only possible while the session is NOT registered (fresh / after logout).
 *   - 1 request / 10s / IP rate limit.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS = path.join(__dirname, 'settings.json');
const hits = new Map();                       // ip → ts (rate limit)

function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) || {}; } catch { return {}; } }
function saveSettings(d) { try { fs.writeFileSync(SETTINGS, JSON.stringify(d, null, 2)); } catch { } }

/** the pair key — env PAIR_KEY wins, else settings.json, else auto-generate (kept) */
function pairKey() {
    const env = String(process.env.PAIR_KEY || '').trim();
    if (env) return env;
    const s = readSettings();
    if (s.pairKey && /^[A-Za-z0-9]{4,32}$/.test(String(s.pairKey))) return String(s.pairKey);
    const k = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);   // 8 chars
    s.pairKey = k; saveSettings(s);
    return k;
}

/** "077 123 4567" / "+94 77…" / "9477…" → "9477…" (Sri Lanka aware, generic) */
function normNumber(raw) {
    let n = String(raw || '').replace(/\D/g, '');
    if (n.startsWith('0') && n.length === 10) n = '94' + n.slice(1);      // 0771234567 → 94771234567
    if (n.length < 9 || n.length > 15) return '';
    return n;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─────────────────────────── page ─────────────────────────── */
function page(key) {
    return `<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex">
<title>KAVIZ MD V1 — Pair</title>
<style>
  :root { --bg:#0b0e14; --card:#141824; --line:#232a3d; --tx:#e8ecf4; --dim:#8b93a7; --ac:#ffb454; --ok:#3fd68f; --err:#ff6b6b; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--tx); font-family:system-ui,'Noto Sans',sans-serif; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:32px 16px; }
  .wrap { width:100%; max-width:430px; }
  h1 { font-size:20px; text-align:center; letter-spacing:1px; }
  .sub { text-align:center; color:var(--dim); font-size:13px; margin-top:4px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; margin-top:18px; }
  label { display:block; font-size:12px; color:var(--dim); margin:14px 0 6px; text-transform:uppercase; letter-spacing:1px; }
  input { width:100%; background:#0d1119; border:1px solid var(--line); border-radius:10px; color:var(--tx); padding:13px 14px; font-size:16px; outline:none; }
  input:focus { border-color:var(--ac); }
  button { width:100%; margin-top:16px; background:var(--ac); border:0; border-radius:10px; color:#1a1205; font-size:16px; font-weight:700; padding:14px; cursor:pointer; }
  button:disabled { opacity:.55; cursor:wait; }
  .status { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--dim); margin-top:16px; justify-content:center; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--dim); }
  .dot.on { background:var(--ok); box-shadow:0 0 8px var(--ok); }
  .dot.err { background:var(--err); }
  #msg { margin-top:14px; font-size:14px; line-height:1.7; text-align:center; display:none; }
  .ok { color:var(--ok); } .err { color:var(--err); }
  #code { display:none; font-size:34px; font-weight:800; letter-spacing:6px; text-align:center; margin-top:18px; color:var(--ac); user-select:all; }
  .steps { margin-top:18px; font-size:13px; color:var(--dim); line-height:2; }
  .steps b { color:var(--tx); }
  footer { margin-top:26px; color:var(--dim); font-size:12px; text-align:center; opacity:.7; }
</style>
</head>
<body>
<div class="wrap">
  <h1>◈ ＫＡＶＩＺ ＭＤ Ｖ1 ◈</h1>
  <div class="sub">WhatsApp pairing site</div>

  <div class="card">
    <div class="status"><span class="dot" id="dot"></span><span id="st">status බලනවා…</span></div>

    <label>📱 WhatsApp number</label>
    <input id="num" type="tel" inputmode="tel" placeholder="077 123 4567 / 9477…" autocomplete="tel">

    <button id="go" onclick="pair()">🔢 Pairing code එක ගන්න</button>

    <div id="code"></div>
    <div id="msg"></div>

    <div class="steps">
      <b>1.</b> Code එක ලැබුණාම — WhatsApp open කරන්න<br>
      <b>2.</b> <b>Settings → Linked devices → Link a device</b><br>
      <b>3.</b> <b>"Link with phone number instead"</b> තෝරලා code එක ගහන්න
    </div>
  </div>

  <footer>⚡ ᴋᴀᴠɪᴢ ᴍᴅ ᴠ1 · private bot</footer>
</div>
<script>
const $ = (i) => document.getElementById(i);
const SERVER_KEY = '${esc(key)}';   // embedded at render — /pair එකට auto යනවා (field එකක් ඕන නෑ)
let timer = null;
function dot(k, t) { $('dot').className = 'dot ' + k; $('st').textContent = t; }
async function poll() {
  try {
    const r = await fetch('/status'); const j = await r.json();
    if (j.status === 'open') dot('on', '🟢 Bot online — session එක හදලා තියෙනවා (re-pair ඕන නම් unlink කරන්න)');
    else if (j.status === 'connecting' || j.status === 'starting') dot('', '🟡 ' + j.status + ' — pair කරන්න පුළුවන්');
    else dot('', '⚪ ' + j.status);
  } catch { dot('err', '🔴 Bot එක ළඟා වෙන්න බෑ'); }
}
async function pair() {
  const num = $('num').value.trim(), key = SERVER_KEY;
  const b = $('go'); b.disabled = true; b.textContent = '⏳ ඉල්ලනවා…';
  $('msg').style.display = 'none'; $('code').style.display = 'none';
  try {
    const r = await fetch('/pair?number=' + encodeURIComponent(num) + '&key=' + encodeURIComponent(key));
    const j = await r.json();
    if (j.ok && j.code) {
      $('code').textContent = j.code; $('code').style.display = 'block';
      $('msg').innerHTML = '<span class="ok">✅ Code එක ලැබුණා! ඉහත පියවර 3 කරන්න — විනාඩියක් ඇතුළත ගහන්න.</span>';
      $('msg').style.display = 'block';
    } else {
      $('msg').innerHTML = '<span class="err">❌ ' + (j.error || 'fail') + '</span>'; $('msg').style.display = 'block';
    }
  } catch { $('msg').innerHTML = '<span class="err">❌ Network error</span>'; $('msg').style.display = 'block'; }
  b.disabled = false; b.textContent = '🔢 Pairing code එක ගන්න';
}
poll(); timer = setInterval(poll, 5000);
</script>
</body>
</html>`;
}

/* ─────────────────────────── server ─────────────────────────── */
function json(r, code, obj) { r.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); r.end(JSON.stringify(obj)); }

/** request a code — real logic, testable without HTTP */
async function requestPair(rawNum, key, deps) {
    const { getSock, getKey } = deps;
    if (!key || String(key) !== String(getKey())) return { ok: false, error: '❌ Pair key වැරදියි — key එක console එකේ print වෙලා තියෙනවා' };
    const num = normNumber(rawNum);
    if (!num) return { ok: false, error: '❌ Number එක හරි නෑ (උදා: 0771234567 හෝ 94771234567)' };
    const sock = getSock();
    if (!sock) return { ok: false, error: '⏳ Bot එක තාම start වෙනවා — ටිකක් ඉන්න ආයෙ try කරන්න' };
    let registered = false;
    try { registered = !!sock.authState?.creds?.registered; } catch { }
    if (registered) return { ok: false, error: '✅ Bot එක දැනටමත් pair වෙලා! අලුතෙන් pair කරන්න ඕන නම් WhatsApp → Linked devices → unlink කරලා restart කරන්න' };
    let code;
    for (let i = 0; i < 3 && !code; i++) {
        try { code = await sock.requestPairingCode(num); }
        catch (e) { if (i === 2) return { ok: false, error: '❌ Pairing fail: ' + (e?.message || e) }; await new Promise(r2 => setTimeout(r2, 2500)); }
    }
    if (!code) return { ok: false, error: '❌ Code එකක් ලැබුණේ නෑ — ටිකක් ඉන්න ආයෙ try කරන්න' };
    return { ok: true, code: String(code).match(/.{1,4}/g).join('-'), number: num };
}

/* ─────────────────── 📦 v2.57: /abc/ file host (path-traversal safe) ─────────────────── */
const ABC_DIR = path.join(__dirname, 'abc');
const ABC_TYPES = {
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.zip': 'application/zip', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.enc': 'application/octet-stream', '.env': 'application/octet-stream'
};
function abcList() {
    try { return fs.readdirSync(ABC_DIR).filter(f => !f.startsWith('.')).sort(); } catch { return []; }
}
/** name → basename only; kills ../ ..\ encoded tricks (Linux + win backslash both) */
function safeAbcName(name) {
    let s = String(name || '');
    try { s = decodeURIComponent(s); } catch { }
    if (/[\/\\]|\.\./.test(s)) return '';
    s = path.basename(s);
    return (s === '.' || s === '..') ? '' : s;   // basename('.') = '.' → reject
}
function serveAbc(r, name) {
    const safe = safeAbcName(name);
    if (!safe || safe.startsWith('.')) { r.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return r.end('not found'); }
    let data = null;
    try {
        const full = path.join(ABC_DIR, safe);
        if (fs.statSync(full).isFile()) data = fs.readFileSync(full);
    } catch { }
    if (!data) { r.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return r.end('not found'); }
    const ext = path.extname(safe).toLowerCase();
    const head = { 'Content-Type': ABC_TYPES[ext] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache' };
    if (ext === '.zip') head['Content-Disposition'] = 'attachment; filename="' + safe.replace(/"/g, '') + '"';
    r.writeHead(200, head);
    return r.end(data);
}
function abcPage() {
    const rows = abcList().map(f => {
        let sz = 0; try { sz = fs.statSync(path.join(ABC_DIR, f)).size; } catch { }
        const kb = sz >= 1024 ? (sz / 1024).toFixed(1) + ' KB' : sz + ' B';
        return '<tr><td><a href="/abc/' + encodeURIComponent(f) + '">' + esc(f) + '</a></td><td class="s">' + kb + '</td></tr>';
    }).join('') || '<tr><td colspan="2" class="s">(empty)</td></tr>';
    return `<!DOCTYPE html>
<html lang="si"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>KAVIZ MD — Files</title>
<style>
  body{background:#0b0e14;color:#e8ecf4;font-family:system-ui,'Noto Sans',sans-serif;display:flex;justify-content:center;padding:32px 16px;margin:0}
  .card{width:100%;max-width:520px;background:#141824;border:1px solid #232a3d;border-radius:14px;padding:22px}
  h1{font-size:18px;margin:0 0 4px}.sub{color:#8b93a7;font-size:12.5px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  td{padding:9px 6px;border-top:1px solid #232a3d}
  a{color:#ffb454;text-decoration:none;word-break:break-all}a:hover{text-decoration:underline}
  .s{color:#8b93a7;font-size:12px;text-align:right;white-space:nowrap}
  .home{display:inline-block;margin-top:16px;color:#8b93a7;font-size:12.5px}
</style></head><body><div class="card">
<h1>📦 Uploaded Files</h1>
<div class="sub">KAVIZ MD V1 — /abc/ file host</div>
<table>${rows}</table>
<a class="home" href="/">← Pair page</a>
</div></body></html>`;
}

/** start the server — deps: { status:()=>obj, getSock:()=>sock|null, log:(t)=>void } */
function start(deps) {
    const d = { port: parseInt(process.env.SERVER_PORT || process.env.PORT || '3000', 10), ...deps };
    const KEY = pairKey();
    const srv = http.createServer(async (q, r) => {
        try {
            const url = new URL(q.url, 'http://x');
            if (url.pathname === '/status') return json(r, 200, d.status ? d.status() : { bot: 'KAVIZ MD V1', status: 'unknown', uptime: Math.floor(process.uptime()) });
            if (url.pathname === '/logs') {   // 🗒️ v2.43: recent console output (pair-key gated) — remote debugging
                if (String(url.searchParams.get('key') || '') !== String(KEY)) return json(r, 403, { ok: false, error: 'wrong key' });
                r.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                return r.end((d.logs ? d.logs() : '') || '(empty)');
            }
            if (url.pathname === '/pair') {
                const ip = (q.socket?.remoteAddress || '').replace(/^::ffff:/, '');
                const keyOk = String(url.searchParams.get('key') || '') === String(KEY);
                if (keyOk) {                              // ⏳ expensive path only (wrong-key spam stays cheap)
                    const now = Date.now(), last = hits.get(ip) || 0;
                    if (now - last < 10000) return json(r, 429, { ok: false, error: '⏳ ටිකක් ඉන්න (10s) ආයෙ try කරන්න' });
                }
                const out = await requestPair(url.searchParams.get('number'), url.searchParams.get('key'), { getSock: d.getSock, getKey: () => KEY });
                if (out.ok) { hits.set(ip, Date.now()); if (hits.size > 500) hits.clear(); }
                else if (/key/i.test(out.error || '')) d.log && d.log(`🌐 pairsite: wrong pair key from ${ip}`);
                else d.log && d.log(`🌐 pairsite: ${out.error}`);
                return json(r, out.ok ? 200 : 400, out);
            }
            if (url.pathname === '/diag') {   // 🩺 v2.63: MovieBox remote diagnostics (pair-key gated — runs INSIDE the panel network)
                if (String(url.searchParams.get('key') || '') !== String(KEY)) return json(r, 403, { ok: false, error: 'wrong key' });
                const out = { at: new Date().toISOString(), node: process.version };
                // ① panel egress identity (IP + ASN/geo)
                out.egress = {};
                for (const svc of ['https://api.ipify.org?format=json', 'https://ipinfo.io/json']) {
                    const k = svc.includes('ipify') ? 'ip' : 'info';
                    try { out.egress[k] = await (await fetch(svc, { signal: AbortSignal.timeout(8000) })).json(); }
                    catch (e) { out.egress[k] = String(e.message).slice(0, 60); }
                }
                // ② proxy pool state
                try { out.pool = require('./proxypool').stats(); } catch (e) { out.pool = { err: String(e.message).slice(0, 60) }; }
                // ③ per-host visitor-login probe (fresh identity each — is the edge blocking us per-host?)
                const mv = require('./moviedex');
                out.hosts = [];
                for (const host of mv.MB_HOSTS) {
                    const h = host.replace('https://', '');
                    try {
                        mv.mbIdentity();
                        const u = host + '/wefeed-mobile-bff/user-api/visitor-login';
                        const t0 = Date.now();
                        const rr = await fetch(u, { method: 'POST', headers: mv.mbHeaders('POST', u, '{}'), body: '{}', signal: AbortSignal.timeout(10000) });
                        const tt = await rr.text().catch(() => '');
                        out.hosts.push({ h, s: rr.status, tok: rr.ok && tt.includes('"token"'), ms: Date.now() - t0 });
                    } catch (e) { out.hosts.push({ h, err: String(e.message).slice(0, 60) }); }
                }
                // ④ fresh login + RAW search (the exact call that 406s for users)
                try {
                    out.login = { ok: await mv.mbLogin(2) };
                    if (out.login.ok) {
                        const u = mv.MB_HOSTS[0] + '/wefeed-mobile-bff/subject-api/search/v2';
                        const body = JSON.stringify({ keyword: 'black clover', page: 1, perPage: 20, subjectType: 0 });
                        const t0 = Date.now();
                        const rr = await fetch(u, { method: 'POST', headers: mv.mbHeaders('POST', u, body), body, signal: AbortSignal.timeout(15000) });
                        const tt = await rr.text().catch(() => '');
                        out.rawSearch = { s: rr.status, body: tt.slice(0, 90), ms: Date.now() - t0 };
                    }
                } catch (e) { out.login = { err: String(e.message).slice(0, 110) }; }
                // ⑤ the full user-facing search + WHY-did-fallback-not-fire probes
                try { out.plan = mv.mbDispatchers().map(x => x.kind === 'proxy' ? { kind: 'proxy', url: x.url.replace(/^https?:\/\//, '').slice(0, 22) } : { kind: x.kind }); } catch (e) { out.plan = String(e.message).slice(0, 60); }
                try {
                    const t0 = Date.now();
                    const list = await mv.mbSearch('black clover', 3);
                    out.mbSearch = { ok: true, rows: list.length, ms: Date.now() - t0, first: list[0] ? `${list[0].name} [${list[0].type}]` : null };
                } catch (e) { out.mbSearch = { ok: false, err: String(e.message).slice(0, 130) }; }
                out.mbStateAfter = mv._mbState ? mv._mbState() : null;
                // ⑤b TOKEN THEORY: registered token via proxy vs fresh-visitor via direct
                try {
                    const undici2 = require('undici');
                    const pp2 = require('./proxypool');
                    const cand = pp2.candidates(1)[0];
                    if (cand) {
                        const ag = new undici2.ProxyAgent({ uri: /^https?:\/\//.test(cand) ? cand : 'http://' + cand, connect: { timeout: 8000 } });
                        const su = mv.MB_HOSTS[0] + '/wefeed-mobile-bff/subject-api/search/v2';
                        const body = JSON.stringify({ keyword: 'black clover', page: 1, perPage: 20, subjectType: 0 });
                        const sh = mv.mbHeaders('POST', su, body);   // mbPickToken → REGISTERED token
                        const sr = await undici2.fetch(su, { method: 'POST', headers: sh, body, dispatcher: ag, signal: AbortSignal.timeout(15000) });
                        const st = await sr.text().catch(() => '');
                        out.regTokenViaProxy = { s: sr.status, hits: (st.match(/"subjectId"/g) || []).length, body: st.slice(0, 70) };
                        // fresh visitor via DIRECT (is the block IP-side for fresh tokens too?)
                        mv.mbIdentity();
                        await mv.mbLogin(1);
                        const dh = mv.mbHeaders('POST', su, body); delete dh.Authorization;   // pure anon-visitor semantics… keep mbToken if just issued
                        const dr = await fetch(su, { method: 'POST', headers: mv.mbHeaders('POST', su, body), body, signal: AbortSignal.timeout(15000) });
                        const dt = await dr.text().catch(() => '');
                        out.freshVisitorDirect = { s: dr.status, hits: (dt.match(/"subjectId"/g) || []).length, body: dt.slice(0, 70) };
                    } else out.regTokenViaProxy = 'no pool candidate';
                } catch (e) { out.regTokenViaProxy = String(e.message).slice(0, 80); }
                // ⑤c CDN-IP-BINDING probe: a proxy-issued direct MP4 link fetched DIRECT (the bot's real download path)
                try {
                    const rows = await mv.mbDirectRows('3380137095141441488', 1, 124);
                    const row360 = rows.find(r => r.h === 360) || rows[0];
                    if (row360) {
                        const rid = row360.direct?.rid || row360.resourceId;   // v2.46 row shape: rid lives under direct{}
                        const link = await mv.mbDirectUrl('3380137095141441488', 1, 124, rid);
                        const dr = await fetch(link, { headers: { 'User-Agent': 'okhttp/4.9.3', Range: 'bytes=0-32767' }, signal: AbortSignal.timeout(20000) });
                        await dr.body?.cancel().catch(() => { });
                        out.cdnDirectFetch = { s: dr.status, ct: (dr.headers.get('content-type') || '').slice(0, 30), cr: dr.headers.get('content-range') };
                    } else out.cdnDirectFetch = 'no rows';
                } catch (e) { out.cdnDirectFetch = String(e.message).slice(0, 110); }
                // ⑥ proxy A/B — login + search through pool proxies (datacenter-IP-block theory, panel vantage)
                try {
                    const undici = require('undici');
                    const pp = require('./proxypool');
                    await pp.ensureReady(15000);
                    out.proxyAB = [];
                    for (const p of pp.candidates(3)) {
                        const ps = String(p).replace(/^https?:\/\//, '').slice(0, 22);
                        const row = { p: ps };
                        try {
                            mv.mbIdentity();
                            const agent = new undici.ProxyAgent({ uri: /^https?:\/\//.test(p) ? p : 'http://' + p, connect: { timeout: 8000 } });
                            const u = mv.MB_HOSTS[0] + '/wefeed-mobile-bff/user-api/visitor-login';
                            const lh = mv.mbHeaders('POST', u, '{}'); delete lh.Authorization;   // anonymous login (mbLogin convention)
                            const rr = await undici.fetch(u, { method: 'POST', headers: lh, body: '{}', dispatcher: agent, signal: AbortSignal.timeout(12000) });
                            const tt = await rr.text().catch(() => '');
                            row.login = rr.status;
                            let ptok = null;
                            try { ptok = (JSON.parse(tt)?.data || {}).token || null; } catch { }
                            if (rr.ok && ptok) {
                                pp.markGood(p);
                                const su = mv.MB_HOSTS[0] + '/wefeed-mobile-bff/subject-api/search/v2';
                                const body = JSON.stringify({ keyword: 'black clover', page: 1, perPage: 20, subjectType: 0 });
                                const sh = mv.mbHeaders('POST', su, body);
                                sh.Authorization = 'Bearer ' + ptok;   // the token THIS proxy IP was issued → clean region test
                                const sr = await undici.fetch(su, { method: 'POST', headers: sh, body, dispatcher: agent, signal: AbortSignal.timeout(15000) });
                                const st = await sr.text().catch(() => '');
                                row.search = sr.status;
                                row.hits = st.includes('"subjectId"') ? (st.match(/"subjectId"/g) || []).length : 0;
                                row.body = st.slice(0, 60);
                            } else pp.markBad(p);
                        } catch (e) { row.err = String(e.message).slice(0, 50); pp.markBad(p); }
                        out.proxyAB.push(row);
                    }
                } catch (e) { out.proxyAB = String(e.message).slice(0, 80); }
                // ⑦ YT probe (?yt=1|<url>) — .song 403 / .video menu speed ground truth (panel vantage)
                const ytQ = url.searchParams.get('yt');
                if (ytQ) {
                    out.yt = { url: ytQ === '1' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : ytQ };
                    try {
                        const media = require('./media');
                        const bin = await media.getBin('yt-dlp');
                        out.yt.version = (await media._run(bin, ['--version'], 15e3)).out.trim();
                        const U = out.yt.url;
                        // ① info timing (the .video/.song quality-menu path) — 200s watchdog, real time recorded
                        const t0 = Date.now();
                        out.yt.info = await Promise.race([
                            media.info(U).then((i) => ({ ok: true, ms: Date.now() - t0, formats: (i.formats || []).length, title: String(i.title || '').slice(0, 40) }))
                                .catch((e) => ({ ok: false, ms: Date.now() - t0, err: String(e.message).slice(0, 150) })),
                            new Promise((res) => setTimeout(() => res({ timeout: '200s (still running — this is the 4-min menu bug)' }), 200e3)),
                        ]);
                        // ② per-client AUDIO download probes (the .song path) — parallel, 4 MB cap each
                        const clients = {
                            default: [], alt: ['--extractor-args', 'youtube:player_client=web_safari,tv,mweb'],
                            tv_simply: ['--extractor-args', 'youtube:player_client=tv_simply'], ios: ['--extractor-args', 'youtube:player_client=ios'],
                            android: ['--extractor-args', 'youtube:player_client=android'],
                        };
                        const fs2 = require('fs'), os2 = require('os'), path2 = require('path');
                        const tmpd = os2.tmpdir();
                        out.yt.audio = {};
                        await Promise.all(Object.entries(clients).map(async ([name, ea]) => {
                            const t1 = Date.now();
                            const pref = path2.join(tmpd, `diagyt-${name}-${Date.now().toString(36)}`);
                            try {
                                const args = ['--no-playlist', '--no-warnings', '--no-part', '--socket-timeout', '15', '--retries', '1',
                                    '--js-runtimes', `node:${process.execPath}`,   // 🧠 v2.66 — probe the FIXED path
                                    '--max-filesize', '4M', '-f', 'bestaudio[ext=m4a]/bestaudio', '-o', pref + '.%(ext)s', ...ea, U];
                                const rr = await media._run(bin, args, 150e3);
                                const got = fs2.readdirSync(tmpd).filter((f) => f.startsWith(path2.basename(pref) + '.'));
                                out.yt.audio[name] = {
                                    ok: rr.code === 0 && got.length > 0, ms: Date.now() - t1,
                                    err: rr.code !== 0 ? (String(rr.err || rr.out).split('\n').filter((l) => /error/i.test(l)).pop() || 'fail').slice(0, 130) : '',
                                };
                                for (const f of got) { try { fs2.rmSync(path2.join(tmpd, f), { force: true }); } catch { } }
                            } catch (e) { out.yt.audio[name] = { ok: false, ms: Date.now() - t1, err: String(e.message).slice(0, 100) }; }
                        }));
                        // ③ clipto fallback probe (API + 32 KB of the audio URL)
                        const t2 = Date.now();
                        try {
                            const rr = await fetch('https://www.clipto.com/api/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.clipto.com/' }, body: JSON.stringify({ url: U }), signal: AbortSignal.timeout(40e3) });
                            const jj = await rr.json().catch(() => null);
                            const aud = (jj?.medias || []).find((m) => /audio/.test(m.mimeType || ''));
                            let dl = null;
                            if (aud) { const d2 = await fetch(aud.url, { headers: { Range: 'bytes=0-32767' }, signal: AbortSignal.timeout(15e3) }); await d2.body?.cancel().catch(() => { }); dl = d2.status; }
                            out.yt.clipto = { ok: !!aud, ms: Date.now() - t2, audDl: dl, err: jj ? '' : 'json fail' };
                        } catch (e) { out.yt.clipto = { ok: false, ms: Date.now() - t2, err: String(e.message).slice(0, 100) }; }
                        // ④ ?yt=<url> verbose download probe — WHY does the real .video/.song download 403?
                        // captures the yt-dlp --verbose tail (player client, EJS/nsig, PO token, HTTP 403) + JS runtime availability
                        if (ytQ !== '1') {
                            out.yt.verbose = {};
                            try {
                                const which = await media._run('/bin/sh', ['-c', 'command -v deno; command -v node; node --version 2>/dev/null'], 10e3);
                                out.yt.verbose.runtime = (which.out || '').trim() || 'none-in-PATH';
                                out.yt.verbose.execPath = process.execPath;   // 🧠 v2.66 — what JSRT() feeds --js-runtimes
                                const t3 = Date.now();
                                const args = ['--no-playlist', '--no-warnings', '--verbose', '--no-part', '--socket-timeout', '15', '--retries', '1',
                                    '--js-runtimes', `node:${process.execPath}`,   // 🧠 v2.66 — probe the FIXED path
                                    '--max-filesize', '3M', '-f', 'best[height<=480][ext=mp4]/best[height<=480]/bestaudio', '-o', path2.join(tmpd, 'diagytv-%(ext)s'), U];
                                const rr = await media._run(bin, args, 120e3);
                                const got3 = fs2.readdirSync(tmpd).filter((f) => f.startsWith('diagytv-'));
                                const lines = String(rr.err || '') + '\n' + String(rr.out || '');
                                const pick = lines.split('\n').filter((l) => /player|ejs|nsig|sig|po.?token|403|forbidden|error|deno|node|runtime|fetch|sabr/i.test(l));
                                out.yt.verbose.dl = { code: rr.code, ok: got3.length > 0, ms: Date.now() - t3, tail: pick.slice(-28).map((l) => l.slice(0, 160)) };
                                for (const f of got3) { try { fs2.rmSync(path2.join(tmpd, f), { force: true }); } catch { } }
                            } catch (e) { out.yt.verbose.err = String(e.message).slice(0, 100); }
                        }
                    } catch (e) { out.yt.err = String(e.message).slice(0, 100); }
                }
                // ⑨ ?yti=<url|1> — youtubei.js (Innertube) client matrix: info + audio-download probe per client
                if (url.searchParams.get('yti')) {
                    out.yti = {};
                    try {
                        const ytiMod = require('./yti');
                        const U2 = url.searchParams.get('yti') === '1' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : url.searchParams.get('yti');
                        out.yti.evalPatched = (() => { try { const { Platform } = require('youtubei.js'); ytiMod._patchEval(); return !!Platform.shim.__kzEval; } catch (e) { return 'no-pkg'; } })();
                        const clientsY = ['WEB', 'TV', 'IOS', 'ANDROID'];
                        const fs3 = require('fs'), os3 = require('os'), path3 = require('path');
                        const tmpd3 = os3.tmpdir();
                        out.yti.clients = {};
                        await Promise.all(clientsY.map(async (ct) => {
                            const t1 = Date.now();
                            try {
                                const lib = require('youtubei.js');
                                const ytc = await lib.Innertube.create({ client_type: ct });
                                const m3 = String(U2).match(ytiMod.ID_RE);
                                const inf = await ytc.getBasicInfo(m3 ? m3[1] : 'dQw4w9WgXcQ');
                                const st = inf.playability_status?.status || 'OK';
                                if (st !== 'OK') { out.yti.clients[ct] = { info: st, ms: Date.now() - t1 }; return; }
                                const pref3 = path3.join(tmpd3, `yti-${ct}-` + Date.now().toString(36));
                                let bytes = 0, dlErr = '';
                                try {
                                    const stream = await inf.download({ type: 'audio' });
                                    const { Readable: R3 } = require('stream');
                                    await new Promise((res, rej) => {
                                        const s3 = R3.fromWeb(stream);
                                        s3.on('data', (c) => { bytes += c.length; if (bytes > 2 * 1048576) { s3.destroy(); res(); } });
                                        s3.on('error', rej); s3.on('end', res);
                                    });
                                } catch (e) { dlErr = String(e.message).slice(0, 90); }
                                for (const f of fs3.readdirSync(tmpd3)) if (f.startsWith('yti-' + ct + '-')) { try { fs3.rmSync(path3.join(tmpd3, f), { force: true }); } catch { } }
                                out.yti.clients[ct] = { info: 'OK', title: String(inf.basic_info?.title || '').slice(0, 40), audBytes: bytes, dlErr, ms: Date.now() - t1 };
                            } catch (e) { out.yti.clients[ct] = { err: String(e.message).slice(0, 110), ms: Date.now() - t1 }; }
                        }));
                    } catch (e) { out.yti.err = String(e.message).slice(0, 120); }
                }
                // ⑧ eporner probe (?ep=1) — CDN host reachability + end-to-end smallest-quality download
                if (url.searchParams.get('ep')) {
                    out.ep = {};
                    try {
                        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
                        const t0 = Date.now();
                        const pr = await fetch('https://www.eporner.com/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15e3) });
                        await pr.body?.cancel().catch(() => { });
                        out.ep.page = { s: pr.status, ms: Date.now() - t0 };
                        const media = require('./media');
                        const bin = await media.getBin('yt-dlp');
                        const VP = url.searchParams.get('ep') === '1' ? 'https://www.eporner.com/video-shMfGmc3oYS/she-has-the-perfect-tits/' : url.searchParams.get('ep');
                        const j = await media._run(bin, ['-J', '--no-warnings', '--skip-download', VP], 60e3);
                        const info = JSON.parse(j.out);
                        const hosts = {};
                        for (const f of info.formats || []) { try { const h = new URL(f.url).hostname; (hosts[h] = hosts[h] || new Set()).add(f.height || f.format_id); } catch { } }
                        const netm = require('net');
                        const tcp = (host) => new Promise((res) => {
                            const s = netm.connect({ host, port: 443 });
                            const done = (ok) => { s.destroy(); res(ok); };
                            s.setTimeout(6000, () => done(false));
                            s.once('connect', () => done(true));
                            s.once('error', () => done(false));
                        });
                        out.ep.hosts = [];
                        for (const [h, hs] of Object.entries(hosts)) out.ep.hosts.push({ h, heights: [...hs].join(','), tcp: await tcp(h) });
                        const t1 = Date.now();
                        const dl = await media._run(bin, ['--no-playlist', '--no-warnings', '--no-part', '--socket-timeout', '15', '--max-filesize', '3M', '-f', 'worst[ext=mp4]/worst', '-o', '/tmp/diag-ep.%(ext)s', VP], 90e3);
                        const got = (require('fs').readdirSync('/tmp')).filter((f) => f.startsWith('diag-ep.'));
                        out.ep.dlSmallest = { ok: dl.code === 0 && got.length > 0, ms: Date.now() - t1, err: dl.code !== 0 ? (String(dl.err || dl.out).split('\n').filter(Boolean).pop() || '').slice(0, 130) : '' };
                        for (const f of got) { try { require('fs').rmSync('/tmp/' + f, { force: true }); } catch { } }
                    } catch (e) { out.ep.err = String(e.message).slice(0, 120); }
                }
                // 🩺 v2.69 — PO-token status (pot=1 → live mint probe too)
                try {
                    const pot = require('./pot');
                    out.pot = pot.status();
                    if (String(url.searchParams.get('pot') || '') === '1') {
                        const t = Date.now();
                        const tok = await pot.getPO(true);
                        out.pot.liveMint = { ok: !!tok, ms: Date.now() - t, po_len: tok ? tok.po.length : 0 };
                    }
                } catch (e) { out.pot = { err: String(e.message).slice(0, 100) }; }
                return json(r, 200, out);
            }
            if (url.pathname === '/') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(page(KEY)); }
            if (url.pathname === '/abc' || url.pathname === '/abc/') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(abcPage()); }
            if (url.pathname.startsWith('/abc/')) return serveAbc(r, url.pathname.slice(5));
            r.writeHead(404, { 'Content-Type': 'text/plain' }); r.end('not found');
        } catch (e) { try { json(r, 500, { ok: false, error: e.message }); } catch { } }
    });
    srv.on('error', (e) => d.log && d.log(`⚠️ pairsite port ${d.port} fail: ${e.message}`));
    srv.listen(d.port, '0.0.0.0');
    d.log && d.log(`🌐 Pair site: http://<panel-address>:${d.port}/?key=${KEY}`);
    return srv;
}

module.exports = { start, requestPair, normNumber, pairKey, _page: page, _abcPage: abcPage, _serveAbc: serveAbc, _safeAbcName: safeAbcName, ABC_DIR };
