/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 */
import sharp from 'sharp'
import { logger } from '../../core/logger.js'
import { downloadMedia } from '../../lib/media.js'

const pluginConfig = {
  name: "toimg",
  alias: ['toimage', 'img'],
  category: "tools",
  description: "Stiker → gambar PNG (balas stikernya)",
  usage: ".toimg",
  example: ".toimg",
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
    const media = await downloadMedia(ctx.client, ctx.event)

    if (!media) {
      await ctx.reply('📥 Media gak ketemu / gak bisa diunduh (mungkin udah kadaluarsa).')
      return
    }

    if (media.kind !== 'sticker') {
      await ctx.reply(`Balas *stiker* dengan caption ${ctx.prefix}toimg`)
      return
    }

    const png = await sharp(media.buffer).png().toBuffer()

    const attempts = [
      { type: 'image', media: png, mimetype: 'image/png', caption: '🖼️ Ini dia hasilnya, Kak!' },
      { type: 'image', media: png, mimetype: 'image/png' },
      { type: 'image', buffer: png, mimetype: 'image/png' }
    ]

    let lastErr
    for (const [i, content] of attempts.entries()) {
      try {
        await ctx.client.message.send(ctx.chat, content)
        logger.info(`🖼️ toimg terkirim (bentuk ke-${i + 1})`)
        return
      } catch (err) {
        lastErr = err
        logger.warn({ bentuk: i + 1, err: err.message }, 'Percobaan kirim image gagal')
      }
    }

    throw lastErr ?? new Error('send image gagal')
  }

export { pluginConfig as config, handler };
