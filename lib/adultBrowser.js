/**
 * © skyline-JXRA
 * adultBrowser.js — UI tombol "browser" untuk katalog XVideos/XNXX.
 *
 * Semua data diambil dari endpoint resmi skyline.web.id lewat
 * scraper/SKYLINE.js (adultBrowse). File ini TIDAK fetch situs sumber, tidak
 * menyimpan API key, dan tidak menambah rate limit lokal — kuota dihitung di
 * sisi web seperti fitur lain.
 *
 * Alur tombol:
 *   home → pilih situs → menu → cari/kategori/best/fresh/verified/dashboard
 *        → hasil (number + prev/next) → detail (link + tag) → back/home.
 * Input bebas (kata kunci, slug kategori, URL) diambil lewat message hook,
 * jadi user tetap bisa "ngetik di address bar" tanpa prefix command.
 */
import sharp from 'sharp'
import config from '../config.js'
import { logger } from '../core/logger.js'
import { addMessageHook } from '../core/liveHooks.js'
import { onRichReply } from '../handlers/messageHandler.js'
import { adultBrowse, keyHint } from '../scraper/SKYLINE.js'

const SESSION_TTL = 15 * 60 * 1000
const INPUT_TTL = 5 * 60 * 1000
const PAGE_SIZE = 10
const MAX_HISTORY = 10
const SITE_LABEL = { xvideos: 'XVideos', xnxx: 'XNXX' }
const ACTION_LABEL = {
  search: 'Pencarian',
  best: 'Terbaik',
  fresh: 'Terbaru',
  verified: 'Terverifikasi',
  dashboard: 'Dashboard',
  category: 'Kategori',
  detail: 'Detail'
}

const SESSIONS = new Map()
const PENDING = new Map()
const REGISTERED = new Set()

const SUFFIXES = [
  'home', 'menu', 'help', 'site-xv', 'site-xn',
  'search', 'category', 'detail-url', 'filter',
  'best', 'fresh', 'verified', 'dashboard',
  'prev', 'next', 'back', 'links', ...
  Array.from({ length: PAGE_SIZE }, (_, i) => `pick${i}`),
  ...Array.from({ length: 5 }, (_, i) => `tag${i}`)
]

const cut = (value, max = 60) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const keyFor = (ctx) => String(ctx?.senderNumber || ctx?.sender || 'anon')

function id(ctx, suffix) {
  return `adlb:${ctx.senderNumber}:${suffix}`
}

function trimSessions() {
  const now = Date.now()
  for (const [key, session] of SESSIONS) {
    if (now - session.updatedAt > SESSION_TTL) SESSIONS.delete(key)
    if (now - (PENDING.get(key)?.at || 0) > INPUT_TTL) PENDING.delete(key)
  }
  while (SESSIONS.size > 500) SESSIONS.delete(SESSIONS.keys().next().value)
}

function registerButtons(ctx, key) {
  for (const suffix of SUFFIXES) {
    const buttonId = id(ctx, suffix)
    if (REGISTERED.has(buttonId)) continue
    REGISTERED.add(buttonId)
    onRichReply(buttonId, async (c2) => {
      const session = SESSIONS.get(key)
      if (!session) return c2.reply('Sesi browser habis. Ketik command lagi ya.')
      if (session.chat !== c2.chat) return c2.reply('Buka tombol ini di chat tempat kamu mulai pencarian.')
      session.updatedAt = Date.now()
      await handleButton(c2, session, suffix)
    })
  }
}

function freshSession(ctx, site) {
  return {
    site,
    chat: ctx.chat,
    view: 'home',
    action: '',
    query: '',
    category: '',
    detailUrl: '',
    filters: {},
    page: 1,
    pages: [],
    videos: [],
    visible: [],
    detail: null,
    history: [],
    updatedAt: Date.now()
  }
}

function getSession(ctx, site) {
  trimSessions()
  const key = keyFor(ctx)
  let session = SESSIONS.get(key)
  if (!session || session.site !== site || session.chat !== ctx.chat) {
    session = freshSession(ctx, site)
  }
  session.updatedAt = Date.now()
  SESSIONS.set(key, session)
  registerButtons(ctx, key)
  return { key, session }
}

