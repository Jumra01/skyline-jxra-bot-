/**
 * © skyline-JXRA
 * Lab header/reply ala Hoshino Ai v2.5.5, disesuaikan ke API zapo-js.
 */

import { sendReplyVariant } from '../../core/replyStyle.js'

const pluginConfig = {
  name: 'tesheader',
  alias: ['testheader', 'headerlab'],
  category: 'tools',
  description: 'Tes varian header/reply ala Hoshino Ai',
  usage: '.tesheader [v1-v7|all]',
  example: '.tesheader v7',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
  energi: 0
}

const VARIANTS = [
  ['v1', 'Teks biasa'],
  ['v2', 'Dokumen + quote kontak'],
  ['v3', 'GIF/video + caption'],
  ['v4', 'Link preview + newsletter'],
  ['v5', 'Fake order quote'],
  ['v6', 'Dokumen + quote asli'],
  ['v7', 'Interactive location header']
]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function handler(ctx) {
  const requested = String(ctx.args?.[0] || '').toLowerCase().trim()
  const ids = requested === 'all'
    ? VARIANTS.map(([id]) => id)
    : requested
      ? requested.split(',').map(v => v.trim()).filter(Boolean)
      : ['v2', 'v4', 'v7']

  const invalid = ids.filter(id => !VARIANTS.some(([key]) => key === id))
  if (invalid.length) {
    await ctx.reply(`Varian tidak dikenal: ${invalid.join(', ')}\nGunakan v1-v7, all, atau beberapa varian dipisah koma.`)
    return
  }

  const text = `🧪 TES HEADER ${ids.join(', ').toUpperCase()}\n\n` +
    `Pesan ini dikirim memakai varian reply ala Hoshino Ai v2.5.5.`
  const results = []

  for (const id of ids) {
    const style = Number(id.slice(1))
    const started = Date.now()
    try {
      await sendReplyVariant(ctx, `${text}\n\n▶ Varian ${id.toUpperCase()}`, style)
      results.push(`✅ ${id.toUpperCase()} — ${Date.now() - started}ms`)
    } catch (err) {
      results.push(`❌ ${id.toUpperCase()} — ${err?.message || String(err)}`)
    }
    if (ids.length > 1) await sleep(350)
  }

  await ctx.client.message.send(ctx.chat, {
    type: 'text',
    text: `🧪 *HASIL TES HEADER*\n\n${results.join('\n')}`
  }, { noStyle: true })
}

export { pluginConfig as config, handler }
