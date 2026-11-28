/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 */
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { downloadMedia } from '../../lib/media.js'
import { MAX_STICKER_BYTES } from '../../lib/sticker.js'
import { buildSoundSticker, sendSoundSticker, MAX_SOUND_SECONDS } from '../../lib/soundSticker.js'

const pluginConfig = {
  name: "soundsticker",
  alias: ['ssticker', 'stikersuara'],
  category: "sticker",
  description: "Stiker bersuara — balas video (ada suara), atau gambar + balas audio",
  usage: ".soundsticker",
  example: "Balas video yang ada suaranya dengan .soundsticker",
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

const QUOTED_FIELDS = [
  'imageMessage',
  'videoMessage',
  'extendedTextMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage'
]

/** Cari audioMessage di pesan yang di-quote (konteks tiap tipe media). */
function quotedAudioMessage(message) {
  if (!message) return null
  for (const field of QUOTED_FIELDS) {
    const audio = message[field]?.contextInfo?.quotedMessage?.audioMessage
    if (audio) return audio
  }
  return null
}

async function handler(ctx) {
    const media = await downloadMedia(ctx.client, ctx.event)

    if (!media || !['image', 'video'].includes(media.kind)) {
      await ctx.reply(
        `Cara pakai ${ctx.prefix}soundsticker:\n` +
        `• Balas *video* yang ada suaranya, atau\n` +
        `• Kirim *gambar/GIF* dengan caption ${ctx.prefix}soundsticker sambil balas *audio/pesan suara*\n` +
        `(suara dipotong maks ${MAX_SOUND_SECONDS} detik)`
      )
      return
    }

    /* Sumber audio: video itu sendiri, atau audio yang di-quote pesan gambar. */
    let audioBuffer = null
    if (media.kind === 'video') {
      audioBuffer = media.buffer
    } else {
      const quoted = quotedAudioMessage(ctx.event.message)
      if (quoted) {
        try {
          audioBuffer = Buffer.from(await ctx.client.message.downloadBytes({ audioMessage: quoted }))
        } catch (err) {
          logger.error({ err: err.message }, 'soundsticker: unduh audio quote gagal')
        }
      }
    }

    if (!audioBuffer) {
      await ctx.reply(
        `Gak nemu *sumber suara*-nya. Balas video yang ada suara, atau kirim gambar ` +
        `dengan caption ${ctx.prefix}soundsticker sambil balas audio/pesan suara.`
      )
      return
    }

    await ctx.react('⏳').catch(() => {})

    let payload
    try {
      payload = await buildSoundSticker(media, audioBuffer, {
        packName: config.sticker.packName,
        author: config.sticker.author,
        withExif: config.sticker.withExif !== false,
        maxVideoSeconds: config.sticker.maxVideoSeconds
      })
    } catch (err) {
      if (/ffmpeg|ENOENT/i.test(err.message)) {
        await ctx.reply('🎬 ffmpeg belum terpasang di server. Install dulu: `apt install -y ffmpeg`')
        return
      }
      if (/matches no streams/i.test(err.message)) {
        await ctx.reply('🤫 Media itu gak punya audio — pilih video/voice note yang ada suaranya ya.')
        return
      }
      throw err
    }

    if (payload.webp.length > MAX_STICKER_BYTES) {
      await ctx.reply(
        `😅 Stikernya kelewat berat buat limit stiker WA (±1MB): hasil ${(payload.webp.length / 1024).toFixed(0)}KB.\n` +
        `Potong durasinya dulu ya — GIF & video pendek aman kok.`
      )
      return
    }

    try {
      await sendSoundSticker(ctx.client, ctx.chat, payload)
    } catch (err) {
      logger.error({ err: err.message, size: payload.webp.length }, 'Gagal kirim sound sticker')
      await ctx.reply(`😵 Gagal kirim stiker bersuara: ${String(err.message).slice(0, 120)}`)
      return
    }

    await ctx.react('✅').catch(() => {})
  }

export { pluginConfig as config, handler };
