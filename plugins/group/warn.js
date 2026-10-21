/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * warn.js — Sistem peringatan member grup.
 *
 *   .warn @user [alasan]   → tambah 1 peringatan (otomatis kick di 3)
 *   .unwarn @user          → kurangi 1 peringatan
 *   .warnlist              → daftar member yang kena warn
 *   .warnreset             → hapus semua peringatan di grup ini
 */
import { isGroupAdmin } from '../../core/permission.js'
import { normalizeNumber } from '../../core/staff.js'
import { jidDigits } from '../../lib/waGroup.js'
import { createJsonStore } from '../../lib/jsonStore.js'
import { memberAction } from '../../lib/groupAdmin.js'

const store = createJsonStore('./data/warns.json')

const MAX_WARN = 3

const pluginConfig = {
  name: 'warn',
  alias: ['peringatan', 'unwarn', 'warnlist', 'warnreset'],
  category: 'group',
  description: `Peringatan member grup — ${MAX_WARN}× warn otomatis di-kick`,
  usage: '.warn @user [alasan] | .unwarn @user | .warnlist | .warnreset',
  example: '.warn @user jangan spam',
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

function targetDigits(ctx) {
  if (ctx.mentioned?.[0]) return digits(ctx.mentioned[0])
  const num = normalizeNumber(ctx.args?.[0] ?? '')
  return num || ''
}

function groupWarns(chat) {
  return store.get(chat) || {}
}

function reasonOf(ctx) {
  const parts = [...(ctx.args || [])]
  if (parts.length && /^@|^\d/.test(parts[0])) parts.shift()
  return parts.join(' ').trim().slice(0, 150)
}

async function handler(ctx) {
  if (!ctx.isGroup) return ctx.reply('🚫 Khusus grup.')
  if (!(await isGroupAdmin(ctx))) return ctx.reply('🚫 Khusus admin grup / staff bot.')

  const cmd = String(ctx.command || 'warn').toLowerCase()

  if (cmd === 'warnlist' || (cmd === 'warn' && !targetDigits(ctx))) {
    const data = groupWarns(ctx.chat)
    const rows = Object.entries(data).filter(([, v]) => (v?.count || 0) > 0)
    if (!rows.length) return ctx.reply('✅ Belum ada member yang kena warn di grup ini.')
    const lines = rows
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
      .map(([num, v]) => {
        const last = v.reasons?.[v.reasons.length - 1]
        return `• @${num} — *${v.count}/${MAX_WARN}*${last?.reason ? `\n  ↳ ${String(last.reason).slice(0, 80)}` : ''}`
      })
    return ctx.reply(`⚠️ *DAFTAR WARN*\n\n${lines.join('\n')}\n\n> ${MAX_WARN}× warn = otomatis di-kick.`)
  }

  if (cmd === 'warnreset') {
    store.del(ctx.chat)
    return ctx.reply('🧹 Semua peringatan di grup ini dihapus.')
  }

  const target = targetDigits(ctx)
  if (!target) {
    return ctx.reply(
      `Format:\n• ${ctx.prefix}warn @user [alasan]\n• ${ctx.prefix}unwarn @user\n• ${ctx.prefix}warnlist`
    )
  }

  const data = groupWarns(ctx.chat)

  if (cmd === 'unwarn') {
    const cur = data[target]
    if (!cur?.count) return ctx.reply('ℹ️ Dia belum punya peringatan.')
    cur.count -= 1
    if (cur.count <= 0) delete data[target]
    store.set(ctx.chat, data)
    return ctx.reply(`✅ Peringatan untuk @${target} dikurangi. Sisa: *${Math.max(0, cur.count || 0)}/${MAX_WARN}*`)
  }

  // warn
  const reason = reasonOf(ctx) || 'tanpa alasan'
  const cur = data[target] || { count: 0, reasons: [] }
  cur.count += 1
  cur.reasons = [...(cur.reasons || []), { at: Date.now(), by: digits(ctx.sender), reason }].slice(-10)
  data[target] = cur
  store.set(ctx.chat, data)

  if (cur.count >= MAX_WARN) {
    await ctx.reply(
      `⛔ *BATAS WARN TERCAPAI*\n\n@${target} sudah *${cur.count}/${MAX_WARN}* peringatan.\n` +
        `Alasan terakhir: ${reason}\n\n> Member akan dikeluarkan dari grup.`
    )
    // Kick pakai jalur yang sama dengan `.kick` (target dari mention).
    await memberAction(ctx, 'kick')
    delete data[target]
    store.set(ctx.chat, data)
    return
  }

  return ctx.reply(
    `⚠️ *PERINGATAN ${cur.count}/${MAX_WARN}*\n\n` +
      `👤 Target : @${target}\n` +
      `📝 Alasan : ${reason}\n\n` +
      `> Sisa ${MAX_WARN - cur.count}× lagi sebelum di-kick.`
  )
}

export { pluginConfig as config, handler }
