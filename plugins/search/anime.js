/**
 * © skyline-JXRA
 * Cari informasi anime dari AniList berdasarkan judul.
 */
import { searchAnimeMedia } from '../../lib/animeSearch.js'
import { replyCatalogResult } from '../../lib/catalogButtons.js'

const pluginConfig = {
  name: 'carianime',
  alias: ['animeinfo', 'anime'],
  category: 'search',
  description: 'Cari informasi lengkap anime dari AniList',
  usage: '.carianime <judul>',
  example: '.carianime Jujutsu Kaisen',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 10,
  limit: 1,
  isEnabled: true,
  energi: 0,
}

async function handler(ctx) {
  const query = (ctx.text || '').trim()
  if (!query) {
    await ctx.reply('🎬 Masukkan judul anime. Contoh: .carianime Jujutsu Kaisen')
    return
  }
  await searchAndReply(ctx, query)
}

async function searchAndReply(ctx, query) {
  await ctx.react('🔍')
  try {
    const result = await searchAnimeMedia(query, 'ANIME')
    if (!result) {
      await ctx.react('❌')
      await ctx.reply(`Anime dengan judul “${query}” tidak ditemukan di AniList.`)
      return
    }
    await replyCatalogResult(ctx, query, 'ANIME', result)
    await ctx.react('✅')
  } catch (error) {
    await ctx.react('❌')
    await ctx.reply(`Pencarian anime gagal: ${error.message || 'layanan tidak tersedia'}`)
  }
}

export { pluginConfig as config, handler }
