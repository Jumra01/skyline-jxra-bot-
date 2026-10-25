/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * menu.js — Menu utama: greeting + box bot/user info + daftar menu,
 * list kategori single_select + tombol nativeFlow (quick_reply/cta_url).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import config from '../../config.js'
import { listFeatures } from '../loader.js'
import { totalUsers, getBalance } from '../../core/database.js'
import { getCharacter } from '../../core/rpg.js'
import { richList, interactiveSendOptions } from '../../lib/richMessage.js'
import { logger } from '../../core/logger.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { getGlobal } from '../../core/groupSettings.js'

let VERSION = ''
try {
  VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? ''
} catch {}

const CATEGORY_EMOJI = {
  general: '📌',
  group: '👥',
  downloader: '📥',
  media: '🎨',
  sticker: '🧸',
  ai: '🤖',
  tools: '🛠️',
  search: '🔎',
  primbon: '🔮',
  game: '🎲',
  rpg: '🧭',
  interactive: '🕹️',
  owner: '👑'
}

const CATEGORY_INFO = {
  general: 'Informasi & Utilitas Dasar',
  downloader: 'Downloader berbagai media',
  interactive: 'Demo Tombol & List',
  owner: 'Khusus Owner Bot',
  sticker: 'Stiker & Konversi Media',
  tools: 'Peralatan',
  search: 'Pencarian informasi',
  primbon: 'Ramalan & tafsir primbon',
  media: 'Olah Media',
  ai: 'Kecerdasan Buatan',
  group: 'Manajemen Grup',
  game: 'Game Santai Grup',
  rpg: 'Petualangan Nusantara Wilds'
}

const CATEGORY_ORDER = [
  'general', 'group', 'downloader', 'media', 'sticker',
  'ai', 'tools', 'search', 'primbon', 'game', 'rpg', 'interactive', 'owner', 'other'
]

/* ═══════════ Text transform (small-caps & mono-bold) ═══════════ */

const SMALL_CAPS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ',
  i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ',
  q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x',
  y: 'ʏ', z: 'ᴢ'
}

const MONO_BOLD = {
  A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛',
  I: '𝗜', J: '𝗝', K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣',
  Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧', U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫',
  Y: '𝗬', Z: '𝗭'
}

const toSmallCaps = (text) =>
  String(text).toLowerCase().split('').map((c) => SMALL_CAPS[c] ?? c).join('')

const toMonoUpperBold = (text) =>
  String(text).toUpperCase().split('').map((c) => MONO_BOLD[c] ?? c).join('')

function getTimeGreeting() {
  const h = new Date().getHours()
  if (h < 4) return 'Selamat Malam 🌙'
  if (h < 11) return 'Selamat Pagi 🌅'
  if (h < 15) return 'Selamat Siang ☀️'
  if (h < 19) return 'Selamat Sore 🌇'
  return 'Selamat Malam 🌙'
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  return parts.join(' ') || '0m'
}

function fieldLine(emoji, label, value) {
  const pad = toSmallCaps(label).padEnd(11)
  return `${emoji} ${pad}: ${value}`
}

function bracketBox(title, lines, emoji = '🤖') {
  const out = [`╭─〔 ${emoji} \`${toSmallCaps(title)}\` 〕─⬣`]
  for (const line of lines) out.push(`│ ✦ *${line}*`)
  out.push('╰─⬣')
  return out.join('\n')
}

function legendBox() {
  return [
    '╭─〔 ⚖️ `ᴋᴇᴛᴀʀᴀɴɢᴀɴ` 〕─⬣',
    '│ ✦ *Ⓞ — Owner  •  Ⓐ — Admin*',
    '╰─⬣'
  ].join('\n')
}

/* ═══════════ Registry & label ═══════════ */

function regroup() {
  const grouped = {}
  for (const f of listFeatures()) {
    const tag = f.tags || 'other'
    ;(grouped[tag] ??= []).push(f)
  }
  return grouped
}

