/**
 * apk.js — APK search & download for KAVIZ MD V1 (v2.68)
 * Ported from Sachi-MD v1.1.0 (services/downloader/apk.js) — adapted to the KAVIZ stack:
 *   • net.js smartFetch (proxy / DoH / pool-aware) instead of axios
 *   • media.fetchToFile — file-based download (no 500 MB RAM buffers) + maxBytes cap
 *   • APKPure d.apkpure.com 302 resolve via curl — its TLS-fingerprint WAF 403s Node's
 *     HTTP stack but allows curl; the signed data.winudf.com URL it hands out accepts
 *     ANY client, so only the tiny redirect lookup needs curl (download stays in Node).
 *
 * Sources (all verified working from a plain datacenter IP — Sachi-MD ground truth):
 *   • resolver  — Google Play web search (no anti-bot): package ids in popularity order
 *   • downloader— APKPure package endpoint (d.apkpure.com) 302-redirects to a signed CDN
 *                 URL; its Location header also carries app name / version / full size
 *   • fallback  — Aptoide ws75 public API (full metadata + direct APK URLs)
 *   • fallback  — F-Droid web search + official package API (FOSS apps)
 *   • direct    — any URL the user supplies
 * Every download is validated: an APK is a ZIP → first bytes MUST be PK\x03\x04 —
 * HTML error pages / WAF challenge pages never pass through.
 */
const { execFile } = require('child_process');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
const URL_RE = /^https?:\/\/\S+$/i;

function resolveInput(text) {
    const t = String(text || '').trim();
    if (!t) return { type: 'empty' };
    if (URL_RE.test(t)) return { type: 'url', value: t };
    if (PACKAGE_RE.test(t) && t.includes('.')) return { type: 'package', value: t.toLowerCase() };
    return { type: 'query', value: t };
}

async function fetchText(url, { timeout = 25000, headers } = {}) {
    const { smartFetch } = require('./net');
    const r = await smartFetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en', Accept: 'text/html,application/json,text/plain,*/*', ...(headers || {}) },
        redirect: 'follow', signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error(`HTTP ${r.status}`); }
    return await r.text();
}

/** Parse the metadata APKPure embeds in its signed Location header (pure — tests) */
function metaFromLocation(location) {
    try {
        const u = new URL(location);
        const filename = u.searchParams.get('filename') || '';
        const fullSize = Number(u.searchParams.get('full_size')) || 0;
        const cleaned = decodeURIComponent(filename).replace(/_APKPure\.(apk|xapk)$/i, '').replace(/-APKPure\.(apk|xapk)$/i, '');
        const cut = cleaned.lastIndexOf('_');
        if (cut > 0) return { name: cleaned.slice(0, cut), version: cleaned.slice(cut + 1), sizeBytes: fullSize };
        if (cleaned) return { name: cleaned, version: '', sizeBytes: fullSize };
    } catch { /* fall through */ }
    return null;
}

/** d.apkpure.com sits behind a TLS-fingerprint WAF that 403s Node but allows curl → shell out for the 302 */
function curlResolve(url, timeoutMs = 25000) {
    return new Promise((resolve) => {
        execFile('curl', ['-sS', '-o', '/dev/null', '--max-time', String(Math.ceil(timeoutMs / 1000)),
            '-A', UA, '-w', '%{http_code}\t%{redirect_url}', url],
        { timeout: timeoutMs }, (err, stdout) => {
            const out = String(stdout || '');
            const [code, loc] = out.trim().split('\t');
            if (err && !out) return resolve(null);
            resolve(code === '302' || code === '301' ? loc || null : null);
        });
    });
}

async function resolveApkPure(pkg) {
    const target = `https://d.apkpure.com/b/APK/${encodeURIComponent(pkg)}?version=latest`;
    const loc = await curlResolve(target);
    if (loc) return loc;
    try {   // WAF absent / curl missing → plain no-redirect fetch fallback
        const { smartFetch } = require('./net');
        const r = await smartFetch(target, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        const loc2 = r.headers?.get?.('location') || null;
        try { await r.body?.cancel(); } catch { }
        return (r.status === 301 || r.status === 302) ? loc2 : null;
    } catch { return null; }
}

/** Redirect-only metadata probe for one package (no media downloaded) */
async function fetchMeta(pkg) {
    const loc = await resolveApkPure(pkg);
    return loc ? metaFromLocation(loc) : null;
}

/** Enrich list items with real names/versions/sizes in parallel */
async function enrich(items) {
    await Promise.all(items.map(async (item) => {
        if (item.source !== 'apkpure') return;
        try { const meta = await fetchMeta(item.package); if (meta) Object.assign(item, meta); } catch { }
    }));
    return items;
}

/** Google Play web search → package ids in popularity order */
async function searchPlay(query, { limit = 6 } = {}) {
    const html = await fetchText(`https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en`);
    const seen = new Set(), out = [];
    const re = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
        const pkg = m[1].toLowerCase();
        if (!seen.has(pkg)) { seen.add(pkg); out.push({ source: 'apkpure', package: pkg }); }
    }
    return enrich(out);
}

/** Aptoide ws75 public API search — full metadata + direct APK URL per result */
async function searchAptoide(query, { limit = 6 } = {}) {
    const raw = await fetchText(`https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(query)}&limit=${Math.max(limit * 2, 10)}`, { timeout: 20000 });
    const list = JSON.parse(raw)?.datalist?.list || [];
    const out = [];
    for (const a of list) {
        if (!a?.package || !a?.file?.path) continue;
        out.push({ source: 'aptoide', package: String(a.package), name: a.name || '', version: a.file.vername || '', sizeBytes: Number(a.file.filesize) || 0, url: a.file.path });
        if (out.length >= limit) break;
    }
    return out;
}

/** F-Droid search → package ids + display names (FOSS fallback) */
async function searchFdroid(query, { limit = 6 } = {}) {
    const html = await fetchText(`https://search.f-droid.org/?q=${encodeURIComponent(query)}&lang=en`);
    const seen = new Set(), out = [];
    const re = /f-droid\.org\/en\/packages\/([a-zA-Z0-9._]+)"[\s\S]{0,400}?<h4 class="package-name">\s*([^<]+?)\s*<\/h4>/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
        const pkg = m[1].toLowerCase();
        if (!seen.has(pkg)) { seen.add(pkg); out.push({ source: 'fdroid', package: pkg, name: m[2].trim() }); }
    }
    if (!out.length) {
        const bare = /f-droid\.org\/en\/packages\/([a-zA-Z0-9._]+)/g;
        let b;
        while ((b = bare.exec(html)) && out.length < limit) {
            const pkg = b[1].toLowerCase();
            if (!seen.has(pkg)) { seen.add(pkg); out.push({ source: 'fdroid', package: pkg }); }
        }
    }
    return out;
}

