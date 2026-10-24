/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * voip.js — Panggilan WhatsApp (VOIP) lewat @zapo-js/voip — khusus owner.
 *
 * Cara kerja: client WaClient dipasangi plugin `voipPlugin()` di sky.js,
 * jadi semua API ada di `ctx.client.voip` (startCall/acceptCall/endCall/
 * loadAudio/getCalls). Media jalan lokal: codec MLow (WASM) + relay WebRTC
 * (@roamhq/wrtc); file audio di-decode ffmpeg ke 16 kHz mono lalu dikirim
 * sebagai voice call beneran ke target.
 *
 * Perintah:
 *   .voip <nomor|@tag> [file]  — nelpon + putar audio (file opsional)
 *   .voip accept | tolak       — angkat / tolak panggilan masuk
 *   .voip end                  — tutup panggilan aktif
 *   .voip status               — daftar panggilan + status deps
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EndCallReason } from '@zapo-js/voip'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { normalizeNumber } from '../../core/staff.js'
import { jidDigits } from '../../lib/waGroup.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DEFAULT_AUDIO_DIR = path.join(ROOT, 'assets', 'voip')

const pluginConfig = {
  name: 'voip',
  alias: ['call', 'nelpon'],
  category: 'owner',
  description: 'Panggilan WhatsApp (VOIP) — nelpon + putar audio, khusus owner',
  usage: '.voip <nomor|@tag> [file] | accept | tolak | end | status',
  example: '.voip 628xxxx halo.mp3',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 10,
  limit: 0,
  isEnabled: true,
  energi: 0,
}

const digits = (jid) => {
  try {
    return jidDigits(String(jid || ''))
  } catch {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  }
}

const ownerJids = () =>
  (config.owner?.numbers ?? [])
    .map((n) => normalizeNumber(String(n)))
    .filter(Boolean)
    .map((n) => `${n}@s.whatsapp.net`)

// Notifier panggilan masuk — daftar listener sekali per client (guard di
// object client biar aman waktu hot reload plugin).
function installNotifier(client) {
  if (client.__voipNotifier) return
  client.__voipNotifier = true

  client.on('voip_call_incoming', (call) => {
    const from = call.callerPn
      ? `+${digits(call.callerPn)}`
      : digits(call.peerJid) || call.peerJid
    const kind = call.isGroupCall ? ' grup' : ''
    const text =
      `📞 *Panggilan${kind} masuk!*\n` +
      `Dari: ${from}\n` +
      `ID: \`${call.callId}\`\n\n` +
      `Ketik *.voip accept* buat angkat / *.voip tolak* buat nolak.`
    for (const jid of ownerJids()) {
      client.message.send(jid, text).catch((err) =>
        logger.warn({ err: err?.message }, '[voip] gagal kirim notif panggilan masuk')
      )
    }
    logger.info(`[voip] panggilan masuk dari ${from} (${call.callId})`)
  })

  client.on('voip_call_error', (err) => {
    logger.warn({ err: err?.message }, '[voip] error media/panggilan')
  })
}

// Auto-end: begitu audio selesai diputar, panggilan ditutup + laporan ke chat.
function autoEndAfterAudio(client, callId, chat) {
  const onEnd = (call) => {
    if (call.callId !== callId) return
    client.off('voip_call_outbound_audio_finished', onFinished)
    client.message
      .send(chat, '✅ Audio selesai diputar — panggilan ditutup.')
      .catch(() => {})
  }
  const onFinished = (call) => {
    if (call.callId !== callId) return
    client.off('voip_call_ended', onEnd)
    client.voip
      ?.endCall(callId, EndCallReason.UserEnded)
      .then(() => client.message.send(chat, '✅ Audio selesai diputar — panggilan ditutup.').catch(() => {}))
      .catch((err) =>
        client.message.send(chat, `⚠️ Audio selesai tapi gagal nutup panggilan: ${err?.message}`).catch(() => {})
      )
  }
  client.on('voip_call_outbound_audio_finished', onFinished)
  client.on('voip_call_ended', onEnd)
}

