/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * richMessage.js — Builder & reader untuk interactive messages
 * PENTING: jangan pernah tempel externalAdReply (kartu .setreply) ke
 * interactiveMessage.contextInfo — di WA biasa pesan jadi HILANG total
 * (kartu apa pun, bahkan title+body doang, bikin hilang). Kartu CTA tetap
 * dipakai di pesan teks via core/replyStyle.js; karena itu contextInfo
 * interactive sengaja gak dipasang sama sekali.
 */

/**
 * Bungkus interactiveMessage:
 * viewOnceMessage + messageContextInfo.
 */
function wrapInteractive(interactiveMessage) {
  return {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
        interactiveMessage
      }
    }
  }
}

/** Bentuk tombol nativeFlow. Default = quick_reply (id); opsional: url / phone / copy. */
function buildNativeButton(btn) {
  if (btn.url) {
    return {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: btn.text, url: btn.url, merchant_url: btn.url })
    }
  }
  if (btn.phone) {
    return {
      name: 'cta_call',
      buttonParamsJson: JSON.stringify({ display_text: btn.text, phone_number: btn.phone })
    }
  }
  if (btn.copy) {
    return {
      name: 'cta_copy',
      buttonParamsJson: JSON.stringify({ display_text: btn.text, copy_text: btn.copy })
    }
  }
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: btn.text, id: btn.id })
  }
}

/**
 * Header media: hasil upload `client.message.upload` ditanam sebagai header
 * interactive message (cara paling reliable buat thumbnail — bukan
 * externalAdReply). `headerImage.kind` = 'imageMessage' | 'videoMessage';
 * objek tanpa `kind` (caller lama) dianggap imageMessage.
 */
function buildHeader(headerImage, title = '', subtitle = '') {
  if (!headerImage) return undefined
  const { kind = 'imageMessage', ...media } = headerImage
  return {
    title,
    subtitle,
    hasMediaAttachment: true,
    [kind]: media
  }
}

export function richButtons({ text, footer, buttons, adReply, headerImage }) {
  return wrapInteractive({
    header: buildHeader(headerImage),
    body: { text },
    footer: footer ? { text: footer } : undefined,
    nativeFlowMessage: {
      messageVersion: 1,
      buttons: buttons.map(buildNativeButton)
    }
  })
}

export function richList({ text, footer, title, buttonText, sections, extraButtons = [], adReply, headerImage }) {
  return wrapInteractive({
    header: buildHeader(headerImage),
    body: { text },
    footer: footer ? { text: footer } : undefined,
    nativeFlowMessage: {
      messageVersion: 1,
      buttons: [
        {
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title,
            button_text: buttonText,
            sections: sections.map((section) => ({
              title: section.title,
              rows: section.rows.map((row) => ({
                title: row.title,
                description: row.description ?? '',
                id: row.id
              }))
            }))
          })
        },
        ...extraButtons.map(buildNativeButton)
      ]
    }
  })
}

/**
 * Kartu interaktif gaya Hoshino v21 (Location Button): header FOTO + single_select
 * kategori + cta_url saluran + quick_reply allmenu + bottom_sheet +
 * limited_time_offer (copy_code). Tombol & messageParamsJson disusun persis
 * seperti Hoshino supaya tata letak 1:1.
 *
 * [HAPUS MAP] Header HANYA boleh `imageMessage` (foto dari asset).
 * `locationMessage` (pin) itu selalu digambar WhatsApp sebagai PETA Google Maps
 * yang menutupi `jpegThumbnail` — gejala "thumb ketimpa maps" (tried:
 * `hasMediaAttachment: true` pun tetap map). Karena itu fallback ke pin sudah
 * DIBUANG: upload foto gagal → header kosong (log warn), bukan peta.
 */
