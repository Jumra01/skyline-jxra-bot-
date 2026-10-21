/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * waGroup.js — Helper aksi grup (promote/demote/kick/setdesc) yang tahan dua
 * mode alamat WhatsApp: grup PN-addressed (`x@s.whatsapp.net`) dan grup
 * LID-addressed (`x@lid`).
 *
 * Kenapa perlu: WhatsApp menolak aksi kalau jid participant yang dikirim
 * bukan bentuk yang dipakai grup itu (PN vs LID) — gejalanya error IQ
 * `403`/`404`/`409`. Jadi target selalu dicocokkan dulu ke daftar participant
 * metadata, lalu yang dikirim adalah `participant.jid` (bentuk asli grup).
 *
 * Bonus: `waErrText()` menerjemahkan kode error IQ WhatsApp jadi kalimat yang
 * ngerti manusia, biar chat gak nampilin `group.setDescription iq failed`.
 */

/** Digit nomor dari jid apa pun (device suffix `:12` dibuang). */
export function jidDigits(jid) {
  return String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

/** Dua jid/ nomor dianggap orang sama kalau digitnya sama. */
export function sameUser(a, b) {
  const x = jidDigits(a)
  const y = jidDigits(b)
  return Boolean(x) && x === y
}

/** Semua bentuk identitas yang mungkin dibawa satu participant metadata. */
export function idsOf(p) {
  if (!p || typeof p === 'string') return [String(p ?? '')].filter(Boolean)
  return [p.jid, p.lid, p.lidJid, p.phoneNumber, p.phoneJid, p.pnJid, p.jidAlt, p.id]
    .filter(Boolean)
    .map(String)
}

/**
 * Cari participant yang cocok dengan target (tag @lid, @s.whatsapp.net, nomor).
 * @returns participant metadata (bentuk asli grup) atau null
 */
export function findParticipant(meta, target) {
  const parts = meta?.participants ?? []
  if (!target) return null
  const digits = jidDigits(target)
  for (const p of parts) {
    if (typeof p === 'string') {
      if (sameUser(p, target)) return { jid: p, isAdmin: false, isSuperAdmin: false }
      continue
    }
    if (idsOf(p).some((id) => sameUser(id, target))) return p
    if (digits && idsOf(p).some((id) => jidDigits(id) === digits)) return p
  }
  return null
}

/** Participant milik bot sendiri (buat cek "bot admin grup atau bukan"). */
export function botParticipant(meta, creds) {
  const refs = [creds?.meJid, creds?.meLid, creds?.meNumber].filter(Boolean)
  for (const ref of refs) {
    const hit = findParticipant(meta, ref)
    if (hit) return hit
  }
  return null
}

/** `isAdmin`/`isSuperAdmin` dari participant (atau flag role lama). */
export function isParticipantAdmin(p) {
  if (!p) return false
  return Boolean(
    p.isAdmin ||
      p.isSuperAdmin ||
      p.rank === 'admin' ||
      p.rank === 'superadmin' ||
      p.role === 'admin' ||
      p.role === 'superadmin'
  )
}

/** Kode numerik dari error IQ zapo (`... iq failed (409: conflict)`). */
export function waErrorCode(err) {
  const m = /\((\d{3})\s*:/.exec(String(err?.message ?? err ?? ''))
  return m ? Number(m[1]) : 0
}

const CODE_TEXT = {
  400: 'permintaannya gak valid',
  401: 'sesi bot gak valid (coba `.restart`)',
  403: 'bot bukan admin grup / gak punya izin',
  404: 'target gak ada di grup ini',
  406: 'isinya ditolak WhatsApp (mungkin kepanjangan)',
  409: 'bentrok sama state grup sekarang (baru diubah orang lain / statusnya udah sama)',
  429: 'kelamaan / kebanyakan request, coba lagi nanti',
  500: 'server WhatsApp lagi error',
  503: 'server WhatsApp lagi gak siap',
}

/**
 * Terjemahkan error WhatsApp jadi kalimat manusia.
 * @param {unknown} err
 * @param {{ action?: string, fallback?: string }} [opts]
 */
export function waErrText(err, { action = 'aksi', fallback = '' } = {}) {
  const code = waErrorCode(err)
  const raw = String(err?.message ?? err ?? '').slice(0, 140)
  if (code && CODE_TEXT[code]) return `${CODE_TEXT[code]} (${code})`
  if (fallback) return fallback
  return raw || `${action} gagal`
}

/**
 * Ringkas hasil `*Participants()` zapo: cuma error yang dianggap gagal
 * (status `error`), sisanya sukses.
 * @returns {{ failed: Array<{jid:string, code:number, text:string}> }}
 */
export function failedResults(results) {
  const failed = []
  for (const r of results ?? []) {
    if (!r || r.status !== 'error') continue
    const code = Number(r.code) || 0
    const label = CODE_TEXT[code] || 'ditolak WhatsApp'
    failed.push({ jid: r.jid, code, text: code ? `${label} (${code})` : `${label}` })
  }
  return { failed }
}
