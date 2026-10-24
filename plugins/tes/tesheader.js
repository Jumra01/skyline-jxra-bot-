/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tesheader.js — Lab tes tampilan HEADER bot (`.tesheader`) — khusus owner.
 *
 * ─────────────────────── Kenapa file ini ada ───────────────────────
 * Mau nyobain "header" (banner tampilan atas) bot di HP tanpa ngoprek
 * fitur asli. Tiap varian dikirim berurutan dengan penanda + ringkasan
 * akhir, jadi kelihatan langsung di device mana yang paling cocok.
 * Desain varian diadaptasi dari pola yang sudah beredar & dimodifikasi di
 * komunitas GitHub (zaileys, wesker-bot, malvin-btns, dll) lalu DITERJEMAHAN
 * ke jalur zapo-js repo ini:
 *   • interactive header (gambar/video) → `richButtons`/`richList`
 *     (`lib/richMessage.js`) + upload `client.message.upload` — pola
 *     `uploadHeaderMedia` milik `.menu` (plugins/general/menu.js).
 *   • banner teks        → pesan teks polos `{ noStyle: true }` (jangan
 *     lewat reply style — kartu CTA-nya malah nutupin banner, lihat §7).
 *   • banner kartu HTML  → `sendNativeHtml()` (`lib/emeraldCard.js`),
 *     aturan §9 (full document, data-URI, tanpa CSS terlarang).
 *
 * ─────────────────────── Cara nambah varian baru ───────────────────────
 * Tambah SATU entri di array VARIANTS:
 *
 *   { id: 'namavarian', label: 'Nama', note: 'keterangan singkat',
 *     build: async (ctx) => {} }
 *
 * ID unik (dipakai sebagai argumen `.tesheader namavarian`), urutan kirim =
 * urutan array. `build()` boleh async & gagal sendiri — error per varian
 * dicatat di ringkasan tanpa mematikan varian lain.
 *
 * ─────────────────────── Pemakaian ───────────────────────
 *   .tesheader          → semua varian berurutan + ringkasan
 *   .tesheader foto     → satu varian saja
 *   .tesheader list,html → varian pilihan (koma)
 *
 * Sumber gambar: `assets/thumb/` (menu.* diprioritaskan, file terbaru menang).
 * Varian `video` butuh ffmpeg (dibuat clip mp4 4 dtk dari thumb; kalau
 * ffmpeg gak ada / gagal → otomatis fallback ke varian foto + catatan).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import config from '../../config.js'
import { sendNativeHtml } from '../../lib/emeraldCard.js'

const run = promisify(execFile)
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const THUMB_DIR = path.join(ROOT, 'assets', 'thumb')

const pluginConfig = {
  name: 'tesheader',
  alias: ['teshd', 'headertes'],
  category: 'tools',
  description: 'Lab tes tampilan header/banner bot (gambar, video, teks, kartu HTML)',
  usage: '.tesheader [varian]',
  example: '.tesheader foto',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 10,
  limit: 0,
  isEnabled: true,
  energi: 0,
}

/* ─────────────────────── util header media ─────────────────────── */

/** Field media wajib hasil `client.message.upload` → descriptor proto. */
function baseMediaFields(media) {
  return {
    url: media.url,
    directPath: media.directPath,
    mediaKey: media.mediaKey,
    fileSha256: media.fileSha256,
    fileEncSha256: media.fileEncSha256,
    fileLength: media.fileLength,
    mediaKeyTimestamp: media.mediaKeyTimestamp
  }
}

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const VID_EXTS = ['.mp4', '.mov', '.webm']
const GIF_EXT = '.gif'

/** Cari file thumb (menu.* diprioritaskan; foto/video/gif, terbaru menang). */
function findThumb(kind = 'image') {
  let files
  try { files = fs.readdirSync(THUMB_DIR) } catch { return null }
  const exts = kind === 'video' ? [...VID_EXTS, GIF_EXT] : IMG_EXTS
  const pool = files
    .filter((f) => exts.includes(path.extname(f).toLowerCase()))
    .map((f) => {
      const p = path.join(THUMB_DIR, f)
      let st
      try { st = fs.statSync(p) } catch { return null }
      return { p, mtime: st.mtimeMs, menu: path.basename(f).startsWith('menu') ? 1 : 0 }
    })
    .filter(Boolean)
    .sort((a, b) => b.menu - a.menu || b.mtime - a.mtime)
  return pool[0]?.p ?? null
}

