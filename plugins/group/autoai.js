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
 *   • `.autoai grup on` / `.autoai pribadi on` (eksplisit per jenis chat)
 *   • `.autoai global on/off --skylinemode=...` (owner) — bisa dipisah:
 *     `.autoai global grup on|off` / `.autoai global pribadi on|off`
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
import { setSetting, getSetting } from '../../core/groupSettings.js'
import {
  CHARACTERS, DEFAULT_CHARACTER,
  getGroupConfig, setGroupConfig, getGlobalConfig, setGlobalConfig,
  migrateGlobalConfig, listCustomPersonas, addCustomPersona, removeCustomPersona,
  resolveAutoAI, buildConfig,
} from '../../lib/autoai.js'
import {
  kindOf, parseKind, KIND_LABEL,
  getGlobalKind, setGlobalKind, kindLabel,
} from '../../lib/aiScope.js'

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
 * keduanya dimatikan di scope yang sama (per chat / per jenis global), biar
 * gak rebutan. Scope global sekarang dipisah grup & pribadi.
 * @returns {boolean} true kalau salah satu tadi memang aktif di scope itu
 */
function silenceElla(scope = 'chat', chat = null, kind = null) {
  try {
    if (scope === 'global') {
      const kinds = kind ? [kind] : ['group', 'private']
      let wasOn = false
      for (const k of kinds) {
        for (const name of ['ella', 'ella2']) {
          if (getGlobalKind(name, k) === '1') wasOn = true
          setGlobalKind(name, k, false)
        }
      }
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
  const kind = kindOf(ctx)
  const ai = resolveAutoAI(ctx.chat, kind)
  const src = {
    group: 'chat ini', 'group-off': 'chat ini (dimatikan)',
    global: 'global lama (dua jenis)', 'global-off': 'global lama (dimatikan)',
    'global-group': 'global grup', 'global-group-off': 'global grup (dimatikan)',
    'global-private': 'global pribadi', 'global-private-off': 'global pribadi (dimatikan)',
    default: 'default',
  }[ai.source] || ai.source
  const state = ai.enabled ? '✅ AKTIF' : '❌ NONAKTIF'
  const fmtGlobal = (k) => {
    const c = getGlobalConfig(k)
    if (c) return c.enabled ? `aktif (${c.characterName || '-'})` : 'mati'
    const legacy = getGlobalConfig()
    return legacy ? (legacy.enabled ? `aktif (${legacy.characterName || '-'}, lama)` : 'mati (lama)') : 'belum diatur'
  }
  const ellaChat = getSetting(ctx.chat, 'ella')
  const ellaState = ellaChat === '1' ? 'AKTIF' : ellaChat === '0' ? 'MATI' : `ikut global ${KIND_LABEL[kind]} (${kindLabel(getGlobalKind('ella', kind))})`
  const ella2Chat = getSetting(ctx.chat, 'ella2')
  const ella2State = ella2Chat === '1' ? 'AKTIF' : ella2Chat === '0' ? 'MATI' : `ikut global ${KIND_LABEL[kind]} (${kindLabel(getGlobalKind('ella2', kind))})`
  const lines = [
    `Ruang    : ${ctx.isGroup ? 'grup' : 'pribadi'}`,
    `Status   : *${state}*`,
    `Sumber   : ${src}`,
    ai.enabled ? `Karakter : *${ai.characterName || '-'}* (${ai.character || 'default'})` : null,
    ai.enabled ? `Mode     : *${ai.mode || 'onlychat'}*` : null,
    `Global   : grup → ${fmtGlobal('group')} · pribadi → ${fmtGlobal('private')}`,
    `Ella     : ${ellaState}`,
    `Ella v2  : ${ella2State}`,
  ].filter(Boolean)

  return (
    `🤖 *AUTO AI*\n\n` +
    box('📋 ɪɴғᴏ', lines) + '\n\n' +
    `> Bot balas otomatis saat *di-tag* atau *dibales*.\n` +
    `> AutoAI, Ella & Ella v2 eksklusif — yang dinyalain terakhir yang jalan.\n` +
    `> Saklar grup & pribadi dipisah (global).\n` +
    `> \`${p(ctx)}autoai on --skylinemode=${DEFAULT_CHARACTER}\`\n` +
    `> \`${p(ctx)}autoai grup on\` / \`${p(ctx)}autoai pribadi on\`\n` +
    `> \`${p(ctx)}autoai global grup on|off\` · \`global pribadi on|off\`\n` +
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
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean)
  const sub = tokens[0] || ''
  const charKey = getFlag(raw, ['skylinemode', 'persona', 'char', 'karakter'])
  const mode = getFlag(raw, ['mode'])
  const responseType = getFlag(raw, ['type'])
  const logic = getLogic(raw)
  const kind = kindOf(ctx)
  const ON = ['on', 'nyala', 'hidup']
  const OFF = ['off', 'mati', 'matiin', 'matikan']

  // `.autoai grup on` / `.autoai pribadi on` — harus cocok sama jenis chat ini.
  const kindArg = parseKind(sub)
  let action = sub
  if (kindArg) {
    const word = tokens[1] || ''
    if (!ON.includes(word) && !OFF.includes(word)) {
      return ctx.reply(
        `❌ Format: \`${p(ctx)}autoai ${KIND_LABEL[kindArg]} on|off\`\n` +
        `> Global: \`${p(ctx)}autoai global ${KIND_LABEL[kindArg]} on|off\``
      )
    }
    if (kindArg !== kind) {
      return ctx.reply(
        `⚠️ Ini ${KIND_LABEL[kind]}, bukan ${KIND_LABEL[kindArg]}.\n` +
        `> Buat chat ini: \`${p(ctx)}autoai ${kind} ${word}\`\n` +
        (ctx.isOwner ? `> Buat semua ${KIND_LABEL[kindArg]}: \`${p(ctx)}autoai global ${kindArg} ${word}\`` : '')
      )
    }
    action = word
  }

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
    return ctx.reply(`🎭 *ᴅᴀꜰᴛᴀʀ ᴘᴇʀsᴏɴᴀ*\n\n${personaList()}\n\n> Global grup: ${getGlobalConfig('group')?.enabled ? '✅ Aktif' : '❌ Nonaktif'}\n> Global pribadi: ${getGlobalConfig('private')?.enabled ? '✅ Aktif' : '❌ Nonaktif'}`)
  }

  /* ── global on/off (owner) — bisa per jenis chat ── */
  if (sub === 'global') {
    if (!ctx.isOwner) return ctx.reply('🚫 Khusus owner.')
    const scopeArg = parseKind(tokens[1])
    const gmode = String((scopeArg ? tokens[2] : tokens[1]) || '').toLowerCase()

    if (!ON.includes(gmode) && !OFF.includes(gmode)) {
      const legacy = getGlobalConfig()
      const fmt = (c) => (c ? (c.enabled ? `aktif (${c.characterName || '-'})` : 'mati') : 'belum diatur')
      return ctx.reply(
        `🌐 *AUTO AI GLOBAL*\n\n` +
        box('📋 ɪɴғᴏ', [
          `Grup     : ${fmt(getGlobalConfig('group') || legacy)}`,
          `Pribadi  : ${fmt(getGlobalConfig('private') || legacy)}`,
          legacy ? 'Catatan  : setelan lama masih berlaku buat dua jenis' : null,
        ].filter(Boolean)) + '\n\n' +
        `> \`${p(ctx)}autoai global on|off\` — dua-duanya\n` +
        `> \`${p(ctx)}autoai global grup on|off\`\n` +
        `> \`${p(ctx)}autoai global pribadi on|off\``
      )
    }

    const want = ON.includes(gmode)
    const kinds = scopeArg ? [scopeArg] : ['group', 'private']

    if (want) {
      migrateGlobalConfig()
      const prev = scopeArg
        ? getGlobalConfig(scopeArg)
        : (getGlobalConfig('group') || getGlobalConfig('private'))
      const built = buildConfig({ charKey, logic, mode, responseType, prev, by: ctx.sender })
      if (!built.ok) return ctx.reply(`❌ ${built.error}\n\n${personaList()}`)
      for (const k of kinds) setGlobalConfig({ ...built.cfg, global: true, scope: k }, k)
      const ellaOff = silenceElla('global', null, scopeArg)
      const where = scopeArg ? KIND_LABEL[scopeArg] : 'grup + pribadi'
      return ctx.reply(
        `🌐 *ᴀᴜᴛᴏ ᴀɪ ɢʟᴏʙᴀʟ ᴅɪᴀᴋᴛɪꜰᴋᴀɴ* — ${where}\n\n` +
        box('📋 ɪɴғᴏ', [
          `Karakter : *${built.cfg.characterName}*`,
          `Mode     : *${built.cfg.mode}*`,
        ]) + '\n\n' +
        `> Berlaku buat ${where} yang belum di-set sendiri.` +
        (ellaOff ? `\n> 💝 Ella / Ella v2 auto-reply *dimatikan* di ${where} biar gak tabrakan.` : '')
      )
    }

    migrateGlobalConfig()
    for (const k of kinds) {
      setGlobalConfig({ ...(getGlobalConfig(k) || {}), enabled: false }, k)
    }
    return ctx.reply(`🌐 Auto AI *global ${scopeArg ? KIND_LABEL[scopeArg] : '(grup + pribadi)'}* dimatikan.`)
  }

  /* ── on / off (per chat) ── */
  if (OFF.includes(action)) {
    if (ctx.isGroup && !(await isGroupAdmin(ctx))) return ctx.reply('🚫 Khusus admin grup / staff bot.')
    setGroupConfig(ctx.chat, { enabled: false })
    return ctx.reply(
      `🤖 Auto AI *dimatikan* di ${ctx.isGroup ? 'grup ini' : 'chat pribadi ini'}.\n` +
      `> Bot gak balas saat di-tag/di-bales di sini.\n` +
      (ctx.isOwner ? `> Semua ${KIND_LABEL[kind]}: \`${p(ctx)}autoai global ${kind} off\`` : '')
    )
  }

  if (ON.includes(action)) {
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
      (ctx.isOwner ? `\n> Semua ${KIND_LABEL[kind]}: \`${p(ctx)}autoai global ${kind} on\`` : '') +
      note
    )
  }

  /* ── tanpa arg / status ── */
  return ctx.reply(statusText(ctx))
}

export { pluginConfig as config, handler }
