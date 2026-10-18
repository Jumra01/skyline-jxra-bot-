/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * banner.js — Tampilan console saat bot start: ASCII art + kotak info.
 * Dipanggil dari sky.js (printBanner + printInfo). Gak nyentuh logic bot.
 *
 * ── GANTI TULISAN BANNER (gampang) ──
 * Cukup edit `words` di config.js (blok `banner`). Tiap kata auto di-render
 * jadi block letters 5 baris — huruf besar/kecil bebas, gak perlu nyusun manual.
 *   banner: {
 *     words: [
 *       { text: 'SKYLINE', align: 'left'  },
 *       { text: 'JXRA',    align: 'right' },
 *     ],
 *     tagline: '⚡ next-gen WhatsApp bot · powered by zapo-js',
 *   }
 * Kalau blok `banner` di config gak ada, dipakai DEFAULT_WORDS di bawah.
 */
import fs from 'node:fs'
import os from 'node:os'
import config from '../config.js'
import { paint, colorsEnabled, dispWidth, RESET } from './consoleStyle.js'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ── Font block 5 baris (tiap glyph lebarnya boleh beda, barisnya wajib rata) ──
const GLYPH_H = 5
const GAP = 1 // spasi antar huruf
const FONT = {
  A: [' █████ ', '██   ██', '███████', '██   ██', '██   ██'],
  B: ['██████ ', '██   ██', '██████ ', '██   ██', '██████ '],
  C: [' ██████', '██     ', '██     ', '██     ', ' ██████'],
  D: ['██████ ', '██   ██', '██   ██', '██   ██', '██████ '],
  E: ['███████', '██     ', '█████  ', '██     ', '███████'],
  F: ['███████', '██     ', '█████  ', '██     ', '██     '],
  G: [' ██████', '██     ', '██ ████', '██   ██', ' ██████'],
  H: ['██   ██', '██   ██', '███████', '██   ██', '██   ██'],
  I: ['███████', '   ██  ', '   ██  ', '   ██  ', '███████'],
  J: ['   ████', '     ██', '     ██', '██   ██', ' █████ '],
  K: ['██   ██', '██  ██ ', '█████  ', '██  ██ ', '██   ██'],
  L: ['██     ', '██     ', '██     ', '██     ', '███████'],
  M: ['██   ██', '███████', '███████', '██   ██', '██   ██'],
  N: ['██    ██', '███   ██', '██ ██ ██', '██  ████', '██    ██'],
  O: [' █████ ', '██   ██', '██   ██', '██   ██', ' █████ '],
  P: ['██████ ', '██   ██', '██████ ', '██     ', '██     '],
  Q: [' █████ ', '██   ██', '██   ██', '██ ████', ' ██████'],
  R: ['██████ ', '██   ██', '██████ ', '██  ██ ', '██   ██'],
  S: [' ██████', '██     ', ' █████ ', '     ██', '██████ '],
  T: ['███████', '   ██  ', '   ██  ', '   ██  ', '   ██  '],
  U: ['██   ██', '██   ██', '██   ██', '██   ██', ' █████ '],
  V: ['██   ██', '██   ██', '██   ██', ' ██ ██ ', '  ███  '],
  W: ['██   ██', '██   ██', '███████', '███████', '██   ██'],
  X: ['██   ██', ' ██ ██ ', '  ███  ', ' ██ ██ ', '██   ██'],
  Y: ['██   ██', ' ██ ██ ', '  ███  ', '   ██  ', '   ██  '],
  Z: ['███████', '    ██ ', '  ███  ', ' ██    ', '███████'],
  0: [' █████ ', '██   ██', '██   ██', '██   ██', ' █████ '],
  1: ['   ██  ', '  ███  ', '   ██  ', '   ██  ', '███████'],
  2: [' █████ ', '██   ██', '   ██  ', '  ██   ', '███████'],
  3: ['██████ ', '     ██', ' █████ ', '     ██', '██████ '],
  4: ['██   ██', '██   ██', '███████', '     ██', '     ██'],
  5: ['███████', '██     ', '██████ ', '     ██', '██████ '],
  6: [' █████ ', '██     ', '██████ ', '██   ██', ' █████ '],
  7: ['███████', '     ██', '    ██ ', '   ██  ', '   ██  '],
  8: [' █████ ', '██   ██', ' █████ ', '██   ██', ' █████ '],
  9: [' █████ ', '██   ██', ' ██████', '     ██', ' █████ '],
  ' ': ['       ', '       ', '       ', '       ', '       '],
  '-': ['       ', '       ', ' █████ ', '       ', '       '],
  '.': ['       ', '       ', '       ', '       ', '   ██  '],
  '!': ['   ██  ', '   ██  ', '   ██  ', '       ', '   ██  '],
  '?': [' █████ ', '██   ██', '   ██  ', '       ', '   ██  ']
}

