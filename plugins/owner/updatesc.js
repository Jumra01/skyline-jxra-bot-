/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * update.js — Tarik update script dari GitHub (owner).
 *
 * Pakai:
 *   .updatesc         → git fetch + pull --ff-only dari origin, lalu rekap
 *                      "apa yang baru": 🆕 fitur / 🔧 fix / 📝 lainnya + file berubah
 *   auto-healing      → folder BELUM git repo (deploy panel via upload file)
 *                      → git init + tarik dari GitHub OTOMATIS
 *                      → server GAK punya git → fallback unduh via GitHub API
 *                         (Node fetch + untgz murni Node), file disamain GitHub
 *   auto             → kalau package.json / package-lock.json ikut berubah,
 *                      jalanin `npm install --omit=dev` sendiri setelah pull.
 *
 * SETTING MILIK USER: sebelum update, nilai yang diisi sendiri (apikey dll)
 * dan thumbnail yang pernah diganti di-BACKUP ke `config.js.update.bak` +
 * `updatesc-keep.bak/`. Jalannya DUA TAHAP (dua kartu balasan):
 *   TAHAP 1 → update kode + kartu hasil update
 *   TAHAP 2 → pulihin setting user (config.js + thumbnail) + kartu terpisah
 * Kode tetap versi terbaru; kartu tahap 2 cuma muncul kalau memang ada yang
 * dipulihkan / gagal. Kalau pemulihan gagal, backup tetap disimpan dan bisa
 * dicoba manual lewat `.restore`.
 * Lihat lib/keepSettings.js + lib/keepMigrate.js.
 *
 * Hasil akhir dirender kartu HTML native (richResponseMessage/unifiedResponse,
 * pola ping2/snake — §9 AGENTS.md) tema chrome biru-silver-putih-hitam;
 * progress & fallback tetap kartu teks.
 *
 * node_modules TIDAK diambil dari git (gitignore) — install cuma jalan
 * kalau dependency berubah. session/ & data/ gak tersentuh (gitignore).
 * File core/ lib/ handlers/ sky.js config/ berubah → butuh Restart manual
 * di panel; plugins/ → ke-hot-reload sendiri.
 *
 * Env (opsional, buat fork/testing):
 *   UPDATE_SC_URL            → URL remote repo (default HTTPS repo ini)
 *   UPDATE_SC_API_BASE       → override api.github.com
 *   UPDATE_SC_CODELOAD_BASE  → override codeload.github.com
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import { gunzip } from 'node:zlib'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  KEEP_FILES, KEEP_BAK, KEEP_BAK_DIR,
  readKeep, writeKeep, saveKeep, assetPristine, backupStatus, restoreFromBackup
} from '../../lib/keepSettings.js'
import { normalizeBackup } from '../../lib/keepMigrate.js'

const pexec = promisify(execFile)
const pgunzip = promisify(gunzip)

const REPO_URL = (process.env.UPDATE_SC_URL || 'https://github.com/Jumra01/skyline-jxra-bot-.git').trim()
const BRANCH = 'main'
const API_BASE = (process.env.UPDATE_SC_API_BASE || 'https://api.github.com').replace(/\/+$/, '')
const CODELOAD_BASE = (process.env.UPDATE_SC_CODELOAD_BASE || 'https://codeload.github.com').replace(/\/+$/, '')

// safe.directory=* → amanin kasus Docker/panel (repo beda user sama proses,
// git nolak dengan "detected dubious ownership")
function git(args, timeout = 60_000) {
  return pexec('git', ['-c', 'safe.directory=*', ...args], {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  }).then(({ stdout, stderr }) => ({ out: String(stdout).trim(), err: String(stderr).trim() }))
}

// Biar pesan error kebaca jelas: git gak ada / bukan repo / auth
function gitErrDetail(err) {
  const msg = String(err?.message || err || '')
  if (err?.code === 'ENOENT' || /ENOENT|not found/i.test(msg)) {
    return ['GIT GAK ADA di server ini.', 'Install dulu (Debian/Ubuntu):', 'apt install git']
  }
  if (/dubious ownership/i.test(msg)) {
    return ['Deteksi dubious ownership (Docker).', 'Udah ditangani safe.directory, coba lagi.']
  }
  if (/does not appear to be a git repository|not a git repository|fatal: not a git/i.test(msg)) {
    return ['Folder ini BUKAN git repo.', 'Deploy ulang pakai git clone:', 'git clone <repo-url> .']
  }
  if (/Permission denied \(publickey\)|could not read Username|Authentication failed|403|401/i.test(msg)) {
    return [
      'Auth GitHub GAGAL.',
      'Remote kemungkinan SSH tapi', 'container gak punya key.',
      'Solusi: clone ulang pakai HTTPS+token',
      'atau tambahin deploy key di repo.'
    ]
  }
  return msg.split('\n').filter(Boolean).slice(0, 5)
}

// ── UI helpers (gaya menu: ╭─〔 emoji `judul` 〕─⬣ + │ baris + ╰─⬣) ──
const SC_MAP = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'Q', r: 'ʀ',
  s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
}
const toSmallCaps = (t) => [...String(t).toLowerCase()].map((c) => SC_MAP[c] || c).join('')
const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

/**
 * Balikin setting user OTOMATIS setelah update sukses (atau setelah pull
 * gagal — config/thumbnail udah terlanjur di-reset ke HEAD).
 * Cuma nyentuh `config.js` (KEEP_FIELDS) + thumbnail yang di-backup —
 * kode & config default baru tetap versi terbaru.
 * Gagal → backup TIDAK dihapus, jadi masih bisa `.restore` manual.
 */
async function autoRestore() {
  try {
    await normalizeBackup()
    const r = await restoreFromBackup({ config: true, assets: true })
    return {
      kept: r.kept.length + r.assetsKept.length,
      lost: r.lost.length + r.assetsLost.length,
      error: null
    }
  } catch (err) {
    return { kept: 0, lost: 0, error: String(err?.message || err) }
  }
}

// Sisa backup SETELAH auto-restore (biasanya 0; kalau gagal, masih ada).
async function pendingNow() {
  try {
    const st = await backupStatus()
    return { config: st.config.length > 0, assets: st.assets.length }
  } catch {
    return { config: false, assets: 0 }
  }
}

