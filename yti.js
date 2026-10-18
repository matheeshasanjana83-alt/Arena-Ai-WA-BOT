/**
 * yti.js — youtubei.js (Innertube) YouTube fallback for .song/.video — v2.67
 *
 * WHY (the Asitha-MD secret, deobfuscated): their downloader literally does
 *   const { Innertube } = require('youtu' + 'bei.j' + 's');   // = youtubei.js
 * yt-dlp 2026 without cookies gets "Sign in to confirm you're not a bot" (HTTP 403) on
 * datacenter IPs — youtubei.js keeps a NATIVE innertube session (BotGuard PO-token
 * machinery + signature deciphering in-process, no external JS runtime) and keeps working
 * from the same IP. Probe evidence 2026-10: dev-box yt-dlp = IP-blocked, youtubei.js = OK.
 *
 * Ladder after this change (features.js): yt-dlp (EJS+node) → youtubei.js (HERE) → clipto.com.
 * Exports: info(url) · rows(inf, mode, capMB) [pure] · fetch(url, mode, height, capMB)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

// ── v18 evaluator contract: Platform.shim.eval(data, eval_args) must run the extracted
// player script (data.output ENDS with `return process(...)` — baked-in args) and return
// its result object. Node needs NO quickjs — `new Function` executes it (same trust level
// as yt-dlp running the player JS under deno). Idempotent patch at module load.
const _patchEval = () => {
    try {
        const { Platform } = require('youtubei.js');
        if (!Platform?.shim || Platform.shim.__kzEval) return;
        Platform.shim.eval = (data) => new Function(data.output)();
        Platform.shim.__kzEval = true;
    } catch { }   // package missing → ladder continues to clipto
};
_patchEval();

const TMP = () => process.env.DL_TMP || os.tmpdir();

// one shared session — fresh visitor-data / po-token context every 30 min
let _sess = null, _sessAt = 0;
const CLIENT = String(process.env.YTI_CLIENT || 'WEB');
async function sess() {
    if (!_sess || Date.now() - _sessAt > 30 * 60e3) {
        _patchEval();
        const yti = require('youtubei.js');
        _sess = await yti.Innertube.create({ client_type: CLIENT });
        _sessAt = Date.now();
    }
    return _sess;
}

const ID_RE = /(?:youtube\.com\/(?:watch\?[^ ]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/** innertube getBasicInfo — throws on playability walls (LOGIN_REQUIRED etc.) */
async function info(url) {
    const m = String(url || '').match(ID_RE);
    if (!m) throw new Error('youtube id එක හොයාගන්න බැරි වුණා');
    const yt = await sess();
    const inf = await yt.getBasicInfo(m[1]);
    const st = inf.playability_status?.status;
    if (st && st !== 'OK') throw new Error('yti playability ' + st + (inf.playability_status?.reason ? ': ' + inf.playability_status.reason : ''));
    if (!inf.streaming_data?.adaptive_formats?.length && !inf.streaming_data?.formats?.length) throw new Error('yti streaming_data නෑ');
    return inf;
}

// ───────── rows — SAME row shape as features.ytRows / cliptoRows (pure — offline tests):
//   { label, pick, size, h? }  → the SAME bridge builds ".song <url> m4a|320k|128k" / ".video <url> <h>"
// innertube shapes: basic_info.duration = SECONDS; adaptive_formats[] = { itag, mime_type,
//   bitrate, average_bitrate, content_length, audio_quality, height, has_audio, has_video, is_progressive }
function rows(inf, mode, capMB = 9e9) {
    const fmts = [...(inf?.streaming_data?.adaptive_formats || []), ...(inf?.streaming_data?.formats || [])];
    if (!fmts.length) return [];
    const dur = inf?.basic_info?.duration || 0;   // seconds
    const auds = fmts.filter((f) => f.has_audio && !f.has_video);
    const audSize = Math.max(0, ...auds.map((f) => f.content_length || 0));
    if (mode === 'audio') {
        return [
            { label: 'M4A original', pick: 'm4a', size: audSize || (dur ? Math.round(dur * 16 * 1024) : null) },
            { label: 'MP3 320kbps', pick: '320k', size: dur ? Math.round(dur * 40 * 1024) : null },
            { label: 'MP3 128kbps', pick: '128k', size: dur ? Math.round(dur * 16 * 1024) : null },
        ];
    }
    const byH = new Map();
    for (const f of fmts) {
        if (!f.has_video || !f.height) continue;
        const cur = byH.get(f.height);
        if (!cur || (f.content_length || 0) > (cur.content_length || 0)) byH.set(f.height, f);
    }
    const out = [];
    for (const h of [2160, 1440, 1080, 720, 480, 360, 240, 144]) {
        const f = byH.get(h);
        if (!f) continue;
        const size = (f.content_length || 0) + (f.has_audio ? 0 : audSize);   // video-only → add audio track
        if (size && size > capMB * 1048576) continue;                          // cap → hidden (same as ytRows)
        out.push({ label: h + 'p', pick: String(h), size: size || null, h });
        if (out.length >= 6) break;
    }
    return out;
}

