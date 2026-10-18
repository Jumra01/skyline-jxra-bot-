/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * consoleStyle.js — Helper warna & lebar teks buat semua tampilan console.
 * Dipakai bersama oleh logger.js, banner.js, auth, dsb.
 */

export const RESET = '\x1b[0m'

// Warna aktif kalau terminal mendukung (TTY / FORCE_COLOR) & NO_COLOR gak diset.
export const colorsEnabled = (() => {
  if (process.env.NO_COLOR) return false
  const fc = process.env.FORCE_COLOR
  if (fc !== undefined && fc !== '0' && fc !== 'false') return true
  return !!process.stdout.isTTY
})()

// code bisa: '36' | '1;36' | '38;2;r;g;b' | '43;30'
export function paint(code, text) {
  if (!colorsEnabled) return String(text)
  return `\x1b[${code}m${text}${RESET}`
}

export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '')
}

// Lebar tampilan 1 karakter (emoji/CJK = 2, ZWJ & variation selector = 0)
export function charWidth(cp) {
  if (cp === 0x200d) return 0
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return 0
  if (cp >= 0x1f000) return 2
  if (cp >= 0x2600 && cp <= 0x27bf) return 2
  if (cp >= 0xff00 && cp <= 0xff60) return 2
  if (cp >= 0x2e80 && cp <= 0xa4cf) return 2
  if (cp >= 0xac00 && cp <= 0xd7a3) return 2
  return 1
}

// Lebar tampilan sebuah string (ANSI dibuang dulu)
export function dispWidth(text) {
  let w = 0
  for (const ch of stripAnsi(text)) w += charWidth(ch.codePointAt(0))
  return w
}
