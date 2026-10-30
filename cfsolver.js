/**
 * cfsolver.js — v3.03.0 🥷 Cloudflare stealth solver (puppeteer-extra + stealth plugin)
 * User directive: "වැඩි කල් පවතින ක්‍රමය: Puppeteer + Stealth — හරියටම ඇත්ත මිනිහෙක් Chrome
 * browser එකකින් ගේම් එකට එනවා වගේ" (2026-10-30, after .animepahe hit the CF wall).
 *
 * Design:
 *  - ALL puppeteer code lives HERE — the bot requires this module lazily; if puppeteer is not
 *    installed (npm optionalDependencies skipped on the panel) require() fails and the caller
 *    answers the honest wall card. The bot NEVER crashes because of the browser.
 *  - ONE persistent browser (launched on first solve, kept warm) — not per-request (user knows
 *    the RAM cost: ~1GB class). Pages open/close per solve; browser.idle shutdown is NOT used
 *    (restart churn is worse than idle RAM on a panel).
 *  - solve() returns { ok, cookie, ua, clearance } — the cookie is IP+UA-bound, so callers MUST
 *    reuse the SAME ua with plain fetch (cf_clearance pairs with the UA the browser showed).
 *  - Honest failure modes: no-chromium · ip-blocked ("Attention Required" = hard WAF block,
 *    un-solvable) · challenge-timeout · launch errors — all surfaced, never faked.
 */
'use strict';

let browser = null;
let browserFailed = false;

function libsAvailable() {
    try { require('puppeteer-extra'); require('puppeteer-extra-plugin-stealth'); return true; } catch { return false; }
}

async function getBrowser(log) {
    if (browser) return browser;
    if (browserFailed) return null;
    try {
        const pe = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        pe.use(StealthPlugin());
        browser = await pe.launch({
            headless: true,   // v25+: real Chrome-for-testing headless (not the old HeadlessChrome shell)
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--disable-blink-features=AutomationControlled'],
        });
        if (browser && typeof browser.on === 'function') browser.on('disconnected', () => { browser = null; });
        return browser;
    } catch (e) {
        browserFailed = true;
        if (log) log('cfsolver launch FAIL: ' + String((e && e.message) || e).slice(0, 140));
        return null;
    }
}

const CHALLENGE_TITLE = /Just a moment|Checking your browser|Checking if you are human|Please Wait|Verifying you are human|Verify you are human/i;
const BLOCK_TITLE = /Attention Required|Access denied|Sorry, you have been blocked|Error 1020/i;

/**
 * solve('https://host/') → { ok:true, cookie:'cf_clearance=…; …', ua:'<exact browser UA>', clearance:bool }
 *                        | { ok:false, why:'no-chromium'|'ip-blocked'|'challenge-timeout'|'no-cookies'|'<error>' }
 */
async function solve(base, log) {
    const b = await getBrowser(log);
    if (!b) return { ok: false, why: browserFailed ? 'launch-fail' : 'no-chromium' };
    let page = null;
    try {
        page = await b.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        const resp = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45e3 });
        const t0 = Date.now();
        while (Date.now() - t0 < 40e3) {
            const title = (await page.title().catch(() => '')) || '';
            if (BLOCK_TITLE.test(title)) return { ok: false, why: 'ip-blocked', status: resp ? resp.status() : 0 };
            if (!CHALLENGE_TITLE.test(title)) break;
            await new Promise((r) => setTimeout(r, 1500));
        }
        const title = (await page.title().catch(() => '')) || '';
        if (BLOCK_TITLE.test(title)) return { ok: false, why: 'ip-blocked', status: resp ? resp.status() : 0 };
        if (CHALLENGE_TITLE.test(title)) return { ok: false, why: 'challenge-timeout', status: resp ? resp.status() : 0 };
        const jar = await page.cookies();
        const cookie = jar.map((c) => c.name + '=' + c.value).join('; ');
        if (!cookie) return { ok: false, why: 'no-cookies', status: resp ? resp.status() : 0 };
        const ua = await page.evaluate(() => navigator.userAgent);
        return { ok: true, cookie, ua, clearance: jar.some((c) => c.name === 'cf_clearance'), status: resp ? resp.status() : 0 };
    } catch (e) {
        return { ok: false, why: String((e && e.message) || e).slice(0, 100) };
    } finally {
        if (page) { try { await page.close(); } catch { } }
    }
}

async function shutdown() {
    if (browser) { try { await browser.close(); } catch { } browser = null; }
}

function _reset() { browser = null; browserFailed = false; }   // tests

module.exports = { solve, getBrowser, libsAvailable, shutdown, _reset };
