/* test_v246.js — MovieBox direct-MP4 rescue (resource-position/v2) — offline asserts + RUN_LIVE E2E */
const fs = require('fs');
const path = require('path');
const REPO = '/home/z/my-project/Arena-Ai-WA-BOT';
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };
const rd = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const mv = rd('moviedex.js');
const bot = rd('bot.js');
const guard = rd('guard.js');
const pkg = JSON.parse(rd('package.json'));
const man = JSON.parse(rd('manifest.json'));

console.log('── v2.46.0 core ──');
const vN = (v)=>parseInt(String(v).split('.').join(''),10); ok(vN(pkg.version) >= 2460, 'package.json >= 2.46.0');
ok(vN(man.version) >= 2460, 'manifest >= 2.46.0');
ok(man.files.includes('test_v246.js') && man.files.includes('moviedex.js'), 'manifest files (test_v246 + moviedex)');
ok(vN(man.version) > 2460 || /resource-position\/v2/.test(man.notes), 'manifest notes: resource-position (v2.46 or notes rotated)');

console.log('── identity + signing ──');
ok(mv.includes("Buffer.from('76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O', 'base64')"), 'base64 gateway HMAC key');
ok(!mv.includes('efa891974eecd3148'), 'old hex key removed');
ok(mv.includes('50020126'), 'version_code 50020126');
ok(mv.includes('4.0.02.0831.03'), 'version_name 4.0.02');
ok(mv.includes("const MB_CLIENT_BUILD = '1786863422670304777"), 'x-client-build constant');
ok(/'User-Agent': 'okhttp\/4\.9\.3'/.test(mv), 'okhttp/4.9.3 UA in mbHeaders');
ok(/'x-client-status': '1'/.test(mv), 'x-client-status 1');
ok(mv.includes('application/json;charset=UTF-8'), 'charset content-type');
ok(mv.includes("'x-play-mode': '2'") && mv.includes("'x-idle-data': '1'") && mv.includes("'x-family-mode': '0'") && mv.includes("'x-content-mode': '0'"), 'play/idle/family/content headers');
ok(mv.includes('region:') && /region: 'NG'/.test(mv), 'identity region NG');

console.log('── token / registration ──');
ok(mv.includes('const MB_BOOTSTRAP_TOKEN ='), 'bootstrap pool token');
ok(mv.includes('moviedexUserToken'), 'settings.json persistence key');
ok(mv.includes('process.env.MB_USER_TOKEN'), 'env token override');
ok(mv.includes('/wefeed-mobile-bff/user-api/get-sms-code') && mv.includes('/wefeed-mobile-bff/user-api/register'), 'registration endpoints');
ok(mv.includes('api.tempmail.lol') && mv.includes('api.guerrillamail.com'), 'temp-email providers');
ok(mv.includes('function scheduleMbRegister') && mv.includes('scheduleMbRegister(1500)'), 'scheduleMbRegister (boot + 401 path)');
ok(mv.includes('if (!tokenUsable(mbUserToken)) scheduleMbRegister('), 'boot-time registration');
ok(mv.includes('delete _vh.Authorization'), 'visitor-login anonymous');
ok(mv.includes('mbAuthFailAt = Date.now(); mbUserToken'), 'auth-fail window + token wipe');
ok(mv.includes('mbAuthFailAt = 0;'), 'auth-fail window reset on success');
ok(/HTTP 441\|HTTP 401\|HTTP 406/.test(mv), '406 in auth-fail regex');
ok(mv.includes('function mbPickToken'), 'mbPickToken (registered → bootstrap → visitor)');

console.log('── direct-MP4 path ──');
ok(mv.includes('const MB_STUB_RE = /macdn') && mv.includes('9a0461bc39da389663bf3dbb17091d3f') && mv.includes('|\\/notice\\.mp4/i'), 'stub-URL detector');
ok(mv.includes('/wefeed-mobile-bff/subject-api/resource-position/v2?subjectId=${sid}&resourceId=${rid}&failUrl=&failCode=&resourceNum=1&isVip=false'), 'resource-position/v2 call');
ok(mv.includes('perPage=20&all=0&pagerMode=0&resolution='), 'resource list params (perPage 20 = server cap)');
ok(mv.includes('[1080, 720, 480, 360].map'), 'per-resolution fetch');
ok(mv.includes('it.vipInfo?.requireMemberType === 1') && mv.includes('VIP-only'), 'VIP rows skipped honestly');
ok(mv.includes('rid: String(it.resourceId)'), 'row.direct carries resourceId');
ok(mv.includes('for (const r of [...directRows, ...dashRows])'), 'combinedRows: direct wins per height');
ok(mv.includes('if (row.direct) return directDownload(row,'), 'downloadDash entry → directDownload');
ok(mv.includes("'User-Agent': 'okhttp/4.12.0'") && mv.includes("'Accept-Encoding': 'identity'"), 'CDN fetch headers');
ok(mv.includes("redirect: 'manual'") && mv.includes('CDN redirect loop'), 'manual redirect follow');
ok(mv.includes('content-range') && mv.includes('fs.ftruncateSync(fd, total)'), 'total size + preallocation');
ok(mv.includes("parseInt(process.env.ARENA_DL_WORKERS || '10', 10)"), 'parallel workers env');
ok(mv.includes('fs.writeSync(fd, b, 0, b.length, nextWrite * CHUNK)'), 'ordered position writes');
ok(mv.includes('CDN stall — තත්පර 120ක් bytes ආවේ නෑ'), 'stall watchdog');
ok(mv.includes("const CHUNK = 4 * 1048576;"), '4MB chunking');

