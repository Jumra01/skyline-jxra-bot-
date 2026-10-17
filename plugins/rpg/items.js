/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * items.js — Katalog lengkap item & item_id.
 */
import { ITEM_INDEX, TIER_ICON } from '../../src/rpg/dropTable.js'

const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const TIER_LABEL = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY'
}

const pluginConfig = {
  name: "items",
  alias: ['itemlist', 'katalog'],
  category: "rpg",
  description: "Katalog lengkap item & item_id Nusantara Wilds",
  usage: ".items",
  example: ".items",
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
    const blocks = []
    for (const tier of TIER_ORDER) {
      const items = Object.entries(ITEM_INDEX).filter(([, it]) => it.tier === tier)
      if (!items.length) continue
      blocks.push(
        `┌─「 ${TIER_ICON[tier]} *${TIER_LABEL[tier]}* 」\n` +
        items.map(([id, it]) => `│ • *${it.name}* _(${id})_ — ${it.value}G`).join('\n') +
        `\n└──────────`
      )
    }

    await ctx.reply(
`╭─📦「 *KATALOG ITEM* 」📦─
│
│ Gunakan _item_id_ di dalam
│ kurung untuk .sell / .craft.
│
${blocks.join('\n│\n')}
│
╰────────────────────✦╯`
    )
  }

export { pluginConfig as config, handler };
