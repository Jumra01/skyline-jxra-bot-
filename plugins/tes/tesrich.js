/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tesrich.js — Lab tes & validasi keluarga AI rich response (`richResponseMessage`)
 * — khusus owner.
 *
 * ─────────────────────── Kenapa file ini ada ───────────────────────
 * Proto WA MEMBUANG DIAM-DIAM field yang salah nama / tak dikenal saat
 * encode (terbukti: `latexmetadata` → `latexMetadata = null`, `$unknowns = 0`,
 * tanpa error). Akibatnya payload yang salah justru terkirim "sukses" tapi
 * tampil biasa saja. Karena itu tiap varian divalidasi lewat roundtrip
 * encode→decode pakai proto asli SEBELUM dikirim, dan hasilnya dilaporkan.
 *
 * ─────────────────────── Jebakan proto yang SUDAH terbukti ───────────────────────
 * 1. Field salah nama → DIBUANG SENYAP tanpa error. `latexmetadata` balik
 *    `null`, `$unknowns = 0`. Makanya validator roundtrip wajib jalan.
 * 2. "URL" sering BUKAN string. `imageMetadata.imageUrl` bertipe message
 *    `AIRichResponseImageURL` = `{ imagePreviewUrl, imageHighResUrl,
 *    sourceUrl }`. Yang `latexMetadata.expressions[].url` baru string polos.
 * 3. Field `bytes` (mis. `unifiedResponse.data`) dibaca protobufjs sebagai
 *    BASE64 dari string, balik sebagai Buffer. Harus string base64 / Buffer —
 *    string JSON mentah dirusak senyap. Catatan: validator TIDAK bisa nangkep
 *    ini (decode-nya deterministik, jadi tetap "utuh"); yang menjaga cuma
 *    kebiasaan nulis base64 — lihat `lib/emeraldCard.js sendNativeHtml`.
 * Cek tipe field asli: `node_modules/zapo-js/spec/proto/index.d.ts`
 *
 * ─────────────────────── Cara nambah varian baru ───────────────────────
 * Cukup tambah SATU entri di array VARIANTS di bawah:
 *
 *   { id: 'namavarian', label: 'Nama', note: 'keterangan singkat',
 *     build: () => ({ submessages: [...] }) }
 *
 * ID harus unik (dipakai sebagai argumen: `.tesrich namavarian`), urutan
 * tampil = urutan array, dan otomatis ikut validasi + ringkasan. Jangan
 * sentuh handler buat nambah varian.
 *
 * ─────────────────────── Pemakaian ───────────────────────
 *   .tesrich           → semua varian berurutan + ringkasan
 *   .tesrich tabel      → satu varian saja
 *   .tesrich latexurl   → LaTeX ber-URL (kandidat perbaikan "tampil teks biasa")
 *
 * Envelope contextInfo WAJIB polos `{ isForwarded, forwardOrigin }` — jangan
 * tambah forwardingScore / forwardedAiBotMessageInfo, bikin WA minta update
 * (lihat log 2026-10-22 dan crm.js stripForward()).
 */
import crypto from 'node:crypto'
import { proto } from 'zapo-js'

const pluginConfig = {
  name: 'tesrich',
  alias: ['tesr', 'richsend'],
  category: 'tools',
  description: 'Lab tes AI rich response (teks/tabel/code/LaTeX/gambar/HTML) + validasi payload',
  usage: '.tesrich [teks|tabel|code|latex|latexurl|inlineimg|html]',
  example: '.tesrich latexurl',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
  energi: 0,
}

/* ────────────────────── envelope dasar ────────────────────── */

/**
 * Bungkus `botForwardedMessage > richResponseMessage`.
 * `contextInfo` polos = satu-satunya bentuk yang terbukti di repo ini
 * (lib/emeraldCard.js sendNativeHtml, ping2).
 */
function envelope(inner) {
  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          ...inner,
          contextInfo: { isForwarded: true, forwardOrigin: 4 }
        }
      }
    }
  }
}

/* ────────────────────── validasi roundtrip ────────────────────── */

/**
 * Cari jalur field di `expected` yang hilang / nilainya berubah di `actual`
 * (hasil decode). Field yang ditulis tapi tak dikenal encoder proto akan
 * lenyap senyap — inilah yang mau kita tangkap sebelum kirim ke WA.
 */
function missingPaths(expected, actual, path = '') {
  if (expected === null || expected === undefined) return []
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [path || '(array)']
    const out = []
    expected.forEach((v, i) => out.push(...missingPaths(v, actual[i], `${path}[${i}]`)))
    return out
  }
  if (typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return [path || '(obj)']
    const out = []
    for (const k of Object.keys(expected)) {
      out.push(...missingPaths(expected[k], actual[k], path ? `${path}.${k}` : k))
    }
    return out
  }
  // Field `bytes` proto (mis. `unifiedResponse.data`): string yang dilempar
  // dibaca protobufjs sebagai BASE64 lalu balik sebagai Buffer — nilainya
  // utuh, cuma tipenya berubah. Jangan dilaporkan hilang (false positive).
  if (actual instanceof Uint8Array) {
    const buf = Buffer.from(actual)
    const ok = Buffer.from(String(expected), 'base64').equals(buf) ||
      Buffer.from(String(expected), 'utf8').equals(buf)
    return ok ? [] : [path]
  }
  return actual === expected ? [] : [path]
}

