/**
 * © skyline-JXRA
 * Tombol hasil anime/manga untuk mencari judul sama di katalog pasangan.
 */
import { onRichReply } from '../handlers/messageHandler.js'
import { searchAnimeMedia } from './animeSearch.js'

const sessions = new Map()
const SESSION_TTL_MS = 5 * 60_000

export async function replyCatalogResult(ctx, title, type, result) {
  const id = `catalog-switch:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  sessions.set(id, {
    title,
    type,
    chat: ctx.chat,
    sender: ctx.sender,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  await ctx.replyButtons({
    text: result.text,
    footer: 'AniList • Pencarian katalog',
    buttons: [{
      id,
      text: type === 'ANIME' ? '📚 Cari judul ini di Manga' : '🎬 Cari judul ini di Anime',
    }],
  })
}

onRichReply('catalog-switch:*', async (ctx, reply) => {
  const id = reply?.id
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
})
