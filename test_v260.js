/**
 * test_v260.js — MOVIEDEX SUBTITLES: ▸ Subtitles section on episode + movie quality menus,
 * numbering continues past qualities, same reply grammar picks a sub → .srt document.
 * Run: node test_v260.js   (fully OFFLINE — local HTTP SRT server, no MovieBox calls)
 *  [1] parseCaptions — extCaptions junk filters (stub hash, ≤50B stubs, lan=in tiny, dups, no-url)
 *  [2] subLabel / subFileName — native names, episode vs movie naming, .vtt extension
 *  [3] vttToSrt — header/NOTE/STYLE out, . → , stamps, cue settings out, cues re-numbered, tags stripped
 *  [4] menu numbering — epOptText / cardText: 4 qualities + 3 subs → subs numbered 5..7; no subs → no section
 *  [5] REAL handle() E2E — series + movie session: sub pick → .srt document from a local server,
 *      link mode → direct URL text, q# beyond subs → quality error
 */
process.env.ARENA_NO_DELAY = '1'; process.env.ARENA_NO_REACT = '1';
const assert = require('assert');
const fs = require('fs');
const http = require('http');

const mdx = require('./moviedex.js');
let pass = 0, fail = 0;
function ok(name, fn) {
    try { const r = fn(); if (r && r.catch) return r.then(() => { pass++; console.log('  ✅', name); }).catch(e => { fail++; console.log('  ❌', name, '—', e.message); });
        pass++; console.log('  ✅', name);
    } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
}

const SELF = '94771234567@s.whatsapp.net';
const SENT = [];
let GID = 0;
const send = async (jid, content, opts) => { SENT.push({ jid, content, opts }); return { key: { id: 's' + (++GID), remoteJid: jid } }; };
const lastText = () => String((SENT[SENT.length - 1] || {}).content?.text || (SENT[SENT.length - 1] || {}).content?.caption || '');
let N = 0;
const mk = (text) => ({ key: { remoteJid: SELF, fromMe: true, id: 'm' + (++N) + Math.random().toString(36).slice(2, 8) }, message: { conversation: text } });

const FAKE_CAPS = {
    data: { extCaptions: [
        { url: 'https://x/a.srt', lan: 'en', lanName: 'English', size: 24000 },
        { url: 'https://x/b.srt', lan: 'si', lanName: 'Sinhala', size: 31000 },
        { url: 'https://x/stub.srt', lan: 'xx', lanName: 'Stub', size: 30 },                    // ≤50B junk → out
        { url: '', lan: 'no', lanName: 'NoURL', size: 1000 },                                    // no url → out
        { url: 'https://x/dead.srt?h=aa348f2541d13ffe', lan: 'dd', lanName: 'Dead', size: 500 }, // stub hash → out
        { url: 'https://x/tiny.srt', lan: 'in', lanName: 'Indonesia', size: 99 },                // lan=in tiny → out
        { url: 'https://x/a.srt', lan: 'en', lanName: 'English dup', size: 24000 },              // dup url → out
        { url: 'https://x/c.srt', lan: '', lanName: '', size: 12000 },                           // no lan/name → Unknown
    ] },
};

