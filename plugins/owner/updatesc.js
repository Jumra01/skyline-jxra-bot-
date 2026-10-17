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
  try { await fs.copyFile('config.js', 'config.js.pre-git.bak') } catch {}

  await git(['init'])
  await ensureOriginUrl()
  await git(['fetch', 'origin', BRANCH], 180_000)
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

// Fallback tanpa git: unduh tarball branch dari codeload → extract murni Node
// (untgz) → timpa isi folder kerja (fs.cp). Gak butuh binary git/tar/cp —
// aman di container minimal. Gak bisa deteksi file berubah — package.json
// dicek manual (bandingin sebelum/sesudah copy).
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

    // fs.cp recursive — murni Node, tanpa binary cp system
    await fs.cp(src, process.cwd(), { recursive: true, force: true })

    let pkgChanged = false
    try {
      const pkgAfter = await fs.readFile('package.json')
      pkgChanged = !!pkgBefore && !pkgBefore.equals(pkgAfter)
    } catch {}

    return { short, msg, pkgChanged }
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
      const { short, msg, pkgChanged } = await apiSync()
      const { installed, installErr } = await npmInstallMaybe(ctx, pkgChanged)
      const npmLine = installed
        ? '📦 npm install *sukses*'
        : installErr
          ? '⚠️ npm install *gagal* (cek log)'
          : '📦 npm install *lewati*'
      await ctx.react(installErr ? '⚠️' : '✅')
      await ctx.reply(card(installErr ? '⚠️' : '🌐', 'UPDATE', [
        '✅ *UPDATE SELESAI (API)*',
        '',
        `📌 \`${short}\` ${trunc(msg, 30)}`,
        `⏱️ *${fmtDur(Date.now() - t0)}*`,
        '',
        '🌐 Server tanpa git — sync via GitHub API',
        'ℹ️ Daftar file gak bisa dideteksi (tanpa git)',
        npmLine,
        '',
        '🔁 *RESTART* bot di panel biar kode baru kebaca',
        '',
        `🕒 ${nowWIB()}`
      ]))
    } catch (err) {
      await ctx.react('⚠️')
      await ctx.reply(card('⚠️', 'UPDATE', [
        '❌ *UPDATE GAGAL*',
        '',
        '🔍 Detail error:',
        ...gitErrDetail(err).map((l) => l),
        '',
        `⏱️ *${fmtDur(Date.now() - t0)}*`,
        `🕒 ${nowWIB()}`
      ]))
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
      await ctx.reply(card('⚠️', 'SETUP', [
        '❌ *SETUP GAGAL*',
        '',
        ...gitErrDetail(err),
        '',
        `🕒 ${nowWIB()}`
      ]))
      return
    }
    const { installed, installErr } = await npmInstallMaybe(ctx, bootstrapped.pkgChanged)
    const npmLine = installed
      ? '📦 npm install *sukses*'
      : installErr
        ? '⚠️ npm install *gagal* (cek log)'
        : '📦 npm install *lewati*'
    await ctx.react(installErr ? '⚠️' : '✅')
    await ctx.reply(card(installErr ? '⚠️' : '⚙️', 'SETUP', [
      '✅ *SETUP REPO SELESAI*',
      '',
      `📌 HEAD: \`${bootstrapped.head.split(' ')[0]}\``,
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      '',
      '📥 Repo di-init otomatis + sync penuh',
      '💾 config.js lama → `config.js.pre-git.bak`',
      npmLine,
      '',
      '🔁 *RESTART* bot di panel',
      '⚠️ Abis restart, .updatesc jalan normal (pull)',
      '',
      `🕒 ${nowWIB()}`
    ]))
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
    await ctx.reply(card('⚠️', 'UPDATE', [
      '❌ *UPDATE GAGAL*',
      '',
      '🔍 Gak bisa baca HEAD:',
      ...gitErrDetail(err),
      '',
      `🕒 ${nowWIB()}`
    ]))
    return
  }

  // Fetch dulu biar tau ada update gak (dan error remote keliatan jelas)
  try {
    await git(['fetch', 'origin', '--quiet'], 120_000)
  } catch (err) {
    await ctx.react('⚠️')
    await ctx.reply(card('⚠️', 'UPDATE', [
      '❌ *UPDATE GAGAL*',
      '',
      '🔍 Fetch origin error:',
      ...gitErrDetail(err),
      '',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ]))
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
    await ctx.react('✅')
    await ctx.reply(card('✅', 'UPDATE', [
      '✅ *UDAH TERBARU*',
      '',
      `📌 HEAD: \`${curHash}\``,
      curMsg.length ? `💬 ${trunc(curMsg.join(' '), 36)}` : null,
      '',
      'ℹ️ Gak ada commit baru dari GitHub',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ].filter(Boolean)))
    return
  }

  // Pull (--ff-only: tolak kalau ada editan lokal di panel — jangan edit
  // file langsung di server, editnya di lokal lalu push)
  let pullErr = null
  try {
    await git(['pull', '--ff-only', 'origin', BRANCH], 120_000)
  } catch (err) {
    pullErr = err
  }

  if (pullErr) {
    await ctx.react('⚠️')
    await ctx.reply(card('⚠️', 'UPDATE', [
      '❌ *UPDATE GAGAL*',
      '',
      ...gitErrDetail(pullErr),
      '',
      '💡 Kemungkinan ada file diedit langsung',
      '   di panel. Paling aman: edit di lokal',
      '   → push → .updatesc (atau reset repo)',
      '',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ]))
    return
  }

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

  const npmLine = installed
    ? '📦 npm install *sukses*'
    : installErr
      ? '⚠️ npm install *gagal* (cek log)'
      : '📦 npm install *lewati*'
  const restartLine = needRestart
    ? '🔁 *RESTART* diperlukan (core/lib/handlers)'
    : onlyPlugins
      ? '⚡ Hot reload aktif · gak perlu restart'
      : '✅ Selesai'

  await ctx.react(installErr ? '⚠️' : '✅')
  await ctx.reply(card(installErr ? '⚠️' : '✅', 'UPDATE', [
    '✅ *UPDATE SELESAI*',
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
    npmLine,
    restartLine,
    '',
    `🕒 ${nowWIB()}`
  ]))
}

export { pluginConfig as config, handler }
