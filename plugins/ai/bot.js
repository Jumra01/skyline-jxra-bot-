/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bot.js — Chat AI `.bot`, gaya ella-zen (skyline-md): fetch langsung
 *          `https://opencode.ai/zen/v1/chat/completions` pake API key,
 *          persona SYSTEM inline, memori per user, react 🕕 → ✅/☢.
 *
 * Dua jalur (config.ai.mode):
 *  'auto' (default) — API langsung (gaya skyline-md) kalau ada key;
 *                     kalau ditolak server OpenCode (FreeTier) otomatis
 *                     pindah ke CLI lokal kalau ada.
 *  'api'  — selalu API langsung, butuh apikey (model berbayar/aktif).
 *  'cli'  — selalu CLI OpenCode (`opencode api ...`) — gratis, tanpa key.
 *
 * Catatan riset 2026-10: model `*-free` DITOLAK 403 FreeTierError kalau
 * dipanggil dari luar OpenCode (endpoint zen & inference sama-sama nolak,
 * diuji pake key Console valid) — makanya ada fallback CLI yang lolos
 * (github anomalyco/opencode #49621/#49723/#50627).
 *
 * Persona ada di `.opencode/agents/botchat.md` (dipakai dua-duanya: isi file
 * jadi SYSTEM prompt jalur API, jadi agent persona jalur CLI). File itu
 * di-copy ke workspace netral /tmp biar AGENTS.md repo gak ke-inject.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { getUser } from '../../core/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const AGENT_SRC = join(REPO_ROOT, '.opencode', 'agents', 'botchat.md')
const CTX_DIR = join(tmpdir(), 'skyline-botchat-ctx') // workspace netral (di luar repo)
const AGENT_DST = join(CTX_DIR, '.opencode', 'agents', 'botchat.md')

const pluginConfig = {
  name: 'bot',
  alias: ['botchat', 'chatbot', 'ngobrol'],
  category: 'ai',
  description: 'Ngobrol sama AI — hafal nama & riwayat chat kamu',
  usage: '.bot <pesan>\n.bot reset',
  example: '.bot halo, kenalin aku Jumra',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 8,
  energi: 2,
  isEnabled: true,
}

/* ══════════════════ konfigurasi ══════════════════ */
function cfg() {
  const c = config.ai || {}
  const model = String(process.env.OPENCODE_AI_MODEL || c.model || 'deepseek-v4.1-flash-free')
  const modeRaw = String(process.env.OPENCODE_AI_MODE || c.mode || 'auto').toLowerCase()
  return {
    enabled: c.enabled !== false,
    mode: ['auto', 'cli', 'api'].includes(modeRaw) ? modeRaw : 'auto',
    apikey: String(process.env.OPENCODE_API_KEY || c.apikey || '').trim(),
    baseUrl: String(process.env.OPENCODE_AI_BASE || c.baseUrl || 'https://opencode.ai/zen/v1').replace(/\/+$/, ''),
    model,
    fallbackModels: (Array.isArray(c.fallbackModels) ? c.fallbackModels : [])
      .map((m) => String(m))
      .filter((m) => m && m !== model),
    maxHistory: Math.max(2, Number(c.maxHistory) || 15),
    maxChars: Math.max(500, Number(c.maxChars) || 12000),
    timeoutMs: Math.max(10_000, Number(c.timeoutMs) || 120_000),
  }
}

/* ══════════════════ memori per user (gaya ella-zen) ══════════════════ */
const memory = new Map() // jid -> [{ role: 'user'|'assistant', content }]
let session = null // { id, model } — jalur CLI
let binCache = null
let apiBlocked = null // 'FreeTier' | 'ModelDisabled' — ditandai sekali, gak dicoba lagi

function getHistory(sender) {
  if (!memory.has(sender)) memory.set(sender, [])
  return memory.get(sender)
}

function trimHistory(arr, max) {
  if (arr.length > max) arr.splice(0, arr.length - max)
}

/* ══════════════════ binary opencode (jalur CLI) ══════════════════ */
function findBin() {
  if (binCache) return binCache
  const cands = []
  if (process.env.OPENCODE_BIN) cands.push(process.env.OPENCODE_BIN)
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (dir) cands.push(join(dir, 'opencode'))
  }
  cands.push(join(homedir(), '.local/bin/opencode'), join(homedir(), '.opencode/bin/opencode'))
  const found = cands.find((p) => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  })
  if (found) binCache = found
  return found || null
}

