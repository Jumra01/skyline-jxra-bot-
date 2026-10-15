# AGENTS.md — Panduan Agen untuk skyline-JXRA Bot

> Dokumen ini adalah **sumber kebenaran** untuk semua agen/AI yang mengedit bot
> di folder ini. Isinya: identitas proyek, **kemampuan yang diizinkan**,
> **larangan keras**, checklist verifikasi, dan **log aktivitas** yang wajib
> ditambahi setiap kali ada perubahan.

---

## 1. Identitas proyek

| Item | Nilai |
| --- | --- |
| Nama | **skyline-JXRA** (rebrand total 2026-10-15 dari base JH-Base / BotZapo) |
| Library WhatsApp | **`zapo-js`** (Zapo-JS) — **BUKAN Baileys, jangan pernah kembali ke Baileys** |
| Store | `@zapo-js/store-sqlite` → `session/state.sqlite` |
| Runtime | Node.js >= 20 (ESM, `"type": "module"`) — plain JavaScript, **tanpa TypeScript** |
| Entry point | `sky.js` |
| Konfigurasi | `config.js` (satu file, terpusat) |
| Perintah | `npm start` (=`node sky.js`), `npm run dev` (`node --watch sky.js`) |
| Hot reload | Aktif — edit file di `feat/` langsung tanpa restart (`core/hotReload.js`) |
| Deploy | PM2 (`pm2 start sky.js --name zapo`) |

Library inti yang terpasang: `zapo-js`, `@zapo-js/store-sqlite`,
`@zapo-js/media-utils`, `wreq-js`, `sharp`, `better-sqlite3`, `pino`,
`qrcode`, `node-webpmux`, `@napi-rs/canvas`, `axios`, `cheerio`, `puppeteer`,
`chokidar`, `syntax-error`.

### API gaya zapo (bukan Baileys)

```js
client.message.send(jadi, teksOpsi)   // kirim pesan (string / objek proto / richMessage)
client.group.queryGroupMetadata(jad)  // metadata grup
client.profile.getLidsByPhoneNumbers()// resolusi LID <-> nomor
client.auth.getState()                // { registered: true } kalau sudah pairing
client.on('message', async (event) => { ... })
```

- Identitas datang dalam dua bentuk: **PN** (`@s.whatsapp.net`) dan **LID**
  (`@lid`). Selalu tangani keduanya (baca `ctx.sender` + `ctx.senderLid`).
- Event memakai `event.key.participant / participantAlt / remoteJidAlt`.

---

## 2. Struktur folder & zona keselamatan

```
sky.js        # Entry point — JANTUNG. Hati-hati. Komentar wajib dijaga.
config.js     # Semua pengaturan bot (prefix, staff, sticker, antilink, dll)
auth/         # QR, pairing code, connection manager (reconnect/backoff)
core/         # logger, database, context, permission, cooldown, staff,
              # presence, groupSettings, hotReload, rpg, quest, dll
lib/          # richMessage, sticker (EXIF), brat, iqc, album, carousel, UNO, WW
handlers/     # messageHandler (routing), group, antilink, game, menfess, error
feat/         # ★ ETALEASE — semua command, auto-load rekursif oleh feat/loader.js
src/          # ws/mediaServer, data, rewards, rpg
session/      # KREDENSIAL + DB (gitignored — JANGAN disentuh/dikirim)
auth/ , cache/ , scraper/ , node_modules/
```

**Prinsip:** `auth/`, `core/`, `lib/`, `handlers/`, `src/ws` = **dapur**
(jarang disentuh, perubahan harus kecil & terukur).
`feat/` = **etalase** (tempat aman untuk fitur baru).

---

## 3. Kemampuan agen (yang MATANG diizinkan untuk update script)

Agen boleh dan diharapkan mampu melakukan hal berikut, **dengan urutan
workflow yang benar**:

