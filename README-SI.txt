KAVIZ MD V1 (Arena AI v2.3 base) — ඔයාට විතරක් වැඩ කරන WhatsApp bot එක (AI + Downloader)
=====================================================================
Commands ("Message yourself" chat එකේ ගහන්න):
  .ai <ප්‍රශ්නය>             AI එකෙන් අහන්න (සිංහල OK). කලින් කතාව මතක තියාගන්නවා (පණිවිඩ 10ක්)
  (message එකකට reply කරලා) .ai   → ඒ message එක ගැන පැහැදිලි කරනවා / translate කරනවා
  .ai reset                  කතාව අලුතෙන් පටන් ගන්න
  .download <link>           file එක download කරලා document එකක් විදියට එවනවා (.dl / .dn)
  .setkey gemini <KEY>       Gemini free key දාන්න   (key message එක auto මැකෙනවා)
  .setkey groq <KEY>         Groq free key දාන්න
  .keys                      keys තියෙනවද බලන්න      .delkey gemini|groq  → key මකන්න
  .ping / .help

AI ගැන ඇත්ත: උත්තර දෙන්නේ Google Gemini / Groq free models (KAVIZ agent එක නෙවෙයි).
Gemini fail වුණොත් Groq එකට auto මාරු වෙනවා. Free limits ඉවර වුණොත් ටිකකින් ආයෙත් try කරන්න.

Free keys:
  Gemini → https://aistudio.google.com/apikey   (Google account → Create API key)
  Groq   → https://console.groq.com/keys        (login → Create API Key)

Download support: direct links, GitHub, Google Drive (public), MediaFire, MEGA, Dropbox, Pixeldrain,
litterbox/catbox, x0.at, transfer.archivete.am, filebin, eporner (v2.17). (gofile / LimeWire / folders support නෑ). Max 2 GB.

🔒 Private: ඔයා යවන messages විතරයි. වෙන අය commands යැව්වත් ignore.

