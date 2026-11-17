/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * update.js — Tarik update script dari GitHub (owner).
 *
 * Pakai:
 *   .updatesc         → git fetch + pull --ff-only dari origin, lalu rekap
 *                      "apa yang baru": 🆕 fitur / 🔧 fix / 📝 lainnya + file berubah
 *   auto-healing      → folder BELUM git repo (deploy panel via upload file)
 *                      → git init + tarik dari GitHub OTOMATIS
 *                      → server GAK punya git → fallback unduh via GitHub API
 *                         (Node fetch + untgz murni Node), file disamain GitHub
 *   auto             → kalau package.json / package-lock.json ikut berubah,
 *                      jalanin `npm install --omit=dev` sendiri setelah pull.
 *
 * SETTING MILIK USER: sebelum update, nilai yang diisi sendiri (apikey dll)
 * dan thumbnail yang pernah diganti di-BACKUP ke `config.js.update.bak` +
 * `updatesc-keep.bak/`. Jalannya DUA TAHAP (dua kartu balasan):
 *   TAHAP 1 → update kode + kartu hasil update
 *   TAHAP 2 → pulihin setting user (config.js + thumbnail) + kartu terpisah
 * Kode tetap versi terbaru; kartu tahap 2 cuma muncul kalau memang ada yang
 * dipulihkan / gagal. Kalau pemulihan gagal, backup tetap disimpan dan bisa
 * dicoba manual lewat `.restore`.
 * Lihat lib/keepSettings.js + lib/keepMigrate.js.
 *
 * Hasil akhir dirender kartu HTML native (richResponseMessage/unifiedResponse,
 * pola ping2/snake — §9 AGENTS.md) tema chrome biru-silver-putih-hitam;
 * progress & fallback tetap kartu teks.
 *
 * node_modules TIDAK diambil dari git (gitignore) — install cuma jalan
 * kalau dependency berubah. session/ & data/ gak tersentuh (gitignore).
 * File core/ lib/ handlers/ sky.js config/ berubah → butuh Restart manual
 * di panel; plugins/ → ke-hot-reload sendiri.
 *
 * Env (opsional, buat fork/testing):
 *   UPDATE_SC_URL            → URL remote repo (default HTTPS repo ini)
 *   UPDATE_SC_API_BASE       → override api.github.com
 *   UPDATE_SC_CODELOAD_BASE  → override codeload.github.com
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import { gunzip } from 'node:zlib'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  KEEP_FILES, KEEP_BAK, KEEP_BAK_DIR,
  readKeep, writeKeep, saveKeep, assetPristine, backupStatus, restoreFromBackup
} from '../../lib/keepSettings.js'
import { normalizeBackup } from '../../lib/keepMigrate.js'
import { getBotNumber } from '../../core/staff.js'

const pexec = promisify(execFile)
const pgunzip = promisify(gunzip)

const REPO_URL = (process.env.UPDATE_SC_URL || 'https://github.com/Jumra01/skyline-jxra-bot-.git').trim()
const BRANCH = 'main'
const API_BASE = (process.env.UPDATE_SC_API_BASE || 'https://api.github.com').replace(/\/+$/, '')
const CODELOAD_BASE = (process.env.UPDATE_SC_CODELOAD_BASE || 'https://codeload.github.com').replace(/\/+$/, '')

// safe.directory=* → amanin kasus Docker/panel (repo beda user sama proses,
// git nolak dengan "detected dubious ownership")
function git(args, timeout = 60_000) {
  return pexec('git', ['-c', 'safe.directory=*', ...args], {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  }).then(({ stdout, stderr }) => ({ out: String(stdout).trim(), err: String(stderr).trim() }))
}

// Biar pesan error kebaca jelas: git gak ada / bukan repo / auth
function gitErrDetail(err) {
  const msg = String(err?.message || err || '')
  if (err?.code === 'ENOENT' || /ENOENT|not found/i.test(msg)) {
    return ['GIT GAK ADA di server ini.', 'Install dulu (Debian/Ubuntu):', 'apt install git']
  }
  if (/dubious ownership/i.test(msg)) {
    return ['Deteksi dubious ownership (Docker).', 'Udah ditangani safe.directory, coba lagi.']
  }
  if (/does not appear to be a git repository|not a git repository|fatal: not a git/i.test(msg)) {
    return ['Folder ini BUKAN git repo.', 'Deploy ulang pakai git clone:', 'git clone <repo-url> .']
  }
  if (/Permission denied \(publickey\)|could not read Username|Authentication failed|403|401/i.test(msg)) {
    return [
      'Auth GitHub GAGAL.',
      'Remote kemungkinan SSH tapi', 'container gak punya key.',
      'Solusi: clone ulang pakai HTTPS+token',
      'atau tambahin deploy key di repo.'
    ]
  }
  return msg.split('\n').filter(Boolean).slice(0, 5)
}

// ── UI helpers (gaya menu: ╭─〔 emoji `judul` 〕─⬣ + │ baris + ╰─⬣) ──
const SC_MAP = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'Q', r: 'ʀ',
  s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
}
const toSmallCaps = (t) => [...String(t).toLowerCase()].map((c) => SC_MAP[c] || c).join('')
const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

/**
 * Balikin setting user OTOMATIS setelah update sukses (atau setelah pull
 * gagal — config/thumbnail udah terlanjur di-reset ke HEAD). Cuma nyentuh
 * `config.js` (KEEP_FIELDS) + thumbnail dari backup; kode tetap versi baru.
 * Gagal → backup TIDAK dihapus, jadi masih bisa `.restore` manual.
 */
async function autoRestore() {
  try {
    await normalizeBackup()
    const r = await restoreFromBackup({ config: true, assets: true })
    return {
      kept: r.kept.length + r.assetsKept.length,
      lost: r.lost.length + r.assetsLost.length,
      keptKeys: r.kept,
      lostKeys: r.lost,
      assetsKept: r.assetsKept,
      assetsLost: r.assetsLost,
      error: null
    }
  } catch (err) {
    return { kept: 0, lost: 0, keptKeys: [], lostKeys: [], assetsKept: [], assetsLost: [], error: String(err?.message || err) }
  }
}

// Sisa backup SETELAH auto-restore (biasanya 0; kalau gagal, masih ada).
async function pendingNow() {
  try {
    const st = await backupStatus()
    return {
      config: st.config.length > 0,
      configKeys: st.config,
      assets: st.assets.length,
      assetList: st.assets.map((a) => a.rel)
    }
  } catch {
    return { config: false, configKeys: [], assets: 0, assetList: [] }
  }
}

/* Nama ramah buat baris pemulihan: `skyline.apikey` → API skyline dll. */
function friendlyKey(key) {
  if (/\.apikey$/i.test(key)) return { st: '🔐', nm: 'API key skyline' }
  if (/spotify/i.test(key)) return { st: '🎵', nm: 'Spotify client' }
  if (/thumb/i.test(key)) return { st: '🖼️', nm: 'Thumbnail reply v9' }
  if (/product/i.test(key)) return { st: '🔗', nm: 'Product URL v9' }
  if (/icon/i.test(key)) return { st: '🎨', nm: 'Icon URL v9' }
  if (/title/i.test(key)) return { st: '🏷️', nm: 'Title v9' }
  if (/brand/i.test(key)) return { st: '🏷️', nm: 'Brand v9' }
  if (/price/i.test(key)) return { st: '💰', nm: 'Price v9' }
  return { st: '⚙️', nm: key }
}

function friendlyAsset(rel) {
  if (/thumb|\.jpe?g$|\.png$|\.webp$/i.test(rel)) return { st: '🖼️', nm: `thumb ${path.basename(rel)}` }
  return { st: '📎', nm: path.basename(rel) }
}

/* Satu laporan pemulihan setting: baris buat kartu, baris console, &
 * baris teks fallback. Dipakai semua jalur `.updatesc` biar gak ada
 * kartu kedua terpisah. */
