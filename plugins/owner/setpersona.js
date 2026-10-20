/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * setpersona.js — Atur persona/prompt AI chat (.bot) dari WhatsApp.
 *
 * Persona disimpan di `data/ai-persona.txt` dan dibaca LIVE tiap balasan
 * AI (gak perlu restart bot). Bisa juga diedit langsung dari file.
 *
 *   .setpersona                 → lihat persona aktif + status
 *   .setpersona <teks...>       → ganti persona
 *   .setpersona (balas pesan)   → ganti persona pakai teks yang dibalas
 *   .setpersona reset           → balik ke persona default
 */
import fs from 'node:fs'
import { logger } from '../../core/logger.js'
import { readPersona, writePersona, personaIsCustom, PERSONA_FILE, DEFAULT_PERSONA } from '../../lib/aiPersona.js'
import { readEllaPersona, writeEllaPersona, ellaPersonaIsCustom, PERSONA_FILE as ELLA_PERSONA_FILE } from '../../lib/ellaPersona.js'

const pluginConfig = {
  name: 'setpersona',
  alias: ['persona', 'setai', 'promptai'],
  category: 'owner',
  description: 'Atur persona/prompt AI chat (.bot) — file + command',
  usage: '.setpersona [teks] | .setpersona reset | balas pesan lalu .setpersona',
  example: '.setpersona Kamu asisten galak tapi peduli, jawab singkat pakai bahasa gaul',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  isEnabled: true,
}

function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}

function quotedText(ctx) {
  const msg = ctx.event?.message
  const q = getContextInfo(msg)?.quotedMessage
  if (!q) return ''
  return String(
    q.conversation ||
    q.extendedTextMessage?.text ||
    q.imageMessage?.caption ||
    q.videoMessage?.caption ||
    ''
  ).trim()
}

function box(title, body) {
  return `╭─〔 ${title} 〕─⬣\n${body}\n╰─⬣`
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const arg = String(ctx.text || '').trim()

  // Cabang khusus Ella: .setpersona ella [teks...] | .setpersona ella reset
  const isElla = /^\s*ella(\s|$)/i.test(arg)
  if (isElla) {
    const ellaArg = arg.replace(/^\s*ella\s*/i, '').trim()
    const fromQuote = quotedText(ctx)
    const newText = fromQuote || ellaArg

    if (/^(reset|default|bawaan)$/i.test(newText)) {
      writeEllaPersona('')
      await ctx.react('♻️')
      return ctx.reply(box('♻️ `ᴘᴇʀꜱᴏɴᴀ ᴇʟʟᴀ ᴅɪʀᴇꜱᴇᴛ`', 'Persona Ella balik ke *default* bawaan bot.'))
    }

    if (!newText) {
      const cur = readEllaPersona()
      const custom = ellaPersonaIsCustom()
      let size = 0
      try { size = fs.statSync(ELLA_PERSONA_FILE).size } catch { size = Buffer.byteLength(cur) }
      const preview = cur.length > 900 ? `${cur.slice(0, 900)}\n…(${cur.length - 900} karakter lagi)` : cur
      return ctx.reply(
        box(
          '🎭 `ᴘᴇʀꜱᴏɴᴀ ᴇʟʟᴀ`',
          `Target: *Ella (skyline.web.id)*\n` +
          `Status: *${custom ? 'CUSTOM' : 'DEFAULT'}*\n` +
          `Ukuran: ${size} byte · ${cur.length} karakter\n\n` +
          `${preview}\n\n` +
          '*Ubah:*\n' +
          `> ${p}setpersona ella <teks baru>\n` +
          `> balas pesan lalu ketik ${p}setpersona ella\n` +
          `> ${p}setpersona ella reset — balik default`
        )
      )
    }

    if (!writeEllaPersona(newText)) {
      return ctx.reply('❌ Gagal nyimpen persona Ella. Cek izin tulis folder `data/`.')
    }

    logger.success(`[setpersona] persona Ella diubah owner (+${ctx.senderNumber}) — ${newText.length} karakter`)
    await ctx.react('🎭')

    const preview = newText.length > 400 ? `${newText.slice(0, 400)}…` : newText
    return ctx.reply(
      box(
        '✅ `ᴘᴇʀꜱᴏɴᴀ ᴇʟʟᴀ ᴅɪꜱɪᴍᴘᴀɴ`',
        `Persona Ella udah diganti (${newText.length} karakter).\n` +
        'Langsung kepakai di balasan berikutnya — *gak perlu restart*.\n\n' +
        `📝 *Persona sekarang:*\n${preview}`
      )
    )
  }

  // reset → balik ke default (hapus file)
  if (/^(reset|default|bawaan)$/i.test(arg)) {
    writePersona('')
    await ctx.react('♻️')
    return ctx.reply(box('♻️ `ᴘᴇʀꜱᴏɴᴀ ᴅɪʀᴇꜱᴇᴛ`', 'Persona AI balik ke *default* bawaan bot.'))
  }

  // sumber teks baru: balasan (quote) > argumen
  const fromQuote = quotedText(ctx)
  const newText = fromQuote || arg

  if (!newText) {
    // tampilkan persona aktif + status
    const cur = readPersona()
    const custom = personaIsCustom()
    let size = 0
    try { size = fs.statSync(PERSONA_FILE).size } catch { size = Buffer.byteLength(cur) }
    const preview = cur.length > 900 ? `${cur.slice(0, 900)}\n…(${cur.length - 900} karakter lagi)` : cur
    return ctx.reply(
      box(
        '🎭 `ᴘᴇʀꜱᴏɴᴀ ᴀɪ`',
        `Target: *Bella / .bot (Gemini)*\n` +
        `Status: *${custom ? 'CUSTOM' : 'DEFAULT'}*\n` +
        `Ukuran: ${size} byte · ${cur.length} karakter\n\n` +
        `${preview}\n\n` +
        '*Ubah:*\n' +
        `> ${p}setpersona <teks baru>\n` +
        `> balas sebuah pesan lalu ketik ${p}setpersona\n` +
        `> ${p}setpersona reset — balik default\n\n` +
        `> Untuk Ella: \`${p}setpersona ella <teks>\` atau \`${p}ella persona\``
      )
    )
  }

  if (!writePersona(newText)) {
    return ctx.reply('❌ Gagal nyimpen persona. Cek izin tulis folder `data/`.')
  }

  logger.success(`[setpersona] persona diubah owner (+${ctx.senderNumber}) — ${newText.length} karakter`)
  await ctx.react('🎭')

  const preview = newText.length > 400 ? `${newText.slice(0, 400)}…` : newText
  return ctx.reply(
    box(
      '✅ `ᴘᴇʀꜱᴏɴᴀ ᴅɪꜱɪᴍᴘᴀɴ`',
      `Persona AI udah diganti (${newText.length} karakter).\n` +
      'Langsung kepakai di balasan berikutnya — *gak perlu restart*.\n\n' +
      `📝 *Persona sekarang:*\n${preview}`
    )
  )
}

// referensi default (biar gampang dicek dari kode kalau butuh)
void DEFAULT_PERSONA

export { pluginConfig as config, handler }
