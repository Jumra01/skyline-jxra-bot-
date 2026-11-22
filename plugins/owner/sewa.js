/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * sewa.js — Kelola sewa grup (sumber data: D1 skyline.web.id, bukan file lokal).
 *
 * .sewa              → status ringkas
 * .sewa on|off       → nyalakan/matikan mode sewa
 * .sewa add [target] [durasi]   → daftarkan/perpanjang grup
 * .sewa del [target]            → hapus sewa
 * .sewa renew [target] [durasi] → perpanjang (akumulatif)
 * .sewa list         → daftar lengkap
 * .sewa sync         → tarik ulang cache dari server
 */
import { getSewaState, sewaAction } from '../../lib/sewaClient.js'

const pluginConfig = {
  name: 'sewa',
  alias: ['sewabot', 'addsewa', 'delsewa', 'renewsewa', 'listsewa', 'sewalist', 'perpanjangsewa'],
  category: 'owner',
  description: 'Kelola sewa grup bot (mode, daftar, tambah, perpanjang, hapus)',
  usage: '.sewa [on|off|add|del|renew|list|sync]\n.sewa add [target] <durasi> [nama penyewa]',
  example: '.sewa add 30d Budi · .sewa list · .sewa off',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 2,
  limit: 1,
  isEnabled: true,
  energi: 0,
}

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|mnt|menit|m|h|jam|d|hari|w|minggu|mo|bulan|y|tahun|lifetime|permanent|forever|selamanya|0)?$/i

function isDuration(s) {
  return DURATION_RE.test(String(s ?? '').trim())
}

function tanggal(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}

function statusText(g) {
  if (g.status === 'lifetime') return '♾ Permanent'
  if (g.status === 'active') return `✅ Aktif · ${g.daysLeft} hari`
  return '⛔ Expired'
}

function ringkas(state) {
  const s = state.stats || { total: 0, active: 0, expired: 0, lifetime: 0 }
  return `╭─💼「 *SEWA GRUP* 」💼─╮
│
│ Mode sewa: *${state.enabled ? 'AKTIF' : 'MATI'}*
│ ${state.enabled ? 'Grup belum sewa tidak bisa pakai bot.' : 'Semua grup boleh pakai bot.'}
│
│ Total grup : *${s.total}*
│ Aktif      : *${s.active}*
│ Expired    : *${s.expired}*
│ Permanent  : *${s.lifetime}*
│
│ *.sewa list* — lihat daftar
│ *.sewa on|off* — ubah mode
╰────────────────────✦╯`
}

function daftar(state) {
  if (!state.groups?.length) return 'Belum ada grup yang disewa.'
  const rows = state.groups.map((g, i) =>
    `${i + 1}. ${g.groupName || g.groupJid}\n   ${g.groupJid}\n   ${statusText(g)} · ${g.tenantName || '-'} · s/d ${g.isLifetime ? 'selamanya' : tanggal(g.expiresAt)}`
  ).join('\n\n')
  return `💼 *DAFTAR SEWA GRUP* (${state.groups.length})\n\n${rows}\n\n*.sewa add <target> <durasi>* · *.sewa del <target>*`
}

async function resolveTarget(ctx, arg) {
  const raw = String(arg ?? '').trim()
  if (!raw) {
    if (!ctx.isGroup) return { error: 'Tentukan target atau jalankan perintah ini di dalam grup.' }
    let name = ''
    try {
      const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
      name = String(meta?.subject || '')
    } catch { /* metadata bisa gagal, JID tetap dipakai */ }
    return { jid: ctx.chat, name }
  }

  const invite = raw.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i)
  if (invite) {
    try {
      const info = await ctx.client.group.queryGroupInviteInfo(invite[1])
      if (!info?.jid) return { error: 'Link undangan tidak mengembalikan JID grup.' }
      return { jid: info.jid, name: String(info.subject || '') }
    } catch (err) {
      console.error('[sewa] resolve invite gagal:', err?.message || String(err))
      return { error: 'Link undangan tidak bisa dibaca. Pakai JID grup (120363xxx@g.us) atau buka .sewa add di dalam grup itu.' }
    }
  }

  if (raw.includes('@g.us')) return { jid: raw.replace(/:\d+@/, '@'), name: '' }
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 8) return { jid: `${digits}@g.us`, name: '' }
  return { error: 'Target tidak dikenal. Pakai JID grup, link chat.whatsapp.com, atau nomor grup.' }
}

