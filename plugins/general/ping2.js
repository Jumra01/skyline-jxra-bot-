/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ping2.js — Cek latensi + resource, tampilan DASHBOARD HTML web-style
 * (render native di WA lewat richResponseMessage/unifiedResponse — pola sama
 * dengan plugins/game/snake.js). Tema chrome: putih/silver/biru/hitam +
 * kartu profile user yang menjalankan command.
 */
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import crypto from 'node:crypto'
import config from '../../config.js'

const execFileAsync = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmtUptime(seconds) {
  const s = Math.floor(Number(seconds) || 0)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts = []
  if (d) parts.push(`${d}h`)
  if (h) parts.push(`${h}j`)
  if (m) parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join(' ')
}

function fmtBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Number(bytes) || 0
  let i = 0
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtPhone(num) {
  const d = String(num || '').replace(/\D/g, '')
  if (!d) return '-'
  return `+${d}`
}

function barColor(p) {
  if (p >= 90) return 'linear-gradient(90deg,#ff5c7a,#ff8fa3)'
  if (p >= 75) return 'linear-gradient(90deg,#ffb84d,#ffd28a)'
  return 'linear-gradient(90deg,#3b82f6,#9fd0ff)'
}

async function getCpuUsage() {
  try {
    const snap = async () => {
      const line = (await readFile('/proc/stat', 'utf8')).split('\n').find((l) => /^cpu\s/.test(l))
      const v = line.trim().split(/\s+/).slice(1).map(Number)
      return { idle: v[3] + v[4], total: v.reduce((a, b) => a + b, 0) }
    }
    const a = await snap()
    await sleep(800)
    const b = await snap()
    const idle = b.idle - a.idle
    const total = b.total - a.total
    if (total <= 0) return null
    return Math.min(100, Math.max(0, ((total - idle) / total) * 100))
  } catch { return null }
}

async function getDisk() {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', '/'], { timeout: 5000, maxBuffer: 1024 * 1024 })
    const data = stdout.trim().split('\n').at(-1).trim().split(/\s+/)
    const total = Number(data[1]) * 1024
    const used = Number(data[2]) * 1024
    const percent = Number.parseFloat(data[4])
    return { total, used, percent }
  } catch { return null }
}

async function toJpegDataUri(buf, size, quality = 70) {
  const sharp = (await import('sharp')).default
  const out = await sharp(buf).rotate().resize(size, size, { fit: 'cover' }).jpeg({ quality }).toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

/** Avatar fallback: gradient biru-silver + inisial nama (canvas). */
async function initialsAvatar(name) {
  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    const size = 192
    const canvas = createCanvas(size, size)
    const g = canvas.getContext('2d')
    const grad = g.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, '#1e3a8a')
    grad.addColorStop(0.5, '#3b82f6')
    grad.addColorStop(1, '#c8d3e8')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    g.fillStyle = 'rgba(255,255,255,0.14)'
    g.beginPath()
    g.arc(size * 0.8, size * 0.2, size * 0.5, 0, 7)
    g.fill()
    const initial = (String(name || '?').trim()[0] || '?').toUpperCase()
    g.fillStyle = '#ffffff'
    g.font = 'bold 96px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(initial, size / 2, size / 2 + 6)
    const buf = canvas.toBuffer('image/png')
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch { return '' }
}

/** Foto profil user (PP WA) → data URI; gagal → avatar inisial. */
async function userAvatar(client, jid, name) {
  try {
    const pic = await client?.profile?.getProfilePicture?.(jid)
    if (pic?.url) {
      const res = await fetch(pic.url, { signal: AbortSignal.timeout(5000), redirect: 'follow' })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length) return await toJpegDataUri(buf, 192)
      }
    }
  } catch {}
  return initialsAvatar(name)
}

/** Logo bot dari aset thumb global (cta-thumb) → data URI kecil. */
async function botLogo() {
  try {
    const p = path.join(process.cwd(), 'assets', 'thumb', 'cta-thumb.jpg')
    if (fs.existsSync(p)) return await toJpegDataUri(fs.readFileSync(p), 96, 75)
  } catch {}
  return ''
}

