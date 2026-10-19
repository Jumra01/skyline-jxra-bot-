/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * ytv.js — Download video YouTube pake yt-dlp, pilih kualitas lewat tombol.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { onRichReply } from '../../handlers/messageHandler.js';
import {
  ytInfo as skylineInfo,
  downloadVideo as skylineVideo,
  isConfigured as skylineReady
} from '../../scraper/SKYLINE.js';
import { logger } from '../../core/logger.js';
import { uploadThumbHeader } from '../../lib/ytUi.js';

const SESSIONS = (globalThis.JH_YTV_SESSIONS ??= new Map());
const PER_PAGE = 2;

const QUALITY_TIERS = [
  { height: 1080, label: '1080p Full HD' },
  { height: 720, label: '720p HD' },
  { height: 480, label: '480p SD' },
  { height: 360, label: '360p' },
  { height: 240, label: '240p' }
];

const LINE = '━━━━━━━━━━━━━━━━━━━━';

/** Rapikan judul jadi nama file yang aman. */
const safeName = (s, fallback = 'video') =>
  String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback;

function fetchInfo(url) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const p = spawn('yt-dlp', ['-J', '--no-warnings', url]);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `yt-dlp exit ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function fmtDuration(sec) {
  if (!sec) return '-:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function detectAvailableTiers(formats) {
  const heights = new Set(
    (formats || [])
      .filter((f) => f.height)
      .map((f) => f.height)
  );
  if (!heights.size) return [{ height: null, label: 'Best (auto)' }];

  const maxHeight = Math.max(...heights);
  const available = QUALITY_TIERS.filter((t) => t.height <= maxHeight);
  return available.length ? available : [{ height: maxHeight, label: `${maxHeight}p` }];
}

export function downloadYT(url, height) {
  return new Promise((resolve, reject) => {
    let filename = '';
    let stderr = '';

    fs.mkdirSync('tmp', { recursive: true });

    const formatSelector = height
      ? `bestvideo[height<=${height}][vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]/best[height<=${height}][vcodec^=avc1][ext=mp4]/bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`
      : 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]/best[vcodec^=avc1][ext=mp4]/best[ext=mp4]/best';

    const ytdlp = spawn('yt-dlp', [
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      ...(fs.existsSync('cookies.txt') ? ['--cookies', 'cookies.txt'] : []),
      '-f', formatSelector,
      '--merge-output-format', 'mp4',
      '--restrict-filenames',
      '--print', 'after_move:filename',
      '-o', 'tmp/%(id)s_%(epoch)s.%(ext)s',
      url
    ]);

    ytdlp.stdout.on('data', (data) => {
      filename += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('error', reject);
    ytdlp.on('close', (code) => {
      if (code === 0) {
        const file = filename.trim().split('\n').pop();
        if (!file || !fs.existsSync(file)) {
          return reject(new Error('Downloaded video file not found'));
        }
        return resolve(file);
      }
      reject(new Error(stderr || `Download failed, code: ${code}`));
    });
  });
}

async function sendVideo(ctx, filePath) {
  const { size } = fs.statSync(filePath);
  const sizeMB = size / 1024 / 1024;
  const fileName = filePath.split('/').pop();
  const buffer = fs.readFileSync(filePath);

  if (sizeMB > 100) {
    await ctx.client.message.send(ctx.chat, {
      type: 'document', media: buffer, mimetype: 'video/mp4', fileName
    });
  } else {
    await ctx.client.message.send(ctx.chat, {
      type: 'video', media: buffer, mimetype: 'video/mp4'
    });
  }
}

async function downloadAndSend(ctx, idx) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.ytv <url>* lagi.');
  const tier = sess.tiers[idx];
  if (!tier) return ctx.reply('Pilihan gak valid.');

  await ctx.react('⏳');

  // Jalur utama: Skyline API (skyline.web.id) kalau API key diisi.
  if (skylineReady()) {
    try {
      const video = await skylineVideo(sess.url, tier.height, { info: sess.skyline });
      await ctx.client.message.send(ctx.chat, {
        type: 'video',
        media: video.buffer,
        mimetype: video.mimetype,
        fileName: `${safeName(video.title || sess.title)}.${video.ext}`
      });
      await ctx.react('✅');
      return;
    } catch (err) {
      logger.warn(`ytv: Skyline gagal (${err?.message || err}) — fallback yt-dlp`);
    }
  }

  let filePath;
  try {
    filePath = await downloadYT(sess.url, tier.height);
    await sendVideo(ctx, filePath);
    await ctx.react('✅');
  } catch (e) {
    await ctx.react('❎');
    ctx.reply('*Maaf Error:* ' + (e.message || e));
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

async function sendPage(ctx, page) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.ytv <url>* lagi.');

  const { tiers, title, duration, durationText } = sess;
  const totalPages = Math.ceil(tiers.length / PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));

  const start = page * PER_PAGE;
  const items = tiers.slice(start, start + PER_PAGE);

  let text = `✦ ──『 🎬 YT VIDEO 』── ⚝\n\n`;
  text += `🎞 Judul : *${title}*\n`;
  text += `⏱ Durasi : ${durationText || fmtDuration(duration)}\n`;
  text += `📄 Page  : ${page + 1}/${totalPages}\n\n`;
  text += LINE + '\n';

  items.forEach((t, i) => {
    text += `\n${start + i + 1} ─ ${t.label}`;
  });

  text += '\n\n' + LINE + '\n\n';
  text += `Tap tombol angka buat\nlangsung download kualitasnya 🎬`;

  const buttons = items.map((t, i) => ({
    text: String(start + i + 1),
    id: `ytv:${ctx.sender}:pick:${start + i}`
  }));

  if (page > 0) {
    buttons.push({ text: '◀ Prev', id: `ytv:${ctx.sender}:prev:${page - 1}` });
  }
  if (page < totalPages - 1) {
    buttons.push({ text: 'Next ▶', id: `ytv:${ctx.sender}:next:${page + 1}` });
  }
  if (/^https?:\/\//i.test(sess.url || '')) {
    buttons.push({ text: '▶ Buka YouTube', url: sess.url });
  }

  items.forEach((t, i) => {
    onRichReply(`ytv:${ctx.sender}:pick:${start + i}`, async (c2) => {
      await downloadAndSend(c2, start + i);
    });
  });
  if (page > 0) {
    onRichReply(`ytv:${ctx.sender}:prev:${page - 1}`, async (c2) => {
      await sendPage(c2, page - 1);
    });
  }
  if (page < totalPages - 1) {
    onRichReply(`ytv:${ctx.sender}:next:${page + 1}`, async (c2) => {
      await sendPage(c2, page + 1);
    });
  }

  // Tombol standar (viewOnce wrapper + node bot) + header thumbnail video.
  const headerImage = await uploadThumbHeader(ctx.client, sess.thumbnail);

  await ctx.replyButtons({
    text,
    footer: '🎬 skyline-JXRA • YouTube Downloader',
    buttons,
    headerImage
  });
}

const pluginConfig = {
  name: "ytv",
  alias: ['ytmp4'],
  category: "downloader",
  description: "Download video YouTube, pilih kualitas lewat tombol",
  usage: ".ytv",
  example: ".ytv",
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
      return ctx.reply(`*Contoh Pakai :*\n.ytv https://youtube.com/watch?v=xxxx`);
    }

    await ctx.react('⏳');

    // Jalur utama: Skyline API (skyline.web.id) kalau API key diisi.
    if (skylineReady()) {
      try {
        const info = await skylineInfo(url);
        const tiers = info.qualities.length
          ? info.qualities.map((q) => ({ height: q.height, label: q.label }))
          : [{ height: null, label: 'Best (auto)' }];

        SESSIONS.set(ctx.sender, {
          url,
          title: info.title || 'Tanpa judul',
          duration: info.seconds || null,
          durationText: info.duration,
          thumbnail: info.thumbnail,
          tiers,
          skyline: info
        });

        await sendPage(ctx, 0);
        await ctx.react('✅');
        return;
      } catch (err) {
        logger.warn(`ytv: info Skyline gagal (${err?.message || err}) — fallback yt-dlp`);
      }
    }

    try {
      const info = await fetchInfo(url);
      const tiers = detectAvailableTiers(info.formats);

      SESSIONS.set(ctx.sender, {
        url,
        title: info.title || 'Tanpa judul',
        duration: info.duration,
        thumbnail: info.thumbnail,
        tiers
      });

      await sendPage(ctx, 0);
      await ctx.react('✅');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('*Maaf Error:* ' + (e.message || e));
    }
  }

export { pluginConfig as config, handler };
