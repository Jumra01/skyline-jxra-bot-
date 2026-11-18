/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * nekopoi.js — Client NekoPoi via API Skyline (https://skyline.web.id/api/nekopoi).
 * Kuota & rate limit tetap terhitung di sisi web Skyline.
 * Tampilan full interactive message:
 *   - Thumbnail (header image via DoH resolver anti-DNS-hijack ISP)
 *   - Tombol single_select buat list hasil / episode / genre
 *   - Quick reply buat navigasi (random, jadwal, beranda, balik)
 *   - CTA copy buat salin link download langsung
 */

import axios from 'axios'
import https from 'node:https'
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
  description: 'NekoPoi via Skyline API: seri terbaru, cari, detail, episode, genre, jadwal, random',
  usage: '.nekopoi [cari <judul> | detail <slug> | episode <slug> | genre | jadwal | random]',
  example: '.nekopoi cari so_low',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 8,
  limit: 1,
  energi: 0,
  isEnabled: true
}

const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/* ── DNS over HTTPS untuk bypass DNS Positif lokal saat fetch gambar ── */
const DNS_CACHE = new Map()
const DNS_TTL = 10 * 60 * 1000

async function resolveIPs(host) {
  const hit = DNS_CACHE.get(host)
  if (hit && Date.now() - hit.ts < DNS_TTL) return hit.ips
  let ips = []
  try {
    const res = await axios.get(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      { timeout: 8000, headers: { accept: 'application/dns-json' } }
    )
    ips = (res.data?.Answer || []).filter((a) => a.type === 1).map((a) => a.data)
  } catch {}
  if (!ips.length) {
    try {
      const dns = await import('node:dns')
      ips = await dns.promises.resolve4(host)
    } catch {}
  }
  if (ips.length) DNS_CACHE.set(host, { ips, ts: Date.now() })
  return ips
}

function fetchWithSNI(u, ip) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: ip,
        port: 443,
        path: u.pathname + u.search,
        servername: u.hostname,
        rejectUnauthorized: false,
        headers: {
          Host: u.hostname,
          'User-Agent': UA,
          Referer: 'https://nekopoi.care/',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error('HTTP ' + res.statusCode))
        }
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > 3 * 1024 * 1024) {
            req.destroy()
            return reject(new Error('kegedean'))
          }
          chunks.push(c)
        })
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
  })
}

async function fetchThumbBuffer(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const ips = await resolveIPs(u.hostname)
    for (const ip of ips.slice(0, 2)) {
      try {
        const buf = await fetchWithSNI(u, ip)
        if (buf && buf.length > 64) return buf
      } catch {}
    }
  } catch {}
  return null
}

