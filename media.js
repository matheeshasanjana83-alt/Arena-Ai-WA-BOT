/**
 * media.js — yt-dlp + ffmpeg manager for KAVIZ MD V1 (v2.15)
 *   (ported & cleaned up from SmokeBoy v3.7 downloader.js)
 *
 *  • Panel / Linux (x64, arm64): downloads static yt-dlp + ffmpeg into ./bin on first use
 *  • Termux: uses `pkg install yt-dlp ffmpeg` (static linux binaries don't run on Android)
 *  • Env overrides: YTDLP_PATH, FFMPEG_PATH
 *  • Files are written to DL_TMP and streamed to WhatsApp (no big buffers in RAM)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const BIN = path.join(__dirname, 'bin');
const TMP = () => process.env.DL_TMP || os.tmpdir();
const isTermux = () => /com\.termux/.test(process.env.PREFIX || '') || fs.existsSync('/data/data/com.termux');

function which(name) {
    for (const d of (process.env.PATH || '').split(':')) {
        const p = path.join(d, name);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { }
    }
    return null;
}

const ASSETS = {
    'yt-dlp': { x64: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', arm64: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64' },
    ffmpeg: { x64: 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-x64', arm64: 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-arm64' },
};

async function downloadBin(url, dest) {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'kaviz-md-bot' } });
    if (!r.ok) throw new Error(`${path.basename(dest)} download fail (${r.status})`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    await new Promise((res, rej) => { const w = fs.createWriteStream(tmp); Readable.fromWeb(r.body).on('error', rej).pipe(w).on('finish', res).on('error', rej); });
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
}

const pending = {};
/** path to a working binary ('yt-dlp' | 'ffmpeg'), downloading it if needed */
function getBin(name) {
    const env = name === 'yt-dlp' ? process.env.YTDLP_PATH : process.env.FFMPEG_PATH;
    if (env && fs.existsSync(env)) return Promise.resolve(env);
    const local = path.join(BIN, name);
    if (fs.existsSync(local)) { if (name === 'yt-dlp') checkUpdate().catch(() => { }); return Promise.resolve(local); }
    const sys = which(name);
    if (sys) return Promise.resolve(sys);
    if (isTermux()) return Promise.reject(Object.assign(new Error(`${name} නෑ. Termux එකේ මේක ගහන්න:  pkg install yt-dlp ffmpeg`), { code: 'NO_BIN' }));
    const url = ASSETS[name][process.arch];
    if (!url || process.platform !== 'linux') return Promise.reject(new Error(`${name}: මේ device එකට (${process.platform}/${process.arch}) auto download නෑ`));
    return (pending[name] ||= downloadBin(url, local).then(() => local).finally(() => { delete pending[name]; }));
}

// ── yt-dlp auto-update ──
// stale extractor = Facebook "Cannot parse data" / YouTube format errors → keep our ./bin/yt-dlp fresh
// (only our own ./bin binary — Termux pkg / system / YTDLP_PATH ones are managed elsewhere)
let updateRunning = null;
let lastForced = 0;
async function ytdlpVersion(bin) { const r = await run(bin, ['--version'], 30e3); return r.code === 0 ? r.out.trim() : ''; }

async function checkUpdate(force = false) {
    if (isTermux()) return;
    const local = path.join(BIN, 'yt-dlp');
    if (!fs.existsSync(local)) return;
    const st = fs.statSync(local);
    if (force && Date.now() - lastForced < 3600e3) return;                      // force update max 1/hour
    if (!force && Date.now() - st.mtimeMs < 24 * 3600e3) return;               // auto check once a day
    if (updateRunning) return updateRunning;
    lastForced = Date.now();
    updateRunning = (async () => {
        try {
            const r = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { 'User-Agent': 'kaviz-md-bot', Accept: 'application/vnd.github+json' } });
            if (!r.ok) return;
            const latest = String((await r.json()).tag_name || '').replace(/^v/, '');
            if (!latest) return;
            const cur = await ytdlpVersion(local);
            if (cur && cur !== latest) {
                const url = ASSETS['yt-dlp'][process.arch] || ASSETS['yt-dlp'].x64;
                try { await downloadBin(url, local); console.log(`[media] yt-dlp ${cur} → ${latest} update කළා ✅`); }
                catch (e) { console.log('[media] yt-dlp update fail: ' + e.message); }
            } else { fs.utimesSync(local, new Date(), new Date()); }          // checked → snooze 24h
        } catch { } finally { updateRunning = null; }
    })();
    return updateRunning;
}

