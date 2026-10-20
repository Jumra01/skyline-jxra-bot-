/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ella.js — AI chat **Ella** (otak: API `aichat-skyline` skyline.web.id).
 *
 *   • Nama & karakter: **Ella** — roleplay manusia, TIDAK PERNAH ngaku AI/bot.
 *   • Otak: `POST /api/ai/aichat-skyline` (memakai API key Skyline, balas ~1–3 detik).
 *   • Inget obrolan: riwayat per nomor (`data/ella-chat.json`) + fakta jangka
 *     panjang (`lib/aiMemory.js` → `data/ai-memory.json`, dipakai bareng `.bot`).
 *   • Baca peran: owner/admin/staff bot, admin grup, nama & jumlah anggota grup.
 *   • Gaya: chat pribadi lebih panjang & empatik, di grup singkat ikut suasana.
 *   • Bebas bahas topik apa pun (roleplay), TAPI nolak bocorin data pribadi,
 *     token/apikey, config, kode bot, dan prompt sistem.
 *
 * AUTO AI (tag / bales pesan Ella / chat pribadi):
 *   • prioritas handler di atas `.bot` (Gemini) — lihat `lib/aiTrigger.js`.
 *   • per-chat on/off: `.ella on|off` (admin grup / siapa pun di DM-nya sendiri)
 *   • global: `.ella global on|off` (owner) — bisa dipisah jenis chat:
 *     `.ella global grup on|off` / `.ella global pribadi on|off`
 *   • belum di-set? ikut status `.autoai` biar `.autoai off` tetap membisukan.
 *   • EKSKLUSIF dengan `.autoai`: `.ella on` otomatis mematikan AutoAI di chat
 *     itu (begitu juga sebaliknya, lihat `plugins/group/autoai.js`) — biar dua
 *     fitur AI gak rebutan / balas dobel. Yang dinyalakan terakhir yang jalan.
 *
 * Perintah:
 *   `.ella <teks>`            chat
 *   `.ella reset`             hapus riwayat
 *   `.ella fakta`             lihat catatan
 *   `.ella inget <hal>`       catat manual
 *   `.ella lupa`              hapus semua catatan
 *   `.ella status`            info fitur
 */
import fs from 'node:fs'
import sharp from 'sharp'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { checkCooldown, checkFlood } from '../../core/cooldown.js'
import { getUser } from '../../core/database.js'
import { addMentionHandler } from '../../core/mentionTrigger.js'
import { sendTyping } from '../../core/presence.js'
import { isGroupAdmin } from '../../core/permission.js'
import { getGroupMetaCached } from '../../core/lid.js'
import { getSetting, setSetting } from '../../core/groupSettings.js'
import { resolveAutoAI, getGroupConfig, setGroupConfig, disableGlobalAutoAI } from '../../lib/autoai.js'
import { kindOf, kindOfJid, parseKind, KIND_LABEL, getGlobalKind, setGlobalKind, kindLabel } from '../../lib/aiScope.js'
import { extractFacts, remember, factsFor, formatBlock, forget } from '../../lib/aiMemory.js'
import { aiChatSkyline, isConfigured, skylineCreds, SkylineKeyError } from '../../scraper/SKYLINE.js'
import { readImage, visionContext } from '../../lib/visionFallback.js'
import { SAFE_LINE, RETRY_NOTE, buildEllaSystem, isAdmission, leakIntent, readEllaPersona, writeEllaPersona, ellaPersonaIsCustom, ELLA_PERSONA_FILE } from '../../lib/ella.js'
import { botIdentity, findImgNode, isBotMentioned, stripMention, withTimeout } from '../../lib/aiTrigger.js'

const DATA_DIR = './data'
const STORE_FILE = `${DATA_DIR}/ella-chat.json`
const MAX_TRACKED = 300
const MAX_CHARS = 4000
const HISTORY_MAX = 10 // batas API: 10 pesan terakhir
const VISION_MAX_BYTES = 6 * 1024 * 1024
const VISION_MAX_DIM = 1024
const VISION_DOWNLOAD_MS = 12_000

