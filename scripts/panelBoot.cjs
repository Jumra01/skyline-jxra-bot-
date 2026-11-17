/**
 * panelBoot.cjs — start bot dari `npm install` di panel Pterodactyl.
 *
 * Kenapa ada file ini:
 * Egg panel yang dipakai cuma bisa jalanin
 *   ... /usr/local/bin/npm install; /usr/local/bin/${CMD_RUN}
 * dan variabel CMD_RUN di tab Startup read-only (nggak bisa diubah jadi
 * `node sky.js`), jadi setelah install kelar nggak ada yang manggil bot dan
 * container langsung exit (Exit code: 0, tanpa log apa pun).
 *
 * Solusinya: npm install SELALU jalan tiap boot dan script milik project
 * sendiri tetap dieksekusi (yang diblokir npm 12 cuma script dependency),
 * jadi kita pakai `postinstall` untuk menyalakan bot dari dalam install.
 * npm install nggak bakal selesai sebelum bot mati → cuma ada satu instance.
 *
 * Di lokal (npm install / npm ci biasa) file ini langsung keluar tanpa
 * ngapa-ngapain, biar nggak ada bot nyala tiap install.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

// Folder kerja container panel. Bisa di-override buat ngetes.
const PANEL_DIR = path.resolve(process.env.SKYLINE_PANEL_DIR || '/home/container')
const cwd = path.resolve(process.cwd())

if (cwd !== PANEL_DIR) {
  console.log(`[panel-boot] skip — bukan panel (cwd: ${cwd})`)
  process.exit(0)
}

if (process.env.SKYLINE_SKIP_PANEL_BOOT === '1') {
  console.log('[panel-boot] skip — SKYLINE_SKIP_PANEL_BOOT=1')
  process.exit(0)
}

console.log('[panel-boot] panel terdeteksi — nyalain bot dari postinstall')

const child = spawn(process.execPath, ['sky.js'], {
  cwd,
  stdio: 'inherit',
  env: process.env,
})

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  try { child.kill(signal) } catch {}
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stop(signal))
}

child.on('error', (err) => {
  console.error('[panel-boot] gagal spawn bot:', err?.message || err)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal && !stopping) console.error(`[panel-boot] bot berhenti karena signal ${signal}`)
  process.exit(code ?? 1)
})