/** Best Aptoide build for one package: direct lookup first, exact-match search second */
async function aptoideForPackage(pkg) {
    const api = 'https://ws75.aptoide.com/api/7';
    try {
        const raw = await fetchText(`${api}/app/get/package_name=${encodeURIComponent(pkg)}`, { timeout: 15000 });
        const d = JSON.parse(raw)?.nodes?.meta?.data, f = d?.file;
        if (f?.path) return { url: f.path, name: d.name || '', version: f.vername || '', sizeBytes: Number(f.filesize) || 0 };
    } catch { /* fall through to search */ }
    try {
        const raw2 = await fetchText(`${api}/apps/search?query=${encodeURIComponent(pkg)}&limit=10`, { timeout: 20000 });
        const list = JSON.parse(raw2)?.datalist?.list || [];
        const hit = list.find((a) => String(a?.package || '').toLowerCase() === String(pkg).toLowerCase());
        if (hit?.file?.path) return { url: hit.file.path, name: hit.name || '', version: hit.file.vername || '', sizeBytes: Number(hit.file.filesize) || 0 };
    } catch { }
    return null;
}

/** Search with fallback: Play + Aptoide merged, F-Droid when both yield nothing */
async function search(query, { limit = 6 } = {}) {
    const [play, apt] = await Promise.allSettled([searchPlay(query, { limit }), searchAptoide(query, { limit: 3 })]);
    let items = play.status === 'fulfilled' ? play.value : [];
    if (apt.status === 'fulfilled' && apt.value.length) {
        const have = new Set(items.map((i) => i.package));
        for (const a of apt.value) if (!have.has(a.package) && items.length < limit) items.push(a);
    }
    if (!items.length) { try { items = await searchFdroid(query, { limit }); } catch { } }
    return items;
}

/** APK = ZIP → PK\x03\x04 magic on the downloaded FILE (error/HTML pages never pass) */
function assertApkMagic(p) {
    const fd = fs.openSync(p, 'r');
    try {
        const b = Buffer.alloc(4);
        fs.readSync(fd, b, 0, 4, 0);
        if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('මේක valid APK file එකක් නෙවෙයි (bad file signature — source එකෙන් error page එකක් ආවා වගේ)');
    } finally { fs.closeSync(fd); }
}

