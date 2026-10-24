/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * keepMigrate.js — rapihin backup config lama sebelum dipulihkan.
 *
 * Blok `omniedit` sudah DIGABUNG ke `skyline` di config.js — backup yang
 * dibuat `.updatesc` versi lama masih menyimpan blok `omniedit`, jadi
 * `normalizeBackup()` mindahin nilainya ke `skyline` lalu buang blok lamanya
 * (biar pemulihan gak nulis ke blok yang udah gak ada).
 *
 * Dipakai `plugins/owner/updatesc.js` (auto-restore) dan
 * `plugins/owner/restore.js` (manual). Sengaja DIPISAH dari
 * lib/keepSettings.js: plugin yang di-hot-reload bisa import path baru
 * tanpa nunggu `lib/keepSettings.js` di module cache diganti restart.
 */
import { promises as fs } from 'node:fs'

const BAK = 'config.js.update.bak'

/** Rentang `{ ... }` milik blok `name` (brace-aware). */
function blockRange(src, name) {
  const at = src.search(new RegExp(`(^|\\n)[ \\t]*${name}[ \\t]*:[ \\t]*\\{`))
  if (at < 0) return null
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return { at, open, close: i + 1 }
    }
  }
  return null
}

/** Nilai string field di dalam blok ('' kalau gak ada / kosong). */
export function blockValue(src, name, key) {
  const b = blockRange(src, name)
  if (!b) return ''
  const seg = src.slice(b.open, b.close)
  const m = seg.match(new RegExp(`(^|[\\s{,])${key}[ \\t]*:[ \\t]*(['"\`])([^'"\`]*)\\2`))
  return m ? m[3] : ''
}

/** Ganti nilai string field di dalam blok. */
function setBlockValue(src, name, key, value) {
  const b = blockRange(src, name)
  if (!b) return src
  const seg = src.slice(b.open, b.close)
  const re = new RegExp(`(^|[\\s{,])(${key}[ \\t]*:[ \\t]*)(['"\`])([^'"\`]*)\\3`)
  const nseg = seg.replace(re, (_f, pre, decl, q) => `${pre}${decl}${q}${value}${q}`)
  return src.slice(0, b.open) + nseg + src.slice(b.close)
}

/** Buang satu blok `name: { ... },` sekaligus barisnya. */
function removeBlock(src, name) {
  const b = blockRange(src, name)
  if (!b) return src
  const start = src.lastIndexOf('\n', b.at) + 1
  let end = b.close
  if (src[end] === ',') end++
  while (src[end] === ' ' || src[end] === '\t' || src[end] === '\r') end++
  if (src[end] === '\n') end++
  return src.slice(0, start) + src.slice(end)
}

/**
 * Rapikan backup lama: `omniedit` → `skyline`. Idempoten.
 * Balikin `true` kalau file backup diubah, `false` kalau gak ada / udah rapi.
 */
export async function normalizeBackup() {
  let src
  try {
    src = await fs.readFile(BAK, 'utf8')
  } catch {
    return false
  }
  if (!blockRange(src, 'omniedit')) return false

  const omniKey = blockValue(src, 'omniedit', 'apikey')
  const omniSite = blockValue(src, 'omniedit', 'website')

  // Config jadul (sebelum fitur YouTube) cuma punya blok `omniedit` —
  // cukup ganti nama bloknya, isinya sama (`website` + `apikey`).
  if (!blockRange(src, 'skyline') && omniKey) {
    src = src.replace(/(^|\n)([ \t]*)omniedit([ \t]*:[ \t]*\{)/, '$1$2skyline$3')
    await fs.writeFile(BAK, src, 'utf8')
    return true
  }

  // Blok `skyline` sudah ada → pindah nilai yang belum keisi, lalu buang
  // `omniedit` (biar gak ada sisa field yang bikin restore dianggap gagal).
  if (blockRange(src, 'skyline')) {
    if (omniKey && !blockValue(src, 'skyline', 'apikey')) {
      src = setBlockValue(src, 'skyline', 'apikey', omniKey)
    }
    if (omniSite && !blockValue(src, 'skyline', 'website')) {
      src = setBlockValue(src, 'skyline', 'website', omniSite)
    }
  }

  src = removeBlock(src, 'omniedit')
  await fs.writeFile(BAK, src, 'utf8')
  return true
}
