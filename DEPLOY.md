# 🚀 KAVIZ MD V1 — DEPLOY GUIDE (සිංහල)

ඔයාගේම **full-private panel** එක — කිසිම platform expiry එකක් නෑ. Bot එකත් panel එකත් **එකම server එකේ** run වෙනවා. Access තියෙන්නේ මුරපදය දන්නා ඔයාට විතරයි.

---

## 📦 Bot + Panel එක්ක run කරන හැටි (ඕනම host එකක)

```bash
git clone https://github.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT.git
cd Arena-Ai-WA-BOT
npm install
node panel.js          # ← bot + panel දෙකම මේ එක command එකෙන්
```

- Panel එක → `http://<server-ip>:1028`
- **පළවෙනි පාරට password එක auto-generate වෙලා** console එකේ පේනවා + `settings.json` එකේ `panelPw` විදිහට save වෙනවා
- Login වුණාම bot එක auto-start වෙනවා (800ms පස්සේ)

---

## 📱 Path 1 — Termux (ඔයාගේ phone එකේ · සල්ලි නෑ · expiry නෑ)

Play Store Termux (F-Droid build එක recommended) එකේ:

```bash
pkg update -y && pkg install nodejs-lts git -y
termux-wake-lock                          # phone sleep වුණාම bot නවතින එක නවත්තනවා
git clone https://github.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT.git
cd Arena-Ai-WA-BOT
npm install
node panel.js
```

- Browser එකෙන් → `http://localhost:1028` (phone එකේම) හෝ `http://<phone-ip>:1028` (අනිත් device එකකින් — දෙකම එක WiFi එකේ තියෙනවා නම්)
- **සටහන්:** Termux app එකට battery optimization "unrestricted" දෙන්න (Settings → Battery) — නැත්තම් Android එක පැය කිහිපයකින් kill කරනවා
- Phone එක off/Internet නැති තැනක තිබ්බොත් bot එකත් offline — ඒක තමයි free වල තියෙන tradeoff එක

## 🖥️ Path 2 — VPS (Oracle Cloud Always Free / ඕනම Ubuntu server එකක)

Oracle Always Free = **සැබෑවටම free forever** (Ampere A1, card එකක් verify කරන්න විතරයි ඕනේ). Server එකට SSH වෙලා:

```bash
sudo apt update && sudo apt install -y nodejs npm git    # Node 18+
git clone https://github.com/matheeshasanjana83-alt/Arena-Ai-WA-BOT.git
cd Arena-Ai-WA-BOT && npm install
nohup node panel.js > panel.log 2>&1 &                   # හෝ systemd service එකක් හදාගන්න
```

- Oracle security list එකේ **TCP 1028 inbound** open කරන්න (VPC → Security Lists → Add Ingress Rule)
- Browser එකෙන් → `http://<server-public-ip>:1028`

## 🧩 Path 3 — Free panel platform එකක

1. අලුත් free panel එකක app එකක් හදන්න (Node.js/worker)
2. Startup command = **`node panel.js`** (පරණ `node .`/`node bot.js` එක වෙනුවට)
3. Repo එක upload/clone කරලා `npm install` run වෙලා තියෙනවා නම් done

---

## 🔐 Panel එකෙන් bot එක pair කරන හැටි (අලුත් host එකක පළවෙනි පාර)

1. **පළවෙනි පාරට WhatsApp number එක env එකෙන් දෙන්න** (panel log එකේ typing බැරි නිසා):
   ```bash
   WA_PHONE_NUMBER=94771234567 ARENA_PANEL_PW=ඔයාගේමුරපදය node panel.js
   ```
   (number එක `settings.json` එකේ save වෙනවා — ඊළඟ පාරවල්වල env එක ඕනේ නෑ)
2. Login වෙන්න → bot එක Start වෙලා `connecting` වෙනවා
3. Log එකේ `🔢 PAIRING CODE:  XXXX-XXXX` ආවම **dashboard එකේම ලොකුවට පේනවා**
4. Phone එකෙන්: **WhatsApp → Linked devices → Link a device → "Link with phone number instead"** → code එක ගහන්න
5. `🟢 WhatsApp connected` වුණාම done — `Message yourself` chat එකේ `.ping` ගහලා බලන්න

> 💡 Bot එකේම pair site එකකුත් තියෙනවා: log එකේ `🌐 Pair site: http://<host>:3000/?key=...` — ඒකෙනුත් pair කරන්න පුළුවන් (port 3000 open නම්).

## 🔑 Password වෙනස් කරන හැටි

- `settings.json` එකේ `"panelPw": "ඔයාගේ-අලුත්-මුරපදය"` දාලා panel restart කරන්න, **හෝ**
- Start කරන්න කලින් `ARENA_PANEL_PW=මුරපදය node panel.js` (env එක settings එකට වඩා ජය ගන්නවා)
- Port වෙනස් කරන්න: `ARENA_PANEL_PORT=8080 node panel.js`

## ⚠️ Security notes (full-private වෙන්න)

- Panel එක **HTTP විතරයි** (TLS නෑ) — password එක **දිග/අනුමාන කරන්න බැරි එකක්** දාන්න, URL එක කාටවත් දෙන්න එපා
- 5 න් වැඩිපුර wrong password = IP block 10 min (brute-force guard built-in)
- Login fail වුණොත් විතරක් panic වෙන්න එපා — lockout එක auto අයින් වෙනවා
- VPS එකක නම් possible නම් port 1028 ඔයාගේ IP වලට විතරක් allow කරන්න (firewall)

## 🔄 Bot update කරන හැට්ටෙන් පස්සේ

```bash
cd Arena-Ai-WA-BOT && git pull && npm install
```
Panel එකේ **🔄 Restart** ඔබන්න — done. (Bot එකේම `.update` command එකත් වැඩ — launcher auto-rollback එකත් එහෙමම වැඩ.)