### 3.1 Menambah command baru (jalur utama, paling aman)
1. Buat file baru di `feat/<kategori>/<nama>.js` (`.js` ESM, auto-load).
2. Format wajib:
   ```js
   export default {
     name: 'halo',            // wajib, huruf kecil
     aliases: ['hi'],         // opsional, wajib unik
     tags: 'general',         // kategori: general|group|downloader|rpg|game|
                              // sticker|media|ai|tools|owner|interactive
     description: '...',      // untuk .menu
     owner: true,             // opsional: khusus owner
     admin: true,             // opsional: owner/admin bot
     cooldown: 5000,          // opsional: ms (default config.cooldown = 3000)
     async run(ctx) { ... }
   }
   ```
3. Header komentar mengikuti gaya file lain (kredit `© skyline-JXRA` +
   deskripsi 1–2 baris fungsi file).
4. Verifikasi (lihat §5) sebelum selesai.

### 3.2 Memakai `ctx` (sumber kebenaran: `core/context.js`)
`ctx`: `client`, `event`, `chat`, `sender`, `senderLid`, `senderNumber`,
`pushName`, `isGroup`, `isOwner`, `isAdmin`, `isStaff`, `role`, `mentioned`,
`body`, `command`, `args`, `text`, `prefix`, `receivedAt`,
dan method `reply()`, `react()`, `replyButtons()`, `replyList()`.

### 3.3 API inti yang boleh dipakai fitur
- **Permission**: `isGroupAdmin(ctx)` (`core/permission.js`).
- **DB**: `getUser`, `touchUser`, `incrementCommand`, `topUsers`,
  `setBanned` (`core/database.js`) — plus helper RPG (`core/rpg.js`,
  `core/shop.js`, `core/questEngine.js`, `core/combat.js`).
- **Rich message**: `richButtons()`, `richList()`, `readRichReply()`,
  `onRichReply(id, handler)` (`lib/richMessage.js` +
  `handlers/messageHandler.js`). Selalu pakai `ctx.replyButtons/List`
  atau `onRichReply` untuk respons tombol/list — **bukan** tombol lama.
- **Media/stiker**: `lib/sticker.js` (`imageToSticker`, `gifToSticker`,
  `videoToSticker`, `buildSticker` + EXIF pack dari config).
- **Presence**: `sendTyping`, `markRead` (biasanya sudah ditangani router).
- **Group settings toggle per-grup**: `isOn` / `setOn` (`core/groupSettings.js`)
  — wajib untuk fitur yang masuk `config.toggleable`.
- **Logging**: `logger` / `clientLogger` dari `core/logger.js`
  (`logger.info/warn/error/success`).

### 3.4 Mengedit file yang ada
- `config.js`: menambah prefix, staff, toggleable, blacklist antilink,
  opsi sticker — aman, selama tidak menghapus kunci lain.
- `feat/**`: menambah/merapikan command, memperbaiki bug fitur.
- `lib/**`: memperbaiki bug atau menambah helper baru (dengan import yang
  benar relatif terhadap lokasi file).
- `handlers/**` & `core/**`: **hanya perubahan kecil & terukur**, pahami
  alur routing dulu (`route()` di `handlers/messageHandler.js`), dan
  pastikan tidak merusak permission/anti-spam/cooldown.
- `sky.js`: **hindari**; hanya bila perubahan menyentuh wiring event /
  bootstrap, dan wajib komentar + catat di log.

### 3.5 Verifikasi & pengujian
- Cek sintaks semua file yang disentuh (§5).
- Cek bentrok `name`/`aliases` antar-fitur (loader menolak duplikat).
- Hot reload aktif: perubahan `feat/` dipickup otomatis; pantau log
  (`npm run dev` atau `pm2 logs zapo`) untuk baris
  `feature dimuat ... (n gagal)`.

### 3.6 Pencatatan
- Setiap perubahan **wajib** dicatat di **§6 Log Aktivitas** (append, jangan
  menghapus entri lama).