/* ══════════════════ persona & profil user ══════════════════ */
let personaCache = null
function personaText() {
  if (personaCache) return personaCache
  try {
    const raw = readFileSync(AGENT_SRC, 'utf8')
    personaCache = raw.replace(/^---[\s\S]*?---\s*/, '').trim() || DEFAULT_PERSONA
  } catch {
    personaCache = DEFAULT_PERSONA
  }
  return personaCache
}
const DEFAULT_PERSONA =
  'Kamu adalah "Bot", teman ngobrol virtual di WhatsApp. BUKAN asisten coding.\n' +
  'Balas bahasa Indonesia gaul, santai, 1-3 kalimat, tanpa markdown.'

function roleLabel(ctx) {
  if (ctx.isOwner) return 'OWNER bot'
  if (ctx.role === 'admin') return 'ADMIN bot'
  if (ctx.isStaff) return 'STAFF bot'
  if (ctx.isAdmin) return 'ADMIN grup'
  return 'MEMBER'
}

function profileOf(ctx) {
  let user = null
  try {
    user = getUser?.(ctx.sender) || null
  } catch {}
  const name = (ctx.pushName || user?.name || '').trim() || 'Tanpa Nama'
  const lines = [
    'PROFIL LAWAN BICARA:',
    `- Nama: ${name}`,
    `- Nomor: ${ctx.senderNumber || '-'}`,
    `- Peran: ${roleLabel(ctx)}`,
    `- Chat: ${ctx.isGroup ? 'grup WhatsApp' : 'chat pribadi'}`,
  ]
  if (Number(user?.command_count)) lines.push(`- Sudah pakai ${user.command_count} command bot ini`)
  return { name, text: lines.join('\n') }
}

// SYSTEM prompt jalur API = persona + profil (biar tetap "kenal" lawan bicara)
function systemText(ctx) {
  return `${personaText()}\n\n${profileOf(ctx).text}\n\nBalas HANYA teks polos (tanpa nama penerima, tanpa bintang/heading).`
}

// prompt tunggal jalur CLI (server lokal gak nerima messages[] dari kita)
function buildPrompt(ctx, hist) {
  const { name } = profileOf(ctx)
  const lines = [profileOf(ctx).text, '', 'RIWAYAT CHAT (paling baru di bawah):']
  if (!hist.length) lines.push('(belum ada — ini pesan pertama)')
  for (const m of hist) {
    const who = m.role === 'user' ? name : 'Kamu (bot)'
    lines.push(`${who}: ${String(m.content).slice(0, 600)}`)
  }
  lines.push('')
  lines.push(`Balas PESAN TERAKHIR dari ${name} saja. Balasan HANYA teks polos`)
  lines.push('(tanpa nama penerima, tanpa bintang/heading), 1-3 kalimat, bahasa gaul.')
  return lines.join('\n')
}