function statCard(label, icon, value, sub, pct, big) {
  const bar = pct === undefined || pct === null
    ? ''
    : `<div class="bar"><i style="width:${Math.min(100, Math.max(0, pct))}%;background:${barColor(pct)}"></i></div>`
  return `<div class="card${big ? ' wide' : ''}">
    <div class="lb"><span class="ic">${icon}</span>${esc(label)}</div>
    <div class="val${big ? ' big' : ''}">${esc(value)}</div>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
    ${bar}
  </div>`
}

function roleBadge(role) {
  if (role === 'owner') return `<span class="badge owner">👑 OWNER</span>`
  if (role === 'admin') return `<span class="badge admin">🛡 ADMIN</span>`
  if (role) return `<span class="badge staff">⭐ STAFF</span>`
  return `<span class="badge member">MEMBER</span>`
}

function buildHtml(s) {
  const ramPct = s.totalMem ? (s.usedMem / s.totalMem) * 100 : 0
  const loadPct = Math.min(100, (s.load[0] / s.cpuCount) * 100)
  const latencyPct = Math.min(100, s.latency / 30)

  return `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{margin:0;padding:0;box-sizing:border-box}
html{background-color:#070b16}
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#eef3ff;padding:14px;position:relative;
  background-color:#070b16;
  background-image:
    radial-gradient(560px 300px at 18% -40px,rgba(59,130,246,.38),rgba(59,130,246,0) 70%),
    radial-gradient(520px 300px at 90% 105%,rgba(200,211,232,.22),rgba(200,211,232,0) 70%),
    radial-gradient(380px 260px at 105% 40%,rgba(96,165,250,.16),rgba(96,165,250,0) 70%),
    radial-gradient(340px 260px at -10% 70%,rgba(148,163,184,.14),rgba(148,163,184,0) 70%),
    linear-gradient(180deg,#0a1122 0%,#0b1428 45%,#070b16 100%)}
/* ── layer dekorasi (CSS aman utk renderer native WA: gradien doang, tanpa blur/mask/fixed) ── */
.bgfx{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:0;
  background-image:
    linear-gradient(rgba(59,130,246,.07) 1px,rgba(59,130,246,0) 1px),
    linear-gradient(90deg,rgba(59,130,246,.07) 1px,rgba(59,130,246,0) 1px),
    radial-gradient(rgba(148,163,184,.16) 1.2px,rgba(148,163,184,0) 1.6px);
  background-size:52px 52px,52px 52px,20px 20px;
  background-position:0 0,0 0,0 0}
.sheen{position:absolute;top:0;left:0;right:0;height:190px;
  background:
    linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(200,211,232,.16) 48%,rgba(255,255,255,.22) 52%,rgba(59,130,246,.14) 60%,rgba(59,130,246,0) 75%),
    radial-gradient(420px 150px at 50% 0,rgba(59,130,246,.30),rgba(59,130,246,0) 75%)}
.band{position:absolute;top:0;left:0;right:0;height:300px;
  background:linear-gradient(180deg,rgba(59,130,246,.10),rgba(59,130,246,0));
  border-bottom:1px solid rgba(148,163,184,.12)}
.vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(ellipse 110% 95% at 50% 40%,rgba(0,0,0,0) 52%,rgba(0,0,0,.65) 100%)}
.stars i{position:absolute;width:4px;height:4px;border-radius:50%;background:#9fd0ff;
  box-shadow:0 0 8px 2px rgba(59,130,246,.8)}
.stars i:nth-child(1){top:60px;left:10%;background:#7fb0ff}
.stars i:nth-child(2){top:130px;right:8%;width:3px;height:3px;background:#c8d3e8;box-shadow:0 0 7px 2px rgba(200,211,232,.7)}
.stars i:nth-child(3){top:340px;left:5%;width:3px;height:3px;background:#9fd0ff}
.stars i:nth-child(4){bottom:160px;right:14%;background:#7fb0ff;box-shadow:0 0 7px 2px rgba(59,130,246,.7)}
.stars i:nth-child(5){bottom:60px;left:22%;width:3px;height:3px;background:#c8d3e8;box-shadow:0 0 6px 2px rgba(200,211,232,.6)}
/* ── konten ── */
.wrap{position:relative;z-index:1}
.chrome{height:3px;border-radius:99px;margin-bottom:12px;
  background:linear-gradient(90deg,#3b82f6,#c8d3e8 45%,#ffffff 55%,#93a4c7 70%,#3b82f6);
  box-shadow:0 0 12px rgba(59,130,246,.55)}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.logo{width:38px;height:38px;border-radius:11px;object-fit:cover;border:1.5px solid rgba(200,211,232,.45);
  box-shadow:0 0 16px rgba(59,130,246,.35)}
.t1{font-size:16px;font-weight:800;letter-spacing:1.2px;
  background:linear-gradient(90deg,#ffffff,#b9c6e8 60%,#7fb0ff);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 0 24px rgba(59,130,246,.25)}
.ver{font-size:10px;font-weight:700;color:#0a1122;background:linear-gradient(135deg,#e7edf9,#a8b6d8);
  padding:2px 8px;border-radius:99px;box-shadow:0 1px 0 #fff inset}
.pill{margin-left:auto;font-size:10px;font-weight:800;color:#9fd0ff;border:1px solid rgba(59,130,246,.5);
  background:rgba(59,130,246,.12);padding:4px 10px;border-radius:99px;letter-spacing:1px;
  box-shadow:0 0 14px rgba(59,130,246,.35)}
.prof{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;margin-bottom:12px;
  background:linear-gradient(135deg,rgba(22,32,58,.96),rgba(16,34,64,.97) 55%,rgba(20,28,50,.96));
  border:1px solid rgba(148,163,184,.32);
  box-shadow:0 8px 28px rgba(0,0,0,.45),0 1px 0 rgba(255,255,255,.14) inset,0 0 24px rgba(59,130,246,.10)}
.av{width:56px;height:56px;border-radius:50%;object-fit:cover;padding:2px;background:linear-gradient(135deg,#3b82f6,#c8d3e8);
  box-shadow:0 0 16px rgba(59,130,246,.5)}
.pinfo{flex:1;min-width:0}
.pname{font-size:15px;font-weight:800;color:#fff;display:flex;align-items:center;gap:6px}
.pnum{font-size:11px;color:#a9b8d8;margin-top:2px;font-family:ui-monospace,monospace}
.badge{font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;letter-spacing:.8px}
.badge.owner{color:#1a1206;background:linear-gradient(135deg,#ffd76e,#e0a53a)}
.badge.admin{color:#041026;background:linear-gradient(135deg,#8ec5ff,#3b82f6)}
.badge.staff{color:#0a1122;background:linear-gradient(135deg,#e7edf9,#a8b6d8)}
.badge.member{color:#dfe8fb;background:rgba(148,163,184,.25);border:1px solid rgba(148,163,184,.4)}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.card{background:linear-gradient(160deg,rgba(24,34,60,.97),rgba(11,17,34,.98));
  border:1px solid rgba(148,163,184,.24);border-radius:12px;padding:10px 12px;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 6px 18px rgba(0,0,0,.35)}
.card.wide{grid-column:1/-1}
.lb{font-size:9px;letter-spacing:1.6px;color:#8fa3cc;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:5px}
.ic{font-size:11px}
.val{font-size:14px;font-weight:800;color:#f4f8ff}
.val.big{font-size:30px;line-height:1.15;
  background:linear-gradient(90deg,#ffffff,#9fd0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{font-size:10px;color:#8fa3cc;margin-top:2px}
.bar{height:5px;background:#131c36;border-radius:99px;margin-top:8px;overflow:hidden;
  box-shadow:0 0 0 1px rgba(148,163,184,.15) inset}
.bar i{display:block;height:100%;border-radius:99px}
.ft{margin-top:12px;font-size:10px;color:#61739c;text-align:center;line-height:1.6;
  text-shadow:0 0 12px rgba(59,130,246,.2)}
.ft b{color:#9fd0ff}
</style></head><body>
<div class="bgfx">
  <div class="band"></div>
  <div class="sheen"></div>
  <div class="stars"><i></i><i></i><i></i><i></i><i></i></div>
  <div class="vig"></div>
</div>
<div class="wrap">
<div class="chrome"></div>
<div class="hd">
  ${s.logo ? `<img class="logo" src="${s.logo}">` : '<div class="logo"></div>'}
  <div class="t1">${esc(s.botName)} STATUS</div>
  <div class="ver">v${esc(s.version || '1.0')}</div>
  <div class="pill">● ONLINE</div>
</div>
<div class="prof">
  <img class="av" src="${s.userAvatar}">
  <div class="pinfo">
    <div class="pname">${esc(s.userName)} ${roleBadge(s.userRole)}</div>
    <div class="pnum">${esc(fmtPhone(s.userNumber))} • ${esc(s.isGroup ? 'dari grup' : 'private chat')}</div>
  </div>
</div>
<div class="g">
  ${statCard('Latensi', '⚡', `${s.latency} ms`, 'respons server', latencyPct, true)}
  ${statCard('Runtime Bot', '⏱', s.botUptime, 'sejak start')}
  ${statCard('Uptime VPS', '🖥', s.vpsUptime, 'sejak boot')}
  ${statCard('Memori Bot', '🧠', s.memRss, 'RSS proses node')}
  ${statCard('RAM VPS', '💾', `${fmtBytes(s.usedMem)} / ${fmtBytes(s.totalMem)}`, null, ramPct)}
  ${statCard('CPU VPS', '🧮', s.cpu === null ? '—' : `${s.cpu.toFixed(1)}%`, `${s.cpuCount} core • load ${s.load[0].toFixed(2)}`, s.cpu ?? loadPct)}
  ${statCard('Load Average', '📈', s.load.map((v) => v.toFixed(2)).join(' · '), `${(s.load[0] / s.cpuCount).toFixed(2)} per core`, loadPct)}
  ${statCard('Disk', '📦', s.disk ? `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}` : '—', null, s.disk?.percent)}
  ${statCard('Platform', '🧩', `${s.node} • ${s.platform}`, null)}
  ${statCard('Jam Server', '🕒', s.time, 'WIB')}
</div>
<div class="ft">⚡ <b>ping v2</b> • dashboard HTML native • ${esc(s.botName)} • request oleh <b>${esc(s.userName)}</b></div>
</div>
</body></html>`
}

