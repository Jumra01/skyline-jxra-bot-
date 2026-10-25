/**
 * © skyline-JXRA
 * Kumpulan ramalan primbon: arti nama, jodoh, nomor hoki, mimpi, zodiak, dan lainnya.
 */
import axios from 'axios'

const BASE = 'https://api.siputzx.my.id/api/primbon'
const TIMEOUT = 15_000

const COMMANDS = [
  {
    name: 'artinama', alias: ['namameaning', 'artinamaku'], category: 'tools',
    description: 'Cek arti nama menurut primbon', usage: '.artinama <nama>', example: '.artinama Putu',
    query: (a) => ({ path: 'artinama', params: { nama: a.join(' ') } }),
    valid: (d) => d?.nama && d?.arti,
    format: (d) => `📛 *Arti Nama*\n\nNama: *${d.nama}*\n\n${d.arti}${d.catatan ? `\n\n_${d.catatan}_` : ''}`,
    usageText: 'Masukkan nama. Contoh: .artinama Putu',
  },
  {
    name: 'kecocokannamapasangan', alias: ['cocoknama', 'matchname'], category: 'tools',
    description: 'Cek kecocokan nama pasangan', usage: '.kecocokannamapasangan <nama1> | <nama2>', example: '.kecocokannamapasangan Putu | Keyla',
    query: (a) => { const [nama1, nama2] = splitNames(a); return nama1 && nama2 ? { path: 'kecocokan_nama_pasangan', params: { nama1, nama2 } } : null },
    valid: (d) => d?.nama_anda && d?.nama_pasangan,
    format: (d) => `💞 *Kecocokan Nama Pasangan*\n\n${d.nama_anda} + ${d.nama_pasangan}\n\n✅ Sisi positif: ${d.sisi_positif || '-'}\n⚠️ Sisi negatif: ${d.sisi_negatif || '-'}${d.catatan ? `\n\n_${d.catatan}_` : ''}`,
    usageText: 'Pisahkan dua nama dengan |. Contoh: .kecocokannamapasangan Putu | Keyla',
  },
  {
    name: 'nomerhoki', alias: ['nomorhoki', 'ceknomor'], category: 'tools',
    description: 'Cek ramalan angka hoki nomor telepon', usage: '.nomerhoki <nomor>', example: '.nomerhoki 08123456789',
    query: (a) => { const phoneNumber = a.join('').replace(/\D/g, ''); return phoneNumber.length >= 5 ? { path: 'nomorhoki', params: { phoneNumber } } : null },
    valid: (d) => d?.nomor,
    format: (d) => {
      const pos = d.energi_positif?.details || {}
      const neg = d.energi_negatif?.details || {}
      return `🔢 *Nomor Hoki*\n\nNomor: ${d.nomor}\nAngka Bagua: ${d.angka_bagua_shuzi?.value ?? '-'}\nAnalisis: ${d.analisis?.status ?? '-'}\n\nEnergi positif (${d.energi_positif?.total ?? '-'}): kekayaan ${pos.kekayaan ?? '-'}, kesehatan ${pos.kesehatan ?? '-'}, cinta ${pos.cinta ?? '-'}, kestabilan ${pos.kestabilan ?? '-'}\n\nEnergi negatif (${d.energi_negatif?.total ?? '-'}): perselisihan ${neg.perselisihan ?? '-'}, kehilangan ${neg.kehilangan ?? '-'}, malapetaka ${neg.malapetaka ?? '-'}, kehancuran ${neg.kehancuran ?? '-'}`
    },
    usageText: 'Masukkan nomor telepon (minimal 5 angka). Contoh: .nomerhoki 08123456789',
  },
  {
    name: 'potensipenyakit', alias: ['cekpenyakit', 'penyakit'], category: 'tools',
    description: 'Ramalan primbon potensi penyakit dari tanggal lahir', usage: '.potensipenyakit <tgl> <bln> <thn>', example: '.potensipenyakit 16 11 2007',
    query: (a) => dateQuery('cek_potensi_penyakit', a),
    valid: (d) => d?.sektor || d?.elemen,
    format: (d, a) => `🩺 *Ramalan Potensi Penyakit*\n\nTanggal lahir: ${a.join('-')}\nSektor: ${d.sektor ?? '-'}\nElemen: ${d.elemen ?? '-'}${d.catatan ? `\n\n_${d.catatan}_` : ''}\n\n_Prediksi hiburan, bukan diagnosis atau saran medis._`,
    usageText: 'Format tanggal bulan tahun. Contoh: .potensipenyakit 16 11 2007',
  },
  {
    name: 'ramalanjodoh', alias: ['jodoh', 'cekjodoh'], category: 'tools',
    description: 'Ramalan jodoh berdasarkan primbon Jawa', usage: '.ramalanjodoh <nama1> <tgl1> <bln1> <thn1> <nama2> <tgl2> <bln2> <thn2>', example: '.ramalanjodoh Putu 16 11 2007 Keyla 1 1 2008',
    query: (a) => coupleQuery(a),
    valid: (d) => Boolean(d?.result),
    format: (d) => { const r = d.result; return `💑 *Ramalan Jodoh*\n\n👤 ${r.orang_pertama?.nama ?? '-'} (${r.orang_pertama?.tanggal_lahir ?? '-'})\n👤 ${r.orang_kedua?.nama ?? '-'} (${r.orang_kedua?.tanggal_lahir ?? '-'})\n\n${(r.hasil_ramalan || []).map((x, i) => `${i + 1}. ${x}`).join('\n\n') || 'Hasil tidak tersedia.'}${d.peringatan ? `\n\n_${d.peringatan}_` : ''}` },
    usageText: 'Contoh: .ramalanjodoh Putu 16 11 2007 Keyla 1 1 2008',
  },
  {
    name: 'sifatusahabisnis', alias: ['usahabisnis', 'sifatbisnis'], category: 'tools',
    description: 'Ramalan primbon kecocokan usaha bisnis', usage: '.sifatusahabisnis <tgl> <bln> <thn>', example: '.sifatusahabisnis 16 11 2007',
    query: (a) => dateQuery('sifat_usaha_bisnis', a),
    valid: (d) => d?.hari_lahir || d?.usaha,
    format: (d) => `💼 *Sifat Usaha Bisnis*\n\nHari lahir: ${d.hari_lahir ?? '-'}\nUsaha: ${d.usaha ?? '-'}${d.catatan ? `\n\n_${d.catatan}_` : ''}\n\n_Ramalan hiburan, bukan nasihat keuangan._`,
    usageText: 'Format tanggal bulan tahun. Contoh: .sifatusahabisnis 16 11 2007',
  },
  {
    name: 'tafsirmimpi', alias: ['artimimpi', 'mimpi'], category: 'tools',
    description: 'Cari tafsir mimpi menurut primbon', usage: '.tafsirmimpi <kata kunci>', example: '.tafsirmimpi bertemu',
    query: (a) => a.length ? { path: 'tafsirmimpi', params: { mimpi: a.join(' ') } } : null,
    valid: (d) => Array.isArray(d?.hasil) && d.hasil.length > 0,
    format: (d) => `🌙 *Tafsir Mimpi*\n\nKata kunci: *${d.keyword ?? '-'}* • ${d.total ?? d.hasil.length} hasil\n\n${d.hasil.slice(0, 10).map((h, i) => `*${i + 1}. ${h.mimpi}*\n${h.tafsir}`).join('\n\n')}`,
    usageText: 'Masukkan kata kunci mimpi. Contoh: .tafsirmimpi bertemu',
  },
  {
    name: 'zodiak', alias: ['horoscope', 'ramalan'], category: 'tools',
    description: 'Cek informasi zodiak menurut primbon', usage: '.zodiak <nama zodiak>', example: '.zodiak leo',
    query: (a) => a.length ? { path: 'zodiak', params: { zodiak: a.join(' ').toLowerCase() } } : null,
    valid: (d) => d?.zodiak,
    format: (d) => `♈ *Zodiak ${d.zodiak}*\n\nAngka keberuntungan: ${d.nomor_keberuntungan ?? '-'}\nBunga: ${d.bunga_keberuntungan ?? '-'}\nWarna: ${d.warna_keberuntungan ?? '-'}\nBatu: ${d.batu_keberuntungan ?? '-'}\nElemen: ${d.elemen_keberuntungan ?? '-'}\nPlanet: ${d.planet_yang_mengitari ?? '-'}\nPasangan: ${d.pasangan_zodiak ?? '-'}`,
    usageText: 'Masukkan zodiak. Contoh: .zodiak leo',
  },
]