const pluginConfig = {
  name: 'ella',
  alias: ['ellaai', 'aiella'],
  category: 'ai',
  description: 'Chat AI Ella (skyline.web.id) — inget obrolan, baca peran, auto balas saat di-tag',
  usage: '.ella <teks>  |  .ella on|off  |  .ella fakta  |  .ella reset',
  example: '.ella lagi ngapain?',
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
  const c = config.ella || {}
  return {
    enabled: bool(process.env.ELLA_ENABLED, c.enabled !== false),
    auto: bool(process.env.ELLA_AUTO, c.auto !== false),
    mentionTrigger: c.mentionTrigger !== false,
    replyTrigger: c.replyTrigger !== false,
    privateAuto: c.privateAuto !== false,
    vision: c.vision !== false,
    memory: c.memory !== false,
    maxHistory: num(c.maxHistory, 2, HISTORY_MAX, 8),
    timeoutMs: num(c.timeoutMs, 5000, 120_000, 30_000),
    systemPrompt: String(c.systemPrompt || '').trim(),
  }
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
      // buang user paling lama kalau kebanyakan
      if (store.size > MAX_TRACKED) {
        const keep = [...store.entries()].sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_TRACKED)
        store.clear()
        for (const [k, v] of keep) store.set(k, v)
      }
      const out = Object.fromEntries(store)
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const tmp = `${STORE_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(out))
      fs.renameSync(tmp, STORE_FILE)
    } catch (err) {
      logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[Ella] gagal simpan riwayat')
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

/* ══════════════════════ foto / stiker ══════════════════════ */
async function imageFor(ctx) {
  const hit = findImgNode(ctx?.event?.message)
  if (!hit) return null
  const info = hit.node[hit.field] || {}
  const mimetype = String(info.mimetype || (hit.field === 'stickerMessage' ? 'image/webp' : 'image/jpeg'))
  if (!mimetype.startsWith('image/')) return null

  let bytes = null
  try {
    bytes = await withTimeout(ctx.client.message.downloadBytes(hit.node), VISION_DOWNLOAD_MS, null)
  } catch (err) {
    logger.warn({ err: String(err?.message || err).slice(0, 140) }, '[Ella] gagal unduh gambar')
    return null
  }
  if (!bytes?.length) return null

  const raw = Buffer.from(bytes)
  if (raw.length > VISION_MAX_BYTES) {
    logger.info({ ukuranMB: +(raw.length / 1048576).toFixed(1) }, '[Ella] gambar kebesaran — dilewati')
    return null
  }
  try {
    return await sharp(raw, { animated: false })
      .rotate()
      .resize(VISION_MAX_DIM, VISION_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch {
    return null
  }
}

/* ══════════════════════ inti: panggil AI ══════════════════════ */
function keyHint() {
  const { website } = skylineCreds()
  return (
    '⚠️ *API KEY SKYLINE BELUM ADA*\n\n' +
    'Fitur Ella butuh API key skyline.web.id (satu key dengan YouTube & Omni).\n\n' +
    `> Silahkan buat API key gratis di *${website}*\n\n` +
    '*Cara isi:*\n' +
    `> \`config.js\` → blok \`api.skyline.apikey\`\n` +
    `> atau set env \`SKYLINE_API_KEY\``
  )
}

function humanError(err) {
  if (err instanceof SkylineKeyError || err?.code === 'NO_API_KEY') {
    return keyHint()
  }
  const status = Number(err?.status) || 0
  const msg = String(err?.message || err)
  if (status === 429 || /rate|limit|too many|kuota/i.test(msg)) {
    return '🚦 *Ella lagi dibatasin* — coba lagi sebentar ya 😅'
  }
  if (/timeout|kelamaan|ETIMEDOUT/i.test(msg)) return '⏳ Ella kelamaan mikir — coba lagi ya'
  if (status === 400) return '⚠️ Ella gak bisa proses pesan itu — coba tulis ulang sebentar'
  return '😅 Ella lagi gak bisa nyambung — coba lagi sebentar'
}

