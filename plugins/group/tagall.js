/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * tagall.js — tag semua member grup, tampil sebagai DAFTAR NAMA (bukan @nomor).
 *
 * `mentionedJid` tetap diisi semua participant (biar tiap orang kena notif tag),
 * tapi isi teksnya cuma nama display/user — jadi pesannya rapi, gak ada
 * deretan `@628xxx` satu per satu.
 *
 * Cek admin via helper resmi (isAdmin/isSuperAdmin flag zapo).
 */
import { isGroupAdmin } from '../../core/permission.js'

const pluginConfig = {
  name: "tagall",
  alias: ['tall', 'mentionall'],
  category: "group",
  description: "Tag semua member grup — tampil sebagai daftar nama (admin grup/staff)",
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

const MAX_NAME = 40

/** Nama tampilan member: displayName → username → nomor (tanpa @). */
function nameOf(p) {
  const raw =
    p?.displayName ||
    p?.username ||
    p?.phoneNumber?.split('@')[0]?.split(':')[0] ||
    p?.jid?.split('@')[0]?.split(':')[0] ||
    'Member'
  // Buang newline & rapikan spasi biar daftar tetap satu baris per member
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Member'
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

    const jids = parts.map((p) => p.jid)
    const caption = (ctx.text || '📢 Semua kumpul sini!').trim()
    const list = parts.map((p, i) => `${i + 1}. ${nameOf(p)}`).join('\n')

    const text = [
      `*TAGALL* — ${meta.subject ?? 'Grup'}`,
      '',
      caption,
      '',
      list,
      '',
      `👥 ${parts.length} member`
    ].join('\n')

    // mentionedJid = semua member (masing-masing kena tag), teksnya cuma nama.
    await ctx.client.message.send(ctx.chat, {
      extendedTextMessage: {
        text,
        contextInfo: { mentionedJid: jids }
      }
    })
  }

export { pluginConfig as config, handler };
