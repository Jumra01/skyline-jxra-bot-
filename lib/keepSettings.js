/**
 * © skyline-JXRA — Penyimpanan & pemulihan SETTING MILIK USER
 *
 * Dipakai `.updatesc` (backup sebelum update) dan `.restore` (balikin
 * setting + apikey dari backup tanpa menyentuh kode).
 *
 * Dua jenis data yang dijaga:
 *  1. Nilai di `config.js`  → KEEP_FIELDS. Repo sengaja mengosongkan
 *     field rahasia (tiap pengguna isi punya mereka), jadi nilai lokal
 *     harus selalu menang.
 *  2. File BINARY punya user → KEEP_FILES (thumbnail `.setthumb` /
 *     `.setreply thumb`). File-file ini ke-track di git, jadi pas
 *     update bakal ketimpa versi default.
 *
 * Deteksi "sudah pernah disetting atau belum" pakai pembandingan
 * SHA-1 blob git (`blob <len>\0<isi>`) terhadap `HEAD:<path>` — biner
 * aman karena gak lewat stdout yang bisa korup encoding.
 *
 * Backup disimpan di `config.js.update.bak` + folder `updatesc-keep.bak/`.
 * Nama keduanya diakhiri `.bak` supaya kena rule `*.bak` di .gitignore —
 * gak perlu nambah entry ignore baru.
 *
 * PENTING: `saveKeep()` TIDAK PERNAH menghapus backup yang sudah ada.
 * File di backup bisa jadi setting user dari update sebelumnya yang belum
 * di-`.restore`, sedangkan file lokal udah keburu balik default gara-gara
 * update itu — kalau ikut dihapus, setting user hilang permanen.
 * Penghapusan cuma dilakuin `restoreFromBackup()` setelah sukses memulihkan.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const pexec = promisify(execFile)

export const KEEP_FIELDS = [
  { block: 'omniedit', key: 'apikey' },
  { block: 'spotify', key: 'clientId' },
  { block: 'spotify', key: 'clientSecret' },
  // apikey AI chat (.bot). Nilai normalnya di `src/data/ai.json` (gitignored),
  // tapi kalau ada yang nulis di config.js, jangan sampai kehapus pas update.
  { block: 'aiChat', key: 'apikey' }
]

export const KEEP_FILES = [
  'assets/thumb/menu.jpg',
  'assets/thumb/allmenu.jpg',
  'assets/thumb/cta-thumb.jpg',
  'assets/thumb/v4-thumb.jpg'
]

export const KEEP_BAK = 'config.js.update.bak'
export const KEEP_BAK_DIR = 'updatesc-keep.bak'

// safe.directory=* → amanin kasus Docker/panel (repo beda user sama proses)
function git(args, timeout = 30_000) {
  return pexec('git', ['-c', 'safe.directory=*', ...args], {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 8 * 1024 * 1024
  }).then((r) => ({ out: String(r.stdout ?? '').trim() }))
}

/** Cari rentang `{ ... }` milik blok bernama `name`. */
export function findBlock(src, name) {
  const at = src.search(new RegExp(`(^|\\n)[ \\t]*${name}[ \\t]*:[ \\t]*\\{`))
  if (at < 0) return null
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { open, close: i }
    }
  }
  return null
}

/** Baca nilai KEEP_FIELDS dari sumber config.js (cuma yang keisi). */
export function readKeep(src) {
  const out = []
  for (const { block, key } of KEEP_FIELDS) {
    const b = findBlock(src, block)
    if (!b) continue
    const m = src
      .slice(b.open, b.close)
      .match(new RegExp(`(^|[\\s{,])${key}[ \\t]*:[ \\t]*(['"\`])([^'"\`]*)\\2`))
    if (m && m[3]) out.push({ block, key, value: m[3] })
  }
  return out
}

