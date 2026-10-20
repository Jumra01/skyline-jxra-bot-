/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bot.js — Chat AI yang INGET riwayat obrolan (.bot / tag nomor bot / bales pesan).
 *
 * OTAK: **Gemini web** lewat `lib/geminiWeb.js` — tanpa API key & tanpa kredit.
 *   • TANPA API key & tanpa kredit — cukup internet.
 *   • Multi-turn asli: percakapan nyambung lewat `session` (resumeArray+cookie)
 *     yang disimpan per user di `data/ai-chat.json`.
 *   • Kalau session basi/rusak → otomatis ulang dari awal (riwayat teks
 *     ditempel ke prompt biar konteks gak hilang).
 *
 * PERSONA: default **Bella Clarissa (Bell409)** — lihat `lib/aiPersona.js`.
 *   Ganti kapan saja tanpa restart: `.setpersona` (file `data/ai-persona.txt`).
 *
 * AUTO AI (`.autoai`): nyalain/matiin + pilih karakter per grup
 *   (lihat `lib/autoai.js` + `plugins/group/autoai.js`). Kalau grup di-set,
 *   tag/bales di grup itu pakai persona+mode grup; kalau dimatiin → bot diem.
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
import sharp from 'sharp'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { checkCooldown, checkFlood } from '../../core/cooldown.js'
import { getBotNumber } from '../../core/staff.js'
import { getUser } from '../../core/database.js'
import { setMentionHandler } from '../../core/mentionTrigger.js'
import { resolveLidToPn } from '../../core/lid.js'
import { unwrapMessage } from '../../core/context.js'
import { sendTyping } from '../../core/presence.js'
import { readPersona, personaIsCustom } from '../../lib/aiPersona.js'
import { geminiChat, SUPPORTS_IMAGES } from '../../lib/geminiWeb.js'
import { readImage, visionContext } from '../../lib/visionFallback.js'
import { resolveAutoAI } from '../../lib/autoai.js'
import { kindOf, getGlobalKind } from '../../lib/aiScope.js'
import { getSetting } from '../../core/groupSettings.js'
import { extractFacts, remember, factsFor, formatBlock, forget, stats as memStats } from '../../lib/aiMemory.js'

const DATA_DIR = './data'
const STORE_FILE = `${DATA_DIR}/ai-chat.json`   // riwayat + session per nomor
const USAGE_FILE = `${DATA_DIR}/ai-usage.json`  // penghitung pemakaian harian
const MAX_TRACKED_USERS = 300 // batas jumlah user yang disimpan di disk
const MAX_CHARS = 4000        // potong pesan biar prompt gak meledak
const HISTORY_IN_PROMPT = 16  // pesan terakhir yang ditempel kalau mulai dari nol

// Foto/stiker buat "dilihat" Gemini: dikompres dulu biar upload + jawab cepat.
const VISION_MAX_BYTES = 6 * 1024 * 1024 // foto asli di atas ini dilewati
const VISION_MAX_DIM = 1024              // sisi terpanjang setelah resize
const VISION_DOWNLOAD_MS = 12_000        // batas unduh media dari WhatsApp
const IMG_FIELDS = ['imageMessage', 'stickerMessage', 'documentMessage']
// Balasan "error" bawaan Gemini web (bukan jawaban beneran) — kalau ini muncul
// padahal ada gambar, berarti servernya nolak (bukan berarti gambarnya salah).
const CANNED_ERR_RE = /(sorry,?\s*something went wrong|something went wrong|encountered an error|error doing what you asked|could you try again|an error occurred|please try again|try again later|terjadi kesalahan|gagal memproses|maaf,?\s*terjadi)/i

// Sesi anonim Gemini (cookie) umurnya pendek — kalau dipakai setelah nganggur,
// Google balikin balasan yang gak bisa di-parse → dulu tiap begitu buang 1
// request + nulis WARN. Sekarang: sesi yang kelewat tua dilewati duluan, dan
// kalau sesi tetap gagal beberapa kali beruntun, sesi dimatiin sementara.
const SESSION_FAIL_LIMIT = 3            // gagal beruntun sebelum sesi dimatiin
const SESSION_SKIP_MS = 10 * 60_000     // lama sesi dimatiin saat itu
let sessionFailStreak = 0
let sessionSkipUntil = 0

const pluginConfig = {
  name: 'bot',
  alias: ['aichat', 'ngobrol', 'chatai'],
  category: 'ai',
  description: 'Chat AI Gemini (persona Bella) — inget riwayat, bisa lihat foto/stiker',
  usage: '.bot <pertanyaan>  |  .bot reset  |  tag/bales pesan bot  |  kirim/tag foto',
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
    privateAuto: c.privateAuto !== false,
    vision: c.vision !== false,
    visionFallback: c.visionFallback !== false,
    remember: c.remember !== false,
    rememberEvery: Math.max(0, Math.min(50, Number(c.rememberEvery ?? 8) || 0)),
    sessionTtlMin: Math.max(0, Math.min(720, c.sessionTtlMin === 0 ? 0 : (Number(c.sessionTtlMin) || 20))),
    systemPrompt: String(c.systemPrompt || '').trim(),
  }
}

/* ══════════════════════ riwayat (memori) ══════════════════════ */
const store = new Map() // jid -> { at, msgs, session, sessionAt, sinceExtract }
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
        sessionAt: Number(v.sessionAt) || 0,
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
          sessionAt: Number(v.sessionAt) || 0,
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
  if (!h) { h = { at: Date.now(), msgs: [], session: null, sessionAt: 0, sinceExtract: 0 }; store.set(key, h) }
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

