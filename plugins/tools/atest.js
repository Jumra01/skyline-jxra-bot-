/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * albumtest.js — test kirim album
 */
import { sendAlbum } from '../../lib/album.js'

const pluginConfig = {
  name: "albumtest",
  alias: ['atest'],
  category: "tools",
  description: "Ujicoba albumMessage",
  usage: ".albumtest",
  example: ".albumtest",
  isOwner: true,
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
    await ctx.react('⏳')
    try {
      await sendAlbum(ctx, {
        caption: '🧪 Test album',
        images: [
          { url: 'https://a.top4top.io/p_3911abna00.jpg' },
          { url: 'https://e.top4top.io/p_3911qtk020.jpg' },
          { url: 'https://f.top4top.io/p_39119uot90.jpg' }
        ]
      })
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('❌ ATest gagal: ' + String(e.message || e).slice(0, 250))
    }
  }

export { pluginConfig as config, handler };
