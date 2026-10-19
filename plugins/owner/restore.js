/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * restore.js — Balikin SETTING & apikey dari backup, tanpa menyentuh kode.
 *
 * `.updatesc` sekarang memulihkan setting OTOMATIS setelah update sukses,
 * jadi command ini jarang dibutuhkan — pakai kalau auto-restore gagal atau
 * kalau mau balikin manual kapan aja. Setting yang dulu di-backup ke
 * `config.js.update.bak` + `updatesc-keep.bak/` tetap aman: karena cuma
 * file setting yang disentuh, script yang barusan ke-update TETAP versi
 * terbaru.
 *
 * Pakai:
 *   .restore              → lihat isi backup + pilihan tombol
 *   .restore all          → balikin API + thumbnail sekaligus
 *   .restore api          → balikin API di config.js doang
 *   .restore thumb        → balikin thumbnail doang
 *
 * Thumbnail yang isinya cuma default (user belum pernah ganti) sengaja
 * DILEWAT — biar gak ngebatalin update default dari repo.
 *
 * Backup yang BERHASIL dipulihkan ikut DIHAPUS (biar gak numpuk);
 * yang gagal tetap disimpan buat dicoba ulang. `.updatesc` berikutnya
 * bikin backup baru lagi dari nilai yang ada sekarang.
 *
 * Catatan: balikin API di config.js butuh RESTART biar kebaca bot.
 */
import { onRichReply } from '../../handlers/messageHandler.js'
import { backupStatus, restoreFromBackup } from '../../lib/keepSettings.js'
import { normalizeBackup } from '../../lib/keepMigrate.js'

// Label tampilan — SENGAJA lokal (bukan export baru dari lib/keepSettings.js):
// hot reload cuma re-import `plugins/`, sedangkan `lib/` masih versi lama di
// module cache. Kalau plugin import nama export BARU dari lib, plugin gagal
// load setelah `.updatesc` sampai bot di-restart.
const KEEP_LABELS = {
  'skyline.apikey': 'API',
  'omniedit.apikey': 'API', // backup lama sebelum blok omniedit digabung
  'spotify.clientId': 'Spotify ID',
  'spotify.clientSecret': 'Spotify Secret'
}
const labelOf = (name) => KEEP_LABELS[name] || name
const uniqueLabels = (names) => [...new Set((names || []).map(labelOf))]

const SC_MAP = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'Q', r: 'ʀ',
  s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
}
const toSmallCaps = (t) => [...String(t).toLowerCase()].map((c) => SC_MAP[c] || c).join('')

function card(emoji, title, lines) {
  const out = [`╭─〔 ${emoji} \`${toSmallCaps(title)}\` 〕─⬣`]
  for (const l of lines) out.push(l === '' ? '│' : `│ ${l}`)
  out.push('╰─⬣')
  return out.join('\n')
}

const kb = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

// Backup lama (`omniedit` → `skyline`) dirapikan oleh `normalizeBackup()`
// dari lib/keepMigrate.js — dipakai bareng `.updatesc` (auto-restore).

/** Teks isi backup — dipakai buat status & sesudah restore. */
async function backupText() {
  await normalizeBackup().catch(() => {})
  const st = await backupStatus()
  const baris = []

  if (st.config.length) {
    baris.push('🔑 *API*')
    for (const n of uniqueLabels(st.config)) baris.push(`  ◦ \`${n}\``)
  } else {
    baris.push('🔑 *API*')
    baris.push('  ◦ belum ada')
  }

  baris.push('')
  baris.push('🖼️ *THUMBNAIL*')
  if (st.assets.length) {
    for (const a of st.assets) {
      const nama = a.rel.split('/').pop()
      const waktu = new Date(a.mtime).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
      baris.push(`  ◦ \`${nama}\` · ${kb(a.size)} · ${waktu}`)
    }
  } else {
    baris.push('  ◦ belum ada')
  }

  return { st, baris }
}

function ensureHandlers() {
  onRichReply('restore:all', async (ctx) => act(ctx, 'all'))
  onRichReply('restore:api', async (ctx) => act(ctx, 'apikey'))
  onRichReply('restore:config', async (ctx) => act(ctx, 'apikey')) // tombol lama
  onRichReply('restore:thumb', async (ctx) => act(ctx, 'thumb'))
}

