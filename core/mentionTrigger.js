/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * mentionTrigger.js — Registry handler "mention" (tanpa prefix command).
 *
 * Plugin yang mau balas otomatis saat nomor bot di-tag (mis. plugins/ai/bot.js)
 * daftar lewat setMentionHandler(). route() di handlers/messageHandler.js
 * manggil handler ini cuma kalau pesan TANPA prefix: handler balikin `true`
 * kalau dia memang nanganin (bot di-tag), `false` kalau bukan buat dia.
 */
let handler = null

export function setMentionHandler(fn) {
  handler = typeof fn === 'function' ? fn : null
}

export function getMentionHandler() {
  return handler
}
