/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ytUi.js — Helper tampilan tombol YouTube (header thumbnail + tombol standar).
 *
 * Header media adalah cara paling reliable buat nampilin gambar di atas pesan
 * interaktif (JANGAN pakai externalAdReply — lihat catatan lib/richMessage.js).
 * Semua serba opsional: gagal ambil/upload gambar = pesan tetap terkirim
 * tanpa header.
 *
 * Catatan penting soal thumbnail YouTube:
 *  - `hqdefault.jpg` punya bar hitam atas-bawah (4:3). Itu normal.
 *  - Sebagian API ngasih URL relatif / gambar transparan. Kalau transparan
 *    dikonversi ke JPEG tanpa `flatten`, hasilnya HITAM. Karena itu semua
 *    gambar di-flatten ke putih dulu.
 *  - Kalau gambar dari API ternyata hitam/rusak, coba thumbnail resmi
 *    YouTube (`i.ytimg.com/vi/<id>/...`) sebelum menyerah.
 */
import sharp from 'sharp';
import { logger } from '../core/logger.js';

const MAX_THUMB_BYTES = 3 * 1024 * 1024;
const THUMB_TIMEOUT_MS = 5000;
// Batas total semua kandidat. Kalau jaringan panel ngeblok i.ytimg.com,
// jangan sampai user nunggu 4× timeout sebelum audio dikirim.
const THUMB_TOTAL_BUDGET_MS = 9000;
const UA = 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36';

/** Ambil ID video dari URL thumbnail YouTube (atau URL video). */
export function youtubeVideoId(url) {
  const s = String(url || '');
  const m =
    /(?:i\.ytimg\.com|img\.youtube\.com)\/vi\/([\w-]{11})\//i.exec(s) ||
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i.exec(s);
  return m ? m[1] : null;
}

function mediaFields(media) {
  return {
    url: media?.url,
    directPath: media?.directPath,
    mediaKey: media?.mediaKey,
    fileSha256: media?.fileSha256,
    fileEncSha256: media?.fileEncSha256,
    fileLength: media?.fileLength,
    mediaKeyTimestamp: media?.mediaKeyTimestamp
  };
}

async function downloadImage(url, timeoutMs = THUMB_TIMEOUT_MS) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
      redirect: 'follow'
    });
    if (!res.ok) return null;

    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_THUMB_BYTES) return null;

    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length || raw.length > MAX_THUMB_BYTES) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Gambar yang isinya hitam polos / terlalu gelap = kemungkinan gagal render. */
async function looksBlack(buf) {
  try {
    const stats = await sharp(buf).stats();
    const ch = stats.channels.slice(0, 3);
    if (!ch.length) return false;
    const mean = ch.reduce((a, c) => a + c.mean, 0) / ch.length;
    const dev = ch.reduce((a, c) => a + c.stdev, 0) / ch.length;
    return mean < 6 && dev < 3;
  } catch {
    return true;
  }
}

/**
 * Ambil thumbnail jadi buffer JPEG yang sudah divalidasi.
 * @param {string} url    thumbnail dari API (boleh relatif? kirim absolut)
 * @param {{width?:number, videoId?:string}} opts
 * @returns {Promise<null|{buffer:Buffer,width:number,height:number,source:string}>}
 */
export async function fetchThumbBuffer(url, { width = 800, videoId } = {}) {
  const id = videoId || youtubeVideoId(url);
  const ytCandidates = id
    ? ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg', 'mqdefault.jpg'].map(
        (q) => `https://i.ytimg.com/vi/${id}/${q}`
      )
    : [];

  // Kalau URL-nya memang thumbnail YouTube (hqdefault dll), utamakan
  // maxresdefault biar gak ada bar hitam atas-bawah. URL custom dari API
  // tetap dicoba duluan.
  const fromYt = /(?:i\.ytimg\.com|img\.youtube\.com)\/vi\//i.test(String(url || ''));
  const candidates = [];
  if (fromYt) {
    candidates.push(...ytCandidates);
    if (url) candidates.push(url);
  } else {
    if (url) candidates.push(url);
    candidates.push(...ytCandidates);
  }

  const deadline = Date.now() + THUMB_TOTAL_BUDGET_MS;
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    if (Date.now() > deadline) break;
    seen.add(candidate);

    const raw = await downloadImage(candidate, Math.min(THUMB_TIMEOUT_MS, deadline - Date.now()));
    if (!raw) continue;

    try {
      const buffer = await sharp(raw)
        .rotate()
        // PNG/WebP transparan kalau langsung dijadiin JPEG = HITAM.
        // Flatten ke putih dulu biar aman.
        .flatten({ background: '#ffffff' })
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();

      if (await looksBlack(buffer)) continue;

      const meta = await sharp(buffer).metadata();
      return {
        buffer,
        width: meta.width ?? width,
        height: meta.height ?? width,
        source: candidate
      };
    } catch {
      /* coba kandidat berikutnya */
    }
  }

  return null;
}

/**
 * Ambil thumbnail dari URL (YouTube/API) → upload ke WhatsApp → descriptor
 * `headerImage` buat `ctx.replyButtons` / `ctx.replyList`.
 * @returns {Promise<null|{kind:string, mimetype:string, width:number, height:number}>}
 */
export async function uploadThumbHeader(client, url, { width = 800, videoId } = {}) {
  if (!url && !videoId) return null;
  if (typeof client?.message?.upload !== 'function') return null;

  try {
    const thumb = await fetchThumbBuffer(url, { width, videoId });
    if (!thumb) return null;

    const media = await client.message.upload(thumb.buffer, { type: 'image', mimetype: 'image/jpeg' });

    return {
      kind: 'imageMessage',
      ...mediaFields(media),
      mimetype: 'image/jpeg',
      width: thumb.width,
      height: thumb.height
    };
  } catch (err) {
    logger.debug(`ytUi: header thumb dilewati (${err?.message || err})`);
    return null;
  }
}

/**
 * Thumbnail kecil buat `jpegThumbnail` di pesan video/audio (preview bubble).
 * @returns {Promise<Buffer|null>}
 */
export async function fetchJpegThumbnail(url, { width = 320, videoId } = {}) {
  const thumb = await fetchThumbBuffer(url, { width, videoId });
  return thumb?.buffer || null;
}

/** Tombol angka hasil pencarian (quick reply) — format standar richMessage. */
export function numberButtons(items, start, makeId) {
  return items.map((item, i) => ({
    text: String(start + i + 1),
    id: makeId(start + i)
  }));
}

export { MAX_THUMB_BYTES, THUMB_TIMEOUT_MS };
