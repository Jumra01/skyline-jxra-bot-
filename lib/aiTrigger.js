/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aiTrigger.js — Deteksi "bot diajak ngobrol" (tag / bales / chat pribadi).
 *
 * Dipakai fitur AI yang butuh auto-reply (lihat `plugins/ai/ella.js`) — logika
 * sama dengan `plugins/ai/bot.js`: identitas bot (nomor/credentials/recipientJid),
 * LID↔PN, mention dari semua jenis pesan, dan timeout di tiap panggilan jaringan
 * (zapo bisa gantung).
 */
import { getBotNumber } from '../core/staff.js'
import { resolveLidToPn } from '../core/lid.js'
import { unwrapMessage } from '../core/context.js'

export const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2069\ufeff]/g
export const IMG_FIELDS = ['imageMessage', 'stickerMessage', 'documentMessage']

let botLidCache // { num, lid }

/** Buang suffix device (`:12`) dari jid — `628x:12@s.whatsapp.net` → `628x@s.whatsapp.net`. */
export function normJid(j) {
  return String(j || '').replace(/:\d+@/, '@')
}

/** User (angka) dari jid, device-insensitive. */
export function jidUser(j) {
  return normJid(j).split('@')[0]
}

/** Race dengan batas waktu — panggilan zapo bisa gantung tanpa resolve. */
export function withTimeout(promise, ms, fallback = null) {
  let timer
  const t = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
    timer.unref?.()
  })
  return Promise.race([promise, t]).finally(() => clearTimeout(timer))
}

/**
 * Semua bentuk identitas bot: nomor + jid (PN/LID) yang kita tau.
 * `key.recipientJid` ikut dicek — di chat pribadi stanza masuk dialamatkan ke bot.
 */
export function botIdentity(ctx) {
  let cred = null
  try {
    cred = ctx?.client?.auth?.getCurrentCredentials?.() ?? null
  } catch {
    /* ignore */
  }
  const num = getBotNumber() || jidUser(cred?.meJid) || null
  const meJid = normJid(cred?.meJid) || null
  const meLid = normJid(cred?.meLid) || null
  const recipients = [ctx?.event?.key?.recipientJid, ctx?.event?.key?.recipientAlt]
    .map(normJid)
    .filter((j) => Boolean(j) && (j.endsWith('@s.whatsapp.net') || j.endsWith('@lid')))
  const jids = [...new Set([
    num ? `${num}@s.whatsapp.net` : null,
    meJid,
    meLid,
    ...recipients,
  ].filter(Boolean))]
  return { num, meJid, meLid, jids }
}

/** Kumpulin mentionedJid dari SEMUA jenis pesan (teks, caption, bungkus). */
export function mentionedJids(ctx) {
  const out = new Set(Array.isArray(ctx?.mentioned) ? ctx.mentioned : [])
  const msg = unwrapMessage(ctx?.event?.message) || {}
  for (const v of Object.values(msg)) {
    const list = v?.contextInfo?.mentionedJid
    if (Array.isArray(list)) for (const j of list) out.add(j)
  }
  return [...out].filter(Boolean)
}

/** Pengirim pesan yang di-quote (swipe-reply). */
export function quotedParticipant(ctx) {
  const msg = unwrapMessage(ctx?.event?.message) || {}
  for (const v of Object.values(msg)) {
    const c = v?.contextInfo
    if (!c) continue
    const p = c.participant ?? c.participantAlt ?? c.remoteJid
    if (p) return p
  }
  return null
}

/** Ada balesan/quote? (stanzaId di contextInfo — setelah bungkus dilepas) */
export function hasQuoted(ctx) {
  const msg = unwrapMessage(ctx?.event?.message) || {}
  for (const v of Object.values(msg)) {
    if (v?.contextInfo?.stanzaId) return true
  }
  return false
}

/**
 * Cari gambar/stiker di pesan — yang dikirim langsung ATAU yang di-quote.
 * Balikin `{ node, field }` tanpa mengunduh.
 */
