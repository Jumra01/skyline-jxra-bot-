/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tesheader.js — Lab tes tampilan HEADER & WRAPPER teks balasan bot (`.tesheader`)
 * — khusus owner.
 *
 * ─────────────────────── Konsep ───────────────────────
 * Header di sini adalah "envelope" pembungkus teks pesan balasan bot
 * (seperti fitur `.setreply` dan modifikasi bot WhatsApp populer),
 * agar teks di bawahnya terlihat profesional, estetik, dan enak dibaca:
 *   1. card-large    : Kartu banner gambar besar (externalAdReply) di atas teks
 *   2. card-compact  : Thumbnail mini di samping judul/body (tampilan ringkas)
 *   3. kombo-saluran : Header "Diteruskan dari Saluran" + banner gambar kartu
 *   4. kombo-order   : Fake quote status order/transaksi + banner kartu
 *   5. kombo-vcard   : Fake quote kontak resmi (vCard verified) + banner kartu
 *   6. doc-banner    : Dokumen PDF (cover thumbnail tajam + nama file) + teks caption
 *   7. media-btn     : Foto CDN WhatsApp di atas teks + tombol aksi interaktif
 *   8. location-hdr  : Header peta/lokasi satelit interaktif di atas teks
 *   9. ig            : Mockup profil Instagram Dark Mode (kartu HTML native)
 *
 * Kamu juga bisa tes langsung varian bawaan bot:
 *   .tesheader v1 s/d .tesheader v7
 *
 * ─────────────────────── Pemakaian ───────────────────────
 *   .tesheader                   → kirim 4 varian yang terbukti work + ringkasan
 *   .tesheader kombo-saluran     → varian kombo banner saluran
 *   .tesheader media-btn         → varian media header + tombol
 *   .tesheader location-hdr      → varian header lokasi
 *   .tesheader ig                → varian kartu Instagram
 *   .tesheader v1,v4              → tetap bisa menguji varian eksperimen (pisahkan koma)
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { getThumbBuffer, getAdReply } from '../../core/cta.js'
import { sendNativeHtml } from '../../lib/emeraldCard.js'
import { richButtons, interactiveSendOptions } from '../../lib/richMessage.js'
import { REPLY_VARIANTS, sendReplyVariant } from '../../core/replyStyle.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const THUMB_DIR = path.join(ROOT, 'assets', 'thumb')

const pluginConfig = {
  name: 'tesheader',
  alias: ['teshd', 'headertes'],
  category: 'tools',
  description: 'Lab tes tampilan header/wrapper teks balasan bot (ala .setreply & kombo)',
  usage: '.tesheader [varian]',
  example: '.tesheader card-large',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 8,
  limit: 0,
  isEnabled: true,
  energi: 0,
}

/* ─────────────────────── utilitas pendukung ─────────────────────── */

function randId() {
  return crypto.randomBytes(10).toString('hex').toUpperCase()
}

/** Teks contoh balasan bot yang dibungkus oleh header. */
function getSampleText(vName) {
  const bot = config.botName || 'skyline-JXRA'
  const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  return [
    `✨ *${bot.toUpperCase()} SYSTEM RESPONSE* ✨`,
    `_Tampilan wrapper header varian [ ${vName} ]_`,
    '',
    'Halo kak! Perintah kamu berhasil diproses dengan lancar.',
    '',
    `• Status  : Online & Stabil ✓`,
    `• Waktu   : ${time} WIB`,
    `• Fitur   : 126 Perintah Aktif`,
    `• Latency : 14ms (Super Fast)`,
    `• Emerald : 100 🟩`,
    '',
    'Teks balasan ini dibungkus rapi oleh header di atasnya. Lebih enak dilihat kan!'
  ].join('\n')
}

/** Ambil thumbnail 300x300 JPEG yang sudah di-flatten (aman transparan). */
async function loadThumbJpg(size = 360, quality = 75) {
  try {
    const raw = await getThumbBuffer()
    if (!raw) return null
    const sharp = (await import('sharp')).default
    return await sharp(raw)
      .flatten({ background: '#ffffff' })
      .resize(size, size, { fit: 'cover' })
      .jpeg({ quality })
      .toBuffer()
  } catch {
    return null
  }
}