/** Upload buffer gambar → descriptor header `imageMessage`. */
async function uploadImageHeader(client, buf) {
  const sharp = (await import('sharp')).default
  const jpg = await sharp(buf)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  const meta = await sharp(jpg).metadata()
  const media = await client.message.upload(jpg, { type: 'image', mimetype: 'image/jpeg' })
  return {
    kind: 'imageMessage',
    ...baseMediaFields(media),
    mimetype: 'image/jpeg',
    width: meta.width ?? 1024,
    height: meta.height ?? 1024
  }
}

/** Upload video/gif → descriptor header `videoMessage` (gifPlayback utk gif). */
async function uploadVideoHeader(client, file, { seconds = 4, width = 1280, height = 720 } = {}) {
  const ext = path.extname(file).toLowerCase()
  const isGif = ext === GIF_EXT
  const buf = fs.readFileSync(file)
  const mimetype = isGif ? 'image/gif' : ext === '.webm' ? 'video/webm' : 'video/mp4'
  const media = await client.message.upload(buf, { type: isGif ? 'gif' : 'video', mimetype })
  return {
    kind: 'videoMessage',
    ...baseMediaFields(media),
    mimetype,
    width,
    height,
    seconds,
    ...(isGif ? { gifPlayback: true } : {})
  }
}

/** Generate clip mp4 pendek dari gambar (ffmpeg loop + fade) — header video. */
async function makeHeaderClip(imgPath) {
  await run('ffmpeg', ['-version']) // cek keberadaan ffmpeg dulu (cepat)
  const out = path.join(os.tmpdir(), `tesheader-${process.pid}-${crypto.randomBytes(4).toString('hex')}.mp4`)
  await run('ffmpeg', [
    '-y', '-loop', '1', '-i', imgPath, '-t', '4',
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,' +
    'fade=t=in:st=0:d=0.6,fade=t=out:st=3.4:d=0.6,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
    '-movflags', '+faststart', out
  ])
  return out
}

/** Cek ffmpeg tersedia (untuk ringkasan). */
async function hasFfmpeg() {
  try { await run('ffmpeg', ['-version']); return true } catch { return false }
}

/* ─────────────────────── varian banner teks ─────────────────────── */

/**
 * Lebar display teks utk banner: emoji astral (😀) & CJK = 2 kolom,
 * variation selector (U+FE0F) dihitung 0 — biar garis box gak miring.
 */
function displayWidth(s) {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (cp === 0xfe0f || cp === 0x200d) continue // VS16 / ZWJ — nol lebar
    w += (cp >= 0x1100 && (
      cp <= 0x115f || // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || // CJK
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat
      (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compat forms
      (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f000 && cp <= 0x1ffff) // emoji plane
    )) ? 2 : 1
  }
  return w
}

/** Pad teks sesuai lebar display (emoji = 2 kolom) — garis box tetap lurus. */
function padEndW(s, len) {
  return s + ' '.repeat(Math.max(0, len - displayWidth(s)))
}

/** Banner box-art teks polos — ala header bot komunitas. */
function buildTextBanner() {
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const inner = 27
  const line = (s) => '┃ ' + padEndW(s, inner) + '┃'
  return [
    '┏' + '━'.repeat(inner + 2) + '┓',
    line(`🛰️  ${config.botName.toUpperCase()}`),
    line('WhatsApp Bot • zapo-js'),
    '┣' + '━'.repeat(inner + 2) + '┫',
    line(`• Prefix : ${config.mainPrefix ?? config.prefixes?.[0] ?? '.'}`),
    line(`• Waktu  : ${now} WIB`),
    line('• Mode   : online ✓'),
    '┗' + '━'.repeat(inner + 2) + '┛',
    '',
    'Banner teks (varian `teks`) — murah, selalu tampil, gak butuh upload.'
  ].join('\n')
}

/* ─────────────────────── varian banner kartu HTML ─────────────────────── */

