/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * nekopoi.js — Client NekoPoi via API Skyline (https://skyline.web.id/api/nekopoi).
 * Kuota & rate limit tetap terhitung di sisi web Skyline.
 * Menggunakan interactive list WhatsApp (ctx.replyList) dengan header poster.
 */

import https from 'node:https'
import axios from 'axios'
import sharp from 'sharp'
import config from '../../config.js'
import { skylineCreds } from '../../scraper/SKYLINE.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { bypassSafelink, isSafelink } from '../../scraper/SAFELINK.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const pluginConfig = {
  name: 'nekopoi',
  alias: [
    'nekosearch',
    'nekocari',
    'nekoinfo',
    'nekoep',
    'nekoepisode',
    'nekodl',
    'nekodownload',
    'nekogenre',
    'nekogenres',
    'nekoschedule',
    'nekojadwal',
    'nekorandom'
  ],
  category: 'search',
  description: 'NekoPoi via Skyline API: rilis terbaru, cari, detail, episode, unduh video, genre, jadwal, random',
  usage: '.nekopoi [cari <judul> | detail <slug> | episode <slug> | download <slug> | genre | jadwal | random]',
  example: '.nekopoi cari so_low',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  energi: 0,
  isEnabled: true
}

const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/* ── Sesi Pengguna untuk Navigasi Cepat Nomor ── */
const USER_SESSIONS = new Map() // sender -> { type, series, episodes, updatedAt }

/* ── DoH Poster Fetcher & Uploader ── */
async function fetchPosterBuffer(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const doh = await fetch(`https://cloudflare-dns.com/dns-query?name=${u.hostname}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(4000)
    }).then((r) => r.json())
    const ip = doh.Answer?.find((a) => a.type === 1)?.data
    if (!ip) return null

    const raw = await new Promise((resolve) => {
      const req = https.request(
        {
          host: ip,
          servername: u.hostname,
          path: u.pathname + u.search,
          headers: { Host: u.hostname, 'User-Agent': UA },
          timeout: 6000
        },
        (res) => {
          if (res.statusCode !== 200) return resolve(null)
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        }
      )
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
      req.end()
    })
    if (!raw) return null

    const buffer = await sharp(raw)
      .rotate()
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    const meta = await sharp(buffer).metadata()
    return { buffer, width: meta.width || 800, height: meta.height || 800 }
  } catch {
    return null
  }
}

async function uploadHeaderThumb(client, url) {
  if (!client?.message?.upload || !url) return null
  try {
    const img = await fetchPosterBuffer(url)
    if (!img) return null
    const media = await client.message.upload(img.buffer, { type: 'image', mimetype: 'image/jpeg' })
    return {
      kind: 'imageMessage',
      url: media.url,
      directPath: media.directPath,
      mediaKey: media.mediaKey,
      fileEncSha256: media.fileEncSha256,
      fileSha256: media.fileSha256,
      fileLength: media.fileLength || img.buffer.length,
      mimetype: 'image/jpeg',
      width: img.width,
      height: img.height
    }
  } catch {
    return null
  }
}

/* ── API Skyline Caller ── */
async function callApi(action, params = {}) {
  const { website, apikey } = skylineCreds()
  if (!apikey) {
    const err = new Error('api_key_missing')
    err.code = 'NO_API_KEY'
    throw err
  }
  const qs = new URLSearchParams({ action, apikey, ...params })
  const res = await axios.get(`${website}/api/nekopoi?${qs.toString()}`, {
    timeout: 45000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  })
  const data = res.data || {}
  if (data.error) {
    const err = new Error(data.error)
    err.code = data.code
    throw err
  }
  return data
}

function errorText(e) {
  switch (e?.code) {
    case 'NO_API_KEY':
      return '⚠️ *API KEY SKYLINE BELUM DIISI*\n\nIsi `api.skyline.apikey` di `config.js` atau env `SKYLINE_API_KEY`.'
    case 'hourly_limit':
    case 'total_limit':
      return '⏳ *Limit API Skyline lagi penuh*\n\nKuota akun untuk jam ini sudah habis. Coba lagi nanti.'
    case 'invalid_query':
      return '🔍 Kata kunci minimal 2 karakter.'
    case 'invalid_slug':
      return '🔗 Slug tidak valid. Gunakan format slug yang benar.'
    case 'not_found':
      return '🔍 Data tidak ditemukan di NekoPoi.'
    case 'nekopoi_unavailable':
      return '🛠️ Server NekoPoi sedang tidak dapat diakses. Coba beberapa saat lagi.'
    default:
      return `❌ Terjadi gangguan: ${e?.message || 'Gagal memuat data'}`
  }
}

/* ── View Renderers Menggunakan ctx.replyList & Thumbnail ── */

async function showLatest(ctx) {
  const p = ctx.prefix || '.'
  const d = await callApi('latest')
  const series = (d.series || []).slice(0, 15)
  const eps = (d.episodes || []).slice(0, 5)

  USER_SESSIONS.set(ctx.sender, {
    type: 'latest',
    series,
    episodes: eps,
    updatedAt: Date.now()
  })

  let text = `🔥 *ɴᴇᴋᴏᴘᴏɪ · ʀɪʟɪs ᴛᴇʀʙᴀʀᴜ*\n\n`
  text += `┌─── 📺 *SERI TERBARU*\n`
  if (series.length) {
    text += series
      .map((s, i) => `│ ${String(i + 1).padStart(2, '0')}. *${cut(s.title, 42)}*`)
      .join('\n')
  } else {
    text += '│ —'
  }
  text += `\n└────────────────\n`

  if (eps.length) {
    text += `\n┌─── 🎬 *EPISODE TERKINI*\n`
    text += eps
      .map((e) => `│ • *${cut(e.title, 38)}*\n│   ↳ \`${p}nekopoi ep ${e.slug}\``)
      .join('\n')
    text += `\n└────────────────\n`
  }

  text += `\n_Pilih seri di tombol list bawah untuk melihat detail & episode lengkap._`

  const rows = series.map((s, i) => {
    const btnId = `nekopoi:${ctx.sender}:pick:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showDetail(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(s.title, 35)}`,
      description: 'Lihat sinopsis & daftar episode',
      id: btnId
    }
  })

  // Opsi judul acak
  const rndId = `nekopoi:${ctx.sender}:random`
  onRichReply(rndId, async (c2) => {
    await doRandom(c2)
  })
  rows.push({
    title: '🎲 Random Seri',
    description: 'Pilih seri hentai secara acak',
    id: rndId
  })

  const headerImage = await uploadHeaderThumb(ctx.client, series[0]?.thumb)

  return ctx.replyList({
    text,
    title: '📚 Katalog NekoPoi',
    buttonText: 'Pilih Seri',
    sections: [{ title: `Daftar Seri (${series.length})`, rows }],
    footer: `Hal ${d.page || 1}/${d.total_pages || 1} • ${config.botName}`,
    headerImage
  })
}