function snapshot(session) {
  return {
    view: session.view,
    action: session.action,
    query: session.query,
    category: session.category,
    detailUrl: session.detailUrl,
    filters: { ...session.filters },
    page: session.page,
    pages: [...session.pages],
    videos: [...session.videos],
    visible: [...session.visible],
    detail: session.detail
  }
}

function pushHistory(session) {
  session.history.unshift(snapshot(session))
  session.history.length = Math.min(session.history.length, MAX_HISTORY)
}

function restore(session) {
  const prev = session.history.shift()
  if (!prev) return false
  Object.assign(session, prev, {
    filters: { ...prev.filters },
    pages: [...prev.pages],
    videos: [...prev.videos],
    visible: [...prev.visible],
    detail: prev.detail
  })
  return true
}

async function headerImage(ctx, url) {
  if (!url || typeof ctx.client?.message?.upload !== 'function') return null
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*,*/*' },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow'
    })
    if (!res.ok || !/^image\//i.test(res.headers.get('content-type') || '')) return null
    const raw = Buffer.from(await res.arrayBuffer())
    if (!raw.length || raw.length > 3 * 1024 * 1024) return null
    const buffer = await sharp(raw)
      .rotate()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer()
    const meta = await sharp(buffer).metadata()
    const media = await ctx.client.message.upload(buffer, { type: 'image', mimetype: 'image/jpeg' })
    return {
      kind: 'imageMessage',
      url: media.url,
      directPath: media.directPath,
      mediaKey: media.mediaKey,
      fileEncSha256: media.fileEncSha256,
      fileSha256: media.fileSha256,
      fileLength: media.fileLength || buffer.length,
      mimetype: 'image/jpeg',
      width: meta.width || 600,
      height: meta.height || 600
    }
  } catch (err) {
    logger.debug(`[Adult] header thumb dilewati (${err?.message || err})`)
    return null
  }
}

function isPrefixText(text) {
  const prefixes = config.prefixes || [config.mainPrefix || '.']
  return prefixes.some((p) => p && String(text).startsWith(p))
}

/** Halaman berikutnya + batas tampilan. API XVideos menyisipkan page `1001`
 * di ujung array; jangan dipakai sebagai total saat masih ada blok 1..21. */
function pageInfo(session) {
  const pages = session.pages
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p >= 1)
    .sort((a, b) => a - b)
  const next = pages.find((p) => p > session.page) ??
    (session.videos.length >= PAGE_SIZE ? session.page + 1 : null)
  let shownMax = pages[0] ?? session.page
  for (const p of pages) {
    if (p > shownMax + 1) break
    shownMax = p
  }
  return { next, shownMax: Math.max(shownMax, session.page) }
}

async function askInput(ctx, session, kind, text) {
  PENDING.set(keyFor(ctx), { kind, chat: ctx.chat, site: session.site, at: Date.now() })
  await ctx.reply(text)
}

function errorText(err) {
  switch (err?.code) {
    case 'NO_API_KEY':
      return null // pakai keyHint(ctx) — butuh ctx
    case 'hourly_limit':
    case 'total_limit':
      return '⏳ Kuota API Skyline habis untuk jam ini. Coba lagi nanti.'
    case 'invalid_query':
      return '🔍 Kata kunci minimal 2 karakter.'
    case 'invalid_category':
      return '🏷️ Slug kategori tidak valid. Contoh: `AI-239`.'
    case 'invalid_url':
      return '🔗 URL tidak valid. Paste link video yang lengkap (http/https).'
    case 'xvideos_unavailable':
    case 'xnxx_unavailable':
      return '🛠️ Sumber data sedang tidak tersedia. Coba beberapa saat lagi.'
    case 'auth_required':
      return '⚠️ API key Skyline belum terbaca di bot.'
    default:
      return `❌ Gagal memuat data: ${err?.message || 'gangguan sementara'}`
  }
}

async function sendError(ctx, err) {
  logger.error({ err: String(err?.message || err), code: err?.code || '', status: err?.status || 0 }, '[Adult] request gagal')
  if (err?.code === 'NO_API_KEY') return ctx.reply(keyHint(ctx))
  await ctx.reply(errorText(err))
}

/* ── Renderer ── */

