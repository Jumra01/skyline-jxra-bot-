/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * autoai.js — Konfigurasi **Auto AI per-grup (+ global)**: on/off, karakter, mode.
 *
 * PERSIST di settings.sqlite lewat core/groupSettings.js: per-grup key
 * `autoai`, global key `autoai`/`autoai_group`/`autoai_private`, persona
 * custom global key `autoai_personas`.
 *
 * Dipakai plugins/group/autoai.js (command) + plugins/ai/bot.js (trigger
 * tag/bales pesan bot).
 */
import { getSetting, setSetting, getGlobal, setGlobal } from '../core/groupSettings.js'
import { DEFAULT_PERSONA, readPersona } from './aiPersona.js'

export const MODES = ['onlychat', 'assistant']

/* ══════════════════════ karakter bawaan ══════════════════════ */
export const CHARACTERS = {
  furina: {
    name: 'Furina',
    instruction:
      'Kamu adalah Furina dari Genshin Impact. Bicara santai tapi elegan, sedikit dramatis, kadang agak bangga diri tapi tetap hangat. Jangan terlalu panjang, jawab langsung ke inti seperti chat biasa. Sesekali boleh nyenggol tema panggung atau laut. Jangan mengaku sebagai AI.',
  },
  zeta: {
    name: 'Zeta',
    instruction:
      'Kamu adalah Zeta dari Spy x Family. Bicara serius dan tenang, tapi selalu agak curiga seperti mencium konspirasi. Tetap natural seperti orang ngobrol biasa, singkat dan langsung ke poin. Jangan mengaku sebagai AI.',
  },
  kobo: {
    name: 'Kobo Kanaeru',
    instruction:
      'Kamu adalah Kobo Kanaeru. Bicara santai, ceria, agak usil. Gaya chat biasa, tidak terlalu panjang. Boleh sedikit random atau lucu. Jangan berlebihan pakai caps atau emoji. Jangan mengaku sebagai AI.',
  },
  elaina: {
    name: 'Elaina',
    instruction:
      'Kamu adalah Elaina. Bicara lembut, tenang, percaya diri, sedikit narsis halus. Jawab singkat, rapi, dan langsung ke inti seperti chat normal. Jangan mengaku sebagai AI.',
  },
  waguri: {
    name: 'Waguri',
    instruction:
      'Kamu adalah Waguri. Bicara singkat, agak dingin tapi sebenarnya peduli. Sedikit tsundere, to the point, seperti chat biasa. Jangan mengaku sebagai AI.',
  },
  bell409: { name: 'Bella Clarissa', instruction: DEFAULT_PERSONA },
}

// Bell409 = persona default (.setpersona) → biar gampang dipanggil pakai nama lain
CHARACTERS.bella = CHARACTERS.bell409

export const DEFAULT_CHARACTER = 'bell409'

/* ══════════════════════ parser kecil (aman, gak pernah lempar) ══════════════════════ */
function parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

/* ══════════════════════ config per-grup & global ══════════════════════ */
export function getGroupConfig(chat) {
  return parseJson(getSetting(chat, 'autoai'))
}

export function setGroupConfig(chat, cfg) {
  setSetting(chat, 'autoai', JSON.stringify(cfg))
}

export function getGlobalConfig(kind = null) {
  return parseJson(getGlobal(kind ? `autoai_${kind}` : 'autoai'))
}

export function setGlobalConfig(cfg, kind = null) {
  setGlobal(kind ? `autoai_${kind}` : 'autoai', JSON.stringify(cfg))
}

/**
 * Pindahkan config global lama (satu untuk semua chat) ke `autoai_group` &
 * `autoai_private` — dipanggil sebelum menulis setelan jenis biar jenis yang
 * gak disentuh gak ikut berubah.
 */
export function migrateGlobalConfig() {
  const legacy = getGlobalConfig()
  if (!legacy) return false
  if (!getGlobalConfig('group')) setGlobalConfig(legacy, 'group')
  if (!getGlobalConfig('private')) setGlobalConfig(legacy, 'private')
  setGlobal('autoai', '')
  return true
}

/**
 * Matiin auto AI global buat satu jenis chat (atau dua-duanya kalau `kind`
 * kosong). Jenis yang lagi mati gak ditulis ulang.
 * @returns {boolean} true kalau ada yang berubah
 */
export function disableGlobalAutoAI(kind = null) {
  migrateGlobalConfig()
  let changed = false
  for (const k of kind ? [kind] : ['group', 'private']) {
    const cur = getGlobalConfig(k)
    if (cur?.enabled) {
      setGlobalConfig({ ...cur, enabled: false }, k)
      changed = true
    }
  }
  return changed
}

