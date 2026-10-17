/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * emojiRenderer.js — Loader + drawer emoji
 */

import { loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'cache');
mkdirSync(CACHE_DIR, { recursive: true });

const EMOJI_JSON_URL = 'https://raw.githubusercontent.com/JamvanHax0r/UNO-Cards/main/emoji-list.json';
const EMOJI_JSON_PATH = path.join(CACHE_DIR, 'emoji-list.json');

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf;
}

let emojiMap = null;
const emojiImageCache = new Map();

function emojiToUnicode(emoji) {
  return [...emoji].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('-');
}

export async function loadEmojiMap() {
  if (emojiMap) return emojiMap;
  if (!existsSync(EMOJI_JSON_PATH)) await downloadFile(EMOJI_JSON_URL, EMOJI_JSON_PATH);
  emojiMap = JSON.parse(readFileSync(EMOJI_JSON_PATH, 'utf-8'));
  return emojiMap;
}

// Buat .clearcache — reset memori emoji; map/image bakal ke-load ulang
// (dan emoji-list.json di-download ulang) saat dipakai lagi.
export function resetEmojiCache() {
  emojiMap = null;
  emojiImageCache.clear();
}

export async function getEmojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
  const map = await loadEmojiMap();
  const base = emojiToUnicode(emoji);
  const variants = [
    base,
    base.replace(/-fe0f/gi, ''),
    `${base.replace(/-fe0f/gi, '')}-fe0f`,
    base.toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase() + '-FE0F'
  ];

  let b64 = null;
  for (const v of variants) {
    if (map[v]) { b64 = map[v]; break; }
  }
  if (!b64) return null;

  const img = await loadImage(Buffer.from(b64, 'base64'));
  emojiImageCache.set(emoji, img);
  return img;
}

function emojiPattern() {
  return /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu;
}

export function splitTextSegments(text) {
  const segments = [];
  let lastIndex = 0;

  for (const match of text.matchAll(emojiPattern())) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'emoji', value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

export function measureTextWithEmojis(ctx, text, fontSize) {
  let w = 0;
  for (const seg of splitTextSegments(text)) {
    w += seg.type === 'emoji' ? fontSize : ctx.measureText(seg.value).width;
  }
  return w;
}

export async function drawTextWithEmojis(ctx, text, x, y, fontSize) {
  let curX = x;
  for (const seg of splitTextSegments(text)) {
    if (seg.type === 'emoji') {
      const img = await getEmojiImage(seg.value);
      if (img) {
        ctx.drawImage(img, curX, y, fontSize, fontSize);
      } else {
        ctx.fillText(seg.value, curX, y);
      }
      curX += fontSize;
    } else {
      ctx.fillText(seg.value, curX, y);
      curX += ctx.measureText(seg.value).width;
    }
  }
}
