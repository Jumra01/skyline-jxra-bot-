/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * play.js — Putar lagu kesukaanmu dengan ini.
 */
import { jhydl } from '../../scraper/YT-DL.js';
import { downloadBestAudio } from '../../scraper/YTDLP.js';
import {
  ytSearch as skylineSearch,
  downloadAudio as skylineAudio,
  isConfigured as skylineReady
} from '../../scraper/SKYLINE.js';
import { onRichReply } from '../../handlers/messageHandler.js';
import { logger } from '../../core/logger.js';
import { uploadThumbHeader, fetchThumbBuffer, youtubeVideoId } from '../../lib/ytUi.js';
import { embedAudioCover } from '../../lib/audioCover.js';
import { getCollectionCover } from '../../lib/musicCover.js';

const SESSIONS = (globalThis.JH_PLAY_SESSIONS ??= new Map());
const PER_PAGE = 2;

// Cuma sekali di-log biar terminal gak banjir kalau sumber cadangan dipakai.
let ytdlpWarned = false;
let skylineWarned = false;

/** Rapikan judul jadi nama file yang aman. */
const safeName = (s, fallback = 'audio') =>
  (String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback);

const cut = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};

const LINE = '━━━━━━━━━━━━━━━━━━━━';

async function legacySearch(query) {
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
 * Cari lagu: Skyline API dulu (kalau key diisi), cadangan ke API lama.
 * @returns {Promise<Array>} hasil dengan field { url, title, artist, duration }
 */
async function searchSongs(query) {
  if (skylineReady()) {
    try {
      const results = await skylineSearch(query, 8);
      if (results.length) return results;
    } catch (err) {
      if (!skylineWarned) {
        skylineWarned = true;
        logger.warn(`play: search Skyline gagal (${err?.message || err}) — pakai API cadangan`);
      }
    }
  }
  return legacySearch(query);
}

/**
 * Ambil audio dari YouTube.
 *  1. Skyline API (skyline.web.id) → MP3 siap pakai, kalau API key diisi.
 *  2. yt-dlp  → audio asli (m4a/AAC 128kbps) kalau binary-nya ada.
 *  3. cadangan → sumber lama (savenow), kualitas lebih rendah tapi selalu ada.
 * Gagal di satu jalur = bukan error buat user, langsung pindah jalur berikutnya.
 */
async function fetchAudio(v) {
  if (skylineReady()) {
    try {
      const res = await skylineAudio(v.url);
      logger.info(`play: audio via Skyline API (${res.ext}, ${(res.buffer.length / 1048576).toFixed(1)}MB)`);
      return { ...res, title: v.title || res.title };
    } catch (err) {
      if (!skylineWarned) {
        skylineWarned = true;
        logger.warn(`play: audio Skyline gagal (${err?.message || err}) — pakai sumber cadangan`);
      }
    }
  }

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

    // Thumbnail: dipakai buat cover file audio (biar gak kotak hitam) +
    // dikirim sebagai foto caption kalau cover gagal ditanam.
    const videoId = v.videoId || youtubeVideoId(v.url);
    let cover = await fetchThumbBuffer(v.thumbnail || audio.thumbnail, {
      width: 640,
      videoId
    });
    // Jaringan panel ngeblok semua sumber gambar? Pakai cover default bot,
    // jangan biarkan audio tampil hitam.
    if (!cover) {
      const fallback = await getCollectionCover(640);
      if (fallback) cover = { buffer: fallback, width: 640, height: 640, source: 'local' };
    }

    // Tanam cover TANPA re-encode (ffmpeg -c copy). Gagal = file asli.
    const embedded = await embedAudioCover(audio.buffer, audio.mimetype, cover?.buffer);

    // Foto caption selalu dikirim: jaminan thumbnail kelihatan di semua
    // client WhatsApp, termasuk yang gak baca cover di dalam file audio.
    if (cover) {
      try {
        await ctx.client.message.send(ctx.chat, {
          type: 'image',
          media: cover.buffer,
          mimetype: 'image/jpeg',
          caption:
            `*${audio.title}*\n\n` +
            `⏱ ${v.duration || audio.duration || '-:--'}\n` +
            `👤 ${v.channel || v.artist || '-'}\n` +
            (v.url ? `🔗 ${v.url}\n` : '') +
            `\n> 🎧 skyline-JXRA • Music Player`
        });
      } catch (err) {
        // Foto cuma bonus — jangan sampai audio gagal terkirim.
        logger.warn(`play: foto thumbnail gagal dikirim (${err?.message || err})`);
      }
    }

    await ctx.client.message.send(ctx.chat, {
      type: 'audio',
      media: embedded.buffer,
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
    text: String(start + i + 1),
    id: `jhplay:${ctx.sender}:pick:${start + i}`
  }));

  if (page > 0) {
    buttons.push({ text: '◀ Prev', id: `jhplay:${ctx.sender}:prev:${page - 1}` });
  }
  if (page < totalPages - 1) {
    buttons.push({ text: 'Next ▶', id: `jhplay:${ctx.sender}:next:${page + 1}` });
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

  // Tombol lewat builder standar (viewOnce wrapper + node bot buat private
  // chat) + header thumbnail hasil pertama — gaya paling reliable di WA.
  const first = items[0];
  const headerImage = await uploadThumbHeader(ctx.client, first?.thumbnail, {
    videoId: first?.videoId || youtubeVideoId(first?.url)
  });

  await ctx.replyButtons({
    text,
    footer: '🎧 skyline-JXRA • Music Player',
    buttons,
    headerImage
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
        '*Contoh:*\n.play Bercinta Lewat Kata' +
        (skylineReady() ? '' : '\n\n> 💡 Isi API key skyline.web.id di config\n> biar kualitas audio lebih bagus.')
      );
    }

    await ctx.react('⏳');
    try {
      const results = (await searchSongs(query)).slice(0, 8);
      SESSIONS.set(ctx.sender, { query, results });
      await sendPage(ctx, 0);
      await ctx.react('✅');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('*Maaf Error:* ' + (e.message || e));
    }
  }

export { pluginConfig as config, handler };
