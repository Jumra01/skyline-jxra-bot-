/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bot.js — Chat AI yang INGET riwayat obrolan (.bot / tag nomor bot / bales pesan).
 *
 * OTAK: **Gemini web** lewat `lib/geminiWeb.js` (pola auto-ai skyline-md).
 *   • TANPA API key & tanpa kredit — cukup internet.
 *   • Multi-turn asli: percakapan nyambung lewat `session` (resumeArray+cookie)
 *     yang disimpan per user di `data/ai-chat.json`.
 *   • Kalau session basi/rusak → otomatis ulang dari awal (riwayat teks
 *     ditempel ke prompt biar konteks gak hilang).
 *
 * PERSONA: default **Bella Clarissa (Bell409)** — lihat `lib/aiPersona.js`.
 *   Ganti kapan saja tanpa restart: `.setpersona` (file `data/ai-persona.txt`).
 *
 * MEMORI:
 *   • Jangka pendek — session Gemini + riwayat teks (`data/ai-chat.json`).
 *   • Jangka panjang — fakta penting tentang user (`lib/aiMemory.js` →
 *     `data/ai-memory.json`): pola kalimat ditangkap INSTAN (0 panggilan AI),
 *     sisanya diekstrak AI tiap `rememberEvery` pesan di belakang layar.
 *     Lihat/hapus: `.bot fakta`, `.bot inget <hal>`, `.bot reset`.
 *
 * Trigger:
 *   • command  → `.bot <pertanyaan>` (+ `.bot reset` buat hapus riwayat)
 *   • mention  → tag nomor bot (tanpa prefix), kalau mentionTrigger aktif
 *   • reply    → BALES/quote pesan bot, kalau replyTrigger aktif
 *
 * Semua pengaturan di config.js → blok `aiChat` (enabled/maxHistory/dll).
 * Pemakaian harian dicatat di `data/ai-usage.json` (buat info di `.bot`).
 */
import fs from 'node:fs'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { checkCooldown, checkFlood } from '../../core/cooldown.js'
import { getBotNumber } from '../../core/staff.js'
import { getUser } from '../../core/database.js'
import { setMentionHandler } from '../../core/mentionTrigger.js'
import { resolveLidToPn } from '../../core/lid.js'
import { readPersona, personaIsCustom } from '../../lib/aiPersona.js'
import { geminiChat } from '../../lib/geminiWeb.js'
import { extractFacts, remember, factsFor, formatBlock, forget, stats as memStats } from '../../lib/aiMemory.js'

const DATA_DIR = './data'
const STORE_FILE = `${DATA_DIR}/ai-chat.json`   // riwayat + session per nomor
const USAGE_FILE = `${DATA_DIR}/ai-usage.json`  // penghitung pemakaian harian
const MAX_TRACKED_USERS = 300 // batas jumlah user yang disimpan di disk
const MAX_CHARS = 4000        // potong pesan biar prompt gak meledak
const HISTORY_IN_PROMPT = 16  // pesan terakhir yang ditempel kalau mulai dari nol

const pluginConfig = {
  name: 'bot',
  alias: ['aichat', 'ngobrol', 'chatai'],
  category: 'ai',
  description: 'Chat AI Gemini (persona Bella) — inget riwayat obrolan',
  usage: '.bot <pertanyaan>  |  .bot reset  |  tag/bales pesan bot',
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
  return {
    enabled: c.enabled !== false,
    maxHistory: Math.max(2, Math.min(100, Number(c.maxHistory) || 20)),
    timeoutMs: Math.max(5000, Number(c.timeoutMs) || 60_000),
    mentionTrigger: c.mentionTrigger !== false,
    replyTrigger: c.replyTrigger !== false,
    remember: c.remember !== false,
    rememberEvery: Math.max(0, Math.min(50, Number(c.rememberEvery ?? 8) || 0)),
    systemPrompt: String(c.systemPrompt || '').trim(),
  }
}