async function uploadHeader(client, thumbUrl) {
  if (!thumbUrl || typeof client?.message?.upload !== 'function') return null
  try {
    const buf = await fetchThumbBuffer(thumbUrl)
    if (!buf) return null
    const media = await client.message.upload(buf, { type: 'image', mimetype: 'image/jpeg' })
    return {
      kind: 'imageMessage',
      url: media?.url,
      directPath: media?.directPath,
      mediaKey: media?.mediaKey,
      fileSha256: media?.fileSha256,
      fileEncSha256: media?.fileEncSha256,
      fileLength: media?.fileLength,
      mediaKeyTimestamp: media?.mediaKeyTimestamp,
      mimetype: 'image/jpeg'
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
      return '🔗 Slug tidak valid. Gunakan tombol navigasi atau ketik ulang judulnya.'
    case 'not_found':
      return '🔍 Data tidak ditemukan di NekoPoi.'
    case 'nekopoi_unavailable':
      return '🛠️ Server NekoPoi sedang tidak dapat diakses. Coba beberapa saat lagi.'
    default:
      return `❌ Terjadi gangguan: ${e?.message || 'Gagal memuat data'}`
  }
}

/* ── Helpers ID Rich Reply ── */
const SESS_MAP = new Map() // id -> fn(ctx)

function regAction(id, fn) {
  SESS_MAP.set(id, fn)
  onRichReply(id, async (ctx) => {
    const handler = SESS_MAP.get(id)
    if (handler) await handler(ctx)
  })
}

/* ── View Renderers ── */

async function showLatest(ctx) {
  const d = await callApi('latest')
  const series = (d.series || []).slice(0, 8)
  const eps = (d.episodes || []).slice(0, 5)

  let text = `🔥 *ɴᴇᴋᴏᴘᴏɪ · ʀɪʟɪs ᴛᴇʀʙᴀʀᴜ*\n\n`
  text += `📺 *Seri Terkini*\n`
  text += series.length
    ? series.map((s, i) => `${i + 1}. ${cut(s.title, 55)}`).join('\n')
    : '—'

  if (eps.length) {
    text += `\n\n🎬 *Episode Baru*\n`
    text += eps.map((e) => `• ${cut(e.title, 50)}\n   _${cut(e.date, 25)}_`).join('\n')
  }
  text += `\n\n_Pilih seri di tombol bawah untuk melihat episode._`

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  const rows = series.map((s, i) => {
    const rId = `${sessPrefix}:d:${i}`
    regAction(rId, (c2) => showDetail(c2, s.slug))
    return {
      id: rId,
      title: `${i + 1}. ${cut(s.title, 22)}`,
      description: cut(s.title, 60)
    }
  })

  const randId = `${sessPrefix}:rand`
  const schedId = `${sessPrefix}:sched`
  regAction(randId, (c2) => doRandom(c2))
  regAction(schedId, (c2) => showSchedule(c2))

  const headerImage = await uploadHeader(ctx.client, series[0]?.thumb)
  const footer = `Hal ${d.page || 1}/${d.total_pages || 1} • ${config.botName}`

  if (rows.length) {
    await ctx.replyList({
      text,
      footer,
      title: 'Pilih Seri',
      buttonText: '📚 Daftar Seri',
      sections: [{ title: 'Seri Terbaru', rows }],
      headerImage
    })
  } else {
    await ctx.replyButtons({
      text,
      footer,
      buttons: [
        { text: '🎲 Random', id: randId },
        { text: '📅 Jadwal', id: schedId }
      ],
      headerImage
    })
  }
}

async function showSearch(ctx, query) {
  const d = await callApi('search', { q: query })
  const results = (d.results || []).slice(0, 10)
  if (!results.length) {
    await ctx.reply(`🔍 Judul *${cut(query, 40)}* tidak ditemukan di NekoPoi.`)
    return
  }

  let text = `🔍 *ʜᴀsɪʟ ᴘᴇɴᴄᴀʀɪᴀɴ*\n\n`
  text += `Query: *${cut(query, 40)}*\n`
  text += `Ditemukan: ${d.results.length} hasil${d.total_pages > 1 ? ` (${d.total_pages} hal)` : ''}\n\n`
  text += results.map((r, i) => `${i + 1}. ${cut(r.title, 55)}`).join('\n')
  text += `\n\n_Pilih judul dari menu di bawah._`

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  const rows = results.map((r, i) => {
    const rId = `${sessPrefix}:r:${i}`
    regAction(rId, (c2) => showDetail(c2, r.slug))
    return {
      id: rId,
      title: `${i + 1}. ${cut(r.title, 22)}`,
      description: cut(r.genres || r.desc || 'Buka detail', 60)
    }
  })

  const headerImage = await uploadHeader(ctx.client, results[0]?.thumb)

  await ctx.replyList({
    text,
    footer: `${config.botName} • NekoPoi Search`,
    title: 'Hasil Pencarian',
    buttonText: '📚 Buka Hasil',
    sections: [{ title: 'Daftar Judul', rows }],
    headerImage
  })
}

async function showDetail(ctx, slug) {
  const d = await callApi('detail', { slug })
  const info = d.detail || {}
  const eps = (info.episodes || []).slice(0, 10)

  if (!info.title) {
    await ctx.reply('🔍 Detail seri kosong.')
    return
  }

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
  if (info.synopsis) text += `\n📖 _${cut(info.synopsis, 450)}_\n`

  if (eps.length) {
    text += `\n🎬 *Daftar Episode*\n`
    text += eps.map((e) => `• ${cut(e.episode || e.title, 40)} — ${cut(e.date, 18)}`).join('\n')
  }

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  const headerImage = await uploadHeader(ctx.client, info.poster)

  if (eps.length) {
    const rows = eps.map((e, i) => {
      const eId = `${sessPrefix}:ep:${i}`
      regAction(eId, (c2) => showEpisode(c2, e.slug))
      return {
        id: eId,
        title: cut(e.episode || `Ep ${i + 1}`, 22),
        description: cut(e.title, 60)
      }
    })

    await ctx.replyList({
      text,
      footer: `${config.botName} • NekoPoi Detail`,
      title: 'Pilih Episode',
      buttonText: '🎬 Daftar Episode',
      sections: [{ title: 'Episode Tersedia', rows }],
      headerImage
    })
  } else {
    const epId = `${sessPrefix}:epdirect`
    regAction(epId, (c2) => showEpisode(c2, slug))
    await ctx.replyButtons({
      text,
      footer: `${config.botName} • NekoPoi Detail`,
      buttons: [
        { text: '⬇️ Stream & Download', id: epId },
        { text: '🎲 Random', id: `${sessPrefix}:rand` }
      ],
      headerImage
    })
  }
}

async function showEpisode(ctx, slug) {
  const d = await callApi('episode', { slug })

  let text = `🎬 *${cut(d.title, 80)}*\n\n`
  text += `📡 *Server Stream* (${d.streams?.length || 0})\n`
  text += (d.streams || []).length
    ? d.streams.map((s, i) => `${i + 1}. ${cut(s.server, 25)}`).join('\n')
    : '—'

  const dl = d.downloads || []
  if (dl.length) {
    text += `\n\n⬇️ *Pilihan Unduh*\n`
    text += dl
      .slice(0, 5)
      .map((q) => {
        const label = cut(q.quality.replace(/\s*\[[^\]]+\]\s*$/, ''), 35)
        const q2 = (q.quality.match(/\[([^\]]+)\]/) || [])[1] || ''
        return `• ${label}${q2 ? ` _[${q2}]_` : ''}\n   ${q.links.map((l) => l.label).join(' · ')}`
      })
      .join('\n')
  }

  const buttons = []
  // Pasang CTA copy untuk tautan download
  for (const q of dl) {
    const qTag = (q.quality.match(/\[([^\]]+)\]/) || [])[1] || cut(q.quality, 8)
    const link =
      q.links.find((l) => /mp4|pixel|acefile|kraken|gdrive|mega/i.test(l.label)) || q.links[0]
    if (!link) continue
    buttons.push({ text: `⬇️ ${qTag} · ${cut(link.label, 10)}`, copy: link.url })
    if (buttons.length >= 2) break
  }

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  if (d.seriesLink) {
    const backId = `${sessPrefix}:back`
    regAction(backId, (c2) => showDetail(c2, d.seriesLink))
    buttons.push({ text: '🎴 Balik ke Seri', id: backId })
  } else {
    const homeId = `${sessPrefix}:home`
    regAction(homeId, (c2) => showLatest(c2))
    buttons.push({ text: '🏠 Beranda', id: homeId })
  }

  const headerImage = await uploadHeader(ctx.client, d.poster)

  await ctx.replyButtons({
    text,
    footer: d.seriesTitle ? cut(d.seriesTitle, 40) : `${config.botName} • Stream & DL`,
    buttons,
    headerImage
  })
}

