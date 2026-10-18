/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * restore.js — Balikin SETTING & apikey dari backup, tanpa menyentuh kode.
 *
 * `.updatesc` sengaja update BERSIH: semua file repo (kode, nilai default
 * config, thumbnail) ikut versi terbaru, tapi setting milik user dulu
 * di-backup ke `config.js.update.bak` + `updatesc-keep.bak/`.
 * Fitur inilah yang menebusnya — dan karena cuma file setting yang
 * disentuh, script yang barusan ke-update TETAP versi terbaru.
 *
 * Pakai:
 *   .restore              → lihat isi backup + pilihan tombol
 *   .restore all          → balikin apikey + thumbnail sekaligus
 *   .restore apikey       → balikin nilai di config.js doang
 *   .restore thumb        → balikin thumbnail doang
 *
 * Thumbnail yang isinya cuma default (user belum pernah ganti) sengaja
 * DILEWAT — biar gak ngebatalin update default dari repo.
 *
 * Backup yang BERHASIL dipulihkan ikut DIHAPUS (biar gak numpuk);
 * yang gagal tetap disimpan buat dicoba ulang. `.updatesc` berikutnya
 * bikin backup baru lagi dari nilai yang ada sekarang.
 *
 * Catatan: balikin apikey di config.js butuh RESTART biar kebaca bot.
 */
import { onRichReply } from '../../handlers/messageHandler.js'
import { backupStatus, restoreFromBackup } from '../../lib/keepSettings.js'

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

/** Teks isi backup — dipakai buat status & sesudah restore. */
async function backupText() {
  const st = await backupStatus()
  const baris = []

  if (st.config.length) {
    baris.push('🔑 *APIKEY / NILAI CONFIG*')
    for (const n of st.config) baris.push(`  ◦ \`${n}\``)
  } else {
    baris.push('🔑 *APIKEY / NILAI CONFIG*')
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
  onRichReply('restore:config', async (ctx) => act(ctx, 'apikey'))
  onRichReply('restore:thumb', async (ctx) => act(ctx, 'thumb'))
}

async function act(ctx, which) {
  await ctx.react('🔄')
  const spec =
    which === 'apikey' ? { config: true, assets: false }
      : which === 'thumb' ? { config: false, assets: true }
        : { config: true, assets: true }

  const r = await restoreFromBackup(spec)
  const total = r.kept.length + r.assetsKept.length
  const gagal = r.lost.length + r.assetsLost.length
  const bersih = (r.cleanedConfig ? 1 : 0) + r.cleanedAssets.length

  const lines = ['', '🔑 *APIKEY / NILAI CONFIG*', r.kept.length ? r.kept.map((k) => `  ✅ \`${k}\``).join('\n') : '  — (gak dipulihkan)', '', '🖼️ *THUMBNAIL*', r.assetsKept.length ? r.assetsKept.map((f) => `  ✅ \`${f.split('/').pop()}\``).join('\n') : '  — (gak dipulihkan)']

  if (bersih) lines.push('', `🗑️ *${bersih} file backup dihapus* (udah kebalik)`)
  if (gagal) lines.push('', `⚠️ *${gagal} gagal dipulihkan* — backup-nya TETAP disimpan`, '   buat dicoba ulang nanti.')
  if (total) lines.push('', '♻️ Jalankan *.restart* biar apikey di config kebaca bot.')

  await ctx.reply(card(total ? (gagal ? '⚠️' : '✅') : '📭', total ? 'PULIHAN SELESAI' : 'GAK ADA YANG DIPULIHKAN', [
    `Mode: *${which === 'all' ? 'SEMUA' : which.toUpperCase()}*`,
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
  description: 'Balikin setting & apikey dari backup tanpa mengembalikan kode',
  usage: '.restore [all|apikey|thumb]',
  example: '.restore\n.restore apikey',
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

    if (['all', 'apikey', 'config', 'thumb', 'thumbnail'].includes(arg)) {
      await act(ctx, arg === 'config' ? 'apikey' : arg === 'thumbnail' ? 'thumb' : arg)
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
        'Setting & apikey kamu yang tersimpan',
        'sebelum kena update.',
        '',
        ...baris,
        '',
        'Kode TIDAK dibalikin — tetap terbaru.'
      ]),
      footer: 'skyline-JXRA',
      buttons: [
        { id: 'restore:all', text: '🔑 Pulihkan semua' },
        { id: 'restore:config', text: '🔑 apikey doang' },
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
