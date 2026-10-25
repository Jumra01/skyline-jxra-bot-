/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * config.js — pusat pengaturan skyline-JXRA.
 * Owner → `owner.numbers` · Prefix → `prefixes`
 * API key → `api.skyline.apikey` · Gaya balasan → `reply.variant`
 */

export default {
  /* ── IDENTITAS ── */
  botName: 'skyline-JXRA',

  banner: {
    words: [
      { text: 'SKYLINE', align: 'left' },
      { text: 'JXRA', align: 'right' },
    ],
    tagline: '⚡ next-gen WhatsApp bot · powered by zapo-js',
  },

  /* ── AUTH ── */
  auth: {
    method: 'auto',
    pairingNumber: '',
    useCustomCode: true,
    customCode: 'JHXFNY48',
  },

  /* ── PREFIX ── */
  mainPrefix: '.',
  prefixes: ['.', '!', '/', '#', ',', '😁', '🦅'],

  /* ── OWNER & STAFF ── */
  owner: {
    name: 'skyline-JXRA Developer',
    numbers: ['6283121590572'],
  },

  staff: [
    { number: '6283121590572', role: 'owner', label: 'skyline-JXRA • Developer' },
    // { number: '6281234567890', role: 'admin', label: 'Nama • Admin' },
  ],

  /* ── GRUP ── */
  toggleable: ['welcome', 'bye', 'antilink', 'game', 'antidelete'],
  antilink: {
    defaultBlacklist: 'wa.me,chat.whatsapp.com,t.me,telegram.me',
  },

  /* ── STICKER ── */
  sticker: {
    packName: 'Made with',
    author: 'skyline-JXRA♡',
    withExif: true,
    maxVideoSeconds: 10,
  },

  /* ── API ── */
  api: {
    skyline: {
      website: 'https://skyline.web.id',
      apikey: '',
    },
    spotify: {
      clientId: '',
      clientSecret: '',
    },
  },

  /* ── AI ── */
  aiChat: {
    enabled: true,
    mentionTrigger: true,
    replyTrigger: true,
    privateAuto: true,
    maxHistory: 20,
    timeoutMs: 60_000,
    sessionTtlMin: 20,
    remember: true,
    rememberEvery: 8,
    vision: true,
    visionFallback: true,
    systemPrompt: '',
  },

  ella: {
    enabled: true,
    auto: true,
    mentionTrigger: true,
    replyTrigger: true,
    privateAuto: true,
    maxHistory: 8,
    timeoutMs: 30_000,
    memory: true,
    vision: true,
    systemPrompt: '',
  },

  ella2: {
    enabled: true,
    auto: true,
    mentionTrigger: true,
    replyTrigger: true,
    privateAuto: true,
    maxHistory: 4,
    timeoutMs: 180_000,
    memory: true,
    retries: 4,
    queueMax: 2,
    warmupMin: 25,
    systemPrompt: '',
    exec: 'admin',
    execAllow: [
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
    execDeny: [],
    execUser: [
      'pinterest', 'play', 'yta', 'ytv', 'ytsearch', 'tiktok', 'ig', 'fb', 'twitter',
      'spotify', 'sticker', 'toimg', 'brat', 'smeme', 'iqc', 'omniedit', 'hd', 'unblur',
      'removebg', 'tomp3', 'tourl', 'ping', 'menu', 'balance', 'daily',
    ],
  },

  /* ── ANTI-SPAM & COOLDOWN ── */
  antiSpam: {
    enabled: true,
    max: 5,
    windowMs: 10_000,
    muteMs: 30_000,
  },
  cooldown: 3000,

  /* ── AURORA ── */
  aurora: {
    playerCard: false,
    maxEmbedKb: '',
    embedOriginal: true,
    originalMaxKb: '',
    playerButton: true,
  },

  /* ── EMERALD ── */
  emerald: {
    enabled: true,
    defaultCost: 1,
    max: 64,
    notify: true,
    regen: {
      amount: 10,
      intervalMs: 600_000,
    },
    daily: {
      amount: 30,
      cooldownMs: 86_400_000,
    },
    reward: {
      battle: { common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 5 },
      questDiv: 10,
      sellDiv: 20,
    },
  },

  /* ── PRESENCE ── */
  autoRead: false,
  typingPresence: true,

  /* ── HOT RELOAD ── */
  hotReload: {
    enabled: true,
    debounceMs: 400,
    notifyOwner: false,
  },

  /* ── REACT CHANNEL ── */
  reactChannel: {
    enabled: true,
    dedicatedChannelUrl: 'https://whatsapp.com/channel/0029Vb8Tph9BVJl06WWw5q3B',
    emojis: ['🔥', '❤️', '😍', '👍', '😂', '🥳', '💯', '✨'],
  },

  /* ── KARTU GLOBAL (CTA) ── */
  cta: {
    url: 'https://whatsapp.com/channel/0029Vb8Tph9BVJl06WWw5q3B',
    card: {
      enabled: true,
      title: 'skyline-JXRA',
      body: 'Join channel untuk update & info terbaru 📢',
      thumb: '',
      sourceUrl: '',
      large: true,
    },
  },

  /* ── GAYA BALASAN (1-9) ── */
  reply: {
    variant: 1,
    // v9 — kosong = default (lihat kanan). Wajib URL https://, path lokal diabaikan.
    v9ThumbnailUrl: 'https://skyline.web.id/uploads/6a0484983cb9e74ec0ac32d5.png', // kosong = tanpa gambar
    v9Title: '',      // kosong = nama bot
    v9Brand: '',      // kosong = nama command
    v9Price: '',      // kosong = "Online"
    v9ProductUrl: '', // kosong = mode gambar biasa (isi https = product card)
    v9IconUrl: '',    // kosong = tanpa ikon (isi https = product card)

    // ── v4 (preview link/OG) ──
    website: 'skyline.web.id',              // domain & sumber gambar preview
    v4: {
      title: 'skyline-JXRA',                // judul preview
      desc: '',                             // kosong = deskripsi otomatis
      thumb: 'assets/thumb/v4-thumb.jpg',   // 'off' = pakai gambar OG situs
    },
  },

  /* ── PESAN DEFAULT ── */
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

  /* ── LOGGING ── */
  logLevel: 'info',
  libraryLogLevel: 'error',
}
