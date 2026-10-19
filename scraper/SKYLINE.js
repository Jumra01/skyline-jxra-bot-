/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * SKYLINE.js — Client API skyline.web.id (YouTube downloader + search).
 *
 * Kredensial SATU SUMBER dengan `.omniedit`:
 *   config.js → blok `skyline` (baru) atau `omniedit` (yang sudah ada)
 *   Override env (deploy panel):
 *     SKYLINE_API_KEY / SKYLINE_API_URL
 *     fallback lama: OMNI_API_KEY / OMNI_WEBSITE
 *
 * Endpoint yang dipakai (docs skyline.web.id):
 *   GET /api/tools/yt-search?q=...&limit=...
 *   GET /api/tools/ytdl?url=...
 *   GET /api/tools/ytdl/audio?url=...                        → binary MP3
 *   GET /api/tools/ytdl/download?url=...&quality=360|720|1080 → binary MP4
 *
 * Link audio/video dari server SUDAH membawa apikey, jadi tinggal di-fetch.
 * File disiapin dulu di server: request pertama bisa 10-30 detik (timeout 180s).
 */
import config from '../config.js';

const DEFAULT_SITE = 'https://skyline.web.id';
const UA = 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36';

const MB = 1024 * 1024;

/** Batas ukuran supaya RAM panel (1 GB) gak jebol. */
export const MAX_AUDIO_BYTES = 60 * MB;
export const MAX_VIDEO_BYTES = 120 * MB;

export class SkylineKeyError extends Error {
  constructor(website = DEFAULT_SITE) {
    super('API key skyline.web.id belum diisi');
    this.name = 'SkylineKeyError';
    this.code = 'NO_API_KEY';
    this.website = website;
  }
}

export class SkylineApiError extends Error {
  constructor(message, status = 0, body = '') {
    super(message);
    this.name = 'SkylineApiError';
    this.status = status;
    this.body = String(body || '').slice(0, 220);
  }
}

/* ══════════════ kredensial ══════════════ */
export function skylineCreds() {
  const primary = config.skyline || {};
  const omni = config.omniedit || {};
  const website = String(
    process.env.SKYLINE_API_URL ||
      primary.website ||
      omni.website ||
      process.env.OMNI_WEBSITE ||
      DEFAULT_SITE
  )
    .trim()
    .replace(/\/+$/, '');
  const apikey = String(
    process.env.SKYLINE_API_KEY ||
      primary.apikey ||
      omni.apikey ||
      process.env.OMNI_API_KEY ||
      ''
  ).trim();
  return { website, apikey };
}

export function isConfigured() {
  return !!skylineCreds().apikey;
}

/* ══════════════ breaker (biar gak nunggu tiap request kalau API down) ══════════════ */
const BREAKER_LIMIT = 3;
const BREAKER_MS = 5 * 60 * 1000;
const breakers = new Map();

function breakerCheck(kind) {
  const b = breakers.get(kind);
  if (b && b.until > Date.now()) {
    const sisa = Math.ceil((b.until - Date.now()) / 1000);
    throw new SkylineApiError(`API Skyline lagi bermasalah — coba lagi ${sisa}s lagi`, 0);
  }
}

function breakerOk(kind) {
  breakers.delete(kind);
}

function breakerFail(kind) {
  const b = breakers.get(kind) || { fails: 0, until: 0 };
  b.fails += 1;
  if (b.fails >= BREAKER_LIMIT) {
    b.fails = 0;
    b.until = Date.now() + BREAKER_MS;
  }
  breakers.set(kind, b);
}

/* ══════════════ helper ══════════════ */
function absUrl(website, url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return website + (u.startsWith('/') ? u : '/' + u);
}

function parseApiError(body) {
  if (!body) return '';
  try {
    const obj = JSON.parse(body);
    return String(obj.error || obj.detail || obj.message || '').trim();
  } catch {
    return String(body).trim().slice(0, 160);
  }
}