/* ══════════════════════ riwayat (memori) ══════════════════════ */
const store = new Map() // jid -> { at, msgs: [{ role, content }], session, sinceExtract }
let saveTimer = null

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    for (const [k, v] of Object.entries(raw || {})) {
      if (!Array.isArray(v?.msgs)) continue
      store.set(k, {
        at: Number(v.at) || 0,
        msgs: v.msgs.slice(-100),
        session: typeof v.session === 'string' ? v.session : null,
        sinceExtract: Math.max(0, Number(v.sinceExtract) || 0),
      })
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
      for (const [k, v] of top) {
        obj[k] = {
          at: v.at,
          msgs: v.msgs.slice(-100),
          session: v.session || null,
          sinceExtract: Math.max(0, Number(v.sinceExtract) || 0),
        }
      }
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
  if (!h) { h = { at: Date.now(), msgs: [], session: null, sinceExtract: 0 }; store.set(key, h) }
  if (h.msgs.length > max) h.msgs = h.msgs.slice(-max)
  return h
}

function resetHistory(key) {
  store.delete(key)
  saveStore()
  return forget(key) // sekalian lupakan fakta tentang dia
}

/** Riwayat teks → ditempel ke prompt saat mulai percakapan baru (tanpa session). */
function flatten(msgs, pesan) {
  const lines = (Array.isArray(msgs) ? msgs : [])
    .slice(-HISTORY_IN_PROMPT)
    .map((m) => {
      const isi = String(m?.content || '').trim()
      if (!isi) return ''
      return `${m?.role === 'assistant' ? 'Kamu' : 'User'}: ${isi}`
    })
    .filter(Boolean)
  if (!lines.length) return pesan
  return `Riwayat obrolan kita sejauh ini:\n${lines.join('\n')}\n\nPesan user sekarang:\n${pesan}`
}

/* ══════════════════════ pemakaian harian ══════════════════════ */
function todayUTC() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/** Jumlah balasan AI hari ini (buat info di `.bot`). */
function usageToday() {
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
    if (u && u.day === todayUTC()) return Math.max(0, Number(u.total) || 0)
  } catch { /* belum ada → 0 */ }
  return 0
}

function addUsage(n = 1) {
  const add = Math.max(0, Number(n) || 0)
  if (!add) return usageToday()
  const total = usageToday() + add
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

function nfmt(n) {
  return Number(n || 0).toLocaleString('id-ID')
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

/** Waktu sekarang (WIB) — biar AI gak "mati" soal jam/hari/tanggal. */
function nowWIB() {
  try {
    const t = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date())
    return `${t} WIB`
  } catch {
    return `${new Date().toISOString()} UTC`
  }
}

function buildSystem(ctx, persona, botName, memory = '') {
  const u = userProfile(ctx)
  const self = botName || config.botName || 'bot ini'
  const mem = memory
    ? `\n\n${memory}\nFakta di atas itu BENAR — kamu udah tau dari obrolan sebelumnya. JANGAN\nbilang "gak tau" / "mana aku tau" / "kamu belum pernah bilang" soal hal yang\nudah tercatat di situ; pakai & sebut sewajarnya. Tapi jangan mengarang fakta\nlain di luar itu, dan jangan sebut kata "catatan".`
    : ''
  return `${persona}

[KONTEKS LAWAN BICARA — WAJIB DIBACA SEBELUM BALAS]
Kamu sekarang sedang mengobrol dengan SATU orang berikut:
  • Nama  : ${u.name}
  • Nomor : ${u.number}
  • Peran : ${u.role}
  • Ruang : ${ctx.isGroup ? 'grup WhatsApp' : 'chat pribadi'}
  • Waktu : ${nowWIB()}${mem}

Aturan identitas (jangan dilanggar):
- Nama di atas adalah nama ORANG YANG MENGAJAKMU NGOMONG — BUKAN namamu.
- Nama AKUN bot ini "${self}". Tapi soal siapa dirimu & gaya bicara, tetap
  ikuti persona di atas (jangan menyebut diri sebagai AI/bot).
- Kalau dia tanya "siapa aku / siapa nama saya / kamu tau aku siapa", jawab
  pakai data di atas (nama + peran), jangan ngarang nama lain.
- Sapa dia dengan namanya sesekali biar kerasa personal.
- Kalau dia nanya jam/hari/tanggal, jawab pakai baris *Waktu* di atas (jangan ngarang).
- Balas pakai bahasa yang dia pakai (Indonesia → Indonesia, Inggris → Inggris).`
}

/* ══════════════════════ memori jangka panjang ══════════════════════ */
const EXTRACT_KEYS = 'nama|suka|gak suka|umur|tinggal|kerja|sekolah|ultah|punya|hobi|catatan'

/** Baca JSON array fakta dari balasan AI (tahan teks nyasar di sekelilingnya). */
function parseFactsJson(text) {
  const m = String(text || '').match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x) => x && typeof x.v === 'string' && x.v.trim().length >= 2)
      .slice(0, 5)
      .map((x) => ({
        k: (typeof x.k === 'string' ? x.k.trim().toLowerCase() : 'catatan').slice(0, 20) || 'catatan',
        v: x.v.trim().slice(0, 160),
      }))
  } catch {
    return []
  }
}

