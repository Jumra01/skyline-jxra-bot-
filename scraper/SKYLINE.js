/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * SKYLINE.js — Client API skyline.web.id (YouTube downloader + search).
 *
 * Kredensial SATU SUMBER untuk `.play`/`.yta`/`.ytv`/`.ytsearch` DAN `.omniedit`:
 *   config.js → blok `api.skyline` (website + apikey)
 *   Override env (deploy panel):
 *     SKYLINE_API_KEY / SKYLINE_API_URL
 *     (env lama OMNI_API_KEY / OMNI_WEBSITE masih diterima)
 *
 * Endpoint yang dipakai (docs skyline.web.id):
 *   GET /api/tools/yt-search?q=...&limit=...
 *   GET /api/tools/ytdl?url=...
 *   GET /api/tools/ytdl/audio?url=...                        → binary MP3
 *   GET /api/tools/ytdl/download?url=...&quality=360|720|1080 → binary MP4
 *   POST /api/ai/aichat-skyline { message, history, system, apikey } → chat AI (Ella)
 *   POST /api/ai/gemma        { message, history, system, apikey? } → chat AI (Ella v2)
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
  constructor(message, status = 0, body = '', code = '') {
    super(message);
    this.name = 'SkylineApiError';
    this.status = status;
    this.body = String(body || '').slice(0, 220);
    /* `code` = kode internal dari server (`ai_busy`, `ai_unavailable`,
     * `hourly_limit`, dll). Dipakai buat milih strategi retry — jangan
     * andelin teks pesan, teksnya bisa berubah kapan aja. */
    this.code = String(code || '');
  }
}

/* ══════════════ kredensial ══════════════ */
export function skylineCreds() {
  const conf = config.api?.skyline || {};
  // `OMNI_*` = nama env lama sebelum blok config digabung ke `api.skyline`.
  // Tetap diterima biar deployment panel yang sudah terlanjur set gak putus.
  const website = String(
    process.env.SKYLINE_API_URL || conf.website || process.env.OMNI_WEBSITE || DEFAULT_SITE
  )
    .trim()
    .replace(/\/+$/, '');
  const apikey = String(
    process.env.SKYLINE_API_KEY || conf.apikey || process.env.OMNI_API_KEY || ''
  ).trim();
  return { website, apikey };
}

export function isConfigured() {
  return !!skylineCreds().apikey;
}

/**
 * Dari mana API key-nya diambil. `env` menang atas `config.js`, jadi kalau di
 * panel masih nyangkut env lama, key di config nggak kepakai sama sekali.
 */
export function keySource() {
  if (String(process.env.SKYLINE_API_KEY || '').trim()) return 'env SKYLINE_API_KEY';
  if (String(process.env.OMNI_API_KEY || '').trim()) return 'env OMNI_API_KEY (lama)';
  if (String(config.api?.skyline?.apikey || '').trim()) return 'config.js';
  return 'kosong';
}

/**
 * Sidik jari API key buat log/tes: cukup buat mastiin key mana yang kepakai
 * (mis. `sky_ol19bo2…of1rl`), sengaja bukan key utuh.
 */
export function keyTag() {
  const k = String(skylineCreds().apikey || '');
  if (!k) return 'kosong';
  if (k.length <= 14) return `${k.slice(0, 4)}…${k.slice(-2)}`;
  return `${k.slice(0, 11)}…${k.slice(-4)} (${k.length} char)`;
}

/**
 * Terjemahan error Skyline → sebab + saran, biar log gampang dibaca orang
 * yang nggak hafal kode HTTP.
 * @returns {{ headline: string, reason: string, action: string }}
 */