async function showSearch(ctx, query) {
  const p = ctx.prefix || '.'
  const d = await callApi('search', { q: query })
  const results = (d.results || []).slice(0, 15)
  if (!results.length) {
    await ctx.reply(`🔍 Judul *${cut(query, 40)}* tidak ditemukan di NekoPoi.`)
    return
  }

  USER_SESSIONS.set(ctx.sender, {
    type: 'search',
    series: results,
    updatedAt: Date.now()
  })

  let text = `🔍 *ɴᴇᴋᴏᴘᴏɪ · ʜᴀsɪʟ ᴘᴇɴᴄᴀʀɪᴀɴ*\n\n`
  text += `• Kata Kunci: *${cut(query, 40)}*\n`
  text += `• Ditemukan: *${d.results.length}* judul\n\n`
  text += `┌─── 📋 *DAFTAR HASIL*\n`
  text += results
    .map(
      (r, i) =>
        `│ ${String(i + 1).padStart(2, '0')}. *${cut(r.title, 42)}*${r.genres ? `\n│    _${cut(r.genres, 36)}_` : ''}`
    )
    .join('\n')
  text += `\n└────────────────\n\n`
  text += `_Pilih judul dari tombol list bawah untuk melihat detail._`

  const rows = results.map((r, i) => {
    const btnId = `nekopoi:${ctx.sender}:search_pick:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showDetail(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(r.title, 35)}`,
      description: r.genres ? cut(r.genres, 45) : 'Buka informasi seri',
      id: btnId
    }
  })

  const headerImage = await uploadHeaderThumb(ctx.client, results[0]?.thumb)

  return ctx.replyList({
    text,
    title: '🔍 Hasil Pencarian',
    buttonText: 'Pilih Judul',
    sections: [{ title: `Hasil Pencarian (${results.length})`, rows }],
    footer: `${config.botName} • NekoPoi Search`,
    headerImage
  })
}

