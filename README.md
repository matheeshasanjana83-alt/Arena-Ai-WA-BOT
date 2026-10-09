# 🤖 KAVIZ MD V1 — WhatsApp Bot

Private WhatsApp bot (Baileys v7) — `.ai` (Gemini / Groq), `.download`, `.yt/.video/.song`, `.tiktok`, `.fb`, `.update`.

## Commands
| Command | වැඩේ |
|---|---|
| `.ai <ප්‍රශ්නය>` | AI එකෙන් උත්තර |
| `.download <link>` | Direct / MediaFire / Google Drive / MEGA / eporner ... file එක WhatsApp එකට |
| `.setkey gemini <key>` / `.setkey groq <key>` | AI keys |
| `.net <link>` | Download fail නම් හේතුව (DNS block / IP block) |
| `.setproxy <url\|off>` | Block වෙන sites වලට proxy |
| `.proxies` | Free proxy pool status (`check` / `on` / `off`) — block වුණාම auto fallback; alive අඩු නම් free lists වලින් auto-refresh (v2.17) |
| `.keys` · `.menu` · `.ping` | |
| `.version` | දැන් version එක + update තියෙනවද |
| `.update` | මේ repo එකෙන් අලුත් version එක ගන්නවා (auth / keys වෙනස් වෙන්නේ නෑ) |
| `.tr` `.tts` `.weather` `.lyrics` `.imagine` | Translate · voice · කාලගුණය · lyrics · AI image (v2.12) |
| `.video`/`.yt` `.song` `.yts` | YouTube — all qualities (2160p→144p) + API fallback (v2.15) |
| `.tiktok` `.tt` | TikTok — watermark නැතුව (v2.15 short-link fix) |
| `.fb`/`.facebook`/`.faceboock` | Facebook video — yt-dlp + direct-scrape fallback (v2.15) |
| `.toimg` `.tourl` `.ss` `.qr` `.short` `.calc` `.github` `.del` `.setpp` | Tools (v2.12) |
| `.joke` `.fact` `.quote` `.8ball` · `.mute` `.unmute` `.tagadmins` `.resetlink` | Fun · Group (v2.12) |

> v2.12 command ideas: [Knightbot-MD](https://github.com/mruniquehacker/Knightbot-MD) by mruniquehacker (MIT) — code rewritten for KAVIZ MD V1.

## Install
- **Panel (Pterodactyl):** [`downloads/KAVIZ-MD-V1-panel.zip`](downloads/KAVIZ-MD-V1-panel.zip) upload → Unarchive → Main file `index.js` → Start → console එකේ number එක ගහලා pair කරන්න.
- **Termux:** [`downloads/KAVIZ-MD-V1.zip`](downloads/KAVIZ-MD-V1.zip) → `cd KAVIZ-MD-V1 && npm install && npm start`

## Update යවන හැටි (developer)
1. Files edit කරන්න (repo root).
2. `manifest.json` → `version` වැඩි කරන්න + `notes`; අලුත් file එකක් නම් `files` list එකට දාන්න.
3. Push → bot එකේ `.update`.
