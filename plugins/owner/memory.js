/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * memory.js — Cek penggunaan memori sistem bot
 */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const pluginConfig = {
  name: "memory",
  alias: ['mem', 'rss', 'usage', 'ram'],
  category: "owner",
  description: "Cek penggunaan memori RAM bot",
  usage: ".memory",
  example: ".memory",
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
    const mem = process.memoryUsage();

    const text = [
      '—— ｢ *MEMORY USAGE* ｣ ——',
      '',
      `◦ *rss:* ${formatBytes(mem.rss)}`,
      `◦ *heapTotal:* ${formatBytes(mem.heapTotal)}`,
      `◦ *heapUsed:* ${formatBytes(mem.heapUsed)}`,
      `◦ *external:* ${formatBytes(mem.external)}`,
      `◦ *arrayBuffers:* ${formatBytes(mem.arrayBuffers || 0)}`
    ].join('\n');

    return ctx.reply(text);
  }

export { pluginConfig as config, handler };
