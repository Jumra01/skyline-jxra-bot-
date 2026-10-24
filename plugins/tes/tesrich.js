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
 * sentuh handler buat nambah varian. `build()` BOLEH async (dihandler) —
 * dipakai varian yang perlu fetch dulu, kayak `latexcard`.
 *
 * ─────────────────────── Temuan (sudah dites di device owner) ───────────────────────
 * Submessage rich type 3 & 8 TIDAK digambar oleh WhatsApp — keduanya jatuh
 * ke teks biasa:
 *   • type 8 (`AI_RICH_RESPONSE_LATEX`), `latex` (tanpa url) DAN `latexurl`
 *     (url PNG codecogs) → sama-sama teks.
 *   • type 3 (`AI_RICH_RESPONSE_INLINE_IMAGE`), `inlineimg` → URL-nya gak
 *     pernah di-fetch; `imageText`-nya yang tampil sebagai teks.
 * Artinya URL external polos TIDAK dipakai renderer WA (Meta AI sendiri
 * nyajiin asetnya dari CDN Meta). Konsekuensinya: ganti domain URL — termasuk
 * domain sendiri kayak skyline.web.id — TIDAK menolong, karena URL itu
 * di-fetch oleh client WA, bukan bot. `contentItemsMetadata` juga bukan wadah
 * alternatif (isinya cuma `reelItem`).
 *
 * Yang TERBUKTI tampil: kartu HTML (`htmlCard`) — aset ditandai sebagai
 * data-URI, karena remote <img> diblok WebView kartu tapi data-URI jalan
 * (lihat log 2026-10-22). Jadi buat gambar ATAU rumus, jalurnya sama:
 * render/fetch di sisi bot → data-URI → tanam di kartu.
 * Helper siap pakai: `renderLatexPng(tex)` → `{ buf, mime, width, height }`,
 * `dataUriOf(img)`, `htmlCard(html)`, `pngSize()`, `esc()`, `httpGetBuffer()`.
 *
 * ─────────────────────── Pemakaian ───────────────────────
 *   .tesrich            → semua varian berurutan + ringkasan
 *   .tesrich tabel       → satu varian saja
 *   .tesrich latexcard   → LaTeX jalan (kartu HTML + data-URI)
 *   .tesrich latexurl    → LaTeX jalur native type 8 (control, tampil teks)
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
  usage: '.tesrich [teks|tabel|code|latex|latexurl|inlineimg|html|latexcard]',
  example: '.tesrich latexcard',
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

/* ────────────────────── render LaTeX → gambar ────────────────────── */

// Endpoint render publik (gratis, tanpa API key). Yang fetch ini BOT, bukan
// WhatsApp — PNG-nya lalu ditanam sebagai data-URI di kartu HTML, karena
// WebView kartu memblokir <img> remote (lihat log 2026-10-22; itu juga
// sebabnya cover Aurora ditanam sebagai data-URI).
const LATEX_RENDER = 'https://latex.codecogs.com/png.image?'

/** Baca dimensi PNG dari header IHDR — tanpa dependency tambahan. */
function pngSize(buf) {
  // Signature PNG = 89 50 4E 47; offset 16/20 = width & height (uint32 BE).
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { width: 0, height: 0 }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** data-URI — satu-satunya bentuk gambar yang bisa digambar WebView kartu. */
function dataUriOf({ buf, mime }) {
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * Fetch buffer dengan jalur cadangan.
 *
 * Kenapa perlu: `fetch` bawaan Node bisa gagal di jaringan NAT64/DNS64 —
 * Happy Eyeballs-nya nyoba IPv6 yang gak ada lalu nyerah sebelum IPv4 keburu
 * nyambung (terbukti di mesin dev: ETIMEDOUT ~260ms padahal `curl` ke IP yang
 * sama sukses 200). Setting global `net.setDefaultAutoSelectFamily(false)`
 * memang menolong, tapi itu EFEK KE SELURUH PROSES bot, jadi jangan. Yang
 * dipakai di sini: retry per-request lewat axios (sudah dependency repo) dengan
 * `family: 4`. Gagal lewat sini = memang jaringan/servicenya, bukan urusan IP.
 *
 * HTTP error (404/500) TIDAK di-retry — cuma error jaringan.
 */
async function httpGetBuffer(url, { timeoutMs = 20_000, accept = 'image/*' } = {}) {
  const headers = { accept }
  let res = null
  let netErr = null
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers })
  } catch (err) {
    netErr = err
  }
  if (res) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      buf: Buffer.from(await res.arrayBuffer())
    }
  }

  try {
    const { default: axios } = await import('axios')
    const r = await axios.get(url, {
      timeout: timeoutMs,
      responseType: 'arraybuffer',
      family: 4,
      headers
    })
    return {
      status: r.status,
      contentType: r.headers?.['content-type'] || '',
      buf: Buffer.from(r.data)
    }
  } catch (err) {
    const via = netErr?.cause?.code || netErr?.message || '?'
    const now = err?.response?.status
      ? `HTTP ${err.response.status}`
      : (err?.code || err?.message || String(err))
    throw new Error(`${now} (fetch: ${via})`)
  }
}

