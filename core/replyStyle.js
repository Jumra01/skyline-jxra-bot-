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
  8: { key: 'v8', name: 'USER PROFILE', emoji: '👤', desc: 'Profil user, role, status premium, command, dan waktu penggunaan' }
}

let VERSION = ''
try {
  VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? ''
} catch {}

const clamp = (n) => Math.min(8, Math.max(1, parseInt(n, 10) || 1))

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

    /* v8 USER PROFILE — rich entity card ala owner Type 5 */
    case 8: {
      const sender = ctx.sender || ''
      const number = ctx.senderNumber || String(sender).split('@')[0].split(':')[0] || '-'
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
      const when = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        timeZone: 'Asia/Jakarta'
      }).format(new Date(ctx.receivedAt || Date.now())) + ' WIB'
      const profileText = [
        `👤 *PROFIL PENGGUNA*`,
        ``,
        `Nama: *${ctx.pushName || 'Tidak diketahui'}*`,
        `Nomor: \`${number}\``,
        `Role: *${role}*`,
        `Status: *${tier}*`,
        `Chat: *${ctx.isGroup ? 'Grup' : 'Pribadi'}*`,
        `Command: *${ctx.command ? `.${ctx.command}` : 'Reply / pesan'}*`,
        `Dipakai: *${when}*`,
        ``,
        text
      ].join('\n')
      let imageUrl = await senderAvatar(ctx)
      if (!imageUrl) {
        const fallbackImage = await thumb300()
        if (fallbackImage && client.message?.upload) {
          try {
            const uploaded = await client.message.upload(fallbackImage, { type: 'image', mimetype: 'image/jpeg' })
            imageUrl = uploaded?.url || uploaded?.directPath || ''
          } catch {}
        }
      }
      const entity = {
        __typename: 'GenAICompactEntityPrimitive',
        title: ctx.pushName || 'Pengguna',
        subtitle: `${role} • ${tier}`,
        secondary_subtitle: `${ctx.isGroup ? 'Grup' : 'Pribadi'} • ${when} • ${ctx.command ? `.${ctx.command}` : 'pesan'}`,
        entity_id: Number(String(number).replace(/\D/g, '').slice(-8)) || 12345678,
        entity_url: String(config.reactChannel?.dedicatedChannelUrl || '').trim() || (sender.includes('@') ? `https://wa.me/${number}` : ''),
        entity_type: 'PERSON',
        action_type: 'MESSAGE',
        is_verified: Boolean(ctx.isOwner),
        ...(imageUrl ? { image: { url: imageUrl } } : {})
      }
      const payload = {
        response_id: crypto.randomUUID(),
        sections: [
          { view_model: { primitive: entity, __typename: 'GenAISingleLayoutViewModel' } },
          { view_model: { primitive: { text: profileText, __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } }
        ]
      }
      try {
        const richResult = await client.message.send(chat, {
          botForwardedMessage: {
            message: {
              richResponseMessage: {
                messageType: 1,
                submessages: [{ messageType: 2, messageText: profileText }],
                unifiedResponse: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
                contextInfo: { isForwarded: true, forwardOrigin: 4 }
              }
            }
          }
        }, { quote: event, additionalAttributes: { type: 'text' } })
        if (richResult?.id || richResult?.key?.id || richResult?.messageId) return richResult
        logger.warn('reply v8 rich entity tidak mendapat ack message id — fallback teks')
      } catch (err) {
        logger.warn({ err: String(err?.message ?? err) }, 'reply v8 rich entity gagal — fallback teks')
      }
      return client.message.send(chat, { type: 'text', text: profileText }, { quote: event, noStyle: true })
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