async function renderHome(ctx, session) {
  session.view = 'home'
  await ctx.replyButtons({
    text:
      '🔞 *CATALOG 18+*\n\n' +
      'Pilih situs, lalu pakai tombol seperti browser: cari judul/genre, buka kategori, ' +
      'lihat hasil, lalu pilih video buat detail & link.\n\n' +
      '_Semua lewat API Skyline — kuota tetap dihitung._',
    footer: `${config.botName} • Adult Browser`,
    buttons: [
      { id: id(ctx, 'site-xv'), text: '▶️ XVideos' },
      { id: id(ctx, 'site-xn'), text: '▶️ XNXX' },
      { id: id(ctx, 'help'), text: 'ℹ️ Cara pakai' }
    ]
  })
}

async function renderMenu(ctx, session) {
  session.view = 'menu'
  const xv = session.site === 'xvideos'
  const label = SITE_LABEL[session.site]
  const rows = [
    {
      title: '🔎 Cari judul / genre',
      description: 'Ketik kata kunci apa pun',
      id: id(ctx, 'search')
    },
    {
      title: '🔗 Buka URL video',
      description: 'Detail dari link langsung',
      id: id(ctx, 'detail-url')
    }
  ]

  if (xv) {
    rows.push(
      { title: '🏷️ Kategori / genre', description: 'Slug kategori, mis. AI-239', id: id(ctx, 'category') },
      { title: '🔥 Best', description: 'Urut berdasarkan tahun/bulan', id: id(ctx, 'best') },
      { title: '🆕 Fresh', description: 'Video terbaru', id: id(ctx, 'fresh') },
      { title: '✅ Verified', description: 'Model terverifikasi', id: id(ctx, 'verified') },
      { title: '📊 Dashboard', description: 'Katalog utama', id: id(ctx, 'dashboard') },
      { title: '⚙️ Filter pencarian', description: 'sort/durf/datef/quality', id: id(ctx, 'filter') }
    )
  }

  const text =
    `🌐 *${label.toUpperCase()} • BERANDA*\n\n` +
    `Pilih menu di bawah. Tombol **Cari** menerima judul, genre, nama model, atau kata kunci lain.\n` +
    (session.query ? `• Query terakhir: *${cut(session.query, 40)}*\n` : '') +
    (session.category ? `• Kategori terakhir: \`${cut(session.category, 30)}\`\n` : '') +
    (Object.keys(session.filters).length
      ? `• Filter: \`${cut(JSON.stringify(session.filters), 60)}\`\n`
      : '')

  await ctx.replyList({
    text,
    title: `Menu ${label}`,
    buttonText: 'Buka Menu',
    sections: [{ title: `Menu ${label}`, rows }],
    extraButtons: [
      { id: id(ctx, 'home'), text: '🏠 Ganti Situs' },
      { id: id(ctx, 'help'), text: 'ℹ️ Bantuan' }
    ],
    footer: `${config.botName} • 18+ • ${label}`
  })
}

async function renderResults(ctx, session) {
  session.view = 'results'
  const start = (session.page - 1) * PAGE_SIZE
  session.visible = session.videos.slice(start, start + PAGE_SIZE)
  if (!session.visible.length) {
    session.view = 'menu'
    await ctx.reply('📭 Tidak ada hasil. Coba kata kunci lain atau tombol menu.')
    return renderMenu(ctx, session)
  }

  const label = SITE_LABEL[session.site]
  const { next, shownMax } = pageInfo(session)

  let text = `🔎 *${label.toUpperCase()} • ${ACTION_LABEL[session.action] || 'HASIL'}*\n\n`
  if (session.query) text += `• Kata kunci: *${cut(session.query, 48)}*\n`
  if (session.category) text += `• Kategori: \`${cut(session.category, 32)}\`\n`
  text += `• Halaman: *${session.page}*${session.pages.length ? `/${shownMax}` : ''}\n`
  text += `• Hasil: *${session.videos.length}* video\n\n`
  text += `_Pilih nomor untuk detail. Tombol ◀/▶ buat navigasi halaman._`

  const rows = session.visible.map((video, i) => {
    const meta = [
      video.duration,
      video.views ? `${Intl.NumberFormat('id-ID').format(video.views)} views` : '',
      video.profile ? cut(video.profile, 18) : ''
    ].filter(Boolean).join(' • ')
    return {
      title: `${start + i + 1}. ${cut(video.title, 38)}`,
      description: meta || 'Buka detail & link media',
      id: id(ctx, `pick${i}`)
    }
  })

  const extraButtons = []
  if (session.page > 1) extraButtons.push({ id: id(ctx, 'prev'), text: '◀ Prev' })
  if (next) extraButtons.push({ id: id(ctx, 'next'), text: 'Next ▶' })
  extraButtons.push({ id: id(ctx, 'back'), text: '◀ Menu' })

  await ctx.replyList({
    text,
    title: `${label} • Hasil`,
    buttonText: 'Pilih Video',
    sections: [{ title: `Halaman ${session.page}`, rows }],
    extraButtons,
    headerImage: await headerImage(ctx, session.visible[0]?.thumbnail),
    footer: `${config.botName} • 18+ • ${label}`
  })
}

