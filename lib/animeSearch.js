/**
 * © skyline-JXRA
 * AniList GraphQL client dan formatter untuk pencarian anime/manga.
 */
const API = 'https://graphql.anilist.co'
const QUERY = `
query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type) {
    id
    title { romaji english native }
    description(asHtml: false)
    format
    status
    episodes
    duration
    chapters
    volumes
    season
    seasonYear
    averageScore
    popularity
    genres
    studios(isMain: true) { nodes { name } }
    startDate { year month day }
    endDate { year month day }
    coverImage { extraLarge large }
    siteUrl
  }
}`

const STATUS = {
  FINISHED: 'Selesai', RELEASING: 'Sedang tayang', NOT_YET_RELEASED: 'Belum tayang',
  CANCELLED: 'Dibatalkan', HIATUS: 'Hiatus',
}
const FORMATS = { TV: 'Serial TV', TV_SHORT: 'Serial pendek', MOVIE: 'Film', SPECIAL: 'Spesial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Musik', MANGA: 'Manga', NOVEL: 'Novel', ONE_SHOT: 'One-shot' }

function dateOf(date) {
  if (!date?.year) return '-'
  return [date.day, date.month, date.year].filter(Boolean).join('/')
}

function cleanDescription(text, max = 650) {
  const clean = String(text || 'Sinopsis tidak tersedia.')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean
}

function format(media, kind) {
  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Tanpa judul'
  const lines = [kind === 'ANIME' ? '🎬 *Info Anime*' : '📚 *Info Manga*', '', `*${title}*`]
  if (media.title?.native && media.title.native !== title) lines.push(`_${media.title.native}_`)
  if (media.title?.romaji && media.title.romaji !== title && media.title.romaji !== media.title.native) lines.push(`_${media.title.romaji}_`)
  lines.push('', `📡 Status: ${STATUS[media.status] || media.status || '-'}`, `📄 Format: ${FORMATS[media.format] || media.format || '-'}`)
  if (kind === 'ANIME') {
    lines.push(`🎞 Episode: ${media.episodes ?? '-'}`, `⏱ Durasi: ${media.duration ? `${media.duration} menit/episode` : '-'}`, `🗓 Musim: ${media.season ? `${media.season} ${media.seasonYear || ''}`.trim() : '-'}`)
  } else {
    lines.push(`📖 Chapter: ${media.chapters ?? '-'}`, `📚 Volume: ${media.volumes ?? '-'}`)
  }
  lines.push(`📅 Mulai: ${dateOf(media.startDate)}`, `🏁 Selesai: ${dateOf(media.endDate)}`, `🎨 Studio: ${media.studios?.nodes?.[0]?.name || '-'}`, `🏷 Genre: ${media.genres?.join(', ') || '-'}`, `⭐ Skor: ${media.averageScore ? `${media.averageScore}/100` : '-'}`, `👥 Popularitas: ${media.popularity?.toLocaleString('id-ID') ?? '-'}`, '', `📝 *Sinopsis*\n${cleanDescription(media.description)}`, '', `🔗 ${media.siteUrl}`)
  return { title, text: lines.join('\n'), cover: media.coverImage?.extraLarge || media.coverImage?.large || null }
}

export async function searchAnimeMedia(search, kind) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { search, type: kind } }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'AniList sedang membatasi permintaan, coba lagi sebentar.' : `AniList mengembalikan HTTP ${response.status}.`)
      error.status = response.status
      throw error
    }
    if (payload?.errors?.length) throw new Error('AniList gagal memproses pencarian.')
    const media = payload?.data?.Media
    return media ? { media, ...format(media, kind) } : null
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Pencarian AniList melewati batas waktu 12 detik.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
