/**
 * pot.js — PO-token cache + yt-dlp extractor-args + PO-bound innertube session (v2.69)
 *
 * WHY: 2026 YouTube enforcement = per-IP/per-video "Sign in to confirm you're not a bot"
 * + gvs 403s. A BotGuard PO token bound to visitor_data (bgutils — the same machinery
 * Asitha-MD's youtubei.js path relies on) unlocks gated videos from datacenter IPs.
 * PoC (scripts/poc): minter 270ms, TTL 12h, WEB+PO session = playability OK.
 *
 * Exports: cachedArgs() [sync, [] when cold] · refresh() · getPO(force) · poSession()
 *          · status() [diag] · argsFor() [sync, cached-only]
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKER = process.env.POT_WORKER || path.join(__dirname, 'pot_worker.cjs');
const DISABLED = String(process.env.KZ_POT || '') === '0';   // kill-switch (tests / ops) — everything no-ops
const MAX_AGE_MS = 6 * 3600e3;   // hard re-mint even if TTL says longer (tokens rotate server-side)
let _tok = null;                 // { vd, po, ttl, at }
let _flight = null;              // single-flight mint promise
let _lastErr = '', _lastMs = 0, _mints = 0;

function fresh() { return !DISABLED && _tok && (Date.now() - _tok.at) < Math.min(_tok.ttl ? (_tok.ttl - 900) * 1000 : MAX_AGE_MS, MAX_AGE_MS); }

/** spawn the isolated worker → { vd, po, ttl } */
function mint(timeoutMs = 40e3) {
    if (DISABLED) return Promise.reject(new Error('pot disabled (KZ_POT=0)'));
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(WORKER)) return reject(new Error('pot_worker.cjs missing'));
        const p = spawn(process.execPath, [WORKER], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
        let out = '', err = '';
        const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { } reject(new Error('pot worker timeout')); }, timeoutMs);
        p.stdout.on('data', (d) => { out += d; if (out.length > 1e6) out = out.slice(-1e5); });
        p.stderr.on('data', (d) => { err = (err + d).slice(-400); });
        p.on('error', (e) => { clearTimeout(t); reject(e); });
        p.on('close', (code) => {
            clearTimeout(t);
            const line = out.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('{')).pop();
            if (code === 0 && line) {
                try {
                    const j = JSON.parse(line);
                    if (j.vd && j.po) return resolve(j);
                } catch { }
            }
            reject(new Error(String(err || 'worker exit ' + code).split('\n')[0].slice(0, 160)));
        });
    });
}

/** mint once (single-flight) + cache. force=true ignores cache. Resolves null on failure. */
async function refresh(force = false) {
    if (!force && fresh()) return _tok;
    if (_flight) return _flight;
    _flight = (async () => {
        try {
            const j = await mint();
            _tok = { vd: j.vd, po: j.po, ttl: j.ttl || 43200, at: Date.now() };
            _mints++; _lastMs = j.ms || 0; _lastErr = '';
            return _tok;
        } catch (e) {
            _lastErr = String(e.message || e).slice(0, 160);
            return null;
        } finally { _flight = null; }
    })();
    return _flight;
}

/** await a token (mints when cold) — null when the machinery is unavailable */
async function getPO(force = false) {
    if (!force && fresh()) return _tok;
    return refresh(force);
}

/** yt-dlp extractor-args from the WARM cache only (never blocks the ladder) */
function cachedArgs() {
    if (!fresh()) { refresh().catch(() => { }); return []; }   // cold → kick a bg mint for next time
    const { vd, po } = _tok;
    return ['--extractor-args', `youtube:visitor_data=${vd}`,
        '--extractor-args', `youtube:po_token=web.gvs+${po}`,
        '--extractor-args', `youtube:po_token=web.player+${po}`];
}
const argsFor = cachedArgs;

/** PO-bound WEB innertube session (30-min cache) — yti.js info() fallback */
let _sess = null, _sessAt = 0;
async function poSession() {
    if (_sess && Date.now() - _sessAt < 30 * 60e3) return _sess;
    const tok = await getPO();
    if (!tok) throw new Error('po token unavailable' + (_lastErr ? ': ' + _lastErr : ''));
    const { Innertube } = require('youtubei.js');
    try { if (_sess && _sess.__kzClose) _sess.__kzClose(); } catch { }
    _sess = await Innertube.create({ client_type: 'WEB', visitor_data: tok.vd, po_token: tok.po });
    _sessAt = Date.now();
    return _sess;
}

/** forced re-mint (YouTube enforcement errors → next attempt gets a fresh token) */
function kick() { return refresh(true).catch(() => null); }

function status() {
    return {
        warm: !!fresh(), has_token: !!_tok, mints: _mints, last_err: _lastErr || null,
        age_s: _tok ? Math.round((Date.now() - _tok.at) / 1000) : null, ttl_s: _tok ? _tok.ttl : null, last_ms: _lastMs || null,
        worker_exists: fs.existsSync(WORKER),
        deps: (() => { try { require.resolve('bgutils-js/botguard'); require.resolve('jsdom'); return true; } catch { return false; } })(),
    };
}

module.exports = { cachedArgs, argsFor, refresh, getPO, poSession, kick, status, fresh };