async function showDetail(ctx, slugOrIndex) {
  const p = ctx.prefix || '.'
  let slug = slugOrIndex

  const num = parseInt(slugOrIndex, 10)
  if (!isNaN(num)) {
    const sess = USER_SESSIONS.get(ctx.sender)
    if (sess?.series && sess.series[num - 1]) {
      slug = sess.series[num - 1].slug
    }
  }

  if (!slug || !slug.startsWith('/')) {
    if (slug && !slug.includes('/')) slug = `/hentai/${slug}`
  }

  const d = await callApi('detail', { slug })
  const info = d.detail || {}
  const eps = (info.episodes || []).slice(0, 25)

  if (!info.title) {
    await ctx.reply('🔍 Detail seri tidak ditemukan atau format slug salah.')
    return
  }

  USER_SESSIONS.set(ctx.sender, {
    type: 'detail',
    seriesSlug: slug,
    episodes: eps,
    updatedAt: Date.now()
  })

  let text = `🎴 *${cut(info.title, 80)}*\n\n`
  text += `┌─── ℹ️ *INFORMASI SERI*\n`
  if (info.jenis) text += `│ • Tipe     : ${cut(info.jenis, 20)}\n`
  if (info.status) text += `│ • Status   : ${cut(info.status, 20)}\n`
  if (info.episode) text += `│ • Episode  : ${info.episode}\n`
  if (info.durasi) text += `│ • Durasi   : ${cut(info.durasi, 20)}\n`
  if (info.skor) text += `│ • Skor     : ⭐ ${cut(info.skor, 10)}\n`
  if (info.tayang) text += `│ • Rilis    : ${cut(info.tayang, 20)}\n`
  if (info.produser) text += `│ • Produser : ${cut(info.produser, 25)}\n`
  text += `└────────────────\n`

  if (info.genres?.length) {
    text += `\n🏷️ *Genre:* ${info.genres.slice(0, 8).map((g) => g.name).join(', ')}\n`
  }

  if (info.synopsis) {
    text += `\n📖 *Sinopsis:*\n_${cut(info.synopsis, 320)}_\n`
  }

  if (eps.length) {
    text += `\n┌─── 🎬 *DAFTAR EPISODE*\n`
    text += eps
      .map((e, i) => `│ ${String(i + 1).padStart(2, '0')}. *${cut(e.episode || e.title, 36)}* (${cut(e.date, 15)})`)
      .join('\n')
    text += `\n└────────────────\n\n`
    text += `_Pilih episode yang ingin ditonton pada menu list di bawah 👇_`
  } else {
    text += `\n💡 Link stream: \`${p}nekopoi ep ${slug}\``
  }

  const rows = eps.map((e, i) => {
    const btnId = `nekopoi:${ctx.sender}:ep:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showEpisode(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(e.episode || e.title, 35)}`,
      description: e.date ? `Rilis: ${cut(e.date, 25)}` : 'Buka stream & download',
      id: btnId
    }
  })

  // Tombol Beranda
  const homeId = `nekopoi:${ctx.sender}:home`
  onRichReply(homeId, async (c2) => {
    await showLatest(c2)
  })
  rows.push({
    title: '🏠 Beranda NekoPoi',
    description: 'Kembali ke katalog rilis terbaru',
    id: homeId
  })

  const headerImage = await uploadHeaderThumb(ctx.client, info.poster || eps[0]?.thumb)

  return ctx.replyList({
    text,
    title: '🎬 Pilih Episode',
    buttonText: 'Daftar Episode',
    sections: [{ title: `Episode Tersedia (${eps.length})`, rows }],
    footer: `${config.botName} • NekoPoi Detail`,
    headerImage
  })
}

