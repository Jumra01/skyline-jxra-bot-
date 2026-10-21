/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * presence.js — Typing indicator & read receipt
 */
import { logger } from './logger.js'

let readWarned = false
let typingWarned = false

export async function markRead(client, event) {
  try {
    await client.message.sendReceipt(event, { type: 'read' })
  } catch (err) {
    if (!readWarned) {
      readWarned = true
      logger.warn({ err }, 'Auto-read gagal')
    }
  }
}

export async function sendTyping(client, chat) {
  // zapo-js: `sendChatstate(jid, { state: 'composing' })` → node <composing/>.
  // Pakai `{ type: ... }` (gaya Baileys) hasilnya node <chatstate> tanpa tag
  // anak, jadi WhatsApp diem aja — dulu itu sebabnya "typing…" nggak muncul.
  try {
    await client.presence.sendChatstate(chat, { state: 'composing' })
  } catch {
    try {
      await client.presence.sendChatstate(chat, { type: 'composing' })
    } catch (err) {
      if (!typingWarned) {
        typingWarned = true
        logger.warn({ err }, 'Typing indicator gagal')
      }
    }
  }
}
