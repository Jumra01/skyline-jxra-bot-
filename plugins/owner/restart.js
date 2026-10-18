/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * restart.js — Matikan & nyalakan ulang bot (owner).
 *
 * Tiga jalur, urut prioritas:
 *   0) PANEL PTERODACTYL (config.panel / env PTERO_*) → jalur utama kalau
 *      bot deploy di panel: panggil Client API
 *      `POST /api/client/servers/{id}/power` (signal: restart|start) →
 *      wings nge-restart container-nya. Ini SATU-SATUNYA cara restart
 *      yang bener di panel — respawn manual dari dalam gak bakal selamat
 *      karena begitu PID utama mati wings ikut bunuh semua anaknya.
 *   1) Dijalankan PM2 (terdeteksi NODE_APP_INSTANCE / pm_id / pm_log_path)
 *      → kirim SIGINT ke diri sendiri → sky.js shutdown rapi
 *        (disconnect WA + stopHotReload) → exit(0) → PM2 autorestart.
 *      → owner bilang gak pakai PM2, cabang ini cuma fallback.
 *   2) Manual (`node sky.js` / `npm run dev`) → respawn proses baru:
 *      → spawn restarter detached DULU (sebelum proses dimatikan!) dan
 *        tunggu event 'spawn' — kalau gagal, BATAL restart, bot tetap hidup.
 *      → restarter nunggu proses lama mati (poll kill(pid,0), max 15s),
 *        baru bunuh wrapper `--watch`, lalu spawn `node sky.js` baru.
 *
 * Kenapa gak cukup `process.exit(0)` polos (sudah dibuktikan tes):
 *   • `node --watch` (npm run dev) TIDAK nge-restart kalau child exit —
 *     dia cuma idle nunggu file berubah → bot mati selamanya.
 *
 * Repo root dihitung dari lokasi file ini — jalan di mana pun cwd.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import config from '../../config.js'
import { logger } from '../../core/logger.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(ROOT, 'sky.js')

const pluginConfig = {
  name: 'restart',
  alias: ['reboot', 'restartbot'],
  category: 'owner',
  description: 'Restart bot / server panel (owner)',
  usage: '.restart',
  example: '.restart',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 15,
  isEnabled: true,
}

/* ══════════ panel Pterodactyl — Client API ══════════ */
function pteroHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'Application/vnd.pterodactyl.v1+json',
  }
}

/** Config panel (config.panel, bisa di-override env buat deploy panel). */
function panelCfg() {
  return {
    domain: String(process.env.PTERO_DOMAIN || config.panel?.domain || '').replace(/\/+$/, ''),
    apikey: String(process.env.PTERO_APIKEY || config.panel?.apikey || '').trim(),
    serverid: String(process.env.PTERO_SERVERID || config.panel?.serverid || '').trim(),
  }
}

function panelReady() {
  const p = panelCfg()
  return Boolean(p.domain && p.apikey && p.serverid)
}

/** 'running' | 'offline' | null (gak kebaca). */
async function panelState() {
  const p = panelCfg()
  try {
    const { data } = await axios.get(`${p.domain}/api/client/servers/${p.serverid}/resources`, {
      headers: pteroHeaders(p.apikey),
      timeout: 12000,
      validateStatus: () => true,
    })
    return data?.attributes?.current_state || null
  } catch (e) {
    logger.error({ err: String(e?.message || e) }, '[Restart] cek state server panel gagal')
    return null
  }
}

/** Kirim sinyal power. Balas { ok, status } — ok = panel terima (2xx). */
async function panelPower(signal) {
  const p = panelCfg()
  try {
    const res = await axios.post(
      `${p.domain}/api/client/servers/${p.serverid}/power`,
      { signal },
      { headers: pteroHeaders(p.apikey), timeout: 15000, validateStatus: () => true }
    )
    logger.info({ status: res.status, signal }, '[Restart] respons Client API power')
    return { ok: res.status >= 200 && res.status < 300, status: res.status }
  } catch (e) {
    logger.error({ err: String(e?.message || e) }, '[Restart] kirim sinyal power panel gagal')
    return { ok: false, status: 0, err: String(e?.message || e) }
  }
}