const extracting = new Set()

/**
 * Ekstraksi fakta pakai AI — jalan DI BELAKANG LAYAR (gak nungguin balasan user),
 * cuma tiap `rememberEvery` pesan, dan cuma 1 proses per user sekaligus.
 * Ini yang nangkep fakta yang gak ketangkep pola kalimat.
 */
async function llmRemember(ctx, conf, key, msgs) {
  if (extracting.has(key)) return
  extracting.add(key)
  try {
    const convo = msgs
      .slice(-8)
      .map((m) => `${m.role === 'assistant' ? 'Kamu' : 'User'}: ${String(m.content || '').slice(0, 300)}`)
      .join('\n')
    const prompt =
      'Ambil FAKTA PENTING tentang USER (bukan tentang AI/asisten) dari percakapan ini.\n' +
      `Jawab HANYA JSON array (tanpa penjelasan), maksimal 5 item, format: [{"k":"${EXTRACT_KEYS}","v":"..."}]\n` +
      'Fakta yang layak: identitas, kegemaran, pekerjaan/sekolah, tanggal penting, kondisi, kebiasaan, janji.\n' +
      'JANGAN ambil hal yang cuma sekali/umum (mis. "user bertanya apa itu lubang hitam").\n' +
      'Kalau tidak ada yang layak, jawab [].\n\n' +
      `Percakapan:\n${convo}`
    const res = await geminiChat({
      message: prompt,
      instruction: 'Kamu alat ekstraksi fakta. Balas HANYA JSON array valid, tanpa teks lain.',
      timeoutMs: Math.min(conf.timeoutMs, 45_000),
    })
    const found = parseFactsJson(res?.text)
    if (found.length) {
      const r = remember(key, found)
      logger.debug({ added: r.added, updated: r.updated }, '[AIChat] memori AI diperbarui')
    }
  } catch (err) {
    logger.debug({ err: String(err?.message || err).slice(0, 120) }, '[AIChat] ekstraksi memori AI dilewati')
  } finally {
    extracting.delete(key)
  }
}

/* ══════════════════════ error ramah ══════════════════════ */
function limitMsg() {
  return (
    '🚦 *FITUR AI SEDANG LIMIT*\n\n' +
    'Gemini lagi nolak permintaan (kebanyakan request / rate limit).\n' +
    `> Terpakai hari ini: *${nfmt(usageToday())}* balasan\n\n` +
    '*Coba lagi beberapa menit* ya — biasanya pulih sendiri. Kalau masih nolak, ' +
    'tunggu agak lama (Google sering batasi akses tanpa login).'
  )
}

function isLimitErr(err) {
  const status = err?.status
  const msg = String(err?.message || err)
  return status === 429 || /rate.?limit|too many requests|quota|limité|limit exceeded/i.test(msg)
}