function restoredNote(r) {
  if (!r) return null
  if (r.error) {
    return {
      t: `⚠️ Restore otomatis gagal:<br><b>${hesc(trunc(r.error, 64))}</b><br>Jalankan <b>.restore</b> manual.`,
      cls: 'warn'
    }
  }
  if (r.lost) {
    return {
      t: `⚠️ ${r.kept} setting balik, <b>${r.lost} gagal</b>.<br>Backup-nya masih disimpan — jalankan<br><b>.restore</b> buat coba lagi.`,
      cls: 'warn'
    }
  }
  if (r.kept) {
    return {
      t: `♻️ <b>${r.kept} setting</b> kamu dipulihkan otomatis<br>(apikey / thumbnail) — <b>kode tetap terbaru</b>.`
    }
  }
  return null
}

// Sisa backup dari update sebelumnya yang BELUM berhasil dipulihkan
// (auto-restore gagal / user lama). Wajib dilaporin biar gak dianggap hilang.
function pendingCount(p) {
  return (p?.config ? 1 : 0) + (p?.assets || 0)
}

function pendingStats(p) {
  const n = pendingCount(p)
  return n ? [{ k: '🔐 backup', v: `${n} belum balik`, cls: 'warn' }] : []
}

function pendingNote(p) {
  const n = pendingCount(p)
  return n
    ? {
        t: `🔐 Masih ada <b>${n} backup</b> yang belum<br>kebalik — jalankan <b>.restore</b><br>buat coba lagi.`,
        cls: 'warn'
      }
    : null
}

function pendingLine(p) {
  const n = pendingCount(p)
  return n ? `🔐 ${n} backup belum kebalik → jalankan .restore` : ''
}

/**
 * TAHAP 2 `.updatesc`: kartu TERPISAH buat laporan pemulihan setting.
 * Dijalankan setelah kartu update selesai. Cuma dikirim kalau memang ada
 * yang dipulihkan / gagal / sisa backup — biar gak nambah chat kosong.
 */
async function sendRestoreCard(ctx) {
  const restored = await autoRestore()
  const pending = await pendingNow()
  const nothing =
    !restored.error && restored.kept === 0 && restored.lost === 0 && pendingCount(pending) === 0
  if (nothing) return false

  const bad = !!restored.error
  const warn = !bad && (restored.lost > 0 || pendingCount(pending) > 0)
  await replyRich(ctx, {
    icon: bad || warn ? '⚠️' : '♻️',
    title: 'RESTORE SETTING',
    sub: 'tahap 2 · pemulihan otomatis',
    pill: { t: bad ? 'GAGAL' : warn ? 'SEBAGIAN' : 'BERES', cls: bad ? 'bad' : warn ? 'warn' : 'ok' },
    meta: [`🕒 ${hesc(nowWIB())}`],
    stats: [
      { k: '♻️ setting', v: restored.kept ? `${restored.kept} dipulihkan` : '—', cls: restored.kept ? 'ok' : 'dim' },
      ...(restored.lost ? [{ k: '⚠️ gagal', v: String(restored.lost), cls: 'bad' }] : []),
      ...pendingStats(pending)
    ],
    notes: [restoredNote(restored), pendingNote(pending)].filter(Boolean)
  }, [
    '*RESTORE SETTING* ♻️',
    '',
    restored.kept ? `♻️ ${restored.kept} setting dipulihkan otomatis` : 'ℹ️ Gak ada setting yang bisa dipulihkan',
    restored.lost ? `⚠️ ${restored.lost} gagal → jalankan .restore` : null,
    pendingLine(pending) || null,
    restored.kept ? '✅ Kode tetap versi terbaru' : null,
    `🕒 ${nowWIB()}`
  ].filter(Boolean))
  return true
}

function card(emoji, title, lines) {
  const out = [`╭─〔 ${emoji} \`${toSmallCaps(title)}\` 〕─⬣`]
  for (const line of lines) out.push(line === '' ? '│' : `│ ${line}`)
  out.push('╰─⬣')
  return out.join('\n')
}

