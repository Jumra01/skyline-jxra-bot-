/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * replyStyle.js — Varian gaya reply pesan bot (.setreply): v1 BASIC s/d v7.
 * Persist di src/data/replyStyle.json (fallback config.reply.variant).
 * Dikirim oleh core/context.js tiap ctx.reply() DAN global hook di
 * buildContext (semua pesan teks bot kena varian aktif); diatur via .setreply.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import config from '../config.js'
import { logger } from './logger.js'
import { getThumbBuffer, getAdReply } from './cta.js'

const DATA_DIR = path.join(process.cwd(), 'src', 'data')
const FILE = path.join(DATA_DIR, 'replyStyle.json')

export const REPLY_VARIANTS = {
  1: { key: 'v1', name: 'BASIC', emoji: '✨', desc: 'Teks biasa (default)' },
  2: { key: 'v2', name: 'PREMIUM', emoji: '🖼️', desc: 'Dokumen + quote kontak palsu' },
  3: { key: 'v3', name: 'TITANIUM', emoji: '📨', desc: 'Video GIF + caption' },
  4: { key: 'v4', name: 'LV', emoji: '💼', desc: 'Link preview website + terus-kanal' },
  5: { key: 'v5', name: 'FAKE ORDER', emoji: '🛒', desc: 'Teks + quote order palsu' },
  6: { key: 'v6', name: 'SIMPLE DOCUMENT', emoji: '📄', desc: 'Dokumen + quote pesan asli' },
  7: { key: 'v7', name: 'FAKE LOCATION', emoji: '📍', desc: 'Header lokasi palsu (interactive)' },
  8: { key: 'v8', name: 'LOCATION FLOW', emoji: '🗺️', desc: 'Interactive location header' },
  9: { key: 'v9', name: 'BUTTON FLOW', emoji: '🔘', desc: 'Location header + tombol aksi' },
  10: { key: 'v10', name: 'BUSINESS CARD', emoji: '💼', desc: 'Kartu bisnis interactive' },
  11: { key: 'v11', name: 'PAYMENT', emoji: '💳', desc: 'Request payment bubble' },
  12: { key: 'v12', name: 'ANIMATED PREVIEW', emoji: '🌀', desc: 'Link preview dengan judul bot' },
  13: { key: 'v13', name: 'CATALOG', emoji: '🛍️', desc: 'Katalog order sebagai pesan utama' },
  14: { key: 'v14', name: 'RICH HTML', emoji: '✨', desc: 'Kartu HTML native interaktif' },
  15: { key: 'v15', name: 'PREVIEW PLUS', emoji: '🌐', desc: 'Link preview lanjutan' },
  16: { key: 'v16', name: 'PRODUCT CARD', emoji: '🧾', desc: 'Kartu produk native HTML' }
}

let VERSION = ''
try {
  VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? ''
} catch {}

const clamp = (n) => Math.min(16, Math.max(1, parseInt(n, 10) || 1))

let cache = null

export function getReplyStyle() {
  if (cache) return cache
  let v = config.reply?.variant ?? 1
  try {
    if (fs.existsSync(FILE)) v = JSON.parse(fs.readFileSync(FILE, 'utf8')).variant ?? v
  } catch {}
  cache = clamp(v)
  return cache
}

export function setReplyStyle(n) {
  cache = clamp(n)
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify({ variant: cache }, null, 2))
  } catch {}
  return cache
}

/* ══════════════ Pengiriman per varian ══════════════ */

/**
 * [GLOBAL SETREPLY] Depth guard — aktif selama sendReplyVariant/sendBasicReply
 * jalan. Global hook di core/context.js cek isStyling() supaya envelope internal
 * (yang dikirim lewat client.message.send yang sama) gak ke-wrap ulang → nol
 * recursion.
 */
let stylingDepth = 0
export function isStyling() {
  return stylingDepth > 0
}

const randId = () => crypto.randomBytes(10).toString('hex').toUpperCase()