// ───────── download plumbing ─────────
function _pipeTo(webStream, dest, capBytes) {
    return new Promise((res, rej) => {
        const src = Readable.fromWeb(webStream);
        let n = 0;
        const w = fs.createWriteStream(dest);
        const bail = (e) => { try { src.destroy(); } catch { } try { fs.rmSync(dest, { force: true }); } catch { } rej(e); };
        src.on('data', (c) => {
            n += c.length;
            if (capBytes && n > capBytes) { bail(new Error('File is larger than max')); }
        });
        src.on('error', bail);
        w.on('error', bail);
        w.on('finish', () => res(dest));
        src.pipe(w);
    });
}

async function _merge(vp, ap) {
    const media = require('./media');
    let ff = null; try { ff = await media.getBin('ffmpeg'); } catch { return null; }
    const out = path.join(TMP(), `yti-${process.pid}-${Date.now().toString(36)}-m.mp4`);
    const r = await media._run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', vp, '-i', ap, '-c', 'copy', '-movflags', '+faststart', out], 300e3);
    if (r.code !== 0) { fs.rmSync(out, { force: true }); return null; }
    return out;
}

/** innertube download → { path, size, height?, title, ext }  (caller deletes the file)
 *  audio: best audio/mp4 (m4a, itag 140 class) · video: height ladder desc, progressive (≤360)
 *  when available, else video(mp4,avc)+audio(m4a) ffmpeg merge — WhatsApp-playable output. */
async function fetch(url, mode, height, capMB = 100) {
    const inf = await info(url);
    const title = String(inf.basic_info?.title || '').slice(0, 120);
    const cap = capMB * 1048576;
    const prefix = `yti-${process.pid}-${Date.now().toString(36)}`;
    if (mode === 'audio') {
        const p = path.join(TMP(), prefix + '.m4a');
        await _pipeTo(await inf.download({ type: 'audio' }), p, cap);
        return { path: p, size: fs.statSync(p).size, title, ext: 'm4a' };
    }
    const H = [...new Set(height ? [height, ...[1080, 720, 480, 360].filter((h) => h < height)] : [1080, 720, 480, 360])];
    let lastErr = null;
    for (const h of H) {
        const stem = path.join(TMP(), prefix + '-' + h);
        try {
            // progressive first (video+audio in one file — itag 18 class, ≤360p)
            let prog = null;
            try { prog = inf.chooseFormat({ type: 'video+audio', quality: h + 'p' }); } catch { }
            if (prog && prog.is_progressive) {
                if ((prog.content_length || 0) > cap) { lastErr = new Error('File is larger than max'); continue; }
                const p = await _pipeTo(await inf.download({ type: 'video+audio', quality: h + 'p' }), stem + '.mp4', cap);
                return { path: p, size: fs.statSync(p).size, height: prog.height || h, title, ext: 'mp4' };
            }
            // DASH: video(mp4,avc — WhatsApp codec) + audio(m4a) → ffmpeg copy-merge
            const vf = inf.chooseFormat({ type: 'video', quality: h + 'p', format: 'mp4', codec: 'avc' });
            if ((vf.content_length || 0) > cap) { lastErr = new Error('File is larger than max'); continue; }
            const vp = await _pipeTo(await inf.download({ type: 'video', quality: h + 'p', format: 'mp4', codec: 'avc' }), stem + '-v.mp4', cap);
            let ap = null, out = null;
            try {
                ap = await _pipeTo(await inf.download({ type: 'audio' }), stem + '-a.m4a', Math.min(cap, 40 * 1048576));
                out = await _merge(vp, ap);
            } finally { try { fs.rmSync(vp, { force: true }); } catch { } if (ap) { try { fs.rmSync(ap, { force: true }); } catch { } } }
            if (!out) throw new Error('yti ffmpeg merge fail');
            return { path: out, size: fs.statSync(out).size, height: vf.height || h, title, ext: 'mp4' };
        } catch (e) {
            lastErr = e;
            for (const f of fs.readdirSync(TMP())) if (f.startsWith(path.basename(stem))) { try { fs.rmSync(path.join(TMP(), f), { force: true }); } catch { } }
            if (/larger than max/i.test(String(e.message))) continue;   // next height down
        }
    }
    throw lastErr || new Error('yti download fail');
}

module.exports = { sess, info, rows, fetch, ID_RE, _patchEval };
