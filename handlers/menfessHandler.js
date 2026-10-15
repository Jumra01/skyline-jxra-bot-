/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * menfessHandler.js — State-machine buat thread Menfess (pesan anonim 2 arah).
 */

import { onRichReply } from './messageHandler.js'
import { reactTo } from '../core/react.js'

const THREADS = (globalThis.JH_MENFESS_THREADS ??= new Map())
const PENDING = (globalThis.JH_MENFESS_PENDING ??= new Map())  

const REPLY_TIMEOUT_MS = 3 * 60 * 1000

function otherSide(thread, jid) {
  return thread.a === jid ? thread.b : thread.a
}

function clearPending(jid) {
  const p = PENDING.get(jid)
  if (p) clearTimeout(p.timer)
  PENDING.delete(jid)
}

export function createThread(jidA, jidB) {
  const id = Math.random().toString(36).slice(2, 10)
  THREADS.set(id, { a: jidA, b: jidB, blocked: new Set() })
  return id
}

export function armReply(ctx, threadId) {
  const jid = ctx.sender
  clearPending(jid)
  const timer = setTimeout(() => {
    PENDING.delete(jid)
    ctx.reply('⌛ Waktu balas menfess habis. Tekan tombol *Balas* lagi kalo masih mau bales.').catch(() => {})
  }, REPLY_TIMEOUT_MS)
  PENDING.set(jid, { threadId, timer })
}

export async function deliverMenfess(ctx, threadId, text, { isReply = false } = {}) {
  const thread = THREADS.get(threadId)
  if (!thread) throw new Error('Sesi menfess ini udah gak aktif/expired.')
  if (thread.blocked.has(ctx.sender)) throw new Error('Kamu udah berhenti dari sesi menfess ini.')

  const toJid = otherSide(thread, ctx.sender)
  if (thread.blocked.has(toJid)) throw new Error('Lawan bicara udah berhenti dari sesi ini, pesan gak diterusin.')

  const label = isReply ? '↩️ *Balasan Menfess*' : '📩 *Menfess Masuk*'
  const buttonId = `menfess:reply:${threadId}:${Date.now()}`
  const blockId = `menfess:stop:${threadId}:${Date.now()}`

  onRichReply(buttonId, async (c2) => {
    armReply(c2, threadId)
    await c2.reply('✍️ Ketik balesan kamu sekarang (pesan biasa, gak usah pake command apapun).\nAuto batal dalam 3 menit kalo gak dibales.')
  })

  onRichReply(blockId, async (c2) => {
    thread.blocked.add(c2.sender)
    clearPending(c2.sender)
    await c2.reply('🚫 Kamu berhenti dari sesi menfess ini. Pesan berikutnya dari thread ini gak bakal diterusin lagi.')
  })

  const buttons = [
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '↩️ Balas', id: buttonId }) },
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🚫 Berhenti', id: blockId }) }
  ]

  await ctx.client.message.send(toJid, {
    interactiveMessage: {
      body: { text: `${label}\n\n${text}` },
      footer: { text: '🕶️ Menfess • identitas dirahasiakan' },
      nativeFlowMessage: { buttons, messageVersion: 1 }
    }
  })
}

export async function checkMenfessReply(client, event) {
  if (event.key.fromMe) return

  const primary = event.key.participant ?? event.key.remoteJid
  const alt = event.key.participantAlt ?? event.key.remoteJidAlt
  const senderJid = primary?.endsWith('@lid') ? (alt ?? primary) : primary

  const pending = PENDING.get(senderJid)
  if (!pending) return

  const body = (
    event.message?.conversation ??
    event.message?.extendedTextMessage?.text ??
    ''
  ).trim()
  if (!body) return

  if (/^[.!/]/.test(body)) return

  clearPending(senderJid)

  const remoteJid = event.key.remoteJid
  const miniCtx = {
    client,
    sender: senderJid,
    chat: remoteJid,
    react: (emoji) => reactTo(client, event, emoji),
    reply: (text) => client.message.send(remoteJid, String(text))
  }

  try {
    await miniCtx.react('⏳')
    await deliverMenfess(miniCtx, pending.threadId, body, { isReply: true })
    await miniCtx.react('✅')
  } catch (e) {
    await miniCtx.react('❎')
    await miniCtx.reply('Gagal ngirim balesan: ' + (e.message || e))
  }
}