function humanError(err) {
  const status = err?.status
  const msg = String(err?.message || err)
  if (isLimitErr(err)) return limitMsg()
  if (err?.parse || /gak bisa dibaca|gak ngasih cookie|format web/i.test(msg)) {
    return (
      '🔧 Balasan Gemini gak bisa dibaca — kemungkinan Google baru ngubah web-nya.\n' +
      '> Coba lagi sebentar. Kalau tetap, lapor owner biar scraper-nya di-update.'
    )
  }
  if (status === 403 || status === 401) {
    return '🔒 Gemini nolak akses dari server ini (butuh login/verifikasi). Coba lagi nanti ya.'
  }
  if (status >= 500) return '🛠️ Server Gemini lagi error. Coba lagi nanti ya.'
  if (/timeout|ECONNABORTED|ETIMEDOUT|socket hang up/i.test(msg)) {
    return '⏱️ Gemini kelamaan balas. Coba lagi ya (kadang kalau pertanyaannya berat).'
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network/i.test(msg)) {
    return '🌐 Gak bisa nyambung ke Gemini (internet/DNS server lagi ngadat). Coba lagi ya.'
  }
  return `❌ Gagal hubungi Gemini: ${msg.slice(0, 160)}`
}

/* ══════════════════════ alur chat inti ══════════════════════ */
function gagal(err, conf) {
  logger.warn({
    err: String(err?.message || err).slice(0, 200),
    status: err?.status ?? null,
  }, '[AIChat] gagal')
  const le = isLimitErr(err)
  return { ok: false, limit: le, reply: le ? limitMsg() : humanError(err) }
}

async function runChat(ctx, text) {
  const conf = cfg()
  if (!conf.enabled) return { ok: false, reply: '❌ Fitur AI chat lagi nonaktif (config.aiChat.enabled).' }

  const key = historyKey(ctx)
  const h = getHistory(key, conf.maxHistory)
  h.at = Date.now()

  const pesan = String(text).slice(0, MAX_CHARS)
  // Memori jangka panjang: pola kalimat dulu (instan, gratis) — biar fakta yang
  // baru disebut LANGSUNG kepakai di balasan ini juga, bukan nunggu nanti.
  if (conf.remember) {
    const pola = extractFacts(pesan)
    if (pola.length) {
      const r = remember(key, pola)
      if (r.added || r.updated) logger.debug({ key, pola: pola.map((f) => f.k) }, '[AIChat] fakta dicatat')
    }
  }
  const system = conf.systemPrompt || readPersona()
  const instruction = buildSystem(ctx, system, null, conf.remember ? formatBlock(key) : '')
  // Kalau udah ada session, Gemini inget sendiri konteksnya (cukup kirim pesan baru).
  // Kalau belum/gagal, riwayat teks ditempel biar obrolan tetap nyambung.
  const withHistory = flatten(h.msgs, pesan)

  let res
  try {
    res = await geminiChat({
      message: h.session ? pesan : withHistory,
      instruction,
      session: h.session,
      timeoutMs: conf.timeoutMs,
    })
  } catch (err) {
    // session lama basi/rusak → ulang SEKALI dari awal (tanpa session)
    if (h.session) {
      logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[AIChat] session lama gagal — ulang tanpa session')
      h.session = null
      try {
        res = await geminiChat({ message: withHistory, instruction, timeoutMs: conf.timeoutMs })
      } catch (err2) {
        saveStore()
        return gagal(err2, conf)
      }
    } else {
      return gagal(err, conf)
    }
  }

  const answer = String(res?.text || '').trim()
  if (!answer) return { ok: false, reply: '❌ AI gak ngasih balasan. Coba lagi ya.' }

  h.msgs.push({ role: 'user', content: pesan })
  h.msgs.push({ role: 'assistant', content: answer.slice(0, MAX_CHARS) })
  if (h.msgs.length > conf.maxHistory) h.msgs = h.msgs.slice(-conf.maxHistory)
  if (res?.session) h.session = res.session
  h.sinceExtract = Math.max(0, Number(h.sinceExtract) || 0) + 1
  saveStore()
  addUsage(1)

  // Cadangan: ekstraksi fakta pakai AI tiap `rememberEvery` pesan — di belakang
  // layar (gak nambah delay balasan), cuma 1 proses per user sekaligus.
  if (conf.remember && conf.rememberEvery > 0 && h.sinceExtract >= conf.rememberEvery) {
    h.sinceExtract = 0
    void llmRemember(ctx, conf, key, h.msgs)
  }

  return { ok: true, reply: answer.slice(0, MAX_CHARS) }
}