v2.23.0 — 📺 MoviePro SERIES flow (TV series + season packs)
  • .moviepro <නම> — දැන් movies + TV series දෙකම හොයනවා (series = 📺 mark එකත් එක්ක)
  • .moviepro <අංකය> (series එකකට) — IMDb details card (📅 release · ⏱ runtime · ⭐ rating ·
    🎭 genres · 🌍 country · 📝 description) + Episodes List:
      *1* | 📦 Download Season 1 (All Episodes)
      *2* | Season 1 Episode 1  ·  date
      ... (episodes 60 බැගින් pages — .moviepro <n> next = ඊළඟ page)
  • .moviepro <අංකය> <row#> (season row එකකට) — Video Quality options (480p/720p/...) +
    සිංහල උපසිරැසි link
  • .moviepro <අංකය> <row#> <quality#> — ඒ season එකේ episodes ඔක්කොමේ DIRECT download links
    (25 බැගින් — .moviepro <n> <row#> <q#> next = ඊළඟ 25)
  • .moviepro <අංකය> <episode row#> — ඒ episode එකේ quality list
  • .moviepro <අංකය> <episode row#> <quality#> — episode FILE එකම chat එකට (maxmb guard එකත් එක්ක)
  • Source: CineSubz episode pipeline (episode page → zeta player ajax → direct mp4) —
    series එක CineSubz එකේ නැත්නම් සිංහල උපසිරැසි link එක එනවා
  • Movies flow එක වෙනස් වෙලා නෑ (movie file / link / trailer ඔක්කොම දැනට වගේ)

v2.22.0 — ✨ Flow overhaul: bot එක දැන් hand-made bot එකක් වගේ කතා කරනවා
  • ⏳ → ✅/❌ react flow — heavy command එකක් (download/movie/AI/...) ගැහුවම bot එක
    ඔයාගේ message එකට ⏳ react කරනවා, ඉවර වුණාම ✅ (fail නම් ❌). Light commands වලට ✨ random react.
  • Progress bubble auto-delete — "✅ ඉවරයි" වගේ status bubbles chat එකේ ඉතුරු වෙන්නේ නෑ:
    file එක / link එක ආවම progress bubble එක මකලා දානවා. Chat එක පිරිසිදු.
  • Captions minimal — 🎬 *title* + කොළ පාට blockquote එකේ `> ⚡ ᴋᴀᴠɪᴢ ᴍᴅ ᴠ1 · size · quality`
    විතරයි. 👤/❤️/💬/👁️ emoji-stat walls අයින්. style.js — හැම message එකක්ම එකම voice.
  • AI replies "— gemini" model නම පෙන්නන්නේ නෑ → `> ⚡ ᴋᴀᴠɪᴢ ᴀɪ`.
  • .ping දැන් ms latency එකත් පෙන්නනවා (🏓 *Pong!* 42 ms).
  • .menu + categories compact ✦ style — ලොකු පැහැදිලි කිරීම් පාරාග්‍රීන් අයින්, one-line commands.
  • Errors කෙටියි — හේතුව එක පේළියක් + ඕනේ නම් විතරක් hint එකක් (details console log වල).

v2.20.0 — 🚫 Anti-spam + block toolkit
  • .block <නම්බර්|reply> — spammer කෙනෙක් block (server-side — ඒ number එකෙන්
    ආයෙ messages/calls ඔයාට එන්නෙම නෑ). 076... / +94-76-... / 9476... format ඔක්කොම OK.
  • .unblock <නම්බර්|reply>  •  .blocklist — block කරපු ලැයිස්තුව
  • .antispam on|off|<N> — DM flood guard: මිනිත්තුවකට N (default 10) ට වැඩියෙන්
    messages එවන කෙනෙක් → auto block + blocklist + spamlog + ඔයාට notice එකක්.
    (පරණ history-sync messages ගණන් ගන්නෙ නෑ — false block නෑ; group/status skip)
  • .spamlog — අලුත්ම auto/manual block සිදුවීම් 15
  • ℹ️ Report flood එකක් නෑ: WhatsApp report කරන එකම පාර phone එකේ Report button එක
    (එක number එකකින් bot reports යැව්වොත් ඔයාගෙම number එක ban වෙනවා — block එක තමයි
    spammer ලාට safe + ස්ථිර විසඳුම). antispam.json — .update වලින් මෙන්නෙ නෑ.
  • test_v220.js — 12 offline checks (flood/unblock/reply-block/history-guard...)

v2.21.0 — 🔗 Mirror relay: file → direct share link (අනිත් bots වල /dl link UX එක)
  • .mirror <link> (.link) — link එකේ file එක download කරලා browser එකෙන් උනේන
    direct download link එකක් විදිහට යවනවා (video/file share වලට — status/grp).
  • .tourl FIX — පරණ catbox host එක වැඩ කරන්නේ නෑ; දැන් qu.ax (දින 30) →
    transfer.archivete.am (දින 7) fallback. Photo/video/audio/file reply → .tourl.
  • .moviepro <අංකය> <quality#> link — movie එක WhatsApp file එකක් වෙනුවට direct link
    එකක් විදිහට (500 status viewers ලාට share කරන්න ලේසි).
  • mirror.js — upload chain: qu.ax (දින 30, ~950MB) → transfer (big files stream).
    Proxy-pool fallback එකත් වැඩ (net.js smartFetch).
  • ⚠️ Public links — sensitive/personal files .mirror/.tourl කරන්න එපා.

v2.19.0 — 🍿 .moviepro — movie FILE එකම chat එකට (trailer නෙවෙයි!)
  • .moviepro <අංකය> — info card එකට CineSubz quality list එකත් එනවා
    (WEB-DL 480p / 720p / 1080p + size — cinesubz.net එකෙන් auto)
  • .moviepro <අංකය> <quality#> (උදා: .moviepro 1 1) — movie file එකම
    download කරලා document එකක් විදිහට chat එකට එනවා:
    CineSubz zt-links gate decode → real CDN link (drive.csplayer2.space) →
    live-check → download engine (stream, proxy pool fallback) → WhatsApp
  • File එක server එකෙන් අයින් නම් / CDN එක player protection දැම්මොත් —
    clean fallback: direct CDN link + CineSubz telegram link + gate link
  • limit එකට වඩා ලොකු files (2GB+) — link එකම එනවා (.maxmb වෙනස් කරන්න පුළුවන්)
  • .moviepro <අංකය> trailer — trailer option එකත් තියෙනවා (v2.18 විදිහටම)
  • test_v219.js — 12 offline checks (gate decode/mapping/size/tg/card)

v2.18.0 — 🎥 .moviepro (movies — in-chat interactive flow)
  • .moviepro <movie නම> — IMDb (Cinemeta — free, key ඕනේ නෑ) search → results 8 දක්වා
  • .moviepro <අංකය> — poster + ⭐rating + genres + description + IMDb link +
    🇱🇰 සිංහල උපසිරැසි link (sinhalasub.lk) + download page (cinesubz.net)
  • .moviepro <අංකය> trailer — trailer එක video විදිහට යවනවා (yt-dlp → clipto → pool)
  • List එකට අංකය විතරක් reply කළත් වැඩ (.menu වගේම)
  • අනිත් bots වල .moviepro වගේ නෙවෙයි (banner/webhook) — සම්පූර්ණ in-chat flow එකක්

v2.17.0 — 🎬 eporner downloads + pool auto-refresh
  • .download — eporner.com දැන් support: direct /dload/...mp4 links + video page links
    (page links yt-dlp හරහා, formats + quality auto). CDN block වුණොත් pool route එකෙන් යනවා.
  • Pool auto-refresh: alive proxies 8 ට අඩු වුණාම free proxy lists (monosans / TheSpeedX /
    proxyscrape / roosterkid) වලින් අලුත් proxies auto ගෙනියනවා — pool එක හිස් වෙන්නේ නෑ.
    (runtime pool එකට විතරයි — proxies.txt file එක වෙනස් වෙන්නේ නෑ; cache: proxies.cache.json)
  • smartFetch: direct/DoH/IPv6 ඔක්කොම connect-fail වුණාම pool එක හිස් නම් තත්පර 20 ක් ඇතුළට
    fresh fetch + check කරලා pool එකෙන්ම try කරනවා (first blocked download එකේදීත් pool එක ලැබෙනවා).
  • .proxies — auto-fetched count එකත් පෙන්නනවා.

v2.16.0 — 🧩 Free Proxy Pool (IP block වුණාම auto fallback)
  • proxies.txt (434 proxies) bot එකේම එනවා. Start වෙද්දී background check එකකින් "වැඩ කරන" ඒවා හොයාගන්නවා
    (results cache වෙනවා, විනාඩි 20 කට සැරයක් refresh).
  • Direct / DNS bypass / IPv6 / ඔයාගේ .setproxy එකෙන් බැරි වුණොත් විතරයි pool එකෙන් try කරන්නේ —
    ඒ නිසා සාමාන්‍ය downloads වලට කිසිම බාධාවක් නෑ. YouTube bot-check / FB / TikTok block වලටත් yt-dlp
    හරහාම pool proxies පාවිච්චි වෙනවා.
  • .proxies — pool status  •  .proxies check — දැන්ම check  •  .proxies on / off
  • ඔයාගේම proxies: bot folder එකේ proxies.user.txt (ip:port lines) — .update වෙද්දී මැකෙන්නේ නෑ.
  💡 Free proxies ගොඩක් ඉක්මනට මැරෙනවා — හොඳම විසඳුම .setcookies (YouTube) + ඔයාගේම proxy එකක් (.setproxy).

v2.15.0 — KAVIZ MD V1 rebrand + downloader fixes
  • .yt / .video — ALL qualities (2160p → 144p; quality නැතුව = best) + clipto.com fallback (YouTube bot-check)
  • .fb / .facebook / .faceboock / .fbvid — FB page-scrape fallback  •  .tiktok — vm/vt short links + retries
  • yt-dlp bot start වෙද්දීම auto-update (stale extractor = FB "Cannot parse data" fix)

v2.13.1 — 🧬 Anti-Bug Instituts visthara (status + contacts + invisible bugs)
  • Status (status@broadcast) + newsletters tik scan kellayi: bug ekak → delete for me + report (block karanne na)
  • Contact card bombs: vCard ekak TEL 20+ / lines 200+ → catch
  • Pure invisible messages ( productive text eka) + long unbroken runs (8000+) → catch
  • Variation selectors ( productive chars flood) → catch
  • *.antibug scan* — sudden caught bugs list eka balanna

v2.13.0 — 🧬 Anti-Bug (WhatsApp bug / crash messages වලින් ආරක්ෂාව)
  කවුරු හරි WhatsApp එක hang/crash කරන "bug" message එකක් එව්වොත් bot එක:
   1. ඒ message එක ඔයාට delete කරනවා → phone එකටත් sync වෙනවා, chat එක ආයෙත් open කරන්න පුළුවන්
   2. group එකක නම් + bot (ඔයා) admin නම් → හැමෝටම delete
   3. private chat එකක ලොකු bug එකක් නම් → එව්ව කෙනාව block   (.antibug block off = block එපා)
   4. Message yourself chat එකට කෙටි report එකක් (bug text එක නැතුව)
  අල්ලන දේවල්: crash අකුරු (virtex), අකුරු 12k+ texts, mentions 256+, contacts 40+, buttons/poll options 60+,
               අති විශාල fields (location / buttons / lists), nesting 14+, තත්පර 10ට messages 25+ (flood)
  Commands: .antibug  •  .antibug on / off  •  .antibug block on / off   (default: ON)
  ⚠️ Bug message එක phone එකටත් එකම වෙලාවේ එන නිසා ඒ chat එක screen එකේ open නම් තත්පරයක් දෙකක් hang වෙන්න පුළුවන්.
     අලුත්ම වර්ගයක bug එකක් අල්ලගන්න බැරි වෙන්නත් පුළුවන් — එහෙම වුණොත් screenshot එකක් එවන්න.

v2.12.2 — 🔒 ආරක්ෂාව + 📨 Agent messages
  • WhatsApp library එක (libsignal) encryption keys panel console එකට print කළා → දැන් ඒවා පේන්නේ නෑ
  • KAVIZ agent ට panel එකේ agent-msg.txt file එකක් ලියලා ඔයාගේ "Message yourself" chat එකට message යවන්න පුළුවන්
    (bot එක තත්පර 5 කට සැරයක් බලනවා, යැව්වට පස්සේ file එක මකනවා)

v2.12.1 — 📦 ලොකු files (2 GB දක්වා)
  • Panel එකේ පරණ 350 MB limit එක අයින් කළා → දැන් 2000 MB (WhatsApp එකෙන් යවන්න පුළුවන් උපරිමය ≈ 2 GB)
  • 100 MB ට ලොකු files disk එකේ save නොකර කෙලින්ම WhatsApp එකට stream වෙනවා → disk එක 2× නෙවෙයි 1× විතරයි
  • .maxmb  → දැන් limit එක + disk free     .maxmb 1000 / .maxmb 2gb → වෙනස් කරන්න (max 2000)
  • Disk එකේ ඉඩ මදි නම් download එක පටන් ගන්න කලින්ම පැහැදිලි error එකක්
  ⚠️ 2 GB ට ලොකු (6 GB වගේ) files WhatsApp එකෙන් යවන්න බෑ — ඒක WhatsApp limit එකක්

v2.12 — 🛠️ TOOLS update (Knightbot-MD bot එකේ ideas, අපේම code එකෙන් ස්ථාවර free APIs වලින්)
  🌐 .tr <භාෂාව> <text>  → translate (message එකකට reply කරලා .tr si) — si en ta hi ja ko ...
  🗣️ .tts <text>  → voice note (සිංහල auto)      🌍 .weather <නගරය>  → කාලගුණය + දින 3
  🎤 .lyrics <සින්දුව>      🎨 .imagine <විස්තරය>  → AI image (සිංහලෙනුත් ලියන්න පුළුවන්)
  🖼️ .toimg (sticker reply) → photo      🔗 .tourl (media reply) → download link
  📸 .ss <website>  •  🔳 .qr <text>  •  ✂️ .short <link>  •  🧮 .calc (25+15)*3 / 15% of 2000
  🐙 .github <user>  •  🗑️ .del (reply → message එක මකනවා, ඕනෑම chat එකක)  •  .setpp (photo → profile)
  🎉 .joke  •  .fact (+සිංහල)  •  .quote  •  .8ball <ප්‍රශ්නය>
  👥 Group: .mute  .unmute  .tagadmins  .resetlink
  Menu: categories 13 (6 = Tools, 7 = Fun)
  Credit: command ideas — Knightbot-MD by mruniquehacker (MIT). Code එක අලුතෙන් ලිව්වේ.

v2.11 — 🚀 SUPER update (abc repo එකේ SmokeBoy bot එකෙන් ගත්ත features)
  🎬 .yts <නම>  •  .song <නම/link> (audio)  •  .video <නම/link> (720p→360p)
  📱 .tiktok (watermark නෑ)  •  .fb  •  .ig  •  .x   <link>
  🔍 .wiki <මාතෘකාව>  (.wiki si ... = සිංහල)   🐙 .gitclone user/repo → zip
  🖼️ .s = photo/video → sticker (video තත්පර 6)  •  .take Pack | Author
  👥 Group (ඔයා group එකේ ගැහුවොත්): .groupinfo .grouplink .tagall .kick .promote .demote .jid
  🔄 .restart
  • Panel: පළමු .song/.video/.s එකේදී yt-dlp (40MB) + ffmpeg (80MB) auto download වෙනවා (විනාඩියක් විතර).
  • Termux: pkg install yt-dlp ffmpeg   (termux-setup.sh එක දැන් ඒකත් කරනවා)
  • YouTube සමහර server IPs වලට "bot check" දානවා — එහෙම වුණොත් bot එක පැහැදිලිව කියනවා.

v2.10 — 📋 ලස්සන .menu + ✨ auto react
  • .menu — photo + BOT INFO box (version, uptime, RAM, host) + categories 6.
    Number එක reply කරන්න (උදා 1 = Download) → ඒ category එකේ commands.  .help = full list.
  • Commands ගහද්දී random emoji react එකක් (⚡🔥✨🚀...).  .react off / .react on

v2.9 — 🖼️ ලස්සන online card එක (photo + කෙටි status)
  • Bot start වුණාම / .update එකෙන් පස්සේ photo එකක් එක්ක පොඩි card එකක් එනවා.  .alive = ඕනෑම වෙලාවක බලන්න.
  • .setlogo — ඔයාගේ photo එක Message yourself chat එකට යවලා ඒකට reply කරලා .setlogo ගහන්න (update වලින් මැකෙන්නේ නෑ).
  • .dellogo — default KAVIZ MD V1 banner එකට ආපහු.

v2.8 — 🔒 සම්පූර්ණ Safe mode + 🛡️ Anti-ban
  • Commands පාවිච්චි කරන්න පුළුවන් ඔයාට විතරයි (fromMe + sender double check). වෙන කෙනෙක් ගැහුවොත් reply එකක්වත් නෑ.
  • Default: "Message yourself" chat එකේ විතරයි වැඩ.  .mode all = ඔයා ඕනෑම chat එකක ගහන commands වැඩ.
  • Anti-ban: විනාඩියට commands 10 / පැයට 120 limit, reply කලින් පොඩි human delay, messages එකින් එක යවනවා,
    reconnect backoff (3s→5min), ban (403) වුණොත් / වෙන තැනක එකම bot එක run වුණොත් (440) නවතිනවා,
    "online" message පැය 6 කට එක පාරයි, download එකකට links 5 යි, එක පාරට download එකයි.
  • API keys / proxy password console log එකේ පේන්නේ නෑ. Panel status page එකේ number එක පේන්නේ නෑ.
  ⚠️ කිසිම bot එකක් 100% ban-proof නෑ — spam නොකර, එක instance එකක් විතරක් run කරන්න.

v2.7 — IPv6 route: CDN එකක් server එකේ IPv4 block කළොත් මුළු download chain එකම IPv6 එකෙන් ආයෙත් try කරනවා
  (server එකට IPv6 තියෙනවා නම්). .net එකේ Server IPv6 + hop එකට IPv6 TCP test පෙන්නනවා.

v2.6 — Block වෙන sites fix:
  • Download එකක් network error එකකින් fail වුණොත් bot එක ඉබේම DNS-over-HTTPS (1.1.1.1/8.8.8.8) එකෙන් ආයෙත් try කරනවා
    (server එකේ ISP/රට DNS block කරනවා නම් ඒක පනිනවා). වැඩ කරපු route එක මතක තියාගන්නවා.
  • .net <link> — server එකෙන් ඒ site එකට යන්න පුළුවන්ද, DNS block ද IP block ද කියලා report එකක්.
  • .setproxy http://user:pass@host:port — IP block වෙන sites වලට proxy (off: .setproxy off).

v2.5 — Updates දැන් එන්නේ අලුත් repo එකෙන්: https://github.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT
  (.update / .version ඒ විදියටම. Panel එකේත් වැඩ — launcher එක bot එක auto restart කරනවා.)

v2.4 — Server/panel (HeavenCloud) support:
  index.js = panel entry (npm start එකමයි). Panel එකේ temp files server disk එකේ (.tmp), file limit 350MB.
  Phone number එක settings.json එකේ "phone" විදියටත් දාන්න පුළුවන්. Panel zip: KAVIZ-MD-V1-panel.zip (files root එකේ).

v2.3 fix: bot එකේ replies phone එකේ "Waiting for this message" කියලා පෙන්නපු එක.
  Baileys v7 self-chat messages වලට device/LID jid එකක් (35189...:0@lid) දෙනවා; ඒකට reply කළාම phone එකට decrypt
  කරන්න බෑ. දැන් self-chat replies හැම වෙලාවෙම ඔයාගේ phone-number JID (94...@s.whatsapp.net) එකට යනවා.

v2.2 — .update command:
  .update          GitHub (matheeshasanjana83-alt/abc → arena-ai-bot/) එකෙන් අලුත් files අරන් auto restart.
                   auth/ (WhatsApp link) + settings.json (API keys) කවදාවත් වෙනස් කරන්නේ නෑ → pair කරන්න ඕනේ නෑ.
  .update force    එකම version එක ආයෙත් install කරන්න
  .version         දැන් version එක + update තියෙනවද
  • අලුත් files වල error එකක් තිබ්බොත් install කරන්නේම නෑ. Install වුණාට පස්සේ crash වුණොත් පරණ version එකට auto rollback.
  • Auto restart වෙන්න bot එක *npm start* එකෙන් start කරන්න ඕනේ (launcher.js).

v2.1 fix (commands වැඩ නොකළ ප්‍රශ්නය):
  • Baileys 6.7 (legacy) → 7.0.0-rc14. WhatsApp LID ක්‍රමයට මාරු වුණු නිසා 6.7 ට ඔයාගේ phone එකෙන් එන
    messages decrypt කරන්න බැරි වුණා ("Bad MAC") → commands bot එකට පේන්නේ නෑ. v7 එකේ LID support තියෙනවා.
    (6.7 delivery ACKs යවනවා — WhatsApp ban කරනවා කියලා Baileys docs කියනවා; v7 යවන්නේ නෑ)
  • 'append' type messages ද process කරනවා, getMessage retry fix ("Waiting for this message"), online msg එක එක පාරයි.
  • 6.7 session එක v7 එකට පාවිච්චි කරන්න එපා → auth folder එක මකලා අලුතෙන් pair කරන්න.

Update (පරණ version එකෙන්):
  WhatsApp → Linked devices → පරණ bot device එක Log out කරන්න
  cd ~ && curl -L -o KAVIZ-MD-V1.zip https://raw.githubusercontent.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT/main/downloads/KAVIZ-MD-V1.zip && unzip -o KAVIZ-MD-V1.zip
  cd ~/KAVIZ-MD-V1 && rm -rf auth node_modules package-lock.json && npm install --legacy-peer-deps && npm start

Termux setup:
  pkg install -y curl unzip
  cd ~ && curl -L -o KAVIZ-MD-V1.zip https://raw.githubusercontent.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT/main/downloads/KAVIZ-MD-V1.zip && unzip -o KAVIZ-MD-V1.zip
  cd ~/KAVIZ-MD-V1 && bash termux-setup.sh
  termux-wake-lock
  npm start
ආයෙත් start:  cd ~/KAVIZ-MD-V1 && termux-wake-lock && npm start
Re-pair:       cd ~/KAVIZ-MD-V1 && rm -rf auth && npm start
Test:          npm test
