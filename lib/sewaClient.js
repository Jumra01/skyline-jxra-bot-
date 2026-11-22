/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * sewaClient.js — Klien + cache state sewa grup dari skyline.web.id (D1).
 *
 * Sumber kebenaran TUNGGAL ada di D1 (/api/bot/sewa* dan /api/admin/sewa*).
 * Bot cuma nyimpen salinan di `data/sewa-cache.json` supaya:
 *   - gate tidak network request tiap pesan (cache 2 menit),
 *   - bot tetap bisa jalan kalau server sedang down (pakai cache terakhir).
 *
 * Semua error upstream dipetakan ke pesan internal — host/penyedia tidak
 * pernah ikut keluar ke chat.
 */
import { createJsonStore } from './jsonStore.js'
import { logger } from '../core/logger.js'
import { skylineCreds } from '../scraper/SKYLINE.js'

const CACHE_TTL_MS = 120_000
const WARN_INTERVAL_MS = 5 * 60_000
const store = createJsonStore('data/sewa-cache.json', { delay: 500 })
const lastWarn = new Map()
let inflight = null

const BLANK = { enabled: false, active: [], groups: [], stats: null, serverTime: null, fetchedAt: 0 }

function cached() {
  const raw = store.get('state')
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...BLANK, ...raw } : { ...BLANK }
}

function normJid(jid) {
  return String(jid ?? '').trim().replace(/:\d+@/, '@').toLowerCase()
}

/** Request JSON ke API sewa. Error dilempar sudah dalam bentuk aman. */
async function api(path, init = {}) {
  const { website, apikey } = skylineCreds()
  if (!apikey) throw Object.assign(new Error('API key skyline belum diisi'), { code: 'no_api_key' })

  let res
  try {
    res = await fetch(`${website}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apikey}`,
        ...(init.headers || {})
      },
      signal: AbortSignal.timeout(10_000)
    })
  } catch (err) {
    console.error('[sewa] network error:', err?.message || String(err))
    throw Object.assign(new Error('Layanan sewa sedang tidak bisa dihubungi'), { code: 'sewa_unavailable' })
  }

  let body = null
  try { body = await res.json() } catch { /* respons bukan JSON */ }

  if (!res.ok) {
    const code = String(body?.code || '')
    console.error('[sewa] HTTP', res.status, code)
    const pesan = {
      admin_required: 'API key bot tidak punya akses admin sewa',
      hourly_limit: 'Kuota API harian sudah habis',
      total_limit: 'Kuota API bulanan sudah habis',
      invalid_group: 'JID grup tidak valid',
      invalid_duration: 'Format durasi tidak valid',
      not_found: 'Grup belum terdaftar dalam sewa',
      already_lifetime: 'Sewa grup ini sudah permanen'
    }[code] || 'Permintaan sewa ditolak server'
    throw Object.assign(new Error(pesan), { code: code || 'sewa_request_failed' })
  }
  return body
}

/** Tarik state terbaru. Concurrent caller berbagi satu request. */
export async function refreshSewa() {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await api('/api/bot/sewa')
      if (!data || typeof data !== 'object' || !Array.isArray(data.active)) {
        throw new Error('Balasan sewa tidak dikenal')
      }
      const state = {
        enabled: !!data.enabled,
        active: data.active.map(normJid),
        groups: Array.isArray(data.groups) ? data.groups : [],
        stats: data.stats || null,
        serverTime: data.serverTime || null,
        fetchedAt: Date.now()
      }
      store.set('state', state)
      return state
    } catch (err) {
      console.error('[sewa] refresh gagal:', err?.message || String(err))
      return cached() // pakai salinan terakhir, jangan buka gate secara membabi buta
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export async function getSewaState({ force = false } = {}) {
  const state = cached()
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < CACHE_TTL_MS) return state
  return refreshSewa()
}

/** Paksa tarik ulang setelah aksi owner supaya gate langsung keupdate. */
export function invalidateSewa() {
  store.set('state', { ...cached(), fetchedAt: 0 })
}

export async function isGroupAllowed(jid) {
  const state = await getSewaState()
  if (!state.enabled) return { allowed: true, state }
  return { allowed: state.active.includes(normJid(jid)), state }
}

/** Satu aksi owner → D1, lalu cache lokal diinvalidasi. */
export async function sewaAction(action, payload = {}) {
  const out = await api('/api/bot/sewa/action', {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  })
  invalidateSewa()
  await refreshSewa()
  return out || {}
}

/** Peringatan ke grup: cukup sekali per 5 menit biar ga spam. */
export async function notifyLocked(ctx) {
  const key = normJid(ctx.chat)
  const now = Date.now()
  if (now - (lastWarn.get(key) || 0) < WARN_INTERVAL_MS) return
  lastWarn.set(key, now)

  try { await ctx.react('🔒') } catch { /* reaksi opsional */ }
  try {
    await ctx.reply(
`╭─🔒「 *GRUP BELUM DISEWA* 」🔒─╮
│
│ Bot ini belum aktif di grup kamu.
│ Command belum bisa dipakai sebelum
│ grup ini disewa.
│
│ 💬 Hubungi owner bot untuk sewa.
│ Cek status: *.ceksewa*
│
╰────────────────────✦╯`
    )
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'Gagal kirim peringatan sewa')
  }
}
