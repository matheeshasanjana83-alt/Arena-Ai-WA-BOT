// animepahe_ci.mjs — runs ON a GitHub Actions runner (Azure datacenter IP).
// Answers: does the animepahe API respond to a plain datacenter-IP client?
import dns from 'node:dns/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const out = [];

try { out.push('runner-ip | ' + await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10000) })).text()); } catch (e) { out.push('runner-ip | ERR ' + e.message); }

for (const d of ['animepahe.si', 'animepahe.com', 'animepahe.pw']) {
  let ips = [];
  try { ips = await dns.resolve4(d); } catch (e) { ips = ['DNSERR:' + (e.code || e.message)]; }
  let res;
  const t0 = Date.now();
  try {
    const r = await fetch(`https://${d}/api?m=search&q=naruto`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    let parsed = '';
    try { const j = JSON.parse(body); parsed = 'JSON ok keys=' + Object.keys(j).join(',') + (j.data ? ' results=' + j.data.length : ''); } catch { parsed = 'non-json'; }
    res = `status=${r.status} ct=${(r.headers.get('content-type') || '').split(';')[0]} server=${r.headers.get('server') || ''} len=${body.length} ${parsed} head=${body.slice(0, 120).replace(/\s+/g, ' ')}`;
  } catch (e) { res = 'FETCH-ERR ' + String(e.cause?.code || e.message).slice(0, 90); }
  out.push(`${d} | dns=${ips.join(',')} | ${(Date.now() - t0)}ms | ${res}`);
}

try { const r = await fetch('https://kwik.cx/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); out.push(`kwik.cx | status=${r.status} server=${r.headers.get('server') || ''}`); }
catch (e) { out.push('kwik.cx | FETCH-ERR ' + String(e.cause?.code || e.message).slice(0, 90)); }

for (const u of ['https://consumet-api.vercel.app/anime/animepahe/naruto', 'https://consumet.vercel.app/anime/animepahe/naruto']) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    const b = await r.text();
    out.push(`${u.slice(0, 52)} | status=${r.status} ct=${(r.headers.get('content-type') || '').split(';')[0]} | ${b.slice(0, 160).replace(/\s+/g, ' ')}`);
  } catch (e) { out.push(`${u.slice(0, 52)} | FETCH-ERR ${String(e.message).slice(0, 90)}`); }
}

console.log(out.join('\n'));
