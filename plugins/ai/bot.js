/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bot.js — Chat AI (Aion Labs) yang INGET riwayat obrolan (.bot / tag nomor bot).
 *
 * PROVIDER: **Aion Labs** (https://api.aionlabs.ai/v1, OpenAI-compatible).
 *   Model default `aion-labs/aion-rp-llama-3.1-8b` = "completely uncensored",
 *   jago roleplay/ngobrol. Free tier: 15 req/menit · 20.000 token/hari.
 *
 * Semua pengaturan ada di config.js → blok `aiChat` (model/apikey/dll).
 * Key bisa ditimpa TANPA nyentuh config (prioritas paling tinggi dulu):
 *   env AICHAT_API_KEY  >  src/data/ai.json  >  config.aiChat
 * (file `src/data/ai.json` GITIGNORED — isi manual kalau perlu)
 *
 * Trigger:
 *   • command  → `.bot <pertanyaan>` (+ `.bot reset` buat hapus riwayat)
 *   • mention  → tag nomor bot di grup (tanpa prefix), kalau mentionTrigger aktif
 *
 * Persona/prompt: file `data/ai-persona.txt` (ganti via `.setpersona`).
 * Riwayat: disimpan di `data/ai-chat.json` (per nomor), dibatasi maxHistory.
 * Kuota  : `data/ai-usage.json` (penghitung token harian, peringatan kalau habis).
 */
import axios from 'axios'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { checkCooldown, checkFlood } from '../../core/cooldown.js'
import { getBotNumber } from '../../core/staff.js'
import { getUser } from '../../core/database.js'
import { setMentionHandler } from '../../core/mentionTrigger.js'
import { readPersona } from '../../lib/aiPersona.js'

const DATA_DIR = './data'
const STORE_FILE = `${DATA_DIR}/ai-chat.json`
// Override runtime (GITIGNORED, biar apikey gak ikut ke GitHub):
//   src/data/ai.json → { "provider": "...", "apikey": "...", "model": "...", "baseUrl": "..." }
// Dibaca LIVE tiap balasan → ganti apikey/model gak perlu restart.
// Path di-resolve relatif ke file ini (aman walau cwd bukan root repo).
// `AICHAT_OVERRIDE_FILE` cuma buat pengujian (arahin ke file lain / file kosong).
const OVERRIDE_FILE = process.env.AICHAT_OVERRIDE_FILE
  ? String(process.env.AICHAT_OVERRIDE_FILE)
  : fileURLToPath(new URL('../../src/data/ai.json', import.meta.url))
const MAX_TRACKED_USERS = 300   // batas jumlah user yang disimpan di disk
const MAX_CHARS = 4000          // potong pesan biar prompt gak meledak
// Penghitung token harian (biar bisa KASIH PERINGATAN sebelum kuota provider habis).
// Disimpan di data/ai-usage.json (gitignored), reset otomatis ganti hari (UTC).
const USAGE_FILE = `${DATA_DIR}/ai-usage.json`
const DEFAULT_DAILY_TOKENS = 20_000 // free tier Aion = 20K token/hari
const WARN_RATIO = 0.9              // ≥90% kuota → tempel peringatan di balasan

// ── Aion Labs (satu-satunya provider fitur ini) ──
// https://api.aionlabs.ai/v1 (OpenAI-compatible). Free tier: 15 RPM, 20K token/hari.
// Ambil key GRATIS (tanpa kartu): https://www.aionlabs.ai/app/api-keys/
const AION = {
  name: 'aion',
  baseUrl: 'https://api.aionlabs.ai/v1',
  // aion-rp-llama-3.1-8b = "completely uncensored", jago roleplay/ngobrol.
  model: 'aion-labs/aion-rp-llama-3.1-8b', // alternatif: aion-labs/aion-2.0
}

const pluginConfig = {
  name: 'bot',
  alias: ['aichat', 'ngobrol', 'chatai'],
  category: 'ai',
  description: 'Chat AI Aion Labs (uncensored) — inget riwayat obrolan',
  usage: '.bot <pertanyaan>  |  .bot reset  |  tag nomor bot di grup',
  example: '.bot jelasin apa itu lubang hitam singkat',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  energi: 1,
  isEnabled: true,
}

/* ══════════════════════ config ══════════════════════ */
function overrides() {
  try {
    const o = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'))
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}

function cfg() {
  const c = config.aiChat || {}
  const o = overrides() // prioritas: env > src/data/ai.json > config.js
  return {
    enabled: c.enabled !== false,
    provider: AION.name, // fokus Aion Labs
    baseUrl: String(o.baseUrl || c.baseUrl || AION.baseUrl).replace(/\/+$/, ''),
    model: String(o.model || c.model || AION.model).trim(),
    apikey: String(process.env.AICHAT_API_KEY || o.apikey || c.apikey || '').trim(),
    maxHistory: Math.max(2, Math.min(100, Number(c.maxHistory) || 20)),
    dailyTokenLimit: Math.max(0, Number(c.dailyTokenLimit ?? DEFAULT_DAILY_TOKENS) || 0),
    timeoutMs: Math.max(5000, Number(c.timeoutMs) || 60_000),
    mentionTrigger: c.mentionTrigger !== false,
    systemPrompt: String(c.systemPrompt || '').trim(),
  }
}

/* ══════════════════════ riwayat (memori) ══════════════════════ */
const store = new Map() // jid -> { at, msgs: [{ role, content }] }
let saveTimer = null

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    for (const [k, v] of Object.entries(raw || {})) {
      if (Array.isArray(v?.msgs)) store.set(k, { at: Number(v.at) || 0, msgs: v.msgs.slice(-100) })
    }
  } catch { /* belum ada / rusak → mulai kosong */ }
}

