/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * database.js — Database abstraction untuk skyline-JXRA
 * [UPDATE AND FIX BELOW]
 *
 * Wallet reward (gold/xp/gems) = SATU dompet buat seluruh ekonomi RPG.
 * Emerald 🟩 = mata uang command (biaya per command + regen + riwayat log).
 */
import Database from 'better-sqlite3'
import { logger } from './logger.js'
import { dbPath } from './dataDir.js'
import config from '../config.js'

// DB user/premium di ./data/ (bukan session/) — session/ cuma buat kredensial auth,
// jadi data user gak ikut hilang kalau session/ dihapus buat pairing ulang.
const db = new Database(dbPath('users.sqlite'))

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    jid TEXT PRIMARY KEY,
    name TEXT,
    first_seen INTEGER,
    last_seen INTEGER,
    command_count INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    gold INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    gems INTEGER DEFAULT 0,
    emerald INTEGER DEFAULT 0,
    emerald_regen_at INTEGER DEFAULT 0,
    daily_claim_at INTEGER DEFAULT 0,
    emerald_notify INTEGER DEFAULT 1
  )
`)

// [UPDATE] Premium pindah ke table sendiri (terpisah dari users).
db.exec(`
  CREATE TABLE IF NOT EXISTS premiumdb (
    jid TEXT PRIMARY KEY,
    until INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER
  )