/** Shared tail: download a resolved URL → verify → shape. Fetches to FILE (RAM-safe for 300MB+ APKs) */
async function fetchAndShape(spec, { maxMB, onStatus }) {
    const media = require('./media');
    const p = await media.fetchToFile(spec.url, 'apk', { maxBytes: maxMB * 1048576, ext: spec.isBundle ? 'xapk' : 'apk' });
    try {
        assertApkMagic(p);
        let name = spec.name || '';
        if (!name && spec.directUrl) {
            try { name = decodeURIComponent(new URL(spec.url).pathname.split('/').pop() || ''); } catch { }
            if (name.toLowerCase().endsWith('.apk')) name = name.slice(0, -4);
        }
        if (!name) name = spec.package || 'app';
        const size = fs.statSync(p).size;
        const base = `${String(name).slice(0, 80)}${spec.version ? `-${spec.version}` : ''}`.replace(/[^a-zA-Z0-9._ ()-]+/g, '_').trim() || 'app';
        return {
            path: p, size, name, version: spec.version || '', source: spec.source, package: spec.package || null,
            fileName: /\.(apk|xapk)$/i.test(base) ? base : `${base}${spec.isBundle ? '.xapk' : '.apk'}`,
            isBundle: !!spec.isBundle,
        };
    } catch (e) { fs.rmSync(p, { force: true }); throw e; }
}

/** One download attempt against a single source. Throws on failure. */
async function downloadVia(kind, item, opts) {
    const pkg = item.package;
    if (kind === 'url') return fetchAndShape({ url: item.url, source: 'direct', package: pkg, name: item.name, version: item.version, directUrl: !item.name }, opts);
    if (kind === 'fdroid') {
        const { smartFetch } = require('./net');
        const r = await smartFetch(`https://f-droid.org/api/v1/packages/${encodeURIComponent(pkg)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        const api = r.ok ? await r.json().catch(() => null) : null;
        const code = api?.suggestedVersionCode;
        if (!code) throw new Error('F-Droid එකේ downloadable build එකක් නෑ');
        return fetchAndShape({ url: `https://f-droid.org/repo/${pkg}_${code}.apk`, source: 'fdroid', package: pkg, name: item.name, version: item.version }, opts);
    }
    if (kind === 'aptoide') {
        const alt = await aptoideForPackage(pkg);
        if (!alt?.url) throw new Error(`Aptoide එකේ ${pkg} build එකක් නෑ`);
        return fetchAndShape({ url: alt.url, source: 'aptoide', package: pkg, name: item.name || alt.name, version: item.version || alt.version }, opts);
    }
    // apkpure: resolve the signed CDN URL via curl (WAF-safe)
    const loc = await resolveApkPure(pkg);
    if (!loc) throw new Error('APK source එක දැන් reach කරන්න බෑ (block / down)');
    const meta = metaFromLocation(loc);
    const spec = { url: loc, source: 'apkpure', package: pkg, name: item.name || meta?.name, version: item.version || meta?.version };
    if (/\.xapk(?:&|$)/i.test(loc)) {
        // APKPure only ships a split/XAPK bundle here — Aptoide often has a plain,
        // directly-installable APK of the same app → prefer that
        try {
            const alt = await aptoideForPackage(pkg);
            if (alt?.url) return fetchAndShape({ url: alt.url, source: 'aptoide', package: pkg, name: item.name || alt.name, version: item.version || alt.version }, opts);
        } catch { /* keep the bundle path */ }
        spec.isBundle = true;
    }
    return fetchAndShape(spec, opts);
}

/** Download an APK for a list item / package / direct URL, with source fallback */
async function downloadApk(item, { maxMB = 500, onStatus } = {}) {
    const wants = typeof item === 'string' ? { package: item } : { ...(item || {}) };
    if (!wants.url && !wants.package) throw new Error('App නමක් / package එකක් / URL එකක් දෙන්න');
    onStatus?.(`🔎 source හොයනවා — ${wants.url ? 'direct' : wants.source || 'apkpure'}`);
    let attempts;
    if (wants.url) attempts = wants.package ? ['url', 'aptoide'] : ['url'];
    else if (wants.source === 'fdroid') attempts = ['fdroid', 'aptoide'];
    else if (wants.source === 'aptoide') attempts = ['aptoide', 'apkpure'];
    else attempts = ['apkpure', 'aptoide'];
    let lastErr;
    for (const kind of attempts) {
        try { return await downloadVia(kind, wants, { maxMB, onStatus }); }
        catch (e) {
            if (/limit එකට වඩා|size limit/i.test(e.message || '')) throw e;   // cap is not retryable
            lastErr = e;
        }
    }
    throw lastErr;
}

module.exports = { resolveInput, search, searchPlay, searchAptoide, searchFdroid, aptoideForPackage, fetchMeta, resolveApkPure, metaFromLocation, downloadApk, assertApkMagic, curlResolve, PACKAGE_RE };