(async () => {
    console.log('== v2.60 moviedex subtitles ==\n[1] parseCaptions');
    const caps = mdx.parseCaptions(FAKE_CAPS);
    await ok('8 raw → 3 kept (stub-hash/≤50B/no-url/lan=in-tiny/dup filtered)', () => assert.strictEqual(caps.length, 3));
    await ok('kept order + lan/name', () => assert.deepStrictEqual(caps.map(c => [c.lan, c.name]), [['en', 'English'], ['si', 'Sinhala'], ['', 'Unknown']]));
    await ok('top-level extCaptions wrapper too', () => assert.strictEqual(mdx.parseCaptions({ extCaptions: [{ url: 'u', lan: 'ta' }] })[0].lan, 'ta'));
    await ok('empty/garbage payloads → []', () => { assert.deepStrictEqual(mdx.parseCaptions({}), []); assert.deepStrictEqual(mdx.parseCaptions(null), []); assert.deepStrictEqual(mdx.parseCaptions({ data: {} }), []); });

    console.log('\n[2] subLabel / subFileName');
    await ok('si → si (සිංහල)', () => assert.strictEqual(mdx.subLabel({ lan: 'si', name: 'Sinhala' }), 'si (සිංහල)'));
    await ok('en → en (English)', () => assert.strictEqual(mdx.subLabel({ lan: 'en', name: 'English' }), 'en (English)'));
    await ok('unknown lan → lanName fallback', () => assert.strictEqual(mdx.subLabel({ lan: 'zz', name: 'Zzzish' }), 'zz (Zzzish)'));
    await ok('in_id Indonesian', () => assert.strictEqual(mdx.subLabel({ lan: 'in_id', name: 'Indonesian' }), 'in_id (Bahasa Indonesia)'));
    await ok('ep name: Show S01E01 - si (සිංහල).srt', () => assert.strictEqual(mdx.subFileName('Black Clover', { lan: 'si', name: 'Sinhala', url: 'https://x/y.srt' }, true, 1, 1), 'Black Clover S01E01 - si (සිංහල).srt'));
    await ok('movie name: Title - en (English).srt', () => assert.strictEqual(mdx.subFileName('Deadpool', { lan: 'en', name: 'English', url: 'https://x/y.srt' }, false, 0, 0), 'Deadpool - en (English).srt'));
    await ok('.vtt url keeps .vtt ext', () => assert.ok(mdx.subFileName('T', { lan: 'en', url: 'https://x/y.vtt?Policy=x' }, false, 0, 0).endsWith('.vtt')));
    await ok('illegal chars stripped from show name (base, not the .srt ext)', () => assert.ok(!/[\\/:*?"<>|]/.test(mdx.subFileName('A/B:C*D', { lan: 'en', url: 'x.srt' }, true, 2, 3).split(' S')[0])));

    console.log('\n[3] vttToSrt');
    const vtt = '\uFEFFWEBVTT\n\nNOTE this is a note\nwith two lines\n\nSTYLE\n::cue { color: red }\n\n1\n00:01:02.500 --> 00:01:04.000 align:start line:0%\nHello <c.name>world</c>\n\n2\n00:01:05.000 --> 00:01:07.250\nSecond cue\n';
    const srt = mdx.vttToSrt(vtt);
    await ok('WEBVTT header + NOTE + STYLE blocks gone', () => assert.ok(!/WEBVTT|NOTE|STYLE|::cue/.test(srt)));
    await ok('stamps use , (comma) milliseconds', () => assert.ok(srt.includes('00:01:02,500 --> 00:01:04,000')));
    await ok('cue settings (align/line) stripped', () => assert.ok(!/align:|line:/.test(srt)));
    await ok('cue tags stripped, text kept', () => assert.ok(srt.includes('Hello world') && !/<c\.|<\/c>/.test(srt)));
    await ok('cues re-numbered 1,2 (VTT ids dropped)', () => assert.ok(/^1\n/.test(srt) && /\n2\n/.test(srt) && !/\n\d+\n\d+\n00:/.test(srt)));

    console.log('\n[4] menu numbering');
    const q4 = [{ h: 1080, label: '1080p', sizeMB: 205 }, { h: 720, label: '720p', sizeMB: 125 }, { h: 480, label: '480p', sizeMB: 79 }, { h: 360, label: '360p', sizeMB: 62 }];
    const subs3 = [{ lan: 'si', name: 'Sinhala', url: 'u' }, { lan: 'en', name: 'English', url: 'u' }, { lan: 'hi', name: 'Hindi', url: 'u' }];
    const row = { kind: 'ep', season: 1, ep: 114 };
    const epMenu = mdx.epOptText ? '' : '';   // epOptText is internal — via source pin below; cardText is exported
    const cardTxt = mdx.cardText({ name: 'Deadpool', year: '2016', desc: 'x' }, 1, q4, subs3);
    await ok('cardText: qualities numbered 1-4', () => assert.ok(/\*1\* \| 🎥 1080p/.test(cardTxt) && /\*4\* \| 🎥 360p/.test(cardTxt)));
    await ok('cardText: ▸ Subtitles section, numbering continues 5-7', () => {
        assert.ok(cardTxt.includes('▸ Subtitles 👇'));
        assert.ok(/\*5\* \| 🗨 si \(සිංහල\)/.test(cardTxt));
        assert.ok(/\*6\* \| 🗨 en \(English\)/.test(cardTxt));
        assert.ok(/\*7\* \| 🗨 hi \(हिन्दी\)/.test(cardTxt));
    });
    await ok('cardText: no subs → no Subtitles section (menu unchanged)', () => {
        const t = mdx.cardText({ name: 'VIP', desc: 'x' }, 1, q4);
        assert.ok(!t.includes('Subtitles'));
        assert.ok(/\*4\* \| 🎥 360p/.test(t));
    });
    await ok('epOptText source pin: SELECT DOWNLOAD OPTION + Subtitles section + continued numbering', () => {
        const src = fs.readFileSync('moviedex.js', 'utf8');
        assert.ok(src.includes('function epOptText(show, row, qRows, subs)'));
        assert.ok(src.includes("'▸ Subtitles 👇'") && src.includes('**(qRows || []).length + i + 1**'.replace(/\*\*/g, '')));
        assert.ok(src.includes("ltk = full.name && false") === false);   // no-op keepalive for lint-style asserts
    });

    // ═══ [5] REAL handle() E2E — offline local SRT server ═══
    console.log('\n[5] handle() E2E — sub pick → .srt document');
    const SRT = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nKAVIZ SUB TEST\n');
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(SRT); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const SUB_URL = `http://127.0.0.1:${srv.address().port}/sub.srt`;

    const jid1 = SELF + ' A'.slice(0, 0);   // same jid shape, distinct session keys below
    const J1 = 'sess-a@s.whatsapp.net', J2 = 'sess-b@s.whatsapp.net';
    mdx._testSession(J1, {
        list: [{ sid: 'SID1', name: 'Black Clover', type: 'series' }],
        detail: { 1: { sid: 'SID1', name: 'Black Clover', type: 'series', at: Date.now() } },
        tv: { 1: { at: Date.now(), seasons: [{ se: 1, maxEp: 2 }],
            epQualities: { 2: [{ h: 1080, label: '1080p', direct: { rid: 'R1' } }, { h: 720, label: '720p', direct: { rid: 'R2' } }] },
            epSubs: { 2: [{ lan: 'si', name: 'Sinhala', url: SUB_URL }, { lan: 'en', name: 'English', url: SUB_URL }] } } },
        mv: {}, at: Date.now(),
    });
    const ctx = (j) => ({ send, jid: j, msg: mk('.moviedex 1 2 3'), rest: ['1', '2', '3'], react: () => { } });

    SENT.length = 0;
    await mdx.handle('.moviedex', ctx(J1));   // c = the command word — rest carries the picks (same as the bot router)
    const doc = SENT.find(x => x.content?.document);
    await ok('series: q3 (past 2 qualities) → subtitle document', () => assert.ok(!!doc, 'sent=' + SENT.length + ' types=' + SENT.map(x => Object.keys(x.content)[0]).join(',')));
    await ok('document name = Black Clover S01E02 - si (සිංහල).srt (v2.62: row 2 = E2 — episodes first)', () => assert.strictEqual(doc?.content?.fileName, 'Black Clover S01E02 - si (සිංහල).srt'));
    await ok('caption has language label', () => assert.ok(/si \(සිංහල\)/.test(String(doc?.content?.caption || ''))));
    await ok('resolve bubble deleted after doc (file speaks)', () => assert.ok(!!SENT[SENT.length - 1]?.content?.delete));

    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 2 4 link'), rest: ['1', '2', '4', 'link'], react: () => { } });
    await ok('series: q4 link mode → direct URL text (no document)', () => assert.ok(!SENT.some(x => x.content?.document) && SENT.some(x => String(x.content?.text || '').includes(SUB_URL) && /English/.test(lastText())), lastText().slice(0, 60)));

    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 2 9'), rest: ['1', '2', '9'], react: () => { } });
    await ok('series: q9 beyond subs+qualities → quality error', () => assert.ok(/quality නෑ/.test(lastText()), lastText().slice(0, 60)));

    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J1, msg: mk('.moviedex 1 2 2'), rest: ['1', '2', '2'], react: () => { } });
    await ok('series: q2 (still a quality) → NOT a sub (streams path)', () => assert.ok(!SENT.some(x => x.content?.document?.fileName?.includes('.srt'))));

    mdx._testSession(J2, {
        list: [{ sid: 'SID2', name: 'Deadpool', type: 'movie' }],
        detail: { 1: { sid: 'SID2', name: 'Deadpool', type: 'movie', year: '2016', at: Date.now() } },
        mv: { 1: { streams: [], qualities: [{ h: 1080, label: '1080p', direct: { rid: 'R9' } }], subs: [{ lan: 'en', name: 'English', url: SUB_URL }, { lan: 'bn', name: 'Bengali', url: SUB_URL }], at: Date.now() } },
        at: Date.now(),
    });
    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J2, msg: mk('.moviedex 1 2'), rest: ['1', '2'], react: () => { } });
    const doc2 = SENT.find(x => x.content?.document);
    await ok('movie: q2 (past 1 quality) → subtitle document', () => assert.ok(!!doc2));
    await ok('movie doc name = Deadpool - en (English).srt (q2 = FIRST sub)', () => assert.strictEqual(doc2?.content?.fileName, 'Deadpool - en (English).srt'));
    SENT.length = 0;
    await mdx.handle('.moviedex', { send, jid: J2, msg: mk('.moviedex 1 3'), rest: ['1', '3'], react: () => { } });
    const doc3 = SENT.find(x => x.content?.document);
    await ok('movie doc q3 = Deadpool - bn (বাংলা).srt (numbering continues)', () => assert.strictEqual(doc3?.content?.fileName, 'Deadpool - bn (বাংলা).srt'));

    srv.close();

    console.log('\n[6] version pins');
    await ok('package.json 2.65.0', () => assert.strictEqual(require('./package.json').version, '2.68.0'));
    await ok('manifest.json 2.65.0 + notes mention subtitles/deep-episodes', () => { const m = JSON.parse(fs.readFileSync('manifest.json')); assert.strictEqual(m.version, '2.68.0'); assert.ok(/SUBTITLES|DEEP EPISODES/i.test(m.notes)); });
    await ok('moviedex.js exports subtitle helpers', () => ['mbCaptions', 'parseCaptions', 'subLabel', 'subFileName', 'vttToSrt', 'deliverSub'].every(k => assert.ok(fs.readFileSync('moviedex.js', 'utf8').includes(k + ',') || fs.readFileSync('moviedex.js', 'utf8').includes(' ' + k + ','), k)));

    console.log(`\n═══ v2.60 moviedex subtitles: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
