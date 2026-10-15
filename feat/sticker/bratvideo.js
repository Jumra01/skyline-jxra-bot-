/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bratvideo.js — Bikin STICKER ANIMATED "brat" (efek bounce + highlight
 */

import { generateBratAnimatedSticker } from '../../lib/bratGenerator.js';

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

export default {
  name: 'bratvideo',
  aliases: ['bratv', 'bratvid'],
  tags: 'sticker',
  description: 'Bikin sticker brat-style animated (efek bounce jalan)',

  async run(ctx) {
    const raw = (ctx.text || '').trim();
    if (!raw) {
      return ctx.reply(
        '✦ *BRAT ANIMATED STICKER* ✦\n\n' +
        'Cara pake:\n*.bratvideo <teks>*\n' +
        'Pilih tema: *.bratvideo <white/black/green>|<teks>*\n\n' +
        'Contoh:\n.bratvideo Halo Dunia\n.bratvideo black|Gelap Tapi Estetik\n\n' +
        '(mau versi statis aja? pake *.brat <teks>*)'
      );
    }

    const { theme, text } = parseArgs(raw);

    await ctx.react('⏳');
    try {
      const webpBuffer = await generateBratAnimatedSticker({
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
      ctx.reply('Gagal bikin sticker brat animated: ' + (e.message || e));
    }
  }
};