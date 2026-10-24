/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * imageSource.js — Ambil gambar dari pesan (lampiran / balasan / quote) atau
 * dari URL. Dipakai fitur AI gambar (`.nanobana`, `.superhd`, `.omniedit`).
 *
 * Hasil: `{ buf, mime }` = gambar lokal (perlu di-upload dulu kalau API
 * butuh URL), `{ url }` = user ngasih URL langsung, `null` = tidak ada gambar.
 */
import axios from 'axios'
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import { logger } from '../core/logger.js'
import top4topUpload from './uploadImage.js'
import { uploadImage as skylineUpload } from '../scraper/SKYLINE.js'

export const MAX_IMAGE = 10 * 1024 * 1024

export function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}

export function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Buffer gambar dari node pesan (kalau tipenya gambar). */
export async function imageBufferFromMessage(message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload || !payload.mimetype || !String(payload.mimetype).startsWith('image/')) return null
    const stream = await downloadMediaMessage(message)
    const buf = await streamToBuffer(stream)
    if (!buf?.length) return null
    if (buf.length > MAX_IMAGE) throw new Error('gambar kegedean (maks 10MB)')
    return { buf, mime: payload.mimetype }
  } catch (e) {
    logger.warn('[imageSource] ambil gambar gagal: ' + String(e?.message || e).slice(0, 140))
    return null
  }
}

/** Buffer gambar dari URL publik. */
export async function imageFromUrl(url) {
  const { data, headers } = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 })
  const buf = Buffer.from(data)
  if (!buf.length) throw new Error('gambar dari URL kosong')
  if (buf.length > MAX_IMAGE) throw new Error('gambar dari URL kegedean (maks 10MB)')
  const mime = String(headers?.['content-type'] || 'image/jpeg').split(';')[0] || 'image/jpeg'
  return { buf, mime }
}

/**
 * Tentukan sumber gambar dari ctx — urutan: argumen berupa URL gambar →
 * gambar yang dibalas/di-quote → gambar yang dikirim bareng command.
 */
export async function pickImage(ctx) {
  const text = String(ctx.text || '').trim()
  const first = text.split(/\s+/)[0] || ''
  if (/^https?:\/\/\S+$/i.test(first) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(first)) {
    return { url: first, rest: text.slice(first.length).trim() }
  }

  const event = getEvent(ctx)
  const rawMessage = event?.message ?? event
  const quoted = getContextInfo(rawMessage)?.quotedMessage ?? null

  const fromQuote = await imageBufferFromMessage(quoted)
  if (fromQuote) return { ...fromQuote, rest: text }

  const fromSelf = await imageBufferFromMessage(rawMessage)
  if (fromSelf) return { ...fromSelf, rest: text }

  return null
}

/**
 * Ubah hasil `pickImage()` jadi URL yang bisa dibaca server AI — user kasih
 * URL langsung → pakai itu; ada buffer → upload ke CDN skyline (satu pintu),
 * gagal → fallback hosting luar (top4top).
 */
export async function toPublicUrl(picked) {
  if (picked?.url) return picked.url
  if (!picked?.buf) return ''

  try {
    return await skylineUpload(picked.buf, { mimetype: picked.mime || 'image/jpeg' })
  } catch (e) {
    logger.warn('[imageSource] upload CDN skyline gagal, coba top4top: ' + String(e?.message || e).slice(0, 140))
  }

  return top4topUpload(picked.buf)
}