function restoreReport(restored, pending) {
  const items = []
  const textLines = []
  const logLines = []

  for (const k of restored?.keptKeys || []) {
    const f = friendlyKey(k)
    items.push({ st: f.st, nm: f.nm, tag: 'DIPULIHKAN', tagCls: 'ok' })
    textLines.push(`♻️ ${f.nm} *dipulihkan*`)
  }
  for (const rel of restored?.assetsKept || []) {
    const f = friendlyAsset(rel)
    items.push({ st: f.st, nm: f.nm, tag: 'DIPULIHKAN', tagCls: 'ok' })
    textLines.push(`♻️ ${f.nm} *dipulihkan*`)
  }
  for (const k of restored?.lostKeys || []) {
    const f = friendlyKey(k)
    items.push({ st: f.st, nm: f.nm, tag: 'GAGAL', tagCls: 'bad' })
    textLines.push(`⚠️ ${f.nm} *gagal* dipulihkan`)
  }
  for (const rel of restored?.assetsLost || []) {
    const f = friendlyAsset(rel)
    items.push({ st: f.st, nm: f.nm, tag: 'GAGAL', tagCls: 'bad' })
    textLines.push(`⚠️ ${f.nm} *gagal* dipulihkan`)
  }
  if (restored?.error) {
    items.push({ st: '⚠️', nm: 'auto-restore error', tag: 'GAGAL', tagCls: 'bad' })
    textLines.push(`⚠️ auto-restore error: ${trunc(restored.error, 60)}`)
  }
  // backup yang belum kebalik (perlu `.restore` manual)
  for (const k of pending?.configKeys || []) {
    const f = friendlyKey(k)
    items.push({ st: f.st, nm: f.nm, tag: 'MENUNGGU', tagCls: 'warn' })
  }
  for (const rel of pending?.assetList || []) {
    const f = friendlyAsset(rel)
    items.push({ st: f.st, nm: f.nm, tag: 'MENUNGGU', tagCls: 'warn' })
  }

  const keptTotal = (restored?.keptKeys?.length || 0) + (restored?.assetsKept?.length || 0)
  const lostTotal = (restored?.lostKeys?.length || 0) + (restored?.assetsLost?.length || 0)
  const stillPending = (pending?.configKeys?.length || 0) + (pending?.assetList?.length || 0)

  if (restored?.error) {
    logLines.push({ pr: '♻️', tx: 'restore setting → GAGAL', cls: 'bad' })
  } else if (keptTotal) {
    logLines.push({
      pr: '♻️',
      tx: `restore ${keptTotal} setting → ok${lostTotal ? ` (${lostTotal} gagal)` : ''}`,
      cls: lostTotal ? 'warn' : 'ok'
    })
  } else {
    logLines.push({ pr: '♻️', tx: 'restore setting → tidak ada backup', cls: 'dim' })
  }
  if (stillPending) {
    logLines.push({ pr: '🔐', tx: `${stillPending} backup belum balik → .restore`, cls: 'warn' })
  }

  const notes = []
  if (restored?.error) {
    notes.push({ t: `⚠️ Restore otomatis gagal:<br><b>${hesc(trunc(restored.error, 64))}</b><br>Jalankan <b>.restore</b> manual.`, cls: 'warn' })
  } else if (lostTotal) {
    notes.push({ t: `⚠️ <b>${lostTotal} setting gagal</b> dipulihkan.<br>Backup masih disimpan — jalankan <b>.restore</b>.`, cls: 'warn' })
  }
  if (stillPending) {
    notes.push({ t: `🔐 Masih ada <b>${stillPending} backup</b> belum kebalik —<br>jalankan <b>.restore</b> buat coba lagi.`, cls: 'warn' })
  }

  const stat = {
    k: '♻️ pemulihan',
    v: restored?.error ? 'GAGAL' : keptTotal ? `${keptTotal} balik` : stillPending ? `${stillPending} tertunda` : 'tidak perlu',
    cls: restored?.error || lostTotal ? 'bad' : keptTotal ? 'ok' : stillPending ? 'warn' : 'dim'
  }

  return { restore: items.length ? { items, notes } : (notes.length ? { items: [], notes } : null), textLines, logLines, stat }
}

/* Tombol di dalam rich HTML. Kalau nomor bot kebaca, tombol jadi link
 * `wa.me/<bot>?text=<command>` — sekali tap langsung kirim command. */
function cmdHref(cmd) {
  const n = getBotNumber()
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(cmd)}` : null
}

function actionButtons({ restart = false, restore = false, compareUrl = null, extra = [] } = {}) {
  const out = []
  if (restart) out.push({ t: '🔄 .restart', cls: 'blue', href: cmdHref('.restart') })
  if (restore) out.push({ t: '♻️ .restore', cls: '', href: cmdHref('.restore') })
  if (compareUrl) out.push({ t: '📋 lihat diff', cls: 'green', href: compareUrl })
  return [...out, ...extra].filter((b) => b.t)
}

function shortRepo() {
  const gh = parseGitHubRepo(REPO_URL)
  return gh ? `${gh.owner}/${gh.repo}` : 'GitHub'
}

function compareUrl(oldHash, newHash) {
  const gh = parseGitHubRepo(REPO_URL)
  if (!gh || !oldHash || !newHash) return null
  return `https://github.com/${gh.owner}/${gh.repo}/compare/${oldHash}...${newHash}`
}

function restoredNote(r) {
  if (!r) return null
  if (r.error) {
    return {
      t: `⚠️ Restore otomatis gagal:<br><b>${hesc(trunc(r.error, 64))}</b><br>Jalankan <b>.restore</b> manual.`,
      cls: 'warn'
    }
  }
  if (r.lost) {
    return {
      t: `⚠️ ${r.kept} setting balik, <b>${r.lost} gagal</b>.<br>Backup-nya masih disimpan — jalankan<br><b>.restore</b> buat coba lagi.`,
      cls: 'warn'
    }
  }
  if (r.kept) {
    return {
      t: `♻️ <b>${r.kept} setting</b> kamu dipulihkan otomatis<br>(apikey / thumbnail) — <b>kode tetap terbaru</b>.`
    }
  }
  return null
}

// Sisa backup dari update sebelumnya yang BELUM berhasil dipulihkan
// (auto-restore gagal / user lama). Wajib dilaporin biar gak dianggap hilang.
function pendingCount(p) {
  return (p?.config ? 1 : 0) + (p?.assets || 0)
}

function pendingStats(p) {
  const n = pendingCount(p)
  return n ? [{ k: '🔐 backup', v: `${n} belum balik`, cls: 'warn' }] : []
}

function pendingNote(p) {
  const n = pendingCount(p)
  return n
    ? {
        t: `🔐 Masih ada <b>${n} backup</b> yang belum<br>kebalik — jalankan <b>.restore</b><br>buat coba lagi.`,
        cls: 'warn'
      }
    : null
}

function pendingLine(p) {
  const n = pendingCount(p)
  return n ? `🔐 ${n} backup belum kebalik → jalankan .restore` : ''
}

/**
 * TAHAP 2 `.updatesc`: kartu TERPISAH buat laporan pemulihan setting —
 * cuma dikirim kalau memang ada yang dipulihkan / gagal / sisa backup.
 */
async function sendRestoreCard(ctx) {
  const restored = await autoRestore()
  const pending = await pendingNow()
  const nothing =
    !restored.error && restored.kept === 0 && restored.lost === 0 && pendingCount(pending) === 0
  if (nothing) return false

  const bad = !!restored.error
  const warn = !bad && (restored.lost > 0 || pendingCount(pending) > 0)
  await replyRich(ctx, {
    icon: bad || warn ? '⚠️' : '♻️',
    title: 'RESTORE SETTING',
    sub: 'tahap 2 · pemulihan otomatis',
    pill: { t: bad ? 'GAGAL' : warn ? 'SEBAGIAN' : 'BERES', cls: bad ? 'bad' : warn ? 'warn' : 'ok' },
    meta: [`🕒 ${hesc(nowWIB())}`],
    stats: [
      { k: '♻️ setting', v: restored.kept ? `${restored.kept} dipulihkan` : '—', cls: restored.kept ? 'ok' : 'dim' },
      ...(restored.lost ? [{ k: '⚠️ gagal', v: String(restored.lost), cls: 'bad' }] : []),
      ...pendingStats(pending)
    ],
    notes: [restoredNote(restored), pendingNote(pending)].filter(Boolean)
  }, [
    '*RESTORE SETTING* ♻️',
    '',
    restored.kept ? `♻️ ${restored.kept} setting dipulihkan otomatis` : 'ℹ️ Gak ada setting yang bisa dipulihkan',
    restored.lost ? `⚠️ ${restored.lost} gagal → jalankan .restore` : null,
    pendingLine(pending) || null,
    restored.kept ? '✅ Kode tetap versi terbaru' : null,
    `🕒 ${nowWIB()}`
  ].filter(Boolean))
  return true
}

function card(emoji, title, lines) {
  const out = [`╭─〔 ${emoji} \`${toSmallCaps(title)}\` 〕─⬣`]
  for (const line of lines) out.push(line === '' ? '│' : `│ ${line}`)
  out.push('╰─⬣')
  return out.join('\n')
}

