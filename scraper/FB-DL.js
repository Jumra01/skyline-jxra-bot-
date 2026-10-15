/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * FB-DL.js — Facebook downloader scraper
 */

export async function JHFBDL(fbUrl) {
  const axios = (await import('axios')).default

  if (!fbUrl || typeof fbUrl !== 'string') {
    throw new Error('URL Facebook tidak valid.')
  }
  if (!/facebook\.com|fb\.watch/i.test(fbUrl)) {
    throw new Error('URL bukan URL Facebook.')
  }

  const apiUrl = `https://serverless-tooly-gateway-6n4h522y.ue.gateway.dev/facebook/video?url=${encodeURIComponent(fbUrl)}`

  const { data } = await axios.get(apiUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 30000
  })

  if (!data || !data.success) {
    throw new Error('Gagal nyedot data dari API.')
  }

  let rawTitle = data.title || 'Unknown'
  let title = rawTitle
  let author = 'Unknown'

  if (rawTitle.includes('|')) {
    const parts = rawTitle.split('|')
    author = parts.pop().trim()
    title = parts.join('|').trim()
  }

  const media = []
  if (data.videos?.hd?.url) {
    media.push({ quality: 'HD', size: data.videos.hd.size || '-', url: data.videos.hd.url })
  }
  if (data.videos?.sd?.url) {
    media.push({ quality: 'SD', size: data.videos.sd.size || '-', url: data.videos.sd.url })
  }

  if (media.length === 0) {
    throw new Error('Media kosong dari API.')
  }

  return { status: true, data: { caption: title, author, media } }
}

export default JHFBDL
