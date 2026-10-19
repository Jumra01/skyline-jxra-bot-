/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * geminiWeb.js — jembatan ke Gemini web (gemini.google.com) TANPA API key.
 *
 *   Dipakai plugins/ai/bot.js sebagai otak chat AI (.bot / tag / bales).
 *   Pola sama dengan auto-ai skyline-md (src/scraper/gemini.js) — jadi
 *   yang dipakai model Gemini yang beneran, bukan model kecil gratisan.
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

const DEFAULT_BASE = 'https://gemini.google.com'
// build label web Gemini — kalau suatu saat balasan gagal di-parse, cek ini
const BL_COOKIE = 'boq_assistant-bard-web-server_20250814.06_p1'
const BL_STREAM = 'boq_assistant-bard-web-server_20250729.06_p0'
const X_GOOG_EXT = '[1,null,null,null,"9ec249fc9ad08861",null,null,null,[4]]'

function base() {
  return String(process.env.GEMINI_WEB_BASE || DEFAULT_BASE).replace(/\/+$/, '')
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
 * @returns {Promise<{text: string, session: string|null}>}
 */
export async function geminiChat({ message, instruction = '', session = null, timeoutMs = 60_000 } = {}) {
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

  // 2) kirim pertanyaan
  const requestBody = [
    [text, 0, null, null, null, null, 0],
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
  const nextResume = [...(parsed[1] || []), parsed[4][0][0]]

  return { text: answer, session: encodeSession({ resumeArray: nextResume, cookie, instruction: savedInstruction }) }
}

export const _internals = { base, bl, parseStream, pickCookie, encodeSession, decodeSession }
export default geminiChat