function buildSystem(ctx, persona, botName, memory = '', mode = 'onlychat') {
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
- Balas pakai bahasa yang dia pakai (Indonesia → Indonesia, Inggris → Inggris).
${mode === 'assistant'
  ? '- Mode: ASISTEN — kalau ditanya hal serius (penjelasan, hitung, materi, saran) jawab lebih rapi & informatif; tetap ramah, boleh menyapa namanya.'
  : '- Mode: OBROLAN SANTAI — jawab singkat & santai seperti chat biasa, jangan sok menggurui.'}`
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

async function runChat(ctx, text, opts = {}) {
  const conf = cfg()
  if (!conf.enabled) return { ok: false, reply: '❌ Fitur AI chat lagi nonaktif (config.aiChat.enabled).' }

  const key = historyKey(ctx)
  const h = getHistory(key, conf.maxHistory)
  h.at = Date.now()

  const pesan = String(text).slice(0, MAX_CHARS)
  const images = Array.isArray(opts.images) ? opts.images.filter((i) => i?.buffer?.length) : []
  // Memori jangka panjang: pola kalimat dulu (instan, gratis) — biar fakta yang
  // baru disebut LANGSUNG kepakai di balasan ini juga, bukan nunggu nanti.
  if (conf.remember) {
    const pola = extractFacts(pesan)
    if (pola.length) {
      const r = remember(key, pola)
      if (r.added || r.updated) logger.debug({ key, pola: pola.map((f) => f.k) }, '[AIChat] fakta dicatat')
    }
  }
  const system = opts.persona || conf.systemPrompt || readPersona()
  const instruction = buildSystem(ctx, system, null, conf.remember ? formatBlock(key) : '', opts.mode || 'onlychat')
  // Kalau udah ada session, Gemini inget sendiri konteksnya (cukup kirim pesan baru).
  // Kalau belum/gagal, riwayat teks ditempel biar obrolan tetap nyambung.
  const withHistory = flatten(h.msgs, pesan)

  // Sesi tua (cookie Gemini umurnya pendek) atau sesi yang lagi dimatiin karena
  // sering gagal → skip duluan, langsung pakai riwayat teks. Hemat 1 request
  // gagal & log gak berisik.
  if (h.session && conf.sessionTtlMin > 0 && h.sessionAt && Date.now() - h.sessionAt > conf.sessionTtlMin * 60_000) {
    logger.debug({ umurMenit: Math.round((Date.now() - h.sessionAt) / 60_000) }, '[AIChat] sesi Gemini udah tua — dilewati, lanjut tanpa sesi')
    h.session = null
    h.sessionAt = 0
  }
  if (h.session && Date.now() < sessionSkipUntil) {
    h.session = null
    h.sessionAt = 0
  }

  // Giliran BERGAMBAR selalu mulai dari percakapan baru (tanpa sesi lama):
  // sesi lama (apalagi yang dibuat sebelum fitur gambar ada) bikin Gemini
  // balikin pesan error "Sorry, something went wrong." padahal file-nya udah
  // terunggah. Konteks obrolan tetap kebawa lewat `withHistory`.
  if (images.length && h.session) {
    h.session = null
    h.sessionAt = 0
  }

  const usedSession = Boolean(h.session)
  let res
  try {
    res = await geminiChat({
      message: usedSession ? pesan : withHistory,
      instruction,
      session: h.session,
      timeoutMs: conf.timeoutMs,
      images,
    })
    if (usedSession) sessionFailStreak = 0
  } catch (err) {
    // sesi lama basi/rusak → ulang SEKALI dari awal (tanpa sesi)
    if (h.session) {
      h.session = null
      h.sessionAt = 0
      sessionFailStreak += 1
      if (sessionFailStreak >= SESSION_FAIL_LIMIT) {
        sessionSkipUntil = Date.now() + SESSION_SKIP_MS
        logger.warn({ gagalBeruntun: sessionFailStreak, matiSelamaMenit: SESSION_SKIP_MS / 60_000 }, '[AIChat] sesi Gemini sering gagal — sesi dimatiin sementara (auto-nyala lagi)')
      } else {
        logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[AIChat] sesi Gemini kadaluwarsa — lanjut tanpa sesi (obrolan tetap nyambung dari riwayat)')
      }
      try {
        res = await geminiChat({ message: withHistory, instruction, timeoutMs: conf.timeoutMs, images })
      } catch (err2) {
        saveStore()
        return gagal(err2, conf)
      }
    } else {
      return gagal(err, conf)
    }
  }

  let answer = String(res?.text || '').trim()
  // Kalau jawabannya pesan error bawaan Gemini padahal ada gambar → coba sekali
  // lagi dari percakapan benar-benar baru (kadang sesi anonimnya yang lagi kurang
  // beruntung). Gagal lagi → jangan teruskan pesan error-nya ke user.
  if (answer && images.length && CANNED_ERR_RE.test(answer)) {
    logger.warn({ jawaban: answer.slice(0, 120) }, '[AIChat] Gemini balikin pesan error — coba ulang percakapan baru')
    try {
      const ulang = await geminiChat({ message: withHistory, instruction, timeoutMs: conf.timeoutMs, images })
      const ans2 = String(ulang?.text || '').trim()
      if (ans2 && !CANNED_ERR_RE.test(ans2)) {
        res = ulang
        answer = ans2
      }
    } catch (err) {
      logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[AIChat] ulangan tanpa sesi gagal')
    }
  }
  if (images.length && CANNED_ERR_RE.test(answer)) {
    // Jalur cadangan: server Gemini nolak FILE-nya, tapi teks masih jalan.
    // Gambar dibaca lewat OCR + deskripsi otomatis, lalu model tetap Gemini.
    if (conf.visionFallback) {
      try {
        const baca = await readImage(images[0].buffer)
        if (baca.ada) {
          logger.info(
            { ocr: baca.teks ? baca.teks.length : 0, deskripsi: baca.deskripsi ? baca.deskripsi.length : 0 },
            '[AIChat] Gemini nolak file — gambar dibaca lewat jalur cadangan (OCR + deskripsi)'
          )
          const ulang3 = await geminiChat({
            message: `${withHistory}\n\n${visionContext(baca)}`,
            instruction,
            timeoutMs: conf.timeoutMs,
          })
          const ans3 = String(ulang3?.text || '').trim()
          if (ans3 && !CANNED_ERR_RE.test(ans3)) {
            res = ulang3
            answer = ans3
          }
        }
      } catch (err) {
        logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[AIChat] jalur cadangan gambar gagal')
      }
    }
  }
  if (images.length && CANNED_ERR_RE.test(answer)) {
    saveStore()
    return {
      ok: false,
      reply:
        '🖼️ *Gemini lagi gak bisa buka gambarnya* 😅\n' +
        '> Coba kirim ulang gambarnya, atau tulis pertanyaannya aja dulu (tanpa foto).',
    }
  }
  if (!answer) return { ok: false, reply: '❌ AI gak ngasih balasan. Coba lagi ya.' }

  h.msgs.push({ role: 'user', content: pesan })
  h.msgs.push({ role: 'assistant', content: answer.slice(0, MAX_CHARS) })
  if (h.msgs.length > conf.maxHistory) h.msgs = h.msgs.slice(-conf.maxHistory)
  // Sesi hasil giliran BERGAMBAR gak bisa dipakai lagi: turn berikutnya balikin
  // balasan yang gak kebaca (sudah dites: teks→gambar jalan, gambar→apa pun
  // gagal). Jadi sesi dibuang, konteks tetap nyambung lewat riwayat teks.
  if (images.length) {
    h.session = null
    h.sessionAt = 0
  } else if (res?.session) {
    h.session = res.session
    h.sessionAt = Date.now()
  }
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
    (conf.vision ? 'Aku juga *bisa lihat foto & stiker* yang kamu kirim/bales.\n' : '') +
    mem +
    `Pemakaian hari ini: *${nfmt(usageToday())}* balasan\n\n` +
    '*Cara pakai:*\n' +
    `> ${p}bot <pertanyaan>\n` +
    (conf.remember ? `> ${p}bot fakta — lihat catatan tentang kamu\n` : '') +
    (conf.remember ? `> ${p}bot inget <hal penting> — suruh aku nyatet\n` : '') +
    `> ${p}bot reset — hapus riwayat${conf.remember ? ' + catatan' : ''}, mulai dari awal\n` +
    (conf.mentionTrigger ? '> tag nomor aku langsung (tanpa prefix)\n' : '') +
    (conf.mentionTrigger && conf.replyTrigger ? '> atau BALES/quote pesan-ku\n' : '') +
    (conf.privateAuto ? '> di chat pribadi tinggal kirim pesan biasa, aku balas\n' : '') +
    (conf.vision ? '> kirim/tag foto atau stiker — aku lihat lalu jawab\n' : '') +
    `> ${p}autoai on/off — atur Auto AI per grup (admin)\n` +
    `> ${p}bot diag — cek kenapa tag/bales gak dibalas (owner/staff)\n` +
    `> ${p}bot tes — tes koneksi AI teks & gambar (owner/staff)\n` +
    '\n*Contoh:*\n' +
    `> ${p}bot jelasin apa itu lubang hitam singkat\n` +
    (conf.vision ? `> tag aku + kirim foto: "ini gambar apa?"` : '')
  )
}

/** `.bot tes` — cek jalur teks & gambar ke Gemini langkah demi langkah (owner/staff). */
async function selfTestText(conf) {
  const durasi = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
  const baris = []
  const jalan = async (label, fn) => {
    const t0 = Date.now()
    try {
      const note = await fn()
      baris.push(`✅ *${label}* — ${durasi(Date.now() - t0)}${note ? `\n   ${note}` : ''}`)
      return true
    } catch (err) {
      baris.push(`❌ *${label}* — ${durasi(Date.now() - t0)}\n   ${String(err?.message || err).slice(0, 180)}`)
      return false
    }
  }

  // Gambar tes dibikin sendiri → gak perlu kirim WhatsApp dulu.
  let gambar = null
  try {
    gambar = await sharp({ create: { width: 360, height: 260, channels: 3, background: '#1a73e8' } })
      .composite([{
        input: Buffer.from('<svg width="360" height="260"><text x="30" y="152" font-size="58" font-family="DejaVu Sans" fill="#ffffff">TES 47</text></svg>')
      }])
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch { /* sharp error → bagian gambar dilewati */ }

  const teksOk = await jalan('Teks ke Gemini', async () => {
    const r = await geminiChat({ message: 'balas satu kata: oke', instruction: 'Jawab satu kata saja.', timeoutMs: Math.min(conf.timeoutMs, 45_000) })
    const t = String(r?.text || '').trim()
    if (!t) throw new Error('jawaban kosong')
    if (CANNED_ERR_RE.test(t)) throw new Error(`Gemini balas error: ${t.slice(0, 120)}`)
    return `jawaban: ${t.slice(0, 60)}`
  })

  let gambarOk = false
  if (gambar) {
    gambarOk = await jalan('Gambar ke Gemini', async () => {
      const r = await geminiChat({
        message: 'tulisan apa yang ada di gambar ini? sebut apa adanya.',
        instruction: 'Jawab singkat.',
        timeoutMs: Math.min(conf.timeoutMs, 60_000),
        images: [{ buffer: gambar, mimetype: 'image/jpeg', filename: 'tes.jpg' }],
      })
      const t = String(r?.text || '').trim()
      if (!t) throw new Error('jawaban kosong')
      if (CANNED_ERR_RE.test(t)) throw new Error(`Gemini nolak gambarnya: ${t.slice(0, 120)}`)
      return `jawaban: ${t.slice(0, 90)}${/47/.test(t) ? '' : ' (angka di gambar gak kebaca)'}`
    })
  } else {
    baris.push('⚠️ *Gambar tes* — dilewati (sharp gak bisa bikin gambar di server ini)')
  }

  // Gemini nolak file? cek apakah jalur cadangan (OCR + deskripsi) masih bisa baca
  let cadanganOk = null
  if (!gambarOk && gambar && conf.visionFallback) {
    cadanganOk = await jalan('Cadangan gambar (OCR + deskripsi)', async () => {
      const baca = await readImage(gambar)
      if (!baca.ada) throw new Error('OCR & deskripsi dua-duanya gak ngasih hasil')
      return `tulisan: ${baca.teks ? `"${baca.teks.slice(0, 50)}"` : '-'} · deskripsi: ${baca.deskripsi ? `${baca.deskripsi.length} char` : '-'}`
    })
  }

  const hasil = !teksOk
    ? '❌ Gemini *teks* juga gagal — bukan soal gambar. Server/IP-nya lagi nolak, coba lagi nanti.'
    : gambarOk
      ? '✅ Teks & gambar dua-duanya jalan. Kalau tadi gagal, coba kirim ulang fotonya.'
      : cadanganOk
        ? '⚠️ Gemini nolak file, tapi *jalur cadangan jalan* — gambar tetap kebaca & dijawab (lebih lambat ±5-10 dtk).'
        : '⚠️ Teks jalan, *gambar gagal* — server Gemini nolak file & jalur cadangan juga gak dapet hasil.'
  return (
    '🧪 *TES AI*\n' +
    `> lib gambar: ${SUPPORTS_IMAGES ? 'ya' : 'TIDAK (lib lama — restart bot dulu!)'}\n` +
    `> node: ${process.version}\n\n` +
    baris.join('\n\n') +
    `\n\n*Hasil:* ${hasil}`
  )
}

/** `.bot diag` — kenapa tag/bales gak dibalas? (identitas + pesan terakhir) */
function diagText(ctx, p) {
  const conf = cfg()
  const id = botIdentity(ctx)
  const ai = resolveAutoAI(ctx.chat, kindOf(ctx))
  const s = lastSeen
  const yes = (v) => (v ? 'ya' : 'TIDAK')
  const bot = [
    `Nomor    : ${id.num ? `+${id.num}` : '❌ belum kedeteksi'}`,
    `meJid    : ${id.meJid || '-'}`,
    `meLid    : ${id.meLid || '-'}`,
    `user.id  : ${ctx.client?.user?.id || ctx.client?.user?.lid || '-'}`,
    `Fitur AI : ${yes(conf.enabled)} • tag ${yes(conf.mentionTrigger)} • bales ${yes(conf.replyTrigger !== false)} • chat pribadi ${yes(conf.privateAuto !== false)} • foto ${yes(conf.vision)}`,
    `Lib gambar: ${SUPPORTS_IMAGES ? 'ya ✅' : 'TIDAK — lib lama, restart bot dulu!'}`,
    `AutoAI   : ${ai.enabled ? `AKTIF (${ai.source}) • ${ai.characterName} • ${ai.mode}` : `NONAKTIF (${ai.source})`}`,
  ]
  const last = s
    ? [
        `Waktu    : ${s.at}`,
        `Chat     : ${s.group ? 'grup' : 'pribadi'}`,
        `Teks     : ${s.body || '(kosong)'}`,
        `Tag JID  : ${s.mentioned.length ? s.mentioned.join(', ') : '-'}`,
        `Quote    : ${s.quoted || '-'}`,
        `Gambar   : ${s.vision ? 'dilihat AI ✅' : s.adaGambar ? 'ada (gagal dibaca / vision mati)' : '-'}`,
        `Kedeteksi: ${s.matched ? 'YA' : 'TIDAK'}`,
        `Hasil    : ${s.result || '-'}`,
      ]
    : ['(belum ada pesan tanpa prefix sejak bot nyala)']
  const raw = s?.raw
    ? [
        `key.remoteJid  : ${raw0(s.raw.key.remoteJid)}`,
        `key.participant: ${raw0(s.raw.key.participant)}${s.raw.key.participantAlt ? `  (alt: ${s.raw.key.participantAlt})` : ''}`,
        `remoteJidAlt   : ${raw0(s.raw.key.remoteJidAlt)}`,
        `recipient      : ${raw0(s.raw.key.recipientJid)}${s.raw.key.recipientAlt ? `  (alt: ${s.raw.key.recipientAlt})` : ''}`,
        `fromMe         : ${s.raw.key.fromMe}`,
        `ctx.mentioned  : ${raw0(s.raw.mentionedJid.join(', '))}`,
        `ctx.quotePart. : ${raw0(s.raw.quoteParticipant)}`,
      ]
    : ['(belum ada)']

  return (
    '🔎 *ᴅɪᴀɢ ᴀɪ*\n\n' +
    `╭┈┈⬡「 🤖 ʙᴏᴛ 」\n${bot.map((l) => `┃ ${l}`).join('\n')}\n╰┈┈┈┈┈┈┈┈⬡\n\n` +
    `╭┈┈⬡「 📨 ᴘᴇsᴀɴ ᴛᴇʀᴀᴋʜɪʀ 」\n${last.map((l) => `┃ ${l}`).join('\n')}\n╰┈┈┈┈┈┈┈┈⬡\n\n` +
    `╭┈┈⬡「 🧪 ᴘᴀʏʟᴏᴀᴅ ᴍᴇɴᴛᴀʜ 」\n${raw.map((l) => `┃ ${l}`).join('\n')}\n╰┈┈┈┈┈┈┈┈⬡\n\n` +
    `> Tag / bales pesanku, lalu jalankan \`${p}bot diag\` lagi.\n` +
    '> Kalau *Kedeteksi: TIDAK*, bandingkan JID di blok PAYLOAD MENTAH dengan identitas bot di atas.'
  )
}