function saveStore() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const top = [...store.entries()]
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
        .slice(0, MAX_TRACKED_USERS)
      const obj = {}
      for (const [k, v] of top) obj[k] = { at: v.at, msgs: v.msgs.slice(-100) }
      const tmp = `${STORE_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(obj))
      fs.renameSync(tmp, STORE_FILE)
    } catch (err) {
      logger.warn({ err: String(err?.message || err) }, '[AIChat] gagal simpan riwayat')
    }
  }, 1200)
  if (saveTimer.unref) saveTimer.unref()
}

function historyKey(ctx) {
  return ctx.sender || ctx.senderLid || ctx.chat
}

function getHistory(key, max) {
  let h = store.get(key)
  if (!h) { h = { at: Date.now(), msgs: [] }; store.set(key, h) }
  if (h.msgs.length > max) h.msgs = h.msgs.slice(-max)
  return h
}

function resetHistory(key) {
  store.delete(key)
  saveStore()
}

/* ══════════════════════ kuota token harian ══════════════════════ */
// Perkiraan pemakaian token provider per hari (dari `usage` yang dibalikin API).
// Dipakai buat: (1) nolak duluan kalau kuota udah abis, (2) ngingetin kalau mepet.
function todayUTC() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function usageToday() {
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
    if (u && u.day === todayUTC()) return Math.max(0, Number(u.total) || 0)
  } catch { /* belum ada → 0 */ }
  return 0
}

function addUsage(tokens) {
  const n = Math.max(0, Number(tokens) || 0)
  if (!n) return usageToday()
  const total = usageToday() + n
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${USAGE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ day: todayUTC(), total }))
    fs.renameSync(tmp, USAGE_FILE)
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, '[AIChat] gagal simpan usage')
  }
  return total
}

/* ══════════════════════ prompt & profil ══════════════════════ */
function roleLabel(ctx) {
  if (ctx.isOwner) return 'Owner bot'
  if (ctx.isAdmin) return 'Admin bot'
  if (ctx.isStaff) return 'Staff bot'
  return 'Member biasa'
}

function userProfile(ctx) {
  const row = ctx.sender ? getUser(ctx.sender) : null
  const name = String(ctx.pushName || row?.name || '').trim() || 'Tanpa Nama'
  return {
    name,
    number: ctx.senderNumber ? `+${ctx.senderNumber}` : '-',
    role: roleLabel(ctx),
  }
}

function buildSystem(ctx, persona) {
  const u = userProfile(ctx)
  return `${persona}

