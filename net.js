'use strict';
/**
 * net.js — smarter fetch for servers/panels whose network blocks some sites.
 *
 *   1. normal fetch (system DNS)
 *   2. on DNS/connect errors → retry with DNS-over-HTTPS (1.1.1.1 / 8.8.8.8 by IP, IPv4)
 *      → beats ISP / country DNS blocking (e.g. Indonesian "Internet Positif")
 *   3. still failing + settings.json "proxy" set → retry through that HTTP(S) proxy
 *   The route that worked is remembered per host (no 10 s timeout next time).
 *
 *   diagnose(url) → human report for the .net command (server IP/country, DNS vs DoH, TCP tests).
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns');

let undici = null;
try { undici = require('undici'); } catch { /* optional: falls back to plain fetch */ }

const SETTINGS = path.join(__dirname, 'settings.json');
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const getProxy = () => String(process.env.DL_PROXY || loadSettings().proxy || '').trim();

const NET_ERR = /ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET|EHOSTUNREACH|ENETUNREACH|EPROTO|ERR_SSL|CERT/;
const errCode = (e) => e?.cause?.code || e?.code || (e?.cause?.message || e?.message || '').match(/E[A-Z_]{4,}/)?.[0] || '';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(what + ' timeout'), { code: 'ETIMEDOUT' })), ms))]);

