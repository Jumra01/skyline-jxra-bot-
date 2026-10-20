/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * geminiWeb.js — jembatan ke Gemini web (gemini.google.com) TANPA API key.
 *
 *   Dipakai plugins/ai/bot.js sebagai otak chat AI (.bot / tag / bales).
 *   Cookie anonim + request StreamGenerate — jadi yang dipakai model Gemini
 *   yang beneran, bukan model kecil gratisan.
 *
 * Cara kerja (2 request, tanpa key/kredit):
 *   1) ambil cookie anonim  → POST /_/BardChatUi/data/batchexecute (rpcid maGuAc)
 *   2) tanya model          → POST .../assistant.lamda.BardFrontendService/StreamGenerate
 *      balasan di-parse dari format batchexecute (bukan JSON biasa).
 *
 * Obrolan nyambung multi-turn: `resumeArray` + cookie dibungkus jadi
 * `session` (base64) dan dipakai lagi di panggilan berikutnya.
 *
 * Env override (opsional):
 *   GEMINI_WEB_BASE  → ganti base URL (dipakai tes: mock server lokal)
 *   GEMINI_WEB_BL    → build label Google (kalau Google ganti versi)
 */
import axios from 'axios'
import FormData from 'form-data'

const DEFAULT_BASE = 'https://gemini.google.com'
const DEFAULT_UPLOAD = 'https://content-push.googleapis.com'
// build label web Gemini — kalau suatu saat balasan gagal di-parse, cek ini
const BL_COOKIE = 'boq_assistant-bard-web-server_20250814.06_p1'
const BL_STREAM = 'boq_assistant-bard-web-server_20250729.06_p0'
const X_GOOG_EXT = '[1,null,null,null,"9ec249fc9ad08861",null,null,null,[4]]'
// Upload gambar Gemini web (tanpa login): multipart ke content-push + header ini.
const UPLOAD_PUSH_ID = 'feeds/mcudyrk2a4khkz'

function base() {
  return String(process.env.GEMINI_WEB_BASE || DEFAULT_BASE).replace(/\/+$/, '')
}
function uploadBase() {
  return String(process.env.GEMINI_WEB_UPLOAD_BASE || DEFAULT_UPLOAD).replace(/\/+$/, '')
}
function bl() {
  return String(process.env.GEMINI_WEB_BL || BL_STREAM)
}

/** Bungkus resumeArray + cookie + instruction jadi session (base64). */
export function encodeSession({ resumeArray, cookie, instruction } = {}) {
  if (!resumeArray || !cookie) return null
  return Buffer.from(JSON.stringify({ resumeArray, cookie, instruction: instruction || '' })).toString('base64')
}

/** Baca session balik. Rusak/aneh → null (biar mulai dari awal, gak crash). */
export function decodeSession(session) {
  if (!session) return null
  try {
    const o = JSON.parse(Buffer.from(String(session), 'base64').toString())
    if (!o || typeof o !== 'object') return null
    return {
      resumeArray: Array.isArray(o.resumeArray) ? o.resumeArray : null,
      cookie: typeof o.cookie === 'string' ? o.cookie : null,
      instruction: typeof o.instruction === 'string' ? o.instruction : '',
    }
  } catch {
    return null
  }
}

function httpErr(status, data, tahap) {
  const body = typeof data === 'string' ? data : JSON.stringify(data ?? '')
  const err = new Error(`Gemini ${tahap} gagal (HTTP ${status})${body ? `: ${body.slice(0, 140)}` : ''}`)
  err.status = status
  return err
}

function pickCookie(headers = {}) {
  const raw = headers['set-cookie'] ?? headers['Set-Cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  for (const item of list) {
    const first = String(item).split(';')[0]
    if (first) return first
  }
  return ''
}

/**
 * Upload satu gambar ke server Gemini (tanpa login) → kembalikan id file
 * (`/contrib_service/ttl_1d/…`) yang dipakai di payload StreamGenerate.
 */
async function uploadImage({ buffer, mimetype = 'image/jpeg', filename = 'foto.jpg' } = {}, { cookie = '', timeoutMs = 60_000 } = {}) {
  if (!buffer?.length) {
    const err = new Error('Gambar kosong.')
    err.parse = true
    throw err
  }
  const fd = new FormData()
  fd.append('file', buffer, { filename, contentType: mimetype })
  const res = await axios.post(`${uploadBase()}/upload`, fd, {
    timeout: Math.min(Math.max(timeoutMs, 5000), 45_000),
    maxBodyLength: Infinity,
    validateStatus: () => true,
    headers: {
      ...fd.getHeaders(),
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      'X-Tenant-Id': 'bard-storage',
      'Push-ID': UPLOAD_PUSH_ID,
      ...(cookie ? { Cookie: cookie } : {})
    }
  })
  if (res.status < 200 || res.status >= 300) throw httpErr(res.status, res.data, 'upload gambar')
  const id = String(res.data ?? '').trim()
  if (!id.startsWith('/')) {
    const err = new Error('Upload gambar gak ngasih id file (formatnya mungkin berubah).')
    err.parse = true
    throw err
  }
  return id
}

