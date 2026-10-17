/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * update.js — Tarik update script dari GitHub (owner).
 *
 * Pakai:
 *   .updatesc         → git fetch + pull --ff-only dari origin
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

function git(args, timeout = 60_000) {
  return pexec('git', args, {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  }).then(({ stdout, stderr }) => ({ out: String(stdout).trim(), err: String(stderr).trim() }))
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
  } catch {
    await ctx.reply(
      '❌ *UPDATE GAGAL*\n\n' +
      'Folder bot ini bukan git repo.\n' +
      'Deploy ulang dengan `git clone <repo>` biar .updatesc bisa jalan.'
    )
    return
  }

  await ctx.react('🔄')
  await ctx.reply('🔄 *UPDATE*\n\n_Mengambil commit terbaru dari GitHub..._')

  let oldHead
  try {
    oldHead = (await git(['rev-parse', 'HEAD'])).out
  } catch {
    await ctx.reply('❌ Gak bisa baca HEAD repo — cek instalasi git di server.')
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
        ...(String(err?.message || err).split('\n').slice(0, 4).map((l) => `• ${l}`)),
        '',
        'Cek koneksi/akses git server (token expired?)'
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
    const detail = String(pullErr?.message || pullErr).split('\n').slice(0, 5)
    await ctx.react('⚠️')
    await ctx.reply(
      box([
        '*UPDATE GAGAL*',
        '',
        ...detail.map((l) => `• ${l}`),
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
  let commits = []
  let files = []
  try {
    commits = (await git(['log', '--oneline', `${oldHead}..${newHead}`])).out.split('\n').filter(Boolean)
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

  // 6. Rekap — butuh restart gak?
  const needRestart = files.some(
    (f) => NEED_RESTART_RE.test(f) || f === 'sky.js' || f === 'config.js'
  )
  const onlyPlugins = files.length > 0 && files.every((f) => f.startsWith('plugins/'))

  const commitLines = commits.slice(0, 5).map((c) => `◦ ${c}`)
  if (commits.length > 5) commitLines.push(`… +${commits.length - 5} commit lain`)

  const fileLines = files.slice(0, 8).map((f) => `◦ ${f}`)
  if (files.length > 8) fileLines.push(`… +${files.length - 8} file lain`)

  const status = [
    `*${commits.length} commit* · *${files.length} file* diperbarui`,
    '',
    ...commitLines,
    files.length ? ['', ...fileLines] : [],
    installed ? ['', '📦 npm install *sukses*'] : [],
    installErr ? ['', '⚠️ npm install GAGAL:', ...installErr.map((l) => `• ${l}`)] : [],
    '',
    needRestart
      ? '🔁 Ada perubahan *core/lib/handlers* → *RESTART* bot di panel biar kebaca'
      : onlyPlugins
        ? '⚡ Cuma plugins/ → ke-*hot reload* sendiri, gak perlu restart'
        : commits.length
          ? '✅ Selesai'
          : ''
  ].flat().filter((l) => l !== undefined)

  await ctx.react(installErr ? '⚠️' : '✅')
  await ctx.reply(box(['*UPDATE SELESAI* ✅', '', ...status.filter(Boolean)]))
}

export { pluginConfig as config, handler }
