/**
 * pot_worker.cjs — standalone BotGuard PO-token minter (v2.69)
 *
 * Prints ONE JSON line to stdout: {"vd":"<visitor_data>","po":"<po_token>","ttl":<secs>}
 * Runs as a CHILD PROCESS (node pot_worker.cjs) so the jsdom/window globals never
 * pollute the bot process, and a BotGuard hang can't wedge .song/.video.
 *
 * deps: bgutils-js (BotGuard challenge → integrity token → WebPO minter),
 *       jsdom (the interpreter script needs window/document), youtubei.js (base WEB
 *       session → visitorData contentBinding). Proven flow = scripts/poc/poc.cjs.
 */
process.on('uncaughtException', (e) => { try { console.error('worker crash: ' + e.message); } catch { } process.exit(3); });

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.youtube.com/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.location = dom.window.location;

const { getChallenge, BotGuardClient } = require('bgutils-js/botguard');
const { WebPoMinter } = require('bgutils-js/webpo');
const { GOOG_API_KEY, GOOG_BASE_URL } = require('bgutils-js/utils');
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';   // YouTube innertube attestation key (public, same in bgutil-ytdlp-pot)

(async () => {
    const t0 = Date.now();
    // 1) BotGuard challenge (InnerTube att/get — cleaner than scraping a watch page)
    const challenge = await getChallenge({ requestKey: REQUEST_KEY, fetchFunction: (u, o) => fetch(u, o), useYouTubeAPI: true });
    const ij = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!ij) throw new Error('no interpreterJavascript');
    new Function(ij)();   // defines globalThis[challenge.globalName] (verify — jsdom may capture it on window)
    if (!globalThis[challenge.globalName] && dom.window[challenge.globalName]) globalThis[challenge.globalName] = dom.window[challenge.globalName];
    if (!globalThis[challenge.globalName]) throw new Error('BotGuard global missing: ' + challenge.globalName);

    // 2) run the bytecode program → snapshot → botguardResponse
    const bg = await BotGuardClient.create({ program: challenge.program, globalName: challenge.globalName, globalObject: globalThis });
    const webPoSignalOutput = [];
    const botguardResponse = await bg.snapshot({ webPoSignalOutput });
    if (!botguardResponse) throw new Error('snapshot empty');

    // 3) integrity token (WAA GenerateIT)
    const itR = await fetch(`${GOOG_BASE_URL}/$rpc/google.internal.waa.v1.Waa/GenerateIT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json+protobuf', 'x-goog-api-key': GOOG_API_KEY, 'x-user-agent': 'grpc-web-javascript/0.1' },
        body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });
    if (!itR.ok) throw new Error('GenerateIT ' + itR.status);
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await itR.json();
    if (!integrityToken) throw new Error('no integrity token');
    const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput);

    // 4) visitor data from a base WEB session → mint the PO token bound to it
    const { Innertube } = require('youtubei.js');
    const base = await Innertube.create({ client_type: 'WEB', retrieve_player: false });
    const vd = base.session?.context?.client?.visitorData;
    if (!vd) throw new Error('no visitorData from base session');
    const po = await minter.mintAsWebsafeString(vd);
    if (!po || po.length < 50) throw new Error('mint too short: ' + (po || '').length);

    process.stdout.write(JSON.stringify({ vd, po, ttl: estimatedTtlSecs || 43200, ms: Date.now() - t0 }) + '\n');
    process.exit(0);
})().catch((e) => { try { console.error('mint fail: ' + (e && e.message)); } catch { } process.exit(1); });