function mediaLinks(detail) {
  const files = detail?.files || {}
  const urls = [
    detail?.dlink,
    files.HLS,
    files.high,
    files.low,
    detail?.contentUrl,
    detail?.url
  ]
  const seen = new Set()
  return urls
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .filter((u) => !seen.has(u) && seen.add(u))
}

async function renderDetail(ctx, session) {
  session.view = 'detail'
  const d = session.detail || {}
  const links = mediaLinks(d)
  const tags = Array.isArray(d.tags) ? d.tags.filter(Boolean).slice(0, 5) : []
  const categories = Array.isArray(d.categories) ? d.categories.filter(Boolean).slice(0, 6) : []

  let text = `🎬 *${cut(d.title || 'Detail Video', 90)}*\n\n`
  text += `• Situs: ${SITE_LABEL[session.site]}\n`
  if (d.videoId) text += `• ID: \`${cut(d.videoId, 30)}\`\n`
  const rawDuration = String(d.duration || d.durationSeconds || '').trim()
  if (rawDuration) {
    text += `• Durasi: ${cut(rawDuration, 20)}${/^\d+$/.test(rawDuration) ? ' detik' : ''}\n`
  }
  if (d.views != null || d.watchCount != null) {
    text += `• Views: ${Intl.NumberFormat('id-ID').format(Number(d.views ?? d.watchCount) || 0)}\n`
  }
  if (d.uploadDate) text += `• Upload: ${cut(d.uploadDate, 30)}\n`
  if (categories.length) text += `• Kategori: ${categories.map((c) => cut(c, 24)).join(', ')}\n`
  if (tags.length) text += `• Tag: ${tags.map((t) => cut(t, 24)).join(', ')}\n`
  if (d.description) text += `\n📝 ${cut(d.description, 280)}\n`
  text += `\n${links.length ? `🔗 ${links.length} link media tersedia. Tekan **📋 Semua Link** buat pilih.` : '⚠️ Link media tidak dikembalikan sumber.'}`

  const rows = tags.map((tag, i) => ({
    title: `🏷️ ${cut(tag, 36)}`,
    description: 'Cari video dengan tag ini',
    id: id(ctx, `tag${i}`)
  }))
  rows.push({
    title: '📋 Semua link media',
    description: 'Tonton / copy link langsung',
    id: id(ctx, 'links')
  })
  rows.push({
    title: '◀ Kembali ke hasil',
    description: 'Balik ke daftar video',
    id: id(ctx, 'back')
  })
  rows.push({
    title: '🏠 Beranda',
    description: 'Ganti situs / menu utama',
    id: id(ctx, 'home')
  })

  const extraButtons = []
  const source = d.url || session.detailUrl
  if (/^https?:\/\//i.test(String(source || ''))) {
    extraButtons.push({ text: '🌐 Buka di Web', url: String(source) })
  }
  if (links[0]) extraButtons.push({ text: '📋 Copy Link', copy: links[0] })

  await ctx.replyList({
    text,
    title: 'Detail Video',
    buttonText: 'Menu Detail',
    sections: [{ title: 'Aksi', rows }],
    extraButtons,
    headerImage: await headerImage(ctx, d.thumbnail || d.thumbnailUrl || d.thumbnailUrls?.[0]),
    footer: `${config.botName} • 18+ • ${SITE_LABEL[session.site]}`
  })
}

