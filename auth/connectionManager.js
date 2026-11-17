/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * connectionManager.js — Connection state & reconnection dengan backoff.
 *
 * Tiap close/open juga ditulis ke `logs/conn.log` (gitignored) supaya kalau
 * bot kelihatan "putus-nyambung terus", penyebabnya bisa dicek dari `reason`
 * tanpa harus nangkep console yang udah ke-scroll.
 */
import fs from 'node:fs'
import path from 'node:path'
import { logger, box } from '../core/logger.js'

let shuttingDown = false

export function markShutdown() {
  shuttingDown = true
}

/* Terjemahan `reason` dari WhatsApp/zapo → penyebab yang bisa ditindak. */
const REASON_HINTS = {
  stream_error_replaced: 'session dipakai instance LAIN (bot kedua nyala) — matiin salah satu',
  stream_error_device_removed: 'device di-unlink dari HP (Perangkat tertaut)',
  stream_error_force_logout: 'server maksa logout',
  stream_error_force_login: 'server minta login ulang',
  stream_error_ack: 'server tidak menerima ack',
  stream_error_xml_not_well_formed: 'frame rusak (bug protokol)',
  stream_error_other: 'stream error dari server',
  client_disconnected: 'ditutup dari sisi bot sendiri',
  comms_stopped: 'transport dihentikan',
  failure_client_too_old: 'versi client ketinggalan (butuh versi WA terbaru)',
  failure_locked: 'akun/device dikunci server',
  failure_not_authorized: 'sesi tidak diizinkan (kredensial invalid)',
  failure_banned: 'akun dibanned',
  failure_bad_user_agent: 'user-agent ditolak',
  failure_service_unavailable: 'server WhatsApp lagi gangguan (503)',
  primary_identity_key_change: 'identitas akun berubah (perlu pairing ulang)'
}

const LOG_DIR = './logs'
const LOG_FILE = path.join(LOG_DIR, 'conn.log')

/* Simpan riwayat koneksi biar bisa dibaca belakangan (console panel ke-scroll). */
function appendLog(line) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch (err) {
    logger.debug({ err: err?.message }, 'Gagal nulis logs/conn.log')
  }
}

export function setupConnection(client) {
  const MAX_RECONNECT_ATTEMPTS = 10
  let reconnectAttempt = 0

  client.on('connection', (event) => {
    if (shuttingDown) return // intentional close — diem aja

    if (event.status === 'open') {
      box('🟢 TERHUBUNG', [
        event.isNewLogin ? '🔐 Login baru (pairing pertama)' : '🔗 Sesi tersambung',
        `🕐 ${new Date().toLocaleTimeString('id-ID', { hour12: false })}`
      ], { color: '32' })
      appendLog(`open reason=${event.reason ?? '-'} newLogin=${!!event.isNewLogin}`)
      reconnectAttempt = 0
      return
    }

    const hint = REASON_HINTS[event.reason]
    appendLog(`close reason=${event.reason ?? '-'} code=${event.code ?? '-'} isLogout=${!!event.isLogout}`)
    logger.warn({ reason: event.reason, code: event.code, isLogout: event.isLogout }, '🔴 Koneksi terputus')
    if (hint) logger.warn(`↳ penyebab: ${hint}`)

    if (event.isLogout) {
      box('🔴 DEVICE DI-UNLINK', [
        'Sesi logout dari HP / server.',
        'Hapus folder session/ lalu jalankan ulang.'
      ], { color: '31' })
      return
    }

    void reconnectWithBackoff()
  })

  async function reconnectWithBackoff() {
    if (shuttingDown) return
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`❌ Menyerah setelah ${reconnectAttempt} percobaan reconnect.`)
      appendLog(`give-up attempts=${reconnectAttempt}`)
      return
    }
    const delayMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempt)
    reconnectAttempt += 1
    logger.info(`⏳ Reconnect dalam ${delayMs}ms (percobaan ke-${reconnectAttempt})`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      await client.connect()
    } catch (err) {
      logger.error({ err: err.message }, '❌ Reconnect gagal')
      appendLog(`reconnect-failed ${err?.message ?? err}`)
      void reconnectWithBackoff()
    }
  }
}