async function act(ctx, which) {
  await ctx.react('🔄')
  await normalizeBackup().catch(() => {})
  const spec =
    which === 'apikey' ? { config: true, assets: false }
      : which === 'thumb' ? { config: false, assets: true }
        : { config: true, assets: true }

  const r = await restoreFromBackup(spec)
  const total = r.kept.length + r.assetsKept.length
  const gagal = r.lost.length + r.assetsLost.length
  const bersih = (r.cleanedConfig ? 1 : 0) + r.cleanedAssets.length

  const apiLabels = uniqueLabels(r.kept)
  const apiGagal = uniqueLabels(r.lost)
  const lines = [
    '',
    '🔑 *API*',
    apiLabels.length ? apiLabels.map((k) => `  ✅ \`${k}\``).join('\n') : '  — (gak dipulihkan)',
    ...(apiGagal.length ? apiGagal.map((k) => `  ⚠️ \`${k}\` gagal`) : []),
    '',
    '🖼️ *THUMBNAIL*',
    r.assetsKept.length
      ? r.assetsKept.map((f) => `  ✅ \`${f.split('/').pop()}\``).join('\n')
      : '  — (gak dipulihkan)'
  ]

  if (bersih) lines.push('', `🗑️ *${bersih} file backup dihapus* (udah kebalik)`)
  if (gagal) lines.push('', `⚠️ *${gagal} gagal dipulihkan* — backup-nya TETAP disimpan`, '   buat dicoba ulang nanti.')
  if (total) lines.push('', '♻️ Jalankan *.restart* biar API di config kebaca bot.')

  await ctx.reply(card(total ? (gagal ? '⚠️' : '✅') : '📭', total ? 'PULIHAN SELESAI' : 'GAK ADA YANG DIPULIHKAN', [
    `Mode: *${which === 'all' ? 'SEMUA' : which === 'apikey' ? 'API' : 'THUMBNAIL'}*`,
    ...lines,
    '',
    total || gagal
      ? `🔐 ${total} setting dipulihkan · ${gagal} gagal`
      : 'Belum ada backup tersimpan.'
  ]))

  await ctx.react(gagal ? '⚠️' : '✅')
}

const pluginConfig = {
  name: 'restore',
  alias: ['pulih', 'balikin', 'restoreset'],
  category: 'owner',
  description: 'Balikin API & thumbnail dari backup tanpa mengembalikan kode',
  usage: '.restore [all|api|thumb]',
  example: '.restore\n.restore api',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 10,
  limit: 1,
  isEnabled: true
}

async function handler(ctx) {
  try {
    const arg = String(ctx.args?.[0] || '').toLowerCase()

    if (['all', 'api', 'apikey', 'config', 'thumb', 'thumbnail'].includes(arg)) {
      await act(ctx, arg === 'api' || arg === 'apikey' || arg === 'config' ? 'apikey' : arg === 'thumbnail' ? 'thumb' : arg)
      return
    }

    const { st, baris } = await backupText()
    const ada = st.config.length || st.assets.length

    if (!ada) {
      await ctx.reply(card('📭', 'BELUM ADA BACKUP', [
        'Belum ada setting yang tersimpan.',
        '',
        'Backup dibuat otomatis tiap kali',
        '`.updatesc` jalan.'
      ]))
      return
    }

    ensureHandlers()
    await ctx.replyButtons({
      text: card('🔐', 'PULIH SETTING', [
        'API & thumbnail kamu yang tersimpan',
        'sebelum kena update.',
        '',
        ...baris,
        '',
        'Kode TIDAK dibalikin — tetap terbaru.'
      ]),
      footer: 'skyline-JXRA',
      buttons: [
        { id: 'restore:all', text: '🔐 Pulihkan semua' },
        { id: 'restore:api', text: '🔑 Pulihkan API' },
        { id: 'restore:thumb', text: '🖼️ Thumbnail doang' }
      ]
    })
    await ctx.react('🔐')
  } catch (err) {
    try { await ctx.react('❌') } catch {}
    try { await ctx.reply(`❌ *GAGAL PULIH*\n> ${err?.message || err}`) } catch {}
  }
}

export { pluginConfig as config, handler }
// buat pengujian (loader cuma baca `config` + `handler`)
export const _internals = { normalizeBackup }
