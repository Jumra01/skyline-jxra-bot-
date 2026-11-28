/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * soundSticker.js — Stiker bersuara (audioStickerMessage, proto field 134)
 *
 * WA sound sticker = wrapper top-level `audioStickerMessage.message.stickerMessage`
 * yang membawa `audioMessage` (Opus) di dalam StickerMessage. Upload dua media
 * lewat API resmi zapo (`client.message.upload`), terus proto dirakit mentah
 * dan dikirim lewat `client.message.send`.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import { buildSticker } from './sticker.js'

/** Batas fitur sound sticker di WA. */
export const MAX_SOUND_SECONDS = 10

function run(file, args, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, out, stderr) => {
      if (err) reject(new Error(`${file}: ${String(stderr).slice(-300) || err.message}`))
      else resolve(out)
    })
  })
}

/**
 * Audio apa pun (track video / voice note / mp3) → Ogg Opus 48k mono —
 * format pesan suara WA. Balik `{ buffer, seconds }`.
 */
export async function audioToOpus(buffer, maxSeconds = MAX_SOUND_SECONDS) {
  const dir = await mkdtemp(join(tmpdir(), 'sstk-'))
  const inPath = join(dir, 'in.bin')
  const outPath = join(dir, 'out.ogg')

  try {
    await writeFile(inPath, buffer)
    await run('ffmpeg', [
      '-y', '-loglevel', 'error', '-nostdin',
      '-i', inPath,
      '-t', String(maxSeconds),
      '-vn',
      '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000',
      '-application', 'voip', '-frame_duration', '20',
      '-f', 'ogg', outPath
    ])
    const out = await readFile(outPath)
    const probe = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outPath]
    ).catch(() => '')
    const seconds = Math.max(1, Math.min(maxSeconds, Math.ceil(Number.parseFloat(probe) || maxSeconds)))
    logger.info(`🔊 opus sound sticker: ${(out.length / 1024).toFixed(0)}KB ${seconds}s`)
    return { buffer: out, seconds }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Stiker (gambar/GIF/video) + buffer audio → payload siap kirim.
 * Audio dipotong maks `MAX_SOUND_SECONDS`.
 */
export async function buildSoundSticker(media, audioBuffer, {
  packName, author, withExif = true, maxVideoSeconds = 10
} = {}) {
  const webp = await buildSticker(media, { packName, author, withExif, maxVideoSeconds })
  const isAnimated = media.kind === 'video' || /gif/i.test(media.mimetype || '')
  const { buffer: ogg, seconds } = await audioToOpus(audioBuffer, MAX_SOUND_SECONDS)
  return { webp, isAnimated, ogg, seconds }
}

/**
 * Upload sticker + audio ke CDN WA, rakit `audioStickerMessage` (field 134),
 * kirim. Field yang disusun mengikuti jalur typed `type:'sticker'`/`type:'audio'`
 * di zapo (uploadedFields + properti message yang sama).
 */
export async function sendSoundSticker(client, chat, { webp, isAnimated, ogg, seconds }) {
  const [sticker, audio] = await Promise.all([
    client.message.upload(webp, { type: 'sticker', mimetype: 'image/webp' }),
    client.message.upload(ogg, { type: 'audio', mimetype: 'audio/ogg; codecs=opus' })
  ])
  const nowSec = Math.floor(Date.now() / 1000)

  return client.message.send(chat, {
    audioStickerMessage: {
      message: {
        stickerMessage: {
          url: sticker.url,
          directPath: sticker.directPath,
          mediaKey: sticker.mediaKey,
          fileSha256: sticker.fileSha256,
          fileEncSha256: sticker.fileEncSha256,
          fileLength: sticker.fileLength,
          mediaKeyTimestamp: sticker.mediaKeyTimestamp ?? nowSec,
          mimetype: 'image/webp',
          width: 512,
          height: 512,
          isAnimated,
          stickerSentTs: Date.now(),
          /* audioMessage field 26 — DI DALAM StickerMessage (bukan saudara
           * message): taruh di level message biasa → jatuh jadi pesan audio
           * biasa (Message.audioMessage field 8) dan stikernya jadi diam. */
          audioMessage: {
            url: audio.url,
            directPath: audio.directPath,
            mediaKey: audio.mediaKey,
            fileSha256: audio.fileSha256,
            fileEncSha256: audio.fileEncSha256,
            fileLength: audio.fileLength,
            mediaKeyTimestamp: audio.mediaKeyTimestamp ?? nowSec,
            mimetype: 'audio/ogg; codecs=opus',
            seconds,
            streamingSidecar: audio.streamingSidecar
          }
        }
      }
    }
  })
}
