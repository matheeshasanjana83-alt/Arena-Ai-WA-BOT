'use strict';
/**
 * proxypool.js — free-proxy pool for KAVIZ MD V1 (v2.16)
 *
 *  proxies.txt      — shipped list (repo එකෙන් එනවා, .update එකෙන් අලුත් වෙනවා)
 *  proxies.user.txt — ඔයාගේම proxies (update වෙද්දි මැකෙන්නේ නෑ; line එකකට එකක්,
 *                     `ip:port` හෝ `http://user:pass@ip:port`)
 *
 *  Flow:
 *   1. load lists → dedupe
 *   2. background health-check (https://www.google.com/generate_204 හරහා CONNECT tunnel)
 *      → alive list (fastest first), cache file එකක save (restart වුණාම ආයෙත් check කරන්න ඕනේ නෑ)
 *   3. net.js (direct → DoH → IPv6 → your proxy → *pool*) + yt-dlp (media.js) වලට
 *      LAST-RESORT fallback එක විදිහට alive proxies rotate කරලා දෙනවා
 *
 *  Off කරන්න: PROXY_POOL=0 env  හෝ  settings.json { "proxyPool": false }  හෝ  *.proxies off*
 */
const fs = require('fs');
const path = require('path');

const POOL_FILE = path.join(__dirname, 'proxies.txt');
const USER_FILE = path.join(__dirname, 'proxies.user.txt');
const CACHE_FILE = path.join(__dirname, 'proxies.cache.json');
const SETTINGS = path.join(__dirname, 'settings.json');

const CHECK_URL = 'https://www.google.com/generate_204';   // CONNECT + TLS + tiny body → real signal
const CHECK_TIMEOUT = 9000;        // ms per proxy
const CONCURRENCY = 14;
const REFRESH_MS = 20 * 60e3;      // re-check alive list every 20 min (background)
const BAD_COOLDOWN = 10 * 60e3;    // failed proxy → try again after 10 min
const ALIVE_TTL = 6 * 3600e3;      // cached alive list older than 6 h → ignore

let undici = null;
try { undici = require('undici'); } catch { /* pool disabled without undici */ }

// ───────── state ─────────
let all = new Map();          // 'ip:port' → proxy url (both lists merged)
let alive = [];               // [proxy urls] — last known good (fastest first)
let aliveAt = 0;              // when the alive list was computed
let checking = null;          // running check promise
let cursor = 0;               // round-robin pointer
const badUntil = new Map();   // proxy url → ts (runtime failures)
const lastUsed = new Map();   // proxy url → ts (rotate least-recently-used first)
const agents = new Map();     // proxy url → undici ProxyAgent (reuse connections)

