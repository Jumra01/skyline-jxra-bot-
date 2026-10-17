/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * setthumb.js — Ganti thumbnail header menu lewat balasan foto ATAU video/GIF.
 *
 * Pakai:
 *   .setthumb menu               → balas foto/video/GIF, jadi header .menu (home)
 *   .setthumb allmenu            → balas foto/video/GIF, jadi header .menu all
 *   .setthumb                    → lihat status thumb
 *
 * Tipe media auto-detect — file lama bertipe lain (foto ↔ video) otomatis
 * dihapus biar gak ketimpa dobel-dobel.
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import { downloadMedia } from '../../lib/media.js'

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.3gp', '.mkv']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const GIF_EXT = '.gif'
const ALL_EXTS = [...VIDEO_EXTS, GIF_EXT, ...IMAGE_EXTS]
const MAX_VIDEO_MB = 15 // batas upload media WhatsApp ~16MB

const TARGETS = {
  menu: {
    base: 'assets/thumb/menu',
    label: 'header `.menu` (home)',
    aliases: ['home']
  },
  allmenu: {
    base: 'assets/thumb/allmenu',
    label: 'header `.menu all`',
    aliases: ['all', 'semua']
  }
}

function resolveTarget(arg) {
  const key = String(arg || '').toLowerCase()
  if (TARGETS[key]) return { key, ...TARGETS[key] }
  for (const [k, t] of Object.entries(TARGETS)) {
    if (t.aliases.includes(key)) return { key, ...t }
  }
  return null
}

function abs(rel) {
  return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel)
}

/** File thumb yang ada utk base ini (paling baru menang) — null kalau belum ada */
function findThumbFile(base) {
  let best = null
  for (const ext of ALL_EXTS) {
    const rel = base + ext
    try {
      const st = fs.statSync(abs(rel))
      if (!best || st.mtimeMs > best.mtimeMs) best = { rel, ext, mtimeMs: st.mtimeMs, size: st.size }
    } catch {}
  }
  return best
}

function typeOf(ext) {
  if (ext === GIF_EXT) return { icon: '🎞', name: 'GIF' }
  if (VIDEO_EXTS.includes(ext)) return { icon: '🎬', name: 'video' }
  return { icon: '🖼', name: 'foto' }
}

/** Tentukan ekstensi file dari media yang dibalas (auto-detect tipe) */
function detectExt(media) {
  const mt = (media.mimetype || '').toLowerCase()
  if (media.kind === 'video') {
    if (mt === 'video/webm') return { ext: '.webm', type: typeOf('.webm') }
    return { ext: '.mp4', type: typeOf('.mp4') }
  }
  if (mt === 'image/gif') return { ext: GIF_EXT, type: typeOf(GIF_EXT) }
  if (mt === 'image/png') return { ext: '.png', type: typeOf('.png') }
  if (mt === 'image/webp' || media.kind === 'sticker') return { ext: '.webp', type: typeOf('.webp') }
  return { ext: '.jpg', type: typeOf('.jpg') }
}

function removeOtherVariants(base, keepExt) {
  let removed = 0
  for (const ext of ALL_EXTS) {
    if (ext === keepExt) continue
    try {
      fs.unlinkSync(abs(base + ext))
      removed++
    } catch {}
  }
  return removed
}

function statusText() {
  const p = config.mainPrefix
  const lines = [`⚙️ *THUMB MENU — Status*`, '']
  for (const [key, t] of Object.entries(TARGETS)) {
    const f = findThumbFile(t.base)
    let info = '❌ belum ada (placeholder otomatis)'
    if (f) {
      const { icon, name } = typeOf(f.ext)
      info = `${icon} ${f.rel} — ${name} (${Math.round(f.size / 1024)} KB)`
    }
    lines.push(`${key === 'menu' ? '🖼' : '🗃'} *${t.label}*`)
    lines.push(`   ${info}`)
  }
  lines.push(
    '',
    '*Cara pakai:*',
    `• Balas *foto* dengan \`${p}setthumb menu\` → ganti header .menu`,
    `• Balas *video/GIF* dengan \`${p}setthumb menu\` → jadi header video`,
    `• Balas *foto/video* dengan \`${p}setthumb allmenu\` → ganti header .menu all`,
    '',
    `Media lama langsung diganti (tipe beda → file lama dihapus otomatis). Video maks ${MAX_VIDEO_MB}MB.`
  )
  return lines.join('\n')
}

function help(ctx, target) {
  return (
    `*Ganti ${target.label}:*\n` +
    `Balas *foto*, *video*, atau *GIF* dengan \`${ctx.prefix}setthumb ${target.key}\`\n\n` +
    `Contoh: kirim foto/video dulu → reply media itu dengan perintah di atas.\n` +
    `Tipe media auto-detect (foto/video/GIF); media lama otomatis ditimpa.`
  )
}

const pluginConfig = {
  name: "setthumb",
  alias: ['setmenuthumb'],
  category: "owner",
  description: "Ganti thumbnail header menu (.menu & .menu all) lewat balasan foto/video/GIF",
  usage: ".setthumb",
  example: ".setthumb",
  isOwner: true,
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
    const sub = (ctx.args[0] || '').toLowerCase()

    if (!sub) {
      await ctx.reply(statusText())
      return
    }

    const target = resolveTarget(sub)
    if (!target) {
      await ctx.reply(
        `❌ Target "${sub}" gak ada.\nTarget: ${Object.keys(TARGETS).join(', ')}\n\n${statusText()}`
      )
      return
    }

    const media = await downloadMedia(ctx.client, ctx.event)
    if (media && (media.kind === 'image' || media.kind === 'sticker' || media.kind === 'video')) {
      const { ext, type } = detectExt(media)

      if (media.kind === 'video' && media.buffer.length > MAX_VIDEO_MB * 1024 * 1024) {
        await ctx.reply(
          `⚠️ Video terlalu besar (${Math.round(media.buffer.length / 1024 / 1024)}MB, maks ${MAX_VIDEO_MB}MB).\n` +
          `Kompres/potong dulu videonya, atau balas foto aja.`
        )
        return
      }

      const dest = abs(target.base + ext)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      removeOtherVariants(target.base, ext)
      fs.writeFileSync(dest, media.buffer)
      const kb = Math.round(media.buffer.length / 1024)
      await ctx.react('✅')
      await ctx.reply(
        `✅ ${target.label} diganti — ${type.name} (${kb} KB) tersimpan di \`${target.base + ext}\`.\n` +
        `Langsung kepakai di pesan menu berikutnya${type.name === 'foto' ? '' : ' (autoplay header video)'}.`
      )
      return
    }

    const quoted = ctx.event?.message?.extendedTextMessage?.contextInfo?.quotedMessage
    if (quoted) {
      await ctx.reply('⚠️ Pesan yang dibalas bukan media yang didukung. Balas *foto*, *video*, atau *GIF* ya.')
      return
    }

    await ctx.reply(help(ctx, target))
  }

export { pluginConfig as config, handler };