function panelErrHint(status, err) {
  if (status === 401 || status === 403)
    return 'API key salah, atau gak dicentang izin *Power* + *Read Info*.'
  if (status === 404) return 'Server ID salah, atau servernya udah dihapus.'
  if (status === 422) return 'Panel nolak signal — cek lagi `serverid` di config.'
  return err ? `Gak bisa nyambung ke panel:\n\`${err}\`` : `Panel balas HTTP ${status}.`
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
 * (kamu kasih error event — `spawn` gagal itu ASYNC, try/catch biasa gak nangkep).
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
  // Ditemukan lewat simulasi `.restart`.
  setTimeout(() => process.exit(0), 8000)
}

async function handler(ctx) {
  const panel = panelCfg()
  const filled = [panel.domain, panel.apikey, panel.serverid].filter(Boolean).length
  if (filled > 0 && filled < 3) {
    logger.warn(
      '[Restart] config.panel keisi SEBAGIAN (' +
        ['domain', 'apikey', 'serverid'].filter((k) => !panel[k]).join(', ') +
        ' belum) — .restart pakai jalur lama.'
    )
  }

  /* ── Jalur 0: PANEL PTERODACTYL ──
   * Owner deploy di panel & gak pakai PM2. Dari dalam container kita
   * gak bisa respawn diri — begitu PID utama mati wings ikut bunuh
   * anaknya. Jadi minta panel yang nge-restart container-nya. */
  if (panelReady()) {
    const state = await panelState()
    const signal = state === 'running' ? 'restart' : 'start'

    await ctx.react('♻️')
    await ctx.reply(
      '♻️ *RESTART SERVER PANEL*\n\n' +
        `Panel: *${panel.domain}*\n` +
        `Server: *${panel.serverid}*\n` +
        `Action: *${signal}*\n\n` +
        'Server panel lagi direstart — bot bakal mati sebentar, terus ' +
        'nyala lagi otomatis lewat startup command panel.\n' +
        'Sesi WhatsApp gak bakal ilang.'
    )

    // kasih pesan keburu terkirim sebelum container dibunuh wings
    await new Promise((r) => setTimeout(r, 1500))

    const r = await panelPower(signal)
    if (!r.ok) {
      // JANGAN shutdown — panel nolak, bot harus tetap hidup
      return ctx.reply(
        '❌ *GAGAL RESTART PANEL*\n\n' +
          panelErrHint(r.status, r.err) +
          '\n\nBot tetap jalan. Kamu bisa restart manual lewat dashboard panel.'
      )
    }

    logger.warn(`[Restart] mode panel → sinyal ${signal} diterima wings`)
    shutdown(`[Restart] mode panel → container diserahkan ke wings (signal=${signal})`)
    return
  }

  /* ── Jalur 1: PM2 ── */
  const isPm2 = underPm2()

  // ── Cek dulu, SEBELUM janjiin restart. Gagal = bot tetap hidup. ──
  if (!isPm2) {
    if (!existsSync(ENTRY)) {
      return ctx.reply(
        '❌ `sky.js` gak ketemu di `' + ROOT + '` — bot jadi TIDAK di-restart (biar gak mati permanen).'
      )
    }
    const ok = await scheduleRespawn(findWatchPid(), 800, process.pid)
    if (!ok) {
      return ctx.reply(
        '❌ Gagal menyiapkan restarter — bot TIDAK jadi di-restart (biar gak mati permanen).\n' +
          'Jalankan ulang manual: `npm start` / `npm run dev`.'
      )
    }
  }

  await ctx.react('♻️')
  await ctx.reply(
    '♻️ *RESTART BOT*\n\n' +
      `Mode: *${isPm2 ? 'PM2 (autorestart)' : 'respawn manual'}*\n` +
      'Bot akan mati sebentar, lalu nyambung lagi dalam beberapa detik.\n' +
      'Sesi WhatsApp gak bakal ilang.'
  )

  // kasih pesan keburu terkirim sebelum proses mati
  await new Promise((r) => setTimeout(r, 1500))

  shutdown(
    isPm2
      ? '[Restart] mode PM2 → SIGINT, serahin ke PM2 autorestart'
      : `[Restart] mode respawn manual (watchPid=${findWatchPid() || 'tanpa'}) → SIGINT`
  )
}

export { pluginConfig as config, handler }

// buat pengujian (gak dipakai loader — loader cuma baca `config` + `handler`)
export const _internals = {
  underPm2,
  findWatchPid,
  readProc,
  scheduleRespawn,
  panelCfg,
  panelReady,
  panelState,
  panelPower,
  ROOT,
  ENTRY,
}
