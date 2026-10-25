/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * config.js — pusat pengaturan skyline-JXRA.
 * Cukup file ini yang perlu diedit buat ngatur bot.
 *
 *   Owner / staff  → `owner.numbers` (format 628xxx)
 *   Prefix         → `mainPrefix` + `prefixes`
 *   Kredensial API → `api.skyline.apikey` (atau env SKYLINE_API_KEY)
 *   Gaya balasan   → `reply.variant` (atau .setreply)
 *   Premium        → database, atur via .addprem / .premlist
 */

export default {
  /* ── IDENTITAS ─────────────────────────────────────────── */
  botName: 'skyline-JXRA',

  // Banner console saat bot start (auto-generate dari `words`).
  // align: 'left' | 'right' | 'center'
  banner: {
    words: [
      { text: 'SKYLINE', align: 'left' },
      { text: 'JXRA', align: 'right' },
    ],
    tagline: '⚡ next-gen WhatsApp bot · powered by zapo-js',
  },

  /* ── AUTH ──────────────────────────────────────────────── */
  auth: {
    method: 'auto',          // auto | qr | pairing
    pairingNumber: '',       // 628xxx (kosong = fallback QR)
    useCustomCode: true,
    customCode: 'JHXFNY48',  // 8 karakter: 1-9 & A-Z tanpa I, O, U
  },

  /* ── PREFIX ────────────────────────────────────────────── */
  mainPrefix: '.',
  prefixes: ['.', '!', '/', '#', ',', '😁', '🦅'],

  /* ── OWNER & STAFF ─────────────────────────────────────── */
  owner: {
    name: 'skyline-JXRA Developer',
    numbers: ['6283121590572'], // format bebas: 628xxx / 08xxx / +628xxx
  },

  // Nomor bot sendiri otomatis owner. Isi `staff` cuma kalau ada
  // admin/staff lain — satu nomor cuma bisa satu entry yang dipakai.
  staff: [
    { number: '6283121590572', role: 'owner', label: 'skyline-JXRA • Developer' },
    // { number: '6281234567890', role: 'admin', label: 'Nama • Admin' },
  ],

  /* ── GRUP ──────────────────────────────────────────────── */
  toggleable: ['welcome', 'bye', 'antilink', 'game', 'antidelete'], // on/off per grup
  antilink: {
    defaultBlacklist: 'wa.me,chat.whatsapp.com,t.me,telegram.me',
  },

  /* ── STICKER ───────────────────────────────────────────── */
  sticker: {
    packName: 'Made with',
    author: 'skyline-JXRA♡',
    withExif: true,
    maxVideoSeconds: 10,
  },

  /* ── API (kredensial layanan luar) ─────────────────────── */
  // Semua kredensial API dikumpulin di sini biar rapi & gampang dicari.
  // Dikosongkan di repo — tiap user isi sendiri. Override lewat env:
  //   skyline → SKYLINE_API_KEY / SKYLINE_API_URL
  //   spotify → SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
  // Kosong = fitur terkait mati/fallback, fitur lain tetap jalan.
  api: {
    // Satu key buat `.play` `.yta` `.ytv` `.ytsearch` + `.omniedit` + `.ella`.
    skyline: {
      website: 'https://skyline.web.id',
      apikey: '',
    },
    // Search Spotify by judul butuh app gratis dari
    // developer.spotify.com/dashboard. `.spotify <link>` tetap jalan
    // walau kredensial ini kosong.
    spotify: {
      clientId: '',
      clientSecret: '',
    },
  },

  /* ── AI CHAT (.bot) ────────────────────────────────────── */
  // Otak: Gemini web (tanpa API key). Persona: data/ai-persona.txt
  // atau `.setpersona`. Memori fakta: data/ai-memory.json (maks 25
  // fakta/user, 500 user terakhir).
  aiChat: {
    enabled: true,
    maxHistory: 20,          // jumlah pesan riwayat per user
    timeoutMs: 60_000,       // batas tunggu balasan AI (ms)
    mentionTrigger: true,    // balas saat bot di-tag (tanpa prefix)
    replyTrigger: true,      // balas saat pesan bot di-reply
    privateAuto: true,       // chat pribadi: pesan biasa (tanpa tag) juga dibalas
    vision: true,            // bisa lihat foto/stiker yang dikirim atau di-quote
    visionFallback: true,    // kalau Gemini nolak file → baca gambar lewat OCR + deskripsi otomatis
    remember: true,          // catat fakta penting tentang user
    rememberEvery: 8,        // tiap N pesan rapihin fakta (0 = pola instan)
    sessionTtlMin: 20,       // sesi Gemini basi setelah N menit nganggur
    systemPrompt: '',        // kosong = persona default (Bella)
  },

  /* ── ELLA (AI chat skyline.web.id) ─────────────────────── */
  // Otak: POST /api/ai/aichat-skyline (wajib API key Skyline).
  // Memakai key yang sama dengan `.play`/`.omniedit`: api.skyline.apikey
  // atau env SKYLINE_API_KEY. Persona Ella menolak bocoran rahasia.
  ella: {
    enabled: true,          // fitur nyala (command + auto)
    auto: true,             // auto balas tag/bales/DM (false = auto pakai `.bot` Gemini)
    mentionTrigger: true,   // balas saat bot di-tag
    replyTrigger: true,     // balas saat pesan Ella dibales
    privateAuto: true,      // chat pribadi: pesan biasa juga dibalas
    vision: true,           // foto/stiker dibaca (OCR + deskripsi otomatis)
    memory: true,           // inget fakta penting tentang user
    maxHistory: 8,          // pesan terakhir yang dikirim ke API (maks 10)
    timeoutMs: 30_000,      // batas tunggu balasan (ms)
    systemPrompt: '',       // instruksi tambahan (opsional)
  },

  /* ── ELLA v2 (AI chat Gemma skyline.web.id) ────────────── */
  // Otak: POST /api/ai/gemma (model gemma-4-31b). Endpoint ini WAJIB apikey —
  // isi `api.skyline.apikey` atau env SKYLINE_API_KEY (tanpa key = 401).
  // Modelnya besar: balasan bisa 10-25 detik, timeout sengaja lega.
  // Auto-nya OPT-IN (`.ella2 on`) biar gak rebutan sama `.ella`/`.autoai`.
  ella2: {
    enabled: true,          // fitur nyala (command + auto)
    auto: true,             // izin auto balas tag/bales/DM
    mentionTrigger: true,   // balas saat bot di-tag
    replyTrigger: true,     // balas saat pesan Ella v2 dibales
    privateAuto: true,      // chat pribadi: pesan biasa juga dibalas
    memory: true,           // inget fakta penting tentang user
    maxHistory: 4,          // pesan terakhir yang dikirim ke API (maks 10) — kecil = prompt ringan
    timeoutMs: 180_000,     // batas tunggu balasan (ms) — 0 = tanpa batas; Gemma bisa 10-25 dtk
    retries: 4,             // ulang otomatis kalau "AI is busy" (503/429) — total 5 percobaan (backoff 2s→30s, deadline 180s di bawah)
    queueMax: 2,            // kalau antrean Gemma > ini, user langsung dikasih tau (biar ga nunggu 2 menit)
    warmupMin: 25,          // ping ringan tiap N menit biar upstream ga cold start (0 = mati)
    systemPrompt: '',       // instruksi tambahan (opsional)

    // Aksi bot (Ella bisa jalanin command beneran atas permintaan):
    // Owner/staff bot = bebas command apa pun (kecuali restart/updatesc/
    // restore/clearcache). `execAllow` = daftar buat admin grup.
    exec: 'admin',          // 'owner' | 'admin' (owner/staff/admin grup) | 'off'
    execAllow: [            // aksi grup yang boleh diminta admin grup
      'g open',
      'g close',
      'g link',
      'g revoke',
      'g setname <nama>',
      'g setdesc <teks>',
      'setwelcome <teks>',
      'setbye <teks>',
      'kick <tag/nomor>',
      'promote <tag/nomor>',
      'demote <tag/nomor>',
      'tagall <teks>',
      'hidetag <teks>',
      'on <welcome|bye|antilink|game>',
      'off <welcome|bye|antilink|game>',
    ],
    execDeny: [],           // tambahan yang diblokir (restart/updatesc udah hard-block)

    // Fitur umum yang boleh dijalanin Ella v2 atas nama SIAPA AJA (member juga).
    // Gak ikut saklar `exec` di atas; tetap kena cooldown + potongan emerald,
    // sama seperti kalau user ngetik command-nya sendiri.
    execUser: [
      'pinterest', 'play', 'yta', 'ytv', 'ytsearch', 'tiktok', 'ig', 'fb', 'twitter',
      'spotify', 'sticker', 'toimg', 'brat', 'smeme', 'iqc', 'omniedit', 'hd', 'unblur',
      'removebg', 'tomp3', 'tourl', 'ping', 'menu', 'balance', 'daily',
    ],
  },

  /* ── ANTI-SPAM & COOLDOWN ──────────────────────────────── */
  antiSpam: {
    enabled: true,
    max: 5,                  // maks pesan per window sebelum mute
    windowMs: 10_000,
    muteMs: 30_000,
  },
  cooldown: 3000,            // jeda antar command per user (ms)

  /* ── EMERALD (mata uang command) ───────────────────────── */
  /* ── AURORA (player kartu) ──────────────────────────────── */
  // false = kartu cuma cover + info (paling aman, jalan di semua device).
  // true  = kartu player WebSocket (butuh WS; sebagian WebView WA nolak media).
  aurora: {
    playerCard: false,
    // Batas audio yang di-embed di dalam kartu (KB base64). Kosong = 2000 =
    // keukur encoder zapo: frame kartu ±2,9MB (limit keras WA 16,7MB) —
    // lagu ±4 menit muat penuh di opus 48k. Turunin (mis. '800') kalau mau
    // hemat, naikin sampai '3900' maksimal; jangan lewat 4000 (hard-cap
    // frame). Dikutip sebagai string ('...') biar nilai user kebackup pas
    // .updatesc (KEEP_FIELDS cuma membaca nilai string).
    maxEmbedKb: '',
    // true = audio di-embed TANPA kompres (mp3/m4a asli dari skyline) selama
    // muat di hard-cap frame WhatsApp (base64 audio ≤ 4MB ≈ file 3MB, karena
    // payload kartu melebar ±4× di pipeline). Kegedean → otomatis kompres opus.
    // false = kompres opus seperti biasa.
    embedOriginal: true,
    // Opsional: batas base64 audio asli (KB). Kosong = pakai hard-cap frame
    // (±4000KB). Diisi angka (mis. '3000') = kalau lewat, lebih awal fallback
    // kompres opus.
    originalMaxKb: '',
    // Tombol "Buka Player Web" (web-app di in-app browser WhatsApp). Default
    // nyala; set false kalau mau hemat bubble (tiap lagu cuma progress + kartu).
    // Kalau kartu gagal memuat audio, tombol tetap dikirim apa pun setelan ini.
    playerButton: true,
  },

  emerald: {
    enabled: true,           // false = semua command gratis
    defaultCost: 1,          // biaya default (override: `energi:` di plugin)
    max: 64,                 // batas saldo
    notify: true,            // true | false | 'private'
    regen: {
      amount: 10,            // tambahan saldo per tick
      intervalMs: 600_000,   // tiap 10 menit (lazy, tanpa timer)
    },
    daily: {
      amount: 30,            // hadiah .daily
      cooldownMs: 86_400_000, // 24 jam
    },
    reward: {
      battle: { common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 5 },
      questDiv: 10,          // emerald quest = floor(gold / 10)
      sellDiv: 20,           // emerald jual = floor(gold / 20), min 1
    },
  },

  /* ── PRESENCE ──────────────────────────────────────────── */
  autoRead: false,
  typingPresence: true,      // indikator "typing…" saat bot memproses

  /* ── HOT RELOAD ────────────────────────────────────────── */
  hotReload: {
    enabled: true,           // reload otomatis plugin/ tanpa restart
    debounceMs: 400,
    notifyOwner: false,      // kirim WA ke owner tiap reload
  },

  /* ── REACT CHANNEL ─────────────────────────────────────── */
  reactChannel: {
    enabled: true,
    dedicatedChannelUrl: 'https://whatsapp.com/channel/0029Vb8Tph9BVJl06WWw5q3B',
    emojis: ['🔥', '❤️', '😍', '👍', '😂', '🥳', '💯', '✨'],
  },

  /* ── KARTU GLOBAL (externalAdReply) ────────────────────── */
  // Nempel di atas bubble balasan teks (ctx.reply).
  // Thumbnail diganti via `.setreply thumb` (balas foto).
  cta: {
    url: 'https://whatsapp.com/channel/0029Vb8Tph9BVJl06WWw5q3B',
    card: {
      enabled: true,
      title: 'skyline-JXRA',
      body: 'Join channel untuk update & info terbaru 📢',
      thumb: '',             // kosong = placeholder; 'off' = tanpa gambar
      sourceUrl: '',         // kosong = pakai `url` di atas
      large: true,
    },
  },

  /* ── GAYA BALASAN (.setreply) ──────────────────────────── */
  // 1 BASIC · 2 PREMIUM · 3 TITANIUM · 4 LV · 5 FAKE ORDER
  // 6 SIMPLE DOCUMENT · 7 FAKE LOCATION
  reply: {
    variant: 1,
    // Khusus .setreply v9: URL gambar thumbnail product card/header.
    v9ThumbnailUrl: 'https://skyline.web.id/uploads/6a0484983cb9e74ec0ac32d5.png',
    // Khusus .setreply v9: link product card (opsional). Kalau diisi, WhatsApp
    // menampilkan favicon domain link itu sebagai ikon bundar kecil di samping
    // nama. Biarkan KOSONG supaya ikon bundar kecil tidak muncul sama sekali.
    // Jangan isi link whatsapp.com/channel — favicon WhatsApp yang tampil.
    v9ProductUrl: '',
    // Khusus .setreply v9: URL gambar untuk ikon kecil di product card
    // (opsional). Kosong = ikon kecil tidak dikirim. Isi dengan URL gambar
    // https:// kalau ingin ikon kecil tampil memakai gambar pilihan sendiri.
    v9IconUrl: '',
    website: 'skyline.web.id',        // dipakai v4 (OG preview otomatis)
    v4: {
      title: 'skyline-JXRA',
      desc: '',
      thumb: 'assets/thumb/v4-thumb.jpg', // 'off' = ikut OG image
    },
  },

  /* ── PESAN DEFAULT ─────────────────────────────────────── */
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

  /* ── LOGGING ───────────────────────────────────────────── */
  logLevel: 'info',
  libraryLogLevel: 'error',
}
