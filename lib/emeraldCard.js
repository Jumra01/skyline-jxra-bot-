/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * emeraldCard.js — Kartu notif/riwayat emerald 🟩 (HTML native, tema Minecraft).
 *
 * Render native di WA lewat konsep plugins/game/snake.js: kirim payload
 * polos richResponseMessage + HTML full document (DOCTYPE + charset),
 * ukuran payload dijaga setara snake (~19KB) biar pasti ke-render.
 *
 * Fitur kartu:
 * - Tinggi frame NATURAL (tanpa aspect-ratio/vh-batas) — webview
 *   WA gak ngehitung aspect-ratio → collapse jadi strip hitam
 * - 3 view di dalam kartu: 🔔 NOTIF / 👤 INFO USER / 📜 RIWAYAT
 *   (konten kelebihan → tombol nav di dasar frame, onclick swap — pola aurora)
 * - Tema Minecraft: tile dirt 16px (canvas), teks hard-shadow, tombol GUI bevel,
 *   XP bar buat progress saldo, avatar square pixel
 * - Data riwayat di-embed saat kirim (snapshot fresh) — tombol tanpa roundtrip
 *
 * Dipakai: handlers/messageHandler.js (route), plugins/general/riwayat.js
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import config from '../config.js'
import { logger } from '../core/logger.js'
import {
  getBalance, getEmerald, getEmeraldHistory, emeraldStats, getUser, isPremiumActive
} from '../core/database.js'
import { getCharacter } from '../core/rpg.js'

/* ────────────────────────── util ────────────────────────── */

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const emeraldMax = () => Math.max(1, Number(config.emerald?.max) || 64)