/**
 * Roundtrip payload lewat proto WA asli.
 * @returns {{ ok: boolean, bytes: number, missing: string[] }}
 */
function verifyPayload(payload) {
  try {
    const bytes = proto.Message.encode(payload).finish().length
    const back = proto.Message.decode(proto.Message.encode(payload).finish())
    const missing = missingPaths(payload, back)
    return { ok: missing.length === 0, bytes, missing }
  } catch (err) {
    return { ok: false, bytes: 0, missing: [`encode gagal: ${err?.message || err}`] }
  }
}

/* ────────────────────── registry varian ────────────────────── */

// URL render LaTeX → PNG. Dicek hidup (HTTP 200, image/png) saat file ini dibuat.
const LATEX_PNG = 'https://latex.codecogs.com/png.image?E%20%3D%20mc%5E2'
// Gambar demo buat varian yang butuh URL polos (InlineImageMetadata.imageUrl).
const DEMO_IMG = LATEX_PNG

/**
 * Registry varian rich response. Nambah fitur = tambah entri di sini.
 * `build()` mengembalikan isi `richResponseMessage` (tanpa messageType/contextInfo).
 */
const VARIANTS = [
  {
    id: 'teks',
    label: 'Teks',
    note: 'submessage type 2 — teks berformat dalam rich',
    build: () => ({
      submessages: [
        { messageType: 2, messageText: '🧪 *TES RICH — TEKS*\nSubmessage type 2 (messageText) — kalau kamu baca ini, teks rich sampai.' }
      ]
    })
  },
  {
    id: 'tabel',
    label: 'Tabel',
    note: 'submessage type 4 — repro issue zapo #272 (yang dulu gak terkirim)',
    build: () => ({
      submessages: [
        {
          messageType: 4,
          tableMetadata: {
            title: 'Tes Tabel AI Rich Response',
            rows: [
              { items: ['Varian', 'Zapo', 'Status'], isHeading: true },
              { items: ['Teks', 'type 2', 'dicek'], isHeading: false },
              { items: ['Tabel', 'type 4', 'dicek'], isHeading: false },
              { items: ['Code', 'type 5', 'dicek'], isHeading: false },
              { items: ['LaTeX', 'type 8', 'dicek'], isHeading: false }
            ]
          }
        }
      ]
    })
  },
  {
    id: 'code',
    label: 'Code block',
    note: 'submessage type 5 — potongan kode ter-highlight',
    build: () => ({
      submessages: [
        { messageType: 2, messageText: '🧪 *TES RICH — CODE BLOCK*' },
        {
          messageType: 5,
          codeMetadata: {
            codeLanguage: 'javascript',
            codeBlocks: [
              { highlightType: 1, codeContent: 'const ' },
              { highlightType: 0, codeContent: 'tes = ' },
              { highlightType: 3, codeContent: "'rich response'" },
              { highlightType: 0, codeContent: ';\n' },
              { highlightType: 2, codeContent: 'console.log' },
              { highlightType: 0, codeContent: '(tes);' }
            ]
          }
        }
      ]
    })
  },
  {
    id: 'latex',
    label: 'LaTeX (tanpa URL)',
    note: 'submessage type 8 — KONTROL: expression tanpa `url`, ekspektasi jatuh ke teks',
    build: () => ({
      submessages: [
        {
          messageType: 8,
          latexMetadata: {
            text: 'Rumus tes: ',
            expressions: [{ latexExpression: 'E = mc^2', width: 100, height: 50 }]
          }
        }
      ]
    })
  },
  {
    id: 'latexurl',
    label: 'LaTeX + URL gambar',
    note: 'type 8 tapi `url` diisi PNG hasil render — kalau ini tampil, berarti varian `latex` cuma kekurangan URL',
    build: () => ({
      submessages: [
        {
          messageType: 8,
          latexMetadata: {
            text: 'Rumus tes (dengan url): ',
            expressions: [{ latexExpression: 'E = mc^2', url: LATEX_PNG, width: 74, height: 20 }]
          }
        }
      ]
    })
  },
  {
    id: 'inlineimg',
    label: 'Gambar inline (URL polos)',
    note: 'submessage type 3 — ngetes apakah URL external polos diizinkan WA (indikator kuat buat `latexurl`)',
    build: () => ({
      submessages: [
        { messageType: 2, messageText: '🧪 *TES RICH — INLINE IMAGE (URL polos)*' },
        {
          messageType: 3,
          imageMetadata: {
            // JANGAN: { imageUrl: 'https://...' } — `imageUrl` bukan string,
            // tapi message AIRichResponseImageURL. Salah ketik polos bikin
            // gambarnya senyap (terbukti lewat validasi roundtrip).
            imageUrl: {
              imagePreviewUrl: DEMO_IMG,
              imageHighResUrl: DEMO_IMG,
              sourceUrl: DEMO_IMG
            },
            imageText: 'gambar dari URL polos'
          }
        }
      ]
    })
  },
  {
    id: 'html',
    label: 'HTML unifiedResponse',
    note: 'GenAI unifiedResponse — envelope sama dengan kartu native bot (Aurora/ping2)',
    build: () => ({
      unifiedResponse: {
        // `data` bertipe proto `bytes`: string yang dilempar akan di-BASE64-DECODE
        // oleh protobufjs. Jadi WAJIB string base64 (atau Buffer) — dilempar string
        // JSON mentah, payloadnya rusak senyap. Persis seperti lib/emeraldCard.js.
        data: Buffer.from(JSON.stringify({
          __typename: 'GenAIUnifiedResponse',
          response_id: crypto.randomUUID(),
          sections: [{
            __typename: 'GenAIUnifiedResponseSection',
            view_model: {
              __typename: 'GenAISingleLayoutViewModel',
              primitive: {
                __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                trusted_sources: [],
                payload: '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tes Rich</title></head><body style="margin:0;background:#0b1220;color:#e7ecff;font-family:sans-serif"><div style="padding:24px"><h2 style="color:#7dd3fc">🧪 Tes Rich — HTML unifiedResponse</h2><p>Kartu HTML native lewat <b>richResponseMessage.unifiedResponse</b>.</p><p style="color:#94a3b8">Kalau kotak ini tampil, jalur GenAI unified response sehat.</p></div></body></html>'
              }
            }
          }]
        })).toString('base64')
      }
    })
  }
]

