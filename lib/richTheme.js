/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * richTheme.js — Tema + wrapper HTML native untuk SEMUA kartu rich bot.
 *
 * Paleta di-sinkron dari web-cf `public/assets/js/themes.js` (9 tema).
 * Pilihan tema disimpan sekali di `data/rich-theme.json` → semua kartu
 * yang pakai `richDoc()` otomatis memakai tema yang sama.
 *
 * Aturan WA webview (jangan dilanggar):
 *   - full document: DOCTYPE + charset + title
 *   - payload ≤ ~26KB base64 → html ideal < 18KB
 *   - JANGAN aspect-ratio / max-height vh / filter blur / backdrop-filter /
 *     mask-image / position fixed / remote <img> (webview offline)
 *   - tinggi pakai px + overflow-y:auto + min-height:0
 */
import { createJsonStore } from './jsonStore.js'

export const THEME_ORDER = [
  'komik', 'skyline', 'azure', 'glass', 'auralys', 'sakura', 'sunset', 'midnight', 'pixel'
]

export const DEFAULT_THEME = 'komik'

/** Mirror web-cf themes.js — jangan ubah warna seenaranya tanpa sinkron. */
export const THEMES = {
  komik: {
    name: 'Komik', scheme: 'light', colors: {
      '--bg': '#FAF8FF', '--surface': '#FFFFFF', '--surface-2': '#F2F3FF',
      '--primary': '#131B2E', '--primary-hover': '#283044',
      '--text': '#131B2E', '--text-dim': '#434655', '--text-muted': '#737686',
      '--accent': '#2563EB', '--accent-secondary': '#00D2FF',
      '--border': 'rgba(15,23,42,0.14)', '--glow': '3px 3px 0 #131B2E'
    }
  },
  skyline: {
    name: 'Skyline', scheme: 'dark', colors: {
      '--bg': '#080A0E', '--surface': '#12151C', '--surface-2': '#1A1E27',
      '--primary': '#E4E8EE', '--primary-hover': '#F0F4F8',
      '--text': '#FFFFFF', '--text-dim': '#A8B4C0', '--text-muted': '#788898',
      '--accent': '#B8C8D8', '--accent-secondary': '#788898',
      '--border': 'rgba(255,255,255,0.06)', '--glow': '0 0 40px rgba(184,200,216,0.3)'
    }
  },
  azure: {
    name: 'Azure', scheme: 'dark', colors: {
      '--bg': '#090d16', '--surface': '#111827', '--surface-2': '#182235',
      '--primary': '#E4E8EE', '--primary-hover': '#F0F4F8',
      '--text': '#FFFFFF', '--text-dim': '#b7c4d6', '--text-muted': '#8090a7',
      '--accent': '#8cc8ff', '--accent-secondary': '#6689ff',
      '--border': 'rgba(173,205,238,0.12)', '--glow': '0 18px 46px -18px rgba(82,133,235,0.55)'
    }
  },
  glass: {
    name: 'Liquid Glass', scheme: 'light', colors: {
      '--bg': '#EAF1FB', '--surface': 'rgba(255,255,255,0.58)', '--surface-2': 'rgba(255,255,255,0.42)',
      '--primary': '#0B1220', '--primary-hover': '#152238',
      '--text': '#0B1220', '--text-dim': '#3D4A5C', '--text-muted': '#6C7A8C',
      '--accent': '#0A84FF', '--accent-secondary': '#7C5CFF',
      '--border': 'rgba(255,255,255,0.62)', '--glow': '0 18px 50px rgba(23,48,92,0.16)'
    }
  },
  auralys: {
    name: 'Auralys', scheme: 'dark', colors: {
      '--bg': '#0B0C0F', '--surface': 'rgba(255,255,255,0.06)', '--surface-2': 'rgba(255,255,255,0.10)',
      '--primary': '#F2F4F7', '--primary-hover': '#FFFFFF',
      '--text': '#F2F4F7', '--text-dim': '#B4BAC6', '--text-muted': '#8B92A0',
      '--accent': '#FF7F5C', '--accent-secondary': '#FFB85C',
      '--border': 'rgba(255,255,255,0.10)', '--glow': '0 18px 46px -18px rgba(255,127,92,0.45)'
    }
  },
  sakura: {
    name: 'Sakura', scheme: 'light', colors: {
      '--bg': '#FFF5F8', '--surface': '#FFFFFF', '--surface-2': '#FFF0F5',
      '--primary': '#2B1020', '--primary-hover': '#45182E',
      '--text': '#2B1020', '--text-dim': '#6B4257', '--text-muted': '#9A7386',
      '--accent': '#E8437F', '--accent-secondary': '#FF9EC4',
      '--border': 'rgba(43,16,32,0.12)', '--glow': '0 16px 40px -20px rgba(232,67,127,0.5)'
    }
  },
  sunset: {
    name: 'Sunset', scheme: 'dark', colors: {
      '--bg': '#1A0F0D', '--surface': '#241613', '--surface-2': '#2E1C18',
      '--primary': '#FFE9DD', '--primary-hover': '#FFF6F0',
      '--text': '#FFF3EC', '--text-dim': '#E5C4B4', '--text-muted': '#B08D7E',
      '--accent': '#FF8A3D', '--accent-secondary': '#FF4D6D',
      '--border': 'rgba(255,255,255,0.08)', '--glow': '0 18px 46px -18px rgba(255,110,60,0.5)'
    }
  },
  midnight: {
    name: 'Midnight', scheme: 'dark', colors: {
      '--bg': '#0B0D1F', '--surface': '#141733', '--surface-2': '#1B1F45',
      '--primary': '#E9EBFF', '--primary-hover': '#F5F6FF',
      '--text': '#FFFFFF', '--text-dim': '#B9BEE8', '--text-muted': '#8A90C2',
      '--accent': '#8B7CFF', '--accent-secondary': '#4CC9F0',
      '--border': 'rgba(255,255,255,0.08)', '--glow': '0 18px 46px -18px rgba(139,124,255,0.45)'
    }
  },
  pixel: {
    name: 'Pixel Arcade', scheme: 'light', colors: {
      '--bg': '#f9f9f9', '--surface': '#ffffff', '--surface-2': '#f1f1f1',
      '--primary': '#000000', '--primary-hover': '#333333',
      '--text': '#1b1b1b', '--text-dim': '#4a4a4a', '--text-muted': '#777777',
      '--accent': '#e52521', '--accent-secondary': '#5c94fc',
      '--border': 'rgba(0,0,0,0.85)', '--glow': '5px 5px 0 #000000'
    }
  }
}

