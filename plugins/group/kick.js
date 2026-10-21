/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * kick.js — .kick: keluarkan member dari grup (tag atau nomor).
 * Logika bareng `.add` ada di `lib/groupAdmin.js`.
 */
import { memberAction } from '../../lib/groupAdmin.js'

const pluginConfig = {
  name: "kick",
  alias: [],
  category: "group",
  description: "Keluarkan member dari grup via tag atau nomor (admin grup/staff)",
  usage: ".kick <tag/nomor>",
  example: ".kick @user",
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
  return memberAction(ctx, 'kick')
}

export { pluginConfig as config, handler };
