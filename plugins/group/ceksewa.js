/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ceksewa.js — Cek status sewa grup tempat perintah ini dikirim.
 */
import { getSewaState } from '../../lib/sewaClient.js'

const pluginConfig = {
  name: 'ceksewa',
  alias: ['sisasewa', 'statussewa'],
  category: 'group',
  description: 'Cek sisa sewa grup ini',
  usage: '.ceksewa',
  example: '.ceksewa',
  isOwner: false,
  isPremium: false,
  isGroup: true,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
  energi: 0,
}

function tanggal(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
}

async function handler(ctx) {
  try {
    const state = await getSewaState({ force: true })
    if (!state.enabled) {
      return ctx.reply('✅ Mode sewa sedang *MATI*. Semua grup boleh memakai bot.')
    }

    const g = (state.groups || []).find((row) => row.groupJid === ctx.chat)
    if (!g) {
      return ctx.reply(
`🔒 *GRUP INI BELUM DISEWA*

Bot belum bisa dipakai di grup ini.
Silakan hubungi owner bot untuk informasi sewa.

_Mode sewa aktif._`
      )
    }

    if (g.status === 'lifetime') {
      return ctx.reply(
`✅ *SEWA PERMANENT*

• Grup : ${g.groupName || g.groupJid}
• Status: ♾ Selamanya
• Penyewa: ${g.tenantName || '-'}`
      )
    }

    if (g.status === 'expired') {
      return ctx.reply(
`⛔ *SEWA SUDAH HABIS*

• Grup : ${g.groupName || g.groupJid}
• Habis : ${tanggal(g.expiresAt)}
• Penyewa: ${g.tenantName || '-'}

Hubungi owner bot untuk perpanjang.`
      )
    }

    return ctx.reply(
`✅ *SEWA AKTIF*

• Grup : ${g.groupName || g.groupJid}
• Sisa : *${g.daysLeft} hari*
• s/d : ${tanggal(g.expiresAt)}
• Penyewa: ${g.tenantName || '-'}`
    )
  } catch (err) {
    console.error('[ceksewa]', err?.message || String(err))
    return ctx.reply('⚠️ Status sewa sedang tidak bisa dicek. Coba lagi sebentar.')
  }
}

export { pluginConfig as config, handler }
