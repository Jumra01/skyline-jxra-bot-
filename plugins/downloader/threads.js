/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * threads.js — Threads Downloader
 */

import { JHThreadsDL } from '../../scraper/THREADS.js'
import { sendCarousel } from '../../lib/carousel.js'
import { onRichReply } from '../../handlers/messageHandler.js'

const THREADS_URL_REGEX = /https?:\/\/(www\.)?(threads\.com|threads\.net)\/[^\s]+/i

function extractUrl(ctx) {
  const text = (ctx.text || '').trim()
  const match = text.match(THREADS_URL_REGEX)
  if (match) return match[0]

  const quoted = ctx.message?.extendedTextMessage?.contextInfo?.quotedMessage
  const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || ''
  const quotedMatch = quotedText.match(THREADS_URL_REGEX)
  if (quotedMatch) return quotedMatch[0]

  return null
}

function cleanCaption(value, max = 150) {
  if (!value) return ''
  const clean = String(value).replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

function formatCaption(data, url, opts) {
  const videos = data.media.filter(d => d.type === 'video').length
  const images = data.media.filter(d => d.type === 'image').length
  const captionPost = cleanCaption(data.caption)

  const contentInfo = [
    `- *User:* _@${data.username || 'Unknown'}_`,
    ...(captionPost ? [`- *Caption:* _${captionPost}_`] : []),
    `- *Total Media:* _${data.media.length}_`,
    ...(videos ? [`- *Video:* _${videos}_`] : []),
    ...(images ? [`- *Image:* _${images}_`] : []),
    `- *Link:* _${url}_`
  ]

  let instruction
  if (opts.useCarousel && videos) {
    instruction = '👇 *Geser carousel untuk semua image.*\n🎬 *Video dikirim terpisah setelah carousel.*'
  } else if (opts.useCarousel) {
    instruction = '👇 *Scroll dan geser untuk melihat semua image.*'
  } else if (images === 1 && videos) {
    instruction = '🖼️ *Image dan video dikirim berurutan.*'
  } else if (videos && !images) {
    instruction = videos > 1
      ? '🎬 *Video dikirim berurutan.*'
      : '🎬 *Video Threads siap didownload.*'
  } else {
    instruction = '🖼️ *Single image Threads.*'
  }

  return [
    [
      '┌───「 🧵 *THREADS DOWNLOADER* 」───┐',
      '',
      ...contentInfo,
      '',
      '└──────────────────────────────────────┘'
    ].join('\n'),
    '',
    instruction,
    '',
    '> ✨ _*Powered by skyline-JXRA*_'
  ].join('\n')
}

async function downloadMedia(url) {
  const axios = (await import('axios')).default
  const { data: buffer } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36'
    }
  })
  const buf = Buffer.from(buffer)
  if (!buf.length) throw new Error('Empty buffer dari URL media')
  return buf
}

async function sendVideo(ctx, media, caption) {
  const videoBuffer = await downloadMedia(media.url)
  await ctx.client.message.send(ctx.chat, {
    type: 'video',
    media: videoBuffer,
    mimetype: 'video/mp4',
    ...(caption ? { caption } : {})
  })
}

async function sendSingleImage(ctx, media, caption) {
  const imageBuffer = await downloadMedia(media.url)
  await ctx.client.message.send(ctx.chat, {
    type: 'image',
    media: imageBuffer,
    mimetype: 'image/jpeg',
    ...(caption ? { caption } : {})
  })
}

async function sendCarouselImages(ctx, images, totalImages, url, username, caption) {
  const cards = images.map((img, index) => ({
    imageUrl: img.thumbnail && !/\.mp4/i.test(img.thumbnail) ? img.thumbnail : img.url,
    body: [
      `*Image ${index + 1} dari ${totalImages}*`,
      '',
      '🧵 Threads post'
    ].join('\n'),
    footer: `🧵 @${username || 'Unknown'}`,
    buttons: [
      { type: 'url', displayText: '🌐 Buka di Threads', url },
      { type: 'reply', displayText: '📋 Menu', id: 'rich:threads-menu' }
    ]
  }))

  await sendCarousel(ctx, { text: caption, cards })
}

onRichReply('rich:threads-menu', async (ctx) => {
  await ctx.reply(
    [
      '📋 *Menu Cepat*',
      '',
      '• `.threads <link>` — Threads downloader',
      '• `.tiktok <link>` — TikTok downloader',
      '• `.ig <link>` — Instagram downloader',
      '• `.menu all` — Menu lengkap',
      '• `.ping` — Cek status bot'
    ].join('\n')
  )
})

const pluginConfig = {
  name: "threads",
  alias: ['thread', 'threadsdl'],
  category: "downloader",
  description: "Downloader Threads",
  usage: ".threads",
  example: ".threads",
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
        [
          '🧵 *THREADS DOWNLOADER*',
          '',
          '- Kirim link Threads',
          '- Atau reply pesan yang berisi link Threads',
          '',
          '*Supported:*',
          '- Video (semua video dikirim)',
          '- Single image post',
          '- Carousel multi-image',
          '- Post campuran image + video',
          '',
          '*Contoh:*',
          '`.threads https://www.threads.com/share/BAbGGHk6r5/`'
        ].join('\n')
      )
    }

    await ctx.react('⏳')

    let result
    try {
      result = await JHThreadsDL(url)
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal scrape: ' + String(e.message || e).slice(0, 200))
    }

    if (!result.status) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal download: ' + (result.error || 'Unknown error'))
    }

    const data = result.data
    const videos = data.media.filter(d => d.type === 'video')
    const images = data.media.filter(d => d.type === 'image')
    const useCarousel = images.length >= 2

    try {
      const summary = formatCaption(data, url, { useCarousel })

      let firstSent = false
      const nextCaption = (extra) => {
        if (!firstSent) {
          firstSent = true
          return extra ? summary + '\n\n' + extra : summary
        }
        return extra || undefined
      }

      if (useCarousel) {
        const cardImages = images.slice(0, 25)
        await sendCarouselImages(
          ctx,
          cardImages,
          images.length,
          url,
          data.username,
          nextCaption(videos.length ? '🎬 *Video dikirim terpisah setelah carousel.*' : '')
        )

        for (let i = 25; i < images.length; i++) {
          await sendSingleImage(ctx, images[i], `🖼️ Image ${i + 1}/${images.length} • 🧵 Threads`)
        }
      } else if (images.length === 1) {
        await sendSingleImage(ctx, images[0], nextCaption(''))
      }

      for (let i = 0; i < videos.length; i++) {
        const extra = videos.length > 1
          ? `🎬 *Video ${i + 1}/${videos.length}* • 🧵 Threads`
          : '🎬 *Video Threads* • 🧵 Threads'
        await sendVideo(ctx, videos[i], nextCaption(extra))
      }

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Error: ' + String(error.message || error).slice(0, 250))
    }
  }

export { pluginConfig as config, handler };
