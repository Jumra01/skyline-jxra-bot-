/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * nanobana.js — Edit gambar pakai AI Nanobana (backend skyline.web.id).
 *
 * Gambar sumber: balas/quote foto, foto caption command, atau URL.
 * Server butuh gambar yang bisa diakses publik → upload dulu (top4top).
 */
import { pickImage, getEvent, toPublicUrl } from '../../lib/imageSource.js'
import { nanoBanana, skylineCreds, keyHint, SkylineKeyError } from '../../scraper/SKYLINE.js'
import { logger } from '../../core/logger.js'

const pluginConfig = {
  name: 'nanobana',
  alias: ['nb', 'editfoto'],
  category: 'ai',
  description: 'Edit gambar pake AI Nanobana — ganti background, tambah objek, dll',
  usage: '.nanobana <prompt> (sambil reply/quote gambar)\n.nanobana <url_gambar> <prompt>',
  example: '.nanobana jadikan gaya anime',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 30,
  limit: 1,
  energi: 2,
  isEnabled: true,
}

const HELP = (p) =>
  '🍌 *NANOBANA — AI Image Edit*\n\n' +
  'Edit gambar pake AI. Bisa ganti background, tambah objek, ubah gaya, dll.\n\n' +
  '*Cara pakai:*\n' +
  `> ${p}nanobana <prompt> — sambil reply/quote gambar\n` +
  `> ${p}nanobana <url_gambar> <prompt>\n\n` +
  '*Contoh:*\n' +
  `> ${p}nanobana jadikan gaya anime\n` +
  `> ${p}nanobana tambah mahkota di kepalanya`

async function handler(ctx) {
  const p = ctx.prefix || '.'
  if (!skylineCreds().apikey) return ctx.reply(keyHint(ctx))

  const picked = await pickImage(ctx)
  const prompt = String(picked?.rest ?? ctx.text ?? '').trim()
  if (!picked) return ctx.reply(HELP(p))
  if (!prompt) return ctx.reply(`❌ Tulis prompt-nya! Contoh: \`${p}nanobana jadikan gaya anime\``)

  await ctx.react('⏳')
  await ctx.reply('🍌 *Nanobana* — lagi ngolah gambar, tunggu sebentar ya...')

  try {
    const url = await toPublicUrl(picked)
    if (!url) throw new Error('gagal upload gambar ke hosting')

    const out = await nanoBanana({ image: url, prompt })
    await ctx.react('🎨')
    return ctx.client.message.send(
      ctx.chat,
      {
        type: 'image',
        media: out.buffer,
        mimetype: out.mimetype || 'image/png',
        caption: `🍌 *Nanobana — Selesai!*\n\n📝 *Prompt:* ${prompt}`
      },
      { quote: getEvent(ctx) }
    )
  } catch (e) {
    const msg = String(e?.message || e)
    logger.warn({ err: msg.slice(0, 300) }, '[Nanobana] gagal')
    await ctx.react('❎')
    if (e instanceof SkylineKeyError) return ctx.reply(keyHint(ctx))
    if (/timeout|kelamaan/i.test(msg)) return ctx.reply('⏱️ Server AI gambar kelamaan — coba lagi ya.')
    return ctx.reply('❌ Gagal ngolah gambar: ' + msg.slice(0, 160))
  }
}

export { pluginConfig as config, handler }
