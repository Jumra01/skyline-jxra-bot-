/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * status.js — Status karakter + inventory Nusantara Wilds.
 * Dompet (gold/gems) = satu dompet reward (users.sqlite).
 */
import { createCharacter, getInventory, getActiveQuests } from '../../core/rpg.js'
import { getBalance } from '../../core/database.js'
import { itemInfo } from '../../core/shop.js'
import { TIER_ICON } from '../../src/rpg/dropTable.js'
import { restStage, fmtSec } from '../../src/rpg/flavor.js'
import config from '../../config.js'

const pluginConfig = {
  name: "status",
  alias: ['satchel', 'inv', 'inventory'],
  category: "rpg",
  description: "Status karakter + inventory Nusantara Wilds",
  usage: ".status",
  example: ".status",
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
    const char = createCharacter(ctx.sender, ctx.pushName)
    const inv = getInventory(ctx.sender)
    const bal = getBalance(ctx.sender)

    const lines = inv
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)
      .map((row) => {
        const it = itemInfo(row.item_id)
        const icon = it ? TIER_ICON[it.tier] : '•'
        const name = it?.name ?? row.item_id
        return `│ ${icon} ${name} ×${row.amount}`
      })

    const more = inv.length > 15 ? `\n│ … +${inv.length - 15} item lainnya` : ''
    const empty = '│ Satchel-mu masih kosong.\n│ Rimba di luar sana menunggumu — coba .hunt / .forage / .fish.'

    const restLine = char.resting
      ? `\n│ 🛖 Sedang beristirahat: *${Math.floor(char.restProgress * 100)}%*\n│    ${restStage(char.restProgress)}\n│    ⏳ Sisa ${fmtSec(char.restRemaining)}\n`
      : ''

    await ctx.reply(
`╭─🧭「 *NUSANTARA WILDS* 」🧭─
│
│ 👤 ${char.name} — Level ${char.level}
│ ⭐ XP: ${char.xp}/${char.level * 100}
│ 🟩 ${bal.emerald}/${Math.max(1, Number(config.emerald?.max) || 64)} emerald • 💰 ${bal.gold}G • 💎 ${bal.gems}
│ 📍 Lokasi: ${char.location}
│
│ ❤️ HP: ${char.hp}/${char.max_hp}
│ ⚡ Energi: ${char.energy}/${char.max_energy}
│ 💪 Stamina: ${char.stamina}/${char.max_stamina}${restLine}
│
│ 🎒 *SATCHEL* (${inv.length} jenis)
${lines.length ? lines.join('\n') : empty}${more}
│
╰────────────────────✦╯`
    )
  }

export { pluginConfig as config, handler };
