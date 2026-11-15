/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * pap.js — "kirim foto" sesuai permintaan: base dicari di Pinterest, terus
 * dieksekusi Omni Editor biar cocok sama konteks obrolan.
 *
 * Dipakai 2 jalur:
 *   • manual : `.pap selfie pake baju merah di kafe`
 *   • Ella2  : user minta foto → model nulis `[[RUN: pap <deskripsi>]]`
 *
 * Alur: JHPin(query) → unduh base → omniEdit(base, sesuai permintaan) → kirim.
 * Kalau Omni gagal, foto base tetap dikirim (biar ga kosong) + catatan jujur.
 */
import axios from 'axios'
import { JHPin } from '../../scraper/PINSEARCH.js'
import { omniEdit, skylineCreds } from '../../scraper/SKYLINE.js'
import { logger } from '../../core/logger.js'

const MAX_IMAGE = 10 * 1024 * 1024

const pluginConfig = {
  name: 'pap',
  alias: ['genpap', 'fotoai'],
  category: 'ai',
  description: 'Kirim foto sesuai permintaan — base dari Pinterest, disesuaikan AI (Omni)',
  usage: '.pap <deskripsi foto>',
  example: '.pap selfie pake baju merah di kafe',
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

const HELP =
  '📷 *PAP — foto sesuai permintaah*\n\n' +
  'Cari base foto di Pinterest → AI sesuaikan sama permintaanmu → dikirim balik.\n\n' +
  '*Cara pakai:*\n' +
  '> `.pap <deskripsi foto>`\n\n' +
  '*Contoh:*\n' +
  '> `.pap selfie pake baju merah di kafe`\n' +
  '> `.pap foto estetik sunset di pantai`'

/** Instruksi edit ke Omni — biar hasilnya "menyesuaikan permintaan". */
const editPrompt = (req) =>
  `Edit this photo to match the request: "${req}". ` +
  'Keep it looking like a natural, realistic photo with good quality — ' +
  'only change what the request asks for.'

/** Cari base foto di Pinterest → URL pertama dari hasil teratas. */
async function findBase(query) {
  const r = await JHPin(query, 10)
  const imgs = r?.data?.images || []
  if (!r?.status || !imgs.length) return ''
  // Acak dari 5 teratas — biar hasilnya gak itu-itu terus.
  const pool = imgs.slice(0, 5)
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Unduh URL → data URL (batas 10MB, mime dari response). */
async function toDataUrl(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000, validateStatus: () => true })
  const buf = Buffer.from(res.data || [])
  if (!buf.length) throw new Error('base foto kosong')
  if (buf.length > MAX_IMAGE) throw new Error('base foto kegedean')
  const mime = String(res.headers?.['content-type'] || '').split(';')[0]
  return {
    buf,
    dataUrl: `data:${mime.startsWith('image/') ? mime : 'image/jpeg'};base64,${buf.toString('base64')}`,
  }
}

async function sendImage(ctx, buf, mimetype, caption, event) {
  return ctx.client.message.send(
    ctx.chat,
    { type: 'image', media: buf, mimetype, caption: caption || '' },
    { quote: event }
  )
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const query = String(ctx.text || '').trim().slice(0, 200)
  if (!query) return ctx.reply(HELP)
  if (!skylineCreds().apikey) return ctx.reply('⚠️ API key belum diisi — fitur foto AI lagi mati.')

  const event = ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
  await ctx.react?.('⏳')

  // 1) base dari Pinterest
  let pinUrl = ''
  try {
    pinUrl = await findBase(query)
  } catch (e) {
    logger.warn({ err: String(e?.message || e).slice(0, 140) }, '[Pap] cari base gagal')
  }
  if (!pinUrl) {
    await ctx.react?.('❎')
    return ctx.reply('😵 Foto base-nya gagal dicari — coba ganti kata kunci ya.')
  }

  // 2) unduh base
  let base = null
  try {
    base = await toDataUrl(pinUrl)
  } catch (e) {
    logger.warn({ err: String(e?.message || e).slice(0, 140) }, '[Pap] unduh base gagal')
    await ctx.react?.('❎')
    return ctx.reply('📥 Base foto gagal diunduh — coba lagi sebentar lagi ya.')
  }

  // 3) eksekusi Omni — sesuaikan sama permintaan
  try {
    const out = await omniEdit({ image: base.dataUrl, prompt: editPrompt(query) })
    await ctx.react?.('🎨')
    logger.info({ query: query.slice(0, 80), kb: Math.round(out.buffer.length / 1024) }, '[Pap] foto jadi')
    return await sendImage(ctx, out.buffer, out.mimetype || 'image/jpeg', '', event)
  } catch (e) {
    // Omni gagal → kirim base apa adanya, jujur bilang belum diedit.
    logger.warn({ err: String(e?.message || e).slice(0, 160) }, '[Pap] Omni gagal — kirim base apa adanya')
    await ctx.react?.('⚠️')
    return await sendImage(
      ctx,
      base.buf,
      'image/jpeg',
      '⚠️ AI-nya lagi sial, ini foto base-nya dulu ya.',
      event
    )
  }
}

export { pluginConfig as config, handler }
