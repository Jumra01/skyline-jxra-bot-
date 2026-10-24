/**
 * © skyline-JXRA
 * Lab reply/header Hoshino Ai v2.5.5 yang diterjemahkan ke API zapo-js secara penuh.
 * Varian v1-v16, context c1-c3, rich/html, business, location, buttons.
 */
import { sendReplyVariant } from '../../core/replyStyle.js'
import { sendNativeHtml } from '../../lib/emeraldCard.js'

const pluginConfig = {
  name: 'tesheader', alias: ['testheader', 'headerlab'], category: 'tools',
  description: 'Lab semua varian reply/header ala Hoshino Ai v2.5.5 (zapo-js)',
  usage: '.tesheader [v1-v16|c1-c3|all]', example: '.tesheader all',
  isOwner: true, isPremium: false, isGroup: false, isPrivate: false,
  isAdmin: false, isBotAdmin: false, cooldown: 5, limit: 0, isEnabled: true, energi: 0
}

const VARIANTS = [
  ['v1', 'Teks biasa (default)'],
  ['v2', 'Dokumen + fake contact quoted'],
  ['v3', 'Video GIF + caption'],
  ['v4', 'Link preview + forwarded newsletter'],
  ['v5', 'Fake order quoted + kartu CTA'],
  ['v6', 'Dokumen + quoted pesan asli'],
  ['v7', 'Fake location header interactive'],
  ['v8', 'Interactive location flow + cta buttons'],
  ['v9', 'Legacy buttonsMessage via document wrapper'],
  ['v10', 'Interactive business card header'],
  ['v11', 'Native review_and_pay flow payment'],
  ['v12', 'Animated preview via editKey sequence'],
  ['v13', 'Catalog order review_and_pay flow'],
  ['v14', 'GenAI UnifiedResponse HTML card'],
  ['v15', 'Link preview plus dinamis'],
  ['v16', 'ProductMessage resmi zapo (fresh upload)'],
  ['c1', 'Context standard reply'],
  ['c2', 'Context document reply'],
  ['c3', 'Context link preview reply']
]
const LABEL = new Map(VARIANTS)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const textOf = (id) => `🧪 TES HEADER ${id.toUpperCase()}\n\nVarian Hoshino Ai v2.5.5 yang telah diporting penuh ke arsitektur zapo-js tanpa fallback rusak.`

async function direct(ctx, id, text) {
  const { client, chat, event } = ctx
  if (/^v(?:[1-9]|1[0-6])$/.test(id)) {
    return sendReplyVariant(ctx, text, Number(id.slice(1)))
  }
  if (id === 'c1') {
    return client.message.send(chat, { type: 'text', text }, { quote: event, noStyle: true })
  }
  if (id === 'c2') {
    return client.message.send(
      chat,
      {
        type: 'document',
        media: Buffer.from('skyline-JXRA context verification'),
        mimetype: 'text/plain',
        fileName: 'context.txt',
        caption: text
      },
      { quote: event }
    )
  }
  if (id === 'c3') {
    return client.message.send(
      chat,
      {
        type: 'text',
        text: `https://skyline.web.id\n\n${text}`,
        linkPreview: {
          matchedText: 'https://skyline.web.id',
          title: 'skyline-JXRA Context',
          description: 'Hoshino Context 3 preview via zapo'
        }
      },
      { quote: event, noStyle: true }
    )
  }
  throw new Error(`varian ${id} belum dikenal`)
}

async function handler(ctx) {
  const raw = String(ctx.args?.[0] || '').toLowerCase().trim()
  const ids = raw === 'all'
    ? VARIANTS.map(([id]) => id)
    : raw
      ? raw.split(',').map((x) => x.trim()).filter(Boolean)
      : ['v8', 'v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16']
  const invalid = ids.filter((id) => !LABEL.has(id))
  if (invalid.length) {
    return ctx.reply(`Varian tidak dikenal: ${invalid.join(', ')}\nGunakan opsi: v1-v16, c1-c3, atau all.`)
  }
  const out = []
  for (const id of ids) {
    const started = Date.now()
    try {
      await direct(ctx, id, textOf(id))
      out.push(`✅ ${id} — ${LABEL.get(id)} — ${Date.now() - started}ms`)
    } catch (e) {
      out.push(`❌ ${id} — ${LABEL.get(id)} — ${e?.message || e}`)
    }
    if (ids.length > 1) await sleep(400)
  }
  await ctx.client.message.send(
    ctx.chat,
    { type: 'text', text: `🧪 HASIL TES HEADER HOSHINO (ZAPO FULL)\n\n${out.join('\n')}` },
    { noStyle: true }
  )
}

export { pluginConfig as config, handler }
