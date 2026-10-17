/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * brat.js — Bikin STICKER STATIS "brat"
 */

import { generateBratSticker } from '../../lib/bratGenerator.js';

const KNOWN_THEMES = ['white', 'black', 'green'];

function parseArgs(raw) {
  const trimmed = raw.trim();
  const pipeIdx = trimmed.indexOf('|');

  if (pipeIdx !== -1) {
    const maybeTheme = trimmed.slice(0, pipeIdx).trim().toLowerCase();
    if (KNOWN_THEMES.includes(maybeTheme)) {
      return { theme: maybeTheme, text: trimmed.slice(pipeIdx + 1).trim() };
    }
  }

  return { theme: 'white', text: trimmed };
}

const pluginConfig = {
  name: "brat",
  alias: ['bratstiker', 'bratsticker'],
  category: "sticker",
  description: "Bikin sticker brat-style statis",
  usage: ".brat",
  example: ".brat",
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
    const raw = (ctx.text || '').trim();
    if (!raw) {
      return ctx.reply(
        '✦ *BRAT STICKER* ✦\n\n' +
        'Cara pake:\n*.brat <teks>*\n' +
        'Pilih tema: *.brat <white/black/green>|<teks>*\n\n' +
        'Contoh:\n.brat Halo Dunia\n.brat black|Gelap Tapi Estetik\n\n' +
        '(mau versi gerak/animated? pake *.bratvideo <teks>*)'
      );
    }

    const { theme, text } = parseArgs(raw);

    await ctx.react('⏳');
    try {
      const webpBuffer = await generateBratSticker({
        text,
        theme,
        packName: 'Made With',
        packAuthor: 'skyline-JXRA♡'
      });

      await ctx.client.message.send(ctx.chat, {
        type: 'sticker', media: webpBuffer, mimetype: 'image/webp'
      });

      await ctx.react('✅');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('Gagal bikin sticker brat: ' + (e.message || e));
    }
  }

export { pluginConfig as config, handler };
