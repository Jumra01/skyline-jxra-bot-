/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * antidelete.js — Kirim ulang pesan yang dihapus (anti-delete) di grup.
 *
 *   .antidelete on|off   → nyalakan/matikan di grup ini (admin grup/staff)
 *
 * Yang di-cache cuma METADATA + objek pesan asli (bukan file), maks 100 pesan
 * per grup, TTL 30 menit. Media (foto/video/audio/dokumen/stiker) baru
 * diunduh dari CDN WhatsApp saat pesannya benar-benar dihapus, jadi memori
 * tetap kecil walau grup ramai.
 */
import { downloadMediaMessage } from 'zapo-js'
import { isOn, setOn } from '../../core/groupSettings.js'
import { isGroupAdmin } from '../../core/permission.js'
import { addMessageHook, addProtocolHook } from '../../core/liveHooks.js'
import { jidDigits } from '../../lib/waGroup.js'
import { logger } from '../../core/logger.js'

const KEY = 'antidelete'
const MAX_CACHE = 100
const TTL = 30 * 60 * 1000
const DOWNLOAD_TIMEOUT = 20_000

// Kirim mentah tanpa reply-style global (`.setreply`) — kalau dibungkus varian
// v9, seluruh teks ikut di-bold-kan Unicode, jadi notifikasi ini jadi aneh.
const SEND_OPTS = { noStyle: true }

// Batas ukuran media yang mau dikirim ulang (byte).
const MAX_BYTES = {
  image: 16 * 1024 * 1024,
  video: 32 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 32 * 1024 * 1024,
  sticker: 8 * 1024 * 1024,
}

const cache = new Map() // chat -> Map(id -> { sender, name, text, kind, at, message })

// Bisa diganti saat tes programatik (default: unduh dari CDN WhatsApp).
let downloader = downloadMediaMessage

const pluginConfig = {
  name: 'antidelete',
  alias: ['antihapus'],
  category: 'group',
  description: 'Kirim ulang pesan grup yang dihapus (teks + media)',
  usage: '.antidelete on|off',
  example: '.antidelete on',
  isOwner: false,
  isPremium: false,
  isGroup: true,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 0,
  isEnabled: true,
}

const digits = (jid) => {
  try {
    return jidDigits(String(jid || ''))
  } catch {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  }
}

/** Buka pembungkus view-once / dokumen-bercaption, ambil node isi pesan. */
function unwrap(message) {
  let cur = message
  for (let i = 0; i < 5 && cur; i++) {
    const next =
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.viewOnceMessageV2Extension?.message ||
      cur.documentWithCaptionMessage?.message
    if (!next) break
    cur = next
  }
  return cur || {}
}

/** Kenali jenis isi pesan + ambil node media-nya (undefined = bukan media). */
function mediaInfo(message) {
  const m = unwrap(message)
  if (m.imageMessage) return { kind: 'image', node: m.imageMessage }
  if (m.videoMessage) return { kind: 'video', node: m.videoMessage }
  if (m.ptvMessage) return { kind: 'video', node: m.ptvMessage }
  if (m.audioMessage) return { kind: 'audio', node: m.audioMessage }
  if (m.stickerMessage) return { kind: 'sticker', node: m.stickerMessage }
  if (m.documentMessage) return { kind: 'document', node: m.documentMessage }
  return { kind: 'text', node: null }
}

/** Jenis pesan buat cadangan kalau media gagal diunduh. */
function kindLabel(kind) {
  return (
    {
      image: 'foto',
      video: 'video',
      audio: 'audio',
      sticker: 'stiker',
      document: 'dokumen',
      text: 'pesan',
    }[kind] || kind
  )
}

