/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * nekopoi.js — Client NekoPoi via API Skyline (https://skyline.web.id/api/nekopoi).
 * Kuota & rate limit tetap terhitung di sisi web Skyline.
 * Format ctx.replyList persis seperti di .setreply (tanpa header media/location bermasalah).
 */

import axios from 'axios'
import config from '../../config.js'
import { skylineCreds } from '../../scraper/SKYLINE.js'
import { onRichReply } from '../../handlers/messageHandler.js'

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
    'nekogenre',
    'nekogenres',
    'nekoschedule',
    'nekojadwal',
    'nekorandom'
  ],
  category: 'search',
  description: 'NekoPoi via Skyline API: rilis terbaru, cari, detail, episode, genre, jadwal, random',
  usage: '.nekopoi [cari <judul> | detail <slug> | episode <slug> | genre | jadwal | random]',
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

/* ── View Renderers Menggunakan ctx.replyList (Metode setreply) ── */

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
  text += `📺 *Seri Terkini:*\n`
  if (series.length) {
    text += series
      .map((s, i) => `${i + 1}. *${cut(s.title, 50)}*`)
      .join('\n')
  } else {
    text += '—'
  }

  if (eps.length) {
    text += `\n\n🎬 *Episode Baru:*\n`
    text += eps
      .map((e) => `• *${cut(e.title, 45)}*\n   ↳ \`${p}nekopoi ep ${e.slug}\``)
      .join('\n')
  }

  text += `\n\nPilih seri yang diinginkan dari tombol list di bawah 👇`

  const rows = series.map((s, i) => {
    const btnId = `nekopoi:${ctx.sender}:pick:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showDetail(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(s.title, 35)}`,
      description: 'Buka detail & daftar episode',
      id: btnId
    }
  })

  // Tambahkan opsi acak
  const rndId = `nekopoi:${ctx.sender}:random`
  onRichReply(rndId, async (c2) => {
    await doRandom(c2)
  })
  rows.push({
    title: '🎲 Random Seri',
    description: 'Pilih seri anime secara acak',
    id: rndId
  })

  return ctx.replyList({
    text,
    title: '📚 Pilih Seri NekoPoi',
    buttonText: 'Pilih Seri',
    sections: [{ title: `Daftar Seri (${series.length})`, rows }],
    footer: `Hal ${d.page || 1}/${d.total_pages || 1} • ${config.botName}`
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

  let text = `🔍 *ʜᴀsɪʟ ᴘᴇɴᴄᴀʀɪᴀɴ*\n\n`
  text += `Kata Kunci: *${cut(query, 40)}*\n`
  text += `Ditemukan: ${d.results.length} hasil\n\n`
  text += results
    .map(
      (r, i) =>
        `${i + 1}. *${cut(r.title, 50)}*${r.genres ? `\n   _${cut(r.genres, 40)}_` : ''}`
    )
    .join('\n')

  text += `\n\nPilih seri yang diinginkan dari tombol list di bawah 👇`

  const rows = results.map((r, i) => {
    const btnId = `nekopoi:${ctx.sender}:search_pick:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showDetail(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(r.title, 35)}`,
      description: r.genres ? cut(r.genres, 50) : 'Buka info seri',
      id: btnId
    }
  })

  return ctx.replyList({
    text,
    title: '🔍 Hasil Pencarian',
    buttonText: 'Pilih Hasil',
    sections: [{ title: `Hasil Pencarian (${results.length})`, rows }],
    footer: `${config.botName} • NekoPoi Search`
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
  const eps = (info.episodes || []).slice(0, 20)

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
  const meta = []
  if (info.jenis) meta.push(`• Tipe: *${cut(info.jenis, 20)}*`)
  if (info.status) meta.push(`• Status: *${cut(info.status, 20)}*`)
  if (info.episode) meta.push(`• Episode: *${info.episode}*`)
  if (info.durasi) meta.push(`• Durasi: *${cut(info.durasi, 20)}*`)
  if (info.skor) meta.push(`• Skor: *${cut(info.skor, 10)}*`)
  if (info.tayang) meta.push(`• Rilis: *${cut(info.tayang, 20)}*`)
  if (info.produser) meta.push(`• Produser: *${cut(info.produser, 30)}*`)
  if (meta.length) text += meta.join('\n') + '\n'
  if (info.genres?.length) text += `\n🏷️ ${info.genres.slice(0, 8).map((g) => g.name).join(', ')}\n`
  if (info.synopsis) text += `\n📖 _${cut(info.synopsis, 300)}_\n`

  if (eps.length) {
    text += `\n🎬 *Daftar Episode:*\n`
    text += eps
      .map((e, i) => `${i + 1}. *${cut(e.episode || e.title, 40)}* (${cut(e.date, 15)})`)
      .join('\n')
    text += `\n\nPilih episode yang ingin ditonton di tombol list di bawah 👇`
  } else {
    text += `\n⬇️ *Stream & Unduh*: \`${p}nekopoi ep ${slug}\``
  }

  const rows = eps.map((e, i) => {
    const btnId = `nekopoi:${ctx.sender}:ep:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showEpisode(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(e.episode || e.title, 35)}`,
      description: e.date ? `Rilis: ${cut(e.date, 25)}` : 'Link unduh & stream',
      id: btnId
    }
  })

  // Tambahkan tombol Beranda
  const homeId = `nekopoi:${ctx.sender}:home`
  onRichReply(homeId, async (c2) => {
    await showLatest(c2)
  })
  rows.push({
    title: '🏠 Beranda NekoPoi',
    description: 'Kembali ke daftar seri rilis terbaru',
    id: homeId
  })

  return ctx.replyList({
    text,
    title: '🎬 Pilih Episode',
    buttonText: 'Episode',
    sections: [{ title: `Daftar Episode (${eps.length})`, rows }],
    footer: `${config.botName} • NekoPoi Detail`
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
      text += `↳ \`${p}nekopoi detail ${d.seriesLink}\`\n\n`
    } else {
      text += `\n`
    }
  }

  const streams = d.streams || []
  if (streams.length) {
    text += `📡 *Server Stream:*\n`
    text += streams.map((s, i) => `${i + 1}. ${cut(s.server, 25)}`).join('\n') + `\n\n`
  }

  const dl = d.downloads || []
  if (dl.length) {
    text += `⬇️ *Pilihan Unduh:*\n`
    text += dl
      .map((q) => {
        const links = q.links.map((l) => `• ${l.label}: ${l.url}`).join('\n')
        return `*${cut(q.quality, 40)}*\n${links}`
      })
      .join('\n\n')
  } else {
    text += `_Link unduh belum tersedia untuk episode ini._`
  }

  const rows = []
  if (d.seriesLink) {
    const backId = `nekopoi:${ctx.sender}:back_detail`
    onRichReply(backId, async (c2) => {
      await showDetail(c2, d.seriesLink)
    })
    rows.push({
      title: '📺 Lihat Seri Lengkap',
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
    description: 'Kembali ke daftar seri terbaru',
    id: homeId
  })

  return ctx.replyList({
    text,
    title: '🔗 Navigasi NekoPoi',
    buttonText: 'Navigasi',
    sections: [{ title: 'Menu Pilihan', rows }],
    footer: d.seriesTitle ? cut(d.seriesTitle, 40) : `${config.botName} • Stream & DL`
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
  text += `Total: *${d.count || genres.length}* genre.\n`
  text += `Pilih genre yang ingin dijelajahi pada tombol di bawah 👇`

  const rows = top.map((g) => {
    const btnId = `nekopoi:${ctx.sender}:genre:${g.slug}`
    onRichReply(btnId, async (c2) => {
      await showBrowse(c2, g.slug, 'genre')
    })
    return {
      title: g.name,
      description: `Buka katalog genre ${g.name}`,
      id: btnId
    }
  })

  return ctx.replyList({
    text,
    title: '🏷️ Pilih Genre',
    buttonText: 'Daftar Genre',
    sections: [{ title: `Genre NekoPoi (${top.length})`, rows }],
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

  let text = `📚 *Katalog ${type === 'category' ? 'Kategori' : 'Genre'}: ${cut(slug, 30)}*\n\n`
  text += results
    .map(
      (r, i) =>
        `${i + 1}. *${cut(r.title, 50)}*${r.genres ? `\n   _${cut(r.genres, 40)}_` : ''}`
    )
    .join('\n')
  text += `\n\n_Total ${d.total_pages || 1} halaman._\nPilih seri yang diinginkan dari tombol list di bawah 👇`

  const rows = results.map((r, i) => {
    const btnId = `nekopoi:${ctx.sender}:browse_pick:${i + 1}`
    onRichReply(btnId, async (c2) => {
      await showDetail(c2, String(i + 1))
    })
    return {
      title: `${i + 1}. ${cut(r.title, 35)}`,
      description: r.genres ? cut(r.genres, 50) : 'Buka detail seri',
      id: btnId
    }
  })

  return ctx.replyList({
    text,
    title: '📚 Pilih Seri',
    buttonText: 'Pilih Seri',
    sections: [{ title: `Katalog (${results.length})`, rows }],
    footer: `${config.botName} • Katalog`
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
  text += items
    .map(
      (s, i) =>
        `${i + 1}. *${cut(s.title, 45)}*\n   _${cut(s.episode || '-', 16)} · ${cut(s.release_date, 18)}_`
    )
    .join('\n\n')
  text += `\n\n_Total ${d.count || items.length} judul dipantau._\n`
  text += `💡 Ketik \`${p}nekopoi cari <judul>\` untuk mencari seri.`

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
    `• *${p}nekopoi* — rilis terbaru & tombol list pilihan\n` +
    `• *${p}nekopoi cari <judul>* — cari seri\n` +
    `• *${p}nekopoi <nomor>* — info seri dari hasil rilis/cari\n` +
    `• *${p}nekopoi ep <nomor>* — stream & unduh episode\n` +
    `• *${p}nekopoi genre* — daftar genre interaktif\n` +
    `• *${p}nekopoi genre <slug>* — seri per genre\n` +
    `• *${p}nekopoi jadwal* — jadwal rilis baru\n` +
    `• *${p}nekopoi random* — pilih judul acak\n\n` +
    `_Data diambil melalui API Skyline, kuota terhitung otomatis._`
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