function orderedEntries(grouped) {
  return Object.entries(grouped).sort(([a], [b]) => {
    const ia = CATEGORY_ORDER.indexOf(a)
    const ib = CATEGORY_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}

function emojiOf(tag) {
  return CATEGORY_EMOJI[tag] || '📁'
}

function label(tag) {
  return `${emojiOf(tag)} ${tag.charAt(0).toUpperCase()}${tag.slice(1)}`
}

function permSym(f) {
  if (f.owner) return ' Ⓞ'
  if (f.admin) return ' Ⓐ'
  return ''
}

function hint() {
  const p = config.mainPrefix
  return [
    `💡 Buka kategori: *${p}menu <kategori>* — mis. *${p}menu rpg*`,
    `📜 Semua fitur: *${p}menu all*`
  ].join('\n')
}

/* ═══════════ Tampilan ═══════════ */

function greeting(ctx) {
  return [
    `${getTimeGreeting()}, *${ctx.pushName || 'User'}* 🪸`,
    `Aku ${config.botName}, bot WhatsApp yang siap bantu kamu.`,
    `Kamu bisa pakai aku buat cari info, ambil data, atau bantu hal-hal sederhana langsung lewat WhatsApp — praktis tanpa ribet.`
  ].join('\n')
}

function botInfoBox() {
  const ownerName = config.owner?.name ??
    config.staff?.find((s) => s.role === 'owner')?.label ?? '-'
  return bracketBox('BOT INFO', [
    fieldLine('🖐', 'nama', config.botName),
    fieldLine('🔑', 'versi', VERSION ? `v${VERSION}` : '-'),
    fieldLine('🧶', 'prefix', `[ ${config.mainPrefix} ]`),
    fieldLine('⏱', 'uptime', fmtUptime(process.uptime() * 1000)),
    fieldLine('👥', 'total', `${totalUsers()} Users`),
    fieldLine('👑', 'owner', ownerName)
  ], '🤖')
}

function userInfoBox(ctx) {
  const bal = getBalance(ctx.sender)
  const char = getCharacter(ctx.sender)
  const role = ctx.isStaff ? ctx.role.charAt(0).toUpperCase() + ctx.role.slice(1) : 'User'
  const roleEmoji = ctx.isOwner ? '👑' : ctx.isAdmin ? '🛡️' : '👤'
  const level = char?.level ?? Math.floor((bal.xp || 0) / 20000) + 1
  const now = new Date()
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  return bracketBox('USER INFO', [
    fieldLine('🙋', 'nama', ctx.pushName || 'User'),
    fieldLine('🎭', 'role', `${roleEmoji} ${role}${ctx.staffLabel ? ` • ${ctx.staffLabel}` : ''}`),
    fieldLine('⚡', 'level', level),
    fieldLine('✨', 'exp', (bal.xp ?? 0).toLocaleString('id-ID')),
    fieldLine('🟩', 'emerald', `${bal.emerald ?? 0}/${Math.max(1, Number(config.emerald?.max) || 64)}`),
    fieldLine('💰', 'koin', (bal.gold ?? 0).toLocaleString('id-ID')),
    fieldLine('💎', 'gems', (bal.gems ?? 0).toLocaleString('id-ID')),
    fieldLine('🕒', 'waktu', `${timeStr} WIB`),
    fieldLine('📅', 'tanggal', dateStr)
  ], '👤')
}

function categoryListLines(grouped) {
  const p = config.mainPrefix
  const lines = ['📂 *ᴅᴀꜰᴛᴀʀ ᴍᴇɴᴜ*']
  for (const [tag] of orderedEntries(grouped)) {
    lines.push(`- \`◦\` ${toSmallCaps(`${p}menu ${tag}`)} ${emojiOf(tag)}`)
  }
  return lines.join('\n')
}

function overviewText(ctx, grouped) {
  return [
    greeting(ctx),
    '',
    botInfoBox(),
    '',
    userInfoBox(ctx),
    '',
    categoryListLines(grouped),
    '',
    hint()
  ].join('\n')
}

function categoryBlock(tag, list, p, withInfo) {
  const lines = [`╭─☰ ${toMonoUpperBold(tag)}`]
  if (withInfo) lines.push(`│ _${CATEGORY_INFO[tag] || ''}_`)
  for (const f of list) lines.push(`┃ *${p}${f.name}*${permSym(f)}`)
  lines.push('╰─⬣')
  return lines.join('\n')
}

function categoryText(ctx, tag, grouped) {
  const p = config.mainPrefix
  const list = grouped[tag] ?? []
  return [
    legendBox(),
    '',
    categoryBlock(tag, list, p, true),
    '',
    `Total: ${list.length} commands`,
    '',
    `📜 *${p}menu all* • 🔙 *${p}menu* — kembali`
  ].join('\n')
}

function allText(ctx, grouped) {
  const p = config.mainPrefix
  const blocks = []
  let total = 0
  for (const [tag, list] of orderedEntries(grouped)) {
    total += list.length
    blocks.push(categoryBlock(tag, list, p, false))
  }
  return [
    legendBox(),
    '',
    blocks.join('\n\n'),
    '',
    `Total: ${total} commands`,
    '',
    hint()
  ].join('\n')
}

/* ═══════════ Kirim kartu ═══════════ */

// Thumbnail header menu — base path tanpa ekstensi.
// Auto-detect: file .mp4/.gif (video) ATAU foto (.jpg/.png/.webp) — mana yang
// ada & paling baru dimodifikasi itulah yang dipakai.
const THUMB_MENU = 'assets/thumb/menu'
const THUMB_ALL = 'assets/thumb/allmenu'
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.3gp', '.mkv']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const GIF_EXT = '.gif'
const MAX_VIDEO_MB = 15 // batas upload media WhatsApp ~16MB

function absPath(rel) {
  return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel)
}

/** Cari file thumb mana yang ada (video/gif/foto, terbaru menang) */
function findThumb(base) {
  const candidates = [...VIDEO_EXTS, GIF_EXT, ...IMAGE_EXTS].map((e) => base + e)
  let best = null
  for (const rel of candidates) {
    try {
      const st = fs.statSync(absPath(rel))
      if (!best || st.mtimeMs > best.mtimeMs) best = { rel, mtimeMs: st.mtimeMs }
    } catch {}
  }
  return best?.rel ?? null
}

/** ffprobe: dimensi/durasi/codec video (auto-detect) */
function probeVideo(p) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
     'stream=codec_name,width,height:format=duration', '-of', 'json', p],
    { encoding: 'utf8', timeout: 15000 }
  )
  const j = JSON.parse(r.stdout || '{}')
  const s = j.streams?.[0] || {}
  const dur = s.duration ?? j.format?.duration
  return {
    codec: s.codec_name || '',
    width: Number(s.width) || 1080,
    height: Number(s.height) || 1080,
    seconds: Math.max(1, Math.round(Number(dur) || 5))
  }
}