/**
 * Render satu ekspresi LaTeX jadi PNG.
 * @returns {Promise<{ buf: Buffer, mime: string, width: number, height: number }>}
 */
async function renderLatexPng(tex) {
  const r = await httpGetBuffer(LATEX_RENDER + encodeURIComponent(tex))
  const mime = (r.contentType || '').split(';')[0].trim()
  if (!mime.startsWith('image/')) throw new Error(`balasan bukan gambar (${mime || 'tanpa content-type'})`)
  if (r.buf.length < 64) throw new Error('PNG kosong/truncated')
  return { buf: r.buf, mime, ...pngSize(r.buf) }
}

/** Escape teks buat disisipkan aman ke dalam HTML kartu. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/**
 * Bungkus HTML jadi `richResponseMessage.unifiedResponse` (GenAI).
 * Jalur ini yang terbukti render di bot ini (Aurora / ping2 / emeraldCard).
 */
function htmlCard(html) {
  return {
    unifiedResponse: {
      // `data` bertipe proto `bytes`: string yang dilempar di-BASE64-DECODE
      // protobufjs. Harus string base64 (atau Buffer) — string JSON mentah
      // dirusak senyap. Persis seperti lib/emeraldCard.js sendNativeHtml.
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
              payload: html
            }
          }
        }]
      })).toString('base64')
    }
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
    note: 'submessage type 3 — TIDAK digambar WA; fallback jadi teks. Konfirmasi: URL external gak di-fetch, jadi gak ada domain yang menolong',
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
    build: () => htmlCard(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tes Rich</title></head>' +
      '<body style="margin:0;background:#0b1220;color:#e7ecff;font-family:sans-serif;min-height:100vh">' +
      '<div style="padding:24px">' +
      '<h2 style="color:#7dd3fc;margin:0 0 12px">🧪 Tes Rich — HTML unifiedResponse</h2>' +
      '<p style="margin:0 0 8px">Kartu HTML native lewat <b>richResponseMessage.unifiedResponse</b>.</p>' +
      '<p style="color:#94a3b8;margin:0">Kalau kotak ini tampil, jalur GenAI unified response sehat.</p>' +
      '</div></body></html>'
    )
  },
  {
    id: 'latexcard',
    label: 'LaTeX via kartu HTML (data-URI)',
    // build() boleh async — handler meng-await-nya.
    note: 'jalur TERBUKTI: render LaTeX → PNG di sisi bot → tanam data-URI di kartu HTML',
    build: async () => htmlCard(await buildLatexCardHtml())
  }
]

/**
 * Kartu HTML berisi rumus hasil render. Gambar ditanam sebagai data-URI
 * (remote <img> diblok WebView kartu), jadi kartu ini tidak bergantung pada
 * apakah WhatsApp mau render submessage type 8.
 */
