/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * igdl.js — Instagram downloader scraper (include thumbnail per media)
 */

export async function JHIGDL(igUrl) {
  const axios = (await import('axios')).default
  const FormData = (await import('form-data')).default

  if (!igUrl || typeof igUrl !== 'string') {
    throw new Error('URL Instagram tidak valid.')
  }
  if (!/instagram\.com|instagr\.am/i.test(igUrl)) {
    throw new Error('URL bukan URL Instagram.')
  }

  const baseRes = await axios.get('https://snapsave.app/id/download-video-instagram', {
    timeout: 30000,
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })

  let cookies = ''
  if (baseRes.headers['set-cookie']) {
    cookies = baseRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
  }

  const form = new FormData()
  form.append('url', igUrl)

  const res = await axios.post('https://snapsave.app/id/action.php?lang=id', form, {
    timeout: 60000,
    headers: {
      ...form.getHeaders(),
      accept: '*/*',
      'accept-language': 'id-ID',
      origin: 'https://snapsave.app',
      referer: 'https://snapsave.app/id/download-video-instagram',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      cookie: cookies
    }
  })

  const rawData = res.data
  if (typeof rawData !== 'string' || !rawData.includes('eval(function')) {
    throw new Error('Format respons obfus tidak ditemukan.')
  }

  let htmlDecoded = ''
  try {
    const patchEval = rawData.replace('eval(function', 'return (function')
    const deobfuscator = new Function(patchEval)
    htmlDecoded = deobfuscator()
  } catch (e) {
    throw new Error('Gagal deobfuscate respons: ' + (e.message || e))
  }

  if (htmlDecoded.includes('document.querySelector("#alert").innerHTML = "')) {
    const errMsg = htmlDecoded.split('document.querySelector("#alert").innerHTML = "')[1].split('";')[0]
    throw new Error('Source menolak: ' + errMsg)
  }

  if (!htmlDecoded.includes('innerHTML = "')) {
    throw new Error('Struktur HTML tidak dikenali.')
  }

  let cleanHtml = htmlDecoded.split('innerHTML = "')[1]
  cleanHtml = cleanHtml.split('"; document.')[0]
  cleanHtml = cleanHtml.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')

  const results = []
  const items = cleanHtml.split('class="download-items"')

  for (let i = 1; i < items.length; i++) {
    const itemHtml = items[i]
    const thumbMatch = itemHtml.match(/<img src="([^"]+)"/)
    const dlMatch = itemHtml.match(/href="([^"]+)"/)
    if (!dlMatch) continue

    const isVideo = itemHtml.includes('icon-dlvideo') || itemHtml.includes('Download video')
    results.push({
      type: isVideo ? 'video' : 'image',
      thumbnail: thumbMatch ? thumbMatch[1].replace(/&amp;/g, '&') : null,
      url: dlMatch[1].replace(/&amp;/g, '&')
    })
  }

  if (results.length === 0) {
    throw new Error('Media tidak ditemukan (mungkin private / dihapus / region lock).')
  }

  return { success: true, data: results }
}
