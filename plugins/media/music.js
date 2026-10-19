/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * music.js — Koleksi musik siap kirim (.music1 - .music140).
 *
 * Diambil dari skyline-md (plugins/media/music.js), sumber audio:
 *   github.com/Rez4-3yz/Music-rd → folder `music/`
 * Audio dikirim sebagai file (bukan voice note), tanpa biaya emerald.
 */
import axios from 'axios'
import { embedAudioCover } from '../../lib/audioCover.js'
import { getCollectionCover } from '../../lib/musicCover.js'

const MIN = 1
const MAX = 140

/** Alamat file musik ke-N. */
const source = (n) => `https://raw.githubusercontent.com/Rez4-3yz/Music-rd/master/music/music${n}.mp3`

// daftarkan `.music1` … `.music140` sebagai alias satu fitur
const LIST = []
for (let i = MIN; i <= MAX; i++) LIST.push(`music${i}`)

const pluginConfig = {
  name: 'music',
  alias: LIST,
  category: 'media',
  description: `Koleksi musik (music${MIN} - music${MAX})`,
  usage: `.music1 sampai .music${MAX}`,
  example: '.music1',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
}

/** Unduh lalu kirim sebagai audio (file, bukan ptt). */
async function sendAudio(ctx, url, fileName) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000, validateStatus: () => true })
  if (res.status !== 200 || !res.data?.byteLength) {
    const err = new Error(`Gagal ambil audio (HTTP ${res.status})`)
    err.status = res.status
    throw err
  }
  const rawMessage = ctx.event?.message ?? ctx.event

  // Tanam cover default biar gak jadi kotak hitam di WhatsApp.
  const buffer = Buffer.from(res.data)
  const cover = await getCollectionCover()
  const embedded = await embedAudioCover(buffer, 'audio/mpeg', cover)

  await ctx.client.message.send(
    ctx.chat,
    { type: 'audio', media: embedded.buffer, mimetype: 'audio/mpeg', ptt: false, fileName },
    rawMessage ? { quote: rawMessage } : undefined
  )
}

const help = (ctx) =>
  '🎵 *ᴍᴜsɪᴄ ᴄᴏʟʟᴇᴄᴛɪᴏɴ*\n\n' +
  `> Tersedia: \`.music${MIN}\` – \`.music${MAX}\`\n` +
  `> Contoh: \`${ctx.prefix}music1\``

async function handler(ctx) {
  const num = Number.parseInt(String(ctx.command || '').replace(/\D/g, ''), 10)
  if (!Number.isFinite(num) || num < MIN || num > MAX) return ctx.reply(help(ctx))

  await ctx.react('🕕')
  try {
    await sendAudio(ctx, source(num), `music${num}.mp3`)
    await ctx.react('✅')
  } catch (err) {
    await ctx.react('❌')
    const notFound = err?.status === 404
    return ctx.reply(
      notFound
        ? `❌ Musik *music${num}* tidak ada.`
        : `❌ Gagal mengambil musik *music${num}* — coba lagi ya.`
    )
  }
}

export { pluginConfig as config, handler }
