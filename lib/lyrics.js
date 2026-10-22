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
 * Catatan: LRCLIB kadang balas 503 "Server is busy" sesaat — tunggu sebentar
 * lalu coba lagi; `fetchLyrics()` sudah retry 1× buat status 5xx.
 */

import { logger } from '../core/logger.js';

const API = 'https://lrclib.net/api';
const UA = 'skyline-JXRA/1.0 (lyrics; +https://github.com/jumra01/skyline-jxra-bot-)';
const TIMEOUT_MS = 12000;
/* LRCLIB sering balas 503 "Server is busy" sesaat — 2 retry dengan jeda
 * makin panjang (700ms → 1400ms) nyadarin sebagian besar kasus. */
const RETRY_5XX = 2;

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

/** GET JSON; retry 1× buat 5xx (LRCLIB suka 503 "busy" sesaat). */
async function getJsonRetry(path, { timeoutMs = TIMEOUT_MS } = {}) {
  let last = null;
  for (let i = 0; i <= RETRY_5XX; i += 1) {
    try {
      const res = await fetch(API + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.status === 404) return { status: 404, body: null };
      if (res.status >= 500) {
        last = { status: res.status };
        await new Promise((r) => setTimeout(r, 700 * (i + 1))); // 700ms → 1400ms
        continue;
      }
      let body = null;
      if (res.status === 200) {
        try { body = await res.json(); } catch { body = null; }
      }
      return { status: res.status, body };
    } catch (err) {
      last = { status: 0, error: err };
      if (i < RETRY_5XX) await new Promise((r) => setTimeout(r, 500));
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
  let score = similarity(wantTitle, cleanTrackTitle(rec?.trackName || rec?.name || '')) * 2.4;
  if (wantArtist) score += similarity(wantArtist, rec?.artistName || '') * 1.4;
  const candDur = Number(rec?.duration) || 0;
  if (durSec && candDur) {
    const diff = Math.abs(candDur - durSec);
    if (diff <= 3) score += 0.6;
    else if (diff <= 8) score += 0.25;
    else if (diff <= 20) score -= 0.35;
    else score -= 1;
  }
  if (rec?.syncedLyrics) score += 0.35; // synced lebih enak buat kartu
  return score;
}

/**
 * Ambil lirik lagu dari LRCLIB. Urutan:
 *   1) `/api/get` pakai duration (paling spesifik)
 *   2) `/api/get` tanpa duration (durasi YouTube bisa beda dari aslinya)
 *   3) `/api/search` lalu pilih kandidat dengan skor tertinggi
 *
 * @returns {Promise<{ok:true, synced, lines, plain, ...}|{ok:false, reason}>}
 */
export async function fetchLyrics({ title, artist = '', duration = '' } = {}) {
  const t0 = Date.now();
  const wantTitle = cleanTrackTitle(title);
  if (!wantTitle) return { ok: false, reason: 'judul kosong' };
  const wantArtist = cleanArtist(artist);
  const durSec = parseDurationSec(duration);

  const params = new URLSearchParams({ track_name: wantTitle });
  if (wantArtist) params.set('artist_name', wantArtist);
  if (durSec) params.set('duration', String(durSec));

  let r = await getJsonRetry('/get?' + params.toString());
  if (r.status !== 200 || !r.body) {
    if (durSec) { // coba tanpa duration dulu sebelum search
      params.delete('duration');
      r = await getJsonRetry('/get?' + params.toString());
    }
    if (r.status !== 200 || !r.body) {
      /* Cari dengan judul+artis dulu; kalau 0 hasil (umumnya karena "artis"
       * itu nama label/CHANNEL YouTube, mis. "HITS Records"), ulangi pakai
       * judul saja — kebukti nolong di kasus "TERAMINI #BERDAMAI". */
      const queries = [];
      if (wantArtist) queries.push(`${wantTitle} ${wantArtist}`);
      queries.push(wantTitle);
      let arr = [], s = null, picked = null;
      for (const q0 of queries) {
        const q = q0.slice(0, 120);
        s = await getJsonRetry('/search?q=' + encodeURIComponent(q));
        arr = Array.isArray(s.body) ? s.body : [];
        const ranked = arr
          .map((rec) => ({ rec, score: scoreCandidate(rec, wantTitle, wantArtist, durSec) }))
          .filter((x) => x.score > 0.3 && (x.rec?.plainLyrics || x.rec?.syncedLyrics))
          .sort((a, b) => b.score - a.score);
        if (ranked.length) { picked = ranked[0].rec; break; }
      }
      if (!picked) {
        logger.info(
          `[Lyrics] tidak ketemu "${wantTitle}"${wantArtist ? ` / ${wantArtist}` : ''} — ` +
          `get=${r.status} • search=${s?.status ?? 0} (${arr.length} hasil) • ${Date.now() - t0}ms`
        );
        return { ok: false, reason: `tidak ketemu (get ${r.status}, search ${s?.status ?? 0})` };
      }
      r = { status: 200, body: picked };
    }
  }

  const ly = normalize(r.body);
  if (!ly) return { ok: false, reason: 'lirik kosong' };
  logger.info(
    `[Lyrics] OK "${ly.trackName || wantTitle}" / ${ly.artistName || '-'} • ` +
    `${ly.synced ? `synced ${ly.lines.length} baris` : `plain ${ly.plain.split('\n').length} baris`} • ` +
    `${Date.now() - t0}ms`
  );
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