/* ══════════════════ JALUR 1: API langsung (gaya ella-zen) ══════════════════ */
async function callZen(system, messages, model, c) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), c.timeoutMs)
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + c.apikey,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        temperature: 0.95,
        max_tokens: 500,
      }),
      signal: ctl.signal,
    })

    const raw = await res.text()
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {}

    if (!res.ok) {
      const msg = body?.error?.message || body?.message || raw.slice(0, 150) || `HTTP ${res.status}`
      const e = new Error(`API error ${res.status}: ${msg}`)
      e.status = res.status
      e.code = res.status === 401 ? 'EKEY' : 'EAPI'
      throw e
    }

    const text = body?.choices?.[0]?.message?.content?.trim()
    if (!text) {
      const e = new Error('model balas kosong')
      e.code = 'EEMPTY'
      throw e
    }
    return text
  } catch (e) {
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
      const t = new Error(`timeout ${c.timeoutMs}ms nunggu OpenCode Zen`)
      t.code = 'ETIMEDOUT'
      throw t
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/* ══════════════════ JALUR 2: CLI OpenCode lokal (free tier) ══════════════════ */
function parseBody(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? v : null
  } catch {}
  for (const line of s.split('\n').reverse()) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const v = JSON.parse(t)
      if (v && typeof v === 'object') return v
    } catch {}
  }
  return null
}

function runApi(method, apiPath, payload, timeoutMs) {
  return new Promise((res, rej) => {
    let bin
    try {
      bin = findBin()
      if (!bin) throw Object.assign(new Error('binary `opencode` gak ketemu di PATH'), { code: 'ENOENT' })
    } catch (e) {
      return rej(e)
    }
    const args = ['api', method, apiPath]
    if (payload) args.push('-d', JSON.stringify(payload))

    let child
    try {
      child = spawn(bin, args, { cwd: REPO_ROOT, env: process.env })
    } catch (e) {
      return rej(e)
    }

    let out = ''
    let errOut = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {}
      rej(Object.assign(new Error(`timeout ${timeoutMs}ms nunggu OpenCode`), { code: 'ETIMEDOUT' }))
    }, timeoutMs)

    child.stdout?.on('data', (d) => {
      out += d
    })
    child.stderr?.on('data', (d) => {
      errOut += d
    })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rej(e)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const body = parseBody(out) || parseBody(errOut)
      if (body) {
        if (body._tag) {
          const e = new Error(String(body.message || body._tag))
          e.tag = body._tag
          e.code = 'EAPI'
          return rej(e)
        }
        return res(body)
      }
      const msg = (out + '\n' + errOut).trim() || `opencode api exit ${code}`
      rej(Object.assign(new Error(msg.slice(0, 300)), { code: code === 0 ? 'EEMPTY' : 'EEXIT' }))
    })
  })
}

function ensureWorkspace() {
  try {
    mkdirSync(dirname(AGENT_DST), { recursive: true })
    if (!existsSync(AGENT_DST) || readFileSync(AGENT_SRC, 'utf8') !== readFileSync(AGENT_DST, 'utf8')) {
      copyFileSync(AGENT_SRC, AGENT_DST)
    }
  } catch (e) {
    logger.warn({ err: String(e.message || e) }, '[bot] copy agent chat gagal')
  }
}

async function createSession(model) {
  ensureWorkspace()
  const body = await runApi(
    'post',
    '/api/session',
    {
      title: 'skyline-botchat',
      agent: 'botchat',
      model: { providerID: 'opencode', id: model },
      location: { directory: CTX_DIR },
    },
    60_000
  )
  const id = body?.data?.id
  if (!id) throw new Error('gak dapet session id: ' + JSON.stringify(body).slice(0, 150))
  return { id, model }
}

async function callCli(prompt, model, c) {
  if (!session || session.model !== model) session = await createSession(model)
  const body = await runApi('post', `/api/session/${session.id}/generate`, { prompt: prompt.slice(0, c.maxChars) }, c.timeoutMs)
  let text = body?.data?.text
  if (typeof text !== 'string' || !text.trim()) {
    const retry = await runApi(
      'post',
      `/api/session/${session.id}/generate`,
      { prompt: prompt.slice(0, c.maxChars) + '\n\n(Jangan kosong — tulis balasanmu sekarang.)' },
      c.timeoutMs
    )
    text = retry?.data?.text
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw Object.assign(new Error('model balas kosong'), { code: 'EEMPTY' })
  }
  return text.trim()
}