/** Parse balasan batchexecute → object `parsed` (atau null kalau formatnya berubah). */
export function parseStream(data) {
  const raw = typeof data === 'string' ? data : JSON.stringify(data ?? '')
  const lines = Array.from(raw.matchAll(/^\d+\n(.+?)\n/gm)).reverse()
  for (const m of lines) {
    try {
      const outer = JSON.parse(m[1])
      const candidate = outer?.[0]?.[2]
      if (!candidate) continue
      const parsed = JSON.parse(candidate)
      if (parsed?.[4]?.[0]?.[1]?.[0]) return parsed
    } catch { /* baris lain → lanjut cari */ }
  }
  return null
}

/**
 * Tanya Gemini web.
 * `images` = array `{ buffer, mimetype, filename }` (foto/stiker yang diunggah
 * dulu ke server Gemini, tanpa login — hasilnya id file yang ditempel ke payload).
 * @returns {Promise<{text: string, session: string|null}>}
 */
export async function geminiChat({ message, instruction = '', session = null, timeoutMs = 60_000, images = [] } = {}) {
  const text = String(message || '').trim()
  if (!text) throw new Error('Pesan kosong.')

  let resumeArray = null
  let cookie = null
  let savedInstruction = instruction

  const prev = decodeSession(session)
  if (prev) {
    resumeArray = prev.resumeArray
    cookie = prev.cookie
    savedInstruction = instruction || prev.instruction || ''
  }

  const http = { timeout: timeoutMs, validateStatus: () => true }

  // 1) cookie anonim (kalau session lama udah bawa cookie, skip)
  if (!cookie) {
    const res = await axios.post(
      `${base()}/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=${BL_COOKIE}&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c`,
      'f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&',
      { ...http, headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } }
    )
    if (res.status < 200 || res.status >= 300) throw httpErr(res.status, res.data, 'cookie')
    cookie = pickCookie(res.headers)
    if (!cookie) {
      const err = new Error('Gemini gak ngasih cookie (form web-nya mungkin berubah).')
      err.parse = true
      throw err
    }
  }

  // 2) unggah gambar (kalau ada) — bisa beberapa sekaligus
  let fileData = null
  if (Array.isArray(images) && images.length) {
    const list = images.slice(0, 4)
    const ids = await Promise.all(
      list.map((img) => uploadImage(img, { cookie, timeoutMs }))
    )
    fileData = ids.map((id, i) => [[id], list[i]?.filename || 'foto.jpg'])
  }

  // 3) kirim pertanyaan (index 3 = data file kalau ada gambar)
  const requestBody = [
    [text, 0, null, fileData, null, null, 0],
    ['en-US'],
    resumeArray || ['', '', '', null, null, null, null, null, null, ''],
    null, null, null, [1], 1, null, null, 1, 0, null, null, null, null, null, [[0]], 1,
    null, null, null, null, null,
    ['', '', savedInstruction, null, null, null, null, null, 0, null, 1, null, null, null, []],
    null, null, 1, null, null, null, null, null, null, null,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    1, null, null, null, null, [1],
  ]
  const body = new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify(requestBody)]) }).toString()
  const res = await axios.post(
    `${base()}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${bl()}&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c`,
    body,
    {
      ...http,
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-goog-ext-525001261-jspb': X_GOOG_EXT,
        cookie,
      },
    }
  )
  if (res.status < 200 || res.status >= 300) throw httpErr(res.status, res.data, 'chat')

  const parsed = parseStream(res.data)
  if (!parsed) {
    const err = new Error('Balasan Gemini gak bisa dibaca (format web-nya berubah).')
    err.parse = true
    throw err
  }

  const answer = String(parsed[4][0][1][0] || '')
    .trim()
    // Gemini web balikin markdown **tebal** → WhatsApp pakai *tebal*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    // penanda sumber `[cite: 1]` gak ada artinya di WhatsApp
    .replace(/\[cite:\s*[\d,\s]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  const nextResume = [...(parsed[1] || []), parsed[4][0][0]]

  return { text: answer, session: encodeSession({ resumeArray: nextResume, cookie, instruction: savedInstruction }) }
}

export const _internals = { base, bl, uploadBase, parseStream, pickCookie, uploadImage, encodeSession, decodeSession }
export default geminiChat
