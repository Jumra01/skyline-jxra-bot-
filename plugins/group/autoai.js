/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * autoai.js — `.autoai` (alias `.aai`): nyalain/matiin Auto AI per grup.
 *
 * Bot jawab otomatis saat DI-TAG atau DI-BALES di grup/chat yang aktif,
 * pakai karakter/persona + mode yang dipilih:
 *   • `.autoai on` (admin grup)  → Auto AI nyala di grup ini
 *   • `.autoai off`              → matiin di grup ini
 *   • `.autoai on --skylinemode=furina`
 *   • `.autoai on --skylinemode=custom --logic=kamu adalah nexa ai`
 *   • `.autoai on --mode=assistant|onlychat`
 *   • `.autoai global on/off --skylinemode=...` (owner)
 *   • `.autoai listpersona` / `tambahpersona nama | logic` / `hapuspersona nama`
 *
 * Config disimpan di `lib/autoai.js` (settings.sqlite). Trigger tag/bales
 * ditangani `plugins/ai/bot.js` lewat `core/mentionTrigger.js`.
 *
 * EKSKLUSIF dengan `.ella` / `.ella2`: `.autoai on` otomatis mematikan keduanya
 * di chat itu (dan `.ella on` / `.ella2 on` mematikan AutoAI) — biar fitur AI
 * gak rebutan/balas dobel.
 * Yang dinyalakan terakhir yang jalan.
 */
import { isGroupAdmin } from '../../core/permission.js'
import { setSetting, getSetting, setGlobal, getGlobal } from '../../core/groupSettings.js'
import {
  CHARACTERS, DEFAULT_CHARACTER,
  getGroupConfig, setGroupConfig, getGlobalConfig, setGlobalConfig,
  listCustomPersonas, addCustomPersona, removeCustomPersona,
  resolveAutoAI, buildConfig,
} from '../../lib/autoai.js'

const pluginConfig = {
  name: 'autoai',
  alias: ['aai'],
  category: 'group',
  description: 'Auto AI: bot jawab saat di-tag/di-bales (per grup + global)',
  usage: '.autoai on/off [--skylinemode=<karakter>] [--mode=onlychat|assistant]',
  example: '.autoai on --skylinemode=furina',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
}

/* ══════════════════════ helper tampilan ══════════════════════ */
const p = (ctx) => ctx.prefix || '.'

/**
 * AutoAI ⇄ Ella / Ella v2 saling eksklusif: nyalain AutoAI = auto-reply
 * keduanya dimatikan di scope yang sama (per chat / global), biar gak rebutan.
 * @returns {boolean} true kalau salah satu tadi memang aktif di scope itu
 */
function silenceElla(scope = 'chat', chat = null) {
  try {
    if (scope === 'global') {
      const wasOn = getGlobal('ella') === '1' || getGlobal('ella2') === '1'
      setGlobal('ella', '0')
      setGlobal('ella2', '0')
      return wasOn
    }
    const wasOn = getSetting(chat, 'ella') === '1' || getSetting(chat, 'ella2') === '1'
    setSetting(chat, 'ella', '0')
    setSetting(chat, 'ella2', '0')
    return wasOn
  } catch {
    /* gagal nyimpen jangan bikin command ikut gagal */
    return false
  }
}

function box(title, lines) {
  return `╭┈┈⬡「 ${title} 」\n${lines.map((l) => `┃ ${l}`).join('\n')}\n╰┈┈┈┈┈┈┈┈⬡`
}

function personaList() {
  const custom = Object.keys(listCustomPersonas())
  const builtIn = Object.entries(CHARACTERS)
    .filter(([k]) => k !== 'bella') // alias bell409 — cukup tampil sekali
    .map(([k, v]) => `▸ *${k}* — ${v.name}`)
  let t = '*Bawaan:*\n' + builtIn.join('\n')
  t += '\n\n*Custom:*\n' + (custom.length ? custom.map((k) => `▸ *${k}*`).join('\n') : '▸ (belum ada)')
  return t
}

