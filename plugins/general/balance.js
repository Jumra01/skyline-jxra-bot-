/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * balance.js — Cek saldo: emerald 🟩 & gold & gems (wallet) + XP (karakter).
 */
import { getBalance } from '../../core/database.js'
import { getCharacter } from '../../core/rpg.js'
import config from '../../config.js'

const pluginConfig = {
  name: "balance",
  alias: ['bal', 'saldo'],
  category: "general",
  description: "Cek saldo reward kamu",
  usage: ".balance",
  example: ".balance",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
  energi: 0,
};

async function handler(ctx) {
    const bal = getBalance(ctx.sender)
    const char = getCharacter(ctx.sender)
    const name = ctx.pushName || 'User'
    const emMax = Math.max(1, Number(config.emerald?.max) || 64)

    await ctx.reply(
`╭─💰「 *SALDO ${name.toUpperCase()}* 」💰─╮
│
│ 🟩 Emerald: *${bal.emerald}/${emMax}*
│ 💰 Gold: *${bal.gold}*
│ 💎 Gems: *${bal.gems}*
│ ⭐ XP: *${char ? char.xp : 0}* (Lv.${char ? char.level : 1})
│
│ 🟩 Emerald buat bayar command;
│ regen *+10/10m*, klaim *.daily*,
│ riwayat di *.riwayat*.
│
╰────────────────────✦╯`
    )
  }

export { pluginConfig as config, handler };
