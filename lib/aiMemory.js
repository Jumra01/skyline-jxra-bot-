/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aiMemory.js — MEMORI JANGKA PANJANG AI chat (.bot): catatan fakta tentang user.
 *
 * Kenapa: sesi/riwayat obrolan ada batasnya (session Gemini bisa basi, riwayat
 * dipotong `maxHistory`). Fakta penting ("namaku Rina", "aku suka matcha")
 * kalau cuma nempel di riwayat bisa hilang → AI kerasa "keriset/amnesia".
 *
 * Desain HEMAT (RAM/disk kecil — permintaan owner):
 *   • 1 file JSON: `data/ai-memory.json`, 1 baris per user.
 *   • Maks 25 fakta per user, tiap nilai ≤ 160 karakter.
 *   • Penyimpanan di-debounce (1,5 detik) + file di-prune: user lama dibuang
 *     (maks 500 user terakhir yang aktif) → file tetap kecil.
 *   • Ekstraksi pola = sinkron & instan (0 panggilan AI, 0 biaya). Ekstraksi
 *     pakai AI (opsional, `aiChat.rememberEvery`) jalan di belakang layar.
 *   • Yang dibaca masuk prompt cuma ringkasannya, dipotong ≤ 900 karakter.
 */
import fs from 'node:fs'

const FILE = './data/ai-memory.json'
const DIR = './data'
const MAX_USERS = 500      // user terakhir yang aktif (sisanya dibuang saat simpan)
const MAX_FACTS = 25       // fakta per user
const MAX_LEN = 160        // panjang 1 nilai fakta
const MAX_BLOCK_CHARS = 900 // maksimal teks memori yang masuk prompt

/** Key yang boleh punya banyak nilai (mis. banyak kegemaran). */
const MULTI_KEYS = new Set(['suka', 'gak suka', 'punya', 'catatan'])
/** Key yang dikenal (di luar ini → dianggap 'catatan'). */
export const ALLOWED_KEYS = new Set([
  'nama', 'suka', 'gak suka', 'umur', 'tinggal', 'kerja', 'sekolah', 'ultah', 'punya', 'hobi', 'catatan',
])
/** Label rapi buat ditampilkan di prompt/pesan. */
const LABEL = {
  nama: 'Nama', suka: 'Suka', 'gak suka': 'Gak suka', umur: 'Umur', tinggal: 'Tinggal di',
  kerja: 'Kerja di', sekolah: 'Sekolah/Kuliah di', ultah: 'Ulang tahun', punya: 'Punya',
  hobi: 'Hobi', catatan: 'Catatan',
}

