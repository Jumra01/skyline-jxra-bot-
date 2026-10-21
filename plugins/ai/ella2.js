/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ella2.js — AI chat **Ella v2** (otak: model Gemma di skyline.web.id).
 *
 *   • Otak: `POST /api/ai/gemma` (lihat `scraper/SKYLINE.js` → `gemmaChat`).
 *     Endpoint ini WAJIB apikey — pakai key yang sama dengan `.play`/`.ella`
 *     (`api.skyline.apikey` / env SKYLINE_API_KEY).
 *   • Persona: baru & terpisah dari `.ella` — bisa diubah `.ella2 persona`.
 *   • Ingatan: riwayat per nomor (`data/ella2-chat.json`) + fakta penting
 *     bersama `lib/aiMemory.js` (sama seperti `.bot`/`.ella`).
 *   • AUTO (tag / bales / DM): daftar mention handler prioritas 20, TAPI
 *     hanya jalan kalau `.ella2 on` (atau global) — default-nya ikut `.ella`
 *     biar perilaku lama gak berubah.
 *   • AKSI BOT: owner/staff/admin grup bisa nyuruh aksi beneran lewat obrolan
 *     ("tutup grup", "buka grup", "kick dia", ...). Model menandai balasan
 *     dengan `[[RUN: <perintah>]]`, lalu `lib/commandExec.js` yang validasi
 *     izin + jalanin command aslinya. Daftar aksi admin grup di
 *     `config.ella2.execAllow`; owner/staff bot bebas minta command apa pun.
 *   • FITUR UMUM: siapa pun (termasuk member) bisa minta fitur bot lewat
 *     obrolan ("cariin foto kucing" → `.pinterest kucing`, "downloadin lagu X"
 *     → `.play X`). Daftar di `config.ella2.execUser`, tetap kena cooldown +
 *     potongan emerald seperti command manual.
 *
 * Perintah:
 *   `.ella2 <teks>`           chat
 *   `.ella2 aksi`             lihat fitur umum + aksi admin yang bisa diminta
 *   `.ella2 on|off`           auto di chat ini (admin grup / DM sendiri)
 *   `.ella2 grup|pribadi on|off`  eksplisit per jenis chat
 *   `.ella2 global on|off`    auto di semua chat (owner) — bisa dipisah:
 *                             `global grup on|off` / `global pribadi on|off`
 *   `.ella2 persona [teks]`   lihat/ubah persona (owner, `reset` = default)
 *   `.ella2 fakta`            lihat fakta yang dicatat
 *   `.ella2 inget <hal>`      catat manual
 *   `.ella2 lupa`             hapus semua catatan
 *   `.ella2 reset`            hapus riwayat obrolan
 *   `.ella2 status`           info fitur
 *
 * EKSKLUSIF: nyalain `.ella2` otomatis mematikan `.autoai` di chat itu dan
 * mematikan `.ella` (per chat) — biar gak rebutan balas.
 */
import fs from 'node:fs'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { checkCooldown, checkFlood } from '../../core/cooldown.js'
import { getUser } from '../../core/database.js'
import { addMentionHandler } from '../../core/mentionTrigger.js'
import { sendTyping } from '../../core/presence.js'
import { isGroupAdmin } from '../../core/permission.js'
import { getGroupMetaCached } from '../../core/lid.js'
import { getSetting, setSetting } from '../../core/groupSettings.js'
import { getGroupConfig, setGroupConfig, disableGlobalAutoAI } from '../../lib/autoai.js'
import { kindOf, kindOfJid, parseKind, KIND_LABEL, getGlobalKind, setGlobalKind, kindLabel } from '../../lib/aiScope.js'
import { extractFacts, remember, factsFor, formatBlock, forget } from '../../lib/aiMemory.js'
import { gemmaChat } from '../../scraper/SKYLINE.js'
import { isBotMentioned, stripMention, botIdentity, withTimeout, findImgNode } from '../../lib/aiTrigger.js'
import { mayExec, parseRunMarkers, runBotCommand, allowNames, splitCommand } from '../../lib/commandExec.js'
import { getFeature } from '../loader.js'
import { isAdmission } from '../../lib/ella.js'
import {
  buildElla2System, readElla2Persona, writeElla2Persona, ella2PersonaIsCustom,
  SAFE_LINE, RETRY_NOTE,
} from '../../lib/ella2.js'

const DATA_DIR = './data'
const STORE_FILE = `${DATA_DIR}/ella2-chat.json`
const MAX_TRACKED = 300
const MAX_CHARS = 4000
const HISTORY_MAX = 10
const MODEL_LABEL = 'gemma-4-31b'

/** Command bawaan yang boleh dijalanin lewat Ella v2 (bisa diubah di config). */
const DEFAULT_EXEC_ALLOW = [
  'g open',
  'g close',
  'g link',
  'g revoke',
  'g setname <nama>',
  'g setdesc <teks>',
  'setwelcome <teks>',
  'setbye <teks>',
  'kick <tag/nomor>',
  'promote <tag/nomor>',
  'demote <tag/nomor>',
  'tagall <teks>',
  'hidetag <teks>',
  'on <welcome|bye|antilink|game>',
  'off <welcome|bye|antilink|game>',
]

