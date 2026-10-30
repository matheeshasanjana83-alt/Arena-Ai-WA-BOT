/* get-chrome.js — v3.03.1 postinstall: best-effort Chrome download for cfsolver.
 * The panel's npm install DID install puppeteer's JS but skipped/silently-failed the browser
 * download (boot log 2026-10-30: "Could not find Chrome (ver. 156…)"). This runs the same
 * installer on every npm install — Chrome is downloaded ONCE (~170MB) and cached in
 * ~/.cache/puppeteer for all later boots. NEVER fails the install: any error → log + exit 0. */
'use strict';
try {
    const fs = require('fs'), path = require('path');
    const inst = path.join(__dirname, '..', 'node_modules', 'puppeteer', 'install.mjs');
    if (!fs.existsSync(inst)) {
        console.log('[get-chrome] puppeteer not installed (npm optionalDependencies skipped) — cfsolver answers honest wall cards');
    } else {
        console.log('[get-chrome] ensuring puppeteer Chrome (first download ~170MB, then cached)…');
        require('child_process').execFileSync(process.execPath, [inst], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 300000 });
        console.log('[get-chrome] Chrome ready ✅');
    }
} catch (e) {
    console.log('[get-chrome] Chrome download failed (best-effort, bot unaffected): ' + String((e && e.message) || e).slice(0, 120));
    console.log('[get-chrome] cfsolver self-heal will retry in background on the next .animepahe use');
}
process.exit(0);
