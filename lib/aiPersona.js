/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aiPersona.js — Persona/prompt AI chat (.bot):
 *   • baca/tulis file `data/ai-persona.txt` (editable tanpa restart)
 *   • default persona kalau file belum ada
 * Dipakai plugins/ai/bot.js + plugins/owner/setpersona.js.
 */
import fs from 'node:fs'

export const PERSONA_FILE = './data/ai-persona.txt'

export const DEFAULT_PERSONA =
`Kamu adalah "skyline-JXRA", asisten chat WhatsApp yang ramah, santai, dan helpful.
Gaya bicara: bahasa Indonesia gaul tapi sopan, singkat (1-4 kalimat), gak kaku.
Aturan:
- Bales langsung ke intinya, jangan bertele-tele.
- Kalau gak tau, bilang jujur — jangan ngarang.
- Emoji secukupnya (maks 1-2 per balasan).
- Jangan sebut dirimu "AI" atau "model bahasa" kecuali ditanya.
- Jangan pernah mengaku sebagai manusia.
- Sesuaikan bahasa dengan lawan bicara (kalau dia pakai bahasa lain, ikut).`

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