/* ══════════════════ dispatcher jalur ══════════════════ */
function isRecoverable(e) {
  return e?.code !== 'ENOENT' && e?.code !== 'ENOKEY' && e?.code !== 'EKEY'
}

function markApiBlocked(msg) {
  if (/free tier|FreeTier/i.test(msg)) apiBlocked = 'FreeTier'
  else if (/Model access is disabled/i.test(msg)) apiBlocked = 'ModelDisabled'
}

async function askModel(ctx, hist) {
  const c = cfg()
  const models = [c.model, ...c.fallbackModels]
  const bin = findBin()

  if (c.mode === 'api' && !c.apikey) {
    throw Object.assign(new Error('mode api butuh API key OpenCode (config.ai.apikey / env OPENCODE_API_KEY)'), { code: 'ENOKEY' })
  }

  // auto: API dulu (gaya skyline-md) kalau ada key & belum ketahuan ditolak;
  // begitu kena FreeTier/ModelDisabled → pindah CLI (sekali tandai, gak dicoba lagi)
  let useApi = c.mode === 'api' || (c.mode === 'auto' && !!c.apikey && !apiBlocked)
  if (!useApi && c.mode === 'auto' && !bin && !c.apikey) {
    throw Object.assign(new Error('gak ada jalur: CLI OpenCode gak ada & API key belum diisi'), { code: 'ENOKEY' })
  }
  if (!useApi && c.mode === 'auto' && !bin && c.apikey) useApi = true // API mentok, biar error-nya jelas

  logger.debug({ mode: useApi ? 'api' : 'cli', model: c.model, bin: bin || '-' }, '[bot] jalur dipakai')

  let lastErr = null
  for (const model of models) {
    try {
      if (useApi) return await callZen(systemText(ctx), hist, model, c)
      return await callCli(buildPrompt(ctx, hist), model, c)
    } catch (e) {
      lastErr = e
      session = null
      const msg = String(e?.message || e)
      logger.warn({ model, mode: useApi ? 'api' : 'cli', err: msg.slice(0, 200) }, '[bot] generate gagal')

      if (useApi) {
        markApiBlocked(msg)
        if (apiBlocked && bin && c.mode !== 'api') {
          // Free tier ditolak dari luar → langsung pindah CLI pakai model yang sama
          logger.info('[bot] API ditolak server OpenCode → fallback ke CLI lokal')
          useApi = false
          continue
        }
      }
      if (!isRecoverable(e)) throw e
    }
  }
  throw lastErr || new Error('model gak tersedia')
}

/* ══════════════════ pesan bantuan & error ══════════════════ */
function helpText(ctx) {
  const c = cfg()
  const p = ctx.prefix || '.'
  const hist = getHistory(ctx.sender)
  const name = profileOf(ctx).name
  const bin = findBin()
  const jalur = c.mode === 'cli' ? 'CLI OpenCode' : c.mode === 'api' ? 'API langsung' : c.apikey && !apiBlocked ? 'API langsung' : bin ? 'CLI OpenCode' : 'API langsung'
  return (
    '🤖 *SKYLINE BOT — NGOBROL AI*\n\n' +
    'Ngobrol sama AI. Dia hafal nama & riwayat chat kamu.\n\n' +
    '*Cara pakai:*\n' +
    `> ${p}bot halo, kenalin aku ${name}\n` +
    `> ${p}bot lagi ngapain?\n` +
    `> ${p}bot reset — hapus memori chat kamu\n\n` +
    `*Model:* ${c.model} (OpenCode${c.apikey ? '' : ' · gratis'})\n` +
    `*Jalur:* ${jalur}\n` +
    `*Memori:* ${hist.length}/${c.maxHistory} pesan`
  )
}