/** '-' kalau kosong, biar baris diag gak nanggung. */
function raw0(v) {
  const s = String(v ?? '').trim()
  return s || '-'
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
  const adaGambar = conf.vision && Boolean(findImgNode(ctx?.event?.message))
  if (!text && !adaGambar) return ctx.reply(helpText(p, conf))

  if (/^(diag|diagnosa|diagnose|cek)$/i.test(text)) {
    if (!ctx.isStaff) return ctx.reply('🚫 Khusus owner/staff.')
    return ctx.reply(diagText(ctx, p))
  }

  if (/^(tes|test|uji)$/i.test(text)) {
    if (!ctx.isStaff) return ctx.reply('🚫 Khusus owner/staff.')
    if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
    return ctx.reply(await selfTestText(conf))
  }

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

  const ai = resolveAutoAI(ctx.chat, kindOf(ctx))
  const opts = ai.enabled ? { persona: ai.instruction, mode: ai.mode } : { persona: readPersona(), mode: 'onlychat' }
  // Foto/stiker (yang dikirim atau yang di-quote) ikut dikirim ke AI.
  if (conf.vision) {
    const img = await imageForAI(ctx)
    if (img) opts.images = [img]
  }
  const prompt = text || 'Jelaskan gambar/stiker ini.'
  // Tanpa reaction (permintaan owner) — cukup indikator "typing", gak nunggu
  // round-trip reaction sebelum AI dipanggil.
  if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
  const r = await runChat(ctx, prompt, opts)
  return ctx.reply(r.reply)
}