export function explainSkylineError(err) {
  const status = Number(err?.status) || 0;
  const msg = String(err?.message || err || '').trim();
  const low = msg.toLowerCase();

  if (err?.code === 'NO_API_KEY' || status === 401) {
    return {
      headline: 'API key kosong / tidak dikirim',
      reason: 'server skyline.web.id nolak karena tidak ada API key yang valid di request',
      action: `isi api.skyline.apikey di config.js atau env SKYLINE_API_KEY (sekarang: ${keySource()})`
    };
  }
  if (status === 403) {
    return {
      headline: 'API key ditolak',
      reason: 'key-nya terbaca tapi tidak berlaku (salah ketik, dicabut, atau beda server)',
      action: `pakai key dari dashboard skyline.web.id (dipakai bot: ${keyTag()})`
    };
  }
  if (status === 402) {
    return {
      headline: 'Kuota / credit habis',
      reason: 'key masih valid tapi jatah pemakaiannya sudah habis',
      action: 'top-up / naikkan limit key di dashboard, atau pakai key lain'
    };
  }
  if (err?.code === 'hourly_limit' || err?.code === 'total_limit') {
    return {
      headline: 'Kuota key habis (rate limit)',
      reason: `key ${keyTag()} udah lewat batas pemakaian (per jam / 24 jam) — bukan server penuh`,
      action: 'tunggu reset jam-an, kurangi frekuensi chat, atau pakai key tier lebih tinggi'
    };
  }
  if (status === 429 || status === 503 || /busy|overload|ramai|try again later/i.test(low)) {
    return {
      headline: 'Server sedang penuh (bukan bug bot)',
      reason: 'antrean model AI di server skyline.web.id penuh atau key kena batas laju',
      action: 'tunggu beberapa detik (bot sudah retry otomatis), atau naikkan concurrency/kuota di sisi server'
    };
  }
  if (status === 502 || status === 504) {
    return {
      headline: 'Gateway server bermasalah',
      reason: 'server di depan model tidak dapat balasan tepat waktu (edge timeout / model kelamaan)',
      action: 'coba lagi; kalau sering, cek timeout/worker di server skyline'
    };
  }
  if (status === 404) {
    return {
      headline: 'Endpoint tidak ketemu',
      reason: 'path API berubah atau salah tulis',
      action: 'cek path di docs skyline.web.id (bot pakai GET/POST sesuai dokumentasi)'
    };
  }
  if (status >= 500) {
    return {
      headline: `Server error (HTTP ${status})`,
      reason: 'kesalahan di sisi server, bukan dari request bot',
      action: 'coba lagi nanti; kalau tetap, cek log server skyline'
    };
  }
  if (!status && /timeout|kelamaan/i.test(low)) {
    return {
      headline: 'Timeout',
      reason: 'server tidak menjawab sampai batas waktu bot (±60 detik)',
      action: 'coba lagi; kalau sering, cek beban/worker model di server'
    };
  }
  if (!status) {
    return {
      headline: 'Koneksi ke skyline.web.id gagal',
      reason: 'jaringan bot tidak bisa menjangkau server (DNS, firewall, atau server down)',
      action: 'tes dari server bot: curl -sS https://skyline.web.id/api/status'
    };
  }
  return { headline: `Gagal (HTTP ${status})`, reason: msg || 'tanpa keterangan dari server', action: 'cek pesan server di atas' };
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

function parseApiPayload(body) {
  if (!body) return { message: '', code: '' };
  try {
    const obj = JSON.parse(body);
    return {
      message: String(obj.error || obj.detail || obj.message || '').trim(),
      code: String(obj.code || '').trim()
    };
  } catch {
    return { message: String(body).trim().slice(0, 160), code: '' };
  }
}

function parseApiError(body) {
  return parseApiPayload(body).message;
}

/* ══════════════ gerbang global (anti-limit) ══════════════ */
/**
 * Semua request ke skyline.web.id lewat gerbang ini: waktu MULAI tiap request
 * dijatah minimal `GATE_MIN_GAP` ms biar nggak nembak barengan (itu pemicu
 * 429/503 "AI is busy"), tapi request tetap boleh jalan paralel.
 */
const GATE_MIN_GAP = 350;
let gateNextSlot = 0;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export function skylineSchedule(fn) {
  const now = Date.now();
  const slot = Math.max(now, gateNextSlot);
  gateNextSlot = slot + GATE_MIN_GAP;
  const delay = slot - now;
  return (delay > 0 ? sleepMs(delay) : Promise.resolve()).then(fn);
}

/** Request yang identik & barengan cukup sekali (2 user `.play` lagu sama). */
const inflight = new Map();
function dedupe(key, fn) {
  const cur = inflight.get(key);
  if (cur) return cur;
  const p = fn();
  inflight.set(key, p);
  const clear = () => {
    if (inflight.get(key) === p) inflight.delete(key);
  };
  p.then(clear, clear);
  return p;
}

/** Status yang artinya "coba lagi", bukan "rusak". */
const RETRY_CODES = new Set([429, 502, 503, 504]);

async function requestOnce(url, { timeout = 30000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'Timeout nunggu API Skyline' : `Gagal konek API Skyline (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const text = await res.text();

  if (res.status === 401) {
    throw new SkylineApiError(parseApiError(text) || 'API key Skyline kosong', res.status, text);
  }
  if (res.status === 403) {
    throw new SkylineApiError(parseApiError(text) || 'API key Skyline ditolak', res.status, text);
  }
  if (!res.ok) {
    throw new SkylineApiError(parseApiError(text) || `HTTP ${res.status}`, res.status, text);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SkylineApiError('Balasan API Skyline gak bisa dibaca', res.status, text);
  }

  if (json?.status === false || json?.success === false) {
    throw new SkylineApiError(parseApiError(text) || 'API Skyline nolak request', res.status, text);
  }

  return json;
}

/**
 * Jalanin `fn` dengan breaker + retry untuk status "ramai" (429/502/503/504).
 * Breaker sengaja TIDAK dihitung untuk status ramai — biar 503 sesaat nggak
 * bikin fitur mati 5 menit.
 */
async function withRetry(kind, fn, retries = 2) {
  breakerCheck(kind);
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const out = await fn();
      breakerOk(kind);
      return out;
    } catch (err) {
      lastErr = err;
      const code = Number(err?.status) || 0;
      if (RETRY_CODES.has(code) && i < retries) {
        await sleepMs(800 * (i + 1) + Math.floor(Math.random() * 300));
        continue;
      }
      if (code !== 401 && code !== 403 && !RETRY_CODES.has(code)) breakerFail(kind);
      throw err;
    }
  }
  throw lastErr;
}

async function request(kind, path, params, { timeout = 30000, retries = 2 } = {}) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new SkylineKeyError(website);

  const qs = new URLSearchParams({ ...params, apikey });
  const url = `${website}${path}?${qs.toString()}`;

  return dedupe(url, () =>
    withRetry(kind, () => skylineSchedule(() => requestOnce(url, { timeout })), retries)
  ).then((json) => ({ json, website, apikey }));
}

async function fetchBinary(url, { timeout = 180000, maxBytes = MAX_VIDEO_BYTES } = {}) {
  const { website } = skylineCreds();
  const target = absUrl(website, url);

  let res;
  try {
    res = await skylineSchedule(() =>
      fetch(target, {
        headers: { Accept: '*/*', 'User-Agent': UA },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow'
      })
    );
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
  const { json, website } = await request('search', '/api/tools/yt-search', { q, limit: String(n) }, { timeout: 30000 });

  const list = json?.result || json?.data?.result || json?.data || [];
  if (!Array.isArray(list)) return [];

  return list
    .filter((v) => v && (v.url || v.video_id))
    .map((v) => {
      const videoId = v.video_id || v.videoId || '';
      return {
        videoId,
        // Pakai URL kanonik dari videoId — kalau API balikin URL relatif
        // (`/watch?v=…`) atau link share, endpoint audio bisa bingung dan
        // malah balas halaman HTML. Fallback: absolutkan URL mentahnya.
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : absUrl(website, v.url),
        title: v.title || 'Tanpa judul',
        channel: v.channel || v.author || '-',
        artist: v.channel || v.author || '-',
        duration: v.duration || '-:--',
        seconds: Number(v.seconds || 0) || 0,
        views: v.views || '-',
        // Bisa jadi URL relatif dari API → jadikan absolut biar bisa di-fetch.
        thumbnail: absUrl(website, v.thumbnail) || null,
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
    thumbnail: absUrl(website, r.thumbnail) || null,
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

/* ══════════════ Omni Editor (edit gambar) ══════════════ */
/**
 * POST /api/ai/omniedit — body `{ image_url, prompt, apikey }`, balasan binary
 * gambar (atau JSON error). Dipakai `.omniedit`, jadi edit gambar ikut gerbang
 * + retry yang sama dengan fitur Skyline lain.
 */
export const OMNI_EDIT_PATH = '/api/ai/omniedit';

export async function omniEdit({ image, prompt, timeout = 180000, retries = 1 } = {}) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new SkylineKeyError(website);

  const img = String(image || '').trim();
  const text = String(prompt || '').trim();
  if (!img) throw new SkylineApiError('Gambar kosong', 400);
  if (!text) throw new SkylineApiError('Prompt kosong', 400);

  return withRetry(
    'omniedit',
    async () => {
      let res;
      try {
        res = await skylineSchedule(() =>
          fetch(`${website}${OMNI_EDIT_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', Accept: 'image/*', 'User-Agent': UA },
            body: JSON.stringify({ image_url: img, prompt: text.slice(0, 2000), apikey }),
            signal: AbortSignal.timeout(timeout)
          })
        );
      } catch (err) {
        const msg = err?.name === 'TimeoutError'
          ? 'Server Omni Editor kelamaan (timeout)'
          : `Gagal konek API Skyline (${err?.message || err})`;
        throw new SkylineApiError(msg, 0);
      }

      const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (res.ok && ct.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new SkylineApiError('Hasil edit kosong dari server', res.status);
        return { buffer: buf, mimetype: ct };
      }

      const body = await res.text().catch(() => '');
      throw new SkylineApiError(parseApiError(body) || `Gagal ngolah gambar (HTTP ${res.status})`, res.status, body);
    },
    retries
  );
}

/* ══════════════ AI gambar: Nanobana (edit) & Super HD (upscale) ══════════════
 *
 *   GET /api/ai/nanobana?url=<gambar_publik>&prompt=<teks>&apikey=<key>
 *   GET /api/ai/superhd?url=<gambar_publik>&apikey=<key>
 *
 * Keduanya balikin BINER gambar (bukan JSON). Sama seperti fitur Skyline lain,
 * request lewat gerbang `skylineSchedule()` + retry status ramai, dan butuh
 * gambar yang bisa diakses publik (pakai `lib/uploadImage.js` dulu).
 */
export const NANO_BANANA_PATH = '/api/ai/nanobana';
export const SUPER_HD_PATH = '/api/ai/superhd';

async function imageApi(path, params, timeout) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new SkylineKeyError(website);

  const qs = new URLSearchParams({ ...params, apikey }).toString();
  let res;
  try {
    res = await skylineSchedule(() =>
      fetch(`${website}${path}?${qs}`, {
        headers: { Accept: 'image/*', 'User-Agent': UA },
        signal: AbortSignal.timeout(timeout)
      })
    );
  } catch (err) {
    const msg = err?.name === 'TimeoutError'
      ? 'Server AI gambar kelamaan (timeout)'
      : `Gagal konek API Skyline (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (res.ok && ct.startsWith('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new SkylineApiError('Hasil gambar kosong dari server', res.status);
    return { buffer: buf, mimetype: ct };
  }

  const body = await res.text().catch(() => '');
  throw new SkylineApiError(parseApiError(body) || `Gagal ngolah gambar (HTTP ${res.status})`, res.status, body);
}

/* ══════════════ Upload CDN (buat gambar yang butuh URL publik) ══════════════
 *
 *   POST /api/tools/cdn-upload  (multipart: file) + Authorization: Bearer <key>
 *   → { data: { url: '/uploads/<file>' } }  → dijadikan URL absolut.
 *
 * Nanobana & Super HD butuh URL gambar publik; upload lewat server sendiri
 * (satu pintu, sama kayak fitur Skyline lain) lebih awet daripada hosting luar.
 */
export const CDN_UPLOAD_PATH = '/api/tools/cdn-upload';

export async function uploadImage(buffer, { mimetype = 'image/jpeg', filename = 'image.jpg', timeout = 60000 } = {}) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new SkylineKeyError(website);
  if (!buffer?.length) throw new SkylineApiError('File kosong', 400);

  const form = new FormData();
  const name = /\.[a-z0-9]{2,5}$/i.test(filename)
    ? filename
    : `${filename}${mimetype.includes('png') ? '.png' : mimetype.includes('webp') ? '.webp' : mimetype.includes('gif') ? '.gif' : '.jpg'}`;
  form.append('file', new Blob([buffer], { type: mimetype }), name);

  let res;
  try {
    res = await skylineSchedule(() =>
      fetch(`${website}${CDN_UPLOAD_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apikey}`, Accept: 'application/json', 'User-Agent': UA },
        body: form,
        signal: AbortSignal.timeout(timeout)
      })
    );
  } catch (err) {
    const msg = err?.name === 'TimeoutError'
      ? 'Upload CDN kelamaan (timeout)'
      : `Gagal konek upload CDN (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const body = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(body); } catch { /* bukan JSON */ }

  const url = json?.data?.url;
  if (!res.ok || !url) {
    throw new SkylineApiError(parseApiError(body) || `Upload CDN gagal (HTTP ${res.status})`, res.status, body);
  }
  return absUrl(website, url);
}

/** Edit gambar pakai AI Nanobana. `image` = URL publik. */
export async function nanoBanana({ image, prompt, timeout = 180000, retries = 1 } = {}) {
  const img = String(image || '').trim();
  const text = String(prompt || '').trim();
  if (!img) throw new SkylineApiError('Gambar kosong', 400);
  if (!text) throw new SkylineApiError('Prompt kosong', 400);
  return withRetry(
    'nanobana',
    () => imageApi(NANO_BANANA_PATH, { url: img, prompt: text.slice(0, 1000) }, timeout),
    retries
  );
}

/** Naikin kualitas gambar (AI upscale). `image` = URL publik. */
export async function superHd({ image, timeout = 180000, retries = 1 } = {}) {
  const img = String(image || '').trim();
  if (!img) throw new SkylineApiError('Gambar kosong', 400);
  return withRetry('superhd', () => imageApi(SUPER_HD_PATH, { url: img }, timeout), retries);
}

/* ══════════════ AI chat (Ella) ══════════════ */

/**
 * POST /api/ai/aichat-skyline — chat AI teks (otak fitur `.ella`).
 *
 *   body: { message (wajib, ≤4000), history (≤10 pesan), system (≤3000),
 *           apikey (wajib) }
 *   resp: { status, reply, blocked, took_ms }
 *
 * Ella memakai kredensial yang sama dengan YouTube dan Omni Editor:
 * `api.skyline.apikey` atau env `SKYLINE_API_KEY`.
 */
export const AI_CHAT_PATH = '/api/ai/aichat-skyline';

export async function aiChatSkyline({ message, history = [], system = '', timeoutMs = 30000, retries = 2 } = {}) {
  const teks = String(message || '').trim();
  if (!teks) throw new SkylineApiError('Pesan kosong', 400);

  const { website, apikey } = skylineCreds();
  if (!apikey) throw new SkylineKeyError(website);

  breakerCheck('aichat');

  const body = { message: teks.slice(0, 4000), apikey };
  if (Array.isArray(history) && history.length) {
    body.history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .slice(-10)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  }
  if (system) body.system = String(system).slice(0, 3000);

  /* 503/429 "ramai" itu sementara → diulang sebentar dengan jeda naik;
   * "ramai" tidak dihitung ke breaker (sama kayak Gemma). */
  const maxTries = Math.max(1, Math.min(5, (Number(retries) || 0) + 1));
  let lastErr = null;

  for (let i = 1; i <= maxTries; i += 1) {
    try {
      return await aiChatOnce(body, website, timeoutMs);
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status) || 0;
      const busy = BUSY_STATUS.has(status) || /busy|try again later|overload|ramai/i.test(String(err?.message || ''));
      const retryable = busy
        || RETRY_STATUS.has(status)
        || (status === 0 && /timeout|konek/i.test(String(err?.message || '')));
      if (!retryable || i >= maxTries) throw err;
      const jeda = Math.min(6000, busy ? 2000 * i : 700 * i) + Math.floor(Math.random() * 300);
      await sleep(jeda);
    }
  }
  throw lastErr || new SkylineApiError('Ella gagal nyambung', 0);
}

/** Satu percobaan request ke /api/ai/aichat-skyline (otak Ella v1). */
async function aiChatOnce(body, website, timeoutMs) {
  let res;
  try {
    res = await skylineSchedule(() =>
      fetch(`${website}${AI_CHAT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    );
  } catch (err) {
    breakerFail('aichat');
    const msg = err?.name === 'TimeoutError'
      ? 'Ella kelamaan mikir (timeout)'
      : `Gagal konek API Skyline (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ditangani di bawah */
  }

  /* "Ramai" (429/503) bukan rusak → jangan bikin breaker muter 5 menit. */
  const ramai = BUSY_STATUS.has(res.status);
  if (!res.ok || !json) {
    if (!ramai) breakerFail('aichat');
    throw new SkylineApiError(parseApiError(text) || `HTTP ${res.status}`, res.status, text);
  }
  if (json.status === false) {
    if (!ramai) breakerFail('aichat');
    throw new SkylineApiError(parseApiError(text) || 'API Skyline nolak request', res.status, text);
  }

  const reply = String(json.reply || '').trim();
  if (!reply) {
    breakerFail('aichat');
    throw new SkylineApiError('Balasan AI kosong', res.status, text);
  }

  breakerOk('aichat');
  return {
    reply,
    blocked: Boolean(json.blocked),
    tookMs: Number(json.took_ms) || 0,
    website
  };
}

/* ══════════════ AI chat (Ella v2 — Gemma) ══════════════ */

/**
 * POST /api/ai/gemma — chat AI teks model Gemma (otak fitur `.ella2`).
 *
 *   body: { message (wajib, ≤4000), history (≤10 pesan), system (≤3000),
 *           apikey (opsional — tanpa key dihitung per IP) }
 *   resp: { status, model, reply, took_ms }
 *
 * Model besar → balasan bisa 10-25 detik, jadi default timeout dibikin lega.
 * Kalau `api.skyline.apikey` kosong, request tetap jalan (rate limit per IP).
 */
export const AI_GEMMA_PATH = '/api/ai/gemma';

/** Status yang artinya "server lagi ramai" — layak dicoba ulang, bukan gangguan permanen. */
const BUSY_STATUS = new Set([429, 503]);
/** Status gangguan sementara lain (gateway/edge) yang juga layak diulang. */
const RETRY_STATUS = new Set([502, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Satu percobaan request ke endpoint Gemma. */
/* Gemma: model berat, upstream cuma sanggup beberapa request sekaligus —
 * chat berbeda diantre (antrean dilepas tiap percobaan, bukan seluruh retry)
 * supaya bot sendiri nggak jadi biang "AI is busy". */
let gemmaChain = Promise.resolve();
/* Statistik antrean. Dipakai plugin buat nolak cepat waktu antrean panjang,
 * biar user ga nunggu 120 dtk cuma buat dapat pesan "ramai". */
let gemmaInFlight = 0;
let gemmaQueued = 0;

function gemmaSlot(fn) {
  gemmaQueued += 1;
  const runNow = async () => {
    gemmaQueued = Math.max(0, gemmaQueued - 1);
    gemmaInFlight += 1;
    try {
      return await fn();
    } finally {
      gemmaInFlight = Math.max(0, gemmaInFlight - 1);
    }
  };
  const run = gemmaChain.then(runNow, runNow);
  gemmaChain = run.then(() => {}, () => {});
  return run;
}

/** Berapa request yang sedang jalan / nunggu di antrean Gemma. */
export function gemmaLoad() {
  return { inFlight: gemmaInFlight, queued: gemmaQueued };
}

async function gemmaOnce(body, website, timeoutMs) {
  let res;
  try {
    res = await skylineSchedule(() =>
      fetch(`${website}${AI_GEMMA_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    );
  } catch (err) {
    const msg = err?.name === 'TimeoutError'
      ? 'Ella v2 kelamaan mikir (timeout)'
      : `Gagal konek API Skyline (${err?.message || err})`;
    throw new SkylineApiError(msg, 0);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ditangani di bawah */
  }

  const payload = parseApiPayload(text);
  if (!res.ok || !json) {
    throw new SkylineApiError(payload.message || `HTTP ${res.status}`, res.status, text, payload.code);
  }
  if (json.status === false) {
    throw new SkylineApiError(payload.message || 'API Skyline nolak request', res.status, text, payload.code);
  }

  const reply = String(json.reply || '').trim();
  if (!reply) throw new SkylineApiError('Balasan AI kosong', res.status, text);

  return { reply, json };
}

/**
 * Chat ke otak Gemma.
 *
 * `503 / 429 / "AI is busy"` itu artinya server lagi ramai (bukan rusak), jadi
 * otomatis diulang dengan jeda pendek — `retries` (default 2) kali. Total waktu
 * tetap dibatasi `timeoutMs` biar bot gak nunggu kebangetan, dan status "ramai"
 * sengaja TIDAK dihitung ke breaker (biar 3× ramai gak bikin fitur mati 5 menit).
 */
export async function gemmaChat({ message, history = [], system = '', timeoutMs = 60000, retries = 2 } = {}) {
  const teks = String(message || '').trim();
  if (!teks) throw new SkylineApiError('Pesan kosong', 400);

  const { website, apikey } = skylineCreds();

  breakerCheck('gemma');

  const body = { message: teks.slice(0, 4000) };
  if (apikey) body.apikey = apikey;
  if (Array.isArray(history) && history.length) {
    body.history = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .slice(-10)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  }
  if (system) body.system = String(system).slice(0, 3000);

  // Versi "ringan": tanpa riwayat + persona dipotong. Dipakai di percobaan
  // terakhir kalau server bilang ramai — payload kecil lebih gampang diterima
  // waktu server penuh / kena batas ukuran.
  const liteBody = { message: teks.slice(0, 2000) };
  if (apikey) liteBody.apikey = apikey;
  if (system) liteBody.system = String(system).slice(0, 1200);

  // Batas tunggu: `timeoutMs` <= 0 = tanpa batas (dipakai 10 menit sebagai
  // pengaman supaya bot nggak nunggu selamanya kalau server benar-benar mati).
  const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : 10 * 60 * 1000;
  const deadline = Date.now() + budget;
  const maxAttempts = Math.max(1, Math.min(10, (Number(retries) || 0) + 1));

  let lastErr = null;
  let attempts = 0;
  let liteNext = false;
  const startedAt = Date.now();
  const statuses = [];

  for (let i = 1; i <= maxAttempts; i += 1) {
    const sisa = deadline - Date.now();
    if (sisa <= 1000) break;
    attempts = i;

    try {
      // Satu percobaan boleh lama (maks 90 dtk); sisa waktu total tetap dipakai.
      const { reply, json } = await gemmaSlot(() =>
        gemmaOnce(liteNext ? liteBody : body, website, Math.min(90_000, Math.max(4000, sisa)))
      );

      breakerOk('gemma');
      return {
        reply,
        model: String(json.model || 'gemma-4-31b'),
        tookMs: Number(json.took_ms) || 0,
        attempts,
        website
      };
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status) || 0;
      const kode = String(err?.code || '');
      statuses.push(status);
      /* `ai_busy`   = antrean upstream penuh (layak diulang).
       * `ai_unavailable` = gangguan lain (boleh diulang sekali).
       * Timeout lokal juga dianggap ramai, sama kayak di server. */
      /* Kuota per jam / total ga bakal sembuh dalam hitungan detik —
       * jangan retry, langsung lempar biar user dapat pesan "dibatasi". */
      if (kode === 'hourly_limit' || kode === 'total_limit') break;
      const busy = kode === 'ai_busy'
        || BUSY_STATUS.has(status)
        || /busy|try again later|overload|ramai/i.test(String(err?.message || ''));
      const retryable = busy
        || RETRY_STATUS.has(status)
        || kode === 'ai_unavailable'
        || (status === 0 && /timeout|konek/i.test(String(err?.message || '')));

      if (!retryable || i >= maxAttempts) break;

      // Percobaan berikutnya = terakhir? Pakai payload ringan (khusus "ramai").
      liteNext = busy && (i >= maxAttempts - 1 || maxAttempts <= 2);

      // Jeda eksponensial + jitter. "Ramai" biasanya bertahan menit (antrean
      // upstream), jadi jeda busy naik sampai 30 dtk: 2s → 6s → 18s → 30s.
      // Gangguan lain (502/504) tetap singkat.
      const base = busy ? 2000 * 3 ** (i - 1) : 700 * i;
      const jeda = Math.min(busy ? 30000 : 6000, base) + Math.floor(Math.random() * 400);

      // Masih ada chat lain di antrean? Kasih giliran dulu — jangan numpuk
      // retry di atas request yang belum kelar.
      if (gemmaLoad().queued > 0) {
        const batas = Date.now() + Math.min(8000, jeda + 3000);
        while (gemmaLoad().queued > 0 && Date.now() < batas) await sleep(250);
      }
      await sleep(jeda);
    }
  }

  // "Ramai" bukan gangguan konfigurasi → jangan bikin breaker muter 5 menit.
  const status = Number(lastErr?.status) || 0;
  const busy = String(lastErr?.code || '') === 'ai_busy'
    || BUSY_STATUS.has(status)
    || /busy|try again later|overload|ramai/i.test(String(lastErr?.message || ''));
  if (!busy) breakerFail('gemma');

  const errOut = lastErr || new SkylineApiError('Ella v2 gagal nyambung', 0);
  // Info buat log: berapa kali dicoba, berapa lama, status tiap percobaan,
  // endpoint yang dipakai, dan key mana yang aktif (potongan, bukan key utuh).
  errOut.attempts = attempts || 1;
  errOut.elapsedMs = Date.now() - startedAt;
  errOut.statuses = statuses;
  errOut.serverCode = String(lastErr?.code || '');
  errOut.load = gemmaLoad();
  errOut.endpoint = AI_GEMMA_PATH;
  errOut.website = website;
  errOut.keyTag = keyTag();
  errOut.keySource = keySource();
  throw errOut;
}

/**
 * Ping ringan buat "bangunin" model — cold start upstream bisa >90 dtk dan
 * itu berakhir jadi 503 `ai_busy` di mata bot. Dipanggil berkala oleh plugin
 * `.ella2` (lihat `config.ella2.warmupMin`). Tanpa retry & tanpa breaker.
 */
export async function warmGemma({ timeoutMs = 45000 } = {}) {
  const { website, apikey } = skylineCreds();
  if (!apikey) return { ok: false, code: 'NO_API_KEY' };
  const body = { message: 'ping', system: 'Balas satu kata: ok', apikey };
  try {
    const res = await fetch(`${website}${AI_GEMMA_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) return { ok: true, status: res.status };
    const payload = parseApiPayload(await res.text());
    return { ok: false, status: res.status, code: payload.code, message: payload.message };
  } catch (err) {
    return { ok: false, status: 0, code: err?.name === 'TimeoutError' ? 'timeout' : 'konek' };
  }
}

/** Pesan ramah buat user kalau key belum diisi. */
export function keyHint(ctx) {  const { website } = skylineCreds();
  const p = ctx?.prefix || '.';
  return (
    '⚠️ *API KEY SKYLINE BELUM ADA*\n\n' +
    'Fitur YouTube butuh API key skyline.web.id.\n\n' +
    `> Buat key gratis di *${website}* (menu Dashboard)\n\n` +
    '*Cara isi:*\n' +
    `> \`config.js\` → blok \`api.skyline.apikey\`\n` +
    `> atau env \`SKYLINE_API_KEY\`\n\n` +
    `Sementara ini ${p}play / ${p}yta / ${p}ytv / ${p}ytsearch masih pakai sumber cadangan (kualitas lebih rendah).`
  );
}

export default {
  skylineCreds,
  isConfigured,
  keyTag,
  explainSkylineError,
  keySource,
  ytSearch,
  ytInfo,
  downloadAudio,
  downloadVideo,
  aiChatSkyline,
  gemmaChat,
  omniEdit,
  nanoBanana,
  superHd,
  uploadImage,
  skylineSchedule,
  keyHint,
  MAX_AUDIO_BYTES,
  MAX_VIDEO_BYTES,
  SkylineKeyError,
  SkylineApiError
};
