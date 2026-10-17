/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * richMessage.js — Builder & reader untuk interactive messages
 * PENTING: jangan pernah tempel externalAdReply (kartu .setreply) ke
 * interactiveMessage.contextInfo — di WA biasa pesan jadi HILANG total
 * (terbukti .rdiag: kartu apa pun, bahkan title+body doang, bikin hilang;
 * kartu CTA tetap dipakai di pesan teks via core/replyStyle.js).
 * Karena itu contextInfo interactive sengaja gak dipasang sama sekali.
 */

/**
 * Bungkus interactiveMessage ala Hoshino/Baileys resmi:
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
 * Header media ala skyline-md: hasil upload `client.message.upload`
 * ditanam sebagai header interactive message — ini cara paling reliable
 * buat bikin thumbnail muncul di client resmi (bukan externalAdReply).
 * `headerImage.kind` = 'imageMessage' | 'videoMessage' (foto/video auto);
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
 * Opsi kirim buat pesan interaktif (tombol/list).
 * Zapo otomatis nambah node `biz > interactive > native_flow`, tapi private
 * chat butuh tambahan node `bot biz_bot=1` biar tombol render di WA biasa
 * (WA Business udah jalan tanpa ini). Grup cukup biz doang.
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
