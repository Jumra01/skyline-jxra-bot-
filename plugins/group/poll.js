/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * poll.js — Voting cepat di grup (.poll).
 *
 *   .poll Makan apa? | Nasi goreng | Mie ayam | Bakso
 *
 * Tombolnya native (quick_reply). Satu orang satu suara — pilih ulang =
 * ganti suara. Hasil ditally langsung di chat.
 */
import { onRichReply } from '../../handlers/messageHandler.js'
import { jidDigits } from '../../lib/waGroup.js'

const pluginConfig = {
  name: 'poll',
  alias: ['vote', 'voting'],
  category: 'group',
  description: 'Bikin voting cepat pakai tombol (hasil otomatis ditally)',
  usage: '.poll <pertanyaan> | <opsi1> | <opsi2> [| opsi3 ...]',
  example: '.poll Makan apa? | Nasi goreng | Mie ayam | Bakso',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
}

const MAX_OPTIONS = 10
const polls = new Map()
let seq = 0

const digits = (jid) => {
  try {
    return jidDigits(String(jid || ''))
  } catch {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  }
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const cut = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''))

function tally(poll) {
  const counts = new Array(poll.options.length).fill(0)
  for (const idx of poll.votes.values()) {
    if (idx >= 0 && idx < counts.length) counts[idx] += 1
  }
  const total = poll.votes.size
  const max = Math.max(1, ...counts)
  const lines = poll.options.map((opt, i) => {
    const c = counts[i]
    const bar = '█'.repeat(Math.round((c / max) * 10)).padEnd(10, '░')
    const pct = total ? Math.round((c / total) * 100) : 0
    return `${i + 1}. ${esc(cut(opt, 30))}\n   ${bar} ${c} suara (${pct}%)`
  })
  return `📊 *${esc(cut(poll.question, 80))}*\n\n${lines.join('\n')}\n\n👥 Total: ${total} suara`
}

async function handler(ctx) {
  const p = ctx.prefix || '.'
  const raw = String(ctx.text || '').trim()
  const parts = raw.split('|').map((s) => s.trim()).filter(Boolean)

  if (parts.length < 3) {
    return ctx.reply(
      `📊 *POLL*\n\n` +
        `Format: \`${p}poll <pertanyaan> | <opsi1> | <opsi2> ...\`\n\n` +
        `Contoh:\n> ${p}poll Makan apa? | Nasi goreng | Mie ayam | Bakso\n\n` +
        `Minimal 2 opsi, maksimal ${MAX_OPTIONS}.`
    )
  }

  const question = parts[0].slice(0, 120)
  const options = parts.slice(1, MAX_OPTIONS + 1).map((s) => s.slice(0, 60))
  if (options.length < 2) return ctx.reply('❌ Minimal 2 opsi.')

  seq += 1
  const pollId = `${Date.now().toString(36)}${seq.toString(36)}`
  const poll = {
    id: pollId,
    chat: ctx.chat,
    question,
    options,
    votes: new Map(),
    creator: digits(ctx.sender),
    at: Date.now(),
  }
  polls.set(pollId, poll)

  // Batasi memori: simpan 200 poll terakhir saja.
  if (polls.size > 200) {
    const oldest = [...polls.keys()].slice(0, polls.size - 200)
    for (const k of oldest) polls.delete(k)
  }

  options.forEach((opt, i) => {
    onRichReply(`poll:${pollId}:${i}`, async (c2) => {
      const live = polls.get(pollId)
      if (!live) return c2.reply('⚠️ Poll ini sudah kedaluwarsa.')
      const who = digits(c2.sender)
      const prev = live.votes.get(who)
      live.votes.set(who, i)
      await c2.react(prev === i ? '👍' : '🗳️')
      const note = prev === undefined ? 'Suara dicatat' : prev === i ? 'Suaramu tetap' : 'Suara diganti'
      return c2.reply(`🗳️ *${note}* — ${esc(cut(opt, 40))}\n\n${tally(live)}`)
    })
  })

  const buttons = options.slice(0, 3).map((opt, i) => ({ text: cut(opt, 20), id: `poll:${pollId}:${i}` }))
  const text =
    `📊 *POLL BARU*\n\n` +
    `❓ ${esc(question)}\n\n` +
    options.map((opt, i) => `${i + 1}. ${esc(cut(opt, 40))}`).join('\n') +
    `\n\n> Pilih lewat tombol di bawah. Bisa ganti suara kapan saja.`

  if (options.length <= 3) {
    return ctx.replyButtons({ text, footer: '🗳️ skyline-JXRA • Voting', buttons })
  }

  return ctx.replyList({
    text,
    footer: '🗳️ skyline-JXRA • Voting',
    title: 'Pilih opsi',
    buttonText: '🗳️ Lihat opsi',
    sections: [
      {
        title: 'Opsi voting',
        rows: options.map((opt, i) => ({ title: cut(opt, 24), id: `poll:${pollId}:${i}` })),
      },
    ],
  })
}

export { pluginConfig as config, handler }
