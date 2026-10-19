/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * audioCover.js — Tanam cover (thumbnail YouTube) ke file audio.
 *
 * WhatsApp nampilin kotak HITAM buat audio yang gak punya cover di dalam
 * filenya. yt-dlp & kebanyakan API audio gak menyertakan cover, jadi kita
 * tanam sendiri pakai ffmpeg TANPA re-encode (`-c copy`) — kualitas audio
 * persis sama, cuma ditambah artwork ID3 (MP3) / atom covr (M4A).
 *
 * ffmpeg gak ada / gagal = MP3 tetap bisa (fallback ID3 murni JS tanpa
 * dependensi); M4A balik ke buffer asli. Fitur tetap jalan.
 * Pemanggil sebaiknya tetap kirim foto thumbnail (caption) sebagai fallback.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 25_000;

// null = belum dicek, true = ada, false = gak ada (biar gak spawn terus)
let ffmpegAvailable = null;

/** ID3v2.3 syncsafe integer (7 bit per byte). */
function syncsafe(n) {
  return Buffer.from([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);
}

function withoutId3v2(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return buf;
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = (buf[5] & 0x10) !== 0 ? 10 : 0;
  return buf.subarray(10 + size + footer);
}

/**
 * Fallback TANPA ffmpeg: tulis ID3v2.3 + frame APIC langsung ke MP3.
 * Dipakai kalau ffmpeg gak terpasang / gagal. Tag lama diganti tag baru
 * (judul/artis lama hilang — tapi cover-nya muncul, gak hitam lagi).
 */
export function injectId3Cover(audioBuffer, coverJpeg) {
  if (!audioBuffer?.length || !coverJpeg?.length) return null;

  try {
    const audio = withoutId3v2(audioBuffer);
    const body = Buffer.concat([
      Buffer.from([0]), // text encoding ISO-8859-1
      Buffer.from('image/jpeg\0', 'latin1'), // MIME
      Buffer.from([3, 0]), // picture type 3 (front cover) + description kosong
      coverJpeg
    ]);

    const frameHeader = Buffer.alloc(10);
    frameHeader.write('APIC', 0, 'latin1');
    frameHeader.writeUInt32BE(body.length, 4);
    frameHeader[8] = 0;
    frameHeader[9] = 0;

    const frames = Buffer.concat([frameHeader, body]);
    const header = Buffer.concat([
      Buffer.from('ID3', 'latin1'),
      Buffer.from([3, 0, 0]),
      syncsafe(frames.length)
    ]);

    return Buffer.concat([header, frames, audio]);
  } catch {
    return null;
  }
}

function extFromMime(mimetype) {
  const m = String(mimetype || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return null;
}

function ffmpegArgs(ext, input, cover, output) {
  if (ext === 'mp3') {
    return [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', input,
      '-i', cover,
      '-map', '0:a', '-map', '1:v',
      '-c', 'copy',
      '-id3v2_version', '3',
      '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)',
      output
    ];
  }
  // M4A / MP4 audio: cover disimpan sebagai attached_pic.
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-i', cover,
    '-map', '0:a', '-map', '1:v',
    '-c', 'copy',
    '-disposition:v', 'attached_pic',
    output
  ];
}

/**
 * Rapikan gambar cover (transparan → putih, resize, JPEG).
 * Dipakai buat cover dari file lokal (koleksi `.music` / `.mengkane`).
 * @param {Buffer} image
 * @param {number} width
 * @returns {Promise<Buffer|null>}
 */
export async function prepareCover(image, width = 640) {
  if (!image?.length) return null;
  try {
    return await sharp(image)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Tanam cover JPEG ke audio.
 * @param {Buffer} audioBuffer
 * @param {string} mimetype  audio/mpeg | audio/mp4 | audio/m4a
 * @param {Buffer} coverJpeg
 * @returns {Promise<{buffer:Buffer, embedded:boolean}>}
 */
export async function embedAudioCover(audioBuffer, mimetype, coverJpeg) {
  const original = { buffer: audioBuffer, embedded: false };
  if (!audioBuffer?.length || !coverJpeg?.length) return original;

  const ext = extFromMime(mimetype);
  if (!ext) return original;

  const id3Fallback = () => {
    if (ext !== 'mp3') return null;
    const buf = injectId3Cover(audioBuffer, coverJpeg);
    return buf ? { buffer: buf, embedded: true, method: 'id3' } : null;
  };

  if (ffmpegAvailable === false) return id3Fallback() ?? original;

  let dir;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skyline-cover-'));
    const input = path.join(dir, `in.${ext}`);
    const cover = path.join(dir, 'cover.jpg');
    const output = path.join(dir, `out.${ext}`);

    await fs.writeFile(input, audioBuffer);
    await fs.writeFile(cover, coverJpeg);

    await execFileAsync('ffmpeg', ffmpegArgs(ext, input, cover, output), {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024
    });

    const out = await fs.readFile(output);
    if (out.length < 512) return id3Fallback() ?? original;

    ffmpegAvailable = true;
    return { buffer: out, embedded: true, method: 'ffmpeg' };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      ffmpegAvailable = false;
      logger.warn('audioCover: ffmpeg gak ada — pakai ID3 fallback buat MP3');
    } else {
      logger.debug(`audioCover: ffmpeg gagal (${err?.message || err}) — coba ID3 fallback`);
    }
    return id3Fallback() ?? original;
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function isFfmpegAvailable() {
  return ffmpegAvailable;
}
