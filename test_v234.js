'use strict';
/**
 * test_v234.js — Anti-Bug v4: real crasher-toolkit classes (v2.34.0)
 * Source: LimeWire "WhatsApp Documents.zip" → 10 leaked bug tools dissected
 * (AmbaCrash v14, HADES, SKYVIEN, XLOID INVICTUS, DELVIN CRASH, SATANIC DEVIL,
 *  CFC V30, Shiroxyx 4.0, HARVEST INFINITY, Neobeast). Proves every payload class
 * those tools send is caught severe, normals never trigger, retaliation still works.
 * run: node test_v234.js   (offline — pure detect() fixtures + fake sock, nothing sent)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

process.env.ANTIBUG_TEST_FAST = '1';
let failed = false;
process.chdir(__dirname);
const read = (f) => fs.readFileSync(f, 'utf8');

const SET_FILE = path.join(__dirname, 'settings.json');
const SET_SNAP = fs.readFileSync(SET_FILE, 'utf8');
process.on('exit', () => { try { fs.writeFileSync(SET_FILE, SET_SNAP); } catch { } });

const ab = require('./antibug');
let uniq = 900;
const senderJid = () => `9478${String(uniq++).padStart(6, '0')}@s.whatsapp.net`;

(async () => {
    try {
        // 1) version sync 2.34.0
        const man = JSON.parse(read('manifest.json'));
        const pkg = JSON.parse(read('package.json'));
        if (man.version !== pkg.version || pkg.version < '2.34.0') throw new Error('version sync wrong: pkg=' + pkg.version);
        console.log('[1] v' + pkg.version + ' sync (manifest === package): OK ✅');

        // 2) old test gone, manifest clean, antibug.js + test_v234.js shipped
        if (fs.existsSync('test_v233.js')) throw new Error('test_v233.js still exists');
        for (const f of man.removed || []) {
            if (man.files.includes(f)) throw new Error(f + ' in both files and removed');
            if (/^(auth|node_modules|\.backup)/.test(f) || f.includes('..') || path.isAbsolute(f)) throw new Error('unsafe removed path: ' + f);
        }
        if (!man.files.includes('antibug.js') || !man.files.includes('test_v234.js')) throw new Error('manifest missing antibug.js/test_v234.js');
        console.log('[2] test_v233 deleted + manifest clean: OK ✅');

        // 3) new v2.34 limits present
        for (const k of ['pageCount', 'fileLenMax', 'amountMax', 'bannerAction', 'convDelay', 'fwdScore', 'lineStorm', 'surrMin']) {
            if (!(k in ab.L)) throw new Error('antibug.L missing ' + k);
        }
        console.log('[3] v2.34 limits (pageCount/fileLen/amount/banner/convDelay/fwdScore/lineStorm/surrMin): OK ✅');

        // 4) new classes caught severe (independent fixtures)
        const mustSevere = (name, msg) => {
            const r = ab.detect(msg);
            if (!r.bug || !r.severe) throw new Error(name + ' not caught severe: ' + JSON.stringify(r.reasons));
            return r;
        };
        mustSevere('pageCount bomb', { documentMessage: { pageCount: 3567587327 } });
        mustSevere('pageCount bomb 2', { documentMessage: { pageCount: 199183729199991 } });
        mustSevere('fileLength number bomb', { documentMessage: { fileLength: 1e13 } });
        mustSevere('fileLength string bomb', { documentMessage: { fileLength: '999999999999999999999999999999999999999999999999' } });
        mustSevere('fileLength Long bomb', { documentMessage: { fileLength: { low: 101, high: 2328, unsigned: true } } });
        mustSevere('order amount bomb', { orderMessage: { totalAmount1000: '98999999999999999' } });
        mustSevere('trustBannerAction bomb', { extendedTextMessage: { text: 'hi', contextInfo: { trustBannerAction: 99999 } } });
        mustSevere('negative expiration', { extendedTextMessage: { text: 'hi', contextInfo: { expiration: -99999 } } });
        mustSevere('forwardingScore bomb', { extendedTextMessage: { text: 'hi', contextInfo: { forwardingScore: 999999 } } });
        mustSevere('conversionDelaySeconds bomb', { extendedTextMessage: { text: 'hi', contextInfo: { conversionDelaySeconds: 9999 } } });
        mustSevere('lone surrogate storm', { conversation: 'a' + String.fromCharCode(0xDB40).repeat(300) });
        mustSevere('FFFD storm', { conversation: 'a\uFFFD'.repeat(400) });
        mustSevere('line storm', { conversation: 'i lose\n'.repeat(9999) });
        console.log('[4] v2.34 classes: pageCount/fileLength(num+str+Long)/amount/trustBanner/negExp/fwdScore/convDelay/surrogate/FFFD/line-storm all severe: OK ✅');

        // 5) REAL payload reconstructions from the 10 dissected tools
        mustSevere('SATANIC DEVIL crashcursor', {
            viewOnceMessage: { message: { listResponseMessage: {
                title: 'Bruh your stupid' + '@0'.repeat(50000), listType: 2, singleSelectReply: { selectedRowId: '🩸' },
                contextInfo: { expiration: -99999, trustBannerAction: 99999, forwardingScore: 999999, conversionDelaySeconds: 9999 },
                quotedMessage: { buttonsMessage: {
                    documentMessage: { pageCount: 3567587327, fileLength: '9999999999999', fileName: '#satan' },
                    buttons: [{ buttonId: '\u0000'.repeat(850000), buttonText: { displayText: '#satan' }, type: 1 }], headerType: 3,
                } },
            } } },
        });
        mustSevere('SKYVIEN RavageCursorOrder', {
            viewOnceMessage: { message: { orderMessage: {
                message: '📦 Ravage Only Order' + 'ꦾ'.repeat(99999), totalAmount1000: '98999999999999999',
                fileLength: '9999999999999', pageCount: 3567587327,
                contextInfo: { quotedMessage: { buttonsMessage: { buttons: [{ buttonId: '\u0000'.repeat(549999) }] } } },
            } } },
        });
        mustSevere('QBug interactiveResponse paramsJson', {
            message: { interactiveResponseMessage: { body: { text: 'Sent', format: 'DEFAULT' },
                nativeFlowResponseMessage: { name: 'galaxy_message', paramsJson: `{"screen_0_TextInput_0":"radio${'\0'.repeat(500000)}"}`, version: 3 } } },
        });
        mustSevere('XLOID accessibilityText flood', { extendedTextMessage: { text: 'x', accessibilityText: '\u200B'.repeat(102002) } });
        mustSevere('XLOID buttonParamsJson NUL', { interactiveMessage: { nativeFlowMessage: {
            buttons: Array.from({ length: 30 }, () => ({ name: 'galaxy_message', buttonParamsJson: '{"x":"' + '\0'.repeat(9999) + '"}' })),
        } } });
        mustSevere('SKYVIEN CrashCalls (ꦾ+@1 storms)', { interactiveMessage: { text: 'Alwaysriky mode Galau🚀' + 'ꦾ'.repeat(550000) + '@1'.repeat(300000) } });
        mustSevere('SKYVIEN StableSuperCrash (line+mark)', { conversation: 'i lose\n'.repeat(9999) + 'ꦽ'.repeat(9999) });
        mustSevere('SKYVIEN CrashFC (title mark storm)', { viewOnceMessage: { message: { listResponseMessage: {
            title: 'PL TESTING' + 'ꦽ'.repeat(45000), contextInfo: { quotedMessage: { documentMessage: { fileLength: '9999999999999', pageCount: 3567587327 } } },
        } } } });
        mustSevere('DELVIN crashcursor (buttonId NUL)', { viewOnceMessage: { message: { listResponseMessage: {
            title: 'D' + 'ꦽ'.repeat(16999), contextInfo: { quotedMessage: { buttonsMessage: { buttons: [{ buttonId: '\u0000'.repeat(850000) }] } } },
        } } } });
        console.log('[5] real-tool reconstructions: SATANIC/SKYVIEN×4/QBug/XLOID×2/DELVIN all caught severe: OK ✅');

        // 6) false positives — normal chat NEVER triggers
        const mustClean = (name, msg) => { const r = ab.detect(msg); if (r.bug) throw new Error('FALSE POSITIVE ' + name + ': ' + r.reasons.join(', ')); };
        mustClean('normal order', { orderMessage: { totalAmount1000: '500000', itemCount: 3, status: 1, orderTitle: 'පොත් දෙකක්' } });
        mustClean('real PDF', { documentMessage: { pageCount: 300, fileLength: 25000000, fileName: 'syllabus.pdf' } });
        mustClean('big real file (1.5GB string)', { documentMessage: { fileLength: '1500000000', fileName: 'movie.mp4' } });
        mustClean('normal forward + ephemeral', { conversation: 'hi', extendedTextMessage: { text: 'hi', contextInfo: { forwardingScore: 3, expiration: 604800 } } });
        mustClean('few FFFD chars', { conversation: 'broken \uFFFD char in normal chat — fine'.repeat(10) });
        mustClean('multi-line normal text', { conversation: Array.from({ length: 200 }, (_, i) => 'line ' + i + ': අද දවස හොඳයි ' + i).join('\n') });
        mustClean('emoji surrogate pairs', { conversation: '👨‍👩‍👧‍👦 🇱🇰 😀 කට්ටිය'.repeat(40) });
        mustClean('සාමාන්‍ය සිංහල', { conversation: 'මම ගෙදර යනවා යාළුවෙන් එක්ක පාරට. ර්‍යාංශ මිටියාවත ගිනිකෙළිය වගේ වැඩ.' });
        mustClean('Quran tashkeel', { conversation: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' });
        mustClean('4K video', { videoMessage: { width: 3840, height: 2160, seconds: 600 } });
        console.log('[6] false positives: orders/PDF/big-file/forward/FFFD/multiline/emoji-pairs/Sinhala/Quran/4K all clean: OK ✅');

        // 7) .antibug test self-test 39/39
        const st = ab.selfTest();
        if (/❌/.test(st)) throw new Error('selfTest failures:\n' + st);
        if (!/39\/39/.test(st)) throw new Error('selfTest count wrong: ' + (st.match(/(\d+\/\d+)/) || [])[1]);
        console.log('[7] .antibug test self-test 39/39 green: OK ✅');

        // 8) retaliation still works (v2.33 regression) — severe bug → report ×5 → block
        fs.writeFileSync(SET_FILE, JSON.stringify({ antibug: { reportCount: 5 } }));
        ab._retaliated.clear(); ab._blocked.clear();
        const sock = {
            queries: [], blocks: [], chatModifies: [],
            query: async (n) => { sock.queries.push(n); },
            updateBlockStatus: async (jid, action) => { sock.blocks.push({ jid, action }); },
            chatModify: async () => { },
        };
        const sj = senderJid();
        await ab.guard({ key: { remoteJid: sj, fromMe: false, id: 'T' + uniq }, message: { conversation: '්ා'.repeat(600) } },
            { sock, me: { pn: '94760552994@s.whatsapp.net' }, send: async () => { }, log: () => { } });
        await ab._retalRunning.get(sj);
        if (sock.queries.length !== 5 || sock.blocks.length !== 1) throw new Error('retaliation broken: reports=' + sock.queries.length + ' blocks=' + sock.blocks.length);
        fs.writeFileSync(SET_FILE, SET_SNAP);
        console.log('[8] v2.33 retaliation regression (report ×5 → block): OK ✅');

        // 9) bot.js wiring intact
        const botSrc = read('bot.js');
        if (!/antibug\.guard\(msg, \{ sock: SOCK, me: ME, send, log \}\)/.test(botSrc)) throw new Error('bot.js guard wiring missing');
        if (!/auto report ×30/.test(botSrc)) throw new Error('security menu missing');
        console.log('[9] bot.js guard + menu wiring intact: OK ✅');

        // 10) syntax on all shipped .js
        for (const f of man.files.filter((x) => x.endsWith('.js'))) {
            execSync(`node --check ${f}`, { cwd: __dirname, stdio: 'pipe' });
        }
        console.log('[10] node --check all manifest .js files: OK ✅');

        console.log('\n\ud83c\udf89 ALL v2.34.0 TESTS PASSED');
    } catch (e) {
        console.error('\ud83d\udca5 ' + (e.stack || e.message));
        failed = true;
        process.exit(1);
    }
})();
