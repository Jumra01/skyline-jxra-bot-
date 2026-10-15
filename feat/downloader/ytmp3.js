/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * yta.js — Download audio (mp3) dari YouTube. 
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';

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

export default {
  name: 'yta',
  aliases: ['ytmp3', 'ytaudio'],
  tags: 'downloader',
  description: 'Download audio (mp3) dari YouTube',

  async run(ctx) {
    const url = (ctx.text || '').trim();
    if (!url) {
      return ctx.reply(`*Contoh Pakai :*\n.yta https://youtu.be/xxxx`);
    }

    let filePath;
    await ctx.react('⏳');

    try {
      const info = await getInfo(url);
      const title = (info.title || 'YouTube Audio').replace(/[\\/:*?"<>|]/g, '');
      const caption =
        `*${title}*\n\n` +
        `*Author:* ${info.uploader || '-'}\n` +
        `*Views:* ${info.view_count || '-'}\n` +
        `*Duration:* ${info.duration_string || info.duration || '-'}\n` +
        `*Link:* ${url}\n\n` +
        `> Downloading audio...`;

      if (info.thumbnail) {
        try {
          const thumbRes = await fetch(info.thumbnail);
          if (thumbRes.ok) {
            const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
            await ctx.client.message.send(ctx.chat, {
              type: 'image', media: thumbBuf, mimetype: 'image/jpeg', caption
            });
          }
        } catch {
        }
      }

      filePath = await downloadAudio(url);
      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / 1024 / 1024;
      const buffer = fs.readFileSync(filePath);

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
};