const CONTACT_VCARD =
  'BEGIN:VCARD\n' +
  'VERSION:3.0\n' +
  `N:XL;${config.botName},;;;\n` +
  `FN:${config.botName}\n` +
  'item1.TEL;waid=13135550002:+1 (313) 555-0002\n' +
  'item1.X-ABLabel:Ponsel\n' +
  'END:VCARD'

function gifPath() {
  return config.reply?.gifPath
    ? path.resolve(process.cwd(), config.reply.gifPath)
    : path.join(process.cwd(), 'assets', 'reply', 'skyline-mp4.mp4')
}

function readVersionedFile(rel) {
  return fs.readFileSync(new URL(rel, import.meta.url))
}

async function thumb300() {
  try {
    const buf = await getThumbBuffer()
    if (!buf) return null
    const sharp = (await import('sharp')).default
    // flatten: PNG/WebP transparan kalau langsung di-JPEG = hitam.
    return await sharp(buf)
      .flatten({ background: '#ffffff' })
      .resize(300, 300, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer()
  } catch {
    return null
  }
}

/** newsletterJid channel dari config.reactChannel.dedicatedChannelUrl (atau null). */
function channelNewsletterJid() {
  try {
    const code = (config.reactChannel?.dedicatedChannelUrl ?? '').match(/channel\/([0-9A-Za-z]+)/)?.[1]
    return code ? `${code}@newsletter` : null
  } catch {
    return null
  }
}

/** Parse OG tags dari HTML halaman (title/description/image) buat preview v4. */
function parseOg(html) {
  const meta = (key) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']og:${key}["'][^>]*content=["']([^"']+)["']`, 'i'))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:${key}["']`, 'i'))?.[1]
  const title = meta('title') ?? html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]
  const description = meta('description')
  const image = meta('image')
  if (!title && !description && !image) return null
  return { title: title?.trim(), description: description?.trim(), image: image?.trim() }
}

/**
 * Fetch OG asli dari website (github dsb) → { title, description, thumbnail }.
 * Gagal/gak ada OG → null (caller fallback ke thumb lokal).
 */
async function fetchOgPreview(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; skyline-JXRA/1.0)' }
    })
    if (!res.ok) return null
    const html = (await res.text()).slice(0, 300_000)
    const og = parseOg(html)
    if (!og) return null
    let thumbnail
    if (og.image) {
      try {
        const imgRes = await fetch(og.image, { signal: AbortSignal.timeout(6000), redirect: 'follow' })
        if (imgRes.ok) {
          const raw = Buffer.from(await imgRes.arrayBuffer())
          const sharp = (await import('sharp')).default
          thumbnail = await sharp(raw)
            .rotate()
            .flatten({ background: '#ffffff' })
            .resize(360, 360, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 65 })
            .toBuffer()
        }
      } catch {}
    }
    return { title: og.title, description: og.description, thumbnail }
  } catch {
    return null
  }
}

/**
 * Cache OG preview — fetch website (+gambar OG) tiap ctx.reply (varian v4) bisa
 * menunda reply 6-12 detik kalau site lambat. Sekali fetch per URL dipakai ulang
 * 10 menit; hasil null pun di-cache biar site mati gak terus dicoba.
 */
const OG_CACHE_TTL = 10 * 60 * 1000
const ogCache = new Map() // url → { at, og|null }

async function fetchOgPreviewCached(url) {
  const hit = ogCache.get(url)
  if (hit && Date.now() - hit.at < OG_CACHE_TTL) return hit.og
  const og = await fetchOgPreview(url)
  ogCache.set(url, { at: Date.now(), og })
  return og
}

const V4_THUMB_TTL = 30 * 60 * 1000
const v4ThumbCache = new Map() // key path#mtime → { buf, at }

/**
 * Thumbnail lokal preview v4 dari config.reply.v4.thumb (default
 * assets/thumb/v4-thumb.jpg — bisa ditimpa langsung atau via
 * `.setreply thumb v4`). 'off'/kosong/file hilang → null (fallback OG).
 */
