/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * YTDLP.js — Ambil audio YouTube kualitas ASLI pakai yt-dlp.
 *
 * Kenapa perlu? Sumber gratisan (y2down/savenow, ytmp3.mobi, dll) hanya
 * menyajikan audio bitrate rendah lalu di-upscale jadi "320kbps" — treble di
 * atas ~11 kHz hilang, jadi kedengeran kayak kena kompres. yt-dlp langsung
 * mengambil stream resmi YouTube (m4a/AAC 128 kbps, treble sampai ~16 kHz).
 *
 * Ramah panel kecil (1 GB):
 *   • tanpa ffmpeg — audio tidak di-transcode, cukup diambil apa adanya
 *   • tanpa file temp — output di-stream ke memori (`-o -`)
 *   • ada batas ukuran + timeout, proses langsung dimatikan kalau lewat
 *
 * env override (buat panel / tes):
 *   YTDLP_BIN         path binary yt-dlp (default: `./yt-dlp` kalau ada, else PATH)
 *   YTDLP_TIMEOUT_MS  batas waktu unduh (default 90000)
 *   YTDLP_MAX_BYTES   batas ukuran audio (default 30 MB)
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_MAX_BYTES = 30 * 1024 * 1024

// Format yang aman diputar WhatsApp: m4a/AAC dulu, lalu mp4, terakhir mp3.
// Sengaja TIDAK menyertakan webm/opus — player WA gak enak buat container itu.
const FORMAT = 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[ext=mp3]'

// Pemutus otomatis: kalau yt-dlp gagal berkali-kali beruntun (misal IP panel
// diblok YouTube → 403), jangan bikin tiap `.play` nunggu percuma — dilewati
// dulu beberapa menit, lalu dicoba lagi otomatis.
const MAX_FAILS = 3
const SKIP_MS = 10 * 60_000

let cachedBin
let missing = false
let failStreak = 0
let skipUntil = 0

/** Buang cache pencarian binary + reset pemutus (dipakai tes / yt-dlp baru dipasang). */
export function resetYtdlpCache() {
  cachedBin = undefined
  missing = false
  failStreak = 0
  skipUntil = 0
}

/** Status ringkas buat log/tes. */
export function ytdlpState() {
  return {
    bin: cachedBin,
    missing,
    skipped: Date.now() < skipUntil,
    skipUntil,
    failStreak,
  }
}

function pickBin() {
  if (cachedBin) return cachedBin
  if (process.env.YTDLP_BIN) return (cachedBin = process.env.YTDLP_BIN)
  const local = join(process.cwd(), 'yt-dlp')
  cachedBin = existsSync(local) ? local : 'yt-dlp'
  return cachedBin
}

/** Tebak container dari magic bytes → { ext, mimetype } atau null kalau asing. */
export function sniffContainer(buf) {
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    return { ext: 'm4a', mimetype: 'audio/mp4' }
  }
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return { ext: 'mp3', mimetype: 'audio/mpeg' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { ext: 'mp3', mimetype: 'audio/mpeg' }
  }
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'fLaC') {
    return { ext: 'flac', mimetype: 'audio/flac' }
  }
  return null
}

/**
 * Unduh audio terbaik dari YouTube (tanpa transcode).
 * @returns {Promise<{buffer: Buffer, ext: string, mimetype: string, bin: string}>}
 * @throws kalau yt-dlp gak ada / gagal / lewat batas — pemanggil harus fallback.
 */
export function downloadBestAudio(url, opts = {}) {
  const timeoutMs = Number(process.env.YTDLP_TIMEOUT_MS) || opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const maxBytes = Number(process.env.YTDLP_MAX_BYTES) || opts.maxBytes || DEFAULT_MAX_BYTES
  const skipMs = Number(process.env.YTDLP_SKIP_MS) || opts.skipMs || SKIP_MS
  const bin = opts.bin || pickBin()

  return new Promise((resolve, reject) => {
    if (missing) return reject(new Error('yt-dlp tidak tersedia'))
    if (Date.now() < skipUntil) return reject(new Error('yt-dlp di-skip sementara (gagal beruntun)'))

    const args = [
      '--no-warnings',
      '--no-playlist',
      '--no-progress',
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      '-f', FORMAT,
      '-o', '-',
      '--', String(url),
    ]

    let child
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return reject(err)
    }

    const chunks = []
    let size = 0
    let stderr = ''
    let done = false
    let timer

    const finish = (fn, arg) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { child.kill('SIGKILL') } catch {}
      fn(arg)
    }

    // Catat kegagalan beruntun → rem sementara biar `.play` gak nunggu tiap kali.
    const fail = (err) => {
      failStreak += 1
      if (failStreak >= MAX_FAILS) {
        skipUntil = Date.now() + skipMs
        failStreak = 0
      }
      finish(reject, err)
    }

    timer = setTimeout(
      () => fail(new Error(`yt-dlp timeout ${timeoutMs}ms`)),
      timeoutMs
    )

    child.on('error', (err) => {
      if (err?.code === 'ENOENT') {
        missing = true
        return fail(new Error('yt-dlp tidak terpasang'))
      }
      fail(err)
    })

    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        return fail(new Error(`audio kelewat besar (> ${Math.round(maxBytes / 1048576)}MB)`))
      }
      chunks.push(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })

    child.on('close', (code) => {
      if (done) return
      if (code !== 0) {
        const last = stderr.trim().split('\n').filter(Boolean).pop() || ''
        return fail(new Error(`yt-dlp gagal (exit ${code})${last ? `: ${last}` : ''}`))
      }
      const buffer = Buffer.concat(chunks)
      if (!buffer.length) return fail(new Error('yt-dlp tidak mengembalikan data'))
      const kind = sniffContainer(buffer)
      if (!kind) return fail(new Error('format audio hasil yt-dlp tidak dikenali'))
      failStreak = 0
      skipUntil = 0
      finish(resolve, { buffer, ...kind, bin })
    })
  })
}

export default { downloadBestAudio, sniffContainer, resetYtdlpCache, ytdlpState }