/**
 * FITUR UMUM yang boleh dijalanin Ella v2 atas nama siapa pun (bukan aksi
 * admin). Yang di sini tetap kena cooldown + potongan emerald seperti kalau
 * user ngetik command-nya sendiri.
 */
const DEFAULT_EXEC_USER = [
  'pinterest',
  'play',
  'yta',
  'ytv',
  'ytsearch',
  'tiktok',
  'ig',
  'fb',
  'twitter',
  'spotify',
  'sticker',
  'toimg',
  'brat',
  'smeme',
  'iqc',
  'omniedit',
  'hd',
  'unblur',
  'removebg',
  'tomp3',
  'tourl',
  'ping',
  'menu',
  'balance',
  'daily',
]

/** Label pendek buat prompt (command → contoh pakai + kegunaan). */
const USER_HINTS = {
  pinterest: 'pinterest <kata kunci> — cari gambar',
  play: 'play <judul> — cari & kirim lagu',
  yta: 'yta <judul/link> — audio YouTube',
  ytv: 'ytv <judul/link> — video YouTube',
  ytsearch: 'ytsearch <kata kunci> — cari video YouTube',
  tiktok: 'tiktok <link> — download TikTok',
  ig: 'ig <link> — download Instagram',
  fb: 'fb <link> — download Facebook',
  twitter: 'twitter <link> — download X/Twitter',
  spotify: 'spotify <judul> — cari & download lagu Spotify',
  sticker: 'sticker — gambar/video yang dibalas jadi stiker',
  toimg: 'toimg — stiker yang dibalas jadi gambar',
  brat: 'brat <teks> — stiker teks ala brat',
  smeme: 'smeme <atas> | <bawah> — stiker meme dari gambar',
  iqc: 'iqc <teks> — gambar quote ala iPhone',
  omniedit: 'omniedit <perintah edit> — edit gambar pakai AI',
  hd: 'hd — jernihkan gambar yang dibalas',
  unblur: 'unblur — perbaiki foto buram',
  removebg: 'removebg — hapus background gambar',
  tomp3: 'tomp3 — video/voice note jadi MP3',
  tourl: 'tourl — media yang dibalas jadi link',
  ping: 'ping — cek latensi bot',
  menu: 'menu — daftar semua fitur bot',
  balance: 'balance — cek saldo emerald',
  daily: 'daily — klaim emerald harian',
}


const pluginConfig = {
  name: 'ella2',
  alias: ['ellav2', 'ella-2'],
  category: 'ai',
  description: 'Chat AI Ella v2 (Gemma skyline.web.id) — persona baru, inget obrolan, auto saat di-tag, bisa jalanin fitur bot & aksi grup',
  usage: '.ella2 <teks>  |  .ella2 on|off  |  .ella2 aksi  |  .ella2 fakta  |  .ella2 reset',
  example: '.ella2 tutup grup',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
}

/* ══════════════════════ config ══════════════════════ */
function bool(v, def) {
  if (v === undefined || v === null || v === '') return def
  return !/^(0|false|off|no|mati|gak)$/i.test(String(v).trim())
}

function num(v, min, max, def) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n)))
}

function cfg() {
  const c = config.ella2 || {}
  const allow = Array.isArray(c.execAllow) && c.execAllow.length ? c.execAllow : DEFAULT_EXEC_ALLOW
  const userAllow = Array.isArray(c.execUser) ? c.execUser : DEFAULT_EXEC_USER
  const deny = Array.isArray(c.execDeny) ? c.execDeny : []
  return {
    enabled: bool(process.env.ELLA2_ENABLED, c.enabled !== false),
    auto: bool(process.env.ELLA2_AUTO, c.auto !== false),
    mentionTrigger: c.mentionTrigger !== false,
    replyTrigger: c.replyTrigger !== false,
    privateAuto: c.privateAuto !== false,
    memory: c.memory !== false,
    maxHistory: num(c.maxHistory, 2, HISTORY_MAX, 8),
    timeoutMs: num(c.timeoutMs, 5000, 180_000, 60_000),
    systemPrompt: String(c.systemPrompt || '').trim(),
    retries: num(c.retries, 0, 3, 2),
    exec: String(c.exec ?? 'admin').toLowerCase(),
    execAllow: allow.map((s) => String(s).trim()).filter(Boolean),
    execUser: userAllow.map((s) => String(s).trim()).filter(Boolean),
    execDeny: deny.map((s) => String(s).trim()).filter(Boolean),
  }
}

/** Katalog ringkas buat prompt: `pinterest <kata kunci>`. */
function userCatalog(names = cfg().execUser) {
  return names.map((n) => {
    const hint = USER_HINTS[n]
    if (hint) return hint.split(' — ')[0]
    return n
  })
}

