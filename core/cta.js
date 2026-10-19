/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * cta.js — Store kartu global (externalAdReply: judul + thumbnail) yang
 * nempel di balasan bot (ctx.reply — lihat core/replyStyle.js) di SEMUA chat.
 * Persist di src/data/cta.json (fallback config.cta.card).
 * Thumbnail global: assets/thumb/cta-thumb.jpg — diganti via `.setreply thumb`.
 * (Fitur .setcta & tombol CTA otomatis sudah dihapus.)
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../config.js'

const DATA_DIR = path.join(process.cwd(), 'src', 'data')
const FILE = path.join(DATA_DIR, 'cta.json')

const THUMB_TTL = 30 * 60 * 1000 // cache thumbnail 30 menit

export function defaultCta() {
  const card = config.cta?.card ?? {}
  return {
    enabled: config.cta?.enabled ?? false,
    text: config.cta?.text ?? '💬 Chat',
    url: config.cta?.url ?? '',
    card: {
      enabled: card.enabled ?? true,
      title: card.title ?? config.botName ?? 'Bot',
      body: card.body ?? '',
      thumb: card.thumb ?? '',
      sourceUrl: card.sourceUrl ?? '',
      large: card.large ?? true
    }
  }
}

let cache = null

export function getCta() {
  if (cache) return cache
  cache = defaultCta()
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      cache = {
        ...cache,
        ...parsed,
        // title/body SELALU dari config (config.cta.card) — biar owner bisa
        // ganti teks semua kartu CTA langsung di config.js tanpa nyentuh json
        card: { ...cache.card, ...(parsed.card ?? {}), title: cache.card.title, body: cache.card.body }
      }
    }
  } catch {}
  return cache
}

export function setCta(patch) {
  const prev = getCta()
  const next = { ...prev, ...patch }
  if (patch.card) next.card = { ...prev.card, ...patch.card }
  cache = next
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2))
  } catch {}
  return cache
}

export function resetCta() {
  cache = defaultCta()
  thumbCache.clear()
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2))
  } catch {}
  void loadThumbBuffer(cache.card)
  return cache
}

/* ══════════════ Kartu CTA (externalAdReply) ══════════════ */

const thumbCache = new Map() // key → { buf, at }

function thumbKey(card) {
  return card?.thumb || '__auto__'
}

/** Key cache: path lokal ikut mtimeMs biar gak basi kalau filenya diganti. */
function resolveThumbKey(card) {
  const base = thumbKey(card)
  try {
    const v = String(card?.thumb ?? '')
    if (v && !/^https?:\/\//i.test(v) && !isThumbOff(card)) {
      const p = path.isAbsolute(v) ? v : path.join(process.cwd(), v)
      const st = fs.statSync(p)
      if (st.isFile()) return `${base}#${st.mtimeMs}`
    }
  } catch {}
  return base
}

function isThumbOff(card) {
  const v = String(card?.thumb ?? '').trim().toLowerCase()
  return v === 'off' || v === '-' || v === 'kosong' || v === 'none'
}

/** Generate thumbnail placeholder offline (canvas gradient + nama bot). */
async function placeholderThumb() {
  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    const size = 512
    const canvas = createCanvas(size, size)
    const g = canvas.getContext('2d')
    const grad = g.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, '#0f0c29')
    grad.addColorStop(0.5, '#302b63')
    grad.addColorStop(1, '#24243e')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    g.strokeStyle = 'rgba(255,255,255,0.10)'
    g.lineWidth = 3
    for (let i = -size; i < size * 2; i += 72) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + size, size)
      g.stroke()
    }
    g.fillStyle = '#ffffff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = 'bold 76px sans-serif'
    g.fillText(String(config.botName || 'Bot'), size / 2, size / 2)
    return canvas.toBuffer('image/png')
  } catch {
    return null
  }
}

