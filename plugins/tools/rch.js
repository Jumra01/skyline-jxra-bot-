/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * rch.js — WhatsApp Channel Reaction
 */
import { logger } from '../../core/logger.js'
import { JHRCH } from '../../scraper/rch.js'

const pluginConfig = {
  name: "react",
  alias: ['chreact', 'reactch', 'rc'],
  category: "tools",
  description: "React postingan WhatsApp Channel menggunakan emoji (bisa reply link atau ketik langsung)",
  usage: ".react",
  example: ".react",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    const args = ctx.args || (ctx.text ? ctx.text.split(' ').slice(1) : []);
    
    let link = args[0];
    let emoji = args[1] || '❤️'; 

    const quoted = ctx.quoted ? (ctx.quoted.text || ctx.quoted.caption || '') : '';
    if (!link && quoted) {
      const match = quoted.match(/(https:\/\/whatsapp\.com\/channel\/[^\s]+)/);
      if (match) {
        link = match[1];
        if (args[0] && !args[0].startsWith('http')) {
          emoji = args[0];
        }
      }
    }

    if (!link || !link.includes('whatsapp.com/channel/')) {
      await ctx.reply(
        `❌ Format salah atau link tidak ditemukan!\n\n` +
        `💡 *Cara Penggunaan:*\n` +
        `• ${ctx.prefix}react <link_channel> <emoji>\n` +
        `• Atau reply link channel dengan ketik: ${ctx.prefix}react <emoji>\n\n` +
        `*Contoh:* ${ctx.prefix}react https://whatsapp.com/channel/... 🔥`
      );
      return;
    }

    await ctx.reply(`⏳ Sedang memproses reaction *${emoji}* ke channel...`);

    try {
      const result = await JHRCH(link, emoji);

      if (!result.status || !result.data?.ok) {
        const errMsg = result.data?.message || result.error || 'Gagal mengirim reaction.';
        await ctx.reply(`❌ Gagal: ${errMsg}`);
        return;
      }

      const qData = result.data.data;
      const replyText = 
        `✅ *REACTION BERHASIL DIPROSES!*\n\n` +
        `📌 *Queue Number:* ${result.data.queueNumber}\n` +
        `💬 *Message ID:* ${qData.messageId}\n` +
        `❤️ *Emojis:* ${qData.emojis.join(', ')}\n\n` +
        `> _*Powered by skyline-JXRA*_`;

      await ctx.reply(replyText);
      logger.info(`✨ React channel sukses terkirim ke ${qData.jid}`);

    } catch (err) {
      logger.error({ err: err.message }, 'Error saat eksekusi command react.');
      await ctx.reply(`❌ Terjadi kesalahan internal: ${err.message}`);
    }
  }

export { pluginConfig as config, handler };
