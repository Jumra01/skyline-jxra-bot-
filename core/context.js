/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * context.js — Build context object untuk setiap pesan
 */
import config from '../config.js'
import { richButtons, richList, interactiveSendOptions } from '../lib/richMessage.js'
import { getReplyStyle, sendReplyVariant, sendBasicReply, isStyling } from './replyStyle.js'
import { logger } from './logger.js'
import { getStaffEntry, setBotNumber } from './staff.js'

/** Envelope pesan yang isinya dibungkus lagi (disappearing/view-once/dsb). */
const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'deviceSentMessage',
]

/** Lepas bungkus pesan (`ephemeralMessage`/`viewOnceMessage`/…) → isi sebenarnya. */
export function unwrapMessage(message) {
  let msg = message
  for (let i = 0; i < 6 && msg; i++) {
    let inner = null
    for (const k of WRAPPER_KEYS) {
      if (msg[k]?.message) { inner = msg[k].message; break }
    }
    if (!inner) break
    msg = inner
  }
  return msg
}

function extractText(message) {
  const m = unwrapMessage(message)
  if (!m) return undefined
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    undefined
  )
}

const digits = (jid) => (jid ?? '').split('@')[0].split(':')[0]

/* ══════════ [GLOBAL SETREPLY] Varian .setreply nempel di SEMUA pesan ══════════
 * Patch client.message.send SEKALI (idempoten): pesan teks apa pun yang keluar
 * (ctx.reply, plugin yang kirim string langsung, handler, dsb) lewat varian
 * aktif. Media/interactive/reaction/native-HTML & pesan ber-mention tetap lewat
 * utuh (mention gak dibawa envelope varian). Envelope internal dikirim lewat
 * jalur yang sama → isStyling() di replyStyle.js menghentikan recursion.
 */
let replyHookInstalled = false

function outboundText(content) {
  if (typeof content === 'string') return content || null
  if (!content || typeof content !== 'object') return null
  if (content.type === 'text' && typeof content.text === 'string') return content.text || null
  if (typeof content.conversation === 'string') return content.conversation || null
  if (typeof content.extendedTextMessage?.text === 'string') return content.extendedTextMessage.text || null
  return null
}

function hasMentions(content, opts) {
  const lists = [
    content?.contextInfo?.mentionedJid,
    content?.extendedTextMessage?.contextInfo?.mentionedJid,
    opts?.contextInfo?.mentionedJid
  ]
  return lists.some((a) => Array.isArray(a) && a.length > 0)
}

function installGlobalReplyStyle(client) {
  if (replyHookInstalled) return
  const send = client?.message?.send
  if (typeof send !== 'function') return
  replyHookInstalled = true
  const rawSend = send.bind(client.message)

  client.message.send = async (chat, content, opts = {}) => {
    try {
      if (isStyling()) return await rawSend(chat, content, opts)
      const text = outboundText(content)
      if (!text || hasMentions(content, opts)) return await rawSend(chat, content, opts)

      const style = getReplyStyle()
      const pseudo = { client, chat, event: undefined }
      if (style !== 1) {
        try {
          return await sendReplyVariant(pseudo, text, style)
        } catch (err) {
          logger.warn(
            { err: String(err?.message ?? err), style },
            'Global reply variant gagal — fallback ke teks + kartu'
          )
        }
      }
      return await sendBasicReply(pseudo, text)
    } catch (err) {
      logger.warn({ err: String(err?.message ?? err) }, 'Global reply style gagal — kirim asli')
      return await rawSend(chat, content, opts)
    }
  }
}

export function buildContext(client, event) {
  installGlobalReplyStyle(client)
  const primary = event.key.participant ?? event.key.remoteJid
  const alt = event.key.participantAlt ?? event.key.remoteJidAlt

  const pnJid = primary?.endsWith('@lid') ? (alt ?? primary) : primary
  const lidJid = primary?.endsWith('@lid') ? primary : alt?.endsWith('@lid') ? alt : undefined

  const senderNumber = digits(pnJid)

  // Lazy: cache nomor bot sendiri sekali — biar bot = owner otomatis
  try {
    const me = client.auth?.getCurrentCredentials?.()
    if (me?.meJid) setBotNumber(me.meJid)
  } catch {}

  const staff = getStaffEntry(senderNumber, lidJid)
  const role = staff?.role ?? null

  const ctx = {
    client,
    event,
    chat: event.key.remoteJid,
    sender: pnJid,
    senderLid: lidJid,
    senderNumber,
    pushName: event.pushName,
    isGroup: Boolean(event.key.isGroup),
    receivedAt: Date.now(),

    mentioned: event.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [],

    role,
    staffLabel: staff?.label ?? null,
    isOwner: role === 'owner',
    isAdmin: role === 'owner' || role === 'admin',
    isStaff: role !== null,

    body: extractText(event.message) ?? '',
    command: '',
    args: [],
    text: '',

    async reply(text) {
      let style = 1
      try {
        style = getReplyStyle()
        if (style !== 1) return await sendReplyVariant(ctx, text, style)
      } catch (err) {
        logger.warn(
          { err: String(err?.message ?? err), style },
          'Reply variant gagal — fallback ke teks biasa'
        )
      }
      return sendBasicReply(ctx, text)
    },

    async react(emoji) {
      return client.message.send(ctx.chat, { type: 'reaction', emoji, target: event })
    },

    async replyButtons({ text, footer, buttons, adReply, headerImage }) {
      return client.message.send(
        ctx.chat,
        richButtons({ text, footer, buttons, adReply, headerImage }),
        interactiveSendOptions(ctx.chat)
      )
    },

    async replyList({ text, footer, title, buttonText, sections, adReply, headerImage }) {
      return client.message.send(
        ctx.chat,
        richList({ text, footer, title, buttonText, sections, adReply, headerImage }),
        interactiveSendOptions(ctx.chat)
      )
    }
  }

  return ctx
}
