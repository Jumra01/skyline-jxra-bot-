/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * mentionTrigger.js — Registry handler "mention" (pesan TANPA prefix command).
 *
 * Banyak fitur bisa daftar (mis. `plugins/ai/ella.js` dan `plugins/ai/bot.js`).
 * route() manggil `getMentionHandler()`, lalu dispatcher mencoba handler
 * berurutan dari prioritas TERBESAR sampai ada yang balikin `true`
 * (= dia memang nanganin pesan itu). Handler yang balikin `false` diteruskan
 * ke handler berikutnya, jadi satu fitur bisa "menyerahkan" pesan ke fitur lain.
 *
 *   addMentionHandler('ella', fn, 20)   // prioritas tinggi
 *   addMentionHandler('gemini', fn, 10)
 *   setMentionHandler(fn)               // cara lama = id 'default' prioritas 0
 *
 * Daftar ulang dengan id yang sama (hot reload) = MENGGANTI, bukan menumpuk.
 */
import { logger } from './logger.js'

const handlers = new Map() // id -> { fn, priority }

export function addMentionHandler(id, fn, priority = 0) {
  const key = String(id || 'default')
  if (typeof fn !== 'function') {
    handlers.delete(key)
    return
  }
  handlers.set(key, { fn, priority: Number(priority) || 0 })
}

export function removeMentionHandler(id) {
  handlers.delete(String(id || 'default'))
}

/** Kompatibilitas cara lama: satu handler utama (id 'default'). */
export function setMentionHandler(fn) {
  addMentionHandler('default', fn, 0)
}

export function listMentionHandlers() {
  return [...handlers.entries()]
    .map(([id, h]) => ({ id, priority: h.priority }))
    .sort((a, b) => b.priority - a.priority)
}

export function getMentionHandler() {
  if (!handlers.size) return null
  return async function dispatchMention(ctx) {
    const list = [...handlers.entries()].sort((a, b) => b[1].priority - a[1].priority)
    for (const [id, h] of list) {
      try {
        if (await h.fn(ctx)) return true
      } catch (err) {
        // Satu fitur error gak boleh bikin fitur lain ikut diam.
        logger.error({ err, handler: id }, 'Mention handler gagal')
      }
    }
    return false
  }
}
