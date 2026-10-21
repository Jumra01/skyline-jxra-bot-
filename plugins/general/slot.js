/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * slot.js — Mesin slot bertaruh gold (.slot).
 *
 * 3 simbol sama = x5 (💎 x10), 2 sama = x2, selain itu hangus.
 */
import { getBalance, addReward, spendGold } from '../../core/database.js'

const pluginConfig = {
  name: 'slot',
  alias: ['judi', 'gacha'],
  category: 'general',
  description: 'Main slot bertaruh gold — 3 simbol sama dapat x5',
  usage: '.slot <taruhan>',
  example: '.slot 50',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 8,
  limit: 0,
  isEnabled: true,
}

const MIN_BET = 5
const MAX_BET = 500
const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '🍀', '💎']

const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]

function payout(reels, bet) {
  const [a, b, c] = reels
  if (a === b && b === c) return { mult: a === '💎' ? 10 : 5, label: 'JACKPOT!' }
  const pair = a === b || a === c || b === c
  if (pair) return { mult: 2, label: 'Dua sama' }
  return { mult: 0, label: 'Zonk' }
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const bet = Math.floor(Number(String(ctx.args?.[0] ?? '').replace(/[.,]/g, '')) || 0) || 10

  if (bet < MIN_BET || bet > MAX_BET) {
    return ctx.reply(`🎰 Taruhan harus antara *${MIN_BET}* dan *${MAX_BET}* gold.\n\nContoh: \`${p}slot 50\``)
  }

  const saldo = getBalance(ctx.sender).gold || 0
  if (saldo < bet) {
    return ctx.reply(`❌ Gold kamu cuma *${saldo.toLocaleString('id-ID')}* — nggak cukup buat taruhan *${bet}*.`)
  }

  const after = spendGold(ctx.sender, bet)
  if (!after) return ctx.reply('❌ Gagal motong gold — coba lagi.')

  const reels = [pick(), pick(), pick()]
  const { mult, label } = payout(reels, bet)
  const win = Math.floor(bet * mult)
  const finalGold = win > 0 ? (addReward(ctx.sender, { gold: win }).gold || 0) : (after.gold || 0)

  const frame = `┃ ${reels.join(' ┃ ')} ┃`

  if (!win) {
    return ctx.reply(
      `🎰 *SLOT* 🎰\n\n${frame}\n\n` +
        `😵 *${label}* — taruhan *${bet}* gold hangus.\n` +
        `🏦 Saldo: *${finalGold.toLocaleString('id-ID')}* gold`
    )
  }

  return ctx.reply(
    `🎰 *SLOT* 🎰\n\n${frame}\n\n` +
      `🎉 *${label}* — menang *${win.toLocaleString('id-ID')}* gold (x${mult})\n` +
      `🏦 Saldo: *${finalGold.toLocaleString('id-ID')}* gold`
  )
}

export { pluginConfig as config, handler }
