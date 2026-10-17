/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 */
import { loadFeatures } from '../loader.js'

const pluginConfig = {
  name: "reload",
  alias: [],
  category: "owner",
  description: "Muat ulang semua feature tanpa restart bot",
  usage: ".reload",
  example: ".reload",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    const { count, total, failed } = await loadFeatures()

    let text = `🔄 Feature dimuat ulang: ${count}/${total} feature aktif.`

    if (failed.length) {
      text += `\n\n❎ *${failed.length} gagal dimuat:*\n`
      text += failed.map(f => `• ${f.file}\n   ${f.reason.split(' -> ')[1] ?? f.reason}`).join('\n')
    }

    await ctx.reply(text)
  }

export { pluginConfig as config, handler };
