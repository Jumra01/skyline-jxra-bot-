/**
 * © skyline-JXRA
 * setmenu.js — Atur variant tampilan menu (.setmenu): v1, v2, v4.
 * Disimpan global (bukan per-grup) via core/groupSettings.
 */
import config from '../../config.js'
import { getGlobal, setGlobal } from '../../core/groupSettings.js'
import { richList, interactiveSendOptions } from '../../lib/richMessage.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { normalizeMenuVariant } from '../general/menu.js'

const VARIANTS = {
  v1: { id: 1, name: 'Simple',          desc: 'Teks biasa (tanpa kartu interaktif)' },
  v2: { id: 2, name: 'Standard',        desc: 'richList: gambar header + single_select kategori (default)' },
  v4: { id: 4, name: 'Location Button', desc: 'Header lokasi di kartu + kategori + saluran + limited_time_offer (Hoshino v21)' }
}

/** Semua ID variant (bukan asumsi 1..N berurutan — v4 adalah v21 Hoshino). */
const VARIANT_IDS = Object.values(VARIANTS).map((v) => v.id)

const pluginConfig = {
  name: 'setmenu',
  alias: ['menuvariant', 'menustyle'],
  category: 'owner',
  description: 'Mengatur variant tampilan menu (v1, v2, v4)',
  usage: '.setmenu <variant>',
  example: '.setmenu v4',
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
        `Gunakan: v1, v2, atau v4`
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

  const current = normalizeMenuVariant(getGlobal('menuVariant') || config.ui?.menuVariant || 2)

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
        sections: [{ title: 'Daftar Variant (v1, v2, v4)', rows }],
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
  for (const id of VARIANT_IDS) {
    onRichReply(`setmenu:v${id}`, (c) => { setGlobal('menuVariant', String(id)); c.reply(`✅ Menu → V${id}`) })
  }
}
ensureHandlers()

export { pluginConfig as config, handler }