async function loadV4Thumb() {
  const rel = String(config.reply?.v4?.thumb ?? 'assets/thumb/v4-thumb.jpg').trim()
  if (!rel || rel === 'off') return null
  const p = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel)
  try {
    const st = fs.statSync(p)
    if (!st.isFile()) return null
    const key = `${p}#${st.mtimeMs}`
    const hit = v4ThumbCache.get(key)
    if (hit && Date.now() - hit.at < V4_THUMB_TTL) return hit.buf
    const sharp = (await import('sharp')).default
    const buf = await sharp(fs.readFileSync(p))
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(360, 360, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 65 })
      .toBuffer()
    v4ThumbCache.set(key, { buf, at: Date.now() })
    return buf
  } catch {
    return null
  }
}

/**
 * Kirim pesan balasan dengan varian gaya (2-7).
 * Varian 1 (BASIC) gak lewat sini — ditangani ctx.reply langsung.
 * Kalau gagal, lempar error biar pemanggil fallback ke teks biasa.
 */
export async function sendReplyVariant(ctx, text, style) {
  stylingDepth++
  try {
    return await runReplyVariant(ctx, text, style)
  } finally {
    stylingDepth--
  }
}

async function runReplyVariant(ctx, text, style) {
  const { client, chat, event } = ctx

  switch (Number(style)) {
    /* v2 PREMIUM — dokumen + quote kontak palsu */
    case 2:
    /* v6 SIMPLE DOCUMENT — dokumen + quote pesan asli */
    case 6: {
      const content = {
        type: 'document',
        media: readVersionedFile('../package.json'),
        mimetype: 'image/png',
        fileName: config.botName,
        caption: text
      }
      const jpeg = await thumb300()
      if (jpeg) content.jpegThumbnail = jpeg

      const quote =
        style === 2
          ? {
              id: randId(),
              remoteJid: 'status@broadcast',
              participant: '0@s.whatsapp.net',
              message: {
                contactMessage: {
                  displayName: `🪸 ${config.botName}`,
                  vcard: CONTACT_VCARD
                }
              }
            }
          : event
      return client.message.send(chat, content, { quote })
    }

    /* v3 TITANIUM — video GIF + caption, quote pesan asli */
    case 3: {
      const gif = gifPath()
      if (!fs.existsSync(gif)) throw new Error(`aset GIF reply gak ketemu: ${gif}`)
      return client.message.send(
        chat,
        {
          type: 'video',
          media: fs.readFileSync(gif),
          mimetype: 'video/mp4',
          caption: text,
          gifPlayback: true
        },
        { quote: event }
      )
    }

    /* v4 LV — link preview website + forwarded newsletter */
    case 4: {
      // Auto-detect: bare domain ('github.com/x') → tambah https:// otomatis
      let website = String(config.reply?.website || '').trim()
      if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website
      const v4cfg = config.reply?.v4 || {}
      const defDesc = `Pengembang: ${config.owner?.name || config.botName}${VERSION ? ` • v${VERSION}` : ''}`
      const newsletterJid = channelNewsletterJid()

      // Preview v4:
      //  teks  = config.reply.v4.title/desc (kalau diisi) > OG halaman > cta.card > default
      //  thumb = aset lokal config.reply.v4.thumb (assets/thumb/v4-thumb.jpg)
      //          > OG image > thumb global cta-thumb.jpg
      let preview
      if (website) {
        const og = await fetchOgPreviewCached(website)
        const localThumb = await loadV4Thumb()
        const title = (v4cfg.title || og?.title || config.cta?.card?.title || config.botName || '')
          .trim()
          .slice(0, 100)
        const desc = (v4cfg.desc || og?.description || config.cta?.card?.body || defDesc)
          .trim()
          .slice(0, 200)
        const thumbBytes = localThumb || og?.thumbnail || (await getThumbBuffer())
        preview = {
          matchedText: website,
          title,
          description: desc,
          ...(thumbBytes ? { thumbnail: { bytes: thumbBytes } } : {})
        }
      }

      const raw = {
        isForwarded: true,
        forwardingScore: 9,
        ...(newsletterJid
          ? {
              forwardedNewsletterMessageInfo: {
                newsletterJid,
                newsletterName: config.botName,
                serverMessageId: Math.floor(Math.random() * 1_000_000)
              }
            }
          : {})
      }

      return client.message.send(
        chat,
        {
          type: 'text',
          text: website ? `${website}\n\n${text}` : text,
          ...(preview ? { linkPreview: preview } : {})
        },
        { quote: event, contextInfo: { raw } }
      )
    }

    /* v5 FAKE ORDER — teks + quote orderMessage palsu (+ kartu CTA) */
    case 5: {
      const content = { type: 'text', text }
      const jpeg = await thumb300()
      try {
        const ad = await getAdReply()
        if (ad) content.contextInfo = { raw: { externalAdReply: ad } }
      } catch {}
      return client.message.send(chat, content, {
        quote: {
          id: randId(),
          remoteJid: chat,
          participant: '0@s.whatsapp.net',
          message: {
            orderMessage: {
              orderId: '123456',
              itemCount: 999,
              status: 1,
              surface: 1,
              message: config.botName,
              orderTitle: 'System Notification',
              sellerJid: '0@s.whatsapp.net',
              token: 'ARU1+',
              totalAmount1000: '1000000',
              totalCurrencyCode: 'IDR',
              ...(jpeg ? { thumbnail: jpeg } : {})
            }
          }
        }
      })
    }

    /* v7 FAKE LOCATION — interactive header lokasi palsu */
    case 7: {
      const jpeg = await thumb300()
      return client.message.send(
        chat,
        {
          interactiveMessage: {
            header: {
              hasMediaAttachment: true,
              locationMessage: {
                degreesLatitude: 0,
                degreesLongitude: 0,
                name: config.botName,
                address: 'WhatsApp Bot Multi Device',
                ...(jpeg ? { jpegThumbnail: jpeg } : {})
              }
            },
            body: { text },
            nativeFlowMessage: { buttons: [] }
          }
        },
        { quote: event }
      )
    }

    /* v8 LOCATION FLOW — interactive location header + companion biz */
    case 8: {
      const jpeg = await thumb300()
      return client.message.send(
        chat,
        {
          interactiveMessage: {
            header: {
              hasMediaAttachment: true,
              locationMessage: {
                degreesLatitude: -6.2088,
                degreesLongitude: 106.8456,
                name: config.botName,
                address: 'skyline-JXRA • Location Flow',
                ...(jpeg ? { jpegThumbnail: jpeg } : {})
              }
            },
            body: { text },
            footer: { text: config.botName },
            nativeFlowMessage: {
              messageVersion: 1,
              buttons: [
                {
                  name: 'quick_reply',
                  buttonParamsJson: JSON.stringify({ display_text: '👑 Owner', id: '.owner' })
                },
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({ display_text: '🌐 Website', url: 'https://skyline.web.id' })
                }
              ]
            }
          }
        },
        { quote: event }
      )
    }

    /* v9 BUTTON FLOW — buttonsMessage dibungkus documentWithCaptionMessage (sesuai delivery-matrix zapo) */
    case 9: {
      const jpeg = await thumb300()
      return client.message.send(
        chat,
        {
          documentWithCaptionMessage: {
            message: {
              buttonsMessage: {
                contentText: text,
                footerText: config.botName,
                headerType: 1,
                buttons: [
                  {
                    buttonId: '.owner',
                    buttonText: { displayText: '👑 Kontak Owner' },
                    type: 1,
                    nativeFlowInfo: {}
                  },
                  {
                    buttonId: '.allmenu',
                    buttonText: { displayText: '📜 Semua Menu' },
                    type: 1,
                    nativeFlowInfo: {}
                  }
                ]
              }
            }
          }
        },
        { quote: event }
      )
    }

    /* v10 BUSINESS CARD — interactiveMessage dengan header text/sub + cta_url/quick_reply */
    case 10: {
      return client.message.send(
        chat,
        {
          interactiveMessage: {
            header: {
              title: `💼 ${config.botName}`,
              subtitle: 'Verified Service Provider',
              hasMediaAttachment: false
            },
            body: { text },
            footer: { text: 'WhatsApp Business Solution • zapo-js' },
            nativeFlowMessage: {
              messageVersion: 1,
              buttons: [
                {
                  name: 'quick_reply',
                  buttonParamsJson: JSON.stringify({ display_text: '💬 Hubungi Owner', id: '.owner' })
                },
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({ display_text: '🌐 Official Portal', url: 'https://skyline.web.id' })
                }
              ]
            }
          }
        },
        { quote: event }
      )
    }

    /* v11 PAYMENT — review_and_pay native flow resmi zapo (isCustomItem: true) */
    case 11: {
      const referenceId = `PAY-${Date.now()}`
      return client.message.send(
        chat,
        {
          interactiveMessage: {
            body: { text },
            footer: { text: `${config.botName} • Invoice Payment` },
            nativeFlowMessage: {
              messageVersion: 1,
              buttons: [
                {
                  name: 'review_and_pay',
                  buttonParamsJson: JSON.stringify({
                    currency: 'IDR',
                    reference_id: referenceId,
                    total_amount: { value: 1000000, offset: 100 },
                    payment_settings: [
                      {
                        type: 'custom_payment_method',
                        custom_payment_method: {
                          name: 'QRIS / Transfer Bank',
                          reference_id: referenceId
                        }
                      }
                    ],
                    order: {
                      status: 'payment_requested',
                      subtotal: { value: 1000000, offset: 100 },
                      order_type: 'ORDER',
                      items: [
                        {
                          name: `${config.botName} Premium Order`,
                          amount: { value: 1000000, offset: 100 },
                          quantity: 1,
                          isCustomItem: true,
                          isQuantitySet: true
                        }
                      ]
                    }
                  })
                }
              ]
            }
          }
        },
        { quote: event }
      )
    }

    /* v12 ANIMATED PREVIEW — update linkPreview title bertahap via editKey */
    case 12: {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const frames = [
        '🌐 Menghubungkan...',
        `🌐 [ ${config.botName} ]`,
        `🌐 [ ${config.botName} v${VERSION || '1.0'} ]`,
        `🌐 ${config.botName} Online`
      ]
      const sent = await client.message.send(
        chat,
        {
          type: 'text',
          text,
          linkPreview: {
            matchedText: 'https://skyline.web.id',
            title: frames[0],
            description: 'skyline-JXRA Animated Preview'
          }
        },
        { quote: event, noStyle: true }
      )
      const editKey = sent?.key?.id || sent?.message?.key?.id || sent?.id
      if (editKey) {
        for (let i = 1; i < frames.length; i++) {
          await delay(700)
          await client.message.send(
            chat,
            {
              type: 'text',
              text,
              linkPreview: {
                matchedText: 'https://skyline.web.id',
                title: frames[i],
                description: 'skyline-JXRA Animated Preview'
              }
            },
            {
              quote: event,
              editKey: { id: editKey, participant: ctx.isGroup ? client.auth?.getCurrentCredentials?.()?.meJid : undefined },
              noStyle: true
            }
          ).catch(() => null)
        }
      }
      return sent
    }

    /* v13 CATALOG — carousel produk katalog resmi zapo (MIXED_BIZ_OPTIONS + cta_catalog + cta_url) */
    case 13: {
      const pn = ctx.client.auth?.getCurrentCredentials?.()?.meJid?.split('@')?.[0] || '628000000000'
      const thumb = await thumb300()
      let uploadedImage = null
      if (thumb && client.message?.upload) {
        try {
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
        } catch {}
      }

      const cards = [
        {
          header: {
            title: `${config.botName} Service`,
            hasMediaAttachment: Boolean(uploadedImage),
            ...(uploadedImage ? { imageMessage: uploadedImage } : {})
          },
          body: { text: `${text.slice(0, 80)}\nIDR 50.000` },
          nativeFlowMessage: {
            messageVersion: 1,
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🌐 Website',
                  url: 'https://skyline.web.id',
                  merchant_url: 'https://skyline.web.id'
                })
              },
              {
                name: 'cta_catalog',
                buttonParamsJson: JSON.stringify({
                  business_phone_number: pn
                })
              }
            ]
          }
        }
      ]

      return client.message.send(
        chat,
        {
          interactiveMessage: {
            body: { text },
            footer: { text: config.botName },
            carouselMessage: { messageVersion: 1, cards }
          }
        },
        {
          quote: event,
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
      )
    }

    /* v14 RICH PROTO — submessages native AI rich response (type 2 text + type 5 code) */
    case 14: {
      return client.message.send(
        chat,
        {
          botForwardedMessage: {
            message: {
              richResponseMessage: {
                messageType: 1,
                submessages: [
                  {
                    messageType: 2,
                    messageText: `✨ *${config.botName}*\n\n${text}`
                  },
                  {
                    messageType: 5,
                    codeMetadata: {
                      codeLanguage: 'text',
                      codeBlocks: [
                        { highlightType: 0, codeContent: text }
                      ]
                    }
                  }
                ],
                contextInfo: { isForwarded: true, forwardOrigin: 4 }
              }
            }
          }
        },
        { quote: event, additionalAttributes: { type: 'text' } }
      )
    }

    /* v15 PREVIEW PLUS — linkPreview dengan OG image buffer dinamis */
    case 15: {
      const website = 'https://skyline.web.id'
      const og = await fetchOgPreviewCached(website)
      const jpeg = await thumb300()
      return client.message.send(
        chat,
        {
          type: 'text',
          text: `${website}\n\n${text}`,
          linkPreview: {
            matchedText: website,
            title: `🌐 ${config.botName} Hub`,
            description: og?.description || 'WhatsApp Multi-Device Assistant with zapo-js',
            ...(og?.thumbnail || jpeg ? { thumbnail: { bytes: og?.thumbnail || jpeg } } : {})
          }
        },
        { quote: event, noStyle: true }
      )
    }

    /* v16 RICH PROTO PRODUCT-STYLE — rich submessages, tanpa HTML/WebView/download */
    case 16: {
      const thumb = await thumb300()
      const imageUrl = thumb ? `data:image/jpeg;base64,${thumb.toString('base64')}` : ''
      return client.message.send(
        chat,
        {
          botForwardedMessage: {
            message: {
              richResponseMessage: {
                messageType: 1,
                submessages: [
                  {
                    messageType: 2,
                    messageText: `🧾 *${config.botName} Product Card*\n\n${text}`
                  },
                  {
                    messageType: 4,
                    tableMetadata: {
                      title: config.botName,
                      rows: [
                        { items: ['Product', config.botName], isHeading: true },
                        { items: ['Status', 'Available'], isHeading: false },
                        { items: ['Website', 'https://skyline.web.id'], isHeading: false }
                      ]
                    }
                  },
                  ...(imageUrl
                    ? [{
                        messageType: 3,
                        imageMetadata: {
                          imageUrl: {
                            imagePreviewUrl: imageUrl,
                            imageHighResUrl: imageUrl,
                            sourceUrl: imageUrl
                          }
                        }
                      }]
                    : [])
                ],
                contextInfo: { isForwarded: true, forwardOrigin: 4 }
              }
            }
          }
        },
        { quote: event, additionalAttributes: { type: 'text' } }
      )
    }
    default:
      throw new Error(`reply variant ${style} gak dikenal`)
  }
}

/** Fallback teks biasa + kartu CTA (dipakai ctx.reply buat v1 & saat varian gagal). */
export async function sendBasicReply(ctx, text) {
  stylingDepth++
  try {
    try {
      const ad = await getAdReply()
      if (ad) {
        return await ctx.client.message.send(ctx.chat, text, {
          contextInfo: { raw: { externalAdReply: ad } }
        })
      }
    } catch (err) {
      logger.warn({ err: String(err?.message ?? err) }, 'kartu CTA gagal — kirim teks biasa')
    }
    return await ctx.client.message.send(ctx.chat, text)
  } finally {
    stylingDepth--
  }
}
