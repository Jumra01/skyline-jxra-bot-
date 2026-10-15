/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * bratGenerator.js — Mesin render STICKER "brat" (statis & animated),
 */
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEmojiMap, measureTextWithEmojis, drawTextWithEmojis } from './emojiRenderer.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_DIR = path.join(__dirname, '..', 'cache');
mkdirSync(CACHE_DIR, { recursive: true });

const FONT_URL = 'https://cdn.jsdelivr.net/gh/Napoleon-Fibonacci/assets@main/font/impact.ttf';
const FONT_PATH = path.join(CACHE_DIR, 'impact.ttf');

const THEMES = {
  black: { bg: '#000000', text: '#ffffff' },
  white: { bg: '#ffffff', text: '#000000' },
  green: { bg: '#8ace00', text: '#000000' }
};

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf;
}

let fontRegistered = false;
async function ensureFont() {
  if (fontRegistered) return;
  if (!existsSync(FONT_PATH)) await downloadFile(FONT_URL, FONT_PATH);
  GlobalFonts.registerFromPath(FONT_PATH, 'Impact');
  fontRegistered = true;
}

const measureTextCustom = measureTextWithEmojis;

function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px Impact`;
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (measureTextCustom(ctx, test, fontSize) > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitsAt(ctx, text, fontSize, maxWidth, maxHeight, lineGap) {
  const lines = wrapText(ctx, text, maxWidth, fontSize);
  const longestWord = Math.max(...text.split(' ').map((w) => measureTextCustom(ctx, w, fontSize)));
  const totalHeight = lines.length * (fontSize + lineGap) - lineGap;
  return longestWord <= maxWidth && totalHeight <= maxHeight;
}

function findBestFontSize(ctx, text, maxWidth, maxHeight, lineGap) {
  let lo = 10;
  let hi = 700;
  let best = lo;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(ctx, text, mid, maxWidth, maxHeight, lineGap)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function easeOutBack(x) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function calculateWordLayout(ctx, fullText, maxWidth, maxHeight, lineGap, margin, padding, boxSize) {
  const fontSize = findBestFontSize(ctx, fullText, maxWidth, maxHeight, lineGap);
  ctx.font = `${fontSize}px Impact`;
  const defaultSpaceWidth = ctx.measureText(' ').width;

  const fullLines = wrapText(ctx, fullText, maxWidth, fontSize);
  const totalTextHeight = fullLines.length * (fontSize + lineGap) - lineGap;
  const startY = margin + (boxSize - totalTextHeight) / 2;

  const wordLayouts = [];
  let currentY = startY;

  for (let l = 0; l < fullLines.length; l++) {
    const line = fullLines[l];
    const lineWords = line.split(' ').filter(Boolean);
    const isLastLine = l === fullLines.length - 1;

    const totalWordsW = lineWords.reduce((acc, w) => acc + measureTextCustom(ctx, w, fontSize), 0);

    let spaceBetween = defaultSpaceWidth;
    if (!isLastLine && lineWords.length > 1) {
      spaceBetween = (maxWidth - totalWordsW) / (lineWords.length - 1);
    }

    let currentX = margin + padding;

    for (const word of lineWords) {
      const wordW = measureTextCustom(ctx, word, fontSize);
      wordLayouts.push({ text: word, x: currentX, y: currentY, w: wordW, h: fontSize });
      currentX += wordW + spaceBetween;
    }
    currentY += fontSize + lineGap;
  }

  return { fontSize, wordLayouts };
}

async function renderCanvas({
  wordLayouts,
  fontSize,
  wordStates,
  theme,
  blurAmount,
  highlightProgress = 0,
  margin = 70,
  size = 1000
}) {
  const selectedTheme = THEMES[theme] || THEMES.white;
  const boxSize = size - margin * 2;
  const x = margin;
  const y = margin;
  const w = boxSize;
  const h = boxSize;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = selectedTheme.bg;
  ctx.fillRect(0, 0, size, size);

  if (!wordLayouts || wordLayouts.length === 0) return canvas;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = selectedTheme.text;
  ctx.font = `${fontSize}px Impact`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;

  for (let idx = 0; idx < wordLayouts.length; idx++) {
    const item = wordLayouts[idx];
    const state = wordStates[idx] || { scale: 0, alpha: 0, visible: false };

    if (!state.visible) continue;

    const centerX = item.x + item.w / 2;
    const centerY = item.y + fontSize / 2;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, state.alpha));

    if (state.scale !== 1.0) {
      ctx.translate(centerX, centerY);
      ctx.scale(state.scale, state.scale);
      ctx.translate(-centerX, -centerY);
    }

    await drawTextWithEmojis(ctx, item.text, item.x, item.y, fontSize);
    ctx.restore();
  }

  if (highlightProgress > 0 && highlightProgress <= 1) {
    const totalDist = boxSize * 2.8;
    const curr = margin - boxSize * 1.0 + highlightProgress * totalDist;
    const sweepW = boxSize * 0.95;

    const grad = ctx.createLinearGradient(curr, curr, curr + sweepW, curr + sweepW);

    grad.addColorStop(0.0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.1, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.38, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
    grad.addColorStop(0.52, 'rgba(255, 255, 255, 0.05)');
    grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.88, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(margin, margin, boxSize, boxSize);
  }

  ctx.restore();
  return canvas;
}

async function addStickerMetadata(webpBuffer, { packName, packAuthor }) {
  const webpmuxNs = await import('node-webpmux');
  const Image = webpmuxNs.Image || webpmuxNs.default?.Image;

  const img = new Image();
  await img.load(webpBuffer);

  const json = {
    'sticker-pack-id': `skyline-jxra.brat.${Date.now()}`,
    'sticker-pack-name': packName,
    'sticker-pack-publisher': packAuthor,
    emojis: ['🐐']
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf-8');
  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  img.exif = exif;
  return img.save(null);
}

function buildAnimationTasks(wordLayouts, { fps, holdDuration }) {
  const frameStepTime = 1 / fps;
  const totalWords = wordLayouts.length;
  const tasks = [];

  tasks.push({
    wordStates: wordLayouts.map(() => ({ scale: 0, alpha: 0, visible: false })),
    highlightProgress: 0,
    duration: 0.15
  });

  const staggerFrames = Math.max(1, Math.round((5 / 60) * fps));
  const bounceFramesCount = Math.max(3, Math.round((28 / 60) * fps));
  const totalBounceFrames = (totalWords - 1) * staggerFrames + bounceFramesCount;

  for (let f = 0; f < totalBounceFrames; f++) {
    const wordStates = wordLayouts.map((_, i) => {
      const startFrame = i * staggerFrames;
      const currentFrame = f - startFrame;

      if (currentFrame < 0) return { scale: 0, alpha: 0, visible: false };
      if (currentFrame >= bounceFramesCount) return { scale: 1.0, alpha: 1.0, visible: true };

      const prog = currentFrame / (bounceFramesCount - 1);
      const bounceFactor = easeOutBack(prog);
      const scale = 0.2 + 0.8 * bounceFactor;
      const alpha = Math.min(1.0, prog * 1.8);
      return { scale, alpha, visible: true };
    });

    const highlightProgress = (f + 1) / totalBounceFrames;
    tasks.push({ wordStates, highlightProgress, duration: frameStepTime });
  }

  const secondHighlightFrames = Math.max(3, Math.round((38 / 60) * fps));
  const allVisibleStates = wordLayouts.map(() => ({ scale: 1.0, alpha: 1.0, visible: true }));

  for (let hf = 0; hf < secondHighlightFrames; hf++) {
    const highlightProgress = (hf + 1) / secondHighlightFrames;
    tasks.push({ wordStates: allVisibleStates, highlightProgress, duration: frameStepTime });
  }

  tasks.push({ wordStates: allVisibleStates, highlightProgress: 0, duration: holdDuration });

  return tasks;
}

async function renderFrameSequence({
  text, theme, blur, size, margin, padding, lineGap, fps, holdDuration, fastProgress
}) {
  const blurAmount = [0, 1, 2, 3].includes(blur) ? blur : 0;

  await ensureFont();
  await loadEmojiMap();
  if (!text.trim()) throw new Error('Teks kosong');

  const boxSize = size - margin * 2;
  const maxWidth = boxSize - padding * 2;
  const maxHeight = boxSize - padding * 2;

  const dummyCanvas = createCanvas(size, size);
  const dummyCtx = dummyCanvas.getContext('2d');

  const { fontSize, wordLayouts } = calculateWordLayout(
    dummyCtx, text, maxWidth, maxHeight, lineGap, margin, padding, boxSize
  );

  const tasks = buildAnimationTasks(wordLayouts, { fps, holdDuration });
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brat-'));

  const renderFrame = async (task, index) => {
    const canvas = await renderCanvas({
      wordLayouts, fontSize, wordStates: task.wordStates, theme,
      blurAmount, highlightProgress: task.highlightProgress, margin, size
    });
    const buffer = await canvas.encode('png');
    const framePath = path.join(tmpDir, `frame-${String(index + 1).padStart(5, '0')}.png`);
    writeFileSync(framePath, buffer);
    return { path: framePath, duration: task.duration };
  };

  let framePaths;
  if (fastProgress) {
    framePaths = await Promise.all(tasks.map((task, i) => renderFrame(task, i)));
  } else {
    framePaths = [];
    for (let i = 0; i < tasks.length; i++) {
      framePaths.push(await renderFrame(tasks[i], i));
    }
  }

  return { tmpDir, framePaths };
}

function writeConcatFile(tmpDir, framePaths) {
  const manifestLines = [];
  for (let i = 0; i < framePaths.length; i++) {
    manifestLines.push(`file '${framePaths[i].path.replace(/'/g, "'\\''")}'`);
    manifestLines.push(`duration ${framePaths[i].duration}`);
  }
  manifestLines.push(`file '${framePaths[framePaths.length - 1].path.replace(/'/g, "'\\''")}'`);

  const concatPath = path.join(tmpDir, 'concat.txt');
  writeFileSync(concatPath, manifestLines.join('\n'));
  return concatPath;
}