async function showEpisode(ctx, slugOrIndex) {
  const p = ctx.prefix || '.'
  let slug = slugOrIndex

  const num = parseInt(slugOrIndex, 10)
  if (!isNaN(num)) {
    const sess = USER_SESSIONS.get(ctx.sender)
    if (sess?.episodes && sess.episodes[num - 1]) {
      slug = sess.episodes[num - 1].slug
    }
  }

  if (!slug) {
    await ctx.reply('Contoh: *.nekopoi ep 1* atau *.nekopoi ep /so_low-episode-4-subtitle-indonesia*')
    return
  }

  const d = await callApi('episode', { slug })

  let text = `🎬 *${cut(d.title, 80)}*\n\n`

  if (d.seriesTitle) {
    text += `📺 Seri: *${cut(d.seriesTitle, 50)}*\n`
    if (d.seriesLink) {
      text += `↳ Kembali ke seri: \`${p}nekopoi detail ${d.seriesLink}\`\n\n`
    } else {
      text += `\n`
    }
  }

  const streams = d.streams || []
  if (streams.length) {
    text += `📡 *Server Stream Langsung (Nonton di Browser):*\n`
    text += streams.map((s, i) => `• *${s.server}*: ${s.url}`).join('\n') + `\n\n`
  }

  const dl = d.downloads || []
  if (dl.length) {
    text += `┌─── ⬇️ *LINK UNDUH VIDEO*\n`
    for (const q of dl) {
      text += `│ *${cut(q.quality, 35)}*\n`
      for (const l of q.links || []) {
        text += `│ • ${l.label}: ${l.url}\n`
      }
      text += `│\n`
    }
    text += `└────────────────\n\n`
    text += `💡 *Nonton / Unduh:* Klik tombol *Tonton Stream* untuk streaming langsung di browser, atau pilih *Pilihan Link Unduh* di menu list.`
  } else {
    text += `_Link unduh belum tersedia untuk episode ini._`
  }

  const rows = []
  if (dl.length) {
    const dlId = `nekopoi:${ctx.sender}:dl:${slug}`
    onRichReply(dlId, async (c2) => {
      await showDownload(c2, slug)
    })
    rows.push({
      title: '⬇️ Pilihan Link Unduh',
      description: 'Dapatkan tautan filehost & info unduhan',
      id: dlId
    })
  }

  if (d.seriesLink) {
    const backId = `nekopoi:${ctx.sender}:back_detail`
    onRichReply(backId, async (c2) => {
      await showDetail(c2, d.seriesLink)
    })
    rows.push({
      title: '📺 Seri Lengkap',
      description: 'Kembali ke detail & episode lain',
      id: backId
    })
  }

  const homeId = `nekopoi:${ctx.sender}:home`
  onRichReply(homeId, async (c2) => {
    await showLatest(c2)
  })
  rows.push({
    title: '🏠 Beranda NekoPoi',
    description: 'Kembali ke rilis terbaru',
    id: homeId
  })

  const extraButtons = []
  if (streams.length && streams[0]?.url) {
    extraButtons.push({ text: `▶️ Tonton Stream (${streams[0].server || 'Server 1'})`, url: streams[0].url })
  }

  const headerImage = await uploadHeaderThumb(ctx.client, d.poster)

  return ctx.replyList({
    text,
    title: '🔗 Navigasi NekoPoi',
    buttonText: 'Menu Navigasi',
    sections: [{ title: 'Pilihan Menu', rows }],
    extraButtons,
    footer: d.seriesTitle ? cut(d.seriesTitle, 40) : `${config.botName} • Stream & DL`,
    headerImage
  })
}

