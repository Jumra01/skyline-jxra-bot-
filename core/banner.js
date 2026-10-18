/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * banner.js — Tampilan console saat bot start: ASCII art + kotak info.
 * Dipanggil dari sky.js (printBanner + printInfo). Gak nyentuh logic bot.
 */
import fs from 'node:fs'
import os from 'node:os'
import config from '../config.js'

const RESET = '\x1b[0m'
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ASCII art "SKYLINE" + "JXRA" (block letters, font 5 baris).
const SKYLINE = [
  ' ██████ ██   ██ ██   ██ ██      ███████ ██    ██ ███████',
  '██      ██  ██   ██ ██  ██         ██   ███   ██ ██',
  ' █████  █████     ███   ██         ██   ██ ██ ██ █████',
  '     ██ ██  ██     ██   ██         ██   ██  ████ ██',
  '██████  ██   ██    ██   ███████ ███████ ██    ██ ███████'
]
const JXRA = [
  '   ████ ██   ██ ██████   █████',
  '     ██  ██ ██  ██   ██ ██   ██',
  '     ██   ███   ██████  ███████',
  '██   ██  ██ ██  ██  ██  ██   ██',
  ' █████  ██   ██ ██   ██ ██   ██'
]
const ART_WIDTH = 56
const ART = [
  ...SKYLINE,
  // "JXRA" dirapatkan ke kanan biar rata kanan sama baris SKYLINE
  ...JXRA.map((line) => ' '.repeat(ART_WIDTH - 31) + line)
]

// Warna ANSI cuma kalau didukung (TTY / FORCE_COLOR), hormati NO_COLOR.
const useColor = (() => {
  if (process.env.NO_COLOR) return false
  const fc = process.env.FORCE_COLOR
  if (fc !== undefined && fc !== '0' && fc !== 'false') return true
  return !!process.stdout.isTTY
})()

const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text)

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '')
}

// Lebar tampilan 1 karakter (emoji/CJK dihitung 2, ZWJ & variation selector 0).
function charWidth(cp) {
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

function dispWidth(text) {
  let w = 0
  for (const ch of stripAnsi(text)) w += charWidth(ch.codePointAt(0))
  return w
}

// Gradasi warna per kolom buat ASCII art (biru muda → biru tua).
function paintArt(line, colors) {
  if (!useColor) return line
  const [from, to] = colors
  let out = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === ' ') { out += ch; continue }
    const t = ART_WIDTH <= 1 ? 0 : i / (ART_WIDTH - 1)
    const r = Math.round(from[0] + (to[0] - from[0]) * t)
    const g = Math.round(from[1] + (to[1] - from[1]) * t)
    const b = Math.round(from[2] + (to[2] - from[2]) * t)
    out += `\x1b[38;2;${r};${g};${b}m${ch}`
  }
  return out + RESET
}

function fmtTimeWIB(date) {
  const opts = { timeZone: 'Asia/Jakarta', hour12: false }
  const d = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', ...opts })
  const t = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...opts })
  return `${d} · ${t} WIB`
}

// Banner ASCII art — dipanggil di awal main().
export function printBanner() {
  const gradFrom = [125, 211, 252] // sky-300
  const gradTo = [37, 99, 235] // blue-600
  const colors = [gradFrom, gradTo]

  console.log('')
  for (const line of ART) console.log(paintArt(line, colors))
  console.log('')
  console.log('  ' + paint('2', '⚡ next-gen WhatsApp bot') + paint('2', ' · ') + paint('2', 'powered by zapo-js'))
  console.log('')
}

// Kotak info — dipanggil setelah loadFeatures() biar jumlah fitur kebaca.
export function printInfo({ count = 0, total = 0, failed = [] } = {}) {
  const owner = config.owner ?? {}
  const ownerText = [owner.name, Array.isArray(owner.numbers) ? owner.numbers[0] : owner.numbers]
    .filter(Boolean)
    .join(' · ') || '-'
  const prefixText = (config.prefixes ?? [config.mainPrefix ?? '.']).join(' ')
  const featureText = `${count}/${total} dimuat${failed.length ? ` · ${failed.length} gagal` : ''}`

  const rows = [
    ['🤖', 'bot', `${config.botName} · v${pkg.version ?? '0.0.0'}`],
    ['👑', 'owner', ownerText],
    ['🔤', 'prefix', prefixText],
    ['🧩', 'fitur', featureText],
    ['🟢', 'runtime', `node ${process.version} · ${os.platform()} ${os.arch()}`],
    ['🕐', 'start', fmtTimeWIB(new Date())]
  ]

  const LABEL_W = 7
  const body = rows.map(([icon, label, value]) =>
    `${icon} ${paint('1;36', label.padEnd(LABEL_W))} ${value}`
  )
  const width = Math.max(...body.map(dispWidth))
  const bar = paint('2;36', '─'.repeat(width + 2))

  console.log(paint('2;36', '╭') + bar + paint('2;36', '╮'))
  for (const line of body) {
    const pad = ' '.repeat(Math.max(0, width - dispWidth(line)))
    console.log(paint('2;36', '│') + ' ' + line + pad + ' ' + paint('2;36', '│'))
  }
  console.log(paint('2;36', '╰') + bar + paint('2;36', '╯'))
  console.log('')
}
