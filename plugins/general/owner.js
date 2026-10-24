/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * owner.js — Menampilkan kontak owner bot secara 100% lengkap ala Hoshino Ai v2.5.5
 * Mendukung 5 Mode (ownerType 1-5):
 *   Type 1: Teks Rapi + Single Contact Cards
 *   Type 2: Carousel Interactive Cards (PP + Tombol Chat Owner wa.me + Menu)
 *   Type 3: Multi-Contact Array Card (VCard Group)
 *   Type 4: AIRich Post Cards (Social Media Instagram Style NIXEL)
 *   Type 5: AIRich Compact Entity Section (Verified Badge + Message Action)
 * Diatur melalui .setownertype 1-5
 */
import crypto from 'node:crypto'
import config from '../../config.js'
import { getGlobal } from '../../core/groupSettings.js'
import { getThumbBuffer } from '../../core/cta.js'

const pluginConfig = {
  name: 'owner',
  alias: ['creator', 'dev', 'developer'],
  category: 'general',
  description: 'Menampilkan kontak owner bot (5 mode ala Hoshino)',
  usage: '.owner [1-5]',
  example: '.owner 2',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
  energi: 0
}

const MIXED_BIZ_OPTIONS = {
  customNodes: [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' }, content: undefined }]
        }
      ]
    }
  ]
}

const DEFAULT_PP = 'https://cdn.gimita.id/download/pp%20kosong%20wa%20default%20(1)_1769506608569_52b57f5b.jpg'

async function getProfilePic(client, jid) {
  try {
    return await client.profile?.getProfilePicture?.(jid) || DEFAULT_PP
  } catch {
    return DEFAULT_PP
  }
}