/** Katalog versi enak dibaca (buat `.ella2 aksi`). */
function userCatalogDetailed(names = cfg().execUser) {
  return names.map((n) => {
    const hint = USER_HINTS[n]
    if (hint) return hint
    const f = getFeature(n)
    const desc = String(f?.description || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').slice(0, 55)
    return desc ? `${n} — ${desc}` : n
  })
}

/* ══════════════════════ riwayat (per nomor) ══════════════════════ */
const store = new Map() // jid -> { at, msgs: [{ role, content }] }
let saveTimer = null

function storeKey(ctx) {
  return String(ctx.sender || ctx.chat || 'unknown')
}

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    for (const [k, v] of Object.entries(raw || {})) {
      if (!Array.isArray(v?.msgs)) continue
      const msgs = v.msgs
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-HISTORY_MAX * 2)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      if (msgs.length) store.set(k, { at: Number(v.at) || 0, msgs })
    }
  } catch {
    /* belum ada file */
  }
}

function saveStore() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      if (store.size > MAX_TRACKED) {
        const keep = [...store.entries()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_TRACKED)
        store.clear()
        for (const [k, v] of keep) store.set(k, v)
      }
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const tmp = `${STORE_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(store)))
      fs.renameSync(tmp, STORE_FILE)
    } catch (err) {
      logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[Ella2] gagal simpan riwayat')
    }
  }, 1500)
  saveTimer.unref?.()
}

function pushTurn(h, role, content) {
  h.msgs.push({ role, content: String(content || '').slice(0, 2000) })
  const cap = Math.max(4, cfg().maxHistory * 2)
  if (h.msgs.length > cap) h.msgs = h.msgs.slice(-cap)
  h.at = Date.now()
  saveStore()
}

/* ══════════════════════ profil & waktu ══════════════════════ */
function roleLabel(ctx) {
  if (ctx.isOwner) return 'Owner bot'
  if (ctx.isAdmin) return 'Admin bot'
  if (ctx.isStaff) return 'Staff bot'
  return 'Member biasa'
}

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

/** Siapa yang lagi nyuruh — dideteksi otomatis dari peran & admin grup. */
function execRoleLabel(ctx, info) {
  if (ctx.isOwner) return 'Owner bot'
  if (ctx.isStaff) return 'Admin/Staff bot'
  if (ctx.isGroup && info?.group?.isGroupAdmin) return 'Admin grup'
  return 'Member'
}

async function contextFor(ctx) {
  const row = ctx.sender ? getUser(ctx.sender) : null
  const name = String(ctx.pushName || row?.name || '').trim() || 'Tanpa Nama'
  let group = null
  if (ctx.isGroup) {
    const [meta, admin] = await Promise.all([
      withTimeout(getGroupMetaCached(ctx.client, ctx.chat), 2500, null),
      withTimeout(isGroupAdmin(ctx), 2500, false),
    ])
    group = {
      name: String(meta?.subject || ''),
      members: Array.isArray(meta?.participants) ? meta.participants.length : 0,
      isGroupAdmin: Boolean(admin),
    }
  }
  return {
    name,
    number: ctx.senderNumber ? `+${ctx.senderNumber}` : '-',
    role: roleLabel(ctx),
    group,
  }
}

/* ══════════════════════ status on/off ══════════════════════ */
/** Ella v2 aktif di chat ini? (opt-in) per-chat → global jenis chat → mati. */
function hereOn(ctx) {
  const chat = typeof ctx === 'string' ? ctx : ctx.chat
  const kind = typeof ctx === 'string' ? kindOfJid(chat) : kindOf(ctx)
  try {
    const v = getSetting(chat, 'ella2')
    if (v === '1') return true
    if (v === '0') return false
    return getGlobalKind('ella2', kind) === '1'
  } catch {
    return false
  }
}

function sourceOf(ctx) {
  const chat = typeof ctx === 'string' ? ctx : ctx.chat
  const kind = typeof ctx === 'string' ? kindOfJid(chat) : kindOf(ctx)
  const v = getSetting(chat, 'ella2')
  if (v === '1') return 'chat ini'
  if (v === '0') return 'chat ini (dimatikan)'
  const g = getGlobalKind('ella2', kind)
  if (g === '1') return `global ${KIND_LABEL[kind]} (owner)`
  if (g === '0') return `global ${KIND_LABEL[kind]} (dimatikan)`
  return 'belum diaktifkan'
}

/* ══════════════════════ eksklusif ══════════════════════ */
function silenceAutoAI(scope = 'chat', chat = null, kind = null) {
  try {
    if (scope === 'global') return disableGlobalAutoAI(kind)
    const c = getGroupConfig(chat)
    if (c?.enabled) {
      setGroupConfig(chat, { ...c, enabled: false })
      return true
    }
    return false
  } catch {
    return false
  }
}

function silenceElla(scope = 'chat', chat = null, kind = null) {
  try {
    if (scope === 'global') {
      const kinds = kind ? [kind] : ['group', 'private']
      let was = false
      for (const k of kinds) {
        if (getGlobalKind('ella', k) === '1') was = true
        setGlobalKind('ella', k, false)
      }
      return was
    }
    const was = getSetting(chat, 'ella') === '1'
    setSetting(chat, 'ella', '0')
    return was
  } catch {
    return false
  }
}

/* ══════════════════════ antrian per chat ══════════════════════ */
/**
 * Server Gemma balas "ramai" (503/429) paling sering kalau request numpuk —
 * di chat pribadi tiap pesan memicu request, jadi user yang ngetik cepat bisa
 * punya 3-4 request barengan. Antrian ini bikin satu chat cuma punya SATU
 * request jalan; pesan berikutnya nunggu (maks 45 dtk) baru dikirim.
 */
const CHAT_QUEUE = new Map()
const CHAT_QUEUE_MAX_WAIT = 45_000

async function withChatQueue(key, fn) {
  const prev = CHAT_QUEUE.get(key)
  if (prev) {
    await Promise.race([
      prev.catch(() => {}),
      new Promise((r) => setTimeout(r, CHAT_QUEUE_MAX_WAIT))
    ])
  }
  const run = (async () => {
    try {
      return await fn()
    } finally {
      if (CHAT_QUEUE.get(key) === run) CHAT_QUEUE.delete(key)
    }
  })()
  CHAT_QUEUE.set(key, run)
  return run
}

/* ══════════════════════ inti: panggil AI ══════════════════════ */
function humanError(err) {
  const status = Number(err?.status) || 0
  const msg = String(err?.message || err)
  if (status === 429 || /rate|limit|too many|kuota/i.test(msg)) {
    return '🚦 *Ella v2 lagi dibatasin* — coba lagi sebentar ya 😅'
  }
  if (status === 503 || /busy|try again later|overload|ramai/i.test(msg)) {
    return '🕐 *Otak Ella v2 lagi ramai* — udah dicoba beberapa kali, tetap penuh. Coba lagi ±10 detik ya 😅'
  }
  if (status === 502 || status === 504) {
    return '🛠️ Server AI-nya lagi ngadat — coba lagi sebentar ya'
  }
  if (/timeout|kelamaan|ETIMEDOUT/i.test(msg)) return '⏳ Ella v2 kelamaan mikir — coba lagi ya'
  if (status === 401 || status === 403) {
    return '🔑 Ella v2 butuh API key skyline.web.id yang valid — kasih tahu owner bot ya'
  }
  if (status === 400) return '⚠️ Ella v2 gak bisa proses pesan itu — coba tulis ulang sebentar'
  return '😅 Ella v2 lagi gak bisa nyambung — coba lagi sebentar'
}

/** Anggap ngaku AI juga kalau nyebut model Gemma. */
function admission(text) {
  const t = String(text || '')
  if (isAdmission(t)) return true
  return /\bgemma\b|\basisten\s+ai\b|\bmodel\s+(?:ai|bahasa)\b/i.test(t)
}

/**
 * Proses penanda `[[RUN: ...]]` dari balasan AI.
 * - Owner/staff bot (`open`) → bebas milih command apa pun (hard-deny tetap).
 * - Admin grup (`execOn`) → aksi di `execAllow` + fitur umum `execUser`.
 * - Member → fitur umum `execUser` saja.
 * - Penanda yang ditolak tetap dibuang biar gak bocor ke chat.
 */
async function applyRunMarkers(ctx, reply, { execOn = false, open = false, conf = cfg() } = {}) {
  const { clean, actions } = parseRunMarkers(reply)
  if (!actions.length) return { reply, note: '', results: [] }

  const userSet = new Set(allowNames(conf.execUser))
  const runnable = []
  const denied = []
  for (const a of actions.slice(0, 3)) {
    const name = splitCommand(a).name
    // Alias (`yts`, `ytmp3`, `pin`) diresolve ke nama asli dulu.
    const canonical = String(getFeature(name)?.name || name).toLowerCase()
    if (open || execOn || userSet.has(name) || userSet.has(canonical)) runnable.push(a)
    else denied.push(name)
  }

  if (denied.length) {
    logger.info({ denied }, '[Ella2] aksi ditolak — pengirim bukan owner/staff/admin grup')
  }

  const results = []
  for (const a of runnable) {
    const res = await runBotCommand(ctx, a, {
      allow: conf.execAllow,
      deny: conf.execDeny,
      userAllow: conf.execUser,
      open,
    })
    logger.info({ cmd: a, ok: res.ok, tier: res.tier, err: res.error }, '[Ella2] aksi bot')
    results.push(res.ok ? `✅ \`${res.used}\` dijalanin.` : `⚠️ ${res.error}.`)
  }

  const notes = [...results]
  if (denied.length) {
    notes.push(`⛔ \`${denied.join('`, `')}\` cuma bisa diminta owner/admin grup.`)
  }

  let text = clean
  // Model sempat ngaku "udah dikerjain" padahal semuanya ditolak → ganti jujur.
  if (!runnable.length && denied.length) {
    text = 'Aksi admin kayak gitu cuma bisa diminta owner atau admin grup ya.'
  }
  if (!text) text = runnable.length ? 'Oke, aku jalanin ya 👍' : 'Oke.'

  return {
    reply: text,
    note: notes.length ? `\n\n${notes.join('\n')}` : '',
    results,
    denied,
  }
}

