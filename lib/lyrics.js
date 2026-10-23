/**
 * © skyline-JXRA
 * lyrics.js — klien lirik lagu LEWAT LRCLIB (https://lrclib.net) — gratis,
 * tanpa API key, dan punya lirik SYNCED (pakai timestamp `[mm:ss.xx]`),
 * jadi kartu Aurora bisa nampilin lirik kayak Spotify asli.
 *
 * Endpoint public (tanpa autentikasi):
 *   GET /api/get?track_name=&artist_name=&album_name=&duration=  → 1 lagu pas
 *   GET /api/search?q=                                           → array hasil
 *
 * Catatan: LRCLIB kadang balas 503 "Server is busy" sesaat — retry 1× sudah
 * cukup; `fetchLyrics()` punya batas waktu TOTAL (`TOTAL_BUDGET_MS`) supaya
 * kartu Aurora nggak ikut menggantung belasan detik cuma nunggu lirik, dan
 * hasil yang pernah ketemu di-cache 6 jam biar lagu yang diulang instan.
 */

import { logger } from '../core/logger.js';

const API = 'https://lrclib.net/api';
const UA = 'skyline-JXRA/1.0 (lyrics; +https://github.com/jumra01/skyline-jxra-bot-)';
const TIMEOUT_MS = 9000;
/* LRCLIB sering balas 503 "Server is busy" sesaat — 1 retry cukup. */
const RETRY_5XX = 1;
/* Batas waktu buat SELURUH proses (get + search), bukan per request. */
const TOTAL_BUDGET_MS = 26000;
/* Cache hasil sukses (6 jam) — lagu yang diputar ulang gak perlu nembak API. */
const CACHE_TTL_MS = 6 * 3600 * 1000;
const CACHE_MAX = 300;
const CACHE = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Kata umum di judul YouTube yang bikin pencarian lirik meleset. */
const STOP = new Set([
  'official', 'video', 'lyric', 'lyrics', 'audio', 'music', 'visualizer',
  'live', 'remix', 'cover', 'ft', 'feat', 'with', 'mv', 'hq', 'hd'
]);

/** "3:45" | "03:04:05" | "225" | 225 → detik (number) atau null. */
export function parseDurationSec(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw));
  const m = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] || 0), mi = Number(m[2]), s = Number(m[3]);
  return h * 3600 + mi * 60 + s;
}

/**
 * Bersihin judul YouTube biar cocok sama database lirik:
 * buang "(Official Video)", "[Lyrics]", " - Artist" di depan, "feat. X", dll.
 */
export function cleanTrackTitle(raw) {
  let t = String(raw || '').trim();
  // "#BERDAMAI" → "BERDAMAI" — simbol hashtag/mention bikin /get & /search
  // LRCLIB nihil (kebukti: query dengan '#' balas 0 hasil, tanpa '#' ketemu).
  t = t.replace(/[#@_]+/g, ' ');
  t = t.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*/g, ' ');
  t = t.replace(/\s*[-–—|]\s*(official|lyric|lyrics|audio|video|music video|visualizer|live|mv)\b.*$/ig, ' ');
  const dash = t.match(/^(.+?)\s*[-–—]\s+(.+)$/);
  if (dash && dash[1].length <= 45) t = dash[2];
  t = t.replace(/\b(feat\.?|ft\.?|with)\s+.*$/ig, ' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** Bersihin nama artis/channel: buang "(Official)" / suffix "- Topic" ala YT Music. */
export function cleanArtist(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*/g, ' ');
  t = t.replace(/\s*-\s*(topic|official|vevo|music)\s*$/ig, ' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, 45);
}

/** "[00:09.65] teks" → [{ t: 9.65, text: 'teks' }] (baris kosong dibuang). */
export function parseSynced(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const frac = m[3] ? Number('0.' + m[3]) : 0;
    const t = Number(m[1]) * 60 + Number(m[2]) + frac;
    const body = String(m[4] || '').trim();
    if (body) out.push({ t, text: body });
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

/** Kemiripan 0..1 dari token overlap dua arah (judul/artist kandidat vs minta). */
function similarity(a, b) {
  const ta = tokens(a), tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit += 1;
  return hit / Math.max(ta.length, tb.size);
}

/** GET JSON; retry 1× buat 5xx, dan TIDAK pernah lewat `deadline` total. */
async function getJsonRetry(path, { timeoutMs = TIMEOUT_MS, deadline = 0 } = {}) {
  let last = null;
  for (let i = 0; i <= RETRY_5XX; i += 1) {
    const left = deadline ? deadline - Date.now() : Infinity;
    if (left < 1200) break; // sisa waktu gak cukup buat satu request
    try {
      const res = await fetch(API + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, left)))
      });
      if (res.status === 404) return { status: 404, body: null };
      if (res.status >= 500) {
        last = { status: res.status };
        // jeda pendek, tapi jangan makan sisa waktu
        await sleep(Math.min(700 * (i + 1), Math.max(0, (deadline ? deadline - Date.now() : 5000) - 1000)));
        continue;
      }
      let body = null;
      if (res.status === 200) {
        try { body = await res.json(); } catch { body = null; }
      }
      return { status: res.status, body };
    } catch (err) {
      last = { status: 0, error: err };
      if (i < RETRY_5XX) await sleep(350);
    }
  }
  return { status: last?.status || 0, body: null, error: last?.error };
}

