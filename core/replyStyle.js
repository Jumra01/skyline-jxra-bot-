/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * replyStyle.js — Varian gaya reply pesan bot (.setreply): v1 BASIC s/d v8.
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
import { isPremiumActive } from './database.js'

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
  8: { key: 'v8', name: 'USER PROFILE', emoji: '👤', desc: 'Profil user, role, status premium, command, dan waktu penggunaan' },
  9: { key: 'v9', name: 'PRODUCT PROFILE', emoji: '', desc: 'Product card dengan profil bot, command, status online, dan balasan small caps bold' }
}

let VERSION = ''
try {
  VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? ''
} catch {}

const clamp = (n) => Math.min(9, Math.max(1, parseInt(n, 10) || 1))

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

async function senderAvatar(ctx) {
  try {
    const result = await Promise.race([
      Promise.resolve(ctx.client?.profile?.getProfilePicture?.(ctx.sender, 'image')),
      new Promise((resolve) => setTimeout(() => resolve(null), 4000))
    ])
    const url = typeof result === 'string' ? result : result?.url
    return url && /^https?:\/\//i.test(url) ? url : null
  } catch {
    return null
  }
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
    logger.debug(
      { style, chat: ctx?.chat, len: String(text ?? '').length },
      `[REPLY] kirim varian v${style}`
    )
    const result = await runReplyVariant(ctx, text, style)
    logger.debug(
      { style, chat: ctx?.chat, ok: true },
      `[REPLY] v${style} terkirim`
    )
    return result
  } catch (err) {
    // Log jelas: varian berapa, chat mana, pesan error, dan 3 baris stack
    // pertama — biar kegagalan varian langsung kelihatan di panel, bukan diam.
    const reason = String(err?.message ?? err)
    logger.warn(
      {
        style,
        chat: ctx?.chat,
        err: reason,
        stack: String(err?.stack ?? '').split('\n').slice(1, 4).join(' | '),
      },
      `[REPLY] v${style} GAGAL — ${reason}`
    )
    throw err
  } finally {
    stylingDepth--
  }
}