// Dipakai kalau config.banner gak diisi
const DEFAULT_WORDS = [
  { text: 'SKYLINE', align: 'left' },
  { text: 'JXRA', align: 'right' }
]
const DEFAULT_TAGLINE = '⚡ next-gen WhatsApp bot · powered by zapo-js'

// Satu glyph → baris-baris rata sendiri (lebar = baris terpanjang)
function glyphRows(ch) {
  const raw = FONT[ch] ?? FONT['?']
  const w = Math.max(...raw.map((r) => r.length))
  return raw.map((r) => r.padEnd(w))
}

// Satu kata → array baris (tinggi GLYPH_H)
function renderWord(text) {
  const rows = Array.from({ length: GLYPH_H }, () => '')
  for (const ch of String(text).toUpperCase()) {
    const glyph = glyphRows(ch)
    for (let r = 0; r < GLYPH_H; r++) rows[r] += glyph[r] + ' '.repeat(GAP)
  }
  return rows.map((r) => r.replace(/\s+$/, ''))
}

// Gabung beberapa kata jadi art (align per kata: left | center | right)
function buildArt(words) {
  const blocks = words
    .filter((w) => w && String(w.text ?? w).trim() !== '')
    .map((w, i) => {
      const raw = typeof w === 'string' ? { text: w } : w
      return {
        rows: renderWord(raw.text),
        align: raw.align ?? (i === 0 ? 'left' : 'right')
      }
    })
  if (!blocks.length) return buildArt(DEFAULT_WORDS)

  const width = Math.max(...blocks.flatMap((b) => b.rows.map((r) => r.length)))
  const lines = []
  for (const block of blocks) {
    for (const r of block.rows) {
      const pad =
        block.align === 'right' ? width - r.length
          : block.align === 'center' ? Math.floor((width - r.length) / 2)
            : 0
      lines.push(' '.repeat(Math.max(0, pad)) + r)
    }
  }
  return { lines, width }
}

// ── Ambil setting dari config (fallback ke default) ──
const bannerCfg = config.banner ?? {}
const WORDS = Array.isArray(bannerCfg.words) && bannerCfg.words.length
  ? bannerCfg.words
  : DEFAULT_WORDS
const TAGLINE = bannerCfg.tagline ?? DEFAULT_TAGLINE

const { lines: ART, width: ART_WIDTH } = buildArt(WORDS)

// Gradasi warna per kolom buat ASCII art (biru muda → biru tua)
function paintArt(line, colors) {
  if (!colorsEnabled) return line
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

// Banner ASCII art — dipanggil di awal main()
export function printBanner() {
  const gradFrom = [125, 211, 252] // sky-300
  const gradTo = [37, 99, 235] // blue-600
  const colors = [gradFrom, gradTo]

  console.log('')
  for (const line of ART) console.log(paintArt(line, colors))
  console.log('')
  console.log('  ' + paint('2', TAGLINE))
  console.log('')
}

// Kotak info — dipanggil setelah loadFeatures() biar jumlah fitur kebaca
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