/* ════════════════ penyimpanan (Map + debounce save) ════════════════ */
const store = new Map() // jid -> { at, facts: [{ k, v, at }] }
let saveTimer = null

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    for (const [jid, v] of Object.entries(raw || {})) {
      const facts = Array.isArray(v?.facts)
        ? v.facts
            .filter((f) => f && typeof f.k === 'string' && typeof f.v === 'string' && f.v.trim())
            .slice(0, MAX_FACTS)
        : []
      if (!facts.length) continue
      store.set(jid, { at: Number(v.at) || 0, facts })
    }
  } catch { /* belum ada / rusak → mulai kosong */ }
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.mkdirSync(DIR, { recursive: true })
      const top = [...store.entries()]
        .filter(([, v]) => v.facts.length)
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
        .slice(0, MAX_USERS)
      const obj = {}
      for (const [jid, v] of top) obj[jid] = { at: v.at, facts: v.facts.slice(-MAX_FACTS) }
      const tmp = `${FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(obj))
      fs.renameSync(tmp, FILE)
    } catch { /* gagal simpan → jangan ganggu chat */ }
  }, 1500)
  if (saveTimer.unref) saveTimer.unref()
}

/* ════════════════ util nilai ════════════════ */
function cleanValue(v) {
  let s = String(v ?? '').trim()
  s = s.replace(/^(?:sama|sma|itu|adalah|dengan|bagi)\s+/i, '')
  s = s.replace(/\b(?:ya|yah|dong|sih|lah|kok|deh|nih|kan|tuh|aja|saja)\s*$/i, '').trim()
  s = s.replace(/^[:\-\s]+/, '').replace(/[.,;!?]+$/, '').trim()
  if (s.length < 2) return ''
  if (/^(aku|kamu|dia|saya|gue|gw|orang|apa|itu|gitu|gini)$/i.test(s)) return ''
  return s.slice(0, MAX_LEN)
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/* ════════════════ ekstraksi pola (instan, tanpa AI) ════════════════ */
const RULES = [
  { k: 'nama', re: /\b(?:nama(?:ku| saya| gue| gw)|panggil(?: aku| saya| gue| gw))\s*(?:adalah|itu|:)?\s*([A-Za-zÀ-ÿ][\w'’.\- ]{1,30})/i },
  { k: 'gak suka', re: /\b(?:aku|saya|gue|gw)\s+(?:gak|ga|nggak|tidak|kurang)\s*suka\s+(?:sama\s+|sma\s+)?([^.,!?\n]{2,60})/i },
  { k: 'suka', re: /\b(?:aku|saya|gue|gw)\s+(?:sangat|paling|suka\s+banget\s+|banget\s+)?suka\s+(?:sama\s+|sma\s+)?([^.,!?\n]{2,60})/i },
  { k: 'umur', re: /\b(?:umur(?:ku| saya)|usiaku)\s*(?:adalah|itu|:)?\s*(\d{1,2})\b/i },
  { k: 'umur', re: /\b(?:aku|saya)\s+(\d{1,2})\s*tahun\b/i },
  { k: 'tinggal', re: /\b(?:aku|saya|gue|gw|rumahku)\s+(?:tinggal|domisili|mukim)?\s*(?:di|:)\s*([^.,!?\n]{2,50})/i },
  { k: 'kerja', re: /\b(?:aku|saya)\s+(?:kerja|bekerja|kantor)\s+di\s+([^.,!?\n]{2,50})/i },
  { k: 'sekolah', re: /\b(?:aku|saya)\s+(?:sekolah|kuliah|belajar)\s+di\s+([^.,!?\n]{2,50})/i },
  { k: 'ultah', re: /\b(?:ultah(?:ku| saya)|ulang tahun(?:ku| saya)|tanggal lahir(?:ku| saya))\s*(?:adalah|itu|:)?\s*([^.,!?\n]{2,40})/i },
  { k: 'hobi', re: /\b(?:hobiku|hobi saya|hobi gue|hobi gw)\s*(?:adalah|itu|:)?\s*([^.,!?\n]{2,50})/i },
  { k: 'punya', re: /\b(?:aku|saya)\s+punya\s+([^.,!?\n]{2,50})/i },
  { k: 'catatan', re: /\b(?:inget(?:-|\s)?(?:ya|in|dong|lah)?|catet|catat|note)\b[:,]?\s*([^.!?\n]{4,120})/i },
]

/** Key yang nilainya satu tempat (mis. kota/kantor) — potong kalau ada kalimat lanjutan. */
const PLACE_KEYS = new Set(['tinggal', 'kerja', 'sekolah'])

/** Kalimat tanya / pertanyaan ke bot → JANGAN dianggap fakta (biang catatan kotor). */
function isQuestion(c) {
  if (c.includes('?')) return true
  if (/^(?:apa|apakah|siapa|mana|dimana|di mana|kapan|kenapa|mengapa|gimana|bagaimana|berapa|kok|kah|emang|memang)\b/i.test(c)) return true
  if (/\b(?:inget|ingat)\s+(?:gak|ga|nggak|enggak|tidak|kah)\b/i.test(c)) return true
  if (/^(?:kamu|kau|lu|elo|anda|km)\b/i.test(c)) return true
  return false
}

/** Nilai yang gak layak jadi fakta (kata tanya / potongan pertanyaan). */
const BAD_VALUE = /\b(?:apa|siapa|mana|dimana|kapan|kenapa|gimana|bagaimana|berapa|kok|apakah)\b|\?|\b(?:kamu|kau|lu)\s+(?:tau|tahu|inget|ingat)\b/i

/** Ambil fakta dari teks pesan user (sinkron & murah). Maks 4 per pesan. */
export function extractFacts(text) {
  const t = String(text || '')
  if (!t || t.length > 500) return []
  // Cuma ambil dari kalimat PERNYATAAN (kalimat tanya dibuang) — mis.
  // "kamu masih inget gak aku suka apa dan aku tinggal di mana?" → gak nyatet apa pun.
  const statements = t
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s && !isQuestion(s))
    .join('. ')
  if (!statements) return []

  const out = []
  const seen = new Set()
  for (const rule of RULES) {
    const m = statements.match(rule.re)
    if (!m) continue
    let v = cleanValue(m[1] || m[2])
    if (!v || BAD_VALUE.test(v)) continue
    // "aku tinggal di Jakarta dan kerja shift malam" → cukup "Jakarta"
    if (PLACE_KEYS.has(rule.k)) {
      v = cleanValue(v.replace(/\s+(?:dan|lalu|terus|tapi|juga|kemudian|serta|sambil)\s+[\s\S]*$/i, ''))
      if (!v || BAD_VALUE.test(v)) continue
    }
    const id = `${rule.k}::${norm(v)}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ k: rule.k, v })
    if (out.length >= 4) break
  }
  return out
}

