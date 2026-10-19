/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * yta.js — Download audio (mp3) dari YouTube. 
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { downloadAudio as skylineAudio, isConfigured as skylineReady } from '../../scraper/SKYLINE.js';
import { logger } from '../../core/logger.js';
import { fetchThumbBuffer } from '../../lib/ytUi.js';
import { embedAudioCover } from '../../lib/audioCover.js';
import { getCollectionCover } from '../../lib/musicCover.js';

/** Kirim foto thumbnail; gagal kirim foto jangan bikin audio batal. */
async function sendCover(ctx, cover, caption) {
  if (!cover) return;
  try {
    await ctx.client.message.send(ctx.chat, {
      type: 'image',
      media: cover.buffer,
      mimetype: 'image/jpeg',
      caption
    });
  } catch (err) {
    logger.warn(`yta: foto thumbnail gagal dikirim (${err?.message || err})`);
  }
}

function getInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      ...(fs.existsSync('cookies.txt') ? ['--cookies', 'cookies.txt'] : []),
      '--dump-json',
      url
    ];
    const proc = spawn('yt-dlp', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => { out += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { err += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `Failed to fetch video info: ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });
  });
}

function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    let filename = '';
    let stderr = '';
    fs.mkdirSync('tmp', { recursive: true });

    const dl = spawn('yt-dlp', [
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      ...(fs.existsSync('cookies.txt') ? ['--cookies', 'cookies.txt'] : []),
      '-f', 'bestaudio/best',
      '-x',
      '--audio-format', 'mp3',
      '--restrict-filenames',
      '--print', 'after_move:filename',
      '-o', 'tmp/%(id)s_%(epoch)s.%(ext)s',
      url
    ]);

    dl.stdout.on('data', (d) => { filename += d.toString(); });
    dl.stderr.on('data', (d) => { stderr += d.toString(); });
    dl.on('error', reject);
    dl.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || 'Download audio failed'));
      const printed = filename.trim().split('\n').pop();
      const file = printed.replace(/\.[^./\\]+$/, '.mp3');
      const targetFile = fs.existsSync(file) ? file : printed;
      if (!fs.existsSync(targetFile)) return reject(new Error('File not found'));
      resolve(targetFile);
    });
  });
}

/** Kirim audio hasil Skyline API (kalau key diisi). */
async function sendViaSkyline(ctx, url) {
  const audio = await skylineAudio(url);
  const info = audio.info || {};
  const title = String(audio.title || info.title || 'YouTube Audio').replace(/[\\/:*?"<>|]/g, '');

  const caption =
    `*${title}*\n\n` +
    `*Duration:* ${info.duration || '-'}\n` +
    `*Link:* ${url}\n\n` +
    `> Via Skyline API 🎧`;

  let cover = await fetchThumbBuffer(audio.thumbnail, {
    width: 640,
    videoId: info.videoId
  });
  if (!cover) {
    const fallback = await getCollectionCover(640);
    if (fallback) cover = { buffer: fallback, width: 640, height: 640, source: 'local' };
  }

  await sendCover(ctx, cover, caption);

  // Tanam cover ke file audio biar player WhatsApp gak nampilin kotak hitam.
  const embedded = await embedAudioCover(audio.buffer, audio.mimetype, cover?.buffer);

  await ctx.client.message.send(ctx.chat, {
    type: 'audio',
    media: embedded.buffer,
    mimetype: audio.mimetype,
    fileName: `${title}.${audio.ext}`
  });
}

const pluginConfig = {
  name: "yta",
  alias: ['ytmp3', 'ytaudio'],
  category: "downloader",
  description: "Download audio (mp3) dari YouTube",
  usage: ".yta",
  example: ".yta",
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
    const url = (ctx.text || '').trim();
    if (!url) {
      return ctx.reply(`*Contoh Pakai :*\n.yta https://youtu.be/xxxx`);
    }

    let filePath;
    await ctx.react('⏳');

    try {
      // Jalur utama: Skyline API (skyline.web.id) kalau API key diisi.
      if (skylineReady()) {
        try {
          await sendViaSkyline(ctx, url);
          await ctx.react('✅');
          return;
        } catch (err) {
          logger.warn(`yta: Skyline gagal (${err?.message || err}) — fallback yt-dlp`);
        }
      }

      const info = await getInfo(url);
      const title = (info.title || 'YouTube Audio').replace(/[\\/:*?"<>|]/g, '');
      const caption =
        `*${title}*\n\n` +
        `*Author:* ${info.uploader || '-'}\n` +
        `*Views:* ${info.view_count || '-'}\n` +
        `*Duration:* ${info.duration_string || info.duration || '-'}\n` +
        `*Link:* ${url}\n\n` +
        `> Downloading audio...`;

      let cover = await fetchThumbBuffer(info.thumbnail, {
        width: 640,
        videoId: info.id
      });
      if (!cover) {
        const fallback = await getCollectionCover(640);
        if (fallback) cover = { buffer: fallback, width: 640, height: 640, source: 'local' };
      }

      await sendCover(ctx, cover, caption);

      filePath = await downloadAudio(url);
      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / 1024 / 1024;
      const rawBuffer = fs.readFileSync(filePath);
      const embedded = await embedAudioCover(rawBuffer, 'audio/mpeg', cover?.buffer);
      const buffer = embedded.buffer;

      if (sizeMB > 100) {
        await ctx.client.message.send(ctx.chat, {
          type: 'document', media: buffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`
        });
      } else {
        await ctx.client.message.send(ctx.chat, {
          type: 'audio', media: buffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`
        });
      }

      await ctx.react('✅');
    } catch (err) {
      await ctx.react('❎');
      ctx.reply(err.message || String(err));
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

export { pluginConfig as config, handler };