// Cari file audio: path absolut/relatif dulu, lalu fallback ke assets/voip/.
function resolveAudio(input) {
  if (!input) return null
  const candidates = [
    path.resolve(input),
    path.resolve(ROOT, input),
    path.resolve(DEFAULT_AUDIO_DIR, input),
    path.resolve(DEFAULT_AUDIO_DIR, `${input}.mp3`),
    path.resolve(DEFAULT_AUDIO_DIR, `${input}.m4a`),
    path.resolve(DEFAULT_AUDIO_DIR, `${input}.ogg`),
  ]
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  }) ?? null
}

function callLine(call) {
  const state = call.stateData?.state ?? '?'
  const who = call.groupJid
    ? `grup ${digits(call.groupJid)}`
    : `+${digits(call.peerJid) || call.peerJid}`
  const dir = call.direction === 'outgoing' ? 'keluar ↗️' : 'masuk ↙️'
  return `• \`${call.callId}\` — ${dir} ke ${who} • ${state}`
}

async function handler(ctx) {
  const voip = ctx.client.voip
  if (!voip) {
    return ctx.reply(
      '❌ Fitur VOIP belum aktif di client.\n' +
        'Plugin `voipPlugin()` harus terpasang di sky.js + **restart bot** (perubahan core gak ikut hot reload).'
    )
  }

  installNotifier(ctx.client)

  const sub = String(ctx.args?.[0] ?? '').toLowerCase()

  // ---- status ----
  if (sub === 'status' || sub === 'cek') {
    const calls = voip.getCalls()
    const active = calls.filter((c) => c.stateData?.state !== 'ended')
    const lines = [
      '📡 *VOIP STATUS*',
      `Panggilan aktif: *${active.length}*`,
      ...(active.length ? active.map(callLine) : ['(tidak ada panggilan aktif)']),
      '',
      `Plugin: ${ctx.client.voip ? '✅ terpasang' : '❌ belum'}`,
      `maxConcurrentCalls: 1`,
    ]
    return ctx.reply(lines.join('\n'))
  }

  // ---- accept / tolak ----
  if (sub === 'accept' || sub === 'angkat' || sub === 'terima' || sub === 'reject' || sub === 'tolak' || sub === 'decline') {
    const accept = sub === 'accept' || sub === 'angkat' || sub === 'terima'
    const incoming = voip
      .getCalls()
      .filter((c) => c.direction === 'incoming' && c.stateData?.state !== 'ended')
    if (!incoming.length) return ctx.reply('ℹ️ Tidak ada panggilan masuk yang sedang berdering.')
    const call = incoming[incoming.length - 1]
    try {
      if (accept) {
        await voip.acceptCall(call.callId)
        return ctx.reply(`📞 Panggilan dari +${digits(call.peerJid)} diangkat.\nID: \`${call.callId}\``)
      }
      await voip.rejectCall(call.callId, EndCallReason.Declined)
      return ctx.reply(`📴 Panggilan dari +${digits(call.peerJid)} ditolak.`)
    } catch (err) {
      logger.warn({ err: err?.message }, '[voip] accept/reject gagal')
      return ctx.reply(`❌ Gagal: ${err?.message}`)
    }
  }

  // ---- end ----
  if (sub === 'end' || sub === 'tutup' || sub === 'hangup') {
    const active = voip
      .getCalls()
      .filter((c) => c.stateData?.state !== 'ended')
    if (!active.length) return ctx.reply('ℹ️ Tidak ada panggilan aktif buat ditutup.')
    const done = []
    for (const call of active) {
      try {
        await voip.endCall(call.callId, EndCallReason.UserEnded)
        done.push(call.callId)
      } catch (err) {
        logger.warn({ err: err?.message, callId: call.callId }, '[voip] endCall gagal')
      }
    }
    return ctx.reply(done.length ? `📴 ${done.length} panggilan ditutup.` : '❌ Semua gagal ditutup — cek log.')
  }

  // ---- nelpon ----
  const target = ctx.mentioned?.[0]
    ? ctx.mentioned[0]
    : (() => {
        const num = normalizeNumber(ctx.args?.[0] ?? '')
        return num ? `${num}@s.whatsapp.net` : ''
      })()

  if (!target) {
    const p = ctx.prefix || '.'
    return ctx.reply(
      '📞 *Format VOIP*\n' +
        `➤ \`${p}voip <nomor|@tag> [file]\` — nelpon + putar audio\n` +
        `➤ \`${p}voip accept\` / \`${p}voip tolak\` — angkat / tolak panggilan masuk\n` +
        `➤ \`${p}voip end\` — tutup panggilan aktif\n` +
        `➤ \`${p}voip status\` — cek status panggilan\n\n` +
        `File audio opsional (mp3/m4a/ogg/wav) — bisa path bebas atau nama file di \`assets/voip/\`.`
    )
  }

  // args[0] selalu target (nomor atau token @mention) → nama file dari args[1]+.
  // Token '@...' dibuang biar mention gak ikut jadi bagian nama file.
  const fileInput = ctx.args
    ?.slice(1)
    .filter((a) => !String(a).startsWith('@'))
    .join(' ')
    .trim()
  const audioPath = resolveAudio(fileInput)
  if (fileInput && !audioPath) {
    return ctx.reply(`❌ File audio tidak ditemukan: \`${fileInput}\``)
  }

  const label = `+${digits(target) || target}`
  try {
    await ctx.react('⏱️')
    const callId = await voip.startCall({ peerJid: target })
    logger.info(`[voip] startCall ${label} → ${callId}${audioPath ? ` • audio: ${path.basename(audioPath)}` : ''}`)

    // Kasih waktu ringing/connect sebelum load audio (loadAudio butuh call aktif).
    await ctx.reply(
      `📞 *Memanggil* ${label}...\n` +
        `ID: \`${callId}\`\n` +
        (audioPath ? `🔊 Audio: \`${path.basename(audioPath)}\`\n` : '') +
        `\nKetik \`.voip end\` buat nutup.`
    )

    if (audioPath) {
      // Tunggu call aktif dulu (maks ±30 dtk), lalu kirim audio.
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const now = voip.getCall(callId)
        if (!now || now.stateData?.state === 'ended') {
          return ctx.reply('❌ Panggilan berakhir sebelum audio sempat dikirim (ditolak / gagal connect).')
        }
        if (now.stateData?.state === 'active') break
        await new Promise((r) => setTimeout(r, 1_500))
      }
      const now = voip.getCall(callId)
      if (now?.stateData?.state !== 'active') {
        return ctx.reply(`⚠️ Panggilan belum aktif dalam 30 dtk (state: ${now?.stateData?.state}). Audio belum dikirim — angkat manual atau \`.voip end\`.`)
      }
      try {
        await voip.loadAudio(callId, audioPath)
        autoEndAfterAudio(ctx.client, callId, ctx.chat)
        logger.info(`[voip] audio dimuat → ${callId}`)
      } catch (err) {
        logger.warn({ err: err?.message }, '[voip] loadAudio gagal')
        return ctx.reply(`❌ Gagal memuat audio: ${err?.message}\nPanggilan tetap tersambung (tanpa audio) — \`.voip end\` buat nutup.`)
      }
    }
    await ctx.react('📞')
  } catch (err) {
    logger.warn({ err: err?.message }, '[voip] startCall gagal')
    await ctx.react('❌')
    return ctx.reply(`❌ Gagal nelpon: ${err?.message}`)
  }
}

export { pluginConfig as config, handler }