function cacheMessage(ctx) {
  const chat = ctx.chat
  const id = ctx.event?.key?.id
  if (!id) return
  if (ctx.event?.key?.fromMe) return
  if (!isOn(chat, KEY)) return

  let bucket = cache.get(chat)
  if (!bucket) {
    bucket = new Map()
    cache.set(chat, bucket)
  }

  const body = String(ctx.body || '').trim()
  const { kind } = mediaInfo(ctx.event?.message)
  const senderNumber = digits(ctx.sender)
  bucket.set(id, {
    sender: senderNumber,
    // JID buat mention asli (tag yang bisa diketuk + notifikasi).
    mentionJid: String(ctx.sender || '').includes('@') ? String(ctx.sender) : `${senderNumber}@s.whatsapp.net`,
    name: String(ctx.pushName || '').slice(0, 40),
    text: body.slice(0, 1000),
    kind,
    at: Date.now(),
    // Objek pesan asli disimpan buat unduh media nanti (isinya key + URL, bukan file).
    message: ctx.event?.message || null,
  })

  if (bucket.size > MAX_CACHE) {
    const oldest = [...bucket.keys()].slice(0, bucket.size - MAX_CACHE)
    for (const k of oldest) bucket.delete(k)
  }
}

function sweep() {
  const now = Date.now()
  for (const [chat, bucket] of cache) {
    for (const [id, v] of bucket) {
      if (now - v.at > TTL) bucket.delete(id)
    }
    if (!bucket.size) cache.delete(chat)
  }
}

async function streamToBuffer(stream, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > maxBytes) {
      stream.destroy?.()
      throw new Error('media terlalu besar')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Unduh media dari objek pesan yang di-cache (dengan batas waktu + ukuran). */
async function fetchMedia(entry) {
  const { kind, node } = mediaInfo(entry.message)
  if (!node) return null
  const limit = MAX_BYTES[kind] || 16 * 1024 * 1024

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('unduh media timeout')), DOWNLOAD_TIMEOUT)
    timer.unref?.()
  })

  try {
    const stream = await Promise.race([
      downloader(entry.message, { maxBytes: limit }),
      timeout,
    ])
    const buffer = await Promise.race([streamToBuffer(stream, limit), timeout])
    return { kind, node, buffer, mimetype: node.mimetype || '' }
  } finally {
    clearTimeout(timer)
  }
}

function headerFor(entry, deleter) {
  // Cukup token mention saja (`@<nomor>`) + opsi `mentions` — WhatsApp sendiri
  // yang menampilkan nama kontak/partisipan, jadi jangan dobel nama di teks.
  const tag = `@${entry.sender}`
  const name = String(entry.name || '').trim()
  const jam = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
  const oleh = deleter && deleter !== name ? `\n🧹 Dihapus oleh : ${deleter}` : ''
  return (
    `🗑️ *PESAN DIHAPUS*\n\n` +
    `👤 Pengirim : ${tag}\n` +
    `🕒 Dihapus  : ${jam} WIB${oleh}\n`
  )
}

/** Opsi kirim: mentah (tanpa reply-style) + mention asli kalau ada JID. */
function sendOpts(entry) {
  return entry?.mentionJid ? { ...SEND_OPTS, mentions: [entry.mentionJid] } : SEND_OPTS
}

/** Kirim ulang sesuai jenis media; balikin true kalau berhasil. */
async function resendMedia(client, chat, entry, deleter) {
  const media = await fetchMedia(entry)
  if (!media) return false

  const { kind, node, buffer, mimetype } = media
  const header = headerFor(entry, deleter)
  const caption = entry.text ? `${header}\n📝 Caption:\n${entry.text}` : `${header}\n📎 (${kindLabel(kind)} tanpa teks)`

  if (kind === 'image') {
    await client.message.send(chat, { type: 'image', media: buffer, mimetype: mimetype || 'image/jpeg', caption }, sendOpts(entry))
  } else if (kind === 'video') {
    await client.message.send(chat, { type: 'video', media: buffer, mimetype: mimetype || 'video/mp4', caption }, sendOpts(entry))
  } else if (kind === 'sticker') {
    // Stiker tidak punya caption — kirim keterangan dulu, lalu stikernya.
    await client.message.send(chat, `${header}\n📎 Stiker`, sendOpts(entry))
    await client.message.send(chat, { type: 'sticker', media: buffer, mimetype: 'image/webp' }, sendOpts(entry))
  } else if (kind === 'audio') {
    await client.message.send(chat, {
      type: 'audio',
      media: buffer,
      mimetype: mimetype || 'audio/ogg; codecs=opus',
      ptt: Boolean(node.ptt),
      caption,
    }, sendOpts(entry))
  } else if (kind === 'document') {
    await client.message.send(chat, {
      type: 'document',
      media: buffer,
      mimetype: mimetype || 'application/octet-stream',
      fileName: String(node.fileName || `pesan-dihapus-${Date.now()}`),
      caption,
    }, sendOpts(entry))
  } else {
    return false
  }
  return true
}