console.log('── flow rewiring ──');
ok(mv.includes('if ((!qrow || (!qrow.dash && !qrow.direct)) && st) {') && mv.includes('if (!qrow || (!qrow.dash && !qrow.direct)) { react?.(❌'.replace('❌', "'❌'")), 'deliverStream direct gates ×2');
ok(mv.includes('!row.transcode && !row.direct') && mv.includes('(row.direct || row.transcode) ? \'mp4\''), 'deliverStream finalName direct→mp4');
ok(mv.includes('(qrow.direct || qrow.transcode) ? \'mp4\''), 'movieFileCmd ext direct→mp4');
ok(mv.includes('epFileName(m.name, season, ep, row.h, !row.transcode && !row.direct)'), 'seasonFilesCmd finalName direct→mp4');
ok(mv.includes('const fresh = await combinedRows(m.sid, row.season, row.ep, streams).catch(() => []);'), 'episodeFileCmd → combinedRows');
ok(mv.includes('if (!qrow || (!qrow.direct && !qrow.dash)) { react?.'), 'episodeFileCmd empty-check');
ok(mv.includes('const rows = await combinedRows(m.sid, season, ep, streams).catch(() => []);'), 'seasonFilesCmd → combinedRows');
ok(mv.includes('qRows = await combinedRows(full.sid, row.season, 1, streams);'), 'season probe → combinedRows');
ok(mv.includes('qRows = await combinedRows(full.sid, row.season, row.ep, streams);'), 'episode probe → combinedRows');
ok(mv.includes('rows = await combinedRows(full.sid, 0, 0, streams);'), 'movie probe → combinedRows');
ok(mv.includes('(${qRows.filter(r => r.direct).length} direct)'), 'probe logs show direct counts');
ok(mv.includes('if (epErr) return send(jid, { text: epErr }, { quoted: msg });'), 'episode probe: NEW msg (silence fix)');
ok(mv.includes('if (seasonErr) return send(jid, { text: seasonErr }, { quoted: msg });'), 'season probe: NEW msg (silence fix)');

console.log('── exports + regressions ──');
ok(mv.includes('mbDirectRows, mbDirectUrl, mbPositionSize, mbSizePlausible, MB_POS_SIZE, combinedRows, directDownload, mbRegisterAccount,'), 'new exports (v2.62: position-size helpers added after mbDirectUrl)');
ok(bot.includes("parseInt(process.env.ARENA_TEXT_TIMEOUT || '60000', 10)"), 'R: v2.45 text send timeout');
ok(bot.includes('Math.min(20 * 60e3, 180e3 + Math.round(sz / 1.5 / 1048576 * 1000))'), 'R: v2.43 size-aware media timeout');
ok(bot.includes('/logs?key='), 'R: v2.43 /logs route');
ok(guard.includes("parseInt(process.env.ARENA_PACE_DEFAULT || '120000', 10)") && guard.includes('if (!timeoutMs) timeoutMs = DEF_T;'), 'R: v2.45 pacer default timeout');
ok(mv.includes("parseInt(process.env.ARENA_SEG_WORKERS_V || '16', 10) || 16") && mv.includes("parseInt(process.env.ARENA_SEG_WORKERS_A || '8', 10) || 8"), 'R: v2.44 segment workers');
ok(mv.includes("'-preset', 'ultrafast'"), 'R: v2.44 ultrafast preset');

console.log('── module load ──');
try {
    const mod = require(path.join(REPO, 'moviedex.js'));
    ok(typeof mod.combinedRows === 'function' && typeof mod.mbDirectRows === 'function' && typeof mod.directDownload === 'function' && typeof mod.mbRegisterAccount === 'function', 'moviedex.js require + new API surface');
} catch (e) { ok(false, 'moviedex.js require: ' + e.message.slice(0, 80)); }

if (process.env.RUN_LIVE) {
    console.log('── RUN_LIVE E2E ──');
    (async () => {
        try {
            const mod = require(path.join(REPO, 'moviedex.js'));
            const list = await mod.mbSearch('black clover', 3);
            ok(list.length > 0, `live search (${list.length} rows)`);
            const sid = list[0].sid;
            const rows = await mod.combinedRows(sid, 1, 1, []).catch(e => { console.log('   combinedRows err:', e.message); return []; });
            ok(rows.length > 0, `live combinedRows S1E1 (${rows.length} rows: ${rows.map(r => r.label).join(',')})`);
            ok(rows.some(r => r.direct), 'live rows carry .direct');
            const d = rows.find(r => r.direct);
            if (d) {
                const url = await mod.mbDirectUrl(d.direct.sid, d.direct.se, d.direct.ep, d.direct.rid);
                ok(/^https?:\/\//.test(url) && !/macdn\.aoneroom\.com\/other\//.test(url), 'live direct URL real (' + url.slice(0, 60) + '…)');
                const r = await fetch(url, { headers: { 'User-Agent': 'okhttp/4.12.0', Range: 'bytes=0-1048575' }, signal: AbortSignal.timeout(30000) });
                const buf = await r.arrayBuffer();
                ok(r.status === 206 && buf.byteLength >= 1048576, `live CDN range GET ${r.status} ${Math.round(buf.byteLength / 1024)}KB`);
                try { await r.body?.cancel(); } catch { }
            }
            console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
            process.exit(fail ? 1 : 0);
        } catch (e) { console.log('LIVE FATAL:', e.message); process.exit(1); }
    })();
    return;
}

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
