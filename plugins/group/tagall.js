/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * tagall.js — tag semua member grup, tapi teksnya cuma punya SATU `@user`.
 *
 * Cara kerjanya:
 * - `contextInfo.mentionedJid` diisi SEMUA participant → tiap member tetap
 *   dapat notifikasi "kamu disebut" (cara ini sama dengan `hidetag` di Hoshino:
 *   mention tidak butuh token di teks untuk sekadar menotifikasi).
 * - Teks hanya menuliskan SATU token `@<nomor>` (default: pengirim perintah),
 *   jadi tidak ada deretan `@user1 @user2 @user3` yang bikin pesan penuh tag.
 *
 * Catatan: WhatsApp gak punya konsep "@semua". Token `@<digits>` wajib ada di
 * teks kalau mau tampil sebagai link/nama; jid yang cuma ada di `mentions`
 * tetap menotifikasi tapi tidak tampil sebagai tag.
 *
 * Cek admin via helper resmi (isAdmin/isSuperAdmin flag zapo).
 */
import { isGroupAdmin } from '../../core/permission.js'

const pluginConfig = {
  name: "tagall",
  alias: ['tall', 'mentionall'],
  category: "group",
  description: "Tag semua member grup — teks cuma menampilkan satu tag (admin grup/staff)",
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

/** Jid yang dipakai sebagai token mention (PN diutamakan biar nama ke-resolve). */
function tokenJidOf(p) {
  const jid = normalizeJid(p?.jid)
  if (p?.phoneNumber) return normalizeJid(p.phoneNumber)
  return jid
}

/** Cari participant yang cocok dengan identitas pengirim (PN / LID). */
function findSelf(parts, ctx) {
  const mine = new Set(
    [ctx.sender, ctx.senderLid].map(normalizeJid).filter(Boolean)
  )
  if (!mine.size) return null
  return (
    parts.find((p) => {
      const ids = [p.jid, p.lid, p.phoneNumber].map(normalizeJid).filter(Boolean)
      return ids.some((id) => mine.has(id))
    }) ?? null
  )
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

    // mentionedJid = semua member (notif tag), teks cuma satu token.
    const mentionJids = new Set()
    for (const p of parts) {
      for (const id of [p.jid, p.lid, p.phoneNumber]) {
        const norm = normalizeJid(id)
        if (norm) mentionJids.add(norm)
      }
    }

    // Satu-satunya tag yang kelihatan: pengirim perintah (fallback: member #1).
    const self = findSelf(parts, ctx)
    const tokenSource = self ? tokenJidOf(self) : tokenJidOf(parts[0])
    const tokenDigits = digitsOf(tokenSource)

    const caption = (ctx.text || '📢 Semua kumpul sini!').trim()
    const lines = [`*TAGALL* — ${meta.subject ?? 'Grup'}`, '', caption]
    if (tokenDigits) lines.push('', `@${tokenDigits}`)

    await ctx.client.message.send(ctx.chat, {
      extendedTextMessage: {
        text: lines.join('\n'),
        contextInfo: { mentionedJid: [...mentionJids] }
      }
    })
  }

export { pluginConfig as config, handler };
