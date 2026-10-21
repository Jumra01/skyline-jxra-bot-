/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * pay.js — Transfer gold ke user lain (.pay).
 */
import { getBalance, addReward, spendGold } from '../../core/database.js'
import { normalizeNumber } from '../../core/staff.js'
import { jidDigits } from '../../lib/waGroup.js'

const pluginConfig = {
  name: 'pay',
  alias: ['transfer', 'tf'],
  category: 'general',
  description: 'Transfer gold ke user lain',
  usage: '.pay <jumlah> @user',
  example: '.pay 100 @user',
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

const MAX_TF = 100_000

const digits = (jid) => {
  try {
    return jidDigits(String(jid || ''))
  } catch {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  }
}

function targetOf(ctx) {
  if (ctx.mentioned?.[0]) return ctx.mentioned[0]
  const num = normalizeNumber(ctx.args?.[1] ?? '')
  return num ? `${num}@s.whatsapp.net` : ''
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const amount = Math.floor(Number(String(ctx.args?.[0] ?? '').replace(/[.,]/g, '')) || 0)
  const target = targetOf(ctx)

  if (!amount || amount < 1 || !target) {
    return ctx.reply(`💸 Format: \`${p}pay <jumlah> @user\`\nContoh: \`${p}pay 100 @user\``)
  }
  if (amount > MAX_TF) return ctx.reply(`❌ Maksimal transfer ${MAX_TF.toLocaleString('id-ID')} gold sekali kirim.`)
  if (digits(target) === digits(ctx.sender)) return ctx.reply('🚫 Nggak bisa transfer ke diri sendiri.')

  const saldo = getBalance(ctx.sender).gold || 0
  if (saldo < amount) {
    return ctx.reply(`❌ Gold kamu kurang.\n\n💰 Saldo: *${saldo.toLocaleString('id-ID')}* gold`)
  }

  const after = spendGold(ctx.sender, amount)
  if (!after) return ctx.reply('❌ Gagal motong gold — coba lagi.')

  addReward(target, { gold: amount })
  return ctx.reply(
    `✅ *TRANSFER BERHASIL*\n\n` +
      `👤 Ke     : @${digits(target)}\n` +
      `💰 Jumlah : *${amount.toLocaleString('id-ID')}* gold\n` +
      `🏦 Sisa   : *${(after.gold || 0).toLocaleString('id-ID')}* gold`
  )
}

export { pluginConfig as config, handler }