async function runChat(ctx, text, { mode = 'onlychat', hasImage = false } = {}) {
  const conf = cfg()
  const key = storeKey(ctx)
  let h = store.get(key)
  if (!h) {
    h = { at: 0, msgs: [] }
    store.set(key, h)
  }

  if (conf.memory) {
    try {
      const found = extractFacts(text)
      if (found.length) remember(ctx.sender, found)
    } catch (err) {
      logger.debug({ err: String(err?.message || err).slice(0, 120) }, '[Ella2] gagal catat fakta')
    }
  }

  const info = await contextFor(ctx)
  // Boleh nyuruh Ella ngejalanin command? (owner/staff/admin grup, sesuai config)
  const execOn = mayExec(ctx, { mode: conf.exec, isGroupAdmin: info.group?.isGroupAdmin })
  // Owner/staff bot = bebas minta command apa pun; admin grup terikat daftar.
  const openExec = Boolean(ctx.isOwner || ctx.isStaff)
  const imageNote = hasImage
    ? '\n\n[CATATAN] Dia juga mengirim gambar/stiker, tapi kamu belum bisa melihat isinya. Jangan ngarang isi gambarnya; kalau perlu, bilang singkat belum bisa lihat.'
    : ''

  const system = buildElla2System({
    name: info.name,
    number: info.number,
    role: info.role,
    isGroup: ctx.isGroup,
    groupName: info.group?.name,
    memberCount: info.group?.members,
    isGroupAdmin: info.group?.isGroupAdmin,
    facts: conf.memory ? formatBlock(ctx.sender) : '',
    mode,
    time: nowWIB(),
    extra: conf.systemPrompt,
    canExec: execOn,
    openExec,
    execBlocked: !execOn && conf.exec !== 'off',
    actionList: conf.execAllow,
    featureList: conf.execUser.length ? userCatalog(conf.execUser) : [],
    // Sisa ruang buat catatan gambar (system dipotong API di 3000 char).
    maxChars: hasImage ? 2800 : 3000,
  }) + imageNote

  const history = h.msgs
    .slice(-Math.min(HISTORY_MAX, conf.maxHistory))
    .map((m) => ({ role: m.role, content: m.content }))

  let reply = ''
  let tookMs = 0
  try {
    const r = await withChatQueue(storeKey(ctx), () => gemmaChat({
      message: text,
      history,
      system,
      timeoutMs: conf.timeoutMs,
      retries: conf.retries,
    }))
    reply = r.reply
    tookMs = r.tookMs
    if (r.fallback) logger.info('[Ella2] otak Gemma ramai — dijawab otak cadangan (aichat-skyline)')
    else if (r.attempts > 1) logger.info(`[Ella2] AI akhirnya jawab setelah ${r.attempts}× coba (server ramai)`)
  } catch (err) {
    logger.warn(
      {
        status: err?.status || 0,
        attempts: err?.attempts || 1,
        err: String(err?.message || err).slice(0, 160),
      },
      '[Ella2] AI gagal'
    )
    return { ok: false, reply: humanError(err) }
  }

  if (admission(reply)) {
    logger.info('[Ella2] jawaban ngaku AI — ulang dengan instruksi identitas')
    try {
      const r2 = await withChatQueue(storeKey(ctx), () => gemmaChat({
        message: text,
        history,
        system: `${system}\n\n${RETRY_NOTE}`,
        timeoutMs: conf.timeoutMs,
        retries: conf.retries,
      }))
      reply = r2.reply
      tookMs = r2.tookMs
    } catch {
      /* jatuh ke SAFE_LINE di bawah */
    }
    if (admission(reply)) reply = SAFE_LINE
  }

  // Aksi bot: model bisa nitip baris `[[RUN: ...]]` → divalidasi & dijalanin.
  // Penanda selalu dibuang dari teks, termasuk kalau pengirim gak berhak.
  const applied = await applyRunMarkers(ctx, reply, { execOn, open: openExec, conf })
  reply = applied.reply
  const execNote = applied.note

  pushTurn(h, 'user', text)
  pushTurn(h, 'assistant', reply)
  logger.debug({ ms: tookMs, chars: reply.length }, '[Ella2] balas')
  return { ok: true, reply: `${reply}${execNote}`, tookMs }
}

