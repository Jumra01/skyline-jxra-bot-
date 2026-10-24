/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * setownertype.js — Mengatur varian tampilan .owner (1-5) ala Hoshino Ai
 */
import { getGlobal, setGlobal } from '../../core/groupSettings.js'

const pluginConfig = {
  name: 'setownertype',
  alias: ['ownertype', 'setowner'],
  category: 'owner',
  description: 'Mengatur jenis tampilan command .owner (1-5)',
  usage: '.setownertype <1-5>',
  example: '.setownertype 2',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 0,
  isEnabled: true,
  energi: 0
}

const MODES = {
  1: 'Teks Rapi + Single Contact Cards (VCard)',
  2: 'Carousel Interactive Cards (Foto + Tombol Chat wa.me)',
  3: 'Multi-Contact Array Card (VCard Group)',
  4: 'AIRich Post Card (Instagram Style)',
  5: 'AIRich Compact Entity (Verified Badge + Message Action)'
}

async function handler(ctx) {
  const current = getGlobal('ownerType') || 2
  const target = parseInt(ctx.args[0], 10)

  if (!target || target < 1 || target > 5) {
    let msg = `⚙️ *PENGATURAN TAMPILAN OWNER*\n\n`
    msg += `Mode aktif saat ini: *Type ${current}* (${MODES[current]})\n\n`
    msg += `Pilihan mode yang tersedia:\n`
    for (const [id, desc] of Object.entries(MODES)) {
      msg += `• *Type ${id}*: ${desc} ${Number(id) === current ? '✅' : ''}\n`
    }
    msg += `\nContoh perintah ubah:\n*.setownertype 2*`
    return ctx.reply(msg)
  }

  setGlobal('ownerType', target)
  return ctx.reply(`✅ Berhasil mengubah tampilan *.owner* menjadi *Type ${target}*: ${MODES[target]}`)
}

export { pluginConfig as config, handler }
