/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * commandExec.js — Izinkan handler AI (mis. `.ella2`) menjalankan command bot
 * beneran (tutup/buka grup, kick, promote, dll) atas permintaan user.
 *
 * Cara kerja:
 *   • Model diminta menandai aksi dengan baris `[[RUN: <perintah>]]` di balasan.
 *   • `parseRunMarkers()` memisahkan penanda dari teks balasan.
 *   • `mayExec()` = siapa yang boleh nyuruh (owner / staff / admin grup).
 *   • `runBotCommand()` resolve command lewat registry loader, cek izin, lalu
 *     jalankan handler-nya pakai ctx yang sama (balasannya langsung ke chat).
 *
 * Pengaman: daftar `allow` (cuma command yang diizinkan) + `deny` (hard-block,
 * mis. `restart`/`updatesc`) + flag plugin (`owner`/`admin`/`group`) tetap
 * dicek, jadi gak bisa nyuruh AI buka akses yang seharusnya gak boleh.
 *
 * Dua tingkat (tier) command:
 *   • `allow`     → AKSI ADMIN (tutup grup, kick, promote, ...). Cuma buat
 *                   owner/staff/admin grup — dicek `mayExec()` oleh pemanggil.
 *   • `userAllow` → FITUR UMUM (cari gambar, download, bikin stiker, ...).
 *                   Boleh diminta siapa saja, tapi tetap kena cooldown +
 *                   potongan emerald seperti kalau diketik manual.
 */
import config from '../config.js'
import { getFeature } from '../plugins/loader.js'
import { checkCooldown } from '../core/cooldown.js'
import { getEmerald, isPremiumActive, logEmeraldUse, spendEmerald } from '../core/database.js'

/** Baris penanda aksi dari AI, mis: [[RUN: g close]]. */
const RUN_RE = /^\s*\[\[\s*RUN\s*:\s*(.+?)\s*\]\]\s*$/i

/** Command yang gak boleh dijalankan lewat AI sama sekali. */
export const HARD_DENY = [
  'restart', 'reboot', 'restartbot', 'updatesc', 'update', 'gitupdate', 'pullbot', 'updatebot',
  'restore', 'pulih', 'balikin', 'clearcache', 'cc',
]

/** Siapa yang boleh nyuruh AI jalanin command. */
export function mayExec(ctx, { mode = 'admin', isGroupAdmin = false } = {}) {
  const m = String(mode ?? 'admin').toLowerCase()
  if (m === 'off' || m === '0' || m === 'false' || m === 'mati') return false
  if (ctx?.isOwner) return true
  if (m === 'owner') return false
  if (ctx?.isStaff) return true
  if (m === 'admin' && ctx?.isGroup && isGroupAdmin) return true
  return false
}

