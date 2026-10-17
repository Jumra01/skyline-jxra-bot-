/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ytsearch.js — Cari video YouTube, Download Audio/Videonya dengan Button
 */

import { onRichReply } from '../../handlers/messageHandler.js';
import { searchYouTube } from '../../scraper/YT-Search.js';
import { handler as ytvFeature } from './ytmp4.js';
import { handler as ytaFeature } from './ytmp3.js';

const SESSIONS = (globalThis.JH_YTSEARCH_SESSIONS ??= new Map());
const PER_PAGE = 2;
const LINE = '━━━━━━━━━━━━━━━━━━━━';

const cut = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};

async function showFormatButtons(ctx, video) {
  const videoId = `ytsearch:${ctx.sender}:video:${Date.now()}`;
  const audioId = `ytsearch:${ctx.sender}:audio:${Date.now()}`;

  onRichReply(videoId, async (c2) => {
    await ytvFeature({ ...c2, text: video.url });
  });
  onRichReply(audioId, async (c2) => {
    await ytaFeature({ ...c2, text: video.url });
  });

  const buttons = [
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🎬 Video', id: videoId }) },
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🎵 Audio', id: audioId }) }
  ];

  const text =
    `✦ ──『 🎯 DIPILIH 』── ⚝\n\n` +
    `🎞 *${cut(video.title, 60)}*\n` +
    `👤 ${cut(video.channel, 30)}\n` +
    `⏱ ${video.duration}  •  👁 ${video.views}\n\n` +
    `Mau didownload bentuk apa?`;

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: { text },
      footer: { text: '🎬🎵 skyline-JXRA • Pilih Format' },
      nativeFlowMessage: { buttons, messageVersion: 1 }
    }
  });
}

async function pickResult(ctx, idx) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.ytsearch <query>* lagi.');
  const video = sess.results[idx];
  if (!video) return ctx.reply('Nomor gak valid.');
  await showFormatButtons(ctx, video);
}

async function sendPage(ctx, page) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.ytsearch <query>* lagi.');

  const { results, query } = sess;
  const totalPages = Math.ceil(results.length / PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));

  const start = page * PER_PAGE;
  const items = results.slice(start, start + PER_PAGE);

  let text = `✦ ──『 🔎 YT SEARCH 』── ⚝\n\n`;
  text += `🔎 Query : *${cut(query, 38)}*\n`;
  text += `📄 Page  : ${page + 1}/${totalPages} • ${results.length} hasil\n\n`;
  text += LINE + '\n';

  items.forEach((v, i) => {
    text += `\n${start + i + 1} ─ ${cut(v.title, 45)}\n`;
    text += `    ⏱ ${v.duration}  •  👁 ${v.views}\n`;
    text += `    👤 ${cut(v.channel, 28)}\n`;
  });

  text += '\n' + LINE + '\n\n';
  text += `Tap tombol angka buat pilih,\nlanjut milih Video/Audio 🎬🎵`;

  const buttons = items.map((v, i) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: String(start + i + 1),
      id: `ytsearch:${ctx.sender}:pick:${start + i}`
    })
  }));

  if (page > 0) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: '◀ Prev',
        id: `ytsearch:${ctx.sender}:prev:${page - 1}`
      })
    });
  }
  if (page < totalPages - 1) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Next ▶',
        id: `ytsearch:${ctx.sender}:next:${page + 1}`
      })
    });
  }

  items.forEach((v, i) => {
    onRichReply(`ytsearch:${ctx.sender}:pick:${start + i}`, async (c2) => {
      await pickResult(c2, start + i);
    });
  });
  if (page > 0) {
    onRichReply(`ytsearch:${ctx.sender}:prev:${page - 1}`, async (c2) => {
      await sendPage(c2, page - 1);
    });
  }
  if (page < totalPages - 1) {
    onRichReply(`ytsearch:${ctx.sender}:next:${page + 1}`, async (c2) => {
      await sendPage(c2, page + 1);
    });
  }

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: { text },
      footer: { text: '🔎 skyline-JXRA • YouTube Search' },
      nativeFlowMessage: { buttons, messageVersion: 1 }
    }
  });
}

const pluginConfig = {
  name: "ytsearch",
  alias: ['yts', 'ytsc'],
  category: "downloader",
  description: "Cari video YouTube, pilih hasilnya, download video/audio",
  usage: ".ytsearch",
  example: ".ytsearch",
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
    const query = (ctx.text || '').trim();
    if (!query) {
      return ctx.reply(`*Contoh Pakai :*\n.ytsearch lathi weird genius`);
    }

    await ctx.react('⏳');
    try {
      const results = await searchYouTube(query, 10);
      if (!results.length) {
        await ctx.react('❎');
        return ctx.reply('Gak nemu hasil buat pencarian itu.');
      }

      SESSIONS.set(ctx.sender, { query, results });
      await sendPage(ctx, 0);
      await ctx.react('✅');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('*Maaf Error:* ' + (e.message || e));
    }
  }

export { pluginConfig as config, handler };