const BY_ID = Object.fromEntries(VARIANTS.map(v => [v.id, v]))

/* ────────────────────── handler ────────────────────── */

async function handler(ctx) {
  const pick = (ctx.args[0] || '').toLowerCase()

  if (pick && !BY_ID[pick]) {
    return ctx.reply(
      `Varian *${pick}* gak dikenal.\n\nPakai: ${VARIANTS.map(v => '`' + v.id + '`').join(' / ')}\natau .tesrich tanpa argumen buat kirim semuanya.`
    )
  }

  const targets = pick ? [BY_ID[pick]] : VARIANTS
  const rows = []
  let terkirim = 0

  await ctx.react('🧪')

  for (let i = 0; i < targets.length; i++) {
    const v = targets[i]

    // Validasi dulu — biar payload salah ketik ketahuan SEBELUM buang kuota
    // kirim, bukan sebagai "kok tampilnya biasa aja".
    const payload = envelope(v.build())
    const chk = verifyPayload(payload)
    const tag = `[${i + 1}/${targets.length}] ${v.id}`

    if (!chk.ok) {
      rows.push(`[⚠️] ${tag} — payload rusak sebelum kirim: ${chk.missing.slice(0, 4).join(', ')}${chk.missing.length > 4 ? `, +${chk.missing.length - 4} lagi` : ''}`)
      continue
    }

    // Penanda singkat per varian (mode semua saja) — kalau rich-nya dibuang
    // server, user tetap tahu varian mana yang hilang dari chat.
    if (targets.length > 1) await ctx.reply(`▶ ${tag}`)

    try {
      const res = await ctx.client.message.send(ctx.chat, payload, {
        additionalAttributes: { type: 'text' }
      })
      terkirim += 1
      rows.push(
        res?.ack?.error
          ? `[⚠️] ${tag} — ack error *${res.ack.error}* • ${chk.bytes}B • id \`${res.id ?? '?'}\``
          : `[✅] ${tag} — ack OK • ${chk.bytes}B • id \`${res.id ?? '?'}\``
      )
    } catch (err) {
      rows.push(`[❌] ${tag} — ${err?.message || String(err)}`)
    }

    // Jeda biar bubble urut & gak kebaca sebagai spam
    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 700))
  }

  const lines = [
    '🧪 *HASIL TES AI RICH RESPONSE*',
    '',
    ...rows,
    '',
    `Terkirim *${terkirim}/${targets.length}* (ack) • ${targets.length} varian divalidasi proto sebelum kirim.`,
    '',
    '⚠️ *Ack ≠ tampil.* Cocokkan dengan bubble di chat:',
    '• Muncul lengkap → lolos renderer',
    '• Hilang / jadi teks biasa → renderer nolak atau field gak dipakai',
    '• Gak ada sama sekali → server buang (gejala bug #272)',
    '• Error `479` → WA nolak family ini di chat/kondisi itu'
  ]
  await ctx.reply(lines.join('\n'))
}

// Buat tes programatik (lihat catatan verifikasi) — bukan bagian API publik.
const _internals = { envelope, verifyPayload, missingPaths, VARIANTS, BY_ID }

export { pluginConfig as config, handler, _internals }
