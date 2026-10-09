'use strict';
/**
 * movies.js — .moviepro for KAVIZ MD V1 (v2.18)
 *
 *  වෙනම flow (other bots' .moviepro = static banner / webhook relay — this one is fully in-chat):
 *    .moviepro <නම>            → Cinemeta (Stremio, free/no-key) search → numbered list
 *    .moviepro <අංකය>          → info card: poster + IMDb + genres + description
 *                                 + 🇱🇰 සිංහල උපසිරැසි link (sinhalasub.lk) + download page (cinesubz.net)
 *    .moviepro <අංකය> trailer  → trailer video via the bot's yt pipeline (yt-dlp → clipto → pool)
 *    bare number reply         → picks from the last list (like the .menu numbers)
 *
 *  Poster fails → auto text-only fallback. Sessions cached per chat (15 min).
 */
const fs = require('fs');
const { smartFetch } = require('./net');

const API = 'https://v3-cinemeta.strem.io/catalog/movie/top/search=';
const SESSION_TTL = 15 * 60e3;
const sessions = new Map();   // jid → { list, at }

const enc = (s) => encodeURIComponent(String(s || '').trim()).replace(/%20/g, '+');

async function fetchJson(url, ms = 25000) {
    const r = await smartFetch(url, { headers: { 'User-Agent': 'kaviz-md-bot', Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) { try { await r.body?.cancel(); } catch { } throw new Error('HTTP ' + r.status); }
    return r.json();
}

/** Cinemeta search → top n movie metas (one retry on flaky cold-start) */
async function search(q, n = 8) {
    let lastE;
    for (let i = 0; i < 2; i++) {
        try { const j = await fetchJson(API + enc(q) + '.json'); return (j.metas || []).slice(0, n); }
        catch (e) { lastE = e; if (!/timeout|EAI|ENOTFOUND|reset/i.test(String(e.message))) break; }
    }
    throw lastE;
}

const yearOf = (m) => String(m.releaseInfo || '').split('–')[0].slice(0, 4);
const subsUrl = (m) => 'https://sinhalasub.lk/?s=' + enc(`${m.name} ${yearOf(m)}`);
const dlUrl = (m) => 'https://cinesubz.net/?s=' + enc(m.name);
const ytLink = (m) => { const yt = (m.trailerStreams || [])[0]?.ytId; return yt ? 'https://youtu.be/' + yt : null; };

function listText(q, list) {
    return `🎬 *MoviePro — "${q}"*\n\n` + list.map((m, i) =>
        `*${i + 1}.* ${m.name}${m.releaseInfo ? ' (' + m.releaseInfo + ')' : ''}${m.imdbRating ? '  ⭐' + m.imdbRating : ''}`).join('\n')
        + `\n\n➡️ අභිමතය තෝරන්න: *.moviepro <අංකය>*  (උදා: *.moviepro 1*)\n🎥 Trailer video එකට: *.moviepro <අංකය> trailer*\n(අංකය විතරක් reply කළත් වැඩ)`;
}

function cardText(m, n) {
    const cast = (m.cast || []).slice(0, 3).join(', ');
    const desc = String(m.description || '').trim().slice(0, 380) || '—';
    return [
        `🎬 *${m.name}*${m.releaseInfo ? ` (${m.releaseInfo})` : ''}`,
        `⭐ ${m.imdbRating || '—'}/10 IMDb${m.runtime ? '  •  ⏱ ' + m.runtime : ''}`,
        m.genres?.length ? `🎭 ${m.genres.slice(0, 4).join(', ')}` : '',
        cast ? `👥 ${cast}` : '',
        '',
        `📝 ${desc}`,
        '',
        ytLink(m) ? `▶️ Trailer: ${ytLink(m)}` : '',
        m.imdb_id ? `🌐 IMDb: https://www.imdb.com/title/${m.imdb_id}/` : '',
        `🇱🇰 සිංහල උපසිරැසි: ${subsUrl(m)}`,
        `⬇️ Download page: ${dlUrl(m)}`,
        '',
        `🎥 Trailer එක *video* විදිහට ගන්න: *.moviepro ${n} trailer*`,
        `💡 උඩ site එකෙන් direct file link එකක් ගත්තොත් *.download <link>* වලින් bot එකෙන්ම download කරන්න පුළුවන්`,
    ].filter(Boolean).join('\n');
}

async function sendCard(send, jid, msg, m, n) {
    const text = cardText(m, n);
    try {
        if (!m.poster) throw new Error('no poster');
        await send(jid, { image: { url: m.poster }, caption: text.slice(0, 900) }, { quoted: msg });
    } catch {
        await send(jid, { text }, { quoted: msg });   // poster fail → text only
    }
}

/** trailer video via features.ytCommand (yt-dlp → clipto fallback → cookies/pool) */
async function trailerCmd(send, jid, msg, m) {
    const yt = ytLink(m);
    if (!yt) return send(jid, { text: '😢 මේ movie එකට trailer link එකක් හම්බුණේ නෑ' }, { quoted: msg });
    await require('./features').ytCommand(send, jid, msg, yt + ' 720', 'video', `Trailer — ${m.name}`);
}

const hasSession = (jid) => { const s = sessions.get(jid); return !!(s && Date.now() - s.at < SESSION_TTL && s.list?.length); };

async function handle(c, ctx) {
    if (c !== '.moviepro' && c !== '.mvpro' && c !== '.movie') return false;
    const { send, jid, msg, rest } = ctx;
    const arg = rest.join(' ').trim();
    const pick = arg.match(/^(\d{1,2})(?:\s+(trailer|t))?$/i);

    if (pick) {
        const s = sessions.get(jid);
        if (!hasSession(jid)) return send(jid, { text: '⏳ Search session එක expire වෙලා — මුලින්ම *.moviepro <movie නම>* ගහන්න' }, { quoted: msg });
        const n = +pick[1], m = s.list[n - 1];
        if (!m) return send(jid, { text: `❌ ${n} කියලා result එකක් නෑ (1-${s.list.length})` }, { quoted: msg });
        if (pick[2]) await trailerCmd(send, jid, msg, m);
        else await sendCard(send, jid, msg, m, n);
        return true;
    }

    if (!arg) {
        return send(jid, {
            text: `🎬 *MoviePro* — movie search + info\n\n*.moviepro <movie නම>* — search\n   උදා: *.moviepro avatar way of water*\n*.moviepro <අංකය>* — details card (poster, IMDb, සිංහල උපසිරැසි link)\n*.moviepro <අංකය> trailer* — trailer එක video විදිහට යවනවා`,
        }, { quoted: msg });
    }

    const st = await send(jid, { text: `🔎 "${arg}" හොයනවා...` }, { quoted: msg });
    const edit = async (t) => { try { await send(jid, { text: t, edit: st.key }); } catch { } };
    try {
        const list = await search(arg);
        if (!list.length) return edit(`😢 "${arg}" — results නෑ. Movie නම ටිකක් වෙනස් කරලා try කරන්න.`);
        sessions.set(jid, { list, at: Date.now() });
        if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
        edit(listText(arg, list));
    } catch (e) {
        edit('❌ Search fail: ' + String(e.message).slice(0, 180) + '\n(ටිකකින් ආයෙත් try කරන්න)');
    }
    return true;
}

module.exports = { handle, search, cardText, listText, hasSession };
