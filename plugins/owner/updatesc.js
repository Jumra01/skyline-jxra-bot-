/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * update.js — Tarik update script dari GitHub (owner).
 *
 * Pakai:
 *   .updatesc         → git fetch + pull --ff-only dari origin, lalu rekap
 *                      "apa yang baru": 🆕 fitur / 🔧 fix / 📝 lainnya + file berubah
 *                      (commit baru + daftar file berubah)
 *   auto-healing      → folder BELUM git repo (deploy panel via upload file)
 *                      → git init + tarik dari GitHub OTOMATIS
 *                      → server GAK punya git → fallback unduh via GitHub API
 *                         (Node fetch + tar system), file disamain sama GitHub
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

function box(lines) {
  const w = Math.min(
    Math.max(
      ...lines.map((l) => [...l].reduce((n, c) => n + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)),
      24
    ),
    44
  )
  return [
    '╭─〔 *UPDATE* 〕─⬣',
    ...lines.map((l) => `│ ${l}`),
    `╰${'─'.repeat(w + 2)}╯`
  ].join('\n')
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
    await ctx.reply('📦 *DEPENDENCY BERUBAH*\n\n_Jalanin npm install... (bisa 1-2 menit)_')
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
  const hasGit = await gitAvailable()

  // ── Jalur 1: server gak punya git → fallback GitHub API ──
  if (!hasGit) {
    await ctx.react('🔄')
    await ctx.reply('🔄 *UPDATE*\n\n_Git gak ada di server — fallback unduh via GitHub API..._')
    try {
      const { short, msg, pkgChanged } = await apiSync()
      const { installed, installErr } = await npmInstallMaybe(ctx, pkgChanged)
      await ctx.react(installErr ? '⚠️' : '✅')
      await ctx.reply(
        box([
          '*UPDATE SELESAI* ✅ (API)',
          '',
          'Server gak punya git — file',
          'disamain langsung dari GitHub.',
          '',
          `HEAD: ${short} ${msg.slice(0, 40)}`,
          installed ? ['', '📦 npm install *sukses*'] : [],
          installErr ? ['', '⚠️ npm install GAGAL:', ...installErr.map((l) => `• ${l}`)] : [],
          '',
          '🔁 Tanpa git, daftar file berubah',
          'gak bisa dideteksi — *RESTART*',
          'bot di panel biar aman'
        ].flat().filter(Boolean))
      )
    } catch (err) {
      await ctx.react('⚠️')
      await ctx.reply(
        box([
          '*UPDATE GAGAL*',
          '',
          'Fallback API error:',
          `• ${String(err?.message || err).split('\n')[0].slice(0, 120)}`
        ])
      )
    }
    return
  }

  // ── Jalur 2: git ada, folder BELUM repo (upload file tanpa clone) → auto init ──
  let bootstrapped = null
  if (!(await isGitRepo())) {
    await ctx.react('🔄')
    await ctx.reply('⚠️ _Folder ini belum git repo — init otomatis + tarik dari GitHub..._')
    try {
      bootstrapped = await bootstrapRepo()
    } catch (err) {
      await ctx.reply(box(['*SETUP GAGAL*', '', ...gitErrDetail(err).map((l) => `• ${l}`)]))
      return
    }
    const { installed, installErr } = await npmInstallMaybe(ctx, bootstrapped.pkgChanged)
    await ctx.react(installErr ? '⚠️' : '✅')
    await ctx.reply(
      box([
        '*SETUP REPO* ✅',
        '',
        'Git repo dibuat otomatis +',
        'file disamain sama GitHub.',
        '',
        `HEAD: ${bootstrapped.head}`,
        installed ? ['', '📦 npm install *sukses*'] : [],
        installErr ? ['', '⚠️ npm install GAGAL:', ...installErr.map((l) => `• ${l}`)] : [
          '',
          '⚠️ config.js lokal disimpan',
          'di config.js.pre-git.bak'
        ],
        '',
        '🔁 *RESTART* bot di panel biar',
        'kode baru kebaca. Abis ini',
        '.updatesc jalan normal (pull).'
      ].flat().filter(Boolean))
    )
    return
  }

  // ── Jalur 3: repo normal → fetch + pull --ff-only ──
  await ensureOriginUrl()

  await ctx.react('🔄')
  await ctx.reply('🔄 *UPDATE*\n\n_Mengambil commit terbaru dari GitHub..._')

  let oldHead
  try {
    oldHead = (await git(['rev-parse', 'HEAD'])).out
  } catch (err) {
    await ctx.reply(
      box(['*UPDATE GAGAL*', '', 'Gak bisa baca HEAD:', ...gitErrDetail(err).map((l) => `• ${l}`)])
    )
    return
  }

  // Fetch dulu biar tau ada update gak (dan error remote keliatan jelas)
  try {
    await git(['fetch', 'origin', '--quiet'], 120_000)
  } catch (err) {
    await ctx.reply(
      box([
        '*UPDATE GAGAL*',
        '',
        'Fetch origin error:',
        ...gitErrDetail(err).map((l) => `• ${l}`)
      ])
    )
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
    await ctx.react('✅')
    await ctx.reply(
      box([
        '*UPDATE* ✅',
        '',
        'Script udah *terbaru* — gak ada commit baru.',
        '',
        `HEAD: ${cur}`
      ])
    )
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
    await ctx.reply(
      box([
        '*UPDATE GAGAL*',
        '',
        ...gitErrDetail(pullErr).map((l) => `• ${l}`),
        '',
        'Kemungkinan ada file yang diedit',
        'langsung di panel. Paling aman:',
        'edit di lokal → push → .updatesc',
        '(atau reset repo di panel)'
      ])
    )
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

  const SECTION_MAX = 6
  const section = (label, list) => {
    if (!list.length) return []
    const rows = list.slice(0, SECTION_MAX).map((c) => {
      const subj = c.subject.length > 52 ? `${c.subject.slice(0, 51)}…` : c.subject
      return [`◦ ${subj}`, c.body ? `  _${c.body.split('\n')[0].slice(0, 60)}_` : null]
    })
    if (list.length > SECTION_MAX) rows.push([`… +${list.length - SECTION_MAX} lainnya`])
    return [label, ...rows.flat().filter(Boolean), '']
  }

  const fileLines = files.slice(0, 8).map((f) => `◦ ${f}`)
  if (files.length > 8) fileLines.push(`… +${files.length - 8} file lain`)

  const status = [
    `*${commits.length} commit* · *${files.length} file* diperbarui`,
    '',
    ...section('🆕 *FITUR BARU:*', groups.feat),
    ...section('🔧 *FIX:*', groups.fix),
    ...section('📝 *LAINNYA:*', groups.other),
    files.length ? ['📁 *FILE BERUBAH:*', ...fileLines, ''] : [],
    installed ? ['📦 npm install *sukses*', ''] : [],
    installErr ? ['⚠️ npm install GAGAL:', ...installErr.map((l) => `• ${l}`), ''] : [],
    needRestart
      ? '🔁 Ada perubahan *core/lib/handlers* → *RESTART* bot di panel biar kebaca'
      : onlyPlugins
        ? '⚡ Cuma plugins/ → ke-*hot reload* sendiri, gak perlu restart'
        : '✅ Selesai'
  ].flat().filter((l) => l !== undefined)

  await ctx.react(installErr ? '⚠️' : '✅')
  await ctx.reply(box(['*UPDATE SELESAI* ✅', '', ...status.filter(Boolean)]))
}

export { pluginConfig as config, handler }