async function request(kind, path, params, { timeout = 30000 } = {}) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new SkylineKeyError(website);

  breakerCheck(kind);

  const qs = new URLSearchParams({ ...params, apikey });
  const url = `${website}${path}?${qs.toString()}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    breakerFail(kind);
    const msg = err?.name === 'TimeoutError' ? 'Timeout nunggu API Skyline' : `Gagal konek API Skyline (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const text = await res.text();

  if (res.status === 401) {
    // key kosong/ditolak = bukan gangguan server, jangan bikin breaker muter
    throw new SkylineApiError(parseApiError(text) || 'API key Skyline kosong', res.status, text);
  }
  if (res.status === 403) {
    throw new SkylineApiError(parseApiError(text) || 'API key Skyline ditolak', res.status, text);
  }
  if (!res.ok) {
    breakerFail(kind);
    throw new SkylineApiError(parseApiError(text) || `HTTP ${res.status}`, res.status, text);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    breakerFail(kind);
    throw new SkylineApiError('Balasan API Skyline gak bisa dibaca', res.status, text);
  }

  if (json?.status === false || json?.success === false) {
    breakerFail(kind);
    throw new SkylineApiError(parseApiError(text) || 'API Skyline nolak request', res.status, text);
  }

  breakerOk(kind);
  return { json, website, apikey };
}

