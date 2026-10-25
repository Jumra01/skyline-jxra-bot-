/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tesbutton.js — Lab tombol WhatsApp: kirim SEMUA bentuk tombol yang mungkin
 * didukung zapo-js, lalu pakai tombolnya buat lihat respons balikannya.
 * Khusus owner, murni diagnosa.
 *
 * ─────────────────────── Kenapa file ini ada ───────────────────────
 * Bot ini selama ini cuma pakai 4 bentuk: `quick_reply`, `cta_url`,
 * `cta_copy`, dan `single_select` (semua lewat `lib/richMessage.js`). Proto
 * yang di-vendor zapo (`node_modules/zapo-js/spec/proto/index.d.ts`) punya
 * keluarga jauh lebih luas: `buttonsMessage` (family lama), `listMessage`,
 * `templateMessage` hydrated, `productMessage`, header dokumen/lokasi/produk,
 * carousel, dan nama tombol `cta_call`. Mana yang dirender WhatsApp versi
 * owner, mana yang dibuang senyap, mana yang butuh akun bisnis — tidak ada
 * cara mengetahuinya selain kirim dan lihat.
 *
 * ─────────────────────── Jebakan proto (sudah terbukti di sini) ───────────────────────
 * 1. Field salah nama / tak dikenal → encoder protobufjs MEMBUANGNYA SENYAP
 *    tanpa error (sama seperti `plugins/tes/tesrich.js`: `latexmetadata` →
 *    `null`). Makanya tiap varian di-roundtrip `proto.Message.encode → decode`
 *    SEBELUM dikirim dan hasilnya dilaporkan.
 * 2. Nama tombol beda keluarga = renderer beda, dan zapo sudah menanganinya:
 *    `quick_reply`/`cta_*` → `biz <interactive type=native_flow
 *    v=1><native_flow v=9 name=mixed>` (node `buildButtonAddonNode('interactive')`,
 *    dipasang otomatis oleh `WaMessageDispatchCoordinator`);
 *    `single_select`/`payment_info`/`order_details`/`review_and_pay` → nama
 *    yang sama di node `biz`; `listMessage` → `biz <list type=product_list v=2>`
 *    (di grup malah jadi `type=media mediatype=list` + `<biz><list>`, kalau
 *    tidak server nack 479 — lihat `resolveOutboundStanzaShape`).
 *    Plugin ini TIDAK menambah node sendiri; yang diuji persis jalur zapo.
 * 3. `viewOnceMessage` wajib membungkus `interactiveMessage` (pola menu v7 /
 *    `lib/carousel.js`) supaya `messageContextInfo` ikut terkirim.
 * 4. `productMessage` tanpa gambar sungguhan menghasilkan `bytes` valid tapi
 *    gambar kosong di sisi WA — varian H dipisah sebagai tes produk TOP-LEVEL
 *    (field `product.productImage` butuh `mimetype` + `fileLength` +
 *    `jpegThumbnail`, bukan `url` polos).
 *
 * ─────────────────────── Yang diuji (urutan = urutan array VARIANTS) ───────────────────────
 *  A  nativeFlow: quick_reply + cta_url + cta_copy + cta_call
 *  B  single_select 2 section + cta_url di belakang
 *  C  cta_url + webview_presentation / webview_interaction
 *  D  header gambar (upload asli) + 1 tombol
 *  E  header video/gif (upload asli) + 1 tombol
 *  F  header dokumen (upload asli) + 1 tombol
 *  G  header lokasi + 1 tombol
 *  H  productMessage top-level (gambar asli + harga)
 *  I  carousel 3 kartu (jpegThumbnail + tombol per kartu)
 *  J  buttonsMessage family lama (3 tombol)
 *  K  listMessage family lama (2 baris)
 *  L  templateMessage hydrated (quick reply / url / call)
 *  M  payment_info + review_and_pay
 *  N  order_details
 *  O  katalog bisnis: collection / storefront / bloks widget
 *  P  tombol telepon family lama (hydrated callButton)
 *
 * Pemakaian:
 *   .tesbutton          → semua varian berurutan + ringkasan ack
 *   .tesbutton A        → satu varian (A–P, case-insensitive)
 *   .tesbutton qr|url|list|single|tpl|product|carousel|buttons|pay|order|widget|call|img|doc|video|location
 *   .tesbutton all      → sama dengan tanpa argumen
 *
 * Catatan: ack OK ≠ tombol tampil. Yang menentukan adalah bubble di chat dan
 * apakah tombolnya merespons saat ditekan (log `🖱️ ... memilih "<id>"`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { proto } from 'zapo-js'
import { logger } from '../../core/logger.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { execFile } from 'node:child_process'

const pluginConfig = {
  name: 'tesbutton',
  alias: ['testbutton', 'btnlab', 'tomboltes'],
  category: 'interactive',
  description: 'Lab tombol WA: kirim semua bentuk tombol zapo + baca responsnya (owner)',
  usage: '.tesbutton [A-P|all|qr|url|list|single|tpl|product|carousel|buttons|pay|order|widget|call]',
  example: '.tesbutton A',
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

/* ══════════════ util payload ══════════════ */

const ID = () => `tesbtn:${Math.random().toString(36).slice(2, 8)}`

const wrap = (interactiveMessage) => ({
  viewOnceMessage: {
    message: {
      messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
      interactiveMessage
    }
  }
})

/**
 * Bungkus templateMessage. CATATAN: di dalam `interactiveMessage`,
 * `interactiveMessage.templateMessage` di-DROP proto (dibuktikan: payload 21B,
 * field hilang, `unknowns = 0`). Template harus top-level di dalam
 * `viewOnceMessage.message` — persis pola `message.templateMessage`.
 */
const wrapTemplate = (templateMessage) => ({
  viewOnceMessage: {
    message: {
      messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
      templateMessage
    }
  }
})

/** Tombol nativeFlow → `{ name, buttonParamsJson }` (params di-stringify). */
const nf = (name, params) => ({ name, buttonParamsJson: JSON.stringify(params) })

const quickReply = (text, id = ID()) => nf('quick_reply', { display_text: text, id })

const ctaUrl = (text, url = 'https://skyline.web.id', extra = {}) =>
  nf('cta_url', { display_text: text, url, merchant_url: url, ...extra })

const ctaCopy = (text, copy) => nf('cta_copy', { display_text: text, copy_text: copy })

const ctaCall = (text, phone = '6281234567890') =>
  nf('cta_call', { display_text: text, phone_number: phone })

const singleSelect = (title, buttonText, sections) =>
  nf('single_select', {
    title,
    button_text: buttonText,
    sections: sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.id ?? ID(),
        title: r.title,
        description: r.description ?? ''
      }))
    }))
  })

