/**
 * © skyline-JXRA
 * Cari informasi anime dari AniList berdasarkan judul.
 */
import { searchAnimeMedia } from '../../lib/animeSearch.js'

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
  await ctx.react('🔍')
  try {
    const result = await searchAnimeMedia(query, 'ANIME')
    if (!result) {
      await ctx.react('❌')
      await ctx.reply(`Anime dengan judul “${query}” tidak ditemukan di AniList.`)
      return
    }
    if (result.cover) {
      const response = await fetch(result.cover, { signal: AbortSignal.timeout(8000) })
      if (response.ok && /^image\//i.test(response.headers.get('content-type') || '')) {
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length <= 8 * 1024 * 1024) {
          const media = await ctx.client.message.upload(buffer, { type: 'image', mimetype: response.headers.get('content-type') || 'image/jpeg' })
          await ctx.client.message.send(ctx.chat, {
            imageMessage: {
              ...media,
              mimetype: response.headers.get('content-type') || 'image/jpeg',
              caption: result.text,
            },
          })
        } else await ctx.reply(result.text)
      } else await ctx.reply(result.text)
    } else await ctx.reply(result.text)
    await ctx.react('✅')
  } catch (error) {
    await ctx.react('❌')
    await ctx.reply(`Pencarian anime gagal: ${error.message || 'layanan tidak tersedia'}`)
  }
}

export { pluginConfig as config, handler }