/** Kirim HTML via richResponseMessage/unifiedResponse (pola plugins/game/snake.js). */
async function sendHtml(client, chat, html) {
  await client.message.send(chat, {
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
}

const pluginConfig = {
  name: "ping2",
  alias: ['pingv2', 'pong2'],
  category: "general",
  description: "Cek latensi + resource — dashboard HTML web-style + profile user",
  usage: ".ping2",
  example: ".ping2",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
  energi: 0,
};

async function handler(ctx) {
    const latency = Date.now() - (ctx.receivedAt ?? Date.now())
    const [cpu, disk, avatar, logo] = await Promise.all([
      getCpuUsage(),
      getDisk(),
      userAvatar(ctx.client, ctx.sender, ctx.pushName),
      botLogo()
    ])
    const totalMem = os.totalmem()
    const usedMem = totalMem - os.freemem()
    const memRss = fmtBytes(process.memoryUsage().rss)

    const html = buildHtml({
      botName: config.botName,
      version: (() => { try { return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version } catch { return '' } })(),
      logo,
      userAvatar: avatar || (await initialsAvatar(ctx.pushName)),
      userName: ctx.pushName || 'Pengguna',
      userNumber: ctx.senderNumber,
      userRole: ctx.role,
      isGroup: ctx.isGroup,
      latency,
      botUptime: fmtUptime(process.uptime()),
      vpsUptime: fmtUptime(os.uptime()),
      memRss,
      usedMem,
      totalMem,
      cpu,
      cpuCount: os.cpus().length || 1,
      load: os.loadavg(),
      disk,
      node: process.version,
      platform: `${os.platform()}/${os.arch()}`,
      time: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'medium' })
    })

    await sendHtml(ctx.client, ctx.chat, html)
    await ctx.react('⚡')
  }

export { pluginConfig as config, handler };
