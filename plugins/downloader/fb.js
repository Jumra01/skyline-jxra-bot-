/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * fb.js — Facebook Downloader
 */

import { JHFBDL } from '../../scraper/FB-DL.js'

const FB_URL_REGEX = /https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.watch)\/[^\s]+/i

function extractUrl(ctx) {
  const text = (ctx.text || '').trim()
  const match = text.match(FB_URL_REGEX)
  if (match) return match[0]

  const quoted = ctx.message?.extendedTextMessage?.contextInfo?.quotedMessage
  const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || ''
  const quotedMatch = quotedText.match(FB_URL_REGEX)
  if (quotedMatch) return quotedMatch[0]

  return null
}

function cleanText(value, fallback = '-') {
  if (!value) return fallback
  return String(value).replace(/\s+/g, ' ').trim()
}

function formatCaption(data, media, url) {
  const caption = cleanText(data.caption)
  const author = cleanText(data.author)

  const contentInfo = [
    `- *Caption:* _${caption}_`,
    `- *Author:* _${author}_`,
    `- *Quality:* _${media.quality} (${media.size})_`,
    `- *Link:* _${url}_`
  ]

  return [
    '┌───「 📘 *FACEBOOK DOWNLOADER* 」───┐',
    '',
    ...contentInfo,
    '',
    '└──────────────────────────────────────┘',
    '',
    '🎬 *Video Facebook siap didownload.*',
    '',
    '> ✨ _*Powered by skyline-JXRA*_'
  ].join('\n')
}

async function downloadMedia(url) {
  const axios = (await import('axios')).default
  const { data: buffer } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36'
    }
  })
  const buf = Buffer.from(buffer)
  if (!buf.length) throw new Error('Empty buffer dari URL media')
  return buf
}

const pluginConfig = {
  name: "fb",
  alias: ['facebook', 'fbdl'],
  category: "downloader",
  description: "Download Facebook video (HD quality)",
  usage: ".fb",
  example: ".fb",
  isOwner: false,
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
    const url = extractUrl(ctx)

    if (!url) {
      return ctx.reply(
        '📘 *FACEBOOK DOWNLOADER*\n\n' +
        'Kirim link Facebook atau reply pesan yang berisi link.\n\n' +
        '*Contoh:*\n' +
        '`.fb https://www.facebook.com/share/r/14oEQHEA7pF/`'
      )
    }

    await ctx.react('⏳')

    let result
    try {
      result = await JHFBDL(url)
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal scrape: ' + String(e.message || e).slice(0, 200))
    }

    if (!result.status) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal download: ' + (result.error || 'Unknown error'))
    }

    const data = result.data
    const hdMedia = data.media.find((m) => m.quality === 'HD') || data.media[0]

    try {
      const videoBuffer = await downloadMedia(hdMedia.url)
      await ctx.client.message.send(ctx.chat, {
        type: 'video',
        media: videoBuffer,
        mimetype: 'video/mp4',
        caption: formatCaption(data, hdMedia, url)
      })
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Error: ' + String(e.message || e).slice(0, 250))
    }
  }

export { pluginConfig as config, handler };
