/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * config.js — Centralized configuration untuk skyline-JXRA
 */

export default {
  botName: 'skyline-JXRA',

  auth: {
    method: 'auto',
    customCode: 'JHXFNY48',
    useCustomCode: true,
    pairingNumber: '',
  },

  prefixes: ['.', '!', '/', '#', ',', '😁', '🦅'],
  mainPrefix: '.',

  staff: [
    { number: '6283121590572', role: 'owner', label: 'skyline-JXRA • Developer' },
    { number: '6283121590572', role: 'owner', label: 'JHPremix • Developer' },
    { number: '6283121590572', lid: '203186329669748', role: 'owner', label: 'Arip • Owner' },
    { number: '6283121590572', role: 'admin', label: 'XN • Staff Admin' },
  ],

  // Fitur grup yang butuh on/off (permission admin/staff)
  toggleable: ['welcome', 'bye', 'antilink', 'game'],

  // BLACKLIST domain antilink (default; bisa di-override per grup).
  // Selain daftar ini = boleh. Yang di daftar = dihapus.
  antilink: {
    defaultBlacklist: 'wa.me,chat.whatsapp.com,t.me,telegram.me',
  },

  sticker: {
    packName: 'Made with',
    author: 'skyline-JXRA♡',
    withExif: true,
    maxVideoSeconds: 10
  },

  wsWorkerUrl: 'wss://audio.jhx.my.id/wss/audio',
  wsPort: 8090,
  wsPath: '/wss/audio',

  antiSpam: {
    enabled: true,
    max: 5,
    windowMs: 10_000,
    muteMs: 30_000
  },
  cooldown: 3000,

  autoRead: true,
  typingPresence: true,

  // Hot Reload — auto reload command di feat/ tiap ada file baru/edit/hapus.
  // Gak perlu restart bot/server, gak perlu ketik .reload manual lagi.
  hotReload: {
    enabled: true,
    debounceMs: 400,   // jeda nunggu (ms) biar gak reload berkali-kali pas nyimpen beruntun
    notifyOwner: true, // kirim WA ke owner tiap kali hot reload kejadian
  },

  // React Channel — auto-react postingan baru di channel khusus bot,
  // + command .rch buat react manual ke postingan channel manapun.
  reactChannel: {
    enabled: true,
    dedicatedChannelUrl: 'https://whatsapp.com/channel/0029Vb5blhMEawdx2QFALZ1D',
    emojis: ['🔥', '❤️', '😍', '👍', '😂', '🥳', '💯', '✨'],
  },

  messages: {
    wait: '⏳ Tunggu sebentar ya, Kak...',
    error: '😵 Terjadi kesalahan, harap coba kembali nanti',
    ownerOnly: '🚫 Fitur ini khusus OWNER!',
    adminOnly: '🚫 Fitur ini khusus ADMIN!',
    groupOnly: '🚫 Fitur ini khusus GRUP!',
  },

  logLevel: 'info',
  libraryLogLevel: 'error',
}