async function fetchBinary(url, { timeout = 180000, maxBytes = MAX_VIDEO_BYTES } = {}) {
  const { website } = skylineCreds();
  const target = absUrl(website, url);

  let res;
  try {
    res = await fetch(target, {
      headers: { Accept: '*/*', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow'
    });
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'Timeout / server kelamaan nyiapin file' : `Gagal ambil file (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

  if (!res.ok || ct.includes('json')) {
    const text = await res.text().catch(() => '');
    throw new SkylineApiError(parseApiError(text) || `Gagal ambil file (HTTP ${res.status})`, res.status, text);
  }

  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) {
    throw new SkylineApiError(`File kegedean (${(len / MB).toFixed(1)}MB, maks ${Math.round(maxBytes / MB)}MB)`, res.status);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new SkylineApiError(`File kegedean (maks ${Math.round(maxBytes / MB)}MB)`, res.status);
    }
    chunks.push(Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new SkylineApiError('File dari server kosong', res.status);

  return {
    buffer,
    mimetype: ct || 'application/octet-stream',
    filename: filenameFrom(res.headers.get('content-disposition')),
    website
  };
}

function filenameFrom(cd) {
  const s = String(cd || '');
  const star = /filename\*=UTF-8''([^;]+)/i.exec(s);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* lanjut */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(s);
  return plain ? plain[1].trim() : '';
}

function audioExt(mimetype) {
  const m = String(mimetype || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return { ext: 'mp3', mimetype: 'audio/mpeg' };
  if (m.includes('mp4') || m.includes('m4a')) return { ext: 'm4a', mimetype: 'audio/mp4' };
  if (m.includes('aac')) return { ext: 'aac', mimetype: 'audio/aac' };
  if (m.includes('ogg')) return { ext: 'ogg', mimetype: 'audio/ogg' };
  if (m.includes('webm')) return { ext: 'webm', mimetype: 'audio/webm' };
  if (m.includes('wav')) return { ext: 'wav', mimetype: 'audio/wav' };
  return { ext: 'mp3', mimetype: 'audio/mpeg' };
}

function videoExt(mimetype) {
  const m = String(mimetype || '').toLowerCase();
  if (m.includes('webm')) return { ext: 'webm', mimetype: 'video/webm' };
  if (m.includes('quicktime')) return { ext: 'mov', mimetype: 'video/quicktime' };
  return { ext: 'mp4', mimetype: 'video/mp4' };
}

/* ══════════════ YouTube search ══════════════ */
/**
 * Cari video YouTube.
 * @returns {Promise<Array<{videoId,url,title,channel,artist,duration,seconds,views,thumbnail,live}>>}
 */
export async function ytSearch(query, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];

  const n = Math.max(1, Math.min(20, Number(limit) || 12));
  const { json } = await request('search', '/api/tools/yt-search', { q, limit: String(n) }, { timeout: 30000 });

  const list = json?.result || json?.data?.result || json?.data || [];
  if (!Array.isArray(list)) return [];

  return list
    .filter((v) => v && (v.url || v.video_id))
    .map((v) => {
      const videoId = v.video_id || v.videoId || '';
      return {
        videoId,
        url: v.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
        title: v.title || 'Tanpa judul',
        channel: v.channel || v.author || '-',
        artist: v.channel || v.author || '-',
        duration: v.duration || '-:--',
        seconds: Number(v.seconds || 0) || 0,
        views: v.views || '-',
        thumbnail: v.thumbnail || null,
        live: !!v.live
      };
    });
}

/* ══════════════ YouTube info (metadata + link unduhan) ══════════════ */
/**
 * Ambil metadata + link audio/video satu video.
 * @returns {Promise<{videoId,title,thumbnail,duration,qualities:Array,videoUrl,audioUrl}>}
 */
export async function ytInfo(url) {
  const target = String(url || '').trim();
  if (!target) throw new SkylineApiError('URL YouTube kosong');

  const { json, website } = await request('info', '/api/tools/ytdl', { url: target }, { timeout: 45000 });

  const r = json?.result || json?.data?.result || json?.data || json || {};

  const qualities = (Array.isArray(r.qualities) ? r.qualities : [])
    .map((q) => ({
      height: Number(q?.height) || null,
      label: q?.label || (q?.height ? `${q.height}p` : 'Best'),
      format: q?.format || 'mp4',
      url: absUrl(website, q?.url)
    }))
    .filter((q) => q.url);

  const videoUrl = absUrl(website, r?.video?.url);
  const audioUrl = absUrl(website, r?.audio?.url);

  return {
    videoId: r.video_id || r.videoId || '',
    title: r.title || 'YouTube',
    thumbnail: r.thumbnail || null,
    duration: r.duration || '-:--',
    seconds: Number(r.seconds || 0) || 0,
    qualities,
    videoUrl,
    audioUrl,
    raw: r
  };
}

/* ══════════════ ambil file ══════════════ */
/** Unduh audio (MP3) — info boleh dipakai ulang biar gak request 2×. */
export async function downloadAudio(url, { info, timeout = 180000, maxBytes = MAX_AUDIO_BYTES } = {}) {
  const meta = info || (await ytInfo(url));
  const link = meta.audioUrl;
  if (!link) throw new SkylineApiError('Link audio gak ada di response API');

  breakerCheck('audio');
  let bin;
  try {
    bin = await fetchBinary(link, { timeout, maxBytes });
  } catch (err) {
    if (err?.code !== 'NO_API_KEY') breakerFail('audio');
    throw err;
  }
  breakerOk('audio');

  const kind = audioExt(bin.mimetype);

  return {
    buffer: bin.buffer,
    mimetype: kind.mimetype,
    ext: kind.ext,
    title: meta.title,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    info: meta,
    source: 'skyline'
  };
}

/** Unduh video (MP4) pada kualitas tertentu (360/720/1080). */
export async function downloadVideo(url, quality, { info, timeout = 180000, maxBytes = MAX_VIDEO_BYTES } = {}) {
  const meta = info || (await ytInfo(url));

  let link = '';
  const wanted = Number(quality) || 0;
  if (wanted) {
    const exact = meta.qualities.find((q) => Number(q.height) === wanted);
    const lower = [...meta.qualities]
      .filter((q) => q.height && q.height <= wanted)
      .sort((a, b) => b.height - a.height)[0];
    link = exact?.url || lower?.url || '';
  }
  if (!link) link = meta.videoUrl || meta.qualities[0]?.url || '';
  if (!link) throw new SkylineApiError('Link video gak ada di response API');

  breakerCheck('video');
  let bin;
  try {
    bin = await fetchBinary(link, { timeout, maxBytes });
  } catch (err) {
    if (err?.code !== 'NO_API_KEY') breakerFail('video');
    throw err;
  }
  breakerOk('video');

  const kind = videoExt(bin.mimetype);

  return {
    buffer: bin.buffer,
    mimetype: kind.mimetype,
    ext: kind.ext,
    title: meta.title,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    info: meta,
    source: 'skyline'
  };
}

/** Pesan ramah buat user kalau key belum diisi. */
export function keyHint(ctx) {
  const { website } = skylineCreds();
  const p = ctx?.prefix || '.';
  return (
    '⚠️ *API KEY SKYLINE BELUM ADA*\n\n' +
    'Fitur YouTube butuh API key skyline.web.id.\n\n' +
    `> Buat key gratis di *${website}* (menu Dashboard)\n\n` +
    '*Cara isi:*\n' +
    `> \`config.js\` → blok \`skyline.apikey\` (atau \`omniedit.apikey\`)\n` +
    `> atau env \`SKYLINE_API_KEY\`\n\n` +
    `Sementara ini ${p}play / ${p}yta / ${p}ytv / ${p}ytsearch masih pakai sumber cadangan (kualitas lebih rendah).`
  );
}

export default {
  skylineCreds,
  isConfigured,
  ytSearch,
  ytInfo,
  downloadAudio,
  downloadVideo,
  keyHint,
  MAX_AUDIO_BYTES,
  MAX_VIDEO_BYTES,
  SkylineKeyError,
  SkylineApiError
};
