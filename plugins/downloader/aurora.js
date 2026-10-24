/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aurora.js — AURORA DECK: "AURORA — UR SPECIAL PLAYER"
 */

import sharp from 'sharp';
import config from '../../config.js';
import { sendNativeHtml } from '../../lib/emeraldCard.js';
import { logger } from '../../core/logger.js';
import {
  ytSearch as skylineSearch,
  ytInfo as skylineInfo,
  skylineCreds,
  isConfigured as skylineReady
} from '../../scraper/SKYLINE.js';
import { fetchThumbBuffer } from '../../lib/ytUi.js';
import { fetchLyrics, capLyrics } from '../../lib/lyrics.js';
import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* AURORA v4 — audio CUMA lewat kartu rich HTML (tanpa pesan audio native):
 *   • audio  → unduh endpoint skyline → kompres Opus → ditanam data: URI → WebAudio.
 *   • video  → kartu HTML, link dari skyline & wajib lolos probe.
 */

const UA = 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36';

const AUDIO_FORMAT = /^(mp3|m4a|aac|ogg|wav|flac)$/i;

/* ── Audio EMBEDDED di kartu (jalur WebAudio — trik play2) ───────────────────
 * WebView kartu WA: <audio>/<video>/fetch/WS mati, WebAudio hidup → lagu
 * dikompres Opus (ffmpeg, mono 48k) lalu ditanam sebagai data: URI di HTML
 * kartu → decode sendiri → AudioContext yang muter. Rantai 48k → 32k → 24k →
 * 16k. Budget MAX_EMBED_B64 2MB base64 — jauh di bawah limit frame 16,7MB.
 * Kompres gagal / kegedean → kartu mode visual tanpa audio. */
const OPUS_CHAIN = ['48k', '32k', '24k', '16k'];
const MAX_EMBED_B64 = 2_000_000;
/* Perkiraan base64/detik per bitrate (constrained VBR, mono 48k):
 * bitrate ÷ 8 × 4/3 — dipakai ngitung trim tanpa encode aslinya dulu. */
const B64_PER_SEC = { '48k': 8_000, '32k': 5_333, '24k': 4_000, '16k': 2_667 };
/* Bitrate pas trim (lagu lebih panjang dari yang muat di budget): tengah
 * — 48k kependekan buat lagu panjang, 16k terlalu jelek. */
const TRIM_BITRATE = '24k';
/* Batas keras frame WhatsApp (Noise) — dari error asli:
 * "frame is too large: 24148412 bytes (max allowed: 16777215)". */
const WA_FRAME_MAX = 16_777_215;
/* Hard-cap base64 audio asli. Pipeline kartu memperbesar ±4×
 * (html → JSON → base64 → proto/binary node), jadi batas aman
 * audio base64 = 16.777.215 / 4 ≈ 4,19MB. Di atas ini langsung kompres
 * opus — kartu audio 3,5MB (≈2,6MB file) masih jauh di bawah limit. */
const HARD_EMBED_B64 = 4_000_000;

