/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * notifemerald.js — Fitur notif pemakaian emerald 🟩 (.notife).
 *
 * Notif dikirim sebagai kartu HTML native (lib/emeraldCard.js) tiap kali
 * command user SUKSES nyedot emerald. Fitur ini buat ON/OFF-in notifnya:
 *   .notife on / off        → preferensi per user (default: ON)
 *   .notife all on / off    → global buat semua user (khusus owner)
 *   .notife                 → cek status
 */
import config from '../../config.js'
import { isEmeraldNotifyOn, setEmeraldNotify } from '../../core/database.js'
import { getNotifyGlobal, setNotifyGlobal } from '../../lib/emeraldCard.js'

const pluginConfig = {
  name: "notife",
  alias: ['notifemerald'],
  category: "general",
  description: "Notifikasi pemakaian emerald — aktifkan/matikan",
  usage: ".notife [on|off|all on|all off]",
  example: ".notife off",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
  energi: 0,
};

const st = (b) => (b ? '✅ *AKTIF*' : '❌ *MATI*')

async function handler(ctx) {
    const arg = (ctx.args[0] || '').toLowerCase()
    const arg2 = (ctx.args[1] || '').toLowerCase()

    // ── Global (owner): .notife all on|off ──
    if (arg === 'all') {
      if (!ctx.isOwner) {
        await ctx.reply('🚫 Fitur ini khusus Owner bot.')
        return
      }
      if (arg2 !== 'on' && arg2 !== 'off') {
        await ctx.reply('Pakai: *.notife all on* atau *.notife all off*')
        return
      }
      const on = arg2 === 'on'
      const ok = setNotifyGlobal(on)
      await ctx.reply(
        !ok
          ? '⚠️ Gagal menyimpan pengaturan global.'
          : on
            ? '🔔 Notif emerald *global* dinyalakan buat SEMUA user.'
            : '🔕 Notif emerald *global* dimatikan buat SEMUA user.\nBalikin: *.notife all on*'
      )
      return
    }

    // ── Per user: .notife on|off ──
    if (arg === 'on' || arg === 'off') {
      const on = arg === 'on'
      setEmeraldNotify(ctx.sender, on)
      await ctx.reply(
        on
          ? `🔔 Notif pemakaian emerald *aktif*.\nKartu HTML muncul tiap kamu pakai command berbayar.`
          : `🔕 Notif pemakaian emerald *dimatikan*.\nLedger tetap tercatat — cek kapan pun di *.riwayat*.`
      )
      return
    }

    // ── Status ──
    const mine = isEmeraldNotifyOn(ctx.sender)
    const global = getNotifyGlobal()
    const master = config.emerald?.notify !== false
    const mode = config.emerald?.notify === 'private' ? 'khusus private chat' : 'semua chat'

    await ctx.reply(
`╭─🔔「 *STATUS NOTIF EMERALD* 」─╮
│
│ Notif kamu: ${st(mine)}
│ Global: ${st(global)}
│ Master config: ${st(master)} (${mode})
│
│ Efektif: ${mine && global && master ? '✅ *ON*' : '❌ *OFF*'}
│
│ ──  *CARA PAKAI*  ──
│ • *.notife off* — matikan buat kamu
│ • *.notife on* — nyalakan lagi
│ • *.notife all off* — (owner) global
│
│ Kartu notif = HTML native, tema
│ Minecraft, ukuran maks 9:16 + tombol
│ 👤 Info User & 📜 Riwayat.
│
╰────────────────────✦╯`
    )
  }

export { pluginConfig as config, handler };