/* ══════════════════════ persona custom ══════════════════════ */
export function listCustomPersonas() {
  return parseJson(getGlobal('autoai_personas')) || {}
}

export function addCustomPersona(key, { name, instruction, by } = {}) {
  const k = String(key || '').trim().toLowerCase().replace(/\s+/g, '_')
  if (!k || !instruction) return false
  const all = listCustomPersonas()
  all[k] = { name: String(name || k), instruction: String(instruction).trim(), by: by || null, at: Date.now() }
  setGlobal('autoai_personas', JSON.stringify(all))
  return true
}

export function removeCustomPersona(key) {
  const k = String(key || '').trim().toLowerCase()
  const all = listCustomPersonas()
  if (!all[k]) return false
  delete all[k]
  setGlobal('autoai_personas', JSON.stringify(all))
  return true
}

/** Cari persona (bawaan atau custom) → { name, instruction } | null. */
export function findPersona(key) {
  const k = String(key || '').trim().toLowerCase()
  if (!k) return null
  // Bell409 = persona aktif (ikut `.setpersona` / data/ai-persona.txt)
  if (k === 'bell409' || k === 'bella') return { name: 'Bella Clarissa', instruction: readPersona() }
  if (CHARACTERS[k]) return CHARACTERS[k]
  const custom = listCustomPersonas()
  if (custom[k]) return { name: custom[k].name || k, instruction: custom[k].instruction || '' }
  return null
}

/** Daftar semua key persona (bawaan dulu, baru custom). */
export function allPersonaKeys() {
  return [...Object.keys(CHARACTERS), ...Object.keys(listCustomPersonas())]
}

/* ══════════════════════ resolusi config aktif ══════════════════════ */
/**
 * Config auto AI yang berlaku untuk satu chat — urutan: config per-chat →
 * global jenis chat (`group`/`private`) → global lama → default implicit.
 * `enabled:false` = user minta matiin (chat opt-out / global off) → jangan balas.
 *
 * @param {string} chat
 * @param {'group'|'private'|null} [kind] jenis chat (opsional, biar global bisa dipisah)
 */
export function resolveAutoAI(chat, kind = null) {
  const g = getGroupConfig(chat)
  if (g) {
    if (g.enabled) return { ...g, enabled: true, source: 'group' }
    return { enabled: false, source: 'group-off' }
  }

  const scoped = kind ? getGlobalConfig(kind) : null
  const gl = scoped || getGlobalConfig()
  if (gl) {
    if (gl.enabled) return { ...gl, enabled: true, source: scoped ? `global-${kind}` : 'global' }
    return { enabled: false, source: scoped ? `global-${kind}-off` : 'global-off' }
  }

  // Belum pernah diatur sama sekali → tetap jalan (perilaku lama), persona aktif
  return {
    enabled: true,
    character: 'default',
    characterName: 'Bella Clarissa',
    instruction: readPersona(),
    mode: 'onlychat',
    source: 'default',
    implicit: true,
  }
}

/* ══════════════════════ bangun config baru dari flag command ══════════════════════ */
/**
 * Susun config dari argumen `.autoai on ...`.
 * @returns {{ ok:true, cfg:object } | { ok:false, error:string }}
 */
export function buildConfig({ charKey, logic, mode, responseType, prev, by } = {}) {
  const mMode = MODES.includes(String(mode || '').toLowerCase()) ? String(mode).toLowerCase() : null
  const mType = String(responseType || 'text').toLowerCase()

  let character = 'default'
  let characterName = 'Bella Clarissa'
  let instruction = readPersona()

  if (charKey) {
    const key = String(charKey).toLowerCase()
    if (key === 'custom') {
      if (!logic) return { ok: false, error: 'Mode *custom* butuh `--logic=<instruksi>`.' }
      character = 'custom'
      characterName = 'Custom'
      instruction = String(logic).trim()
    } else {
      const found = findPersona(key)
      if (!found) return { ok: false, error: `Karakter *${key}* gak ada.` }
      character = key
      characterName = found.name
      instruction = found.instruction
    }
  } else if (prev?.enabled && prev.instruction) {
    // `on` tanpa karakter → pertahankan karakter yang sudah dipilih
    character = prev.character || 'default'
    characterName = prev.characterName || 'Bella Clarissa'
    instruction = prev.instruction
  }

  return {
    ok: true,
    cfg: {
      enabled: true,
      character,
      characterName,
      instruction,
      mode: mMode || (prev?.enabled && MODES.includes(prev.mode) ? prev.mode : 'onlychat'),
      responseType: mType === 'voice' ? 'text' : mType, // voice belum didukung → text
      activatedBy: by || null,
      activatedAt: new Date().toISOString(),
    },
  }
}