function statusText(ctx) {
  const ai = resolveAutoAI(ctx.chat)
  const src = { group: 'grup ini', global: 'global (owner)', default: 'default', 'group-off': 'grup ini (dimatikan)', 'global-off': 'global (dimatikan)' }[ai.source] || ai.source
  const state = ai.enabled ? '✅ AKTIF' : '❌ NONAKTIF'
  const ellaRaw = getSetting(ctx.chat, 'ella')
  const ellaState = ellaRaw === '1' ? 'AKTIF (chat ini)' : ellaRaw === '0' ? 'MATI (chat ini)' : 'ikut global/default'
  const ella2Raw = getSetting(ctx.chat, 'ella2')
  const ella2State = ella2Raw === '1' ? 'AKTIF (chat ini)' : ella2Raw === '0' ? 'MATI (chat ini)' : 'ikut global/default'
  const lines = [
    `Status   : *${state}*`,
    `Sumber   : ${src}`,
    ai.enabled ? `Karakter : *${ai.characterName || '-'}* (${ai.character || 'default'})` : null,
    ai.enabled ? `Mode     : *${ai.mode || 'onlychat'}*` : null,
    `Ella     : ${ellaState}`,
    `Ella v2  : ${ella2State}`,
    `Chat     : ${ctx.isGroup ? 'grup' : 'pribadi'}`,
  ].filter(Boolean)

  return (
    `🤖 *AUTO AI*\n\n` +
    box('📋 ɪɴғᴏ', lines) + '\n\n' +
    `> Bot balas otomatis saat *di-tag* atau *dibales*.\n` +
    `> AutoAI, Ella & Ella v2 eksklusif — yang dinyalain terakhir yang jalan.\n` +
    `> \`${p(ctx)}autoai on --skylinemode=${DEFAULT_CHARACTER}\`\n` +
    `> \`${p(ctx)}autoai off\`\n` +
    `> \`${p(ctx)}autoai listpersona\``
  )
}

/* ══════════════════════ parser flag ══════════════════════ */
function getFlag(raw, names) {
  for (const n of names) {
    const re = new RegExp(`--${n}=("[^"]*"|'[^']*'|\\S+)`, 'i')
    const m = raw.match(re)
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim()
  }
  return null
}

function getLogic(raw) {
  const m = raw.match(/--logic=([\s\S]+?)(?=\s+--(?:skylinemode|persona|char|karakter|type|logic|mode)\b|$)/i)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '').trim() : null
}

