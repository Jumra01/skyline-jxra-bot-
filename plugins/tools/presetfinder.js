/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * presetfinder.js — Preset Finder (Alight Motion / CapCut / XML / JSON)
 * Nyisir deskripsi + komentar + balasan komentar sebuah video (TikTok/IG/YT)
 * lewat API skyline.web.id, lalu kirim link preset yang ketemu.
 */

import {
  presetFinder,
  skylineCreds,
  keyHint,
  SkylineKeyError,
  explainSkylineError
} from '../../scraper/SKYLINE.js';

const pluginConfig = {
  name: "presetfinder",
  alias: ['preset', 'pf', 'caripreset'],
  category: "tools",
  description: "Cari link preset Alight Motion/CapCut dari sebuah video TikTok/IG/YouTube",
  usage: ".preset <link video>",
  example: ".preset https://vt.tiktok.com/ZSbkp7fqg/",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 10,
  limit: 1,
  isEnabled: true,
};

/* Upstream nyisir komentar + reply = berat. Batasi biar pesan gak jadi novel. */
const MAX_SHOW = 8;
const MAX_EFFECTS = 5;

const LINK_RE = /https?:\/\/[^\s<>"']+/i;

const SOURCE_LABEL = {
  description: 'deskripsi video',
  comment: 'komentar',
  bio: 'bio',
  bioLink: 'link bio'
};

const TYPE_LABEL = {
  alight: 'Alight Motion',
  capcut: 'CapCut',
  xml: 'File XML',
  json: 'File JSON',
  file: 'File'
};

function extractUrl(ctx) {
  const text = String(ctx.text || '');
  const direct = text.match(LINK_RE);
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

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function platformLabel(p) {
  const k = String(p || '').toLowerCase();
  if (k === 'tiktok') return 'TikTok';
  if (k === 'instagram') return 'Instagram';
  if (k === 'youtube') return 'YouTube';
  return k ? k[0].toUpperCase() + k.slice(1) : 'Video';
}

function formatResult(data) {
  const vi = data.videoInfo || {};
  const lines = ['┌───「 🎬 *PRESET FINDER* 」───┐', ''];

  lines.push(`- *Platform:* _${platformLabel(data.platform)}_`);
  if (vi.author) lines.push(`- *Author:* _@${String(vi.author).replace(/^@/, '')}_`);
  if (vi.title) lines.push(`- *Judul:* _${clip(vi.title, 70)}_`);
  lines.push('');

  if (data.effects.length) {
    lines.push(`*Efek dipakai (${data.effects.length}):*`);
    data.effects.slice(0, MAX_EFFECTS).forEach((e, i) => {
      lines.push(`${i + 1}. ${clip(e.name || 'Unknown Effect', 40)}`);
    });
    if (data.effects.length > MAX_EFFECTS) {
      lines.push(`_… +${data.effects.length - MAX_EFFECTS} efek lain_`);
    }
    lines.push('');
  }

  const presets = data.presets.filter((p) => p?.url);
  if (!presets.length) {
    lines.push('❌ *Preset gak ketemu.*');
    lines.push('_Coba video lain, atau kirim link preset langsung._');
    lines.push('');
    lines.push('└──────────────────────────────────────┘');
    return lines.join('\n');
  }

  lines.push(`*Preset ketemu (${presets.length}):*`);
  presets.slice(0, MAX_SHOW).forEach((p, i) => {
    lines.push(`${i + 1}. *${TYPE_LABEL[p.type] || p.title || 'Preset'}*${p.byAuthor ? ' 👤' : ''}`);
    lines.push(`   ${p.url}`);
    const who = p.detail ? `@${String(p.detail).replace(/^@/, '')}` : '';
    const src = SOURCE_LABEL[p.source] || p.source || '';
    const meta = [src, who].filter(Boolean).join(' · ');
    if (meta) lines.push(`   _${meta}_`);
  });
  if (presets.length > MAX_SHOW) {
    lines.push(`_… +${presets.length - MAX_SHOW} preset lain, buka link video buat sisanya_`);
  }

  if (data.partial) {
    lines.push('');
    lines.push('⚠️ _Hasil mungkin belum lengkap (server lagi lambat)._');
  }

  lines.push('');
  lines.push('└──────────────────────────────────────┘');
  lines.push('');
  lines.push('> ✨ _Powered by skyline-JXRA_');
  return lines.join('\n');
}

async function handler(ctx) {
  if (!skylineCreds().apikey) return ctx.reply(keyHint(ctx));

  const url = extractUrl(ctx);
  if (!url) {
    return ctx.reply(
      '🎬 *PRESET FINDER*\n\n' +
      'Kirim link video (TikTok/Instagram/YouTube) atau reply pesan yang berisi link.\n' +
      'Bot bakal nyisir deskripsi + komentar buat nyari link preset.\n\n' +
      '*Contoh:*\n' +
      '`.preset https://vt.tiktok.com/ZSbkp7fqg/`\n' +
      '`.pf https://www.instagram.com/reel/xxxx/`\n\n' +
      '_Support: Alight Motion, CapCut, file XML/JSON, Google Drive, MediaFire._'
    );
  }

  await ctx.react('⏳');

  let data;
  try {
    data = await presetFinder(url);
  } catch (e) {
    await ctx.react('❎');
    if (e instanceof SkylineKeyError) return ctx.reply(keyHint(ctx));
    const why = explainSkylineError(e);
    return ctx.reply(
      '❌ *Gagal cari preset*\n\n' +
      `> ${why.headline}\n` +
      `> ${why.reason}\n\n` +
      '_Coba lagi nanti atau pakai link video lain._'
    );
  }

  const text = formatResult(data);
  const quick = (data.presets || [])
    .filter((p) => p?.url)
    .slice(0, 3)
    .map((p, i) => ({ text: `🔗 Preset ${i + 1}`, url: p.url }));

  try {
    if (quick.length) {
      await ctx.replyButtons({
        text,
        footer: '🎬 skyline-JXRA • Preset Finder',
        buttons: quick
      });
    } else {
      await ctx.reply(text);
    }
    await ctx.react('✅');
  } catch {
    /* Tombol gagal (device lama) → tetap kirim teks polos. */
    await ctx.reply(text);
    await ctx.react('✅');
  }
}

export { pluginConfig as config, handler };