export function findImgNode(message) {
  const msg = unwrapMessage(message)
  if (!msg) return null
  for (const f of IMG_FIELDS) if (msg[f]) return { node: msg, field: f }
  for (const v of Object.values(msg)) {
    const quoted = v?.contextInfo?.quotedMessage
    if (!quoted) continue
    const q = unwrapMessage(quoted)
    if (!q) continue
    for (const f of IMG_FIELDS) if (q[f]) return { node: q, field: f }
  }
  return null
}

/** LID bot sendiri (kalau `credentials.meLid` kosong) — di-cache kalau ketemu. */
export async function botLid(ctx) {
  const { num, meLid } = botIdentity(ctx)
  if (meLid) return meLid
  if (!num) return null
  if (botLidCache?.num === num && botLidCache.lid) return botLidCache.lid
  try {
    const rows = await withTimeout(ctx.client?.profile?.getLidsByPhoneNumbers?.([num]), 3000, null)
    const lid = normJid((rows ?? [])[0]?.lidJid ?? (rows ?? [])[0]?.lid ?? null)
    if (lid) botLidCache = { num, lid }
    return lid
  } catch {
    return null
  }
}

/** `jid` ini bot sendiri? (device-insensitive, LID ikut dipetakan) */
export async function isBotJid(ctx, jid) {
  if (!jid) return false
  const j = normJid(jid)
  if (!j) return false
  const { num, jids } = botIdentity(ctx)

  if (num && jidUser(j) === num) return true
  if (jids.includes(j)) return true
  if (jids.some((x) => jidUser(x) === jidUser(j))) return true

  // LID yang belum cocok → petakan via participant grup DAN LID bot (paralel).
  if (!j.endsWith('@s.whatsapp.net')) {
    const [pn, lid] = await Promise.all([
      withTimeout(resolveLidToPn(ctx.client, ctx.chat, j), 2500, null),
      botLid(ctx),
    ])
    if (pn && normJid(pn) !== j) {
      if (num && jidUser(pn) === num) return true
      if (jids.includes(normJid(pn))) return true
      if (jids.some((x) => jidUser(x) === jidUser(pn))) return true
    }
    if (lid && jidUser(lid) === jidUser(j)) return true
  }
  return false
}

/**
 * Bot "diajak ngobrol"? = di-TAG (PN/LID/teks @nomor) ATAU dibales
 * (quote pesan bot) ATAU (di chat pribadi) pesan biasa.
 */
export async function isBotMentioned(ctx, conf = {}) {
  const { num, meLid } = botIdentity(ctx)
  if (conf?.mentionTrigger !== false) {
    const mentions = mentionedJids(ctx)
    if (mentions.length) {
      const hits = await Promise.all(mentions.map((j) => isBotJid(ctx, j)))
      if (hits.some(Boolean)) return true
    }
    const body = String(ctx.body || '').replace(INVISIBLE_RE, '')
    if (num && new RegExp(`@${num}(?![0-9])`).test(body)) return true
    const lidNum = jidUser(meLid)
    if (lidNum.length >= 6 && new RegExp(`@${lidNum}(?![0-9])`).test(body)) return true
  }
  if (conf?.replyTrigger !== false) {
    if (await isBotJid(ctx, quotedParticipant(ctx))) return true
    // Chat pribadi: lawan bicaranya cuma bot → tiap balesan = balesan pesan bot
    if (!ctx.isGroup && hasQuoted(ctx)) return true
  }
  // Chat pribadi = memang ngobrol sama bot → gak perlu tag/bales.
  if (!ctx.isGroup && conf?.privateAuto !== false) return true
  return false
}

/** Buang mention bot dari teks (biar prompt bersih). */
export function stripMention(text, num) {
  let t = String(text || '').replace(INVISIBLE_RE, '')
  if (num) t = t.replace(new RegExp(`@${num}(?![0-9])`, 'g'), ' ')
  return t.replace(/\s+/g, ' ').trim()
}
