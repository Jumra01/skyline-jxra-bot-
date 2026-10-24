/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * lid.js — Util resolusi LID → PN + kirim reply dengan mention rapi.
 *
 * Grup WA ada dua mode addressing (PN / LID). Resolver ini:
 * 1) baca dua bentuk identitas participant langsung (grup LID-addressed)
 * 2) fallback: resolve balik via getLidsByPhoneNumbers (grup PN-addressed)
 */

const isPn = (j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net')
const isLid = (j) => typeof j === 'string' && j.endsWith('@lid')

// Identitas dibanding device-insensitive: `628x:12@s.whatsapp.net` ≡ `628x@s.whatsapp.net`.
const jidUser = (j) => String(j ?? '').replace(/:\d+@/, '@').split('@')[0]
const sameUser = (a, b) => Boolean(a) && Boolean(b) && jidUser(a) === jidUser(b)
// Participant bisa bawa PN sebagai jid penuh atau nomor polos (`phoneNumber`).
const asPn = (v) => {
  if (typeof v !== 'string' || !v) return null
  if (v.endsWith('@s.whatsapp.net')) return v
  return /^\d{6,}$/.test(v) ? `${v}@s.whatsapp.net` : null
}

// Cache metadata grup 60 detik — queryGroupMetadata = panggilan network;
// tanpa cache, tiap resolve tag/balasan (.addprem/.delprem) menambah delay.
const META_TTL = 60_000
const metaCache = new Map() // groupJid → { at, meta }

async function getMetaCached(client, groupJid) {
  const hit = metaCache.get(groupJid)
  if (hit && Date.now() - hit.at < META_TTL) return hit.meta
  const meta = await client.group.queryGroupMetadata(groupJid)
  metaCache.set(groupJid, { at: Date.now(), meta })
  return meta
}

/** Metadata grup dengan cache 60s — dipakai lintas modul biar gak bolak-balik network. */
export { getMetaCached as getGroupMetaCached }

/** Kalau jid LID, petakan ke PN. Kalau gagal/udah PN, biarkan. */
export async function resolveLidToPn(client, groupJid, jid) {
  if (!isLid(jid)) return jid

  const want = jidUser(jid)
  try {
    const meta = await getMetaCached(client, groupJid)
    const parts = meta.participants ?? []

    // 1) Participant bawa dua bentuk identitas → map langsung
    //    (zapo: `jid` + `lid` / `phoneNumber`; bentuk lain dijaga kompatibel)
    for (const p of parts) {
      if (typeof p === 'string') continue
      const lids = [p.jid, p.lid, p.lidJid, p.jidAlt, p.participantJid, p.id].filter(isLid)
      const pns = [asPn(p.phoneNumber), p.jid, p.phoneJid, p.pnJid, p.jidAlt, p.participantJid].filter(isPn)
      if (pns.length && lids.some((l) => sameUser(l, jid) || jidUser(l) === want)) return pns[0]
    }

    // 2) Grup PN-addressed → resolve balik via getLidsByPhoneNumbers
    const pns = parts
      .map((p) => (typeof p === 'string' ? p : (asPn(p.phoneNumber) ?? p.jid)))
      .filter(isPn)
    if (pns.length) {
      const rows = await client.profile.getLidsByPhoneNumbers(pns.map((j) => jidUser(j)))
      for (const r of rows) {
        if (sameUser(r?.lidJid, jid) || sameUser(r?.lid, jid)) return asPn(r?.phoneJid) ?? asPn(r?.queriedJid) ?? jid
      }
    }
  } catch { /* biarkan apa adanya */ }

  return jid
}

/** Kirim teks dengan mention yang render nama (placeholder @user). */
export async function sendMention(client, chat, jid, text) {
  const pn = await resolveLidToPn(client, chat, jid)
  const num = pn.split('@')[0].split(':')[0]
  await client.message.send(chat, {
    extendedTextMessage: {
      text: text.replace('@user', `@${num}`),
      contextInfo: { mentionedJid: [pn] }
    }
  })
}
