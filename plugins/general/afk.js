/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * afk.js — Status AFK (.afk) + auto-jawab saat di-tag.
 *
 * - `.afk <alasan>`  → tandai AFK
 * - `.afk off`       → cabut AFK
 * - otomatis dicabut saat yang bersangkutan kirim pesan
 * - kalau ada yang tag / balas pesan orang AFK, bot kasih tahu alasannya
 */
import { jidDigits } from '../../lib/waGroup.js'
import { createJsonStore } from '../../lib/jsonStore.js'
import { addMessageHook } from '../../core/liveHooks.js'
import { addMentionHandler } from '../../core/mentionTrigger.js'

const store = createJsonStore('./data/afk.json')

const pluginConfig = {
  name: 'afk',
  alias: ['away', 'sibuk'],
  category: 'general',
  description: 'Tandai lagi AFK — auto-balas kalau ada yang tag',
  usage: '.afk <alasan> | .afk off',
  example: '.afk sholat dulu',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 0,
  isEnabled: true,
}

const MAX_REASON = 120
const NOTICE_GAP = 5 * 60 * 1000

const lastNotice = new Map() // `${chat}|${user}` -> timestamp

const digits = (jid) => {
  try {
    return jidDigits(String(jid || ''))
  } catch {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  }
}

export function isAfk(jid) {
  return Boolean(store.get(digits(jid)))
}

export function afkInfo(jid) {
  return store.get(digits(jid)) || null
}

function sinceText(ms) {
  const s = Math.max(0, Math.floor((Date.now() - Number(ms || 0)) / 1000))
  if (s < 60) return `${s} detik`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} menit`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} jam ${m % 60} menit`
  return `${Math.floor(h / 24)} hari`
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function handler(ctx) {
  const key = digits(ctx.sender)
  const arg = String(ctx.text || '').trim()

  if (/^(off|stop|balik|cabut|hapus)$/i.test(arg)) {
    if (!store.get(key)) return ctx.reply('Kamu nggak sedang AFK.')
    store.del(key)
    return ctx.reply('✅ Status AFK dicabut. Selamat kembali!')
  }

  const reason = (arg || 'tanpa alasan').slice(0, MAX_REASON)
  const old = store.get(key)
  store.set(key, { reason, at: old?.at || Date.now() })

  return ctx.reply(
    `💤 *AFK DIAKTIFKAN*\n\n` +
      `📝 Alasan : ${reason}\n` +
      `🕒 Sejak  : ${sinceText(Date.now())} lalu\n\n` +
      `> Status hilang otomatis begitu kamu kirim pesan lagi.\n` +
      `> Cabut manual: \`${ctx.prefix || '.'}afk off\``
  )
}

/* ── otomatis cabut AFK begitu orangnya kirim pesan ───────────────────── */
addMessageHook('afk', async (ctx) => {
  const key = digits(ctx.sender)
  const info = store.get(key)
  if (!info) return
  store.del(key)
  await ctx.reply(
    `👋 *${String(ctx.pushName || 'Kamu').slice(0, 40)}* sudah kembali!\n\n` +
      `> AFK dicabut otomatis (alasan sebelumnya: ${String(info.reason || '-').slice(0, 80)})`
  )
})

/* ── kasih tahu kalau ada yang tag / balas orang AFK ──────────────────── */
async function onMention(ctx) {
  if (!ctx.isGroup && !ctx.isPrivate) return false

  const targets = new Set()
  for (const jid of ctx.mentioned || []) targets.add(digits(jid))

  // orang yang dibalas/di-quote
  const event = ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
  const raw = event?.message ?? event ?? {}
  for (const key of Object.keys(raw || {})) {
    const node = raw[key]
    const ci = node && typeof node === 'object' ? node.contextInfo : null
    if (ci?.participant) targets.add(digits(ci.participant))
  }

  targets.delete(digits(ctx.sender))
  if (!targets.size) return false

  const lines = []
  for (const key of targets) {
    const info = store.get(key)
    if (!info) continue
    const cacheKey = `${ctx.chat}|${key}`
    const last = lastNotice.get(cacheKey) || 0
    if (Date.now() - last < NOTICE_GAP) continue
    lastNotice.set(cacheKey, Date.now())
    lines.push(`• @${key} — ${String(info.reason || 'tanpa alasan').slice(0, MAX_REASON)} (${sinceText(info.at)})`)
  }
  if (!lines.length) return false

  lastNotice.set(`${ctx.chat}|${digits(ctx.sender)}`, Date.now())
  await ctx.reply(
    `💤 *SEDANG AFK*\n\n` +
      lines.join('\n') +
      `\n\n> Pesan jangan diharap dibalas cepat ya.`
  )
  return false // biar fitur AI lain tetap bisa jawab kalau memang di-tag
}

addMentionHandler('afk', onMention, 90)

export { pluginConfig as config, handler }
