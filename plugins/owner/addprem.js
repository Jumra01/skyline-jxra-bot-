/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * addprem.js — Kelola user PREMIUM (table premiumdb, expiry di database).
 * UX ala skyline-md: balas pesan / tag / nomor, durasi = hari (default 30).
 * .addprem <nomor/@tag/balas pesan> [hari] | .delprem | .listprem | .cekprem
 */
import {
  touchUser,
  addPremium,
  removePremium,
  getPremiumUntil,
  listPremium,
  allPnJids,
} from '../../core/database.js'
import { resolveLidToPn } from '../../core/lid.js'
import { normalizeNumber } from '../../core/staff.js'

const pluginConfig = {
  name: "addprem",
  alias: ["addpremium", "setprem", "delprem", "delpremium", "listprem", "premlist", "cekprem"],
  category: "owner",
  description: "Kelola premium users (expiry di database)",
  usage: ".addprem <nomor/@tag/balas pesan> [hari]\n.delprem <nomor/@tag/urutan-premlist>\n.listprem\n.cekprem <nomor/@tag>",
  example: ".addprem 6281234567890 30 | .delprem 1",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

const DAY_MS = 86_400_000

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function toNumber(input) {
  let n = String(input ?? '').replace(/\D/g, '')
  if (n.startsWith('0')) n = '62' + n.slice(1)
  return n
}

/** Target: balas pesan > tag > args[0] (argumen pertama yang bukan hari). */
function extractTarget(ctx) {
  const q = ctx.event?.message?.extendedTextMessage?.contextInfo
  if (q?.participant && q?.quotedMessage) return q.participant
  if (ctx.mentioned?.length) return ctx.mentioned[0]
  const arg = ctx.args?.[0]
  return arg ?? null
}

/** Jid target → { jids: [pn, ...lid-simpanan], number, label } */
async function resolveTarget(ctx, rawJidOrNumber) {
  let jids = []

  if (typeof rawJidOrNumber === 'string' && rawJidOrNumber.includes('@')) {
    if (rawJidOrNumber.endsWith('@lid')) {
      const pn = await resolveLidToPn(ctx.client, ctx.chat, rawJidOrNumber)
      if (pn?.endsWith('@s.whatsapp.net')) {
        jids = [pn, rawJidOrNumber] // dual-store: PN + LID
      } else {
        return { error: '⚠️ Gak bisa resolve tag itu ke nomor. Tulis nomornya langsung (contoh: .addprem 628xxx 30)' }
      }
    } else {
      jids = [rawJidOrNumber]
    }
  } else {
    const number = toNumber(rawJidOrNumber)
    if (number.length < 10 || number.length > 15) {
      return { error: '❌ Format nomor tidak valid' }
    }
    jids = [`${number}@s.whatsapp.net`]
  }

  const pnJid = jids.find((j) => j.endsWith('@s.whatsapp.net'))
  const number = toNumber(pnJid.split('@')[0])
  return { jids, pnJid, number, label: `@${number}` }
}

/** Batch map LID→PN dari nomor yang pernah tercatat (buat .listprem di private chat). */
async function buildLidMap(client) {
  const map = new Map()
  const nums = allPnJids().map((j) => j.split('@')[0])
  for (let i = 0; i < nums.length; i += 50) {
    try {
      const rows = await client.profile.getLidsByPhoneNumbers(nums.slice(i, i + 50))
      for (const r of rows) {
        if (r?.lidJid && r?.phoneJid?.endsWith?.('@s.whatsapp.net')) map.set(r.lidJid, r.phoneJid)
      }
    } catch { /* skip batch gagal */ }
  }
  return map
}

// [FIX DELAY] Cache map LID→PN 10 menit — sebelumnya di-scan ulang tiap .listprem
// (network per batch) → list keliatan lambat.
const LID_MAP_TTL = 10 * 60 * 1000
let lidMapCache = { at: 0, map: null }

async function buildLidMapCached(client) {
  if (lidMapCache.map && Date.now() - lidMapCache.at < LID_MAP_TTL) return lidMapCache.map
  const map = await buildLidMap(client)
  lidMapCache = { at: Date.now(), map }
  return map
}

/**
 * Daftar premium merged & terurut — SATU sumber kebenaran buat .listprem
 * DAN .delprem-by-urutan (index-nya harus sama persis kayak yang ditampilkan).
 * Juga SELF-HEAL: row lid yang ke-resolve dipindah/dibuang dari DB.
 */
async function collectEntries(ctx) {
  const rows = listPremium()
  if (!rows.length) return []

  // Fallback global resolve LID→PN (kalau di private chat)
  let lidMap = null

  const merged = new Map()
  for (const r of rows) {
    let jid = r.jid
    if (jid.endsWith('@lid')) {
      let pn = null
      if (ctx.isGroup) {
        const resolved = await resolveLidToPn(ctx.client, ctx.chat, jid)
        if (resolved?.endsWith('@s.whatsapp.net')) pn = resolved
      }
      if (!pn) {
        lidMap ??= await buildLidMapCached(ctx.client)
        pn = lidMap.get(jid) ?? null
      }
      if (pn) {
        jid = pn
        removePremium(r.jid) // buang row lid — PN jadi satu-satunya
        if (!(getPremiumUntil(pn) > Date.now())) {
          touchUser(pn, null)
          addPremium(pn, Math.max(0, r.until - Date.now()))
        }
      }
    }
    const key = jid.split('@')[0]
    const prev = merged.get(key)
    const until = getPremiumUntil(jid) || r.until
    if (!prev || prev.until < until) merged.set(key, { jid, until, name: r.name ?? prev?.name ?? null })
  }

  return [...merged.values()].sort((a, b) => b.until - a.until)
}

async function handler(ctx) {
    const cmd = ctx.command
    const isAdd = ['addprem', 'addpremium', 'setprem'].includes(cmd)
    const isDel = ['delprem', 'delpremium'].includes(cmd)
    const isList = ['listprem', 'premlist'].includes(cmd)
    const isCek = cmd === 'cekprem'

    if (isList) {
      const entries = await collectEntries(ctx)
      if (!entries.length) {
        await ctx.reply('💎 Belum ada premium terdaftar')
        return
      }

      const now = Date.now()
      const mentions = entries
        .map((r) => (r.jid.endsWith('@s.whatsapp.net') ? r.jid : null))
        .filter(Boolean)
      const lines = entries.map((r, i) => {
        const number = toNumber(r.jid.split('@')[0])
        const remaining = Math.ceil((r.until - now) / DAY_MS)
        const status = remaining > 0 ? `${remaining}d` : 'Expired'
        return `${i + 1}. @${number} — ${status}`
      })

      const text = `💎 *DAFTAR PREMIUM*\n\n${lines.join('\n')}\n\nTotal: *${entries.length}* premium`
      await ctx.client.message.send(ctx.chat, {
        extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } }
      })
      return
    }

    const rawTarget = extractTarget(ctx)
    if (!rawTarget) {
      await ctx.reply(
        `💎 *${isAdd ? 'ADD' : isCek ? 'CEK' : 'DEL'} PREMIUM*\n\nMasukkan nomor, tag user, atau balas pesannya${isDel ? ' — bisa juga pakai urutan dari .listprem' : ''}\nContoh: ${ctx.prefix}${ctx.command} 6281234567890${isAdd ? ' 30' : ''}${isDel ? ` | ${ctx.prefix}delprem 1` : ''}`
      )
      return
    }

    // [UPDATE] .delprem by URUTAN — arg angka polos <10 digit = nomor urut di .listprem
    const q = ctx.event?.message?.extendedTextMessage?.contextInfo
    const hasQuote = Boolean(q?.participant && q?.quotedMessage)
    const hasMention = Boolean(ctx.mentioned?.length)
    if (isDel && !hasQuote && !hasMention && /^\d+$/.test(String(rawTarget)) && String(rawTarget).length < 10) {
      const entries = await collectEntries(ctx)
      if (!entries.length) {
        await ctx.reply('💎 Belum ada premium terdaftar')
        return
      }
      const idx = parseInt(rawTarget, 10)
      const entry = idx >= 1 ? entries[idx - 1] : null
      if (!entry) {
        await ctx.reply(
          `❌ Urutan *${rawTarget}* gak ada (list cuma ${entries.length}).\nCek urutannya: ${ctx.prefix}listprem`
        )
        return
      }
      removePremium(entry.jid)
      const number = toNumber(entry.jid.split('@')[0])
      await ctx.reply(`✅ Berhasil menghapus *${number}* (urutan ${idx}) dari premium`)
      void ctx.react('✅')
      return
    }

    const t = await resolveTarget(ctx, rawTarget)
    if (t.error) {
      await ctx.reply(t.error)
      return
    }

    if (isCek) {
      const until = getPremiumUntil(t.pnJid)
      if (!until) {
        await ctx.reply(`❌ ${t.label} bukan premium`)
        return
      }
      const remaining = Math.ceil((until - Date.now()) / DAY_MS)
      await ctx.reply(`💎 ${t.label} — premium\nSisa: *${remaining}d*\nExpired: *${formatDate(until)}*`)
      return
    }

    if (isAdd) {
      // Hari = argumen angka polos (≤4 digit), default 30. Bonus: dukung juga "1d"/"12h".
      let days = parseInt(ctx.args?.find((a) => /^\d+$/.test(a) && a.length <= 4), 10)
      if (!days) {
        const extra = ctx.args
          ?.filter((a) => !/^\d+$/.test(a) && !a.startsWith('@'))
          .join(' ')
        const m = extra?.match(/^(\d+(?:\.\d+)?)([dhms])(?:\s*(\d+(?:\.\d+)?)([dhms]))*$/i)
        if (m) {
          const unitMs = { d: DAY_MS, h: 3_600_000, m: 60_000, s: 1_000 }
          let ms = 0
          for (const mm of extra.matchAll(/(\d+(?:\.\d+)?)([dhms])/gi)) {
            ms += parseFloat(mm[1]) * unitMs[mm[2].toLowerCase()]
          }
          if (ms > 0) days = ms / DAY_MS
        }
      }
      if (!days || days <= 0) days = 30

      const existed = getPremiumUntil(t.pnJid) > Date.now()
      let until = 0
      for (const jid of t.jids) {
        touchUser(jid, null)
        until = addPremium(jid, days * DAY_MS)
      }

      // [FIX DELAY] reply dulu, react fire-and-forget — sebelumnya react (network RTT)
      // di-await sebelum reply → user nunggu lebih lama sebelum liat balasan.
      await ctx.reply(
        `✅ Berhasil ${existed ? 'memperpanjang' : 'menambahkan'} premium *${t.number}* selama *${days} hari*\nExpired: *${formatDate(until)}*`
      )
      void ctx.react('💎')
      return
    }

    // delprem
    if (!t.jids.some((jid) => getPremiumUntil(jid))) {
      await ctx.reply(`❌ *${t.number}* bukan premium`)
      return
    }
    for (const jid of t.jids) removePremium(jid)
    await ctx.reply(`✅ Berhasil menghapus *${t.number}* dari premium`)
    void ctx.react('✅')
  }

export { pluginConfig as config, handler };
