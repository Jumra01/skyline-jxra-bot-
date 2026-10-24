/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * visionFallback.js — "mata cadangan" kalau Gemini nolak file gambar.
 *
 * Jalur utama tetap kirim gambar ke Gemini (`lib/geminiWeb.js`); kalau server
 * Gemini nolak file yang diunggah, gambar tetap "dibaca" lewat 2 layanan
 * tanpa API key: OCR (api.ocr.space, key demo `helloworld`) dan deskripsi
 * (imageprompt.org, bahasa Inggris). Hasilnya digabung jadi konteks teks,
 * lalu model chat tetap Gemini.
 *
 * Semua kegagalan DITELAN (return string kosong) — fitur chat gak boleh mati
 * gara-gara layanan cadangan ngadat.
 *
 * Env override (dipakai tes / kalau domain berubah): VISION_OCR_BASE,
 * VISION_OCR_KEY, VISION_CAPTION_BASE
 */

const DEFAULT_OCR = 'https://api.ocr.space/parse/image'
const DEFAULT_OCR_KEY = 'helloworld' // key demo publik ocr.space
const DEFAULT_CAPTION = 'https://imageprompt.org/api/ai/prompts/image'

const MAX_CHARS = 700

function ocrBase() {
  return String(process.env.VISION_OCR_BASE || DEFAULT_OCR).replace(/\/+$/, '')
}
function captionBase() {
  return String(process.env.VISION_CAPTION_BASE || DEFAULT_CAPTION).replace(/\/+$/, '')
}

const potong = (s, n = MAX_CHARS) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

/** Baca tulisan di gambar (OCR). Gagal / kosong → '' */
export async function ocrText(buffer, { timeoutMs = 8000 } = {}) {
  if (!buffer?.length) return ''
  const body = new FormData()
  body.append('apikey', process.env.VISION_OCR_KEY || DEFAULT_OCR_KEY)
  body.append('language', 'eng')
  body.append('OCREngine', '2')
  body.append('base64Image', `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`)
  for (let coba = 0; coba < 2; coba++) {
    try {
      const res = await fetch(ocrBase(), {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data?.IsErroredOnProcessing) throw new Error(String(data?.ErrorMessage || 'ocr error'))
      const rows = (data?.ParsedResults ?? []).map((r) => r?.ParsedText ?? '').join('\n')
      const teks = potong(rows)
      if (teks) return teks
      return '' // kebaca "kosong" → gak perlu ulang
    } catch {
      // percobaan kedua (jaringan suka putus sekali)
    }
  }
  return ''
}

/** Deskripsi isi gambar (bahasa Inggris, layanan imageprompt.org). Gagal → '' */
export async function captionImage(buffer, { timeoutMs = 14000 } = {}) {
  if (!buffer?.length) return ''
  try {
    const res = await fetch(captionBase(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10)',
        origin: 'https://imageprompt.org',
        referer: 'https://imageprompt.org/image-to-prompt'
      },
      body: JSON.stringify({
        base64Url: `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`,
        imageModelId: 0,
        language: 'en'
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return ''
    const data = await res.json().catch(() => null)
    return potong(data?.prompt)
  } catch {
    return ''
  }
}

/**
 * Baca satu gambar lewat jalur cadangan (OCR + deskripsi, paralel).
 * @returns {Promise<{teks: string, deskripsi: string, ada: boolean}>}
 */
export async function readImage(buffer, { timeoutMs } = {}) {
  if (!buffer?.length) return { teks: '', deskripsi: '', ada: false }
  const [teks, deskripsi] = await Promise.all([
    ocrText(buffer, timeoutMs ? { timeoutMs } : {}),
    captionImage(buffer, timeoutMs ? { timeoutMs: Math.max(timeoutMs, 6000) } : {})
  ])
  return { teks, deskripsi, ada: Boolean(teks || deskripsi) }
}

/** Susun blok konteks gambar buat ditempel ke prompt model chat. */
export function visionContext({ teks, deskripsi } = {}) {
  if (!teks && !deskripsi) return ''
  const baris = ['[GAMBAR DARI USER — hasil pembacaan otomatis]']
  if (deskripsi) baris.push(`Isi gambar: ${deskripsi}`)
  if (teks) baris.push(`Tulisan yang kebaca di gambar: ${teks}`)
  baris.push(
    'Anggap kamu memang melihat gambar itu. Jangan pernah menyebut kata "deskripsi", "prompt", "OCR", atau "pembacaan otomatis" ke user.'
  )
  return baris.join('\n')
}

export const _internals = { ocrBase, captionBase, potong }
