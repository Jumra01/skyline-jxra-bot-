/**
 * © skyline-JXRA
 * setmenu.js — Atur variant tampilan menu (.setmenu): v1–v10.
 * Disimpan global (bukan per-grup) via core/groupSettings.
 */
import config from '../../config.js'
import { getGlobal, setGlobal } from '../../core/groupSettings.js'
import { richList, interactiveSendOptions } from '../../lib/richMessage.js'
import { onRichReply } from '../../handlers/messageHandler.js'

const VARIANTS = {
  v1:  { id: 1,  name: 'Simple',              desc: 'Teks biasa (tanpa kartu interaktif)' },
  v2:  { id: 2,  name: 'Standard',            desc: 'richList: gambar header + single_select kategori (default)' },
  v3:  { id: 3,  name: 'Document',            desc: 'Thumbnail dikirim sebagai dokumen + caption menu' },
  v4:  { id: 4,  name: 'Video Interactive',   desc: 'Header video + tombol (Semua Fitur, Channel, Menu Utama)' },
  v5:  { id: 5,  name: 'Button',              desc: 'richButtons: tombol quick_reply (tanpa list kategori)' },
  v6:  { id: 6,  name: 'Document Premium',    desc: 'Thumbnail sebagai dokumen + caption menu' },
  v7:  { id: 7,  name: 'Carousel',            desc: 'Carousel horizontal per kategori (native zapo)' },
  v8:  { id: 8,  name: 'Minimalist',          desc: 'Teks ringkas (12 baris pertama)' },
  v9:  { id: 9,  name: 'NativeFlow',          desc: 'richButtons: tombol + header media' },
  v10: { id: 10, name: 'Product Catalog',     desc: 'richButtons: Semua Fitur & Menu Utama' }
}

const MAX_VARIANT = Object.keys(VARIANTS).length

const pluginConfig = {
  name: 'setmenu',
  alias: ['menuvariant', 'menustyle'],
  category: 'owner',
  description: 'Mengatur variant tampilan menu (v1–v10)',
  usage: '.setmenu <v1-v10>',
  example: '.setmenu v5',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true
}

async function handler(ctx) {
  const variant = (ctx.args[0] ?? '').toLowerCase()

  if (variant) {
    const selected = VARIANTS[variant]
    if (!selected) {
      await ctx.reply(
        `✦ *Set Menu* ✦\n\n` +
        `❌ \`${variant}\` bukan variant yang dikenal.\n` +
        `Gunakan: \`v1\` s/d \`v${MAX_VARIANT}\``
      )
      return
    }
    setGlobal('menuVariant', String(selected.id))
    await ctx.reply(
      `✦ *Menu Diperbarui* ✦\n\n` +
      `✅ Tampilan menu diganti ke *V${selected.id} — ${selected.name}*\n` +
      `_${selected.desc}_`
    )
    return
  }

  const current = Number(getGlobal('menuVariant') || config.ui?.menuVariant || 2)

  const rows = Object.entries(VARIANTS).map(([key, val]) => ({
    id: `setmenu:${key}`,
    title: `${key.toUpperCase()}${val.id === current ? ' ✓' : ''} — ${val.name}`,
    description: val.desc
  }))

  const bodyText =
    `✦ *Set Menu Variant* ✦\n\n` +
    `Variant aktif: *V${current}*\n` +
    `_${VARIANTS[`v${current}`]?.name || 'Unknown'}_\n\n` +
    `Pilih variant dari daftar di bawah.`

  try {
    await ctx.client.message.send(
      ctx.chat,
      richList({
        text: bodyText,
        footer: `${config.botName} • setmenu`,
        title: '🎨 Pilih Variant Menu',
        buttonText: '🎨 Pilih Variant',
        sections: [{ title: `Daftar Variant (v1–v${MAX_VARIANT})`, rows }],
        headerImage: null
      }),
      interactiveSendOptions(ctx.chat)
    )
  } catch (err) {
    let txt = `✦ *Set Menu Variant* ✦\n\nVariant aktif: *V${current}*\n\n`
    for (const [key, val] of Object.entries(VARIANTS)) {
      const mark = val.id === current ? ' ✓' : ''
      txt += `> *${key.toUpperCase()}*${mark} — _${val.desc}_\n`
    }
    txt += `\n_Gunakan: \`${ctx.prefix}setmenu v1\` dst._`
    await ctx.reply(txt)
  }

}

function ensureHandlers() {
  for (let i = 1; i <= MAX_VARIANT; i++) {
    onRichReply(`setmenu:v${i}`, (c) => { setGlobal('menuVariant', String(i)); c.reply(`✅ Menu → V${i}`) })
  }
}
ensureHandlers()

export { pluginConfig as config, handler }