function fmtTime(at) {
  try {
    return new Date(at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
  } catch { return '--:--' }
}

function fmtDate(at) {
  try {
    return new Date(at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium' })
  } catch { return '-' }
}

function fmtPhone(num) {
  const d = String(num || '').replace(/\D/g, '')
  return d ? `+${d}` : '-'
}

let versionCache
function botVersion() {
  if (versionCache !== undefined) return versionCache
  try {
    versionCache = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || ''
  } catch { versionCache = '' }
  return versionCache
}

/* ─────────────── toggle global notif (src/data) ─────────────── */

const NOTIF_FILE = path.join(process.cwd(), 'src', 'data', 'emeraldNotify.json')

export function getNotifyGlobal() {
  try {
    if (fs.existsSync(NOTIF_FILE)) {
      return JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8')).global !== false
    }
  } catch (err) {
    logger.warn({ err }, 'Gagal baca emeraldNotify.json — pakai default ON')
  }
  return config.emerald?.notify !== false
}

export function setNotifyGlobal(on) {
  try {
    fs.mkdirSync(path.dirname(NOTIF_FILE), { recursive: true })
    fs.writeFileSync(NOTIF_FILE, JSON.stringify({ global: !!on, updatedAt: Date.now() }, null, 2))
    return true
  } catch (err) {
    logger.error({ err }, 'Gagal simpan emeraldNotify.json')
    return false
  }
}

/* ────────────────────── tekstur dirt (canvas) ────────────────────── */

let dirtTilePromise
/** Tile dirt 16×16 pixel → data URI. */
function dirtTile() {
  if (!dirtTilePromise) {
    dirtTilePromise = (async () => {
      try {
        const { createCanvas } = await import('@napi-rs/canvas')
        const s = 16
        const c = createCanvas(s, s)
        const g = c.getContext('2d')
        const base = ['#866043', '#7a563c', '#91684a', '#6f4e35', '#8a6247']
        const dark = ['#5d412b', '#664731', '#543b27']
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            g.fillStyle = Math.random() < 0.22
              ? dark[(Math.random() * dark.length) | 0]
              : base[(Math.random() * base.length) | 0]
            g.fillRect(x, y, 1, 1)
          }
        }
        return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`
      } catch (err) {
        logger.warn({ err }, 'Gagal bikin tile dirt — pakai warna polos')
        return ''
      }
    })()
  }
  return dirtTilePromise
}

/* ────────────────────── avatar (PP user) ────────────────────── */

const AVATAR_TTL = 20 * 60 * 1000
const avatarCache = new Map()

async function toJpegDataUri(buf, size = 256, quality = 78) {
  const sharp = (await import('sharp')).default
  const out = await sharp(buf).rotate().resize(size, size, { fit: 'cover' }).jpeg({ quality }).toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

/** Avatar inisial — gaya head Minecraft (gradient kotak + huruf). */
async function initialsAvatar(name) {
  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    const size = 112
    const c = createCanvas(size, size)
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, '#2f6b33')
    grad.addColorStop(0.55, '#5D9C3F')
    grad.addColorStop(1, '#8fce62')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    g.fillStyle = 'rgba(0,0,0,0.16)'
    for (let i = 0; i < 26; i++) {
      const p = 16
      g.fillRect(((Math.random() * size / p) | 0) * p, ((Math.random() * size / p) | 0) * p, p, p)
    }
    g.fillStyle = '#ffffff'
    g.font = 'bold 64px monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText((String(name || '?').trim()[0] || '?').toUpperCase(), size / 2, size / 2 + 3)
    return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`
  } catch { return '' }
}

/** PP WA → data URI (cache 20 menit); gagal → avatar inisial. */
async function userAvatar(client, jid, name) {
  const hit = avatarCache.get(jid)
  if (hit && Date.now() - hit.at < AVATAR_TTL) return hit.uri
  let uri = ''
  try {
    // Race timeout: getProfilePicture bisa hang tanpa resolve di kondisi
    // production → kartu gak pernah terkirim tanpa error. 4s → pakai inisial.
    const pic = await Promise.race([
      Promise.resolve(client?.profile?.getProfilePicture?.(jid)),
      new Promise((r) => setTimeout(() => r(null), 4000))
    ])
    if (pic?.url) {
      const res = await fetch(pic.url, { signal: AbortSignal.timeout(5000), redirect: 'follow' })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        // 112px q50: payload unifiedResponse wajib ≤ ukuran snake (26KB b64)
        // yang terbukti render native — avatar gede bikin payload 31KB.
        if (buf.length) uri = await toJpegDataUri(buf, 112, 50)
      }
    }
  } catch {}
  if (!uri) uri = await initialsAvatar(name)
  if (uri) avatarCache.set(jid, { uri, at: Date.now() })
  return uri
}

/** Logo bot (assets/thumb/cta-thumb.jpg) → data URI kecil; kosong kalau gak ada. */
async function botLogo() {
  try {
    const p = path.join(process.cwd(), 'assets', 'thumb', 'cta-thumb.jpg')
    if (fs.existsSync(p)) return await toJpegDataUri(fs.readFileSync(p), 48, 48)
  } catch {}
  return ''
}

/* ────────────────────── kirim HTML native ────────────────────── */

/**
 * Kirim HTML — tiru PERSIS konsep plugins/game/snake.js (owner minta):
 * payload polos `botForwardedMessage > richResponseMessage` + contextInfo
 * `{ isForwarded, forwardOrigin: 4 }`, tanpa wrapper verificationMetadata.
 * HTML-nya sendiri wajib full document (`<!DOCTYPE html>` + charset).
 */
export async function sendNativeHtml(client, chat, html) {
  try {
    const sent = await client.message.send(chat, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            unifiedResponse: {
              data: Buffer.from(JSON.stringify({
                __typename: 'GenAIUnifiedResponse',
                response_id: crypto.randomUUID(),
                sections: [{
                  __typename: 'GenAIUnifiedResponseSection',
                  view_model: {
                    __typename: 'GenAISingleLayoutViewModel',
                    primitive: {
                      __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                      trusted_sources: [],
                      payload: html
                    }
                  }
                }]
              })).toString('base64')
            },
            contextInfo: { isForwarded: true, forwardOrigin: 4 }
          }
        }
      }
    }, { additionalAttributes: { type: 'text' } })
    logger.info(`Kartu HTML native terkirim — ${Math.round(html.length / 1024)}KB → ${chat}`)
    return sent
  } catch (err) {
    logger.error({ err }, 'Kirim kartu HTML native GAGAL')
    throw err
  }
}

/* ────────────────────── builder kartu ────────────────────── */

function roleBadge(role) {
  if (role === 'owner') return '<span class="badge owner">KING</span>'
  if (role === 'admin') return '<span class="badge admin">OP</span>'
  if (role) return '<span class="badge staff">MOD</span>'
  return '<span class="badge member">PLAYER</span>'
}

