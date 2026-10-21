/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * add.js — .add: tambahkan orang ke grup (tag atau nomor).
 * Logika bareng `.kick` ada di `lib/groupAdmin.js`.
 */
import { memberAction } from '../../lib/groupAdmin.js'

const pluginConfig = {
  name: "add",
  alias: [],
  category: "group",
  description: "Tambahkan orang ke grup via nomor atau tag (admin grup/staff)",
  usage: ".add <nomor>",
  example: ".add 628xxx",
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
  return memberAction(ctx, 'add')
}

export { pluginConfig as config, handler };