async function renderLinks(ctx, session) {
  session.view = 'links'
  const links = mediaLinks(session.detail || {})
  if (!links.length) {
    await ctx.reply('📭 Link media tidak tersedia untuk video ini.')
    return renderDetail(ctx, session)
  }
  const body = links.map((link, i) => `${i + 1}. ${link}`).join('\n')
  const buttons = links.slice(0, 3).map((link, i) => ({
    text: `📋 Copy Link ${i + 1}`,
    copy: link
  }))
  buttons.push({ id: id(ctx, 'back'), text: '◀ Detail' })
  await ctx.replyButtons({
    text: `🔗 *LINK MEDIA*\n\n${body}\n\n_Copy lewat tombol, atau buka link di browser HP._`,
    footer: `${config.botName} • 18+ • ${SITE_LABEL[session.site]}`,
    buttons
  })
}

async function renderHelp(ctx, session) {
  const p = config.mainPrefix || '.'
  const site = session?.site === 'xnxx' ? 'xnxx' : 'xvideo'
  await ctx.reply(
    `ℹ️ *ADULT BROWSER 18+*\n\n` +
    `• \`${p}${site} <judul/genre>\` — langsung cari\n` +
    `• \`${p}${site} kategori <slug>\` — conto \`AI-239\`\n` +
    `• \`${p}${site} detail <url>\` — buka link video\n` +
    `• \`${p}${site} best|fresh|verified|dashboard\` (XVideos)\n\n` +
    `Tombol **Cari / Kategori / URL** bakal minta kamu ngetik tanpa prefix. ` +
    `Ketik \`batal\` buat keluar. Pilih nomor hasil → detail → link media.\n\n` +
    `_Tombol ◀ Menu dan 🏠 Beranda selalu tersedia._`
  )
}

async function render(ctx, session) {
  switch (session.view) {
    case 'menu': return renderMenu(ctx, session)
    case 'results': return renderResults(ctx, session)
    case 'detail': return renderDetail(ctx, session)
    case 'links': return renderLinks(ctx, session)
    case 'help': return renderHelp(ctx, session)
    default: return renderHome(ctx, session)
  }
}

/* ── Aksi API ── */

async function run(ctx, session, action, params, view) {
  await ctx.react('⏳')
  try {
    const data = await adultBrowse(session.site, { action, ...params })
    if (action === 'detail') {
      session.detail = data.detail
      session.detailUrl = params.url || session.detailUrl
      session.view = 'detail'
    } else {
      session.videos = data.videos
      session.pages = data.pagination.pages
      session.page = data.pagination.page || 1
      session.visible = []
      session.detail = null
      session.action = action
      session.view = view || 'results'
    }
    session.updatedAt = Date.now()
    await ctx.react('✅')
    await render(ctx, session)
  } catch (err) {
    await ctx.react('❌')
    await sendError(ctx, err)
  }
}