`)

try { db.exec(`ALTER TABLE users ADD COLUMN gold INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN gems INTEGER DEFAULT 0`) } catch {}

// [UPDATE] Emerald 🟩 — kolom saldo + regen lazy + klaim daily + toggle notif.
try { db.exec(`ALTER TABLE users ADD COLUMN emerald INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN emerald_regen_at INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN daily_claim_at INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN emerald_notify INTEGER DEFAULT 1`) } catch {}

// [UPDATE] Riwayat pemakaian emerald per command (buat notif + .riwayat).
db.exec(`
  CREATE TABLE IF NOT EXISTS emerald_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT NOT NULL,
    cmd TEXT,
    cost INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_emerald_log_jid ON emerald_log(jid, at)`)

// Migrasi: kolom lama users.premium_until (kalau masih ada) → premiumdb, lalu drop.
try { db.exec(`ALTER TABLE users ADD COLUMN premium_until INTEGER DEFAULT 0`) } catch {}
try {
  db.exec(`
    INSERT OR IGNORE INTO premiumdb (jid, until)
    SELECT jid, premium_until FROM users WHERE premium_until > 0
  `)
  db.exec(`ALTER TABLE users DROP COLUMN premium_until`)
} catch {}

export function getUser(jid) {
  return db.prepare('SELECT * FROM users WHERE jid = ?').get(jid)
}

export function touchUser(jid, name) {
  const now = Date.now()
  const existing = getUser(jid)

  if (!existing) {
    db.prepare(
      'INSERT INTO users (jid, name, first_seen, last_seen, command_count, banned, gold, xp, gems) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0)'
    ).run(jid, name ?? null, now, now)
  } else {
    db.prepare(
      'UPDATE users SET last_seen = ?, name = COALESCE(?, name) WHERE jid = ?'
    ).run(now, name ?? null, jid)
  }

  return getUser(jid)
}

export function incrementCommand(jid) {
  db.prepare('UPDATE users SET command_count = command_count + 1 WHERE jid = ?').run(jid)
}

export function setBanned(jid, banned) {
  const res = db.prepare('UPDATE users SET banned = ? WHERE jid = ?').run(banned ? 1 : 0, jid)
  return res.changes > 0
}

export function topUsers(limit = 10) {
  return db.prepare('SELECT * FROM users ORDER BY command_count DESC LIMIT ?').all(limit)
}

export function totalUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c
}

/* ---------- [UPDATE] Wallet RPG (satu dompet) ---------- */

export function getBalance(jid) {
  touchUser(jid, null)
  const row = db.prepare('SELECT gold, xp, gems FROM users WHERE jid = ?').get(jid)
  return { gold: row.gold, xp: row.xp, gems: row.gems, emerald: getEmerald(jid) }
}

export function addReward(jid, { gold = 0, xp = 0, gems = 0, emerald = 0 } = {}) {
  touchUser(jid, null)
  db.prepare(
    'UPDATE users SET gold = gold + ?, xp = xp + ?, gems = gems + ? WHERE jid = ?'
  ).run(gold, xp, gems, jid)
  if (emerald > 0) addEmerald(jid, emerald)
  return getBalance(jid)
}

/* ---------- [UPDATE] EMERALD 🟩 — saldo command ---------- */

/** Batas saldo emerald dari config (default 64 ala stack Minecraft). */
function emeraldMax() {
  return Math.max(1, Number(config.emerald?.max) || 64)
}

/**
 * Saldo emerald + regen LAZY: tiap `regen.intervalMs` (default 10 menit)
 * nambah `regen.amount` (default 10), berhenti di cap. Sisa waktu antar
 * tick disimpan (gak kebuang, gak ke-burst) — tanpa timer sama sekali.
 */
export function getEmerald(jid) {
  touchUser(jid, null)
  const max = emeraldMax()
  const amount = Math.max(0, Number(config.emerald?.regen?.amount) || 10)
  const interval = Math.max(1000, Number(config.emerald?.regen?.intervalMs) || 600_000)
  const row = db.prepare('SELECT emerald, emerald_regen_at FROM users WHERE jid = ?').get(jid)
  let balance = row?.emerald ?? 0
  const now = Date.now()
  let at = row?.emerald_regen_at ?? 0

  if (!at) {
    db.prepare('UPDATE users SET emerald_regen_at = ? WHERE jid = ?').run(now, jid)
    return balance
  }

  const elapsed = now - at
  if (elapsed >= interval) {
    const ticks = Math.floor(elapsed / interval)
    balance = Math.min(max, balance + ticks * amount)
    db.prepare('UPDATE users SET emerald = ?, emerald_regen_at = ? WHERE jid = ?')
      .run(balance, at + ticks * interval, jid)
  }
  return balance
}

/** Tambah saldo (dibatasi cap). Mengembalikan saldo baru. */
export function addEmerald(jid, amount) {
  touchUser(jid, null)
  const n = Math.floor(Number(amount) || 0)
  if (n <= 0) return getEmerald(jid)
  db.prepare('UPDATE users SET emerald = MIN(?, emerald + ?) WHERE jid = ?')
    .run(emeraldMax(), n, jid)
  return db.prepare('SELECT emerald FROM users WHERE jid = ?').get(jid).emerald
}

/** Potong saldo ATOMIC — null kalau gak cukup. Mengembalikan sisa. */
export function spendEmerald(jid, amount) {
  touchUser(jid, null)
  const n = Math.floor(Number(amount) || 0)
  if (n <= 0) return getEmerald(jid)
  const res = db.prepare(
    'UPDATE users SET emerald = emerald - ? WHERE jid = ? AND emerald >= ?'
  ).run(n, jid, n)
  if (!res.changes) return null
  return db.prepare('SELECT emerald FROM users WHERE jid = ?').get(jid).emerald
}

/**
 * Klaim hadiah harian. Hasil:
 *  { ok, amount, emerald, max } |
 *  { error: 'cooldown', remainingMs } |
 *  { error: 'full', emerald, max }  (saldo penuh — mending dipakai dulu)
 */
export function claimDaily(jid) {
  touchUser(jid, null)
  const max = emeraldMax()
  const amount = Math.max(0, Number(config.emerald?.daily?.amount) || 30)
  const cd = Math.max(1000, Number(config.emerald?.daily?.cooldownMs) || 86_400_000)
  const now = Date.now()
  const row = db.prepare('SELECT emerald, daily_claim_at FROM users WHERE jid = ?').get(jid)
  const last = row?.daily_claim_at ?? 0

  if (last && now - last < cd) {
    return { error: 'cooldown', remainingMs: cd - (now - last) }
  }
  if ((row?.emerald ?? 0) >= max) {
    return { error: 'full', emerald: row.emerald, max }
  }

  db.prepare('UPDATE users SET emerald = MIN(?, emerald + ?), daily_claim_at = ? WHERE jid = ?')
    .run(max, amount, now, jid)
  const emerald = db.prepare('SELECT emerald FROM users WHERE jid = ?').get(jid).emerald
  return { ok: true, amount, emerald, max }
}

/** Catat pemakaian emerald (ledger — tetap dicatat walau notif mati). */
export function logEmeraldUse(jid, cmd, cost) {
  const now = Date.now()
  db.prepare('INSERT INTO emerald_log (jid, cmd, cost, at) VALUES (?, ?, ?, ?)')
    .run(jid, String(cmd ?? '?'), Math.floor(Number(cost) || 0), now)
  // prune entri > 30 hari (biar table gak membengkak)
  db.prepare('DELETE FROM emerald_log WHERE at < ?').run(now - 30 * 86_400_000)
}

/** N entri riwayat terbaru (terlama di bawah). */
export function getEmeraldHistory(jid, limit = 15) {
  return db.prepare(
    'SELECT cmd, cost, at FROM emerald_log WHERE jid = ? ORDER BY at DESC, id DESC LIMIT ?'
  ).all(jid, Math.max(1, Math.floor(limit)))
}

/** Statistik pemakaian: hari ini / total / fitur paling sering. */
export function emeraldStats(jid) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const t0 = dayStart.getTime()
  const today = db.prepare(
    'SELECT COUNT(*) AS c, COALESCE(SUM(cost), 0) AS s FROM emerald_log WHERE jid = ? AND at >= ?'
  ).get(jid, t0)
  const all = db.prepare(
    'SELECT COUNT(*) AS c, COALESCE(SUM(cost), 0) AS s FROM emerald_log WHERE jid = ?'
  ).get(jid)
  const fav = db.prepare(
    'SELECT cmd, COUNT(*) AS c FROM emerald_log WHERE jid = ? GROUP BY cmd ORDER BY c DESC LIMIT 1'
  ).get(jid)
  return {
    todayCount: today.c, todaySpent: today.s,
    totalCount: all.c, totalSpent: all.s,
    favorite: fav?.cmd ?? null, favoriteCount: fav?.c ?? 0,
  }
}

/** Notif emerald per-user (default ON). */
export function isEmeraldNotifyOn(jid) {
  touchUser(jid, null)
  const row = db.prepare('SELECT emerald_notify FROM users WHERE jid = ?').get(jid)
  return (row?.emerald_notify ?? 1) === 1
}

export function setEmeraldNotify(jid, on) {
  touchUser(jid, null)
  db.prepare('UPDATE users SET emerald_notify = ? WHERE jid = ?').run(on ? 1 : 0, jid)
  return on
}

/** [FIX] Bayar pakai gold. null kalau gak cukup. */
export function spendGold(jid, amount) {
  touchUser(jid, null)
  const row = db.prepare('SELECT gold FROM users WHERE jid = ?').get(jid)
  if (!row || row.gold < amount) return null
  db.prepare('UPDATE users SET gold = gold - ? WHERE jid = ?').run(amount, jid)
  return getBalance(jid)
}

export function topByXP(limit = 10) {
  return db.prepare('SELECT * FROM users ORDER BY xp DESC LIMIT ?').all(limit)
}

export function topByGold(limit = 10) {
  return db.prepare('SELECT * FROM users ORDER BY gold DESC LIMIT ?').all(limit)
}

/* ---------- [UPDATE] PREMIUM USER — table `premiumdb` (terpisah dari users) ---------- */

/** Tambah/kalibrasi premium. `durationMs` ditambahkan ke sisa waktu lama (kalau masih aktif). */
export function addPremium(jid, durationMs) {
  const now = Date.now()
  const current = getPremiumUntil(jid)
  const base = current > now ? current : now
  const until = base + Math.max(0, Math.round(durationMs))
  db.prepare(`
    INSERT INTO premiumdb (jid, until, added_at) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET until = excluded.until
  `).run(jid, until, now)
  return until
}

export function removePremium(jid) {
  const res = db.prepare('DELETE FROM premiumdb WHERE jid = ?').run(jid)
  return res.changes > 0
}

/** Timestamp expiry (epoch ms). 0 kalau tidak pernah/kedaluwarsa. */
export function getPremiumUntil(jid) {
  const row = db.prepare('SELECT until FROM premiumdb WHERE jid = ?').get(jid)
  return row?.until ?? 0
}

export function isPremiumActive(jid) {
  return getPremiumUntil(jid) > Date.now()
}

/** Semua user premium yang masih aktif. */
export function listPremium() {
  return db
    .prepare(`
      SELECT p.jid, p.until, u.name
      FROM premiumdb p LEFT JOIN users u ON u.jid = p.jid
      WHERE p.until > ? ORDER BY p.until DESC
    `)
    .all(Date.now())
}

/** Semua jid PN (nomor asli) yang pernah tercatat — buat batch resolve LID → PN. */
export function allPnJids() {
  return db
    .prepare(`SELECT jid FROM users WHERE jid LIKE '%@s.whatsapp.net'`)
    .all()
    .map((r) => r.jid)
}
