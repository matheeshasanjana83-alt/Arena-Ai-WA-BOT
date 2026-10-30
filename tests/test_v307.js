/**
 * test_v307.js — 🎌 CONSUMET PROVIDER LADDER (v3.04.0)
 * User directive 2026-10-30: "Puppeteer is useless — server IP hard-blocked. Switch to the
 * Consumet API fallback method. Scrape api.consumet.org for animepahe instead of hitting
 * animepahe.pw directly."
 * LIVE PROBE truth (scripts/probe_consumet.js): api.consumet.org = HTTP 451 + GitHub-Parks HTML
 * (official instance DEAD — "Consumet API is no longer publicly available"); mirrors dead too.
 * Shipped honestly: provider ladder — consumet FIRST (base = ARENA_CONSUMET_BASE > settings.json
 * "consumetBase" (.setconsumet) > official), dead-verdict cached 10 min, direct ladder fallback,
 * dual-fail honest card names BOTH statuses + both fixes. kwik embeds → existing form-token
 * POST resolver. resolvers.js #apref fragment NOW REAL (v3.02 appended it, nothing stripped it).
 * ALL OFFLINE (fetcher seam + global.fetch POST mock).
 */
process.env.ARENA_CONSUMET_BASE = 'https://ctest.example';   // deterministic test base
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };

const pkg = JSON.parse(fs.readFileSync(REPO + '/package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync(REPO + '/manifest.json', 'utf8'));
const ap = require('../animepahe');
const { resolve } = require('../resolvers');
const botSrc = fs.readFileSync(REPO + '/bot.js', 'utf8');
const resSrc = fs.readFileSync(REPO + '/resolvers.js', 'utf8');
const apSrc = fs.readFileSync(REPO + '/animepahe.js', 'utf8');
const JID = '94724768017@s.whatsapp.net';

const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null, getSetCookie: () => [] }, text: async () => body });
const C_SEARCH = JSON.stringify({ results: [
    { id: 'sessA', title: 'Sousou no Frieren', image: 'https://ctest.example/p1.jpg', type: 'TV', year: 2023, episodes: 28 },
    { id: 'sessB', title: 'One Piece', image: 'https://ctest.example/p2.jpg', type: 'TV', year: 1999 },
    { id: null, title: 'broken row' },
], currentPage: 1, hasNextPage: true });
const C_INFO = JSON.stringify({ id: 'sessA', title: 'Sousou no Frieren', episodes: [
    { id: 'sessA/e10', number: 10 }, { id: 'sessA/e9', number: 9 }, { id: 'sessA/e1', number: 1 },
] });
const C_WATCH = JSON.stringify({ headers: { Referer: 'https://kwik.cx/' }, sources: [
    { url: 'https://kwik.cx/e/abc1080', quality: '1080p', isM3U8: false },
    { url: 'https://kwik.cx/e/hlsauto', quality: 'auto', isM3U8: true },
    { url: 'https://kwik.cx/e/abc720', quality: '720p' },
] });
const GITHUB_451 = '<!DOCTYPE html><html lang="en"><link rel="dns-prefetch" href="https://github.githubassets.com">Consumet API is no longer publicly available</html>';
const KWIK_PAGE = '<html><title>ep1 :: Kwik</title><form action="https://kwik.cx/api/token" method="POST"><input type="hidden" name="_token" value="KWIKTOK"></form></html>';
const D_SEARCH = JSON.stringify({ data: [{ session: 'YW5pbWU=', slug: 'frieren', title: 'Sousou no Frieren (direct)', poster: 'https://animepahe.pw/p1.jpg', type: 'TV', episodes: 28, year: 2023 }] });

const mkCtx = () => {
    const sent = [];
    const send = async (jid, content) => {
        if (content && content.delete) return { key: { id: 'del' + (sent.length + 1) } };
        const id = 'card' + (sent.length + 1);
        sent.push({ jid, content, id });
        return { key: { id, remoteJid: jid } };
    };
    const ctx = { sent, send, downloads: [], download: async (link, tag) => { ctx.downloads.push({ link, tag }); }, jid: JID, msg: { key: { id: 'm1' } }, react: async () => { } };
    return ctx;
};
const last = (c) => c.sent[c.sent.length - 1].content.text || '';

