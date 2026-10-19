/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * config.js — Centralized configuration untuk skyline-JXRA
 */

export default {
  /* ════════════════════════════════════════════
   *  BOT
   * ════════════════════════════════════════════ */
  botName: 'skyline-JXRA',

  /* ════════════════════════════════════════════
   *  BANNER CONSOLE (tampilan saat bot start)
   *  ASCII art auto di-generate dari `words` —
   *  tinggal ganti/tekan kata, huruf besar/kecil bebas.
   *  align: 'left' | 'right' | 'center'
   *  (hapus blok ini = balik ke default SKYLINE / JXRA)
   * ════════════════════════════════════════════ */
  banner: {
    words: [
      { text: 'SKYLINE', align: 'left' },
      { text: 'JXRA', align: 'right' },
    ],
    tagline: '⚡ next-gen WhatsApp bot · powered by zapo-js',
  },

  /* ════════════════════════════════════════════
   *  AUTH
   *  method: 'auto'     → pilih QR / pairing via menu saat start
   *           'qr'      → langsung QR
   *           'pairing' → langsung pairing code
   *  pairingNumber WAJIB diisi (format 628xxx) kalau mau pairing
   *  code jalan otomatis (terutama via PM2 / non-interaktif).
   * ════════════════════════════════════════════ */
  auth: {
    method: 'auto',
    pairingNumber: '',      // contoh: '6281234567890' (kosong = fallback QR)
    useCustomCode: true,
    customCode: 'JHXFNY48', // 8 karakter: 1-9 & A-Z tanpa I, O, U
  },

  /* ════════════════════════════════════════════
   *  PERINTAH & PREFIX
   * ════════════════════════════════════════════ */
  mainPrefix: '.',
  prefixes: ['.', '!', '/', '#', ',', '😁', '🦅'],

  /* ════════════════════════════════════════════
   *  OWNER (cukup isi nomor di sini — format bebas:
   *  628xxx / 08xxx / +628xxx / 628xxx@s.whatsapp.net
   *  Nomor bot sendiri otomatis jadi owner.
   * ════════════════════════════════════════════ */
  owner: {
    name: 'skyline-JXRA Developer',
    numbers: ['6283121590572'],
  },

  /* ════════════════════════════════════════════
   *  STAFF (opsional — buat label & role admin)
   *  role: 'owner' | 'admin' — dicocokkan via nomor & LID
   * ════════════════════════════════════════════ */
  staff: [
    { number: '6283121590572', role: 'owner', label: 'skyline-JXRA • Developer' },
    { number: '6283121590572', role: 'owner', label: 'JHPremix • Developer' },
    { number: '6283121590572', lid: '203186329669748', role: 'owner', label: 'Arip • Owner' },
    { number: '6283121590572', role: 'admin', label: 'XN • Staff Admin' },
  ],

  /* ════════════════════════════════════════════
   *  PREMIUM — daftar & expiry disimpan di table
   *  database `premiumdb` (data/users.sqlite,
   *  TERPISAH dari session/ biar aman dari re-pair),
   *  diatur via command owner:
   *  .addprem <nomor> <durasi> / .delprem / .premlist
   * ════════════════════════════════════════════ */

  /* ════════════════════════════════════════════
   *  GRUP
   * ════════════════════════════════════════════ */
  // Fitur grup on/off per grup (hanya admin grup / staff yang boleh ubah)
  toggleable: ['welcome', 'bye', 'antilink', 'game'],

  // Domain yang dihapus oleh antilink (default; bisa di-override per grup).
  // Selain daftar ini = boleh.
  antilink: {
    defaultBlacklist: 'wa.me,chat.whatsapp.com,t.me,telegram.me',
  },

  /* ════════════════════════════════════════════
   *  STICKER
   * ════════════════════════════════════════════ */
  sticker: {
    packName: 'Made with',
    author: 'skyline-JXRA♡',
    withExif: true,
    maxVideoSeconds: 10,
  },

  /* ════════════════════════════════════════════
   *  SPOTIFY (opsional — buat `.spotify <judul>`)
   *  Search pakai Spotify Web API, butuh app
   *  kredensial (gratis) dari:
   *    https://developer.spotify.com/dashboard
   *  JANGAN tulis rahasia di file ini (ke-commit!).
   *  Set lewat environment variable:
   *    SPOTIFY_CLIENT_ID
   *    SPOTIFY_CLIENT_SECRET
   *  (Pterodactyl: tab Startup → Environment Variables)
   *  Field di bawah cuma fallback kalau env kosong.
   *  Kosong = search by judul mati, tapi
   *  `.spotify <link Spotify>` tetap jalan.
   * ════════════════════════════════════════════ */
  spotify: {
    clientId: '',
    clientSecret: '',
  },

  /* ════════════════════════════════════════════
   *  OMNI EDITOR (edit gambar AI)
   *  Backend skyline.web.id — dipakai plugins/ai/omniedit.js (.omniedit)
   *  `apikey` SENGAJA DIKOSONGKAN — tiap orang isi punya mereka
   *  sendiri, dibuat di skyline.web.id. Kalau kosong, `.omniedit`
   *  nolak & nyuruh bikin key dulu.
   *  Buat deploy panel, gak perlu edit config — pakai env:
   *    OMNI_API_KEY / OMNI_WEBSITE
   * ════════════════════════════════════════════ */
  omniedit: {
    website: 'https://skyline.web.id',
    apikey: '',
  },

  /* ════════════════════════════════════════════
   *  AI CHAT (.bot) — chat AI yang INGET riwayat obrolan
   *  OTAK: **Gemini web** (lib/geminiWeb.js) — TANPA API key & tanpa kredit,
   *  cukup server ada internet. Pola sama dengan auto-ai skyline-md.
   *    • Multi-turn asli (session resumeArray+cookie disimpan per user)
   *    • Kalau Gemini ubah web-nya sampai gagal dibaca → bot balas pesan
   *      ramah, tinggal update `lib/geminiWeb.js`.
   *  PERSONA: file `data/ai-persona.txt` atau command `.setpersona`.
   *  Default: Bella Clarissa (Bell409) — lihat `lib/aiPersona.js`.
   *  MEMORI JANGKA PANJANG (`remember`): catatan fakta penting tentang user
   *  (`data/ai-memory.json` — file kecil, otomatis di-prune: maks 25 fakta/user,
   *  500 user terakhir). Pola kalimat ditangkap INSTAN tanpa panggilan AI;
   *  `rememberEvery` = tiap berapa pesan AI dipakai ngerapihin fakta (jalan di
   *  belakang layar, gak nambah delay balasan; 0 = matiin yang ini juga).
   *  AUTO-BALAS (tanpa prefix): `mentionTrigger` = bot di-tag/di-@ nomornya,
   *  `replyTrigger` = pesan bot DIBALES (quote/swipe-reply) → dua-duanya
   *  dianggap ngajak ngobrol. Matiin salah satu kalau berisik di grup.
   * ════════════════════════════════════════════ */
  aiChat: {
    enabled: true,        // matiin total kalau lagi gak mau pakai
    maxHistory: 20,       // jumlah pesan riwayat per user (user + assistant)
    timeoutMs: 60_000,    // batas tunggu balasan AI (ms)
    mentionTrigger: true, // balas otomatis kalau nomor bot di-tag (tanpa prefix)
    replyTrigger: true,   // balas juga kalau pesan bot DIBALES (quote/swipe-reply)
    remember: true,       // nyatet fakta penting tentang user (memori jangka panjang)
    rememberEvery: 8,     // tiap N pesan, rapihin fakta pakai AI (0 = cuma pola instan)
    systemPrompt: '',     // kosong → pakai data/ai-persona.txt / default (Bella)
  },

  /* ════════════════════════════════════════════
   *  WORKER / WEBSOCKET (media)
   * ════════════════════════════════════════════ */
  wsWorkerUrl: 'wss://audio.jhx.my.id/wss/audio',
  wsPort: 8090,
  wsPath: '/wss/audio',
  // Host bind server MediaWS lokal.
  // '127.0.0.1' = cuma bisa diakses dari dalam VPS (aman, anti open-proxy/SSRF).
  // Set '0.0.0.0' HANYA kalau memang perlu diakses dari luar + sudah ada firewall.
  wsHost: '127.0.0.1',
  // Token opsional buat client yang connect (`?token=...`).
  // Kosong = tanpa token (asumsi host sudah dibatasi ke localhost).
  wsToken: '',

  /* ════════════════════════════════════════════
   *  ANTI-SPAM & COOLDOWN
   * ════════════════════════════════════════════ */
  antiSpam: {
    enabled: true,
    max: 5,        // maks pesan dalam windowMs sebelum mute
    windowMs: 10_000,
    muteMs: 30_000,
  },
  cooldown: 3000,  // jeda antar command per user (ms)

  /* ════════════════════════════════════════════
   *  EMERALD 🟩 (mata uang command — ala trading Minecraft)
   *  Tiap command user biasa bayar defaultCost emerald
   *  (owner/staff/premium bebas). Biaya per command bisa
   *  dioverride lewat field `energi:` di config plugin.
   *  Sumber: regen (+amount / interval), .daily, reward RPG
   *  (battle/quest/jual barang). Saldo numpuk maks `max`.
   *  Notif pemakaian (kartu HTML native): .notife on/off.
   *  Riwayat: .riwayat
   * ════════════════════════════════════════════ */
  emerald: {
    enabled: true,        // matikan total → semua command jadi gratis
    defaultCost: 1,       // biaya default tiap command (override: `energi:` di plugin)
    max: 64,              // batas saldo (ala stack Minecraft)
    notify: true,         // master notif: true | false | 'private' (cuma chat pribadi)
    regen: {
      amount: 10,         // tambahan saldo per tick regen
      intervalMs: 600_000, // tiap 10 menit (dihitung lazy, tanpa timer)
    },
    daily: {
      amount: 30,         // hadiah .daily
      cooldownMs: 86_400_000, // 24 jam
    },
    reward: {
      // emerald per battle menang, sesuai tier monster
      battle: { common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 5 },
      questDiv: 10,       // emerald quest = floor(gold / 10)
      sellDiv: 20,        // emerald jual barang = floor(gold / 20), min 1
    },
  },

  /* ════════════════════════════════════════════
   *  PRESENCE
   * ════════════════════════════════════════════ */
  autoRead: false,
  // Indikator "typing…" (bot kelihatan sedang mengetik) — bikin bot kerasa
  // hidup, penting buat fitur yang mikir lama (AI `.bot` 3-6 detik).
  typingPresence: true,

  /* ════════════════════════════════════════════
   *  HOT RELOAD
   *  Auto reload command di plugins/ tiap file baru/edit/hapus.
   *  Gak perlu restart bot/server.
   * ════════════════════════════════════════════ */
  hotReload: {
    enabled: true,
    debounceMs: 400,   // jeda nunggu (ms) biar gak reload berkali-kali pas nyimpen beruntun
    notifyOwner: false, // kirim WA ke owner tiap kali hot reload kejadian
  },

  /* ════════════════════════════════════════════
   *  REACT CHANNEL
   *  Auto-react postingan baru di channel khusus bot,
   *  + command .rch buat react manual ke postingan channel manapun.
   * ════════════════════════════════════════════ */
  reactChannel: {
    enabled: true,
    dedicatedChannelUrl: 'https://whatsapp.com/channel/0029Vb8Tph9BVJl06WWw5q3B',
    emojis: ['🔥', '❤️', '😍', '👍', '😂', '🥳', '💯', '✨'],
  },

  /* ════════════════════════════════════════════
   *  KARTU GLOBAL (externalAdReply):
   *  Thumbnail + judul yang nempel di atas bubble balasan bot
   *  (ctx.reply — semua chat; lihat core/cta.js & core/replyStyle.js).
   *  Thumbnail diganti owner via `.setreply thumb` (balas foto).
   *  (Fitur .setcta & tombol CTA otomatis sudah dihapus.)
   *  Override runtime disimpan di src/data/cta.json
   * ════════════════════════════════════════════ */
  cta: {
    enabled: false, // (sisa) tombol CTA sudah dihapus — gak berefek
    text: '📢 Saluran', // (sisa) label tombol lama — gak berefek
    url: 'https://whatsapp.com/channel/0029Vb8Tph9BVJl06WWw5q3B', // fallback sourceUrl kalau card.sourceUrl kosong
    card: {
      enabled: true,
      title: 'skyline-JXRA',                       // judul kartu
      body: 'Join channel untuk update & info terbaru 📢',  // deskripsi di bawah judul
      thumb: '',        // URL/path gambar; kosong = placeholder otomatis; 'off' = tanpa thumbnail
      sourceUrl: '',    // link saat kartu diklik; kosong = ikut url di atas (channel)
      large: true,      // thumbnail besar (renderLargerThumbnail)
    },
  },

  /* ════════════════════════════════════════════
   *  REPLY VARIANT (ala skyline-md .setreply)
   *  Gaya tampilan ctx.reply() bot — v1 s/d v7:
   *  1 BASIC • 2 PREMIUM (dokumen+quote kontak) •
   *  3 TITANIUM (gif) • 4 LV (link preview) •
   *  5 FAKE ORDER • 6 SIMPLE DOCUMENT (quote asli) •
   *  7 FAKE LOCATION
   *  Ganti runtime: .setreply → src/data/replyStyle.json
   * ════════════════════════════════════════════ */
  reply: {
    variant: 1,
    website: 'skyline.web.id', // dipakai varian v4 (link preview) — boleh domain saja; https:// ditambah otomatis. Kalau halamannya punya OG tags (github dsb), judul/deskripsi/foto preview diambil otomatis dari situ
    v4: {
      // Teks preview v4 — kosongkan untuk pakai OG halaman website;
      // kalau diisi, teks ini yang dipakai (menang atas OG).
      // Fallback (OG kosong + config kosong): judul/desc kartu CTA (cta.card di atas).
      title: 'skyline-JXRA',
      desc: '',
      // Thumbnail preview v4 — timpa filenya langsung, atau balas foto + `.setreply thumb v4`.
      // 'off' = tanpa thumbnail lokal (ikut OG image website).
      thumb: 'assets/thumb/v4-thumb.jpg',
    },
  },

  /* ════════════════════════════════════════════
   *  PESAN DEFAULT
   * ════════════════════════════════════════════ */
  messages: {
    wait: '⏳ Tunggu sebentar ya, Kak...',
    error: '😵 Terjadi kesalahan, harap coba kembali nanti',
    ownerOnly: '🚫 Fitur ini khusus OWNER!',
    adminOnly: '🚫 Fitur ini khusus ADMIN!',
    groupOnly: '🚫 Fitur ini khusus GRUP!',
    privateOnly: '🚫 Fitur ini khusus PRIVATE CHAT!',
    premiumOnly: '💎 Fitur ini khusus PREMIUM user!',
    botAdminOnly: '🛡 Bot harus jadi ADMIN grup dulu.',
  },

  /* ════════════════════════════════════════════
   *  LOGGING
   * ════════════════════════════════════════════ */
  logLevel: 'info',
  libraryLogLevel: 'error',
}