/** Ambil 1 frame video → jpegThumbnail (preview sebelum play) */
function videoThumbFrame(p) {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-ss', '0.5', '-i', p, '-frames:v', '1',
     '-vf', 'scale=min(320\\,iw):min(320\\,ih):force_original_aspect_ratio=decrease',
     '-q:v', '6', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'],
    { maxBuffer: 8 << 20, timeout: 20000 }
  )
  return r.status === 0 && r.stdout?.length ? Buffer.from(r.stdout) : undefined
}

/** Transcode ke mp4 h264 (720p cap, tanpa upscale) biar pasti bisa diputar */
function transcodeMp4(p) {
  const out = path.join(os.tmpdir(), `zapo-thumb-${process.pid}-${Date.now()}.mp4`)
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', p, '-t', '60',
     '-vf', 'scale=min(1280\\,iw):min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '26',
     '-movflags', '+faststart', out],
    { timeout: 120000 }
  )
  if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size === 0) {
    throw new Error(r.stderr?.toString().slice(0, 200) || 'transcode ffmpeg gagal')
  }
  return out
}

function baseMediaFields(media) {
  return {
    url: media.url,
    directPath: media.directPath,
    mediaKey: media.mediaKey,
    fileSha256: media.fileSha256,
    fileEncSha256: media.fileEncSha256,
    fileLength: media.fileLength,
    mediaKeyTimestamp: media.mediaKeyTimestamp
  }
}

/**
 * Upload thumb ke CDN WhatsApp → descriptor header interactive message
 * (media nempel di atas body pesan).
 *
 * Foto: auto rasio & orientasi (EXIF rotate), resize max 1024px tanpa crop 1:1.
 * Video/GIF: auto-detect codec — mp4 h264 yang udah aman diupload mentah,
 * selain itu ditranscode ke mp4 h264 (max 720p/60s); gif diupload apa adanya
 * dengan gifPlayback. Return null kalau gak ada file / gagal → fallback kartu.
 */