/** Tulis nilai KEEP_FIELDS ke sumber config.js. */
export function writeKeep(src, keeps) {
  let out = src
  for (const { block, key, value } of keeps) {
    const b = findBlock(out, block)
    if (!b) continue // bloknya gak ada di config sekarang → biarin, nanti ke-lapor
    const seg = out.slice(b.open, b.close)
    const re = new RegExp(`(^|[\\s{,])(${key}[ \\t]*:[ \\t]*)(['"\`])([^'"\`]*)\\3`)
    if (!re.test(seg)) continue // field-nya gak ada → biarin
    const nseg = seg.replace(re, (_f, pre, decl, q) => `${pre}${decl}${q}${value}${q}`)
    out = out.slice(0, b.open) + nseg + out.slice(b.close)
  }
  return out
}

/** SHA-1 blob git (`blob <len>\0<isi>`) — biar biner bisa dibanding. */
export function gitBlobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/**
 * File ini isinya PERSIS sama kayak versi `ref` (default HEAD)? Berarti
 * user belum pernah ngubahnya → gak usah di-backup-kan balik, biar versi
 * terbarunya dari update yang menang.
 * `ref` bisa diganti (mis. `FETCH_HEAD` pas bootstrap yang belum punya HEAD).
 */
export async function assetPristine(rel, ref = 'HEAD') {
  try {
    const refSha = (await git(['rev-parse', `${ref}:${rel}`], 15_000)).out
    return gitBlobSha(await fs.readFile(rel)) === refSha
  } catch {
    return false
  }
}

/**
 * Backup semua setting milik user. Panggil SEBELUM file ditimpa update.
 * `assets` cuma berisi file yang BENERAN pernah diubah user — thumbnail
 * yang isinya persis default gak dibuatkan backup (sekaligus jadi
 * penanda, biar `.restore` gak ngebatalin update default dari repo).
 * Balikin `{ keeps, assets }` — dipakai `assetDirty` buat nahan `git pull`.
 */
export async function saveKeep(opts = {}) {
  const keeps = []
  const assets = []

  // Cara nentuin "file ini masih default atau udah diubah user".
  // Default: banding SHA-1 blob vs `HEAD` (butuh git).
  // Jalur tanpa git (API) / belum punya HEAD (bootstrap) WAJIB nyerahin
  // pembanding sendiri lewat `opts.pristine` — kalau nggak, semua file
  // bakal dianggap "diubah user" & ikut ke-backup padahal masih default.
  const isPristine = typeof opts.pristine === 'function' ? opts.pristine : assetPristine

  // Backup yang SUDAH ada dari update sebelumnya (belum di-`.restore`) —
  // dilaporkan ke pemanggil biar user tau masih ada yang nunggu dipulihin.
  let pendingConfig = false
  let pendingAssets = 0
  try {
    pendingConfig = readKeep(await fs.readFile(KEEP_BAK, 'utf8')).length > 0
  } catch {}
  try {
    pendingAssets = (await fs.readdir(KEEP_BAK_DIR)).filter((f) =>
      KEEP_FILES.some((p) => path.basename(p) === f)
    ).length
  } catch {}

  try {
    const src = await fs.readFile('config.js', 'utf8')
    keeps.push(...readKeep(src))
    if (keeps.length) await fs.writeFile(KEEP_BAK, src, 'utf8') // jaring pengaman
  } catch {}
  for (const rel of KEEP_FILES) {
    const bak = path.join(KEEP_BAK_DIR, path.basename(rel))
    try {
      await fs.access(rel)
      // Isinya persis default → gak ada yang perlu dibackup.
      // PENTING: backup yang SUDAH ada JANGAN dihapus di sini — file itu
      // bisa jadi setting user dari update sebelumnya yang belum di-`.restore`
      // (dan file lokal udah keburu balik default gara-gara update itu).
      // Penghapusan cuma dilakuin `.restore` setelah sukses memulihkan.
      if (await isPristine(rel)) continue
      await fs.mkdir(KEEP_BAK_DIR, { recursive: true })
      await fs.copyFile(rel, bak)
      assets.push({ rel })
    } catch {}
  }
  return { keeps, assets, pending: { config: pendingConfig, assets: pendingAssets } }
}

