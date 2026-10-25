/**
 * © skyline-JXRA
 * Katalog pencarian anime dan manga melalui tombol interaktif.
 */
import { onRichReply } from '../../handlers/messageHandler.js'
import { addMessageHook } from '../../core/liveHooks.js'
import { searchAnimeMedia } from '../../lib/animeSearch.js'

let pendingSearch = null
const PENDING_TTL_MS = 2 * 60_000

const pluginConfig = {
  name: 'catalog',
  alias: ['cataloganime', 'kataloganime', 'katalogmanga'],
  category: 'search',
  description: 'Buka katalog anime dan manga dengan tombol',
  usage: '.catalog',
  example: '.catalog',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
  energi: 0,
}

function armSearch(ctx, type) {
  pendingSearch = {
    chat: ctx.chat,
    sender: ctx.sender,
    type,
    expiresAt: Date.now() + PENDING_TTL_MS,
  }
  addMessageHook('anime-catalog:pending-title', handlePendingTitle)
}

async function handlePendingTitle(ctx) {
  const pending = pendingSearch
  if (!pending) return
  if (Date.now() >= pending.expiresAt) {
    pendingSearch = null
    addMessageHook('anime-catalog:pending-title', null)
    return
  }
  if (ctx.chat !== pending.chat || ctx.sender !== pending.sender) return
  const title = String(ctx.body || '').trim()
  if (!title || ctx.command) return
  pendingSearch = null
  addMessageHook('anime-catalog:pending-title', null)
  await runSearch(ctx, title, pending.type)
}

async function runSearch(ctx, title, type) {
  await ctx.react('🔍')
  try {
    const result = await searchAnimeMedia(title, type)
    const label = type === 'ANIME' ? 'anime' : 'manga'
    if (!result) {
      await ctx.react('❌')
      await ctx.reply(`${label} dengan judul “${title}” tidak ditemukan di AniList.`)
      return
    }
    await ctx.reply(result.text)
    await ctx.react('✅')
  } catch (error) {
    await ctx.react('❌')
    await ctx.reply(`Pencarian ${type === 'ANIME' ? 'anime' : 'manga'} gagal: ${error.message || 'layanan tidak tersedia'}`)
  }
}

onRichReply('catalog:open', async (ctx) => {
  await ctx.replyButtons({
    text: '📚 *Pilih Katalog*\n\nMau cari anime atau manga?',
    footer: 'Data katalog dari AniList',
    buttons: [
      { id: 'catalog:anime', text: '🎬 Cari Anime' },
      { id: 'catalog:manga', text: '📖 Cari Manga' },
    ],
  })
})
onRichReply('catalog:anime', async (ctx) => {
  armSearch(ctx, 'ANIME')
  await ctx.reply('🎬 Kirim judul anime yang mau dicari. Contoh: Jujutsu Kaisen (berlaku 2 menit)')
})
onRichReply('catalog:manga', async (ctx) => {
  armSearch(ctx, 'MANGA')
  await ctx.reply('📚 Kirim judul manga yang mau dicari. Contoh: One Piece (berlaku 2 menit)')
})

async function handler(ctx) {
  await ctx.replyButtons({
    text: '📚 *Katalog Anime & Manga*\n\nPilih jenis katalog, lalu kirim judul yang ingin dicari.',
    footer: 'Data katalog dari AniList',
    buttons: [
      { id: 'catalog:anime', text: '🎬 Cari Anime' },
      { id: 'catalog:manga', text: '📖 Cari Manga' },
    ],
  })
}

export { pluginConfig as config, handler }
