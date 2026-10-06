# 🤖 Arena AI — WhatsApp Bot

Private WhatsApp bot (Baileys v7) — `.ai` (Gemini / Groq), `.download`, `.update`.

## Commands
| Command | වැඩේ |
|---|---|
| `.ai <ප්‍රශ්නය>` | AI එකෙන් උත්තර |
| `.download <link>` | Direct / MediaFire / Google Drive / MEGA ... file එක WhatsApp එකට |
| `.setkey gemini <key>` / `.setkey groq <key>` | AI keys |
| `.net <link>` | Download fail නම් හේතුව (DNS block / IP block) |
| `.setproxy <url\|off>` | Block වෙන sites වලට proxy |
| `.keys` · `.menu` · `.ping` | |
| `.version` | දැන් version එක + update තියෙනවද |
| `.update` | මේ repo එකෙන් අලුත් version එක ගන්නවා (auth / keys වෙනස් වෙන්නේ නෑ) |

## Install
- **Panel (Pterodactyl):** [`downloads/Arena-AI-panel.zip`](downloads/Arena-AI-panel.zip) upload → Unarchive → Main file `index.js` → Start → console එකේ number එක ගහලා pair කරන්න.
- **Termux:** [`downloads/Arena-AI.zip`](downloads/Arena-AI.zip) → `cd Arena-AI && npm install && npm start`

## Update යවන හැටි (developer)
1. Files edit කරන්න (repo root).
2. `manifest.json` → `version` වැඩි කරන්න + `notes`; අලුත් file එකක් නම් `files` list එකට දාන්න.
3. Push → bot එකේ `.update`.