const EXTRACT_BROKEN = /Cannot parse data|Unable to extract|no video formats|Requested format is not available|player response/i;

// ── YouTube cookies (.setcookies → cookies.txt in bot dir) ──
function cookiesFile() {
    const p = path.join(__dirname, 'cookies.txt');
    try { return fs.existsSync(p) && fs.statSync(p).size > 50 ? p : null; } catch { return null; }
}

/** common yt-dlp flags: cookies when available */
function cookieArgs(args) {
    const ck = cookiesFile();
    if (ck) args.push('--cookies', ck);
    return args;
}

function run(bin, args, timeout = 15 * 60e3) {
    return new Promise((resolve) => {
        const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', (d) => { out += d; if (out.length > 20e6) out = out.slice(-20e6); });
        p.stderr.on('data', (d) => { err += d; if (err.length > 1e5) err = err.slice(-1e5); });
        const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } }, timeout);
        p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
        p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    });
}

function proxyArg() {
    try { const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8')).proxy; return p || process.env.DL_PROXY || ''; } catch { return process.env.DL_PROXY || ''; }
}

function ytError(t) {
    t = String(t || '');
    if (/sign in to confirm|not a bot|confirm you.re not/i.test(t)) return 'YouTube මේ server IP එකට "bot check" එකක් දානවා (datacenter IP block). Fix: *.setcookies* (browser cookies — හොඳම විසඳුම) එකක්, *.setproxy* එකක්, නැත්නම් Termux එකෙන් try කරන්න.';
    if (/Cannot parse data|Unable to extract/i.test(t)) return 'Site එකේ page structure එක වෙනස් වෙලා — yt-dlp අලුත් version එකක් ඕනේ. ටිකකින් ආයෙත් try කරන්න (bot එක yt-dlp එක auto-update කරගන්නවා).';
    if (/private video|login required|registered users|cookies/i.test(t)) return 'Video එක private / login ඕනේ — public videos විතරයි.';
    if (/unsupported url/i.test(t)) return 'මේ site එක support නෑ.';
    if (/video unavailable|removed|does not exist|404/i.test(t)) return 'Video එක නෑ / delete කරලා.';
    if (/max-filesize|larger than max|File is larger/i.test(t)) return 'Video එක size limit එකට වඩා ලොකුයි — කෙටි video එකක්, අඩු quality එකක් (*.video <link> 480*) හෝ .yta (audio) try කරන්න.';
    if (/403|forbidden/i.test(t)) return 'Site එක block කළා (403).';
    if (/429|too many/i.test(t)) return 'Requests ගොඩක් (429) — ටිකකින් ආයෙත් try කරන්න.';
    const m = t.match(/ERROR:\s*(.+)/);
    return (m ? m[1] : t.split('\n').filter(Boolean).pop() || 'yt-dlp error').slice(0, 250);
}
const blocked = (t) => /sign in to confirm|not a bot|403|forbidden|429|timed out|unable to connect|connection (reset|refused)/i.test(String(t));

async function info(url) {
    const yt = await getBin('yt-dlp');
    let r = await run(yt, cookieArgs(['-J', '--no-playlist', '--no-warnings', '--skip-download']).concat([url]), 120e3);
    if (r.code !== 0 && /sign in to confirm|not a bot/i.test(r.err))   // bot check → alternate clients
        r = await run(yt, cookieArgs(['-J', '--no-playlist', '--no-warnings', '--skip-download']).concat(['--extractor-args', 'youtube:player_client=web_safari,tv,mweb', url]), 120e3);
    const px = proxyArg();
    if (r.code !== 0 && px && blocked(r.err)) r = await run(yt, cookieArgs(['-J', '--no-playlist', '--no-warnings', '--skip-download']).concat(['--proxy', px, url]), 120e3);
    if (r.code !== 0) {
        if (EXTRACT_BROKEN.test(r.err || r.out)) checkUpdate(true).catch(() => { });   // stale extractor → update in background
        throw new Error(ytError(r.err || r.out));
    }
    return JSON.parse(r.out);
}

/**
 * Download with yt-dlp → { path, ext, height, size }   (caller deletes the file)
 * mode: 'video' | 'audio'   height: preferred max height (e.g. 1080) or null
 */
async function ytdl(url, { mode = 'video', maxMB = 100, height = null } = {}) {
    const yt = await getBin('yt-dlp');
    let ff = null; try { ff = await getBin('ffmpeg'); } catch { }
    const px = proxyArg();
    const ALL_H = [2160, 1440, 1080, 720, 480, 360];
    // user picked a height → try it first, then fall down; default chain: ALL qualities (2160 → 360) — v2.15 "all quality"
    const heights = mode === 'audio' ? [null] : height
        ? [...ALL_H.filter((x) => x <= height), ...ALL_H.filter((x) => x > height)]
        : [2160, 1440, 1080, 720, 480, 360];
    const ck = cookiesFile();
    // attempts: plain → alt-clients → cookies (if any) → proxy combos
    const attempts = [];
    for (const useProxy of px ? [false, true] : [false]) {
        attempts.push({ proxy: useProxy, alt: false, ck: false });
        if (ck) attempts.push({ proxy: useProxy, alt: false, ck: true });
        attempts.push({ proxy: useProxy, alt: true, ck: false });
        if (ck) attempts.push({ proxy: useProxy, alt: true, ck: true });
    }
    let lastErr = '';
    outer:
    for (const at of attempts) {
        for (const h of heights) {
            const fmt = mode === 'audio' ? 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio'
                : ff ? `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/b[height<=${h}]/b`
                    : `b[height<=${h}][ext=mp4]/b[height<=${h}]/b`;
            const prefix = `yt-${process.pid}-${Date.now().toString(36)}`;
            const args = ['--no-playlist', '--no-warnings', '--no-part', '--max-filesize', `${maxMB}M`, '-f', fmt, '-o', path.join(TMP(), prefix + '.%(ext)s')];
            if (at.ck) args.push('--cookies', ck);
            if (at.alt) args.push('--extractor-args', 'youtube:player_client=web_safari,tv,mweb');
            if (ff) args.push('--ffmpeg-location', ff);
            if (mode === 'video' && ff) args.push('--merge-output-format', 'mp4');
            if (at.proxy) args.push('--proxy', px);
            args.push(url);
            const r = await run(yt, args);
            const produced = fs.readdirSync(TMP()).filter((f) => f.startsWith(prefix + '.') && !/\.(part|ytdl|temp)$/.test(f));
            const main = produced.find((f) => !/\.f\d+\./.test(f)) || produced[0];
            if (r.code === 0 && main) {
                for (const f of produced) if (f !== main) fs.rmSync(path.join(TMP(), f), { force: true });
                const p = path.join(TMP(), main);
                const size = fs.statSync(p).size;
                if (size > maxMB * 1048576) { fs.rmSync(p, { force: true }); lastErr = 'File is larger than max'; continue; }
                return { path: p, ext: path.extname(main).slice(1) || (mode === 'audio' ? 'm4a' : 'mp4'), height: h, size, proxy: at.proxy };
            }
            for (const f of produced) fs.rmSync(path.join(TMP(), f), { force: true });
            lastErr = r.err || r.out || (r.code === 0 ? 'File is larger than max' : '');
            if (EXTRACT_BROKEN.test(lastErr)) { checkUpdate(true).catch(() => { }); break outer; }   // stale extractor → updating won't help this run
            if (blocked(lastErr)) break;               // IP block → next attempt (cookies / alt clients / proxy)
            if (!/larger than max|max-filesize|requested format/i.test(lastErr)) break outer;   // real error → stop
        }
    }
    throw new Error(ytError(lastErr));
}

// ───────── stickers (ffmpeg → webp + Exif pack/author) ─────────
async function toWebp(input, { animated = false } = {}) {
    const ff = await getBin('ffmpeg');
    const vfBase = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
    const out = path.join(TMP(), `st-${process.pid}-${Date.now().toString(36)}.webp`);
    try {
        if (!animated) {
            const r = await run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', vfBase, '-c:v', 'libwebp', '-q:v', '75', '-frames:v', '1', out], 60e3);
            if (r.code !== 0) throw new Error('ffmpeg: ' + (r.err || '').slice(-200));
            return fs.readFileSync(out);
        }
        // animated: shrink until WhatsApp's ~500 KB limit
        for (const [fps, q, secs, size] of [[15, 50, 6, 512], [12, 35, 6, 512], [10, 25, 5, 512], [10, 20, 4, 384], [8, 15, 3, 320]]) {
            const vf = `fps=${fps},` + vfBase.replace(/512/g, String(size)) + (size < 512 ? `,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000` : '');
            const r = await run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-t', String(secs), '-i', input, '-vf', vf, '-c:v', 'libwebp', '-loop', '0', '-q:v', String(q), '-an', '-vsync', '0', out], 120e3);
            if (r.code !== 0) throw new Error('ffmpeg: ' + (r.err || '').slice(-200));
            const b = fs.readFileSync(out);
            if (b.length <= 500 * 1024) return b;
        }
        throw new Error('video sticker එක 500 KB ට අඩු කරන්න බැරි වුණා — කෙටි video එකක් try කරන්න');
    } finally { fs.rmSync(out, { force: true }); }
}

async function addExif(webp, pack = 'KAVIZ MD V1', author = 'KAVIZ MD V1') {
    try {
        const { Image } = require('node-webpmux');
        const img = new Image();
        await img.load(webp);
        const json = { 'sticker-pack-id': 'kaviz-md-' + Date.now(), 'sticker-pack-name': pack, 'sticker-pack-publisher': author, emojis: ['🤖'] };
        const head = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
        const body = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([head, body]);
        exif.writeUIntLE(body.length, 14, 4);
        img.exif = exif;
        return await img.save(null);
    } catch { return webp; }   // sticker still works without pack name
}

async function makeSticker(buf, { animated = false, pack, author } = {}) {
    const inp = path.join(TMP(), `in-${process.pid}-${Date.now().toString(36)}`);
    fs.writeFileSync(inp, buf);
    try { return await addExif(await toWebp(inp, { animated }), pack, author); }
    finally { fs.rmSync(inp, { force: true }); }
}

/** server-side download of a media URL → file path (proxy-aware via smartFetch, caller deletes)
 *  opts: { referer, maxBytes (abort mid-stream when larger), ext ('mp4' default) } */
async function fetchToFile(url, prefix, { referer, maxBytes, ext } = {}) {
    const { smartFetch } = require('./net');
    const headers = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', Accept: '*/*' };
    if (referer) headers.Referer = referer;
    const r = await smartFetch(url, { headers, redirect: 'follow' });
    if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error(`HTTP ${r.status}`); }
    const p = path.join(TMP(), `${prefix}-${process.pid}-${Date.now().toString(36)}.${ext || 'mp4'}`);
    try {
        await new Promise((res, rej) => {
            const w = fs.createWriteStream(p);
            let loaded = 0, done = false;
            const src = Readable.fromWeb(r.body);
            src.on('data', (c) => {
                loaded += c.length;
                if (maxBytes && loaded > maxBytes && !done) {
                    done = true; src.destroy(); w.destroy();
                    rej(new Error(`file එක ${Math.round(maxBytes / 1048576)} MB limit එකට වඩා ලොකුයි`));
                }
            });
            src.on('error', (e) => { if (!done) { done = true; rej(e); } });
            w.on('error', (e) => { if (!done) { done = true; rej(e); } });
            w.on('finish', () => { if (!done) { done = true; res(); } });
            src.pipe(w);
        });
        const size = fs.statSync(p).size;
        if (size < 10 * 1024) throw new Error('download වුණු file එක වැරදියි (පුංචියි)');
        return p;
    } catch (e) { fs.rmSync(p, { force: true }); throw e; }
}

/** follow redirects manually (fb.watch share links → yt-dlp generic extractor redirect-loop bug) */
async function resolveRedirects(url, max = 6) {
    const { smartFetch } = require('./net');
    let cur = url;
    for (let i = 0; i < max; i++) {
        const r = await smartFetch(cur, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, redirect: 'manual' });
        const loc = r.headers.get('location');
        try { await r.body?.cancel(); } catch { }
        if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
        if (r.ok) return cur;
        throw new Error(`HTTP ${r.status}`);
    }
    throw new Error('redirect ගොඩක් (loop)');
}

module.exports = { getBin, info, ytdl, makeSticker, addExif, ytError, isTermux, fetchToFile, resolveRedirects, cookiesFile, checkUpdate, _run: run };
