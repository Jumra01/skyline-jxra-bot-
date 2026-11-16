/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * pap.js — "kirim foto" sesuai permintaan: ambil SATU foto base dari folder
 * lokal `assets/ella2/` (diisi manual oleh owner), terus dieksekusi Omni Editor
 * biar cocok sama permintaan/obrolan, lalu dikirim.
 *
 *   • manual : `.pap pake baju merah, latar kafe`
 *   • Ella2  : user minta foto → model nulis `[[RUN: pap <permintaan edit>]`
 *
 * Kenapa asset lokal (bukan Pinterest): hasil pin kadang kena sensor/
 * gak nyambung sama maksud — foto base dikontrol penuh dari folder.
 * Folder: `assets/pap/` (jpg/png/webp/gif). Ganti isinya kapan aja, restart
 * bot ga perlu — dibaca tiap request.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { omniEdit, skylineCreds } from '../../scraper/SKYLINE.js'
import { logger } from '../../core/logger.js'

const MAX_IMAGE = 10 * 1024 * 1024

const IMG_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

const pluginConfig = {
  name: 'pap',
  alias: ['genpap', 'fotoai'],
  category: 'ai',
  description: 'Kirim foto (dari folder assets/ella2) yang disesuaikan AI sama permintaan',
  usage: '.pap <permintaan edit foto>',
  example: '.pap pake baju merah, latar kafe',
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
  '📷 *PAP — foto sesuai permintaan*\n\n' +
  'Ambil satu foto dari folder `assets/ella2/` → AI sesuaikan sama permintaanmu → dikirim balik.\n\n' +
  '*Cara pakai:*\n' +
  '> `.pap <permintaan edit>`\n\n' +
  '*Contoh:*\n' +
  '> `.pap pake baju merah, latar kafe`\n' +
  '> `.pap gaya selfie di pantai sore hari`\n\n' +
  '> Isi folder `assets/ella2/` dengan foto-foto base ya.'

/** Instruksi edit ke Omni — biar hasilnya "menyesuaikan permintaan". */
const editPrompt = (req) =>
  `Edit this photo to match the request: "${req}". ` +
  'Keep it looking like a natural, realistic photo with good quality — ' +
  'only change what the request asks for.'

function papDir() {
  return process.env.PAP_DIR
    ? process.env.PAP_DIR
    : fileURLToPath(new URL('../../assets/ella2', import.meta.url))
}

/** Pilih SATU foto base acak dari folder (jpg/png/webp/gif). null kalau kosong. */
function pickBase() {
  let files = []
  try {
    files = fs.readdirSync(papDir())
      .filter((f) => IMG_EXT[path.extname(f.toLowerCase())])
  } catch {
    return null
  }
  if (!files.length) return null
  const name = files[Math.floor(Math.random() * files.length)]
  try {
    const buf = fs.readFileSync(path.join(papDir(), name))
    if (!buf.length || buf.length > MAX_IMAGE) return null
    return { buf, mime: IMG_EXT[path.extname(name.toLowerCase())] || 'image/jpeg' }
  } catch (err) {
    logger.warn({ err: String(err?.message || err).slice(0, 120) }, '[Pap] gagal baca foto base')
    return null
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
  const query = String(ctx.text || '').trim().slice(0, 200)
  if (!query) return ctx.reply(HELP)
  if (!skylineCreds().apikey) return ctx.reply('⚠️ API key belum diisi — fitur foto AI lagi mati.')

  const event = ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null

  // 1) ambil satu foto base dari folder
  const base = pickBase()
  if (!base) {
    await ctx.react?.('📂')
    return ctx.reply(
      '📂 *Belum ada foto base nih*\n\n' +
        'Isi folder `assets/ella2/` dengan foto-foto base dulu ya (jpg/png/webp/gif), terus coba lagi.'
    )
  }
  const dataUrl = `data:${base.mime};base64,${base.buf.toString('base64')}`

  await ctx.react?.('⏳')

  // 2) eksekusi Omni — sesuaikan sama permintaan
  try {
    const out = await omniEdit({ image: dataUrl, prompt: editPrompt(query) })
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
      base.mime,
      '🚫 AI-nya nolak ngolah permintaan ini (kemungkinan kena sensor) — ini foto base-nya ya.',
      event
    )
  }
}

export { pluginConfig as config, handler, papDir }
