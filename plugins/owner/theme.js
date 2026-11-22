/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * theme.js — Pilih tema global untuk SEMUA kartu rich HTML bot.
 * Sumber tema: lib/richTheme.js (mirror 9 tema web-cf).
 */
import { THEMES, THEME_ORDER, DEFAULT_THEME, getThemeKey, setThemeKey, listThemes, richDoc, esc } from '../../lib/richTheme.js'
import { sendNativeHtml } from '../../lib/emeraldCard.js'

const pluginConfig = {
  name: 'theme',
  alias: ['tema', 'richtheme', 'themecard'],
  category: 'owner',
  description: 'Pilih tema rich HTML (9 tema, sinkron untuk semua kartu)',
  usage: '.theme [nama tema]\n.theme',
  example: '.theme auralys · .theme',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 2,
  limit: 1,
  isEnabled: true,
  energi: 0,
}

function daftarTeks() {
  const active = getThemeKey()
  return `🎨 *TEMA RICH HTML*\n\n${listThemes().map(t => `${t.active ? '▶' : '·'} ${t.key} — ${t.name}`).join('\n')}\n\nGanti: *.theme <nama>*\nContoh: *.theme ${active === 'auralys' ? 'sakura' : 'auralys'}*`
}

function previewHtml(key) {
  const t = THEMES[key] || THEMES[DEFAULT_THEME]
  const swatches = Object.entries(t.colors)
    .filter(([k]) => ['--bg', '--surface', '--accent', '--accent-secondary'].includes(k))
    .map(([k, v]) => `<div class="sw"><i style="background:${esc(v)}"></i><span>${esc(k.replace('--', ''))}</span></div>`)
    .join('')

  const body = `<div class="hd"><div class="top">
    <div class="logo">🎨</div>
    <div><div class="ttl">TEMA RICH HTML</div><div class="sub">Preview langsung · <span data-rtheme>${esc(t.name)}</span></div></div>
    <span class="pill">${esc(key)}</span>
  </div></div>
  <div class="view on">
    <div class="card acc"><div class="k">Tema aktif</div><div class="big" id="rCmd">.theme ${esc(key)}</div>
      <div class="line" style="margin-top:6px">Pilihan ini dipakai semua kartu rich HTML. Ganti kapan saja lewat perintah di bawah.</div>
    </div>
    <div class="card"><div class="k">Warna</div><div class="swatches">${swatches}</div></div>
    <div class="card"><div class="k">Pilih tema lain</div><div class="sw">${THEME_ORDER.map(k =>
      `<button class="${k === key ? 'on' : ''}" onclick="st('${k}')">${esc(THEMES[k].name)}</button>`
    ).join('')}</div>
      <div class="mono">.theme &lt;nama&gt;</div>
    </div>
  </div>
  <div class="ft">Klik swatch untuk pratinjau · simpan lewat <b>.theme &lt;nama&gt;</b></div>`

  const css = `.swatches{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
.sw{display:flex;align-items:center;gap:6px;font-size:9px;color:var(--text-dim)}
.sw i{width:22px;height:22px;border-radius:7px;border:1px solid var(--border);flex:none}
.sw span{font-family:ui-monospace,monospace}`

  return richDoc({ title: `Tema ${t.name}`, body, extraCss: css })
}

async function handler(ctx) {
  const arg = String((ctx.args || [])[0] || '').trim().toLowerCase()
  if (!arg) return ctx.reply(daftarTeks())

  const key = setThemeKey(arg)
  if (!key) {
    return ctx.reply(`⚠️ Tema "${arg}" tidak dikenal.\n\n${daftarTeks()}`)
  }

  try {
    const html = previewHtml(key)
    await sendNativeHtml(ctx.client, ctx.chat, html)
    return ctx.reply(`✅ Tema rich HTML: *${THEMES[key].name}* (${key}). Berlaku untuk semua kartu.`)
  } catch (err) {
    console.error('[theme] gagal kirim preview:', err?.message || String(err))
    return ctx.reply(`✅ Tema rich HTML: *${THEMES[key].name}* (${key}). Preview gagal dikirim, tapi tema tersimpan.`)
  }
}

export { pluginConfig as config, handler }