// ───────── helpers ─────────
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
let settingsCache = { at: 0, v: false };
function enabled() {
    if (process.env.PROXY_POOL === '0') return false;
    if (Date.now() - settingsCache.at > 30e3) { settingsCache = { at: Date.now(), v: loadSettings().proxyPool !== false }; }
    return settingsCache.v;
}
function normalize(line) {
    line = String(line || '').trim();
    if (!line || line.startsWith('#')) return null;
    if (/^https?:\/\//i.test(line)) return line.replace(/\/+$/, '');
    if (/^[\w.-]+:\d{2,5}$/.test(line)) return 'http://' + line;      // ip:port / host:port
    return null;
}
function load() {
    all = new Map();
    for (const f of [POOL_FILE, USER_FILE]) {
        let txt = '';
        try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
        for (const line of txt.split(/\r?\n/)) {
            const p = normalize(line);
            if (p) all.set(p.replace(/^https?:\/\//, ''), p);
        }
    }
    // restore cached alive list
    try {
        const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (c && Array.isArray(c.alive) && Date.now() - c.at < ALIVE_TTL && c.listHash === listHash()) {
            alive = c.alive.filter(p => all.has(p.replace(/^https?:\/\//, '')));
            aliveAt = c.at;
        }
    } catch { }
    return all.size;
}
function listHash() {
    const keys = [...all.keys()];
    return keys.length + ':' + (keys.length ? require('crypto').createHash('md5').update(keys.sort().join(',')).digest('hex').slice(0, 8) : '');
}
function saveCache() {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ at: aliveAt, alive: alive.slice(0, 200), listHash: listHash() })); } catch { }
}

// ───────── health check ─────────
async function checkOne(url) {
    if (!undici) return false;
    try {
        const agent = agentFor(url);
        const r = await undici.fetch(CHECK_URL, { dispatcher: agent, signal: AbortSignal.timeout(CHECK_TIMEOUT), headers: { 'User-Agent': 'kaviz-md-bot' } });
        try { await r.body?.cancel(); } catch { }
        return r.status >= 200 && r.status < 400;
    } catch { return false; }
}
function agentFor(url) {
    let a = agents.get(url);
    if (!a) { a = new undici.ProxyAgent({ uri: url, connect: { timeout: 8000 } }); agents.set(url, a); }
    return a;
}

async function checkNow(reason = 'manual') {
    if (checking) return checking;
    if (!all.size) load();
    if (!all.size) return { total: 0, alive: 0 };
    const list = [...all.values()];
    checking = (async () => {
        const good = [];
        let i = 0;
        const worker = async () => {
            while (i < list.length) {
                const p = list[i++];
                if (await checkOne(p)) good.push(p);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
        alive = good;
        aliveAt = Date.now();
        saveCache();
        console.log(`[proxypool] check (${reason}): ${alive.length}/${all.size} alive ✅`);
        return { total: all.size, alive: alive.length };
    })().finally(() => { checking = null; });
    return checking;
}

/** background warm-up — call once at bot start (non-blocking) */
function warmup() {
    if (!enabled() || !undici) return;
    load();
    if (!all.size) return;
    if (alive.length && Date.now() - aliveAt < REFRESH_MS) return;
    if (!checking) checkNow('warmup').catch(() => { });
    setInterval(() => { if (enabled() && !checking) checkNow('refresh').catch(() => { }); }, REFRESH_MS).unref();
}

// ───────── public API ─────────
/** up to n TESTED-alive proxies (round-robin, cooldown-aware). [] when none ready yet. */
function candidates(n = 2) {
    if (!enabled() || !undici) return [];
    if (!all.size) load();
    const now = Date.now();
    const pool = alive.filter((p) => (badUntil.get(p) || 0) < now);
    if (!pool.length) return [];
    const out = [];
    for (let k = 0; k < pool.length && out.length < n; k++) {
        const p = pool[cursor++ % pool.length];
        if (!out.includes(p)) out.push(p);
    }
    for (const p of out) lastUsed.set(p, now);
    return out;
}
const hasCandidates = () => enabled() && alive.some((p) => (badUntil.get(p) || 0) < Date.now());
const isPool = (p) => all.has(String(p || '').replace(/^https?:\/\//, ''));
function markGood(p) { if (isPool(p)) { badUntil.delete(p); if (!alive.includes(p)) { alive.push(p); aliveAt = Date.now(); } } }
function markBad(p) { if (isPool(p)) badUntil.set(p, Date.now() + BAD_COOLDOWN); }

function stats() {
    if (!all.size) load();
    const now = Date.now();
    const usable = alive.filter((p) => (badUntil.get(p) || 0) < now);
    let userCount = 0;
    try { userCount = fs.readFileSync(USER_FILE, 'utf8').split(/\r?\n/).map(normalize).filter(Boolean).length; } catch { }
    return {
        enabled: enabled(),
        total: all.size, shipped: all.size - userCount, user: userCount,
        alive: alive.length, usable: usable.length,
        checkedAgo: aliveAt ? Math.round((now - aliveAt) / 60e3) : null,   // minutes
        checking: !!checking,
        next: usable.length ? usable[cursor % usable.length] : null,
    };
}

function resetSettingsCache() { settingsCache = { at: 0, v: false }; }

load();
module.exports = { warmup, checkNow, candidates, hasCandidates, markGood, markBad, isPool, stats, enabled, resetSettingsCache, load, normalize };
