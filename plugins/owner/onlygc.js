/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * onlygc.js — Mode bot hanya di grup (global).
 *
 * Pakai:
 *   .onlygc        → lihat status + tombol on/off
 *   .onlygc on     → aktif (tanpa tombol)
 *   .onlygc off    → nonaktif
 * Aktif → semua pesan non-owner di private chat diabaikan.
 * Aktif → mode onlyPc otomatis nonaktif.
 */
import { getGlobal, setGlobal } from '../../core/groupSettings.js'
import { onRichReply } from '../../handlers/messageHandler.js'

const KEY = 'onlyGc'
const OTHER = 'onlyPc'

function statusText() {
  const on = getGlobal(KEY) === '1'
  return (
    `🏘️ *ONLY GROUP*\n\n` +
    `> Status: *${on ? 'Aktif ✅' : 'Nonaktif ❌'}*\n\n` +
    `_Jika aktif, bot hanya merespon di grup._\n` +
    `_Mode Only Private otomatis nonaktif._`
  )
}

function ensureHandlers() {
  onRichReply('onlygc:on', async (ctx) => {
    setGlobal(KEY, '1')
    setGlobal(OTHER, '0')
    await ctx.react('✅')
    await ctx.reply(
      `🏘️ *ONLY GROUP AKTIF*\n\n` +
      `> Bot hanya merespon di grup\n` +
      `> Mode Only Private dinonaktifkan\n\n` +
      `_Matikan: ${ctx.prefix}onlygc off_`
    )
  })
  onRichReply('onlygc:off', async (ctx) => {
    setGlobal(KEY, '0')
    await ctx.react('❌')
    await ctx.reply(
      `🏘️ *ONLY GROUP NONAKTIF*\n\n` +
      `> Bot bisa diakses di mana saja (public)`
    )
  })
}
ensureHandlers()

const pluginConfig = {
  name: 'onlygc',
  alias: ['onlygroup', 'grouponly'],
  category: 'owner',
  description: 'Mode bot hanya di grup (global)',
  usage: '.onlygc',
  example: '.onlygc',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true
}

async function handler(ctx) {
  const opt = (ctx.args[0] || '').toLowerCase()
  if (opt === 'on' || opt === 'off') {
    const on = opt === 'on'
    setGlobal(KEY, on ? '1' : '0')
    if (on) setGlobal(OTHER, '0')
    await ctx.react(on ? '✅' : '❌')
    await ctx.reply(
      on
        ? `🏘️ *ONLY GROUP AKTIF*\n\n> Bot hanya merespon di grup\n> Mode Only Private dinonaktifkan`
        : `🏘️ *ONLY GROUP NONAKTIF*\n\n> Bot bisa diakses di mana saja (public)`
    )
    return
  }
  await ctx.replyButtons({
    text: statusText(),
    footer: 'skyline-JXRA',
    buttons: [
      { id: 'onlygc:on', text: '✅ Aktifkan' },
      { id: 'onlygc:off', text: '❌ Nonaktif' }
    ]
  })
}

export { pluginConfig as config, handler }