/** Buat objek externalAdReply dengan opsi kustom. */
async function makeAdReply({ large = true, title = '', body = '', url = '' } = {}) {
  const buf = await loadThumbJpg(large ? 420 : 200, 75)
  const ad = {
    title: (title || config.botName || 'Bot').trim(),
    body: (body || config.cta?.card?.body || 'Official Verified Bot').trim(),
    mediaType: 1, // 1 = IMAGE
    renderLargerThumbnail: large,
    sourceUrl: url || config.cta?.card?.sourceUrl || 'https://skyline.web.id'
  }
  if (buf instanceof Uint8Array && buf.length) ad.thumbnail = buf
  return ad
}

/** Cari newsletter JID saluran resmi bot. */
function getNewsletterJid() {
  const url = config.reactChannel?.dedicatedChannelUrl || ''
  const m = url.match(/channel\/([0-9A-Za-z]+)/)
  return m ? `${m[1]}@newsletter` : '120363300000000000@newsletter'
}

/** Vcard kontak resmi bot. */
function getContactVCard() {
  const bot = config.botName || 'skyline-JXRA'
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:Bot;${bot};;;`,
    `FN:${bot} Official`,
    'ORG:Skyline Network;',
    'item1.TEL;waid=13135550002:+1 (313) 555-0002',
    'item1.X-ABLabel:Official Verified Account',
    'END:VCARD'
  ].join('\n')
}

/* ─────────────────────── varian profil IG ─────────────────────── */

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

async function thumbDataUri(size = 80) {
  try {
    const raw = await getThumbBuffer()
    if (!raw) return ''
    const sharp = (await import('sharp')).default
    const buf = await sharp(raw).rotate().resize(size, size, { fit: 'cover' }).jpeg({ quality: 50 }).toBuffer()
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

async function buildInstagramHtml() {
  const avatar = await thumbDataUri(72)
  const postImg = await thumbDataUri(140)
  const name = config.botName || 'skyline-JXRA'
  const handle = name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'skyline_bot'
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Instagram</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  html, body { background:#000; color:#f5f5f5; font-family:-apple-system,sans-serif; }
  body { min-height:100vh; display:flex; justify-content:center; padding:12px 8px; }
  .ig { width:100%; max-width:400px; background:#000; border-radius:18px; border:1px solid #262626; overflow:hidden; }
  .top { display:flex; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #1a1a1a; font-weight:700; }
  .head { display:flex; align-items:center; gap:18px; padding:14px 16px; }
  .ring { width:74px; height:74px; border-radius:50%; padding:2.5px; background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888); }
  .avatar { width:100%; height:100%; border-radius:50%; object-fit:cover; border:2px solid #000; display:block; }
  .stats { display:flex; flex:1; justify-content:space-around; text-align:center; }
  .num { font-weight:700; font-size:16px; }
  .lbl { font-size:11px; color:#a8a8a8; }
  .bio { padding:0 16px 12px; font-size:13px; line-height:1.4; }
  .actions { display:flex; gap:6px; padding:0 16px 12px; }
  .btn { flex:1; text-align:center; padding:7px 0; font-size:13px; font-weight:600; border-radius:8px; background:#262626; }
  .primary { background:#0095f6; }
  .grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:2px; }
  .tile { height:110px; background:#121212; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
  .tile img { width:100%; height:100%; object-fit:cover; }
</style>
</head>
<body>
  <div class="ig">
    <div class="top"><span>${escHtml(handle)} ●</span><span>•••</span></div>
    <div class="head">
      <div class="ring">${avatar ? `<img class="avatar" src="${avatar}">` : ''}</div>
      <div class="stats">
        <div><div class="num">126</div><div class="lbl">Posts</div></div>
        <div><div class="num">2.4K</div><div class="lbl">Users</div></div>
        <div><div class="num">1</div><div class="lbl">Owner</div></div>
      </div>
    </div>
    <div class="bio">
      <b>${escHtml(name)}</b><br>
      Bot WhatsApp • zapo-js • Multi-Device<br>
      🤖 24/7 Online • Fast Response<br>
      <span style="color:#0095f6">🔗 skyline.web.id</span>
    </div>
    <div class="actions">
      <div class="btn primary">Ikuti</div>
      <div class="btn">Kirim Pesan</div>
      <div class="btn">Menu (.menu)</div>
    </div>
    <div class="grid">
      <div class="tile">${postImg ? `<img src="${postImg}">` : ''}</div>
      <div class="tile" style="background:linear-gradient(135deg,#1f2937,#111827);color:#60a5fa"><b>skyline</b><br><small>v2.0</small></div>
      <div class="tile" style="background:radial-gradient(#064e3b,#022c22);color:#34d399"><b>🟩 100%</b><br><small>EMERALD</small></div>
      <div class="tile" style="background:linear-gradient(135deg,#311042,#1a0924);color:#d8b4fe"><b>AI</b><br><small>Gemma</small></div>
      <div class="tile" style="background:linear-gradient(135deg,#1e1b4b,#0f172a);color:#38bdf8"><b>14ms</b><br><small>Ping</small></div>
      <div class="tile" style="background:radial-gradient(#1e3a5f,#0b1526);color:#7dd3fc"><b>${now}</b><br><small>WIB</small></div>
    </div>
  </div>
</body>
</html>`
}