function fmtDur(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} detik`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function nowWIB() {
  try {
    const s = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })
    return `${s} WIB`
  } catch {
    return new Date().toISOString()
  }
}

const NEED_RESTART_RE = /^(core|lib|handlers|auth|src)\//

// ── Kartu HTML native (FOAHtmlPrimitive — pola ping2/snake, §9 AGENTS.md) ──
// Tema chrome: biru · silver · putih · hitam. Aman: gak pakai blur/mask/
// backdrop-filter/position:fixed/aspect-ratio (larangan webview WA).
const hesc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html{background-color:#070b16}
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#eef3ff;padding:14px;position:relative;
  background-color:#070b16;
  background-image:
    radial-gradient(560px 300px at 18% -40px,rgba(59,130,246,.38),rgba(59,130,246,0) 70%),
    radial-gradient(520px 300px at 90% 105%,rgba(200,211,232,.22),rgba(200,211,232,0) 70%),
    radial-gradient(380px 260px at 105% 40%,rgba(96,165,250,.16),rgba(96,165,250,0) 70%),
    linear-gradient(180deg,#0a1122 0%,#0b1428 45%,#070b16 100%)}
.bgfx{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:0;
  background-image:
    linear-gradient(rgba(59,130,246,.07) 1px,rgba(59,130,246,0) 1px),
    linear-gradient(90deg,rgba(59,130,246,.07) 1px,rgba(59,130,246,0) 1px),
    radial-gradient(rgba(148,163,184,.16) 1.2px,rgba(148,163,184,0) 1.6px);
  background-size:52px 52px,52px 52px,20px 20px}
.sheen{position:absolute;top:0;left:0;right:0;height:170px;
  background:
    linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(200,211,232,.16) 48%,rgba(255,255,255,.22) 52%,rgba(59,130,246,.14) 60%,rgba(59,130,246,0) 75%),
    radial-gradient(420px 150px at 50% 0,rgba(59,130,246,.30),rgba(59,130,246,0) 75%)}
.vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(ellipse 110% 95% at 50% 40%,rgba(0,0,0,0) 55%,rgba(0,0,0,.6) 100%)}
.wrap{position:relative;z-index:1}
.chrome{height:3px;border-radius:99px;margin-bottom:12px;
  background:linear-gradient(90deg,#3b82f6,#c8d3e8 45%,#ffffff 55%,#93a4c7 70%,#3b82f6);
  box-shadow:0 0 12px rgba(59,130,246,.55)}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;
  background:linear-gradient(135deg,rgba(59,130,246,.35),rgba(200,211,232,.16));
  border:1.5px solid rgba(200,211,232,.45);box-shadow:0 0 16px rgba(59,130,246,.35)}
.t1{font-size:16px;font-weight:800;letter-spacing:1.4px;
  background:linear-gradient(90deg,#ffffff,#b9c6e8 60%,#7fb0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.t2{font-size:10px;color:#8fa3cc;margin-top:1px}
.pill{margin-left:auto;font-size:10px;font-weight:800;padding:4px 11px;border-radius:99px;letter-spacing:1px}
.pill.ok{color:#9df0c4;border:1px solid rgba(52,211,153,.5);background:rgba(52,211,153,.12);
  box-shadow:0 0 14px rgba(52,211,153,.3)}
.pill.info{color:#9fd0ff;border:1px solid rgba(59,130,246,.5);background:rgba(59,130,246,.12);
  box-shadow:0 0 14px rgba(59,130,246,.35)}
.pill.warn{color:#ffd28a;border:1px solid rgba(255,184,77,.5);background:rgba(255,184,77,.12)}
.pill.bad{color:#ffb3c1;border:1px solid rgba(255,92,122,.5);background:rgba(255,92,122,.12);
  box-shadow:0 0 14px rgba(255,92,122,.3)}
.card{background:linear-gradient(160deg,rgba(24,34,60,.97),rgba(11,17,34,.98));
  border:1px solid rgba(148,163,184,.26);border-radius:13px;padding:11px 13px;margin-bottom:9px;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 6px 18px rgba(0,0,0,.35)}
.lbl{font-size:9px;letter-spacing:1.6px;color:#8fa3cc;text-transform:uppercase;margin-bottom:6px;
  display:flex;align-items:center;gap:5px}
.hash{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:700;color:#0a1122;
  background:linear-gradient(135deg,#e7edf9,#a8b6d8);padding:2px 9px;border-radius:7px;display:inline-block;
  box-shadow:0 1px 0 #fff inset}
.arrow{color:#7fb0ff;font-weight:800;font-size:13px;padding:0 3px}
.meta{display:flex;flex-wrap:wrap;gap:7px;align-items:center;font-size:11px;color:#a9b8d8}
.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:9px}
.chip{background:linear-gradient(160deg,rgba(24,34,60,.97),rgba(11,17,34,.98));
  border:1px solid rgba(148,163,184,.24);border-radius:11px;padding:8px 5px;text-align:center;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset}
.chip .n{font-size:20px;font-weight:800;line-height:1.15;
  background:linear-gradient(90deg,#ffffff,#9fd0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.chip .e{font-size:13px}
.chip .k{font-size:8px;letter-spacing:1.1px;color:#8fa3cc;text-transform:uppercase;margin-top:1px}
.sec{margin-bottom:8px}
.sech{font-size:10px;font-weight:800;letter-spacing:1.2px;color:#9fd0ff;text-transform:uppercase;
  display:flex;align-items:center;gap:6px;margin-bottom:5px}
.sech .cnt{color:#61739c;font-weight:700}
.secb{background:rgba(11,17,34,.72);border:1px solid rgba(148,163,184,.18);border-radius:10px;padding:7px 10px}
.row{font-size:12px;color:#dfe8fb;padding:3px 0;line-height:1.45}
.row .dot{color:#7fb0ff}
.row .cnt{color:#9fd0ff;font-weight:700}
.row.dim{color:#8fa3cc;font-size:11px}
.note{font-size:11px;color:#a9b8d8;background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.30);
  border-radius:10px;padding:8px 11px;margin-bottom:9px;line-height:1.55}
.note b{color:#9fd0ff}
.note.warn{background:rgba(255,184,77,.09);border-color:rgba(255,184,77,.35)}
.note.warn b{color:#ffd28a}
.note.bad{background:rgba(255,92,122,.09);border-color:rgba(255,92,122,.35)}
.note.bad b{color:#ffb3c1}
.stat{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;
  background:rgba(11,17,34,.72);border:1px solid rgba(148,163,184,.18);border-radius:10px;
  padding:7px 11px;margin-bottom:6px}
.stat .v{font-weight:700;color:#9fd0ff;text-align:right}
.stat .v.ok{color:#9df0c4}
.stat .v.bad{color:#ffb3c1}
.stat .v.dim{color:#8fa3cc;font-weight:600}
.ft{margin-top:4px;font-size:9.5px;color:#61739c;text-align:center;line-height:1.6}
.ft b{color:#9fd0ff}
.btnline{display:flex;gap:7px;justify-content:center;margin-top:8px;flex-wrap:wrap}
.btn{display:inline-block;text-decoration:none;font-size:10px;font-weight:700;color:#0a1122;
  background:linear-gradient(135deg,#e7edf9,#a8b6d8);
  padding:6px 14px;border-radius:99px;box-shadow:0 1px 0 #fff inset,0 4px 12px rgba(0,0,0,.35)}
.btn.blue{color:#fff;background:linear-gradient(135deg,#3b82f6,#1d4ed8);
  box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 4px 14px rgba(59,130,246,.45)}
.btn.green{color:#052e1c;background:linear-gradient(135deg,#9df0c4,#34d399);
  box-shadow:0 1px 0 rgba(255,255,255,.45) inset,0 4px 14px rgba(52,211,153,.35)}
.term{background:linear-gradient(180deg,#05090f,#070d1a);border:1px solid rgba(148,163,184,.24);
  border-radius:10px;padding:9px 11px;margin-bottom:9px;
  box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 8px 20px rgba(0,0,0,.45)}
.term .bar{display:flex;align-items:center;gap:5px;margin-bottom:7px;padding-bottom:6px;
  border-bottom:1px solid rgba(148,163,184,.16)}
.term .dot{width:7px;height:7px;border-radius:99px;display:inline-block}
.term .dot.r{background:#ff5f56}.term .dot.y{background:#ffbd2e}.term .dot.g{background:#27c93f}
.term .tt{font-size:8.5px;letter-spacing:1.3px;color:#61739c;margin-left:auto;text-transform:uppercase}
.ln{font-family:ui-monospace,SFMono-Regular,monospace;font-size:10.5px;line-height:1.62;
  color:#c7d3ea;display:flex;gap:6px;word-break:break-word}
.ln .pr{flex-shrink:0;width:10px;text-align:center;color:#4b5f8a}
.ln.cmd .pr,.ln.cmd .tx{color:#9fd0ff}
.ln.ok .pr{color:#34d399}.ln.ok .tx{color:#b6f2d2}
.ln.warn .pr{color:#ffbd2e}.ln.warn .tx{color:#ffe0a8}
.ln.bad .pr{color:#ff5c7a}.ln.bad .tx{color:#ffc1cc}
.ln.dim .tx{color:#8fa3cc}
.rshead{font-size:9px;letter-spacing:1.4px;color:#8fa3cc;text-transform:uppercase;margin-bottom:6px;
  display:flex;align-items:center;gap:5px}
.rsrow{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#dfe8fb;padding:3px 0}
.rsrow .st{font-size:11px;flex-shrink:0}
.rsrow .nm{color:#c7d3ea;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rsrow .tag{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.6px;padding:2px 8px;border-radius:99px;flex-shrink:0}
.rsrow .tag.ok{color:#9df0c4;background:rgba(52,211,153,.14);border:1px solid rgba(52,211,153,.4)}
.rsrow .tag.bad{color:#ffb3c1;background:rgba(255,92,122,.14);border:1px solid rgba(255,92,122,.4)}
.rsrow .tag.warn{color:#ffd28a;background:rgba(255,184,77,.14);border:1px solid rgba(255,184,77,.4)}
.rsrow .tag.dim{color:#8fa3cc;background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.3)}
`