/** Tombol kartu template (format TV2) — bedakan dengan nativeFlow: gunakan kunci
 * `quickReplyButton`/`urlButton`/`callButton`, bukan `name`/`buttonParamsJson`. */
const tplBtn = (type, payload) => ({ [type]: payload })

/**
 * Roundtrip lewat proto WA asli — field yang di-drop encoder ketahuan di sini.
 * @returns {{ ok: boolean, bytes: number, missing: string[], unknowns: number }}
 */
function verifyPayload(payload) {
  try {
    const buf = proto.Message.encode(payload).finish()
    const back = proto.Message.decode(buf)
    return {
      ok: true,
      bytes: buf.length,
      missing: missingPaths(payload, back),
      unknowns: back.$unknowns?.length ?? 0
    }
  } catch (err) {
    return { ok: false, bytes: 0, missing: [`encode gagal: ${err?.message || String(err)}`], unknowns: -1 }
  }
}

/**
 * Nilai int64 proto (`fileLength`, `priceAmount1000`, `totalAmount1000`, dst.)
 * decode-nya jadi objek Long `{ low, high, unsigned }` — bukan number. Tanpa
 * penanganan ini tiap payload media/produk dilaporkan "rusak" padahal utuh
 * (false positive; persis kelas jebakan base64 di `plugins/tes/tesrich.js`).
 */
