/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * messageHandler.js — Routing pesan masuk: richMessage, command, anti-spam.
 */
import config from '../config.js'
import { logger } from '../core/logger.js'
import { buildContext } from '../core/context.js'
import { readRichReply } from '../lib/richMessage.js'
import { getFeature } from '../plugins/loader.js'
import { checkCooldown, checkFlood } from '../core/cooldown.js'
import { isBotGroupAdmin } from '../core/permission.js'
import { getGroupMetaCached } from '../core/lid.js'
import { touchUser, incrementCommand, getUser, topUsers, isPremiumActive, getEmerald, spendEmerald, logEmeraldUse, isEmeraldNotifyOn } from '../core/database.js'
import { sendUsageCard, getNotifyGlobal } from '../lib/emeraldCard.js'
import { sendTyping, markRead } from '../core/presence.js'
import { getGlobal } from '../core/groupSettings.js'
import { getMentionHandler } from '../core/mentionTrigger.js'
import { reactTo } from '../core/react.js'

const richHandlers = new Map()

export function onRichReply(id, handler) {
  richHandlers.set(id, handler)
}

// Karakter invisible yang diselipin WA di sekeliling mention
const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2069\ufeff]/g

function numOnly(jid) {
  return jid?.split('@')[0]?.split(':')[0] ?? jid
}

/** Cari nama tampilan buat satu jid (PN/LID). */
async function nameForJid(client, jid, metaParticipants, userRows) {
  // 1) field nama di metadata (kalau ada)
  const p = (metaParticipants ?? []).find((mp) => {
    if (typeof mp === 'string') return mp === jid
    const ids = [mp.jid, mp.lid, mp.phoneJid, mp.pnJid, mp.participantJid, mp.jidAlt, mp.lidJid, mp.phoneNumber]
    return ids.includes(jid)
  })
  
  let metaName = p && typeof p === 'object' ? (p.pushName || p.name || p.notify || p.verifiedName) : null
  
  // ✅ Tambah phoneNumber handling: kalau ada phoneNumber, lookup ke users DB
  if (!metaName && p?.phoneNumber) {
    const pnJid = `${p.phoneNumber}@s.whatsapp.net`
    const viaPhone = getUser(pnJid)?.name
    if (viaPhone) metaName = viaPhone
  }
  
  if (metaName) return metaName

  // 2) users DB langsung (jid sama)
  const direct = getUser(jid)
  if (direct?.name) return direct.name

  // 3) LID → PN via users DB + batch lookup
  if (jid?.endsWith('@lid')) {
    try {
      const pns = (userRows ?? [])
        .map((r) => r.jid)
        .filter((j) => j?.endsWith('@s.whatsapp.net'))
      if (pns.length) {
        const rows = await client.profile.getLidsByPhoneNumbers(pns.map(numOnly))
        const hit = (rows ?? []).find((r) => r?.lidJid === jid)
        const pn = hit?.phoneJid ?? hit?.queriedJid
        if (pn) {
          const u = (userRows ?? []).find((r) => r.jid === pn)
          if (u?.name) return u.name
        }
      }
    } catch { /* fallback */ }
  }

  return null
}

/** Beautify teks: replace @<jid/lid> dengan @<nama>. */
async function beautifyText(client, chat, text, mentionedJid) {
  if (!text) return text
  // Strip invisible chars biar regex match (WA nyelipin isolate di mention)
  let result = String(text).replace(INVISIBLE_RE, '')
  if (!mentionedJid?.length || !chat?.endsWith('@g.us')) return result

  let metaParticipants = []
  try {
    // [FIX DELAY] pakai metadata grup ber-cache — queryGroupMetadata langsung =
    // network call tiap pesan ber-tag → nunda command masuk.
    const meta = await getGroupMetaCached(client, chat)
    metaParticipants = meta.participants ?? []
  } catch { /* pakai users DB aja */ }

  const userRows = topUsers(1000)

  for (const jid of mentionedJid) {
    const name = await nameForJid(client, jid, metaParticipants, userRows)
    const display = name ?? numOnly(jid)
    const regex = new RegExp(`@${numOnly(jid)}(?![0-9])`, 'g')
    result = result.replace(regex, `@${display}`)
  }

  return result
}

async function describeMessage(client, chat, message) {
  if (!message) return '(pesan kosong)'

  if (message.conversation) {
    return `teks: "${await beautifyText(client, chat, message.conversation, null)}"`
  }

  if (message.extendedTextMessage?.text) {
    const text = message.extendedTextMessage.text
    const mentioned = message.extendedTextMessage.contextInfo?.mentionedJid ?? []
    return `teks: "${await beautifyText(client, chat, text, mentioned)}"`
  }

  if (message.imageMessage) {
    const caption = message.imageMessage.caption
    const mentioned = message.imageMessage.contextInfo?.mentionedJid ?? []
    const beautified = await beautifyText(client, chat, caption, mentioned)
    return `gambar 📷${beautified ? ` • "${beautified}"` : ''}`
  }

  if (message.videoMessage) {
    const caption = message.videoMessage.caption
    const mentioned = message.videoMessage.contextInfo?.mentionedJid ?? []
    const beautified = await beautifyText(client, chat, caption, mentioned)
    return `video 🎥${beautified ? ` • "${beautified}"` : ''}`
  }

  if (message.stickerMessage) return 'stiker 🟡'
  if (message.audioMessage) return 'audio 🎵'
  if (message.documentMessage) return `dokumen 📄 ${message.documentMessage.fileName ?? ''}`
  if (message.contactMessage) return 'kontak 👤'
  if (message.locationMessage) return 'lokasi 📍'
  const keys = Object.keys(message)
  return keys.length ? `(bentuk belum dikenal: ${keys.join(', ')})` : '(pesan kosong)'
}