function wrapHtml(inner, title) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${hesc(title)}</title>
<style>${CSS}</style></head><body>
<div class="bgfx"><div class="sheen"></div><div class="vig"></div></div>
<div class="wrap"><div class="chrome"></div>${inner}
<div class="ft">⚡ <b>skyline-JXRA</b> · updater · jangan edit file langsung di panel<br>edit di lokal → push → <b>.updatesc</b></div>
</div></body></html>`
}

function hd(icon, title, sub, pillText, pillCls) {
  return `<div class="hd"><div class="ic">${icon}</div>
<div><div class="t1">${hesc(title)}</div><div class="t2">${hesc(sub)}</div></div>
<div class="pill ${pillCls}">${hesc(pillText)}</div></div>`
}

const row = (text) => `<div class="row"><span class="dot">▸</span> ${text}</div>`

function sectionBlock(icon, label, items) {
  if (!items.length) return ''
  const rows = items.slice(0, 6).map((it) => row(hesc(trunc(it, 58))))
  if (items.length > 6) rows.push(`<div class="row dim">… +${items.length - 6} lainnya</div>`)
  return `<div class="sec"><div class="sech">${icon} ${hesc(label)} <span class="cnt">(${items.length})</span></div>
<div class="secb">${rows.join('')}</div></div>`
}

function buildResultHtml(d) {
  // d: { icon, title, sub, pill:{t,cls}, head, meta:[], chips:[{e,n,k}],
  //      notes:[{t,cls}], stats:[{k,v,cls}], sections:[{icon,label,items}],
  //      log:[{pr,tx,cls}], restore:{items:[{nm,tag,tagCls,st}], notes:[]},
  //      buttons:[{t,cls,href}] }
  const chips = d.chips?.length
    ? `<div class="chips">${d.chips.map((c) => `<div class="chip"><div class="e">${c.e}</div><div class="n">${hesc(String(c.n))}</div><div class="k">${hesc(c.k)}</div></div>`).join('')}</div>`
    : ''
  const meta = d.meta?.length
    ? `<div class="card"><div class="lbl">📌 <span>commit</span></div><div class="meta">${d.meta.map((m) => `<span>${m}</span>`).join('<span class="arrow">·</span>')}</div></div>`
    : ''
  const notes = (d.notes || [])
    .map((n) => `<div class="note ${n.cls || ''}">${n.t}</div>`)
    .join('')
  const stats = (d.stats || [])
    .map((s) => `<div class="stat"><span>${s.k}</span><span class="v ${s.cls || ''}">${s.v}</span></div>`)
    .join('')
  const sections = (d.sections || []).map((s) => sectionBlock(s.icon, s.label, s.items)).join('')
  const log = d.log?.length
    ? `<div class="term"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tt">console · updatesc</span></div>${d.log.map((l) => `<div class="ln ${l.cls || 'dim'}"><span class="pr">${hesc(l.pr)}</span><span class="tx">${hesc(l.tx)}</span></div>`).join('')}</div>`
    : ''
  const restore = d.restore?.items?.length
    ? `<div class="card"><div class="rshead">♻️ <span>pemulihan setting</span></div>${d.restore.items.map((r) => `<div class="rsrow"><span class="st">${r.st}</span><span class="nm">${hesc(r.nm)}</span><span class="tag ${r.tagCls}">${hesc(r.tag)}</span></div>`).join('')}</div>`
    : ''
  const restoreNotes = (d.restore?.notes || []).map((n) => `<div class="note ${n.cls || ''}">${n.t}</div>`).join('')
  const buttons = d.buttons?.length
    ? `<div class="btnline">${d.buttons.map((b) => b.href
      ? `<a class="btn ${b.cls || ''}" href="${hesc(b.href)}">${hesc(b.t)}</a>`
      : `<span class="btn ${b.cls || ''}">${hesc(b.t)}</span>`).join('')}</div>`
    : ''
  return wrapHtml(
    hd(d.icon, d.title, d.sub, d.pill.t, d.pill.cls) +
      `<div class="card">${d.head}</div>` + meta + chips + notes + log + stats + sections + restore + restoreNotes + buttons,
    d.title
  )
}

// Kirim kartu HTML native (FOAHtmlPrimitiveDemoDONOTUSE — pola ping2/snake).
// GAGAL → throw (biar pemanggil fallback ke kartu teks, jangan ditelan).
async function sendNativeHtml(client, chat, html) {
  await client.message.send(chat, {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({
              __typename: 'GenAIUnifiedResponse',
              response_id: crypto.randomUUID(),
              sections: [{
                __typename: 'GenAIUnifiedResponseSection',
                view_model: {
                  __typename: 'GenAISingleLayoutViewModel',
                  primitive: {
                    __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                    trusted_sources: [],
                    payload: html
                  }
                }
              }]
            })).toString('base64')
          },
          contextInfo: { isForwarded: true, forwardOrigin: 4 }
        }
      }
    }
  }, { additionalAttributes: { type: 'text' } })
}

// HTML dulu; gagal → fallback kartu teks lama (biar update tetap keliatan)
async function replyRich(ctx, htmlData, fallbackLines) {
  try {
    await sendNativeHtml(ctx.client, ctx.chat, buildResultHtml(htmlData))
    return true
  } catch {
    try {
      await ctx.reply(card(htmlData.icon, htmlData.title, fallbackLines))
      return true
    } catch {
      return false
    }
  }
}

async function gitAvailable() {
  try {
    await git(['--version'], 10_000)
    return true
  } catch (err) {
    if (err?.code === 'ENOENT') return false
    return true
  }
}

