/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * restart.js — Matikan & nyalakan ulang bot (owner).
 *
 * Alur: react → balas info box → tunggu 2 detik →
 * spawn proses baru (detached) → matiin proses lama.
 *
 * Pengaman biar bot gak mati permanen (gak kelihatan dari chat):
 *   • `node sky.js` (entry repo ini), bukan `index.js`.
 *   • spawn DICEK dulu lewat event 'spawn'/'error' — `spawn` gagal itu
 *     ASYNC, try/catch biasa gak nangkep. Kalau gagal → batal restart,
 *     bot tetap hidup (spawn gagal = batal restart, bukan mati permanen).
 *   • restarter nunggu proses lama beneran mati (poll kill(pid,0)) sebelum
 *     spawn, biar gak dobel instance kalau shutdown lambat.
 *   • bunuh wrapper `node --watch` lama (kondisi `npm run dev`) — kalau
 *     gak, watcher-nya idel terus dan kamu punya 2 bot nyala.
 *     `process.exit(0)` polos juga gak nge-restart di `node --watch`.
 *   • shutdown via SIGINT dulu biar sky.js disconnect WA + stopHotReload
 *     rapi, baru exit(0) — bukan exit langsung tanpa shutdown.
 *
 * Repo root dihitung dari lokasi file ini — jalan di mana pun cwd.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../../core/logger.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(ROOT, 'sky.js')

const pluginConfig = {
  name: 'restart',
  alias: ['reset', 'reboot', 'restartbot'],
  category: 'owner',
  description: 'Restart bot process (real restart)',
  usage: '.restart',
  example: '.restart',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 30,
  isEnabled: true,
}

/* ══════════ deteksi supervisor ══════════ */
function underPm2() {
  return (
    process.env.NODE_APP_INSTANCE !== undefined ||
    process.env.pm_id !== undefined ||
    process.env.pm_log_path !== undefined
  )
}

const SHELL_RE = /(^|\/)(bash|zsh|sh|dash|fish|tmux|screen|login|su)$/

function readProc(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // stat: "pid (comm) state ppid ..." — comm bisa ada spasi → potong setelah ')' terakhir
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return { cmd, ppid: Number(after[1]) }
  } catch {
    return null
  }
}

/** Cari ancestor `node --watch` (berhenti sebelum shell) — biar wrapper lama ikut mati. */
function findWatchPid() {
  let pid = process.ppid
  for (let i = 0; i < 8 && pid > 1; i++) {
    const info = readProc(pid)
    if (!info || !info.cmd) break
    if (/(^|\s)--watch(\s|$)/.test(info.cmd)) return pid
    if (SHELL_RE.test(info.cmd.split(/\s+/)[0])) break // jangan naik sampai shell
    if (!info.ppid || info.ppid >= pid) break
    pid = info.ppid
  }
  return 0
}

/**
 * Restarter detached. Kode di bawah dikirim ke `node -e` — ARGUMEN-nya:
 *   argv[1] delay minimum (buffer biar pesan keburu terkirim)
 *   argv[2] pid wrapper `node --watch` lama (0 = gak ada)
 *   argv[3] repo root
 *   argv[4] pid proses bot lama (nunggu sampe beneran mati)
 * Balasan Promise<boolean>: true = restarter sudah hidup, false = GAGAL
 * (kamu kasih error event — `spawn` gagal itu ASYNC, try/catch gak nangkep).
 */
