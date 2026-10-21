/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * antidelete.js — Kirim ulang pesan yang dihapus (anti-delete) di grup.
 *
 *   .antidelete on|off   → nyalakan/matikan di grup ini (admin grup/staff)
 *
 * Pesan terakhir di-cache di memori (teks/caption saja, maks 100 per grup).
 * Begitu ada yang menghapus, bot kirim ulang isinya + siapa pengirimnya.
 */
import { isOn, setOn } from '../../core/groupSettings.js'
import { isGroupAdmin } from '../../core/permission.js'
import { addMessageHook, addProtocolHook } from '../../core/liveHooks.js'
import { jidDigits } from '../../lib/waGroup.js'
import { logger } from '../../core/logger.js'

const KEY = 'antidelete'
const MAX_CACHE = 100
const TTL = 30 * 60 * 1000

const cache = new Map() // chat -> Map(id -> { sender, name, text, kind, at })

const pluginConfig = {
  name: 'antidelete',
  alias: ['antihapus'],
  category: 'group',
  description: 'Kirim ulang pesan grup yang dihapus (anti-delete)',
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

function kindOf(message) {
  const key = Object.keys(message || {})[0] || ''
  return String(key).replace(/Message$/, '').toLowerCase() || 'pesan'
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
  bucket.set(id, {
    sender: digits(ctx.sender),
    name: String(ctx.pushName || '').slice(0, 40),
    text: body.slice(0, 1000),
    kind: kindOf(ctx.event?.message),
    at: Date.now(),
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

  const who = entry.name ? `${entry.name} (@${entry.sender})` : `@${entry.sender}`
  const isi = entry.text
    ? entry.text
    : entry.kind === 'sticker'
      ? '(stiker)'
      : `(${entry.kind} tanpa teks)`

  try {
    await client.message.send(
      chat,
      `🗑️ *PESAN DIHAPUS*\n\n` +
        `👤 Pengirim : ${who}\n` +
        `🕒 Dihapus  : ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
        `📝 Isi pesan:\n${isi}`
    )
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
        `Kalau aktif, pesan yang dihapus di grup ini bakal dikirim ulang bot.\n\n` +
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
