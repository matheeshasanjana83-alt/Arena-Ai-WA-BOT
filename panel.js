/**
 * panel.js — KAVIZ MD V1 🔒 PRIVATE PANEL (v3.06.0)
 * User directive 2026-11-03: "free server එකක් අල්ලගෙන මේ වගෙ panel එකක් හදන්න —
 * full private, මටයි ඔයාටයි access තියෙන්න" → අපේම panel එක, කිසිම platform එකක
 * තියෙන expiry එකක් නෑ. ඕනම host එකක (Termux / VPS / free panel) `node panel.js`.
 *
 * ZERO-DEP (node builtins only: http, child_process, crypto, fs, path, os):
 *  - bot එක launcher.js විදිහට spawn කරලා manage කරනවා (start/stop/restart, crash
 *    auto-restart + rollback logic launcher එකේම — panel එක ඒක wrap කරනවා විතරයි)
 *  - stdout/stderr → timestamped ring buffer (1500 lines) → browser live log
 *  - PAIRING CODE auto-detect (bot.js prints "🔢 PAIRING CODE:  XXXX-XXXX") → panel
 *    header එකේම ලොකුවට පෙන්නනවා = අලුත් host එකක pair කරන්න QR scan ඕනේ නෑ
 *  - WhatsApp state detection: 'WhatsApp Connected' / pairing / logged-out / banned
 *  - 🔒 auth: password (ARENA_PANEL_PW env > settings.json panelPw > auto-generated
 *    12-char, settings.json එකේ persist + console එකේ එක පාරක් print) → HttpOnly
 *    SameSite session cookie (24h) · 5 fails/IP → 10 min lockout · body cap 64KB
 *  - bot kill = process-group SIGTERM (detached spawn) → launcher+bot දෙකම නැවතිනවා
 *  - panel SIGTERM/SIGINT → bot group kill + exit (orphan bot නෑ)
 *
 * Endpoints: GET / (SPA) · GET /api/health (public {ok}) · POST /api/login ·
 * POST /api/logout · GET /api/status · GET /api/logs?after=N ·
 * POST /api/bot/start · POST /api/bot/stop · POST /api/bot/restart
 * (auth නැති හැම /api/* එකක්ම 401 — /api/health හැර)
 *
 * Port: ARENA_PANEL_PORT (default 1028 — පරණ panel status port එකම)
 * Bot cmd override (tests/special hosts): ARENA_PANEL_BOT_CMD="node other.js"
 * Autostart off: ARENA_PANEL_AUTOSTART=0
 */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const LOG_CAP = 1500;
const FAIL_MAX = 5;
const LOCK_MS = 10 * 60e3;
const SESSION_MS = 24 * 3600e3;
const BODY_CAP = 64 * 1024;

