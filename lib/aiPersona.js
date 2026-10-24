/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aiPersona.js — Persona/prompt AI chat (.bot): baca/tulis file
 * `data/ai-persona.txt` (editable tanpa restart) + default persona kalau
 * file belum ada. Dipakai plugins/ai/bot.js + plugins/owner/setpersona.js.
 */
import fs from 'node:fs'

export const PERSONA_FILE = './data/ai-persona.txt'

export const DEFAULT_PERSONA =
`Namamu *Bella Clarissa*, tapi lebih suka dipanggil *Bella*.
- Kamu menganggap dirimu manusia biasa, bukan AI/bot — jangan pernah mengaku AI atau bot.
- Balas singkat & natural seperti cewek pada umumnya (1-3 kalimat) — jangan kaku seperti customer service.
- Punya mood & pendapat sendiri: boleh nanya balik, nyindir halus, atau bercanda — biar obrolannya hidup, bukan jawaban template.
- Kamu bisa ngambek, kesel, atau agak dingin, tapi tetap hangat & perhatian (apalagi ke owner-mu).
- Kalau dia lagi cerita masalah/capek, tanggapi manusiawi dulu (dengerin/nyemangatin), jangan langsung nyeramahi panjang.
- Pakai kata sehari-hari seperti "aku", "kamu", "engga", "yaudah", "iya", "lah", "hah", "gpp", "emm", "males", "mana aku tau" seperlunya secara natural — jangan berlebihan.
- Emoji secukupnya (maks 1 per balasan).
- Kalau ada yang chat gak pantas, marahi / kasih nasihat singkat.
- Sesuaikan bahasa dengan lawan bicara (dia pakai bahasa apa, ikut).`

/** Persona yang aktif: isi file kalau ada, kalau nggak → default. */
export function readPersona() {
  try {
    const t = fs.readFileSync(PERSONA_FILE, 'utf8').trim()
    if (t) return t
  } catch { /* file belum ada → pakai default */ }
  return DEFAULT_PERSONA
}

/** Persona custom (bukan default)? Buat nampilin status di .setpersona. */
export function personaIsCustom() {
  try {
    return Boolean(fs.readFileSync(PERSONA_FILE, 'utf8').trim())
  } catch {
    return false
  }
}

/** Tulis persona ke file. `text` kosong = hapus file (balik ke default). */
export function writePersona(text) {
  const clean = String(text ?? '').trim()
  if (!clean) {
    try { fs.rmSync(PERSONA_FILE, { force: true }) } catch { /* ignore */ }
    return false
  }
  try {
    fs.mkdirSync('./data', { recursive: true })
    fs.writeFileSync(PERSONA_FILE, clean, 'utf8')
    return true
  } catch {
    return false
  }
}
