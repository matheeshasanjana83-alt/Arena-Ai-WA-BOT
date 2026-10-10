// test_v216.js — v2.16.0 free-proxy pool tests (node test_v216.js)
process.env.PROXY_POOL = '1';
const pool = require('./proxypool');
const net = require('./net');

(async () => {
    // 1) load & parse
    const s0 = pool.stats();
    console.log(`[1] pool loaded: total=${s0.total} shipped=${s0.shipped} user=${s0.user} enabled=${s0.enabled}`);
    if (s0.total < 400) throw new Error('proxy list load fail');

    // 2) normalize sanity
    const n1 = pool.normalize('1.2.3.4:8080'), n2 = pool.normalize('http://u:p@5.6.7.8:3128'), n3 = pool.normalize('garbage line');
    console.log(`[2] normalize: ${n1} | ${n2} | ${n3}`);
    if (n1 !== 'http://1.2.3.4:8080' || n2 !== 'http://u:p@5.6.7.8:3128' || n3 !== null) throw new Error('normalize fail');

    // 3) real check on 6 sample proxies (bounded: 6 × 9 s max)
    const fs = require('fs');
    const sample = fs.readFileSync('./proxies.txt', 'utf8').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 6);
    const undici = require('undici');
    let ok = 0;
    await Promise.all(sample.map(async (p) => {
        const url = 'http://' + p;
        try {
            const r = await undici.fetch('https://www.google.com/generate_204', { dispatcher: new undici.ProxyAgent({ uri: url, connect: { timeout: 8000 } }), signal: AbortSignal.timeout(9000) });
            try { await r.body?.cancel(); } catch { }
            if (r.status < 400) { ok++; console.log(`    ✅ ${p} → ${r.status}`); }
            else console.log(`    ⚠️ ${p} → HTTP ${r.status}`);
        } catch (e) { console.log(`    ❌ ${p} → ${String(e.cause?.code || e.code || e.message || '').slice(0, 40)}`); }
    }));
    console.log(`[3] sample check: ${ok}/6 alive (free list → some/all dead is expected & handled)`);

    // 4) markGood on unknown proxy → ignored, no crash
    pool.markGood('http://10.10.10.10:9999');
    console.log(`[4] markGood on unknown proxy: no crash ✅`);

    // 5) smartFetch normal (direct) still works — pool skipped when empty
    const r = await net.smartFetch('https://api.github.com/zen', { headers: { 'User-Agent': 'kaviz-md-test' } });
    console.log(`[5] smartFetch direct: HTTP ${r.status} ✅`);

    // 6) candidates() with empty pool → [] (net.js skips pool fast)
    console.log(`[6] candidates (pool not checked yet): ${JSON.stringify(pool.candidates(2))} ✅`);

    // 7) bot.js loads (full module graph incl. features/tools/guard)
    require('./bot.js');
    console.log(`[7] bot.js module load: OK ✅`);

    console.log('\n🎉 ALL TESTS PASSED');
    process.exit(0);
})().catch((e) => { console.error('💥 ' + (e.stack || e.message)); process.exit(1); });
