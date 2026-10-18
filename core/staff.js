/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * staff.js — Staff & role management (PN + LID)
 */
import config from '../config.js'
import { logger } from './logger.js'

export function normalizeNumber(input) {
  let n = String(input ?? '').replace(/\D/g, '')
  if (n.startsWith('0')) n = `62${n.slice(1)}`
  return n
}

const lidDigits = (j) => String(j ?? '').replace(/\D/g, '')
const digitsOnly = (j) => String(j ?? '').replace(/\D/g, '').split(':')[0]

const ROLE_RANK = { owner: 2, admin: 1 }

const byNumber = new Map()
const byLid = new Map()

function putBestRole(map, key, entry) {
  const existing = map.get(key)
  if (!existing || (ROLE_RANK[entry.role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
    map.set(key, entry)
  }
}

for (const entry of config.staff) {
  const n = normalizeNumber(entry.number)
  if (n !== String(entry.number)) {
    logger.warn(`Nomor staff "${entry.number}" dinormalisasi jadi "${n}". Disarankan tulis format internasional tanpa +/0.`)
  }
  putBestRole(byNumber, n, entry)
  if (entry.lid) putBestRole(byLid, lidDigits(entry.lid), entry)
}

// Daftar owner dari config (format bebas — digit-strip dulu)
const ownerNums = new Set(
  (config.owner?.numbers ?? []).map((x) => normalizeNumber(x)).filter(Boolean)
)
const ownerLabel = config.owner?.name ?? 'Owner'

// Nomor bot sendiri — otomatis owner (di-set sekali dari credentials)
let botNumber = null

export function setBotNumber(jidOrNumber) {
  const n = digitsOnly(jidOrNumber)
  if (n && n !== botNumber) {
    botNumber = n
    logger.info(`🤖 Nomor bot +${n} otomatis di-set sebagai owner.`)
  }
}

/** Nomor bot sendiri (digit), buat deteksi mention nomor bot di .bot. */
export function getBotNumber() {
  return botNumber
}

export function getStaffEntry(pnNumber, lidJid) {
  const n = normalizeNumber(pnNumber)

  // 1) Bot sendiri → owner
  if (botNumber && n === botNumber) {
    return { role: 'owner', label: ownerLabel }
  }

  // 2) owner.numbers di config → owner (cukup isi nomor di config, selesai)
  if (n && ownerNums.has(n)) {
    return { role: 'owner', label: ownerLabel }
  }

  // 3) Fallback: staff map (PN dulu, lalu LID)
  return (
    byNumber.get(n) ??
    (lidJid ? byLid.get(lidDigits(lidJid)) : null) ??
    null
  )
}
