/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * tagall.js — mention semua anggota; token @user dirender sebagai nama kontak
 * masing-masing pada perangkat penerima.
 *
 * WhatsApp membutuhkan token `@<id>` di teks untuk merender mention/notifikasi;
 * metadata `mentionedJid` saja tidak membuat tag terlihat. JID token mengikuti
 * addressing mode grup (PN atau LID), lalu token ditulis sebaris agar ringkas.
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

    const me = ctx.client.auth?.getCurrentCredentials?.()
    const selfIds = new Set([me?.meJid, me?.meLid].filter(Boolean).map(normalizeJid))
    const mentionJids = new Set()
    const tokens = []
    const seen = new Set()

    for (const p of parts) {
      // Mention token must match the participant JID's addressing mode in this
      // group (PN or LID); WhatsApp resolves each @token to the local contact name.
      const jid = normalizeJid(p.jid || p.phoneNumber || p.lid)
      if (!jid || selfIds.has(jid)) continue
      const user = jid.split('@')[0]
      const digits = user.replace(/\D/g, '')
      if (!digits || seen.has(user)) continue
      seen.add(user)
      tokens.push(`@${digits}`)
      mentionJids.add(jid)
    }

    if (!tokens.length) {
      await ctx.reply('⚠️ Gak ada participant lain yang bisa di-tag.')
      return
    }

    const caption = (ctx.text || '📢 Semua kumpul sini!').trim()
    const text = [`*TAGALL* — ${meta.subject ?? 'Grup'}`, '', caption, '', tokens.join(' ')].join('\n')

    // Tiap peserta perlu token @<id> di body agar WA merender mention sebagai
    // nama kontak dan memberi notifikasi. noStyle menjaga mentions tidak hilang.
    await ctx.client.message.send(
      ctx.chat,
      { type: 'text', text },
      { mentions: [...mentionJids], noStyle: true }
    )
  }

export { pluginConfig as config, handler };