/* ══════════════════════ trigger mention nomor bot ══════════════════════ */
const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2069\ufeff]/g
let botLidCache // { num, lid } — LID bot (kalau credentials.meLid kosong)

/** Buang suffix device (`:12`) dari jid — `628x:12@s.whatsapp.net` → `628x@s.whatsapp.net`. */
function normJid(j) {
  return String(j || '').replace(/:\d+@/, '@')
}

/** User (angka) dari jid, device-insensitive. */
function jidUser(j) {
  return normJid(j).split('@')[0]
}

/**
 * Race dengan batas waktu. Panggilan zapo (getLidsByPhoneNumbers /
 * queryGroupMetadata) bisa gantung tanpa resolve — kalau ditunggu terus,
 * handler tag/reply ikut macet dan bot kelihatan diem.
 */
function withTimeout(promise, ms, fallback = null) {
  let timer
  const t = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
    timer.unref?.()
  })
  return Promise.race([promise, t]).finally(() => clearTimeout(timer))
}

/**
 * Semua bentuk identitas bot: nomor + jid (PN/LID) yang kita tau.
 * Termasuk `key.recipientJid` — di chat pribadi stanza masuknya dialamatkan
 * ke bot sendiri, jadi field itu = identitas bot (di grup isinya jid grup).
 */