/** Blok statis "sumber emerald" — ngisi ruang frame 9:16 + ngingetin cara nambah. */
function sumberRows() {
  const daily = Math.max(0, Number(config.emerald?.daily?.amount) || 30)
  const regen = Math.max(0, Number(config.emerald?.regen?.amount) || 10)
  const per = Math.round((Number(config.emerald?.regen?.intervalMs) || 600_000) / 60_000)
  return `
    <div class="sec">▸ NAMBAH SALDO EMERALD</div>
    <div class="row"><span>🎁 <b>.daily</b> — klaim harian</span><span class="pos">+${daily} 🟩</span></div>
    <div class="row"><span>⏳ <b>REGEN</b> — otomatis</span><span class="pos">+${regen}/${per}m</span></div>
    <div class="row"><span>⚔️ <b>RPG</b> — battle, quest, jual</span><span class="pos">+1…5 🟩</span></div>`
}

function viewNotif(d) {
  const pct = Math.min(100, Math.round((d.emerald / d.max) * 100))
  const preview = d.history.slice(0, 3)
  const previewRows = preview.length
    ? preview.map((h) => `
      <div class="row"><span>${esc(fmtTime(h.at))} <b>${esc(h.cmd)}</b></span><span class="neg">-${h.cost} 🟩</span></div>`).join('')
    : '<div class="empty">BELUM ADA RIWAYAT — PAKAI COMMAND DULU</div>'

  const toast = d.cost > 0 ? `
      <div class="toast">
        <div class="lbl">EMERALD TERPAKAI</div>
        <div class="big">-${d.cost} 🟩</div>
        <div class="cmdname">${esc(d.command)}</div>
        ${d.description ? `<div class="desc">${esc(d.description)}</div>` : ''}
        <div class="when">${esc(d.time)}</div>
      </div>` : `
      <div class="toast">
        <div class="lbl">SALDO EMERALD</div>
        <div class="big">🟩 ${d.emerald}</div>
        <div class="cmdname">/ ${d.max} EMERALD</div>
        <div class="when">${esc(d.time)}</div>
      </div>`

  return `
    ${toast}
    <div class="cell mb">
      <div class="k">SALDO — XP BAR EMERALD</div>
      <div class="v">${d.emerald} <span class="dim">/ ${d.max}</span></div>
      <div class="xp"><i style="width:${pct}%"></i></div>
      <div class="k mt">REGEN +${Number(config.emerald?.regen?.amount) || 10} TIAP ${Math.round((Number(config.emerald?.regen?.intervalMs) || 600000) / 60000)} MENIT</div>
    </div>

    <div class="sec">▸ RIWAYAT TERAKHIR</div>
    ${previewRows}
    <div class="hint">BUKA LENGKAP — TEKAN TOMBOL <b>RIWAYAT</b> DI BAWAH</div>

    ${sumberRows()}
    <div class="hint">OWNER / STAFF / PREMIUM BEBAS BIAYA • <b>.riwayat</b> &amp; <b>.balance</b> GRATIS</div>`
}