// ───────────── DNS-over-HTTPS (IP endpoints → no DNS needed to reach them) ─────────────
const DOH = [
    (h) => `https://1.1.1.1/dns-query?name=${encodeURIComponent(h)}&type=A`,
    (h) => `https://8.8.8.8/resolve?name=${encodeURIComponent(h)}&type=A`,
    (h) => `https://1.0.0.1/dns-query?name=${encodeURIComponent(h)}&type=A`,
];
const dohCache = new Map();   // host → { ips, exp }
async function dohResolve(host) {
    if (net.isIP(host)) return [host];
    const c = dohCache.get(host);
    if (c && c.exp > Date.now()) return c.ips;
    let lastErr;
    for (const mk of DOH) {
        try {
            const r = await withTimeout(fetch(mk(host), { headers: { accept: 'application/dns-json' } }), 6000, 'DoH');
            const j = await r.json();
            const ips = (j.Answer || []).filter(a => a.type === 1).map(a => a.data);
            if (ips.length) { dohCache.set(host, { ips, exp: Date.now() + 10 * 60e3 }); return ips; }
            lastErr = new Error('DoH: no A record for ' + host);
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('DoH failed');
}
function dohLookup(hostname, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    dohResolve(hostname).then((ips) => {
        if (options && options.all) cb(null, ips.map(a => ({ address: a, family: 4 })));
        else cb(null, ips[0], 4);
    }, (e) => cb(Object.assign(e, { code: e.code || 'ENOTFOUND' })));
}

let _dohAgent = null, _proxyAgent = null, _proxyUrl = '';
const dohAgent = () => _dohAgent || (_dohAgent = new undici.Agent({ connect: { lookup: dohLookup, timeout: 15000 } }));
function proxyAgent() {
    const p = getProxy();
    if (!p) return null;
    if (_proxyAgent && _proxyUrl === p) return _proxyAgent;
    _proxyUrl = p; _proxyAgent = new undici.ProxyAgent({ uri: p, connect: { timeout: 15000 } });
    return _proxyAgent;
}

// ───────────── smart fetch ─────────────
const route = new Map();   // host → 'doh' | 'proxy'   (what worked last time)
const ROUTE_NAME = { direct: 'සාමාන්‍ය', doh: 'DNS bypass (DoH)', proxy: 'proxy' };
let lastRouteUsed = 'direct';

async function viaRoute(kind, url, opts) {
    if (kind === 'direct') return fetch(url, opts);
    if (!undici) throw Object.assign(new Error('undici නෑ (npm install කරන්න)'), { code: 'NO_UNDICI' });
    if (kind === 'doh') return undici.fetch(url, { ...opts, dispatcher: dohAgent() });
    const pa = proxyAgent();
    if (!pa) throw Object.assign(new Error('proxy set කරලා නෑ'), { code: 'NO_PROXY' });
    return undici.fetch(url, { ...opts, dispatcher: pa });
}

async function smartFetch(url, opts = {}) {
    const host = hostOf(url);
    const order = ['direct', 'doh', 'proxy'];
    const pref = route.get(host);
    if (pref) order.sort((a, b) => (b === pref) - (a === pref));
    const errors = [];
    for (const kind of order) {
        if (kind === 'proxy' && !getProxy()) continue;
        if (kind !== 'direct' && !undici) continue;
        try {
            const res = await viaRoute(kind, url, opts);
            if (kind === 'direct') route.delete(host); else route.set(host, kind);
            lastRouteUsed = kind;
            if (kind !== 'direct') console.log(`[net] ${host} → ${ROUTE_NAME[kind]} හරහා වැඩ ✅`);
            return res;
        } catch (e) {
            const c = errCode(e);
            errors.push({ kind, code: c, msg: e?.cause?.message || e.message });
            if (!NET_ERR.test(c) && kind === 'direct') throw e;   // not a network problem → don't mask it
        }
    }
    throw explain(url, errors);
}

function explain(url, errors) {
    const host = hostOf(url) || 'site';
    const d = errors.find(x => x.kind === 'direct'), h = errors.find(x => x.kind === 'doh'), p = errors.find(x => x.kind === 'proxy');
    const lines = [];
    const why = (c) => ({
        ENOTFOUND: 'DNS එකෙන් හොයාගන්න බෑ', EAI_AGAIN: 'DNS error', UND_ERR_CONNECT_TIMEOUT: 'connect timeout', ETIMEDOUT: 'timeout',
        ECONNRESET: 'connection එක කැපුවා', ECONNREFUSED: 'connection reject කළා', UND_ERR_SOCKET: 'connection කැඩුණා',
    }[c] || c || 'error');
    if (d) lines.push(`• සාමාන්‍ය: ${why(d.code)}${d.code ? ' [' + d.code + ']' : ''}`);
    if (h) lines.push(`• DNS bypass (DoH): ${why(h.code)}${h.code ? ' [' + h.code + ']' : ''}`);
    if (p) lines.push(`• Proxy: ${why(p.code)}${p.code ? ' [' + p.code + ']' : ''}`);
    let hint;
    if (h && !p) hint = `➡️ DNS bypass එකෙනුත් බැරි වුණා → මේ server එකේ network එක (ISP/රට) හෝ ${host} site එක මේ server IP එක *block* කරනවා.\n💡 *.net ${url.slice(0, 60)}* ගහලා හරියටම බලන්න. විසඳුම: *.setproxy http://user:pass@host:port* (proxy එකක්) හෝ ඒ link එක Termux එකෙන්.`;
    else if (p) hint = `➡️ Proxy එකෙනුත් බැරි වුණා — proxy එක වැඩද / link එක තාම valid ද බලන්න.`;
    else hint = `💡 *.net ${url.slice(0, 60)}* ගහලා බලන්න.`;
    const err = new Error(`${host} වලට connect වෙන්න බැරි වුණා:\n${lines.join('\n')}\n\n${hint}`);
    err.code = (h || d || {}).code || ''; err.netErrors = errors;
    return err;
}

// ───────────── diagnostics (.net) ─────────────
function tcpTest(ip, port = 443, ms = 7000) {
    return new Promise((res) => {
        const t0 = Date.now();
        const s = net.connect({ host: ip, port, family: net.isIP(ip) || 4 });
        const done = (ok, why) => { s.destroy(); res({ ok, ms: Date.now() - t0, why }); };
        s.setTimeout(ms, () => done(false, 'timeout'));
        s.once('connect', () => done(true));
        s.once('error', (e) => done(false, e.code || e.message));
    });
}

async function diagnose(url) {
    const out = [];
    const host = hostOf(url);
    if (!host) return '❌ link එක වැරදියි';
    const isHttps = url.startsWith('https');
    const port = isHttps ? 443 : 80;

    // server identity
    try {
        const j = await withTimeout(fetch('https://ipwho.is/').then(r => r.json()), 8000, 'ip');
        out.push(`🖥️ Server IP: ${j.ip || '?'}  ${j.country ? '(' + j.country + (j.connection?.isp ? ', ' + j.connection.isp : '') + ')' : ''}`);
    } catch { out.push('🖥️ Server IP: ? (හොයාගන්න බැරි වුණා)'); }
    out.push(`🌐 Site: ${host}`);

    // DNS
    let sys = [], doh = [];
    try { sys = (await withTimeout(dns.promises.lookup(host, { all: true }), 8000, 'dns')).map(a => a.address); out.push(`🔎 Server DNS: ${sys.join(', ') || '-'}`); }
    catch (e) { out.push(`🔎 Server DNS: ❌ ${errCode(e) || e.message}`); }
    try { doh = await dohResolve(host); out.push(`🔐 DoH (1.1.1.1): ${doh.join(', ')}`); }
    catch (e) { out.push(`🔐 DoH: ❌ ${e.message}`); }
    const sameDns = sys.length && doh.length && sys.some(ip => doh.includes(ip));
    if (sys.length && doh.length && !sameDns) out.push('⚠️ DNS දෙක වෙනස් → server එකේ ISP DNS එක වැරදි IP දෙනවා (*DNS block*)');

    // TCP
    const sysIp4 = sys.find(ip => net.isIPv4(ip)) || sys[0];
    let tSys = null, tDoh = null;
    if (sysIp4) { tSys = await tcpTest(sysIp4, port); out.push(`🔌 ${sysIp4}:${port} (server DNS) → ${tSys.ok ? '✅ ' + tSys.ms + 'ms' : '❌ ' + tSys.why}`); }
    if (doh[0] && doh[0] !== sysIp4) { tDoh = await tcpTest(doh[0], port); out.push(`🔌 ${doh[0]}:${port} (DoH) → ${tDoh.ok ? '✅ ' + tDoh.ms + 'ms' : '❌ ' + tDoh.why}`); }
    else if (doh[0]) tDoh = tSys;

    // full request through smartFetch
    let httpLine;
    try {
        const r = await withTimeout(smartFetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0' }, redirect: 'follow' }), 30000, 'http');
        try { await r.body?.cancel(); } catch { }
        httpLine = `📥 Download test: HTTP ${r.status} ${r.headers.get('content-type') || ''} (route: ${ROUTE_NAME[lastRouteUsed]})`;
    } catch (e) { httpLine = `📥 Download test: ❌ ${(e.message || '').split('\n')[0]}`; }
    out.push(httpLine);

    // verdict
    let v;
    if (/HTTP 2\d\d|HTTP 206/.test(httpLine)) v = lastRouteUsed === 'direct' ? '✅ මේ server එකෙන් site එකට යන්න පුළුවන්.' : `✅ ${ROUTE_NAME[lastRouteUsed]} හරහා වැඩ — .download දැන් වැඩ කරන්න ඕනේ.`;
    else if (/HTTP 403|HTTP 401/.test(httpLine)) v = '🚫 Site එක connect වෙනවා, හැබැයි *403/401* — link එක ඔයාගේ phone එකේ IP/session එකට විතරයි හදලා තියෙන්නේ (expire/IP-lock). Site එකෙන් අලුත් link එකක් ගන්න, නැත්නම් Termux.';
    else if (/HTTP 404|HTTP 410/.test(httpLine)) v = '🚫 Link එක expire වෙලා / නෑ (404).';
    else if (tSys && !tSys.ok && tDoh && tDoh.ok) v = '🧱 *DNS block* — DoH එකෙන් ගියාම වැඩ කරන්න ඕනේ.';
    else if ((tSys && !tSys.ok) && (!tDoh || !tDoh.ok)) v = `🧱 *IP block* — server එකේ network එක (ISP/රට/host) හෝ site එක ${host} වලට යන එක block කරනවා. DNS bypass මදි → *.setproxy* (proxy) හෝ VPN තියෙන server එකක් / Termux ඕනේ.`;
    else if (tSys && tSys.ok) v = '🔐 TCP connect වෙනවා, හැබැයි request එක fail — site එක server/datacenter IPs block කරනවා (TLS/HTTP level) හෝ link එක IP-lock. Proxy / Termux.';
    else v = '❓ හරියටම කියන්න බෑ — මේ report එකේ screenshot එක එවන්න.';
    out.push('', '🧾 ' + v);
    if (getProxy()) out.push(`🧩 Proxy set කරලා: ${getProxy().replace(/\/\/[^@/]*@/, '//***@')}`);
    return out.join('\n');
}

module.exports = { smartFetch, diagnose, dohResolve, getProxy, explain, hasUndici: () => !!undici, _route: route };