function isLong(v) {
  return v && typeof v === 'object' && typeof v.low === 'number' && typeof v.high === 'number'
}

function missingPaths(expected, actual, p = '') {
  if (expected === null || expected === undefined) return []
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [p || '(array)']
    return expected.flatMap((v, i) => missingPaths(v, actual[i], `${p}[${i}]`))
  }
  if (typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return [p || '(obj)']
    return Object.keys(expected).flatMap((k) => missingPaths(expected[k], actual[k], p ? `${p}.${k}` : k))
  }
  if (actual instanceof Uint8Array) {
    const buf = Buffer.from(actual)
    const ok = Buffer.from(String(expected), 'base64').equals(buf) ||
      Buffer.from(String(expected), 'utf8').equals(buf)
    return ok ? [] : [p]
  }
  if (isLong(actual) && typeof expected === 'number') {
    return actual.toNumber() === expected ? [] : [p]
  }
  return actual === expected ? [] : [p]
}

/* ══════════════ aset upload ══════════════ */

const MEDIA_DIR = () => path.join(process.cwd(), 'assets/voip')

/**
 * Gambar header: `assets/thumb/menu.jpg` → jpeg ≤1024px + thumbnail 32px.
 * Wajib ada `jpegThumbnail` — tanpa itu header media sering ditolak renderer.
 */
async function buildImageHeader(ctx, sharp) {
  const raw = fs.readFileSync(path.join(process.cwd(), 'assets/thumb/menu.jpg'))
  const bytes = await sharp(raw).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  const meta = await sharp(bytes).metadata()
  const thumb = await sharp(bytes).resize(32).jpeg({ quality: 50 }).toBuffer()
  const up = await ctx.client.message.upload(bytes, { type: 'image', mimetype: 'image/jpeg' })
  return {
    title: '',
    hasMediaAttachment: true,
    imageMessage: { ...up, mimetype: 'image/jpeg', width: meta.width, height: meta.height, jpegThumbnail: thumb }
  }
}

/** Dokumen header: PNG/gif dari aset → diupload sebagai document. */
async function buildDocumentHeader(ctx, sharp, bytes, fileName, mimetype) {
  const meta = await sharp(bytes).metadata()
  const up = await ctx.client.message.upload(bytes, { type: 'document', mimetype })
  return {
    title: fileName,
    hasMediaAttachment: true,
    documentMessage: { ...up, fileName, mimetype, title: fileName, pageCount: 1, fileLength: bytes.length, fileSha256: up.fileSha256 }
  }
}

/** Cari aset media cadangan (gif/webm/mp4/png) di `assets/voip/`. */
function pickMediaAsset(exts) {
  try {
    for (const f of fs.readdirSync(MEDIA_DIR())) {
      if (exts.some((e) => f.toLowerCase().endsWith(e))) return path.join(MEDIA_DIR(), f)
    }
  } catch { /* folder belum ada */ }
  return null
}

/* ══════════════ registry varian ══════════════ */

const ORDER_PARAMS = {
  order_image: [],
  total_amount: 'Rp10000',
  currency: 'IDR',
  order_id: 'TES-ORDER-1',
  order_title: 'Pesanan Tes',
  status: 'INQUIRY',
  message: 'Tes pembayaran'
}

