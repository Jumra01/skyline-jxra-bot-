/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * YT-Search.js — Scraper Mencari Video YouTube
 */

function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(jsonStart, i + 1);
    }
  }
  return null;
}

export async function searchYouTube(query, limit = 10) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!res.ok) throw new Error('Gagal fetch halaman YouTube: HTTP ' + res.status);

  const html = await res.text();
  const raw = extractJsonAfter(html, 'var ytInitialData = ');
  if (!raw) {
    throw new Error('Gagal nemu data pencarian di halaman YouTube (kemungkinan struktur halamannya berubah).');
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Gagal parse data pencarian YouTube.');
  }

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];

  const results = [];

  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const v = item.videoRenderer;
      if (!v?.videoId) continue;

      results.push({
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Tanpa judul',
        duration: v.lengthText?.simpleText || 'LIVE',
        views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '-',
        channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '-',
        thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url || null
      });

      if (results.length >= limit) return results;
    }
  }

  return results;
}