/** Bentuk record LRCLIB → objek seragam (atau null kalau beneran kosong). */
function normalize(rec) {
  const lines = parseSynced(rec?.syncedLyrics || '');
  const plain = String(rec?.plainLyrics || lines.map((l) => l.text).join('\n') || '').trim();
  if (!lines.length && !plain) return null;
  return {
    ok: true,
    synced: lines.length > 0,
    lines,
    plain,
    trackName: rec?.trackName || rec?.name || '',
    artistName: rec?.artistName || '',
    albumName: rec?.albumName || '',
    duration: Number(rec?.duration) || 0,
    source: 'lrclib'
  };
}

/** Skor kandidat hasil /api/search — makin tinggi makin mirip lagu yang dicari. */
function scoreCandidate(rec, wantTitle, wantArtist, durSec) {
  const titleSim = similarity(wantTitle, cleanTrackTitle(rec?.trackName || rec?.name || ''));
  const artistSim = wantArtist ? similarity(wantArtist, rec?.artistName || '') : 0;
  const candDur = Number(rec?.duration) || 0;
  const diff = durSec && candDur ? Math.abs(candDur - durSec) : null;
  let score = titleSim * 2.4 + artistSim * 1.4;
  if (diff !== null) {
    if (diff <= 3) score += 0.6;
    else if (diff <= 8) score += 0.25;
    else if (diff <= 20) score -= 0.35;
    else score -= 1;
  }
  if (rec?.syncedLyrics) score += 0.35; // synced lebih enak buat kartu
  return { score, titleSim, artistSim, diff };
}

/**
 * Pilih kandidat /api/search terbaik + GERBANG akurasi.
 *
 * Dulu ambangnya cuma `score > 0.3`, jadi "Dynasti / Adrian Khalif" bisa
 * dipasangi lirik "Skambankt" (judul mirip, artis beda total) — lirik SALAH
 * lebih parah daripada panel "tidak tersedia". Sekarang wajib:
 *  - kemiripan judul ≥ 0.5, dan
 *  - kalau artis diketahui: kemiripan artis ≥ 0.34 ATAU durasi nyaris sama
 *    (≤3 dtk) sebagai bukti kuat versi yang sama.
 */
function pickBest(arr, wantTitle, wantArtist, durSec) {
  if (!Array.isArray(arr) || !arr.length) return null;
  let best = null;
  for (const rec of arr) {
    if (!rec?.plainLyrics && !rec?.syncedLyrics) continue;
    const s = scoreCandidate(rec, wantTitle, wantArtist, durSec);
    if (s.titleSim < 0.5) continue;
    if (wantArtist && s.artistSim < 0.34 && !(s.diff !== null && s.diff <= 3)) continue;
    if (!best || s.score > best.score) best = { rec, score: s.score };
  }
  return best?.rec || null;
}

const cacheKey = (title, artist, durSec) => `${norm(title)}|${norm(artist)}|${durSec || 0}`;

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { at: Date.now(), data });
}

/**
 * Ambil lirik lagu dari LRCLIB.
 *
 * Strategi (biar cepet & tahan LRCLIB yang suka 503):
 *   1) PARALEL: `/api/get` (judul+artis+durasi) **dan** `/api/search`
 *      (judul+artis) — dulu berurutan, jadi 1x gangguan server langsung
 *      numpuk jadi puluhan detik.
 *   2) Kalau belum dapat: PARALEL lagi `/api/get` tanpa durasi + `/search`
 *      judul saja (nama "artis" di YouTube sering cuma channel/label).
 *   3) Total proses dibatasi `TOTAL_BUDGET_MS`; hasil sukses di-cache 6 jam.
 *
 * @returns {Promise<{ok:true, synced, lines, plain, ...}|{ok:false, reason}>}
 */
/** "HITS Records", "Official Music", "… - Topic": nama channel/label, bukan artis. */
const CHANNELISH = /\b(records?|record|music|musik|official|channel|tv|vevo|entertainment|label|hits|media|studio|production|productions|topic|release|distribution|network|channel)\b/i;