export async function route(client, event) {
  if (event.key.fromMe) return

  const ctx = buildContext(client, event)
  const who = `${ctx.pushName || 'Anonim'} +${ctx.senderNumber}`
  const where = ctx.isGroup ? 'GRUP' : 'PRIV'

  if (config.autoRead) void markRead(client, event)

  // Mode global onlyPc / onlyGc (.onlypc / .onlygc) — owner selalu bisa akses
  // biar mode bisa dimatikan dari chat mana pun. Non-owner: diem aja (silent).
  if (!ctx.isOwner) {
    if (getGlobal('onlyPc') === '1' && ctx.isGroup) return
    if (getGlobal('onlyGc') === '1' && !ctx.isGroup) return
  }

  const richReply = readRichReply(event.message)
  if (richReply) {
    logger.info(`🖱️  ${who} [${where}] memilih "${richReply.id}"`)
    const handler = richHandlers.get(richReply.id)
    if (handler) {
      try {
        await handler(ctx, richReply)
      } catch (err) {
        logger.error({ err, id: richReply.id }, 'Handler richMessage gagal')
      }
    } else {
      logger.warn(`⚠️  Tidak ada handler untuk rich id "${richReply.id}"`)
    }
    return
  }

  if (
    event.message?.interactiveResponseMessage ||
    event.message?.buttonsResponseMessage ||
    event.message?.listResponseMessage ||
    event.message?.templateButtonReplyMessage
  ) {
    logger.warn({ raw: event.message }, '🧩 Respons richMessage belum dikenal')
    return
  }

  // ✅ Beautify mention di log
  const desc = await describeMessage(client, ctx.chat, event.message)
  logger.info(`💬 ${who} [${where}] ${desc}`)

  if (!ctx.body) return

  let matchedPrefix = ''
  for (const prefix of config.prefixes) {
    if (ctx.body.startsWith(prefix)) {
      matchedPrefix = prefix
      break
    }
  }

  // [AI] Trigger mention: pesan TANPA prefix yang nge-tag nomor bot ditangani
  // handler yang didaftarkan plugin (mis. plugins/ai/bot.js). Handler balikin
  // `true` kalau dia nanganin (bot beneran di-tag), `false` kalau bukan.
  if (!matchedPrefix) {
    const onMention = getMentionHandler()
    if (onMention) {
      // Indikator "typing…" juga di jalur tag (tanpa prefix) — dulu cuma jalur
      // command, jadi pas bot di-tag dia diem 3-6 detik tanpa jejak = kerasa mati.
      if (config.typingPresence) void sendTyping(client, ctx.chat)
      try {
        if (await onMention(ctx)) return
      } catch (err) {
        logger.error({ err }, 'Mention handler gagal')
      }
    }
    return
  }

  const withoutPrefix = ctx.body.slice(matchedPrefix.length).trim()
  const [commandName, ...args] = withoutPrefix.split(/\s+/)
  if (!commandName) return

  const feature = getFeature(commandName)
  if (!feature) return // Command gak ada → diem, no react

  // [UPDATE⭐] REACT: muncul di sini karena command valid
  void reactTo(client, event, '⏱️')

  touchUser(ctx.sender, ctx.pushName)

  if (!ctx.isStaff) {
    const rowPn = getUser(ctx.sender)
    const rowLid = ctx.senderLid ? getUser(ctx.senderLid) : undefined
    if (rowPn?.banned || rowLid?.banned) {
      logger.info(`🚫 ${who} [${where}] di-ban — command ${commandName} ditolak`)
      await ctx.reply('🚫 Kamu telah di-ban oleh owner bot.')
      return
    }
  }

  if (feature.owner && !ctx.isOwner) {
    await ctx.reply('🚫 Fitur ini khusus Owner bot.')
    return
  }

  if (feature.admin && !ctx.isAdmin) {
    await ctx.reply('🚫 Fitur ini khusus Owner/Admin bot.')
    return
  }

  // [UPDATE] Check template skyline: group / private / premium / botAdmin
  if (feature.group && !ctx.isGroup) {
    await ctx.reply(config.messages?.groupOnly || '🚫 Fitur ini khusus GRUP!')
    return
  }

  if (feature.private && ctx.isGroup) {
    await ctx.reply(config.messages?.privateOnly || '🚫 Fitur ini khusus PRIVATE CHAT!')
    return
  }

  // Premium = expiry di database (table premiumdb, diatur via .addprem).
  // Cek PN + LID biar kena juga kalau identitas datang sebagai @lid.
  if (feature.premium && !ctx.isOwner && !ctx.isStaff) {
    const active = isPremiumActive(ctx.sender) || (ctx.senderLid ? isPremiumActive(ctx.senderLid) : false)
    if (!active) {
      await ctx.reply(config.messages?.premiumOnly || '💎 Fitur ini khusus PREMIUM user!')
      return
    }
  }

  if (feature.botAdmin && ctx.isGroup && !(await isBotGroupAdmin(ctx))) {
    await ctx.reply(config.messages?.botAdminOnly || '🛡 Bot harus jadi ADMIN grup dulu.')
    return
  }

  if (!ctx.isStaff && config.antiSpam?.enabled) {
    const flood = checkFlood(ctx.sender, config.antiSpam)
    if (flood.flooded) {
      await ctx.reply(`🐢 Pelan-pelan! Tunggu ${(flood.remainingMs / 1000).toFixed(0)} detik.`)
      return
    }
  }

  if (!ctx.isStaff) {
    const cd = checkCooldown(ctx.sender, commandName, feature.cooldown ?? config.cooldown ?? 0)
    if (cd.onCooldown) {
      await ctx.reply(`⏳ Tunggu ${(cd.remainingMs / 1000).toFixed(1)} detik buat pakai ${matchedPrefix}${commandName}.`)
      return
    }
  }

  // [UPDATE] EMERALD 🟩 — biaya command. Owner/staff/premium bebas.
  // Biaya = `energi:` di config plugin, atau config.emerald.defaultCost.
  // Dipotong SEBELUM run (anti-abuse), dicatat ke ledger emerald_log.
  let emeraldCost = 0
  let emeraldAfter = 0
  if (config.emerald?.enabled !== false && !ctx.isOwner && !ctx.isStaff) {
    const cost = Math.max(0, Math.floor(Number(feature.energi ?? config.emerald?.defaultCost ?? 0) || 0))
    const premiumFree = cost > 0 && (
      isPremiumActive(ctx.sender) || (ctx.senderLid ? isPremiumActive(ctx.senderLid) : false)
    )
    if (cost > 0 && !premiumFree) {
      const have = getEmerald(ctx.sender)
      if (have < cost) {
        logger.info(`🟩 ${who} [${where}] emerald kurang buat ${commandName} (${have}/${cost})`)
        await ctx.reply(
`╭─💚「 *EMERALD KURANG* 」💚─╮
│
│ 🟩 Saldo kamu: *${have}*
│ 💸 Butuh buat .${commandName}: *${cost}*
│
│ Cara nambah:
│ • *.daily* — klaim harian (+30)
│ • Tunggu regen *+10 / 10 menit*
│ • Main RPG — *.hunt* *.battle* *.quest*
│ • Cek riwayat — *.riwayat*
│
╰────────────────────✦╯`
        )
        return
      }
      const sisa = spendEmerald(ctx.sender, cost)
      if (sisa === null) {
        await ctx.reply('💚 Saldo emerald gak cukup. Cek .balance ya.')
        return
      }
      emeraldCost = cost
      emeraldAfter = sisa
      try { logEmeraldUse(ctx.sender, commandName, cost) } catch (err) {
        logger.warn({ err }, 'Gagal catat log emerald')
      }
    }
  }

  if (config.typingPresence) void sendTyping(client, ctx.chat)

  ctx.prefix = matchedPrefix
  ctx.command = commandName.toLowerCase()
  ctx.args = args
  ctx.text = withoutPrefix.slice(commandName.length).trim()

  incrementCommand(ctx.sender)
  logger.info(`⚙️  [CMD] ${matchedPrefix}${commandName} oleh +${ctx.senderNumber}${ctx.role ? ` (${ctx.role})` : ''}`)

  try {
    await feature.run(ctx)

    // [UPDATE] Notif pemakaian emerald — kartu HTML native setelah fitur SUKSES.
    // Bisa dimatikan per-user (.notife off), global (.notife all off),
    // atau via config.emerald.notify (false / 'private').
    if (emeraldCost > 0) {
      try {
        const mode = config.emerald?.notify
        const allowed =
          mode !== false &&
          isEmeraldNotifyOn(ctx.sender) &&
          getNotifyGlobal() &&
          (mode !== 'private' || !ctx.isGroup)
        if (allowed) {
          void sendUsageCard(ctx, {
            command: `${matchedPrefix}${commandName}`,
            cost: emeraldCost,
            balance: emeraldAfter,
            description: feature.description ?? '',
          }).catch((err) => logger.warn({ err }, 'Notif emerald gagal dikirim'))
        }
      } catch (err) {
        logger.warn({ err }, 'Notif emerald gagal disiapkan')
      }
    }
  } catch (err) {
    logger.error({ err, feature: feature.name }, 'Feature gagal dijalankan')
    await ctx.reply(`⚠️ Terjadi error saat menjalankan ${matchedPrefix}${feature.name}.`)
  }
}