function viewUser(d) {
  const xpPct = d.char ? Math.min(100, Math.round((d.char.xp / (d.char.level * 100)) * 100)) : 0
  return `
    <div class="usr">
      <img class="avatar" src="${d.avatar}">
      <div class="uinfo">
        <div class="uname">${esc(d.userName)} ${roleBadge(d.userRole)}</div>
        ${d.premium ? '<div class="badge prem">DIAMOND MEMBER</div>' : ''}
        <div class="uphone">${esc(fmtPhone(d.userNumber))}</div>
        <div class="uchat">${d.isGroup ? 'DARI GRUP' : 'PRIVATE CHAT'}</div>
      </div>
    </div>

    <div class="grid2 mt">
      <div class="cell"><div class="k">🟩 EMERALD</div><div class="v green">${d.emerald} <span class="dim">/ ${d.max}</span></div></div>
      <div class="cell"><div class="k">💰 GOLD</div><div class="v gold">${d.gold}</div></div>
      <div class="cell"><div class="k">💎 GEMS</div><div class="v gem">${d.gems}</div></div>
      <div class="cell"><div class="k">⭐ XP</div><div class="v xp-v">${d.char ? d.char.xp : 0} <span class="dim">LV.${d.char ? d.char.level : 1}</span></div></div>
    </div>
    ${d.char ? `
    <div class="cell mt">
      <div class="k">PROGRESS LEVEL</div>
      <div class="xp"><i style="width:${xpPct}%"></i></div>
      <div class="k mt">${d.char.xp} / ${d.char.level * 100} XP</div>
    </div>` : ''}

    <div class="grid2 mt">
      <div class="cell"><div class="k">TOTAL COMMAND</div><div class="v">${d.commandCount}</div></div>
      <div class="cell"><div class="k">MEMBER SEJAK</div><div class="v sm">${esc(d.firstSeen)}</div></div>
    </div>

    <div class="cell mt">
      <div class="k">FAVORIT — PALING SERING DIPAKAI</div>
      <div class="v sm">${d.stats.favorite ? esc(d.stats.favorite) + ` (${d.stats.favoriteCount}x)` : '—'}</div>
    </div>

    ${d.history.length ? `
    <div class="sec">▸ RIWAYAT TERAKHIR</div>
    ${d.history.slice(0, 3).map((h) => `
      <div class="row"><span>${esc(fmtTime(h.at))} <b>${esc(h.cmd)}</b></span><span class="neg">-${h.cost} 🟩</span></div>`).join('')}
    <div class="hint">LENGKAP DI TOMBOL <b>RIWAYAT</b> BAWAH SINI</div>` : ''}`
}

function viewHistory(d) {
  const rows = d.history.length
    ? d.history.map((h) => `
      <div class="row"><span>${esc(fmtTime(h.at))} <b>${esc(h.cmd)}</b></span><span class="neg">-${h.cost} 🟩</span></div>`).join('')
    : '<div class="empty">BELUM ADA RIWAYAT — PAKAI COMMAND DULU</div>'

  return `
    <div class="grid3">
      <div class="cell"><div class="k">KELUAR HARI INI</div><div class="v green">${d.stats.todaySpent} 🟩</div><div class="k">${d.stats.todayCount}x PAKAI</div></div>
      <div class="cell"><div class="k">TOTAL KELUAR</div><div class="v green">${d.stats.totalSpent} 🟩</div><div class="k">${d.stats.totalCount}x PAKAI</div></div>
      <div class="cell"><div class="k">SALDO</div><div class="v green">${d.emerald}<span class="dim">/${d.max}</span></div><div class="k">SISA</div></div>
    </div>

    <div class="sec mt">▸ RIWAYAT PEMAKAIAN COMMAND</div>
    ${rows}
    <div class="hint">MAKS 15 ENTRI TERBARU • DATA TERSIMPAN 30 HARI</div>

    ${sumberRows()}

    <div class="sec mt">▸ COMMAND GRATIS (0 🟩)</div>
    <div class="row"><span><b>.menu</b> — daftar perintah</span><span class="pos">FREE</span></div>
    <div class="row"><span><b>.balance</b> / <b>.me</b> / <b>.ping</b></span><span class="pos">FREE</span></div>
    <div class="row"><span><b>.daily</b> / <b>.riwayat</b> / <b>.notife</b></span><span class="pos">FREE</span></div>
    <div class="row"><span><b>.status</b> — dashboard RPG</span><span class="pos">FREE</span></div>
    <div class="hint">OWNER / STAFF / PREMIUM BEBAS SEMUA COMMAND</div>`
}

/**
 * Build kartu HTML (frame 9:16, tema Minecraft, 3 view + tombol nav).
 * opts: { avatar, logo, defaultView: 'notif'|'history', ...data }
 */
