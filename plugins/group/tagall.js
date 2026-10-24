/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * tagall.js — mention KELIHATAN semua member + custom caption.
 *
 * Cek admin via helper resmi (isAdmin/isSuperAdmin flag zapo).
 */
import { isGroupAdmin } from '../../core/permission.js'

const pluginConfig = {
  name: "tagall",
  alias: ['tall', 'mentionall'],
  category: "group",
  description: "Mention kelihatan semua member + custom caption (admin grup/staff)",
  usage: ".tagall",
  example: ".tagall",
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
      await ctx.reply('🚫 Command ini khusus grup.')
      return
    }

    if (!(await isGroupAdmin(ctx))) {
      await ctx.reply('🚫 Khusus Admin grup / Staff bot.')
      return
    }

    const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
    const jids = meta.participants.map((p) => p.jid)
    const caption = ctx.text || '📢 Semua kumpul sini!'

    const tags = jids.map((j) => `@${j.split('@')[0]}`).join(' ')
    const text = `*TAGALL* — ${meta.subject ?? 'Grup'}\n${caption}\n\n${tags}`

    await ctx.client.message.send(ctx.chat, {
      extendedTextMessage: {
        text,
        contextInfo: { mentionedJid: jids }
      }
    })
  }

export { pluginConfig as config, handler };