/** Jalankan ffmpeg sekali → { code, stderr } (gak nge-throw biar gampang dirantai). */
function runFfmpeg(args) {
  return new Promise((resolve) => {
    let stderr = '';
    let ff;
    try { ff = spawn('ffmpeg', args); } catch (e) { resolve({ code: -1, stderr: String(e?.message || e) }); return; }
    ff.stderr?.on('data', (d) => { stderr += d.toString(); });
    ff.on('error', (e) => resolve({ code: -1, stderr: String(e?.message || e) }));
    ff.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** Buffer audio (mp3 dst) → Opus webm mono 48k. `trimSec` = potong dari awal. */
async function compressOpus(inputBuffer, { bitrate, trimSec = 0, label = 'aurora' } = {}) {
  const safe = String(label).replace(/[^a-zA-Z0-9]/g, '') || 'aurora';
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = join(tmpdir(), `au_in_${safe}_${stamp}.tmp`);
  const outPath = join(tmpdir(), `au_out_${safe}_${stamp}.webm`);
  const cleanup = async () => {
    try { await unlink(inPath); } catch { /* skip */ }
    try { await unlink(outPath); } catch { /* skip */ }
  };
  try { await writeFile(inPath, inputBuffer); }
  catch (e) { throw new Error(`tulis input ffmpeg: ${e?.message || e}`); }
  const args = [
    '-y', '-i', inPath,
    ...(trimSec > 0 ? ['-t', String(trimSec)] : []),
    '-vn', '-ac', '1', '-ar', '48000',
    // constrained VBR, BUKAN plain VBR: `-vbr on` di ffmpeg 6 nembak jauh di
    // atas target (24k → 38,9kbps terukur) → payload embed meleset dari
    // perkiraan. Constrained nempel (24k → 25,5kbps terukur).
    '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'constrained',
    '-application', 'audio', '-frame_duration', '40', '-compression_level', '10',
    outPath
  ];
  const r = await runFfmpeg(args);
  if (r.code !== 0) {
    await cleanup();
    throw new Error(`ffmpeg exit ${r.code}: ${r.stderr.slice(-220).replace(/\s+/g, ' ')}`);
  }
  try {
    const out = await readFile(outPath);
    if (!out?.byteLength) throw new Error('output kosong');
    return out;
  } finally { await cleanup(); }
}

/**
 * Video MP4 → buffer audio siap-encode. Jalur PENYELAMAT saat endpoint audio
 * skyline balas 502: endpoint VIDEO (`/ytdl/download`) pakai upstream yang
 * BERBEDA (savenow) dan mp4-nya selalu bawa track audio AAC. Urutan:
 * `-c:a copy` ke M4A → gagal (codec aneh) → re-encode MP3 128k.
 */
async function extractAudioFromVideo(mp4Buffer, label = 'aurora') {
  const safe = String(label).replace(/[^a-zA-Z0-9]/g, '') || 'aurora';
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = join(tmpdir(), `au_vid_${safe}_${stamp}.mp4`);
  const outM4a = join(tmpdir(), `au_aud_${safe}_${stamp}.m4a`);
  const outMp3 = join(tmpdir(), `au_aud_${safe}_${stamp}.mp3`);
  const cleanup = async () => {
    for (const p of [inPath, outM4a, outMp3]) { try { await unlink(p); } catch { /* skip */ } }
  };
  try { await writeFile(inPath, mp4Buffer); }
  catch (e) { throw new Error(`tulis input ffmpeg: ${e?.message || e}`); }
  try {
    // 1) ambil track audio apa adanya (AAC → M4A) — nol loss, nol re-encode
    let r = await runFfmpeg(['-y', '-i', inPath, '-vn', '-c:a', 'copy', outM4a]);
    if (r.code === 0) {
      try {
        const out = await readFile(outM4a);
        if (out?.byteLength) return { buffer: out, mimetype: 'audio/mp4', ext: 'm4a' };
      } catch { /* coba jalur mp3 */ }
    }
    // 2) fallback re-encode MP3 (nangkep codec yang gak bisa di-copy)
    r = await runFfmpeg(['-y', '-i', inPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', outMp3]);
    if (r.code === 0) {
      const out = await readFile(outMp3);
      if (out?.byteLength) return { buffer: out, mimetype: 'audio/mpeg', ext: 'mp3' };
    }
    throw new Error(`ffmpeg exit ${r.code}: ${r.stderr.slice(-180).replace(/\s+/g, ' ')}`);
  } finally { await cleanup(); }
}

/**
 * Unduh VIDEO lalu ekstrak audionya — fallback kalau endpoint audio skyline
 * balas 502. Coba 360p dulu (paling cepat & ringan), lalu 720p; satu budget
 * waktu buat seluruh rantai biar gak numpuk timeout.
 */
async function downloadAudioViaVideo(videoUrl, { timeoutMs = 180000 } = {}) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new Error('API key skyline.web.id belum diisi');
  const deadline = Date.now() + timeoutMs;
  const tried = [];
  for (const quality of [360, 720]) {
    const left = deadline - Date.now();
    if (left < 20000) { tried.push(`${quality}p waktu habis`); break; }
    const link = `${website}/api/tools/ytdl/download?url=${encodeURIComponent(videoUrl)}` +
      `&quality=${quality}&apikey=${encodeURIComponent(apikey)}`;
    try {
      const res = await fetch(link, {
        headers: { 'User-Agent': UA, Accept: 'video/*,application/octet-stream;q=0.9' },
        signal: AbortSignal.timeout(left)
      });
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok) { tried.push(`${quality}p HTTP ${res.status}`); continue; }
      if (!/^video\//.test(type)) { tried.push(`${quality}p bukan video (${type || '-'})`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) { tried.push(`${quality}p kosong`); continue; }
      const audio = await extractAudioFromVideo(buf);
      logger.info(
        `[Aurora] audio: video-fallback ${quality}p ${(buf.length / 1048576).toFixed(1)}MB → ` +
        `${audio.ext} ${(audio.buffer.length / 1048576).toFixed(2)}MB`
      );
      return { ...audio, via: 'video-fallback', finalUrl: redactUrl(link) };
    } catch (err) {
      tried.push(`${quality}p ${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 100)}`);
    }
  }
  throw new Error(`jalur video juga gagal — ${tried.join(' | ')}`);
}

/** Budget embed audio dari config (`aurora.maxEmbedKb`, default 800KB). */
function embedBudgetBytes() {
  const kb = Number(config.aurora?.maxEmbedKb);
  return Number.isFinite(kb) && kb >= 64 ? Math.floor(kb * 1024) : MAX_EMBED_B64;
}

/** Embed TANPA kompres aktif? (`aurora.embedOriginal`) */
function embedOriginalOn() {
  return Boolean(config.aurora?.embedOriginal);
}

/** Batas base64 audio ASLI (`aurora.originalMaxKb`). 0/'' = tanpa batas. */
function originalBudgetBytes() {
  const kb = Number(config.aurora?.originalMaxKb);
  return Number.isFinite(kb) && kb >= 64 ? Math.floor(kb * 1024) : 0; // 0 = tanpa batas
}

/**
 * Siapkan audio siap-embed buat kartu: { buf, b64len, bitrate, trimSec,
 * original, mimetype } atau null kalau gagal — NULL BUKAN ERROR: kartu jalan
 * tanpa pemutar.
 * Mode `preferOriginal` (`aurora.embedOriginal`): audio ASLI (mp3/m4a dari
 * skyline) ditanam apa adanya, TIDAK PERNAH dikompres — cuma nolak kalau
 * `originalMaxB64` diisi angka DAN dilewati (baru fallback opus) atau
 * ukurannya melewati HARD_EMBED_B64. Default `originalMaxB64` 0 = tanpa batas.
 */
async function prepareEmbeddedAudio(buffer, durationSec = 0, { maxB64 = MAX_EMBED_B64, preferOriginal = false, originalMaxB64 = 0, mimetype = '' } = {}) {
  if (!buffer?.length) return null;
  try {
    if (preferOriginal) {
      const b64len = Math.ceil(buffer.length * 4 / 3);
      if (b64len > HARD_EMBED_B64) {
        logger.warn(`[Aurora] audio: asli kegedean banget (${Math.round(b64len / 1024)}KB > hard-cap ${Math.round(HARD_EMBED_B64 / 1024)}KB) — fallback kompres opus`);
      } else if (originalMaxB64 > 0 && b64len > originalMaxB64) {
        logger.info(`[Aurora] audio: asli lewat batas config (${Math.round(b64len / 1024)}KB > ${Math.round(originalMaxB64 / 1024)}KB) — fallback kompres opus`);
      } else {
        logger.info(`[Aurora] audio: embed ASLI ${mimetype || 'audio/*'} • ${Math.round(b64len / 1024)}KB base64 (tanpa kompres)`);
        return { buf: buffer, b64len, bitrate: 'asli', trimSec: 0, original: true, mimetype: mimetype || 'audio/mpeg' };
      }
    }
    let best = null;
    for (const bitrate of OPUS_CHAIN) {
      const buf = await compressOpus(buffer, { bitrate });
      const b64len = Math.ceil(buf.length * 4 / 3);
      best = { buf, b64len, bitrate, trimSec: 0 };
      logger.info(`[Aurora] audio: opus ${bitrate} → ${Math.round(b64len / 1024)}KB base64`);
      if (b64len <= maxB64) return best;
    }
    // Semua bitrate masih kegedean penuh (lagu > ±7,5 menit) → potong lagu.
    const dur = Number(durationSec) || 0;
    if (dur < 60) {
      logger.warn('[Aurora] audio: embed kegedean & durasi nggak diketahui — kartu dikirim tanpa pemutar');
      return null;
    }
    const bitrate = TRIM_BITRATE;
    const trimSec = Math.min(dur - 5, Math.floor((maxB64 * 0.9) / B64_PER_SEC[bitrate]));
    if (trimSec < 30) {
      logger.warn('[Aurora] audio: trim gak masuk akal — tanpa embed');
      return null;
    }
    const buf = await compressOpus(buffer, { bitrate, trimSec });
    const b64len = Math.ceil(buf.length * 4 / 3);
    logger.info(`[Aurora] audio: trim ${trimSec}s @ ${bitrate} → ${Math.round(b64len / 1024)}KB base64`);
    if (b64len > maxB64) {
      logger.warn('[Aurora] audio: masih kegedean setelah trim — tanpa embed');
      return null;
    }
    return { buf, b64len, bitrate, trimSec };
  } catch (err) {
    logger.warn(`[Aurora] audio: kompres embed gagal — ${err?.message || err}`);
    return null;
  }
}

/** Pilih quality video paling dekat dengan yang diminta (default: tertinggi). */
function pickQuality(list, height) {
  const arr = (Array.isArray(list) ? list : []).filter((q) => q?.url);
  if (!arr.length) return null;
  if (!height) {
    return arr.slice().sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0))[0];
  }
  const exact = arr.find((q) => Number(q.height) === Number(height));
  if (exact) return exact;
  return arr.slice().sort(
    (a, b) => Math.abs((Number(a.height) || 0) - height) - Math.abs((Number(b.height) || 0) - height)
  )[0];
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return '-'; }
}

/** Link googlevideo yang punya `&ip=` cuma valid dari IP yang minta URL-nya. */
function isIpLocked(url) {
  return /[?&]ip=/i.test(String(url || ''));
}

/** URL proxy skyline dikasih `mode=stream` (inline) kalau endpoint-nya dukung. */
function withInlineMode(url) {
  try {
    const u = new URL(String(url || ''));
    if (/^skyline\.web\.id$/i.test(u.host) && /\/ytdl\//i.test(u.pathname)) u.searchParams.set('mode', 'stream');
    return u.href;
  } catch { return url; }
}

/**
 * Cek cepat apakah URL bisa diputar: ambil 2 KB pertama pakai Range lalu cancel.
 * Semua hasilnya dicatat, jadi kalau gagal sebabnya langsung kelihatan.
 */
async function probeMedia(url, label, { timeoutMs = 12000 } = {}) {
  const host = hostOf(url);
  const locked = isIpLocked(url);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { Range: 'bytes=0-2047', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const type = (r.headers.get('content-type') || '-').toLowerCase();
    const range = r.headers.get('content-range') || '';
    const total = r.headers.get('content-length') || '?';
    let first = 0;
    let snippet = '';
    try {
      const reader = r.body?.getReader();
      if (reader) {
        const chunk = await reader.read();
        first = chunk?.value?.byteLength || 0;
        if (chunk?.value && first) snippet = Buffer.from(chunk.value).subarray(0, 160).toString('utf8').replace(/\s+/g, ' ').trim();
        await reader.cancel();
      }
    } catch { /* cukup header */ }
    const ok = (r.status === 200 || r.status === 206) && /^(audio|video)\//.test(type);
    const tail = ok ? '' : ` • body="${snippet.slice(0, 140)}"`;
    const line = `[Aurora] probe ${label} → HTTP ${r.status} • ${type} • range=${range || 'TIDAK didukung'} • ${first}B/${total}B • ${Date.now() - t0}ms • host=${host}${locked ? ' • ⚠ IP-LOCKED' : ''}${tail}`;
    if (ok) logger.info(line); else logger.warn(line);
    return { ok, status: r.status, type, ranges: Boolean(range), bytes: first, host, locked };
  } catch (err) {
    logger.warn(`[Aurora] probe ${label} GAGAL — ${err?.name || 'Error'}: ${err?.message || err} • host=${host}${locked ? ' • ⚠ IP-LOCKED' : ''}`);
    return { ok: false, status: 0, type: '', ranges: false, bytes: 0, host, locked, error: err?.name || 'Error' };
  }
}

/** Link media video dari skyline (audio ga lewat sini — lihat sendAuroraAudio). */
async function resolveSource(info, format) {
  if (!skylineReady()) throw new Error('API key skyline.web.id belum diisi — Aurora butuh itu');
  const meta = await skylineInfo(info.url);
  const url = pickQuality(meta.qualities, Number(format))?.url || meta.videoUrl;
  if (!url) throw new Error('Skyline gak ngasih link video buat kualitas ' + format);
  const finalUrl = withInlineMode(url);
  logger.info(`[Aurora] video: kualitas ${format}p → ${hostOf(finalUrl)}`);
  // Video di-resolve on-demand di server (bisa 20-40 dtk), jadi timeout-nya lebih lega.
  const probe = await probeMedia(finalUrl, 'skyline-video', { timeoutMs: 45000 });
  if (!probe.ok) {
    const why = probe.error ? probe.error : `HTTP ${probe.status || 0}${probe.type ? ' ' + probe.type : ''}`;
    throw new Error(`Link video skyline gagal diputar (${why}) — cek log [Aurora] probe`);
  }
  return {
    url: finalUrl,
    title: meta.title || info.title,
    thumbnail: meta.thumbnail || info.thumbnail,
    duration: meta.duration || info.duration || '',
    via: 'skyline',
    probe,
    preview: `Sumber skyline • ${probe.type}`
  };
}

/**
 * AUDIO: `/api/tools/ytdl/audio` jalur tercepat, TAPI jalur resmi docs =
 * `GET /api/tools/ytdl` dulu lalu fetch `audio.url`. Server bisa membalas
 * halaman HTML (200 `text/html`) → rantai di bawah otomatis nyoba beberapa
 * bentuk URL lalu jatuh ke alur docs.
 */
/** URL endpoint audio skyline buat video tertentu (dipakai kartu & unduhan). */
function audioEndpoint(videoUrl) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new Error('API key skyline.web.id belum diisi');
  return `${website}/api/tools/ytdl/audio?url=${encodeURIComponent(videoUrl)}` +
    `&apikey=${encodeURIComponent(apikey)}&mode=stream`;
}

/** URL yang sama dengan satu query param dibuang (`mode=stream` dst). */
function withoutParam(url, name) {
  try {
    const u = new URL(String(url || ''));
    u.searchParams.delete(name);
    return u.href;
  } catch { return url; }
}

/** Jangan pernah bocorin apikey ke log/chat — sensor nilai query `apikey`. */
function redactUrl(url) {
  return String(url || '').replace(/([?&](?:api)?key=)[^&#]*/gi, '$1***');
}

/** Ambil + validasi satu URL audio. Error-nya nyebut judul halaman + URL final. */
async function fetchAudioBinary(link, { timeoutMs = 180000, maxBytes = 60 * 1024 * 1024, label = 'audio' } = {}) {
  const host = hostOf(link);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(link, {
      headers: { 'User-Agent': UA, Accept: 'audio/*,application/octet-stream;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new Error(`[${label}] koneksi ke ${host} gagal (${err?.name || 'Error'}: ${err?.message || err})`);
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const finalUrl = redactUrl(res.url || link);
  /* Body HTML itu yang bikin bingung: ambil judul + potongan awal biar
   * ketahuan halaman apa yang dibalikin (challenge / landing / error). */
  const readSnippet = async (n) => {
    try {
      const body = (await res.text()).slice(0, 3000);
      const title = ((body.match(/<title[^>]*>([^<]{1,140})/i) || [])[1] || '').trim();
      return { snippet: body.slice(0, n).replace(/\s+/g, ' '), title };
    } catch { return { snippet: '', title: '' }; }
  };
  if (!res.ok) {
    const { snippet, title } = await readSnippet(200);
    /* `definitive` = server sudah menjawab tegas (bukan gangguan jaringan) →
     * mengulang ke URL yang sama SEMUA percuma, jalur fallback juga menembak
     * endpoint yang sama. */
    throw Object.assign(
      new Error(`[${label}] HTTP ${res.status} • ${type || '-'}${title ? ` • title="${title}"` : ''} • final=${finalUrl} • body="${snippet}"`),
      { status: res.status, definitive: true }
    );
  }
  if (!/^audio\//.test(type)) {
    const { snippet, title } = await readSnippet(200);
    throw Object.assign(
      new Error(`[${label}] bukan audio (content-type ${type || '-'})${title ? ` • title="${title}"` : ''} • final=${finalUrl} • body="${snippet}"`),
      { status: res.status }
    );
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) {
    throw new Error(`[${label}] audio kegedean (${(len / 1048576).toFixed(1)}MB > ${(maxBytes / 1048576).toFixed(0)}MB)`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error(`[${label}] audio kosong (0 byte)`);
  if (buf.length > maxBytes) throw new Error(`[${label}] audio kegedean (${(buf.length / 1048576).toFixed(1)}MB > ${(maxBytes / 1048576).toFixed(0)}MB)`);
  logger.info(
    `[Aurora] audio: ${type} • ${(buf.length / 1048576).toFixed(2)}MB • ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s • host=${host} • jalur=${label}`
  );
  return {
    buffer: buf,
    mimetype: type.split(';')[0].trim() || 'audio/mpeg',
    ext: /mp4|m4a/.test(type) ? 'm4a' : 'mp3',
    via: label,
    finalUrl
  };
}

/**
 * Unduh audio dengan rantai fallback:
 *   1. `/api/tools/ytdl/audio?…&mode=stream` (tercepat)
 *   2. URL yang sama TANPA `mode` (param ekstra kadang bikin server balas HTML)
 *   3. alur docs: `/api/tools/ytdl` → `audio.url` (jalur `.play`/`.yta`)
 * Semua kegagalan dikumpulin → pesan error nyebut tiap jalur + sebabnya.
 */
async function downloadAudioViaSearch(videoUrl, { timeoutMs = 180000, maxBytes = 60 * 1024 * 1024 } = {}) {
  const tried = [];
  /* Satu budget waktu buat SELURUH rantai (bukan per request) — kalau endpoint
   * pertama menggantung, jalur berikutnya tetap dapat sisa waktu, bukan
   * numpuk 3× timeout. */
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(8000, deadline - Date.now());
  const attempt = async (url, label) => {
    try {
      return await fetchAudioBinary(url, { timeoutMs: left(), maxBytes, label });
    } catch (err) {
      tried.push(String(err?.message || err).slice(0, 400));
      throw err;
    }
  };

  const link = audioEndpoint(videoUrl);

  /* Server sudah jawab tegas (502 "Audio tidak bisa diunduh saat ini" dll)?
   * Jalur 2 & 3 menembak ENDPOINT YANG SAMA → pasti jawab sama: langsung
   * berhenti, jangan buang waktu percuma. */
  let definitive = null;

  try { return await attempt(link, 'ytdl/audio'); } catch (err) { if (err?.definitive) definitive = err; }

  if (!definitive) {
    // 2) endpoint langsung tanpa `mode`
    try { return await attempt(withoutParam(link, 'mode'), 'ytdl/audio tanpa mode'); } catch (err) { if (err?.definitive) definitive = err; }
  }

  // 3) alur resmi docs → audio.url (link sudah membawa apikey)
  if (!definitive) {
    let meta = null;
    try {
      meta = await skylineInfo(videoUrl);
    } catch (err) {
      tried.push(`[info] ${String(err?.message || err).slice(0, 200)}`);
    }
    if (meta?.audioUrl) {
      try { return await attempt(meta.audioUrl, 'audio.url'); } catch (err) { if (err?.definitive) definitive = err; }
    } else if (meta) {
      tried.push('[audio.url] kosong di response /api/tools/ytdl');
    }
  }

  throw Object.assign(
    new Error(`gagal ambil audio — ${tried.length} jalur dicoba: ${tried.join(' | ')}`),
    { definitive: Boolean(definitive), status: definitive?.status || 0 }
  );
}

/** Satu hasil pencarian → bentuk `info` yang dipakai handler. */
function searchResultToInfo(v) {
  return {
    url: v.url,
    title: v.title || 'Unknown',
    artist: v.artist || v.channel || 'skyline-JXRA Stream',
    thumbnail: v.thumbnail || '',
    duration: v.duration || ''
  };
}

/**
 * Pilih KANDIDAT dari hasil pencarian — bukan cuma `results[0]`.
 * Hasil teratas query DJ/remix sering berupa video LIVE atau upload yang
 * dibatasi pemiliknya (endpoint ytdl gagal buat video begitu), padahal
 * reupload lagu yang SAMA ada di hasil ke-2/ke-3 dan normal.
 *
 * Aturan:
 *  - buang `live` (audio live stream gak bisa diunduh sebagai file)
 *  - audio: buang durasi >45 menit (hampir pasti lewat batas 60MB server),
 *    tapi disimpan sebagai cadangan terakhir kalau memang cuma itu hasilnya
 *  - sisanya dipakai berurutan, maksimal `max` kandidat
 */
function pickSearchCandidates(results, { forAudio = true, max = 4 } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((v) => v && v.url);
  if (!list.length) return [];
  const skipped = [];
  const keep = [];
  const spare = [];
  for (const v of list) {
    const secs = Number(v.seconds) || 0;
    const title = String(v.title || '');
    /* API kadang gak ngisi flag `live` → deteksi dari judul juga (radio DJ
     * 24 jam biasanya nulis LIVE / 24 JAM / RADIO di judulnya). */
    const looksLive = v.live || /(^|[^\p{L}])(live|radio|24\s*jam)([^\p{L}]|$)/iu.test(title);
    if (looksLive) {
      skipped.push(`live "${title.slice(0, 40)}"`);
      continue;
    }
    if (forAudio && secs > 45 * 60) { spare.push(v); continue; }
    keep.push(v);
  }
  const picked = (keep.length ? keep : spare.length ? spare : list).slice(0, max);
  if (skipped.length) {
    logger.info(`[Aurora] search: ${skipped.length} hasil live dilewati — ${skipped.slice(0, 3).join(' | ')}`);
  }
  if (!keep.length && spare.length) {
    logger.warn('[Aurora] search: semua hasil bukan live tapi kepanjangan (>45 menit) — dicoba juga sebagai cadangan');
  }
  return picked.map(searchResultToInfo);
}

/** "3:45" / "1:02:03" → detik. Null kalau gak kebaca. */
function durToSeconds(dur) {
  const parts = String(dur || '').split(':').map((n) => parseInt(n, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null;
}

/* ══════ Tombol PLAYER di in-app browser WhatsApp (opsi ke-2) ══════
 * (1) play langsung di kartu (WebAudio), (2) tombol ini buka web player di
 * in-app browser WhatsApp ASLI (browser penuh — audio/seek/lirik sinkron).
 * API key tidak pernah masuk link chat: URL audio (berapikey) ditukar ke
 * token singkat via /api/tools/aurora-token (D1). */

/** Tukar URL audio ke token player. Null kalau gagal (tombol dilewati). */
async function mintPlayerToken(audioUrl) {
  const { website } = skylineCreds();
  try {
    const res = await fetch(`${website}/api/tools/aurora-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ url: audioUrl }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      logger.warn(`[Aurora] player: mint token HTTP ${res.status} — tombol dilewati`);
      return null;
    }
    const j = await res.json();
    if (!j?.token) {
      logger.warn('[Aurora] player: mint token balasan kosong — tombol dilewati');
      return null;
    }
    return String(j.token);
  } catch (err) {
    logger.warn(`[Aurora] player: mint token gagal — ${err?.message || err}`);
    return null;
  }
}

/**
 * Kirim tombol "▶ Buka Player" (cta_url + webview_interaction). Null-safe:
 * gagal = dilewati, kartu tetap utuh.
 */
async function sendPlayerButton(ctx, info, clean, duration) {
  const { website } = skylineCreds();
  const token = await mintPlayerToken(audioEndpoint(info.url));
  if (!token) return false;

  const params = new URLSearchParams({
    t: token,
    title: String(info.title || clean || '').slice(0, 120),
    cover: String(info.thumbnail || '').slice(0, 300)
  });
  const artist = /skyline-JXRA Stream/.test(String(info.artist || '')) ? '' : String(info.artist || '').slice(0, 80);
  if (artist) params.set('artist', artist);
  const durSec = durToSeconds(duration || info.duration);
  if (durSec) params.set('dur', String(durSec));
  const playerUrl = `${website}/aurora-player?${params.toString()}`;

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: {
        text: `🎧 *${clean}*\nPilihan kedua: buka player di browser WhatsApp — cover, seek, dan lirik sinkron.`
      },
      footer: { text: 'AURORA • skyline.web.id' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '🌐 Buka Player Web',
              url: playerUrl,
              merchant_url: playerUrl,
              webview_presentation: 'full',
              webview_interaction: true
            })
          }
        ]
      }
    }
  });
  return true;
}

/** Judul tahap progress (1→4). Dipakai kartu loading `.aurora`. */
const AURORA_STAGES = [
  '1/4 mencari lagu…',
  '2/4 mengunduh audio…',
  '3/4 menyiapkan kartu…',
  '4/4 mengirim…'
];

/** Bar blok sederhana: step 1..4 → ▓▓▓▓░░░░ dst. */
function progressBar(step, total = 4) {
  const filled = Math.max(0, Math.min(total, Math.round(Number(step) || 0)));
  return '▓'.repeat(filled) + '░'.repeat(total - filled);
}

/**
 * Progress "loading bar" dalam SATU pesan yang di-EDIT tiap tahap — bukan
 * 4 pesan terpisah (spam grup); zapo belum punya API edit tingkat tinggi,
 * jadi pakai `protocolMessage` type 14 (pola sama `lib/jhrich.js`).
 * Semua operasi progress OPSIONAL: edit gagal → command tetap jalan.
 */
function createProgress(ctx, title = '') {
  const t0 = Date.now();
  const isGroup = String(ctx.chat || '').endsWith('@g.us');
  let id = null;
  let step = 1;
  let note = AURORA_STAGES[0];
  let icon = '🎧';
  let done = false;
  let timer = null;
  /* Edit diantrekan (bukan dijalankan paralel) biar urutannya pasti: state
   * terakhir selalu yang menang, dan `finish()` benar-benar menunggu edit
   * terakhir terkirim. */
  let chain = Promise.resolve();
  let editFails = 0;

  const body = () => {
    const pct = Math.min(100, step * 25);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    return `${icon} *AURORA*${title ? ` — ${String(title).slice(0, 60)}` : ''}\n` +
      `${progressBar(step)} ${pct}%\n` +
      `${note} • ${secs}s`;
  };

  const edit = () => {
    if (!id) return chain;
    /* Di GRUP, edit pesan sendiri butuh `participant` = JID bot (pola sama
     * `lib/album.js`). Tanpa itu WhatsApp bisa mengabaikan edit-nya. */
    const participant = isGroup
      ? (ctx.client.getCurrentMeJid?.() || ctx.client.getCurrentCredentials?.()?.meJid || undefined)
      : undefined;
    const editKey = participant ? { id, participant } : { id };
    chain = chain
      .then(() => ctx.client.message.send(ctx.chat, { type: 'text', text: body() }, { editKey, noStyle: true }))
      .catch((err) => {
        editFails += 1;
        const line = '[Aurora] progress: edit gagal — ' + String(err?.message || err).slice(0, 160);
        // Kegagalan pertama wajib kelihatan di log panel (sisanya debug biar
        // gak banjir) — kalau bar diam, dari sini ketahuan sebabnya.
        if (editFails === 1) logger.warn(line); else logger.debug(line);
      });
    return chain;
  };

  return {
    /** Kirim pesan progress pertama (harus di-await biar id-nya kebaca). */
    async start() {
      try {
        /* `noStyle` = kirim teks polos, jangan dibungkus varian `.setreply`:
         * pesan ini bakal di-EDIT, dan varian (kartu/interactive) tidak bisa
         * di-edit WhatsApp. */
        const sent = await ctx.client.message.send(ctx.chat, body(), { noStyle: true });
        id = sent?.id || sent?.key?.id || null;
        if (id) {
          // Timer cuma nyegarin hitungan detik tetap jalan selama proses lama
          // (mis. server skyline nyiapin file 10-30s) — tanpa kirim pesan baru.
          timer = setInterval(() => { if (!done) edit(); }, 5000);
          timer.unref?.();
        }
        logger.debug('[Aurora] progress: pesan loading terkirim | id=' + (id || '?'));
      } catch (err) {
        logger.debug('[Aurora] progress: gagal kirim pesan loading — ' + String(err?.message || err).slice(0, 120));
      }
    },
    /** Naik ke tahap `n` (1..4) dengan catatan baru. */
    set(n, msg, newTitle) {
      step = Math.max(0, Math.min(4, Number(n) || 0));
      if (msg) note = msg;
      else if (AURORA_STAGES[step - 1]) note = AURORA_STAGES[step - 1];
      if (newTitle) title = newTitle;
      edit();
    },
    /** Selesai: bar 100% + tanda centang (pesan terakhir tetap kelihatan). */
    async finish(msg) {
      done = true;
      step = 4;
      icon = '✅';
      note = msg || 'selesai';
      clearInterval(timer);
      await edit();
    },
    /** Gagal: bar berhenti di tahap terakhir + tanda silang. */
    async fail(msg) {
      done = true;
      icon = '❌';
      note = String(msg || 'gagal').slice(0, 120);
      clearInterval(timer);
      await edit();
    }
  };
}

async function sendAuroraAudio(ctx, infos, format, progress = null) {
  const t0 = Date.now();
  const candidates = (Array.isArray(infos) ? infos : [infos]).filter((i) => i?.url);
  let audio = null;
  let info = candidates[0] || null;
  const fails = [];
  let videoFallbackTried = false;
  /* Anggaran waktu TOTAL buat seluruh kandidat (bukan per request): endpoint
   * skyline bisa nyiapin file 10-30s, tapi kalau semua kandidat bermasalah
   * command jangan menggantung belasan menit. */
  const deadline = Date.now() + 240_000;
  const leftMs = () => Math.max(20_000, deadline - Date.now());
  progress?.set(2, undefined, info?.title);

  /* Input URL manual = judul placeholder ("Aurora Stream") → lirik & judul
   * kartu ikut salah. Ambil metadata asli PARALEL dengan unduhan supaya
   * tidak menambah waktu tunggu (di-await setelah audio dapat). */
  const isPlaceholder = /^Aurora Stream$/i.test(String(info?.title || '').trim());
  const metaP = isPlaceholder
    ? skylineInfo(info.url).catch((err) => {
        logger.warn(`[Aurora] meta: ytInfo gagal — ${String(err?.message || err).slice(0, 160)}`);
        return null;
      })
    : null;

  /* Satu video gagal TIDAK berarti lagunya gak ada: coba kandidat
   * pencarian berikutnya (reupload lagu yang sama). Kandidat pertama dicoba
   * 2× (gangguan jaringan sesaat), sisanya sekali — biar command gak
   * menggantung lama kalau semua memang bermasalah. */
  for (let i = 0; i < candidates.length && !audio; i += 1) {
    const cand = candidates[i];
    const tries = i === 0 ? 2 : 1;
    let definitive = false;
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      try {
        logger.info(
          `[Aurora] audio: unduh kandidat ${i + 1}/${candidates.length} (percobaan ${attempt}) ` +
          `"${String(cand.title || '').slice(0, 70)}" url=${String(cand.url || '').slice(0, 60)}`
        );
        audio = await downloadAudioViaSearch(cand.url, { timeoutMs: leftMs() });
        info = cand;
        if (i > 0) {
          logger.info(`[Aurora] audio: kandidat ${i + 1} berhasil — "${String(cand.title || '').slice(0, 60)}"`);
        }
        break;
      } catch (err) {
        fails.push(`#${i + 1} ${String(err?.message || err).slice(0, 260)}`);
        logger.warn(
          `[Aurora] audio: kandidat ${i + 1}/${candidates.length} GAGAL (percobaan ${attempt}/${tries}) — ` +
          `status=${err?.status || 0} • pesan=${String(err?.message || err).slice(0, 500)}`
        );
        /* Server sudah jawab tegas (502 dll) → mengulang kandidat yang SAMA
         * pasti jawab sama — buang waktu doang. Langsung ke kandidat berikut
         * atau jalur video-fallback. */
        if (err?.definitive) { definitive = true; break; }
        if (attempt < tries) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    /* Endpoint audio skyline balas tegas "tidak bisa diunduh"? Endpoint VIDEO
     * pakai upstream yang BERBEDA (savenow) dan masih sehat → ambil video
     * kandidat ini, ekstrak track audio-nya. Cuma dicoba sekali per perintah. */
    if (!audio && definitive && !videoFallbackTried) {
      videoFallbackTried = true;
      progress?.set(2, 'audio 502 — coba lewat video…', cand.title);
      try {
        audio = await downloadAudioViaVideo(cand.url, { timeoutMs: leftMs() });
        info = cand;
        logger.info(`[Aurora] audio: kandidat ${i + 1} dapat lewat VIDEO fallback (audio endpoint 502)`);
        break;
      } catch (err) {
        fails.push(`#vid ${String(err?.message || err).slice(0, 200)}`);
        logger.warn(`[Aurora] audio: video-fallback kandidat ${i + 1} GAGAL — ${String(err?.message || err).slice(0, 300)}`);
      }
    }
    if (Date.now() >= deadline) {
      logger.warn('[Aurora] audio: anggaran waktu 240s habis — berhenti nyoba kandidat');
      break;
    }
  }
  if (!audio) {
    const lastErr = fails[fails.length - 1] || '';
    throw new Error(
      `Gagal unduh audio dari skyline (${candidates.length} kandidat dicoba)${fails.length > 1 ? `: ${fails.join(' | ')}` : `: ${lastErr}`}` +
      '\nLagu DJ/remix yang cuma ada versi live sering gak bisa diunduh — coba kirim link YouTube-nya langsung: `.aurora <url>`'
    );
  }

  /* Metadata asli buat input URL: kartu jadi pakai judul yang benar dan
   * `wantLyrics` di bawah tidak lagi mati karena placeholder. Timeout 12 dtk
   * — kalau ytInfo lambat, kartu tetap jalan dengan data seadanya. */
  if (metaP) {
    let meta = null;
    try {
      meta = await Promise.race([
        metaP,
        new Promise((resolve) => {
          const tm = setTimeout(() => resolve(null), 12000);
          tm.unref?.();
        })
      ]);
    } catch { meta = null; }
    if (meta?.title && meta.title !== 'YouTube') {
      info = {
        ...info,
        title: meta.title,
        duration: meta.duration && meta.duration !== '-:--' ? meta.duration : info.duration,
        thumbnail: info.thumbnail || meta.thumbnail || ''
      };
      logger.info(`[Aurora] meta: input URL → "${String(info.title).slice(0, 70)}" • ${info.duration || '?'}`);
    }
  }

  const clean = String(info.title || 'Audio').replace(/[\\/:*?"<>|]/g, '').slice(0, 90);
  const duration = String(info.duration || '');

  /* Lagu cuma lewat kartu rich HTML (audio embed WebAudio di dalam kartu).
   * Lirik (LRCLIB) diambil PARALEL sama cover biar nambah nol waktu tunggu. */
  let cover = null;
  const wantLyrics = String(info.title || '') !== 'Aurora Stream'; // input URL manual = judul palsu
  progress?.set(3, 'menyiapkan kartu (lirik + audio)…', info.title);
  /* Embed audio (WebAudio) ikut PARALEL — ffmpeg jalan di local, nol jaringan,
   * jadi nambah nol waktu tunggu. Gagal = null → kartu mode visual biasa. */
  const [coverRes, lyricRes, embedRes] = await Promise.all([
    fetchThumbBuffer(info.thumbnail, { width: 640 }).then(
      (c) => {
        logger.info(`[Aurora] audio: cover ${c ? `OK ${Math.round(c.buffer.length / 1024)}KB` : 'kosong'}`);
        return c;
      },
      (err) => {
        logger.warn(`[Aurora] audio: cover gagal — ${err?.message || err}`);
        return null;
      }
    ),
    wantLyrics
      ? fetchLyrics({
          title: info.title,
          // Placeholder "skyline-JXRA Stream" (input URL manual) jangan dicari.
          artist: /skyline-JXRA Stream/.test(String(info.artist || '')) ? '' : info.artist,
          duration: info.duration
        }).then(
          // Lirik diambil UTUH (batas default 40 baris bikin kepotong) —
          // pengaman terakhirnya = guard payload di mkCard, jadi aman.
          (ly) => {
            if (!ly?.ok) {
              logger.info(`[Aurora] audio: lirik tidak ada — ${ly?.reason || 'kosong'}`);
              return null;
            }
            return capLyrics(ly, { maxLines: 250, maxLineLen: 120, maxText: 16000 });
          },
          (err) => {
            logger.warn(`[Aurora] lirik: gagal — ${err?.name || 'Error'}: ${err?.message || err}`);
            return null;
          }
        )
      : Promise.resolve(null),
    prepareEmbeddedAudio(audio.buffer, durToSeconds(duration) || 0, {
      maxB64: embedBudgetBytes(),
      preferOriginal: embedOriginalOn(),
      originalMaxB64: originalBudgetBytes(),
      mimetype: audio.mimetype
    })
  ]);
  cover = coverRes;
  const lyricCard = lyricRes;
  const embed = embedRes || null;
  if (embed) {
    logger.info(
      `[Aurora] audio: embed WebAudio siap — ${embed.original ? `ASLI ${embed.mimetype}` : `opus ${embed.bitrate}`} • ` +
      `${Math.round(embed.b64len / 1024)}KB base64${embed.trimSec ? ` • trim ${embed.trimSec}s` : ''}`
    );
  } else {
    logger.info('[Aurora] audio: tanpa embed — kartu mode visual tanpa audio (tombol play = hint)');
  }
  if (lyricCard) {
    logger.info(
      `[Aurora] audio: lirik siap — ${lyricCard.s ? `synced ${lyricCard.l.length} baris` : `plain ${String(lyricCard.p).split('\n').length} baris`}`
    );
  } else if (wantLyrics) {
    logger.debug('[Aurora] audio: kartu dikirim tanpa panel lirik (lihat log [Lyrics] di atas kenapa)');
  }

  // Warna aksen diambil dari cover lalu dinaikin saturasi/terangnya biar
  // gradiennya hidup (cover gelap kalau dipakai mentah jadi lumpur).
  let accent = '#1DB954';
  try {
    if (cover?.buffer) accent = await accentFromBuffer(cover.buffer) || accent;
  } catch { /* pakai default */ }

  let cardSent = false;
  let embeddedAudio = false;
  let thumbB64 = '';
  progress?.set(4, 'mengirim kartu…');
  /* Cover 504px pas buat kotak 252px CSS di layar retina. Kartu dengan audio
   * embed punya jatah markup besar, jadi cover boleh tajam (±24KB) — dikurangi
   * sedikit kalau ada panel lirik biar guard payload nggak memangkas lirik.
   * Kartu kecil (tanpa embed) wajib hemat: ada lirik ±2,4KB, kosong ±6,4KB. */
  const coverBudget = embed ? (lyricCard ? 18000 : 24000) : lyricCard ? 2400 : 6400;
  try { thumbB64 = await thumbDataUri(info.thumbnail, { maxB64: coverBudget }); } catch { /* tanpa cover */ }

  if (config.aurora && config.aurora.playerCard) {
    /* Kartu player (opt-in). WebView kartu WA offline, tapi WebSocket JALAN —
     * byte audio diambil lewat /api/tools/ws-audio lalu dijadikan blob. */
    try {
      const link = audioEndpoint(info.url);
      const { website } = skylineCreds();
      /* wajib wss:// — ws:// plain kena redirect 301 front worker → gagal. */
      const wsUrl = `${website.replace(/^http/i, 'ws').replace(/^ws:\/\//, 'wss://')}/api/tools/ws-audio?url=${encodeURIComponent(link)}`;
      const html = buildHtml({
        finalTitle: clean,
        finalChannel: 'AURORA',
        finalDuration: duration,
        videoUrl: link,
        thumbnailb64: thumbB64,
        wsUrl,
        isAudio: true,
        preferWs: true,
        sourceNote: 'Menyiapkan audio lewat WebSocket…'
      });
      await sendNativeHtml(ctx.client, ctx.chat, html);
      cardSent = true;
      logger.info(`[Aurora] audio: kartu player terkirim • ${html.length}B • ws=${wsUrl.slice(0, 48)}…`);
    } catch (err) {
      logger.warn(`[Aurora] audio: kartu player gagal — ${err?.message || err}`);
    }
  } else {
    /* DEFAULT: kartu AURORA deck. Embed sukses → pemutar WebAudio beneran di
     * dalam kartu (WebView mati buat <audio> remote, tapi AudioContext + data
     * URI hidup). Embed null → kartu visual tanpa audio. */
    try {
      /* Perkiraan ukuran frame: frame ≈ 3× payloadB64 ≈ 4× html (terukur dari
       * error "frame is too large: 24148412"). Limit keras WhatsApp =
       * 16.777.215 byte per frame — audio yang estimasinya meledak langsung
       * dikompres, jangan buang percobaan kirim. */
      const mkCard = (emb) => {
        const audioMime = emb ? (emb.mimetype || 'audio/webm;codecs=opus') : '';
        const audioDataUri = emb ? `data:${audioMime};base64,${emb.buf.toString('base64')}` : '';
        const b = {
          title: clean,
          channel: info.artist || 'Unknown Artist',
          duration,
          thumbnailb64: thumbB64,
          accent: accent || '#1DB954',
          audioDataUri,
          audioMeta: emb,
          note: audioDataUri
            ? (emb.trimSec
                ? `Audio kartu dipotong ±${emb.trimSec}s biar muat di kartu.`
                : emb.original
                  ? 'Tekan ▶ buat putar — audio kualitas asli di dalam kartu.'
                  : 'Tekan ▶ buat putar langsung di dalam kartu.')
            : 'Gagal menyiapkan audio di kartu — coba lagi ya.'
        };
        const audioPart = audioDataUri ? Math.ceil(audioDataUri.length * 4 / 3) : 0;
        const payBudget = audioDataUri ? 60000 + audioPart : 25600;
        let h = buildSpotifyHtml({ ...b, lyrics: lyricCard });
        let sh = '';
        /* Jaga-jaga: kalau kartu + lirik kegedean, pangkas bertahap: timestamp
         * dibuang (panel jadi biasa) → potong baris → buang lirik (cover tetap). */
        if (lyricCard && payloadB64Len(h) > payBudget) {
          let ly = { s: false, l: [], p: lyricCard.l.map((x) => x[1]).join('\n') || lyricCard.p };
          h = buildSpotifyHtml({ ...b, lyrics: ly });
          sh = ' • lirik polos';
          if (payloadB64Len(h) > payBudget) {
            ly = { s: false, l: [], p: String(ly.p).split('\n').slice(0, 18).join('\n') };
            h = buildSpotifyHtml({ ...b, lyrics: ly });
            sh = ' • lirik dipangkas';
            if (payloadB64Len(h) > payBudget) {
              // Step terakhir: buang LIRIK aja — cover jangan, biar kartu tetap
              // komplit.
              h = buildSpotifyHtml({ ...b, lyrics: null });
              sh = ' • lirik dibuang (cover tetap)';
            }
          }
        }
        return { html: h, shrink: sh, audioDataUri };
      };
      const recompress = async (why, maxB64) => {
        logger.warn(`[Aurora] audio: ${why} — kompres otomatis`);
        return prepareEmbeddedAudio(audio.buffer, durToSeconds(duration) || 0, {
          maxB64: maxB64 || embedBudgetBytes(),
          preferOriginal: false,
          mimetype: audio.mimetype
        });
      };
      let used = embed;
      let card = mkCard(used);
      if (used?.original && payloadB64Len(card.html) * 3 > WA_FRAME_MAX) {
        used = await recompress(`audio asli estimasi frame ${Math.round(payloadB64Len(card.html) * 3 / 1048576)}MB > 16MB`);
        card = mkCard(used);
        card.shrink += ' • asli→kompres (batas frame WA)';
      }
      /* Tangga adaptif: kirim kualitas penuh dulu; kalau WA nolak (479
       * "negative publish ack" ATAU "frame is too large") → turunin budget
       * embed & ulang, terakhir kartu TANPA embed. Ambang pastinya diketahui
       * dari log tiap tahap (payload per tahap ditulis di situ). Non-479/frame
       * → lempar ke catch luar seperti biasa. */
      const budgetSteps = [...new Set(
        [embedBudgetBytes(), 1_150_000, 800_000].filter((v) => v <= embedBudgetBytes())
      )].sort((a, b) => b - a);
      const isReject = (err) => /frame is too large|negative publish ack|error=479/i.test(String(err?.message || err));
      let sentOk = false;
      if (!used) {
        // Kartu memang tanpa audio (embed gagal disiapkan) — payload kecil,
        // proven-safe: sekali kirim saja.
        await sendNativeHtml(ctx.client, ctx.chat, card.html);
        sentOk = true;
      }
      for (let step = 0; step < budgetSteps.length && !sentOk; step += 1) {
        const budget = budgetSteps[step];
        if (step > 0) {
          used = await recompress(`WA nolak kartu — coba tahap ${step + 1}/${budgetSteps.length} budget ${Math.round(budget / 1024)}KB`, budget);
          card = mkCard(used);
        }
        try {
          await sendNativeHtml(ctx.client, ctx.chat, card.html);
          sentOk = true;
          card.shrink += ` • tahap ${step + 1}/${budgetSteps.length} (budget ${Math.round(budget / 1024)}KB)`;
        } catch (err) {
          if (!isReject(err)) throw err;
          logger.warn(
            `[Aurora] audio: WA nolak kartu tahap ${step + 1}/${budgetSteps.length} ` +
            `(payload ±${payloadB64Len(card.html)}B ≈ ${Math.round(payloadB64Len(card.html) / 1048576 * 10) / 10}MB) — ` +
            `${String(err?.message || err).slice(0, 160)}`
          );
        }
      }
      if (!sentOk) {
        // Semua tahap dengan audio ditolak (kemungkinan kena flag sementara
        // server) → kartu polos sekali; kalau tetap ditolak, jatuh ke catch
        // luar → cover image (selalu berhasil).
        card = mkCard(null);
        card.shrink += ' • semua tahap ditolak → tanpa embed';
        await sendNativeHtml(ctx.client, ctx.chat, card.html);
        sentOk = true;
      }
      cardSent = true;
      embeddedAudio = Boolean(card.audioDataUri);
      logger.info(
        `[Aurora] audio: kartu cover terkirim • ${card.html.length}B • payload±${payloadB64Len(card.html)}B ` +
        `(playerCard=false${lyricCard ? ' +lirik' : ''}${card.audioDataUri ? ' +audio-embed' : ''})${card.shrink}`
      );
    } catch (err) {
      logger.warn(`[Aurora] audio: kartu cover gagal — ${err?.message || err}`);
    }
  }

  if (cover && !cardSent) {
    try {
      await ctx.client.message.send(ctx.chat, {
        type: 'image',
        media: cover.buffer,
        mimetype: 'image/jpeg',
        caption: `*${clean}*\n\n> ${duration} • AURORA 🎧`
      });
      logger.info('[Aurora] audio: cover terkirim');
    } catch (err) {
      logger.warn(`[Aurora] audio: cover gagal dikirim — ${err?.message || err}`);
    }
  }

  logger.info(`[Aurora] audio: selesai — kartu player ${cardSent ? 'terkirim' : 'GAGAL'} • total ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  /* Opsi ke-2: tombol web player (in-app browser WhatsApp). Cuma dikirim kalau
   * kartu TIDAK punya audio embed (mis. embed gagal) atau user menyalakan
   * `config.aurora.playerButton` — biar chat nggak jadi 2-3 bubble per lagu. */
  const wantPlayerButton = !embeddedAudio || Boolean(config.aurora?.playerButton);
  if (wantPlayerButton) {
    try {
      const ok = await sendPlayerButton(ctx, info, clean, duration);
      if (ok) logger.info('[Aurora] audio: tombol player web terkirim');
    } catch (err) {
      logger.warn(`[Aurora] player: tombol gagal — ${err?.message || err}`);
    }
  }
}

/**
 * Ambil warna dominan cover, lalu boost saturasi & kecerahan (HSL) — biar
 * gradiennya nyatu.
 */
async function accentFromBuffer(buffer) {
  const { data } = await sharp(buffer).resize(1, 1, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
  let r = data[0] / 255, g = data[1] / 255, b = data[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0;
  const l0 = (max + min) / 2;
  const d = max - min;
  if (d) {
    sat = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s2 = Math.min(1, Math.max(0.55, sat));
  const l2 = Math.min(0.62, Math.max(0.46, l0 + 0.18));
  const hue2rgb = (p2, q2, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
    if (t < 1 / 2) return q2;
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
    return p2;
  };
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p2 = 2 * l2 - q;
  const out = [hue2rgb(p2, q, h + 1 / 3), hue2rgb(p2, q, h), hue2rgb(p2, q, h - 1 / 3)]
    .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Perkiraan ukuran payload base64 sebuah HTML kartu (batas render ±26KB).
 * +600 = envelope JSON GenAIUnifiedResponse sebelum di-base64. */
function payloadB64Len(html) {
  return Math.ceil(String(html || '').length * 4 / 3) + 600;
}

/** Panel lirik di dalam kartu (sembunyi default; dibuka lewat tombol lirik).
 * Baris sengaja TANPA atribut data — teksnya dibaca dari DOM pas user tap,
 * dan timestamp-nya dari array `LY.t` (hemat ±2KB payload vs nyimpen dua kali). */
function buildLyricPanelHtml(lyrics, synced) {
  const has = Boolean(lyrics && (lyrics.p || (Array.isArray(lyrics.l) && lyrics.l.length)));
  const body = !has
    ? '<div class="lyr-none">⚠️ Lirik tidak tersedia untuk lagu ini — server lagi sibuk atau lagu belum terdaftar. Coba lagi nanti ya.</div>'
    : synced
      ? lyrics.l
          .map(([, tx]) => `<i class=ly>${escHtml(tx)}</i>`)
          .join('')
      : String(lyrics.p || '')
          .split('\n')
          .filter(Boolean)
          .map((tx) => `<i class=ly>${escHtml(tx)}</i>`)
          .join('') || '<div class="lyr-none">Lirik tidak tersedia.</div>';
  const ctl = has && synced
    ? `<div class="lyr-ctl">
        <button type="button" id="lyrPlay" onclick="lyrPlay()" title="Mulai sinkron">▶</button>
        <button type="button" onclick="lyrShift(-0.5)" title="Geser lirik +0,5 dtk">−</button>
        <button type="button" onclick="lyrShift(0.5)" title="Geser lirik −0,5 dtk">+</button>
      </div>`
    : '';
  return `<div class="lyrics" id="lyrPanel" style="display:none">
    <div class="lyr-head"><b>LIRIK</b><span>${!has ? 'TIDAK ADA' : synced ? 'SINKRON' : 'TEKS'}</span>${ctl}</div>
    <div class="lyr-view" id="lyrView">${body}</div>
  </div>`;
}

/**
 * Kartu "Now Playing" gaya Spotify (dark, cover besar, kontrol penuh).
 * Audio ditanam sebagai data: URI → WebAudio yang muter (WebView kartu WA
 * mati buat <audio> remote, tapi AudioContext hidup); aksen dari cover.
 * `lyrics` = hasil `capLyrics()` dari lib/lyrics.js — `{ s, l:[[detik,teks]], p }`.
 * Panel lirik di tombol baris judul; kalau synced ada mode karaoke (sinkron
 * posisi audio di kartu) + auto-highlight.
 */
function buildSpotifyHtml({ title, channel, duration, thumbnailb64, accent = '#1DB954', note, lyrics = null, audioDataUri = '', audioMeta = null }) {
  const dur = String(duration || '').trim();
  const hits = /^\d+:\d{2}(:\d{2})?$/.test(dur) ? dur : '';
  const safeTitle = escHtml(title || 'Tanpa Judul');
  const safeChannel = escHtml(channel || 'Unknown Artist');
  const hasAudio = Boolean(audioDataUri);
  const safeNote = escHtml(note || (hasAudio
    ? 'Tekan ▶ buat putar langsung di dalam kartu.'
    : 'Gagal menyiapkan audio di kartu — coba lagi ya.'));
  const hasLyrics = Boolean(lyrics && (lyrics.p || (Array.isArray(lyrics.l) && lyrics.l.length)));
  const lyrSynced = hasLyrics && Array.isArray(lyrics.l) && lyrics.l.length > 0;
  const art = thumbnailb64
    ? `<div class="art-wrap"><img class="art" src="${thumbnailb64}" alt=""></div>`
    : `<div class="art-wrap"><div class="art-ph"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M9 18V5.5l10-2V16"/><circle cx="6.6" cy="18" r="2.6"/><circle cx="16.6" cy="16" r="2.6"/></svg></div></div>`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AURORA — ${safeTitle}</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
html,body{margin:0;background:#000}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;padding:12px}
.card{max-width:412px;margin:0 auto;border-radius:26px;overflow:hidden;position:relative;
  background:
    radial-gradient(130% 52% at 50% 0%,${accent}59 0%,${accent}1f 34%,rgba(0,0,0,0) 68%),
    linear-gradient(180deg,#1b1b1b 0%,#121212 44%,#0a0a0a 100%);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 24px 70px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.03) inset}
.top{display:flex;align-items:center;gap:10px;padding:15px 17px 6px}
.logo{width:23px;height:23px;flex:none;display:block}
.who{display:flex;flex-direction:column;line-height:1.16;min-width:0}
.who b{font-size:11.5px;letter-spacing:2.4px;font-weight:800;white-space:nowrap}
.who span{font-size:8px;letter-spacing:1.9px;color:rgba(255,255,255,.42);font-weight:700;margin-top:2px}
.more{margin-left:auto;display:flex;align-items:center;color:rgba(255,255,255,.55)}
.hero{padding:14px 18px 2px;text-align:center;position:relative}
.hero::before{content:"";position:absolute;left:50%;top:8px;width:290px;height:290px;
  transform:translateX(-50%);border-radius:50%;pointer-events:none;
  background:radial-gradient(closest-side,${accent}30 0%,${accent}12 55%,transparent 78%)}
.art-wrap{position:relative;border-radius:20px;overflow:hidden;background:#181818;
  max-width:252px;margin:0 auto;
  box-shadow:0 24px 54px rgba(0,0,0,.78),0 0 0 1px rgba(255,255,255,.09),0 0 34px ${accent}26}
.art{display:block;width:100%;height:auto}
.art-wrap::after{content:"";position:absolute;inset:0;border-radius:18px;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.08) 0%,rgba(255,255,255,0) 22%,rgba(0,0,0,.22) 100%)}
.art-ph{position:relative;padding-top:100%;color:${accent};
  background:radial-gradient(110% 80% at 50% 20%,${accent}47 0%,rgba(255,255,255,.03) 70%)}
.art-ph svg{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);opacity:.85}
.track{display:flex;align-items:flex-start;gap:12px;padding:17px 18px 0}
.meta{min-width:0;flex:1}
.title{font-size:20px;font-weight:800;letter-spacing:-.35px;line-height:1.24;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.artist{margin-top:6px;font-size:12.5px;color:#b3b3b3;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.heart{width:37px;height:37px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  color:#c7c7c7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.prog{padding:19px 18px 0}
.bar{position:relative;height:4px;border-radius:4px;background:rgba(255,255,255,.17)}
.bar i{position:absolute;inset:0 auto 0 0;width:0%;border-radius:4px;background:${accent};
  box-shadow:0 0 14px ${accent}8c}
.bar b{position:absolute;top:50%;left:0%;width:11px;height:11px;border-radius:50%;background:#fff;
  transform:translate(-50%,-50%);box-shadow:0 3px 10px rgba(0,0,0,.55)}
.times{display:flex;justify-content:space-between;margin-top:9px;font-size:10px;color:#8f8f8f;
  font-weight:600;font-variant-numeric:tabular-nums}
.ctrl{display:flex;align-items:center;justify-content:space-between;padding:10px 24px 2px}
.ico{width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.76)}
.ico.on{color:${accent}}
.play{width:62px;height:62px;border-radius:50%;background:#fff;color:#0a0a0a;flex:none;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 14px 32px rgba(0,0,0,.58),0 0 0 1px rgba(255,255,255,.45) inset;
  transition:transform .12s ease,box-shadow .2s ease}
.play:active{transform:scale(.93)}
.play.ready{box-shadow:0 14px 32px rgba(0,0,0,.58),0 0 0 6px ${accent}22,0 0 26px ${accent}66}
.src{margin:14px 14px 0;display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:18px;
  background:
    radial-gradient(120% 130% at 0% 0%,${accent}26 0%,rgba(255,255,255,.02) 62%),
    linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));
  border:1px solid rgba(255,255,255,.075)}
.src-ico{width:36px;height:36px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  background:${accent};color:#08130c;box-shadow:0 8px 20px ${accent}47}
.src-txt{min-width:0;flex:1}
.src-txt b{display:block;font-size:11.5px;font-weight:800;letter-spacing:.15px}
.src-txt span{display:block;font-size:10px;color:#9a9a9a;line-height:1.45;margin-top:2px}
.eq{display:flex;align-items:flex-end;gap:2.5px;height:18px;flex:none;padding-right:2px}
.eq i{width:2.5px;border-radius:2px;background:${accent};opacity:.85;
  animation:eq 1.05s ease-in-out infinite}
.eq i:nth-child(1){height:30%;animation-delay:0s}
.eq i:nth-child(2){height:62%;animation-delay:.14s}
.eq i:nth-child(3){height:44%;animation-delay:.28s}
.eq i:nth-child(4){height:82%;animation-delay:.42s}
.eq i:nth-child(5){height:38%;animation-delay:.56s}
@keyframes eq{0%,100%{transform:scaleY(.42)}50%{transform:scaleY(1)}}
.lyr-btn{width:37px;height:37px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  color:#c7c7c7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.lyr-btn.on{color:${accent};background:${accent}22;border-color:${accent}66}
.lyrics{margin:14px 14px 0;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));
  border:1px solid rgba(255,255,255,.075)}
.lyr-head{display:flex;align-items:center;gap:8px;padding:11px 14px 5px}
.lyr-head b{font-size:10.5px;letter-spacing:2.2px;font-weight:800}
.lyr-head span{font-size:8.5px;letter-spacing:1.4px;color:#8f8f8f;font-weight:700;
  padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.06)}
.lyr-ctl{margin-left:auto;display:flex;gap:5px}
.lyr-ctl button{border:0;border-radius:9px;background:rgba(255,255,255,.08);color:#dcdcdc;
  font-size:11px;font-weight:800;padding:4px 10px;min-width:30px;line-height:1.25}
.lyr-ctl button.on{background:${accent};color:#08130c}
.lyr-view{max-height:236px;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;
  padding:2px 14px 12px}
.ly{display:block;font-size:13.5px;line-height:1.62;font-weight:600;color:rgba(255,255,255,.40);
  padding:3px 0;transition:color .2s ease}
.ly.cur{color:#fff}
.lyr-none{font-size:11.5px;color:#8f8f8f}
.foot{display:flex;align-items:center;justify-content:center;gap:7px;padding:14px 0 16px;
  font-size:9px;color:#6f6f6f;letter-spacing:1.5px;font-weight:700}
.chip{padding:3px 7px;border-radius:6px;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.08);color:#9a9a9a;letter-spacing:.9px}
</style></head>
<body>
<div class="card">
  <div class="top">
    <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="${accent}"/>
      <g fill="none" stroke="#07120a" stroke-width="1.7" stroke-linecap="round">
        <path d="M6.4 8.9c3.7-1.05 8.4-.6 11.2 1.05"/>
        <path d="M7.3 12.2c3.1-.85 7-.4 9.4 1"/>
        <path d="M8.1 15.4c2.5-.6 5.4-.3 7.3.8"/>
      </g>
    </svg>
    <div class="who"><b>AURORA</b><span>NOW PLAYING</span></div>
    <div class="more">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
      </svg>
    </div>
  </div>

  <div class="hero">${art}</div>

  <div class="track">
    <div class="meta">
      <div class="title">${safeTitle}</div>
      <div class="artist">${safeChannel}</div>
    </div>
    <div class="acts">
      <div class="lyr-btn" id="lyrBtn" onclick="lyrToggle()" title="${hasLyrics ? 'Lirik' : 'Lirik — tidak tersedia'}"${hasLyrics ? '' : ' style="opacity:.45"'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16"/><path d="M4 11h11"/><path d="M4 16h16"/><path d="M4 21h8"/>
        </svg>
      </div>
      <div class="heart">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>
        </svg>
      </div>
    </div>
  </div>

  <div class="prog">
    <div class="bar"${hasAudio ? ' onclick="aBarClick(event)" style="cursor:pointer"' : ''}><i id="barFill"></i><b id="knob"></b></div>
    <div class="times"><span id="tCur">0:00</span><span id="tDur">${escHtml(hits || '--:--')}</span></div>
  </div>

  <div class="ctrl">
    <div class="ico on">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>
      </svg>
    </div>
    <div class="ico"${hasAudio ? ' onclick="aSeekRel(-10)" title="Mundur 10 detik" style="cursor:pointer"' : ''}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 5h2v14H6zM19 5v14l-9.5-7z"/>
      </svg>
    </div>
    <div class="play" id="playBtn" onclick="${hasAudio ? 'aToggle()' : 'hint()'}">
      <svg id="icoPlay" width="25" height="25" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </div>
    <div class="ico"${hasAudio ? ' onclick="aSeekRel(10)" title="Maju 10 detik" style="cursor:pointer"' : ''}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 5h2v14h-2zM5 5v14l9.5-7z"/>
      </svg>
    </div>
    <div class="ico"${hasAudio ? ' onclick="aToggleLoop()" title="Ulangi lagu" style="cursor:pointer"' : ''}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    </div>
  </div>

  <div class="src">
    <div class="src-ico">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9 18V5.4l10-2V16"/><circle cx="6.6" cy="18" r="2.7"/><circle cx="16.6" cy="16" r="2.7"/>
      </svg>
    </div>
    <div class="src-txt"><b>Audio siap diputar</b><span id="srcNote">${safeNote}</span></div>
    <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
  </div>

  ${buildLyricPanelHtml(lyrics, lyrSynced)}

  <div class="foot"><span>AURORA</span><span>•</span><span>skyline.web.id</span><span class="chip">HQ</span></div>
</div>

<script>
/* Fallback kalau jalur WebAudio gak kepakai: tombol play cuma ngasih tau
 * kalau audio kartu gagal disiapkan. */
function hint() {
  var t = document.getElementById('srcNote');
  if (t) { t.textContent = 'Audio gagal disiapkan — coba lagi ya'; t.style.color = '#ff6b6b'; }
  var b = document.getElementById('playBtn');
  if (b) b.className = 'play ready';
}
</script>
<script>
/* Toggle panel lirik — versi ringkas dipakai kalau lirik gak ada (panel
 * berisi peringatan). Kalau ADA lirik, blok script lirik di bawah nge-override
 * fungsi ini dengan versi karaoke-nya. */
function lyrToggle() {
  var p = document.getElementById('lyrPanel');
  if (!p) return;
  var on = p.style.display === 'none';
  p.style.display = on ? 'block' : 'none';
  var b = document.getElementById('lyrBtn');
  if (b) b.className = on ? 'lyr-btn on' : 'lyr-btn';
}
</script>${hasLyrics ? `
<script>
/* LIRIK KARAOKE — sebelum audio di-decode, sinkronisasi pakai jam manual
 * (ketuk ▶ di panel lirik); sesudah decode, ngikut posisi audio di kartu.
 * Teks baris dibaca dari DOM, cuma timestamp yang di-embed (hemat payload). */
window.LYRICS = ${JSON.stringify({ s: Boolean(lyrSynced), t: (lyrics.l || []).map((x) => Math.round((Number(x[0]) || 0) * 10) / 10) })};
var LY = window.LYRICS || {}, T = 0, L = 0, TI = null, I = -1, E = null;
function nodes() { return E || (E = [].slice.call(document.querySelectorAll('#lyrView .ly'))) }
function lyrToggle() {
  var p = document.getElementById('lyrPanel');
  if (!p) return;
  var on = p.style.display === 'none';
  p.style.display = on ? 'block' : 'none';
  var b = document.getElementById('lyrBtn');
  if (b) b.className = on ? 'lyr-btn on' : 'lyr-btn';
  if (on) paint(1);
}
function lyrPlay() {
  var b = document.getElementById('lyrPlay');
  if (TI) { clearInterval(TI); TI = null; if (b) { b.textContent = '\u25B6'; b.className = ''; } return; }
  L = Date.now();
  TI = setInterval(function() { var n = Date.now(); T += (n - L) / 1e3; L = n; paint(); }, 200);
  if (b) { b.textContent = '\u275A\u275A'; b.className = 'on'; }
}
function lyrShift(d) { T = Math.max(0, T + d); L = Date.now(); paint(); }
function lyrSeek(t) { T = Math.max(0, Number(t) || 0); L = Date.now(); paint(); }
function paint(f) {
  var ts = LY.t || [];
  if (!ts.length) return;
  var els = nodes();
  if (!els.length) return;
  var i = -1;
  for (var k = 0; k < ts.length && k < els.length; k++) { if (ts[k] <= T + 1e-3) i = k; else break; }
  if (i === I && !f) return;
  I = i;
  for (var j = 0; j < els.length; j++) els[j].className = (j === i ? 'ly cur' : 'ly');
  var cur = els[i], v = document.getElementById('lyrView');
  if (cur && v) { // rect, bukan offsetTop: offsetParent kartu ini .card, bukan panel scroll
    var dy = cur.getBoundingClientRect().top - v.getBoundingClientRect().top;
    v.scrollTop = Math.max(0, v.scrollTop + dy - v.clientHeight * .4);
  }
}
(function() {
  var v = document.getElementById('lyrView');
  if (!v) return;
  v.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== v && el.className !== 'ly') el = el.parentNode;
    if (!el || el === v) return;
    var els = nodes();
    for (var i = 0; i < els.length; i++) if (els[i] === el) { lyrSeek((LY.t || [])[i]); return; }
  });
})();
</script>` : ''}
${hasAudio ? `
<script>
/* ═══ AUDIO EMBEDDED — jalur play2 ═══
 * <audio>/<video>/fetch/WebSocket SEMUA mati di WebView kartu WA (bukti:
 * tes .richlab di HP owner), tapi WebAudio HIDUP — #11 oscillator bunyi,
 * #12 decodeAudioData(data URI) bunyi. Jadi lagu di-embed sebagai data URI
 * → atob manual (tanpa fetch) → decodeAudioData → AudioBufferSourceNode.
 * Play TETAP butuh ketukan user (kebijakan autoplay). */
var AU = { uri: ${JSON.stringify(audioDataUri)}, total: ${durToSeconds(dur) || 0}, trimmed: ${Boolean(audioMeta && audioMeta.trimSec)}, bitrate: ${JSON.stringify(String((audioMeta && audioMeta.bitrate) || ''))} };
var actx = null, abuf = null, anode = null;
var aReady = false, aPlaying = false, aPos = 0, aStartT = 0, aLoop = false, aLoading = false, aLyrOff = 0, aTries = 0;
function $(id) { return document.getElementById(id); }
function fmtT(s) { s = Math.max(0, Math.floor(Number(s) || 0)); var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
function aNote(t) { var e = $('srcNote'); if (e) e.textContent = t; }
function aIcons(pause) {
  var s = $('icoPlay');
  /* Pause = garis vertikal → WAJIB stroke (fill area-nya nol, gak kegambar);
   * play = segitiga, fill biasa udah cukup. */
  if (s) s.innerHTML = pause
    ? '<path d="M7.5 5v14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M16.5 5v14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'
    : '<path d="M8 5v14l11-7z"/>';
  var lp = $('lyrPlay');
  if (lp) { lp.textContent = pause ? '❚❚' : '▶'; lp.className = pause ? 'on' : ''; }
}
function dataUriToAb(uri) {
  var b64 = uri.slice(uri.indexOf(',') + 1), bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}
function aCtx() {
  if (actx) return actx;
  var C = window.AudioContext || window.webkitAudioContext;
  if (!C) { aNote('WebAudio tidak didukung di device ini'); return null; }
  try { actx = new C(); } catch (e) { aNote('AudioContext gagal: ' + ((e && e.message) || '?')); return null; }
  return actx;
}
function aStop() {
  if (anode) {
    try { anode.onended = null; anode.stop(); } catch (e) {}
    try { anode.disconnect(); } catch (e) {}
    anode = null;
  }
}
function aPosNow() {
  if (!aReady || !abuf) return 0;
  if (aPlaying && actx) {
    var d = abuf.duration || 0, t = actx.currentTime - aStartT;
    if (aLoop && d > 0) t = t % d;
    else if (d > 0) t = Math.min(t, d);
    return Math.max(0, t);
  }
  return aPos;
}
function aStart(off) {
  var ctx = aCtx();
  if (!ctx || !abuf) return;
  if (ctx.state === 'suspended') ctx.resume();
  aStop();
  anode = ctx.createBufferSource();
  anode.buffer = abuf;
  anode.loop = aLoop;
  anode.connect(ctx.destination);
  off = Math.max(0, Math.min(Number(off) || 0, Math.max(0, abuf.duration - 0.05)));
  anode.start(0, off);
  aStartT = ctx.currentTime - off;
  aPlaying = true;
  anode.onended = function () {
    if (aLoop) return;
    aPlaying = false; aPos = abuf.duration;
    aIcons(false); aNote('Selesai — ketuk ▶ buat ulang');
  };
  aIcons(true);
  aNote('Memutar audio di kartu…');
}
function aToggle() {
  if (!aReady) { aLoad(); return; }
  if (aPlaying) { aPos = aPosNow(); aStop(); aPlaying = false; aIcons(false); aNote('Dijeda'); }
  else {
    if (aPos >= abuf.duration - 0.15) aPos = 0;
    aStart(aPos);
  }
}
function aSeek(t) {
  if (!abuf) return;
  t = Math.max(0, Math.min(Number(t) || 0, abuf.duration));
  if (aPlaying) aStart(t); else { aPos = t; aPaint(); }
}
function aSeekRel(d) { aSeek(aPosNow() + d); }
function aToggleLoop() { aLoop = !aLoop; if (anode) anode.loop = aLoop; aNote(aLoop ? 'Loop ON — lagu diulang' : 'Loop OFF'); }
function aBarClick(ev) {
  if (!abuf) return;
  var r = this.getBoundingClientRect();
  aSeek(((ev.clientX - r.left) / r.width) * abuf.duration);
}
function aPaint() {
  var d = abuf ? abuf.duration : (AU.total || 0), t = aPosNow();
  var pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
  var e = $('barFill'); if (e) e.style.width = pct + '%';
  e = $('knob'); if (e) e.style.left = pct + '%';
  e = $('tCur'); if (e) e.textContent = fmtT(t);
  e = $('tDur'); if (e && d > 0) e.textContent = fmtT(d);
}
function aLinkLyrics() {
  /* Sesudah decode sukses: clock lirik diganti posisi audio (override fungsi
   * manual di script lirik). Sebelum decode, mode manual tetap berlaku. */
  try {
    if (typeof TI !== 'undefined' && TI) { clearInterval(TI); TI = null; }
    if (typeof lyrPlay === 'function') lyrPlay = function () { aToggle(); };
    if (typeof lyrShift === 'function') lyrShift = function (d) { aLyrOff += d; T = aPosNow() + aLyrOff; paint(); };
    if (typeof lyrSeek === 'function') lyrSeek = function (t) { aSeek(Math.max(0, (Number(t) || 0) - aLyrOff)); };
  } catch (e) {}
}
function aLoad() {
  if (aLoading || aReady) return;
  var ctx = aCtx();
  if (!ctx) return;
  aLoading = true; aTries += 1;
  aNote('Memuat audio di kartu…');
  if (ctx.state === 'suspended') ctx.resume();
  var ab;
  try { ab = dataUriToAb(AU.uri); }
  catch (e) { aLoading = false; aNote('Audio rusak: ' + ((e && e.message) || e)); return; }
  var done = false;
  var ok = function (b) {
    if (done) return; done = true;
    abuf = b; aReady = true; aLoading = false;
    aLinkLyrics(); aPaint(); aIcons(false);
    aNote('Siap — ketuk ▶ buat putar');
  };
  var fail = function (e) {
    if (done) return; done = true;
    aLoading = false;
    aNote('Gagal decode audio (' + ((e && (e.message || e.name)) || '?') + ') — coba lagi ya');
  };
  try {
    var p = ctx.decodeAudioData(ab, ok, fail);
    if (p && p.then) p.then(ok, fail);
  } catch (e) { fail(e); }
  setTimeout(function () { fail(new Error('timeout 30s')); }, 30000);
}
/* Decode jalan sejak kartu dibuka (pola play2 — terbukti di HP), tapi play
 * baru jalan dari ketukan user. window.__au = handle diagnosa buat tes dev. */
window.__au = {
  state: function () { return { ready: aReady, playing: aPlaying, pos: aPosNow(), dur: abuf ? abuf.duration : 0, ctx: actx ? actx.state : '-', tries: aTries, trimmed: AU.trimmed, bitrate: AU.bitrate }; },
  toggle: aToggle, seek: aSeek, loop: function () { return aLoop; }
};
aLoad();
setInterval(function () {
  if (!aReady) return;
  if (aPlaying) aPos = aPosNow();
  aPaint();
  if (typeof paint === 'function') { T = aPosNow() + aLyrOff; paint(); }
}, 250);
</script>` : ''}
</body></html>`;
}

/**
 * Kartu COVER buat audio — tanpa <audio>/<video> sama sekali, murni visual
 * (cover + judul + durasi). Kartu player WebAudio = jalur utama; builder ini
 * dipertahankan buat _internals/tes.
 */
function buildCoverHtml({ title, channel, duration, thumbnailb64, note }) {
  const hasThumb = Boolean(thumbnailb64);
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AURORA — ${escapeHtmlJs(title)}</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
body{margin:0;padding:14px;background:#04090b;font-family:Arial,Helvetica,sans-serif;color:#eafff5}
.wrap{position:relative;max-width:440px;margin:auto;border-radius:20px;overflow:hidden;
  border:1px solid rgba(0,255,136,.16);box-shadow:0 10px 40px rgba(0,0,0,.55)}
.bg{position:absolute;inset:-25px;background-position:center;background-size:cover;
  filter:blur(22px) saturate(1.1);opacity:.35;transform:scale(1.15)}
.ov{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,9,11,.35),rgba(4,9,11,.88))}
.in{position:relative;padding:18px;text-align:center}
.hd{font-size:10px;font-weight:800;letter-spacing:2.5px;color:#5cffb0;opacity:.9;margin-bottom:14px}
.cover{width:100%;aspect-ratio:1/1;border-radius:16px;object-fit:cover;display:block;
  background:#0b1512;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.title{font-size:14px;font-weight:800;margin:14px 0 4px;line-height:1.35}
.sub{font-size:11px;color:#8fb8a8}
.badge{margin-top:14px;display:inline-block;padding:9px 14px;border-radius:999px;
  background:rgba(0,255,136,.12);border:1px solid rgba(0,255,136,.25);
  font-size:11px;font-weight:700;color:#8effc4}
.note{margin-top:8px;font-size:10px;color:#7fa896;line-height:1.5}
</style></head>
<body>
<div class="wrap">
  <div class="bg"${hasThumb ? ` style="background-image:url('${thumbnailb64}')"` : ''}></div>
  <div class="ov"></div>
  <div class="in">
    <div class="hd">AURORA — UR SPECIAL PLAYER</div>
    ${hasThumb ? `<img class="cover" src="${thumbnailb64}" alt="">` : ''}
    <div class="title">${escapeHtmlJs(title)}</div>
    <div class="sub">${escapeHtmlJs(channel || '')}${duration ? ` • ${escapeHtmlJs(duration)}` : ''}</div>
    <div class="badge">🎧 Player AURORA</div>
    <div class="note">${escapeHtmlJs(note || 'Putar dari kartu player.')}</div>
  </div>
</div>
</body></html>`;
}

/**
 * Kandidat URL thumbnail, resolusi TERTINGGI dulu.
 * Thumbnail hasil pencarian sering versi kecil (≤480px) → gambarnya burem;
 * YouTube simpan versi asli 1280x720 di `maxresdefault.jpg` (kemudian
 * `mqdefault`, lalu URL asli API). ID video dibaca dari URL thumbnail/video.
 */
function thumbCandidates(url) {
  const raw = String(url || '').trim();
  if (!raw) return [];
  const list = [];
  const id =
    raw.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    raw.match(/\/vi(?:_webp)?\/([\w-]{6,})\//)?.[1] ||
    raw.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    raw.match(/\/embed\/([\w-]{6,})/)?.[1];
  if (id) {
    list.push(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
    list.push(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
  }
  list.push(raw);
  return [...new Set(list)];
}

/** Unduh satu kandidat thumbnail; `minBytes` buang placeholder abu-abu 120x90. */
async function fetchThumbRaw(url, minBytes = 0) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const raw = Buffer.from(await r.arrayBuffer());
    if (!raw.length || raw.length < minBytes) return null;
    return raw;
  } catch { return null; }
}

async function thumbDataUri(url, { maxB64 = 24000 } = {}) {
  const urls = thumbCandidates(url);
  if (!urls.length) return '';
  /* Kandidat hasil upgrade WAJIB kelihatan seperti gambar beneran — video lama
   * kadang balas `maxresdefault` berupa placeholder abu-abu ±1KB. Yang tetap
   * diterima apa adanya cuma URL asli dari API (kandidat terakhir). */
  let raw = null;
  let used = '';
  for (let i = 0; i < urls.length; i += 1) {
    const candidate = urls[i];
    const isFallback = i === urls.length - 1;
    raw = await fetchThumbRaw(candidate, isFallback ? 0 : 4000);
    if (raw) { used = candidate; break; }
  }
  if (!raw) return '';
  try {
    /* Cover di-embed sebagai data URI, jadi tiap KB ikut membengkak 4/3 di
     * payload base64. Kartu dengan audio embed punya jatah markup besar →
     * cover boleh 504px (pas buat kotak 252px CSS di layar retina); kartu
     * kecil (tanpa embed) turun bertahap sampai muat. */
    const plan = [
      [640, 74], [560, 72], [504, 70], [504, 64], [480, 62], [448, 62],
      [448, 58], [416, 58], [400, 56], [360, 54], [320, 52], [288, 50],
      [256, 48], [224, 44], [200, 42], [176, 40], [152, 38], [128, 36], [104, 32]
    ];
    let last = raw;
    for (const [width, quality] of plan) {
      try {
        /* `sharpen` ringan bikin hasil downscale nggak terasa lembek di HP. */
        last = await sharp(raw)
          .resize({ width, withoutEnlargement: true, kernel: 'lanczos3' })
          .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.8 })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
      } catch { return 'data:image/jpeg;base64,' + raw.toString('base64'); }
      const b64 = last.toString('base64');
      if (b64.length <= maxB64) {
        logger.debug(
          `[Aurora] thumb: ${used.includes('maxresdefault') ? 'maxres' : used.includes('mqdefault') ? 'mq' : 'asli'} → ` +
          `${width}px q${quality} • ${Math.round(b64.length / 1024)}KB (budget ${Math.round(maxB64 / 1024)}KB)`
        );
        return 'data:image/jpeg;base64,' + b64;
      }
    }
    return 'data:image/jpeg;base64,' + last.toString('base64');
  } catch { return 'data:image/jpeg;base64,' + raw.toString('base64'); }
}

/** Escape buat teks/atribut HTML (judul bisa ada `&`, `<`, kutip). */
const escHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeHtmlJs = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/</g, '\\x3C');

function buildHtml({ finalTitle, finalChannel, finalDuration, videoUrl, thumbnailb64, wsUrl, isAudio: audioHint, sourceNote = '', preferWs = false }) {
  // URL media dari server kadang gak punya ekstensi (URL proxy/stream),
  // jadi jenis media ditentukan dari format yang diminta, bukan dari URL.
  const isAudio = typeof audioHint === 'boolean'
    ? audioHint
    : /\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/i.test(String(videoUrl || ''));
  const cfg = {
    title: finalTitle,
    channel: finalChannel,
    duration: finalDuration,
    videoUrl,
    wsUrl,
    isAudio,
    preferWs: preferWs === true,
    autoplay: false,
    volume: 0.8,
    loop: false
  };

  // Selalu pakai <video>: elemen <audio> tanpa kotak render sering diabaikan
  // webview WhatsApp (kartu tampil, tapi suara gak pernah keluar). Untuk mp3,
  // poster thumbnail dipakai sebagai cover.
  const mediaTag = `<video id="videoPlayer" playsinline webkit-playsinline preload="auto" poster="${thumbnailb64}"></video>`;

  const htmlPayload = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AURORA — ${escapeHtmlJs(finalTitle)}</title>
<style>
*{
-webkit-tap-highlight-color:transparent;
-webkit-user-select:none;
user-select:none;
-webkit-touch-callout:none;
box-sizing:border-box
}
body{
margin:0;
background:#04090b;
font-family:Arial,Helvetica,sans-serif;
color:#eafff5;
touch-action:manipulation;
cursor:pointer
}
input[type=range]{
width:100%;
height:4px;
accent-color:#00ff88;
cursor:pointer
}
.player-wrap{
width:100%;
max-width:440px;
margin:auto;
padding:12px
}
.aurora-head{
text-align:center;
margin:2px 0 10px
}
.aurora-title{
display:inline-block;
font-size:12px;
font-weight:800;
letter-spacing:2.5px;
background:linear-gradient(90deg,#00ff88,#22d3ee,#7dd3fc,#00ff88);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 6s linear infinite;
text-shadow:0 0 18px rgba(0,255,136,.25)
}
.player{
position:relative;
overflow:hidden;
background:#0b1512;
border:1px solid rgba(0,255,136,.16);
border-radius:20px;
box-shadow:0 10px 40px rgba(0,0,0,.55),0 0 24px rgba(0,255,136,.06) inset
}
.bg{
position:absolute;
inset:-25px;
background-position:center;
background-size:cover;
filter:blur(22px) saturate(1.1);
opacity:.30;
transform:scale(1.15);
pointer-events:none
}
.bg-overlay{
position:absolute;
inset:0;
background:linear-gradient(
180deg,
rgba(4,9,11,.40),
rgba(4,9,11,.78)
);
pointer-events:none
}
.content{
position:relative;
padding:18px;
z-index:2
}
.top{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:15px
}
.top-title{
font-size:13px;
font-weight:700;
letter-spacing:.8px;
color:#5cffb0;
opacity:.9
}
.top-sub{
font-size:10px;
color:#7fa896;
opacity:.7;
margin-top:3px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
max-width:260px
}
.icon-btn{
width:34px;
height:34px;
border:0;
border-radius:50%;
background:rgba(0,255,136,.10);
color:#eafff5;
display:flex;
align-items:center;
justify-content:center;
padding:0;
flex-shrink:0
}
.icon-btn svg{
width:17px;
height:17px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.video-frame{
position:relative;
width:100%;
aspect-ratio:16/9;
border-radius:15px;
overflow:hidden;
background:#000;
box-shadow:0 12px 35px rgba(0,0,0,.45),0 0 0 1px rgba(34,211,238,.14);
cursor:pointer
}
.video-frame video,
.video-frame img.cover-img{
width:100%;
height:100%;
display:block;
background:#000;
object-fit:contain
}
.video-frame img.cover-img{object-fit:cover}
.player-status{
margin-top:6px;
font-size:11px;
line-height:1.35;
letter-spacing:.3px;
color:rgba(234,255,245,.55);
min-height:15px
}
.player-status.warn{color:#fbbf24}
.player-status.err{color:#f87171}
.big-play{
position:absolute;
inset:0;
display:flex;
align-items:center;
justify-content:center;
background:rgba(0,0,0,.18);
transition:opacity .2s;
z-index:3
}
.big-btn{
width:64px;
height:64px;
border:0;
border-radius:50%;
background:linear-gradient(135deg,#00ff88,#22d3ee);
color:#041008;
display:flex;
align-items:center;
justify-content:center;
padding:0;
box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 22px rgba(0,255,136,.35)
}
.big-btn svg{
width:26px;
height:26px;
fill:currentColor;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.frame-playing .big-play{
opacity:0;
pointer-events:none
}
.info{
padding-top:15px
}
.song-title{
font-size:19px;
font-weight:700;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
color:#f2fff8
}
.artist{
font-size:13px;
color:#7fa896;
opacity:.8;
margin-top:5px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.progress{
margin-top:18px
}
.times{
display:flex;
justify-content:space-between;
font-size:10px;
color:#7fa896;
opacity:.75;
margin-top:7px
}
.controls{
display:flex;
align-items:center;
justify-content:center;
gap:18px;
margin-top:13px
}
.side-btn{
width:38px;
height:38px;
border:0;
background:transparent;
color:#b9ffd9;
display:flex;
align-items:center;
justify-content:center;
padding:0;
opacity:.85
}
.side-btn svg{
width:19px;
height:19px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.bottom{
display:flex;
align-items:center;
justify-content:space-between;
margin-top:15px;
gap:12px
}
.bottom-left,
.bottom-right{
display:flex;
align-items:center;
gap:9px
}
.volume{
width:85px
}
.debug-wrap{
margin-top:12px;
background:#0b1512;
border:1px solid rgba(34,211,238,.16);
border-radius:16px;
padding:12px;
font-family:monospace
}
.debug-head{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:8px
}
.debug-title{
font-size:11px;
font-weight:700;
letter-spacing:.8px;
color:#67e8f9;
opacity:.9
}
.debug-state{
font-size:10px;
font-weight:700;
padding:3px 8px;
border-radius:20px;
background:rgba(0,255,136,.10);
color:#5cffb0;
letter-spacing:.5px
}
.debug-server{
font-size:9px;
color:#7fa896;
opacity:.6;
word-break:break-all;
margin-bottom:8px;
line-height:1.4
}
.debug-grid{
display:grid;
grid-template-columns:repeat(3,1fr);
gap:6px;
margin-bottom:8px
}
.debug-cell{
background:rgba(0,255,136,.05);
border-radius:8px;
padding:6px 8px
}
.debug-cell span{
display:block;
font-size:8px;
color:#7fa896;
opacity:.7;
letter-spacing:.5px
}
.debug-cell b{
display:block;
font-size:11px;
color:#eafff5;
margin-top:2px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.debug-bar{
height:4px;
border-radius:4px;
background:rgba(0,255,136,.10);
overflow:hidden;
margin-bottom:8px
}
.debug-bar-fill{
height:100%;
width:0;
background:linear-gradient(90deg,#00ff88,#22d3ee);
transition:width .3s
}
.debug-log{
height:110px;
overflow-y:auto;
background:rgba(0,0,0,.35);
border-radius:8px;
padding:6px 8px;
font-size:9px;
line-height:1.6;
color:#9be8c4;
word-break:break-all;
-webkit-overflow-scrolling:touch
}
.log-line{
white-space:pre-wrap
}
.aurora-foot{
margin-top:12px;
text-align:center;
display:flex;
flex-direction:column;
gap:3px
}
.made,
.powered{
font-size:11px;
color:rgba(234,255,245,.66)
}
.heart{
display:inline-block;
color:#ff4d6d;
animation:beat 1.1s ease-in-out infinite
}
.jh{
font-weight:800;
background:linear-gradient(90deg,#00ff88,#22d3ee,#7dd3fc,#00ff88);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 5s linear infinite
}
.fiony{
font-weight:800;
background:linear-gradient(90deg,#22d3ee,#818cf8,#00ff88,#22d3ee);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 4.5s linear infinite
}
.copy{
font-size:9.5px;
color:rgba(234,255,245,.34);
letter-spacing:.8px;
margin-top:2px
}
@keyframes shine{
to{background-position:300% 0}
}
@keyframes beat{
0%,100%{transform:scale(1)}
30%{transform:scale(1.35)}
55%{transform:scale(1)}
75%{transform:scale(1.2)}
}
</style>
</head>

<body>
	<div class="player-wrap">
		<div class="aurora-head">
			<span class="aurora-title">AURORA — UR SPECIAL PLAYER</span>
		</div>
		<div class="player">
			<div class="bg" id="background"></div>
			<div class="bg-overlay"></div>
			<div class="content">
				<div class="top">
					<div>
						<div class="top-title" id="playlistTitle">NOW PLAYING VIDEO</div>
						<div class="top-sub" id="playlistSub">${escapeHtmlJs(finalTitle)}</div>
					</div>
					<button class="icon-btn" type="button" onclick="toggleMute()" id="muteButton">
						<svg id="volumeIcon" viewBox="0 0 24 24">
							<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
							<path d="M19 9a5 5 0 0 1 0 6"></path>
							<path d="M16 6.5a9 9 0 0 1 0 11"></path>
						</svg>
					</button>
				</div>

				<div class="video-frame" id="videoFrame" onclick="toggleVideo()">
					${mediaTag}
					<div class="big-play" id="bigPlay">
						<button class="big-btn" type="button" onclick="event.stopPropagation();toggleVideo()">
							<svg id="playIcon" viewBox="0 0 24 24">
								<path d="M8 5v14l11-7z"></path>
							</svg>
							<svg id="pauseIcon" viewBox="0 0 24 24" style="display:none">
								<path d="M7 5v14"></path>
								<path d="M17 5v14"></path>
							</svg>
						</button>
					</div>
				</div>

				<div class="info">
					<div class="song-title" id="songTitle">Unknown Video</div>
					<div class="artist" id="artist">Unknown Channel</div>
					<div class="player-status" id="playerStatus">${escapeHtmlJs(sourceNote || 'Tekan play buat mulai')}</div>
				</div>

				<div class="progress">
					<input id="progress" type="range" min="0" max="100" value="0" step="0.1" oninput="seekVideo(this.value)">
					<div class="times">
						<span id="currentTime">0:00</span>
						<span id="duration">0:00</span>
					</div>
				</div>

				<div class="controls">
					<button class="side-btn" type="button" onclick="previousVideo()">
						<svg viewBox="0 0 24 24">
							<path d="M19 20 9 12l10-8v16z"></path>
							<path d="M5 19V5"></path>
						</svg>
					</button>
					<button class="side-btn" type="button" onclick="toggleVideo()">
						<svg id="smallPlayIcon" viewBox="0 0 24 24">
							<path d="M8 5v14l11-7z"></path>
						</svg>
						<svg id="smallPauseIcon" viewBox="0 0 24 24" style="display:none">
							<path d="M7 5v14"></path>
							<path d="M17 5v14"></path>
						</svg>
					</button>
					<button class="side-btn" type="button" onclick="nextVideo()">
						<svg viewBox="0 0 24 24">
							<path d="m5 4 10 8-10 8V4z"></path>
							<path d="M19 5v14"></path>
						</svg>
					</button>
				</div>

				<div class="bottom">
					<div class="bottom-left">
						<button class="icon-btn" type="button" onclick="toggleRepeat()" id="repeatButton">
							<svg viewBox="0 0 24 24">
								<path d="M17 2l4 4-4 4"></path>
								<path d="M3 11V9a3 3 0 0 1 3-3h15"></path>
								<path d="m7 22-4-4 4-4"></path>
								<path d="M21 13v2a3 3 0 0 1-3 3H3"></path>
							</svg>
						</button>
					</div>
					<div class="bottom-right">
						<button class="icon-btn" type="button" onclick="toggleMute()">
							<svg viewBox="0 0 24 24">
								<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
								<path d="m19 9-5 6"></path>
								<path d="m14 9 5 6"></path>
							</svg>
						</button>
						<input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="1" oninput="changeVolume(this.value)">
					</div>
				</div>
			</div>
		</div>

		<div class="debug-wrap">
			<div class="debug-head">
				<div class="debug-title">MEDIA PROCESS</div>
				<div class="debug-state" id="wsState">CONNECTING</div>
			</div>
			<div class="debug-server" id="wsServer">-</div>
			<div class="debug-grid">
				<div class="debug-cell">
					<span>MIME</span>
					<b id="dbgMime">-</b>
				</div>
				<div class="debug-cell">
					<span>Downloaded</span>
					<b id="dbgDownloaded">0.00 MB</b>
				</div>
				<div class="debug-cell">
					<span>Total</span>
					<b id="dbgTotal">-</b>
				</div>
				<div class="debug-cell">
					<span>Progress</span>
					<b id="dbgProgress">0%</b>
				</div>
				<div class="debug-cell">
					<span>Chunks</span>
					<b id="dbgChunks">0</b>
				</div>
				<div class="debug-cell">
					<span>Loop</span>
					<b id="dbgLoop">OFF</b>
				</div>
			</div>
			<div class="debug-bar">
				<div class="debug-bar-fill" id="dbgBarFill"></div>
			</div>
			<div class="debug-log" id="debugLog"></div>
		</div>

		<div class="aurora-foot">
			<div class="made">Made with <span class="heart">❤</span> by <span class="jh">skyline-JXRA</span></div>
			<div class="powered">Powered by <span class="fiony">skyline-JXRA</span></div>
			<div class="copy">© <span id="year"></span> - All Rights Reserved</div>
		</div>
	</div>

	<script>
window.VIDEO_CONFIG = {
	title: "${escapeHtmlJs(cfg.title)}",
	channel: "${escapeHtmlJs(cfg.channel)}",
	duration: "${escapeHtmlJs(cfg.duration)}",
	videoUrl: "${escapeHtmlJs(cfg.videoUrl)}",
	wsUrl: "${escapeHtmlJs(cfg.wsUrl)}",
	isAudio: ${cfg.isAudio},
	preferWs: ${cfg.preferWs},
	autoplay: ${cfg.autoplay},
	volume: ${cfg.volume},
	loop: ${cfg.loop}
};

var video = document.getElementById("videoPlayer");
var frame = document.getElementById("videoFrame");
var songTitle = document.getElementById("songTitle");
var artist = document.getElementById("artist");
var progress = document.getElementById("progress");
var currentTime = document.getElementById("currentTime");
var durationLabel = document.getElementById("duration");
var volume = document.getElementById("volume");
var smallPlayIcon = document.getElementById("smallPlayIcon");
var smallPauseIcon = document.getElementById("smallPauseIcon");
var repeatButton = document.getElementById("repeatButton");
var playlistSub = document.getElementById("playlistSub");
var isLoop = false;
var userPressed = false;

var config = window.VIDEO_CONFIG || {};

/* ═══ DEBUG: console + panel ═══
 * Semua kejadian media dicatat ke console ([Aurora] ...) DAN ke panel
 * MEDIA PROCESS di kartu, biar kelihatan tanpa buka DevTools. */
function dbg(msg, level) {
	var line = String(msg);
	try {
		if (level === 'err') console.error('[Aurora] ' + line);
		else if (level === 'warn') console.warn('[Aurora] ' + line);
		else console.log('[Aurora] ' + line);
	} catch (e) {}
	try { writeLog(line); } catch (e) {}
}
function srcShort(u) { return String(u || '').replace(/apikey=[^&]+/g, 'apikey=***').slice(0, 110); }
window.addEventListener('error', function(e) {
	dbg('window.onerror: ' + (e.message || '?') + ' @' + (e.filename || '') + ':' + (e.lineno || 0), 'err');
});
window.addEventListener('unhandledrejection', function(e) {
	var r = e.reason || {};
	dbg('unhandledrejection: ' + (r.name || '?') + ' ' + (r.message || String(r)), 'err');
});
dbg('boot • origin=' + location.origin + ' • secure=' + window.isSecureContext);
dbg('ua=' + String(navigator.userAgent).slice(0, 100));
dbg('canPlay mp3=' + (video.canPlayType('audio/mpeg') || 'no') + ' • m4a=' + (video.canPlayType('audio/mp4') || 'no') + ' • mp4=' + (video.canPlayType('video/mp4') || 'no'));
var background = document.getElementById("background");
songTitle.textContent = config.title || "Unknown Video";
artist.textContent = config.channel || "Unknown Channel";
playlistSub.textContent = config.title || "Unknown Video";

var yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

if (video.poster && background) {
	background.style.backgroundImage = "url('" + video.poster + "')";
}

if (config.volume !== undefined) {
	video.volume = config.volume;
	volume.value = config.volume;
}
isLoop = config.loop || false;
video.loop = isLoop;
updateLoopStatus();

function formatTime(seconds) {
	if (!isFinite(seconds)) return "0:00";
	var min = Math.floor(seconds / 60);
	var sec = Math.floor(seconds % 60);
	if (sec < 10) sec = "0" + sec;
	return min + ":" + sec;
}

function setStatus(text, kind) {
	var el = document.getElementById("playerStatus");
	if (!el) return;
	el.textContent = text;
	el.className = "player-status" + (kind ? " " + kind : "");
}

function updateUI() {
	if (video.paused) {
		smallPlayIcon.style.display = "block";
		smallPauseIcon.style.display = "none";
		frame.classList.remove("frame-playing");
	} else {
		smallPlayIcon.style.display = "none";
		smallPauseIcon.style.display = "block";
		frame.classList.add("frame-playing");
	}
}

function ensureDirectSource() {
	if (!directMode) return;
	var url = config.videoUrl || "";
	if (!url) return;
	// Pasang ulang src saat user benar-benar menekan play: browser baru
	// mulai fetch media setelah ada gesture, jadi tidak menunggu halaman.
	if (video.readyState === 0 || video.src !== url) {
		video.src = url;
		video.load();
	}
}

var directWatchdog = null;

function armDirectWatchdog() {
	if (!directMode || streamStarted || !config.wsUrl) return;
	if (directWatchdog) clearTimeout(directWatchdog);
	directWatchdog = setTimeout(function() {
		directWatchdog = null;
		if (directMode && video.readyState === 0) {
			directMode = false;
			startWsFallback("timeout 8s");
		}
	}, 8000);
}

// Webview WA kadang cuma ngizinin audio mulai dalam keadaan mute
// (kebijakan autoplay). Coba normal dulu, kalau ditolak mute sebentar
// lalu unmute lagi — biar user tetap dengar suaranya.
function safePlay() {
	// Sebagian webview cuma ngizinin play kalau gesture-nya kena elemen media
	// sendiri, jadi pasang juga listener langsung di elemen (idempoten).
	if (!video.dataset.gestureBound) {
		video.dataset.gestureBound = '1';
		video.addEventListener('pointerdown', function() {
			if (video.paused) safePlay();
		});
	}
	var p = video.play();
	if (p && p.then) {
		p.then(function() { dbg('play() OK • t=' + video.currentTime.toFixed(2)); })
		 .catch(function(e) { dbg('play() reject: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || ''), 'err'); });
	}
	if (!p || !p.catch) return;
	p.catch(function(err) {
		writeLog("play() ditolak: " + ((err && err.name) || "?"));
		if (!diagDone) setStatus("Play ditolak webview — ketuk sekali lagi", "warn");
		video.muted = true;
		var p2 = video.play();
		if (!p2 || !p2.then) return;
		p2.then(function() {
			setTimeout(function() {
				video.muted = false;
			}, 350);
		}).catch(function(e2) {
			writeLog("play() gagal: " + ((e2 && e2.name) || "?"));
			if (!diagDone) setStatus("Audio diblokir webview (" + ((e2 && e2.name) || "?") + ") — ketuk play lagi", "err");
			setWsState("BLOCKED");
		});
	});
}

function playVideo() {
	setStatus("Menyambung ke sumber audio…", "");
	ensureDirectSource();
	safePlay();
	armDirectWatchdog();
	updateUI();
}

function toggleVideo() {
	if (video.paused) {
		if (!video.src) userPressed = true;
		playVideo();
	} else {
		userPressed = false;
		video.pause();
	}
	updateUI();
}

function previousVideo() {
	if (!isFinite(video.duration)) return;
	video.currentTime = Math.max(0, video.currentTime - 10);
}

function nextVideo() {
	if (!isFinite(video.duration)) return;
	video.currentTime = Math.min(video.duration, video.currentTime + 10);
}

function seekVideo(value) {
	if (!isFinite(video.duration)) return;
	video.currentTime = (Number(value) / 100) * video.duration;
}

function changeVolume(value) {
	video.volume = Number(value);
	if (video.volume > 0) {
		video.muted = false;
	}
}

function toggleMute() {
	video.muted = !video.muted;
}

function toggleRepeat() {
	isLoop = !isLoop;
	video.loop = isLoop;
	repeatButton.style.opacity = isLoop ? "1" : ".55";
	repeatButton.title = isLoop ? "Loop ON" : "Loop OFF";
	updateLoopStatus();
}

function updateLoopStatus() {
	var el = document.getElementById("dbgLoop");
	if (el) el.textContent = isLoop ? "ON" : "OFF";
}

video.addEventListener("loadedmetadata", function() {
	durationLabel.textContent = formatTime(video.duration);
});

video.addEventListener("timeupdate", function() {
	if (!isFinite(video.duration)) return;
	var value = (video.currentTime / video.duration) * 100;
	progress.value = value;
	currentTime.textContent = formatTime(video.currentTime);
	durationLabel.textContent = formatTime(video.duration);
});

video.addEventListener("play", function() {
	updateUI();
});

video.addEventListener("pause", function() {
	updateUI();
});

video.addEventListener("ended", function() {
	if (!isLoop) {
		progress.value = 0;
		currentTime.textContent = "0:00";
		video.currentTime = 0;
	}
	updateUI();
});

var wsVideo = null;
var wsChunks = [];
var wsDownloaded = 0;
var wsTotal = null;
var wsMime = "video/mp4";
var wsObjectUrl = null;
var wsDone = false;
var wsLastLog = 0;

function fmtSize(bytes) {
	if (!isFinite(bytes)) return "0 B";
	if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
	if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
	return bytes + " B";
}

function setWsState(state) {
	var el = document.getElementById("wsState");
	if (el) el.textContent = state;
}

function writeLog(line) {
	var box = document.getElementById("debugLog");
	if (!box) return;
	var div = document.createElement("div");
	div.className = "log-line";
	div.textContent = line;
	box.appendChild(div);
	while (box.childNodes.length > 80) {
		box.removeChild(box.firstChild);
	}
	box.scrollTop = box.scrollHeight;
}

function updateWsProgress() {
	var el = document.getElementById("dbgDownloaded");
	if (el) el.textContent = fmtSize(wsDownloaded);
	if (wsTotal !== null && wsTotal > 0) {
		var pct = Math.min(100, (wsDownloaded / wsTotal) * 100);
		el = document.getElementById("dbgTotal");
		if (el) el.textContent = fmtSize(wsTotal);
		el = document.getElementById("dbgProgress");
		if (el) el.textContent = pct.toFixed(1) + "%";
		el = document.getElementById("dbgBarFill");
		if (el) el.style.width = pct.toFixed(1) + "%";
		if (streamStarted && !wsDone) setStatus("Mengunduh " + pct.toFixed(0) + "% — jangan tutup kartu", "warn");
	}
	el = document.getElementById("dbgChunks");
	if (el) el.textContent = String(wsChunks.length);
}

function finishWsDownload(cfg) {
	if (wsDone) return;
	wsDone = true;
	setWsState("COMPLETE");
	writeLog("Download complete");
	var blob = new Blob(wsChunks, {
		type: wsMime || "video/mp4"
	});
	writeLog("Blob created (" + fmtSize(blob.size) + ")");
	if (wsObjectUrl) {
		URL.revokeObjectURL(wsObjectUrl);
	}
	wsObjectUrl = URL.createObjectURL(blob);
	writeLog("Video source attached");
	video.src = wsObjectUrl;
	video.load();
	writeLog("Player ready");
	setStatus("Siap — memutar", "");
	if (wsVideo) {
		try {
			wsVideo.close();
		} catch (e) {}
	}
	wsChunks = [];
	/* JANGAN play otomatis di sini. Ini dipanggil dari callback WebSocket,
	 * bukan dari ketukan user — Chrome/WebView bakal nolak dengan
	 * NotAllowedError dan statusnya jadi "diblokir webview".
	 * Yang benar: tunggu user mengetuk tombol play (gesture sah). */
	setStatus("Siap — ketuk play", "");
	writeLog("Siap diputar (autoplay sengaja mati: butuh ketukan user)");
}

function startVideoStream(cfg) {
	var videoUrl = cfg.videoUrl || "";
	var wsUrl = cfg.wsUrl || "";
	var serverEl = document.getElementById("wsServer");
	if (serverEl) {
		var host = "-";
		try {
			host = new URL(wsUrl).host;
		} catch (e) {}
		serverEl.textContent = host || "-";
	}
	if (!wsUrl) {
		setWsState("ERROR");
		writeLog("No video URL tersedia");
		return;
	}
	if (typeof WebSocket === "undefined") {
		setWsState("ERROR");
		writeLog("WebSocket API tidak tersedia");
		return;
	}
	writeLog("Connecting...");
	setWsState("CONNECTING");
	wsVideo = new WebSocket(wsUrl);
	wsVideo.binaryType = "arraybuffer";
	wsVideo.onopen = function() {
		writeLog("WebSocket OPEN");
		setWsState("CONNECTED");
	};
	wsVideo.onmessage = function(event) {
		if (typeof event.data === "string") {
			var message = null;
			try {
				message = JSON.parse(event.data);
			} catch (e) {}
			if (!message) return;
			if (message.type === "start") {
				wsMime = message.mime || "video/mp4";
				if (message.contentLength !== undefined && message.contentLength !== null) {
					wsTotal = Number(message.contentLength);
				} else if (message.length !== undefined && message.length !== null) {
					wsTotal = Number(message.length);
				}
				var mimeEl = document.getElementById("dbgMime");
				if (mimeEl) mimeEl.textContent = wsMime;
				writeLog("START | MIME: " + wsMime);
				if (wsTotal !== null && wsTotal > 0) {
					writeLog("Size: " + fmtSize(wsTotal));
				}
				setWsState("DOWNLOADING");
				updateWsProgress();
				return;
			}
			if (message.type === "end") {
				writeLog("END");
				finishWsDownload(config);
				return;
			}
			if (message.type === "error") {
				writeLog("Server error: " + (message.message || "unknown"));
				setWsState("ERROR");
				return;
			}
			return;
		}
		wsChunks.push(event.data);
		var bytes = event.data.byteLength || 0;
		wsDownloaded += bytes;
		var now = Date.now();
		if (now - wsLastLog > 400) {
			wsLastLog = now;
			writeLog("Binary chunk: " + fmtSize(bytes));
		}
		updateWsProgress();
	};
	wsVideo.onerror = function() {
		writeLog("WebSocket error");
		setWsState("ERROR");
	};
	wsVideo.onclose = function(event) {
		if (wsDone) {
			setWsState("COMPLETE");
			return;
		}
		writeLog("WebSocket closed unexpectedly");
		writeLog("Code: " + event.code + " Reason: " + (event.reason || "-"));
		setWsState("CLOSED");
	};
	window.addEventListener("beforeunload", function() {
		if (wsVideo) {
			try {
				wsVideo.close();
			} catch (e) {}
		}
		if (wsObjectUrl) {
			URL.revokeObjectURL(wsObjectUrl);
		}
	});
}

// Putar langsung dari URL API (progressive / Range 206) biar audio bisa bunyi
// dalam hitungan detik. Unduh penuh lewat WebSocket + tampung di memori dulu
// = "lagu gak bisa diputar" di HP lambat. WS sekarang cuma
// fallback kalau URL langsung gagal (403/CORS/blokir).
var streamStarted = false;
var directMode = false;

function startWsFallback(reason) {
	if (streamStarted) return;
	streamStarted = true;
	writeLog("Direct gagal (" + reason + ") — pakai WebSocket");
	setStatus("Sumber lambat — ngambil lewat WebSocket…", "warn");
	try {
		video.removeAttribute("src");
		video.load();
	} catch (e) {}
	startVideoStream(config);
}

function attachDirectSource() {
	var url = config.videoUrl || "";
	if (!url) {
		startWsFallback("URL kosong");
		return;
	}
	directMode = true;
	writeLog("Direct stream: " + url.slice(-32));
	video.preload = config.isAudio ? "auto" : "metadata";
	video.src = url;
	video.load();
	setWsState("DIRECT");
}

video.addEventListener("playing", function() {
	dbg('playing • t=' + video.currentTime.toFixed(2) + ' • rs=' + video.readyState);
	setStatus("Memutar", "");
});

video.addEventListener("loadstart", function() {
	dbg('loadstart • src=' + srcShort(video.currentSrc || video.src));
});

video.addEventListener("canplay", function() {
	dbg('canplay • rs=' + video.readyState + ' • dur=' + (isFinite(video.duration) ? video.duration.toFixed(1) : '?'));
});

video.addEventListener("suspend", function() {
	dbg('suspend • ns=' + video.networkState + ' • rs=' + video.readyState);
});

video.addEventListener("abort", function() {
	dbg('abort • ns=' + video.networkState, 'warn');
});

video.addEventListener("waiting", function() {
	dbg('waiting • rs=' + video.readyState + ' • ns=' + video.networkState, 'warn');
	if (!diagDone) setStatus("Buffering… tunggu sinyal", "warn");
});

video.addEventListener("stalled", function() {
	dbg('stalled • rs=' + video.readyState + ' • ns=' + video.networkState, 'warn');
	if (!diagDone) setStatus("Koneksi lambat — masih buffering", "warn");
});

video.addEventListener("loadedmetadata", function() {
	if (!directMode) return;
	setWsState("DIRECT");
	setStatus("Siap — durasi " + formatTime(video.duration), "");
	var mimeEl = document.getElementById("dbgMime");
	if (mimeEl) mimeEl.textContent = config.isAudio ? "audio" : "video";
	writeLog("Siap | durasi " + formatTime(video.duration));
});

// Diagnosa sekali per sesi: kalau media gagal, cek HTTP/Content-Type URL-nya
// biar status di kartu nyebut angka asli (403/502/HTML) — bukan cuma "kode 4".
var diagDone = false;
function diagnoseMedia() {
	// fetch() lintas-origin bakal diblok CORS, jadi diagnosa pakai info dari
	// elemen media sendiri: kode error + pesan asli dari engine.
	diagDone = true;
	var v = video.error;
	var detail = v ? ("kode " + v.code + (v.message ? " • " + v.message : "")) : "tanpa detail";
	writeLog("Diagnosa: " + detail + " • src=" + String(config.videoUrl || "").slice(0, 60) + "…");
}

var retriedDirect = false;
video.addEventListener("error", function() {
	var code = video.error ? video.error.code : 0;
	var msg = video.error && video.error.message ? " • " + video.error.message : "";
	dbg('media error • kode=' + code + msg + ' • rs=' + video.readyState + ' • ns=' + video.networkState + ' • src=' + srcShort(video.currentSrc || video.src), 'err');
	diagnoseMedia();
	if (!streamStarted) setStatus("Gagal memutar (kode " + code + msg + ") — pencet tombol play di player", "err");
	// Tampilkan kontrol bawaan browser: tombol play-nya = gesture sah, jadi
	// kalau kebijakan autoplay webview ketat, user tetap bisa mulai manual.
	try {
		video.controls = true;
		video.setAttribute('controls', 'controls');
	} catch (e) {}
	if (!directMode || streamStarted) {
		if (code) setWsState("ERROR " + code);
		return;
	}
	// Sekali coba ulang untuk SEMUA kode: endpoint proxy nge-resolve ulang tiap
	// request, jadi 502 sesaat (yang tampil sebagai kode 4) sering sembuh sendiri.
	if (!retriedDirect) {
		retriedDirect = true;
		setTimeout(function() {
			try {
				video.src = config.videoUrl;
				video.load();
				safePlay();
			} catch (e) {}
		}, 1200);
		return;
	}
	if (!config.wsUrl) {
		setWsState("ERROR");
		return;
	}
	directMode = false;
	startWsFallback("kode " + (video.error ? video.error.code : "?"));
});

// WebView kartu WA offline: media remote gak bisa dimuat, cuma WebSocket yang
// jalan. Kalau preferWs, langsung ambil lewat WS tanpa nyoba URL dulu.
if (config.preferWs && config.wsUrl) startWsFallback('mode WS (webview offline)');
else attachDirectSource();
</script>
</body>
</html>`;

  return htmlPayload;
}

const pluginConfig = {
  name: "aurora",
  alias: ['splay', 'streamplay', 'deck', 'vplay'],
  category: "downloader",
  description: "Aurora Deck — Player Music/Video",
  usage: ".aurora",
  example: ".aurora",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    let query = (ctx.text || '').trim();
    if (!query) {
      return ctx.reply(
        '🎧 *AURORA — UR SPECIAL PLAYER*\n\n' +
        '`.aurora <judul>` — audio mp3\n' +
        '`.aurora <judul> 720` — video\n' +
        '`.aurora <url youtube>` — direct'
      );
    }

    let customFormat = null;
    const mFmt = query.match(/^(.*?)\s+(mp3|m4a|144|240|360|480|720|1080|1440|2160)$/i);
    if (mFmt) { customFormat = mFmt[2].toLowerCase(); query = mFmt[1].trim(); }
    const format = customFormat || 'mp3';
    const t0 = Date.now();

    await ctx.react('🎧');

    /* Loading bar (satu pesan yang di-edit, tahap 1→4). Dikirim paling awal
     * supaya user langsung tahu botnya kerja — proses skyline bisa 10-30s. */
    const progress = createProgress(ctx, query.slice(0, 60));
    await progress.start();

    try {
      let candidates = [];
      if (/^https?:\/\//i.test(query)) {
        candidates = [{
          url: query, title: 'Aurora Stream', artist: 'skyline-JXRA Stream',
          thumbnail: '', duration: ''
        }];
      } else if (skylineReady()) {
        try {
          const results = await skylineSearch(query, 8);
          candidates = pickSearchCandidates(results, { forAudio: AUDIO_FORMAT.test(format) });
          if (!candidates.length) {
            logger.warn(`[Aurora] search "${query.slice(0, 60)}" → ${results.length} hasil, 0 kandidat valid`);
          }
        } catch (err) {
          logger.warn('[Aurora] Skyline search GAGAL — HTTP ' + (err?.status || 0) + ' • ' + (err?.message || err));
        }
      }
      if (!candidates.length) {
        // Tanpa API cadangan: kalau skyline ga bisa, ya error jujur.
        throw new Error('Lagu/video gak ketemu lewat skyline.web.id (search kosong)');
      }
      const info = candidates[0];

      // AUDIO → unduh lewat skyline lalu kirim kartu player berisi audio.
      if (AUDIO_FORMAT.test(format)) {
        await sendAuroraAudio(ctx, candidates, format, progress);
        await progress.finish(`selesai — kartu terkirim (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        await ctx.react('🎛️');
        return;
      }

      /* VIDEO: kandidat pertama bisa gagal probe (video live/restricted) —
       * coba kandidat berikutnya sebelum nyerah. */
      let media = null;
      let videoInfo = info;
      const vFails = [];
      progress.set(2, 'mengambil link video…', info.title);
      for (const cand of candidates.slice(0, 3)) {
        try {
          media = await resolveSource(cand, format);
          videoInfo = cand;
          break;
        } catch (err) {
          vFails.push(`"${String(cand.title || '').slice(0, 40)}": ${String(err?.message || err).slice(0, 160)}`);
          logger.warn(`[Aurora] video: kandidat gagal — ${String(err?.message || err).slice(0, 300)}`);
        }
      }
      if (!media?.url) throw new Error('Link final gak dapet' + (vFails.length ? ` — ${vFails.join(' | ')}` : ''));

      progress.set(3, 'menyiapkan kartu video…', videoInfo.title);
      const finalTitle = media.title || videoInfo.title || 'Unknown Video';
      const finalChannel = videoInfo.artist || 'Unknown Channel';
      const finalDuration = media.duration || '';
      // Thumbnail bisa dari sumber mana saja yang hidup — coba dua-duanya
      // paralel biar gak nambah waktu tunggu.
      const [thumbA, thumbB] = await Promise.all([
        thumbDataUri(media.thumbnail, { maxB64: 18000 }),
        thumbDataUri(videoInfo.thumbnail, { maxB64: 18000 })
      ]);
      const thumbnailb64 = thumbA || thumbB;

      const probe = media.probe || {};
      logger.info(
        `[Aurora] sumber dipakai: ${media.via} • host=${probe.host || '-'} • ${probe.type || '?'} • ` +
        `range=${probe.ranges ? 'ya' : 'tidak'} • ${probe.bytes || 0}B • locked=${probe.locked ? 'YA' : 'tidak'} • format=${format}`
      );
      if (probe.locked) {
        logger.warn('[Aurora] URL final IP-locked — HP bakal 403 kalau main langsung; kartu akan jatuh ke WebSocket (unduh dulu, baru bunyi)');
      }
      if (!probe.ok) {
        logger.warn(`[Aurora] URL final gagal probe (HTTP ${probe.status || 0}) — player kemungkinan gagal; cek log probe di atas`);
      }

      // Video: tanpa WebSocket pihak ketiga — cuma link skyline.
      const wsUrl = '';

      const sourceNote = media.preview
        ? `${media.preview} — tekan play`
        : 'Tekan play buat mulai';
      progress.set(4, 'mengirim kartu…', finalTitle);
      const htmlPayload = buildHtml({
        finalTitle, finalChannel, finalDuration,
        videoUrl: media.url, thumbnailb64, wsUrl,
        isAudio: AUDIO_FORMAT.test(String(format || 'mp3')),
        sourceNote
      });

      const sent = await sendNativeHtml(ctx.client, ctx.chat, htmlPayload);

      logger.info('[Aurora] kartu terkirim | id=' + (sent?.id || '?') + ' | sumber=' + media.via + (media.probe?.locked ? ' (locked → WS)' : ''));
      await progress.finish(`selesai — kartu terkirim (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      await ctx.react('🎛️');
    } catch (e) {
      logger.error(
        `[Aurora] GAGAL — ${e?.name || 'Error'} • status=${e?.status || 0} • kode=${e?.code || '-'} • ` +
        `pesan=${String(e?.message || e).slice(0, 900)}`
      );
      await ctx.react('❎');
      await progress.fail(e?.message || e);
      /* Error multi-baris (rincian tiap kandidat) jangan dipotong di tengah —
       * baris pertama buat user, sisanya sudah ada di log. */
      const lines = String(e?.message || e).split('\n');
      const head = lines[0].slice(0, 200);
      const hint = lines[1] ? '\n' + lines[1].slice(0, 200) : '';
      ctx.reply('*Aurora Error:* ' + head + hint);
    }
  }

export { pluginConfig as config, handler };
export const _internals = { resolveSource, probeMedia, isIpLocked, hostOf, buildHtml, buildCoverHtml, buildSpotifyHtml, thumbDataUri, thumbCandidates, payloadB64Len, buildLyricPanelHtml, prepareEmbeddedAudio, compressOpus, durToSeconds, audioEndpoint, withoutParam, redactUrl, fetchAudioBinary, downloadAudioViaSearch, pickSearchCandidates, searchResultToInfo, createProgress, progressBar };