export function buildEmeraldCard(opts) {
  const d = {
    emerald: 0, max: emeraldMax(),
    cost: 0, command: '', description: '', time: '',
    history: [], stats: {}, char: null, gold: 0, gems: 0,
    commandCount: 0, firstSeen: '-', userName: 'Pengguna',
    userNumber: '', userRole: '', isGroup: false, premium: false,
    avatar: '', logo: '', botName: config.botName || 'skyline-JXRA',
    tile: '', defaultView: 'notif',
    ...opts,
  }

  const defView = d.defaultView === 'history' ? 'history' : 'notif'
  const pct = Math.min(100, Math.round((d.emerald / d.max) * 100))

  const bg = d.tile
    ? `background-color:#14120d;background-image:linear-gradient(rgba(6,10,7,.82),rgba(6,10,7,.82)),url(${d.tile});background-size:auto,16px 16px`
    : `background-color:#14120d`

  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,viewport-fit=cover">
<title>Emerald — ${esc(d.botName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{min-height:100%}
body{font-family:ui-monospace,'Courier New',monospace;color:#e8f5e9;padding:8px;min-height:100vh;${bg}}
/* ── frame: tinggi NATURAL, tapi DIBATASI px (bukan vh/rasio
   yang bikin webview collapse jadi strip) — lebih dari itu → scroll ── */
.frame{width:100%;max-width:400px;margin:0 auto;max-height:660px;
  display:flex;flex-direction:column;position:relative;overflow:hidden;
  background-color:rgba(12,18,13,.95);border:3px solid #000;
  box-shadow:inset 3px 3px 0 rgba(255,255,255,.15),inset -3px -3px 0 rgba(0,0,0,.65),0 0 0 2px rgba(0,0,0,.8)}
/* ── header ── */
.hd{flex:none;display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:3px solid #000;
  background:linear-gradient(180deg,rgba(93,156,63,.28),rgba(0,0,0,.25));
  box-shadow:inset 0 -2px 0 rgba(255,255,255,.07)}
.logo{width:30px;height:30px;image-rendering:pixelated;object-fit:cover;border:2px solid #000;
  box-shadow:inset 2px 2px 0 rgba(255,255,255,.3)}
.t{font:bold 13px monospace;color:#3FD565;text-shadow:2px 2px 0 #000;letter-spacing:2px}
.ver{font-size:9px;color:#c7e6c2;text-shadow:1px 1px 0 #000;border:2px solid #000;background:rgba(0,0,0,.45);padding:2px 6px}
.pill{margin-left:auto;font-size:9px;font-weight:bold;color:#fff;text-shadow:1px 1px 0 #1d3a12;
  background:#5D9C3F;border:2px solid #000;padding:3px 7px;letter-spacing:1px;
  box-shadow:inset 1px 1px 0 rgba(255,255,255,.4),inset -1px -1px 0 rgba(0,0,0,.35)}
/* ── view area: min-height:0 WAJIB biar flex item boleh shrink → scroll ── */
.view{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:10px;display:none}
.view.on{display:block}
.sec{font:bold 10px monospace;color:#8fd6a0;letter-spacing:2px;text-shadow:1px 1px 0 #000;margin:10px 0 6px}
.hint{font-size:8px;color:#6f9279;letter-spacing:1px;text-align:center;margin-top:8px;text-shadow:1px 1px 0 #000}
.hint b{color:#3FD565}
.empty{font-size:9px;color:#7d9b86;text-align:center;padding:12px 8px;border:2px dashed #3a4d40;background:rgba(0,0,0,.35);letter-spacing:1px}
/* ── toast notif ── */
.toast{text-align:center;padding:14px 10px;margin-bottom:8px;background:rgba(0,0,0,.55);
  border:3px solid #000;box-shadow:inset 2px 2px 0 rgba(255,255,255,.12),inset -2px -2px 0 rgba(0,0,0,.5)}
.toast .lbl{font-size:9px;letter-spacing:3px;color:#9fd6ac;text-shadow:1px 1px 0 #000}
.toast .big{font:bold 34px monospace;color:#3FD565;text-shadow:3px 3px 0 #000;margin:5px 0 3px}
.toast .cmdname{font:bold 14px monospace;color:#fff;text-shadow:2px 2px 0 #000}
.toast .desc{font-size:9px;color:#a9c4b1;margin-top:3px}
.toast .when{font-size:9px;color:#6f9279;margin-top:5px;letter-spacing:1px}
/* ── cell / grid ── */
.cell{background:rgba(0,0,0,.45);border:2px solid #000;padding:8px 9px;
  box-shadow:inset 2px 2px 0 rgba(255,255,255,.09),inset -2px -2px 0 rgba(0,0,0,.45)}
.cell.mb{margin-bottom:8px}
.mt{margin-top:8px}
.k{font-size:8px;letter-spacing:1.6px;color:#8fb59a;text-shadow:1px 1px 0 #000}
.k.mt{margin-top:6px}
.v{font:bold 16px monospace;color:#fff;text-shadow:2px 2px 0 #000;margin-top:2px}
.v.green{color:#3FD565}
.v.gold{color:#FED84F}
.v.gem{color:#7ee7ff}
.v.xp-v{color:#80FF20}
.v.sm{font-size:12px}
.dim{color:#7d9b86;font-size:11px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
/* ── XP bar ── */
.xp{height:12px;background:#0b0b0b;border:2px solid #000;margin-top:6px;
  box-shadow:inset 0 2px 0 rgba(0,0,0,.9)}
.xp i{display:block;height:100%;background:linear-gradient(180deg,#9dff7a 0%,#3FD565 45%,#1fae4d 100%)}
/* ── baris riwayat ── */
.row{display:flex;justify-content:space-between;align-items:center;gap:6px;
  font-size:10px;padding:6px 7px;margin-bottom:4px;background:rgba(0,0,0,.4);border:2px solid #000;
  box-shadow:inset 1px 1px 0 rgba(255,255,255,.08);text-shadow:1px 1px 0 #000}
.row b{color:#c9f2d4}
.row .neg{color:#ff8a8a;font-weight:bold}
.row .pos{color:#3FD565;font-weight:bold}
/* ── profile user ── */
.usr{display:flex;gap:10px;align-items:center}
.avatar{width:66px;height:66px;image-rendering:pixelated;border:3px solid #000;
  box-shadow:inset 2px 2px 0 rgba(255,255,255,.3),0 0 0 2px #4a6b4e}
.uinfo{min-width:0}
.uname{font:bold 14px monospace;color:#fff;text-shadow:2px 2px 0 #000;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.uphone{font-size:10px;color:#a9c4b1;margin-top:4px;text-shadow:1px 1px 0 #000}
.uchat{font-size:8px;color:#6f9279;letter-spacing:1.4px;margin-top:2px}
.badge{font-size:8px;font-weight:bold;padding:2px 7px;letter-spacing:1px;border:2px solid #000;text-shadow:1px 1px 0 rgba(0,0,0,.6)}
.badge.owner{background:#FED84F;color:#3a2b00;box-shadow:inset 1px 1px 0 rgba(255,255,255,.6)}
.badge.admin{background:#5aa2e8;color:#04182e;box-shadow:inset 1px 1px 0 rgba(255,255,255,.5)}
.badge.staff{background:#c9d4c9;color:#1c241c;box-shadow:inset 1px 1px 0 rgba(255,255,255,.5)}
.badge.member{background:#4a5a4d;color:#d7e6da}
.badge.prem{background:#7ee7ff;color:#022a33;margin-top:4px;display:inline-block;
  box-shadow:inset 1px 1px 0 rgba(255,255,255,.6)}
/* ── tombol nav bergaya blocky ── */
.nav{flex:none;display:flex;gap:4px;padding:8px;border-top:3px solid #000;background:rgba(0,0,0,.4)}
.btn{flex:1;font:bold 9px monospace;letter-spacing:.6px;color:#fff;text-shadow:2px 2px 0 #3f3f3f;
  background:#8b8b8b;padding:9px 2px;border:0;cursor:pointer;
  box-shadow:inset 2px 2px 0 #c3c3c3,inset -2px -2px 0 #3f3f3f}
.btn.sbtn{flex:0 0 auto;min-width:28px;padding:9px 4px;letter-spacing:0}
.btn.on{background:#5D9C3F;text-shadow:2px 2px 0 #1d3a12;
  box-shadow:inset 2px 2px 0 #2f5c1f,inset -2px -2px 0 #17300d}
.btn:active{box-shadow:inset 2px 2px 0 #3f3f3f,inset -2px -2px 0 #c3c3c3}
/* ── footer ── */
.ft{flex:none;padding:5px 10px;font-size:8px;color:#5f7a68;letter-spacing:1.4px;text-align:center;
  border-top:2px solid #000;text-shadow:1px 1px 0 #000}
</style></head><body>
<div class="frame">
  <div class="hd">
    ${d.logo ? `<img class="logo" src="${d.logo}">` : '<div class="logo" style="background:#3FD565"></div>'}
    <div class="t">EMERALD</div>
    <div class="ver">v${esc(botVersion() || '1.0')}</div>
    <div class="pill">● LIVE</div>
  </div>

  <div class="view${defView === 'notif' ? ' on' : ''}" id="v_notif">${viewNotif(d)}</div>
  <div class="view${defView === 'user' ? ' on' : ''}" id="v_user">${viewUser(d)}</div>
  <div class="view${defView === 'history' ? ' on' : ''}" id="v_history">${viewHistory(d)}</div>

  <div class="nav">
    <button class="btn sbtn" title="Atas" onclick="sc(-1)">▲</button>
    <button class="btn${defView === 'user' ? ' on' : ''}" id="b_user" onclick="sv('user')">👤 INFO USER</button>
    <button class="btn${defView === 'history' ? ' on' : ''}" id="b_history" onclick="sv('history')">📜 RIWAYAT</button>
    <button class="btn${defView === 'notif' ? ' on' : ''}" id="b_notif" onclick="sv('notif')">🔔 NOTIF</button>
    <button class="btn sbtn" title="Bawah" onclick="sc(1)">▼</button>
  </div>

  <div class="ft">${esc(d.botName)} • SISTEM EMERALD 🟩 • ${pct}% PENUH</div>
</div>
<script>
var VL=['notif','user','history'];
function sv(n){
  for(var i=0;i<VL.length;i++){
    var v=document.getElementById('v_'+VL[i]);
    if(v) v.className='view'+(VL[i]===n?' on':'');
    var b=document.getElementById('b_'+VL[i]);
    if(b) b.className='btn'+(VL[i]===n?' on':'');
  }
  var cv=document.getElementById('v_'+n);
  if(cv) cv.scrollTop=0;
}
function sc(d){
  var v=document.querySelector('.view.on');
  if(!v) return;
  var t=Math.max(0, v.scrollTop + d*200);
  if(v.scrollTo){ try{ v.scrollTo({top:t,behavior:'smooth'}); return; }catch(e){} }
  v.scrollTop=t;
}
</script>
</body></html>`
}

/* ────────────────────── kirim kartu ────────────────────── */

/**
 * Kumpulkan data user + build + kirim — pola snake: KALAU GAGAL LEMPAR
 * error (pemanggil/plugin yang balas ke chat, jangan ditelan diam-diam).
 * Aset dekoratif di-race dgn timeout 8s (fallback kosong) — nunggu PP/tile
 * gak boleh nahan kartu terkirim tanpa jejak.
 */
async function sendEmeraldCard(ctx, { command = '', cost = 0, balance, description = '', defaultView = 'notif' }) {
  const jid = ctx.sender
  const [avatar, tile, logo] = await Promise.race([
    Promise.all([
      userAvatar(ctx.client, jid, ctx.pushName),
      dirtTile(),
      botLogo(),
    ]),
    new Promise((r) => setTimeout(() => r(['', '', '']), 8000))
  ])
  const bal = getBalance(jid)
  const emerald = Number.isFinite(balance) ? balance : bal.emerald
  const char = getCharacter(jid)
  const user = getUser(jid)
  const history = getEmeraldHistory(jid, 15)
  const stats = emeraldStats(jid)

  const html = buildEmeraldCard({
    avatar, tile, logo, defaultView,
    emerald, max: emeraldMax(),
    cost, command, description,
    time: new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short'
    }),
    history, stats, char,
    gold: bal.gold, gems: bal.gems,
    commandCount: user?.command_count ?? 0,
    firstSeen: user?.first_seen ? fmtDate(user.first_seen) : '-',
    userName: ctx.pushName || 'Pengguna',
    userNumber: ctx.senderNumber,
    userRole: ctx.role,
    isGroup: ctx.isGroup,
    premium: isPremiumActive(jid),
    botName: config.botName || 'skyline-JXRA',
  })

  await sendNativeHtml(ctx.client, ctx.chat, html)
}

/** Notif pemakaian (dipanggil route() setelah fitur sukses). */
export function sendUsageCard(ctx, meta) {
  return sendEmeraldCard(ctx, { ...meta, defaultView: 'notif' })
}

/** Kartu riwayat (command .riwayat). */
export function sendHistoryCard(ctx) {
  return sendEmeraldCard(ctx, { defaultView: 'history' })
}