const store = createJsonStore('data/rich-theme.json', { delay: 300 })

export function getThemeKey() {
  const key = store.get('theme')
  return THEMES[key] ? key : DEFAULT_THEME
}

export function setThemeKey(key) {
  const k = String(key || '').toLowerCase()
  if (!THEMES[k]) return null
  store.set('theme', k)
  store.flush()
  return k
}

export function listThemes() {
  const active = getThemeKey()
  return THEME_ORDER.map(k => ({ key: k, name: THEMES[k].name, active: k === active }))
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/** CSS variable declarations untuk satu tema. */
export function cssVars(key = getThemeKey()) {
  const t = THEMES[key] || THEMES[DEFAULT_THEME]
  return Object.entries(t.colors).map(([k, v]) => `${k}:${v}`).join(';')
}

/* Script ganti tema di dalam kartu (instan, tanpa kirim ulang pesan).
 * Simpan permanen tetap lewat command `.theme <key>` (data/rich-theme.json). */
function themeScript() {
  const palettes = JSON.stringify(Object.fromEntries(
    THEME_ORDER.map(k => [k, { name: THEMES[k].name, scheme: THEMES[k].scheme, colors: THEMES[k].colors }])
  ))
  return `<script>
var RP=${palettes};
function ra(k){var t=RP[k]||RP.${DEFAULT_THEME};var r=document.documentElement;
Object.keys(t.colors).forEach(function(x){r.style.setProperty(x,t.colors[x])});
r.style.colorScheme=t.scheme;document.querySelectorAll('[data-rtheme]').forEach(function(n){n.textContent=t.name});
var c=document.getElementById('rCmd');if(c)c.textContent='.theme '+k;}
function st(k){ra(k)}
<\/script>`
}

/* Base CSS bareng. Turunan tema disisipkan di :root lewat cssVars(). */
const BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}
html,body{min-height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);padding:8px}
.frame{width:100%;max-width:420px;margin:0 auto;background:linear-gradient(155deg,var(--surface),var(--surface-2));border:1px solid var(--border);border-radius:18px;box-shadow:var(--glow);overflow:hidden}
.hd{padding:13px 14px 10px;background:linear-gradient(135deg,var(--surface-2),var(--surface));border-bottom:1px solid var(--border)}
.top{display:flex;align-items:center;gap:9px}
.logo{width:34px;height:34px;flex:none;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent-secondary));display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;box-shadow:0 4px 14px -6px var(--accent)}
.ttl{font-size:15px;font-weight:800;letter-spacing:.3px}
.sub{font-size:9px;color:var(--text-muted);letter-spacing:1.2px;text-transform:uppercase;margin-top:2px}
.pill{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.6px;padding:4px 8px;border-radius:999px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-secondary));white-space:nowrap}
.pill.off{background:var(--surface-2);color:var(--text-muted);border:1px solid var(--border)}
.tabs{display:flex;gap:5px;padding:8px 10px 4px;overflow-x:auto}
.tab{flex:none;font-size:10px;font-weight:700;letter-spacing:.3px;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);cursor:pointer}
.tab.on{color:#fff;border-color:transparent;background:linear-gradient(135deg,var(--accent),var(--accent-secondary))}
.view{display:none;padding:10px 12px 12px}
.view.on{display:block}
.card{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:10px 11px;margin-bottom:8px}
.card.acc{background:linear-gradient(135deg,var(--surface-2),var(--surface));border-color:var(--accent)}
.k{font-size:8px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-muted)}
.big{font-size:22px;font-weight:800;margin-top:2px;color:var(--accent)}
.line{font-size:11px;line-height:1.55;color:var(--text-dim)}
.line b{color:var(--text)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--accent);background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:6px 7px;margin-top:5px;word-break:break-all}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:8px 6px;text-align:center}
.stat .n{font-size:17px;font-weight:800;color:var(--accent)}
.stat .l{font-size:8px;color:var(--text-muted);letter-spacing:.6px;margin-top:2px}
.step{display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed var(--border)}
.step:last-child{border-bottom:0}
.no{width:20px;height:20px;flex:none;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--accent-secondary));color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center}
.step .t{font-size:11px;font-weight:800;color:var(--text)}
.step .d{font-size:10px;color:var(--text-dim);line-height:1.5;margin-top:2px}
.tag{display:inline-block;font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;background:var(--surface-2);color:var(--text-dim);border:1px solid var(--border);margin:2px 3px 0 0}
.tag.a{color:var(--accent);border-color:var(--accent)}
.row{padding:8px 0;border-bottom:1px dashed var(--border)}
.row:last-child{border-bottom:0}
.row .n{font-size:11px;font-weight:800}
.row .m{font-size:9px;color:var(--text-muted);word-break:break-all;margin-top:2px}
.row .s{font-size:9px;font-weight:700;margin-top:3px}
.ok{color:#39c97f}.bad{color:#ff6b6b}.life{color:#60a5fa}
.sw{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.sw button{font-size:9px;font-weight:700;padding:5px 8px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);cursor:pointer}
.sw button.on{border-color:var(--accent);color:var(--accent)}
.ft{padding:8px 12px 11px;border-top:1px solid var(--border);font-size:9px;color:var(--text-muted);text-align:center;letter-spacing:.4px}
.ft b{color:var(--accent)}
.scroll{max-height:620px;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:0}`

/**
 * Bungkus body kartu jadi dokumen HTML lengkap + tema aktif.
 * `extraCss` dan `extraScript` opsional (milik kartu masing-masing).
 */
export function richDoc({ title = 'Skyline', body = '', extraCss = '', extraScript = '', theme } = {}) {
  const key = THEMES[theme] ? theme : getThemeKey()
  const t = THEMES[key]
  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>${esc(title)}</title>
<style>
:root{${cssVars(key)};--accent-gradient:linear-gradient(135deg,var(--accent),var(--accent-secondary))}
${BASE_CSS}
${extraCss}
</style>
</head><body>
<div class="frame">${body}</div>
${themeScript()}
${extraScript ? `<script>${extraScript}<\/script>` : ''}
</body></html>`
}

/** Perkiraan bytes payload base64 — jangan kirim kalau > ~26KB. */
export function payloadBytes(html) {
  return Math.ceil(Buffer.byteLength(html, 'utf8') / 3) * 4
}
