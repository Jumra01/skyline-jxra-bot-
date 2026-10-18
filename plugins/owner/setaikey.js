/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * setaikey.js — Atur API key AI chat (.bot) dari WhatsApp.
 *
 * Kenapa perlu: repo ini PUBLIK, jadi apikey SENGAJA gak pernah ditulis di
 * file yang di-commit (config.js). Nilai disimpan di `src/data/ai.json`
 * (GITIGNORED) — dan file itu GAK ikut ke GitHub, jadi di panel deploy
 * harus diisi sendiri. Command ini isi file itu LANGSUNG dari chat,
 * jadi gak perlu buka file manager panel.
 *
 *   .setaikey                    → lihat status (provider/model/key tersamar)
 *   .setaikey <apikey>           → simpan API key (provider default: Aion)
 *   .setaikey model <id>         → ganti model
 *   .setaikey off                → hapus key
 *
 * Prioritas pembacaan plugin: env AICHAT_API_KEY > src/data/ai.json > config.
 * Jadi kalau env di-set (Pterodactyl → Startup), nilai file DIABAIKAN.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../../core/logger.js'

// Path di-resolve relatif ke file ini (aman walau cwd bukan root repo).
// `AICHAT_OVERRIDE_FILE` cuma buat pengujian.
const OVERRIDE_FILE = process.env.AICHAT_OVERRIDE_FILE
  ? String(process.env.AICHAT_OVERRIDE_FILE)
  : fileURLToPath(new URL('../../src/data/ai.json', import.meta.url))

const DEFAULT_PROVIDER = 'aion'
const DEFAULT_BASEURL = 'https://api.aionlabs.ai/v1'
const DEFAULT_MODEL = 'aion-labs/aion-rp-llama-3.1-8b'

const pluginConfig = {
  name: 'setaikey',
  alias: ['aikey', 'setapikey', 'apikeyai'],
  category: 'owner',
  description: 'Set API key AI chat (.bot) dari WhatsApp — tersimpan lokal (gak ke GitHub)',
  usage: '.setaikey <apikey> | .setaikey model <id> | .setaikey off',
  example: '.setaikey alv2_xxxxxxxxxxxx',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  isEnabled: true,
}

function readFileCfg() {
  try {
    const o = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'))
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}

function writeFileCfg(obj) {
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true })
  const tmp = `${OVERRIDE_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`)
  fs.renameSync(tmp, OVERRIDE_FILE)
}

function mask(key) {
  const k = String(key || '')
  if (!k) return '(kosong)'
  if (k.length <= 12) return `${k.slice(0, 3)}…${k.slice(-2)}`
  return `${k.slice(0, 8)}…${k.slice(-4)}`
}

function box(title, body) {
  return `╭─〔 ${title} 〕─⬣\n${body}\n╰─⬣`
}

