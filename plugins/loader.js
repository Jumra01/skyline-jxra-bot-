/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * loader.js — Scan plugins/xx/xxx.js, daftarkan ke registry, support reload.
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

// [UPDATE] Format skyline-md: export { pluginConfig as config, handler }.
// Dinormalisasi ke shape internal route() (owner/admin/tags/aliases/cooldown ms).
function fromSkyline(mod) {
  const c = mod.config
  if (!c?.name || typeof mod.handler !== 'function') return null
  return {
    // field asli skyline (dipertahankan buat menu/detail)
    usage: c.usage,
    example: c.example,
    limit: c.limit,
    energi: c.energi,
    isPremium: !!c.isPremium,
    isGroup: !!c.isGroup,
    isPrivate: !!c.isPrivate,
    isBotAdmin: !!c.isBotAdmin,
    isEnabled: c.isEnabled !== false,
    // mapping ke shape route() lama
    name: c.name,
    aliases: c.alias ?? [],
    tags: c.category ?? 'general',
    description: c.description ?? '',
    owner: !!c.isOwner,
    admin: !!c.isAdmin,
    group: !!c.isGroup,
    private: !!c.isPrivate,
    premium: !!c.isPremium,
    botAdmin: !!c.isBotAdmin,
    // skyline pakai DETIK → route() pakai milidetik
    cooldown: (Number(c.cooldown) || 0) * 1000,
    run: mod.handler
  }
}

// [UPDATE] Format lama: export default { name, aliases, tags, run }.
function fromLegacy(mod) {
  const feature = mod.default
  if (!feature?.name || typeof feature.run !== 'function') return null
  return feature
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

    // Tahap 2: validasi bentuk feature-nya (support skyline + legacy)
    let feature = fromSkyline(mod)
    let format = 'skyline'
    if (!feature) {
      feature = fromLegacy(mod)
      format = 'legacy'
    }
    if (!feature) {
      const missing = [
        !mod.config && !mod.default ? 'export config/default kosong' : null,
        mod.config && typeof mod.handler !== 'function' ? '`handler()` (format skyline)' : null,
        mod.default && !mod.default.name ? '`name`' : null,
        mod.default && typeof mod.default.run !== 'function' ? '`run()` (format legacy)' : null
      ].filter(Boolean).join(', ') || 'bentuk gak dikenali (butuh `config`+`handler` ATAU `export default { name, run }`)'
      const reason = `${short} -> shape invalid: ${missing}`
      logger.warn(reason)
      failed.push({ file: short, stage: 'validate', reason })
      continue
    }

    // [UPDATE] Plugin nonaktif (isEnabled: false) — dilewati, bukan gagal
    if (feature.isEnabled === false) {
      logger.info(`⏸ feature ${feature.name} nonaktif (isEnabled: false) — dilewati`)
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