function scheduleRespawn(watchPid, delayMs, parentPid = process.pid, execPath = process.execPath) {
  const helper = `
const delay  = Number(process.argv[1] || 800);
const watch  = Number(process.argv[2] || 0);
const root   = process.argv[3];
const parent = Number(process.argv[4] || 0);
const MAXWAIT = 15000;

const alive = (p) => { try { process.kill(p, 0); return true } catch (e) { return e.code === 'EPERM' } };

function go() {
  if (watch > 1) { try { process.kill(watch, 'SIGTERM') } catch {} }
  try {
    const { spawn } = require('node:child_process');
    const c = spawn(process.execPath, ['sky.js'], {
      cwd: root, stdio: 'inherit', detached: true, env: process.env
    });
    c.on('error', () => process.exit(1));
    c.unref();
  } catch (e) { process.exit(1) }
  process.exit(0);
}

const t0 = Date.now();
(function wait() {
  const parentDead = !parent || !alive(parent);
  if (parentDead && Date.now() - t0 >= delay) return go();   // mati + buffer lewat
  if (Date.now() - t0 >= MAXWAIT) return go();               // jaring pengaman
  setTimeout(wait, 150);
})()
`

  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    let child
    try {
      child = spawn(
        execPath,
        ['-e', helper, String(delayMs), String(watchPid), ROOT, String(parentPid)],
        { detached: true, stdio: 'ignore', cwd: ROOT, env: process.env }
      )
    } catch (e) {
      logger.error({ err: String(e?.message || e) }, '[Restart] spawn restarter melempar error')
      return done(false)
    }
    child.once('spawn', () => {
      child.unref()
      done(true)
    })
    child.once('error', (e) => {
      logger.error({ err: String(e?.message || e) }, '[Restart] spawn restarter gagal')
      done(false)
    })
    // jaring pengaman kalau event gak pernah datang
    setTimeout(() => done(true), 3000).unref?.()
  })
}

/** Shutdown: SIGINT → handler sky.js (disconnect rapi) → exit(0). */
function shutdown(reason) {
  logger.warn(reason)
  try {
    process.kill(process.pid, 'SIGINT')
  } catch {
    process.exit(0)
  }
  // Jaring pengaman sengaja REF'd (bukan .unref): selain maksa exit kalau
  // handler macet, dia juga MENJAGA event loop tetap hidup — tanpa ini loop
  // bisa keburu kosong & Node exit(0) sebelum sinyal SIGINT sempat diproses,
  // sehingga shutdown rapi (disconnect WA + stopHotReload) gak pernah jalan.
  setTimeout(() => process.exit(0), 8000)
}

async function handler(ctx) {
  const isPm2 = underPm2()

  await ctx.react('🔄')
  await ctx.reply(
    '🔄 *ʀᴇsᴛᴀʀᴛɪɴɢ ʙᴏᴛ...*\n\n' +
      `╭┈┈⬡「 📊 *ɪɴꜰᴏ* 」\n` +
      `┃ ⏰ Time: ${new Date().toLocaleTimeString('id-ID')}\n` +
      `┃ 🔧 Method: ${isPm2 ? 'PM2 Autorestart' : 'Process Spawn'}\n` +
      `┃ 📦 PID: ${process.pid}\n` +
      `╰┈┈⬡\n\n` +
      `> Bot akan restart dalam 2 detik...\n` +
      `> Proses mungkin memakan waktu 10-30 detik`
  )

  // kasih pesan keburu terkirim sebelum proses mati
  await new Promise((r) => setTimeout(r, 2000))

  // Jalur PM2: keluar rapi, PM2 yang nyalain lagi. Gak usah spawn (nanti dobel).
  if (isPm2) return shutdown('[Restart] PM2 → SIGINT, serahin ke PM2 autorestart')

  // Cek dulu SEBELUM matiin diri — spawn gagal = bot jangan sampai mati permanen.
  if (!existsSync(ENTRY)) {
    return ctx.reply(
      '❌ `sky.js` gak ketemu di `' + ROOT + '` — bot jadi TIDAK di-restart (biar gak mati permanen).'
    )
  }
  const watchPid = findWatchPid()
  const ok = await scheduleRespawn(watchPid, 800, process.pid)
  if (!ok) {
    return ctx.reply(
      '❌ Gagal bikin proses baru — bot TIDAK jadi di-restart (biar gak mati permanen).\n' +
        'Jalankan ulang manual: `npm start` / `npm run dev`.'
    )
  }

  shutdown(`[Restart] respawn manual (watchPid=${watchPid || 'tanpa'}) → SIGINT`)
}

export { pluginConfig as config, handler }

// buat pengujian (gak dipakai loader — loader cuma baca `config` + `handler`)
export const _internals = { underPm2, findWatchPid, readProc, scheduleRespawn, ROOT, ENTRY }