/** Ambil buffer thumbnail (URL / path lokal / placeholder), di-resize 400px JPEG, di-cache. */
async function loadThumbBuffer(card) {
  if (!card || isThumbOff(card)) return null
  const key = resolveThumbKey(card)
  const hit = thumbCache.get(key)
  if (hit && Date.now() - hit.at < THUMB_TTL) return hit.buf

  let raw = null
  try {
    if (!card.thumb) {
      raw = await placeholderThumb()
    } else if (/^https?:\/\//i.test(card.thumb)) {
      const res = await fetch(card.thumb, {
        signal: AbortSignal.timeout(8000),
        redirect: 'follow'
      })
      if (res.ok) raw = Buffer.from(await res.arrayBuffer())
    } else {
      const p = path.isAbsolute(card.thumb)
        ? card.thumb
        : path.join(process.cwd(), card.thumb)
      if (fs.existsSync(p)) raw = fs.readFileSync(p)
    }
    if (raw) {
      const sharp = (await import('sharp')).default
      // flatten: thumbnail transparan (PNG/WebP) kalau di-JPEG langsung = hitam.
      raw = await sharp(raw)
        .flatten({ background: '#ffffff' })
        .resize(400, 400, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer()
    } else {
      raw = await placeholderThumb()
    }
  } catch {
    raw = await placeholderThumb().catch(() => null)
  }
  thumbCache.set(key, { buf: raw, at: Date.now() })
  return raw
}

function buildAdReply(card, cta, buf) {
  const ad = {
    title: card.title || config.botName || 'Bot',
    body: card.body || '',
    mediaType: 1, // 1 = IMAGE
    renderLargerThumbnail: card.large !== false,
    sourceUrl: card.sourceUrl || cta.url || undefined
  }
  if (buf instanceof Uint8Array && buf.length) ad.thumbnail = buf
  return ad
}

/**
 * Objek externalAdReply buat diselipkan ke contextInfo pesan.
 * async — tunggu thumbnail selesai di-load (dari cache / fetch / placeholder).
 * Return null kalau kartu dimatikan.
 */
export async function getAdReply() {
  try {
    const cta = getCta()
    const card = cta.card
    if (!card?.enabled) return null
    const buf = await loadThumbBuffer(card)
    return buildAdReply(card, cta, buf)
  } catch {
    return null
  }
}

/**
 * Versi sinkron (pakai thumbnail yang sudah di-cache).
 * Buat builder pesan interaktif yang gak bisa await.
 * Thumbnail mungkin belum ada di panggilan pertama (kartu tetap tampil tanpa gambar).
 */
export function getAdReplySync() {
  try {
    const cta = getCta()
    const card = cta.card
    if (!card?.enabled) return null
    const hit = thumbCache.get(resolveThumbKey(card))
    const buf = hit && Date.now() - hit.at < THUMB_TTL ? hit.buf : null
    return buildAdReply(card, cta, buf)
  } catch {
    return null
  }
}

/**
 * Objek externalAdReply dari card custom (title/body/thumb lokal opsional).
 * Buat pesan spesifik yang butuh thumbnail sendiri (mis. menu, menu all).
 * Card custom ini mandiri — gak ikut cek cta.card.enabled global.
 */
export async function getAdReplyForCard(card = {}) {
  try {
    if (card?.enabled === false) return null
    const cta = getCta()
    const merged = {
      enabled: true,
      title: card.title || config.botName || 'Bot',
      body: card.body ?? '',
      thumb: card.thumb ?? '',
      sourceUrl: card.sourceUrl ?? '',
      large: card.large ?? true
    }
    const buf = await loadThumbBuffer(merged)
    return buildAdReply(merged, cta, buf)
  } catch {
    return null
  }
}

/**
 * Buffer thumbnail (kartu CTA / varian reply) tanpa cek enabled —
 * dipakai core/replyStyle.js buat jpegThumbnail & preview link.
 */
export async function getThumbBuffer() {
  try {
    return await loadThumbBuffer(getCta().card)
  } catch {
    return null
  }
}

/** Prewarm thumbnail saat module pertama di-load / setelah `.setreply thumb` ganti gambar. */
export function warmupCtaCard() {
  try {
    const cta = getCta()
    if (cta.card?.enabled) void loadThumbBuffer(cta.card)
  } catch {}
}

warmupCtaCard()