function fmtDur(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} detik`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function nowWIB() {
  try {
    const s = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })
    return `${s} WIB`
  } catch {
    return new Date().toISOString()
  }
}

const NEED_RESTART_RE = /^(core|lib|handlers|auth|src)\//

// ── Kartu HTML native (FOAHtmlPrimitive — pola ping2/snake, §9 AGENTS.md) ──
// Tema chrome: biru · silver · putih · hitam. Aman: gak pakai blur/mask/
// backdrop-filter/position:fixed/aspect-ratio (larangan webview WA).
const hesc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html{background-color:#070b16}
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#eef3ff;padding:14px;position:relative;
  background-color:#070b16;
  background-image:
    radial-gradient(560px 300px at 18% -40px,rgba(59,130,246,.38),rgba(59,130,246,0) 70%),
    radial-gradient(520px 300px at 90% 105%,rgba(200,211,232,.22),rgba(200,211,232,0) 70%),
    radial-gradient(380px 260px at 105% 40%,rgba(96,165,250,.16),rgba(96,165,250,0) 70%),
    linear-gradient(180deg,#0a1122 0%,#0b1428 45%,#070b16 100%)}
.bgfx{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:0;
  background-image:
    linear-gradient(rgba(59,130,246,.07) 1px,rgba(59,130,246,0) 1px),
    linear-gradient(90deg,rgba(59,130,246,.07) 1px,rgba(59,130,246,0) 1px),
    radial-gradient(rgba(148,163,184,.16) 1.2px,rgba(148,163,184,0) 1.6px);
  background-size:52px 52px,52px 52px,20px 20px}
.sheen{position:absolute;top:0;left:0;right:0;height:170px;
  background:
    linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(200,211,232,.16) 48%,rgba(255,255,255,.22) 52%,rgba(59,130,246,.14) 60%,rgba(59,130,246,0) 75%),
    radial-gradient(420px 150px at 50% 0,rgba(59,130,246,.30),rgba(59,130,246,0) 75%)}
.vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(ellipse 110% 95% at 50% 40%,rgba(0,0,0,0) 55%,rgba(0,0,0,.6) 100%)}
.wrap{position:relative;z-index:1}
.chrome{height:3px;border-radius:99px;margin-bottom:12px;
  background:linear-gradient(90deg,#3b82f6,#c8d3e8 45%,#ffffff 55%,#93a4c7 70%,#3b82f6);
  box-shadow:0 0 12px rgba(59,130,246,.55)}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;
  background:linear-gradient(135deg,rgba(59,130,246,.35),rgba(200,211,232,.16));
  border:1.5px solid rgba(200,211,232,.45);box-shadow:0 0 16px rgba(59,130,246,.35)}
.t1{font-size:16px;font-weight:800;letter-spacing:1.4px;
  background:linear-gradient(90deg,#ffffff,#b9c6e8 60%,#7fb0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.t2{font-size:10px;color:#8fa3cc;margin-top:1px}
.pill{margin-left:auto;font-size:10px;font-weight:800;padding:4px 11px;border-radius:99px;letter-spacing:1px}
.pill.ok{color:#9df0c4;border:1px solid rgba(52,211,153,.5);background:rgba(52,211,153,.12);
  box-shadow:0 0 14px rgba(52,211,153,.3)}
.pill.info{color:#9fd0ff;border:1px solid rgba(59,130,246,.5);background:rgba(59,130,246,.12);
  box-shadow:0 0 14px rgba(59,130,246,.35)}
.pill.warn{color:#ffd28a;border:1px solid rgba(255,184,77,.5);background:rgba(255,184,77,.12)}
.pill.bad{color:#ffb3c1;border:1px solid rgba(255,92,122,.5);background:rgba(255,92,122,.12);
  box-shadow:0 0 14px rgba(255,92,122,.3)}
.card{background:linear-gradient(160deg,rgba(24,34,60,.97),rgba(11,17,34,.98));
  border:1px solid rgba(148,163,184,.26);border-radius:13px;padding:11px 13px;margin-bottom:9px;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 6px 18px rgba(0,0,0,.35)}
.lbl{font-size:9px;letter-spacing:1.6px;color:#8fa3cc;text-transform:uppercase;margin-bottom:6px;
  display:flex;align-items:center;gap:5px}
.hash{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:700;color:#0a1122;
  background:linear-gradient(135deg,#e7edf9,#a8b6d8);padding:2px 9px;border-radius:7px;display:inline-block;
  box-shadow:0 1px 0 #fff inset}
.arrow{color:#7fb0ff;font-weight:800;font-size:13px;padding:0 3px}
.meta{display:flex;flex-wrap:wrap;gap:7px;align-items:center;font-size:11px;color:#a9b8d8}
.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:9px}
.chip{background:linear-gradient(160deg,rgba(24,34,60,.97),rgba(11,17,34,.98));
  border:1px solid rgba(148,163,184,.24);border-radius:11px;padding:8px 5px;text-align:center;
  box-shadow:0 1px 0 rgba(255,255,255,.10) inset}
.chip .n{font-size:20px;font-weight:800;line-height:1.15;
  background:linear-gradient(90deg,#ffffff,#9fd0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.chip .e{font-size:13px}
.chip .k{font-size:8px;letter-spacing:1.1px;color:#8fa3cc;text-transform:uppercase;margin-top:1px}
.sec{margin-bottom:8px}
.sech{font-size:10px;font-weight:800;letter-spacing:1.2px;color:#9fd0ff;text-transform:uppercase;
  display:flex;align-items:center;gap:6px;margin-bottom:5px}
.sech .cnt{color:#61739c;font-weight:700}
.secb{background:rgba(11,17,34,.72);border:1px solid rgba(148,163,184,.18);border-radius:10px;padding:7px 10px}
.row{font-size:12px;color:#dfe8fb;padding:3px 0;line-height:1.45}
.row .dot{color:#7fb0ff}
.row .cnt{color:#9fd0ff;font-weight:700}
.row.dim{color:#8fa3cc;font-size:11px}
.note{font-size:11px;color:#a9b8d8;background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.30);
  border-radius:10px;padding:8px 11px;margin-bottom:9px;line-height:1.55}
.note b{color:#9fd0ff}
.note.warn{background:rgba(255,184,77,.09);border-color:rgba(255,184,77,.35)}
.note.warn b{color:#ffd28a}
.note.bad{background:rgba(255,92,122,.09);border-color:rgba(255,92,122,.35)}
.note.bad b{color:#ffb3c1}
.stat{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;
  background:rgba(11,17,34,.72);border:1px solid rgba(148,163,184,.18);border-radius:10px;
  padding:7px 11px;margin-bottom:6px}
.stat .v{font-weight:700;color:#9fd0ff;text-align:right}
.stat .v.ok{color:#9df0c4}
.stat .v.bad{color:#ffb3c1}
.stat .v.dim{color:#8fa3cc;font-weight:600}
.ft{margin-top:4px;font-size:9.5px;color:#61739c;text-align:center;line-height:1.6}
.ft b{color:#9fd0ff}
.btnline{display:flex;gap:7px;justify-content:center;margin-top:8px;flex-wrap:wrap}
.btn{font-size:10px;font-weight:700;color:#0a1122;background:linear-gradient(135deg,#e7edf9,#a8b6d8);
  padding:6px 14px;border-radius:99px;box-shadow:0 1px 0 #fff inset,0 4px 12px rgba(0,0,0,.35)}
.btn.blue{color:#fff;background:linear-gradient(135deg,#3b82f6,#1d4ed8);
  box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 4px 14px rgba(59,130,246,.45)}
`

function wrapHtml(inner, title) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${hesc(title)}</title>
<style>${CSS}</style></head><body>
<div class="bgfx"><div class="sheen"></div><div class="vig"></div></div>
<div class="wrap"><div class="chrome"></div>${inner}
<div class="ft">⚡ <b>skyline-JXRA</b> · updater · jangan edit file langsung di panel<br>edit di lokal → push → <b>.updatesc</b></div>
</div></body></html>`
}

function hd(icon, title, sub, pillText, pillCls) {
  return `<div class="hd"><div class="ic">${icon}</div>
<div><div class="t1">${hesc(title)}</div><div class="t2">${hesc(sub)}</div></div>
<div class="pill ${pillCls}">${hesc(pillText)}</div></div>`
}

const row = (text) => `<div class="row"><span class="dot">▸</span> ${text}</div>`

function sectionBlock(icon, label, items) {
  if (!items.length) return ''
  const rows = items.slice(0, 6).map((it) => row(hesc(trunc(it, 58))))
  if (items.length > 6) rows.push(`<div class="row dim">… +${items.length - 6} lainnya</div>`)
  return `<div class="sec"><div class="sech">${icon} ${hesc(label)} <span class="cnt">(${items.length})</span></div>