function statusText(p) {
  const f = readFileCfg()
  const envSet = Boolean(String(process.env.AICHAT_API_KEY || '').trim())
  const fileSet = Boolean(String(f.apikey || '').trim())
  const source = envSet ? 'ENV `AICHAT_API_KEY`' : fileSet ? `file (\`${path.relative(process.cwd(), OVERRIDE_FILE) || OVERRIDE_FILE}\`)` : 'BELUM ADA'
  return box(
    '🔑 `ᴀᴘɪ ᴋᴇʏ ᴀɪ`',
    `Provider: *${f.provider || `${DEFAULT_PROVIDER} (default)`}*\n` +
    `Model: \`${f.model || DEFAULT_MODEL}\`\n` +
    `Key: \`${mask(envSet ? process.env.AICHAT_API_KEY : f.apikey)}\`\n` +
    `Sumber aktif: *${source}*${envSet ? ' ⚠️ (nilai file diabaikan)' : ''}\n\n` +
    '*Cara ubah:*\n' +
    `> ${p}setaikey <apikey>\n` +
    `> ${p}setaikey model <id-model>\n` +
    `> ${p}setaikey off — hapus key`
  )
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const text = String(ctx.text || '').trim()

  // tanpa argumen → status
  if (!text) return ctx.reply(statusText(p))

  if (/^(off|hapus|reset|clear|delete)$/i.test(text)) {
    const f = readFileCfg()
    delete f.apikey
    try { writeFileCfg(f) } catch (err) {
      logger.warn({ err: String(err?.message || err) }, '[setaikey] gagal simpan')
      return ctx.reply('❌ Gagal nyimpen. Cek izin tulis folder `src/data/`.')
    }
    await ctx.react('🗑️')
    return ctx.reply(box('🗑️ `ᴋᴇʏ ᴅɪʜᴀᴘᴜꜱ`', `API key AI udah dihapus dari \`src/data/ai.json\`.\n> Isi lagi: \`${p}setaikey <apikey>\``))
  }

  // ganti model
  const m = text.match(/^(?:model|setmodel)\s+(.+)$/i)
  if (m) {
    const model = m[1].trim()
    const f = readFileCfg()
    f.provider = f.provider || DEFAULT_PROVIDER
    f.baseUrl = f.baseUrl || DEFAULT_BASEURL
    f.model = model
    try { writeFileCfg(f) } catch (err) {
      logger.warn({ err: String(err?.message || err) }, '[setaikey] gagal simpan model')
      return ctx.reply('❌ Gagal nyimpen model. Cek izin tulis folder `src/data/`.')
    }
    await ctx.react('🧠')
    return ctx.reply(box('🧠 `ᴍᴏᴅᴇʟ ᴅɪɢᴀɴᴛɪ`', `Model AI sekarang: \`${model}\`\nLangsung kepakai di balasan berikutnya — *gak perlu restart*.`))
  }

  // sisanya = apikey (buang spasi/newline; kalau user nempel pakai tanda kutip, ikut dibersihin)
  const key = text.replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, '')
  if (/^(https?:|provider|baseurl)/i.test(key) || key.length < 12) {
    return ctx.reply(
      box(
        '⚠️ `ᴋᴇʏ ɢᴀᴋ ᴠᴀʟɪᴅ`',
        'Yang kamu kirim kayaknya bukan API key (kependekan / kayak URL).\n\n' +
        `> Contoh: \`${p}setaikey alv2_xxxxxxxxxxxx\`\n` +
        `> Status sekarang: \`${p}setaikey\``
      )
    )
  }

  const f = readFileCfg()
  const lockProvider = !f.provider || f.provider === DEFAULT_PROVIDER
  const out = {
    ...f,
    provider: lockProvider ? DEFAULT_PROVIDER : f.provider,
    baseUrl: f.baseUrl || (lockProvider ? DEFAULT_BASEURL : ''),
    model: f.model || DEFAULT_MODEL,
    apikey: key,
  }
  if (!out.baseUrl) delete out.baseUrl

  try { writeFileCfg(out) } catch (err) {
    logger.warn({ err: String(err?.message || err) }, '[setaikey] gagal simpan')
    return ctx.reply('❌ Gagal nyimpen. Cek izin tulis folder `src/data/`.')
  }

  logger.success(`[setaikey] apikey AI diset owner (+${ctx.senderNumber}) — ${mask(key)}`)
  await ctx.react('🔑')

  const envWarn = String(process.env.AICHAT_API_KEY || '').trim()
    ? '\n\n⚠️ *Perhatian:* env `AICHAT_API_KEY` aktif → nilai file ini *diabaikan*. Hapus env-nya di panel (tab Startup) kalau mau pakai yang ini.'
    : ''

  return ctx.reply(
    box(
      '✅ `ᴋᴇʏ ᴅɪꜱɪᴍᴘᴀɴ`',
      `API key AI disimpan: \`${mask(key)}\`\n` +
      `Provider: *${out.provider}* · Model: \`${out.model}\`\n\n` +
      'Disimpan di `src/data/ai.json` (GITIGNORED — gak ikut ke GitHub).\n' +
      'Langsung kepakai di balasan berikutnya — *gak perlu restart*.' +
      envWarn
    )
  )
}

export { pluginConfig as config, handler }