/* ─────────────────────── REGISTRY VARIAN ─────────────────────── */

const VARIANTS = [
  {
    id: 'card-large',
    label: 'Banner Gambar Besar (AdReply)',
    note: 'header kartu gambar lebar di atas teks balasan (gaya paling populer)',
    build: async (ctx) => {
      const ad = await makeAdReply({ large: true })
      await ctx.client.message.send(
        ctx.chat,
        { type: 'text', text: getSampleText('card-large') },
        { quote: ctx.event, contextInfo: { raw: { externalAdReply: ad } } }
      )
    }
  },
  {
    id: 'card-compact',
    label: 'Thumbnail Mini Samping',
    note: 'thumbnail kecil di sebelah kiri judul & deskripsi — clean & ramping',
    build: async (ctx) => {
      const ad = await makeAdReply({ large: false })
      await ctx.client.message.send(
        ctx.chat,
        { type: 'text', text: getSampleText('card-compact') },
        { quote: ctx.event, contextInfo: { raw: { externalAdReply: ad } } }
      )
    }
  },
  {
    id: 'kombo-saluran',
    label: 'Saluran Resmi + Banner Gambar',
    note: 'kombo: "Diteruskan dari Saluran" di pucuk bubble + banner kartu di atas teks',
    build: async (ctx) => {
      const ad = await makeAdReply({ large: true })
      const newsletterJid = getNewsletterJid()
      const raw = {
        isForwarded: true,
        forwardingScore: 9,
        forwardedNewsletterMessageInfo: {
          newsletterJid,
          newsletterName: `${config.botName} Official Channel`,
          serverMessageId: Math.floor(Math.random() * 1_000_000)
        },
        externalAdReply: ad
      }
      await ctx.client.message.send(
        ctx.chat,
        { type: 'text', text: getSampleText('kombo-saluran') },
        { quote: ctx.event, contextInfo: { raw } }
      )
    }
  },
  {
    id: 'kombo-order',
    label: 'Order Belanjaan + Banner Kartu',
    note: 'fake quote pesanan/transaksi belanjaan di atas + banner kartu',
    build: async (ctx) => {
      const ad = await makeAdReply({ large: true })
      const jpeg = await loadThumbJpg(300, 70)
      const fakeOrderQuote = {
        id: randId(),
        remoteJid: ctx.chat,
        participant: '0@s.whatsapp.net',
        message: {
          orderMessage: {
            orderId: 'SKYL-' + randId().slice(0, 8),
            itemCount: 99,
            status: 1,
            surface: 1,
            message: `${config.botName} System Notification`,
            orderTitle: 'Pesanan Resmi Dikonfirmasi',
            sellerJid: '0@s.whatsapp.net',
            token: 'ARU1+',
            totalAmount1000: '1000000',
            totalCurrencyCode: 'IDR',
            ...(jpeg ? { thumbnail: jpeg } : {})
          }
        }
      }
      await ctx.client.message.send(
        ctx.chat,
        { type: 'text', text: getSampleText('kombo-order') },
        { quote: fakeOrderQuote, contextInfo: { raw: { externalAdReply: ad } } }
      )
    }
  },
  {
    id: 'kombo-vcard',
    label: 'Kontak Terverifikasi + Banner Kartu',
    note: 'fake quote kontak WhatsApp resmi/verified di atas + banner kartu',
    build: async (ctx) => {
      const ad = await makeAdReply({ large: true })
      const fakeVcardQuote = {
        id: randId(),
        remoteJid: 'status@broadcast',
        participant: '0@s.whatsapp.net',
        message: {
          contactMessage: {
            displayName: `🪸 ${config.botName} Verified`,
            vcard: getContactVCard()
          }
        }
      }
      await ctx.client.message.send(
        ctx.chat,
        { type: 'text', text: getSampleText('kombo-vcard') },
        { quote: fakeVcardQuote, contextInfo: { raw: { externalAdReply: ad } } }
      )
    }
  },
  {
    id: 'doc-banner',
    label: 'Dokumen PDF + Caption Teks',
    note: 'format dokumen dengan cover tajam, nama file resmi, teks sebagai caption',
    build: async (ctx) => {
      const jpeg = await loadThumbJpg(360, 75)
      const fakePdfBuffer = Buffer.from('%PDF-1.4\n%skyline-system\n%%EOF')
      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'document',
          media: fakePdfBuffer,
          mimetype: 'application/pdf',
          fileName: `🛰️ ${config.botName} • System_Response.pdf`,
          caption: getSampleText('doc-banner'),
          ...(jpeg ? { jpegThumbnail: jpeg } : {})
        },
        { quote: ctx.event }
      )
    }
  },
  {
    id: 'combo-user',
    label: 'Profil Pemanggil + Status Bot + Saluran',
    note: 'foto profil user di header, status bot bergaya v4, forward score, tombol Lihat Saluran',
    build: async (ctx) => {
      const profileJid = ctx.sender || ctx.senderLid || ctx.chat
      let raw = null
      try {
        raw = await Promise.race([
          Promise.resolve(ctx.client.profile?.getProfilePicture?.(profileJid, 'image')),
          new Promise((resolve) => setTimeout(() => resolve(null), 4000))
        ])
        if (typeof raw === 'string') {
          const res = await fetch(raw, { signal: AbortSignal.timeout(4000) })
          if (res.ok) raw = Buffer.from(await res.arrayBuffer())
          else raw = null
        }
      } catch { raw = null }
      if (!raw) raw = await getThumbBuffer()
      if (!raw) throw new Error('foto profil user dan thumb bot sama-sama tidak tersedia')

      const sharp = (await import('sharp')).default
      const avatar = await sharp(raw).rotate().flatten({ background: '#ffffff' })
        .resize(720, 720, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer()
      const media = await ctx.client.message.upload(avatar, { type: 'image', mimetype: 'image/jpeg' })
      const channelUrl = config.reactChannel?.dedicatedChannelUrl || 'https://skyline.web.id'
      const pushName = ctx.pushName || 'Pengguna WhatsApp'
      const status = `✅ ${config.botName} aktif • zapo-js • online 24/7\n📡 Status: stabil • 🟩 Emerald aktif\n↗️ Diteruskan • skor 999`
      const headerImage = {
        kind: 'imageMessage',
        url: media.url,
        directPath: media.directPath,
        mediaKey: media.mediaKey,
        fileSha256: media.fileSha256,
        fileEncSha256: media.fileEncSha256,
        fileLength: media.fileLength,
        mediaKeyTimestamp: media.mediaKeyTimestamp,
        mimetype: 'image/jpeg', width: 720, height: 720
      }
      await ctx.client.message.send(ctx.chat, richButtons({
        text: `🔵 *${pushName}*\n\n${status}\n\n${getSampleText('combo-user')}`,
        footer: `Dibuat untuk ${pushName} • ${config.botName}`,
        buttons: [{ url: channelUrl, text: '📣 Lihat Saluran' }, { id: 'combo-user:ok', text: '✅ Oke' }],
        headerImage
      }), interactiveSendOptions(ctx.chat))
    }
  },
  {
    id: 'media-btn',
    label: 'Header Media CDN + Teks + Tombol',
    note: 'interactive buttons: foto resolusi tinggi di header + teks + tombol aksi',
    build: async (ctx) => {
      const thumbBuf = await loadThumbJpg(720, 80)
      if (!thumbBuf) throw new Error('Aset thumbnail tidak dapat dimuat')
      const media = await ctx.client.message.upload(thumbBuf, { type: 'image', mimetype: 'image/jpeg' })
      const headerImage = {
        kind: 'imageMessage',
        url: media.url,
        directPath: media.directPath,
        mediaKey: media.mediaKey,
        fileSha256: media.fileSha256,
        fileEncSha256: media.fileEncSha256,
        fileLength: media.fileLength,
        mediaKeyTimestamp: media.mediaKeyTimestamp,
        mimetype: 'image/jpeg',
        width: 720,
        height: 720
      }
      await ctx.replyButtons({
        text: getSampleText('media-btn'),
        footer: `${config.botName} • Modern Interactive Header`,
        buttons: [
          { id: '.menu', text: '📋 Buka Menu' },
          { id: '.ping', text: '⚡ Cek Latency' }
        ],
        headerImage
      })
    }
  },
  {
    id: 'location-hdr',
    label: 'Header Lokasi Interaktif',
    note: 'interactive header lokasi satelit/peta di atas teks balasan',
    build: async (ctx) => {
      const jpeg = await loadThumbJpg(300, 70)
      await ctx.client.message.send(
        ctx.chat,
        {
          interactiveMessage: {
            header: {
              hasMediaAttachment: true,
              locationMessage: {
                degreesLatitude: -6.2088,
                degreesLongitude: 106.8456,
                name: `🛰️ ${config.botName} Main Station`,
                address: 'Skyline Cloud Datacenter, Jakarta',
                ...(jpeg ? { jpegThumbnail: jpeg } : {})
              }
            },
            body: { text: getSampleText('location-hdr') },
            nativeFlowMessage: { buttons: [] }
          }
        },
        { quote: ctx.event }
      )
    }
  },
  {
    id: 'ig',
    label: 'Profil Instagram (Kartu HTML)',
    note: 'mockup profil Instagram dark mode via kartu HTML native',
    build: async (ctx) => {
      const html = await buildInstagramHtml()
      await sendNativeHtml(ctx.client, ctx.chat, html)
    }
  }
]

