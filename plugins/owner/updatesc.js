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
 *   auto             → kalau package.json / package-lock.json ikut berubah,
 *                      jalanin `npm install --omit=dev` sendiri setelah pull.
 *
 * node_modules TIDAK diambil dari git (gitignore) — install cuma jalan
 * kalau dependency berubah. session/ & data/ gak tersentuh (gitignore).
 * File core/ lib/ handlers/ sky.js config/ berubah → butuh Restart manual
 * di panel; plugins/ → ke-hot-reload sendiri.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)

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

const pluginConfig = {
  name: 'updatesc',
  alias: ['update', 'gitupdate', 'pullbot', 'updatebot'],
  category: 'owner',
  description: 'Tarik update script dari GitHub (git pull + auto npm install)',
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
  // 1. Pastiin cwd = git repo (deploy panel harus clone dari GitHub)
  try {
    await git(['rev-parse', '--is-inside-work-tree'])
  } catch (err) {
    await ctx.reply(
      box(['*UPDATE GAGAL*', '', ...gitErrDetail(err).map((l) => `• ${l}`)])
    )
    return
  }

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

  // 2. Fetch dulu biar tau ada update gak (dan error remote keliatan jelas)
  try {
    await git(['fetch', 'origin', '--quiet'])
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

  // 3. Bandingin sama upstream
  let behind
  try {
    behind = (await git(['rev-list', '--count', 'HEAD..@{u}'])).out
  } catch {
    try {
      behind = (await git(['rev-list', '--count', 'HEAD..origin/main'])).out
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

  // 4. Pull (--ff-only: tolak kalau ada editan lokal di panel — jangan edit
  //    file langsung di server, editnya di lokal lalu push)
  let pullErr = null
  try {
    await git(['pull', '--ff-only'], 120_000)
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

  // 5. Auto npm install KUMULUAN kalau package manifest ikut berubah
  let installed = false
  let installErr = null
  if (files.includes('package.json') || files.includes('package-lock.json')) {
    try {
      await ctx.reply('📦 *DEPENDENCY BERUBAH*\n\n_Jalanin npm install... (bisa 1-2 menit)_')
      await pexec('npm', ['install', '--omit=dev'], {
        cwd: process.cwd(),
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024
      })
      installed = true
    } catch (err) {
      installErr = String(err?.message || err).split('\n').slice(0, 4)
    }
  }

  // 6. Kategorin commit: fitur baru / fix / lainnya (dari subject + body)
  const categorize = (c) => {
    const t = `${c.subject} ${c.body}`.toLowerCase()
    if (/\b(fix|bug|perbaiki|perbaikan|patch|hotfix|repair|bugfix)\b/.test(t)) return 'fix'
    if (/\b(fitur|feature|feat|tambah|baru|new|port|redesign|enhance|update)\b/.test(t)) return 'feat'
    return 'other'
  }
  const groups = { feat: [], fix: [], other: [] }
  for (const c of commits) groups[categorize(c)].push(c)

  // 7. Rekap — butuh restart gak?
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
