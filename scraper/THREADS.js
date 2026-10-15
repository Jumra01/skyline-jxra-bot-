/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * THREADS.js — Threads downloader scraper
 */

export async function JHThreadsDL(threadsUrl) {
  const axios = (await import('axios')).default

  if (!threadsUrl || typeof threadsUrl !== 'string') {
    throw new Error('URL Threads tidak valid.')
  }
  if (!/threads\.(com|net)/i.test(threadsUrl)) {
    throw new Error('URL bukan URL Threads.')
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36',
    Referer: 'https://www.threadsdl.app/id/'
  }

  const { data } = await axios.post(
    'https://www.threadsdl.app/api/threads',
    { url: threadsUrl },
    { headers, timeout: 60000 }
  )

  if (!data || !data.medias) {
    throw new Error('Data media kosong atau link invalid.')
  }

  const results = data.medias
    .map((m) => {
      if (m.mediaType === 2 && m.videos && m.videos.length > 0) {
        return { type: 'video', url: m.videos[0].url, thumbnail: m.cover || '' }
      }
      if (m.mediaType === 1 && m.images && m.images.length > 0) {
        const hdImg = m.images.reduce((prev, curr) => (prev.width > curr.width ? prev : curr))
        return { type: 'image', url: hdImg.url }
      }
      return null
    })
    .filter(Boolean)

  if (results.length === 0) {
    throw new Error('Gagal ekstrak media dari JSON response.')
  }

  return {
    status: true,
    data: {
      username: data.username || 'Unknown',
      profile_pic: data.avatar || '',
      caption: data.text || '',
      media: results
    }
  }
}

export default JHThreadsDL
