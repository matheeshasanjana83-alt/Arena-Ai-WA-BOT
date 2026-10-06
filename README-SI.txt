Arena AI v2.3 — ඔයාට විතරක් වැඩ කරන WhatsApp bot එක (AI + Downloader)
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

AI ගැන ඇත්ත: උත්තර දෙන්නේ Google Gemini / Groq free models (Arena.ai agent එක නෙවෙයි).
Gemini fail වුණොත් Groq එකට auto මාරු වෙනවා. Free limits ඉවර වුණොත් ටිකකින් ආයෙත් try කරන්න.

Free keys:
  Gemini → https://aistudio.google.com/apikey   (Google account → Create API key)
  Groq   → https://console.groq.com/keys        (login → Create API Key)

Download support: direct links, GitHub, Google Drive (public), MediaFire, MEGA, Dropbox, Pixeldrain,
litterbox/catbox, x0.at, transfer.archivete.am, filebin. (gofile / LimeWire / folders support නෑ). Max 2 GB.

🔒 Private: ඔයා යවන messages විතරයි. වෙන අය commands යැව්වත් ignore.

v2.5 — Updates දැන් එන්නේ අලුත් repo එකෙන්: https://github.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT
  (.update / .version ඒ විදියටම. Panel එකේත් වැඩ — launcher එක bot එක auto restart කරනවා.)

v2.4 — Server/panel (HeavenCloud) support:
  index.js = panel entry (npm start එකමයි). Panel එකේ temp files server disk එකේ (.tmp), file limit 350MB.
  Phone number එක settings.json එකේ "phone" විදියටත් දාන්න පුළුවන්. Panel zip: Arena-AI-panel.zip (files root එකේ).

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
  cd ~ && curl -L -o Arena-AI.zip https://raw.githubusercontent.com/matheeshasanjana83-alt/abc/main/downloads/Arena-AI.zip && unzip -o Arena-AI.zip
  cd ~/Arena-AI && rm -rf auth node_modules package-lock.json && npm install --legacy-peer-deps && npm start

Termux setup:
  pkg install -y curl unzip
  cd ~ && curl -L -o Arena-AI.zip https://raw.githubusercontent.com/matheeshasanjana83-alt/abc/main/downloads/Arena-AI.zip && unzip -o Arena-AI.zip
  cd ~/Arena-AI && bash termux-setup.sh
  termux-wake-lock
  npm start
ආයෙත් start:  cd ~/Arena-AI && termux-wake-lock && npm start
Re-pair:       cd ~/Arena-AI && rm -rf auth && npm start
Test:          npm test
