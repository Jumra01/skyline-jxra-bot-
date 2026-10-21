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
 */
import { getFeature } from '../plugins/loader.js'

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
 * Jalankan satu command bot atas nama ctx.
 * @returns {Promise<{ok:boolean, used?:string, error?:string}>}
 */
export async function runBotCommand(ctx, token, { allow = [], deny = [] } = {}) {
  const { name, argText } = splitCommand(token)
  const used = `${name}${argText ? ` ${argText}` : ''}`
  if (!name) return { ok: false, error: 'perintah kosong' }

  const denySet = new Set([...(deny || []), ...HARD_DENY].map((s) => String(s).toLowerCase()))
  if (denySet.has(name)) return { ok: false, error: `\`${name}\` gak boleh dijalanin lewat AI` }

  const allowSet = new Set(allowNames(allow))
  if (allowSet.size && !allowSet.has(name)) return { ok: false, error: `perintah \`${name}\` di luar daftar izin` }

  const feature = getFeature(name)
  if (!feature) return { ok: false, error: `perintah \`${name}\` gak dikenal` }
  if (feature.isEnabled === false) return { ok: false, error: `\`${name}\` lagi nonaktif` }

  // Flag plugin tetap dihormati (sama seperti gate di route()).
  if (feature.owner && !ctx.isOwner) return { ok: false, error: `\`${name}\` khusus owner` }
  if (feature.admin && !(ctx.isOwner || ctx.isStaff)) return { ok: false, error: `\`${name}\` khusus admin bot` }
  if (feature.group && !ctx.isGroup) return { ok: false, error: `\`${name}\` cuma bisa di grup` }
  if (feature.private && ctx.isGroup) return { ok: false, error: `\`${name}\` cuma bisa di chat pribadi` }

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
    return { ok: true, used }
  } catch (err) {
    return { ok: false, error: `\`${name}\` gagal: ${String(err?.message || err).slice(0, 120)}` }
  }
}

export const _internals = { RUN_RE, splitCommand }
