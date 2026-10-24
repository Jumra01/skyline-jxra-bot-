/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * jsonStore.js — Store JSON kecil buat data fitur (bukan data user RPG/premium),
 * disimpan di `data/<nama>.json` (tidak ikut git, tidak kena `.clearcache`),
 * tulis ditunda (debounce) + atomic (`tmp` lalu `rename`) biar aman kalau
 * bot dimatikan mendadak.
 */
import fs from 'node:fs'
import { logger } from '../core/logger.js'

export function createJsonStore(file, { delay = 1200, onError } = {}) {
  let data = {}
  let timer = null

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) data = raw
  } catch {
    /* file belum ada / rusak → mulai kosong */
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    try {
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data))
      fs.renameSync(tmp, file)
    } catch (err) {
      logger.warn({ err: String(err?.message || err) }, `[jsonStore] gagal simpan ${file}`)
      if (onError) onError(err)
    }
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(flush, delay)
    timer.unref?.()
  }

  return {
    file,
    get all() {
      return data
    },
    get(key) {
      return data[key]
    },
    set(key, value) {
      if (value === undefined || value === null) delete data[key]
      else data[key] = value
      schedule()
      return value
    },
    del(key) {
      delete data[key]
      schedule()
    },
    flush,
    entries() {
      return Object.entries(data)
    }
  }
}