/* ══════════════════════ auto (tag / bales / DM) ══════════════════════ */
async function onMention(ctx) {
  const conf = cfg()
  if (!conf.enabled || !conf.auto) return false

  const matched = await isBotMentioned(ctx, conf)
  if (!matched) return false

  // Opt-in: belum diaktifkan di chat ini → serahkan ke handler lain (`.ella`).
  if (!hereOn(ctx)) return false

  if (!ctx.isStaff) {
    if (ctx.isGroup && config.antiSpam?.enabled) {
      const f = checkFlood(ctx.sender, config.antiSpam)
      if (f.flooded) {
        logger.info('💤 [Ella2] diem — pengirim kena anti-spam')
        return true
      }
    }
    const cd = checkCooldown(ctx.sender, 'ella2Mention', ctx.isGroup ? 4000 : 1500)
    if (cd.onCooldown) {
      logger.debug(`💤 [Ella2] diem — cooldown ${Math.ceil(cd.remainingMs / 1000)}s`)
      return true
    }
  }

  const adaGambar = Boolean(conf.mentionTrigger && findImgNode(ctx?.event?.message))
  let text = stripMention(ctx.body, botIdentity(ctx).num)
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)

  if (!text && !adaGambar) {
    const nama = String(ctx.pushName || '').trim()
    await ctx.reply(
      ctx.isGroup
        ? `Halo${nama ? ` ${nama}` : ''}! Ada apa? Tag aku bareng pertanyaannya ya 😊`
        : `Halo${nama ? ` ${nama}` : ''}! Mau ngobrol apa? 😊`
    )
    return true
  }
  if (!text) {
    await ctx.reply('Aku belum bisa lihat gambar di versi ini 😅 tulis aja maksudnya ya.')
    return true
  }

  if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
  const r = await runChat(ctx, text, { hasImage: adaGambar })
  await ctx.reply(r.reply)
  return true
}

