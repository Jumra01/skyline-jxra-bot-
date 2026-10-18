/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bot.js — Chat AI `.bot`, model free OpenCode Zen (deepseek-v4.1-flash-free)
 *
 * Alur: spawn `opencode api post /api/session/{id}/generate` (API HTTP resmi
 * OpenCode, jalan di server lokal) → model free → balasan ke chat.
 *
 * Kenapa lewat server lokal & bukan langsung ke opencode.ai: model `*-free`
 * DITOLAK 403 FreeTierError kalau dipanggil dari luar OpenCode (anti-abuse —
 * lihat github anomalyco/opencode #49621 / #50627). Request yang keluar dari
 * dalam OpenCode sendiri lolos, cost $0 (gak butuh API key sama sekali).
 *
 * Persona chat ada di `.opencode/agents/botchat.md`, di-copy ke workspace
 * netral di /tmp biar AGENTS.md repo ini gak ikut ke-inject ke context model.
 * Memori percakapan per user (in-memory) — `.bot reset` buat ngapus.
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
// Workspace netral (di luar repo) → AGENTS.md repo ini gak ikut dibaca model
const CTX_DIR = join(tmpdir(), 'skyline-botchat-ctx')
const AGENT_DST = join(CTX_DIR, '.opencode', 'agents', 'botchat.md')

const pluginConfig = {
  name: 'bot',
  alias: ['botchat', 'chatbot', 'ngobrol'],
  category: 'ai',
  description: 'Ngobrol sama AI (OpenCode free) — hafal nama & riwayat chat kamu',
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
  return {
    enabled: c.enabled !== false,
    model: String(process.env.OPENCODE_AI_MODEL || c.model || 'deepseek-v4.1-flash-free'),
    fallbackModels: (Array.isArray(c.fallbackModels) ? c.fallbackModels : [])
      .map((m) => String(m))
      .filter((m) => m && m !== (c.model || 'deepseek-v4.1-flash-free')),
    maxHistory: Math.max(2, Number(c.maxHistory) || 12),
    maxChars: Math.max(500, Number(c.maxChars) || 12000),
    timeoutMs: Math.max(10_000, Number(c.timeoutMs) || 120_000),
  }
}

/* ══════════════════ state ══════════════════ */
const memory = new Map() // jid -> [{ role: 'user'|'assistant', content }]
let session = null // { id, model }
let binCache = null

function history(jid) {
  if (!memory.has(jid)) memory.set(jid, [])
  return memory.get(jid)
}

function trimHistory(arr, max) {
  while (arr.length > max) arr.shift()
}

/* ══════════════════ binary opencode ══════════════════ */
function resolveBin() {
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
  if (!found) {
    const e = new Error('binary `opencode` gak ketemu di PATH')
    e.code = 'ENOENT'
    throw e
  }
  binCache = found
  return found
}

/* ══════════════════ pemanggilan CLI OpenCode ══════════════════ */
function parseBody(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? v : null
  } catch {}
  const lines = s.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const v = JSON.parse(line)
      if (v && typeof v === 'object') return v
    } catch {}
  }
  return null
}

function runApi(method, apiPath, payload, timeoutMs) {
  return new Promise((res, rej) => {
    let bin
    try {
      bin = resolveBin()
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
      const e = new Error(`timeout ${timeoutMs}ms nunggu OpenCode`)
      e.code = 'ETIMEDOUT'
      rej(e)
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
      const e = new Error(msg.slice(0, 300))
      e.code = code === 0 ? 'EEMPTY' : 'EEXIT'
      rej(e)
    })
  })
}

/* ══════════════════ workspace + session ══════════════════ */
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

function isRecoverable(e) {
  return e?.code !== 'ENOENT'
}

/* ══════════════════ panggil model ══════════════════ */
async function askModel(prompt) {
  const c = cfg()
  const models = [c.model, ...c.fallbackModels]
  let lastErr = null

  for (const model of models) {
    try {
      if (!session || session.model !== model) session = await createSession(model)

      const body = await runApi('post', `/api/session/${session.id}/generate`, { prompt: prompt.slice(0, c.maxChars) }, c.timeoutMs)
      let text = body?.data?.text
      if (typeof text !== 'string' || !text.trim()) {
        // kadang model balas kosong → sekali coba ulang dengan dorongan
        const retry = await runApi(
          'post',
          `/api/session/${session.id}/generate`,
          { prompt: prompt.slice(0, c.maxChars) + '\n\n(Jangan kosong — tulis balasanmu sekarang.)' },
          c.timeoutMs
        )
        text = retry?.data?.text
        if (typeof text !== 'string' || !text.trim()) {
          const e = new Error('model balas kosong')
          e.code = 'EEMPTY'
          throw e
        }
      }
      return text.trim()
    } catch (e) {
      lastErr = e
      session = null // paksa bikin session baru (pindah model / lepas dari error)
      logger.warn({ model, err: String(e.message || e).slice(0, 200) }, '[bot] generate gagal')
      if (!isRecoverable(e)) throw e
    }
  }
  throw lastErr || new Error('model gak tersedia')
}