async function showDownload(ctx, slugOrIndex) {
  const p = ctx.prefix || '.'
  let slug = slugOrIndex

  const num = parseInt(slugOrIndex, 10)
  if (!isNaN(num)) {
    const sess = USER_SESSIONS.get(ctx.sender)
    if (sess?.episodes && sess.episodes[num - 1]) {
      slug = sess.episodes[num - 1].slug
    }
  }

  if (!slug) {
    await ctx.reply(`Contoh: *${p}nekopoi dl 1* atau *${p}nekopoi dl /so_low-episode-4-subtitle-indonesia*`)
    return
  }

  const d = await callApi('episode', { slug })
  const dl = d.downloads || []
  const streams = d.streams || []

  if (!dl.length && !streams.length) {
    await ctx.reply('📭 Daftar unduhan / stream tidak tersedia untuk episode ini.')
    return
  }

  let text = `⬇️ *ɴᴇᴋᴏᴘᴏɪ · sᴛʀᴇᴀᴍ & ᴜɴᴅᴜʜ*\n\n`
  text += `🎬 *${cut(d.title, 80)}*\n\n`

  if (streams.length) {
    text += `📡 *LINK STREAMING LANGSUNG:*\n`
    for (const s of streams) {
      text += `• *${s.server}*: ${s.url}\n`
    }
    text += `↳ _Bisa langsung ditonton di browser tanpa unduh file._\n\n`
  }

  if (dl.length) {
    text += `┌─── 📦 *LINK UNDUHAN (FILEHOST)*\n`
    for (const q of dl.slice(0, 4)) {
      const qTag = (q.quality.match(/\[([^\]]+)\]/) || [])[1] || cut(q.quality, 20)
      text += `│ *Kualitas ${qTag}*\n`
      for (const l of (q.links || []).slice(0, 5)) {
        let finalUrl = l.url
        if (isSafelink(l.url) || /sfl\.gl|linku|safelink|tutwuri/i.test(l.url)) {
          try {
            const res = await bypassSafelink(l.url)
            if (res?.url) finalUrl = res.url
            else if (typeof res === 'string') finalUrl = res
          } catch {}
        }
        text += `│ • ${l.label}: ${finalUrl}\n`
      }
      text += `│\n`
    }
    text += `└────────────────\n\n`
  }

  text += `⚠️ *Catatan Media WhatsApp:*\n`
  text += `_File anime berukuran 80–350MB, melampaui batas transmisi media langsung bot. Gunakan tombol stream untuk menonton online atau klik link filehost di atas untuk mengunduh._`

  const rows = []
  if (d.seriesLink) {
    const backId = `nekopoi:${ctx.sender}:back_detail`
    onRichReply(backId, async (c2) => {
      await showDetail(c2, d.seriesLink)
    })
    rows.push({
      title: '📺 Seri Lengkap',
      description: 'Kembali ke detail seri',
      id: backId
    })
  }

  const homeId = `nekopoi:${ctx.sender}:home`
  onRichReply(homeId, async (c2) => {
    await showLatest(c2)
  })
  rows.push({
    title: '🏠 Beranda NekoPoi',
    description: 'Kembali ke rilis terbaru',
    id: homeId
  })

  const extraButtons = []
  if (streams.length && streams[0]?.url) {
    extraButtons.push({ text: `▶️ Tonton Stream (${streams[0].server || 'Server 1'})`, url: streams[0].url })
  }

  const headerImage = await uploadHeaderThumb(ctx.client, d.poster)

  return ctx.replyList({
    text,
    title: '⬇️ Unduh & Stream',
    buttonText: 'Pilihan Menu',
    sections: [{ title: 'Menu Navigasi', rows }],
    extraButtons,
    footer: `${config.botName} • Stream & Direct Download`,
    headerImage
  })
}

async function showGenres(ctx) {
  const p = ctx.prefix || '.'
  const d = await callApi('genres')
  const genres = d.genres || []
  if (!genres.length) {
    await ctx.reply('🏷️ Daftar genre kosong.')
    return
  }

  const top = genres.slice(0, 25)
  let text = `🏷️ *ᴅᴀғᴛᴀʀ ɢᴇɴʀᴇ ɴᴇᴋᴏᴘᴏɪ*\n\n`
  text += `• Total Tersedia: *${d.count || genres.length}* genre\n`
  text += `• Pilih genre pada menu tombol list di bawah 👇`

  const rows = top.map((g) => {
    const btnId = `nekopoi:${ctx.sender}:genre:${g.slug}`
    onRichReply(btnId, async (c2) => {
      await showBrowse(c2, g.slug, 'genre')
    })
    return {
      title: g.name,
      description: `Jelajahi koleksi genre ${g.name}`,
      id: btnId
    }
  })

  return ctx.replyList({
    text,
    title: '🏷️ Pilih Genre',
    buttonText: 'Daftar Genre',
    sections: [{ title: `Genre Tersedia (${top.length})`, rows }],
    footer: `${config.botName} • Genres`
  })
}

