/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * qr.js — Bikin QR code dari teks/link (.qr).
 */
import QRCode from 'qrcode'
import { getEvent } from '../../lib/imageSource.js'

const pluginConfig = {
  name: 'qr',
  alias: ['qrcode', 'bikinqr'],
  category: 'tools',
  description: 'Bikin gambar QR code dari teks atau link',
  usage: '.qr <teks/link>',
  example: '.qr https://skyline.web.id',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
}

const MAX_LEN = 900

async function handler(ctx) {
  const text = String(ctx.text || '').trim()
  if (!text) {
    return ctx.reply(`🔳 Format: \`${ctx.prefix || '.'}qr <teks atau link>\`\n\nContoh: \`${ctx.prefix || '.'}qr https://skyline.web.id\``)
  }
  if (text.length > MAX_LEN) {
    return ctx.reply(`❌ Teks kepanjangan (${text.length}/${MAX_LEN} karakter).`)
  }

  try {
    const buffer = await QRCode.toBuffer(text, {
      type: 'png',
      width: 720,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    })

    await ctx.react('🔳')
    return ctx.client.message.send(
      ctx.chat,
      {
        type: 'image',
        media: buffer,
        mimetype: 'image/png',
        caption: `🔳 *QR CODE*\n\n${text.length > 120 ? text.slice(0, 120) + '…' : text}`
      },
      { quote: getEvent(ctx) }
    )
  } catch (err) {
    return ctx.reply('❌ Gagal bikin QR: ' + String(err?.message || err).slice(0, 140))
  }
}

export { pluginConfig as config, handler }
