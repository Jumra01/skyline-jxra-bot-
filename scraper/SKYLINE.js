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
  constructor(message, status = 0, body = '') {
    super(message);
    this.name = 'SkylineApiError';
    this.status = status;
    this.body = String(body || '').slice(0, 220);
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
        url: v.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
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

export async function aiChatSkyline({ message, history = [], system = '', timeoutMs = 30000 } = {}) {
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

  if (!res.ok || !json) {
    breakerFail('aichat');
    throw new SkylineApiError(parseApiError(text) || `HTTP ${res.status}`, res.status, text);
  }
  if (json.status === false) {
    breakerFail('aichat');
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

  if (!res.ok || !json) {
    throw new SkylineApiError(parseApiError(text) || `HTTP ${res.status}`, res.status, text);
  }
  if (json.status === false) {
    throw new SkylineApiError(parseApiError(text) || 'API Skyline nolak request', res.status, text);
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

  const budget = Math.max(5000, Number(timeoutMs) || 60000);
  const deadline = Date.now() + budget;
  const maxAttempts = Math.max(1, Math.min(6, (Number(retries) || 0) + 1));

  let lastErr = null;
  let attempts = 0;
  let liteNext = false;

  for (let i = 1; i <= maxAttempts; i += 1) {
    const sisa = deadline - Date.now();
    if (i > 1 && sisa < 5000) break;
    attempts = i;

    try {
      const { reply, json } = await gemmaOnce(liteNext ? liteBody : body, website, Math.max(4000, sisa));

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
      const code = Number(err?.status) || 0;
      const busy = BUSY_STATUS.has(code) || /busy|try again later|overload|ramai/i.test(String(err?.message || ''));
      const retryable = busy || RETRY_STATUS.has(code) || (code === 0 && /timeout|konek/i.test(String(err?.message || '')));

      if (!retryable || i >= maxAttempts) break;

      // Percobaan berikutnya = terakhir? Pakai payload ringan (khusus "ramai").
      liteNext = busy && i >= maxAttempts - 1;

      // Jeda: 0,9s → 1,8s, yang "ramai" 1,5s → 3s (+ jitter) biar server
      // sempat lega — dulu cuma 0,6s/1,2s jadi sering nabrak lagi.
      // "Ramai" biasanya sembuh 10-20 detik → jeda makin panjang (1,5s → 5s)
      // biar total tunggu masih di bawah `timeoutMs` tapi cukup sabar.
      const base = busy ? 1200 * i + 300 : 600 * i;
      await sleep(Math.min(busy ? 5000 : 3000, base) + Math.floor(Math.random() * 300));
    }
  }

  // "Ramai" bukan gangguan konfigurasi → jangan bikin breaker muter 5 menit.
  const code = Number(lastErr?.status) || 0;
  const busy = BUSY_STATUS.has(code) || /busy|try again later|overload|ramai/i.test(String(lastErr?.message || ''));
  if (!busy) breakerFail('gemma');

  if (lastErr && attempts > 1) {
    lastErr.attempts = attempts;
    lastErr.message = `${lastErr.message} (dicoba ${attempts}×)`;
  }
  throw lastErr || new SkylineApiError('Ella v2 gagal nyambung', 0);
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
  keySource,
  ytSearch,
  ytInfo,
  downloadAudio,
  downloadVideo,
  aiChatSkyline,
  gemmaChat,
  omniEdit,
  skylineSchedule,
  keyHint,
  MAX_AUDIO_BYTES,
  MAX_VIDEO_BYTES,
  SkylineKeyError,
  SkylineApiError
};
