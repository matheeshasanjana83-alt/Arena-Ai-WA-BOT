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
    let host = hostOf(url) || 'site';
    const att = errors.map(x => (x.msg || '').match(/attempted address: ([^:,)\s]+)/)?.[1]).find(Boolean);
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
    const where = att && att !== hostOf(url) ? `${host} → redirect → *${att}* (CDN)` : host;
    const err = new Error(`${where} වලට connect වෙන්න බැරි වුණා:\n${lines.join('\n')}\n\n${hint}`);
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

function tlsTest(ip, servername, ms = 9000) {
    return new Promise((res) => {
        const t0 = Date.now();
        const s = require('tls').connect({ host: ip, port: 443, servername, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
        const done = (ok, why) => { s.destroy(); res({ ok, ms: Date.now() - t0, why }); };
        s.setTimeout(ms, () => done(false, 'TLS timeout'));
        s.once('secureConnect', () => done(true));
        s.once('error', (e) => done(false, e.code || e.message));
    });
}

// follow redirects by hand, testing every hop (TCP → TLS → HTTP) so we know WHICH server blocks us
async function walkHops(url, maxHops = 5) {
    const hops = [];
    let cur = url;
    for (let i = 0; i < maxHops && cur; i++) {
        const u = new URL(cur), host = u.hostname, https = u.protocol === 'https:';
        const hop = { host, status: null, tcp: null, tls: null, err: null, next: null };
        let ip = null;
        try { ip = (await withTimeout(dns.promises.lookup(host, { family: 4 }), 8000, 'dns')).address; }
        catch { try { ip = (await dohResolve(host))[0]; hop.viaDoh = true; } catch (e) { hop.err = 'DNS: ' + (errCode(e) || e.message); hops.push(hop); break; } }
        hop.ip = ip;
        hop.tcp = await tcpTest(ip, https ? 443 : 80);
        if (hop.tcp.ok && https) hop.tls = await tlsTest(ip, host);
        if (hop.tcp.ok && (!https || hop.tls?.ok)) {
            try {
                const r = await withTimeout(smartFetch(cur, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0' } }), 20000, 'http');
                hop.status = r.status; hop.ctype = (r.headers.get('content-type') || '').split(';')[0];
                const loc = r.headers.get('location');
                try { await r.body?.cancel(); } catch { }
                if (r.status >= 300 && r.status < 400 && loc) hop.next = new URL(loc.replace(/ /g, '%20'), cur).href;
            } catch (e) { hop.err = (e.message || '').split('\n')[0]; }
        }
        hops.push(hop);
        cur = hop.next;
    }
    return hops;
}

async function diagnose(url) {
    const out = [];
    const host = hostOf(url);
    if (!host) return '❌ link එක වැරදියි';

    // server identity
    try {
        const j = await withTimeout(fetch('https://ipwho.is/').then(r => r.json()), 8000, 'ip');
        out.push(`🖥️ Server IP: ${j.ip || '?'}  ${j.country ? '(' + j.country + (j.connection?.isp ? ', ' + j.connection.isp : '') + ')' : ''}`);
    } catch { out.push('🖥️ Server IP: ? (හොයාගන්න බැරි වුණා)'); }
    out.push(`🌐 Site: ${host}`);

    // DNS
    let sys = [], doh = [];
    try { sys = (await withTimeout(dns.promises.lookup(host, { all: true }), 8000, 'dns')).map(a => a.address); out.push(`🔎 Server DNS: ${sys.filter(ip => net.isIPv4(ip)).slice(0, 3).join(', ') || sys.slice(0, 2).join(', ') || '-'}`); }
    catch (e) { out.push(`🔎 Server DNS: ❌ ${errCode(e) || e.message}`); }
    try { doh = await dohResolve(host); out.push(`🔐 DoH (1.1.1.1): ${doh.slice(0, 3).join(', ')}`); }
    catch (e) { out.push(`🔐 DoH: ❌ ${e.message}`); }
    const sameDns = sys.length && doh.length && sys.some(ip => doh.includes(ip));
    const bogon = (ip) => /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1' || ip === '::';
    if (sys.some(bogon)) out.push('⚠️ Server DNS එක private/blackhole IP එකක් දෙනවා → *DNS block* (DNS bypass එකෙන් පනිනවා)');
    else if (sys.length && doh.length && !sameDns) out.push('ℹ️ DNS දෙකේ IPs වෙනස් — CDN sites වල ඒක සාමාන්‍යයි');

    // every hop of the redirect chain
    const hops = await walkHops(url);
    out.push('', '🔗 *Redirect chain:*');
    hops.forEach((h, i) => {
        const parts = [];
        if (h.tcp) parts.push('TCP ' + (h.tcp.ok ? '✅' : '❌ ' + h.tcp.why));
        if (h.tls) parts.push('TLS ' + (h.tls.ok ? '✅' : '❌ ' + h.tls.why));
        if (h.status) parts.push('HTTP ' + h.status + (h.ctype ? ' ' + h.ctype : ''));
        if (h.err) parts.push('❌ ' + h.err);
        out.push(`${i + 1}. ${h.host}${h.ip ? ' (' + h.ip + ')' : ''}\n    ${parts.join(' · ')}${h.next ? '  ➜ redirect' : ''}`);
    });

    // verdict
    const last = hops[hops.length - 1] || {};
    const blocked = hops.find(h => (h.tcp && !h.tcp.ok) || (h.tls && !h.tls.ok) || (h.err && !h.status));
    let v;
    if (!blocked && last.status >= 200 && last.status < 300) v = '✅ මේ server එකෙන් file එකට යන්න පුළුවන් — .download වැඩ කරන්න ඕනේ.';
    else if (!blocked && (last.status === 403 || last.status === 401)) v = `🚫 ${last.host} *403/401* — link එක ඔයාගේ phone එකේ IP/session එකට lock කරලා, හෝ ඒ site එක server IPs ලට file දෙන්නේ නෑ.`;
    else if (!blocked && (last.status === 404 || last.status === 410)) v = '🚫 Link එක expire වෙලා / නෑ (404) — අලුත් link එකක් ගන්න.';
    else if (blocked && blocked.tcp && !blocked.tcp.ok) v = `🧱 *${blocked.host}* මේ server එකේ IP එකෙන් එන connection *drop* කරනවා (TCP ${blocked.tcp.why}).${blocked !== hops[0] ? ' (මුල් site එක OK, block කරන්නේ redirect කරන CDN server එක.)' : ''}\n➡️ ඒ site එක datacenter/server IPs block කරනවා — DNS bypass වලින් බෑ. Residential proxy (*.setproxy*) හෝ Termux (phone IP) ඕනේ.`;
    else if (blocked && blocked.tls && !blocked.tls.ok) v = `🧱 *${blocked.host}* TCP connect වෙනවා, හැබැයි *TLS handshake එක block* (${blocked.tls.why}) — site එක/firewall එක මේ server IP එක block කරනවා.\n➡️ Residential proxy (*.setproxy*) හෝ Termux (phone IP) ඕනේ.`;
    else if (blocked) v = `❌ ${blocked.host}: ${blocked.err}`;
    else v = '❓ හරියටම කියන්න බෑ — මේ report එකේ screenshot එක එවන්න.';
    out.push('', '🧾 ' + v);
    if (getProxy()) out.push(`🧩 Proxy set කරලා: ${getProxy().replace(/\/\/[^@/]*@/, '//***@')}`);
    return out.join('\n');
}

module.exports = { smartFetch, diagnose, dohResolve, getProxy, explain, hasUndici: () => !!undici, _route: route };
