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
 * Header bertipe `locationMessage` (pin lokasi) untuk kartu interaktif —
 * gaya Hoshino v21. `title`/`subtitle` tampil di atas pin. Jika
 * `location.jpegThumbnail` disertakan (buffer/jpeg), WA render foto di atas
 * pin sehingga header menampilkan *foto* bukan map polos (gaya setreply v9).
 *
 * `hasMediaAttachment` WAJIB `true` kalau ada `jpegThumbnail` — kalau `false`,
 * WhatsApp tetap menggambar MAP yang menutupi foto (gejala: thumb ketimpa maps,
 * beda dengan `.setreply v7` yang pakai `hasMediaAttachment: true`).
 */
function buildLocationHeader(location, title = '', subtitle = '') {
  if (!location) return undefined
  const lm = {
    degreesLatitude: location.degreesLatitude,
    degreesLongitude: location.degreesLongitude,
    name: location.name || '',
    address: location.address || '',
    isLive: false
  }
  if (location.jpegThumbnail) lm.jpegThumbnail = location.jpegThumbnail
  if (location.url) lm.url = location.url
  // Bentuk harus identik dengan `.setreply v7` (core/replyStyle.js) yang sudah
  // terbukti menampilkan FOTO, bukan map: `hasMediaAttachment: true` + tanpa
  // kunci `title`/`subtitle` kosong.
  return {
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
    hasMediaAttachment: Boolean(location.jpegThumbnail),
    locationMessage: lm
  }
}

/**
 * Kartu interaktif gaya Hoshino v21 (Location Button): pin lokasi di header
 * + single_select kategori + cta_url saluran + quick_reply allmenu +
 * bottom_sheet + limited_time_offer (copy_code). Tombol & messageParamsJson
 * disusun persis seperti Hoshino supaya tata letak 1:1.
 */
export function richLocationList({
  text, footer, headerImage, headerTitle = '', headerSubtitle = '',
  sections, channelUrl, copyCode = '', offerText = '',
  bottomSheet = {}, locationThumb = null
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
    // Prioritaskan header FOTO (imageMessage) — reliably render di semua device.
    // locationMessage (pin+map) tetap dipakai sebagai fallback bila upload foto gagal
    // (thumb ganti lewat config.ui.menuThumb), biar header tidak pernah kosong.
    header: headerImage
      ? buildHeader(headerImage, headerTitle, headerSubtitle)
      : buildLocationHeader(
          { degreesLatitude: -7.2575, degreesLongitude: 112.7521, name: headerTitle, address: headerSubtitle, jpegThumbnail: locationThumb },
          '', ''
        ),
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
