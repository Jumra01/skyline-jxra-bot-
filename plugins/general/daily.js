/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * daily.js — Klaim emerald 🟩 harian (.daily).
 *
 * Sumber emerald gratis: +30 per 24 jam (config.emerald.daily).
 * Ditolak kalau saldo udah penuh (64) — mending dipakai dulu.
 */
import config from '../../config.js'
import { claimDaily, getEmerald } from '../../core/database.js'

const pluginConfig = {
  name: "daily",
  alias: ['harian', 'klaim'],
  category: "general",
  description: "Klaim emerald 🟩 harian (+30 per 24 jam)",
  usage: ".daily",
  example: ".daily",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
  energi: 0,
};

function fmtDur(ms) {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h} jam ${m} menit`
  if (m) return `${m} menit ${sec} detik`
  return `${sec} detik`
}

async function handler(ctx) {
    const amount = Math.max(0, Number(config.emerald?.daily?.amount) || 30)
    const max = Math.max(1, Number(config.emerald?.max) || 64)
    const res = claimDaily(ctx.sender)

    if (res.error === 'cooldown') {
      await ctx.reply(
`⏳ *Klaim harian belum siap!*

Sisa waktu: *${fmtDur(res.remainingMs)}*
Coba lagi nanti, atau cek riwayat: *.riwayat*`
      )
      return
    }

    if (res.error === 'full') {
      await ctx.reply(
`🟩 *Saldo emerald penuh (${res.emerald}/${res.max})!*

Klaim sekarang bakal kebuang — pakai dulu saldomu:
• *.balance* — cek saldo
• *.riwayat* — riwayat pemakaian`
      )
      return
    }

    await ctx.reply(
`╭─🎁「 *KLAIM HARIAN* 」🎁─╮
│
│ ✅ Berhasil klaim *+${res.amount} 🟩*
│ 🟩 Saldo: *${res.emerald}/${res.max}*
│
│ 💡 Besok klaim lagi dengan *.daily*
│ 📜 Riwayat: *.riwayat*
│
╰────────────────────✦╯`
    )
  }

export { pluginConfig as config, handler };