/* ══════════════════════ teks bantuan ══════════════════════ */
function helpText(p, conf) {
  const persona = personaIsCustom() ? 'custom (`data/ai-persona.txt`)' : 'Bella Clarissa (default)'
  const mem = conf.remember ? 'Aku juga *nyatet hal penting* tentang kamu (nama, kesukaan, dll) biar gak lupa.\n' : ''
  return (
    '🤖 *AI CHAT — Gemini*\n\n' +
    `Otak: *Gemini* (lewat web, tanpa API key)\n` +
    `Persona: ${persona}\n` +
    `Aku inget riwayat obrolan kita (maks ${conf.maxHistory} pesan).\n` +
    mem +
    `Pemakaian hari ini: *${nfmt(usageToday())}* balasan\n\n` +
    '*Cara pakai:*\n' +
    `> ${p}bot <pertanyaan>\n` +
    (conf.remember ? `> ${p}bot fakta — lihat catatan tentang kamu\n` : '') +
    (conf.remember ? `> ${p}bot inget <hal penting> — suruh aku nyatet\n` : '') +
    `> ${p}bot reset — hapus riwayat${conf.remember ? ' + catatan' : ''}, mulai dari awal\n` +
    (conf.mentionTrigger ? '> tag nomor aku langsung (tanpa prefix)\n' : '') +
    (conf.mentionTrigger && conf.replyTrigger ? '> atau BALES/quote pesan-ku\n' : '') +
    '\n*Contoh:*\n' +
    `> ${p}bot jelasin apa itu lubang hitam singkat`
  )
}

