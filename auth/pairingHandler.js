/**
 * pairingHandler.js — Pairing code flow, minimal & anti-spam.
 * SATU request per run (anti-abuse WA suppress notif kalau di-hammer).
 *
 * Thanks to XN for helping this. 
 */
import config from '../config.js'
import { logger } from '../core/logger.js'

const CODE_PATTERN = /^[1-9A-HJ-NP-TV-Z]{8}$/

function validateCode(raw) {
  const code = String(raw ?? '').toUpperCase()
  if (!CODE_PATTERN.test(code)) {
    logger.error(
      `❌ customCode "${raw}" tidak valid. ` +
      `Harus 8 karakter dari 1-9 & A-Z tanpa I, O, U, 0. Contoh: JHXFNY48`
    )
    return null
  }
  return code
}

const PAIRING_SETTLE_MS = 15_000
const PAIRING_RETRY_MS = 25_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function setupPairing(client, phoneNumber) {
  let requested = false

  async function requestCode() {
    if (requested) return
    requested = true

    try {
      const state = client.auth.getState()
      if (state?.registered) return

      const useCustom = config.auth.useCustomCode !== false
      const custom = useCustom ? validateCode(config.auth.customCode) : undefined
      if (useCustom && !custom) return

      // Tunggu socket benar-benar siap. WA (terutama WA Bisnis) suppress
      // notif pairing kalau companion-hello dikirim terlalu cepat setelah
      // connect — delay settle dulu, lalu request. (Pola yang work di Baileys.)
      logger.info(`⏳ Menunggu koneksi stabil ${PAIRING_SETTLE_MS / 1000}s sebelum request pairing code...`)
      await sleep(PAIRING_SETTLE_MS)

      logger.info(`🔑 Request pairing code untuk +${phoneNumber}...`)
      let issued
      try {
        issued = await client.auth.requestPairingCode(phoneNumber, true, custom)
      } catch (err) {
        // Retry sekali dengan jeda lebih lama — beberapa nomor (WA Bisnis)
        // butuh attempt kedua karena server masih rate-limit handshake pertama.
        logger.warn(`⚠️ Request pertama gagal (${err.message}). Retry dalam ${PAIRING_RETRY_MS / 1000}s...`)
        await sleep(PAIRING_RETRY_MS)
        issued = await client.auth.requestPairingCode(phoneNumber, true, custom)
      }

      const pretty = issued.match(/.{1,4}/g)?.join('-') ?? issued

      logger.success(`🔑 PAIRING CODE: ${pretty}`)
      logger.info('📲 Notif tautan perangkat dikirim ke HP — buka notifnya & tautkan kode di atas.')
      logger.info('ℹ️ Notif gak muncul? Gak masalah — bisa langsung input code di atas via:')
      logger.info('   WhatsApp → Perangkat tertaut → Tautkan perangkat → "Tautkan dengan nomor telepon".')
      logger.info('   (WA Bisnis: Settings → Linked Devices → Link a Device → "Link with phone number")')
      logger.info('⚠️ JANGAN request berulang kali dalam waktu singkat (anti-abuse WA).')
    } catch (err) {
      requested = false
      logger.error({ err: err.message }, 'Gagal request pairing code')
    }
  }

  // Diagnosa kecil (relevant to event resmi zapo)
  client.on('auth_passkey_required', ({ hasSigner }) => {
    logger.warn(`🔐 Akun di-gate PASSKEY oleh server (hasSigner: ${hasSigner}).`)
  })
  client.on('auth_pairing_code', ({ code }) => {
    logger.info(`🎟️ Event auth_pairing_code: ${code}`)
  })
  client.on('stanza_error', (e) => logger.warn({ detail: e }, '🧩 stanza_error saat pairing'))
  client.on('stream_failure', (e) => logger.warn({ detail: e }, '🧩 stream_failure saat pairing'))
  client.on('auth_pairing_required', () => void requestCode())

  client.on('auth_paired', ({ credentials }) => {
    logger.success(`✅ Pairing berhasil sebagai ${credentials.meJid}`)
    logger.success('✅ Bot berjalan. Ctrl+C buat berhenti.')
  })

  return requestCode
}
