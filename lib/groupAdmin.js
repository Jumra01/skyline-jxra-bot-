/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * groupAdmin.js — Logika aksi admin grup yang dipakai bareng beberapa plugin:
 *   • `rankAction(ctx, 'promote' | 'demote')`   → `.promote` / `.demote`
 *   • `memberAction(ctx, 'kick' | 'add')`       → `.kick` / `.add`
 *
 * Semua target dicocokkan dulu ke participant metadata grup, jadi aman buat
 * grup PN-addressed maupun LID-addressed (kirimnya `participant.jid` asli).
 * Error WhatsApp diterjemahin lewat `waErrText()` — chat gak nampilin lagi
 * pesan mentah `group.xxx iq failed (409: ...)`.
 */
import config from '../config.js'
import { isGroupAdmin } from '../core/permission.js'
import { normalizeNumber } from '../core/staff.js'
import { sendMention } from '../core/lid.js'
import {
  findParticipant,
  botParticipant,
  isParticipantAdmin,
  sameUser,
  waErrText,
  failedResults
} from './waGroup.js'

/** Ambil target mentah: mention dulu, kalau gak ada baru nomor dari args. */
function rawTarget(ctx) {
  if (ctx.mentioned?.[0]) return ctx.mentioned[0]
  const num = normalizeNumber(ctx.args?.[0] ?? '')
  return num ? `${num}@s.whatsapp.net` : ''
}

/** Guard bareng: harus di grup + pengirim admin grup/staff. */
async function guard(ctx, label) {
  if (!ctx.isGroup) {
    await ctx.reply('🚫 Khusus grup.')
    return false
  }
  if (!(await isGroupAdmin(ctx))) {
    await ctx.reply('🚫 Khusus Admin grup / Staff bot.')
    return false
  }
  return true
}

/* ══════════════════════ promote / demote ══════════════════════ */

export async function rankAction(ctx, mode = 'promote') {
  const promote = mode === 'promote'
  const verb = promote ? 'promote' : 'demote'
  if (!(await guard(ctx, verb))) return

  const raw = rawTarget(ctx)
  if (!raw) {
    await ctx.reply(
      `Format:\n• ${ctx.prefix}${verb} <tag orangnya>\n• ${ctx.prefix}${verb} 628xxx`
    )
    return
  }

  let meta
  try {
    meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
  } catch (err) {
    await ctx.reply(`😵 Gak bisa baca data grup: ${waErrText(err)}`)
    return
  }

  const target = findParticipant(meta, raw)
  if (!target) {
    await ctx.reply('🚫 Dia bukan anggota grup ini (atau udah keluar).')
    return
  }

  const creds = ctx.client?.auth?.getCurrentCredentials?.() ?? null
  const bot = botParticipant(meta, creds)
  if (bot && !isParticipantAdmin(bot)) {
    await ctx.reply('🛡 Bot harus jadi ADMIN grup dulu buat ngatur admin lain.')
    return
  }
  if (sameUser(target.jid, bot?.jid)) {
    await ctx.reply(`🚫 Gak bisa ${verb} bot sendiri.`)
    return
  }

  const targetAdmin = isParticipantAdmin(target)
  if (promote && targetAdmin) {
    await sendMention(ctx.client, ctx.chat, target.jid, 'ℹ️ @user udah admin grup dari tadi.')
    return
  }
  if (!promote && !targetAdmin) {
    await sendMention(ctx.client, ctx.chat, target.jid, 'ℹ️ @user emang bukan admin grup.')
    return
  }

  try {
    const group = ctx.client.group
    const results = promote
      ? await group.promoteParticipants(ctx.chat, [target.jid])
      : await group.demoteParticipants(ctx.chat, [target.jid])

    const { failed } = failedResults(results)
    if (failed.length) {
      await ctx.reply(`😵 WhatsApp nolak ${verb}: ${failed[0].text}`)
      return
    }

    await sendMention(
      ctx.client,
      ctx.chat,
      target.jid,
      promote ? '⬆️ @user sekarang admin grup.' : '⬇️ @user bukan admin lagi.'
    )
  } catch (err) {
    await ctx.reply(`😵 Gagal ${verb}: ${waErrText(err)}`)
  }
}

/* ══════════════════════ kick / add ══════════════════════ */

export async function memberAction(ctx, mode = 'kick') {
  const kick = mode === 'kick'
  const verb = kick ? 'kick' : 'add'
  if (!(await guard(ctx, verb))) return

  const raw = rawTarget(ctx)
  if (!raw) {
    await ctx.reply(
      `Format:\n• ${ctx.prefix}${verb} <tag orangnya>\n• ${ctx.prefix}${verb} 628xxx`
    )
    return
  }

  let meta
  try {
    meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
  } catch (err) {
    await ctx.reply(`😵 Gak bisa baca data grup: ${waErrText(err)}`)
    return
  }

  const target = findParticipant(meta, raw)

  // Proteksi owner bot (pakai nomor asli: PN atau phoneNumber participant).
  const targetNumber = target?.phoneNumber?.split('@')[0] ?? raw.split('@')[0].split(':')[0]
  const targetStaff = config.staff.find((s) => s.number === targetNumber)
  if (targetStaff?.role === 'owner') {
    await ctx.reply(`🚫 Gak bisa ${verb} sesama owner!`)
    return
  }

  const creds = ctx.client?.auth?.getCurrentCredentials?.() ?? null
  const bot = botParticipant(meta, creds)
  if (bot && !isParticipantAdmin(bot)) {
    await ctx.reply(
      kick
        ? '🛡 Bot harus jadi ADMIN grup dulu buat nge-kick member.'
        : '🛡 Bot harus jadi ADMIN grup dulu buat nambah member.'
    )
    return
  }
  if (target && sameUser(target.jid, bot?.jid)) {
    await ctx.reply(`🚫 Gak bisa ${verb} bot sendiri.`)
    return
  }

  if (kick) {
    if (!target) {
      await ctx.reply('🚫 Dia bukan anggota grup ini.')
      return
    }
    if (isParticipantAdmin(target)) {
      await sendMention(
        ctx.client,
        ctx.chat,
        target.jid,
        '🚫 @user masih admin grup — turunin dulu pakai .demote.'
      )
      return
    }
  } else if (target) {
    await sendMention(ctx.client, ctx.chat, target.jid, 'ℹ️ @user udah ada di grup ini.')
    return
  }

  // `add` boleh nomor baru (belum anggota), `kick` wajib pakai jid asli grup.
  const jid = target?.jid ?? raw

  try {
    const results = kick
      ? await ctx.client.group.removeParticipants(ctx.chat, [jid])
      : await ctx.client.group.addParticipants(ctx.chat, [jid])

    const { failed } = failedResults(results)
    if (failed.length) {
      await ctx.reply(`😵 WhatsApp nolak ${verb}: ${failed[0].text}`)
      return
    }

    await sendMention(
      ctx.client,
      ctx.chat,
      jid,
      kick ? '🚪 @user di-kick dari grup.' : '✅ @user ditambahkan ke grup.'
    )
  } catch (err) {
    await ctx.reply(`😵 Gagal ${verb}: ${waErrText(err)}`)
  }
}

export const _internals = { rawTarget, guard }