function humanError(e) {
  const msg = String(e?.message || e)
  if (e?.code === 'ENOENT') {
    return (
      '🔧 *OpenCode gak ada di server ini*\n\n' +
      'Fitur `.bot` butuh CLI OpenCode (`opencode`) buat model free.\n' +
      'Install 1 perintah (gak butuh login):\n' +
      '> curl -fsSL https://opencode.ai/install | bash\n\n' +
      'Atau isi `ai.apikey` di config + `ai.mode: \'api\'` (butuh model berbayar aktif).'
    )
  }
  if (e?.code === 'ENOKEY') {
    return (
      '🔑 *API key OpenCode belum diisi*\n\n' +
      'Isi `ai.apikey` di config atau env `OPENCODE_API_KEY`.\n' +
      'Cara gratis (tanpa key): install CLI OpenCode di server —\n' +
      '> curl -fsSL https://opencode.ai/install | bash'
    )
  }
  if (e?.code === 'EKEY' || /invalid api key|unauthorized|API error 401/i.test(msg)) {
    return '🔑 *API key ditolak* (401) — key expired/salah. Cek `ai.apikey` / env `OPENCODE_API_KEY`.'
  }
  if (/Model access is disabled/i.test(msg)) {
    return (
      '💳 *Model gak aktif di workspace Console* ("Model access is disabled").\n' +
      'Key valid tapi modelnya belum diaktifkan (butuh billing di Console).\n' +
      'Sementara pakai cara gratis: install CLI OpenCode —\n' +
      '> curl -fsSL https://opencode.ai/install | bash'
    )
  }
  if (/free tier|FreeTier/i.test(msg)) {
    return (
      '🚫 *Free tier ditolak dari luar OpenCode* — model `*-free` cuma mau dipanggil ' +
      'lewat aplikasi/CLI OpenCode (kebijakan anti-abuse mereka).\n' +
      'Solusinya install CLI: `curl -fsSL https://opencode.ai/install | bash`.'
    )
  }
  if (e?.code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return '⏱️ *AI lambat balas* — server OpenCode lagi sibuk. Coba kirim lagi ya.'
  }
  if (/ConnectionRefused|ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg)) {
    return '🔌 *Koneksi ke OpenCode gak nyambung* — cek jaringan server, lalu ulangi.'
  }
  if (e?.code === 'EEMPTY' || /balas kosong/i.test(msg)) {
    return '😶 AI gak ngasih balasan. Coba ulangi pertanyaannya ya.'
  }
  return '❌ *Gagal ngobrol* — ' + msg.slice(0, 160)
}

/* ══════════════════ handler ══════════════════ */
async function handler(ctx) {
  const c = cfg()
  const raw = String(ctx.text || '').trim()
  const p = ctx.prefix || '.'

  if (!c.enabled) return ctx.reply('⏸️ Fitur `.bot` lagi dimatikan (config → `ai.enabled: false`).')

  if (!raw) return ctx.reply(helpText(ctx))

  if (/^(reset|hapus|clear|lupa|forget)$/i.test(raw)) {
    memory.set(ctx.sender, [])
    return ctx.reply(
      '🧹 *Memori chat dihapus*\n\n> Aku lupa percakapan sebelumnya sama kamu.\n' + `Lanjut ngobrol: ${p}bot halo, kenalin aku lagi`
    )
  }

  const hist = getHistory(ctx.sender)
  hist.push({ role: 'user', content: raw })
  trimHistory(hist, c.maxHistory)

  try {
    ctx.react('🕕')?.catch?.(() => {})
  } catch {}

  let reply
  try {
    reply = await askModel(ctx, hist)
  } catch (e) {
    try {
      await ctx.react('☢')
    } catch {}
    return ctx.reply(humanError(e))
  }

  hist.push({ role: 'assistant', content: reply })
  trimHistory(hist, c.maxHistory)

  const out = reply.length > 4000 ? reply.slice(0, 4000) + '…' : reply
  await ctx.reply(out)
  try {
    await ctx.react('✅')
  } catch {}
}

export { pluginConfig as config, handler }
