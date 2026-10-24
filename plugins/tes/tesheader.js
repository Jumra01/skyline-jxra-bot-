/**
 * © skyline-JXRA
 * Lab reply/header Hoshino Ai v2.5.5 yang diterjemahkan ke API zapo-js.
 * Varian v1-v16, context c1-c3, rich/html, business, location, buttons.
 */
import { sendReplyVariant } from '../../core/replyStyle.js'
import { sendNativeHtml } from '../../lib/emeraldCard.js'
import { richButtons } from '../../lib/richMessage.js'

const pluginConfig = {
  name: 'tesheader', alias: ['testheader', 'headerlab'], category: 'tools',
  description: 'Lab semua varian reply/header ala Hoshino Ai v2.5.5',
  usage: '.tesheader [v1-v16|c1-c3|rich|business|all]', example: '.tesheader all',
  isOwner: true, isPremium: false, isGroup: false, isPrivate: false,
  isAdmin: false, isBotAdmin: false, cooldown: 8, limit: 0, isEnabled: true, energi: 0
}

const VARIANTS = [
  ['v1','Teks biasa'], ['v2','Dokumen + quote kontak'], ['v3','GIF/video + caption'],
  ['v4','Link preview + newsletter'], ['v5','Fake order quote'], ['v6','Dokumen + quote asli'],
  ['v7','Interactive location'], ['v8','Location interactive'], ['v9','Buttons + location'],
  ['v10','Business card'], ['v11','Payment request'], ['v12','Animated link preview'],
  ['v13','Fake catalog'], ['v14','AI Rich response'], ['v15','Link preview favicon'],
  ['v16','Product/rich card'], ['c1','Context standard'], ['c2','Context document'],
  ['c3','Context link preview'], ['rich','Native HTML rich card'], ['business','Business card helper'],
  ['location','Location header'], ['buttons','Buttons header']
]
const LABEL = new Map(VARIANTS)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const textOf = (id) => `🧪 TES HEADER ${id.toUpperCase()}\n\nVarian Hoshino Ai v2.5.5 yang sudah disesuaikan ke zapo-js.`

async function direct(ctx, id, text) {
  const { client, chat, event } = ctx
  if (/^v[1-7]$/.test(id)) return sendReplyVariant(ctx, text, Number(id.slice(1)))
  if (id === 'c1' || id === 'c3') return client.message.send(chat, { type: 'text', text, linkPreview: id === 'c3' ? { matchedText: 'https://skyline.web.id', title: 'skyline-JXRA', description: 'Hoshino context preview' } : undefined }, { quote: event, noStyle: true })
  if (id === 'c2') return client.message.send(chat, { type: 'document', media: Buffer.from('skyline-JXRA'), mimetype: 'text/plain', fileName: 'context.txt', caption: text }, { quote: event })
  if (id === 'v8' || id === 'location') return client.message.send(chat, { interactiveMessage: { header: { hasMediaAttachment: false, locationMessage: { degreesLatitude: 0, degreesLongitude: 0, name: 'skyline-JXRA', address: 'Hoshino context' } }, body: { text }, nativeFlowMessage: { buttons: [] } } }, { quote: event })
  if (id === 'v9' || id === 'buttons') return client.message.send(chat, richButtons({ text, footer: 'skyline-JXRA', buttons: [{ text: 'Owner', id: 'owner' }, { text: 'All Menu', id: 'allmenu' }] }), { quote: event })
  if (id === 'v10' || id === 'business') return client.message.send(chat, { interactiveMessage: { header: { title: 'skyline-JXRA', subtitle: 'Business Card', hasMediaAttachment: false }, body: { text }, footer: { text: 'Hoshino Ai v2.5.5' }, nativeFlowMessage: { buttons: [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Owner', id: 'owner' }) }] } } }, { quote: event })
  if (id === 'v11') return client.message.send(chat, { requestPaymentMessage: { currencyCodeIso4217: 'IDR', amount1000: 0, requestFrom: ctx.sender, noteMessage: { extendedTextMessage: { text } } } }, { quote: event })
  if (id === 'v12' || id === 'v15') return client.message.send(chat, { type: 'text', text: `https://skyline.web.id\n\n${text}`, linkPreview: { matchedText: 'https://skyline.web.id', title: 'skyline-JXRA', description: 'Reply preview Hoshino Ai' } }, { quote: event, noStyle: true })
  if (id === 'v13') return client.message.send(chat, { orderMessage: { orderId: 'skyline-test', itemCount: 1, status: 'INQUIRY', surface: 'CATALOG', message: text, orderTitle: 'skyline-JXRA', sellerJid: ctx.sender, totalAmount1000: 0, totalCurrencyCode: 'IDR' } }, { quote: event })
  if (id === 'v14' || id === 'rich' || id === 'v16') return sendNativeHtml(client, chat, `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>skyline</title></head><body style="font-family:Arial;background:#111;color:#fff;padding:24px"><h2>✨ ${id.toUpperCase()} • skyline-JXRA</h2><p>${text}</p><button>Hoshino Rich Response</button></body></html>`)
  throw new Error(`varian ${id} belum dikenal`)
}

async function handler(ctx) {
  const raw = String(ctx.args?.[0] || '').toLowerCase().trim()
  const ids = raw === 'all' ? VARIANTS.map(([id]) => id) : raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : ['v8','v9','v14','v15','v16']
  const invalid = ids.filter(id => !LABEL.has(id))
  if (invalid.length) return ctx.reply(`Varian tidak dikenal: ${invalid.join(', ')}\nGunakan v1-v16, c1-c3, rich, business, location, buttons, atau all.`)
  const out = []
  for (const id of ids) {
    const started = Date.now()
    try { await direct(ctx, id, textOf(id)); out.push(`✅ ${id} — ${LABEL.get(id)} — ${Date.now()-started}ms`) }
    catch (e) { out.push(`❌ ${id} — ${LABEL.get(id)} — ${e?.message || e}`) }
    if (ids.length > 1) await sleep(350)
  }
  await ctx.client.message.send(ctx.chat, { type: 'text', text: `🧪 HASIL TES HEADER\n\n${out.join('\n')}` }, { noStyle: true })
}
export { pluginConfig as config, handler }
