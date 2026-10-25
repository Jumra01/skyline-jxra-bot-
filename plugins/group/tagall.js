/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * tagall.js — tag SEMUA member grup, nama tiap orang tampil (mention asli).
 *
 * Fakta WhatsApp (sudah diuji di grup): token `@<digits>` hanya menotifikasi
 * & menampilkan SATU orang. Gak ada konsep "@semua"/"@everyone" — jid yang
 * cuma ada di `contextInfo.mentionedJid` tanpa token TIDAK jadi tag kelihatan
 * (gejalanya: cuma orang yang punya token yang ke-tag). Karena itu tiap
 * participant WAJIB punya token sendiri di teks.
 *
 * Tetap rapi: token ditulis menyambung dalam satu paragraf (wrap otomatis,
 * TIDAK satu-per-baris, tidak bernomor). Di HP masing-masing penerima, setiap
 * `@<nomor>` dirender jadi NAMA kontak yang mereka simpan sendiri.
 *
 * Cek admin via helper resmi (isAdmin/isSuperAdmin flag zapo).
 */
import { isGroupAdmin } from '../../core/permission.js'

const pluginConfig = {
  name: "tagall",
  alias: ['tall', 'mentionall'],
  category: "group",
  description: "Tag semua member grup — nama tiap member tampil (admin grup/staff)",
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
 * WA mencocokkan token `@628xx` dengan user part jid di `mentionedJid`; jid
 * yang masih membawa `:12` bikin mention gagal di-render (token jadi teks).
 */
const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/, '')

/**
 * Jid yang dipakai sebagai token mention: **jid participant apa adanya**
 * (`p.jid`). Jid dari metadata sudah mengikuti addressing mode grup — grup PN
 * berisi `@s.whatsapp.net`, grup LID berisi `@lid` — dan WhatsApp mencocokkan
 * token `@<digits>` dengan user part jid yang sama. Memaksa PN di grup LID
 * bikin token orang lain TIDAK ke-resolve jadi nama (hanya identitas bot/
 * pengirim sendiri yang tampil), jadi jangan diutamakan.
 * Fallback: phoneNumber → lid → jid.
 */
function tokenJidOf(p) {
  return normalizeJid(p?.jid) || normalizeJid(p?.phoneNumber) || normalizeJid(p?.lid)
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
      // Satu orang cukup sekali token-nya
      if (seen.has(digits)) continue
      seen.add(digits)
      tokens.push(`@${digits}`)
      if (tokenJid) mentionJids.add(tokenJid)
      // Identitas lain ikut di-mention biar notif sampai di grup LID maupun PN
      for (const id of [p.jid, p.lid, p.phoneNumber]) {
        const norm = normalizeJid(id)
        if (norm) mentionJids.add(norm)
      }
    }

    if (!tokens.length) {
      await ctx.reply('⚠️ Gak ada participant yang bisa di-tag.')
      return
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
