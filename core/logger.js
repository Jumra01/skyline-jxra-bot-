/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * logger.js — Logger console berwarna: badge level, jam, context objek + box.
 * API: info/warn/error/success + child/level — drop-in buat semua pemanggil.
 * Terima urutan (msg, ctx) maupun (ctx, msg).
 */
import config from '../config.js'
import { paint, dispWidth } from './consoleStyle.js'

const PRIORITY = { silent: 100, trace: 10, debug: 20, info: 30, ok: 30, warn: 40, error: 50 }

// label = teks badge · badge = warna ANSI badge (bg;fg) · msg = warna pesan
const STYLES = {
  trace: { label: 'TRACE', badge: '100;97', msg: '90' },
  debug: { label: 'DEBUG', badge: '100;97', msg: '90' },
  info: { label: 'INFO', badge: '46;30', msg: '36' },
  ok: { label: 'OK', badge: '42;30', msg: '32' },
  warn: { label: 'WARN', badge: '43;30', msg: '33' },
  error: { label: 'ERROR', badge: '41;97', msg: '31' }
}

const BADGE_W = 5
const SKIP_KEYS = new Set(['level', 'time', 'pid', 'hostname', 'v'])
const pad2 = (n) => String(n).padStart(2, '0')

function clock(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function fmtVal(v) {
  if (v instanceof Error) return v.message
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function fmtContext(ctx) {
  const parts = []
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || SKIP_KEYS.has(k)) continue
    parts.push(`${k}=${fmtVal(v)}`)
  }
  return parts.join(' ')
}

// Terima dua urutan argumen: (msg, ctx) atau (ctx, msg).
function normalize(args) {
  let message = ''
  let context = null
  for (const a of args) {
    if (a === undefined || a === null) continue
    if (typeof a === 'string') message = message ? `${message} ${a}` : a
    else if (a instanceof Error) context = { ...(context || {}), err: a.message }
    else if (typeof a === 'object') context = { ...(context || {}), ...a }
    else message = message ? `${message} ${String(a)}` : String(a)
  }
  return { message, context }
}

function render(level, message, context) {
  const s = STYLES[level] ?? STYLES.info
  const time = paint('90', clock())
  const badge = paint(s.badge, ` ${s.label.padEnd(BADGE_W)} `)
  const bar = paint('90', '│')
  const msg = message ? paint(s.msg, message) : paint('90', '(kosong)')
  const ctxStr = context && Object.keys(context).length ? fmtContext(context) : ''
  return `${time} ${badge} ${bar} ${msg}${ctxStr ? '  ' + paint('90', ctxStr) : ''}`
}

class ConsoleLogger {
  constructor(level = 'info', bindings = null) {
    this._bindings = bindings
    this.level = level
  }

  get level() { return this._level }
  set level(v) {
    this._level = v
    this._min = PRIORITY[v] ?? PRIORITY.info
  }

  trace(...a) { this._write('trace', a) }
  debug(...a) { this._write('debug', a) }
  info(...a) { this._write('info', a) }
  warn(...a) { this._write('warn', a) }
  error(...a) { this._write('error', a) }
  success(...a) { this._write('ok', a) }

  child(bindings, options) {
    const merged = { ...(this._bindings || {}), ...(bindings || {}) }
    return new ConsoleLogger(options?.level ?? this._level, merged)
  }

  _write(level, args) {
    if (PRIORITY[level] < this._min) return
    const { message, context } = normalize(args)
    let ctx = context
    if (this._bindings && Object.keys(this._bindings).length) {
      ctx = { ...this._bindings, ...(context || {}) }
    }
    process.stdout.write(render(level, message, ctx) + '\n')
  }
}

export const logger = new ConsoleLogger(config.logLevel ?? 'info')
export const clientLogger = new ConsoleLogger(config.libraryLogLevel ?? 'warn')

// ── Box bergaris buat event penting (koneksi, pairing, siap, dll) ──
// title: baris judul (bold) · lines: baris isi · opts.color: kode warna ANSI
export function box(title, lines = [], opts = {}) {
  const c = opts.color ?? '36'
  const rows = []
  if (title) rows.push(paint(`1;${c}`, String(title)))
  for (const l of lines) {
    if (l === '' || l === null || l === undefined) { rows.push(''); continue }
    rows.push(String(l))
  }
  const w = Math.max(1, ...rows.map(dispWidth))
  const bar = paint(`2;${c}`, '─'.repeat(w + 2))
  const out = [paint(`2;${c}`, '╭') + bar + paint(`2;${c}`, '╮')]
  for (const row of rows) {
    const pad = ' '.repeat(Math.max(0, w - dispWidth(row)))
    out.push(paint(`2;${c}`, '│') + ' ' + row + pad + ' ' + paint(`2;${c}`, '│'))
  }
  out.push(paint(`2;${c}`, '╰') + bar + paint(`2;${c}`, '╯'))
  process.stdout.write(out.join('\n') + '\n')
}

logger.box = box
