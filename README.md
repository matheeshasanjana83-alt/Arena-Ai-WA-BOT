# 🤖 KAVIZ MD V1 — WhatsApp Bot

Private WhatsApp bot (Baileys v7) — `.ai` (Gemini / Groq), `.moviedex` (movies + TV series files), `.download`, `.yt/.video/.song`, `.tiktok`, `.fb`, `.update`.

## Commands
| Command | වැඩේ |
|---|---|
| `.moviedex <නම>` (`.mdx`) | **Movie + 📺 TV series download** — search → info card (rating/genres/desc + poster) → quality (1080p/720p/480p + sizes) → movie **file** · series **FULL menu** (all seasons + episodes in one message) → season pack (episodes එකින් එක files, 50/run + `next`) · 🧳 **12-ep packs** (24+ ep seasons): series card rows `1.1 = EP1-12`, `1.2 = EP13-24` … → pack reply → quality → files (v2.39 — v2.38 range command අයින්) · 🧳 **12-ep packs** (24+ ep seasons): series card rows `1.1 = EP1-12`, `1.2 = EP13-24` … → pack reply → quality → files (v2.39 — v2.38 range command අයින්) · episode file · `link` suffix → 🔗 share link. අංකය reply කරන්න විතරයි (v2.28: අන්තිම cards 8ම routing — series card එකටත් පස්සේ reply වැඩ). ffmpeg ඕනේ (panel auto-download · Termux: `pkg install ffmpeg`) |
| `.ai <ප්‍රශ්නය>` | AI එකෙන් උත්තර |
| `.download <link>` | Direct / MediaFire / Google Drive / MEGA / eporner ... file එක WhatsApp එකට |
| `.setting` | ⚙️ BOT SETTINGS PANEL — 🍀 status rows + options 1-9 (අංකය reply → toggle → panel refresh) |
| `.setkey gemini/groq/zai <key>` | AI keys (zai = Z.ai GLM — alias z.ai/glm) |
| `.net <link>` | Download fail නම් හේතුව (DNS block / IP block) |
| `.setproxy <url\|off>` | Block වෙන sites වලට proxy |
| `.proxies` | Free proxy pool status (`check` / `on` / `off`) — block වුණාම auto fallback; alive අඩු නම් free lists වලින් auto-refresh (v2.17) |
| `.block <නම්බර්\|reply>` | Spammer block (server-side — ඒ number එකෙන් ආයෙ messages එන්නෙම නෑ) · `.unblock` · `.blocklist` · `.spamlog` (v2.20) |
| `.antispam on\|off\|<N>` | DM flood guard — මිනිත්තුවකට N (default 10) ට වැඩි messages → auto block + notice (v2.20) |
| `.mirror <link>` | URL → download → **direct share link** (qu.ax දින 30 → transfer දින 7) — අනිත් bots වල `/dl` link UX එක · `.link` alias · `.tourl` fixed (v2.21) |
| 🌐 *Pair site (v2.29)* | bot port එකේම web page — number එක දාලා pairing code එක site එකෙන් ගන්න (key-protected, registered session block, 10s rate-limit) |
| *UX flow (v2.22)* | heavy commands react **⏳ → ✅/❌**, progress bubbles auto-delete, captions = title + `> ⚡ ᴋᴀᴠɪᴢ ᴍᴅ ᴠ1` footer, compact ✦ menu, `.ping` ms, AI replies brand-signed (model name hidden) |
| `.keys` · `.menu` · `.ping` | |
| `.version` | දැන් version එක + update තියෙනවද |
| `.update` | මේ repo එකෙන් අලුත් version එක ගන්නවා (auth / keys වෙනස් වෙන්නේ නෑ) |
| `.tr` `.tts` `.weather` `.lyrics` `.imagine` | Translate · voice · කාලගුණය · lyrics · AI image (v2.12) |
| `.video`/`.yt` `.song` `.yts` | YouTube — all qualities (2160p→144p) + API fallback (v2.15) |
| `.tiktok` `.tt` | TikTok — watermark නැතුව (v2.15 short-link fix) |
| `.fb`/`.facebook`/`.faceboock` | Facebook video — yt-dlp + direct-scrape fallback (v2.15) |
| `.toimg` `.tourl` `.mirror` `.ss` `.qr` `.short` `.calc` `.github` `.del` `.setpp` | Tools (v2.12 · .mirror v2.21) |
| `.joke` `.fact` `.quote` `.8ball` · `.mute` `.unmute` `.tagadmins` `.resetlink` | Fun · Group (v2.12) |

> v2.12 command ideas: [Knightbot-MD](https://github.com/mruniquehacker/Knightbot-MD) by mruniquehacker (MIT) — code rewritten for KAVIZ MD V1.

## Install
- **Panel (Pterodactyl):** [`downloads/KAVIZ-MD-V1-panel.zip`](downloads/KAVIZ-MD-V1-panel.zip) upload → Unarchive → Main file `index.js` → Start → console එකේ print වෙන **Pair site URL** එක browser එකෙන් open කරලා number එක දාලා pair කරන්න (v2.29: `http://<panel-host>:<port>/?key=XXXX` — code එක site එකේම පේනවා). Console එකේ ගහන එකත් වැඩ.
- **Termux:** [`downloads/KAVIZ-MD-V1.zip`](downloads/KAVIZ-MD-V1.zip) → `cd KAVIZ-MD-V1 && npm install && npm start` (pair site: `http://localhost:3000/?key=…` — console එකේ print වෙනවා)

## Update යවන හැටි (developer)
1. Files edit කරන්න (repo root).
2. `manifest.json` → `version` වැඩි කරන්න + `notes`; අලුත් file එකක් නම් `files` list එකට දාන්න.
3. Push → bot එකේ `.update`.