[Konteks lawan bicara]
Nama: ${u.name}
Nomor: ${u.number}
Peran: ${u.role}
Jenis chat: ${ctx.isGroup ? 'grup' : 'chat pribadi'}
Sapa dia dengan namanya sesekali. Balas pakai bahasa yang dia pakai.`
}

/* ══════════════════════ panggil API ══════════════════════ */
function parseErr(data) {
  if (!data) return ''
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data
    const e = obj?.error
    return String(
      (e && (e.message || e.status)) || e || obj?.message || obj?.detail || ''
    ).trim()
  } catch {
    return String(data).slice(0, 200)
  }
}

async function askModel(conf, system, messages) {
  const res = await axios.post(
    `${conf.baseUrl}/chat/completions`,
    {
      model: conf.model,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.8,
      max_tokens: 800,
    },
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conf.apikey}` },
      timeout: conf.timeoutMs,
      validateStatus: () => true,
    }
  )
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(parseErr(res.data) || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  const content = res.data?.choices?.[0]?.message?.content
  return {
    content: typeof content === 'string' ? content.trim() : '',
    tokens: Number(res.data?.usage?.total_tokens) || 0,
  }
}

function nfmt(n) {
  return Number(n || 0).toLocaleString('id-ID')
}

// Pesan waktu kuota AI harian habis / provider lagi nge-limit.
function limitMsg(conf, used = 0) {
  const lim = Number(conf?.dailyTokenLimit) || DEFAULT_DAILY_TOKENS
  return (
    '🚦 *FITUR AI SEDANG LIMIT*\n\n' +
    `Kuota token harian udah habis (±${nfmt(lim)} token/hari — paket gratis).\n` +
    (used ? `> Terpakai hari ini: *${nfmt(used)}* token\n` : '') +
    '\n*Coba lagi BESOK* ya — kuota reset otomatis tiap ganti hari.\n' +
    '> Biar lebih hemat: kecilin riwayat (`maxHistory`) di config.'
  )
}

function isLimitErr(err) {
  const status = err?.status
  const msg = String(err?.message || err)
  return status === 429 || /rate.?limit|usage limit|quota|too many requests|exceed/i.test(msg)
}

function humanError(err) {
  const status = err?.status
  const msg = String(err?.message || err)
  // Kuota/limit Aion (token habis / rate limit) → peringatan "sedang limit"
  if (isLimitErr(err)) {
    return limitMsg(null, usageToday())
  }
  if (status === 402 || /insufficient|balance|credit/i.test(msg)) {
    return '💳 Saldo/kredit akun Aion habis.\n> Cek: https://www.aionlabs.ai/pricing/'
  }
  if (status === 401 || status === 403) {
    return '❌ API key Aion ditolak.\n> Cek `apikey` di `config.js` → blok `aiChat` (atau env `AICHAT_API_KEY`).'
  }
  if (status === 404) return '❌ Model Aion gak ketemu. Cek `aiChat.model` di `config.js`.'
  if (status === 400) return `❌ Permintaan ditolak Aion: ${msg.slice(0, 160)}`
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(msg)) return '⏱️ AI kelamaan balas. Coba lagi ya.'
  if (status >= 500) return '🛠️ Server Aion lagi error (gangguan di sisi mereka). Coba lagi nanti ya.'
  return `❌ Gagal hubungi Aion: ${msg.slice(0, 160)}`
}