async function showBrowse(ctx, slug, type = 'genre') {
  const p = ctx.prefix || '.'
  const d = await callApi('browse', { type, slug })
  const results = (d.results || []).slice(0, 15)
  if (!results.length) {
    await ctx.reply(`📭 Seri untuk ${type} *${cut(slug, 30)}* belum tersedia.`)
    return
  }

  USER_SESSIONS.set(ctx.sender, {
    type: 'browse',
    series: results,
    updatedAt: Date.now()
  })

  let text = `📚 *ᴋᴀᴛᴀʟᴏɢ ${type === 'category' ? 'KATEGORI' : 'GENRE'}: ${cut(slug, 30).toUpperCase()}*\n\n`
  text += `┌─── 📋 *DAFTAR JUDUL*\n`
  text += results
    .map(
      (r, i) =>
        `│ ${String(i + 1).padStart(2, '0')}. *${cut(r.title, 42)}*${r.genres ? `\n│    _${cut(r.genres, 36)}_` : ''}`
    )
    .join('\n')
  text += `\n└────────────────\n\n`
  text += `_Total ${d.total_pages || 1} halaman. Pilih judul di tombol bawah 👇_`

  const rows = results.map((r, i) => {
    const btnId = `nekopoi:${ctx.sender}:browse_pick:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showDetail(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(r.title, 35)}`,
      description: r.genres ? cut(r.genres, 45) : 'Buka detail seri',
      id: btnId
    }
  })

  const headerImage = await uploadHeaderThumb(ctx.client, results[0]?.thumb)

  return ctx.replyList({
    text,
    title: '📚 Pilih Seri',
    buttonText: 'Pilih Judul',
    sections: [{ title: `Katalog (${results.length})`, rows }],
    footer: `${config.botName} • Katalog`,
    headerImage
  })
}

async function showSchedule(ctx) {
  const p = ctx.prefix || '.'
  const d = await callApi('schedule')
  const items = (d.results || []).slice(0, 10)
  if (!items.length) {
    await ctx.reply('📅 Jadwal rilis belum diperbarui oleh NekoPoi.')
    return
  }

  let text = `📅 *ᴊᴀᴅᴡᴀʟ ʀɪʟɪs ɴᴇᴋᴏᴘᴏɪ*\n\n`
  text += `┌─── 🗓️ *JADWAL TAYANG*\n`
  text += items
    .map(
      (s, i) =>
        `│ ${String(i + 1).padStart(2, '0')}. *${cut(s.title, 40)}*\n│    ↳ _${cut(s.episode || '-', 16)} • ${cut(s.release_date, 18)}_`
    )
    .join('\n│\n')
  text += `\n└────────────────\n\n`
  text += `_Total ${d.count || items.length} judul dalam pantauan._\n`
  text += `💡 Cari judul: \`${p}nekopoi cari <judul>\``

  return ctx.reply(text)
}

async function doRandom(ctx) {
  const r = await callApi('random')
  if (r?.slug) {
    await showDetail(ctx, r.slug)
  } else {
    await ctx.reply('🎲 Gagal mengambil judul acak. Coba lagi.')
  }
}

