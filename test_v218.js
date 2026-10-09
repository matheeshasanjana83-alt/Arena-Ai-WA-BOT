'use strict';
/**
 * test_v218.js — .moviepro checks (v2.18.0)
 *  1. offline: card/list text build, session pick routing, exports
 *  2. online: Cinemeta search (free API) → real result → real card text
 *  3. bot.js full module graph loads (moviepro wired)
 * Run: node test_v218.js
 */
const assert = require('assert');

let pass = 0, fail = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ✅', name); }, (e) => { fail++; console.log('  ❌', name, '—', e.message); });

(async () => {
    console.log('v2.18.0 tests\n');
    const movies = require('./movies');

    // 1 ── text builders
    await ok('listText: numbered + pick hints', () => {
        const t = movies.listText('avatar', [{ name: 'Avatar', releaseInfo: '2009', imdbRating: '7.9' }, { name: 'Avatar: The Way of Water', releaseInfo: '2022' }]);
        assert.ok(t.includes('*1.* Avatar (2009)') && t.includes('⭐7.9'), 'list missing');
        assert.ok(t.includes('.moviepro 1'), 'pick hint missing');
    });
    await ok('cardText: poster card fields (IMDb, සිංහල උපසිරැසි, cinesubz, trailer hint) — v2.19 card', () => {
        const m = { name: 'Avatar', releaseInfo: '2009', imdbRating: '7.9', runtime: '162 min', genres: ['Action'], cast: ['Sam Worthington'], description: 'A paraplegic Marine...', imdb_id: 'tt0499549', poster: 'https://x/y.jpg', trailerStreams: [{ ytId: '5PSNL1qE6VY' }] };
        const t = movies.cardText(m, 1);
        for (const s of ['IMDb: https://www.imdb.com/title/tt0499549/', 'sinhalasub.lk', 'cinesubz.net', '.moviepro 1 trailer', '⭐ 7.9/10']) assert.ok(t.includes(s), 'missing: ' + s);
        // v2.19: trailer URL is now delivered via the .moviepro <n> trailer command, not a raw link
        assert.ok(!t.includes('youtu.be/5PSNL1qE6VY'), 'raw trailer URL should be replaced by command hint');
    });
    await ok('cardText: null-safe (no rating/trailer/cast)', () => {
        const t = movies.cardText({ name: 'X', description: null }, 3);
        assert.ok(t.includes('*X*') && t.includes('—/10') && !t.includes('undefined'), 'null-unsafe');
    });

    // 2 ── online: Cinemeta (free, no key)
    await ok('search("avatar way of water") → real Cinemeta results', async () => {
        const list = await movies.search('avatar way of water', 5);
        assert.ok(list.length >= 1, 'no results');
        const first = list[0];
        assert.ok(first.name && first.poster && first.imdb_id, 'meta incomplete: ' + JSON.stringify(first).slice(0, 120));
    });
    await ok('handle(): .moviepro <name> → session saved → pick via .moviepro 1', async () => {
        const sent = [];
        const send = async (jid, content) => { sent.push(content); return { key: { id: 'K' } }; };
        const ctx = { send, jid: 'test@s.whatsapp.net', msg: { key: { id: 'M' } }, rest: ['avatar', '2009'] };
        assert.strictEqual(await movies.handle('.moviepro', ctx), true, 'not handled');
        await new Promise(r => setTimeout(r, 4000));   // search completes → list edited
        assert.strictEqual(movies.hasSession(ctx.jid), true, 'session not saved');
        assert.ok(movies.hasSession('other@s.whatsapp.net') === false, 'session leaked to other chat');
        const ctx2 = { ...ctx, rest: ['1'] };
        await movies.handle('.moviepro', ctx2);
        await new Promise(r => setTimeout(r, 20000));   // v2.19: enrichMeta + cinesubz quality fetch before the card
        assert.ok(sent.some(s => (s.caption || s.text || '').includes('Avatar')), 'card not sent');
        assert.ok(sent.some(s => (s.caption || s.text || '').includes('CineSubz') || (s.caption || s.text || '').includes('Download page')), 'quality list / fallback link missing');
    });
    await ok('handle(): junk number → friendly error (no crash)', async () => {
        const sent = [];
        const send = async (jid, content) => { sent.push(content); return { key: { id: 'K' } }; };
        await movies.handle('.moviepro', { send, jid: 'test2@s.whatsapp.net', msg: {}, rest: ['99'] });
        assert.ok(sent.some(s => (s.text || '').includes('expire')), 'no expire hint');
    });
    await ok('handle(): unrelated command → false (not consumed)', async () => {
        assert.strictEqual(await movies.handle('.ping', { send: async () => ({}), jid: 'x@s', msg: {}, rest: [] }), false);
    });

    // 3 ── full module graph
    await ok('bot.js loads (moviepro wired, menu/HELP parse)', () => { require('./bot'); });
    await ok('features.ytCommand exported (trailer pipeline)', () => {
        const f = require('./features');
        assert.strictEqual(typeof f.ytCommand, 'function');
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
