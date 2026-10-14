/**
 * ai_tools.js — 🧰 GLM connector tools (v2.50)
 * Z.ai GLM එකට function-calling එකෙන් connect වෙන abilities:
 *   web_search · get_datetime · calculator · weather · youtube_search
 * runTool() කවදාවත් throw කරන්නේ නෑ — error string එකක් return කරනවා (model ට කියනවා)
 */
const TOOL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for CURRENT/fresh facts and news (today info, prices, scores, releases...). Returns top results with title, url and snippet.',
            parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_datetime',
            description: 'Get the current date, day of week and time. Default timezone is Asia/Colombo (Sri Lanka). Use this whenever the user asks "today", "now", dates or deadlines.',
            parameters: { type: 'object', properties: { tz: { type: 'string', description: 'Optional IANA timezone, e.g. Asia/Colombo' } } }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculator',
            description: 'Evaluate an arithmetic expression (+ - * / ( ) %). Use for ANY math beyond trivial.',
            parameters: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. 12*(3+4)/2' } }, required: ['expression'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'weather',
            description: 'Current weather + today min/max for a city.',
            parameters: { type: 'object', properties: { location: { type: 'string', description: 'City name, e.g. Colombo' } }, required: ['location'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'youtube_search',
            description: 'Search YouTube. Returns top videos with title, duration, channel and link.',
            parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search words' } }, required: ['query'] }
        }
    }
];

// ── fetch helpers (timeout + browser UA + proxy-pool fallback) ──
function ffetch(url, opts = {}, ms = 9000) {
    const c = new AbortController();
    const t = setTimeout(() => { try { c.abort(); } catch { } }, ms);
    return fetch(url, { ...opts, signal: c.signal, headers: { 'User-Agent': TOOL_UA, ...(opts.headers || {}) } }).finally(() => clearTimeout(t));
}
async function ffetchPool(url, opts, ms) { // direct fail → free proxy pool
    try {
        const r = await ffetch(url, opts, ms);
        if (r.ok) return r;
    } catch { }
    try { return await require('./net').viaPool(url, opts || {}); } catch { }
    return ffetch(url, opts, ms); // last direct try → caller sees the real error
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (m) => ENT[m] || m).replace(/\s+/g, ' ').trim();
function cleanUrl(u) {
    u = String(u || '');
    if (u.startsWith('//')) u = 'https:' + u;
    const m = u.match(/[?&]uddg=([^&]+)/);
    if (m) { try { u = decodeURIComponent(m[1]); } catch { } }
    return u.split('#')[0];
}

// ── 🔎 web search (DuckDuckGo html → lite fallback) ──
async function webSearch(q) {
    q = String(q || '').trim().slice(0, 300);
    if (!q) throw new Error('empty query');
    let r = await ffetch('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'en' }, body: new URLSearchParams({ q }).toString() }, 11000);
    let html = r.ok ? await r.text() : '';
    let links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    let snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    if (!links.length) { // lite fallback
        r = await ffetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } }, 11000);
        html = r.ok ? await r.text() : '';
        links = [...html.matchAll(/<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
        snips = [...html.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)];
    }
    if (!links.length) throw new Error('no results (or blocked)');
    const out = [];
    for (let i = 0; i < links.length && out.length < 5; i++) {
        const url = cleanUrl(links[i][1]);
        if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // ads
        const snip = snips[i] ? clean(snips[i][1]).slice(0, 220) : '';
        out.push(`${out.length + 1}. ${clean(links[i][2]).slice(0, 110)}\n   ${url}${snip ? '\n   ' + snip : ''}`);
    }
    if (!out.length) throw new Error('no results');
    return out.join('\n');
}

// ── 🕐 date/time (default Asia/Colombo — user timezone) ──
function getDateTime(args = {}) {
    let tz = String(args.tz || 'Asia/Colombo');
    try { Intl.DateTimeFormat(undefined, { timeZone: tz }); } catch { tz = 'Asia/Colombo'; }
    const now = new Date();
    const d = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now);
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    return `${d} — ${t} (${tz}) · unix ${Math.floor(now.getTime() / 1000)}`;
}

// ── 🧮 calculator (whitelisted — injection safe) ──
function calc(expression) {
    const e = String(expression || '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '').slice(0, 120);
    if (!e) throw new Error('empty expression');
    if (!/^[\d+\-*/().%eE]+$/.test(e)) throw new Error('invalid characters');
    const v = Function('"use strict";return(' + e + ')')();
    if (typeof v !== 'number' || !isFinite(v)) throw new Error('not a finite number');
    return String(Math.round(v * 1e10) / 1e10);
}

// ── ⛅ weather (wttr.in j1 — free, no key) ──
async function weather(loc) {
    loc = String(loc || '').trim().slice(0, 100);
    if (!loc) throw new Error('empty location');
    const r = await ffetchPool('https://wttr.in/' + encodeURIComponent(loc) + '?format=j1', { headers: { 'Accept': 'application/json' } }, 12000);
    if (!r.ok) throw new Error('weather http ' + r.status);
    const j = JSON.parse(await r.text());
    const c = j.current_condition && j.current_condition[0];
    if (!c) throw new Error('no weather data');
    const area = (j.nearest_area && j.nearest_area[0] && j.nearest_area[0].areaName && j.nearest_area[0].areaName[0] && j.nearest_area[0].areaName[0].value) || loc;
    let out = `${area}: ${c.temp_C}°C (feels ${c.FeelsLikeC}°C), ${clean(c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value)}, humidity ${c.humidity}%, wind ${c.windspeedKmph}km/h`;
    const w = (j.weather || [])[0];
    if (w) out += ` · today ${w.mintempC}–${w.maxtempC}°C`;
    return out;
}

// ── 📺 YouTube search (yt-search pkg — bot එකේ දැනටමත් dependency) ──
let _yts = null;
async function ytSearch(q) {
    q = String(q || '').trim().slice(0, 200);
    if (!q) throw new Error('empty query');
    _yts = _yts || require('yt-search');
    const r = await _yts({ query: q, pageStart: 1, pageEnd: 1 });
    const vids = (r.videos || []).slice(0, 5);
    if (!vids.length) throw new Error('no videos');
    return vids.map((v, i) => `${i + 1}. ${String(v.title || '').slice(0, 100)}${v.timestamp ? ' [' + v.timestamp + ']' : ''} — ${v.author && v.author.name ? v.author.name : '?'}\n   ${v.url}`).join('\n');
}

// ── dispatcher — never throws ──
async function runTool(name, argsJson) {
    let args = {};
    try { args = JSON.parse(argsJson || '{}') || {}; } catch { }
    try {
        switch (String(name || '')) {
            case 'web_search': return await webSearch(args.query);
            case 'get_datetime': return getDateTime(args);
            case 'calculator': return calc(args.expression);
            case 'weather': return await weather(args.location);
            case 'youtube_search': return await ytSearch(args.query);
            default: return 'Unknown tool: ' + name;
        }
    } catch (e) { return 'Tool error: ' + String(e && e.message || e).slice(0, 150); }
}

module.exports = { TOOLS, runTool, _webSearch: webSearch, _getDateTime: getDateTime, _calc: calc, _weather: weather, _ytSearch: ytSearch };
