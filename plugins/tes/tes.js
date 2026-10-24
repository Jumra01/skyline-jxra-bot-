/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tes.js — Panel tes/diagnostik bot (`.tes`) — khusus owner.
 *
 * Folder `plugins/tes/` khusus plugin percobaan & diagnosa: auto-load sama
 * seperti kategori lain, gampang dihapus/hot-reload tanpa menyentuh fitur
 * inti. Panel ini ngecek: versi Node, versi library WA (zapo-js + ekosistem),
 * status plugin VOIP di client, ffmpeg, uptime, dan jumlah feature termuat.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const run = promisify(execFile)

const pluginConfig = {
  name: 'tes',
  alias: ['test', 'cektes'],
  category: 'tools',
  description: 'Panel tes & diagnostik bot (versi library, VOIP, ffmpeg, dsb)',
  usage: '.tes',
  example: '.tes',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
  energi: 0,
}

// Baca versi paket langsung dari node_modules/<name>/package.json —
// gak lewat require/import biar aman dari paket ESM-only yang menutup exports.
function pkgVersion(name) {
  try {
    const file = path.join(ROOT, 'node_modules', ...name.split('/'), 'package.json')
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.version ?? null
  } catch {
    return null
  }
}

async function ffmpegVersion() {
  try {
    const { stdout } = await run('ffmpeg', ['-version'])
    return stdout.split('\n')[0]?.replace(/^ffmpeg version/, '')?.trim() ?? '?'
  } catch {
    return null
  }
}

async function handler(ctx) {
  const voipInstalled = !!ctx.client.voip
  const calls = voipInstalled ? ctx.client.voip.getCalls() : []
  const ff = await ffmpegVersion()

  const lines = [
    '🧪 *PANEL TES BOT*',
    '',
    `• Node: \`${process.version}\``,
    `• Uptime: ${Math.floor(process.uptime() / 60)} menit`,
    `• Feature termuat: ${ctx.client ? 'lihat log loader' : '?'}`,
    '',
    '*Library WhatsApp (zapo ecosystem):*',
    `• zapo-js: \`${pkgVersion('zapo-js') ?? '-'}\``,
    `• @zapo-js/store-sqlite: \`${pkgVersion('@zapo-js/store-sqlite') ?? '-'}\``,
    `• @zapo-js/media-utils: \`${pkgVersion('@zapo-js/media-utils') ?? '-'}\``,
    `• @zapo-js/voip: \`${pkgVersion('@zapo-js/voip') ?? 'belum terpasang'}\``,
    `• libmlow-wasm-fork: \`${pkgVersion('libmlow-wasm-fork') ?? '-'}\``,
    `• @roamhq/wrtc: \`${pkgVersion('@roamhq/wrtc') ?? '-'}\``,
    '',
    '*Status VOIP:*',
    `• Plugin client: ${voipInstalled ? '✅ aktif' : '❌ belum (butuh restart)'}`,
    `• Panggilan terlacak: ${calls.length}`,
    `• ffmpeg: ${ff ? `✅ ${ff}` : '❌ tidak ditemukan'}`,
    '',
    ff && voipInstalled
      ? '✅ Semua siap — coba `.voip <nomor>` buat nelpon.'
      : '⚠️ Sebagian komponen belum siap (lihat atas).',
  ]

  await ctx.reply(lines.join('\n'))
}

export { pluginConfig as config, handler }