export async function fetchLyrics({ title, artist = '', duration = '' } = {}) {
  const t0 = Date.now();
  const wantTitle = cleanTrackTitle(title);
  if (!wantTitle) return { ok: false, reason: 'judul kosong' };
  /* "artis" dari hasil YouTube sering cuma nama CHANNEL/label ("HITS Records"),
   * dan kalau dipakai buat filter malah nolak lagu yang benar — jadi dianggap
   * tanpa artis (cocokkan judul + durasi saja). */
  const artistClean = cleanArtist(artist);
  const wantArtist = artistClean && !CHANNELISH.test(artistClean) ? artistClean : '';
  const durSec = parseDurationSec(duration);

  const key = cacheKey(wantTitle, wantArtist, durSec);
  const cached = cacheGet(key);
  if (cached) {
    logger.info(`[Lyrics] cache "${cached.trackName || wantTitle}" (${Date.now() - t0}ms)`);
    return cached;
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const getParams = new URLSearchParams({ track_name: wantTitle });
  if (wantArtist) getParams.set('artist_name', wantArtist);
  if (durSec) getParams.set('duration', String(durSec));
  const searchArtistQ = `${wantTitle} ${wantArtist}`.trim().slice(0, 120);

  // Ronde 1: get spesifik + search judul+artis, jalan BARENGAN.
  const [rGet, s1] = await Promise.all([
    getJsonRetry('/get?' + getParams.toString(), { deadline }),
    getJsonRetry('/search?q=' + encodeURIComponent(searchArtistQ), { deadline })
  ]);
  let ly = rGet.status === 200 ? normalize(rGet.body) : null;
  let picked = ly ? null : pickBest(s1.body, wantTitle, wantArtist, durSec);
  let lastGet = rGet.status;
  let lastSearch = s1.status;

  // Ronde 2: tanpa duration + search judul saja (paralel), kalau masih ada waktu.
  if (!ly && !picked && Date.now() < deadline) {
    const p2 = new URLSearchParams({ track_name: wantTitle });
    if (wantArtist) p2.set('artist_name', wantArtist);
    const [rGet2, s2] = await Promise.all([
      getJsonRetry('/get?' + p2.toString(), { deadline }),
      getJsonRetry('/search?q=' + encodeURIComponent(wantTitle.slice(0, 120)), { deadline })
    ]);
    ly = rGet2.status === 200 ? normalize(rGet2.body) : null;
    lastGet = rGet2.status;
    lastSearch = s2.status;
    if (!ly) picked = pickBest(s2.body, wantTitle, wantArtist, durSec) || picked;
  }

  if (!ly && picked) ly = normalize(picked);
  if (!ly) {
    logger.info(
      `[Lyrics] tidak ketemu "${wantTitle}"${wantArtist ? ` / ${wantArtist}` : ''} — ` +
      `get=${lastGet} • search=${lastSearch} • ${Date.now() - t0}ms`
    );
    return { ok: false, reason: `tidak ketemu (get ${lastGet}, search ${lastSearch})` };
  }

  logger.info(
    `[Lyrics] OK "${ly.trackName || wantTitle}" / ${ly.artistName || '-'} • ` +
    `${ly.synced ? `synced ${ly.lines.length} baris` : `plain ${ly.plain.split('\n').length} baris`} • ` +
    `${Date.now() - t0}ms`
  );
  cacheSet(key, ly);
  return ly;
}

/**
 * Batasin lirik biar muat di budget payload kartu rich HTML
 * (base64 unifiedResponse wajib ≤ ±26KB — lihat AGENTS.md §9.2).
 * Balikin bentuk ringkas `{ s: synced, l: [[detik, teks]], p: 'plain' }` atau null.
 *
 * Budget dihitung dari TOTAL KARAKTER teks baris — karena teks cuma hidup di
 * markup panel (JSON yang ditempel ke script kartu nanti cuma timestamp),
 * jumlah × panjang baris = ukuran markup panel ≈ payload tambahan kartu.
 */
export function capLyrics(ly, { maxLines = 40, maxLineLen = 46, maxText = 2100 } = {}) {
  if (!ly?.ok) return null;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, maxLineLen);
  let lines = (Array.isArray(ly.lines) ? ly.lines : [])
    .map((l) => ({ t: Number(l.t) || 0, text: clean(l.text) }))
    .filter((l) => l.text);
  let plain = String(ly.plain || '').split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);
  if (plain.length > maxLines) plain = plain.slice(0, maxLines);

  // Pangkas dari ekor sampai total teks muat (bagian awal lagu paling penting).
  const fits = (arr) => arr.reduce((n, l) => n + l.text.length, 0) <= maxText;
  while (lines.length > 8 && !fits(lines)) lines = lines.slice(0, Math.max(8, Math.floor(lines.length * 0.85)));
  while (plain.length > 8 && !fits(plain.map((t) => ({ text: t })))) plain = plain.slice(0, Math.max(8, Math.floor(plain.length * 0.85)));

  const payload = {
    s: lines.length > 0,
    l: lines.map((l) => [Math.round(l.t * 10) / 10, l.text]),
    // Plain cuma diisi kalau TANPA synced — kalau synced, panel pakai `l`,
    // jadi nyimpan plain juga cuma nambah payload dobel.
    p: lines.length ? '' : plain.join('\n')
  };
  if (!payload.l.length && !payload.p) return null;
  return payload;
}