/** Kartu daftar fakta yang dicatat tentang user. */
function faktaText(key, p) {
  const facts = factsFor(key)
  if (!facts.length) {
    return (
      '🧠 *CATATAN TENTANG KAMU*\n\n' +
      'Masih kosong — aku belum nangkep hal penting apa pun.\n' +
      `> Kasih tau aja, mis. \`${p}bot inget aku suka kopi hitam\``
    )
  }
  const lines = facts.map((f, i) => `${i + 1}. *${f.k}*: ${f.v}`)
  return (
    '🧠 *CATATAN TENTANG KAMU*\n\n' +
    `${lines.join('\n')}\n\n` +
    `_Yang ini kesimpan permanen (gak kehapus walau obrolan panjang)._\n` +
    `> Hapus semua: \`${p}bot reset\``
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
    return ctx.reply(
      '🧹 Oke, riwayat obrolan kita udah aku lupain' +
      (conf.remember ? ' — termasuk catatan tentang kamu' : '') +
      '. Mulai dari awal lagi ya!'
    )
  }

  if (conf.remember && /^(fakta|memori|ingatan|catatan)$/i.test(text)) {
    return ctx.reply(faktaText(historyKey(ctx), p))
  }

  if (conf.remember) {
    const m = text.match(/^(?:inget|ingat|catat|catet|note)\s+([\s\S]{2,200})$/i)
    if (m) {
      const v = m[1].trim()
      remember(historyKey(ctx), { k: 'catatan', v })
      return ctx.reply(`🧠 Siap, aku catet: *${v}*\n> Lihat semua catatan: \`${p}bot fakta\``)
    }
  }

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

/** Semua bentuk identitas bot: nomor + jid (PN/LID) yang kita tau. */
function botIdentity(ctx) {
  const num = getBotNumber()
  let meJid = null
  try { meJid = ctx?.client?.auth?.getCurrentCredentials?.()?.meJid ?? null } catch { /* ignore */ }
  const userId = ctx?.client?.user?.id ?? ctx?.client?.user?.lid ?? null
  const jids = [num ? `${num}@s.whatsapp.net` : null, meJid, userId].filter(Boolean)
  return { num, jids }
}

async function botLid(ctx) {
  const { num } = botIdentity(ctx)
  if (!num) return null
  // cache cuma kalau ketemu — kalau gagal, biar bisa dicoba lagi kapan-kapan
  if (botLidCache?.num === num && botLidCache.lid) return botLidCache.lid
  try {
    const rows = await ctx.client?.profile?.getLidsByPhoneNumbers?.([num])
    const lid = (rows ?? [])[0]?.lidJid ?? (rows ?? [])[0]?.lid ?? null
    if (lid) botLidCache = { num, lid }
    return lid
  } catch {
    return null
  }
}

/** Kumpulin mentionedJid dari SEMUA jenis pesan (teks, caption gambar/video, dll). */
function mentionedJids(ctx) {
  const out = new Set(Array.isArray(ctx?.mentioned) ? ctx.mentioned : [])
  const msg = ctx?.event?.message || {}
  for (const v of Object.values(msg)) {
    const list = v?.contextInfo?.mentionedJid
    if (Array.isArray(list)) for (const j of list) out.add(j)
  }
  return [...out].filter(Boolean)
}

/** Pengirim pesan yang di-quote (swipe-reply) — buat deteksi "bales pesan bot". */
function quotedParticipant(ctx) {
  const msg = ctx?.event?.message || {}
  for (const v of Object.values(msg)) {
    const c = v?.contextInfo
    if (!c) continue
    const p = c.participant ?? c.participantAlt ?? c.remoteJid
    if (p) return p
  }
  return null
}

/** `jid` ini bot sendiri? (cocok lewat nomor, jid, LID, atau LID→PN) */
async function isBotJid(ctx, jid) {
  if (!jid) return false
  const { num, jids } = botIdentity(ctx)
  if (num && digits(jid) === num) return true
  if (jids.includes(jid)) return true
  const lid = await botLid(ctx)
  if (lid && jid === lid) return true
  if (String(jid).endsWith('@lid')) {
    const pn = await resolveLidToPn(ctx.client, ctx.chat, jid)
    if (pn) {
      if (num && digits(pn) === num) return true
      if (jids.includes(pn)) return true
    }
  }
  return false
}

/**
 * Bot "diajak ngobrol"? = di-TAG (PN/LID/teks @nomor) ATAU dibales
 * (quote pesan bot, kalau `replyTrigger` gak dimatiin) → dua-duanya manggil AI.
 */
async function isBotMentioned(ctx, conf) {
  const { num } = botIdentity(ctx)
  for (const j of mentionedJids(ctx)) {
    if (await isBotJid(ctx, j)) return true
  }
  const body = String(ctx.body || '').replace(INVISIBLE_RE, '')
  if (num && new RegExp(`@${num}(?![0-9])`).test(body)) return true
  if (conf?.replyTrigger !== false && (await isBotJid(ctx, quotedParticipant(ctx)))) return true
  return false
}

function stripMention(text, num) {
  let t = String(text || '').replace(INVISIBLE_RE, '')
  if (num) t = t.replace(new RegExp(`@${num}(?![0-9])`, 'g'), ' ')
  return t.replace(/\s+/g, ' ').trim()
}

async function onMention(ctx) {
  const conf = cfg()
  if (!conf.enabled || !conf.mentionTrigger) return false
  if (!(await isBotMentioned(ctx, conf))) return false

  const num = getBotNumber()
  const text = stripMention(ctx.body, num)
  if (!text) {
    const u = userProfile(ctx)
    const siapa = u.name && u.name !== 'Tanpa Nama' ? ` ${u.name}` : ''
    await ctx.reply(`Halo${siapa}! 👋 Ada yang bisa aku bantu? Tag aku bareng pertanyaannya ya 😊`)
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
  cfg, runChat, humanError, isLimitErr, limitMsg,
  usageToday, addUsage, USAGE_FILE, STORE_FILE, buildSystem, userProfile, nowWIB,
  isBotMentioned, mentionedJids, quotedParticipant, stripMention, flatten,
  resetHistory, store, llmRemember, parseFactsJson, faktaText, helpText,
}
