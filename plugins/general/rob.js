/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * rob.js — Coba mencuri gold user lain (.rob).
 *
 * Peluang sukses 45%. Gagal = kena denda. Ada jeda 60 detik.
 */
import { getBalance, addReward, spendGold } from '../../core/database.js'
import { normalizeNumber } from '../../core/staff.js'
import { jidDigits } from '../../lib/waGroup.js'

const pluginConfig = {
  name: 'rob',
  alias: ['curi', 'maling'],
  category: 'general',
  description: 'Coba curi gold user lain (bisa gagal & kena denda)',
  usage: '.rob @user',
  example: '.rob @user',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 60,
  limit: 0,
  isEnabled: true,
}

const SUCCESS = 0.45
const MIN_VICTIM = 20
const FINE = 10

const digits = (jid) => {
  try {
    return jidDigits(String(jid || ''))
  } catch {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  }
}

function targetOf(ctx) {
  if (ctx.mentioned?.[0]) return ctx.mentioned[0]
  const num = normalizeNumber(ctx.args?.[0] ?? '')
  return num ? `${num}@s.whatsapp.net` : ''
}

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const target = targetOf(ctx)
  if (!target) return ctx.reply(`🕵️ Format: \`${p}rob @user\``)
  if (digits(target) === digits(ctx.sender)) return ctx.reply('🚫 Nggak bisa ngerampok diri sendiri.')

  const victim = getBalance(target).gold || 0
  if (victim < MIN_VICTIM) {
    return ctx.reply(
      `🥱 @${digits(target)} miskin — gold-nya cuma *${victim}*.\n> Minimal ${MIN_VICTIM} gold biar worth it.`
    )
  }

  if (Math.random() < SUCCESS) {
    const loot = Math.min(Math.max(1, Math.floor(victim * (rnd(5, 15) / 100))), 500)
    const taken = spendGold(target, loot)
    if (!taken) return ctx.reply('😵 Gagal — gold dia keburu habis.')

    addReward(ctx.sender, { gold: loot })
    return ctx.reply(
      `🕵️ *BERHASIL MERAMPOK!*\n\n` +
        `🎯 Target : @${digits(target)}\n` +
        `💰 Rampasan: *${loot.toLocaleString('id-ID')}* gold\n` +
        `🏦 Saldo kamu: *${(getBalance(ctx.sender).gold || 0).toLocaleString('id-ID')}* gold`
    )
  }

  const own = getBalance(ctx.sender).gold || 0
  const fine = Math.min(FINE, own)
  if (fine > 0) spendGold(ctx.sender, fine)

  return ctx.reply(
    `🚨 *KETAHUAN!*\n\n` +
      `Kamu gagal merampok @${digits(target)} dan malah kehilangan ` +
      `*${fine.toLocaleString('id-ID')}* gold.\n\n> Coba lagi nanti, jangan serakah 😅`
  )
}

export { pluginConfig as config, handler }