async function isGitRepo() {
  try {
    await git(['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

// Remote origin wajib ada & nunjuk ke REPO_URL (biar fetch bisa jalan)
async function ensureOriginUrl() {
  try {
    const cur = (await git(['remote', 'get-url', 'origin'])).out
    if (cur) return
  } catch {}
  await git(['remote', 'add', 'origin', REPO_URL])
}

// Folder bukan repo → init + tarik penuh dari GitHub. Overwrite file tracked,
// session/ data/ node_modules/ gak kepegang (gak di-repo). config.js lokal
// dibackup dulu (checkout nimpa file yang ada di tree).
async function bootstrapRepo() {
  let pkgBefore = null
  try { pkgBefore = await fs.readFile('package.json') } catch {}

  await git(['init'])
  await ensureOriginUrl()
  await git(['fetch', 'origin', BRANCH], 180_000)

  // `fetch` gak nyentuh working tree → baru sekarang bisa bedain file yang
  // BENERAN diubah user vs masih default, pakai pembanding `FETCH_HEAD`
  // (folder belum punya HEAD). Tanpa ini, thumbnail default ikut ke-backup.
  await saveKeep({
    pristine: (rel) => assetPristine(rel, 'FETCH_HEAD')
  })
  // checkout -f bakal nimpa config.js versi lokal (apikey klien) → simpen
  // dulu nilainya. (`config.js.pre-git.bak` tetap dibuat — salinan utuh.)
  try { await fs.copyFile('config.js', 'config.js.pre-git.bak') } catch {}

  await git(['checkout', '-f', '-B', BRANCH, 'FETCH_HEAD'])
  try { await git(['branch', '--set-upstream-to', `origin/${BRANCH}`, BRANCH]) } catch {}

  let pkgChanged = false
  try {
    const pkgAfter = await fs.readFile('package.json')
    pkgChanged = !!pkgBefore && !pkgBefore.equals(pkgAfter)
  } catch {}

  const head = (await git(['log', '-1', '--oneline'])).out
  return { head, pkgChanged }
}

function parseGitHubRepo(url) {
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

// Extractor tar.gz murni Node (zlib built-in) — container panel gak selalu
// punya binary tar. Cuma perlu path/size/typeflag (format ustar codeload).
async function untgz(buf, destDir) {
  const raw = await pgunzip(buf)
  let off = 0
  const created = new Set()
  while (off + 512 <= raw.length) {
    const header = raw.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const str = (start, len) => {
      let end = start
      while (end < start + len && header[end] !== 0) end++
      return header.subarray(start, end).toString('utf8')
    }
    const size = parseInt(str(124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(header[156] || 0)
    let name = str(0, 100)
    const prefix = str(345, 155)
    if (prefix) name = `${prefix}/${name}`
    name = name.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')
    const dataStart = off + 512
    off = dataStart + Math.ceil(size / 512) * 512
    if (!name || name.includes('..')) continue // anti path traversal
    if (type === '5' || name.endsWith('/')) {
      const dir = path.join(destDir, name)
      if (!created.has(dir)) {
        await fs.mkdir(dir, { recursive: true })
        created.add(dir)
      }
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '') continue
    const file = path.join(destDir, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, raw.subarray(dataStart, dataStart + size))
  }
}

async function ghJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'skyline-JXRA-updatesc', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 120)}`)
  }
  return res.json()
}

const MANIFEST_FILE = '.updatesc-manifest.json'

/* Daftar file relatif (forward slash) di dalam `dir`. */
async function listRelFiles(dir, base = dir) {
  const out = []
  const walk = async (d) => {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  await walk(dir)
  return out.sort()
}

async function readManifest(file) {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    return { files: Array.isArray(raw.files) ? raw.files : [], removed: Array.isArray(raw.removed) ? raw.removed : [] }
  } catch {
    return null
  }
}

/* File yang sudah TIDAK ada di repo tapi masih nyangkut di folder kerja.
 * fs.cp cuma nimpa/nambah, jadi tanpa ini file yang dihapus upstream
 * (mis. plugin yang di-`git rm`) tetap ada dan tetap ke-load. */
async function pruneStale(oldManifest, newManifest, newFiles) {
  const next = new Set(newFiles)
  const stale = new Set([...(oldManifest?.removed ?? []), ...(newManifest?.removed ?? [])])
  for (const rel of oldManifest?.files ?? []) {
    if (!next.has(rel)) stale.add(rel)
  }
  const removed = []
  for (const rel of stale) {
    if (!rel || rel.startsWith('/') || rel.includes('..')) continue
    try {
      await fs.rm(rel, { force: true })
      removed.push(rel)
    } catch {}
  }
  return removed
}

// Fallback tanpa git: unduh tarball branch dari codeload → extract murni Node
// (untgz) → timpa isi folder kerja (fs.cp). Gak butuh binary git/tar/cp —
// aman di container minimal. File yang dibuang upstream dihapus lewat
// `.updatesc-manifest.json` (dibandingin sebelum/sesudah copy).
async function apiSync() {
  const gh = parseGitHubRepo(REPO_URL)
  if (!gh) throw new Error('URL repo bukan GitHub — fallback API gak bisa dipakai')
  const { owner, repo } = gh

  const meta = await ghJson(`${API_BASE}/repos/${owner}/${repo}/commits/${BRANCH}`)
  const sha = String(meta.sha || '')
  const short = sha.slice(0, 7)
  const msg = String(meta.commit?.message || '').split('\n')[0]

  let pkgBefore = null
  try { pkgBefore = await fs.readFile('package.json') } catch {}

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'updatesc-'))
  try {
    const res = await fetch(`${CODELOAD_BASE}/${owner}/${repo}/tar.gz/refs/heads/${BRANCH}`, {
      signal: AbortSignal.timeout(180_000)
    })
    if (!res.ok) throw new Error(`Unduh tarball gagal: HTTP ${res.status}`)
    const tgz = path.join(tmpDir, 'src.tgz')
    await fs.writeFile(tgz, Buffer.from(await res.arrayBuffer()))

    const extractDir = path.join(tmpDir, 'x')
    await fs.mkdir(extractDir, { recursive: true })
    await untgz(await fs.readFile(tgz), extractDir)
    const entries = await fs.readdir(extractDir)
    const src = path.join(extractDir, entries[0] || '')
    const st = await fs.stat(src).catch(() => null)
    if (!entries[0] || !st?.isDirectory()) throw new Error('Struktur tarball gak dikenali')

    // fs.cp recursive — murni Node, tanpa binary cp. config.js IKUT ketimpa
    // versi GitHub (apikey kosong) → simpen dulu nilai user ke backup
    // (dipulihin lewat `.restore`). Tarball di `src` (versi upstream)
    // dipakai sebagai pembanding "pristine" tanpa git — thumbnail default
    // gak ikut ke-backup.
    await saveKeep({
      pristine: async (rel) => {
        try {
          const [upstream, lokal] = await Promise.all([
            fs.readFile(path.join(src, rel)),
            fs.readFile(rel)
          ])
          return upstream.equals(lokal)
        } catch {
          return false
        }
      }
    })
    const oldManifest = await readManifest(path.join(process.cwd(), MANIFEST_FILE))
    await fs.cp(src, process.cwd(), { recursive: true, force: true })

    // Setelah copy: manifest versi baru ikut ketimpa dari tarball.
    const newFiles = await listRelFiles(src)
    const newManifest = await readManifest(path.join(process.cwd(), MANIFEST_FILE))
    const removed = await pruneStale(oldManifest, newManifest, newFiles)

    let pkgChanged = false
    try {
      const pkgAfter = await fs.readFile('package.json')
      pkgChanged = !!pkgBefore && !pkgBefore.equals(pkgAfter)
    } catch {}

    return { short, msg, pkgChanged, removed }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function npmInstallMaybe(ctx, changed) {
  if (!changed) return { installed: false, installErr: null }
  try {
    await ctx.reply(card('📦', 'DEPENDENCY', [
      '⏳ *Dependency berubah*',
      '',
      '⚙️ npm install... (bisa 1-2 menit)'
    ]))
    await pexec('npm', ['install', '--omit=dev'], {
      cwd: process.cwd(),
      timeout: 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024
    })
    return { installed: true, installErr: null }
  } catch (err) {
    return { installed: false, installErr: String(err?.message || err).split('\n').slice(0, 4) }
  }
}

// Rekap section: label + daftar commit (maks 6), spasi bawah biar rapi
function section(label, list) {
  if (!list.length) return []
  const rows = list.slice(0, 6).map((c) => `◦ ${trunc(c.subject, 50)}`)
  if (list.length > 6) rows.push(`… +${list.length - 6} lainnya`)
  return [`${label} (${list.length})`, ...rows, '']
}

// Daftar file berubah → dikelompokin per folder root (rapi buat banyak file)
function fileSection(files) {
  if (!files.length) return []
  const byDir = {}
  for (const f of files) {
    const key = f.includes('/') ? `${f.split('/')[0]}/` : f
    byDir[key] = (byDir[key] || 0) + 1
  }
  const keys = Object.keys(byDir)
  const rows = keys.slice(0, 8).map((d) => `◦ ${d} · ${byDir[d]}`)
  if (keys.length > 8) rows.push(`… +${keys.length - 8} lain`)
  return [`📁 *FILE BERUBAH* (${files.length})`, ...rows, '']
}

const pluginConfig = {
  name: 'updatesc',
  alias: ['update', 'gitupdate', 'pullbot', 'updatebot'],
  category: 'owner',
  description: 'Tarik update script dari GitHub (auto git init + npm install)',
  usage: '.updatesc',
  example: '.updatesc',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 15,
  limit: 1,
  isEnabled: true
}

async function handler(ctx) {
  const t0 = Date.now()
  const hasGit = await gitAvailable()

  // ── Jalur 1: server gak punya git → fallback GitHub API ──
  if (!hasGit) {
    await ctx.react('🔄')
    await ctx.reply(card('🌐', 'UPDATE', [
      '⏳ *Git gak ada di server*',
      '',
      '🌐 Fallback: unduh via GitHub API',
      `🕒 ${nowWIB()}`
    ]))
    try {
      const { short, msg, pkgChanged, removed } = await apiSync()
      const { installed, installErr } = await npmInstallMaybe(ctx, pkgChanged)
      const restored = await autoRestore()
      const pending = await pendingNow()
      const rr = restoreReport(restored, pending)
      await ctx.react(installErr ? '⚠️' : '✅')
      const log = [
        { pr: '$', tx: 'sync via GitHub API (tarball)', cls: 'cmd' },
        { pr: '✓', tx: `${short} · ${trunc(msg, 46)}`, cls: 'ok' },
        { pr: '✓', tx: `file disamain dari origin/main`, cls: 'ok' },
        removed.length
          ? { pr: '✓', tx: `${removed.length} file usang dihapus`, cls: 'ok' }
          : { pr: '•', tx: 'tidak ada file usang', cls: 'dim' },
        { pr: '$', tx: 'npm install --omit=dev', cls: 'cmd' },
        installed
          ? { pr: '✓', tx: 'dependency terpasang', cls: 'ok' }
          : installErr
            ? { pr: '✗', tx: 'npm install gagal — cek log panel', cls: 'bad' }
            : { pr: '•', tx: 'package.json gak berubah — dilewati', cls: 'dim' },
        ...rr.logLines
      ]
      await replyRich(ctx, {
        icon: '🌐',
        title: 'UPDATE SELESAI',
        sub: `${removed.length} file usang dibersihkan · mode API`,
        pill: { t: installErr ? 'ADA ERROR' : 'SUKSES', cls: installErr ? 'warn' : 'ok' },
        head: `<div class="lbl">📦 <span>sync via API</span></div>
<div class="meta"><span class="hash">${hesc(short)}</span><span>${hesc(trunc(msg, 34))}</span></div>`,
        meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`, `🌿 ${hesc(BRANCH)}`],
        chips: [
          { e: '📦', n: 1, k: 'commit' },
          { e: '🗑️', n: removed.length, k: 'usang' },
          { e: '♻️', n: restored.kept, k: 'pulih' },
          { e: '🕒', n: fmtDur(Date.now() - t0), k: 'durasi' }
        ],
        sections: [
          removed.length ? { icon: '🗑️', label: 'FILE USANG DIHAPUS', items: removed.map((r) => r) } : null,
          { icon: 'ℹ️', label: 'CATATAN MODE API', items: ['Server gak punya git — sync pakai tarball GitHub', 'Daftar file berubah gak bisa dideteksi tanpa git', 'File usang dibersihkan via .updatesc-manifest.json'] }
        ].filter(Boolean),
        log,
        stats: [
          { k: '📦 npm install', v: installed ? 'sukses' : installErr ? 'GAGAL' : 'lewati', cls: installed ? 'ok' : installErr ? 'bad' : 'dim' },
          { k: '🗑️ file usang', v: removed.length ? String(removed.length) : '0', cls: removed.length ? 'ok' : 'dim' },
          rr.stat
        ],
        restore: rr.restore,
        buttons: actionButtons({ restart: true, restore: restored.lost > 0 || pendingCount(pending) > 0, compareUrl: `https://github.com/${shortRepo()}/commit/${short}` })
      }, [
        '*UPDATE SELESAI* ✅ (API)',
        '',
        `📌 \`${short}\` ${trunc(msg, 30)}`,
        `⏱️ *${fmtDur(Date.now() - t0)}*`,
        '',
        '🖥️ *CONSOLE LOG*',
        ...log.map((l) => `${l.pr} ${l.tx}`),
        '',
        ...rr.textLines,
        '',
        '🌐 Server tanpa git — sync via GitHub API',
        'ℹ️ Daftar file gak bisa dideteksi (tanpa git)',
        '🔁 *RESTART* bot di panel biar kode baru kebaca',
        '',
        `🕒 ${nowWIB()}`
      ].filter(Boolean))
    } catch (err) {
      const restored = await autoRestore()
      const pending = await pendingNow()
      const rr = restoreReport(restored, pending)
      await ctx.react('⚠️')
      await replyRich(ctx, {
        icon: '⚠️',
        title: 'UPDATE GAGAL',
        sub: 'fallback GitHub API',
        pill: { t: 'GAGAL', cls: 'bad' },
        head: `<div class="lbl">❌ <span>API error</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
        meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
        log: [
          { pr: '$', tx: 'sync via GitHub API (tarball)', cls: 'cmd' },
          { pr: '✗', tx: trunc(String(err?.message || err), 62), cls: 'bad' },
          ...rr.logLines
        ],
        notes: [
          { t: 'Cek koneksi / rate limit GitHub,<br>lalu coba lagi <b>.updatesc</b>.', cls: 'bad' }
        ].filter(Boolean),
        restore: rr.restore,
        buttons: actionButtons({ restore: true })
      }, [
        '*UPDATE GAGAL*',
        '',
        '🔍 Detail error:',
        ...gitErrDetail(err),
        '',
        `⏱️ *${fmtDur(Date.now() - t0)}*`,
        `🕒 ${nowWIB()}`
      ])
    }
    return
  }

  // ── Jalur 2: git ada, folder BELUM repo (upload file tanpa clone) → auto init ──
  let bootstrapped = null
  if (!(await isGitRepo())) {
    await ctx.react('🔄')
    await ctx.reply(card('⚙️', 'SETUP', [
      '⏳ *Folder belum git repo*',
      '',
      '🔄 Init + tarik penuh dari GitHub...',
      '⏱️ Bisa 1-2 menit'
    ]))
    try {
      bootstrapped = await bootstrapRepo()
    } catch (err) {
      await ctx.react('⚠️')
      await replyRich(ctx, {
        icon: '⚠️',
        title: 'SETUP GAGAL',
        sub: 'git init / fetch error',
        pill: { t: 'GAGAL', cls: 'bad' },
        head: `<div class="lbl">❌ <span>init repo error</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
        meta: [`🕒 ${hesc(nowWIB())}`],
        notes: [{ t: 'Cek koneksi / akses GitHub<br>lalu coba lagi <b>.updatesc</b>.', cls: 'bad' }]
      }, [
        '*SETUP GAGAL*',
        '',
        ...gitErrDetail(err),
        '',
        `🕒 ${nowWIB()}`
      ])
      return
    }
    const { installed, installErr } = await npmInstallMaybe(ctx, bootstrapped.pkgChanged)
    const restored = await autoRestore()
    const pending = await pendingNow()
    const rr = restoreReport(restored, pending)
    await ctx.react(installErr ? '⚠️' : '✅')
    const bHash = bootstrapped.head.split(' ')[0]
    const bMsg = bootstrapped.head.split(' ').slice(1).join(' ')
    const log = [
      { pr: '$', tx: 'git init && git fetch origin main', cls: 'cmd' },
      { pr: '✓', tx: `repo dibuat · HEAD ${bHash}`, cls: 'ok' },
      { pr: '✓', tx: trunc(bMsg, 46), cls: 'ok' },
      { pr: '$', tx: 'npm install --omit=dev', cls: 'cmd' },
      installed
        ? { pr: '✓', tx: 'dependency terpasang', cls: 'ok' }
        : installErr
          ? { pr: '✗', tx: 'npm install gagal — cek log panel', cls: 'bad' }
          : { pr: '•', tx: 'package.json gak berubah — dilewati', cls: 'dim' },
      ...rr.logLines
    ]
    await replyRich(ctx, {
      icon: '⚙️',
      title: 'SETUP REPO SELESAI',
      sub: 'git init otomatis dari GitHub',
      pill: { t: installErr ? 'ADA ERROR' : 'SETUP OK', cls: installErr ? 'warn' : 'ok' },
      head: `<div class="lbl">📥 <span>repo dibuat + sync penuh</span></div>
<div class="meta"><span class="hash">${hesc(bHash)}</span><span>${hesc(trunc(bMsg, 40))}</span></div>`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`, `🌿 ${hesc(BRANCH)}`],
      chips: [
        { e: '📥', n: 1, k: 'repo' },
        { e: '📦', n: installed ? 'ok' : 'pass', k: 'npm' },
        { e: '♻️', n: restored.kept, k: 'pulih' },
        { e: '🕒', n: fmtDur(Date.now() - t0), k: 'durasi' }
      ],
      log,
      notes: [
        { t: '💾 Config lama disimpan di<br><b>config.js.pre-git.bak</b>' },
        { t: '⚠️ Abis <b>RESTART</b>, jalur .updatesc<br>berikutnya normal (git pull).', cls: 'warn' }
      ].filter(Boolean),
      stats: [
        { k: '📦 npm install', v: installed ? 'sukses' : installErr ? 'GAGAL' : 'lewati', cls: installed ? 'ok' : installErr ? 'bad' : 'dim' },
        { k: '📁 session/ & data/', v: 'aman utuh', cls: 'ok' },
        rr.stat
      ].filter(Boolean),
      restore: rr.restore,
      buttons: actionButtons({ restart: true, restore: restored.lost > 0 || pendingCount(pending) > 0 })
    }, [
      '*SETUP REPO SELESAI* ✅',
      '',
      `📌 HEAD: \`${bHash}\``,
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      '',
      '📥 Repo di-init otomatis + sync penuh',
      '💾 config.js lama → `config.js.pre-git.bak`',
      installed ? '📦 npm install *sukses*' : installErr ? '⚠️ npm install *gagal* (cek log)' : '📦 npm install *lewati*',
      ...rr.textLines,
      '',
      '🔁 *RESTART* bot di panel',
      '⚠️ Abis restart, .updatesc jalan normal (pull)',
      '',
      `🕒 ${nowWIB()}`
    ])
    return
  }

  // ── Jalur 3: repo normal → fetch + pull --ff-only ──
  await ensureOriginUrl()

  await ctx.react('🔄')
  await ctx.reply(card('🔄', 'UPDATE', [
    '⏳ *Mengambil commit terbaru...*',
    '',
    `🌐 origin/${BRANCH}`,
    `🕒 ${nowWIB()}`
  ]))

  let oldHead
  try {
    oldHead = (await git(['rev-parse', 'HEAD'])).out
  } catch (err) {
    await ctx.react('⚠️')
    await replyRich(ctx, {
      icon: '⚠️',
      title: 'UPDATE GAGAL',
      sub: 'gak bisa baca HEAD repo',
      pill: { t: 'GAGAL', cls: 'bad' },
      head: `<div class="lbl">❌ <span>rev-parse HEAD</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
      meta: [`🕒 ${hesc(nowWIB())}`]
    }, [
      '*UPDATE GAGAL*',
      '',
      '🔍 Gak bisa baca HEAD:',
      ...gitErrDetail(err),
      '',
      `🕒 ${nowWIB()}`
    ])
    return
  }

  // Fetch dulu biar tau ada update gak (dan error remote keliatan jelas)
  try {
    await git(['fetch', 'origin', '--quiet'], 120_000)
  } catch (err) {
    await ctx.react('⚠️')
    await replyRich(ctx, {
      icon: '⚠️',
      title: 'UPDATE GAGAL',
      sub: 'fetch origin error',
      pill: { t: 'GAGAL', cls: 'bad' },
      head: `<div class="lbl">❌ <span>git fetch origin</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
      notes: [{ t: 'Cek koneksi server / akses remote<br>(token SSH/HTTPS expired?).', cls: 'bad' }]
    }, [
      '*UPDATE GAGAL*',
      '',
      '🔍 Fetch origin error:',
      ...gitErrDetail(err),
      '',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ])
    return
  }

  // Bandingin sama upstream
  let behind
  try {
    behind = (await git(['rev-list', '--count', 'HEAD..@{u}'])).out
  } catch {
    try {
      behind = (await git(['rev-list', '--count', `HEAD..origin/${BRANCH}`])).out
    } catch {
      behind = null
    }
  }

  if (behind === '0') {
    const cur = (await git(['log', '-1', '--oneline'])).out
    const [curHash = '', ...curMsg] = cur.split(' ')
    const restored = await autoRestore()
    const pending = await pendingNow()
    const rr = restoreReport(restored, pending)
    await ctx.react('✅')
    const log = [
      { pr: '$', tx: `git fetch origin ${BRANCH}`, cls: 'cmd' },
      { pr: '✓', tx: `origin/${BRANCH} sama dengan HEAD`, cls: 'ok' },
      { pr: '•', tx: 'tidak ada commit baru di GitHub', cls: 'dim' },
      ...rr.logLines
    ]
    await replyRich(ctx, {
      icon: '✅',
      title: 'UDAH TERBARU',
      sub: 'gak ada commit baru di GitHub',
      pill: { t: 'UP TO DATE', cls: 'ok' },
      head: `<div class="lbl">📌 <span>HEAD sekarang</span></div>
<div class="meta"><span class="hash">${hesc(curHash)}</span>${curMsg.length ? `<span>${hesc(trunc(curMsg.join(' '), 40))}</span>` : ''}</div>`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🌿 ${hesc(BRANCH)}`, `🕒 ${hesc(nowWIB())}`],
      chips: [
        { e: '📌', n: curHash.slice(0, 7), k: 'head' },
        { e: '🌿', n: BRANCH, k: 'branch' },
        { e: '♻️', n: restored.kept, k: 'pulih' },
        { e: '🕒', n: fmtDur(Date.now() - t0), k: 'durasi' }
      ],
      log,
      stats: [
        { k: '📡 origin', v: 'tersambung', cls: 'ok' },
        { k: '🔄 status', v: 'sudah paling baru', cls: 'ok' },
        rr.stat
      ],
      restore: rr.restore,
      buttons: actionButtons({ restart: false, restore: restored.lost > 0 || pendingCount(pending) > 0, compareUrl: `https://github.com/${shortRepo()}/commit/${curHash}` })
    }, [
      '✅ *UDAH TERBARU*',
      '',
      `📌 HEAD: \`${curHash}\``,
      curMsg.length ? `💬 ${trunc(curMsg.join(' '), 36)}` : null,
      '',
      '🖥️ *CONSOLE LOG*',
      ...log.map((l) => `${l.pr} ${l.tx}`),
      '',
      ...rr.textLines,
      '',
      'ℹ️ Gak ada commit baru dari GitHub',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ].filter(Boolean))
    return
  }

  // ── Simpen nilai milik user (apikey dll) dulu ──
  // config.js lokal pasti beda dari GitHub (user ngisi apikey sendiri),
  // dan `pull --ff-only` bakal NOLAK kalau file tracked berubah lokal.
  // Jadi: backup → balikin ke versi HEAD → pull → **auto-restore** setting
  // user (config + thumbnail) di atas kode terbaru. `.restore` cuma perlu
  // kalau auto-restore gagal.
  let keepState = { keeps: [], assets: [], pending: { config: false, assets: 0 } }
  let cfgReset = false
  try {
    keepState = await saveKeep()                              // baca + backup
    const dirty = (await git(['status', '--porcelain', '--', 'config.js'])).out
    if (dirty) {
      const head = await git(['show', 'HEAD:config.js'])    // versi commit lokal
      await fs.writeFile('config.js', head.out + '\n', 'utf8')
      cfgReset = true
    }
    // Thumbnail punya user juga KE-TRACK — kalau beda dari HEAD,
    // `pull --ff-only` bakal NOLAK ("would be overwritten by merge").
    // Balikin dulu ke versi HEAD biar pull lancar; nilainya udah
    // ke-backup di saveKeep() dan bisa dipulihin lewat `.restore`.
    // (assets cuma berisi file yang beneran pernah diubah user)
    for (const { rel } of keepState.assets) {
      try { await git(['checkout', 'HEAD', '--', rel], 30_000) } catch {}
    }
  } catch {}

  // Pull (--ff-only: tolak kalau ada editan lokal di panel — jangan edit
  // file langsung di server, editnya di lokal lalu push)
  let pullErr = null
  try {
    await git(['pull', '--ff-only', 'origin', BRANCH], 120_000)
  } catch (err) {
    pullErr = err
  }

  // Pull gagal → file lokal udah dibalikin ke versi HEAD, jadi setting user
  // WAJIB dipulihkan balik (kalau enggak, apikey di config.js hilang sampai
  // `.restore` manual).

  if (pullErr) {
    const restored = await autoRestore()
    const pending = await pendingNow()
    const rr = restoreReport(restored, pending)
    await ctx.react('⚠️')
    const log = [
      { pr: '$', tx: `git pull --ff-only origin ${BRANCH}`, cls: 'cmd' },
      { pr: '✗', tx: 'pull ditolak oleh git', cls: 'bad' },
      ...gitErrDetail(pullErr).slice(0, 3).map((l) => ({ pr: '•', tx: trunc(l, 56), cls: 'warn' })),
      ...rr.logLines
    ]
    await replyRich(ctx, {
      icon: '⚠️',
      title: 'UPDATE GAGAL',
      sub: 'git pull ditolak',
      pill: { t: 'GAGAL', cls: 'bad' },
      head: `<div class="lbl">❌ <span>pull --ff-only error</span></div>
${gitErrDetail(pullErr).map((l) => row(hesc(l))).join('')}`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
      chips: [
        { e: '⚠️', n: 'gagal', k: 'status' },
        { e: '♻️', n: restored.kept, k: 'pulih' },
        { e: '🕒', n: fmtDur(Date.now() - t0), k: 'durasi' },
        { e: '🌿', n: BRANCH, k: 'branch' }
      ],
      log,
      notes: [
        { t: '💡 Kemungkinan ada file diedit<br>langsung di panel.', cls: 'warn' },
        { t: 'Paling aman: edit di <b>lokal</b> →<br><b>push</b> → <b>.updatesc</b><br>(atau reset repo di panel).', cls: 'warn' }
      ].filter(Boolean),
      stats: [
        { k: '🔄 git pull', v: 'GAGAL', cls: 'bad' },
        rr.stat
      ],
      restore: rr.restore,
      buttons: actionButtons({ restart: false, restore: true })
    }, [
      '*UPDATE GAGAL*',
      '',
      ...gitErrDetail(pullErr),
      '',
      '🖥️ *CONSOLE LOG*',
      ...log.map((l) => `${l.pr} ${l.tx}`),
      '',
      ...rr.textLines,
      '',
      '💡 Kemungkinan ada file diedit langsung',
      '   di panel. Paling aman: edit di lokal',
      '   → push → .updatesc (atau reset repo)',
      '',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ])
    return
  }

  // ── Kode udah terbaru → tahap 2 (restore) dijalankan setelah kartu update ──
  const newHead = (await git(['rev-parse', 'HEAD'])).out
  let commits = [] // { hash, subject, body }
  let files = []
  try {
    // %x1f = unit sep, %x1e = record sep — subject & body aman dari newline
    const log = (
      await git(['log', '--format=%h%x1f%s%x1f%b%x1e', `${oldHead}..${newHead}`])
    ).out
    commits = log
      .split('\x1e')
      .map((rec) => rec.replace(/^\n+|\n+$/g, ''))
      .filter(Boolean)
      .map((rec) => {
        const [hash = '', subject = '', body = ''] = rec.split('\x1f')
        return { hash: hash.trim(), subject: subject.trim(), body: body.trim() }
      })
    files = (await git(['diff', '--name-only', `${oldHead}..${newHead}`])).out.split('\n').filter(Boolean)
  } catch {}

  // Auto npm install KUMULUAN kalau package manifest ikut berubah
  const { installed, installErr } = await npmInstallMaybe(
    ctx,
    files.includes('package.json') || files.includes('package-lock.json')
  )

  // Kategorin commit: fitur baru / fix / lainnya (dari subject + body)
  const categorize = (c) => {
    const t = `${c.subject} ${c.body}`.toLowerCase()
    if (/\b(fix|bug|perbaiki|perbaikan|patch|hotfix|repair|bugfix)\b/.test(t)) return 'fix'
    if (/\b(fitur|feature|feat|tambah|baru|new|port|redesign|enhance|update)\b/.test(t)) return 'feat'
    return 'other'
  }
  const groups = { feat: [], fix: [], other: [] }
  for (const c of commits) groups[categorize(c)].push(c)

  // Rekap — butuh restart gak?
  const needRestart = files.some(
    (f) => NEED_RESTART_RE.test(f) || f === 'sky.js' || f === 'config.js'
  )
  const onlyPlugins = files.length > 0 && files.every((f) => f.startsWith('plugins/'))

  const oldShort = oldHead.slice(0, 7)
  const newShort = newHead.slice(0, 7)

  // ── Auto-restore setting user (digabung langsung dalam 1 kartu) ──
  const restored = await autoRestore()
  const pending = await pendingNow()
  const rr = restoreReport(restored, pending)

  const log = [
    { pr: '$', tx: `git pull --ff-only origin ${BRANCH}`, cls: 'cmd' },
    { pr: '✓', tx: `${oldShort}..${newShort} (${commits.length} commit)`, cls: 'ok' },
    files.length
      ? { pr: '✓', tx: `${files.length} file diperbarui`, cls: 'ok' }
      : { pr: '•', tx: 'tidak ada file berubah', cls: 'dim' },
    { pr: '$', tx: 'npm install --omit=dev', cls: 'cmd' },
    installed
      ? { pr: '✓', tx: 'dependency terpasang', cls: 'ok' }
      : installErr
        ? { pr: '✗', tx: 'npm install gagal — cek log panel', cls: 'bad' }
        : { pr: '•', tx: 'package.json gak berubah — dilewati', cls: 'dim' },
    ...rr.logLines,
    needRestart
      ? { pr: '!', tx: 'core/lib/handlers berubah → restart panel', cls: 'warn' }
      : onlyPlugins
        ? { pr: '⚡', tx: 'cuma plugins/ → hot reload otomatis', cls: 'ok' }
        : { pr: '✓', tx: 'update selesai tanpa restart', cls: 'ok' }
  ]

  await ctx.react(installErr ? '⚠️' : '✅')
  await replyRich(ctx, {
    icon: installErr ? '⚠️' : '🚀',
    title: 'UPDATE SELESAI',
    sub: `${commits.length} commit · ${files.length} file diperbarui`,
    pill: { t: installErr ? 'ADA ERROR' : 'SUKSES', cls: installErr ? 'warn' : 'ok' },
    head: `<div class="lbl">📌 <span>revisi</span></div>
<div class="meta"><span class="hash">${hesc(oldShort)}</span><span class="arrow">➜</span><span class="hash">${hesc(newShort)}</span><span>⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b></span><span>🌿 ${hesc(BRANCH)}</span></div>`,
    chips: [
      { e: '🆕', n: groups.feat.length, k: 'fitur' },
      { e: '🔧', n: groups.fix.length, k: 'fix' },
      { e: '📝', n: groups.other.length, k: 'lain' },
      { e: '📁', n: files.length, k: 'file' }
    ],
    sections: [
      groups.feat.length ? { icon: '🆕', label: 'FITUR BARU', items: groups.feat.map((c) => c.subject) } : null,
      groups.fix.length ? { icon: '🔧', label: 'FIX', items: groups.fix.map((c) => c.subject) } : null,
      groups.other.length ? { icon: '📝', label: 'LAINNYA', items: groups.other.map((c) => c.subject) } : null,
      files.length
        ? {
            icon: '📁',
            label: 'FILE BERUBAH',
            items: (() => {
              const byDir = {}
              for (const f of files) {
                const key = f.includes('/') ? `${f.split('/')[0]}/` : f
                byDir[key] = (byDir[key] || 0) + 1
              }
              return Object.keys(byDir).slice(0, 6).map((d) => `${d} · ${byDir[d]} file`)
            })()
          }
        : null
    ].filter(Boolean),
    log,
    stats: [
      { k: '📦 npm install', v: installed ? 'sukses' : installErr ? 'GAGAL' : 'lewati', cls: installed ? 'ok' : installErr ? 'bad' : 'dim' },
      rr.stat,
      needRestart
        ? { k: '🔁 aksi', v: 'RESTART di panel', cls: 'bad' }
        : onlyPlugins
          ? { k: '⚡ aksi', v: 'hot reload · tanpa restart', cls: 'ok' }
          : { k: '✅ aksi', v: 'selesai', cls: 'ok' }
    ].filter(Boolean),
    restore: rr.restore,
    notes: [
      cfgReset ? { t: '⚙️ config.js sempat di-reset ke<br>versi GitHub sebelum pull.' } : null,
      needRestart
        ? { t: '🔁 Ada file <b>core/lib/handlers</b> berubah —<br><b>RESTART bot di panel</b> biar kebaca.', cls: 'warn' }
        : onlyPlugins
          ? { t: '⚡ Cuma <b>plugins/</b> — ke-hot-reload<br>sendiri, gak perlu restart.' }
          : { t: '✅ Update bersih, gak ada<br>perubahan berisiko.' }
    ].filter(Boolean),
    buttons: actionButtons({
      restart: needRestart,
      restore: restored.lost > 0 || pendingCount(pending) > 0,
      compareUrl: compareUrl(oldShort, newShort)
    })
  }, [
    '*UPDATE SELESAI* ✅',
    '',
    `📌 \`${oldShort}\` ➜ \`${newShort}\``,
    `⏱️ *${fmtDur(Date.now() - t0)}* · 🌿 *${BRANCH}*`,
    '',
    `📊 ${groups.feat.length} 🆕 · ${groups.fix.length} 🔧 · ${groups.other.length} 📝 · ${files.length} 📁`,
    '',
    ...section('🆕 *FITUR BARU*', groups.feat),
    ...section('🔧 *FIX*', groups.fix),
    ...section('📝 *LAINNYA*', groups.other),
    ...fileSection(files),
    '🖥️ *CONSOLE LOG*',
    ...log.map((l) => `${l.pr} ${l.tx}`),
    '',
    ...rr.textLines,
    '',
    installed ? '📦 npm install *sukses*' : installErr ? '⚠️ npm install *gagal* (cek log)' : '📦 npm install *lewati*',
    needRestart
      ? '🔁 *RESTART* diperlukan (core/lib/handlers)'
      : onlyPlugins
        ? '⚡ Hot reload aktif · gak perlu restart'
        : '✅ Selesai',
    '',
    `🕒 ${nowWIB()}`
  ].filter(Boolean))
}

export { pluginConfig as config, handler }

// buat pengujian (loader cuma baca `config` + `handler`)
export const _internals = {
  KEEP_FILES, KEEP_BAK, KEEP_BAK_DIR, readKeep, writeKeep, saveKeep, assetPristine,
  backupStatus, restoreFromBackup, normalizeBackup,
  autoRestore, pendingNow, sendRestoreCard,
  restoredNote,
  pendingCount, pendingStats, pendingNote, pendingLine,
  untgz,
  MANIFEST_FILE, listRelFiles, readManifest, pruneStale,
  buildResultHtml, restoreReport, actionButtons, friendlyKey, friendlyAsset
}