/* ════════════════ simpan / ambil ════════════════ */
function entry(jid, create = false) {
  let e = store.get(jid)
  if (!e && create) { e = { at: Date.now(), facts: [] }; store.set(jid, e) }
  return e
}

/** Simpan beberapa fakta. Single-value key → nilai lama diganti. */
export function remember(jid, list) {
  const items = (Array.isArray(list) ? list : [list])
    .map((f) => ({ k: String(f?.k || 'catatan').toLowerCase().trim(), v: cleanValue(f?.v) }))
    .filter((f) => f.v)
    .map((f) => ({ k: ALLOWED_KEYS.has(f.k) ? f.k : 'catatan', v: f.v }))
  if (!jid || !items.length) return { added: 0, updated: 0 }

  const e = entry(jid, true)
  e.at = Date.now()
  let added = 0
  let updated = 0
  for (const it of items) {
    const same = e.facts.find((f) => norm(f.v) === norm(it.v))
    if (same) { same.at = Date.now(); updated++; continue }
    if (!MULTI_KEYS.has(it.k)) {
      const idx = e.facts.findIndex((f) => f.k === it.k)
      if (idx >= 0) {
        e.facts[idx] = { k: it.k, v: it.v, at: Date.now() }
        updated++
        continue
      }
    }
    e.facts.push({ k: it.k, v: it.v, at: Date.now() })
    added++
  }
  // batas jumlah fakta: buang yang paling lama (kecuali identitas inti)
  if (e.facts.length > MAX_FACTS) {
    const keepCore = new Set(['nama', 'umur', 'ultah', 'tinggal'])
    e.facts = e.facts
      .sort((a, b) => (keepCore.has(b.k) ? 1 : 0) - (keepCore.has(a.k) ? 1 : 0) || (b.at || 0) - (a.at || 0))
      .slice(0, MAX_FACTS)
  }
  e.facts.sort((a, b) => (a.k === 'nama' ? -1 : b.k === 'nama' ? 1 : 0))
  save()
  return { added, updated }
}

/** Daftar fakta 1 user (read-only copy). */
export function factsFor(jid) {
  const e = store.get(jid)
  return e ? e.facts.map((f) => ({ k: f.k, v: f.v, at: f.at })) : []
}

/** Blok memori ringkas buat prompt ('' kalau belum ada fakta). */
export function formatBlock(jid) {
  const facts = factsFor(jid)
  if (!facts.length) return ''
  const lines = []
  let chars = 0
  for (const f of facts) {
    const line = `- ${LABEL[f.k] || 'Catatan'}: ${f.v}`
    if (chars + line.length > MAX_BLOCK_CHARS) break
    lines.push(line)
    chars += line.length + 1
  }
  if (!lines.length) return ''
  return `[CATATAN TENTANG DIA — dari obrolan sebelumnya]\n${lines.join('\n')}`
}

/** Hapus semua memori 1 user. */
export function forget(jid) {
  const had = store.delete(jid)
  if (had) save()
  return had
}

/** Statistik ringkas (buat `.bot fakta`). */
export function stats() {
  let facts = 0
  for (const e of store.values()) facts += e.facts.length
  return { users: store.size, facts }
}

load()

export const _internals = { store, cleanValue, norm, RULES, FILE, MAX_FACTS, MAX_BLOCK_CHARS, LABEL }
