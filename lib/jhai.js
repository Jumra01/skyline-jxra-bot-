/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * jhai.js — Engine Rich Response Meta AI untuk Zapo.
 */

import crypto from 'node:crypto'
import { generateVerificationMetadata } from './jhrich.js'
import { tokenize, LANGS } from './highlight.js'

const SUB_BOT_JID = '867051314767696@bot'
const UNI_BOT_JID = '236911050403982@bot'

function buildGroupNodes(jid) {
  return [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' }, content: [] }]
        }
      ]
    }
  ]
}

function sendOptions(ctx) {
  const opts = { additionalAttributes: { type: 'text' } }
  if (`${ctx.chat || ''}`.endsWith('@g.us')) {
    opts.customNodes = buildGroupNodes(ctx.chat)
  }
  return opts
}

export function subText(text) {
  return { messageType: 2, messageText: text }
}

export function subCode(code, lang = 'javascript') {
  return {
    messageType: 5,
    codeMetadata: {
      codeLanguage: LANGS[lang] || lang || 'javascript',
      codeBlocks: tokenize(code)
    }
  }
}

export function subTable(rows) {
  return {
    messageType: 4,
    tableMetadata: {
      rows: rows.map((r, i) => ({ items: r, isHeading: i === 0 }))
    }
  }
}

export function buildSubContent(submessages, botJid = SUB_BOT_JID) {
  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid },
            forwardOrigin: 4
          }
        }
      }
    }
  }
}

export async function sendSubRich(ctx, submessages) {
  return await ctx.client.message.send(ctx.chat, buildSubContent(submessages), sendOptions(ctx))
}

export async function editReplace(ctx, id, content) {
  return await ctx.client.message.send(
    ctx.chat,
    {
      botForwardedMessage: {
        message: {
          protocolMessage: {
            key: { remoteJid: ctx.chat, fromMe: true, id },
            type: 14,
            editedMessage: content
          }
        }
      }
    },
    sendOptions(ctx)
  )
}

export function thinkingPrimitive(title = 'Sedang berpikir...') {
  return {
    __typename: 'GenAIBotProgressStatusPrimitive',
    title,
    is_in_progress: true
  }
}

export function textPrimitive(text, inlineEntities) {
  return {
    __typename: 'GenAIMarkdownTextUXPrimitive',
    text,
    ...(inlineEntities?.length ? { inline_entities: inlineEntities } : {})
  }
}

export function hyperlinkEntity(key, displayName, url) {
  return {
    key,
    metadata: {
      display_name: displayName,
      is_trusted: true,
      url,
      __typename: 'GenAIInlineLinkItem'
    }
  }
}

export function single(primitive) {
  return { view_model: { primitive, __typename: 'GenAISingleLayoutViewModel' } }
}

export function vStack(primitives) {
  return { view_model: { primitives, __typename: 'GenAIVStackLayoutViewModel' } }
}

export function buildAIContent(sections) {
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        verificationMetadata: generateVerificationMetadata(),
        botResponseId: crypto.randomUUID()
      }
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(
              JSON.stringify({
                __typename: 'GenAIUnifiedResponse',
                response_id: crypto.randomUUID(),
                sections: sections.map((s) => ({
                  __typename: 'GenAIUnifiedResponseSection',
                  ...s
                }))
              })
            ).toString('base64')
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: UNI_BOT_JID },
            forwardOrigin: 4
          }
        }
      }
    }
  }
}

export async function sendAIRich(ctx, sections) {
  return await ctx.client.message.send(ctx.chat, buildAIContent(sections), sendOptions(ctx))
}

export async function sendThinking(ctx, title = 'Sedang berpikir...') {
  const content = buildAIContent([vStack([thinkingPrimitive(title)])])

  const sent = await ctx.client.message.send(ctx.chat, content, sendOptions(ctx))
  const id = sent?.id || sent?.key?.id || null
  if (!id) return sent

  try {
    await ctx.client.message.send(
      ctx.chat,
      {
        botForwardedMessage: {
          message: {
            protocolMessage: {
              key: { remoteJid: ctx.chat, fromMe: true, id },
              type: 14,
              editedMessage: content
            }
          }
        }
      },
      sendOptions(ctx)
    )
  } catch (e) {
    console.log('[JHAi] thinking bypass-edit fail:', String(e?.message || e).slice(0, 120))
  }

  return sent
}