/* ══════════════════════ teks status ══════════════════════ */
function statusText(ctx, { groupAdmin = false } = {}) {
  const p = ctx.prefix || '.'
  const h = store.get(storeKey(ctx))
  const facts = factsFor(ctx.sender)
  const kind = kindOf(ctx)
  const on = hereOn(ctx)
  const c = cfg()
  const role = execRoleLabel(ctx, { group: { isGroupAdmin: groupAdmin } })
  const boleh = mayExec(ctx, { mode: c.exec, isGroupAdmin: groupAdmin })
  return [
    '🤖 *ELLA v2* — jalur Gemma',
    '',
    '> Otak   : skyline.web.id/api/ai/gemma',
    `> Model  : ${MODEL_LABEL}`,
    `> Ruang  : ${ctx.isGroup ? 'grup' : 'pribadi'}`,
    `> Auto   : ${on ? 'AKTIF ✅' : 'MATI 💤'} (${sourceOf(ctx)})`,
    `> Global : grup ${kindLabel(getGlobalKind('ella2', 'group'))} · pribadi ${kindLabel(getGlobalKind('ella2', 'private'))}`,
    `> Persona: ${ella2PersonaIsCustom() ? 'CUSTOM' : 'DEFAULT'}`,
    `> Aksi   : ${String(c.exec).toLowerCase() === 'off' ? 'mati' : (boleh ? 'boleh ✅' : 'gak boleh ⛔')} — kamu ${role}`,
    `> Ingatan: ${facts.length} catatan · ${h?.msgs?.length || 0} pesan`,
    '',
    '> ℹ️ Beda dengan `.ella`: persona & riwayat terpisah, otaknya Gemma.',
    '> ℹ️ Auto `.ella2` dan `.autoai`/`.ella` saling eksklusif (yang nyala terakhir jalan).',
    '> ℹ️ Saklar global grup & pribadi dipisah.',
    '',
    '📌 *Cara pakai*',
    `> ${p}ella2 <teks> — ngobrol`,
    '> tag / bales pesan Ella v2 — auto balas (kalau auto nyala)',
    '> tag + _"cariin foto kucing"_ — Ella jalanin `.pinterest kucing`',
    '> tag + _"downloadin lagu X"_ — Ella jalanin `.play X`',
    '> owner/admin bisa minta aksi: _"tutup grup"_, _"buka grup"_, _"kick dia"_, dll',
    `> ${p}ella2 aksi — daftar fitur & aksi yang bisa dijalanin`,
    '',
    '⚙️ *Atur*',
    `> ${p}ella2 on / off — auto di chat ini`,
    `> ${p}ella2 grup on / pribadi on — eksplisit per jenis`,
    `> ${p}ella2 global on|off — dua jenis (owner)`,
    `> ${p}ella2 global grup on|off · global pribadi on|off`,
    `> ${p}ella2 persona — atur karakter (owner)`,
    `> ${p}ella2 fakta — lihat catatan`,
    `> ${p}ella2 inget <hal> — catat manual`,
    `> ${p}ella2 lupa — hapus catatan`,
    `> ${p}ella2 reset — hapus riwayat`,
  ].join('\n')
}