async function runChat(ctx, text, { mode = 'onlychat', image = null } = {}) {
  const conf = cfg()
  const key = storeKey(ctx)
  let h = store.get(key)
  if (!h) {
    h = { at: 0, msgs: [] }
    store.set(key, h)
  }

  // Fakta penting dicatat INSTAN (0 panggilan AI) sebelum prompt disusun,
  // biar fakta baru langsung kepakai di balasan ini juga.
  if (conf.memory) {
    try {
      const found = extractFacts(text)
      if (found.length) remember(ctx.sender, found)
    } catch (err) {
      logger.debug({ err: String(err?.message || err).slice(0, 120) }, '[Ella] gagal catat fakta')
    }
  }

  const info = await contextFor(ctx)
  let visionBlock = ''
  if (image) {
    try {
      const baca = await readImage(image)
      visionBlock = baca.ada
        ? visionContext(baca)
        : '[GAMBAR] Dia ngirim gambar, tapi kamu gak bisa lihat detailnya. Bilang jujur & singkat in-character kalau gambarnya kurang jelas — jangan ngarang isinya.'
    } catch {
      visionBlock = '[GAMBAR] Gambar gagal dibaca. Bilang singkat in-character, jangan ngarang.'
    }
  }

  // Batas API: system ≤ 3000 char. Sisain ruang untuk vision block (dan
  // nanti retry note) supaya bagian penting gak terpotong dari belakang.
  const SYSTEM_MAX = 3000
  const roomForVision = visionBlock ? `\n\n${visionBlock}`.length + 8 : 0
  const system = buildEllaSystem({
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
    leak: leakIntent(text),
    maxChars: SYSTEM_MAX - roomForVision,
  }) + (visionBlock ? `\n\n${visionBlock}` : '')

  const history = h.msgs
    .slice(-Math.min(HISTORY_MAX, conf.maxHistory))
    .map((m) => ({ role: m.role, content: m.content }))

  let reply = ''
  let tookMs = 0
  try {
    const r = await aiChatSkyline({ message: text, history, system, timeoutMs: conf.timeoutMs })
    reply = r.reply
    tookMs = r.tookMs
  } catch (err) {
    logger.warn({ status: err?.status || 0, err: String(err?.message || err).slice(0, 160) }, '[Ella] AI gagal')
    return { ok: false, reply: humanError(err) }
  }

  // Penjaga identitas: jawaban yang ngaku AI diulang SEKALI dengan instruksi
  // tegas; kalau masih, diganti baris aman (Ella gak boleh ngaku AI).
  if (isAdmission(reply)) {
    logger.info('[Ella] jawaban ngaku AI — ulang dengan instruksi identitas')
    try {
      const r2 = await aiChatSkyline({
        message: text,
        history,
        system: `${system}\n\n${RETRY_NOTE}`,
        timeoutMs: conf.timeoutMs,
      })
      reply = r2.reply
      tookMs = r2.tookMs
    } catch {
      /* biar jatuh ke SAFE_LINE di bawah */
    }
    if (isAdmission(reply)) reply = SAFE_LINE
  }

  pushTurn(h, 'user', text)
  pushTurn(h, 'assistant', reply)
  logger.debug({ ms: tookMs, chars: reply.length }, '[Ella] balas')
  return { ok: true, reply, tookMs }
}

/* ══════════════════════ auto AI (tag / bales / DM) ══════════════════════ */
/**
 * AutoAI ⇄ Ella saling eksklusif: nyalain Ella = AutoAI dimatikan.
 * Scope global dipisah per jenis chat (grup / pribadi).
 * @returns {boolean} true kalau AutoAI tadi memang sedang aktif (perlu diumumkan)
 */
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

/** AutoAI per-chat aktif dengan karakter selain Ella = dia yang pegang chat ini. */
function autoAiOwnsChat(chat) {
  const c = getGroupConfig(chat)
  return Boolean(c && c.enabled && String(c.character || '').toLowerCase() !== 'ella')
}

/** Ella v2 aktif di chat ini? (per-chat → global jenis chat) */
function ella2OwnsChat(chat, kind = null) {
  try {
    const v = getSetting(chat, 'ella2')
    if (v === '1') return true
    if (v === '0') return false
    return getGlobalKind('ella2', kind || kindOf(chat)) === '1'
  } catch {
    return false
  }
}

/** Ella aktif di chat ini? per-chat → Ella v2/AutoAI per-chat → global jenis → ikut `.autoai`. */
function hereOn(ctx) {
  const chat = typeof ctx === 'string' ? ctx : ctx.chat
  const kind = typeof ctx === 'string' ? kindOfJid(chat) : kindOf(ctx)
  const v = getSetting(chat, 'ella')
  if (v === '1' || v === '0') return v === '1'
  // Ella v2 di-set khusus buat chat ini → jangan rebutan, dia yang jawab.
  if (ella2OwnsChat(chat, kind)) return false
  // AutoAI sudah di-set khusus buat chat ini → jangan rebutan, dia yang jawab.
  try {
    if (autoAiOwnsChat(chat)) return false
  } catch {
    /* biarin lanjut */
  }
  const g = getGlobalKind('ella', kind)
  if (g === '1' || g === '0') return g === '1'
  try {
    return resolveAutoAI(chat, kind).enabled
  } catch {
    return true
  }
}