<div class="secb">${rows.join('')}</div></div>`
}

function buildResultHtml(d) {
  // d: { icon, title, sub, pill:{t,cls}, head, meta:[], chips:[{e,n,k}],
  //      notes:[{t,cls}], stats:[{k,v,cls}], sections:[{icon,label,items}],
  //      buttons:[{t,cls}] }
  const chips = d.chips?.length
    ? `<div class="chips">${d.chips.map((c) => `<div class="chip"><div class="e">${c.e}</div><div class="n">${hesc(String(c.n))}</div><div class="k">${hesc(c.k)}</div></div>`).join('')}</div>`
    : ''
  const meta = d.meta?.length
    ? `<div class="card"><div class="lbl">📌 <span>commit</span></div><div class="meta">${d.meta.map((m) => `<span>${m}</span>`).join('<span class="arrow">·</span>')}</div></div>`
    : ''
  const notes = (d.notes || [])
    .map((n) => `<div class="note ${n.cls || ''}">${n.t}</div>`)
    .join('')
  const stats = (d.stats || [])
    .map((s) => `<div class="stat"><span>${s.k}</span><span class="v ${s.cls || ''}">${s.v}</span></div>`)
    .join('')
  const sections = (d.sections || []).map((s) => sectionBlock(s.icon, s.label, s.items)).join('')
  const buttons = d.buttons?.length
    ? `<div class="btnline">${d.buttons.map((b) => `<span class="btn ${b.cls || ''}">${hesc(b.t)}</span>`).join('')}</div>`
    : ''
  return wrapHtml(
    hd(d.icon, d.title, d.sub, d.pill.t, d.pill.cls) +
      `<div class="card">${d.head}</div>` + meta + chips + notes + stats + sections + buttons,
    d.title
  )
}

// Kirim kartu HTML native (FOAHtmlPrimitiveDemoDONOTUSE — pola ping2/snake).
// GAGAL → throw (biar pemanggil fallback ke kartu teks, jangan ditelan).
async function sendNativeHtml(client, chat, html) {
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

// HTML dulu; gagal → fallback kartu teks lama (biar update tetap keliatan)
async function replyRich(ctx, htmlData, fallbackLines) {
  try {
    await sendNativeHtml(ctx.client, ctx.chat, buildResultHtml(htmlData))
    return true
  } catch {
    try {
      await ctx.reply(card(htmlData.icon, htmlData.title, fallbackLines))
      return true
    } catch {
      return false
    }
  }
}

async function gitAvailable() {
  try {
    await git(['--version'], 10_000)
    return true
  } catch (err) {
    if (err?.code === 'ENOENT') return false
    return true
  }
}

async function isGitRepo() {
  try {
    await git(['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

// Remote origin wajib ada & nunjuk ke REPO_URL (biar fetch bisa jalan)
async function ensureOriginUrl() {
  try {
    const cur = (await git(['remote', 'get-url', 'origin'])).out
    if (cur) return
  } catch {}
  await git(['remote', 'add', 'origin', REPO_URL])
}

// Folder bukan repo → init + tarik penuh dari GitHub. Overwrite file tracked,
// session/ data/ node_modules/ gak kepegang (gak di-repo). config.js lokal
// dibackup dulu (checkout nimpa file yang ada di tree).
async function bootstrapRepo() {
  let pkgBefore = null
  try { pkgBefore = await fs.readFile('package.json') } catch {}

  await git(['init'])
  await ensureOriginUrl()
  await git(['fetch', 'origin', BRANCH], 180_000)

  // `fetch` gak nyentuh working tree → baru sekarang bisa bedain file yang
  // BENERAN diubah user vs masih default, pakai pembanding `FETCH_HEAD`
  // (folder belum punya HEAD). Tanpa ini, thumbnail default ikut ke-backup.
  await saveKeep({
    pristine: (rel) => assetPristine(rel, 'FETCH_HEAD')
  })
  // checkout -f bakal nimpa config.js versi lokal (apikey klien) → simpen
  // dulu nilainya. (`config.js.pre-git.bak` tetap dibuat — salinan utuh.)
  try { await fs.copyFile('config.js', 'config.js.pre-git.bak') } catch {}

  await git(['checkout', '-f', '-B', BRANCH, 'FETCH_HEAD'])
  try { await git(['branch', '--set-upstream-to', `origin/${BRANCH}`, BRANCH]) } catch {}

  let pkgChanged = false
  try {
    const pkgAfter = await fs.readFile('package.json')
    pkgChanged = !!pkgBefore && !pkgBefore.equals(pkgAfter)
  } catch {}

  const head = (await git(['log', '-1', '--oneline'])).out
  return { head, pkgChanged }
}

function parseGitHubRepo(url) {
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

// Extractor tar.gz murni Node (zlib built-in) — container panel gak selalu
// punya binary tar. Cuma perlu path/size/typeflag (format ustar codeload).
async function untgz(buf, destDir) {
  const raw = await pgunzip(buf)
  let off = 0
  const created = new Set()
  while (off + 512 <= raw.length) {
    const header = raw.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const str = (start, len) => {
      let end = start
      while (end < start + len && header[end] !== 0) end++
      return header.subarray(start, end).toString('utf8')
    }
    const size = parseInt(str(124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(header[156] || 0)
    let name = str(0, 100)
    const prefix = str(345, 155)
    if (prefix) name = `${prefix}/${name}`
    name = name.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')
    const dataStart = off + 512
    off = dataStart + Math.ceil(size / 512) * 512
    if (!name || name.includes('..')) continue // anti path traversal
    if (type === '5' || name.endsWith('/')) {
      const dir = path.join(destDir, name)
      if (!created.has(dir)) {
        await fs.mkdir(dir, { recursive: true })
        created.add(dir)
      }
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '') continue
    const file = path.join(destDir, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, raw.subarray(dataStart, dataStart + size))
  }
}

async function ghJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'skyline-JXRA-updatesc', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 120)}`)
  }
  return res.json()
}