async function buildLatexCardHtml() {
  // Dua rumus: satu sederhana, satu kompleks — biar kelihatan ini typeset
  // beneran, bukan teks biasa yang kebetulan rapi.
  const demos = [
    { label: 'Relativitas', tex: 'E = mc^2' },
    {
      label: 'Rumus kuadrat',
      tex: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`
    }
  ]

  const blocks = []
  for (const d of demos) {
    let inner
    try {
      // `\color{white}` — codecogs ngerender default hitam, yang nyaris
      // hilang di latar kartu yang gelap. Dites: balik PNG valid.
      const img = await renderLatexPng(`\\color{white} ${d.tex}`)
      // codecogs ngerender kecil; diskalakan 2x biar jelas di layar HP.
      const w = img.width > 0 ? Math.min(img.width * 2, 480) : 0
      const h = img.width > 0 ? Math.round(img.height * (w / img.width)) : 0
      inner =
        `<img src="${dataUriOf(img)}" width="${w}" height="${h}" alt="rumus" ` +
        'style="display:block;margin:0 auto;max-width:100%;height:auto">' +
        `<p style="color:#64748b;font-size:11px;text-align:center;margin:10px 0 0">` +
        `${img.width}×${img.height}px • ${Math.round(img.buf.length / 102.4) / 10}KB • data-URI</p>`
    } catch (err) {
      inner = `<p style="color:#f87171;margin:0">Render gagal: ${esc(err?.message || String(err))}</p>`
    }
    blocks.push(
      '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(125,211,252,.18);' +
      'border-radius:14px;padding:16px;margin:0 0 14px">' +
      `<div style="color:#7dd3fc;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px">${esc(d.label)}</div>` +
      inner +
      // Sumber LaTeX ditampilin polos (tanpa delimiter \( \)) — kartu ini gak
      // punya engine math, delimiter-nya bakal kebaca literal dan bikin berantakan.
      `<div style="color:#94a3b8;font-size:11px;margin:12px 0 0;word-break:break-all">` +
      `<span style="color:#64748b">sumber:</span> ${esc(d.tex)}</div>` +
      '</div>'
    )
  }

  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LaTeX</title></head>' +
    '<body style="margin:0;background:#0b1220;color:#e7ecff;font-family:sans-serif;min-height:100vh">' +
    '<div style="padding:20px">' +
    '<h2 style="color:#7dd3fc;margin:0 0 4px">🧮 Tes Rich — LaTeX via kartu HTML</h2>' +
    '<p style="color:#94a3b8;font-size:12px;margin:0 0 16px">' +
    'Render di sisi bot lalu ditanam sebagai data-URI. Gak butuh submessage type 8.</p>' +
    blocks.join('') +
    '</div></body></html>'
  )
}

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

    const tag = `[${i + 1}/${targets.length}] ${v.id}`

    // Penanda singkat per varian (mode semua saja) — dikirim SEBELUM build
    // karena latexcard butuh waktu fetch hasil render; user perlu tanda
    // sedang proses, bukan diam tanpa kabar.
    if (targets.length > 1) await ctx.reply(`▶ ${tag}`)

    // Validasi dulu — biar payload salah ketik ketahuan SEBELUM buang kuota
    // kirim, bukan sebagai "kok tampilnya biasa aja". `build()` boleh async
    // (mis. latexcard fetch hasil render dulu).
    let payload
    try {
      payload = envelope(await v.build())
    } catch (err) {
      rows.push(`[❌] ${tag} — build gagal: ${err?.message || String(err)}`)
      continue
    }
    const chk = verifyPayload(payload)

    if (!chk.ok) {
      rows.push(`[⚠️] ${tag} — payload rusak sebelum kirim: ${chk.missing.slice(0, 4).join(', ')}${chk.missing.length > 4 ? `, +${chk.missing.length - 4} lagi` : ''}`)
      continue
    }

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
// `renderLatexPng`/`htmlCard` ikut diekspor karena bakal dipakai ulang waktu
// jalur ini naik jadi fitur beneran (bukan cuma plugin tes).
const _internals = {
  envelope, verifyPayload, missingPaths, VARIANTS, BY_ID,
  renderLatexPng, pngSize, dataUriOf, esc, htmlCard, buildLatexCardHtml,
  httpGetBuffer
}

export { pluginConfig as config, handler, _internals }