---

## 4. LARANGAN (hard rules — tidak boleh dilanggar)

1. **JANGAN ganti library ke Baileys.** Proyek ini pakai **`zapo-js`**.
   Jangan import `@whiskeysockets/baileys`, jangan tulis API gaya Baileys
   (`makeWASocket`, `sendMessage(conn, jid, ...)`, `creds.update`, dll).
2. **JANGAN sentuh `session/`** — berisi kredensial Noise & `state.sqlite`.
   Dilarang membaca/mengubah/menghapus/meng-commit isi folder ini.
3. **JANGAN commit/menampilkan kredensial atau API key** apa pun
   (`config.js`, env, token scraper). Jangan menaruh rahasia di kode.
4. **JANGAN menghapus kredit** komentar `© skyline-JXRA` / credit README —
   itu permintaan pemilik repo.
5. **JANGAN mengubah `sky.js`, `auth/`, `core/`, `handlers/` secara besar**
   tanpa permintaan eksplisit; jangan merestruktur folder.
6. **JANGAN menghapus/menurunkan proteksi**: anti-spam (`checkFlood`),
   cooldown, permission (`feature.owner/admin`), cek ban, error handler,
   LID/PN resolution, atau deteksi admin grup.
7. **JANGAN menonaktifkan hot reload, auto-read, reconnect/backoff,
   graceful shutdown** tanpa alasan & izin.
8. **JANGAN menambah dependency baru sembarangan** — cek dulu apakah sudah
   ada library sejenis di `package.json`. Jangan menambah paket besar
   (puppeteer dll) tanpa kebutuhan nyata.
9. **JANGAN memakai TypeScript / bundler / perubahan `"type": "module"`**
   — seluruh codebase plain JS ESM dengan `import` path relatif
   (`.js` wajib ditulis di path import).
10. **JANGAN mengubah mekanisme auth** (QR/pairing code custom) atau
    memaksa pairing ulang yang bisa kena anti-abuse WhatsApp.
11. **JANGAN mengirim pesan massal / spam / fitur broadcast ke banyak
    chat** tanpa izin; jangan auto-kirim ke grup yang tidak terkait.
12. **JANGAN menghapus file `.bak` / file lain milik user** yang bukan bagian
    dari perintah — termasuk yang ada di `.gitignore`.
13. **JANGAN commit, push, atau menjalankan `pm2 restart/stop/start`
    tanpa diminta.** (Edit saja; verifikasi lewat cek sintaks/log.)
14. **JANGAN mengubah `.gitignore`** agar `session/` ikut ter-commit.
15. **JANGAN membiarkan file gagal load** — kalau menambah/ubah file dan
    loader melaporkan gagal, itu dianggap pekerjaan belum selesai.
16. **JANGAN mengubah endpoint/API/aset eksternal** milik base aslinya saat
    rebranding. Daftar terlindungi (sudah diganti nama = rusak):
    - `*.jhx.my.id` (`api.`, `cap.`, `proxy.`, `audio.`, `/yhdl/`, `/yt-search`)
      — `scraper/*`, `feat/downloader/*`, `config.wsWorkerUrl`.
    - `raw.githubusercontent.com/JamvanHax0r/UNO-Cards/*`
      (`lib/UNOEngine.js`, `lib/emojiRenderer.js`) — aset kartu UNO & emoji.
    - `User-Agent: FionyBot/1.0` di `feat/ai/fio.js`.
    - Tautan repo sendiri (README clone, tombol demo `ctest.js`, bantuan
      `fio.js`) = `github.com/raaxml01/skyline-jxra-bot-` — jangan dikembalikan
      ke URL base aslinya.
    Nama tampilan/branding (FionyVerse, Fiony Bot, JamvanHax0r, JH-Base,
    BotZapo, FIONY AI) sudah diganti **skyline-JXRA**; nama orang
    (Fiony Alveria, JKT48, XN, Arip, JHPremix) tetap seperti aslinya.