/* ══════════════════ susun prompt ══════════════════ */
function roleLabel(ctx) {
  if (ctx.isOwner) return 'OWNER bot'
  if (ctx.role === 'admin') return 'ADMIN bot'
  if (ctx.isStaff) return 'STAFF bot'
  if (ctx.isAdmin) return 'ADMIN grup'
  return 'MEMBER'
}

function buildPrompt(ctx, hist) {
  let user = null
  try {
    user = getUser?.(ctx.sender) || null
  } catch {}
  const name = (ctx.pushName || user?.name || '').trim() || 'Tanpa Nama'

  const lines = []
  lines.push('PROFIL LAWAN BICARA:')
  lines.push(`- Nama: ${name}`)
  lines.push(`- Nomor: ${ctx.senderNumber || '-'}`)
  lines.push(`- Peran: ${roleLabel(ctx)}`)
  lines.push(`- Chat: ${ctx.isGroup ? 'grup WhatsApp' : 'chat pribadi'}`)
  if (Number(user?.command_count)) lines.push(`- Sudah pakai ${user.command_count} command bot ini`)
  lines.push('')
  lines.push('RIWAYAT CHAT (paling baru di bawah):')
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

/* ══════════════════ pesan bantuan & error ══════════════════ */
function helpText(ctx) {
  const c = cfg()
  const p = ctx.prefix || '.'
  const hist = history(ctx.sender)
  const name = (ctx.pushName || '').trim() || 'kamu'
  return (
    '🤖 *SKYLINE BOT — NGOBROL AI*\n\n' +
    `Ngobrol sama AI pake model free OpenCode. Dia hafal nama & riwayat chat kamu.\n\n` +
    '*Cara pakai:*\n' +
    `> ${p}bot halo, kenalin aku ${name}\n` +
    `> ${p}bot lagi ngapain?\n` +
    `> ${p}bot reset — hapus memori chat kamu\n\n` +
    `*Model:* ${c.model} (OpenCode · $0)\n` +
    `*Memori:* ${hist.length}/${c.maxHistory} pesan`
  )
}

function humanError(e) {
  const msg = String(e?.message || e)
  if (e?.code === 'ENOENT') {
    return (
      '🔧 *OpenCode gak ketemu di server*\n\n' +
      'Fitur ini butuh CLI OpenCode (`opencode`) buat manggil model free-nya.\n' +
      '> Install: https://opencode.ai\n' +
      '> Atau set env `OPENCODE_BIN` ke path binary-nya.'
    )
  }
  if (e?.code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return '⏱️ *AI lambat balas* — server OpenCode lagi sibuk. Coba kirim lagi ya.'
  }
  if (/free tier|FreeTier/i.test(msg)) {
    return '🚫 *Free tier OpenCode lagi nolak* — biasanya server OpenCode lagi gangguan/rate limit. Coba lagi beberapa menit.'
  }
  if (/ConnectionRefused|ECONNREFUSED/i.test(msg)) {
    return '🔌 *Server OpenCode gak nyambung* — coba jalankan `opencode` dulu di server, lalu ulangi.'
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
    memory.delete(ctx.sender)
    return ctx.reply(
      '🧹 *Memori chat dihapus*\n\n> Aku lupa percakapan sebelumnya sama kamu.\n' +
        `Lanjut ngobrol: ${p}bot halo, kenalin aku lagi`
    )
  }

  const hist = history(ctx.sender)
  hist.push({ role: 'user', content: raw })
  trimHistory(hist, c.maxHistory)

  try {
    ctx.react('🕘')?.catch?.(() => {})
  } catch {}

  let reply
  try {
    reply = await askModel(buildPrompt(ctx, hist))
  } catch (e) {
    logger.warn({ err: String(e.message || e).slice(0, 300) }, '[bot] gagal')
    try {
      await ctx.react('❎')
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