// Tambahkan alias v1 - v7 agar user bisa langsung tes gaya setreply bawaan
for (const [num, v] of Object.entries(REPLY_VARIANTS)) {
  VARIANTS.push({
    id: `v${num}`,
    label: `Setreply ${v.key.toUpperCase()} (${v.name})`,
    note: `varian resmi .setreply v${num}: ${v.desc}`,
    build: async (ctx) => {
      await sendReplyVariant(ctx, getSampleText(`setreply v${num}`), Number(num))
    }
  })
}

const BY_ID = new Map(VARIANTS.map((v) => [v.id, v]))

/* ─────────────────────── handler utama ─────────────────────── */

async function handler(ctx) {
  const arg = (ctx.args[0] || '').toLowerCase()

  // Default hanya varian yang sudah terbukti tampil di device owner.
  const WORKING_DEFAULTS = new Set(['kombo-saluran', 'media-btn', 'location-hdr', 'ig'])
  let picked = VARIANTS.filter((v) => WORKING_DEFAULTS.has(v.id))
  if (arg === 'all' || arg === 'semua') {
    picked = VARIANTS // semua termasuk v1-v7
  } else if (arg) {
    const ids = arg.split(',').map((s) => s.trim()).filter(Boolean)
    const unknown = ids.filter((id) => !BY_ID.has(id))
    if (unknown.length) {
      return ctx.reply(
        `❌ Varian header gak dikenal: ${unknown.join(', ')}\n\n` +
        `*Varian Header Wrapper Unggulan:*\n` +
        VARIANTS.filter((v) => !v.id.startsWith('v')).map((v) => `• \`${v.id}\` — ${v.label}`).join('\n') +
        `\n\n*Varian Bawaan .setreply:*\n` +
        `• \`v1\` s/d \`v7\` (contoh: \`.tesheader v4\` atau \`.tesheader v1,v5\`)\n` +
        `• \`.tesheader all\` untuk kirim seluruhnya.`
      )
    }
    picked = ids.map((id) => BY_ID.get(id))
  }

  await ctx.react('🪧')
  const results = []
  const started = Date.now()

  for (const v of picked) {
    await ctx.client.message.send(
      ctx.chat,
      { type: 'text', text: `─── ▶ Header \`${v.id}\`: *${v.label}* ───` },
      { noStyle: true }
    )
    const t0 = Date.now()
    try {
      await v.build(ctx)
      results.push({ id: v.id, ok: true, ms: Date.now() - t0 })
    } catch (err) {
      results.push({ id: v.id, ok: false, ms: Date.now() - t0, err: err?.message || String(err) })
    }
  }

  const okN = results.filter((r) => r.ok).length
  const lines = results.map((r) =>
    r.ok
      ? `✅ ${r.id} (${(r.ms / 1000).toFixed(1)}s)`
      : `❌ ${r.id} — ${r.err}`
  )

  await ctx.client.message.send(
    ctx.chat,
    {
      type: 'text',
      text: [
        `🪧 *Ringkasan Tes Header Wrapper*`,
        `Berhasil terkirim: ${okN}/${results.length} varian • total ${((Date.now() - started) / 1000).toFixed(1)}s`,
        '',
        lines.join('\n'),
        '',
        '💡 _Pilih mana yang paling rapi & bagus di HP kamu._',
        'Kalau ada yang kamu suka, tinggal bilang biar bisa kita jadikan gaya reply utama!'
      ].join('\n')
    },
    { noStyle: true }
  )
}

export { pluginConfig as config, handler }
