/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * riwayat.js — Riwayat pemakaian emerald (.riwayat).
 *
 * Kartu HTML native (tema Minecraft, frame maks 9:16, 3 view:
 * notif / info user / riwayat) — data di-embed saat kirim.
 */
import { sendHistoryCard } from '../../lib/emeraldCard.js'

const pluginConfig = {
  name: "riwayat",
  alias: ['history'],
  category: "general",
  description: "Riwayat pemakaian emerald per command",
  usage: ".riwayat",
  example: ".riwayat",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
  energi: 0,
};

async function handler(ctx) {
    // Pola persis plugins/game/snake.js: langsung kirim, kalau gagal
    // LAPOR ke chat (jangan ditelan) biar kelihatan apa yang rusak.
    try {
      await sendHistoryCard(ctx)
      await ctx.react('📜')
    } catch (err) {
      await ctx.reply(JSON.stringify({ error: true, message: err?.message || String(err) }))
    }
  }

export { pluginConfig as config, handler };