/**
 * Balikin setting dari file backup (boleh kapan aja, bukan cuma pasca-update).
 * `spec`: `{ config, assets }` — mana yang mau dipulihkan.
 * Cuma file yang ADA di backup yang dipulihkan — dan backup cuma berisi
 * yang pernah diubah user (lihat `saveKeep`), jadi update default dari
 * repo tetap utuh buat file yang belum pernah disentuh.
 * Backup yang BERHASIL dipulihkan ikut DIHAPUS (`cleanedConfig` /
 * `cleanedAssets`) — biar gak numpuk dan gak bingung mana yang udah.
 * Yang GAGAL sengaja disimpan biar bisa dicoba ulang.
 * Balikin `{ kept, lost, assetsKept, assetsLost, cleanedConfig, cleanedAssets }`.
 */
export async function restoreFromBackup(spec = {}) {
  const wantConfig = spec.config !== false
  const wantAssets = spec.assets !== false
  const kept = []
  const lost = []
  const assetsKept = []
  const assetsLost = []
  let cleanedConfig = false
  const cleanedAssets = []

  // ── nilai di config.js ──
  if (wantConfig) {
    let keeps = []
    try {
      keeps = readKeep(await fs.readFile(KEEP_BAK, 'utf8'))
    } catch {}
    if (keeps.length) {
      try {
        const fresh = await fs.readFile('config.js', 'utf8')
        await fs.writeFile('config.js', writeKeep(fresh, keeps), 'utf8')
        // verifikasi beneran kebaca — jangan percaya tulis aja
        const verify = readKeep(await fs.readFile('config.js', 'utf8'))
        for (const k of keeps) {
          const ok = verify.some((v) => v.block === k.block && v.key === k.key && v.value === k.value)
          ;(ok ? kept : lost).push(`${k.block}.${k.key}`)
        }
        // Semua kebaca balik → file backup boleh dibuang.
        // Ada yang gagal → file tetap disimpan buat percobaan ulang.
        if (!lost.length) {
          await fs.rm(KEEP_BAK, { force: true }).catch(() => {})
          cleanedConfig = true
        }
      } catch {
        for (const k of keeps) lost.push(`${k.block}.${k.key}`)
      }
    }
  }

  // ── file biner punya user (thumbnail) ──
  if (wantAssets) {
    let daftar = []
    try {
      daftar = (await fs.readdir(KEEP_BAK_DIR)).filter((f) => f !== '.' && f !== '..')
    } catch {}
    for (const f of daftar) {
      const rel = KEEP_FILES.find((p) => path.basename(p) === f)
      if (!rel) continue // file backup yang gak dikenal → jangan ditebak tujuannya
      const bak = path.join(KEEP_BAK_DIR, f)
      try {
        await fs.mkdir(path.dirname(rel), { recursive: true })
        await fs.copyFile(bak, rel)
        const sama = gitBlobSha(await fs.readFile(rel)) === gitBlobSha(await fs.readFile(bak))
        ;(sama ? assetsKept : assetsLost).push(rel)
        if (sama) {
          // Berhasil & terverifikasi → backup file-nya dibuang.
          await fs.rm(bak, { force: true }).catch(() => {})
          cleanedAssets.push(rel)
        }
      } catch {
        assetsLost.push(rel)
      }
    }
    // Folder jadi kosong → rapikan (buang dir-nya juga)
    try {
      const sisa = await fs.readdir(KEEP_BAK_DIR)
      if (!sisa.length) await fs.rmdir(KEEP_BAK_DIR)
    } catch {}
  }

  return { kept, lost, assetsKept, assetsLost, cleanedConfig, cleanedAssets }
}

/** Isi backup sekarang — buat ditampilin ke user sebelum dia memilih. */
export async function backupStatus() {
  const config = []
  let configAda = false
  try {
    const src = await fs.readFile(KEEP_BAK, 'utf8')
    configAda = true
    config.push(...readKeep(src).map((k) => `${k.block}.${k.key}`))
  } catch {}

  const assets = []
  try {
    for (const f of await fs.readdir(KEEP_BAK_DIR)) {
      const rel = KEEP_FILES.find((p) => path.basename(p) === f)
      if (!rel) continue
      try {
        const st = await fs.stat(path.join(KEEP_BAK_DIR, f))
        assets.push({ rel, size: st.size, mtime: st.mtimeMs })
      } catch {}
    }
  } catch {}

  return { configAda, config, assets }
}
