/**
 * test_v291.js — 🔞 .hentaiv STILL-BROKEN REPORT (2026-10-24 screenshots + panel console)
 * Forensics: console logged kazoku → go 4 → go 1 → go 2 (v2.90 bridge WORKED, no handler errors),
 * but the user's chat carried foreign-text cards that exist in NO commit (git -S): a SECOND bot
 * (another agent's fork, own linked device) replies into the same chat. Plus a REAL race of ours:
 * go 1 + go 2 within 4s → both ran stage='ep' → second sessions.set orphaned the EP1 quality card.
 * Fixes tested here: (1) hvGo double-pick busy guard (+60s expiry + fail-path clear + restoreBack
 * clear) (2) bot.js foreign-bot-card hint (3) 💬 every-message console trace. ALL OFFLINE.
 */
process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const okA = async (n, fn) => { try { await fn(); pass++; console.log('  ✅ ' + n); } catch (e) { fail++; console.log('  ❌ ' + n + ' — ' + e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hub = require('../animehub');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const botSrc = fs.readFileSync('./bot.js', 'utf8');
const hubSrc = fs.readFileSync('./animehub.js', 'utf8');

const sendM = async (j, c) => { msgs.push(c); return { key: { id: 'K' + Math.random() } }; };
let msgs = [];
const fresh = () => { msgs = []; };

(async () => {
    console.log('— v2.96.0 pins —');
    ok('version 2.91 pkg+manifest + notes + source markers', () => {
        assert.strictEqual(pkg.version, '3.03.3', 'pkg ' + pkg.version);
        assert.strictEqual(manifest.version, '3.03.3', 'manifest ' + manifest.version);
        assert.ok(manifest.notes.includes('SECOND BOT'), 'notes headline');
        assert.ok(hubSrc.includes('v2.91: double-pick race'), 'hvGo busy guard marker');
        assert.ok(hubSrc.includes("back.busy = false"), 'restoreBack clears busy');
        assert.ok(hubSrc.includes('s.busy = false; return fail('), 'fail-path busy clear');
        assert.ok(botSrc.includes('💬 ${fromMe'), 'console trace marker');
        assert.ok(botSrc.includes('වෙන linked device එකක්'), 'foreign-bot-card hint text');
        assert.ok(botSrc.includes('contextInfo?.participant'), 'hint checks quoted-card sender');
    });

    console.log('— double-pick race (go 1 + go 2 within 4s, the real user flow) —');
    await okA('busy session → second pick gets honest ⏳ card, NO fetch, session untouched', async () => {
        const JID = 'race291@s.whatsapp.net';
        hub._reset();
        const ep = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'http://127.0.0.1:1/e1' }, { label: 'EP 2', url: 'http://127.0.0.1:1/e2' }], title: 'Kazoku', at: Date.now(), cardId: 'CARD-EP', busy: true, busyAt: Date.now() };
        hub._sessions.set(JID, ep);
        fresh();
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async () => { } });
        assert.strictEqual(msgs.length, 1, 'exactly one reply: ' + JSON.stringify(msgs).slice(0, 120));
        assert.ok(msgs[0].text.includes('කලින් pick එක තාම process වෙනවා'), 'busy card text');
        assert.ok(!msgs[0].text.includes('බලනවා'), 'no status bubble (guard is BEFORE status)');
        assert.strictEqual(hub._sessions.get(JID), ep, 'session object unchanged');
        assert.strictEqual(hub._sessions.get(JID).stage, 'ep', 'still stage ep (no quality overwrite)');
        assert.strictEqual(hub.bridge(JID, 'CARD-EP', '2'), '.hentaiv go 2', 'bridge still routes (guard lives in hvGo)');
    });

    await okA('60s busy expiry → pick proceeds (status bubble) → dead URL → fail card + busy CLEARED', async () => {
        const JID = 'race291b@s.whatsapp.net';
        hub._reset();
        const ep = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'http://127.0.0.1:1/e1' }], title: 'T', at: Date.now(), cardId: 'CARD-E1', busy: true, busyAt: Date.now() - 61000 };
        hub._sessions.set(JID, ep);
        fresh();
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        const texts = msgs.map((m) => m.text || '');
        assert.ok(texts.some((t) => t.includes('බලනවා')), 'status bubble sent (guard expired)');
        assert.ok(texts.some((t) => t.includes('❌')), 'fail card for dead URL');
        assert.strictEqual(ep.busy, false, 'fail path cleared busy (retry possible)');
        // immediate retry → no busy card, straight to status again
        fresh();
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.ok(msgs.map((m) => m.text || '').some((t) => t.includes('බලනවා')), 'retry runs (no stuck busy)');
    });

    await okA('binge restore: quality pick after busy pick → restored EPISODES session has busy=false → next EP pick works', async () => {
        const JID = 'race291c@s.whatsapp.net';
        hub._reset();
        const ep = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'u1' }, { label: 'EP 2', url: 'u2' }], title: 'T', at: Date.now(), cardId: 'CARD-EPX', busy: false };
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: 'default', src: 'http://c/v.mp4' }], title: 'T', at: Date.now(), cardId: 'CARD-QX', prev: ep });
        const dled = [];
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async (s) => { dled.push(s); await sleep(5); } });
        assert.strictEqual(hub._sessions.get(JID), ep, 'ep session restored');
        assert.strictEqual(ep.busy, false, 'restoreBack cleared busy');
        assert.strictEqual(dled.length, 1, 'download fired');
        // simulate the race victim: a busy ep session restored → next pick must NOT hit the busy card
        ep.busy = true; ep.busyAt = Date.now();
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: 'd', src: 'http://c/w.mp4' }], title: 'T', at: Date.now(), cardId: 'CARD-QY', prev: ep });
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { } });
        assert.strictEqual(hub._sessions.get(JID), ep, 'restored again');
        assert.strictEqual(ep.busy, false, 'busy cleared on restore #2');
        fresh();
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '2'], react: async () => { }, download: async () => { } });
        assert.ok(!msgs.map((m) => m.text || '').some((t) => t.includes('කලින් pick')), 'next EP pick NOT busy-blocked after restore');
    });

    console.log('— foreign-bot-card numeric hint (second linked device) —');
    ok('bot.js bridge chain: v2.89 stale-card branch → v2.91 foreign-bot branch (else, after)', () => {
        const i89 = botSrc.indexOf("sentIds.has(String(qid))");            // v2.89 branch condition
        const i91 = botSrc.indexOf("වෙන linked device එකක්");
        assert.ok(i89 > -1 && i91 > i89, 'v2.91 branch sits after the v2.89 branch');
        assert.ok(botSrc.includes('botCard && !sentIds.has(String(qid))'), 'fires only for bot cards NOT ours');
        assert.ok(/else \{\s+\/\/ 🔢 v2\.91/.test(botSrc), 'final-else shape');
    });

    console.log('— v2.90 semantics preserved —');
    await okA('v290 binge core still green on the changed file (EP1→EP2 bridge loop)', async () => {
        const JID = 'reg291@s.whatsapp.net';
        hub._reset();
        const ep = { cmd: 'hv', stage: 'ep', items: [{ label: 'EP 1', url: 'u1' }, { label: 'EP 2', url: 'u2' }], title: 'K', at: Date.now(), cardId: 'CARD-EP9' };
        hub._sessions.set(JID, { cmd: 'hv', stage: 'quality', items: [{ label: 'default', src: 'http://c/z.mp4' }], title: 'K EP1', at: Date.now(), cardId: 'CARD-Q9', prev: ep });
        await hub.handle('.hentaiv', { send: sendM, jid: JID, msg: {}, rest: ['go', '1'], react: async () => { }, download: async () => { await sleep(5); } });
        assert.strictEqual(hub._sessions.get(JID), ep, 'restore OK');
        assert.strictEqual(hub.bridge(JID, 'CARD-EP9', '2'), '.hentaiv go 2', 'EP2 reachable');
    });

    console.log(`\nv2.91 double-pick + second-bot visibility: ${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