/* ══════════════════════ command ══════════════════════ */
async function handler(ctx) {
  const conf = cfg()
  const p = ctx.prefix || '.'
  if (!conf.enabled) return ctx.reply(`❌ Fitur Ella v2 lagi nonaktif (owner bisa nyalain di \`config.ella2.enabled\`).`)

  const tokens = String(ctx.text || '').toLowerCase().split(/\s+/).filter(Boolean)
  const sub = tokens[0] || ''
  const rest = String(ctx.text || '').trim()
  const ON = ['on', 'nyala', 'hidup']
  const OFF = ['off', 'mati', 'matiin', 'matikan']

  /* on / off per chat — bisa dipilih jenisnya (harus cocok sama chat ini) */
  const kindArg = parseKind(sub)
  let action = sub
  if (kindArg) {
    const word = tokens[1] || ''
    if (!ON.includes(word) && !OFF.includes(word)) {
      return ctx.reply(
        `❌ Format: \`${p}ella2 ${KIND_LABEL[kindArg]} on|off\`\n` +
        `> Global: \`${p}ella2 global ${KIND_LABEL[kindArg]} on|off\``
      )
    }
    if (kindArg !== kindOf(ctx)) {
      return ctx.reply(
        `⚠️ Ini ${KIND_LABEL[kindOf(ctx)]}, bukan ${KIND_LABEL[kindArg]}.\n` +
        `> Buat chat ini: \`${p}ella2 ${kindOf(ctx)} ${word}\`\n` +
        (ctx.isOwner ? `> Buat semua ${KIND_LABEL[kindArg]}: \`${p}ella2 global ${kindArg} ${word}\`` : '')
      )
    }
    action = word
  }

  if (ON.includes(action) || OFF.includes(action)) {
    const want = ON.includes(action)
    if (ctx.isGroup) {
      const admin = await withTimeout(isGroupAdmin(ctx), 2500, false)
      if (!admin) return ctx.reply('🚫 Cuma admin grup (atau staff bot) yang bisa ngatur Ella v2 di grup ini.')
    }
    setSetting(ctx.chat, 'ella2', want ? '1' : '0')
    const autoOff = want ? silenceAutoAI('chat', ctx.chat) : false
    const ellaOff = want ? silenceElla('chat', ctx.chat) : false
    const notes = [
      autoOff ? '> 🤖 AutoAI (`.autoai`) otomatis *dimatikan* di chat ini.' : '',
      ellaOff ? '> 💝 `.ella` otomatis *dimatikan* di chat ini (biar gak dobel balas).' : '',
    ].filter(Boolean)
    return ctx.reply(
      want
        ? ['✅ *Ella v2 aktif di chat ini.*', '> Tag dia atau bales pesannya, nanti dia jawab.', ...notes].join('\n')
        : '💤 *Ella v2 diem di chat ini.*\n> Auto balas gak jalan sampai dinyalain lagi.'
    )
  }

  /* global on/off — bisa per jenis chat (grup / pribadi) */
  if (sub === 'global') {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const scopeArg = parseKind(tokens[1])
    const v = String((scopeArg ? tokens[2] : tokens[1]) || '').toLowerCase()

    if (!ON.includes(v) && !OFF.includes(v)) {
      return ctx.reply(
        '🌍 *Global Ella v2*\n\n' +
        `> Grup    : *${kindLabel(getGlobalKind('ella2', 'group'))}*\n` +
        `> Pribadi : *${kindLabel(getGlobalKind('ella2', 'private'))}*\n\n` +
        `> \`${p}ella2 global on|off\` — dua-duanya\n` +
        `> \`${p}ella2 global grup on|off\`\n` +
        `> \`${p}ella2 global pribadi on|off\``
      )
    }

    const want = ON.includes(v)
    const where = scopeArg ? KIND_LABEL[scopeArg] : 'grup + pribadi'
    let autoOff = false
    let ellaOff = false

    if (want) {
      if (scopeArg) {
        setGlobalKind('ella2', scopeArg, true)
        autoOff = silenceAutoAI('global', null, scopeArg)
        ellaOff = silenceElla('global', null, scopeArg)
      } else {
        for (const k of ['group', 'private']) setGlobalKind('ella2', k, true)
        autoOff = silenceAutoAI('global', null, null)
        ellaOff = silenceElla('global', null, null)
      }
    } else if (scopeArg) {
      setGlobalKind('ella2', scopeArg, false)
    } else {
      for (const k of ['group', 'private']) setGlobalKind('ella2', k, false)
    }

    const notes = [
      autoOff ? `> 🤖 AutoAI otomatis *dimatikan* di ${where}.` : '',
      ellaOff ? `> 💝 Ella otomatis *dimatikan* di ${where} (biar gak dobel balas).` : '',
    ].filter(Boolean)
    return ctx.reply(
      want
        ? [`✅ *Ella v2 aktif global — ${where}* (yang gak punya setelan sendiri).`, ...notes].join('\n')
        : `💤 *Ella v2 dimatiin global — ${where}.*`
    )
  }

  /* persona — owner only, dibaca live */
  if (['persona', 'prompt', 'karakter'].includes(sub)) {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const personaArg = rest.replace(/^\S+\s*/i, '').trim()
    if (/^(reset|default|bawaan)$/i.test(personaArg)) {
      writeElla2Persona('')
      return ctx.reply('♻️ Persona Ella v2 dikembalikan ke default.')
    }
    if (!personaArg) {
      const cur = readElla2Persona()
      const preview = cur.length > 1200 ? `${cur.slice(0, 1200)}…` : cur
      return ctx.reply(
        `🎭 *Persona Ella v2* — ${ella2PersonaIsCustom() ? 'CUSTOM' : 'DEFAULT'}\n\n${preview}\n\n` +
          `Ubah: \`${p}ella2 persona <teks>\`\nReset: \`${p}ella2 persona reset\``
      )
    }
    if (personaArg.length > 2500) return ctx.reply('⚠️ Persona terlalu panjang. Maksimal 2500 karakter.')
    if (!writeElla2Persona(personaArg)) return ctx.reply('❌ Gagal menyimpan persona Ella v2 ke folder data/.')
    return ctx.reply(`✅ Persona Ella v2 disimpan (${personaArg.length} karakter). Langsung aktif tanpa restart.`)
  }

  /* reset riwayat */
  if (['reset', 'clear', 'hapus'].includes(sub)) {
    const had = store.delete(storeKey(ctx))
    if (had) saveStore()
    return ctx.reply(
      had ? '🧹 Riwayat obrolan Ella v2 di sini udah dihapus. Mulai dari nol lagi ya.' : '🧹 Memang belum ada riwayat obrolan di sini.'
    )
  }

  /* lupa semua fakta */
  if (['lupa', 'forget'].includes(sub)) {
    const had = forget(ctx.sender)
    return ctx.reply(had ? '🗑️ Semua catatan Ella v2 tentang kamu udah dihapus.' : '🗑️ Belum ada catatan tentang kamu.')
  }

  /* lihat fakta */
  if (['fakta', 'ingat', 'memori', 'memory'].includes(sub)) {
    const list = factsFor(ctx.sender)
    if (!list.length) return ctx.reply('📭 Belum ada yang Ella v2 catat tentang kamu.')
    const lines = list.map((f, i) => `${i + 1}. *${f.k}* — ${f.v}`)
    return ctx.reply(`🧠 *Yang Ella v2 inget tentang kamu*\n\n${lines.join('\n')}\n\n> Hapus: \`${p}ella2 lupa\``)
  }

  /* catat manual */
  if (['inget', 'catat', 'remember'].includes(sub)) {
    const isi = rest.replace(/^\S+\s*/i, '').trim()
    if (!isi) return ctx.reply(`📝 Contoh: \`${p}ella2 inget aku suka kopi hitam\``)
    if (isi.length > 160) return ctx.reply('📝 Kependekan aja ya — maksimal 160 karakter.')
    remember(ctx.sender, [{ k: 'catatan', v: isi }])
    return ctx.reply(`🧠 Oke, Ella v2 catat: _${isi}_`)
  }

  /* daftar aksi bot yang bisa diminta */
  if (['aksi', 'action', 'cmd', 'command'].includes(sub)) {
    const e = cfg()
    const groupAdmin = ctx.isGroup ? await withTimeout(isGroupAdmin(ctx), 2500, false) : false
    const boleh = mayExec(ctx, { mode: e.exec, isGroupAdmin: groupAdmin })
    const open = Boolean(ctx.isOwner || ctx.isStaff)
    const role = execRoleLabel(ctx, { group: { isGroupAdmin: groupAdmin } })
    const fitur = userCatalogDetailed(e.execUser)
    return ctx.reply(
      `⚙️ *Yang bisa diminta ke Ella v2*\n\n` +
        (open
          ? `*Owner/staff bot* — boleh minta command bot apa pun.\n> Pengecualian: \`restart\`, \`updatesc\`, \`restore\`, \`clearcache\`.\n\n`
          : '') +
        `*Fitur umum* — siapa aja boleh minta:\n` +
        (fitur.length ? fitur.map((f) => `> \`${f}\``).join('\n') : '> _(kosong)_') +
        `\n\n*Aksi admin grup* — ${String(e.exec).toLowerCase() === 'off' ? 'lagi dimatiin owner' : 'khusus owner/admin'}:\n` +
        e.execAllow.map((a) => `> \`${a}\``).join('\n') +
        `\n\n> Cukup ngomong biasa, contoh: _"cariin foto kucing"_, _"downloadin lagu X"_.\n` +
        `> Kamu terdeteksi: *${role}* ${open ? '✅ bebas minta command' : boleh ? '✅ boleh nyuruh aksi admin di sini' : '⛔ cuma bisa minta fitur umum'}`
    )
  }

  /* status / bantuan */
  if (!rest || ['status', 'info', 'help', 'bantuan'].includes(sub)) {
    const groupAdmin = ctx.isGroup ? await withTimeout(isGroupAdmin(ctx), 2500, false) : false
    return ctx.reply(statusText(ctx, { groupAdmin }))
  }

  /* ngobrol */
  const hit = findImgNode(ctx?.event?.message)
  let text = rest
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)
  if (!text && hit) return ctx.reply('Aku belum bisa lihat gambar di versi ini 😅 tulis aja maksudnya ya.')

  if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
  const r = await runChat(ctx, text, { hasImage: Boolean(hit) })
  return ctx.reply(r.reply)
}

loadStore()
addMentionHandler('ella2', onMention, 20)

export { pluginConfig as config, handler }
export const _internals = {
  cfg, runChat, humanError, onMention, handler, hereOn, sourceOf, statusText, admission,
  contextFor, nowWIB, store, STORE_FILE, loadStore, execRoleLabel, applyRunMarkers,
  mayExec, parseRunMarkers, runBotCommand, DEFAULT_EXEC_ALLOW,
  DEFAULT_EXEC_USER, USER_HINTS, userCatalog, userCatalogDetailed,
}