/** Thumb kecil jadi data-URI buat kartu HTML (budget §9.2: avatar ≤112px). */
async function thumbDataUri(file, size = 96) {
  try {
    const sharp = (await import('sharp')).default
    const buf = await sharp(file).rotate().resize({ width: size, height: size, fit: 'cover' })
      .jpeg({ quality: 60 }).toBuffer()
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch { return '' }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/** Kartu HTML native berisi banner gaya aplikasi (login screen vibes). */
async function buildBannerCardHtml() {
  const thumb = findThumb('image')
  const logo = thumb ? await thumbDataUri(thumb, 96) : ''
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Banner</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#0b1020; }
  body { min-height:100vh; font-family:-apple-system,'Segoe UI',Roboto,sans-serif; color:#e8ecff;
         display:flex; align-items:center; justify-content:center; padding:18px; }
  .card { width:100%; max-width:420px; background:#131a33; border-radius:22px; overflow:hidden;
          border:1px solid rgba(255,255,255,.08); }
  .banner { position:relative; padding:34px 22px 26px;
            background:radial-gradient(120% 140% at 15% 0%, #2b47c9 0%, #16215a 48%, #0e1433 100%); }
  .banner::after { content:''; position:absolute; inset:0;
            background:radial-gradient(60% 80% at 90% 10%, rgba(99,179,255,.28) 0%, transparent 60%); }
  .row { display:flex; align-items:center; gap:14px; position:relative; z-index:1; }
  .logo { width:72px; height:72px; border-radius:18px; border:2px solid rgba(255,255,255,.25);
          object-fit:cover; background:#0e1433; }
  h1 { font-size:23px; letter-spacing:1.5px; font-weight:800; }
  .sub { font-size:12.5px; color:#a9b6ff; margin-top:3px; letter-spacing:.4px; }
  .pills { display:flex; gap:8px; padding:16px 18px; flex-wrap:wrap; position:relative; z-index:1; }
  .pill { flex:1; min-width:96px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.09);
          border-radius:13px; padding:10px 12px; }
  .k { font-size:10px; color:#8fa0d8; text-transform:uppercase; letter-spacing:1px; }
  .v { font-size:15px; font-weight:700; margin-top:3px; }
  .ok { color:#5ef2a0; }
  .note { padding:0 18px 16px; font-size:11.5px; color:#7d8bc4; position:relative; z-index:1; }
</style>
</head>
<body>
  <div class="card">
    <div class="banner">
      <div class="row">
        ${logo ? `<img class="logo" src="${logo}" alt="">` : '<div class="logo"></div>'}
        <div>
          <h1>${escHtml(config.botName.toUpperCase())}</h1>
          <div class="sub">WhatsApp Bot • zapo-js • skyline-JXRA</div>
        </div>
      </div>
    </div>
    <div class="pills">
      <div class="pill"><div class="k">Status</div><div class="v ok">Online ✓</div></div>
      <div class="pill"><div class="k">Prefix</div><div class="v">${escHtml(config.mainPrefix ?? '.')}</div></div>
      <div class="pill"><div class="k">Waktu</div><div class="v">${escHtml(now)}</div></div>
    </div>
    <div class="note">Kartu HTML native (varian <b>html</b>) — banner gaya aplikasi, dirender webview WA.</div>
  </div>
</body>
</html>`
}

/* ─────────────────────── varian profil Instagram ─────────────────────── */

/**
 * Mockup profil Instagram modern (dark mode), dibuat sebagai kartu HTML native.
 * Data-URI gambar hanya di-embed 1x (avatar + 1 thumb grid), tile lainnya
 * memakai styling CSS gradien agar payload tetap ramping (~10KB <= budget 26KB).
 */
async function buildInstagramHtml() {
  const thumb = findThumb('image')
  const avatar = thumb ? await thumbDataUri(thumb, 72) : ''
  const postImg = thumb ? await thumbDataUri(thumb, 140) : ''
  const name = config.botName || 'skyline-JXRA'
  const handle = name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'skyline_bot'
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Instagram Profile</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  html, body { background:#000000; color:#f5f5f5; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;
         min-height:100vh; display:flex; justify-content:center; padding:12px 8px; }
  .ig { width:100%; max-width:400px; background:#000000; border-radius:18px;
        border:1px solid #262626; overflow:hidden; }
  .top { display:flex; align-items:center; justify-content:space-between;
         padding:12px 16px; border-bottom:1px solid #1a1a1a; }
  .user-badge { display:flex; align-items:center; gap:6px; font-weight:700; font-size:15px; }
  .verified { color:#0095f6; font-size:14px; }
  .dots { color:#a8a8a8; font-size:18px; letter-spacing:2px; }
  .profile { padding:14px 16px 12px; }
  .head { display:flex; align-items:center; gap:20px; }
  .story-ring { width:74px; height:74px; border-radius:50%; padding:2.5px; flex-shrink:0;
                background:linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%); }
  .avatar-wrap { width:100%; height:100%; border-radius:50%; background:#000; padding:2px; }
  .avatar { width:100%; height:100%; border-radius:50%; object-fit:cover; display:block; }
  .stats { display:flex; flex:1; justify-content:space-around; text-align:center; }
  .num { font-weight:700; font-size:16px; }
  .lbl { font-size:12px; color:#a8a8a8; margin-top:2px; }
  .bio { margin-top:12px; font-size:13px; line-height:1.45; }
  .bio-name { font-weight:700; font-size:13.5px; }
  .bio-cat { color:#8e8e8e; font-size:12px; margin:2px 0 4px; }
  .bio-link { color:#e0f1ff; text-decoration:none; display:inline-flex; align-items:center; gap:3px; }
  .actions { display:flex; gap:6px; margin-top:12px; }
  .btn { flex:1; text-align:center; padding:7px 0; font-size:13px; font-weight:600;
         border-radius:8px; cursor:pointer; }
  .btn-primary { background:#0095f6; color:#fff; }
  .btn-sec { background:#262626; color:#f5f5f5; }
  .highlights { display:flex; gap:12px; padding:12px 16px; overflow-x:auto; }
  .hl-item { text-align:center; flex-shrink:0; width:56px; }
  .hl-ring { width:52px; height:52px; border-radius:50%; border:1px solid #363636;
             margin:0 auto 4px; display:flex; align-items:center; justify-content:center;
             background:#121212; font-size:20px; }
  .hl-label { font-size:11px; color:#f5f5f5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tabs { display:flex; border-top:1px solid #262626; }
  .tab { flex:1; text-align:center; padding:10px 0; color:#8e8e8e; font-size:16px; }
  .tab.active { color:#f5f5f5; border-bottom:2px solid #f5f5f5; }
  .grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:2px; }
  .tile { height:120px; background:#121212; position:relative; overflow:hidden;
          display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .tile img { width:100%; height:100%; object-fit:cover; display:block; }
  .badge-pin { position:absolute; top:6px; right:6px; font-size:11px; }
  .badge-reel { position:absolute; bottom:6px; left:6px; font-size:10px; color:#fff;
                display:flex; align-items:center; gap:3px; font-weight:600;
                text-shadow:0 1px 3px rgba(0,0,0,.8); }
  .tile-gradient { background:linear-gradient(135deg,#1f2937,#111827); text-align:center; padding:8px; }
  .t-title { font-size:12px; font-weight:700; color:#60a5fa; }
  .t-sub { font-size:10px; color:#9ca3af; margin-top:2px; }
  .tile-em { background:radial-gradient(circle at 50% 40%,#064e3b,#022c22); text-align:center; }
  .em-val { font-size:13px; font-weight:800; color:#34d399; }
  .em-sub { font-size:9.5px; color:#a7f3d0; letter-spacing:1px; margin-top:2px; }
  .footer-note { padding:10px 16px 14px; text-align:center; font-size:10.5px; color:#737373; }
</style>
</head>
<body>
  <div class="ig">
    <div class="top">
      <div class="user-badge">
        <span>${escHtml(handle)}</span>
        <span class="verified">●</span>
      </div>
      <div class="dots">•••</div>
    </div>

    <div class="profile">
      <div class="head">
        <div class="story-ring">
          <div class="avatar-wrap">
            ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : '<div class="avatar" style="background:#262626"></div>'}
          </div>
        </div>
        <div class="stats">
          <div><div class="num">126</div><div class="lbl">Posts</div></div>
          <div><div class="num">2.4K</div><div class="lbl">Users</div></div>
          <div><div class="num">1</div><div class="lbl">Owner</div></div>
        </div>
      </div>

      <div class="bio">
        <div class="bio-name">${escHtml(name)}</div>
        <div class="bio-cat">Bot WhatsApp • zapo-js • Multi-Device</div>
        <div>🤖 24/7 Online • Fast Response</div>
        <div>🟩 Sistem Emerald &amp; RPG Aktif</div>
        <div><span class="bio-link">🔗 skyline.web.id</span></div>
      </div>

      <div class="actions">
        <div class="btn btn-primary">Ikuti</div>
        <div class="btn btn-sec">Kirim Pesan</div>
        <div class="btn btn-sec">Menu (.menu)</div>
      </div>
    </div>

    <div class="highlights">
      <div class="hl-item"><div class="hl-ring">📜</div><div class="hl-label">Menu</div></div>
      <div class="hl-item"><div class="hl-ring">💎</div><div class="hl-label">Emerald</div></div>
      <div class="hl-item"><div class="hl-ring">⚡</div><div class="hl-label">Speed</div></div>
      <div class="hl-item"><div class="hl-ring">👑</div><div class="hl-label">Owner</div></div>
    </div>

    <div class="tabs">
      <div class="tab active">▦</div>
      <div class="tab">▣</div>
      <div class="tab">🏷️</div>
    </div>

    <div class="grid">
      <div class="tile">
        ${postImg ? `<img src="${postImg}" alt="">` : ''}
        <span class="badge-pin">📌</span>
      </div>
      <div class="tile tile-gradient">
        <div class="t-title">skyline-JXRA</div>
        <div class="t-sub">v2.0 • zapo-js</div>
        <div class="badge-reel">▶ 18.5K</div>
      </div>
      <div class="tile tile-em">
        <div class="em-val">🟩 100%</div>
        <div class="em-sub">EMERALD</div>
      </div>
      <div class="tile tile-gradient" style="background:linear-gradient(135deg,#311042,#1a0924)">
        <div class="t-title" style="color:#d8b4fe">AI Service</div>
        <div class="t-sub">Gemma 2B</div>
      </div>
      <div class="tile tile-gradient" style="background:linear-gradient(135deg,#1e1b4b,#0f172a)">
        <div class="t-title" style="color:#38bdf8">12ms</div>
        <div class="t-sub">Ping Latency</div>
      </div>
      <div class="tile tile-em" style="background:radial-gradient(circle at 50% 40%,#1e3a5f,#0b1526)">
        <div class="em-val" style="color:#7dd3fc">${now}</div>
        <div class="em-sub">WIB</div>
      </div>
    </div>

    <div class="footer-note">Preview UI Instagram Profile • varian ig • tesheader</div>
  </div>
</body>
</html>`
}

/* ─────────────────────── registry varian ─────────────────────── */

const VARIANTS = [
  {
    id: 'foto',
    label: 'Header gambar (interactive buttons)',
    note: 'banner foto di atas tombol — pola zaileys/wesker, jalur zapo',
    build: async (ctx) => {
      const thumb = findThumb('image')
      if (!thumb) throw new Error('assets/thumb/ gak berisi gambar')
      const headerImage = await uploadImageHeader(ctx.client, fs.readFileSync(thumb))
      await ctx.replyButtons({
        text: `Varian *foto* — header gambar nempel di atas body + tombol.\nSumber: ${path.basename(thumb)}`,
        footer: `tesheader • ${config.botName}`,
        buttons: [
          { id: 'tesheader:foto', text: '🔄 Ulangi' },
          { id: 'tesheader:list', text: '📁 Varian list' }
        ],
        headerImage
      })
    }
  },
  {
    id: 'video',
    label: 'Header video/GIF (interactive buttons)',
    note: 'clip mp4 4 dtk dari thumb (butuh ffmpeg); gif ikut kalau ada di assets/thumb',
    build: async (ctx) => {
      // File video/gif eksplisit dipakai langsung; gak ada → generate dari thumb.
      const existing = findThumb('video')
      if (existing) {
        const headerImage = await uploadVideoHeader(ctx.client, existing)
        await ctx.replyButtons({
          text: `Varian *video* — header video/GIF dari \`${path.basename(existing)}\`.`,
          footer: `tesheader • ${config.botName}`,
          buttons: [{ id: 'tesheader:foto', text: '🖼️ Varian foto' }],
          headerImage
        })
        return
      }
      const thumb = findThumb('image')
      if (!thumb) throw new Error('gak ada thumb foto/video di assets/thumb/')
      const clip = await makeHeaderClip(thumb)
      try {
        const headerImage = await uploadVideoHeader(ctx.client, clip, { seconds: 4, width: 1280, height: 720 })
        await ctx.replyButtons({
          text: 'Varian *video* — clip mp4 4 dtk (zoom/fade) dari thumb, dibuat ffmpeg otomatis.',
          footer: `tesheader • ${config.botName}`,
          buttons: [{ id: 'tesheader:foto', text: '🖼️ Varian foto' }],
          headerImage
        })
      } finally {
        fs.unlink(clip, () => {})
      }
    }
  },
  {
    id: 'list',
    label: 'Header gambar (interactive list)',
    note: 'header foto + dropdown single_select — buat menu kategori',
    build: async (ctx) => {
      const thumb = findThumb('image')
      if (!thumb) throw new Error('assets/thumb/ gak berisi gambar')
      const headerImage = await uploadImageHeader(ctx.client, fs.readFileSync(thumb))
      await ctx.replyList({
        text: 'Varian *list* — header foto di atas daftar pilihan (single_select).',
        footer: `tesheader • ${config.botName}`,
        title: `${config.botName} • Varian Header`,
        buttonText: 'Pilih Varian',
        sections: [{
          title: 'Varian tesheader',
          rows: [
            { id: 'tesheader:foto', title: '🖼️ Foto', description: 'header gambar + tombol' },
            { id: 'tesheader:video', title: '🎬 Video', description: 'header video/GIF (ffmpeg)' },
            { id: 'tesheader:teks', title: '🔤 Teks', description: 'banner box-art polos' },
            { id: 'tesheader:html', title: '🧩 Kartu HTML', description: 'banner gaya aplikasi' },
            { id: 'tesheader:ig', title: '📸 Instagram', description: 'profil IG dark mode modern' }
          ]
        }],
        headerImage
      })
    }
  },
  {
    id: 'teks',
    label: 'Banner teks (box art)',
    note: 'paling murah — teks polos, gak butuh upload, selalu tampil',
    build: async (ctx) => {
      // noStyle: banner jangan lewat reply style — kartu CTA-nya nutupin (§7)
      await ctx.client.message.send(ctx.chat, { type: 'text', text: buildTextBanner() }, { noStyle: true })
    }
  },
  {
    id: 'html',
    label: 'Kartu HTML native (banner aplikasi)',
    note: 'FOAHtmlPrimitive — banner gradient + logo data-URI, jalur sendNativeHtml',
    build: async (ctx) => {
      const html = await buildBannerCardHtml()
      await sendNativeHtml(ctx.client, ctx.chat, html)
    }
  },
  {
    id: 'ig',
    label: 'Profil Instagram (kartu HTML)',
    note: 'tampilan profil IG modern dark mode: avatar gradient, stats, bio, grid postingan',
    build: async (ctx) => {
      const html = await buildInstagramHtml()
      await sendNativeHtml(ctx.client, ctx.chat, html)
    }
  }
]

const BY_ID = new Map(VARIANTS.map((v) => [v.id, v]))

/* ─────────────────────── handler ─────────────────────── */

async function handler(ctx) {
  const arg = (ctx.args[0] || '').toLowerCase()

  let picked = VARIANTS
  if (arg && arg !== 'all' && arg !== 'semua') {
    const ids = arg.split(',').map((s) => s.trim()).filter(Boolean)
    const unknown = ids.filter((id) => !BY_ID.has(id))
    if (unknown.length) {
      return ctx.reply(
        `❌ Varian gak dikenal: ${unknown.join(', ')}\n\nTersedia:\n` +
        VARIANTS.map((v) => `• \`${v.id}\` — ${v.label}`).join('\n')
      )
    }
    picked = ids.map((id) => BY_ID.get(id))
  }

  await ctx.react('🪧')
  const ffmpegOk = await hasFfmpeg()
  const results = []
  const started = Date.now()

  for (const v of picked) {
    // Penanda polos (noStyle) — jangan pakai ctx.reply biar gak nambah kartu CTA
    await ctx.client.message.send(
      ctx.chat,
      { type: 'text', text: `─── ▶ varian \`${v.id}\` — ${v.label} ───` },
      { noStyle: true }
    )
    const t0 = Date.now()
    try {
      await v.build(ctx)
      results.push({ id: v.id, ok: true, ms: Date.now() - t0 })
    } catch (err) {
      results.push({ id: v.id, ok: false, ms: Date.now() - t0, err: err?.message || String(err) })
    }
  }

  const okN = results.filter((r) => r.ok).length
  const lines = results.map((r) =>
    r.ok
      ? `✅ ${r.id} — ${(r.ms / 1000).toFixed(1)}s`
      : `❌ ${r.id} — ${r.err}`
  )
  await ctx.reply(
    `🪧 *Ringkasan tesheader*\n` +
    `varian: ${okN}/${results.length} sukses • total ${((Date.now() - started) / 1000).toFixed(1)}s` +
    `${ffmpegOk ? '' : '\n⚠️ ffmpeg gak ada — varian `video` (generate) pasti gagal'}` +
    `\n\n` + lines.join('\n') +
    `\n\nPilih yang paling cocok di HP, lalu bilang mau dipasang di fitur mana.`
  )
}

export { pluginConfig as config, handler }
