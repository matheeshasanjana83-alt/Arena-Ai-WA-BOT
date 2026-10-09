/**
 * style.js — KAVIZ MD V1 v2.22 message style (single source of truth)
 * Every caption / list / status that leaves the bot flows through here,
 * so the whole bot speaks with one hand-made voice — not a generated one.
 *
 *   ⏳ react while working  →  ✅ / ❌ when done   (bot.js HEAVY commands)
 *   progress bubbles self-delete when finished — no "✅ done" residue
 *   captions = one title line + a gray blockquote footer, nothing more
 */
const BRAND = 'ᴋᴀᴠɪᴢ ᴍᴅ ᴠ1';

/** gray blockquote footer — extra is a short note (size, days, warning…) */
const foot = (extra) => `> ⚡ ${BRAND}${extra ? '  ·  ' + extra : ''}`;

/** download progress bar */
const bar = (pct, n = 12) => {
    const on = Math.max(0, Math.min(n, Math.round((pct || 0) / 100 * n)));
    return '▰'.repeat(on) + '▱'.repeat(n - on);
};

/** safe text cut */
const cut = (s, n) => String(s || '').trim().slice(0, n);

/** one-line usage hint */
const use = (line, example) => `${line}${example ? '\n   ' + example : ''}`;

module.exports = { BRAND, foot, bar, cut, use };
