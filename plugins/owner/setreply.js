/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * setreply.js — Atur gaya reply bot (.setreply): v1–v7.
 *
 * Pakai:
 *   .setreply          → daftar varian via list (ada ceklis varian aktif)
 *   .setreply v1-v7    → pilih varian (langsung kelihatan di balasannya)
 *   .setreply thumb    → balas foto: jadi thumbnail KARTU GLOBAL semua balasan
 *                        (varian kartu — v1 BASIC / v5 — di semua chat)
 *   .setreply thumb v4 → balas foto: jadi thumbnail PREVIEW v4 (link preview);
 *                        file assets/thumb/v4-thumb.jpg — teksnya di config
 *                        (reply.v4.title/desc)
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import {
  REPLY_VARIANTS,
  getReplyStyle,
  setReplyStyle
} from '../../core/replyStyle.js'
import { setCta } from '../../core/cta.js'
import { downloadMedia } from '../../lib/media.js'
import { onRichReply } from '../../handlers/messageHandler.js'

// Thumbnail kartu global (externalAdReply) — berlaku di semua chat
const CARD_THUMB = 'assets/thumb/cta-thumb.jpg'
// Thumbnail preview v4 (link preview) — assets/thumb/v4-thumb.jpg, path di config.reply.v4.thumb
const V4_THUMB = config.reply?.v4?.thumb || 'assets/thumb/v4-thumb.jpg'

function applyVariant(ctx, n) {
  const v = setReplyStyle(n)
  const info = REPLY_VARIANTS[v]
  // Balasan ini otomatis tampil pakai gaya baru
  return ctx.reply(
    `✅ *REPLY VARIANT DIGANTI*\n\n` +
    `${info.emoji} *${info.key.toUpperCase()} — ${info.name}*\n` +
    `_${info.desc}_\n\n` +
    `Balasan ini sudah pakai gaya baru, Kak 🎯`
  )
}

function fileStatus(rel) {
  try {
    const st = fs.statSync(path.join(process.cwd(), rel))
    return `✅ \`${rel}\` (${Math.round(st.size / 1024)} KB)`
  } catch {
    return `❌ \`${rel}\` belum ada`
  }
}

function thumbStatus() {
  const p = config.mainPrefix
  return (
    `🖼 *THUMBNAIL*\n\n` +
    `*Kartu global* (externalAdReply — semua chat, v1/v5):\n` +
    `${fileStatus(CARD_THUMB)}\n` +
    `→ balas foto + \`${p}setreply thumb\`\n\n` +
    `*Preview v4* (link preview):\n` +
    `${fileStatus(V4_THUMB)}\n` +
    `→ balas foto + \`${p}setreply thumb v4\`\n` +
    `_teks preview v4 diatur di config.js_ → \`reply.v4.title\` / \`reply.v4.desc\`` +
    `\n_atau timpa filenya langsung_\n`
  )
}

function ensureHandlers() {
  for (const [n, v] of Object.entries(REPLY_VARIANTS)) {
    onRichReply(`setreply:${v.key}`, (ctx) => applyVariant(ctx, Number(n)))
  }
}
ensureHandlers()

const pluginConfig = {
  name: "setreply",
  alias: ['replyvariant', 'replystyle'],
  category: "owner",
  description: "Atur gaya reply bot (v1-v16)",
  usage: ".setreply",
  example: ".setreply",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    const sub = (ctx.args[0] || '').toLowerCase()
    const current = getReplyStyle()
    const pick = sub.match(/^v?([1-9]|1[0-6])$/)

    if (pick) {
      await applyVariant(ctx, Number(pick[1]))
      return
    }
    if (sub === 'thumb') {
      const target = (ctx.args[1] || '').toLowerCase() === 'v4' ? 'v4' : 'global'
      const rel = target === 'v4' ? V4_THUMB : CARD_THUMB
      const media = await downloadMedia(ctx.client, ctx.event)
      if (media && (media.kind === 'image' || media.kind === 'sticker')) {
        const dest = path.join(process.cwd(), rel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, media.buffer)
        if (target === 'global') setCta({ card: { thumb: CARD_THUMB } }) // pastiin store nunjuk file global ini
        await ctx.react('✅')
        await ctx.reply(
          target === 'v4'
            ? `✅ Thumbnail preview v4 diganti (${Math.round(media.buffer.length / 1024)} KB).\n` +
              `File: \`${rel}\` — berlaku di link preview (varian v4).\n` +
              `_Teks preview: config.js → reply.v4.title / reply.v4.desc_`
            : `✅ Thumbnail kartu global diganti (${Math.round(media.buffer.length / 1024)} KB).\n` +
              `Berlaku di *semua chat* — kartu nempel di balasan bot (varian kartu v1/v5).`
        )
        return
      }
      const quoted = ctx.event?.message?.extendedTextMessage?.contextInfo?.quotedMessage
      if (quoted) {
        await ctx.reply('⚠️ Pesan yang dibalas bukan gambar. Balas *foto* ya.')
        return
      }
      await ctx.reply(thumbStatus())
      return
    }

    if (sub) {
      await ctx.reply(
        `❌ *VARIANT TIDAK VALID*\n\n` +
        `Gunakan: *v1* s/d *v16*, atau:\n` +
        `• \`thumb\` — balas foto → thumbnail kartu global\n` +
        `• \`thumb v4\` — balas foto → thumbnail preview v4\n` +
        `Contoh: \`${ctx.prefix}setreply v5\``
      )
      return
    }

    const cur = REPLY_VARIANTS[current]
    const rows = Object.entries(REPLY_VARIANTS).map(([n, v]) => ({
      title: `${v.emoji} ${v.key.toUpperCase()}${Number(n) === current ? ' ✓' : ''} — ${v.name}`,
      description: v.desc,
      id: `setreply:${v.key}`
    }))

    await ctx.replyList({
      text:
        `💬 *REPLY VARIANT*\n\n` +
        `Atur tampilan balasan bot ketika membalas pesan user ✨\n` +
        `Variant aktif saat ini: *${cur.key.toUpperCase()} — ${cur.name}* ${cur.emoji} 🎯\n\n` +
        `Pilih varian dari daftar di bawah 👇\n` +
        `_thumbnail: balas foto dengan_ \`${ctx.prefix}setreply thumb\` _(kartu global)_ / \`${ctx.prefix}setreply thumb v4\` _(preview v4)_`,
      title: '💬 Pilih Variant Reply',
      buttonText: 'Variant',
      sections: [{ title: 'Daftar Variant Reply', rows }],
      footer: `${config.botName} • setreply`
    })
  }

export { pluginConfig as config, handler };