/** `.sewa <link> 30d` diterima juga — owner sering lupa ketik `add`. */
function looksLikeTarget(s) {
  const v = String(s ?? '')
  return /chat\.whatsapp\.com\//i.test(v) || v.includes('@g.us') || /^\d{8,}$/.test(v.replace(/\D/g, ''))
}

function parseArgs(args, canDefaultGroup) {
  const a = args || []
  if (!a.length) return { targetArg: '', duration: '30d' }
  if (isDuration(a[0]) && a.length === 1 && canDefaultGroup) return { targetArg: '', duration: a[0] }
  if (isDuration(a[0]) && !canDefaultGroup) return { targetArg: '', duration: a[0] }
  return { targetArg: a[0] || '', duration: a[1] || '30d' }
}

async function handler(ctx) {
  const cmd = String(ctx.command || 'sewa').toLowerCase()
  const rawArgs = ctx.args || []

  /* Alias semua diarahkan ke sub-command supaya satu handler yang dirawat. */
  const aliasSub = {
    addsewa: 'add', delsewa: 'del', renewsewa: 'renew',
    perpanjangsewa: 'renew', listsewa: 'list', sewalist: 'list', sewabot: 'status'
  }[cmd]
  const args = aliasSub ? [aliasSub, ...rawArgs] : rawArgs.slice()
  let sub = String(args[0] || 'status').toLowerCase()

  const keywords = new Set(['sync', 'on', 'off', 'add', 'renew', 'del', 'delete', 'hapus', 'list', 'status'])
  if (!keywords.has(sub) && looksLikeTarget(args[0])) {
    args.unshift('add')
    sub = 'add'
  }

  try {
    if (sub === 'sync') {
      const state = await getSewaState({ force: true })
      return ctx.reply(`🔄 Cache sewa disegarkan.\n\n${ringkas(state)}`)
    }

    if (sub === 'on' || sub === 'off') {
      const enable = sub === 'on'
      const out = await sewaAction('toggle', { enabled: enable })
      return ctx.reply(`✅ Mode sewa *${out.enabled ? 'AKTIF' : 'MATI'}*.\n${out.enabled ? 'Grup belum sewa sekarang dapat peringatan.' : 'Semua grup boleh pakai bot.'}`)
    }

    if (sub === 'add' || sub === 'renew') {
      const tail = args.slice(1)
      const { targetArg, duration } = parseArgs(tail, ctx.isGroup)
      const tenantName = tail[2] ? String(tail[2]).trim().slice(0, 120) : ''
      const target = await resolveTarget(ctx, targetArg)
      if (target.error) return ctx.reply(`⚠️ ${target.error}`)
      const out = await sewaAction('add', {
        groupJid: target.jid,
        groupName: target.name,
        tenantName,
        duration
      })
      const sisa = out.lifetime ? 'selamanya' : tanggal(out.expiresAt)
      return ctx.reply(
        `✅ Sewa ${out.renewed ? 'diperpanjang' : 'ditambahkan'}.\n` +
        `• Grup: ${target.name || target.jid}\n` +
        `• JID: ${out.groupJid}\n` +
        `• Aktif s/d: *${sisa}*`
      )
    }

    if (sub === 'del' || sub === 'delete' || sub === 'hapus') {
      const target = await resolveTarget(ctx, args[1] || '')
      if (target.error) return ctx.reply(`⚠️ ${target.error}`)
      const out = await sewaAction('delete', { groupJid: target.jid })
      return ctx.reply(`🗑 Sewa dihapus: ${out.groupJid}`)
    }

    if (sub === 'list') {
      const state = await getSewaState({ force: true })
      return ctx.reply(daftar(state))
    }

    const state = await getSewaState()
    return ctx.reply(ringkas(state))
  } catch (err) {
    console.error('[sewa plugin]', err?.message || String(err))
    return ctx.reply(`⚠️ ${err?.message || 'Gagal memproses sewa.'}`)
  }
}

export { pluginConfig as config, handler }
