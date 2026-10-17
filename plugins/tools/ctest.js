/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 */
import { sendCarousel, IMAGE_URLS } from '../../lib/carousel.js'

const pluginConfig = {
  name: "carouseltest",
  alias: ['ctest'],
  category: "tools",
  description: "Ujicoba carousel asli (gambar asli per card, sesuai spek resmi)",
  usage: ".carouseltest",
  example: ".carouseltest",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    await ctx.react('⏳')
    try {
      await sendCarousel(ctx, {
        text: '🧪 *UJICOBA CAROUSEL BY JH*\nPilih kartu:',
        cards: [
          {
            imageUrl: IMAGE_URLS.fiony,
            body: '*Kartu 1 — Fiony*\nFiony Alveria, kesayangan skyline-JXRA.',
            footer: '⚡ Powered by skyline-JXRA',
            buttons: [
              { type: 'url', displayText: '🌐 Buka GitHub', url: 'https://github.com/raaxml01/skyline-jxra-bot-.git' },
              { type: 'reply', displayText: '👋 Sapa Fiony', id: 'rich:carousel-sapa-1' }
            ]
          },
          {
            imageUrl: IMAGE_URLS.carmen,
            body: '*Kartu 2 — Carmen*\nCarmen, karakter kedua.',
            footer: '⚡ Powered by skyline-JXRA',
            buttons: [
              { type: 'url', displayText: '🌐 Buka GitHub', url: 'https://github.com/raaxml01/skyline-jxra-bot-.git' },
              { type: 'reply', displayText: '👋 Sapa Carmen', id: 'rich:carousel-sapa-2' }
            ]
          },
          {
            imageUrl: IMAGE_URLS.nayeon,
            body: '*Kartu 3 — Nayeon*\nNayeon, karakter ketiga.',
            footer: '⚡ Powered by skyline-JXRA',
            buttons: [
              { type: 'url', displayText: '🌐 Buka GitHub', url: 'https://github.com/raaxml01/skyline-jxra-bot-.git' },
              { type: 'reply', displayText: '👋 Sapa Nayeon', id: 'rich:carousel-sapa-3' }
            ]
          }
        ]
      })

      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('❌ CTest gagal: ' + String(e.message || e).slice(0, 250))
    }
  }

export { pluginConfig as config, handler };