const VARIANTS = [
  {
    id: 'A',
    label: 'A · nativeFlow: quick_reply + cta_url + cta_copy + cta_call',
    note: 'jalur utama bot (lib/richMessage.js) + cta_call yang belum pernah dipakai',
    build: () => wrap({
      body: { text: 'A · Tekan keempat tombol ini — semuanya jalur nativeFlow.' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          quickReply('⚡ Quick Reply', 'tesbtn:a-qr'),
          ctaUrl('🌐 Buka Situs'),
          ctaCopy('📋 Salin Kode', 'SKY-TEST-123'),
          ctaCall('📞 Telepon')
        ]
      }
    })
  },
  {
    id: 'B',
    label: 'B · single_select 2 section + cta_url di belakang',
    note: 'list native (single_select) — bedanya dengan listMessage ada di node biz',
    build: () => wrap({
      body: { text: 'B · Pilih satu baris, atau tombol web di belakang.' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          singleSelect('Pilih layanan', '📂 Buka', [
            {
              title: 'Layanan',
              rows: [
                { id: 'tesbtn:b1', title: '⚡ Cepat', description: 'Deskripsi cepat' },
                { id: 'tesbtn:b2', title: '🐢 Lambat', description: 'Deskripsi lambat' }
              ]
            },
            { title: 'Lainnya', rows: [{ id: 'tesbtn:b3', title: '❓ Bantuan', description: 'Hubungi admin' }] }
          ]),
          ctaUrl('🌐 Situs Resmi')
        ]
      }
    })
  },
  {
    id: 'C',
    label: 'C · cta_url + webview_presentation / webview_interaction',
    note: 'tombol yang membuka halaman di browser dalam aplikasi WhatsApp',
    build: () => wrap({
      body: { text: 'C · Tekan tombol web — harusnya terbuka di dalam WhatsApp.' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          ctaUrl('🌐 Webview Penuh', 'https://skyline.web.id', { webview_presentation: 'full', webview_interaction: true }),
          ctaUrl('🌐 Tanpa Webview', 'https://skyline.web.id')
        ]
      }
    })
  },
  {
    id: 'D',
    label: 'D · header gambar (upload asli) + tombol',
    note: 'thumbnail interaktif — jalur yang dipakai .menu v2',
    build: async (ctx) => {
      const sharp = (await import('sharp')).default
      return wrap({
        header: await buildImageHeader(ctx, sharp),
        body: { text: 'D · Thumbnail harusnya tampil di atas.' },
        footer: { text: 'skyline-JXRA · tesbutton' },
        nativeFlowMessage: { messageVersion: 1, buttons: [quickReply('⚡ Oke', 'tesbtn:d1')] }
      })
    }
  },
  {
    id: 'E',
    label: 'E · header video/gif (upload asli) + tombol',
    note: 'header media gerak — butuh file gif/webm/mp4; kalau nggak ada, FFmpeg bikinkan yang kecil otomatis',
    build: async (ctx) => {
      const file = pickMediaAsset(['.gif', '.webm', '.mp4'])
      if (file) {
        const bytes = fs.readFileSync(file)
        const up = await ctx.client.message.upload(bytes, { type: 'video', mimetype: 'video/mp4' })
        const meta = await (await import('sharp')).default(bytes.slice(0, 4096)).metadata().catch(() => ({}))
        return wrap({
          header: {
            title: '',
            hasMediaAttachment: true,
            videoMessage: { ...up, mimetype: 'video/mp4', width: meta.width ?? 640, height: meta.height ?? 360 }
          },
          body: { text: 'E · Header video/gif harusnya bisa diputar.' },
          footer: { text: 'skyline-JXRA · tesbutton' },
          nativeFlowMessage: { messageVersion: 1, buttons: [quickReply('⚡ Oke', 'tesbtn:e1')] }
        })
      }
      return wrap({
        body: { text: 'E · Header video/gif tetap tampil — belum ada aset media. Letakkan file gif/webm/mp4 di assets/voip/.' },
        footer: { text: 'skyline-JXRA · tesbutton' }
      })
    }
  },
  {
    id: 'F',
    label: 'F · header dokumen (upload asli) + tombol',
    note: 'header ikon file — tiap varian dokumen',
    build: async (ctx) => {
      const sharp = (await import('sharp')).default
      const raw = fs.readFileSync(path.join(process.cwd(), 'assets/thumb/menu.jpg'))
      const bytes = await sharp(raw).resize(512).png().toBuffer()
      return wrap({
        header: await buildDocumentHeader(ctx, sharp, bytes, 'tes-button.png', 'image/png'),
        body: { text: 'F · Header dokumen (ikon file) harusnya muncul.' },
        footer: { text: 'skyline-JXRA · tesbutton' },
        nativeFlowMessage: { messageVersion: 1, buttons: [quickReply('⚡ Oke', 'tesbtn:f1')] }
      })
    }
  },
  {
    id: 'G',
    label: 'G · header lokasi + tombol',
    note: 'header pin lokasi (tanpa upload — koordinat langsung)',
    build: () => wrap({
      header: {
        title: 'Lokasi Tes',
        hasMediaAttachment: true,
        locationMessage: {
          degreesLatitude: -6.2088,
          degreesLongitude: 106.8456,
          name: 'Monas, Jakarta',
          address: 'Jakarta, Indonesia'
        }
      },
      body: { text: 'G · Header lokasi harusnya bisa ditekan.' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: { messageVersion: 1, buttons: [quickReply('⚡ Oke', 'tesbtn:g1')] }
    })
  },
  {
    id: 'H',
    label: 'H · productMessage top-level (gambar + harga)',
    note: 'kartu produk — biasanya butuh katalog bisnis terdaftar di WA',
    build: async (ctx) => {
      const sharp = (await import('sharp')).default
      const raw = fs.readFileSync(path.join(process.cwd(), 'assets/thumb/menu.jpg'))
      const bytes = await sharp(raw).resize(512).jpeg({ quality: 85 }).toBuffer()
      const meta = await sharp(bytes).metadata()
      const thumb = await sharp(bytes).resize(32).jpeg({ quality: 50 }).toBuffer()
      const up = await ctx.client.message.upload(bytes, { type: 'image', mimetype: 'image/jpeg' })
      return {
        productMessage: {
          businessOwnerJid: '6281234567890@s.whatsapp.net',
          body: 'Kartu produk tes',
          footer: 'skyline-JXRA',
          product: {
            productImage: { ...up, mimetype: 'image/jpeg', width: meta.width, height: meta.height, fileLength: bytes.length, jpegThumbnail: thumb },
            productId: 'TESTPROD-1',
            title: 'Produk Tes',
            description: 'Deskripsi produk tes',
            currencyCode: 'IDR',
            priceAmount1000: 10000,
            retailerId: 'skyline-JXRA',
            url: 'https://skyline.web.id',
            productImageCount: 1
          }
        }
      }
    }
  },
  {
    id: 'I',
    label: 'I · carousel 3 kartu (jpegThumbnail + tombol per kartu)',
    note: 'geser horizontal — jalur menu v7 (carouselMessage HSCROLL_CARDS)',
    build: async (ctx) => {
      const sharp = (await import('sharp')).default
      const raw = fs.readFileSync(path.join(process.cwd(), 'assets/thumb/menu.jpg'))
      const thumb = await sharp(raw).resize(96).jpeg({ quality: 45 }).toBuffer()
      const cards = [1, 2, 3].map((n) => ({
        header: { title: `Kartu ${n}`, hasMediaAttachment: true, jpegThumbnail: thumb },
        body: { text: `Kartu ${n} · body tes.` },
        footer: { text: `footer ${n}` },
        nativeFlowMessage: { messageVersion: 1, buttons: [quickReply(`📂 Buka ${n}`, `tesbtn:i${n}`)] }
      }))
      return wrap({
        body: { text: 'I · Geser kanan-kiri. Tiap kartu punya tombol sendiri.' },
        footer: { text: 'skyline-JXRA · tesbutton' },
        carouselMessage: { messageVersion: 1, carouselCardType: 1, cards }
      })
    }
  },
  {
    id: 'J',
    label: 'J · buttonsMessage family lama (3 tombol)',
    note: 'family tombol pra-interactiveMessage — responsnya buttonsResponseMessage',
    build: () => ({
      buttonsMessage: {
        headerType: 2,
        contentText: 'J · Family tombol LAMA (buttonsMessage).',
        footerText: 'skyline-JXRA · tesbutton',
        buttons: [
          { buttonId: 'tesbtn:j1', buttonText: { displayText: 'Tombol 1' }, type: 1 },
          { buttonId: 'tesbtn:j2', buttonText: { displayText: 'Tombol 2' }, type: 1 },
          {
            buttonId: 'tesbtn:j3',
            buttonText: { displayText: 'Tombol Native Flow' },
            type: 2,
            nativeFlowInfo: { name: 'quick_reply', paramsJson: JSON.stringify({ display_text: 'Tombol Native Flow', id: 'tesbtn:j3' }) }
          }
        ]
      }
    })
  },
  {
    id: 'K',
    label: 'K · listMessage family lama (2 baris)',
    note: 'family list pra-interactiveMessage — responsnya listResponseMessage',
    build: () => ({
      listMessage: {
        title: 'K · Family list LAMA (listMessage)',
        description: 'Pilih satu baris di bawah.',
        buttonText: 'Buka',
        listType: 1,
        footerText: 'skyline-JXRA · tesbutton',
        sections: [{
          title: 'Opsi',
          rows: [
            { rowId: 'tesbtn:k1', title: 'Opsi A', description: 'Deskripsi A' },
            { rowId: 'tesbtn:k2', title: 'Opsi B', description: 'Deskripsi B' }
          ]
        }]
      }
    })
  },
  {
    id: 'L',
    label: 'L · templateMessage hydrated (quick reply / url / call)',
    note: 'HSM legacy — responsnya templateButtonReplyMessage (yang dibaca readRichReply)',
    build: () => wrapTemplate({
      hydratedTemplate: {
        hydratedTitleText: 'L · TEMPLATE BUTTON (legacy)',
        hydratedContentText: 'Empat bentuk tombol lama sekaligus.',
        hydratedFooterText: 'skyline-JXRA · tesbutton',
        templateId: `tesbtn-tpl-${Date.now()}`,
        hydratedButtons: [
          { quickReplyButton: { id: 'tesbtn:l1', displayText: 'Quick Reply' } },
          { quickReplyButton: { id: 'tesbtn:l2', displayText: 'Quick Reply 2' } },
          { urlButton: { url: 'https://skyline.web.id', displayText: 'Buka URL' } },
          { callButton: { phoneNumber: '6281234567890', displayText: 'Telepon' } }
        ]
      }
    })
  },
  {
    id: 'M',
    label: 'M · payment_info + review_and_pay (nativeFlow pembayaran)',
    note: 'tombol pembayaran — zapo pasang node biz native_flow name=payment_info',
    build: () => wrap({
      body: { text: 'M · Tombol pembayaran (butuh metode bayar terdaftar di WA).' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          nf('review_and_pay', ORDER_PARAMS),
          nf('payment_info', {
            payment_config_id: 'TESTCFG',
            payment_type: 'CREDIT_CARD',
            payment_currency: 'IDR',
            payment_amount1000: 10000
          })
        ]
      }
    })
  },
  {
    id: 'N',
    label: 'N · order_details (nativeFlow pesanan)',
    note: 'detail pesanan katalog — zapo pasang node biz name=order_details',
    build: () => wrap({
      body: { text: 'N · Detail pesanan katalog.' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: { messageVersion: 1, buttons: [nf('order_details', ORDER_PARAMS)] }
    })
  },
  {
    id: 'O',
    label: 'O · katalog bisnis: collection / storefront / bloks widget',
    note: 'tiga keluarga katalog — kemungkinan besar butuh akun bisnis',
    build: () => wrap({
      body: { text: 'O · Bloks widget di header + tombol (butuh blok terdaftar).' },
      header: {
        title: 'Widget',
        bloksWidget: { uuid: 'tesbtn-bloks', data: '{"hello":"world"}', type: 'tes', fallback: 'Fallback teks' }
      },
      footer: { text: 'skyline-JXRA · tesbutton' },
      nativeFlowMessage: { messageVersion: 1, buttons: [quickReply('⚡ Oke', 'tesbtn:o1')] }
    })
  },
  {
    id: 'P',
    label: 'P · tombol telepon family lama (hydrated callButton)',
    note: 'padanan varian L · callButton; dipisah biar jelas mana yang jalan',
    build: () => wrapTemplate({
      hydratedTemplate: {
        hydratedTitleText: 'P · TOMBOL TELEPON (legacy)',
        hydratedContentText: 'Tekan tombol telepon.',
        hydratedFooterText: 'skyline-JXRA · tesbutton',
        templateId: `tesbtn-tplp-${Date.now()}`,
        hydratedButtons: [
          { callButton: { phoneNumber: '6281234567890', displayText: '📞 Telepon Kami' } },
          { urlButton: { url: 'https://skyline.web.id', displayText: '🌐 Website' } }
        ]
      }
    })
  },
  {
    id: 'R',
    label: 'R · collectionMessage (katalog koleksi bisnis)',
    note: 'katalog koleksi katalog katalog — BUTUH biz + katalog terdaftar; tombol katalog',
    build: () => wrap({
      body: { text: 'R · Koleksi katalog. Tekan tombol katalog untuk membuka.' },
      footer: { text: 'skyline-JXRA · tesbutton' },
      collectionMessage: {
        bizJid: '6281234567890@s.whatsapp.net',
        id: 'TEST-COLL-R',
        messageVersion: 1
      }
    })
  },
  {
    id: 'S',
    label: 'S · templateMessage modern (templateId + fourRowTemplate)',
    note: 'kartu template TV2 — templateId + fourRowTemplate dengan tombol button-style',
    build: () => ({
      viewOnceMessage: {
        message: {
          messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
          templateMessage: {
            templateId: `tesbtn-tpls-${Date.now()}`,
            hydratedTemplate: {
              hydratedTitleText: 'S · TEMPLATE MODERN',
              hydratedContentText: 'Tekan tombol di bawah — satu kartu, 4 aksi.',
              hydratedFooterText: 'skyline-JXRA · tesbutton',
              hydratedButtons: [
                { quickReplyButton: { id: 'tesbtn:s1', displayText: 'Kirim 1' } },
                { quickReplyButton: { id: 'tesbtn:s2', displayText: 'Kirim 2' } },
                { urlButton: { url: 'https://skyline.web.id', displayText: 'Lewati' } },
                { callButton: { phoneNumber: '6281234567890', displayText: 'Telepon' } }
              ]
            }
          }
        }
      }
    })
  }
]