addMessageHook('antidelete', async (ctx) => {
  try {
    cacheMessage(ctx)
  } catch (err) {
    logger.debug({ err: String(err?.message || err) }, '[Antidelete] cache gagal')
  }
})

addProtocolHook('antidelete', async (client, event) => {
  const pm = event?.protocolMessage
  if (!pm?.key?.id) return
  if (pm.editedMessage) return // edit pesan, bukan hapus

  const chat = String(event.chatJid || event.key?.remoteJid || '')
  if (!chat.endsWith('@g.us')) return
  if (!isOn(chat, KEY)) return

  const bucket = cache.get(chat)
  const entry = bucket?.get(pm.key.id)
  if (!entry) return
  bucket.delete(pm.key.id)

  const deleter = String(event.pushName || '').slice(0, 40) || null

  // Media (foto/video/audio/dokumen/stiker) → unduh & kirim ulang apa adanya.
  if (mediaInfo(entry.message).node) {
    try {
      const ok = await resendMedia(client, chat, entry, deleter)
      if (ok) return
    } catch (err) {
      logger.warn(
        { err: String(err?.message || err), kind: entry.kind },
        '[Antidelete] media gagal dikirim ulang, jatuh ke teks'
      )
    }
  }

  const isi = entry.text
    ? entry.text
    : `(${kindLabel(entry.kind)} tanpa teks)`

  try {
    await client.message.send(chat, `${headerFor(entry, deleter)}\n📝 Isi pesan:\n${isi}`, sendOpts(entry))
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, '[Antidelete] gagal kirim ulang')
  }
})

// Bersihin cache lama tiap 10 menit (tanpa timer yang nahan proses).
const sweeper = setInterval(sweep, 10 * 60 * 1000)
sweeper.unref?.()

async function handler(ctx) {
  if (!ctx.isGroup) return ctx.reply('🚫 Khusus grup.')
  if (!(await isGroupAdmin(ctx))) return ctx.reply('🚫 Khusus admin grup / staff bot.')

  const arg = String(ctx.text || '').trim().toLowerCase()
  if (!arg) {
    const on = isOn(ctx.chat, KEY)
    return ctx.reply(
      `🗑️ *ANTI-DELETE* — ${on ? 'AKTIF ✅' : 'MATI ❌'}\n\n` +
        `Kalau aktif, pesan yang dihapus di grup ini bakal dikirim ulang bot — ` +
        `teks, foto, video, audio, dokumen, dan stiker.\n\n` +
        `> \`${ctx.prefix}antidelete on\` / \`${ctx.prefix}antidelete off\``
    )
  }

  if (!/^(on|off|enable|disable|nyala|mati)$/i.test(arg)) {
    return ctx.reply(`Format: \`${ctx.prefix}antidelete on\` atau \`${ctx.prefix}antidelete off\``)
  }

  const on = /^(on|enable|nyala)$/i.test(arg)
  setOn(ctx.chat, KEY, on)
  if (!on) cache.delete(ctx.chat)
  return ctx.reply(`${on ? '✅' : '🚫'} Anti-delete ${on ? 'diaktifkan' : 'dimatikan'} di grup ini.`)
}

export { pluginConfig as config, handler }

// Diekspor buat tes programatik (loader cuma baca `config` + `handler`).
export const _internals = {
  unwrap,
  mediaInfo,
  streamToBuffer,
  kindLabel,
  setDownloader: (fn) => {
    downloader = fn || downloadMediaMessage
  },
}
