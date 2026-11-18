/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * safelink.js — Bypass tautan safelink (sfl.gl / safelinku / tutwuri / linku.to)
 * Engine: scraper/SAFELINK.js (redirect + cookie + form + fallback API).
 */

import { bypassSafelink, isSafelink, SafelinkError } from '../../scraper/SAFELINK.js';

const pluginConfig = {
  name: "safelink",
  alias: ['bypass', 'skip', 'safelink'],
  category: "tools",
  description: "Buka tautan safelink (sfl.gl, safelinku, tutwuri, linku.to) jadi link tujuan",
  usage: ".bypass <link safelink>",
  example: ".bypass https://sfl.gl/xxxxx",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 1,
  isEnabled: true,
};

const LINK_RE = /https?:\/\/[^\s<>"']+/i;

function extractUrl(ctx) {
  const direct = String(ctx.text || '').match(LINK_RE);
  if (direct) return direct[0].replace(/[),.!?]+$/, '');

  const quoted = ctx.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedText =
    quoted?.conversation ||
    quoted?.extendedTextMessage?.text ||
    quoted?.imageMessage?.caption ||
    quoted?.videoMessage?.caption ||
    '';
  const q = String(quotedText || '').match(LINK_RE);
  return q ? q[0].replace(/[),.!?]+$/, '') : null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function handler(ctx) {
  const url = extractUrl(ctx);

  if (!url) {
    return ctx.reply(
      '🔓 *BYPASS SAFELINK*\n\n' +
      'Kirim link safelink-nya, atau reply pesan yang berisi link.\n\n' +
      '*Contoh:*\n' +
      '`.bypass https://sfl.gl/xxxxx`\n' +
      '`.skip https://tutwuri.id/xxxxx`\n\n' +
      '_Support: sfl.gl, linku.to, safelinku.com/net, safelinkku.com, tutwuri.id._'
    );
  }

  if (!isSafelink(url)) {
    return ctx.reply(
      '⚠️ Domain itu belum didukung.\n\n' +
      `Link: ${url}\n\n` +
      '_Yang didukung: sfl.gl, linku.to, safelinku.com/net, safelinkku.com, tutwuri.id._'
    );
  }

  await ctx.react('⏳');

  let result;
  try {
    result = await bypassSafelink(url);
  } catch (e) {
    await ctx.react('❎');
    const msg = e instanceof SafelinkError ? e.message : String(e?.message || e);
    return ctx.reply('❌ *Gagal bypass*\n\n> ' + msg);
  }

  const text = [
    '┌───「 🔓 *BYPASS SAFELINK* 」───┐',
    '',
    `- *Asal:* _${hostOf(url)}_`,
    `- *Metode:* _${result.source === 'engine' ? 'engine lokal' : 'API cadangan'}_`,
    '',
    '*Link tujuan:*',
    result.url,
    '',
    '└──────────────────────────────────────┘',
    '',
    '> ✨ _skyline-JXRA_'
  ].join('\n');

  try {
    await ctx.replyButtons({
      text,
      footer: '🔓 skyline-JXRA • Safelink Bypass',
      buttons: [{ text: '🔗 Buka Link', url: result.url }]
    });
  } catch {
    await ctx.reply(text);
  }
  await ctx.react('✅');
}

export { pluginConfig as config, handler };
