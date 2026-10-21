/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * superhd.js — Naikin kualitas gambar pakai AI Super HD (skyline.web.id).
 *
 * Bedanya dengan `.hd`: `.hd` pakai upscaler lama (api.jhx.my.id), ini pakai
 * AI Super HD dari server sendiri. Cocok buat foto blur / hasil screenshot.
 */
import { pickImage, getEvent, toPublicUrl } from '../../lib/imageSource.js'
import { superHd, skylineCreds, keyHint, SkylineKeyError } from '../../scraper/SKYLINE.js'
import { logger } from '../../core/logger.js'

const pluginConfig = {
  name: 'superhd',
  alias: ['aihd', 'hdai'],
  category: 'media',
  description: 'Naikin kualitas gambar pakai AI Super HD',
  usage: '.superhd (sambil reply/quote gambar)',
  example: '.superhd',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 25,
  limit: 1,
  energi: 2,
  isEnabled: true,
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  if (!skylineCreds().apikey) return ctx.reply(keyHint(ctx))

  const picked = await pickImage(ctx)
  if (!picked) {
    return ctx.reply(
      `🖼️ *SUPER HD*\n\nKirim/reply foto sambil ketik \`${p}superhd\`.\n` +
        `Bisa juga: \`${p}superhd <url_gambar>\``
    )
  }

  await ctx.react('⏳')
  await ctx.reply('🔍 *Super HD* — lagi naikin kualitas gambar...')

  try {
    const url = await toPublicUrl(picked)
    if (!url) throw new Error('gagal upload gambar ke hosting')

    const out = await superHd({ image: url })
    await ctx.react('✨')
    return ctx.client.message.send(
      ctx.chat,
      {
        type: 'image',
        media: out.buffer,
        mimetype: out.mimetype || 'image/png',
        caption: '✨ *Super HD — Selesai!*\n\nKualitas gambar udah dinaikin AI.'
      },
      { quote: getEvent(ctx) }
    )
  } catch (e) {
    const msg = String(e?.message || e)
    logger.warn({ err: msg.slice(0, 300) }, '[SuperHD] gagal')
    await ctx.react('❎')
    if (e instanceof SkylineKeyError) return ctx.reply(keyHint(ctx))
    if (/timeout|kelamaan/i.test(msg)) return ctx.reply('⏱️ Server Super HD kelamaan — coba lagi ya.')
    return ctx.reply('❌ Gagal naikin kualitas gambar: ' + msg.slice(0, 160))
  }
}

export { pluginConfig as config, handler }
