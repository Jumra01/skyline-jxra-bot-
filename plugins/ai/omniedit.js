/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * omniedit.js — Edit gambar dengan AI Omni Editor (backend skyline.web.id)
 *
 * Gambar sumber: balas/quote foto, foto caption command, atau URL.
 * Website & API key ikut config.js → blok `api.skyline` (sama kayak fitur
 * YouTube), bisa di-override env SKYLINE_API_KEY / SKYLINE_API_URL.
 */
import axios from 'axios'
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import { skylineCreds, omniEdit } from '../../scraper/SKYLINE.js'
import { logger } from '../../core/logger.js'

const MAX_IMAGE = 10 * 1024 * 1024

const pluginConfig = {
  name: 'omniedit',
  alias: ['omnieditor', 'omni', 'editimg'],
  category: 'ai',
  description: 'Edit gambar pake AI Omni Editor — ganti background, style, outfit, dll',
  usage: '.omniedit <prompt> (sambil reply/quote gambar)\n.omniedit <url_gambar> | <prompt>',
  example: '.omniedit change background to beach sunset',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 30,
  energi: 2,
  isEnabled: true,
}

/* ══════════════ ambil website + apikey (satu sumber dgn YouTube) ══════════════ */
function loadApi() {
  return skylineCreds()
}

/* ══════════════ helper ══════════════ */
function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}

function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function bufferToDataUrl(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function extractImageBuffer(message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload || !payload.mimetype || !String(payload.mimetype).startsWith('image/')) return null
    const stream = await downloadMediaMessage(message)
    const buf = await streamToBuffer(stream)
    if (!buf?.length) return null
    if (buf.length > MAX_IMAGE) throw new Error('gambar kegedean (maks 10MB)')
    return { buf, mime: payload.mimetype }
  } catch (e) {
    logger.warn('[OmniEdit] ambil gambar gagal: ' + String(e.message || e).slice(0, 140))
    return null
  }
}

async function downloadAsBuffer(url) {
  const { data, headers } = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 })
  const buf = Buffer.from(data)
  if (!buf.length) throw new Error('gambar dari URL kosong')
  if (buf.length > MAX_IMAGE) throw new Error('gambar dari URL kegedean (maks 10MB)')
  return { buf, mime: String(headers?.['content-type'] || 'image/jpeg').split(';')[0] || 'image/jpeg' }
}

const HELP = (p) =>
  '🖼️ *OMNI EDITOR*\n\n' +
  'Edit gambar pake AI! Ganti background, style, outfit, dll.\n\n' +
  '*Cara pakai:*\n' +
  `> ${p}omniedit <prompt> — sambil reply/quote gambar\n` +
  `> ${p}omniedit <url> | <prompt>\n\n` +
  '*Contoh:*\n' +
  `> ${p}omniedit change background to beach sunset\n` +
  `> https://...jpg | make it oil painting`

async function handler(ctx) {
  const { website, apikey } = loadApi()
  const p = ctx.prefix || '.'

  if (!apikey) {
    return ctx.reply(
      '⚠️ *API KEY ANDA BELUM ADA*\n\n' +
        'Fitur Omni Editor belum bisa dipakai karena API key belum diisi.\n\n' +
        `> Silahkan buat API key anda di *${website}*\n\n` +
        '*Cara isi:*\n' +
        `> \`config.js\` → blok \`api.skyline.apikey\`\n` +
        `> atau set env \`SKYLINE_API_KEY\``
    )
  }

  let text = (ctx.text || '').trim()
  let urlImage = null

  // mode ".omniedit <url> | <prompt>"
  const pipe = text.indexOf('|')
  if (pipe !== -1) {
    const before = text.slice(0, pipe).trim()
    if (/^https?:\/\//i.test(before)) {
      urlImage = before
      text = text.slice(pipe + 1).trim()
    }
  }

  const event = getEvent(ctx)
  const rawMessage = event?.message ?? event
  const ctxInfo = getContextInfo(rawMessage)
  const quoted = ctxInfo?.quotedMessage ?? null

  // sumber gambar: URL eksplisit > balasan/quote > foto ikut command
  let source = null
  if (urlImage) {
    source = { url: urlImage }
  } else {
    source = (await extractImageBuffer(quoted)) || (await extractImageBuffer(rawMessage))
    if (!source?.buf) source = null
  }

  if (!source) return ctx.reply(HELP(p))
  if (!text) return ctx.reply(`❌ Tulis prompt editingnya! Contoh: \`${p}omniedit change background to beach sunset\``)

  await ctx.react('⏳')
  await ctx.reply('⏳ *Omni Editor* — Lagi ngolah gambar, tunggu sebentar ya...')

  try {
    let dataUrl
    if (source.url) {
      const got = await downloadAsBuffer(source.url)
      dataUrl = bufferToDataUrl(got.buf, got.mime || 'image/jpeg')
    } else {
      dataUrl = bufferToDataUrl(source.buf, source.mime || 'image/jpeg')
    }

    // Satu pintu dengan fitur Skyline lain: gerbang anti-limit + retry.
    const out = await omniEdit({ image: dataUrl, prompt: text })

    await ctx.react('🎨')
    return ctx.client.message.send(
      ctx.chat,
      {
        type: 'image',
        media: out.buffer,
        mimetype: out.mimetype || 'image/jpeg',
        caption: `🎨 *Omni Editor — Selesai!*\n\n📝 *Prompt:* ${text}`
      },
      { quote: event }
    )
  } catch (e) {
    const msg = String(e?.message || e)
    logger.warn({ err: msg.slice(0, 300) }, '[OmniEdit] gagal')
    await ctx.react('❎')

    if (e?.code === 'ECONNABORTED' || /timeout|kelamaan/i.test(msg)) {
      return ctx.reply('⏱️ Timeout — server Omni Editor terlalu lama merespons. Coba lagi nanti.')
    }
    return ctx.reply('❌ Gagal ngolah gambar: ' + msg.slice(0, 160))
  }
}

export { pluginConfig as config, handler }