(async () => {
    console.log('— v3.04.0 pins —');
    ok('version 3.04.0 pkg+manifest · notes headline · manifest lists animepahe.js + test_v307.js', () => {
        assert.strictEqual(pkg.version, '3.04.0', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.04.0', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('CONSUMET PROVIDER LADDER'), 'notes headline');
        assert.ok(manifest.files.includes('animepahe.js') && manifest.files.includes('tests/test_v307.js'), 'manifest files');
    });
    ok('bot.js wiring: .setconsumet router · OWNER_CMDS · handleConsumet (probe→save→honest) · Network+setting menus', () => {
        assert.ok(botSrc.includes("if (c === '.setconsumet') { await handleConsumet(send, jid, msg, rest.join(' ').trim()); continue; }"), 'router');
        assert.ok(botSrc.includes("'.setproxy', '.setconsumet'"), 'OWNER_CMDS');
        assert.ok(botSrc.includes('async function handleConsumet(send, jid, msg, arg)'), 'handler');
        assert.ok(botSrc.includes('ap.probeConsumetBase(base)'), 'LIVE probe before save card');
        assert.ok(botSrc.includes('*.setconsumet <url|off>* — animepahe API mirror'), 'Network menu');
        assert.ok(botSrc.includes('🔧 *.net* · *.setproxy* · *.setconsumet*'), 'setting panel list');
        assert.ok(botSrc.includes('require(\'./animepahe\')'), 'animepahe require intact');
    });
    ok('animepahe.js ladder markers: consumetBase (env>settings>official) · C_STATE_TTL 10min · dual-fail card · noSolve cGet', () => {
        assert.ok(apSrc.includes('ARENA_CONSUMET_BASE'), 'env override');
        assert.ok(apSrc.includes("s.consumetBase"), 'settings.json key');
        assert.ok(apSrc.includes("const CONSUMET_DEFAULT = 'https://api.consumet.org';"), 'official default');
        assert.ok(apSrc.includes('C_STATE_TTL = 10 * 60e3'), 'dead cache TTL');
        assert.ok(apSrc.includes('Consumet API (${cb}) = ${cState.status'), 'dual-fail cPart');
        assert.ok(apSrc.includes('bot-traffic wall (Cloudflare 403 — server IP hard-blocked)'), 'dual-fail dPart');
        assert.ok(apSrc.includes("*.setconsumet <api-url>* (වැඩ කරන instance එකක්) / *.setproxy*"), 'fix hints');
        assert.ok(apSrc.includes('healthCheck') && apSrc.includes('consumet ${cb} boot probe'), 'dual boot probe');
    });

    console.log('— consumet parsers (consumet.ts contract, defensive) —');
    ok('parseConsumetSearch: results[] → rows · id-less skipped · cap 10 · image→poster', () => {
        const many = { results: Array.from({ length: 14 }, (_, i) => ({ id: 's' + i, title: 'T' + i })) };
        assert.strictEqual(ap.parseConsumetSearch(many).length, 10, 'cap 10');
        const rows = ap.parseConsumetSearch(JSON.parse(C_SEARCH));
        assert.strictEqual(rows.length, 2, 'broken row skipped');
        assert.deepStrictEqual([rows[0].session, rows[0].title, rows[0].poster, rows[0].year, rows[0].episodes], ['sessA', 'Sousou no Frieren', 'https://ctest.example/p1.jpg', '2023', 28]);
        assert.deepStrictEqual(ap.parseConsumetSearch([{ id: 'x', title: 'X' }]), [Object.assign({}, ap.parseConsumetSearch([{ id: 'x', title: 'X' }])[0])], 'bare array accepted');
        assert.strictEqual(ap.parseConsumetSearch({}).length, 0, 'no results key → 0');
    });
    ok('parseConsumetInfo: episodes[] → eps · number missing → seq · desc → ep1 first', () => {
        const eps = ap.parseConsumetInfo(JSON.parse(C_INFO));
        assert.deepStrictEqual(eps.map((e) => e.ep), [1, 9, 10], 'asc order');
        assert.deepStrictEqual(eps.map((e) => e.session), ['sessA/e1', 'sessA/e9', 'sessA/e10']);
        const seq = ap.parseConsumetInfo({ episodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
        assert.deepStrictEqual(seq.map((e) => e.ep), [1, 2, 3], 'seq fallback');
        assert.strictEqual(ap.parseConsumetInfo({}).length, 0, 'no episodes → 0');
    });
    ok('parseConsumetWatch: sources[] → rows · m3u8 excluded · res from quality · best-first · headers.Referer carried', () => {
        const rows = ap.parseConsumetWatch(JSON.parse(C_WATCH));
        assert.strictEqual(rows.length, 2, 'm3u8 dropped');
        assert.strictEqual(rows[0].res, 1080, 'best-first');
        assert.strictEqual(rows[0].url, 'https://kwik.cx/e/abc1080');
        assert.strictEqual(rows[0].referer, 'https://kwik.cx/', 'consumet headers.Referer → row referer');
        const dflt = ap.parseConsumetWatch({ sources: [{ url: 'https://kwik.cx/e/z' }] })[0];
        assert.strictEqual(dflt.referer, 'https://animepahe.ru/', 'default referer');
        assert.strictEqual(dflt.res, 0, 'no quality → res 0 (honest "file")');
    });

    console.log('— probeConsumetBase (fetcher seam) —');
    await okA('probe: JSON 200 → ok · 451 HTML → honest why · non-JSON 200 → honest · bad url → format', async () => {
        const real = ap.setFetcher(async (u) => (String(u).endsWith('/anime/animepahe/a') ? resp(C_SEARCH, 200) : resp('', 404)));
        try {
            assert.deepStrictEqual([await ap.probeConsumetBase('https://good.example/')].map((p) => [p.ok, p.status, p.shape]).flat(), [true, 200, 'json'], 'json ok');
            ap.setFetcher(async () => resp(GITHUB_451, 451));
            const dead = await ap.probeConsumetBase('https://api.consumet.org');
            assert.strictEqual(dead.ok, false); assert.strictEqual(dead.status, 451); assert.ok(/HTTP 451/.test(dead.why), '451 why: ' + dead.why);
            ap.setFetcher(async () => resp('<html>parked</html>', 200));
            const parked = await ap.probeConsumetBase('https://parked.example');
            assert.strictEqual(parked.ok, false); assert.ok(/non-JSON/.test(parked.why), 'parked why');
        } finally { ap.setFetcher(real); }
        const bad = await ap.probeConsumetBase('not a url');
        assert.strictEqual(bad.ok, false, 'bad url');
    });

    console.log('— FULL consumet flow e2e (search → eps → quality → FILE) —');
    await okA('ladder e2e: consumet primary → kwik embed POST → #apref download · poster image card', async () => {
        ap._sessions.delete(JID); ap._cTest({ reset: true });
        const seen = { referers: [] };
        const real = ap.setFetcher(async (u, o = {}) => {
            const url = String(u);
            if (url.includes('ctest.example/anime/animepahe/frieren')) return resp(C_SEARCH);
            if (url.includes('ctest.example/anime/animepahe/info')) return resp(C_INFO);
            if (url.includes('ctest.example/anime/animepahe/watch/')) return resp(C_WATCH);
            if (url.includes('kwik.cx')) { seen.referers.push((o.headers && o.headers.Referer) || ''); return resp(KWIK_PAGE); }
            return resp('', 404);
        });
        const realFetch = global.fetch;
        global.fetch = async () => ({ status: 302, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? 'https://eu-11.files.nextcdn.org/frieren-01.mkv' : null) }, text: async () => '' });
        try {
            const c1 = mkCtx();
            await ap.handle('.animepahe', { ...c1, rest: ['frieren'] });
            assert.ok(last(c1).includes('Sousou no Frieren') && last(c1).includes('One Piece'), 'search card rows');
            assert.strictEqual(ap._sessions.get(JID).src, 'consumet', 'src=consumet');
            assert.strictEqual(ap._cTest().ok, true, 'cState ok');
            const c2 = mkCtx();
            await ap.handle('.animepahe', { ...c2, rest: ['go', '1'] });
            assert.ok(last(c2).includes('Episodes 3') && last(c2).includes('EP 1'), 'eps card (info numbers, ep1 first)');
            const c3 = mkCtx();
            await ap.handle('.animepahe', { ...c3, rest: ['go', '1'] });
            const qcard = c3.sent.find((s) => s.content.image) ? c3.sent.find((s) => s.content.image).content.caption : last(c3);
            assert.ok(qcard.includes('1080p') && !qcard.includes('auto'), 'quality card best-first, m3u8 gone');
            assert.strictEqual(ap._sessions.get(JID).stage, 'quality', 'stage quality');
            const c4 = mkCtx();
            const st4 = c4.sent.length;
            await ap.handle('.animepahe', { ...c4, rest: ['1'] });
            assert.strictEqual(c4.downloads.length, 1, 'download fired');
            assert.ok(c4.downloads[0].link.startsWith('https://eu-11.files.nextcdn.org/frieren-01.mkv#apref='), 'direct url + apref');
            assert.strictEqual(decodeURIComponent(c4.downloads[0].link.split('#apref=')[1]), 'https://kwik.cx/', 'apref = consumet headers.Referer');
            assert.ok(seen.referers.some((r) => r === 'https://kwik.cx/'), 'kwik embed GET carried Referer');
            assert.ok(c4.downloads[0].tag.includes('AnimePahe'), 'tag branded');
            assert.ok(!ap._sessions.get(JID) || ap._sessions.get(JID).stage !== 'quality', 'session cleaned');
        } finally { global.fetch = realFetch; ap.setFetcher(real); }
    });

    console.log('— fallback ladder (official instance DEAD 451) —');
    await okA('451 → direct fallback works · dead verdict cached (2nd search skips consumet)', async () => {
        ap._sessions.delete(JID); ap._cTest({ reset: true });
        let consumetCalls = 0;
        const real = ap.setFetcher(async (u) => {
            const url = String(u);
            if (url.includes('ctest.example/anime/animepahe/')) { consumetCalls++; return resp(GITHUB_451, 451); }
            if (url.includes('/api?') && url.includes('m=search')) return resp(D_SEARCH);
            return resp('', 404);
        });
        try {
            const c1 = mkCtx();
            await ap.handle('.animepahe', { ...c1, rest: ['frieren'] });
            assert.ok(last(c1).includes('Sousou no Frieren (direct)'), 'direct fallback card');
            assert.strictEqual(ap._sessions.get(JID).src, 'direct', 'src=direct');
            assert.strictEqual(ap._cTest().ok, false, 'cState dead');
            assert.strictEqual(ap._cTest().status, 451, 'status 451 recorded');
            const c2 = mkCtx();
            await ap.handle('.animepahe', { ...c2, rest: ['naruto'] });
            assert.strictEqual(consumetCalls, 1, '2nd search SKIPPED consumet (TTL cache)');
        } finally { ap.setFetcher(real); }
    });
    await okA('dual-fail honest card: consumet 451 + direct CF wall → BOTH statuses + both fixes named', async () => {
        ap._sessions.delete(JID); ap._cTest({ reset: true });
        const real = ap.setFetcher(async (u) => {
            const url = String(u);
            if (url.includes('ctest.example/anime/animepahe/')) return resp(GITHUB_451, 451);
            return resp('<html>Attention Required | Cloudflare</html>', 403);
        });
        try {
            const c1 = mkCtx();
            await ap.handle('.animepahe', { ...c1, rest: ['frieren'] });
            const t = last(c1);
            assert.ok(t.includes('451'), 'consumet status: ' + t.slice(0, 100));
            assert.ok(t.includes('bot-traffic wall'), 'direct wall');
            assert.ok(t.includes('setconsumet') && t.includes('setproxy'), 'both fixes named');
        } finally { ap.setFetcher(real); }
    });

    console.log('— resolvers #apref (v3.04: NOW REAL) —');
    await okA('#apref fragment → { kind:http, url no-hash, referer=page } · plain URL unchanged', async () => {
        const link = 'https://eu-11.files.nextcdn.org/frieren-01.mkv?x=1#apref=' + encodeURIComponent('https://kwik.cx/e/abc1080');
        const r = await resolve(link);
        assert.strictEqual(r.kind, 'http', 'kind');
        assert.strictEqual(r.url, 'https://eu-11.files.nextcdn.org/frieren-01.mkv?x=1', 'fragment stripped');
        assert.strictEqual(r.referer, 'https://kwik.cx/e/abc1080', 'referer = apref page');
        const plain = await resolve('https://example.com/file.mkv');
        assert.strictEqual(plain.referer, undefined, 'plain direct unchanged');
        assert.ok(resSrc.includes('#apref='), 'marker');
    });

    console.log('— regression guards —');
    ok('bridge reply-only + direct parsers intact (v3.02 exports unchanged) · _cTest reset', () => {
        assert.strictEqual(ap.bridge(JID, 'x', '1'), null, 'no session');
        ap._sessions.set(JID, { cmd: '.aphe', stage: 'search', at: Date.now(), cardId: 'cardZ', items: [{}] });
        assert.strictEqual(ap.bridge(JID, 'other', '1'), null, 'wrong cardId blocked');
        assert.strictEqual(ap.bridge(JID, 'cardZ', '1'), '.aphe go 1');
        ap._sessions.delete(JID);
        assert.strictEqual(ap.parseSearchRows({ data: [{ session: 's', title: 'T' }] })[0].session, 's', 'direct parser intact');
        const st = ap._cTest({ ok: false, status: 451, at: Date.now() });
        assert.strictEqual(st.status, 451, 'setter');
        ap._cTest({ reset: true });
        assert.strictEqual(ap._cTest().ok, null, 'reset');
    });
    ok('USAGE names both providers · typo aliases intact · HEAVY intact', () => {
        assert.ok(apSrc.includes('*.setconsumet*'), 'usage consumet');
        assert.ok(apSrc.includes("'.animepahae': 1, '.anemepahe': 1"), 'typo aliases');
        assert.ok(botSrc.includes("'.animepahe', '.aphe'"), 'HEAVY');
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