function splitNames(args) {
  const text = args.join(' ')
  const parts = text.includes('|') ? text.split('|', 2) : text.split(/\s+dan\s+/i, 2)
  return parts.map((s) => s.trim())
}

function dateQuery(path, args) {
  if (args.length !== 3 || !args.every((x) => /^\d+$/.test(x))) return null
  const [tgl, bln, thn] = args.map(Number)
  const date = new Date(Date.UTC(thn, bln - 1, tgl))
  if (thn < 1900 || thn > new Date().getFullYear() || date.getUTCFullYear() !== thn || date.getUTCMonth() !== bln - 1 || date.getUTCDate() !== tgl) return null
  return { path, params: { tgl, bln, thn } }
}

function coupleQuery(args) {
  if (args.length < 8) return null
  const [nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2] = args
  if (!nama1 || !nama2 || !/^\d+$/.test(tgl1) || !/^\d+$/.test(bln1) || !/^\d{4}$/.test(thn1) || !/^\d+$/.test(tgl2) || !/^\d+$/.test(bln2) || !/^\d{4}$/.test(thn2)) return null
  if (!dateQuery('_', [tgl1, bln1, thn1]) || !dateQuery('_', [tgl2, bln2, thn2])) return null
  return { path: 'ramalanjodoh', params: { nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2 } }
}

async function runCommand(ctx, command) {
  const parsed = command.query(ctx.args || [])
  if (!parsed) {
    await ctx.reply(`ℹ️ ${command.usageText}`)
    return
  }
  await ctx.react('🔮')
  try {
    const { data: envelope } = await axios.get(`${BASE}/${parsed.path}`, {
      params: parsed.params,
      timeout: TIMEOUT,
      responseType: 'json',
    })
    if (!envelope?.status || !command.valid(envelope.data)) {
      await ctx.react('❌')
      await ctx.reply('⚠️ Data primbon tidak tersedia untuk masukan tersebut. Coba periksa formatnya atau coba lagi nanti.')
      return
    }
    await ctx.reply(command.format(envelope.data, ctx.args || []))
    await ctx.react('✅')
  } catch (error) {
    await ctx.react('❌')
    const status = error?.response?.status
    const detail = status ? ` (HTTP ${status})` : ''
    await ctx.reply(`⚠️ Layanan primbon sedang tidak tersedia${detail}. Coba lagi nanti.`)
  }
}

export function getPrimbonCommand(name) {
  return COMMANDS.find((command) => command.name === name)
}

export async function runPrimbonCommand(ctx, name) {
  const command = getPrimbonCommand(name)
  if (command) await runCommand(ctx, command)
}