function botIdentity(ctx) {
  let cred = null
  try { cred = ctx?.client?.auth?.getCurrentCredentials?.() ?? null } catch { /* ignore */ }
  const num = getBotNumber() || jidUser(cred?.meJid) || null
  const meJid = normJid(cred?.meJid) || null
  const meLid = normJid(cred?.meLid) || null
  const recipients = [ctx?.event?.key?.recipientJid, ctx?.event?.key?.recipientAlt]
    .map(normJid)
    .filter((j) => Boolean(j) && (j.endsWith('@s.whatsapp.net') || j.endsWith('@lid')))
  const jids = [...new Set([
    num ? `${num}@s.whatsapp.net` : null,
    meJid,
    meLid,
    ...recipients,
  ].filter(Boolean))]
  return { num, meJid, meLid, userId: null, jids }
}

/** Kumpulin mentionedJid dari SEMUA jenis pesan (teks, caption, bungkus ephemeral/view-once). */
function mentionedJids(ctx) {
  const out = new Set(Array.isArray(ctx?.mentioned) ? ctx.mentioned : [])
  const msg = unwrapMessage(ctx?.event?.message) || {}
  for (const v of Object.values(msg)) {
    const list = v?.contextInfo?.mentionedJid
    if (Array.isArray(list)) for (const j of list) out.add(j)
  }
  return [...out].filter(Boolean)
}