---

## 5. Checklist verifikasi (wajib sebelum menyatakan selesai)

```bash
# 1. Sintaks file yang disentuh (exit != 0 = gagal)
node --check <file.js>          # ulangi untuk tiap file yang diubah/dibuat

# 2. Kalau menambah/mengubah file feat/, cek tidak ada error import/shape
#    (jalankan di kondisi aman, pantau log startup)
node --check feat/**/<file>.js  # atau:
npm run dev                     # node --watch sky.js (hot reload aktif)

# 3. Cek bentrok command/alias secara manual bila perlu
grep -rn "name: '" feat/        # nama & alias harus unik antar file
```

Pantau log: sukses = `N feature dimuat dari M file` tanpa `(n gagal)`.
Kalau ada `[import]`, `[validate]`, atau `[conflict]` → perbaiki dulu.

---

## 6. Log Aktivitas (append-only — JANGAN hapus entri lama)

Format entri:
`YYYY-MM-DD | <kategori: fitur|fix|config|docs|infra|riset> | <file/dir> | <ringkasan> | <status: ok|partial>`

| Tanggal | Kategori | File | Ringkasan | Status |
| --- | --- | --- | --- | --- |
| 2026-10-15 | docs | AGENTS.md | Membuat AGENTS.md: identitas proyek (zapo-js, bukan Baileys), zona folder, kemampuan update script, larangan, checklist verifikasi, dan log aktivitas ini | ok |
| 2026-10-15 | riset | (seluruh repo) | Pemetaan awal: struktur `auth/ core/ lib/ handlers/ feat/ src/`, feature shape di `feat/loader.js`, API `ctx` di `core/context.js`, routing di `handlers/messageHandler.js`, rich message di `lib/richMessage.js`, konfigurasi di `config.js`, entry `sky.js` | ok |
| 2026-10-15 | docs | (seluruh repo, 166 file) | Rebrand total nama proyek & kredit: FionyVerse/Fiony Bot → skyline-JXRA, credit © JamvanHax0r → © skyline-JXRA, JH-Base/BotZapo → skyline-JXRA (package.json, README, config.botName, footer pesan, EXIF stiker, header komentar). API/endpoint eksternal `*.jhx.my.id`, aset UNO GitHub, User-Agent & tautan repo TIDAK diubah (dilindungi, lihat §4.16); nama orang (Fiony Alveria/JKT48/XN/Arip) tetap | ok |
| 2026-10-15 | docs | README.md, feat/tools/ctest.js, feat/ai/fio.js, AGENTS.md | Ganti tautan repo ke repo milik owner `github.com/raaxml01/skyline-jxra-bot-` (clone README, tombol demo ctest, teks bantuan fio) | ok |

> Tambahkan baris baru di **bawah** tabel ini setiap kali ada aktivitas
> (edit fitur, perbaikan bug, perubahan config, dsb).

---

## 7. Catatan operasional singkat

- Pairing: `config.auth.method` = `auto | qr | pairing`; code custom
  (`customCode`) hanya untuk pairing.
- Prefix default: `.` (plus `! / # , 😁 🕊`) — daftar di `config.prefixes`.
- Staff/role ada di `config.staff` (`owner` / `admin`), dicocokkan via
  nomor & LID (`core/staff.js`).
- Toggleable per grup (`config.toggleable`): `welcome`, `bye`, `antilink`,
  `game` — hanya admin grup/staff yang boleh mengubah.
- Owner-only meta handler di `sky.js`: prefix `=> ` (eval) dan `$` (exec)
  — **tidak boleh disentuh/dipakai selain owner**.
- Error pada satu fitur tidak boleh mematikan bot (sudah ditangani
  `handlers/errorHandler.js` + try/catch di `route()`).