export function richLocationList({
  text, footer, headerImage, headerTitle = '', headerSubtitle = '',
  sections, channelUrl, copyCode = '', offerText = '',
  bottomSheet = {}
}) {
  // {} (tombol kosong/penuh) & icon di dalam buttonParamsJson membesar
  // identik dengan Hoshino v21 — divider_indices [1,2] letakkan pemisah.
  const buttons = [
    {},
    {
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: '\u2064',
        sections: sections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({
            title: r.title, description: r.description ?? '', id: r.id
          }))
        })),
        icon: 'DEFAULT'
      })
    },
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: ' ', url: channelUrl, icon: 'PROMOTION' })
    },
    {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: 'all', id: 'menu:all', icon: 'DOCUMENT' })
    }
  ]
  const messageParams = {
    bottom_sheet: {
      list_title: bottomSheet.list_title || 'Pilih Kategori',
      button_title: bottomSheet.button_title ?? ' ',
      in_thread_buttons_limit: bottomSheet.in_thread_buttons_limit ?? 3,
      divider_indices: bottomSheet.divider_indices ?? [1, 2]
    },
    limited_time_offer: {
      text: offerText || headerTitle || '',
      url: channelUrl || '',
      copy_code: copyCode || '',
      expiration_time: Date.now() + (bottomSheet.offerExpiresMs ?? 3_600_000)
    }
  }
  return wrapInteractive({
    // Header FOTO (imageMessage) — satu-satunya bentuk yang render sebagai foto
    // di semua device. Tanpa foto → header kosong, TIDAK pernah locationMessage.
    header: headerImage ? buildHeader(headerImage, headerTitle, headerSubtitle) : undefined,
    body: { text },
    footer: footer ? { text: footer } : undefined,
    nativeFlowMessage: { messageVersion: 1, buttons, messageParamsJson: JSON.stringify(messageParams) }
  })
}

/**
 * Opsi kirim buat pesan interaktif (tombol/list) — private chat butuh node
 * tambahan `bot biz_bot=1` biar tombol render di WA biasa (WA Business udah
 * jalan tanpa ini); grup cukup biz doang.
 */
export function interactiveSendOptions(jid) {
  const isGroup = `${jid || ''}`.endsWith('@g.us')
  if (isGroup) return {}
  return { customNodes: [{ tag: 'bot', attrs: { biz_bot: '1' }, content: [] }] }
}

export function readRichReply(message) {
  if (!message) return undefined

  const tpl = message.templateButtonReplyMessage
  if (tpl?.selectedId) {
    return {
      name: 'template_button_reply',
      id: tpl.selectedId,
      raw: { selectedDisplayText: tpl.selectedDisplayText }
    }
  }

  const flow = message.interactiveResponseMessage?.nativeFlowResponseMessage
  if (flow) {
    let params = {}
    try {
      params = flow.paramsJson ? JSON.parse(flow.paramsJson) : {}
    } catch {}
    const id = params.id ?? params.selected_row_id ?? params.row_id ?? ''
    if (id) return { name: flow.name ?? 'native_flow', id, raw: params }
  }

  const btn = message.buttonsResponseMessage
  if (btn?.selectedButtonId) {
    return { name: 'buttons_response', id: btn.selectedButtonId, raw: btn }
  }

  const rowId = message.listResponseMessage?.singleSelectReply?.selectedRowId
  if (rowId) {
    return { name: 'list_response', id: rowId, raw: message.listResponseMessage }
  }

  const ext = message.extendedTextMessage
  const quoted = ext?.contextInfo?.quotedMessage
  const interactive =
    quoted?.interactiveMessage ??
    quoted?.viewOnceMessage?.message?.interactiveMessage
  const buttons = interactive?.nativeFlowMessage?.buttons

  if (ext?.text && Array.isArray(buttons)) {
    for (const b of buttons) {
      let params = {}
      try {
        params = JSON.parse(b.buttonParamsJson || '{}')
      } catch {
        continue
      }

      if (params.id && params.display_text === ext.text) {
        return { name: 'quoted_quick_reply', id: params.id, raw: params }
      }

      for (const section of params.sections ?? []) {
        for (const row of section.rows ?? []) {
          if (
            row.id &&
            (row.title === ext.text || `${row.title}\n${row.description}` === ext.text)
          ) {
            return { name: 'quoted_single_select', id: row.id, raw: row }
          }
        }
      }
    }
  }

  return undefined
}