function slugOf(text) {
  const cleaned = String(text || '').trim()
  const fromUrl = cleaned.match(/\/c\/([^/?#]+)/i)
  return (fromUrl?.[1] || cleaned).replace(/^#/, '')
}

function parseFilters(text) {
  const out = {}
  const allowed = new Set(['sort', 'durf', 'datef', 'quality', 'year', 'month'])
  for (const part of String(text || '').split(/[\s&]+/)) {
    const [key, ...rest] = part.split('=')
    const value = rest.join('=').trim()
    if (allowed.has(key.toLowerCase()) && value) out[key.toLowerCase()] = value.slice(0, 40)
  }
  return out
}

async function handleInput(ctx, session, kind, text) {
  const body = String(text || '').trim()

  if (kind === 'search') {
    if (body.length < 2) return ctx.reply('🔍 Kata kunci minimal 2 karakter.')
    pushHistory(session)
    session.query = body
    session.category = ''
    session.filters = {}
    return run(ctx, session, 'search', { q: body, page: 1, filters: session.filters })
  }

  if (kind === 'category') {
    const slug = slugOf(body)
    if (!slug) return ctx.reply('🏷️ Slug kategori kosong. Contoh: `AI-239`.')
    pushHistory(session)
    session.category = slug
    session.query = ''
    return run(ctx, session, 'category', { category: slug, page: 1 })
  }

  if (kind === 'detail') {
    const url = body.replace(/^<|>$/g, '')
    if (!/^https?:\/\//i.test(url)) return ctx.reply('🔗 URL harus diawali http:// atau https://')
    pushHistory(session)
    return run(ctx, session, 'detail', { url })
  }

  if (kind === 'filter') {
    const filters = parseFilters(body)
    if (!Object.keys(filters).length) {
      return ctx.reply('⚙️ Format: `sort=relevance durf=quality datef=week quality=hd`. Kosongkan untuk batal.')
    }
    session.filters = filters
    await ctx.reply(`⚙️ Filter disimpan: \`${cut(JSON.stringify(filters), 100)}\``)
    if (session.action === 'search' && session.query) {
      pushHistory(session)
      return run(ctx, session, 'search', { q: session.query, page: 1, filters })
    }
    return renderMenu(ctx, session)
  }

  if (kind === 'best') {
    const [year, month] = body.split(/\s+/)
    pushHistory(session)
    session.filters = { year: year || '', month: month || '' }
    return run(ctx, session, 'best', { page: 1, filters: session.filters })
  }
}

async function handleButton(ctx, session, suffix) {
  switch (suffix) {
    case 'home':
      session.history = []
      session.view = 'home'
      return renderHome(ctx, session)

    case 'menu':
      session.view = 'menu'
      return renderMenu(ctx, session)

    case 'help':
      return renderHelp(ctx, session)

    case 'site-xv':
      if (session.site !== 'xvideos') Object.assign(session, freshSession(ctx, 'xvideos'))
      session.view = 'menu'
      return renderMenu(ctx, session)

    case 'site-xn':
      if (session.site !== 'xnxx') Object.assign(session, freshSession(ctx, 'xnxx'))
      session.view = 'menu'
      return renderMenu(ctx, session)

    case 'search':
      return askInput(
        ctx,
        session,
        'search',
        `🔎 *CARI ${SITE_LABEL[session.site]}*\n\nKetik judul, genre, nama model, atau kata kunci lain (tanpa prefix).\nContoh: \`${config.mainPrefix || '.'}xvideo\` lalu kirim: \`big tits blonde\`.`
      )

    case 'category':
      return askInput(
        ctx,
        session,
        'category',
        '🏷️ *KATEGORI / GENRE*\n\nKirim slug kategori XVideos. Contoh: `AI-239` atau link `https://www.xvideos.com/c/AI-239`.\nKetik `batal` untuk kembali.'
      )

    case 'detail-url':
      return askInput(
        ctx,
        session,
        'detail',
        '🔗 *DETAIL DARI URL*\n\nKirim link video xvideos.com atau xnxx.com (http/https).\nKetik `batal` untuk kembali.'
      )

    case 'filter':
      return askInput(
        ctx,
        session,
        'filter',
        '⚙️ *FILTER PENCARIAN*\n\nKirim pasangan `key=value`, misal:\n`sort=relevance durf=quality datef=week quality=hd`\n\nKunci tersedia: sort, durf, datef, quality, year, month.'
      )

    case 'best':
      return askInput(ctx, session, 'best', '🔥 *BEST*\n\nKirim tahun lalu bulan, misal `2026 11` (bulan opsional).')

    case 'fresh':
      pushHistory(session)
      return run(ctx, session, 'fresh', { page: 1 })

    case 'verified':
      pushHistory(session)
      return run(ctx, session, 'verified', { page: 1 })

    case 'dashboard':
      pushHistory(session)
      return run(ctx, session, 'dashboard', { page: 1 })

    case 'prev':
      if (session.page <= 1) return ctx.reply('Sudah di halaman pertama.')
      pushHistory(session)
      session.page -= 1
      session.videos = []
      return run(ctx, session, session.action || 'search', {
        ...(session.query ? { q: session.query } : {}),
        ...(session.category ? { category: session.category } : {}),
        ...(Object.keys(session.filters).length ? { filters: session.filters } : {}),
        page: session.page
      })

    case 'next': {
      const target = pageInfo(session).next ?? session.page + 1
      pushHistory(session)
      session.page = target
      session.videos = []
      return run(ctx, session, session.action || 'search', {
        ...(session.query ? { q: session.query } : {}),
        ...(session.category ? { category: session.category } : {}),
        ...(Object.keys(session.filters).length ? { filters: session.filters } : {}),
        page: target
      })
    }

    case 'back':
      if (!restore(session)) return renderMenu(ctx, session)
      return render(ctx, session)

    case 'links':
      if (session.view === 'links') {
        if (!restore(session)) return renderDetail(ctx, session)
        return render(ctx, session)
      }
      pushHistory(session)
      return renderLinks(ctx, session)

    case 'pick0':
    case 'pick1':
    case 'pick2':
    case 'pick3':
    case 'pick4':
    case 'pick5':
    case 'pick6':
    case 'pick7':
    case 'pick8':
    case 'pick9': {
      const index = Number(suffix.slice(4))
      const video = session.visible?.[index]
      if (!video) return ctx.reply('Hasil sudah kedaluwarsa. Cari lagi ya.')
      pushHistory(session)
      session.detail = null
      session.detailUrl = video.url
      return run(ctx, session, 'detail', { url: video.url })
    }

    case 'tag0':
    case 'tag1':
    case 'tag2':
    case 'tag3':
    case 'tag4': {
      const index = Number(suffix.slice(3))
      const tag = Array.isArray(session.detail?.tags) ? session.detail.tags[index] : null
      if (!tag) return ctx.reply('Tag sudah tidak tersedia.')
      pushHistory(session)
      session.query = String(tag)
      session.category = ''
      session.filters = {}
      return run(ctx, session, 'search', { q: String(tag), page: 1 })
    }

    default:
      return renderMenu(ctx, session)
  }
}

/* Input bebas: kata kunci / slug / URL, tanpa prefix command. */
let hookInstalled = false
if (!hookInstalled) {
  hookInstalled = true
  addMessageHook('adult-browser-input', async (ctx) => {
    const key = keyFor(ctx)
    const pending = PENDING.get(key)
    if (!pending || pending.chat !== ctx.chat) return

    const body = String(ctx.body || '').trim()
    if (Date.now() - pending.at > INPUT_TTL) {
      PENDING.delete(key)
      return
    }
    if (isPrefixText(body)) {
      PENDING.delete(key)
      return
    }
    if (!body) return

    PENDING.delete(key)
    if (/^(batal|cancel|xa)$/i.test(body)) {
      await ctx.reply('Dibatalkan.')
      return
    }

    const session = SESSIONS.get(key)
    if (!session || session.site !== pending.site) {
      await ctx.reply('Sesi browser habis. Ketik command lagi ya.')
      return
    }
    try {
      await handleInput(ctx, session, pending.kind, body)
    } catch (err) {
      logger.error({ err: String(err?.message || err) }, '[Adult] input handler gagal')
      await sendError(ctx, err)
    }
  })
}

/**
 * Buka browser tombol dari plugin command.
 * @param {'xvideos'|'xnxx'} site
 */
export async function openAdultBrowser(ctx, site, text = '') {
  const { session } = getSession(ctx, site)
  const raw = String(text || '').trim()

  if (!raw) {
    session.view = 'home'
    await renderHome(ctx, session)
    return
  }

  const [first, ...rest] = raw.split(/\s+/)
  const sub = first.toLowerCase()
  const arg = rest.join(' ').trim()

  if (sub === 'bantuan' || sub === 'help') return renderHelp(ctx, session)
  if (sub === 'menu' || sub === 'beranda' || sub === 'home') {
    session.view = 'menu'
    return renderMenu(ctx, session)
  }

  if (['cari', 'search'].includes(sub) && arg) {
    session.query = arg
    return run(ctx, session, 'search', { q: arg, page: 1 })
  }
  if (['kategori', 'category', 'genre', 'cat'].includes(sub) && arg) {
    if (site !== 'xvideos') return ctx.reply('🏷️ Kategori hanya tersedia di XVideos.')
    session.category = slugOf(arg)
    return run(ctx, session, 'category', { category: session.category, page: 1 })
  }
  if (['detail', 'url', 'link'].includes(sub) && arg) {
    return run(ctx, session, 'detail', { url: arg })
  }
  if (['best', 'fresh', 'verified', 'dashboard'].includes(sub)) {
    if (site !== 'xvideos') return ctx.reply(`⚠️ Menu ${sub} hanya tersedia di XVideos.`)
    return run(ctx, session, sub, { page: 1 })
  }
  if (sub === 'filter' && site !== 'xvideos') {
    return ctx.reply('⚙️ Filter pencarian hanya tersedia di XVideos.')
  }

  return run(ctx, session, 'search', { q: raw, page: 1 })
}

export default { openAdultBrowser }