async function showGenres(ctx) {
  const d = await callApi('genres')
  const genres = d.genres || []
  if (!genres.length) {
    await ctx.reply('🏷️ Daftar genre kosong.')
    return
  }

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  const top = genres.slice(0, 24)
  const rows = top.map((g, i) => {
    const gId = `${sessPrefix}:g:${i}`
    regAction(gId, (c2) => showBrowse(c2, g.slug, 'genre'))
    return {
      id: gId,
      title: cut(g.name, 24),
      description: `Lihat seri genre ${g.name}`
    }
  })

  const text =
    `🏷️ *ᴅᴀғᴛᴀʀ ɢᴇɴʀᴇ ɴᴇᴋᴏᴘᴏɪ*\n\n` +
    `Total: *${d.count || genres.length}* genre.\n` +
    `Silakan pilih genre dari menu di bawah:`

  await ctx.replyList({
    text,
    footer: `${config.botName} • Genres`,
    title: 'Pilih Genre',
    buttonText: '🏷️ Buka Genre',
    sections: [{ title: 'Daftar Genre', rows }]
  })
}

async function showBrowse(ctx, slug, type = 'genre') {
  const d = await callApi('browse', { type, slug })
  const results = (d.results || []).slice(0, 10)
  if (!results.length) {
    await ctx.reply(`📭 Seri untuk ${type} *${cut(slug, 30)}* belum tersedia.`)
    return
  }

  let text = `📚 *Katalog ${type === 'category' ? 'Kategori' : 'Genre'}: ${cut(slug, 30)}*\n\n`
  text += results.map((r, i) => `${i + 1}. ${cut(r.title, 55)}`).join('\n')
  text += `\n\n_Total ${d.total_pages || 1} halaman. Pilih judul di bawah._`

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  const rows = results.map((r, i) => {
    const rId = `${sessPrefix}:b:${i}`
    regAction(rId, (c2) => showDetail(c2, r.slug))
    return {
      id: rId,
      title: `${i + 1}. ${cut(r.title, 22)}`,
      description: cut(r.genres || 'Buka detail', 60)
    }
  })

  const headerImage = await uploadHeader(ctx.client, results[0]?.thumb)

  await ctx.replyList({
    text,
    footer: `${config.botName} • Katalog`,
    title: 'Pilih Seri',
    buttonText: '📚 Daftar Seri',
    sections: [{ title: 'Hasil', rows }],
    headerImage
  })
}

