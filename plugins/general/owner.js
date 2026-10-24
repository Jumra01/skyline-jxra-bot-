/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * owner.js — Menampilkan kontak owner bot via Carousel Native Zapo (ala Hoshino Ai Type 2)
 */
import config from '../../config.js'
import { getThumbBuffer } from '../../core/cta.js'

const pluginConfig = {
  name: 'owner',
  alias: ['creator', 'dev', 'developer'],
  category: 'general',
  description: 'Menampilkan kontak owner bot via carousel card',
  usage: '.owner',
  example: '.owner',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
  energi: 0
}

const MIXED_BIZ_OPTIONS = {
  customNodes: [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' }, content: undefined }]
        }
      ]
    }
  ]
}

async function handler(ctx) {
  const { client, chat, event } = ctx
  const botName = config.botName || 'skyline-JXRA'
  const ownerNumbers = [
    ...(config.owner?.numbers || []),
    ...(config.staff || []).map((s) => s.number)
  ].map((n) => String(n).replace(/[^0-9]/g, '')).filter(Boolean)

  const uniqueOwners = [...new Set(ownerNumbers)]
  if (uniqueOwners.length === 0) {
    return ctx.reply('❌ Belum ada owner yang terdaftar di konfigurasi bot.')
  }

  // Siapkan gambar kartu carousel
  let uploadedImage = null
  try {
    const thumb = await getThumbBuffer()
    if (thumb && client.message?.upload) {
      const up = await client.message.upload(thumb, { type: 'image', mimetype: 'image/jpeg' })
      uploadedImage = {
        url: up.url,
        directPath: up.directPath,
        mediaKey: up.mediaKey,
        fileSha256: up.fileSha256,
        fileEncSha256: up.fileEncSha256,
        fileLength: up.fileLength,
        mediaKeyTimestamp: up.mediaKeyTimestamp,
        mimetype: 'image/jpeg'
      }
    }
  } catch {}

  const cards = uniqueOwners.map((num, i) => {
    const staffMatch = config.staff?.find((s) => String(s.number).replace(/[^0-9]/g, '') === num)
    const label = staffMatch?.label || (i === 0 ? '👑 Owner Utama' : `⭐ Owner ${i + 1}`)
    const waUrl = `https://wa.me/${num}?text=Halo%20${encodeURIComponent(label)}`

    return {
      header: {
        title: label,
        hasMediaAttachment: Boolean(uploadedImage),
        ...(uploadedImage ? { imageMessage: uploadedImage } : {})
      },
      body: {
        text: `Nomor: +${num}\nStatus: Active Developer\nBot: ${botName}\n\nCatatan:\n- Jangan spam bot/chat\n- Hubungi jika ada kendala penting`
      },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '💬 Chat Owner',
              url: waUrl,
              merchant_url: waUrl
            })
          },
          {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
              display_text: '📜 Semua Menu',
              id: '.allmenu'
            })
          }
        ]
      }
    }
  })

  return client.message.send(
    chat,
    {
      interactiveMessage: {
        body: {
          text: `Halo *${ctx.pushName || 'Kak'}* 👋\n\nBerikut daftar owner resmi dari *${botName}*. Silakan gunakan tombol di kartu untuk menghubungi langsung.`
        },
        footer: { text: `${botName} • Developer Center` },
        carouselMessage: {
          messageVersion: 1,
          cards
        }
      }
    },
    {
      quote: event,
      ...MIXED_BIZ_OPTIONS
    }
  )
}

export { pluginConfig as config, handler }
