/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 */
import config from '../../config.js'
import { touchUser, setBanned, topUsers, totalUsers } from '../../core/database.js'

const pluginConfig = {
  name: "ban",
  alias: ['unban', 'users'],
  category: "owner",
  description: "Ban/unban user (via nomor atau tag) & daftar user",
  usage: ".ban",
  example: ".ban",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: true,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    if (ctx.command === 'users') {
      const top = topUsers(10)
      const lines = top.map(
        (u, i) => `${i + 1}. +${u.jid.split('@')[0]} — ${u.command_count} cmd${u.banned ? ' 🚫' : ''}`
      )
      await ctx.reply(`👥 *TOTAL USER: ${totalUsers()}*\n\n${lines.join('\n') || '(belum ada user tercatat)'}`)
      return
    }

    let targetJid = ctx.mentioned?.[0]

    if (!targetJid) {
      const targetNumber = (ctx.args[0] ?? '').replace(/\D/g, '')
      if (!targetNumber) {
        await ctx.reply(
          `Format:\n• ${ctx.prefix}${ctx.command} 628123456789\n• ${ctx.prefix}${ctx.command} <tag orangnya>`
        )
        return
      }
      targetJid = `${targetNumber}@s.whatsapp.net`
    }

    const targetNumber = targetJid.split('@')[0].split(':')[0]
    const isLid = targetJid.endsWith('@lid')
    const label = isLid ? 'User yang di-tag' : `+${targetNumber}`

    const targetStaff = config.staff.find((s) => s.number === targetNumber)
    if (targetStaff?.role === 'owner') {
      await ctx.reply('🚫 Gak bisa ban/unban sesama owner!')
      return
    }

    if (ctx.command === 'ban') {
      touchUser(targetJid, null)
      setBanned(targetJid, true)
      await ctx.reply(`🚫 ${label} telah di-BAN.`)
    } else {
      setBanned(targetJid, false)
      await ctx.reply(`✅ ${label} telah di-unban.`)
    }
  }

export { pluginConfig as config, handler };
