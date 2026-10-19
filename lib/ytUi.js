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
 */
import sharp from 'sharp';
import { logger } from '../core/logger.js';

const MAX_THUMB_BYTES = 3 * 1024 * 1024;
const THUMB_TIMEOUT_MS = 6000;

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

/**
 * Ambil thumbnail dari URL (YouTube/API) → upload ke WhatsApp → descriptor
 * `headerImage` buat `ctx.replyButtons` / `ctx.replyList`.
 * @returns {Promise<null|{kind:string, mimetype:string, width:number, height:number}>}
 */
export async function uploadThumbHeader(client, url, { width = 800 } = {}) {
  if (!url || typeof client?.message?.upload !== 'function') return null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(THUMB_TIMEOUT_MS) });
    if (!res.ok) return null;

    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length || raw.length > MAX_THUMB_BYTES) return null;

    const buf = await sharp(raw)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const meta = await sharp(buf).metadata();

    const media = await client.message.upload(buf, { type: 'image', mimetype: 'image/jpeg' });

    return {
      kind: 'imageMessage',
      ...mediaFields(media),
      mimetype: 'image/jpeg',
      width: meta.width ?? width,
      height: meta.height ?? width
    };
  } catch (err) {
    logger.debug(`ytUi: header thumb dilewati (${err?.message || err})`);
    return null;
  }
}

/** Tombol angka hasil pencarian (quick reply) — format standar richMessage. */
export function numberButtons(items, start, makeId) {
  return items.map((item, i) => ({
    text: String(start + i + 1),
    id: makeId(start + i)
  }));
}

export { MAX_THUMB_BYTES, THUMB_TIMEOUT_MS };
