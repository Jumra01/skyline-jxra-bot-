/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * toggle.js — .on / .off / .enable / .disable <fitur>
 * Permission: staff bot atau admin grup. User biasa ditolak.
 */
import config from '../../config.js'
import { setOn } from '../../core/groupSettings.js'
import { isGroupAdmin } from '../../core/permission.js'

const pluginConfig = {
  name: "on",
  alias: ['off', 'enable', 'disable'],
  category: "group",
  description: "Nyalakan/matikan fitur grup (welcome, bye, dll)",
  usage: ".on",
  example: ".on",
  isOwner: false,
  isPremium: false,
  isGroup: true,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('🚫 Khusus grup.')
      return
    }

    if (!(await isGroupAdmin(ctx))) {
      await ctx.reply('🚫 Khusus admin grup / staff bot.')
      return
    }

    const key = (ctx.args[0] ?? '').toLowerCase()
    if (!config.toggleable.includes(key)) {
      await ctx.reply(`Fitur yang bisa di-toggle: ${config.toggleable.join(', ')}`)
      return
    }

    const on = ctx.command === 'on' || ctx.command === 'enable'
    setOn(ctx.chat, key, on)
    await ctx.reply(`${on ? '✅' : '🚫'} Fitur *${key}* ${on ? 'diaktifkan' : 'dimatikan'} di grup ini.`)
  }

export { pluginConfig as config, handler };
