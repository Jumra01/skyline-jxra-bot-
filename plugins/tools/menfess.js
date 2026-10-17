/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * menfess.js — Kirim pesan anonim ke seseorang.
 */

import { createThread, deliverMenfess } from '../../handlers/menfessHandler.js'

function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}

function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}

function normalizeNumber(input) {
  let n = String(input).replace(/[^\d]/g, '')
  if (!n || n.length < 8) return null
  if (n.startsWith('0')) n = '62' + n.slice(1)
  return n + '@s.whatsapp.net'
}

const pluginConfig = {
  name: "menfess",
  alias: ['nfess', 'anonim'],
  category: "tools",
  description: "Kirim pesan anonim ke seseorang (bisa dibales anonim juga)",
  usage: ".menfess",
  example: ".menfess",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    if (ctx.chat?.endsWith('@g.us')) {
      return ctx.reply(
        '🕶️ Menfess cuma bisa dipake lewat *chat pribadi ke bot* (biar beneran rahasia).\nDM bot ini langsung ya, terus ketik ulang *.menfess*-nya di sana.'
      )
    }

    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const ci = getContextInfo(rawMessage)
    const raw = (ctx.text || '').trim()

    if (!raw) {
      return ctx.reply(
        '🕶️ *MENFESS*\n\n' +
        'Cara pake:\n*.menfess <nomor/@mention> <pesan>*\n\n' +
        'Contoh:\n.menfess 628123456789 Halo kak, mau nanya sesuatu...'
      )
    }

    let targetJid = null
    let message = raw

    if (ci?.mentionedJid?.[0]) {
      targetJid = ci.mentionedJid[0]
      message = raw.replace(/@\d+/, '').trim()
    } else {
      const match = raw.match(/^\+?(\d{8,15})\s+([\s\S]+)$/)
      if (!match) {
        return ctx.reply('Format gak kebaca. Contoh: *.menfess 628123456789 pesan kamu di sini*')
      }
      targetJid = normalizeNumber(match[1])
      message = match[2].trim()
    }

    if (!targetJid) return ctx.reply('⚠️ Nomor/target gak valid.')
    if (!message) return ctx.reply('⚠️ Pesannya mana? Contoh: *.menfess 628123456789 halo kak*')
    if (targetJid === ctx.sender) return ctx.reply('Gak bisa menfess ke diri sendiri, Kak.')

    const threadId = createThread(ctx.sender, targetJid)

    await ctx.react('⏳')
    try {
      await deliverMenfess({ ...ctx, sender: ctx.sender }, threadId, message, { isReply: false })
      await ctx.react('✅')
      await ctx.reply('✅ Menfess terkirim secara anonim. Kalo dia bales, notifnya bakal muncul di sini juga.')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('Gagal ngirim menfess: ' + (e.message || e))
    }
  }

export { pluginConfig as config, handler };