async function uploadHeaderMedia(client, relPath) {
  try {
    if (!relPath) return null
    const p = absPath(relPath)
    if (!fs.existsSync(p)) return null
    const ext = path.extname(p).toLowerCase()

    if (ext === GIF_EXT || VIDEO_EXTS.includes(ext)) {
      const isGif = ext === GIF_EXT
      let meta = probeVideo(p)
      let uploadBuf = fs.readFileSync(p)
      let mimetype = isGif ? 'image/gif' : ext === '.webm' ? 'video/webm' : 'video/mp4'

      if (!isGif) {
        const rawOk =
          ext === '.mp4' && meta.codec === 'h264' &&
          meta.width % 2 === 0 && meta.height % 2 === 0 &&
          uploadBuf.length <= MAX_VIDEO_MB * 1024 * 1024
        if (!rawOk) {
          const tmp = transcodeMp4(p)
          try {
            uploadBuf = fs.readFileSync(tmp)
            meta = probeVideo(tmp)
            mimetype = 'video/mp4'
          } finally {
            fs.unlink(tmp, () => {})
          }
        }
        if (uploadBuf.length > MAX_VIDEO_MB * 1024 * 1024 * 0.95) {
          logger.warn({ file: relPath, size: uploadBuf.length }, '⚠️ Video thumb melebihi batas upload')
          return null
        }
      }

      const type = isGif ? 'gif' : 'video'
      const media = await client.message.upload(uploadBuf, { type, mimetype })
      const frame = videoThumbFrame(p)
      return {
        kind: 'videoMessage',
        ...baseMediaFields(media),
        mimetype,
        width: meta.width,
        height: meta.height,
        seconds: meta.seconds,
        ...(isGif ? { gifPlayback: true } : {}),
        ...(frame ? { jpegThumbnail: frame } : {})
      }
    }

    // Foto — rasio auto-detect (EXIF rotate), tanpa crop 1:1
    const sharp = (await import('sharp')).default
    const buf = await sharp(p)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    const out = await sharp(buf).metadata()
    const media = await client.message.upload(buf, { type: 'image', mimetype: 'image/jpeg' })
    return {
      kind: 'imageMessage',
      ...baseMediaFields(media),
      mimetype: 'image/jpeg',
      width: out.width ?? 1024,
      height: out.height ?? 1024
    }
  } catch (err) {
    logger.warn({ err: err.message, file: relPath }, '⚠️ Gagal upload header thumb menu')
    return null
  }
}

function footer() {
  return `Pilih tombol dibawah • Made with ♡ by ${config.botName}`
}

async function sendHome(ctx) {
  const grouped = regroup()
  const rows = orderedEntries(grouped).map(([tag, list]) => ({
    id: `menu:cat:${tag}`,
    title: label(tag),
    description: `${CATEGORY_INFO[tag] || ''} • ${list.length} fitur`
  }))

  const extraButtons = [{ id: 'menu:all', text: '📜 Semua Fitur' }]
  if (config.reactChannel?.enabled && config.reactChannel?.dedicatedChannelUrl) {
    extraButtons.push({ url: config.reactChannel.dedicatedChannelUrl, text: '📱 Channel' })
  }

  // Header media — foto ATAU video auto-detect.
  // JANGAN fallback ke kartu externalAdReply: bikin pesan hilang di WA biasa.
  const headerImage = await uploadHeaderMedia(ctx.client, findThumb(THUMB_MENU))

  await ctx.client.message.send(
    ctx.chat,
    richList({
      text: overviewText(ctx, grouped),
      footer: footer(),
      title: `📂 ${config.botName} • Kategori`,
      buttonText: 'Pilih Kategori',
      sections: [{ title: `${rows.length} kategori`, rows }],
      extraButtons,
      headerImage
    }),
    interactiveSendOptions(ctx.chat)
  )
}

async function sendCategory(ctx, tag) {
  // Header media kategori — pakai thumb menu utama (foto/video auto-detect)
  const headerImage = await uploadHeaderMedia(ctx.client, findThumb(THUMB_MENU))
  await ctx.replyButtons({
    text: categoryText(ctx, tag, regroup()),
    footer: footer(),
    buttons: [
      { id: 'menu:home', text: '🔙 Menu Utama' },
      { id: 'menu:all', text: '📜 Semua Fitur' }
    ],
    headerImage
  })
}