/** Pisahkan penanda `[[RUN: ...]]` dari teks balasan → { clean, actions }. */
export function parseRunMarkers(reply) {
  const actions = []
  const kept = []
  for (const line of String(reply ?? '').split('\n')) {
    const m = line.match(RUN_RE)
    if (m) {
      const cmd = m[1].replace(/[`*]/g, '').trim()
      if (cmd) actions.push(cmd)
      continue
    }
    kept.push(line)
  }
  const clean = kept.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim()
  return { clean, actions }
}

/** `gc close` → { name: 'gc', argText: 'close' }. */
export function splitCommand(token) {
  const raw = String(token ?? '')
    .replace(/^[.!\/#,\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return { name: '', argText: '' }
  const [name, ...rest] = raw.split(' ')
  return { name: name.toLowerCase(), argText: rest.join(' ').trim() }
}

/** Daftar nama command (token pertama) dari daftar `allow` yang berbentuk baris. */
export function allowNames(allow = []) {
  return [...new Set((allow || []).map((s) => splitCommand(s).name).filter(Boolean))]
}

/**
 * Nama asli (kanonik) sebuah command — alias ikut diresolve lewat registry.
 * `yts` → `ytsearch`, `ytmp3` → `yta`, `pin` → `pinterest`.
 * Penting: daftar izin ditulis pakai nama asli, sedangkan model/user sering
 * nyebut alias-nya.
 */
export function canonicalName(token) {
  const { name } = splitCommand(token)
  if (!name) return ''
  return String(getFeature(name)?.name || name).toLowerCase()
}

/**
 * Cooldown + potongan emerald buat FITUR UMUM yang dijalanin lewat AI.
 * Aturannya sama persis dengan `route()` — biar lewat AI gak jadi celah gratis
 * buat command berbiaya.
 * `meta` (opsional) diisi `{ cost, balance }` kalau emerald beneran kepotong —
 * dipakai pemanggil buat nampilin kartu pemakaian (CTA) setelah fitur sukses.
 * @returns {string|null} pesan error kalau gak boleh jalan, `null` kalau oke.
 */
export function chargeLikeRoute(ctx, feature, name, meta = {}) {
  // Kunci cooldown pakai nama ASLI command → gonta-ganti alias (yts ↔ ytsearch)
  // gak bisa dipakai buat ngakalin jeda.
  const key = String(feature?.name || name || '').toLowerCase()
  if (!ctx?.isStaff) {
    const cd = checkCooldown(ctx.sender, key, Number(feature.cooldown ?? config.cooldown ?? 0) || 0)
    if (cd.onCooldown) {
      return `\`${name}\` masih cooldown ${(cd.remainingMs / 1000).toFixed(1)} detik`
    }
  }

  if (config.emerald?.enabled === false || ctx.isOwner || ctx.isStaff) return null

  const cost = Math.max(0, Math.floor(Number(feature.energi ?? config.emerald?.defaultCost ?? 0) || 0))
  if (!cost) return null

  const premiumFree =
    isPremiumActive(ctx.sender) || (ctx.senderLid ? isPremiumActive(ctx.senderLid) : false)
  if (premiumFree) return null

  const have = getEmerald(ctx.sender)
  if (have < cost) {
    return `emerald kamu kurang buat \`${name}\` (punya ${have}, butuh ${cost}) — coba \`.daily\` dulu`
  }

  const sisa = spendEmerald(ctx.sender, cost)
  if (sisa === null) return `saldo emerald gak cukup buat \`${name}\``

  try {
    logEmeraldUse(ctx.sender, name, cost)
  } catch {
    /* pencatatan ledger gagal ≠ gagal jalanin fitur */
  }
  meta.cost = cost
  meta.balance = sisa
  return null
}

/**
 * Jalankan satu command bot atas nama ctx.
 * @returns {Promise<{ok:boolean, used?:string, error?:string}>}
 */
export async function runBotCommand(ctx, token, { allow = [], deny = [], userAllow = [], charge = true, open = false } = {}) {
  const { name, argText } = splitCommand(token)
  const used = `${name}${argText ? ` ${argText}` : ''}`
  if (!name) return { ok: false, error: 'perintah kosong' }

  // Resolve dulu: `yts` → `ytsearch`. Daftar izin ditulis pakai nama asli.
  const feature = getFeature(name)
  const canonical = String(feature?.name || name).toLowerCase()
  const as = (set) => set.has(name) || set.has(canonical)

  const denySet = new Set([...(deny || []), ...HARD_DENY].map((s) => String(s).toLowerCase()))
  if (as(denySet)) return { ok: false, error: `\`${name}\` gak boleh dijalanin lewat AI` }

  // `allow` kosong = semua command dianggap aksi admin (perilaku lama).
  const allowSet = new Set(allowNames(allow))
  const userSet = new Set(allowNames(userAllow))
  const inAdmin = allowSet.size === 0 || as(allowSet)
  const inUser = as(userSet)
  // `open` = peminta owner/staff bot → bebas milih command apa pun (kecuali
  // yang di-hard-deny di atas). Admin grup tetap terikat daftar `allow`.
  if (!inAdmin && !inUser && !open) {
    return { ok: false, error: `perintah \`${name}\` di luar daftar izin` }
  }
  const tier = inUser && !inAdmin ? 'user' : 'admin'

  if (!feature) return { ok: false, tier, error: `perintah \`${name}\` gak dikenal` }
  if (feature.isEnabled === false) return { ok: false, tier, error: `\`${name}\` lagi nonaktif` }

  // Flag plugin tetap dihormati (sama seperti gate di route()).
  // Premium = cek ke database (PN + LID), jangan cuma percaya ctx.
  if (feature.premium && !ctx.isOwner && !ctx.isStaff) {
    const premium = isPremiumActive(ctx.sender) || (ctx.senderLid ? isPremiumActive(ctx.senderLid) : false)
    if (!premium) return { ok: false, tier, error: `\`${name}\` khusus user premium` }
  }
  if (feature.owner && !ctx.isOwner) return { ok: false, tier, error: `\`${name}\` khusus owner` }
  if (feature.admin && !(ctx.isOwner || ctx.isStaff)) return { ok: false, tier, error: `\`${name}\` khusus admin bot` }
  if (feature.group && !ctx.isGroup) return { ok: false, tier, error: `\`${name}\` cuma bisa di grup` }
  if (feature.private && ctx.isGroup) return { ok: false, tier, error: `\`${name}\` cuma bisa di chat pribadi` }

  // Fitur umum: jeda & biaya tetap jalan biar bukan celah gratisan.
  const chargeMeta = {}
  if (tier === 'user' && charge) {
    const blocked = chargeLikeRoute(ctx, feature, name, chargeMeta)
    if (blocked) return { ok: false, tier, error: blocked }
  }

  const args = argText ? argText.split(/\s+/).filter(Boolean) : []
  const prefix = ctx.prefix || '.'
  const clone = {
    ...ctx,
    command: name,
    args,
    text: argText,
    body: `${prefix}${name}${argText ? ` ${argText}` : ''}`,
  }

  try {
    await feature.run(clone)
    return { ok: true, used, tier, charged: chargeMeta.cost || 0, balance: chargeMeta.balance ?? null }
  } catch (err) {
    return { ok: false, error: `\`${name}\` gagal: ${String(err?.message || err).slice(0, 120)}` }
  }
}

export const _internals = { RUN_RE, splitCommand }
