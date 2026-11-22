/**
 * © skyline-JXRA
 * xnxx.js — Browser tombol XNXX via endpoint /api/tools/xnxx (Skyline API).
 * Kuota & API key tetap dihitung di sisi web. Tanpa fetch langsung ke situs sumber.
 */
import { openAdultBrowser } from '../../lib/adultBrowser.js'

const pluginConfig = {
  name: 'xnxx',
  alias: ['xn'],
  category: 'search',
  description: 'XNXX browser tombol 18+: cari judul/genre, detail dari URL, navigasi hasil & link media',
  usage: '.xnxx [judul/genre] | .xnxx detail <url>',
  example: '.xnxx cari blonde',
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
  await openAdultBrowser(ctx, 'xnxx', ctx.text || '')
}

export { pluginConfig as config, handler }
