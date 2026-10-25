/**
 * © skyline-JXRA
 * Cari informasi manga dari AniList berdasarkan judul.
 */
import { searchAnimeMedia } from '../../lib/animeSearch.js'
import { replyCatalogResult } from '../../lib/catalogButtons.js'

const pluginConfig = {
  name: 'manga',
  alias: ['mangasearch', 'carimanga', 'searchmanga'],
  category: 'search',
  description: 'Cari informasi manga dari AniList',
  usage: '.manga <judul>',
  example: '.manga One Piece',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
  energi: 0,
}

async function handler(ctx) {
  const query = (ctx.text || '').trim()
  if (!query) {
    await ctx.reply('📚 Masukkan judul manga. Contoh: .manga One Piece')
    return
  }
  await searchAndReply(ctx, query)
}

async function searchAndReply(ctx, query) {
  await ctx.react('🔍')
  try {
    const result = await searchAnimeMedia(query, 'MANGA')
    if (!result) {
      await ctx.react('❌')
      await ctx.reply(`Manga dengan judul “${query}” tidak ditemukan di AniList.`)
      return
    }
    await replyCatalogResult(ctx, query, 'MANGA', result)
    await ctx.react('✅')
  } catch (error) {
    await ctx.react('❌')
    await ctx.reply(`Pencarian manga gagal: ${error.message || 'layanan tidak tersedia'}`)
  }
}

export { pluginConfig as config, handler }
