/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tesrich.js — Tes kirim `richResponseMessage` (AI rich response) per varian
 * — khusus owner, buat ngecek keluarga pesan AI rich apakah sampai di HP.
 *
 * Latar: zapo-js PR #273 (rilis 1.9.0) memperbaiki family ini jatuh ke
 * media-default sehingga stanza dibuang diam-diam server (ack OK, gak nyampe).
 * Varian yang dites: teks (2) • tabel (4) • code block (5) • LaTeX (8) •
 * HTML unifiedResponse (kartu native ala Meta AI).
 *
 * Pemakaian:
 *   .tesrich          → kirim SEMUA varian berurutan + ringkasan hasil
 *   .tesrich tabel    → kirim satu varian (teks|tabel|code|latex|html)
 *
 * Catatan: ack OK ≠ tampil. Bandingkan ringkasan di bawah dengan bubble yang
 * benar-benar muncul di chat — kalau ada yang ack tapi gak muncul = renderer
 * nolak; hilang total = server buang (gejala bug #272).
 */
import crypto from 'node:crypto'

const pluginConfig = {
  name: 'tesrich',
  alias: ['tesr', 'richsend'],
  category: 'tools',
  description: 'Tes kirim AI rich response (teks/tabel/code/LaTeX/HTML) per varian',
  usage: '.tesrich [teks|tabel|code|latex|html]',
  example: '.tesrich tabel',
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
  energi: 0,
}

/** payload dasar: botForwardedMessage > richResponseMessage (pola emeraldCard/testrich) */
function envelope(inner) {
  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          ...inner,
          // Envelope polos — persis lib/emeraldCard.js sendNativeHtml().
          // JANGAN tambah forwardingScore / forwardedAiBotMessageInfo:
          // dua field itu bikin WA nampilin "perbarui WhatsApp" / "tidak
          // didukung" khusus di jalur unifiedResponse (sudah kejadian di
          // log 2026-10-22, dan crm.js punya stripForward() karenanya).
          contextInfo: { isForwarded: true, forwardOrigin: 4 }
        }
      }
    }
  }
}

const VARIANTS = {
  teks: () => envelope({
    submessages: [
      { messageType: 2, messageText: '🧪 *TES RICH — TEKS*\nSubmessage type 2 (messageText) — kalau kamu baca ini, teks rich sampai.' }
    ]
  }),

  tabel: () => envelope({
    submessages: [
      {
        messageType: 4,
        tableMetadata: {
          title: 'Tes Tabel AI Rich Response',
          rows: [
            { items: ['Varian', 'Zapo', 'Status'], isHeading: true },
            { items: ['Teks', 'type 2', 'dicek'], isHeading: false },
            { items: ['Tabel', 'type 4', 'dicek'], isHeading: false },
            { items: ['Code', 'type 5', 'dicek'], isHeading: false },
            { items: ['LaTeX', 'type 8', 'dicek'], isHeading: false }
          ]
        }
      }
    ]
  }),

  code: () => envelope({
    submessages: [
      { messageType: 2, messageText: '🧪 *TES RICH — CODE BLOCK*' },
      {
        messageType: 5,
        codeMetadata: {
          codeLanguage: 'javascript',
          codeBlocks: [
            { highlightType: 1, codeContent: 'const ' },
            { highlightType: 0, codeContent: 'tes = ' },
            { highlightType: 3, codeContent: "'rich response'" },
            { highlightType: 0, codeContent: ';\n' },
            { highlightType: 2, codeContent: 'console.log' },
            { highlightType: 0, codeContent: '(tes);' }
          ]
        }
      }
    ]
  }),

  latex: () => envelope({
    submessages: [
      { messageType: 2, messageText: '🧪 *TES RICH — LaTeX*' },
      {
        messageType: 8,
        latexMetadata: {
          text: 'Rumus tes: ',
          expressions: [{ latexExpression: 'E = mc^2', width: 100, height: 50 }]
        }
      }
    ]
  }),

  // unifiedResponse (GenAI HTML) — envelope sama dengan kartu native bot ini
  html: () => envelope({
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
              payload: '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tes Rich</title></head><body style="margin:0;background:#0b1220;color:#e7ecff;font-family:sans-serif"><div style="padding:24px"><h2 style="color:#7dd3fc">🧪 Tes Rich — HTML unifiedResponse</h2><p>Kartu HTML native lewat <b>richResponseMessage.unifiedResponse</b>.</p><p style="color:#94a3b8">Kalau kotak ini tampil, jalur GenAI unified response sehat.</p></div></body></html>'
            }
          }
        }]
      })).toString('base64')
    }
  })
}

const ORDER = ['teks', 'tabel', 'code', 'latex', 'html']

async function handler(ctx) {
  const pick = (ctx.args[0] || '').toLowerCase()

  if (pick && !VARIANTS[pick]) {
    return ctx.reply(
      `Varian *${pick}* gak dikenal.\n\nPakai: ${ORDER.map(k => '`' + k + '`').join(' / ')}\natau .tesrich tanpa argumen buat kirim semua.`
    )
  }

  const keys = pick ? [pick] : ORDER
  const rows = []
  let sukses = 0

  await ctx.react('🧪')

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    // teks penanda per varian — biar kalau rich-nya dibuang server,
    // user tetap tahu varian mana yang hilang dari chat
    await ctx.reply(`▶ [${i + 1}/${keys.length}] varian *${key}* dikirim…`)
    try {
      const res = await ctx.client.message.send(ctx.chat, VARIANTS[key](), {
        additionalAttributes: { type: 'text' }
      })
      const ackErr = res?.ack?.error
      sukses += 1
      rows.push(
        ackErr
          ? `[⚠️] ${key} — ack dengan error *${ackErr}* • id \`${res?.id ?? '?'}\``
          : `[✅] ${key} — ack OK • ${res?.attempts ?? '?'} attempt • id \`${res?.id ?? '?'}\``
      )
    } catch (err) {
      rows.push(`[❌] ${key} — ${err?.message || String(err)}`)
    }
    // jeda biar bubble urut & gak kebaca spam
    if (i < keys.length - 1) await new Promise(r => setTimeout(r, 800))
  }

  const lines = [
    '🧪 *HASIL TES AI RICH RESPONSE*',
    '',
    ...rows,
    '',
    `Ringkasan: *${sukses}/${keys.length}* terkirim (ack).`,
    '',
    '⚠️ *Ack ≠ tampil.* Cocokkan daftar di atas dengan bubble di chat:',
    '• Bubble muncul lengkap → ✅ lolos renderer',
    '• Kena teks penanda tapi rich-nya hilang → renderer nolak',
    '• Gak ada sama sekali → server buang (gejala bug #272)',
    '• Error `479` → WA nolak family ini di chat/kondisi itu'
  ]
  await ctx.reply(lines.join('\n'))
}

export { pluginConfig as config, handler }