// Fallback tanpa git: unduh tarball branch dari codeload → extract murni Node
// (untgz) → timpa isi folder kerja (fs.cp). Gak butuh binary git/tar/cp —
// aman di container minimal. Gak bisa deteksi file berubah — package.json
// dicek manual (bandingin sebelum/sesudah copy).
async function apiSync() {
  const gh = parseGitHubRepo(REPO_URL)
  if (!gh) throw new Error('URL repo bukan GitHub — fallback API gak bisa dipakai')
  const { owner, repo } = gh

  const meta = await ghJson(`${API_BASE}/repos/${owner}/${repo}/commits/${BRANCH}`)
  const sha = String(meta.sha || '')
  const short = sha.slice(0, 7)
  const msg = String(meta.commit?.message || '').split('\n')[0]

  let pkgBefore = null
  try { pkgBefore = await fs.readFile('package.json') } catch {}

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'updatesc-'))
  try {
    const res = await fetch(`${CODELOAD_BASE}/${owner}/${repo}/tar.gz/refs/heads/${BRANCH}`, {
      signal: AbortSignal.timeout(180_000)
    })
    if (!res.ok) throw new Error(`Unduh tarball gagal: HTTP ${res.status}`)
    const tgz = path.join(tmpDir, 'src.tgz')
    await fs.writeFile(tgz, Buffer.from(await res.arrayBuffer()))

    const extractDir = path.join(tmpDir, 'x')
    await fs.mkdir(extractDir, { recursive: true })
    await untgz(await fs.readFile(tgz), extractDir)
    const entries = await fs.readdir(extractDir)
    const src = path.join(extractDir, entries[0] || '')
    const st = await fs.stat(src).catch(() => null)
    if (!entries[0] || !st?.isDirectory()) throw new Error('Struktur tarball gak dikenali')

    // fs.cp recursive — murni Node, tanpa binary cp system.
    // config.js IKUT ketimpa versi GitHub (apikey-nya kosong) → simpen
    // dulu nilai milik user ke backup (dipulihin lewat `.restore`).
    // Tarball udah ke-extract di `src` = persis versi upstream → pakai itu
    // sebagai pembanding "pristine" (tanpa git gak ada HEAD). Jadi thumbnail
    // yang masih default gak ikut ke-backup, yang diubah user baru.
    await saveKeep({
      pristine: async (rel) => {
        try {
          const [upstream, lokal] = await Promise.all([
            fs.readFile(path.join(src, rel)),
            fs.readFile(rel)
          ])
          return upstream.equals(lokal)
        } catch {
          return false
        }
      }
    })
    await fs.cp(src, process.cwd(), { recursive: true, force: true })

    let pkgChanged = false
    try {
      const pkgAfter = await fs.readFile('package.json')
      pkgChanged = !!pkgBefore && !pkgBefore.equals(pkgAfter)
    } catch {}

    return { short, msg, pkgChanged }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function npmInstallMaybe(ctx, changed) {
  if (!changed) return { installed: false, installErr: null }
  try {
    await ctx.reply(card('📦', 'DEPENDENCY', [
      '⏳ *Dependency berubah*',
      '',
      '⚙️ npm install... (bisa 1-2 menit)'
    ]))
    await pexec('npm', ['install', '--omit=dev'], {
      cwd: process.cwd(),
      timeout: 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024
    })
    return { installed: true, installErr: null }
  } catch (err) {
    return { installed: false, installErr: String(err?.message || err).split('\n').slice(0, 4) }
  }
}

// Rekap section: label + daftar commit (maks 6), spasi bawah biar rapi
function section(label, list) {
  if (!list.length) return []
  const rows = list.slice(0, 6).map((c) => `◦ ${trunc(c.subject, 50)}`)
  if (list.length > 6) rows.push(`… +${list.length - 6} lainnya`)
  return [`${label} (${list.length})`, ...rows, '']
}

// Daftar file berubah → dikelompokin per folder root (rapi buat banyak file)
function fileSection(files) {
  if (!files.length) return []
  const byDir = {}
  for (const f of files) {
    const key = f.includes('/') ? `${f.split('/')[0]}/` : f
    byDir[key] = (byDir[key] || 0) + 1
  }
  const keys = Object.keys(byDir)
  const rows = keys.slice(0, 8).map((d) => `◦ ${d} · ${byDir[d]}`)
  if (keys.length > 8) rows.push(`… +${keys.length - 8} lain`)
  return [`📁 *FILE BERUBAH* (${files.length})`, ...rows, '']
}

const pluginConfig = {
  name: 'updatesc',
  alias: ['update', 'gitupdate', 'pullbot', 'updatebot'],
  category: 'owner',
  description: 'Tarik update script dari GitHub (auto git init + npm install)',
  usage: '.updatesc',
  example: '.updatesc',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 15,
  limit: 1,
  isEnabled: true
}

async function handler(ctx) {
  const t0 = Date.now()
  const hasGit = await gitAvailable()

  // ── Jalur 1: server gak punya git → fallback GitHub API ──
  if (!hasGit) {
    await ctx.react('🔄')
    await ctx.reply(card('🌐', 'UPDATE', [
      '⏳ *Git gak ada di server*',
      '',
      '🌐 Fallback: unduh via GitHub API',
      `🕒 ${nowWIB()}`
    ]))
    try {
      const { short, msg, pkgChanged } = await apiSync()
      const { installed, installErr } = await npmInstallMaybe(ctx, pkgChanged)
      await ctx.react(installErr ? '⚠️' : '✅')
      await replyRich(ctx, {
        icon: '🌐',
        title: 'UPDATE SELESAI',
        sub: 'mode GitHub API (tanpa git)',
        pill: { t: installErr ? 'ADA ERROR' : 'SUKSES', cls: installErr ? 'warn' : 'ok' },
        head: `<div class="lbl">📦 <span>sync via API</span></div>
<div class="meta"><span class="hash">${hesc(short)}</span><span>${hesc(trunc(msg, 34))}</span></div>`,
        meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
        notes: [
          { t: '🌐 Server gak punya git — file disamain<br>langsung dari GitHub (tarball mode).' },
          { t: 'ℹ️ Daftar file berubah gak bisa<br>dideteksi tanpa git.', cls: 'warn' }
        ].filter(Boolean),
        stats: [
          { k: '📦 npm install', v: installed ? 'sukses' : installErr ? 'GAGAL' : 'lewati', cls: installed ? 'ok' : installErr ? 'bad' : 'dim' }
        ],
        buttons: [{ t: '🔁 RESTART di panel', cls: 'blue' }]
      }, [
        '*UPDATE SELESAI* ✅ (API)',
        '',
        `📌 \`${short}\` ${trunc(msg, 30)}`,
        `⏱️ *${fmtDur(Date.now() - t0)}*`,
        '',
        '🌐 Server tanpa git — sync via GitHub API',
        'ℹ️ Daftar file gak bisa dideteksi (tanpa git)',
        installed ? '📦 npm install *sukses*' : installErr ? '⚠️ npm install *gagal* (cek log)' : '📦 npm install *lewati*',
        '',
        '🔁 *RESTART* bot di panel biar kode baru kebaca',
        '',
        `🕒 ${nowWIB()}`
      ])
      await sendRestoreCard(ctx)
    } catch (err) {
      await ctx.react('⚠️')
      await replyRich(ctx, {
        icon: '⚠️',
        title: 'UPDATE GAGAL',
        sub: 'fallback GitHub API',
        pill: { t: 'GAGAL', cls: 'bad' },
        head: `<div class="lbl">❌ <span>API error</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
        meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
        notes: [
          { t: 'Cek koneksi / rate limit GitHub,<br>lalu coba lagi <b>.updatesc</b>.', cls: 'bad' }
        ].filter(Boolean)
      }, [
        '*UPDATE GAGAL*',
        '',
        '🔍 Detail error:',
        ...gitErrDetail(err),
        '',
        `⏱️ *${fmtDur(Date.now() - t0)}*`,
        `🕒 ${nowWIB()}`
      ])
      await sendRestoreCard(ctx)
    }
    return
  }

  // ── Jalur 2: git ada, folder BELUM repo (upload file tanpa clone) → auto init ──
  let bootstrapped = null
  if (!(await isGitRepo())) {
    await ctx.react('🔄')
    await ctx.reply(card('⚙️', 'SETUP', [
      '⏳ *Folder belum git repo*',
      '',
      '🔄 Init + tarik penuh dari GitHub...',
      '⏱️ Bisa 1-2 menit'
    ]))
    try {
      bootstrapped = await bootstrapRepo()
    } catch (err) {
      await ctx.react('⚠️')
      await replyRich(ctx, {
        icon: '⚠️',
        title: 'SETUP GAGAL',
        sub: 'git init / fetch error',
        pill: { t: 'GAGAL', cls: 'bad' },
        head: `<div class="lbl">❌ <span>init repo error</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
        meta: [`🕒 ${hesc(nowWIB())}`],
        notes: [{ t: 'Cek koneksi / akses GitHub<br>lalu coba lagi <b>.updatesc</b>.', cls: 'bad' }]
      }, [
        '*SETUP GAGAL*',
        '',
        ...gitErrDetail(err),
        '',
        `🕒 ${nowWIB()}`
      ])
      return
    }
    const { installed, installErr } = await npmInstallMaybe(ctx, bootstrapped.pkgChanged)
    await ctx.react(installErr ? '⚠️' : '✅')
    await replyRich(ctx, {
      icon: '⚙️',
      title: 'SETUP REPO SELESAI',
      sub: 'git init otomatis dari GitHub',
      pill: { t: installErr ? 'ADA ERROR' : 'SETUP OK', cls: installErr ? 'warn' : 'ok' },
      head: `<div class="lbl">📥 <span>repo dibuat + sync penuh</span></div>
<div class="meta"><span class="hash">${hesc(bootstrapped.head.split(' ')[0])}</span><span>${hesc(trunc(bootstrapped.head.split(' ').slice(1).join(' '), 40))}</span></div>`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
      notes: [
        { t: '💾 Config lama disimpan di<br><b>config.js.pre-git.bak</b>' },
        { t: '⚠️ Abis <b>RESTART</b>, jalur .updatesc<br>berikutnya normal (git pull).', cls: 'warn' }
      ].filter(Boolean),
      stats: [
        { k: '📦 npm install', v: installed ? 'sukses' : installErr ? 'GAGAL' : 'lewati', cls: installed ? 'ok' : installErr ? 'bad' : 'dim' },
        { k: '📁 session/ & data/', v: 'aman utuh', cls: 'ok' }
      ].filter(Boolean),
      buttons: [{ t: '🔁 RESTART bot di panel', cls: 'blue' }]
    }, [
      '*SETUP REPO SELESAI* ✅',
      '',
      `📌 HEAD: \`${bootstrapped.head.split(' ')[0]}\``,
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      '',
      '📥 Repo di-init otomatis + sync penuh',
      '💾 config.js lama → `config.js.pre-git.bak`',
      installed ? '📦 npm install *sukses*' : installErr ? '⚠️ npm install *gagal* (cek log)' : '📦 npm install *lewati*',
      '',
      '🔁 *RESTART* bot di panel',
      '⚠️ Abis restart, .updatesc jalan normal (pull)',
      '',
      `🕒 ${nowWIB()}`
    ])
    await sendRestoreCard(ctx)
    return
  }

  // ── Jalur 3: repo normal → fetch + pull --ff-only ──
  await ensureOriginUrl()

  await ctx.react('🔄')
  await ctx.reply(card('🔄', 'UPDATE', [
    '⏳ *Mengambil commit terbaru...*',
    '',
    `🌐 origin/${BRANCH}`,
    `🕒 ${nowWIB()}`
  ]))

  let oldHead
  try {
    oldHead = (await git(['rev-parse', 'HEAD'])).out
  } catch (err) {
    await ctx.react('⚠️')
    await replyRich(ctx, {
      icon: '⚠️',
      title: 'UPDATE GAGAL',
      sub: 'gak bisa baca HEAD repo',
      pill: { t: 'GAGAL', cls: 'bad' },
      head: `<div class="lbl">❌ <span>rev-parse HEAD</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
      meta: [`🕒 ${hesc(nowWIB())}`]
    }, [
      '*UPDATE GAGAL*',
      '',
      '🔍 Gak bisa baca HEAD:',
      ...gitErrDetail(err),
      '',
      `🕒 ${nowWIB()}`
    ])
    return
  }

  // Fetch dulu biar tau ada update gak (dan error remote keliatan jelas)
  try {
    await git(['fetch', 'origin', '--quiet'], 120_000)
  } catch (err) {
    await ctx.react('⚠️')
    await replyRich(ctx, {
      icon: '⚠️',
      title: 'UPDATE GAGAL',
      sub: 'fetch origin error',
      pill: { t: 'GAGAL', cls: 'bad' },
      head: `<div class="lbl">❌ <span>git fetch origin</span></div>
${gitErrDetail(err).map((l) => row(hesc(l))).join('')}`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
      notes: [{ t: 'Cek koneksi server / akses remote<br>(token SSH/HTTPS expired?).', cls: 'bad' }]
    }, [
      '*UPDATE GAGAL*',
      '',
      '🔍 Fetch origin error:',
      ...gitErrDetail(err),
      '',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ])
    return
  }

  // Bandingin sama upstream
  let behind
  try {
    behind = (await git(['rev-list', '--count', 'HEAD..@{u}'])).out
  } catch {
    try {
      behind = (await git(['rev-list', '--count', `HEAD..origin/${BRANCH}`])).out
    } catch {
      behind = null
    }
  }

  if (behind === '0') {
    const cur = (await git(['log', '-1', '--oneline'])).out
    const [curHash = '', ...curMsg] = cur.split(' ')
    await ctx.react('✅')
    await replyRich(ctx, {
      icon: '✅',
      title: 'UDAH TERBARU',
      sub: 'gak ada commit baru di GitHub',
      pill: { t: 'UP TO DATE', cls: 'ok' },
      head: `<div class="lbl">📌 <span>HEAD sekarang</span></div>
<div class="meta"><span class="hash">${hesc(curHash)}</span>${curMsg.length ? `<span>${hesc(trunc(curMsg.join(' '), 40))}</span>` : ''}</div>`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🌿 ${hesc(BRANCH)}`, `🕒 ${hesc(nowWIB())}`],
      stats: [
        { k: '📡 origin', v: 'tersambung', cls: 'ok' },
        { k: '🔄 update terakhir', v: 'cek ulang nanti', cls: 'dim' }
      ]
    }, [
      '✅ *UDAH TERBARU*',
      '',
      `📌 HEAD: \`${curHash}\``,
      curMsg.length ? `💬 ${trunc(curMsg.join(' '), 36)}` : null,
      '',
      'ℹ️ Gak ada commit baru dari GitHub',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ].filter(Boolean))
    // Kalau masih ada backup dari update sebelumnya (mis. run lama yang
    // belum sempat di-restore), jalankan tahap 2 sekarang.
    await sendRestoreCard(ctx)
    return
  }

  // ── Simpen nilai milik user (apikey dll) dulu ──
  // config.js lokal pasti beda dari GitHub (user ngisi apikey sendiri),
  // dan `pull --ff-only` bakal NOLAK kalau file tracked berubah lokal.
  // Jadi: backup → balikin ke versi HEAD → pull → **auto-restore** setting
  // user (config + thumbnail) di atas kode terbaru. `.restore` cuma perlu
  // kalau auto-restore gagal.
  let keepState = { keeps: [], assets: [], pending: { config: false, assets: 0 } }
  let cfgReset = false
  try {
    keepState = await saveKeep()                              // baca + backup
    const dirty = (await git(['status', '--porcelain', '--', 'config.js'])).out
    if (dirty) {
      const head = await git(['show', 'HEAD:config.js'])    // versi commit lokal
      await fs.writeFile('config.js', head.out + '\n', 'utf8')
      cfgReset = true
    }
    // Thumbnail punya user juga KE-TRACK — kalau beda dari HEAD,
    // `pull --ff-only` bakal NOLAK ("would be overwritten by merge").
    // Balikin dulu ke versi HEAD biar pull lancar; nilainya udah
    // ke-backup di saveKeep() dan bisa dipulihin lewat `.restore`.
    // (assets cuma berisi file yang beneran pernah diubah user)
    for (const { rel } of keepState.assets) {
      try { await git(['checkout', 'HEAD', '--', rel], 30_000) } catch {}
    }
  } catch {}

  // Pull (--ff-only: tolak kalau ada editan lokal di panel — jangan edit
  // file langsung di server, editnya di lokal lalu push)
  let pullErr = null
  try {
    await git(['pull', '--ff-only', 'origin', BRANCH], 120_000)
  } catch (err) {
    pullErr = err
  }

  // Pull gagal → file lokal udah dibalikin ke versi HEAD, jadi setting user
  // WAJIB dipulihkan balik (kalau enggak, apikey di config.js hilang sampai
  // `.restore` manual).

  if (pullErr) {
    await ctx.react('⚠️')
    await replyRich(ctx, {
      icon: '⚠️',
      title: 'UPDATE GAGAL',
      sub: 'git pull ditolak',
      pill: { t: 'GAGAL', cls: 'bad' },
      head: `<div class="lbl">❌ <span>pull --ff-only error</span></div>
${gitErrDetail(pullErr).map((l) => row(hesc(l))).join('')}`,
      meta: [`⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b>`, `🕒 ${hesc(nowWIB())}`],
      notes: [
        { t: '💡 Kemungkinan ada file diedit<br>langsung di panel.', cls: 'warn' },
        { t: 'Paling aman: edit di <b>lokal</b> →<br><b>push</b> → <b>.updatesc</b><br>(atau reset repo di panel).', cls: 'warn' }
      ].filter(Boolean)
    }, [
      '*UPDATE GAGAL*',
      '',
      ...gitErrDetail(pullErr),
      '',
      '💡 Kemungkinan ada file diedit langsung',
      '   di panel. Paling aman: edit di lokal',
      '   → push → .updatesc (atau reset repo)',
      '',
      `⏱️ *${fmtDur(Date.now() - t0)}*`,
      `🕒 ${nowWIB()}`
    ])
    // Tahap 2: config/thumbnail udah keburu di-reset ke HEAD di atas,
    // jadi setting user WAJIB dipulihkan balik.
    await sendRestoreCard(ctx)
    return
  }

  // ── Kode udah terbaru → tahap 2 (restore) dijalankan setelah kartu update ──
  const newHead = (await git(['rev-parse', 'HEAD'])).out
  let commits = [] // { hash, subject, body }
  let files = []
  try {
    // %x1f = unit sep, %x1e = record sep — subject & body aman dari newline
    const log = (
      await git(['log', '--format=%h%x1f%s%x1f%b%x1e', `${oldHead}..${newHead}`])
    ).out
    commits = log
      .split('\x1e')
      .map((rec) => rec.replace(/^\n+|\n+$/g, ''))
      .filter(Boolean)
      .map((rec) => {
        const [hash = '', subject = '', body = ''] = rec.split('\x1f')
        return { hash: hash.trim(), subject: subject.trim(), body: body.trim() }
      })
    files = (await git(['diff', '--name-only', `${oldHead}..${newHead}`])).out.split('\n').filter(Boolean)
  } catch {}

  // Auto npm install KUMULUAN kalau package manifest ikut berubah
  const { installed, installErr } = await npmInstallMaybe(
    ctx,
    files.includes('package.json') || files.includes('package-lock.json')
  )

  // Kategorin commit: fitur baru / fix / lainnya (dari subject + body)
  const categorize = (c) => {
    const t = `${c.subject} ${c.body}`.toLowerCase()
    if (/\b(fix|bug|perbaiki|perbaikan|patch|hotfix|repair|bugfix)\b/.test(t)) return 'fix'
    if (/\b(fitur|feature|feat|tambah|baru|new|port|redesign|enhance|update)\b/.test(t)) return 'feat'
    return 'other'
  }
  const groups = { feat: [], fix: [], other: [] }
  for (const c of commits) groups[categorize(c)].push(c)

  // Rekap — butuh restart gak?
  const needRestart = files.some(
    (f) => NEED_RESTART_RE.test(f) || f === 'sky.js' || f === 'config.js'
  )
  const onlyPlugins = files.length > 0 && files.every((f) => f.startsWith('plugins/'))

  const oldShort = oldHead.slice(0, 7)
  const newShort = newHead.slice(0, 7)

  await ctx.react(installErr ? '⚠️' : '✅')
  await replyRich(ctx, {
    icon: installErr ? '⚠️' : '🚀',
    title: 'UPDATE SELESAI',
    sub: `${commits.length} commit · ${files.length} file diperbarui`,
    pill: { t: installErr ? 'ADA ERROR' : 'SUKSES', cls: installErr ? 'warn' : 'ok' },
    head: `<div class="lbl">📌 <span>revisi</span></div>
<div class="meta"><span class="hash">${hesc(oldShort)}</span><span class="arrow">➜</span><span class="hash">${hesc(newShort)}</span><span>⏱️ <b>${hesc(fmtDur(Date.now() - t0))}</b></span><span>🌿 ${hesc(BRANCH)}</span></div>`,
    chips: [
      { e: '🆕', n: groups.feat.length, k: 'fitur' },
      { e: '🔧', n: groups.fix.length, k: 'fix' },
      { e: '📝', n: groups.other.length, k: 'lain' },
      { e: '📁', n: files.length, k: 'file' }
    ],
    sections: [
      groups.feat.length ? { icon: '🆕', label: 'FITUR BARU', items: groups.feat.map((c) => c.subject) } : null,
      groups.fix.length ? { icon: '🔧', label: 'FIX', items: groups.fix.map((c) => c.subject) } : null,
      groups.other.length ? { icon: '📝', label: 'LAINNYA', items: groups.other.map((c) => c.subject) } : null,
      files.length
        ? {
            icon: '📁',
            label: 'FILE BERUBAH',
            items: (() => {
              const byDir = {}
              for (const f of files) {
                const key = f.includes('/') ? `${f.split('/')[0]}/` : f
                byDir[key] = (byDir[key] || 0) + 1
              }
              return Object.keys(byDir).slice(0, 6).map((d) => `${d} · ${byDir[d]} file`)
            })()
          }
        : null
    ].filter(Boolean),
    stats: [
      { k: '📦 npm install', v: installed ? 'sukses' : installErr ? 'GAGAL' : 'lewati', cls: installed ? 'ok' : installErr ? 'bad' : 'dim' },
      needRestart
        ? { k: '🔁 aksi', v: 'RESTART di panel', cls: 'bad' }
        : onlyPlugins
          ? { k: '⚡ aksi', v: 'hot reload · gak perlu restart', cls: 'ok' }
          : { k: '✅ aksi', v: 'selesai', cls: 'ok' }
    ].filter(Boolean),
    notes: [
      cfgReset ? { t: '⚙️ config.js sempat di-reset ke<br>versi GitHub sebelum update.' } : null,
      needRestart
        ? { t: '🔁 Ada file <b>core/lib/handlers</b> berubah —<br><b>RESTART bot di panel</b> biar kebaca.', cls: 'warn' }
        : onlyPlugins
          ? { t: '⚡ Cuma <b>plugins/</b> — ke-hot-reload<br>sendiri, gak perlu restart.' }
          : { t: '✅ Update bersih, gak ada<br>perubahan berisiko.' }
    ].filter(Boolean),
    buttons: [{ t: '🕒 ' + nowWIB(), cls: '' }]
  }, [
    '*UPDATE SELESAI* ✅',
    '',
    `📌 \`${oldShort}\` ➜ \`${newShort}\``,
    `⏱️ *${fmtDur(Date.now() - t0)}* · 🌿 *${BRANCH}*`,
    '',
    `📊 ${groups.feat.length} 🆕 · ${groups.fix.length} 🔧 · ${groups.other.length} 📝 · ${files.length} 📁`,
    '',
    ...section('🆕 *FITUR BARU*', groups.feat),
    ...section('🔧 *FIX*', groups.fix),
    ...section('📝 *LAINNYA*', groups.other),
    ...fileSection(files),
    installed ? '📦 npm install *sukses*' : installErr ? '⚠️ npm install *gagal* (cek log)' : '📦 npm install *lewati*',
    needRestart
      ? '🔁 *RESTART* diperlukan (core/lib/handlers)'
      : onlyPlugins
        ? '⚡ Hot reload aktif · gak perlu restart'
        : '✅ Selesai',
    '',
    `🕒 ${nowWIB()}`
  ])
  // ── TAHAP 2: pulihin setting user (kartu terpisah) ──
  await sendRestoreCard(ctx)
}

export { pluginConfig as config, handler }

// buat pengujian (loader cuma baca `config` + `handler`)
export const _internals = {
  KEEP_FILES, KEEP_BAK, KEEP_BAK_DIR, readKeep, writeKeep, saveKeep, assetPristine,
  backupStatus, restoreFromBackup, normalizeBackup,
  autoRestore, pendingNow, sendRestoreCard,
  restoredNote,
  pendingCount, pendingStats, pendingNote, pendingLine,
  untgz
}
