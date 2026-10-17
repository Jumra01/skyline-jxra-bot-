/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * clearcache.js — Bersihkan cache bot (owner).
 *
 * Pakai:
 *   .clearcache          → status ukuran cache + tombol aksi
 *   .clearcache all      → hapus semua isi cache/ + temp + reset memori emoji
 *   .clearcache emoji    → hapus emoji-list.json (28MB) + reset memori emoji
 *   .clearcache temp     → hapus folder temp sisa stiker/brat di /tmp
 *
 * Aman: file di cache/ semuanya auto re-download saat dipakai lagi
 * (emoji-list.json & impact.ttf oleh lib masing-masing).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { onRichReply } from '../../handlers/messageHandler.js'
import { resetEmojiCache } from '../../lib/emojiRenderer.js'

const CACHE_DIR = path.join(process.cwd(), 'cache')

function formatBytes(n) {
  if (n === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return parseFloat((n / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function dirSize(dir, filter = () => true) {
  let total = 0
  let count = 0
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      try {
        const st = fs.statSync(p)
        if (!filter(name, st)) continue
        if (st.isDirectory()) {
          const sub = dirSize(p, () => true)
          total += sub.total
          count += sub.count
        } else {
          total += st.size
          count += 1
        }
      } catch {}
    }
  } catch {}
  return { total, count }
}

function tempDirs() {
  const tmp = os.tmpdir()
  try {
    return fs.readdirSync(tmp).filter((n) => /^(stiker-|brat-)/.test(n)).map((n) => path.join(tmp, n))
  } catch {
    return []
  }
}

function statusText() {
  const cache = dirSize(CACHE_DIR)
  const temp = dirSize(os.tmpdir(), (name) => /^(stiker-|brat-)/.test(name))
  const emojiFile = (() => {
    try { return fs.statSync(path.join(CACHE_DIR, 'emoji-list.json')).size } catch { return 0 }
  })()
  const fontFile = (() => {
    try { return fs.statSync(path.join(CACHE_DIR, 'impact.ttf')).size } catch { return 0 }
  })()
  return (
    `🧹 *CLEAR CACHE*\n\n` +
    `📁 *cache/* — ${formatBytes(cache.total)} (${cache.count} file)\n` +
    `  ◦ emoji-list.json: ${formatBytes(emojiFile)}\n` +
    `  ◦ impact.ttf: ${formatBytes(fontFile)}\n` +
    `  ◦ lainnya: ${formatBytes(cache.total - emojiFile - fontFile)}\n\n` +
    `🗑️ */tmp (stiker/brat)* — ${formatBytes(temp.total)} (${temp.count} file)\n\n` +
    `_File cache auto re-download saat dipakai lagi._`
  )
}

async function doClear(ctx, mode) {
  const before = dirSize(CACHE_DIR).total + dirSize(os.tmpdir(), (n) => /^(stiker-|brat-)/.test(n)).total
  let freedEmoji = 0
  let freedFont = 0
  let freedTemp = 0
  let tempCount = 0
  const removed = []

  const rmQuiet = (p) => {
    try { fs.rmSync(p, { recursive: true, force: true }); return true } catch { return false }
  }

  if (mode === 'emoji' || mode === 'all') {
    const p = path.join(CACHE_DIR, 'emoji-list.json')
    try { freedEmoji = fs.statSync(p).size } catch {}
    if (rmQuiet(p)) removed.push('emoji-list.json')
    resetEmojiCache()
  }
  if (mode === 'all') {
    const p = path.join(CACHE_DIR, 'impact.ttf')
    try { freedFont = fs.statSync(p).size } catch {}
    if (rmQuiet(p)) removed.push('impact.ttf')
  }
  if (mode === 'temp' || mode === 'all') {
    for (const dir of tempDirs()) {
      const s = dirSize(dir).total
      if (rmQuiet(dir)) {
        freedTemp += s
        tempCount += 1
      }
    }
    if (tempCount) removed.push(`${tempCount} folder temp`)
  }

  const freed = freedEmoji + freedFont + freedTemp
  const lines = [
    removed.length
      ? `🧹 *CACHE DIBERSIHKAN*\n\n` +
        (freedEmoji ? `◦ emoji-list.json: *${formatBytes(freedEmoji)}*\n` : '') +
        (freedFont ? `◦ impact.ttf: *${formatBytes(freedFont)}*\n` : '') +
        (freedTemp ? `◦ folder temp: *${formatBytes(freedTemp)}* (${tempCount})\n` : '')
      : `ℹ️ Gak ada yang bisa dihapus di mode ini.`,
    `\nTotal dibebaskan: *${formatBytes(freed)}*`,
    `\n_File cache auto re-download saat dipakai lagi._`
  ]
  await ctx.react(removed.length ? '🧹' : 'ℹ️')
  await ctx.reply(lines.join(''))
}

function ensureHandlers() {
  onRichReply('clearcache:all', (ctx) => doClear(ctx, 'all'))
  onRichReply('clearcache:emoji', (ctx) => doClear(ctx, 'emoji'))
  onRichReply('clearcache:temp', (ctx) => doClear(ctx, 'temp'))
}
ensureHandlers()

const pluginConfig = {
  name: 'clearcache',
  alias: ['cc', 'bersihcache', 'cleancache'],
  category: 'owner',
  description: 'Bersihkan cache bot (emoji/temp/all)',
  usage: '.clearcache [all|emoji|temp]',
  example: '.clearcache',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true
}

async function handler(ctx) {
  const opt = (ctx.args[0] || '').toLowerCase()
  if (['all', 'emoji', 'temp'].includes(opt)) {
    await doClear(ctx, opt)
    return
  }
  await ctx.replyButtons({
    text: statusText(),
    footer: 'skyline-JXRA',
    buttons: [
      { id: 'clearcache:all', text: '🧹 Hapus Semua' },
      { id: 'clearcache:emoji', text: '🎌 Emoji (28MB)' },
      { id: 'clearcache:temp', text: '🗑️ Temp' }
    ]
  })
}

export { pluginConfig as config, handler }
