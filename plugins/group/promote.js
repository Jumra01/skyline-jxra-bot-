/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * promote.js — .promote: naikkan member jadi admin grup (tag atau nomor).
 * Logika bareng `.demote` ada di `lib/groupAdmin.js`.
 */
import { rankAction } from '../../lib/groupAdmin.js'

const pluginConfig = {
  name: "promote",
  alias: [],
  category: "group",
  description: "Jadikan member admin grup via tag atau nomor (admin grup/staff)",
  usage: ".promote <tag/nomor>",
  example: ".promote @user",
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
  return rankAction(ctx, 'promote')
}

export { pluginConfig as config, handler };
