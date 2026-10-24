/**
 * © skyline-JXRA — Penyimpanan & pemulihan SETTING MILIK USER
 *
 * Dipakai `.updatesc` (backup sebelum update + pulih otomatis) dan
 * `.restore` (pemulihan manual). Dua jenis data yang dijaga: nilai
 * `config.js` (KEEP_FIELDS) dan file biner punya user (KEEP_FILES,
 * thumbnail) — keduanya ke-track di git jadi bisa ketimpa update.
 * Deteksi "sudah pernah disetting" pakai pembandingan SHA-1 blob git
 * (`blob <len>\0<isi>`) terhadap `HEAD:<path>`; backup disimpan di
 * `config.js.update.bak` + folder `updatesc-keep.bak/`.
 *
 * PENTING: `saveKeep()` TIDAK PERNAH menghapus backup yang sudah ada —
 * kalau ikut dihapus, setting user hilang permanen. Penghapusan cuma
 * dilakuin `restoreFromBackup()` setelah sukses memulihkan.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const pexec = promisify(execFile)

// Nilai rahasia di `config.js` — nested di blok `api`
// (`api: { skyline: { apikey }, ... }`); pencarian blok bersifat
// struktural per baris, jadi cukup nama bloknya aja.
export const KEEP_FIELDS = [
  { block: 'reply', key: 'v9ThumbnailUrl', label: 'Reply v9 Thumbnail' },
  { block: 'skyline', key: 'apikey', label: 'API' },
  { block: 'spotify', key: 'clientId', label: 'Spotify ID' },
  { block: 'spotify', key: 'clientSecret', label: 'Spotify Secret' },
  { block: 'aurora', key: 'maxEmbedKb', label: 'Aurora Embed KB' },
  { block: 'aurora', key: 'originalMaxKb', label: 'Aurora Embed Asli KB' }
]

// Blok lama yang sudah digabung ke blok baru — nilainya dipindah,
// bukan dibuang, biar key user tetap kebawa waktu `.updatesc`.
export const KEEP_ALIASES = {
  'omniedit.apikey': 'skyline.apikey'
}

// Nama yang ditampilin ke user — jangan bocorin nama blok internal
// (`skyline.apikey` dsb). Semua kunci API cukup disebut "API".
const KEEP_LABELS = Object.fromEntries(
  KEEP_FIELDS.map(({ block, key, label }) => [`${block}.${key}`, label || `${block}.${key}`])
)
// Nama blok lama ikut ditampilin sebagai label barunya.
for (const [from, to] of Object.entries(KEEP_ALIASES)) {
  KEEP_LABELS[from] = KEEP_LABELS[to] || 'API'
}

/** `skyline.apikey` → `API`, `spotify.clientId` → `Spotify ID`, dst. */
export function keepLabel(name) {
  return KEEP_LABELS[name] || name
}

/** Label unik (biar API gak tampil dobel kalau blok lama + baru dua-duanya keisi). */
export function uniqueKeepLabels(names) {
  return [...new Set((names || []).map(keepLabel))]
}

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
  // Blok lama (`omniedit.apikey`) — nilainya dipindah ke blok barunya biar gak hilang.
  for (const [from, to] of Object.entries(KEEP_ALIASES)) {
    if (out.some((k) => `${k.block}.${k.key}` === to)) continue // blok baru menang
    const [block, key] = from.split('.')
    const b = findBlock(src, block)
    if (!b) continue
    const m = src
      .slice(b.open, b.close)
      .match(new RegExp(`(^|[\\s{,])${key}[ \\t]*:[ \\t]*(['"\`])([^'"\`]*)\\2`))
    if (m && m[3]) {
      const [toBlock, toKey] = to.split('.')
      out.push({ block: toBlock, key: toKey, value: m[3] })
    }
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
 * user belum pernah ngubahnya → gak usah di-backup-kan balik.
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
 * `assets` cuma berisi file yang BENERAN pernah diubah user (thumbnail
 * default gak dibuatkan backup). Balikin `{ keeps, assets }`.
 */
export async function saveKeep(opts = {}) {
  const keeps = []
  const assets = []

  // Default: banding SHA-1 blob vs `HEAD` (butuh git). Jalur tanpa git
  // (API) / belum punya HEAD (bootstrap) WAJIB nyerahin pembanding sendiri
  // lewat `opts.pristine` — kalau nggak, semua file dianggap "diubah user".
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
      // bisa jadi setting user dari update sebelumnya yang belum di-`.restore`.
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
 * `spec`: `{ config, assets }` — mana yang mau dipulihkan. Cuma file yang ADA
 * di backup yang dipulihkan (backup cuma berisi yang diubah user), jadi update
 * default dari repo tetap utuh. Backup yang BERHASIL dipulihkan ikut DIHAPUS
 * (`cleanedConfig`/`cleanedAssets`); yang GAGAL disimpan buat dicoba ulang.
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