async function showSchedule(ctx) {
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
        `${i + 1}. ${cut(s.title, 45)}\n   _${cut(s.episode || '-', 16)} · ${cut(s.release_date, 18)}_`
    )
    .join('\n')
  text += `\n\n_Total ${d.count || items.length} judul dipantau._`

  const sessPrefix = `nk:${ctx.sender}:${Date.now().toString(36)}`
  const homeId = `${sessPrefix}:home`
  const randId = `${sessPrefix}:rand`
  regAction(homeId, (c2) => showLatest(c2))
  regAction(randId, (c2) => doRandom(c2))

  const headerImage = await uploadHeader(ctx.client, items[0]?.thumb)

  await ctx.replyButtons({
    text,
    footer: `${config.botName} • Jadwal Rilis`,
    buttons: [
      { text: '🏠 Beranda', id: homeId },
      { text: '🎲 Random', id: randId }
    ],
    headerImage
  })
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
    `• *${p}nekopoi* — rilis terbaru\n` +
    `• *${p}nekopoi cari <judul>* — cari seri\n` +
    `• *${p}nekopoi detail <slug>* — info & episode\n` +
    `• *${p}nekopoi episode <slug>* — stream & unduh\n` +
    `• *${p}nekopoi genre* — daftar genre\n` +
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
          await ctx.reply('Contoh: *.nekopoi detail /hentai/so_low*')
          return
        }
        await showDetail(ctx, arg)
        break
      case 'episode':
        if (!arg) {
          await ctx.reply('Contoh: *.nekopoi episode /so_low-episode-4-subtitle-indonesia*')
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
