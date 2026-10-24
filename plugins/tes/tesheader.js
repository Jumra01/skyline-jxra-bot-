/**
 * © skyline-JXRA
 * Lab layout rich alternatif dari Hoshino AIRich yang dipetakan ke zapo-js.
 * Mencoba HScroll, ActionRow, MetadataText, Post, dan Product primitives.
 */
import crypto from 'node:crypto'

const pluginConfig = {
  name: 'tesheader',
  alias: ['testheader', 'headerlab'],
  category: 'tools',
  description: 'Tes alternatif layout rich Hoshino (HScroll, ActionRow, Post, Product)',
  usage: '.tesheader [hscroll|actionrow|tip|post|product|all]',
  example: '.tesheader all',
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

const samplePost = (n) => ({
  title: `Contoh Post ${n}`,
  subtitle: 'Layout Hoshino AIRich',
  username: 'skyline-JXRA',
  profile_picture_url: 'https://skyline.web.id/assets/img/logo-nav.png',
  is_verified: false,
  thumbnail_url: 'https://skyline.web.id/assets/img/logo-nav.png',
  post_caption: `Tes GenAIPostPrimitive nomor ${n}`,
  likes_count: 128,
  comments_count: 12,
  shares_count: 4,
  post_url: 'https://skyline.web.id',
  post_deeplink: 'https://skyline.web.id',
  source_app: 'INSTAGRAM',
  footer_label: 'skyline-JXRA',
  footer_icon: 'https://skyline.web.id/assets/img/logo-nav.png',
  is_carousel: true,
  orientation: 'LANDSCAPE',
  post_type: 'PHOTO',
  __typename: 'GenAIPostPrimitive',
})

const product = {
  title: 'Contoh Product Card',
  brand: 'skyline-JXRA',
  price: 'Rp 10.000',
  sale_price: 'Rp 8.000',
  product_url: 'https://skyline.web.id',
  image: { url: 'https://skyline.web.id/assets/img/logo-nav.png' },
  additional_images: [{ url: 'https://skyline.web.id/assets/img/logo-nav.png' }],
  __typename: 'GenAIProductItemCardPrimitive',
}

const VARIANTS = [
  {
    id: 'hscroll',
    label: 'HScroll dengan dua entity',
    sections: [{
      view_model: {
        __typename: 'GenAIHScrollLayoutViewModel',
        primitives: [1, 2].map((n) => ({
          __typename: 'GenAICompactEntityPrimitive',
          title: n === 1 ? 'skyline-JXRA' : 'Nama Grup Contoh',
          subtitle: `Entity ${n} • HScroll`,
          secondary_subtitle: 'Tes layout horizontal Hoshino',
          entity_id: 12000000 + n,
          entity_url: 'https://skyline.web.id',
          entity_type: 'PERSON',
          action_type: 'MESSAGE',
          is_verified: false,
          image: { url: 'https://skyline.web.id/assets/img/logo-nav.png' },
        })),
      },
    }],
    submessages: [{ messageType: 2, messageText: 'Tes HScroll entity' }],
  },
  {
    id: 'actionrow',
    label: 'ActionRow suggestion pills',
    sections: [{
      view_model: {
        __typename: 'GenAIActionRowLayoutViewModel',
        primitives: ['Header besar', 'Nama bot', 'Nama grup'].map((text) => ({
          prompt_text: text,
          prompt_type: 'SUGGESTED_PROMPT',
          __typename: 'GenAIFollowUpSuggestionPillPrimitive',
        })),
      },
    }],
    submessages: [{ messageType: 2, messageText: 'Tes ActionRow suggestion pills' }],
  },
  {
    id: 'tip',
    label: 'MetadataText primitive',
    sections: [{
      view_model: {
        __typename: 'GenAISingleLayoutViewModel',
        primitive: {
          text: 'skyline-JXRA  •  Header contoh lebih menonjol',
          __typename: 'GenAIMetadataTextPrimitive',
        },
      },
    }],
    submessages: [{ messageType: 2, messageText: 'Tes metadata text' }],
  },
  {
    id: 'post',
    label: 'HScroll post cards',
    sections: [{
      view_model: {
        __typename: 'GenAIHScrollLayoutViewModel',
        primitives: [samplePost(1), samplePost(2)],
      },
    }],
    submessages: [{ messageType: 2, messageText: 'Tes HScroll post cards' }],
  },
  {
    id: 'product',
    label: 'Single product card',
    sections: [{
      view_model: {
        __typename: 'GenAISingleLayoutViewModel',
        primitive: product,
      },
    }],
    submessages: [{ messageType: 2, messageText: 'Tes single product card' }],
  },
]

const byId = new Map(VARIANTS.map((variant) => [variant.id, variant]))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makePayload(variant) {
  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: variant.submessages,
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({
              __typename: 'GenAIUnifiedResponse',
              response_id: crypto.randomUUID(),
              sections: variant.sections,
            })).toString('base64'),
          },
          contextInfo: { isForwarded: true, forwardOrigin: 4 },
        },
      },
    },
  }
}

async function handler(ctx) {
  const requested = String(ctx.args?.[0] || '').trim().toLowerCase()
  const ids = requested === 'all'
    ? VARIANTS.map((variant) => variant.id)
    : requested
      ? requested.split(',').map((id) => id.trim()).filter(Boolean)
      : VARIANTS.map((variant) => variant.id)
  const invalid = ids.filter((id) => !byId.has(id))
  if (invalid.length) {
    return ctx.reply(`Varian tidak dikenal: ${invalid.join(', ')}\nPilih: ${VARIANTS.map((v) => v.id).join(', ')}, atau all.`)
  }

  const results = []
  for (const id of ids) {
    const variant = byId.get(id)
    const started = Date.now()
    try {
      await ctx.client.message.send(ctx.chat, makePayload(variant), {
        additionalAttributes: { type: 'text' },
      })
      results.push(`✅ ${id} — ${variant.label} (${Date.now() - started}ms)`)
    } catch (err) {
      results.push(`❌ ${id} — ${variant.label}: ${err?.message || String(err)}`)
    }
    if (ids.length > 1) await sleep(600)
  }

  await ctx.client.message.send(ctx.chat, {
    type: 'text',
    text: `🧪 HASIL TES LAYOUT RICH HOSHINO\n\n${results.join('\n')}\n\nAck terkirim belum tentu berarti layout dirender WhatsApp.`,
  }, { noStyle: true })
}

export { pluginConfig as config, handler }
