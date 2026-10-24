/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * permission.js — Helper permission grup.
 *
 * Role grup dibaca dari flag resmi zapo: isAdmin / isSuperAdmin (boolean),
 * dengan fallback string role/rank buat kompatibilitas. Identitas dicocokkan
 * lewat semua bentuk jid participant (PN & LID).
 */

/** Return 'superadmin' | 'admin' | null buat satu participant. */
export async function getGroupRole(client, chat, sender, senderLid) {
  try {
    const meta = await client.group.queryGroupMetadata(chat)
    const me = (meta.participants ?? []).find((p) => {
      const ids = [p.jid, p.lid, p.phoneJid, p.pnJid, p.id, p.participantJid, p.jidAlt, p.lidJid]
      return ids.includes(sender) || (senderLid && ids.includes(senderLid))
    })
    if (!me) return null
    if (me.isSuperAdmin || me.rank === 'superadmin' || me.role === 'superadmin') return 'superadmin'
    if (me.isAdmin || me.rank === 'admin' || me.role === 'admin') return 'admin'
    return null
  } catch {
    return null
  }
}

/** Staff bot otomatis lolos; selain itu harus admin/superadmin grup. */
export async function isGroupAdmin(ctx) {
  if (ctx.isAdmin) return true
  const role = await getGroupRole(ctx.client, ctx.chat, ctx.sender, ctx.senderLid)
  return role === 'admin' || role === 'superadmin'
}

/** Bot sendiri harus admin grup — buat feature.botAdmin (template skyline). */
export async function isBotGroupAdmin(ctx) {
  try {
    const me = ctx.client?.auth?.getCurrentCredentials?.()
    const meJid = me?.meJid
    if (!meJid) return false
    const meDigits = String(meJid).split('@')[0].split(':')[0].replace(/\D/g, '')
    const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
    return (meta.participants ?? []).some((p) => {
      const ids = [p.jid, p.lid, p.phoneJid, p.pnJid, p.id, p.participantJid, p.jidAlt, p.lidJid]
      const hit = ids.some((id) => id && (id === meJid || String(id).split('@')[0].replace(/\D/g, '') === meDigits))
      return hit && (p.isAdmin || p.isSuperAdmin || p.rank === 'admin' || p.rank === 'superadmin' || p.role === 'admin' || p.role === 'superadmin')
    })
  } catch {
    return false
  }
}
