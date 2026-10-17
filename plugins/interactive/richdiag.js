/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * richdiag.js — Diagnostik owner: kirim 6 varian payload interactive sekaligus
 * biar ketahuan elemen mana (bungkus viewOnce / kartu adReply / header media /
 * node biz_bot) yang bikin pesan gak muncul di WA biasa.
 *
 * Pakai: .rdiag     → mode 1: varian A–F (elemen payload)
 *        .rdiag 2   → mode 2: varian G–J (isolasi field kartu adReply)
 *        .rdiag 3   → mode 3: varian K–N (adReply di pesan teks vs interactive)
 * (owner only, sementara — hapus setelah selesai diagnosa)
 */
import path from 'node:path'
import fs from 'node:fs'
import { getAdReply } from '../../core/cta.js'

const CARD_LABELS = [
  'A · telanjang (kontrol spotify)',
  'B · telanjang + kartu adReply',
  'C · viewOnce wrapper',
  'D · wrapper + kartu (tanpa biz_bot)',
  'E · wrapper + kartu + biz_bot (=.button)',
  'F · wrapper + kartu + header (.menu)'
]

function mkButtons(label) {
  return [
    {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: `Tes ${label.slice(0, 1)}`, id: `rdiag:${label.slice(0, 1)}` })
    }
  ]
}

function interactive(label, adReply, headerMedia) {
  return {
    ...(headerMedia ? { header: headerMedia } : {}),
    body: { text: `🧪 *RICHDIAG ${label}` },
    footer: { text: 'richdiag • skyline-JXRA' },
    nativeFlowMessage: { buttons: mkButtons(label), messageVersion: 1 },
    ...(adReply ? { contextInfo: { externalAdReply: adReply } } : {})
  }
}

function wrapped(im) {
  return {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
        interactiveMessage: im
      }
    }
  }
}

const BOT_NODE = { customNodes: [{ tag: 'bot', attrs: { biz_bot: '1' }, content: [] }] }

async function uploadHeader(client) {
  try {
    const sharp = (await import('sharp')).default
    const p = path.join(process.cwd(), 'assets/thumb/menu.jpg')
    if (!fs.existsSync(p)) return undefined
    const buf = await sharp(p)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    const out = await sharp(buf).metadata()
    const media = await client.message.upload(buf, { type: 'image', mimetype: 'image/jpeg' })
    return {
      title: '',
      subtitle: '',
      hasMediaAttachment: true,
      imageMessage: { ...media, mimetype: 'image/jpeg', width: out.width ?? 1024, height: out.height ?? 1024 }
    }
  } catch {
    return undefined
  }
}

const pluginConfig = {
  name: 'rdiag',
  alias: ['richdiag'],
  category: 'interactive',
  description: 'Diagnostik payload interactive (owner) — cari penyebab gak muncul di WA biasa',
  usage: '.rdiag [2|3]',
  example: '.rdiag',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 10,
  limit: 1,
  isEnabled: true
}

async function handler(ctx) {
  const mode = String(ctx.args?.[0] ?? '1')
  const send = (content, opts) => ctx.client.message.send(ctx.chat, content, opts ?? {})

  if (mode === '2') return mode2(ctx, send)
  if (mode === '3') return mode3(ctx, send)

  const ad = await getAdReply().catch(() => null)
  const header = await uploadHeader(ctx.client)

  const [A, B, C, D, E, F] = CARD_LABELS

  await send({ interactiveMessage: interactive(A, null, null) })
  await send({ interactiveMessage: interactive(B, ad, null) })
  await send(wrapped(interactive(C, null, null)))
  await send(wrapped(interactive(D, ad, null)))
  await send(wrapped(interactive(E, ad, null)), BOT_NODE)
  await send(wrapped(interactive(F, ad, header)), BOT_NODE)

  await ctx.reply(
    '🧪 *RICHDIAG terkirim* — 6 varian (A–F).\n' +
      'Buka di **WA biasa**, lalu bilang nomor/varian mana saja yang MUNCUL (dan mana yang hilang).\n\n' +
      CARD_LABELS.map((l) => `  ${l}`).join('\n')
  )
}

/* Mode 2 — isolasi field kartu: semua payload = telanjang + kartu (kayak B),
 * bedanya cuma isi objek externalAdReply. */
async function mode2(ctx, send) {
  const ad = (await getAdReply().catch(() => null)) || {}
  const { thumbnail: _thumb, ...noThumb } = ad
  const { sourceUrl: _src, ...noSrc } = ad
  const minimal = { title: ad.title, body: ad.body }

  const variants = [
    ['G · kartu lengkap (kontrol B)', ad],
    ['H · kartu TANPA thumbnail bytes', noThumb],
    ['I · kartu TANPA sourceUrl', noSrc],
    ['J · kartu minimal (title+body doang)', minimal]
  ]

  for (const [label, card] of variants) {
    await send({ interactiveMessage: interactive(label, Object.keys(card).length ? card : null, null) })
  }

  await ctx.reply(
    '🧪 *RICHDIAG mode 2* — varian G–J (isolasi field kartu).\n' +
      'Lapor mana yang MUNCUL di WA biasa.\n\n' +
      variants.map(([l]) => `  ${l}`).join('\n')
  )
}

/* Mode 3 — apakah kartu juga ngerusak pesan TEKS biasa (ctx.reply jalur kartu)? */
async function mode3(ctx, send) {
  const ad = await getAdReply().catch(() => null)

  await send('🧪 RICHDIAG K · teks polos (tanpa kartu)')
  if (ad) {
    await send('🧪 RICHDIAG L · teks + kartu adReply (contextInfo)', {
      contextInfo: { raw: { externalAdReply: ad } }
    })
  }

  await ctx.reply(
    '🧪 *RICHDIAG mode 3* — varian K/L (kartu di pesan teks).\n' +
      'Kalau L juga hilang → kartu merusak semua pesan, bukan cuma interactive.\n' +
      'Tapi catatan: .setreply aktif = varian 4 (pakai linkPreview, bukan kartu ini) — jadi kartu teks mungkin belum pernah kebukti di WA biasa.'
  )
}

export { pluginConfig as config, handler }