const BY_ID = Object.fromEntries(VARIANTS.map((v) => [v.id.toUpperCase(), v]))

const SHORTCUTS = {
  qr: 'A', quickreply: 'A', quick: 'A', native: 'A', nativeflow: 'A',
  url: 'C', webview: 'C',
  single: 'B', single_select: 'B', select: 'B',
  list: 'K', listmessage: 'K',
  tpl: 'L', template: 'L', hydrated: 'L', hsm: 'L',
  product: 'H', catalog: 'H',
  carousel: 'I',
  buttons: 'J', buttonsmessage: 'J',
  pay: 'M', payment: 'M', review: 'M',
  order: 'N', orderdetails: 'N',
  widget: 'O', bloks: 'O', storefront: 'O',
  call: 'P', phone: 'P',
  img: 'D', image: 'D', doc: 'F', document: 'F', location: 'G', video: 'E',
  collection: 'R', tpl2: 'S'
}

/** ID tombol per varian — registry zapo butuh id persis, bukan pola. */
const BUTTON_IDS = {
  A: ['tesbtn:a-qr'],
  B: ['tesbtn:b1', 'tesbtn:b2', 'tesbtn:b3'],
  C: [],
  D: ['tesbtn:d1'],
  E: ['tesbtn:e1'],
  F: ['tesbtn:f1'],
  G: ['tesbtn:g1'],
  H: [],
  I: ['tesbtn:i1', 'tesbtn:i2', 'tesbtn:i3'],
  J: ['tesbtn:j1', 'tesbtn:j2', 'tesbtn:j3'],
  K: ['tesbtn:k1', 'tesbtn:k2'],
  L: ['tesbtn:l1', 'tesbtn:l2'],
  M: [],
  N: [],
  O: ['tesbtn:o1'],
  P: [],
  R: [],
  S: ['tesbtn:s1', 'tesbtn:s2']
}