/* ══════════════════════ alur chat inti ══════════════════════ */
async function runChat(ctx, text) {
  const conf = cfg()
  if (!conf.enabled) return { ok: false, reply: '❌ Fitur AI chat lagi nonaktif (config.aiChat.enabled).' }
  if (!conf.apikey) return { ok: false, reply: missingKeyMsg(conf) }
  if (!conf.baseUrl || !conf.model) {
    return { ok: false, reply: '❌ Provider AI belum lengkap (baseUrl/model kosong). Cek config.aiChat.' }
  }

  // Kuota harian udah abis? Gak usah panggil API (mubazir) — langsung kasih peringatan.
  const usedBefore = conf.dailyTokenLimit > 0 ? usageToday() : 0
  if (conf.dailyTokenLimit > 0 && usedBefore >= conf.dailyTokenLimit) {
    return { ok: false, limit: true, reply: limitMsg(conf, usedBefore) }
  }

  const key = historyKey(ctx)
  const h = getHistory(key, conf.maxHistory)
  h.at = Date.now()
  h.msgs.push({ role: 'user', content: String(text).slice(0, MAX_CHARS) })
  if (h.msgs.length > conf.maxHistory) h.msgs = h.msgs.slice(-conf.maxHistory)

  const system = conf.systemPrompt || readPersona()

  let answer
  let tokens = 0
  try {
    const res = await askModel(conf, buildSystem(ctx, system), h.msgs)
    answer = res.content
    tokens = res.tokens
  } catch (err) {
    h.msgs.pop() // pesan gagal jangan nyangkut di riwayat
    saveStore()
    logger.warn({ err: String(err?.message || err).slice(0, 200) }, '[AIChat] gagal')
    const le = isLimitErr(err)
    return { ok: false, limit: le, reply: le ? limitMsg(conf, usageToday()) : humanError(err) }
  }

  if (!answer) {
    h.msgs.pop()
    saveStore()
    return { ok: false, reply: '❌ AI gak ngasih balasan. Coba lagi ya.' }
  }

  h.msgs.push({ role: 'assistant', content: answer.slice(0, MAX_CHARS) })
  if (h.msgs.length > conf.maxHistory) h.msgs = h.msgs.slice(-conf.maxHistory)
  saveStore()

  let out = answer.slice(0, MAX_CHARS)
  // Catat token + tempel peringatan kalau kuota harian udah mepet (≥90%).
  if (conf.dailyTokenLimit > 0) {
    const total = addUsage(tokens)
    if (total >= conf.dailyTokenLimit * WARN_RATIO) {
      const left = Math.max(0, conf.dailyTokenLimit - total)
      out += `\n\n_⚠️ Kuota AI hari ini mepet — sisa ±${nfmt(left)} token. Reset otomatis besok._`
    }
  }
  return { ok: true, reply: out }
}

/* ══════════════════════ teks bantuan ══════════════════════ */
function missingKeyMsg(conf) {
  return (
    '⚠️ *API KEY AION BELUM DIISI*\n\n' +
    `Model: \`${conf.model}\`\n\n` +
    'Ambil key GRATIS (tanpa kartu kredit):\n' +
    '> 🎭 https://www.aionlabs.ai/app/api-keys/\n\n' +
    '*Cara isi (pilih salah satu):*\n' +
    '> `config.js` → blok `aiChat.apikey`\n' +
    '> env `AICHAT_API_KEY` (Pterodactyl: tab *Startup*)\n' +
    '> file `src/data/ai.json` → `{ "apikey": "..." }` (gak ikut ke GitHub)'
  )
}

function helpText(p, conf) {
  const used = conf.dailyTokenLimit > 0 ? usageToday() : 0
  const kuota = conf.dailyTokenLimit > 0
    ? `Kuota harian: *${nfmt(used)}* / ${nfmt(conf.dailyTokenLimit)} token\n`
    : ''
  return (
    '🤖 *AI CHAT — Aion Labs*\n\n' +
    `Model: \`${conf.model}\` (uncensored)\n` +
    `Aku inget riwayat obrolan kita (maks ${conf.maxHistory} pesan).\n` +
    kuota +
    '\n*Cara pakai:*\n' +
    `> ${p}bot <pertanyaan>\n` +
    `> ${p}bot reset — hapus riwayat\n` +
    (conf.mentionTrigger ? '> tag nomor aku langsung di grup\n\n' : '\n') +
    '*Contoh:*\n' +
    `> ${p}bot jelasin apa itu lubang hitam singkat`
  )
}

