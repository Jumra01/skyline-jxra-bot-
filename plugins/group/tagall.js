/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * tagall.js — tag semua member grup dengan mention ASLI (`@<nomor>`).
 *
 * Kenapa harus token `@<digits>`: WhatsApp cuma merender link mention (dan
 * menggantinya dengan NAMA kontak sesuai yang disimpan di HP masing-masing
 * penerima) kalau digitnya ada di teks DAN jid-nya ada di `mentions`/
 * `mentionedJid`. Tanpa token, tag tetap "senyap" tapi gak ada nama tampil.
 *
 * Jadi: token ditulis menyambung dalam satu paragraf (ikut wrap otomatis),
 * BUKAN daftar nomor satu per baris. Nama yang muncul = nama kontak di device
 * masing-masing member (bot gak bisa maksa nama tertentu).
 *
 * Cek admin via helper resmi (isAdmin/isSuperAdmin flag zapo).
 */
import { isGroupAdmin } from '../../core/permission.js'

const pluginConfig = {
  name: "tagall",
  alias: ['tall', 'mentionall'],
  category: "group",
  description: "Tag semua member grup — mention asli, tampil sebagai nama kontak (admin grup/staff)",
  usage: ".tagall <teks>",
  example: ".tagall rapat jam 8",
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

/** `628xx:12@s.whatsapp.net` → `628xx` */
const digitsOf = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')

/**
 * Buang device suffix (`628xx:12@s.whatsapp.net` → `628xx@s.whatsapp.net`).
 * WA mencocokkan token `@628xx` dengan user part jid di `mentionedJid`, jadi
 * jid yang masih membawa `:12` bikin mention GAGAL di-render jadi nama
 * (tokennya cuma jadi teks biasa) walau pesannya tetap terkirim.
 */
const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/, '')

/**
 * Jid yang dipakai sebagai token mention. PN diutamakan supaya WhatsApp
 * meresolve nama kontak dengan benar, sisa identitas (LID/PN) tetap
 * dimasukkan ke `mentionedJid` biar notifikasi sampai di grup LID maupun PN.
 */
function tokenJidOf(p) {
  const jid = normalizeJid(p?.jid)
  if (p?.phoneNumber) return normalizeJid(p.phoneNumber)
  return jid
}

async function handler(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('🚫 Command ini khusus grup.')
      return
    }

    if (!(await isGroupAdmin(ctx))) {
      await ctx.reply('🚫 Khusus Admin grup / Staff bot.')
      return
    }

    const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
    const parts = (meta.participants ?? []).filter((p) => p?.jid)
    if (!parts.length) {
      await ctx.reply('⚠️ Gak ada participant yang bisa di-tag.')
      return
    }

    const tokens = []
    const mentionJids = new Set()
    const seen = new Set()

    for (const p of parts) {
      const tokenJid = tokenJidOf(p)
      const digits = digitsOf(tokenJid)
      if (!digits) continue
      // Satu orang cukup sekali (hindari token dobel kalau ada multi-jid)
      if (seen.has(digits)) continue
      seen.add(digits)
      tokens.push(`@${digits}`)
      if (tokenJid) mentionJids.add(tokenJid)
      for (const id of [p.jid, p.lid, p.phoneNumber]) {
        const norm = normalizeJid(id)
        if (norm) mentionJids.add(norm)
      }
    }

    const caption = (ctx.text || '📢 Semua kumpul sini!').trim()
    const text = [`*TAGALL* — ${meta.subject ?? 'Grup'}`, '', caption, '', tokens.join(' ')].join('\n')

    await ctx.client.message.send(ctx.chat, {
      extendedTextMessage: {
        text,
        contextInfo: { mentionedJid: [...mentionJids] }
      }
    })
  }

export { pluginConfig as config, handler };
