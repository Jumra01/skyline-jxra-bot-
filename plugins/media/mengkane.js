/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * mengkane.js — Koleksi audio "mengkane" (.mengkane1 - .mengkane54).
 *
 * Sumber audio dibagi 2 repo:
 *   • nomor 1-24  → github.com/hyuura/Rest-Sound      → folder `HyuuraKane/`
 *   • nomor 25-54 → github.com/aisyah-rest/mangkane   → folder `Mangkanenya/`
 * (nama file di repo selalu `mangkaneN.mp3`, makanya command `mengkane` dipetakan
 *  ke `mangkane` saat menyusun URL). Audio dikirim sebagai file, tanpa biaya emerald.
 */
import axios from 'axios'
import { embedAudioCover } from '../../lib/audioCover.js'
import { getCollectionCover } from '../../lib/musicCover.js'

const MIN = 1
const MAX = 54
const SPLIT = 24 // 1..24 dari hyuura, 25..54 dari aisyah-rest

/** Alamat file mengkane ke-N (nama file di repo = `mangkaneN.mp3`). */
function source(n) {
  return n <= SPLIT
    ? `https://raw.githubusercontent.com/hyuura/Rest-Sound/main/HyuuraKane/mangkane${n}.mp3`
    : `https://raw.githubusercontent.com/aisyah-rest/mangkane/main/Mangkanenya/mangkane${n}.mp3`
}

// `.mengkane1` … `.mengkane54` + ejaan alternatif `.mangkaneN` biar gampang diketik
const LIST = ['mangkane']
for (let i = MIN; i <= MAX; i++) {
  LIST.push(`mengkane${i}`)
  LIST.push(`mangkane${i}`)
}

const pluginConfig = {
  name: 'mengkane',
  alias: LIST,
  category: 'media',
  description: `Musik mengkane (mengkane${MIN} - mengkane${MAX})`,
  usage: `.mengkane1 sampai .mengkane${MAX} (alias .mangkaneN)`,
  example: '.mengkane1',
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
  '🎵 *ᴍᴇɴɢᴋᴀɴᴇ ᴍᴜsɪᴄ*\n\n' +
  `> Tersedia: \`.mengkane${MIN}\` – \`.mengkane${MAX}\`\n` +
  `> Contoh: \`${ctx.prefix}mengkane1\` (alias \`${ctx.prefix}mangkane1\`)`

async function handler(ctx) {
  const num = Number.parseInt(String(ctx.command || '').replace(/\D/g, ''), 10)
  if (!Number.isFinite(num) || num < MIN || num > MAX) return ctx.reply(help(ctx))

  await ctx.react('🕕')
  try {
    await sendAudio(ctx, source(num), `mengkane${num}.mp3`)
    await ctx.react('✅')
  } catch (err) {
    await ctx.react('❌')
    const notFound = err?.status === 404
    return ctx.reply(
      notFound
        ? `❌ Audio *mengkane${num}* tidak ada.`
        : `❌ Gagal mengambil audio *mengkane${num}* — coba lagi ya.`
    )
  }
}

export { pluginConfig as config, handler }