async function runReplyVariant(ctx, text, style) {
  const { client, chat, event } = ctx

  switch (Number(style)) {
    /* v1 BASIC — teks biasa (default sendBasicReply) */
    case 1: {
      return client.message.send(chat, { type: 'text', text }, { quote: event })
    }
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

    /* v7 FAKE LOCATION — interactive header lokasi palsu (fakelocate) */
    case 7: {
      // Nama bot + address (skyline.web.id) + foto thumb semua dari config →
      // ganti di config.ui.menuLocation.address / config.reply.v4.thumb.
      const v7 = config.reply?.v7 || {}
      const jpeg = await loadV4Thumb()   // thumb ganti lewat config.reply.v4.thumb
      const addr = v7.address || config.ui?.menuLocation?.address || 'https://skyline.web.id'
      return client.message.send(
        chat,
        {
          interactiveMessage: {
            header: {
              hasMediaAttachment: true,
              locationMessage: {
                degreesLatitude: 0,
                degreesLongitude: 0,
                name: config.botName || 'skyline-JXRA',
                address: addr,
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

    /* v8 USER PROFILE — rich entity card ala owner Type 5 */
    case 8:
    case 9: {
      const number = ctx.senderNumber || String(ctx.sender || '').split('@')[0].split(':')[0] || '-'
      const premium = (() => {
        try {
          return ctx.isOwner ? false : Boolean(
            (ctx.sender && isPremiumActive(ctx.sender)) ||
            (ctx.senderLid && isPremiumActive(ctx.senderLid))
          )
        } catch { return false }
      })()
      const role = !ctx.isGroup ? 'Pengguna pribadi' : ctx.isOwner ? 'Owner' : ctx.role === 'admin' || ctx.isAdmin ? 'Admin grup' : 'Member grup'
      const tier = ctx.isOwner ? 'Owner' : premium ? 'Premium' : 'User biasa'
      let senderLabel = config.botName || 'skyline-JXRA'
      if (ctx.isGroup) {
        try {
          const meta = await Promise.race([
            Promise.resolve(client.group?.queryGroupMetadata?.(chat)),
            new Promise((resolve) => setTimeout(() => resolve(null), 3500))
          ])
          senderLabel = meta?.subject || meta?.name || 'Grup WhatsApp'
        } catch { senderLabel = 'Grup WhatsApp' }
      }
      const when = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        timeZone: 'Asia/Jakarta'
      }).format(new Date(ctx.receivedAt || Date.now())) + ' WIB'
      // WA does not expose custom fonts in rich text. Use Unicode bold sans-serif
      // for the first non-empty line so the emphasis is visibly rendered without HTML.
      const toBoldSans = (value) => Array.from(value, (char) => {
        const code = char.codePointAt(0)
        if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d5d4 + code - 0x41)
        if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d5ee + code - 0x61)
        if (code >= 0x30 && code <= 0x39) return String.fromCodePoint(0x1d7ec + code - 0x30)
        return char
      }).join('')
      const lines = String(text ?? '').split('\n')
      const firstLine = lines.findIndex((line) => line.trim())
      if (firstLine >= 0) lines[firstLine] = toBoldSans(lines[firstLine])
      const richBody = lines.join('\n')
      let imageUrl = await senderAvatar(ctx)
      if (Number(style) !== 9 && !imageUrl) {
        const fallbackImage = await thumb300()
        if (fallbackImage && client.message?.upload) {
          try {
            const uploaded = await client.message.upload(fallbackImage, { type: 'image', mimetype: 'image/jpeg' })
            imageUrl = uploaded?.url || uploaded?.directPath || ''
          } catch {}
        }
      }
      if (Number(style) === 9) {
        const toBoldFont = (value) => Array.from(String(value ?? ''), (char) => {
          const code = char.codePointAt(0)
          if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d5d4 + code - 0x41)
          if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d5ee + code - 0x61)
          if (code >= 0x30 && code <= 0x39) return String.fromCodePoint(0x1d7ec + code - 0x30)
          return char
        }).join('')
        const styledText = toBoldFont(text)
        const v9Cfg = config.reply || {}
        const v9Str = (value) => String(value ?? '').trim()
        const styledTitle = toBoldFont(v9Str(v9Cfg.v9Title) || config.botName || 'skyline-JXRA')
        const styledBrand = toBoldFont(v9Str(v9Cfg.v9Brand) || (ctx.command || 'pesan'))
        // WhatsApp rich text gak bisa warna teks → penanda hijau pakai emoji 🟢.
        // Kalau `v9Price` sudah diawali emoji bulat, jangan ditambah lagi.
        const rawPrice = v9Str(v9Cfg.v9Price) || 'Online'
        const styledPrice = toBoldFont(/^[\u{1F7E2}\u2705\u{1F49A}]/u.test(rawPrice) ? rawPrice : `🟢 ${rawPrice}`)
        const configuredV9Thumbnail = String(config.reply?.v9ThumbnailUrl || '').trim()
        const productImage = /^https:\/\//i.test(configuredV9Thumbnail) ? configuredV9Thumbnail : ''
        // The product-card primitive always renders a small default icon
        // (WhatsApp's own logo) even when `product_url`/`additional_images` are
        // omitted. So the product card is only used when the owner explicitly
        // configures a link/icon; otherwise v9 uses a plain image header, which
        // has no small circular icon at all.
        const configuredV9ProductUrl = String(config.reply?.v9ProductUrl || '').trim()
        const productUrl = /^https:\/\//i.test(configuredV9ProductUrl) ? configuredV9ProductUrl : ''
        const configuredV9Icon = String(config.reply?.v9IconUrl || '').trim()
        const productIcon = /^https:\/\//i.test(configuredV9Icon) ? configuredV9Icon : ''
        const useProductCard = Boolean(productUrl || productIcon)
        const textSection = {
          view_model: {
            __typename: 'GenAISingleLayoutViewModel',
            primitive: { text: styledText, __typename: 'GenAIMarkdownTextUXPrimitive' }
          }
        }
        const headerSection = useProductCard
          ? {
              view_model: {
                __typename: 'GenAISingleLayoutViewModel',
                primitive: {
                  __typename: 'GenAIProductItemCardPrimitive',
                  title: styledTitle,
                  brand: styledBrand,
                  price: styledPrice,
                  sale_price: '',
                  ...(productUrl ? { product_url: productUrl } : {}),
                  ...(productIcon ? { additional_images: [{ url: productIcon }] } : {}),
                  image: { url: productImage }
                }
              }
            }
          : productImage
            ? {
                view_model: {
                  __typename: 'GenAISingleLayoutViewModel',
                  primitive: {
                    media: { url: productImage, mime_type: 'image/png' },
                    imagine_type: 'IMAGE',
                    status: { status: 'READY' },
                    __typename: 'GenAIImaginePrimitive'
                  }
                }
              }
            : null
        const productPayload = {
          response_id: crypto.randomUUID(),
          sections: [
            ...(headerSection ? [headerSection] : []),
            useProductCard ? textSection : {
              view_model: {
                __typename: 'GenAISingleLayoutViewModel',
                primitive: {
                  text: `${styledTitle}\n${styledBrand} • ${styledPrice}\n\n${styledText}`,
                  __typename: 'GenAIMarkdownTextUXPrimitive'
                }
              }
            }
          ]
        }
        const richContent = {
          botForwardedMessage: {
            message: {
              richResponseMessage: {
                messageType: 1,
                submessages: [{ messageType: 2, messageText: useProductCard ? '[ CANNOT_LOAD_PRODUCT - NIXEL ]' : styledText }],
                unifiedResponse: { data: Buffer.from(JSON.stringify(productPayload)).toString('base64') },
                contextInfo: { isForwarded: true, forwardOrigin: 4 }
              }
            }
          }
        }
        const richResult = await client.message.send(chat, richContent, { additionalAttributes: { type: 'text' } })
        const richId = richResult?.id || richResult?.key?.id || richResult?.messageId
        if (richId) {
          try {
            const meJid = client.getCurrentMeJid?.() || client.getCurrentCredentials?.()?.meJid
            await client.message.send(chat, {
              botForwardedMessage: {
                message: {
                  protocolMessage: {
                    key: {
                      remoteJid: chat,
                      fromMe: true,
                      id: richId,
                      ...(String(chat).endsWith('@g.us') && meJid ? { participant: meJid } : {})
                    },
                    type: 14,
                    editedMessage: richContent
                  }
                }
              }
            }, { additionalAttributes: { type: 'text' } })
          } catch (err) {
            logger.warn({ err: String(err?.message ?? err) }, 'reply v9 rich edit-identik gagal')
          }
        }
        return richResult
      }
      const entity = {
        __typename: 'GenAICompactEntityPrimitive',
        title: config.botName || 'skyline-JXRA',
        subtitle: ctx.isGroup ? senderLabel : `${role} • ${tier}`,
        secondary_subtitle: `📅 ${when} • ${ctx.command ? `.${ctx.command}` : 'pesan'}`,
        entity_id: Number(String(number).replace(/\D/g, '').slice(-8)) || 12345678,
        entity_url: String(config.reactChannel?.dedicatedChannelUrl || '').trim(),
        entity_type: 'PERSON',
        action_type: 'MESSAGE',
        ...(imageUrl ? { image: { url: imageUrl } } : {})
      }
      const payload = {
        response_id: crypto.randomUUID(),
        sections: [
          { view_model: { primitive: entity, __typename: 'GenAISingleLayoutViewModel' } },
          { view_model: { primitive: { text: richBody, __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } }
        ]
      }
      /* Envelope v8 wajib POLOS — hanya `{ isForwarded, forwardOrigin: 4 }`.
       * Field `forwardedAiBotMessageInfo` + `forwardingScore` + wrapper
       * `messageContextInfo.botMetadata.verificationMetadata` (palsu) bikin
       * WhatsApp menampilkan prompt "Please update WhatsApp to the latest
       * version" padahal WA sudah versi terbaru — jalur `unifiedResponse`
       * (GenAI) memverifikasi metadata itu. Sudah dibuktikan saat fix
       * `.tesrich html`; pola aman = persis `sendNativeHtml` (lib/emeraldCard.js).
       * Payload dibangun SEKALI dan dipakai ulang untuk edit-identik. */
      const richContent = {
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              messageType: 1,
              submessages: [{ messageType: 2, messageText: richBody }],
              unifiedResponse: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
              contextInfo: { isForwarded: true, forwardOrigin: 4 }
            }
          }
        }
      }
      try {
        const richResult = await client.message.send(chat, richContent, { additionalAttributes: { type: 'text' } })
        const richId = richResult?.id || richResult?.key?.id || richResult?.messageId
        if (richId) {
          try {
            const meJid = client.getCurrentMeJid?.() || client.getCurrentCredentials?.()?.meJid
            await client.message.send(chat, {
              botForwardedMessage: {
                message: {
                  protocolMessage: {
                    key: {
                      remoteJid: chat,
                      fromMe: true,
                      id: richId,
                      ...(String(chat).endsWith('@g.us') && meJid ? { participant: meJid } : {})
                    },
                    type: 14,
                    editedMessage: richContent
                  }
                }
              }
            }, { additionalAttributes: { type: 'text' } })
          } catch (editErr) {
            logger.warn({ err: String(editErr?.message ?? editErr) }, 'reply v8 rich edit-identik gagal')
          }
          return richResult
        }
        logger.warn('reply v8 rich entity tidak mendapat ack message id — fallback teks')
      } catch (err) {
        logger.warn({ err: String(err?.message ?? err) }, 'reply v8 rich entity gagal — fallback teks')
      }
      return client.message.send(chat, { type: 'text', text }, { quote: event, noStyle: true })
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
