/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 */
import config from '../../config.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { listFeatures } from '../loader.js'

onRichReply('rich:list-ping', async (ctx) => {
  const start = Date.now()
  await ctx.reply(`🏓 Pong!\n- Response: ${Date.now() - start}ms`)
})

onRichReply('rich:list-menu', async (ctx) => {
  const lines = listFeatures()
    .map((f) => `• ${config.mainPrefix}${f.name} — ${f.description}`)
    .join('\n')
  await ctx.reply(`*${config.botName}*\nPrefix: ${config.prefixes.join(' ')}\n\n${lines}`)
})

const pluginConfig = {
  name: "list",
  alias: ['layanan'],
  category: "interactive",
  description: "Contoh richMessage: list/menu single-select",
  usage: ".list",
  example: ".list",
  isOwner: false,
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
    await ctx.replyList({
      text: 'Pilih layanan yang kamu butuhkan:',
      footer: `${config.botName} • Interactive`,
      title: 'Layanan Kami',
      buttonText: 'Buka menu',
      sections: [
        {
          title: 'Umum',
          rows: [
            { id: 'rich:list-ping', title: '🏓 Ping', description: 'Cek status bot' },
            { id: 'rich:list-menu', title: '📖 Menu', description: 'Semua command yang tersedia' }
          ]
        }
      ]
    })
  }

export { pluginConfig as config, handler };
