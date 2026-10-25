/**
 * © skyline-JXRA
 * Tombol hasil anime/manga untuk mencari judul sama di katalog pasangan.
 */
import { onRichReply } from '../handlers/messageHandler.js'
import { searchAnimeMedia } from './animeSearch.js'
import { logger } from '../core/logger.js'

const sessions = new Map()
const SESSION_TTL_MS = 5 * 60_000
const MAX_SESSIONS = 500

function trimSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(id)
  }
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
}

export async function replyCatalogResult(ctx, title, type, result) {
  const id = `catalog-switch:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  trimSessions()
  registerSwitch(id)
  sessions.set(id, {
    title,
    type,
    chat: ctx.chat,
    sender: ctx.sender,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  const headerImage = await uploadCover(ctx, result.cover)
  await ctx.replyButtons({
    text: result.text,
    footer: 'AniList • Pencarian katalog',
    buttons: [{
      id,
      text: type === 'ANIME' ? '📚 Cari judul ini di Manga' : '🎬 Cari judul ini di Anime',
    }],
    headerImage,
  })
}

async function handleCatalogSwitch(ctx, id) {
  const session = sessions.get(id)
  sessions.delete(id)
  if (!session || Date.now() > session.expiresAt || session.chat !== ctx.chat || session.sender !== ctx.sender) {
    await ctx.reply('Tombol pencarian sudah kedaluwarsa atau bukan milik kamu. Jalankan pencarian lagi.')
    return
  }

  const type = session.type === 'ANIME' ? 'MANGA' : 'ANIME'
  const label = type === 'ANIME' ? 'anime' : 'manga'
  await ctx.react('🔍')
  try {
    const result = await searchAnimeMedia(session.title, type)
    if (!result) {
      await ctx.react('❌')
      await ctx.reply(`${label} dengan judul “${session.title}” tidak ditemukan di AniList.`)
      return
    }
    await replyCatalogResult(ctx, session.title, type, result)
    await ctx.react('✅')
  } catch (error) {
    await ctx.react('❌')
    await ctx.reply(`Pencarian ${label} gagal: ${error.message || 'layanan tidak tersedia'}`)
  }
}

async function uploadCover(ctx, url) {
  if (!url) return undefined
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) return undefined
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) return undefined
    const uploaded = await ctx.client.message.upload(bytes, { type: 'image', mimetype: response.headers.get('content-type') || 'image/jpeg' })
    return { kind: 'imageMessage', ...uploaded, mimetype: response.headers.get('content-type') || 'image/jpeg' }
  } catch (err) {
    // Jangan telan diam-diam: thumbnail hilang tanpa jejak bikin bug validasi
    // content-type (regex escaped ganda) tak terdeteksi berhari-hari.
    logger.warn({ err: String(err?.message ?? err), url }, '[Katalog] cover gagal disiapkan — lanjut tanpa thumbnail')
    return undefined
  }
}

// Rich reply registry memakai pencocokan ID exact; daftarkan ID konkrit saat
// tombol dibuat, bukan pola wildcard yang handler dispatcher tidak dukung.
const registerSwitch = (id) => onRichReply(id, (ctx) => handleCatalogSwitch(ctx, id))
export { registerSwitch }

