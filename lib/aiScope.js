/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aiScope.js — Deteksi jenis chat (grup / pribadi) + setelan global per jenis.
 *
 * Dipakai fitur AI otomatis (`.autoai`, `.ella`, `.ella2`) biar saklar grup
 * dan pribadi terpisah: per-chat pakai key lama, global pakai key berakhiran
 * jenis (`ella_group`, `ella_private`, dst.), dan key global LAMA (tanpa
 * akhiran) tetap dibaca sebagai fallback lalu dimigrasi otomatis.
 *
 * Semua fungsi di sini gak pernah melempar — kalau DB error, balikin null.
 */
import { getGlobal, setGlobal } from '../core/groupSettings.js'

export const KINDS = ['group', 'private']

export const KIND_LABEL = { group: 'grup', private: 'pribadi' }

/** `true`/ctx → 'group' | 'private'. */
export function kindOf(ctxOrIsGroup) {
  const isGroup = typeof ctxOrIsGroup === 'boolean' ? ctxOrIsGroup : Boolean(ctxOrIsGroup?.isGroup)
  return isGroup ? 'group' : 'private'
}

/** Baca kata 'grup'/'pribadi' (termasuk alias) → 'group' | 'private' | null. */
export function parseKind(word) {
  const w = String(word || '').trim().toLowerCase()
  if (['grup', 'group', 'gc', 'grub', 'grupnya'].includes(w)) return 'group'
  if (['pribadi', 'private', 'pc', 'dm', 'pm', 'personal'].includes(w)) return 'private'
  return null
}

export const scopeKey = (name, kind) => `${name}_${kind}`

/** Jenis chat dari JID saja (fallback buat fungsi yang cuma terima chat id). */
export function kindOfJid(chat) {
  return String(chat || '').endsWith('@g.us') ? 'group' : 'private'
}

function norm(v) {
  return v === '1' || v === '0' ? v : null
}

/**
 * Setelan global satu jenis: scoped dulu, lalu key legacy (berlaku dua jenis).
 * @returns {'1'|'0'|null}
 */
export function getGlobalKind(name, kind) {
  try {
    return norm(getGlobal(scopeKey(name, kind))) ?? norm(getGlobal(name))
  } catch {
    return null
  }
}

/** Status global dua jenis sekaligus: { group: '1'|'0'|null, private: ... } */
export function globalKindStates(name) {
  const out = {}
  for (const k of KINDS) out[k] = getGlobalKind(name, k)
  return out
}

/**
 * Pindahkan key global lama ke dua jenis (sekali saja).
 * Dipanggil sebelum menulis setelan per jenis biar jenis yang gak disentuh
 * tetap sama seperti sebelumnya.
 */
export function migrateGlobal(name) {
  try {
    const legacy = norm(getGlobal(name))
    if (!legacy) return false
    if (!norm(getGlobal(scopeKey(name, 'group')))) setGlobal(scopeKey(name, 'group'), legacy)
    if (!norm(getGlobal(scopeKey(name, 'private')))) setGlobal(scopeKey(name, 'private'), legacy)
    setGlobal(name, '')
    return true
  } catch {
    return false
  }
}

/** Tulis setelan global satu jenis ('1'/'0'). */
export function setGlobalKind(name, kind, on) {
  const k = KINDS.includes(kind) ? kind : 'group'
  try {
    migrateGlobal(name)
    setGlobal(scopeKey(name, k), on ? '1' : '0')
    return true
  } catch {
    return false
  }
}

/**
 * Tulis setelan global untuk dua jenis sekaligus.
 * @returns {boolean}
 */
export function setGlobalBoth(name, on) {
  let ok = true
  for (const k of KINDS) ok = setGlobalKind(name, k, on) && ok
  return ok
}

/** Label singkat buat status: 'aktif' / 'mati' / 'belum diatur'. */
export function kindLabel(value) {
  if (value === '1') return 'aktif'
  if (value === '0') return 'mati'
  return 'belum diatur'
}

export const _internals = { norm }