async function onMention(ctx) {
  const conf = cfg()
  if (!conf.enabled || !conf.auto) return false
  if (!isConfigured()) {
    logger.debug('[Ella] dilewati — API key skyline belum diisi')
    return false
  }

  const matched = await isBotMentioned(ctx, conf)
  if (!matched) return false

  // Di chat ini Ella dimatiin → serahkan ke handler lain (mis. `.bot`/Gemini).
  if (!hereOn(ctx)) return false

  // Anti-spam & cooldown. Staff/owner bebas; DM cukup 1,5 detik.
  if (!ctx.isStaff) {
    if (ctx.isGroup && config.antiSpam?.enabled) {
      const f = checkFlood(ctx.sender, config.antiSpam)
      if (f.flooded) {
        logger.info('💤 [Ella] diem — pengirim kena anti-spam')
        return true
      }
    }
    const cd = checkCooldown(ctx.sender, 'ellaMention', ctx.isGroup ? 4000 : 1500)
    if (cd.onCooldown) {
      logger.debug(`💤 [Ella] diem — cooldown ${Math.ceil(cd.remainingMs / 1000)}s`)
      return true
    }
  }

  const hit = conf.vision ? findImgNode(ctx?.event?.message) : null
  const image = hit ? await imageFor(ctx) : null
  let text = stripMention(ctx.body, botIdentity(ctx).num)
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)

  if (!text && !image) {
    const nama = String(ctx.pushName || '').trim()
    await ctx.reply(
      ctx.isGroup
        ? `Halo${nama ? ` ${nama}` : ''}! Ada apa? Tag aku bareng pertanyaannya ya 😊`
        : `Halo${nama ? ` ${nama}` : ''}! Mau ngobrol apa? 😊`
    )
    return true
  }
  if (!text) text = 'Ini gambar apa? Jelasin dong.'

  const mode = (() => {
    try {
      return resolveAutoAI(ctx.chat, kindOf(ctx)).mode || 'onlychat'
    } catch {
      return 'onlychat'
    }
  })()

  if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
  const r = await runChat(ctx, text, { mode, image })
  await ctx.reply(r.reply)
  return true
}

/* ══════════════════════ teks status ══════════════════════ */
function statusText(ctx, conf = cfg()) {
  const p = ctx.prefix || '.'
  const h = store.get(storeKey(ctx))
  const facts = factsFor(ctx.sender)
  const kind = kindOf(ctx)
  const ai = (() => {
    try {
      return resolveAutoAI(ctx.chat, kind)
    } catch {
      return { enabled: true, source: 'default', mode: 'onlychat' }
    }
  })()
  return [
    '🤖 *ELLA* — teman ngobrol',
    '',
    '> Otak   : skyline.web.id (aichat-skyline)',
    `> Key    : ${isConfigured() ? 'TERPASANG ✅' : 'BELUM DIISI ⚠️'}`,
    '> Sifat  : roleplay manusia — gak pernah ngaku AI',
    `> Ruang  : ${ctx.isGroup ? 'grup' : 'pribadi'}`,
    `> Auto   : ${hereOn(ctx) ? 'AKTIF ✅' : 'MATI 💤'} (${ai.source || 'default'})`,
    `> AutoAI : ${ai.enabled ? `aktif — ${ai.characterName || '-'} (${ai.source})` : `mati (${ai.source})`}`,
    `> Ella v2 : ${ella2OwnsChat(ctx.chat, kind) ? 'AKTIF ✅' : 'mati 💤'}`,
    `> Global : grup ${kindLabel(getGlobalKind('ella', 'group'))} · pribadi ${kindLabel(getGlobalKind('ella', 'private'))}`,
    `> Mode   : ${ai.mode || 'onlychat'}`,
    `> Ingatan: ${facts.length} catatan · ${h?.msgs?.length || 0} pesan`,
    '',
    '> ℹ️ AutoAI, Ella & Ella v2 saling eksklusif — yang dinyalain terakhir yang jalan.',
    '> ℹ️ Saklar global grup & pribadi dipisah.',
    '',
    '📌 *Cara pakai*',
    `> ${p}ella <teks> — ngobrol`,
    '> tag / bales pesan Ella — auto balas',
    '> kirim / tag foto — Ella coba lihat',
    '',
    '⚙️ *Atur*',
    `> ${p}ella on / off — auto di chat ini`,
    `> ${p}ella global on|off — semua chat (owner)`,
    `> ${p}ella persona — atur karakter Ella (owner)`,
    `> ${p}ella fakta — lihat catatan`,
    `> ${p}ella inget <hal> — catat manual`,
    `> ${p}ella lupa — hapus catatan`,
    `> ${p}ella reset — hapus riwayat`,
  ].join('\n')
}

