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
    },
    {
        type: 'function',
        function: {
            name: 'generate_image',
            description: 'CREATE/generate/draw a NEW image from a text description (photo, art, anime, logo, poster, character). Use ONLY when the user asks you to MAKE an image. Write a RICH vivid English prompt covering: exact subject + action, setting/background, lighting (golden hour/soft/studio), style (photorealistic/cinematic/anime/painting), composition (full scene, NOT a crop). Never send a bare noun phrase like \'a bird\' — describe the whole scene.',
            parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Image description in English, detailed and vivid' } }, required: ['prompt'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_url',
            description: 'Read the text content of a web page link (articles, blogs, docs, news posts). Use when the user shares a link and asks about it, or when you need details from a specific page.',
            parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full http(s) URL to read' } }, required: ['url'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_reminder',
            description: 'Set a reminder/alarm for the user. FIRST call get_datetime to know the current time, then compute the target time. The time MUST be ISO 8601 with +05:30 offset (Sri Lanka), e.g. 2026-10-15T08:00:00+05:30.',
            parameters: { type: 'object', properties: { time: { type: 'string', description: 'ISO 8601 date-time with +05:30 offset' }, note: { type: 'string', description: 'What to remind — keep the user language' } }, required: ['time', 'note'] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_reminders',
            description: 'List the currently active reminders of this user.',
            parameters: { type: 'object', properties: {} }
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

// ── 🖼 generate image (v2.52 SUPER chain) — Gemini nano-banana (ChatGPT-මට්ටම quality, free-tier quota ඇතෙනම්) → Pollinations flux ──
// probe 2026-10-14: cogview-3-flash 400 Unknown Model (Z.ai ගෙන් අයින්) · cogview-4 paid · gemini image models 429-quota (free tier strict — ඒත් quota තියෙන දවසක ChatGPT-මට්ටුම output!)
const GEMINI_IMG_MODELS = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'];
async function geminiImage(prompt, key) {
    for (const model of GEMINI_IMG_MODELS) {
        try {
            const opts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Generate an image: ' + prompt }] }],
                    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
                })
            };
            let r = await ffetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, opts, 90e3);
            if (!r.ok && r.status === 429) {   // quota → මේ model එකෙන් ඉවත් වෙලා අනිත් එකට
                try { const rp = await require('./net').viaPool(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, opts); if (rp && rp.ok) r = rp; } catch { }
                if (!r.ok || r.status === 429) continue;
            }
            if (!r.ok) continue;
            const j = JSON.parse(await r.text());
            const parts = j?.candidates?.[0]?.content?.parts || [];
            const ip = parts.find(p => p.inline_data || p.inlineData);
            const d = ip ? (ip.inline_data || ip.inlineData) : null;
            if (!d || !d.data) continue;
            const buf = Buffer.from(d.data, 'base64');
            if (buf.length > 2000) return buf;
        } catch { } // මේ model fail → ඊළඟ model
    }
    throw new Error('gemini image unavailable (quota)');
}
async function generateImage(prompt, keys) {
    if (typeof keys === 'string') keys = { zai: keys };   // v2.51 legacy — string zaiKey එවත් වැඩ කරන්න
    prompt = String(prompt || '').trim().slice(0, 600);
    if (!prompt) throw new Error('empty prompt');
    if (keys && keys.gemini) {
        try { return await geminiImage(prompt, keys.gemini); } catch { } // quota/denied → pollinations
    }
    const seed = Math.floor(Math.random() * 1e9);
    const r2 = await ffetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 400))}?width=1024&height=1024&nologo=true&safe=true&model=flux&seed=${seed}`, {}, 90e3);
    if (!r2.ok) throw new Error('image gen fail (' + r2.status + ')');
    const ct = String(r2.headers.get('content-type') || '');
    const buf2 = Buffer.from(await r2.arrayBuffer());
    if (!ct.startsWith('image/') || buf2.length < 2000) throw new Error('image gen fail (bad output)');
    return buf2;
}

// ── 📖 read url — page text කියවලා දෙනවා (Deep Research / document power) ──
async function readUrl(u) {
    u = String(u || '').trim();
    if (!/^https?:\/\//i.test(u)) throw new Error('http(s) link එකක් දෙන්න');
    if (u.length > 500) throw new Error('url too long');
    const r = await ffetchPool(u, { headers: { 'Accept': 'text/html,application/xhtml+xml,text/plain,application/json,*/*' } }, 14000);
    if (!r.ok) throw new Error('http ' + r.status);
    const ct = String(r.headers.get('content-type') || '');
    let raw = await r.text();
    if (raw.length > 300000) raw = raw.slice(0, 300000);
    let title = '', text = '';
    if (/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(raw)) {
        title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
        text = raw
            .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ');
        text = text.replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (m) => ENT[m] || m)
            .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    } else text = raw.replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('page එකේ text නෑ (JS-only site වෙන්න පුළුවන්)');
    return `PAGE: ${clean(title).slice(0, 120)}\nURL: ${u}\n\n${text.slice(0, 4500)}`;
}

// ── ⏰ reminders (reminders.js wrapper — chat context එක call එකෙන්ම එනවා, race-free) ──
function setReminder(args, ctx) {
    const rem = require('./reminders');
    if (!ctx || !ctx.chatId) throw new Error('chat context missing');
    if (!args.time) throw new Error('time ඕන — ISO 8601 (2026-10-15T08:00:00+05:30)');
    return rem.toolAdd(ctx.chatId, args.time, args.note || args.text || args.what);
}
function listReminders(ctx) {
    const rem = require('./reminders');
    if (!ctx || !ctx.chatId) throw new Error('chat context missing');
    return rem.toolList(ctx.chatId);
}

// ── dispatcher — never throws (v2.51: {text, image} shape — image = WhatsApp එකට යවන Buffer) ──
async function runToolEx(name, argsJson, ctx) {
    let args = {};
    try { args = JSON.parse(argsJson || '{}') || {}; } catch { }
    try {
        switch (String(name || '')) {
            case 'web_search': return { text: await webSearch(args.query) };
            case 'get_datetime': return { text: getDateTime(args) };
            case 'calculator': return { text: calc(args.expression) };
            case 'weather': return { text: await weather(args.location) };
            case 'youtube_search': return { text: await ytSearch(args.query) };
            case 'generate_image': {
                const buf = await generateImage(args.prompt, { zai: ctx && ctx.zaiKey, gemini: ctx && ctx.geminiKey });
                return { text: `Image generated OK — prompt: ${String(args.prompt).slice(0, 150)}`, image: buf, mime: 'image/jpeg' };
            }
            case 'read_url': return { text: await readUrl(args.url) };
            case 'set_reminder': return { text: setReminder(args, ctx) };
            case 'list_reminders': return { text: listReminders(ctx) };
            default: return { text: 'Unknown tool: ' + name };
        }
    } catch (e) { return { text: 'Tool error: ' + String(e && e.message || e).slice(0, 150) }; }
}
async function runTool(name, argsJson, ctx) { return (await runToolEx(name, argsJson, ctx)).text; }   // v2.50 compat

module.exports = { TOOLS, runTool, runToolEx, _webSearch: webSearch, _getDateTime: getDateTime, _calc: calc, _weather: weather, _ytSearch: ytSearch, _generateImage: generateImage, _readUrl: readUrl };
