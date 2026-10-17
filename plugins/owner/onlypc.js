/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * onlypc.js — Mode bot hanya di private chat (global).
 *
 * Pakai:
 *   .onlypc        → lihat status + tombol on/off
 *   .onlypc on     → aktif (tanpa tombol)
 *   .onlypc off    → nonaktif
 * Aktif → semua pesan non-owner di grup diabaikan.
 * Aktif → mode onlyGc otomatis nonaktif.
 */
import { getGlobal, setGlobal } from '../../core/groupSettings.js'
import { onRichReply } from '../../handlers/messageHandler.js'

const KEY = 'onlyPc'
const OTHER = 'onlyGc'

function statusText() {
  const on = getGlobal(KEY) === '1'
  return (
    `💬 *ONLY PRIVATE*\n\n` +
    `> Status: *${on ? 'Aktif ✅' : 'Nonaktif ❌'}*\n\n` +
    `_Jika aktif, bot hanya merespon di private chat._\n` +
    `_Mode Only Group otomatis nonaktif._`
  )
}

function ensureHandlers() {
  onRichReply('onlypc:on', async (ctx) => {
    setGlobal(KEY, '1')
    setGlobal(OTHER, '0')
    await ctx.react('✅')
    await ctx.reply(
      `💬 *ONLY PRIVATE AKTIF*\n\n` +
      `> Bot hanya merespon di private chat\n` +
      `> Mode Only Group dinonaktifkan\n\n` +
      `_Matikan: ${ctx.prefix}onlypc off_`
    )
  })
  onRichReply('onlypc:off', async (ctx) => {
    setGlobal(KEY, '0')
    await ctx.react('❌')
    await ctx.reply(
      `💬 *ONLY PRIVATE NONAKTIF*\n\n` +
      `> Bot bisa diakses di mana saja (public)`
    )
  })
}
ensureHandlers()

const pluginConfig = {
  name: 'onlypc',
  alias: ['onlyprivate', 'privateonly'],
  category: 'owner',
  description: 'Mode bot hanya di private chat (global)',
  usage: '.onlypc',
  example: '.onlypc',
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
        ? `💬 *ONLY PRIVATE AKTIF*\n\n> Bot hanya merespon di private chat\n> Mode Only Group dinonaktifkan`
        : `💬 *ONLY PRIVATE NONAKTIF*\n\n> Bot bisa diakses di mana saja (public)`
    )
    return
  }
  await ctx.replyButtons({
    text: statusText(),
    footer: 'skyline-JXRA',
    buttons: [
      { id: 'onlypc:on', text: '✅ Aktifkan' },
      { id: 'onlypc:off', text: '❌ Nonaktif' }
    ]
  })
}

export { pluginConfig as config, handler }