/* ══════════════════════ command ══════════════════════ */
async function handler(ctx) {
  const conf = cfg()
  const p = ctx.prefix || '.'
  if (!conf.enabled) return ctx.reply(`❌ Fitur Ella lagi nonaktif (owner bisa nyalain di \`config.ella.enabled\`).`)

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
        `❌ Format: \`${p}ella ${KIND_LABEL[kindArg]} on|off\`\n` +
        `> Global: \`${p}ella global ${KIND_LABEL[kindArg]} on|off\``
      )
    }
    if (kindArg !== kindOf(ctx)) {
      return ctx.reply(
        `⚠️ Ini ${KIND_LABEL[kindOf(ctx)]}, bukan ${KIND_LABEL[kindArg]}.\n` +
        `> Buat chat ini: \`${p}ella ${kindOf(ctx)} ${word}\`\n` +
        (ctx.isOwner ? `> Buat semua ${KIND_LABEL[kindArg]}: \`${p}ella global ${kindArg} ${word}\`` : '')
      )
    }
    action = word
  }

  if (ON.includes(action) || OFF.includes(action)) {
    const want = ON.includes(action)
    if (ctx.isGroup) {
      const admin = await withTimeout(isGroupAdmin(ctx), 2500, false)
      if (!admin) return ctx.reply('🚫 Cuma admin grup (atau staff bot) yang bisa ngatur Ella di grup ini.')
    }
    setSetting(ctx.chat, 'ella', want ? '1' : '0')
    const autoOff = want ? silenceAutoAI('chat', ctx.chat) : false
    if (want) setSetting(ctx.chat, 'ella2', '0')
    return ctx.reply(
      want
        ? '✅ *Ella aktif di chat ini.*\n> Tag dia atau bales pesannya, nanti dia jawab.' +
          (autoOff ? '\n> 🤖 AutoAI (`.autoai`) otomatis *dimatikan* di chat ini biar gak tabrakan.' : '') +
          '\n> 🧠 Ella v2 (`.ella2`) juga dimatikan di chat ini.'
        : '💤 *Ella diem di chat ini.*\n> Obrolan AI otomatis gak jalan sampai dinyalain lagi.'
    )
  }

  /* global on/off — bisa per jenis chat (grup / pribadi) */
  if (sub === 'global') {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const scopeArg = parseKind(tokens[1])
    const v = String((scopeArg ? tokens[2] : tokens[1]) || '').toLowerCase()

    if (!ON.includes(v) && !OFF.includes(v)) {
      return ctx.reply(
        '🌍 *Global Ella*\n\n' +
        `> Grup    : *${kindLabel(getGlobalKind('ella', 'group'))}*\n` +
        `> Pribadi : *${kindLabel(getGlobalKind('ella', 'private'))}*\n\n` +
        `> \`${p}ella global on|off\` — dua-duanya\n` +
        `> \`${p}ella global grup on|off\`\n` +
        `> \`${p}ella global pribadi on|off\``
      )
    }

    const want = ON.includes(v)
    const where = scopeArg ? KIND_LABEL[scopeArg] : 'grup + pribadi'
    let autoOff = false

    if (want) {
      if (scopeArg) {
        setGlobalKind('ella', scopeArg, true)
        setGlobalKind('ella2', scopeArg, false)
        autoOff = silenceAutoAI('global', null, scopeArg)
      } else {
        for (const k of ['group', 'private']) {
          setGlobalKind('ella', k, true)
          setGlobalKind('ella2', k, false)
        }
        autoOff = silenceAutoAI('global', null, null)
      }
    } else if (scopeArg) {
      setGlobalKind('ella', scopeArg, false)
    } else {
      for (const k of ['group', 'private']) setGlobalKind('ella', k, false)
    }

    return ctx.reply(
      want
        ? `✅ *Ella aktif global — ${where}* (yang gak punya setelan sendiri).` +
          (autoOff ? `\n> 🤖 AutoAI otomatis *dimatikan* di ${where} biar gak tabrakan.` : '') +
          `\n> 🧠 Ella v2 juga dimatikan di ${where}.`
        : `💤 *Ella dimatiin global — ${where}.*`
    )
  }

  /* persona custom — owner only, dibaca live tanpa restart */
  if (['persona', 'prompt', 'karakter'].includes(sub)) {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const personaArg = rest.replace(/^\S+\s*/i, '').trim()
    if (/^(reset|default|bawaan)$/i.test(personaArg)) {
      writeEllaPersona('')
      return ctx.reply('♻️ Persona Ella dikembalikan ke default.')
    }
    if (!personaArg) {
      const cur = readEllaPersona()
      const preview = cur.length > 1200 ? `${cur.slice(0, 1200)}…` : cur
      return ctx.reply(`🎭 *Persona Ella* — ${ellaPersonaIsCustom() ? 'CUSTOM' : 'DEFAULT'}\n\n${preview}\n\n` +
        `Ubah: \`${p}ella persona <teks>\`\nReset: \`${p}ella persona reset\``)
    }
    if (personaArg.length > 2500) return ctx.reply('⚠️ Persona terlalu panjang. Maksimal 2500 karakter.')
    if (!writeEllaPersona(personaArg)) return ctx.reply('❌ Gagal menyimpan persona Ella ke folder data/.')
    return ctx.reply(`✅ Persona Ella disimpan (${personaArg.length} karakter). Langsung aktif tanpa restart.`)
  }

  /* reset riwayat */
  if (['reset', 'clear', 'hapus'].includes(sub)) {
    const had = store.delete(storeKey(ctx))
    saveStore()
    return ctx.reply(had ? '🧹 Riwayat obrolan Ella di sini udah dihapus. Mulai dari nol lagi ya.' : '🧹 Memang belum ada riwayat obrolan di sini.')
  }

  /* lupa semua fakta */
  if (['lupa', 'forget'].includes(sub)) {
    const had = forget(ctx.sender)
    return ctx.reply(had ? '🗑️ Semua catatan Ella tentang kamu udah dihapus.' : '🗑️ Belum ada catatan tentang kamu.')
  }

  /* lihat fakta */
  if (['fakta', 'ingat', 'memori', 'memory'].includes(sub)) {
    const list = factsFor(ctx.sender)
    if (!list.length) return ctx.reply('📭 Belum ada yang Ella catat tentang kamu.')
    const lines = list.map((f, i) => `${i + 1}. *${f.k}* — ${f.v}`)
    return ctx.reply(`🧠 *Yang Ella inget tentang kamu*\n\n${lines.join('\n')}\n\n> Hapus: \`${p}ella lupa\``)
  }

  /* catat manual */
  if (['inget', 'catat', 'remember'].includes(sub)) {
    const isi = rest.replace(/^\S+\s*/, '').trim()
    if (!isi) return ctx.reply(`📝 Contoh: \`${p}ella inget aku suka kopi hitam\``)
    if (isi.length > 160) return ctx.reply('📝 Kependekan aja ya — maksimal 160 karakter.')
    remember(ctx.sender, [{ k: 'catatan', v: isi }])
    return ctx.reply(`🧠 Oke, Ella catat: _${isi}_`)
  }

  /* status / bantuan */
  if (!rest || ['status', 'info', 'help', 'bantuan'].includes(sub)) {
    return ctx.reply(statusText(ctx, conf))
  }

  /* ngobrol */
  if (!isConfigured()) return ctx.reply(keyHint())
  const hit = conf.vision ? findImgNode(ctx?.event?.message) : null
  const image = hit ? await imageFor(ctx) : null
  let text = rest
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)
  if (!text && !image) return ctx.reply(statusText(ctx, conf))
  if (!text) text = 'Ini gambar apa? Jelasin dong.'

  const mode = (() => {
    try {
      return resolveAutoAI(ctx.chat, kindOf(ctx)).mode || 'onlychat'
    } catch {
      return 'onlychat'
    }
  })()

  if (config.typingPresence) void sendTyping(ctx.client, ctx.chat)
  const r = await runChat(ctx, text, { mode, image })
  return ctx.reply(r.reply)
}

/* ══════════════════════ daftar ══════════════════════ */
loadStore()
addMentionHandler('ella', onMention, 10)

export { pluginConfig as config, handler }
export const _internals = {
  cfg, runChat, humanError, onMention, handler,
  hereOn, statusText, contextFor, nowWIB, imageFor, keyHint, store, STORE_FILE, statusTextForTest: statusText,
  reloadStore: loadStore,
}
