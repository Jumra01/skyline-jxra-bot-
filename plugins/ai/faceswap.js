/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * faceswap.js — Face Swap AI
 */
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import { faceSwap } from '../../scraper/FACESWAP.js'

const MAX_BUF = 10 * 1024 * 1024
const SESSION_TTL = 5 * 60 * 1000
const SESSION_CAP = 10
const MEM = (globalThis.JH_FACESWAP_MEM ??= new Map())

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

async function extractImageBuffer(message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload || !payload.mimetype || !String(payload.mimetype).startsWith('image/')) return null
    const stream = await downloadMediaMessage(message)
    const buf = await streamToBuffer(stream)
    return buf?.length ? buf : null
  } catch (e) {
    console.log('[FaceSwap] extract image gagal:', String(e.message || e).slice(0, 120))
    return null
  }
}

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function getSession(sender) {
  const s = MEM.get(sender)
  if (!s) return null
  if (Date.now() - s.ts > SESSION_TTL) {
    MEM.delete(sender)
    return null
  }
  return s
}

function setSession(sender, buf) {
  if (MEM.size >= SESSION_CAP) {
    const oldest = MEM.keys().next().value
    MEM.delete(oldest)
  }
  MEM.set(sender, { buf, ts: Date.now() })
}

async function processSwap(ctx, target, swap) {
  await ctx.react('⏳')

  let resultUrl
  try {
    const res = await faceSwap({ target, swap })
    resultUrl = res.resultUrl
  } catch (e) {
    console.log('[FaceSwap] engine error:', String(e.message || e).slice(0, 300))
    await ctx.react('❎')
    return ctx.reply('❌ Gagal proses Face Swap. Coba lagi dengan foto wajah yang jelas (close-up, tidak tertutup).')
  }

  try {
    const res = await fetch(resultUrl, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error('fetch hasil HTTP ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_BUF) throw new Error('hasil invalid/kegedean')

    await ctx.client.message.send(ctx.chat, {
      type: 'image',
      media: buf,
      mimetype: detectMime(buf),
      caption: 'Ini dia hasil Face Swap-nya, Kak!'
    })
    await ctx.react('✅')
  } catch (e) {
    console.log('[FaceSwap] send error:', String(e.message || e).slice(0, 200))
    await ctx.react('❎')
    return ctx.reply('❌ Gagal kirim hasil Face Swap.')
  }
}

const HELP =
  '🎭 *FACE SWAP — AI*\n\n' +
  '*Mode 2 langkah:*\n' +
  '1) Reply/kirim foto + `.faceswap` → foto 1 tersimpan\n' +
  '2) Kirim/reply foto kedua + `.faceswap` → hasil!\n\n' +
  '*Mode sekali tembak:*\n' +
  '• Reply foto + kirim foto caption `.faceswap`\n' +
  '• Reply foto + `.faceswap <url>`\n' +
  '• Kirim foto caption `.faceswap <url>`\n' +
  '• `.faceswap <url1> <url2>`\n\n' +
  '`.faceswap reset` → buang foto 1 tersimpan\n' +
  'Tips: foto wajah close-up & tidak tertutup biar hasil maksimal.'

const pluginConfig = {
  name: "faceswap",
  alias: ['swap', 'fs'],
  category: "ai",
  description: "Face Swap AI — tukar wajah dua foto (mode sesi & one-shot)",
  usage: ".faceswap",
  example: ".faceswap",
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
    const text = (ctx.text || '').trim()
    const firstWord = (text.split(/\s+/)[0] || '').toLowerCase()

    if (/^(reset|del|hapus|cancel|batal)$/.test(firstWord)) {
      MEM.delete(ctx.sender)
      return ctx.reply('🗑️ Session Face Swap dibuang.')
    }

    const urls = (text.match(/https?:\/\/[^\s]+/gi) || []).slice(0, 2)

    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const ctxInfo = getContextInfo(rawMessage)
    const quoted = ctxInfo?.quotedMessage ?? null

    const quotedBuf = await extractImageBuffer(quoted)
    const attachedBuf = await extractImageBuffer(rawMessage)

    const sourcesNow = []
    if (quotedBuf) sourcesNow.push(quotedBuf)
    if (attachedBuf) sourcesNow.push(attachedBuf)
    for (const u of urls) sourcesNow.push(u)

    if (sourcesNow.length >= 2) {
      MEM.delete(ctx.sender)
      return processSwap(ctx, sourcesNow[0], sourcesNow[1])
    }

    if (sourcesNow.length === 1) {
      const saved = getSession(ctx.sender)
      if (saved) {
        MEM.delete(ctx.sender)
        return processSwap(ctx, saved.buf, sourcesNow[0])
      }
      setSession(ctx.sender, sourcesNow[0])
      return ctx.reply(
        '✅ Foto pertama sukses terupload.\n' +
        'Silahkan upload foto kedua untuk memulai proses Face Swap.\n\n' +
        'Kirim foto kedua caption `.faceswap` (atau reply foto kedua dengan `.faceswap`).\n' +
        '⏳ Foto pertama berlaku 5 menit • `.faceswap reset` buat batal.'
      )
    }

    const saved = getSession(ctx.sender)
    if (saved) {
      return ctx.reply(
        '⏳ Foto pertama kamu masih tersimpan.\n' +
        'Kirim foto kedua caption `.faceswap` untuk mulai proses.\n' +
        '`.faceswap reset` buat buang foto pertama.'
      )
    }
    return ctx.reply(HELP)
  }

export { pluginConfig as config, handler };
