/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * musicCover.js — Cover default buat koleksi `.music` & `.mengkane`.
 *
 * File audio dari GitHub gak punya artwork di dalamnya, jadi WhatsApp
 * nampilin kotak hitam. Cover ini ditanam ke file audio (ffmpeg -c copy)
 * biar bubble-nya ada gambar.
 *
 * Dipakai juga sebagai fallback kalau thumbnail YouTube gagal diambil
 * (mis. i.ytimg.com diblokir di panel) — lebih baik logo bot daripada hitam.
 */
import fs from 'node:fs/promises';
import { prepareCover } from './audioCover.js';

const cache = new Map();

/**
 * Cover default (assets/thumb/cta-thumb.jpg) yang sudah di-resize.
 * @param {number} width 640 buat cover audio, 320 buat jpegThumbnail video
 * @returns {Promise<Buffer|null>}
 */
export function getCollectionCover(width = 640) {
  if (!cache.has(width)) {
    cache.set(
      width,
      fs
        .readFile(new URL('../assets/thumb/cta-thumb.jpg', import.meta.url))
        .then((buf) => prepareCover(buf, width))
        .catch(() => null)
    );
  }
  return cache.get(width);
}