/* ---------- password (env > settings.json > generate+persist) ---------- */
function loadPw(root) {
    root = root || ROOT;
    if (process.env.ARENA_PANEL_PW) return { pw: process.env.ARENA_PANEL_PW, src: 'env' };
    const sp = path.join(root, 'settings.json');
    try {
        const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
        if (s.panelPw) return { pw: String(s.panelPw), src: 'settings' };
    } catch { }
    const pw = crypto.randomBytes(9).toString('base64url'); // 12 chars url-safe
    try {
        let s = {}; try { s = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { }
        s.panelPw = pw;
        fs.writeFileSync(sp, JSON.stringify(s, null, 2));
    } catch { }
    return { pw, src: 'generated' };
}

/* ---------- createPanel — full instance (tests inject port/pw/botCmd) ---------- */
function createPanel(opts) {
    opts = opts || {};
    const port = opts.port !== undefined ? opts.port : parseInt(process.env.ARENA_PANEL_PORT || '1028', 10);
    const pwInfo = opts.pw ? { pw: String(opts.pw), src: 'injected' } : loadPw(opts.root);
    const PW = pwInfo.pw;
    const root = opts.root || ROOT;

    /* ----- state ----- */
    const sessions = new Map();          // token → expiresAt
    const fails = new Map();             // ip → {n, until}
    let child = null, startedAt = 0, restarting = false;
    const logs = [];                     // {id, t, s}
    let lineId = 0;
    let pairingCode = null;

    /* ----- bot process ----- */
    function botCmd() {
        if (opts.botCmd) return opts.botCmd;                       // {cmd, args} injected
        const s = process.env.ARENA_PANEL_BOT_CMD;
        if (s) { const p = s.split(' ').filter(Boolean); return { cmd: p[0], args: p.slice(1) }; }
        return { cmd: process.execPath, args: [path.join(root, 'launcher.js')] };
    }
    function isRunning() { return !!child && child.exitCode === null && !child.killed; }

    function pushLog(s) {
        s = String(s);
        while (s.endsWith('\n') || s.endsWith('\r')) s = s.slice(0, -1);
        if (!s) return;
        logs.push({ id: ++lineId, t: new Date().toISOString().slice(11, 19), s });
        if (logs.length > LOG_CAP) logs.shift();
        const m = s.match(/PAIRING CODE:\s*([A-Za-z0-9-]{4,})/);
        if (m) pairingCode = m[1];
    }
    function onChunk(buf) { for (const ln of String(buf).split('\n')) pushLog(ln); }

    function startBot() {
        if (isRunning()) return { ok: false, err: 'Bot දැනටමත් run වෙනවා' };
        const { cmd, args } = botCmd();
        let c;
        try {
            c = spawn(cmd, args, {
                cwd: root, detached: true,
                env: { ...process.env, ARENA_PANEL: '1' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) { pushLog('❌ [panel] spawn fail: ' + e.message); return { ok: false, err: e.message }; }
        child = c; startedAt = Date.now();
        pushLog('▶️ [panel] bot start → pid ' + c.pid);
        c.stdout.on('data', onChunk);
        c.stderr.on('data', onChunk);
        c.on('exit', (code, signal) => {
            pushLog('⏹ [panel] bot exit (code ' + code + (signal ? ' ' + signal : '') + ')');
            if (child === c) { child = null; startedAt = 0; }
        });
        c.on('error', (e) => pushLog('❌ [panel] bot error: ' + e.message));
        return { ok: true, pid: c.pid };
    }

    function killGroup(c, sig) {
        try { process.kill(-c.pid, sig); }
        catch { try { c.kill(sig); } catch { } }
    }
    function stopBot() {
        return new Promise((res) => {
            if (!isRunning()) { if (child) child = null; return res({ ok: true }); }
            const c = child;
            let done = false;
            const finish = () => { if (!done) { done = true; if (child === c) { child = null; startedAt = 0; } res({ ok: true }); } };
            c.once('exit', finish);
            killGroup(c, 'SIGTERM');
            setTimeout(() => { if (!done) { killGroup(c, 'SIGKILL'); } }, 8000).unref();
            setTimeout(finish, 9500).unref();   // hard promise cap — never hang the API
        });
    }
    async function restartBot() {
        if (restarting) return { ok: false, err: 'restart එකක් දැනටමත් run වෙනවා' };
        restarting = true;
        try {
            await stopBot();
            await new Promise(r => setTimeout(r, 1200));
            return startBot();
        } finally { restarting = false; }
    }

    function waState() {
        for (let i = logs.length - 1; i >= 0 && i >= logs.length - 120; i--) {
            const s = logs[i].s;
            if (/WhatsApp Connected/.test(s)) return 'connected';
            if (/PAIRING CODE/.test(s)) return 'pairing';
            if (/Logged out/.test(s)) return 'logged-out';
            if (/block\/restrict/.test(s)) return 'banned';
        }
        return isRunning() ? 'connecting' : 'offline';
    }
    function version() {
        try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '?'; }
        catch { return '?'; }
    }
    function status() {
        return {
            ok: true, running: isRunning(), pid: child ? child.pid : null,
            startedAt: startedAt || null,
            upSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : null,
            version: version(), wa: waState(), pairingCode,
            lines: lineId, host: os.hostname(), port,
            autostart: opts.autostart !== false && process.env.ARENA_PANEL_AUTOSTART !== '0',
        };
    }

    /* ----- HTTP helpers ----- */
    function cookies(req) {
        const out = {};
        for (const part of String(req.headers.cookie || '').split(';')) {
            const i = part.indexOf('=');
            if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
        return out;
    }
    function authed(req) {
        const tok = cookies(req).kzpanel;
        if (!tok || !sessions.has(tok)) return false;
        if (Date.now() > sessions.get(tok)) { sessions.delete(tok); return false; }
        return true;
    }
    function ip(req) { return req.socket.remoteAddress || '?'; }
    function locked(req) {
        const f = fails.get(ip(req));
        return f && f.until && Date.now() < f.until;
    }
    function failLogin(req) {
        const k = ip(req);
        const f = fails.get(k) || { n: 0, until: 0 };
        f.n++;
        if (f.n >= FAIL_MAX) { f.until = Date.now() + LOCK_MS; f.n = 0; }
        fails.set(k, f);
    }
    function json(res, code, obj) {
        const b = JSON.stringify(obj);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(b);
    }
    function readBody(req) {
        return new Promise((res, rej) => {
            let n = 0, big = false; const chunks = [];
            req.on('data', c => { n += c.length; if (n > BODY_CAP) { big = true; chunks.length = 0; return; } chunks.push(c); });
            req.on('end', () => res({ body: Buffer.concat(chunks).toString('utf8'), big }));   // drain fully → clean 413 (never RST the client)
            req.on('error', rej);
        });
    }

    /* ----- routes ----- */
    const server = http.createServer(async (req, res) => {
        res.on('error', () => { });   // browsers abort requests (page nav/refresh) — never crash the panel
        req.on('error', () => { });
        const u = (req.url || '/').split('?')[0];
        try {
            if (u === '/api/health') return json(res, 200, { ok: true });
            if (u === '/api/login' && req.method === 'POST') {
                if (locked(req)) return json(res, 429, { ok: false, err: 'උත්සාහ ගොඩක් fail වුණා — විනාඩි 10 කින් ආයෙත් try කරන්න' });
                let body = '', big = false;
                try { const rb = await readBody(req); body = rb.body; big = rb.big; } catch { return json(res, 400, { ok: false, err: 'body read fail' }); }
                if (big) return json(res, 413, { ok: false, err: 'body too large' });
                let obj = null;
                try { obj = JSON.parse(body || '{}'); } catch { return json(res, 400, { ok: false, err: 'bad json' }); }
                if (String(obj.pw || '') !== PW) { failLogin(req); return json(res, 401, { ok: false, err: 'මුරපදය වැරදියි' }); }
                fails.delete(ip(req));
                const tok = crypto.randomBytes(24).toString('hex');
                sessions.set(tok, Date.now() + SESSION_MS);
                if (sessions.size > 50) {   // cap: oldest expiry first
                    let old = null, oldT = Infinity;
                    for (const [k, t] of sessions) if (t < oldT) { oldT = t; old = k; }
                    if (old) sessions.delete(old);
                }
                res.setHeader('Set-Cookie', 'kzpanel=' + tok + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + (SESSION_MS / 1000));
                return json(res, 200, { ok: true });
            }
            if (u === '/api/logout' && req.method === 'POST') {
                const tok = cookies(req).kzpanel;
                if (tok) sessions.delete(tok);
                res.setHeader('Set-Cookie', 'kzpanel=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
                return json(res, 200, { ok: true });
            }
            if (u === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return res.end(PAGE);
            }
            if (!authed(req)) return json(res, 401, { ok: false, err: 'auth නෑ' });
            if (u === '/api/status' && req.method === 'GET') return json(res, 200, status());
            if (u === '/api/logs' && req.method === 'GET') {
                const q = new URL(req.url, 'http://x').searchParams;
                const after = parseInt(q.get('after') || '0', 10) || 0;
                const out = logs.filter(l => l.id > after);
                return json(res, 200, { ok: true, lines: out, total: lineId });
            }
            if (u === '/api/bot/start' && req.method === 'POST') return json(res, 200, startBot());
            if (u === '/api/bot/stop' && req.method === 'POST') return json(res, 200, await stopBot());
            if (u === '/api/bot/restart' && req.method === 'POST') return json(res, 200, await restartBot());
            return json(res, 404, { ok: false, err: 'no route' });
        } catch (e) {
            return json(res, 500, { ok: false, err: e.message });
        }
    });

    const api = {
        server, port, status, startBot, stopBot, restartBot, pushLog,
        _pw: PW, _pwSrc: pwInfo.src, _sessions: sessions, _logs: logs,
        _authed: authed, _root: root,
    };
    return api;
}

/* ---------- SPA (single HTML, Sinhala, no external assets) ---------- */
const PAGE = `<!doctype html>
<html lang="si"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KAVIZ MD — 🔒 Private Panel</title>
<style>
:root{--bg:#0b1220;--card:#111a2e;--line:#1f2c48;--tx:#e6edf7;--dim:#8aa0c0;--grn:#22c55e;--red:#ef4444;--amb:#f59e0b}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:system-ui,'Noto Sans Sans Sinhala',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:18px}
h1{font-size:18px;margin:8px 0 16px}
h1 small{color:var(--dim);font-size:12px;font-weight:400}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;width:100%;max-width:860px;margin-bottom:14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pill{padding:4px 10px;border-radius:999px;border:1px solid var(--line);font-size:13px;color:var(--dim)}
.g{color:var(--grn)} .r{color:var(--red)} .a{color:var(--amb)}
button{background:#1c2a47;color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:9px 16px;font-size:14px;cursor:pointer}
button:hover{background:#24365c} button:disabled{opacity:.45;cursor:wait}
#code{font-size:30px;letter-spacing:6px;font-weight:700;color:var(--grn);text-align:center;padding:10px 0 2px}
.dim{color:var(--dim);font-size:12px}
#logs{background:#070c16;border:1px solid var(--line);border-radius:8px;padding:10px;height:340px;overflow:auto;white-space:pre-wrap;word-break:break-all;font:12px/1.5 ui-monospace,Consolas,monospace;color:#9fd3a8}
input{background:#0b1220;border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:10px 12px;font-size:15px;width:100%}
#login{max-width:340px;margin-top:12vh;text-align:center}
#login button{width:100%;margin-top:10px}
.err{color:var(--red);font-size:13px;min-height:18px;margin-top:6px}
.hide{display:none}
.kv{display:flex;justify-content:space-between;padding:3px 0;font-size:14px}
.kv b{font-weight:600}
</style></head><body>
<div id="login" class="card">
  <h1>🎌 KAVIZ MD V1</h1>
  <p class="dim">🔒 Private Panel — owner access only</p>
  <input id="pw" type="password" placeholder="මුරපදය" autofocus>
  <div class="err" id="lerr"></div>
  <button id="blogin">🔓 ඇතුල් වන්න</button>
</div>
<div id="app" class="hide" style="width:100%;display:flex;flex-direction:column;align-items:center">
  <h1>🎌 KAVIZ MD V1 <small>· 🔒 private panel</small></h1>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <span class="pill" id="pRun">—</span>
        <span class="pill" id="pWa">WhatsApp: —</span>
      </div>
      <button id="bOut" style="font-size:12px;padding:5px 10px">🚪 logout</button>
    </div>
    <div id="code" class="hide"></div>
    <p class="dim" style="text-align:center" id="codeHint"></p>
    <div style="height:10px"></div>
    <div class="kv"><span>Version</span><b id="vVer">—</b></div>
    <div class="kv"><span>PID / Uptime</span><b id="vUp">—</b></div>
    <div class="kv"><span>Host</span><b id="vHost">—</b></div>
    <div style="height:12px"></div>
    <div class="row">
      <button id="bStart">▶️ Start</button>
      <button id="bStop">⏹ Stop</button>
      <button id="bRest">🔄 Restart</button>
    </div>
    <div class="err" id="aerr"></div>
  </div>
  <div class="card">
    <div class="row" style="justify-content:space-between"><b>📜 Logs</b><span class="dim" id="lcount"></span></div>
    <div style="height:8px"></div>
    <div id="logs"></div>
  </div>
</div>
<script>
var after = 0, lastId = 0;
function $(x){return document.getElementById(x)}
function fmt(s){if(s==null)return '—';var m=Math.floor(s/60),h=Math.floor(m/60);return h? h+'h '+(m%60)+'m '+(s%60)+'s' : m? m+'m '+(s%60)+'s' : s+'s'}
async function j(url,opt){
  var r = await fetch(url, opt||{});
  var b = null; try{ b = await r.json(); }catch(e){}
  if (r.status === 401 && url !== '/api/login'){ showLogin(); throw new Error('401'); }
  return {s:r.status, b:b};
}
function showLogin(){ $('login').classList.remove('hide'); $('app').classList.add('hide'); }
function showApp(){ $('login').classList.add('hide'); $('app').classList.remove('hide'); }
async function pollStatus(){
  try{
    var r = await j('/api/status'); if(!r.b||!r.b.ok) return;
    var st = r.b;
    $('pRun').textContent = st.running ? '🟢 Bot run වෙනවා' : '🔴 Bot නැහැ';
    $('pRun').className = 'pill ' + (st.running?'g':'r');
    var wa = {connected:['🟢 connected','g'],pairing:['🟡 pairing','a'],'logged-out':['🔴 logged out','r'],banned:['🚫 banned','r'],connecting:['🟡 connecting','a'],offline:['⚫ offline','']}[st.wa]||['—',''];
    $('pWa').textContent = 'WhatsApp: ' + wa[0]; $('pWa').className = 'pill ' + wa[1];
    $('vVer').textContent = 'v' + st.version;
    $('vUp').textContent = (st.pid||'—') + ' / ' + fmt(st.upSec);
    $('vHost').textContent = st.host + ' :' + st.port;
    if (st.pairingCode && st.wa !== 'connected'){
      $('code').classList.remove('hide'); $('code').textContent = '🔢 ' + st.pairingCode;
      $('codeHint').textContent = 'WhatsApp → Linked devices → Link a device → "Link with phone number instead" → මේ code එක ගහන්න';
    } else { $('code').classList.add('hide'); $('codeHint').textContent = st.wa==='connected' ? '✅ WhatsApp සම්බන්ධ වෙලා — "Message yourself" chat එකේ .ping ගහලා බලන්න' : ''; }
    $('bStop').disabled = !st.running; $('bRest').disabled = !st.running;
  }catch(e){}
}
async function pollLogs(){
  try{
    var r = await j('/api/logs?after=' + lastId); if(!r.b||!r.b.ok) return;
    var L = r.b.lines||[];
    if (L.length){
      var el = $('logs'), stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      var frag = '';
      for (var i=0;i<L.length;i++) frag += '[' + L[i].t + '] ' + L[i].s + '\\n';
      el.appendChild(document.createTextNode(frag));
      while (el.childNodes.length > 2) el.removeChild(el.firstChild);
      if (stick) el.scrollTop = el.scrollHeight;
      lastId = L[L.length-1].id;
      $('lcount').textContent = lastId + ' lines';
    }
  }catch(e){}
}
async function act(path){
  $('aerr').textContent = '';
  try{ var r = await j('/api/bot/' + path, {method:'POST'});
    if (!r.b || !r.b.ok) $('aerr').textContent = (r.b && r.b.err) || ('fail ' + r.s);
  }catch(e){ $('aerr').textContent = e.message; }
  await pollStatus();
}
$('blogin').onclick = async function(){
  $('lerr').textContent = '';
  try{
    var r = await j('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({pw: $('pw').value})});
    if (r.b && r.b.ok){ $('pw').value=''; showApp(); await pollStatus(); await pollLogs(); }
    else $('lerr').textContent = (r.b && r.b.err) || 'fail ' + r.s;
  }catch(e){ $('lerr').textContent = e.message; }
};
$('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') $('blogin').click(); });
$('bStart').onclick = function(){ this.disabled=true; act('start').then(()=>{this.disabled=false;}); };
$('bStop').onclick  = function(){ this.disabled=true; act('stop').then(()=>{this.disabled=false;}); };
$('bRest').onclick  = function(){ this.disabled=true; act('restart').then(()=>{this.disabled=false;}); };
$('bOut').onclick = async function(){ try{ await j('/api/logout',{method:'POST'}); }catch(e){} showLogin(); };
showLogin();
(async function(){ /* if already authed, /api/status 200 → straight to app */
  try{ var r = await j('/api/status'); if(r.b && r.b.ok){ showApp(); await pollStatus(); await pollLogs(); } }catch(e){}
})();
setInterval(function(){ if(!$('app').classList.contains('hide')) { pollStatus(); pollLogs(); } }, 2000);
</script></body></html>`;

/* ---------- main boot ---------- */
if (require.main === module) {
    const info = loadPw(ROOT);
    const P = createPanel({ port: parseInt(process.env.ARENA_PANEL_PORT || '1028', 10), autostart: process.env.ARENA_PANEL_AUTOSTART !== '0' });
    P.server.listen(P.port, '0.0.0.0', () => {
        console.log('🔒 KAVIZ MD private panel → http://0.0.0.0:' + P.port + '  (pw: ' + info.src + (info.src === 'generated' ? ' — settings.json එකේ panelPw' : '') + ')');
        if (process.env.ARENA_PANEL_AUTOSTART !== '0') setTimeout(() => P.startBot(), 800);
    });
    const bye = () => { try { if (P.status().running) P.stopBot().then(() => process.exit(0)); else process.exit(0); } catch { process.exit(0); } };
    process.on('SIGINT', bye); process.on('SIGTERM', bye);
    setTimeout(() => console.log('💡 login වෙලා bot start කරන්න — pairing code එක panel එකේම පේනවා'), 1500);
}

module.exports = { createPanel, loadPw, PAGE, ROOT };
