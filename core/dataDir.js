/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * dataDir.js — Folder `./data/` untuk database bot (users/rpg/settings).
 *
 * Dipisah dari session/ biar data user (termasuk premiumdb) GAK ikut
 * hilang kalau owner hapus session/ buat pairing ulang — di session/
 * cuma kredensial auth (state.sqlite, qr.png).
 */
import fs from 'node:fs'
import { logger } from './logger.js'

const DATA_DIR = './data'
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

/**
 * Path file DB di ./data. Kalau file lama masih di ./session (build lama),
 * pindahkan bareng suffix -wal/-shm/-journal biar gak ada data yang tertinggal.
 */
export function dbPath(filename) {
  const newPath = `${DATA_DIR}/${filename}`
  const oldPath = `./session/${filename}`
  if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
    try {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        if (fs.existsSync(oldPath + suffix)) fs.renameSync(oldPath + suffix, newPath + suffix)
      }
      logger.info(`📁 ${filename} dipindah dari session/ ke data/ (biar aman kalau session dihapus)`)
    } catch (err) {
      logger.error(`⚠️ Gagal mindahin ${filename} ke data/: ${err.message} — tetap pakai session/`)
      return oldPath
    }
  }
  return newPath
}
