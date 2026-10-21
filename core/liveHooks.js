/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * liveHooks.js — hook "semua pesan" buat fitur yang butuh lihat pesan apa pun
 * (bukan cuma command): `.afk` (auto-jawab + auto-cabut status) dan
 * `.antidelete` (cache pesan sebelum dihapus).
 *
 * Plugin daftar pakai id; id yang sama saat hot reload = MENGGANTI, bukan
 * menumpuk (sama seperti `core/mentionTrigger.js`).
 */
import { logger } from './logger.js'

const messageHooks = new Map() // id -> fn(ctx)
const protocolHooks = new Map() // id -> fn(client, event)

export function addMessageHook(id, fn) {
  const key = String(id || 'default')
  if (typeof fn !== 'function') {
    messageHooks.delete(key)
    return
  }
  messageHooks.set(key, fn)
}

export function removeMessageHook(id) {
  messageHooks.delete(String(id || 'default'))
}

export function addProtocolHook(id, fn) {
  const key = String(id || 'default')
  if (typeof fn !== 'function') {
    protocolHooks.delete(key)
    return
  }
  protocolHooks.set(key, fn)
}

export function removeProtocolHook(id) {
  protocolHooks.delete(String(id || 'default'))
}

/** Dipanggil route() untuk SETIAP pesan masuk (fire-and-forget). */
export async function runMessageHooks(ctx) {
  for (const [id, fn] of messageHooks) {
    try {
      await fn(ctx)
    } catch (err) {
      logger.error({ err, hook: id }, 'Message hook gagal')
    }
  }
}

/** Dipanggil sky.js saat ada protocolMessage (revoke/hapus pesan, dll). */
export async function runProtocolHooks(client, event) {
  for (const [id, fn] of protocolHooks) {
    try {
      await fn(client, event)
    } catch (err) {
      logger.error({ err, hook: id }, 'Protocol hook gagal')
    }
  }
}

export function listHooks() {
  return {
    message: [...messageHooks.keys()],
    protocol: [...protocolHooks.keys()],
  }
}