/** Pengirim pesan yang di-quote (swipe-reply) — buat deteksi "bales pesan bot". */
function quotedParticipant(ctx) {
  const msg = unwrapMessage(ctx?.event?.message) || {}
  for (const v of Object.values(msg)) {
    const c = v?.contextInfo
    if (!c) continue
    const p = c.participant ?? c.participantAlt ?? c.remoteJid
    if (p) return p
  }
  return null
}

/* ══════════════════════ foto / stiker (vision) ══════════════════════ */

/**
 * Cari gambar/stiker di pesan — foto yang dikirim langsung ATAU yang di-quote
 * (bales foto pakai `@bot ini apa?`). Balikin `{ node, field }` tanpa mengunduh.
 */
function findImgNode(message) {
  const msg = unwrapMessage(message)
  if (!msg) return null
  for (const f of IMG_FIELDS) if (msg[f]) return { node: msg, field: f }
  for (const v of Object.values(msg)) {
    const quoted = v?.contextInfo?.quotedMessage
    if (!quoted) continue
    const q = unwrapMessage(quoted)
    if (!q) continue
    for (const f of IMG_FIELDS) if (q[f]) return { node: q, field: f }
  }
  return null
}

/**
 * Siapkan gambar buat dikirim ke Gemini: unduh → resize maks 1024px → jpeg.
 * Stiker webp (termasuk yang animasi, diambil frame pertama) diratakan ke
 * latar putih biar transparan gak jadi hitam. Gagal apa pun → `null` (bot tetap
 * jawab teksnya, cuma tanpa lihat gambar).
 */
