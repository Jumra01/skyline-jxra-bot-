/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * play.js — Putar lagu kesukaanmu dengan ini.
 */
import { jhydl } from '../../scraper/YT-DL.js';
import { downloadBestAudio } from '../../scraper/YTDLP.js';
import { onRichReply } from '../../handlers/messageHandler.js';
import { logger } from '../../core/logger.js';

const SESSIONS = (globalThis.JH_PLAY_SESSIONS ??= new Map());
const PER_PAGE = 2;

// Cuma sekali di-log biar terminal gak banjir kalau yt-dlp memang gak ada.
let ytdlpWarned = false;

/** Rapikan judul jadi nama file yang aman. */
const safeName = (s, fallback = 'audio') =>
  (String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback);

const cut = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};

const LINE = '━━━━━━━━━━━━━━━━━━━━';

async function ytSearch(query) {
  const res = await fetch('https://api.jhx.my.id/yt-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36',
      'Referer': 'https://jhx.my.id/ytdl/'
    },
    body: JSON.stringify({ q: query })
  });
  if (!res.ok) throw new Error('API search error: ' + res.status);
  const json = await res.json();
  if (!json.Status || !Array.isArray(json.data) || !json.data.length) {
    throw new Error('Lagu tidak ditemukan');
  }
  return json.data;
}

/**
 * Ambil audio dari YouTube.
 *  1. yt-dlp  → audio asli (m4a/AAC 128kbps, treble sampai ~16 kHz), tanpa transcode.
 *  2. cadangan → sumber lama (savenow), kualitas lebih rendah tapi selalu ada.
 * yt-dlp gagal / gak terpasang = bukan error buat user, langsung pindah ke cadangan.
 */
async function fetchAudio(v) {
  try {
    const res = await downloadBestAudio(v.url);
    logger.info(`play: audio via yt-dlp (${res.ext}, ${(res.buffer.length / 1048576).toFixed(1)}MB)`);
    return { ...res, title: v.title };
  } catch (err) {
    if (!ytdlpWarned) {
      ytdlpWarned = true;
      logger.warn(`play: yt-dlp gagal (${err?.message || err}) — pakai sumber cadangan, kualitas lebih rendah`);
    }
  }

  const data = await jhydl.download(v.url, 'mp3');
  if (!data || data.error) throw new Error(data?.error || 'Gagal unduh audio.');

  const fr = await fetch(data.download_url);
  if (!fr.ok) throw new Error('Gagal ambil audio: ' + fr.status);

  return {
    buffer: Buffer.from(await fr.arrayBuffer()),
    ext: 'mp3',
    mimetype: 'audio/mpeg',
    title: data.title || v.title
  };
}

async function downloadAndSend(ctx, idx) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.play <judul>* lagi.');
  const v = sess.results[idx];
  if (!v) return ctx.reply('Nomor gak valid.');

  await ctx.react('⏳');
  try {
    const audio = await fetchAudio(v);

    await ctx.client.message.send(ctx.chat, {
      type: 'audio',
      media: audio.buffer,
      mimetype: audio.mimetype,
      fileName: `${safeName(audio.title)}.${audio.ext}`
    });
    await ctx.react('🎧');
  } catch (e) {
    await ctx.react('❎');
    ctx.reply('*Maaf Error:* ' + (e.message || e));
  }
}

async function sendPage(ctx, page) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.play <judul>* lagi.');

  const { results, query } = sess;
  const totalPages = Math.ceil(results.length / PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));

  const start = page * PER_PAGE;
  const items = results.slice(start, start + PER_PAGE);

  let text = `✦ ──『 🎧 PLAY MUSIC 』── ⚝\n\n`;
  text += `🔎 Query : *${cut(query, 38)}*\n`;
  text += `📄 Page  : ${page + 1}/${totalPages} • ${results.length} hasil\n\n`;
  text += LINE + '\n';

  items.forEach((v, i) => {
    text += `\n${start + i + 1} ─ ${cut(v.title, 40)}\n`;
    text += `    ⏱ ${v.duration || '-:--'}  •  ${cut(v.artist, 26)}\n`;
  });

  text += '\n' + LINE + '\n\n';
  text += `Tap tombol angka di bawah\nbuat langsung putar lagunya 🎶`;

  const buttons = items.map((v, i) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: String(start + i + 1),
      id: `jhplay:${ctx.sender}:pick:${start + i}`
    })
  }));

  if (page > 0) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: '◀ Prev',
        id: `jhplay:${ctx.sender}:prev:${page - 1}`
      })
    });
  }
  if (page < totalPages - 1) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Next ▶',
        id: `jhplay:${ctx.sender}:next:${page + 1}`
      })
    });
  }

  items.forEach((v, i) => {
    onRichReply(`jhplay:${ctx.sender}:pick:${start + i}`, async (c2) => {
      await downloadAndSend(c2, start + i);
    });
  });
  if (page > 0) {
    onRichReply(`jhplay:${ctx.sender}:prev:${page - 1}`, async (c2) => {
      await sendPage(c2, page - 1);
    });
  }
  if (page < totalPages - 1) {
    onRichReply(`jhplay:${ctx.sender}:next:${page + 1}`, async (c2) => {
      await sendPage(c2, page + 1);
    });
  }

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: { text },
      footer: { text: '🎧 skyline-JXRA • Music Player' },
      nativeFlowMessage: {
        buttons,
        messageVersion: 1
      }
    }
  });
}

const pluginConfig = {
  name: "play",
  // alias `music` dipindah ke koleksi musik (plugins/media/music.js) sesuai
  // skyline-md — di sini cukup `.play` / `.ytplay` / `.playyt`.
  alias: ['ytplay', 'playyt'],
  category: "downloader",
  description: "Search YouTube audio, pilih lewat button",
  usage: ".play",
  example: ".play",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    const query = ctx.text;
    if (!query) {
      return ctx.reply(
        '✦ ──『 🎧 SKYLINE MUSIC 』── ⚝\n\n' +
        'Masukkan judul lagu yang\nmau lo cari & putar 🎶\n\n' +
        '*Contoh:*\n.play Bercinta Lewat Kata'
      );
    }

    await ctx.react('⏳');
    try {
      const results = (await ytSearch(query)).slice(0, 8);
      SESSIONS.set(ctx.sender, { query, results });
      await sendPage(ctx, 0);
      await ctx.react('✅');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('*Maaf Error:* ' + (e.message || e));
    }
  }

export { pluginConfig as config, handler };