/* ══════════════════════ handler ══════════════════════ */
async function handler(ctx) {
  const raw = String(ctx.text || '').trim()
  const sub = (raw.toLowerCase().split(/\s+/)[0] || '')
  const charKey = getFlag(raw, ['skylinemode', 'persona', 'char', 'karakter'])
  const mode = getFlag(raw, ['mode'])
  const responseType = getFlag(raw, ['type'])
  const logic = getLogic(raw)

  /* ── tambah / hapus persona (owner) ── */
  if (/^(tambahpersona|addpersona|newpersona)$/.test(sub)) {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const part = raw.replace(/^\S+\s*/, '').split('|').map((s) => s.trim())
    if (part.length < 2 || !part[0] || !part[1]) {
      return ctx.reply(`❌ Format: \`${p(ctx)}autoai tambahpersona nama | instruksi\``)
    }
    const key = part[0].toLowerCase().replace(/\s+/g, '_')
    if (CHARACTERS[key]) return ctx.reply(`❌ Nama *${key}* sudah dipakai karakter bawaan.`)
    addCustomPersona(key, { name: part[0], instruction: part.slice(1).join(' | '), by: ctx.sender })
    return ctx.reply(`✅ Persona *${part[0]}* ditambah.\n> Pakai: \`${p(ctx)}autoai on --skylinemode=${key}\``)
  }

  if (/^(hapuspersona|delpersona|removepersona)$/.test(sub)) {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const key = (raw.split(/\s+/)[1] || '').toLowerCase()
    if (!key) return ctx.reply(`❌ Format: \`${p(ctx)}autoai hapuspersona <nama>\``)
    if (!removeCustomPersona(key)) return ctx.reply(`❌ Persona *${key}* gak ketemu.`)
    return ctx.reply(`✅ Persona *${key}* dihapus.`)
  }

  /* ── list persona ── */
  if (/^(listpersona|personas|list)$/.test(sub)) {
    return ctx.reply(`🎭 *ᴅᴀꜰᴛᴀʀ ᴘᴇʀsᴏɴᴀ*\n\n${personaList()}\n\n> Global: ${getGlobalConfig()?.enabled ? '✅ Aktif' : '❌ Nonaktif'}`)
  }

  /* ── global on/off (owner) ── */
  if (sub === 'global') {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const gmode = (raw.split(/\s+/)[1] || '').toLowerCase()
    if (!['on', 'off'].includes(gmode)) {
      return ctx.reply(`❌ Format: \`${p(ctx)}autoai global on/off --skylinemode=<karakter>\``)
    }
    if (gmode === 'off') {
      setGlobalConfig({ ...(getGlobalConfig() || {}), enabled: false })
      return ctx.reply('🌐 Auto AI *global* dimatikan.')
    }
    const built = buildConfig({ charKey, logic, mode, responseType, prev: getGlobalConfig(), by: ctx.sender })
    if (!built.ok) return ctx.reply(`❌ ${built.error}\n\n${personaList()}`)
    setGlobalConfig({ ...built.cfg, global: true })
    const ellaOff = silenceElla('global')
    return ctx.reply(
      `🌐 *ᴀᴜᴛᴏ ᴀɪ ɢʟᴏʙᴀʟ ᴅɪᴀᴋᴛɪꜰᴋᴀɴ*\n\n` +
      box('📋 ɪɴғᴏ', [
        `Karakter : *${built.cfg.characterName}*`,
        `Mode     : *${built.cfg.mode}*`,
      ]) + '\n\n> Berlaku buat grup yang belum di-set sendiri.' +
      (ellaOff ? '\n> 💝 Ella / Ella v2 auto-reply otomatis *dimatikan* (global) biar gak tabrakan.' : '')
    )
  }

  /* ── on / off (per chat) ── */
  if (sub === 'off') {
    if (ctx.isGroup && !(await isGroupAdmin(ctx))) return ctx.reply('🚫 Khusus admin grup / staff bot.')
    setGroupConfig(ctx.chat, { enabled: false })
    return ctx.reply(`🤖 Auto AI *dimatikan* di ${ctx.isGroup ? 'grup ini' : 'chat ini'}.\n> Bot gak balas saat di-tag/di-bales.`)
  }

  if (sub === 'on') {
    if (ctx.isGroup && !(await isGroupAdmin(ctx))) return ctx.reply('🚫 Khusus admin grup / staff bot.')
    const built = buildConfig({ charKey, logic, mode, responseType, prev: getGroupConfig(ctx.chat), by: ctx.sender })
    if (!built.ok) return ctx.reply(`❌ ${built.error}\n\n${personaList()}`)
    setGroupConfig(ctx.chat, built.cfg)
    const ellaOff = silenceElla('chat', ctx.chat)
    const note = responseType && responseType.toLowerCase() === 'voice'
      ? '\n> ⚠️ Voice note belum didukung di bot ini — pakai teks dulu ya.'
      : ''
    return ctx.reply(
      `🤖 *ᴀᴜᴛᴏ ᴀɪ ᴅɪᴀᴋᴛɪꜰᴋᴀɴ*\n\n` +
      box('📋 ɪɴғᴏ', [
        `Karakter : *${built.cfg.characterName}* (${built.cfg.character})`,
        `Mode     : *${built.cfg.mode}*`,
      ]) + '\n\n' +
      `> Bot balas saat *di-tag* / *dibales* di sini.` +
      (ellaOff ? '\n> 💝 Ella / Ella v2 auto-reply otomatis *dimatikan* di chat ini biar gak tabrakan.' : '') +
      note
    )
  }

  /* ── tanpa arg / status ── */
  return ctx.reply(statusText(ctx))
}

export { pluginConfig as config, handler }
