/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * rest.js — Istirahat time-based: mulai rest, cek progress, narasi bertahap.
 * [UPDATE BELOW]
 *
 * Durasi mengikuti seberapa habisnya stats (30s – 10m).
 */
import { createCharacter, getCharacter, startRest } from '../../core/rpg.js'
import { FLAVOR, pick, restStage, fmtSec } from '../../src/rpg/flavor.js'

const pluginConfig = {
  name: "rest",
  alias: ['istirahat'],
  category: "rpg",
  description: "Beristirahat — pemulihan bertahap sesuai waktu",
  usage: ".rest",
  example: ".rest",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    const char = createCharacter(ctx.sender, ctx.pushName)

    // Sedang rest → tunjukin progress
    if (char.resting) {
      const pct = Math.floor(char.restProgress * 100)
      await ctx.reply(
`╭─「 *ISTIRAHAT* 」🛖─
│
│ ${restStage(char.restProgress)}
│
│ 🕰️ Progress: *${pct}%*
│ ⏳ Sisa waktu: ${fmtSec(char.restRemaining)}
│
│ ❤️ HP: ${char.hp}/${char.max_hp}
│ ⚡ Energi: ${char.energy}/${char.max_energy}
│ 💪 Stamina: ${char.stamina}/${char.max_stamina}
│
╰────────────────────✦╯`
      )
      return
    }

    // Udah penuh
    if (
      char.energy >= char.max_energy &&
      char.stamina >= char.max_stamina &&
      char.hp >= char.max_hp
    ) {
      await ctx.reply(pick(FLAVOR.fresh))
      return
    }

    // Mulai rest
    const { duration } = startRest(ctx.sender)
    await ctx.reply(
      `${pick(FLAVOR.startRest)}\n\n` +
      `🕰️ Perkiraan pemulihan: *${fmtSec(duration)}*\n` +
      `Cek progresmu kapan pun dengan *.rest* atau *.status*.`
    )
  }

export { pluginConfig as config, handler };
