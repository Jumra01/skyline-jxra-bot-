/**
 * © skyline-JXRA
 * xvideo.js — Browser tombol XVideos via endpoint /api/tools/xvideos (Skyline API).
 * Kuota & API key tetap dihitung di sisi web. Tanpa fetch langsung ke situs sumber.
 */
import { openAdultBrowser } from '../../lib/adultBrowser.js'

const pluginConfig = {
  name: 'xvideo',
  alias: ['xvideos', 'xv'],
  category: 'search',
  description: 'XVideos browser tombol 18+: cari judul/genre, kategori, best, fresh, verified, dashboard, detail & link',
  usage:
    '.xvideo [judul/genre] | .xvideo kategori <slug> | .xvideo detail <url> | .xvideo best|fresh|verified|dashboard',
  example: '.xvideo cari big tits',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  energi: 0,
  isEnabled: true
}

async function handler(ctx) {
  await openAdultBrowser(ctx, 'xvideos', ctx.text || '')
}

export { pluginConfig as config, handler }
