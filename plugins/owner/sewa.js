/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * sewa.js — Kelola sewa grup (sumber data: D1 skyline.web.id, bukan file lokal).
 *
 * .sewa              → kartu panduan rich HTML (tema bareng)
 * .sewa help         → kartu panduan: cara add/renew/del + format durasi
 * .sewa status|list  → kartu statistik / daftar grup
 * .sewa on|off       → nyalakan/matikan mode sewa
 * .sewa add [target] [durasi]   → daftarkan/perpanjang grup
 * .sewa del [target]            → hapus sewa
 * .sewa renew [target] [durasi] → perpanjang (akumulatif)
 * .sewa list         → daftar lengkap
 * .sewa sync         → tarik ulang cache dari server
 */
import { getSewaState, sewaAction } from '../../lib/sewaClient.js'
import { richDoc, esc, payloadBytes, getThemeKey, THEMES, THEME_ORDER } from '../../lib/richTheme.js'
import { sendNativeHtml } from '../../lib/emeraldCard.js'

const pluginConfig = {
  name: 'sewa',
  alias: ['sewabot', 'addsewa', 'delsewa', 'renewsewa', 'listsewa', 'sewalist', 'perpanjangsewa'],
  category: 'owner',
  description: 'Kelola sewa grup bot (mode, daftar, tambah, perpanjang, hapus)',
  usage: '.sewa [help|status|list|on|off|add|del|renew|sync]\n.sewa add [target] <durasi> [nama penyewa]',
  example: '.sewa help · .sewa add <link gc> 1m Budi · .sewa list',
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

/* ────────────────── Kartu rich HTML (tema bareng) ────────────────── */

async function sendCard(ctx, html, fallbackText) {
  try {
    if (payloadBytes(html) > 24000) throw new Error('HTML terlalu besar')
    await sendNativeHtml(ctx.client, ctx.chat, html)
    return true
  } catch (err) {
    console.error('[sewa] kartu gagal, fallback teks:', err?.message || String(err))
    await ctx.reply(fallbackText)
    return false
  }
}

function badgeStatus(g) {
  if (g.status === 'lifetime') return '<span class="life">♾ Permanent</span>'
  if (g.status === 'active') return `<span class="ok">✅ Aktif · ${g.daysLeft} hari</span>`
  return '<span class="bad">⛔ Expired</span>'
}

function buildSewaHtml(state, tab = 'guide') {
  const s = state.stats || { total: 0, active: 0, expired: 0, lifetime: 0 }
  const mode = state.enabled ? 'AKTIF' : 'MATI'
  const modeNote = state.enabled
    ? 'Grup belum terdaftar / expired tidak bisa pakai command. Bot tetap tinggal di grup.'
    : 'Semua grup boleh memakai bot. Daftarkan grup dulu sebelum mode dinyalakan.'

  const steps = [
    {
      t: '1 · Nyalakan mode sewa',
      d: 'Gerbakan mulai berfungsi. Sebelum ini, semua grup tetap bebas.',
      c: '.sewa on'
    },
    {
      t: '2 · Daftarkan grup',
      d: 'Tempel link undangan grup. Kalau kirim dari dalam grup itu, link boleh kosong.',
      c: '.sewa add <link gc> 1m Budi'
    },
    {
      t: '3 · Tambah masa sewa',
      d: 'Akumulatif kalau sewa masih aktif. `.sewa add ...` juga bisa dipakai.',
      c: '.sewa renew <link gc> 1m'
    },
    {
      t: '4 · Hapus sewa',
      d: 'Grup langsung kena gate saat mode sewa aktif. Bot tidak keluar grup.',
      c: '.sewa del <link gc>'
    },
    {
      t: '5 · Cek & kelola',
      d: 'Lihat daftar, paksa refresh cache, atau matikan mode sewa.',
      c: '.sewa list · .sewa sync · .ceksewa · .sewa off'
    }
  ]

  const tabs = [
    ['guide', '📖 PANDUAN'],
    ['status', '📊 STATUS'],
    ['list', '📋 DAFTAR'],
    ['theme', '🎨 TEMA']
  ].map(([k, label]) =>
    `<button class="tab${k === tab ? ' on' : ''}" data-v="${k}" onclick="sv('${k}')">${label}</button>`
  ).join('')

  const guide = `
    <div class="card acc"><div class="k">Mode sewa saat ini</div><div class="big">${mode}</div>
      <div class="line" style="margin-top:5px">${esc(modeNote)}</div></div>
    <div class="card"><div class="k">Cara sewa · owner only</div>
      ${steps.map(x => `<div class="step"><div class="no">${x.t[0]}</div><div><div class="t">${esc(x.t.slice(2))}</div>
        <div class="d">${esc(x.d)}</div><div class="mono">${esc(x.c)}</div></div></div>`).join('')}
    </div>
    <div class="card"><div class="k">Format durasi</div>
      <span class="tag a">1m = 30 hari</span><span class="tag">7d</span><span class="tag">12h</span>
      <span class="tag">1w</span><span class="tag">1y</span><span class="tag">lifetime</span>
      <div class="line" style="margin-top:7px">Angka polos = hari. Menit pakai <b>mnt</b> (contoh 30mnt). Perpanjangan dihitung dari sisa waktu, bukan dari sekarang.</div>
    </div>`

  const status = `
    <div class="grid4">
      <div class="stat"><div class="n">${s.total}</div><div class="l">TOTAL</div></div>
      <div class="stat"><div class="n">${s.active}</div><div class="l">AKTIF</div></div>
      <div class="stat"><div class="n">${s.expired}</div><div class="l">EXPIRED</div></div>
      <div class="stat"><div class="n">${s.lifetime}</div><div class="l">PERMANENT</div></div>
    </div>
    <div class="card acc" style="margin-top:8px"><div class="k">Mode sewa</div><div class="big">${mode}</div>
      <div class="line" style="margin-top:5px">${esc(modeNote)}</div></div>
    <div class="card"><div class="k">Sinkronisasi</div>
      <div class="line">Bot menyimpan salinan di cache 2 menit. Perubahan dari WA / server langsung dibaca ulang setelah aksi, atau paksa dengan:</div>
      <div class="mono">.sewa sync</div>
    </div>`

  const listRows = (state.groups || []).map(g =>
    `<div class="row"><div class="n">${esc(g.groupName || g.groupJid)}</div>
      <div class="m">${esc(g.groupJid)}</div>
      <div class="s">${badgeStatus(g)} · ${esc(g.tenantName || '-')} · s/d ${esc(g.isLifetime ? 'selamanya' : tanggal(g.expiresAt))}</div>
    </div>`
  ).join('')
  const list = `<div class="card"><div class="k">Grup terdaftar · ${state.groups?.length || 0}</div>
    ${listRows || '<div class="line" style="padding:10px 0">Belum ada grup disewa. Mulai dengan <b>.sewa add &lt;link gc&gt; 1m</b>.</div>'}
    </div>`

  const themeKey = getThemeKey()
  const theme = `<div class="card acc"><div class="k">Tema aktif</div>
      <div class="big" id="rCmd">.theme ${esc(themeKey)}</div>
      <div class="line" style="margin-top:5px">Tema dipakai semua kartu rich HTML. Klik untuk pratinjau, simpan lewat perintah.</div>
    </div>
    <div class="card"><div class="k">Pilih tema · <span data-rtheme>${esc(THEMES[themeKey].name)}</span></div>
      <div class="sw">${THEME_ORDER.map(k =>
        `<button class="${k === themeKey ? 'on' : ''}" onclick="st('${k}')">${esc(THEMES[k].name)}</button>`
      ).join('')}</div>
      <div class="mono">.theme &lt;nama&gt;</div>
    </div>`

  const views = [
    ['guide', guide], ['status', status], ['list', list], ['theme', theme]
  ].map(([k, html]) => `<div class="view${k === tab ? ' on' : ''}" id="v_${k}">${html}</div>`).join('')

  const body = `<div class="hd"><div class="top">
      <div class="logo">💼</div>
      <div><div class="ttl">SEWA GRUP BOT</div><div class="sub">Kelola · <span data-rtheme>${esc(THEMES[themeKey].name)}</span></div></div>
      <span class="pill${state.enabled ? '' : ' off'}">${mode}</span>
    </div><div class="tabs">${tabs}</div></div>
    <div class="scroll">${views}</div>
    <div class="ft">Owner only · <b>.sewa help</b> untuk buka kartu ini lagi</div>`

  const script = `function sv(v){['guide','status','list','theme'].forEach(function(x){
    var e=document.getElementById('v_'+x);if(e)e.className='view'+(x===v?' on':'');
  });document.querySelectorAll('.tab').forEach(function(b){
    b.className='tab'+(b.getAttribute('data-v')===v?' on':'');
  });}`

  return richDoc({ title: 'Sewa Grup Bot', body, extraScript: script })
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

  const keywords = new Set(['sync', 'on', 'off', 'add', 'renew', 'del', 'delete', 'hapus', 'list', 'status', 'help', '?', 'panduan'])
  if (!keywords.has(sub) && looksLikeTarget(args[0])) {
    args.unshift('add')
    sub = 'add'
  }

  try {
    if (sub === 'help' || sub === '?' || sub === 'panduan') {
      const state = await getSewaState()
      await sendCard(ctx, buildSewaHtml(state, 'guide'), ringkas(state))
      return
    }

    if (sub === 'sync') {
      const state = await getSewaState({ force: true })
      await sendCard(ctx, buildSewaHtml(state, 'status'), `🔄 Cache sewa disegarkan.\n\n${ringkas(state)}`)
      return
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
      await sendCard(ctx, buildSewaHtml(state, 'list'), daftar(state))
      return
    }

    if (sub === 'status') {
      const state = await getSewaState()
      await sendCard(ctx, buildSewaHtml(state, 'status'), ringkas(state))
      return
    }

    /* `.sewa` polos = kartu panduan (paling informatif untuk owner). */
    const state = await getSewaState()
    await sendCard(ctx, buildSewaHtml(state, 'guide'), ringkas(state))
  } catch (err) {
    console.error('[sewa plugin]', err?.message || String(err))
    return ctx.reply(`⚠️ ${err?.message || 'Gagal memproses sewa.'}`)
  }
}

export { pluginConfig as config, handler, buildSewaHtml }