/* ══════════════════════ handler command `.bot` ══════════════════════ */
async function handler(ctx) {
  const conf = cfg()
  const p = ctx.prefix || '.'

  if (!conf.enabled) return ctx.reply('❌ Fitur AI chat lagi nonaktif (owner bisa nyalain di config.aiChat.enabled).')

  const text = String(ctx.text || '').trim()
  if (!text) return ctx.reply(helpText(p, conf))

  if (/^(reset|clear|hapus|lupakan|forget)$/i.test(text)) {
    resetHistory(historyKey(ctx))
    return ctx.reply('🧹 Oke, riwayat obrolan kita udah aku lupain. Mulai dari awal lagi ya!')
  }

  if (!conf.apikey) return ctx.reply(missingKeyMsg(conf))

  await ctx.react('🕕')
  const r = await runChat(ctx, text)
  await ctx.react(r.ok ? '✅' : r.limit ? '🚦' : '❎')
  return ctx.reply(r.reply)
}

/* ══════════════════════ trigger mention nomor bot ══════════════════════ */
const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2069\ufeff]/g
let botLidCache // { num, lid } — hasil resolve LID bot (kalau perlu)

function digits(s) {
  return String(s || '').replace(/\D/g, '')
}

async function botLid(ctx) {
  const num = getBotNumber()
  if (!num) return null
  if (botLidCache?.num === num) return botLidCache.lid
  try {
    const rows = await ctx.client?.profile?.getLidsByPhoneNumbers?.([num])
    const lid = (rows ?? [])[0]?.lidJid ?? null
    botLidCache = { num, lid }
    return lid
  } catch {
    botLidCache = { num, lid: null }
    return null
  }
}

async function isBotMentioned(ctx) {
  const num = getBotNumber()
  if (!num) return false
  const mentioned = Array.isArray(ctx.mentioned) ? ctx.mentioned : []
  if (mentioned.some((j) => digits(j) === num)) return true
  if (mentioned.length) {
    const lid = await botLid(ctx)
    if (lid && mentioned.includes(lid)) return true
  }
  const body = String(ctx.body || '').replace(INVISIBLE_RE, '')
  return body.includes(`@${num}`)
}

function stripMention(text, num) {
  let t = String(text || '').replace(INVISIBLE_RE, '')
  if (num) t = t.replace(new RegExp(`@${num}(?![0-9])`, 'g'), ' ')
  return t.replace(/\s+/g, ' ').trim()
}

async function onMention(ctx) {
  const conf = cfg()
  if (!conf.enabled || !conf.mentionTrigger) return false
  if (!conf.apikey) return false // jangan spam kalau key belum diisi
  if (!(await isBotMentioned(ctx))) return false

  const num = getBotNumber()
  const text = stripMention(ctx.body, num)
  if (!text) {
    await ctx.reply('Iya? Ada yang bisa aku bantu? Tulis pertanyaannya ya 😊')
    return true
  }

  // anti-spam + cooldown ringan (staff/owner bebas)
  if (!ctx.isStaff) {
    if (config.antiSpam?.enabled) {
      const f = checkFlood(ctx.sender, config.antiSpam)
      if (f.flooded) return true // diem aja, jangan nambah spam
    }
    const cd = checkCooldown(ctx.sender, 'aiMention', 4000)
    if (cd.onCooldown) return true
  }

  await ctx.react('🕕')
  const r = await runChat(ctx, text)
  await ctx.react(r.ok ? '✅' : r.limit ? '🚦' : '❎')
  await ctx.reply(r.reply)
  return true
}

loadStore()
setMentionHandler(onMention)

export { pluginConfig as config, handler }
// Buat pengujian internal (loader cuma baca `config` + `handler`).
export const _internals = {
  cfg, askModel, runChat, humanError, isLimitErr, limitMsg,
  usageToday, addUsage, USAGE_FILE, AION,
}