export async function generateBratSticker({
  text = 'Halo',
  theme = 'white',
  packName = 'Made With',
  packAuthor = 'skyline-JXRA♡'
} = {}) {
  await ensureFont();
  await loadEmojiMap();
  if (!text.trim()) throw new Error('Teks kosong');

  const size = 512;
  const margin = 36;
  const padding = 20;
  const lineGap = 8;
  const boxSize = size - margin * 2;
  const maxWidth = boxSize - padding * 2;
  const maxHeight = boxSize - padding * 2;

  const dummyCanvas = createCanvas(size, size);
  const dummyCtx = dummyCanvas.getContext('2d');

  const { fontSize, wordLayouts } = calculateWordLayout(
    dummyCtx, text, maxWidth, maxHeight, lineGap, margin, padding, boxSize
  );

  const allVisible = wordLayouts.map(() => ({ scale: 1, alpha: 1, visible: true }));

  const canvas = await renderCanvas({
    wordLayouts, fontSize, wordStates: allVisible, theme,
    blurAmount: 0, highlightProgress: 0, margin, size
  });

  const webpBuffer = await canvas.encode('webp');
  return addStickerMetadata(webpBuffer, { packName, packAuthor });
}

export async function generateBratAnimatedSticker({
  text = 'Halo',
  theme = 'white',
  blur = 0,
  fps = 20,
  holdDuration = 0.8,
  packName = 'Made With',
  packAuthor = 'skyline-JXRA♡'
} = {}) {
  const size = 512;
  const margin = 36;
  const padding = 20;
  const lineGap = 8;

  const { tmpDir, framePaths } = await renderFrameSequence({
    text, theme, blur, size, margin, padding, lineGap, fps, holdDuration, fastProgress: true
  });

  try {
    const concatPath = writeConcatFile(tmpDir, framePaths);
    const outPath = path.join(tmpDir, 'sticker.webp');

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-vf', `fps=${fps},scale=${size}:${size}`,
      '-loop', '0',
      '-an', '-vsync', '0',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '60',
      '-preset', 'default',
      outPath
    ]);

    const webpBuffer = readFileSync(outPath);
    return addStickerMetadata(webpBuffer, { packName, packAuthor });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function generateBratVideo({
  text = 'Halo Guys Nama Saya',
  theme = 'white',
  blur = 0,
  format = 'mp4',
  holdDuration = 1.5,
  fastProgress = false
} = {}) {
  const size = 1000;
  const margin = 70;
  const padding = 40;
  const lineGap = 15;
  const fps = 60;

  const { tmpDir, framePaths } = await renderFrameSequence({
    text, theme, blur, size, margin, padding, lineGap, fps, holdDuration, fastProgress
  });

  const concatPath = writeConcatFile(tmpDir, framePaths);
  const ext = format === 'gif' ? 'gif' : 'mp4';
  const outPath = path.join(os.tmpdir(), `brat-${Date.now()}.${ext}`);

  if (format === 'gif') {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-vf', 'fps=60,scale=1000:1000:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer',
      '-loop', '0',
      outPath
    ]);
  } else {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-vf', 'fps=60,scale=1000:1000',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    ]);
  }

  rmSync(tmpDir, { recursive: true, force: true });
  return outPath;
}