async function imageForAI(ctx) {
  const conf = cfg()
  if (!conf.vision) return null
  const hit = findImgNode(ctx?.event?.message)
  if (!hit) return null

  const info = hit.node[hit.field] || {}
  const mimetype = String(info.mimetype || (hit.field === 'stickerMessage' ? 'image/webp' : 'image/jpeg'))
  if (!mimetype.startsWith('image/')) return null

  let bytes = null
  try {
    bytes = await withTimeout(ctx.client.message.downloadBytes(hit.node), VISION_DOWNLOAD_MS, null)
  } catch (err) {
    logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[AIChat] gagal unduh gambar')
    return null
  }
  if (!bytes?.length) return null

  const raw = Buffer.from(bytes)
  if (raw.length > VISION_MAX_BYTES) {
    logger.info({ ukuranMB: +(raw.length / 1048576).toFixed(1) }, '[AIChat] gambar kebesaran — dilewati')
    return null
  }

  try {
    const jpeg = await sharp(raw, { animated: false })
      .rotate()
      .resize(VISION_MAX_DIM, VISION_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer()
    logger.debug(
      { jenis: hit.field, asliKB: Math.round(raw.length / 1024), kirimKB: Math.round(jpeg.length / 1024) },
      '[AIChat] gambar siap dikirim ke AI'
    )
    return {
      buffer: jpeg,
      mimetype: 'image/jpeg',
      filename:
        hit.field === 'stickerMessage' ? 'stiker.jpg'
          : hit.field === 'documentMessage' ? 'gambar.jpg'
            : 'foto.jpg',
    }
  } catch (err) {
    logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[AIChat] gambar gak bisa diproses')
    return null
  }
}

/**
 * LID bot sendiri (kalau `credentials.meLid` kosong) — dibalik dari nomor bot
 * via `getLidsByPhoneNumbers`. Di-cache cuma kalau ketemu.
 */
async function botLid(ctx) {
  const { num, meLid } = botIdentity(ctx)
  if (meLid) return meLid
  if (!num) return null
  if (botLidCache?.num === num && botLidCache.lid) return botLidCache.lid
  try {
    const rows = await withTimeout(ctx.client?.profile?.getLidsByPhoneNumbers?.([num]), 3000, null)
    const lid = normJid((rows ?? [])[0]?.lidJid ?? (rows ?? [])[0]?.lid ?? null)
    if (lid) botLidCache = { num, lid }
    return lid
  } catch {
    return null
  }
}

/**
 * `jid` ini bot sendiri? Dibanding device-insensitive (buang `:12`) atas:
 * nomor bot, PN/LID dari credentials, `client.user.id`; kalau identitasnya
 * belum ketemu, LID dipetakan ke PN lewat participant grup / LID bot.
 */
async function isBotJid(ctx, jid) {
  if (!jid) return false
  const j = normJid(jid)
  if (!j) return false
  const { num, jids } = botIdentity(ctx)

  if (num && jidUser(j) === num) return true
  if (jids.includes(j)) return true
  if (jids.some((x) => jidUser(x) === jidUser(j))) return true

  // LID yang belum cocok (mis. `meLid` kosong) → petakan via participant grup
  // dan LID bot sekaligus (PARALEL): dua-duanya panggilan network, kalau
  // berurutan bisa nambah sampai 2× batas waktu sebelum AI dipanggil.
  if (!j.endsWith('@s.whatsapp.net')) {
    const [pn, lid] = await Promise.all([
      withTimeout(resolveLidToPn(ctx.client, ctx.chat, j), 2500, null),
      botLid(ctx),
    ])
    if (pn && normJid(pn) !== j) {
      if (num && jidUser(pn) === num) return true
      if (jids.includes(normJid(pn))) return true
      if (jids.some((x) => jidUser(x) === jidUser(pn))) return true
    }
    // terakhir: bandingkan sama LID bot sendiri (hasil balik dari nomor bot)
    if (lid && jidUser(lid) === jidUser(j)) return true
  }
  return false
}

/** Ada balesan/quote? (stanzaId di contextInfo — setelah bungkus dilepas) */
function hasQuoted(ctx) {
  const msg = unwrapMessage(ctx?.event?.message) || {}
  for (const v of Object.values(msg)) {
    if (v?.contextInfo?.stanzaId) return true
  }
  return false
}

/**
 * Bot "diajak ngobrol"? = di-TAG (PN/LID/teks @nomor) ATAU dibales
 * (quote pesan bot, kalau `replyTrigger` gak dimatiin) → dua-duanya manggil AI.
 * Di chat pribadi, lawan bicaranya cuma bot: pesan biasa juga dianggap ngajak
 * ngobrol (kalau `privateAuto` gak dimatiin).
 */
async function isBotMentioned(ctx, conf) {
  const { num, meLid } = botIdentity(ctx)
  // Cek semua mention sekaligus — jangan berurutan (tiap LID bisa nunggu network).
  const mentions = mentionedJids(ctx)
  if (mentions.length) {
    const hits = await Promise.all(mentions.map((j) => isBotJid(ctx, j)))
    if (hits.some(Boolean)) return true
  }
  const body = String(ctx.body || '').replace(INVISIBLE_RE, '')
  if (num && new RegExp(`@${num}(?![0-9])`).test(body)) return true
  // Mention bisa juga tampil sebagai @LID (grup LID-addressed) di teks pesan.
  const lidNum = jidUser(meLid)
  if (lidNum.length >= 6 && new RegExp(`@${lidNum}(?![0-9])`).test(body)) return true
  if (conf?.replyTrigger !== false) {
    if (await isBotJid(ctx, quotedParticipant(ctx))) return true
    // Chat pribadi: lawan bicaranya cuma bot → tiap balesan = balesan pesan bot
    if (!ctx.isGroup && hasQuoted(ctx)) return true
  }
  // Chat pribadi = memang ngobrol sama bot → gak perlu tag/bales sama sekali.
  if (!ctx.isGroup && conf?.privateAuto !== false) return true
  return false
}

function stripMention(text, num) {
  let t = String(text || '').replace(INVISIBLE_RE, '')
  if (num) t = t.replace(new RegExp(`@${num}(?![0-9])`, 'g'), ' ')
  return t.replace(/\s+/g, ' ').trim()
}

/** Snapshot pesan tanpa-prefix terakhir — buat `.bot diag`. */
let lastSeen = null

/**
 * Kalau pesan kelihatan niat nge-tag / bales bot tapi gak kedeteksi, tulis
 * satu baris log INFO — biar kelihatan di console tanpa perlu `.bot diag`.
 */
function logMiss(ctx, snap) {
  const key = ctx?.event?.key ?? {}
  const adaTag = snap.mentioned.length > 0
  const adaQuote = Boolean(snap.raw?.quoteStanzaId)
  const sebutAt = String(ctx?.body || '').includes('@')
  if (!adaTag && !adaQuote && !sebutAt) return
  logger.info(
    `🔎 [AIChat] gak kedeteksi — chat=${ctx.chat} grup=${ctx.isGroup} ` +
    `sender=${ctx.sender} tag=[${snap.mentioned.join(', ') || '-'}] ` +
    `quote=${snap.raw?.quoteParticipant || '-'} quoteId=${snap.raw?.quoteStanzaId || '-'} ` +
    `bot=${snap.bot.num ? `+${snap.bot.num}` : '-'}/${snap.bot.meLid || '-'} ` +
    `teks="${String(ctx.body || '').slice(0, 60)}"`
  )
}

function snapshot(ctx, conf) {
  const id = botIdentity(ctx)
  const key = ctx?.event?.key ?? {}
  const ci = (() => {
    const msg = unwrapMessage(ctx?.event?.message) || {}
    for (const v of Object.values(msg)) if (v?.contextInfo) return v.contextInfo
    return {}
  })()
  return {
    at: new Date().toISOString(),
    chat: ctx.chat,
    group: Boolean(ctx.isGroup),
    sender: ctx.sender,
    senderLid: ctx.senderLid || null,
    body: String(ctx.body || '').slice(0, 160),
    mentioned: mentionedJids(ctx),
    quoted: quotedParticipant(ctx),
    adaGambar: Boolean(findImgNode(ctx?.event?.message)),
    bot: { num: id.num, meJid: id.meJid, meLid: id.meLid, userId: id.userId, jids: id.jids },
    raw: {
      key: {
        remoteJid: key.remoteJid ?? null,
        fromMe: key.fromMe ?? null,
        participant: key.participant ?? null,
        participantAlt: key.participantAlt ?? null,
        remoteJidAlt: key.remoteJidAlt ?? null,
        recipientJid: key.recipientJid ?? null,
        recipientAlt: key.recipientAlt ?? null,
      },
      mentionedJid: Array.isArray(ci.mentionedJid) ? ci.mentionedJid : [],
      quoteParticipant: ci.participant ?? null,
      quoteStanzaId: ci.stanzaId ?? null,
    },
    flags: {
      enabled: conf.enabled,
      mentionTrigger: conf.mentionTrigger !== false,
      replyTrigger: conf.replyTrigger !== false,
      privateAuto: conf.privateAuto !== false,
    },
    autoai: null,
    matched: null,
    result: 'diproses',
  }
}

/** Ella v2 aktif di chat ini? (per-chat → global jenis chat) */
function ella2OwnsChat(chat, kind = 'group') {
  try {
    const v = getSetting(chat, 'ella2')
    if (v === '1') return true
    if (v === '0') return false
    return getGlobalKind('ella2', kind) === '1'
  } catch {
    return false
  }
}

async function onMention(ctx) {
  const conf = cfg()
  if (!conf.enabled || !conf.mentionTrigger) return false

  const snap = snapshot(ctx, conf)
  lastSeen = snap

  const matched = await isBotMentioned(ctx, conf)
  snap.matched = matched
  if (!matched) {
    snap.result = 'bukan tag / bukan bales bot'
    logMiss(ctx, snap)
    return false
  }

  // Auto AI per-chat (`.autoai`): kalau dimatiin di sini → diem aja.
  const ai = resolveAutoAI(ctx.chat, kindOf(ctx))
  snap.autoai = { enabled: ai.enabled, source: ai.source, character: ai.character, mode: ai.mode }
  // Ella v2 pegang chat ini → biarin dia yang jawab (gak dobel).
  if (ella2OwnsChat(ctx.chat, kindOf(ctx))) {
    snap.result = 'diem — ella2 aktif'
    logger.debug('💤 [AIChat] diem — Ella v2 aktif di chat ini')
    return false
  }
  if (!ai.enabled) {
    snap.result = `diem — autoai ${ai.source}`
    logger.info(`💤 [AIChat] tag/bales kedeteksi tapi autoai ${ai.source} mati — gak dibalas`)
    return true
  }

  const num = botIdentity(ctx).num
  let text = stripMention(ctx.body, num)
  const adaGambar = conf.vision && Boolean(findImgNode(ctx?.event?.message))
  if (!text && !adaGambar) {
    const u = userProfile(ctx)
    const siapa = u.name && u.name !== 'Tanpa Nama' ? ` ${u.name}` : ''
    snap.result = 'sapaan (tanpa teks)'
    await ctx.reply(
      ctx.isGroup
        ? `Halo${siapa}! 👋 Ada yang bisa aku bantu? Tag aku bareng pertanyaannya ya 😊`
        : `Halo${siapa}! 👋 Mau ngobrol apa? Kirim pesannya ya 😊`
    )
    return true
  }

  // anti-spam + cooldown ringan (staff/owner bebas). Di chat pribadi cukup
  // cooldown pendek: orang ngobrol wajar bisa kirim beberapa pesan cepat.
  if (!ctx.isStaff) {
    if (ctx.isGroup && config.antiSpam?.enabled) {
      const f = checkFlood(ctx.sender, config.antiSpam)
      if (f.flooded) {
        snap.result = 'diem — anti-spam (flood)'
        logger.info('💤 [AIChat] diem — pengirim kena anti-spam')
        return true
      }
    }
    const cd = checkCooldown(ctx.sender, 'aiMention', ctx.isGroup ? 4000 : 1500)
    if (cd.onCooldown) {
      snap.result = `diem — cooldown ${ctx.isGroup ? 4 : 1.5} detik`
      logger.debug(`💤 [AIChat] diem — cooldown ${Math.ceil(cd.remainingMs / 1000)}s`)
      return true
    }
  }

  snap.result = 'manggil AI…'
  // Foto/stiker (kalau ada) diunduh + dikompres dulu, baru ikut ditanya.
  let img = null
  if (adaGambar) img = await imageForAI(ctx)
  if (!text && img) text = 'Jelaskan gambar/stiker ini.'
  if (!text) {
    snap.result = 'gambar gagal dibaca (sapaan)'
    return ctx.reply('Hmm, gambarnya gak kebaca 😅 Coba kirim ulang ya, atau tulis pertanyaannya.')
  }
  snap.vision = Boolean(img)
  // Gak ada reaction (owner minta) — indikator "typing" dikirim tanpa ditunggu,
  // jadi AI langsung dipanggil tanpa nunggu round-trip reaction dulu.
  if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
  const r = await runChat(ctx, text, { persona: ai.instruction, mode: ai.mode, images: img ? [img] : [] })
  snap.result = r.ok ? 'dibalas ✅' : `gagal: ${String(r.reply || '').slice(0, 140)}`
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
  isBotMentioned, mentionedJids, quotedParticipant, hasQuoted, stripMention, flatten,
  botIdentity, isBotJid, withTimeout, diagText, getLastSeen: () => lastSeen, normJid, jidUser,
  resetHistory, store, llmRemember, parseFactsJson, faktaText, helpText,
  imageForAI, findImgNode, selfTestText, CANNED_ERR_RE,
  sessionGuard: {
    reset: () => { sessionFailStreak = 0; sessionSkipUntil = 0 },
    state: () => ({ sessionFailStreak, sessionSkipUntil }),
    skip: (ms) => { sessionSkipUntil = Date.now() + ms },
  },
}
