/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * demote.js — .demote: turunkan admin grup jadi member biasa.
 * Logika bareng `.promote` ada di `lib/groupAdmin.js`.
 */
import { rankAction } from '../../lib/groupAdmin.js'

const pluginConfig = {
  name: "demote",
  alias: [],
  category: "group",
  description: "Turunkan admin grup jadi member biasa (tag atau nomor)",
  usage: ".demote <tag/nomor>",
  example: ".demote @user",
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
  return rankAction(ctx, 'demote')
}

export { pluginConfig as config, handler };
