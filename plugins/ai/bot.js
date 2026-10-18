/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bot.js — Chat AI yang INGET riwayat obrolan (.bot / tag nomor bot).
 *
 * Provider OpenAI-compatible (atur di config.js → blok `aiChat`):
 *   gemini | groq | openrouter | deepseek | custom
 * Yang gratis (tanpa kartu): Gemini, Groq, OpenRouter (model ":free").
 *
 * Trigger:
 *   • command  → `.bot <pertanyaan>` (+ `.bot reset` buat hapus riwayat)
 *   • mention  → tag nomor bot di grup (tanpa prefix), kalau mentionTrigger aktif
 *
 * Persona/prompt: file `data/ai-persona.txt` (ganti via `.setpersona`).
 * Riwayat: disimpan di `data/ai-chat.json` (per nomor), dibatasi maxHistory.
 */
import axios from 'axios'
import fs from 'node:fs'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { checkCooldown, checkFlood } from '../../core/cooldown.js'
import { getBotNumber } from '../../core/staff.js'
import { getUser } from '../../core/database.js'
import { setMentionHandler } from '../../core/mentionTrigger.js'
import { readPersona } from '../../lib/aiPersona.js'

const DATA_DIR = './data'
const STORE_FILE = `${DATA_DIR}/ai-chat.json`
const MAX_TRACKED_USERS = 300   // batas jumlah user yang disimpan di disk
const MAX_CHARS = 4000          // potong pesan biar prompt gak meledak

// Preset provider OpenAI-compatible. `model` bisa diganti di config.
const PROVIDERS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash', // alternatif: gemini-2.5-flash-lite, gemini-2.5-pro
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile', // alternatif: openai/gpt-oss-120b, qwen/qwen3-32b
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free', // alternatif: nvidia/nemotron-3-ultra:free, google/gemma-4-31b-it:free
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat', // alternatif: deepseek-reasoner
  },
  custom: { baseUrl: '', model: '' },
}

const pluginConfig = {
  name: 'bot',
  alias: ['aichat', 'ngobrol', 'chatai'],
  category: 'ai',
  description: 'Chat AI (Gemini/Groq/DeepSeek/OpenRouter) — inget riwayat obrolan',
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
function cfg() {
  const c = config.aiChat || {}
  const provider = String(c.provider || 'gemini').toLowerCase()
  const preset = PROVIDERS[provider] || PROVIDERS.custom
  return {
    enabled: c.enabled !== false,
    provider,
    baseUrl: String(c.baseUrl || preset.baseUrl || '').replace(/\/+$/, ''),
    model: String(c.model || preset.model || '').trim(),
    apikey: String(process.env.AICHAT_API_KEY || c.apikey || '').trim(),
    maxHistory: Math.max(2, Math.min(100, Number(c.maxHistory) || 20)),
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
  return typeof content === 'string' ? content.trim() : ''
}

function humanError(err) {
  const status = err?.status
  const msg = String(err?.message || err)
  if (status === 401 || status === 403) return '❌ API key ditolak. Cek lagi apikey & provider di config.aiChat.'
  if (status === 429) return '🐢 Kena batas (rate limit) provider. Tunggu sebentar, lalu coba lagi ya.'
  if (status === 404) return '❌ Model/endpoint gak ketemu. Cek `aiChat.model` & `aiChat.provider`.'
  if (status === 400) return `❌ Permintaan ditolak provider: ${msg.slice(0, 160)}`
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(msg)) return '⏱️ AI kelamaan balas. Coba lagi ya.'
  return `❌ Gagal hubungi AI: ${msg.slice(0, 160)}`
}

/* ══════════════════════ alur chat inti ══════════════════════ */
async function runChat(ctx, text) {
  const conf = cfg()
  if (!conf.enabled) return { ok: false, reply: '❌ Fitur AI chat lagi nonaktif (config.aiChat.enabled).' }
  if (!conf.apikey) return { ok: false, reply: missingKeyMsg(conf) }
  if (!conf.baseUrl || !conf.model) {
    return { ok: false, reply: '❌ Provider AI belum lengkap (baseUrl/model kosong). Cek config.aiChat.' }
  }

  const key = historyKey(ctx)
  const h = getHistory(key, conf.maxHistory)
  h.at = Date.now()
  h.msgs.push({ role: 'user', content: String(text).slice(0, MAX_CHARS) })
  if (h.msgs.length > conf.maxHistory) h.msgs = h.msgs.slice(-conf.maxHistory)

  const system = conf.systemPrompt || readPersona()

  let answer
  try {
    answer = await askModel(conf, buildSystem(ctx, system), h.msgs)
  } catch (err) {
    h.msgs.pop() // pesan gagal jangan nyangkut di riwayat
    saveStore()
    logger.warn({ err: String(err?.message || err).slice(0, 200) }, '[AIChat] gagal')
    return { ok: false, reply: humanError(err) }
  }

  if (!answer) {
    h.msgs.pop()
    saveStore()
    return { ok: false, reply: '❌ AI gak ngasih balasan. Coba lagi ya.' }
  }

  h.msgs.push({ role: 'assistant', content: answer.slice(0, MAX_CHARS) })
  if (h.msgs.length > conf.maxHistory) h.msgs = h.msgs.slice(-conf.maxHistory)
  saveStore()
  return { ok: true, reply: answer.slice(0, MAX_CHARS) }
}

/* ══════════════════════ teks bantuan ══════════════════════ */
function missingKeyMsg(conf) {
  return (
    '⚠️ *API KEY AI BELUM DIISI*\n\n' +
    `Provider aktif: *${conf.provider}*${conf.model ? ` (${conf.model})` : ''}\n\n` +
    'Ambil key GRATIS (tanpa kartu kredit):\n' +
    '> 🔹 Gemini — https://aistudio.google.com/apikey\n' +
    '> 🔹 Groq — https://console.groq.com/keys\n' +
    '> 🔹 OpenRouter — https://openrouter.ai/keys\n\n' +
    '*Cara isi:*\n' +
    '> `config.js` → blok `aiChat.apikey`\n' +
    '> atau set env `AICHAT_API_KEY`'
  )
}

function helpText(p, conf) {
  return (
    '🤖 *AI CHAT*\n\n' +
    `Provider: *${conf.provider}*${conf.model ? ` · ${conf.model}` : ''}\n` +
    `Aku inget riwayat obrolan kita (maks ${conf.maxHistory} pesan).\n\n` +
    '*Cara pakai:*\n' +
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
  await ctx.react(r.ok ? '✅' : '❎')
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
  await ctx.react(r.ok ? '✅' : '❎')
  await ctx.reply(r.reply)
  return true
}

loadStore()
setMentionHandler(onMention)

export { pluginConfig as config, handler }
