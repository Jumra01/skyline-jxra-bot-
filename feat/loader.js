/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * loader.js — Scan feat/xx/xxx.js, daftarkan ke registry, support reload.
 * [UPDATE BELOW]
 */
import { readdir } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { logger } from '../core/logger.js'

const FEATURES_DIR = fileURLToPath(new URL('.', import.meta.url))
const SELF = fileURLToPath(import.meta.url)

const byCommand = new Map()
let loadedCount = 0
let lastFailed = []

async function walk(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else if (extname(entry.name) === '.js' && fullPath !== SELF) {
      files.push(fullPath)
    }
  }
  return files
}

// [UPDATE] Ubah error jadi satu baris yang jelas alasannya, gak cuma "Gagal memuat feature".
function describeImportError(err, filePath) {
  const short = relative(FEATURES_DIR, filePath)

  // [UPDATE] Import path salah / file tujuan gak ketemu (mis. '../../lib/uploadFile.js' typo/kepeleset)
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    const missing = err.message.match(/Cannot find (?:package|module) '([^']+)'/)?.[1]
    return `${short} -> modul tidak ditemukan: "${missing || '?'}" (cek path import di file ini)`
  }

  // [UPDATE] Syntax error pas parsing file-nya sendiri
  if (err instanceof SyntaxError || /Unexpected token|is not defined/i.test(err.message)) {
    const loc = err.stack?.split('\n')[0] ?? ''
    return `${short} -> syntax error: ${err.message} ${loc ? `(${loc})` : ''}`
  }

  // [UPDATE] Error lain yang keluar pas top-level module dieksekusi (mis. gagal init sesuatu)
  return `${short} -> ${err.name || 'Error'}: ${err.message}`
}

export async function loadFeatures() {
  byCommand.clear()
  const files = await walk(FEATURES_DIR)
  const failed = []
  let count = 0

  for (const filePath of files) {
    const short = relative(FEATURES_DIR, filePath)
    let mod

    // Tahap 1: import module-nya
    try {
      const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`
      mod = await import(moduleUrl)
    } catch (err) {
      const reason = describeImportError(err, filePath)
      logger.error(`Gagal memuat feature — ${reason}`)
      failed.push({ file: short, stage: 'import', reason })
      continue
    }

    // Tahap 2: validasi bentuk feature-nya
    const feature = mod.default
    if (!feature?.name || typeof feature.run !== 'function') {
      const missing = [
        !feature ? 'export default kosong/undefined' : null,
        feature && !feature.name ? '`name`' : null,
        feature && typeof feature.run !== 'function' ? '`run()`' : null,
      ].filter(Boolean).join(', ')
      const reason = `${short} -> shape invalid, yang kurang: ${missing}`
      logger.warn(reason)
      failed.push({ file: short, stage: 'validate', reason })
      continue
    }

    // Tahap 3: cek bentrok command/alias sebelum didaftarkan
    const keys = [feature.name.toLowerCase(), ...(feature.aliases ?? []).map(a => a.toLowerCase())]
    const clash = keys.find(k => byCommand.has(k) && byCommand.get(k) !== feature)
    if (clash) {
      const owner = byCommand.get(clash)
      const reason = `${short} -> command/alias "${clash}" udah dipakai feature lain (${owner.name})`
      logger.warn(reason)
      failed.push({ file: short, stage: 'conflict', reason })
      continue
    }

    for (const key of keys) byCommand.set(key, feature)
    count += 1
  }

  loadedCount = count
  lastFailed = failed

  logger.info(`${count} feature dimuat dari ${files.length} file${failed.length ? ` (${failed.length} gagal)` : ''}`)
  if (failed.length) {
    for (const f of failed) logger.error(`  ↳ [${f.stage}] ${f.reason}`)
  }

  return { count, total: files.length, failed }
}

export function getFeature(name) {
  return byCommand.get(name.toLowerCase())
}

export function listFeatures() {
  return [...new Set(byCommand.values())]
}

export function featureCount() {
  return loadedCount
}

export function lastLoadFailures() {
  return lastFailed
}