async function handler(ctx) {
  const { client, chat, event, args } = ctx
  const botName = config.botName || 'skyline-JXRA'

  // Dukung override instan lewat argumen: `.owner 2`
  const argType = parseInt(args[0], 10)
  const ownerType = (argType >= 1 && argType <= 5) ? argType : (getGlobal('ownerType') || 2)

  const configOwners = (config.owner?.numbers || [])
    .map((n) => String(n).replace(/[^0-9]/g, ''))
    .filter((n) => n.length >= 10)

  const staffOwners = (config.staff || [])
    .map((s) => ({
      num: String(s.number).replace(/[^0-9]/g, ''),
      label: s.label || 'Staff / Developer'
    }))
    .filter((s) => s.num.length >= 10)

  const ownerList = [
    ...configOwners.map((num) => ({ num, label: '👑 Owner Utama', isMain: true })),
    ...staffOwners.filter((s) => !configOwners.includes(s.num)).map((s) => ({ num: s.num, label: `⭐ ${s.label}`, isMain: false }))
  ]

  if (ownerList.length === 0) {
    return ctx.reply('❌ Belum ada owner terdaftar di konfigurasi bot.')
  }

  // ── TYPE 1: Teks Rapi + Contact Cards per nomor ──
  if (ownerType === 1) {
    let text = `👑 *ᴏᴡɴᴇʀ ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ*\n\n`
    text += `╭┈┈⬡「 📋 *ᴅᴇᴛᴀɪʟ* 」\n`
    text += `┃ 🤖 ʙᴏᴛ: *${botName}*\n`
    text += `┃ 👑 ᴏᴡɴᴇʀ ᴜᴛᴀᴍᴀ: *${configOwners.length}*\n`
    text += `┃ ⭐ ᴏᴡɴᴇʀ ʟᴀɪɴɴʏᴀ: *${staffOwners.length}*\n`
    text += `┃ 🟢 sᴛᴀᴛᴜs: *Online*\n`
    text += `╰┈┈⬡\n\n`
    text += `> _Hubungi owner via contact card di bawah ya kak~ 🌸_`

    await ctx.reply(text)

    for (const { num, label } of ownerList) {
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${label}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`
      await client.message.send(chat, {
        contactMessage: {
          displayName: label,
          vcard
        }
      }, { quote: event })
    }
    return
  }

  // ── TYPE 2: Carousel Native Cards (Persis Hoshino Type 2) ──
  if (ownerType === 2) {
    let uploadedImage = null
    try {
      const thumb = await getThumbBuffer()
      if (thumb && client.message?.upload) {
        const up = await client.message.upload(thumb, { type: 'image', mimetype: 'image/jpeg' })
        uploadedImage = {
          url: up.url,
          directPath: up.directPath,
          mediaKey: up.mediaKey,
          fileSha256: up.fileSha256,
          fileEncSha256: up.fileEncSha256,
          fileLength: up.fileLength,
          mediaKeyTimestamp: up.mediaKeyTimestamp,
          mimetype: 'image/jpeg'
        }
      }
    } catch {}

    const cards = ownerList.map(({ num, label }) => {
      const waUrl = `https://wa.me/${num}?text=Halo%20${encodeURIComponent(label)}~`
      return {
        header: {
          title: label,
          hasMediaAttachment: Boolean(uploadedImage),
          ...(uploadedImage ? { imageMessage: uploadedImage } : {})
        },
        body: {
          text: `Halo! Saya owner dari *${botName}*.\n\n📌 *Rules:*\n- Jangan spam bot\n- Jangan Call/VidCall tanpa izin\n- Hubungi jika ada kendala penting`
        },
        footer: { text: botName },
        nativeFlowMessage: {
          messageVersion: 1,
          buttons: [
            {
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: '💬 Chat Owner',
                url: waUrl,
                merchant_url: waUrl
              })
            },
            {
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: '📜 Menu Utama',
                id: '.allmenu'
              })
            }
          ]
        }
      }
    })

    return client.message.send(
      chat,
      {
        interactiveMessage: {
          body: {
            text: `Hallo *${ctx.pushName || 'Sahabat'}* 👋\n\nKamu ingin mengetahui owner dari *${botName}*?\nBerikut daftar pusat kontak kami:`
          },
          footer: { text: `${botName} • Developer Center` },
          carouselMessage: {
            messageVersion: 1,
            cards
          }
        }
      },
      {
        quote: event,
        ...MIXED_BIZ_OPTIONS
      }
    )
  }

  // ── TYPE 3: Multi-Contact Array Card ──
  if (ownerType === 3) {
    const contacts = ownerList.map(({ num, label }) => {
      return {
        displayName: `${label} (${botName})`,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${label}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`
      }
    })

    return client.message.send(chat, {
      contactsArrayMessage: {
        displayName: `${botName} Official Owners`,
        contacts
      }
    }, { quote: event })
  }

  // ── TYPE 4: AIRich Post Cards (Hoshino Type 4 - Social Media Instagram Post) ──
  if (ownerType === 4) {
    const posts = await Promise.all(ownerList.map(async ({ num, label, isMain }) => {
      const ppUrl = await getProfilePic(client, `${num}@s.whatsapp.net`)
      const waUrl = `https://wa.me/${num}?text=Hai%20${encodeURIComponent(label)}~`
      return {
        title: label,
        subtitle: `${label} • ${botName}`,
        username: `~ ${label}`,
        profile_picture_url: ppUrl,
        is_verified: isMain,
        thumbnail_url: ppUrl,
        post_caption: `Kontak resmi developer & owner bot *${botName}*.\nSilakan hubungi untuk kerjasama atau bantuan teknis.`,
        likes_count: 999,
        comments_count: 88,
        shares_count: 50,
        post_url: waUrl,
        post_deeplink: waUrl,
        source_app: 'INSTAGRAM',
        footer_label: `Ketuk untuk chat owner~ 💖`,
        footer_icon: ppUrl,
        is_carousel: ownerList.length > 1,
        orientation: 'LANDSCAPE',
        post_type: 'PHOTO',
        __typename: 'GenAIPostPrimitive'
      }
    }))

    const payload = {
      response_id: crypto.randomUUID(),
      sections: [
        {
          __typename: 'GenAIUnifiedResponseSection',
          view_model: {
            __typename: 'GenAIHorizontalCarouselViewModel',
            primitives: posts
          }
        }
      ]
    }

    return client.message.send(chat, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              { messageType: 2, messageText: `✨ *Pusat Kontak Owner ${botName}*` }
            ],
            unifiedResponse: {
              data: Buffer.from(JSON.stringify(payload)).toString('base64')
            },
            contextInfo: { isForwarded: true, forwardOrigin: 4 }
          }
        }
      }
    }, { quote: event, additionalAttributes: { type: 'text' } })
  }

  // ── TYPE 5: AIRich Compact Entity Section (Hoshino Type 5 - Verified Badge) ──
  if (ownerType === 5) {
    const entities = await Promise.all(ownerList.map(async ({ num, label, isMain }) => {
      const ppUrl = await getProfilePic(client, `${num}@s.whatsapp.net`)
      return {
        __typename: 'GenAICompactEntityPrimitive',
        title: label,
        subtitle: isMain ? 'Owner Utama' : 'Team Developer',
        secondary_subtitle: `${botName} Multi-Device Bot`,
        entity_id: Number(num.slice(-8)) || 12345678,
        entity_url: `https://wa.me/${num}`,
        entity_type: 'PERSON',
        action_type: 'MESSAGE',
        is_verified: isMain,
        image: {
          url: ppUrl
        }
      }
    }))

    const sections = entities.map((ent) => ({
      __typename: 'GenAIUnifiedResponseSection',
      view_model: {
        __typename: 'GenAISingleLayoutViewModel',
        primitive: ent
      }
    }))

    const payload = {
      response_id: crypto.randomUUID(),
      sections
    }

    return client.message.send(chat, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              { messageType: 2, messageText: `👑 *Pusat Kontak Owner & Developer — ${botName}*` }
            ],
            unifiedResponse: {
              data: Buffer.from(JSON.stringify(payload)).toString('base64')
            },
            contextInfo: { isForwarded: true, forwardOrigin: 4 }
          }
        }
      }
    }, { quote: event, additionalAttributes: { type: 'text' } })
  }
}

export { pluginConfig as config, handler }