async function showHelp(ctx) {
  const p = ctx.prefix || '.'
  const text =
    `🎴 *ɴᴇᴋᴏᴘᴏɪ (sᴋʏʟɪɴᴇ ᴀᴘɪ)*\n\n` +
    `┌─── 📖 *DAFTAR PERINTAH*\n` +
    `│ • *${p}nekopoi* — rilis terbaru & list pilihan\n` +
    `│ • *${p}nekopoi cari <judul>* — cari seri anime\n` +
    `│ • *${p}nekopoi <nomor>* — info seri dari hasil list\n` +
    `│ • *${p}nekopoi ep <nomor>* — stream & unduh episode\n` +
    `│ • *${p}nekopoi dl <nomor>* — unduh direct (auto bypass)\n` +
    `│ • *${p}nekopoi genre* — daftar kategori genre\n` +
    `│ • *${p}nekopoi jadwal* — jadwal rilis baru\n` +
    `│ • *${p}nekopoi random* — judul acak\n` +
    `└────────────────\n\n` +
    `_Data disinkronisasi melalui API resmi Skyline._`
  await ctx.reply(text)
}

/* ── Handler Utama ── */
const SUB_ACTION = {
  latest: 'latest',
  baru: 'latest',
  search: 'search',
  cari: 'search',
  detail: 'detail',
  info: 'detail',
  episode: 'episode',
  ep: 'episode',
  download: 'download',
  dl: 'download',
  unduh: 'download',
  browse: 'browse',
  genre: 'browse',
  genres: 'genres',
  jadwal: 'schedule',
  schedule: 'schedule',
  random: 'random',
  acak: 'random',
  help: 'help'
}

async function handler(ctx) {
  const raw = (ctx.text || '').trim()
  const cmd = (ctx.command || '').toLowerCase()

  let action = 'latest'
  let arg = ''

  if (cmd === 'nekocari' || cmd === 'nekosearch') {
    action = 'search'
    arg = raw
  } else if (cmd === 'nekoinfo') {
    action = 'detail'
    arg = raw
  } else if (cmd === 'nekoep' || cmd === 'nekoepisode') {
    action = 'episode'
    arg = raw
  } else if (cmd === 'nekodl' || cmd === 'nekodownload') {
    action = 'download'
    arg = raw
  } else if (cmd === 'nekogenres') {
    action = 'genres'
  } else if (cmd === 'nekogenre') {
    action = raw ? 'browse' : 'genres'
    arg = raw
  } else if (cmd === 'nekoschedule' || cmd === 'nekojadwal') {
    action = 'schedule'
  } else if (cmd === 'nekorandom') {
    action = 'random'
  } else {
    const first = (raw.split(/\s+/)[0] || '').toLowerCase()
    if (!raw) {
      action = 'latest'
    } else if (/^\d+$/.test(raw)) {
      action = 'detail'
      arg = raw
    } else if (SUB_ACTION[first]) {
      action = SUB_ACTION[first]
      arg = raw.slice(first.length).trim()
    } else {
      action = 'search'
      arg = raw
    }
  }

  await ctx.react('⏳')
  try {
    switch (action) {
      case 'help':
        await showHelp(ctx)
        break
      case 'latest':
        await showLatest(ctx)
        break
      case 'search':
        if (!arg) {
          await showHelp(ctx)
          return
        }
        await showSearch(ctx, arg)
        break
      case 'detail':
        if (!arg) {
          await ctx.reply('Contoh: *.nekopoi detail 1* atau *.nekopoi detail /hentai/so_low*')
          return
        }
        await showDetail(ctx, arg)
        break
      case 'episode':
        if (!arg) {
          await ctx.reply('Contoh: *.nekopoi ep 1* atau *.nekopoi ep /so_low-episode-4-subtitle-indonesia*')
          return
        }
        await showEpisode(ctx, arg)
        break
      case 'download':
        if (!arg) {
          await ctx.reply('Contoh: *.nekopoi dl 1* atau *.nekopoi dl /so_low-episode-4-subtitle-indonesia*')
          return
        }
        await showDownload(ctx, arg)
        break
      case 'genres':
        await showGenres(ctx)
        break
      case 'browse':
        if (!arg) {
          await showGenres(ctx)
          return
        }
        await showBrowse(ctx, arg, 'genre')
        break
      case 'schedule':
        await showSchedule(ctx)
        break
      case 'random':
        await doRandom(ctx)
        break
      default:
        await showHelp(ctx)
        break
    }
    await ctx.react('✅')
  } catch (err) {
    await ctx.react('❌')
    await ctx.reply(errorText(err))
  }
}

export { pluginConfig as config, handler }