async function sendAll(ctx) {
  const headerImage = await uploadHeaderMedia(ctx.client, findThumb(THUMB_ALL))

  await ctx.replyButtons({
    text: allText(ctx, regroup()),
    footer: footer(),
    buttons: [{ id: 'menu:home', text: '🔙 Menu Utama' }],
    headerImage
  })
}

/* ═══════════ Handler tombol ═══════════ */

function ensureHandlers() {
  onRichReply('menu:home', (c) => sendHome(c))
  onRichReply('menu:all', (c) => sendAll(c))
  const tags = new Set([...Object.keys(CATEGORY_EMOJI), ...Object.keys(regroup())])
  for (const tag of tags) {
    onRichReply(`menu:cat:${tag}`, (c) => sendCategory(c, tag))
  }
}

// Registrasi pas load — tombol lama tetap kebaca walau .menu belum dipanggil
ensureHandlers()

const pluginConfig = {
  name: "menu",
  alias: ['help', 'cmd'],
  category: "general",
  description: "Menu: box info + daftar menu, list kategori + tombol",
  usage: ".menu",
  example: ".menu",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
  energi: 0,
};

function getMenuVariant() {
  return Number(getGlobal('menuVariant') || config.ui?.menuVariant || 2)
}

// Varian yang butuh render khusus (selain v2 standar)
async function sendHomeVariant(ctx, v) {
  const grouped = regroup()
  const text = overviewText(ctx, grouped)
  const rows = orderedEntries(grouped).map(([tag, list]) => ({
    id: `menu:cat:${tag}`,
    title: label(tag),
    description: `${CATEGORY_INFO[tag] || ''} • ${list.length} fitur`
  }))
  const extraButtons = [{ id: 'menu:all', text: '📜 Semua Fitur' }]
  if (config.reactChannel?.enabled && config.reactChannel?.dedicatedChannelUrl) {
    extraButtons.push({ url: config.reactChannel.dedicatedChannelUrl, text: '📱 Channel' })
  }
  const headerImage = await uploadHeaderMedia(ctx.client, findThumb(THUMB_MENU))

  switch (v) {
    case 1:
      // Simple: teks biasa tanpa kartu interaktif
      await ctx.reply(text)
      return
    case 3:
    case 6:
      // Document: kirim thumbnail menu sebagai dokumen + caption menu
      {
        let docBuf = null
        try { docBuf = fs.readFileSync(absPath(THUMB_MENU + '.jpg')) } catch {}
        await ctx.client.message.send(ctx.chat, {
          type: 'document', media: docBuf || Buffer.from(''),
          mimetype: 'image/jpeg', fileName: `${config.botName}-menu.jpg`,
          caption: text
        }, interactiveSendOptions(ctx.chat))
      }
      return
    case 4:
      // Video Interactive: richButtons dengan header video + tombol saluran/kategori
      await ctx.client.message.send(ctx.chat, richButtons({
        text,
        footer: footer(),
        buttons: [
          { id: 'menu:all', text: '📜 Semua Fitur' },
          ...(config.reactChannel?.dedicatedChannelUrl
            ? [{ url: config.reactChannel.dedicatedChannelUrl, text: '📱 Channel' }]
            : []),
          { id: 'menu:home', text: '🏠 Menu Utama' }
        ],
        headerImage
      }), interactiveSendOptions(ctx.chat))
      return
    case 5:
      // Button: richButtons (tombol quick_reply, tanpa single_select list)
      await ctx.client.message.send(ctx.chat, richButtons({
        text,
        footer: footer(),
        buttons: [
          { id: 'menu:all', text: '📜 Semua Fitur' },
          { id: 'menu:home', text: '🏠 Menu Utama' },
          ...(config.reactChannel?.dedicatedChannelUrl
            ? [{ url: config.reactChannel.dedicatedChannelUrl, text: '📱 Channel' }]
            : [])
        ],
        headerImage
      }), interactiveSendOptions(ctx.chat))
      return
    case 7:
      // Carousel: zapo mendukung carouselMessage (HSCROLL_CARDS)
      {
        const cards = orderedEntries(grouped).slice(0, 10).map(([tag, list]) => ({
          body: { text: `${emojiOf(tag)} ${tag.toUpperCase()}\n${list.slice(0, 5).map((f) => `• ${config.mainPrefix}${f.name}`).join('\n')}${list.length > 5 ? `\n... +${list.length - 5}` : ''}` },
          footer: { text: `${list.length} fitur` },
          nativeFlowMessage: {
            messageVersion: 1,
            buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '📂 Buka', id: `menu:cat:${tag}` }) }]
          }
        }))
        await ctx.client.message.send(ctx.chat, {
          viewOnceMessage: {
            message: {
              messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
              interactiveMessage: {
                body: { text },
                footer: { text: footer() },
                carouselMessage: {
                  cards,
                  messageVersion: 1,
                  carouselCardType: 1
                }
              }
            }
          }
        }, interactiveSendOptions(ctx.chat))
      }
      return
    case 8:
      // Minimalist: teks ringkas (12 baris pertama)
      await ctx.reply(text.split('\n').slice(0, 12).join('\n'))
      return
    case 9:
      // NativeFlow: richButtons dengan select kategori + tombol owner/saluran
      await ctx.client.message.send(ctx.chat, richButtons({
        text,
        footer: footer(),
        buttons: [
          {
            // single_select kategori disisipkan via nativeFlow manual
            id: 'menu:home',
            text: '📂 Kategori'
          },
          { id: 'menu:all', text: '📜 Semua Fitur' },
          ...(config.reactChannel?.dedicatedChannelUrl
            ? [{ url: config.reactChannel.dedicatedChannelUrl, text: '📱 Channel' }]
            : [])
        ],
        headerImage
      }), interactiveSendOptions(ctx.chat))
      return
    case 10:
      // Product Catalog: fallback richButtons (productMessage tidak tersedia di zapo)
      await ctx.client.message.send(ctx.chat, richButtons({
        text,
        footer: footer(),
        buttons: [
          { id: 'menu:all', text: '📜 Semua Fitur' },
          { id: 'menu:home', text: '🏠 Menu Utama' }
        ],
        headerImage
      }), interactiveSendOptions(ctx.chat))
      return
    case 11:
      // Fake location header: nama bot + durasi aktif + nama user
      const v11Bot = config.botName || 'skyline-JXRA'
      const v11Uptime = fmtUptime(process.uptime() * 1000)
      const v11User = ctx.pushName || 'Owner'
      // Header: pin lokasi palsu dengan label bot, durasi, user
      await ctx.client.message.send(ctx.chat, {
        type: 'location',
        degreesLatitude: -6.2088,
        degreesLongitude: 106.8456,
        name: `${v11Bot} · Aktif ±${v11Uptime}`,
        address: `User: ${v11User}`
      }, interactiveSendOptions(ctx.chat))
      // Body: daftar kategori menu (teks + tombol)
      const grouped = regroup()
      const v11Rows = orderedEntries(grouped).map(([tag, list]) => ({
        id: `menu:cat:${tag}`,
        title: label(tag),
        description: `${CATEGORY_INFO[tag] || ''} • ${list.length} fitur`
      }))
      const v11Extra = [{ id: 'menu:all', text: '📜 Semua Fitur' }]
      if (config.reactChannel?.enabled && config.reactChannel?.dedicatedChannelUrl) {
        v11Extra.push({ url: config.reactChannel.dedicatedChannelUrl, text: '📱 Channel' })
      }
      await ctx.client.message.send(ctx.chat, richList({
        text: overviewText(ctx, grouped),
        footer: footer(),
        title: `📂 ${v11Bot} • Kategori`,
        buttonText: 'Pilih Kategori',
        sections: [{ title: `${v11Rows.length} kategori`, rows: v11Rows }],
        extraButtons: v11Extra,
        headerImage: null
      }), interactiveSendOptions(ctx.chat))
      return
    default:
      return sendHome(ctx)
  }
}

async function handler(ctx) {
    ensureHandlers()
    const sub = (ctx.args[0] ?? '').toLowerCase()

    if (sub === 'all') return sendAll(ctx)
    if (sub === 'button' || sub === 'btn') return sendHome(ctx)

    if (sub) {
      const grouped = regroup()
      if (!grouped[sub]) {
        await ctx.reply(
          `❌ Kategori "${sub}" gak ada.\nKategori: ${orderedEntries(grouped).map(([t]) => t).join(', ')}`
        )
        return
      }
      return sendCategory(ctx, sub)
    }

    const v = getMenuVariant()
    if (v === 2) return sendHome(ctx)
    return sendHomeVariant(ctx, v)
  }

export { pluginConfig as config, handler };
