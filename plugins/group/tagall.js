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

/**
 * Buang device suffix (`628xx:12@s.whatsapp.net` → `628xx@s.whatsapp.net`).
 * WA mencocokkan token `@628xx` dengan user part jid di `mentionedJid`; jid
 * yang masih membawa `:12` bikin mention gagal di-render (token jadi teks).
 */
const normalizeJid = (jid) => String(jid || '').replace(/:\d+(?=@)/, '')

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

    const mentionJids = new Set()
    for (const p of parts) {
      // WAHA resolves "all" to each participant's group-native id and excludes
      // the bot. Use one id per participant; dual PN+LID ids can double-tag.
      const jid = normalizeJid(p.jid || p.phoneNumber || p.lid)
      if (jid) mentionJids.add(jid)
    }

    const me = ctx.client.auth?.getCurrentCredentials?.()
    for (const self of [me?.meJid, me?.meLid]) {
      const jid = normalizeJid(self)
      if (jid) mentionJids.delete(jid)
    }
    if (!mentionJids.size) {
      await ctx.reply('⚠️ Gak ada participant lain yang bisa di-tag.')
      return
    }

    const caption = (ctx.text || '📢 Semua kumpul sini!').trim()
    const text = [`*TAGALL* — ${meta.subject ?? 'Grup'}`, '', caption].join('\n')

    // Pola komunitas yang terbukti (WAHA `mentions: ["all"]`): resolve all
    // participant → kirim daftar JID di field mentions, tanpa token individual
    // di body. Padanan zapo yang benar adalah opsi send `mentions`, bukan raw
    // nonJidMentions atau content-level contextInfo.
    await ctx.client.message.send(
      ctx.chat,
      { type: 'text', text },
      { mentions: [...mentionJids] }
    )
  }

export { pluginConfig as config, handler };