/* ══════════════ handler tombol ══════════════ */

async function ack(ctx, vid, id) {
  const v = BY_ID[vid]
  try {
    await ctx.reply(`✅ *${vid} → ${id}* terdeteksi.\nVarian: ${v?.label ?? vid}`)
  } catch (err) {
    logger.warn({ err: String(err?.message ?? err), id }, '[TesButton] balasan tombol gagal')
  }
}

for (const [vid, ids] of Object.entries(BUTTON_IDS)) {
  for (const id of ids) {
    onRichReply(id, (ctx) => ack(ctx, vid, id))
  }
}

/* ══════════════ handler ══════════════ */

async function handler(ctx) {
  const raw = (ctx.args?.[0] ?? '').trim().toLowerCase()
  let pick = ''

  if (raw && raw !== 'all') {
    if (BY_ID[raw.toUpperCase()]) pick = raw.toUpperCase()
    else if (SHORTCUTS[raw]) pick = SHORTCUTS[raw]
    else {
      return ctx.reply(
        `Varian *${raw}* gak dikenal.\n\n` +
        `Pakai: ${VARIANTS.map((v) => `\`${v.id}\``).join(' ')}\n` +
        `Atau nama pendek: \`qr\` \`url\` \`single\` \`list\` \`tpl\` \`product\` \`carousel\` ` +
        `\`buttons\` \`pay\` \`order\` \`widget\` \`call\` \`img\` \`doc\` \`video\` \`location\` ` +
        `\`collection\` (\`r\`) \`tpl2\` (\`s\`)\n\n` +
        `Tanpa argumen = kirim semua.`
      )
    }
  }

  const targets = pick ? [BY_ID[pick]] : VARIANTS
  const rows = []
  let sent = 0

  await ctx.react('🧪')

  for (let i = 0; i < targets.length; i++) {
    const v = targets[i]
    const tag = `[${i + 1}/${targets.length}] ${v.id}`

    if (targets.length > 1) await ctx.reply(`▶ ${tag} ${v.label}`)

    let payload
    try {
      payload = await v.build(ctx)
    } catch (err) {
      rows.push(`[⏭️] ${tag} — dilewati: ${err?.message || String(err)}`)
      continue
    }

    const chk = verifyPayload(payload)
    if (!chk.ok) {
      rows.push(`[⚠️] ${tag} — payload rusak sebelum kirim: ${chk.missing.slice(0, 3).join(', ')}`)
      continue
    }
    if (chk.missing.length) {
      rows.push(`[⚠️] ${tag} — field hilang saat encode: ${chk.missing.slice(0, 3).join(', ')}`)
      continue
    }

    try {
      const res = await ctx.client.message.send(ctx.chat, payload, { noStyle: true })
      sent += 1
      rows.push(
        res?.ack?.error
          ? `[⚠️] ${tag} — ack error *${res.ack.error}* • ${chk.bytes}B • id \`${res.id ?? '?'}\``
          : `[✅] ${tag} — ack OK • ${chk.bytes}B • id \`${res.id ?? '?'}\``
      )
    } catch (err) {
      rows.push(`[❌] ${tag} — ${err?.message || String(err)}`)
    }

    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 700))
  }

  const lines = [
    '🧪 *HASIL TES TOMBOL*',
    '',
    ...rows,
    '',
    `Terkirim *${sent}/${targets.length}* (ack server).`,
    '',
    '⚠️ *Ack OK ≠ tombol tampil.* Baca dari chat:',
    '• Tombol muncul & bisa ditekan → jalur ini jalan',
    '• Pesan muncul tapi tombol kosong/rusak → renderer nolak bentuk itu',
    '• Pesan hilang total → WA buang family itu di akun ini',
    '• Error `479` → server nolak kombinasi node di chat ini',
    '• Kalau tombol ditekan dan ini balas `✅ <id>` → responsnya sampai ke `onRichReply`'
  ]

  await ctx.reply(lines.join('\n'))
}

/* Buat tes programatik (lihat catatan verifikasi) — bukan bagian API publik. */
const _internals = {
  VARIANTS, BY_ID, SHORTCUTS, BUTTON_IDS,
  nf, quickReply, ctaUrl, ctaCopy, ctaCall, singleSelect,
  wrap, wrapTemplate, verifyPayload, missingPaths,
  buildImageHeader, buildDocumentHeader
}

export { pluginConfig as config, handler, _internals }
