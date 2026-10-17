/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * tourl.js — Convert media (gambar/video/audio/dokumen) jadi link URL.
 *
 * Thanks to XN for helping this. 
 */
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js';
import uploadFile from '../../lib/uploadFile.js';
import uploadImage from '../../lib/uploadImage.js';

const IMAGE_HOST_MIME =
  /image\/(png|jpe?g|gif)|video\/mp4|audio\/mpeg|audio\/mp3|audio\/opus/;

function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null;
}

function getContextInfo(message) {
  if (!message) return null;
  for (const key of Object.keys(message)) {
    const node = message[key];
    if (node && typeof node === 'object' && node.contextInfo) {
      return node.contextInfo;
    }
  }
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const pluginConfig = {
  name: "tourl",
  alias: ['upload'],
  category: "tools",
  description: "Convert media (gambar/video/audio/dokumen) jadi link URL",
  usage: ".tourl",
  example: ".tourl",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 3,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    const event = getEvent(ctx);
    if (!event) {
      return ctx.reply(
        'Gak nemu raw message event di ctx. Cek properti yang bener di framework (ctx.message / ctx.event / dst).'
      );
    }

    const rawMessage = event.message ?? event;
    const ctxInfo = getContextInfo(rawMessage);
    const targetMessage = ctxInfo?.quotedMessage || rawMessage;

    const payload = targetMessage && resolveMediaPayload(targetMessage);

    if (!payload || !payload.mimetype) {
      return ctx.reply(
        'Balas media (gambar/video/audio/dokumen) dengan perintah *.tourl* atau *.upload*'
      );
    }

    await ctx.react('⏳');

    try {
      const stream = await downloadMediaMessage(targetMessage);
      const media = await streamToBuffer(stream);

      const isTele = IMAGE_HOST_MIME.test(payload.mimetype);
      const link = await (isTele ? uploadImage : uploadFile)(media);

      const caption =
        `📮 *L I N K :*\n${link}\n\n` +
        `📊 *S I Z E :* ${media.length} Byte\n` +
        `📛 *E x p i r e d :* ${isTele ? 'No Expiry Date' : 'Unknown'}`;

      await ctx.react('✅');
      ctx.reply(caption);
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('Terjadi kesalahan saat mengunggah media: ' + (e.message || e));
    }
  }

export { pluginConfig as config, handler };
