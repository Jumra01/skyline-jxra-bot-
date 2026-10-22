/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aurora.js — AURORA DECK: "AURORA — UR SPECIAL PLAYER"
 */

import sharp from 'sharp';
import config from '../../config.js';
import { sendRichJH } from '../../lib/jhrich.js';
import { logger } from '../../core/logger.js';
import {
  ytSearch as skylineSearch,
  ytInfo as skylineInfo,
  skylineCreds,
  isConfigured as skylineReady
} from '../../scraper/SKYLINE.js';
import { fetchThumbBuffer } from '../../lib/ytUi.js';
import { embedAudioCover } from '../../lib/audioCover.js';

/* AURORA v3 — SEMUA lewat skyline.web.id (ga ada API pihak ketiga lagi):
 *   • audio  → unduh lewat `downloadAudio()` (jalur yang sama dengan `.yta`),
 *              lalu dikirim sebagai AUDIO WhatsApp asli + cover. Pemutar
 *              WhatsApp native, jadi gak ada lagi drama webview nolak play.
 *   • video  → tetap kartu HTML, tapi link-nya dari skyline & wajib lolos probe.
 */

const UA = 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36';

const AUDIO_FORMAT = /^(mp3|m4a|aac|ogg|wav|flac)$/i;

/** Pilih quality video paling dekat dengan yang diminta (default: tertinggi). */
function pickQuality(list, height) {
  const arr = (Array.isArray(list) ? list : []).filter((q) => q?.url);
  if (!arr.length) return null;
  if (!height) {
    return arr.slice().sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0))[0];
  }
  const exact = arr.find((q) => Number(q.height) === Number(height));
  if (exact) return exact;
  return arr.slice().sort(
    (a, b) => Math.abs((Number(a.height) || 0) - height) - Math.abs((Number(b.height) || 0) - height)
  )[0];
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return '-'; }
}

/** Link googlevideo yang punya `&ip=` cuma valid dari IP yang minta URL-nya. */
function isIpLocked(url) {
  return /[?&]ip=/i.test(String(url || ''));
}

/** URL proxy skyline dikasih `mode=stream` (inline) kalau endpoint-nya dukung. */
function withInlineMode(url) {
  try {
    const u = new URL(String(url || ''));
    if (/^skyline\.web\.id$/i.test(u.host) && /\/ytdl\//i.test(u.pathname)) u.searchParams.set('mode', 'stream');
    return u.href;
  } catch { return url; }
}

/**
 * Cek cepat apakah URL bisa diputar: ambil 2 KB pertama pakai Range lalu cancel.
 * Semua hasilnya dicatat, jadi kalau gagal sebabnya langsung kelihatan.
 */
async function probeMedia(url, label, { timeoutMs = 12000 } = {}) {
  const host = hostOf(url);
  const locked = isIpLocked(url);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { Range: 'bytes=0-2047', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const type = (r.headers.get('content-type') || '-').toLowerCase();
    const range = r.headers.get('content-range') || '';
    const total = r.headers.get('content-length') || '?';
    let first = 0;
    let snippet = '';
    try {
      const reader = r.body?.getReader();
      if (reader) {
        const chunk = await reader.read();
        first = chunk?.value?.byteLength || 0;
        if (chunk?.value && first) snippet = Buffer.from(chunk.value).subarray(0, 160).toString('utf8').replace(/\s+/g, ' ').trim();
        await reader.cancel();
      }
    } catch { /* cukup header */ }
    const ok = (r.status === 200 || r.status === 206) && /^(audio|video)\//.test(type);
    const tail = ok ? '' : ` • body="${snippet.slice(0, 140)}"`;
    const line = `[Aurora] probe ${label} → HTTP ${r.status} • ${type} • range=${range || 'TIDAK didukung'} • ${first}B/${total}B • ${Date.now() - t0}ms • host=${host}${locked ? ' • ⚠ IP-LOCKED' : ''}${tail}`;
    if (ok) logger.info(line); else logger.warn(line);
    return { ok, status: r.status, type, ranges: Boolean(range), bytes: first, host, locked };
  } catch (err) {
    logger.warn(`[Aurora] probe ${label} GAGAL — ${err?.name || 'Error'}: ${err?.message || err} • host=${host}${locked ? ' • ⚠ IP-LOCKED' : ''}`);
    return { ok: false, status: 0, type: '', ranges: false, bytes: 0, host, locked, error: err?.name || 'Error' };
  }
}

/** Link media video dari skyline (audio ga lewat sini — lihat sendAuroraAudio). */
async function resolveSource(info, format) {
  if (!skylineReady()) throw new Error('API key skyline.web.id belum diisi — Aurora butuh itu');
  const meta = await skylineInfo(info.url);
  const url = pickQuality(meta.qualities, Number(format))?.url || meta.videoUrl;
  if (!url) throw new Error('Skyline gak ngasih link video buat kualitas ' + format);
  const finalUrl = withInlineMode(url);
  logger.info(`[Aurora] video: kualitas ${format}p → ${hostOf(finalUrl)}`);
  // Video di-resolve on-demand di server (bisa 20-40 dtk), jadi timeout-nya lebih lega.
  const probe = await probeMedia(finalUrl, 'skyline-video', { timeoutMs: 45000 });
  if (!probe.ok) {
    const why = probe.error ? probe.error : `HTTP ${probe.status || 0}${probe.type ? ' ' + probe.type : ''}`;
    throw new Error(`Link video skyline gagal diputar (${why}) — cek log [Aurora] probe`);
  }
  return {
    url: finalUrl,
    title: meta.title || info.title,
    thumbnail: meta.thumbnail || info.thumbnail,
    duration: meta.duration || info.duration || '',
    via: 'skyline',
    probe,
    preview: `Sumber skyline • ${probe.type}`
  };
}

/**
 * AUDIO: cukup pakai hasil SEARCH skyline + endpoint `/api/tools/ytdl/audio`.
 * Tanpa `ytInfo()` — server yang resolve audio pas endpoint itu dipanggil,
 * jadi lebih cepat & satu langkah lebih sedikit yang bisa gagal.
 */
/** URL endpoint audio skyline buat video tertentu (dipakai kartu & unduhan). */
function audioEndpoint(videoUrl) {
  const { website, apikey } = skylineCreds();
  if (!apikey) throw new Error('API key skyline.web.id belum diisi');
  return `${website}/api/tools/ytdl/audio?url=${encodeURIComponent(videoUrl)}` +
    `&apikey=${encodeURIComponent(apikey)}&mode=stream`;
}

async function downloadAudioViaSearch(videoUrl, { timeoutMs = 180000, maxBytes = 60 * 1024 * 1024 } = {}) {
  const link = audioEndpoint(videoUrl);
  const host = hostOf(link);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(`koneksi ke ${host} gagal (${err?.name || 'Error'}: ${err?.message || err})`);
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 160).replace(/\s+/g, ' '); } catch { /* ignore */ }
    throw Object.assign(new Error(`HTTP ${res.status} • ${type || '-'} • body="${body}"`), { status: res.status });
  }
  if (!/^audio\//.test(type)) {
    let body = '';
    try { body = (await res.text()).slice(0, 160).replace(/\s+/g, ' '); } catch { /* ignore */ }
    throw Object.assign(new Error(`bukan audio (content-type ${type || '-'}) • body="${body}"`), { status: res.status });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('audio kosong (0 byte)');
  if (buf.length > maxBytes) throw new Error(`audio kegedean (${(buf.length / 1048576).toFixed(1)}MB > ${(maxBytes / 1048576).toFixed(0)}MB)`);
  logger.info(`[Aurora] audio: ${type} • ${(buf.length / 1048576).toFixed(2)}MB • ${((Date.now() - t0) / 1000).toFixed(1)}s • host=${host}`);
  return { buffer: buf, mimetype: type.split(';')[0].trim() || 'audio/mpeg', ext: /mp4|m4a/.test(type) ? 'm4a' : 'mp3' };
}

async function sendAuroraAudio(ctx, info, format) {
  const t0 = Date.now();
  let audio = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logger.info(`[Aurora] audio: unduh via /api/tools/ytdl/audio (percobaan ${attempt}/2) "${String(info.title || '').slice(0, 70)}"`);
      audio = await downloadAudioViaSearch(info.url);
      break;
    } catch (err) {
      lastErr = err;
      logger.warn(
        `[Aurora] audio: GAGAL (percobaan ${attempt}/2) — status=${err?.status || 0} • ` +
        `pesan=${String(err?.message || err).slice(0, 180)}`
      );
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!audio) {
    throw new Error(
      `Gagal unduh audio dari skyline${lastErr?.status ? ` (HTTP ${lastErr.status})` : ''}: ` +
      String(lastErr?.message || lastErr || 'tanpa detail').slice(0, 170)
    );
  }

  const clean = String(info.title || 'Audio').replace(/[\\/:*?"<>|]/g, '').slice(0, 90);
  const duration = String(info.duration || '');

  /* Kartu rich HTML tetap dikirim (tampilan AURORA deck), tapi audionya
   * lewat pesan audio native — jadi kalau player di webview rewel, lagu
   * tetap bisa diputar dari pesan audio di bawahnya. */
  let cardSent = false;
  try {
    /* Kartu COVER (tanpa player): di WebView kartu WA elemen media gak jalan,
     * jadi jangan kasih tombol play yang pasti gagal. */
    const thumbB64 = await thumbDataUri(info.thumbnail);
    const html = buildCoverHtml({
      title: clean,
      channel: 'AURORA',
      duration,
      thumbnailb64: thumbB64,
      note: 'Ketuk pesan audio di bawah untuk memutar.'
    });
    await sendRichJH(ctx, html);
    cardSent = true;
    logger.info(`[Aurora] audio: kartu cover terkirim • ${html.length}B`);
  } catch (err) {
    logger.warn(`[Aurora] audio: kartu cover gagal — ${err?.message || err}`);
  }

  let cover = null;
  try {
    cover = await fetchThumbBuffer(info.thumbnail, { width: 640 });
    logger.info(`[Aurora] audio: cover ${cover ? `OK ${Math.round(cover.buffer.length / 1024)}KB` : 'kosong'}`);
  } catch (err) {
    logger.warn(`[Aurora] audio: cover gagal — ${err?.message || err}`);
  }

  if (cover && !cardSent) {
    try {
      await ctx.client.message.send(ctx.chat, {
        type: 'image',
        media: cover.buffer,
        mimetype: 'image/jpeg',
        caption: `*${clean}*\n\n> ${duration} • AURORA 🎧`
      });
      logger.info('[Aurora] audio: cover terkirim');
    } catch (err) {
      logger.warn(`[Aurora] audio: cover gagal dikirim — ${err?.message || err}`);
    }
  }

  let media = audio.buffer;
  try {
    const emb = await embedAudioCover(audio.buffer, audio.mimetype, cover?.buffer);
    media = emb.buffer;
    logger.info(`[Aurora] audio: cover ditanam=${emb.embedded ? 'ya' : 'tidak'}`);
  } catch (err) {
    logger.warn(`[Aurora] audio: tanam cover gagal — ${err?.message || err}`);
  }

  const fileName = `${clean}.${audio.ext || 'mp3'}`;
  await ctx.client.message.send(ctx.chat, {
    type: 'audio',
    media,
    mimetype: audio.mimetype,
    fileName
  });
  logger.info(`[Aurora] audio: terkirim | ${fileName} • ${(media.length / 1048576).toFixed(2)}MB • total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/**
 * Kartu COVER buat audio — tanpa <audio>/<video> sama sekali.
 * Di WebView kartu WA, elemen media gak jalan (cuma image yang tampil),
 * jadi kartu ini murni visual: cover + judul + durasi + penanda bahwa
 * lagunya ada di pesan audio di bawahnya.
 */
function buildCoverHtml({ title, channel, duration, thumbnailb64, note }) {
  const hasThumb = Boolean(thumbnailb64);
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AURORA — ${escapeHtmlJs(title)}</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
body{margin:0;padding:14px;background:#04090b;font-family:Arial,Helvetica,sans-serif;color:#eafff5}
.wrap{position:relative;max-width:440px;margin:auto;border-radius:20px;overflow:hidden;
  border:1px solid rgba(0,255,136,.16);box-shadow:0 10px 40px rgba(0,0,0,.55)}
.bg{position:absolute;inset:-25px;background-position:center;background-size:cover;
  filter:blur(22px) saturate(1.1);opacity:.35;transform:scale(1.15)}
.ov{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,9,11,.35),rgba(4,9,11,.88))}
.in{position:relative;padding:18px;text-align:center}
.hd{font-size:10px;font-weight:800;letter-spacing:2.5px;color:#5cffb0;opacity:.9;margin-bottom:14px}
.cover{width:100%;aspect-ratio:1/1;border-radius:16px;object-fit:cover;display:block;
  background:#0b1512;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.title{font-size:14px;font-weight:800;margin:14px 0 4px;line-height:1.35}
.sub{font-size:11px;color:#8fb8a8}
.badge{margin-top:14px;display:inline-block;padding:9px 14px;border-radius:999px;
  background:rgba(0,255,136,.12);border:1px solid rgba(0,255,136,.25);
  font-size:11px;font-weight:700;color:#8effc4}
.note{margin-top:8px;font-size:10px;color:#7fa896;line-height:1.5}
</style></head>
<body>
<div class="wrap">
  <div class="bg"${hasThumb ? ` style="background-image:url('${thumbnailb64}')"` : ''}></div>
  <div class="ov"></div>
  <div class="in">
    <div class="hd">AURORA — UR SPECIAL PLAYER</div>
    ${hasThumb ? `<img class="cover" src="${thumbnailb64}" alt="">` : ''}
    <div class="title">${escapeHtmlJs(title)}</div>
    <div class="sub">${escapeHtmlJs(channel || '')}${duration ? ` • ${escapeHtmlJs(duration)}` : ''}</div>
    <div class="badge">🎧 Lagu ada di pesan audio di bawah</div>
    <div class="note">${escapeHtmlJs(note || 'Ketuk pesan audio di bawah untuk memutar.')}</div>
  </div>
</div>
</body></html>`;
}

async function thumbDataUri(url) {
  if (!url) return '';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return '';
    const raw = Buffer.from(await r.arrayBuffer());
    if (!raw.length) return '';
    // Kecilin dulu: thumbnail asli ~30-50 KB bikin payload HTML membengkak
    // (base64 naik 4/3) dan kartu berat dirender webview.
    let b = raw;
    try {
      b = await sharp(raw)
        .resize({ width: 400, withoutEnlargement: true })
        .jpeg({ quality: 62 })
        .toBuffer();
    } catch {}
    return 'data:image/jpeg;base64,' + b.toString('base64');
  } catch { return ''; }
}

const escapeHtmlJs = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/</g, '\\x3C');

function buildHtml({ finalTitle, finalChannel, finalDuration, videoUrl, thumbnailb64, wsUrl, isAudio: audioHint, sourceNote = '', preferWs = false }) {
  // URL dari YT-DL/savenow gak punya ekstensi (`/api/v2/download/<hash>`),
  // jadi jenis media ditentukan dari format yang diminta, bukan dari URL.
  const isAudio = typeof audioHint === 'boolean'
    ? audioHint
    : /\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/i.test(String(videoUrl || ''));
  const cfg = {
    title: finalTitle,
    channel: finalChannel,
    duration: finalDuration,
    videoUrl,
    wsUrl,
    isAudio,
    preferWs: preferWs === true,
    autoplay: false,
    volume: 0.8,
    loop: false
  };

  // Selalu pakai <video>: elemen <audio> tanpa kotak render sering diabaikan
  // webview WhatsApp (kartu tampil, tapi suara gak pernah keluar). Untuk mp3,
  // poster thumbnail dipakai sebagai cover.
  const mediaTag = `<video id="videoPlayer" playsinline webkit-playsinline preload="auto" poster="${thumbnailb64}"></video>`;

  const htmlPayload = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AURORA — ${escapeHtmlJs(finalTitle)}</title>
<style>
*{
-webkit-tap-highlight-color:transparent;
-webkit-user-select:none;
user-select:none;
-webkit-touch-callout:none;
box-sizing:border-box
}
body{
margin:0;
background:#04090b;
font-family:Arial,Helvetica,sans-serif;
color:#eafff5;
touch-action:manipulation;
cursor:pointer
}
input[type=range]{
width:100%;
height:4px;
accent-color:#00ff88;
cursor:pointer
}
.player-wrap{
width:100%;
max-width:440px;
margin:auto;
padding:12px
}
.aurora-head{
text-align:center;
margin:2px 0 10px
}
.aurora-title{
display:inline-block;
font-size:12px;
font-weight:800;
letter-spacing:2.5px;
background:linear-gradient(90deg,#00ff88,#22d3ee,#7dd3fc,#00ff88);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 6s linear infinite;
text-shadow:0 0 18px rgba(0,255,136,.25)
}
.player{
position:relative;
overflow:hidden;
background:#0b1512;
border:1px solid rgba(0,255,136,.16);
border-radius:20px;
box-shadow:0 10px 40px rgba(0,0,0,.55),0 0 24px rgba(0,255,136,.06) inset
}
.bg{
position:absolute;
inset:-25px;
background-position:center;
background-size:cover;
filter:blur(22px) saturate(1.1);
opacity:.30;
transform:scale(1.15);
pointer-events:none
}
.bg-overlay{
position:absolute;
inset:0;
background:linear-gradient(
180deg,
rgba(4,9,11,.40),
rgba(4,9,11,.78)
);
pointer-events:none
}
.content{
position:relative;
padding:18px;
z-index:2
}
.top{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:15px
}
.top-title{
font-size:13px;
font-weight:700;
letter-spacing:.8px;
color:#5cffb0;
opacity:.9
}
.top-sub{
font-size:10px;
color:#7fa896;
opacity:.7;
margin-top:3px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
max-width:260px
}
.icon-btn{
width:34px;
height:34px;
border:0;
border-radius:50%;
background:rgba(0,255,136,.10);
color:#eafff5;
display:flex;
align-items:center;
justify-content:center;
padding:0;
flex-shrink:0
}
.icon-btn svg{
width:17px;
height:17px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.video-frame{
position:relative;
width:100%;
aspect-ratio:16/9;
border-radius:15px;
overflow:hidden;
background:#000;
box-shadow:0 12px 35px rgba(0,0,0,.45),0 0 0 1px rgba(34,211,238,.14);
cursor:pointer
}
.video-frame video,
.video-frame img.cover-img{
width:100%;
height:100%;
display:block;
background:#000;
object-fit:contain
}
.video-frame img.cover-img{object-fit:cover}
.player-status{
margin-top:6px;
font-size:11px;
line-height:1.35;
letter-spacing:.3px;
color:rgba(234,255,245,.55);
min-height:15px
}
.player-status.warn{color:#fbbf24}
.player-status.err{color:#f87171}
.big-play{
position:absolute;
inset:0;
display:flex;
align-items:center;
justify-content:center;
background:rgba(0,0,0,.18);
transition:opacity .2s;
z-index:3
}
.big-btn{
width:64px;
height:64px;
border:0;
border-radius:50%;
background:linear-gradient(135deg,#00ff88,#22d3ee);
color:#041008;
display:flex;
align-items:center;
justify-content:center;
padding:0;
box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 22px rgba(0,255,136,.35)
}
.big-btn svg{
width:26px;
height:26px;
fill:currentColor;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.frame-playing .big-play{
opacity:0;
pointer-events:none
}
.info{
padding-top:15px
}
.song-title{
font-size:19px;
font-weight:700;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
color:#f2fff8
}
.artist{
font-size:13px;
color:#7fa896;
opacity:.8;
margin-top:5px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.progress{
margin-top:18px
}
.times{
display:flex;
justify-content:space-between;
font-size:10px;
color:#7fa896;
opacity:.75;
margin-top:7px
}
.controls{
display:flex;
align-items:center;
justify-content:center;
gap:18px;
margin-top:13px
}
.side-btn{
width:38px;
height:38px;
border:0;
background:transparent;
color:#b9ffd9;
display:flex;
align-items:center;
justify-content:center;
padding:0;
opacity:.85
}
.side-btn svg{
width:19px;
height:19px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round
}
.bottom{
display:flex;
align-items:center;
justify-content:space-between;
margin-top:15px;
gap:12px
}
.bottom-left,
.bottom-right{
display:flex;
align-items:center;
gap:9px
}
.volume{
width:85px
}
.debug-wrap{
margin-top:12px;
background:#0b1512;
border:1px solid rgba(34,211,238,.16);
border-radius:16px;
padding:12px;
font-family:monospace
}
.debug-head{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:8px
}
.debug-title{
font-size:11px;
font-weight:700;
letter-spacing:.8px;
color:#67e8f9;
opacity:.9
}
.debug-state{
font-size:10px;
font-weight:700;
padding:3px 8px;
border-radius:20px;
background:rgba(0,255,136,.10);
color:#5cffb0;
letter-spacing:.5px
}
.debug-server{
font-size:9px;
color:#7fa896;
opacity:.6;
word-break:break-all;
margin-bottom:8px;
line-height:1.4
}
.debug-grid{
display:grid;
grid-template-columns:repeat(3,1fr);
gap:6px;
margin-bottom:8px
}
.debug-cell{
background:rgba(0,255,136,.05);
border-radius:8px;
padding:6px 8px
}
.debug-cell span{
display:block;
font-size:8px;
color:#7fa896;
opacity:.7;
letter-spacing:.5px
}
.debug-cell b{
display:block;
font-size:11px;
color:#eafff5;
margin-top:2px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.debug-bar{
height:4px;
border-radius:4px;
background:rgba(0,255,136,.10);
overflow:hidden;
margin-bottom:8px
}
.debug-bar-fill{
height:100%;
width:0;
background:linear-gradient(90deg,#00ff88,#22d3ee);
transition:width .3s
}
.debug-log{
height:110px;
overflow-y:auto;
background:rgba(0,0,0,.35);
border-radius:8px;
padding:6px 8px;
font-size:9px;
line-height:1.6;
color:#9be8c4;
word-break:break-all;
-webkit-overflow-scrolling:touch
}
.log-line{
white-space:pre-wrap
}
.aurora-foot{
margin-top:12px;
text-align:center;
display:flex;
flex-direction:column;
gap:3px
}
.made,
.powered{
font-size:11px;
color:rgba(234,255,245,.66)
}
.heart{
display:inline-block;
color:#ff4d6d;
animation:beat 1.1s ease-in-out infinite
}
.jh{
font-weight:800;
background:linear-gradient(90deg,#00ff88,#22d3ee,#7dd3fc,#00ff88);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 5s linear infinite
}
.fiony{
font-weight:800;
background:linear-gradient(90deg,#22d3ee,#818cf8,#00ff88,#22d3ee);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 4.5s linear infinite
}
.copy{
font-size:9.5px;
color:rgba(234,255,245,.34);
letter-spacing:.8px;
margin-top:2px
}
@keyframes shine{
to{background-position:300% 0}
}
@keyframes beat{
0%,100%{transform:scale(1)}
30%{transform:scale(1.35)}
55%{transform:scale(1)}
75%{transform:scale(1.2)}
}
</style>
</head>

<body>
	<div class="player-wrap">
		<div class="aurora-head">
			<span class="aurora-title">AURORA — UR SPECIAL PLAYER</span>
		</div>
		<div class="player">
			<div class="bg" id="background"></div>
			<div class="bg-overlay"></div>
			<div class="content">
				<div class="top">
					<div>
						<div class="top-title" id="playlistTitle">NOW PLAYING VIDEO</div>
						<div class="top-sub" id="playlistSub">${escapeHtmlJs(finalTitle)}</div>
					</div>
					<button class="icon-btn" type="button" onclick="toggleMute()" id="muteButton">
						<svg id="volumeIcon" viewBox="0 0 24 24">
							<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
							<path d="M19 9a5 5 0 0 1 0 6"></path>
							<path d="M16 6.5a9 9 0 0 1 0 11"></path>
						</svg>
					</button>
				</div>

				<div class="video-frame" id="videoFrame" onclick="toggleVideo()">
					${mediaTag}
					<div class="big-play" id="bigPlay">
						<button class="big-btn" type="button" onclick="event.stopPropagation();toggleVideo()">
							<svg id="playIcon" viewBox="0 0 24 24">
								<path d="M8 5v14l11-7z"></path>
							</svg>
							<svg id="pauseIcon" viewBox="0 0 24 24" style="display:none">
								<path d="M7 5v14"></path>
								<path d="M17 5v14"></path>
							</svg>
						</button>
					</div>
				</div>

				<div class="info">
					<div class="song-title" id="songTitle">Unknown Video</div>
					<div class="artist" id="artist">Unknown Channel</div>
					<div class="player-status" id="playerStatus">${escapeHtmlJs(sourceNote || 'Tekan play buat mulai')}</div>
				</div>

				<div class="progress">
					<input id="progress" type="range" min="0" max="100" value="0" step="0.1" oninput="seekVideo(this.value)">
					<div class="times">
						<span id="currentTime">0:00</span>
						<span id="duration">0:00</span>
					</div>
				</div>

				<div class="controls">
					<button class="side-btn" type="button" onclick="previousVideo()">
						<svg viewBox="0 0 24 24">
							<path d="M19 20 9 12l10-8v16z"></path>
							<path d="M5 19V5"></path>
						</svg>
					</button>
					<button class="side-btn" type="button" onclick="toggleVideo()">
						<svg id="smallPlayIcon" viewBox="0 0 24 24">
							<path d="M8 5v14l11-7z"></path>
						</svg>
						<svg id="smallPauseIcon" viewBox="0 0 24 24" style="display:none">
							<path d="M7 5v14"></path>
							<path d="M17 5v14"></path>
						</svg>
					</button>
					<button class="side-btn" type="button" onclick="nextVideo()">
						<svg viewBox="0 0 24 24">
							<path d="m5 4 10 8-10 8V4z"></path>
							<path d="M19 5v14"></path>
						</svg>
					</button>
				</div>

				<div class="bottom">
					<div class="bottom-left">
						<button class="icon-btn" type="button" onclick="toggleRepeat()" id="repeatButton">
							<svg viewBox="0 0 24 24">
								<path d="M17 2l4 4-4 4"></path>
								<path d="M3 11V9a3 3 0 0 1 3-3h15"></path>
								<path d="m7 22-4-4 4-4"></path>
								<path d="M21 13v2a3 3 0 0 1-3 3H3"></path>
							</svg>
						</button>
					</div>
					<div class="bottom-right">
						<button class="icon-btn" type="button" onclick="toggleMute()">
							<svg viewBox="0 0 24 24">
								<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
								<path d="m19 9-5 6"></path>
								<path d="m14 9 5 6"></path>
							</svg>
						</button>
						<input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="1" oninput="changeVolume(this.value)">
					</div>
				</div>
			</div>
		</div>

		<div class="debug-wrap">
			<div class="debug-head">
				<div class="debug-title">MEDIA PROCESS</div>
				<div class="debug-state" id="wsState">CONNECTING</div>
			</div>
			<div class="debug-server" id="wsServer">-</div>
			<div class="debug-grid">
				<div class="debug-cell">
					<span>MIME</span>
					<b id="dbgMime">-</b>
				</div>
				<div class="debug-cell">
					<span>Downloaded</span>
					<b id="dbgDownloaded">0.00 MB</b>
				</div>
				<div class="debug-cell">
					<span>Total</span>
					<b id="dbgTotal">-</b>
				</div>
				<div class="debug-cell">
					<span>Progress</span>
					<b id="dbgProgress">0%</b>
				</div>
				<div class="debug-cell">
					<span>Chunks</span>
					<b id="dbgChunks">0</b>
				</div>
				<div class="debug-cell">
					<span>Loop</span>
					<b id="dbgLoop">OFF</b>
				</div>
			</div>
			<div class="debug-bar">
				<div class="debug-bar-fill" id="dbgBarFill"></div>
			</div>
			<div class="debug-log" id="debugLog"></div>
		</div>

		<div class="aurora-foot">
			<div class="made">Made with <span class="heart">❤</span> by <span class="jh">skyline-JXRA</span></div>
			<div class="powered">Powered by <span class="fiony">skyline-JXRA</span></div>
			<div class="copy">© <span id="year"></span> - All Rights Reserved</div>
		</div>
	</div>

	<script>
window.VIDEO_CONFIG = {
	title: "${escapeHtmlJs(cfg.title)}",
	channel: "${escapeHtmlJs(cfg.channel)}",
	duration: "${escapeHtmlJs(cfg.duration)}",
	videoUrl: "${escapeHtmlJs(cfg.videoUrl)}",
	wsUrl: "${escapeHtmlJs(cfg.wsUrl)}",
	isAudio: ${cfg.isAudio},
	preferWs: ${cfg.preferWs},
	autoplay: ${cfg.autoplay},
	volume: ${cfg.volume},
	loop: ${cfg.loop}
};

var video = document.getElementById("videoPlayer");
var frame = document.getElementById("videoFrame");
var songTitle = document.getElementById("songTitle");
var artist = document.getElementById("artist");
var progress = document.getElementById("progress");
var currentTime = document.getElementById("currentTime");
var durationLabel = document.getElementById("duration");
var volume = document.getElementById("volume");
var smallPlayIcon = document.getElementById("smallPlayIcon");
var smallPauseIcon = document.getElementById("smallPauseIcon");
var repeatButton = document.getElementById("repeatButton");
var playlistSub = document.getElementById("playlistSub");
var isLoop = false;
var userPressed = false;

var config = window.VIDEO_CONFIG || {};

/* ═══ DEBUG: console + panel ═══
 * Semua kejadian media dicatat ke console ([Aurora] ...) DAN ke panel
 * MEDIA PROCESS di kartu, biar kelihatan tanpa buka DevTools. */
function dbg(msg, level) {
	var line = String(msg);
	try {
		if (level === 'err') console.error('[Aurora] ' + line);
		else if (level === 'warn') console.warn('[Aurora] ' + line);
		else console.log('[Aurora] ' + line);
	} catch (e) {}
	try { writeLog(line); } catch (e) {}
}
function srcShort(u) { return String(u || '').replace(/apikey=[^&]+/g, 'apikey=***').slice(0, 110); }
window.addEventListener('error', function(e) {
	dbg('window.onerror: ' + (e.message || '?') + ' @' + (e.filename || '') + ':' + (e.lineno || 0), 'err');
});
window.addEventListener('unhandledrejection', function(e) {
	var r = e.reason || {};
	dbg('unhandledrejection: ' + (r.name || '?') + ' ' + (r.message || String(r)), 'err');
});
dbg('boot • origin=' + location.origin + ' • secure=' + window.isSecureContext);
dbg('ua=' + String(navigator.userAgent).slice(0, 100));
dbg('canPlay mp3=' + (video.canPlayType('audio/mpeg') || 'no') + ' • m4a=' + (video.canPlayType('audio/mp4') || 'no') + ' • mp4=' + (video.canPlayType('video/mp4') || 'no'));
var background = document.getElementById("background");
songTitle.textContent = config.title || "Unknown Video";
artist.textContent = config.channel || "Unknown Channel";
playlistSub.textContent = config.title || "Unknown Video";

var yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

if (video.poster && background) {
	background.style.backgroundImage = "url('" + video.poster + "')";
}

if (config.volume !== undefined) {
	video.volume = config.volume;
	volume.value = config.volume;
}
isLoop = config.loop || false;
video.loop = isLoop;
updateLoopStatus();

function formatTime(seconds) {
	if (!isFinite(seconds)) return "0:00";
	var min = Math.floor(seconds / 60);
	var sec = Math.floor(seconds % 60);
	if (sec < 10) sec = "0" + sec;
	return min + ":" + sec;
}

function setStatus(text, kind) {
	var el = document.getElementById("playerStatus");
	if (!el) return;
	el.textContent = text;
	el.className = "player-status" + (kind ? " " + kind : "");
}

function updateUI() {
	if (video.paused) {
		smallPlayIcon.style.display = "block";
		smallPauseIcon.style.display = "none";
		frame.classList.remove("frame-playing");
	} else {
		smallPlayIcon.style.display = "none";
		smallPauseIcon.style.display = "block";
		frame.classList.add("frame-playing");
	}
}

function ensureDirectSource() {
	if (!directMode) return;
	var url = config.videoUrl || "";
	if (!url) return;
	// Pasang ulang src saat user benar-benar menekan play: browser baru
	// mulai fetch media setelah ada gesture, jadi tidak menunggu halaman.
	if (video.readyState === 0 || video.src !== url) {
		video.src = url;
		video.load();
	}
}

var directWatchdog = null;

function armDirectWatchdog() {
	if (!directMode || streamStarted || !config.wsUrl) return;
	if (directWatchdog) clearTimeout(directWatchdog);
	directWatchdog = setTimeout(function() {
		directWatchdog = null;
		if (directMode && video.readyState === 0) {
			directMode = false;
			startWsFallback("timeout 8s");
		}
	}, 8000);
}

// Webview WA kadang cuma ngizinin audio mulai dalam keadaan mute
// (kebijakan autoplay). Coba normal dulu, kalau ditolak mute sebentar
// lalu unmute lagi — biar user tetap dengar suaranya.
function safePlay() {
	// Sebagian webview cuma ngizinin play kalau gesture-nya kena elemen media
	// sendiri, jadi pasang juga listener langsung di elemen (idempoten).
	if (!video.dataset.gestureBound) {
		video.dataset.gestureBound = '1';
		video.addEventListener('pointerdown', function() {
			if (video.paused) safePlay();
		});
	}
	var p = video.play();
	if (p && p.then) {
		p.then(function() { dbg('play() OK • t=' + video.currentTime.toFixed(2)); })
		 .catch(function(e) { dbg('play() reject: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || ''), 'err'); });
	}
	if (!p || !p.catch) return;
	p.catch(function(err) {
		writeLog("play() ditolak: " + ((err && err.name) || "?"));
		if (!diagDone) setStatus("Play ditolak webview — ketuk sekali lagi", "warn");
		video.muted = true;
		var p2 = video.play();
		if (!p2 || !p2.then) return;
		p2.then(function() {
			setTimeout(function() {
				video.muted = false;
			}, 350);
		}).catch(function(e2) {
			writeLog("play() gagal: " + ((e2 && e2.name) || "?"));
			if (!diagDone) setStatus("Audio diblokir webview (" + ((e2 && e2.name) || "?") + ") — ketuk play lagi", "err");
			setWsState("BLOCKED");
		});
	});
}

function playVideo() {
	setStatus("Menyambung ke sumber audio…", "");
	ensureDirectSource();
	safePlay();
	armDirectWatchdog();
	updateUI();
}

function toggleVideo() {
	if (video.paused) {
		if (!video.src) userPressed = true;
		playVideo();
	} else {
		userPressed = false;
		video.pause();
	}
	updateUI();
}

function previousVideo() {
	if (!isFinite(video.duration)) return;
	video.currentTime = Math.max(0, video.currentTime - 10);
}

function nextVideo() {
	if (!isFinite(video.duration)) return;
	video.currentTime = Math.min(video.duration, video.currentTime + 10);
}

function seekVideo(value) {
	if (!isFinite(video.duration)) return;
	video.currentTime = (Number(value) / 100) * video.duration;
}

function changeVolume(value) {
	video.volume = Number(value);
	if (video.volume > 0) {
		video.muted = false;
	}
}

function toggleMute() {
	video.muted = !video.muted;
}

function toggleRepeat() {
	isLoop = !isLoop;
	video.loop = isLoop;
	repeatButton.style.opacity = isLoop ? "1" : ".55";
	repeatButton.title = isLoop ? "Loop ON" : "Loop OFF";
	updateLoopStatus();
}

function updateLoopStatus() {
	var el = document.getElementById("dbgLoop");
	if (el) el.textContent = isLoop ? "ON" : "OFF";
}

video.addEventListener("loadedmetadata", function() {
	durationLabel.textContent = formatTime(video.duration);
});

video.addEventListener("timeupdate", function() {
	if (!isFinite(video.duration)) return;
	var value = (video.currentTime / video.duration) * 100;
	progress.value = value;
	currentTime.textContent = formatTime(video.currentTime);
	durationLabel.textContent = formatTime(video.duration);
});

video.addEventListener("play", function() {
	updateUI();
});

video.addEventListener("pause", function() {
	updateUI();
});

video.addEventListener("ended", function() {
	if (!isLoop) {
		progress.value = 0;
		currentTime.textContent = "0:00";
		video.currentTime = 0;
	}
	updateUI();
});

var wsVideo = null;
var wsChunks = [];
var wsDownloaded = 0;
var wsTotal = null;
var wsMime = "video/mp4";
var wsObjectUrl = null;
var wsDone = false;
var wsLastLog = 0;

function fmtSize(bytes) {
	if (!isFinite(bytes)) return "0 B";
	if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
	if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
	return bytes + " B";
}

function setWsState(state) {
	var el = document.getElementById("wsState");
	if (el) el.textContent = state;
}

function writeLog(line) {
	var box = document.getElementById("debugLog");
	if (!box) return;
	var div = document.createElement("div");
	div.className = "log-line";
	div.textContent = line;
	box.appendChild(div);
	while (box.childNodes.length > 80) {
		box.removeChild(box.firstChild);
	}
	box.scrollTop = box.scrollHeight;
}

function updateWsProgress() {
	var el = document.getElementById("dbgDownloaded");
	if (el) el.textContent = fmtSize(wsDownloaded);
	if (wsTotal !== null && wsTotal > 0) {
		var pct = Math.min(100, (wsDownloaded / wsTotal) * 100);
		el = document.getElementById("dbgTotal");
		if (el) el.textContent = fmtSize(wsTotal);
		el = document.getElementById("dbgProgress");
		if (el) el.textContent = pct.toFixed(1) + "%";
		el = document.getElementById("dbgBarFill");
		if (el) el.style.width = pct.toFixed(1) + "%";
		if (streamStarted && !wsDone) setStatus("Mengunduh " + pct.toFixed(0) + "% — jangan tutup kartu", "warn");
	}
	el = document.getElementById("dbgChunks");
	if (el) el.textContent = String(wsChunks.length);
}

function finishWsDownload(cfg) {
	if (wsDone) return;
	wsDone = true;
	setWsState("COMPLETE");
	writeLog("Download complete");
	var blob = new Blob(wsChunks, {
		type: wsMime || "video/mp4"
	});
	writeLog("Blob created (" + fmtSize(blob.size) + ")");
	if (wsObjectUrl) {
		URL.revokeObjectURL(wsObjectUrl);
	}
	wsObjectUrl = URL.createObjectURL(blob);
	writeLog("Video source attached");
	video.src = wsObjectUrl;
	video.load();
	writeLog("Player ready");
	setStatus("Siap — memutar", "");
	if (wsVideo) {
		try {
			wsVideo.close();
		} catch (e) {}
	}
	wsChunks = [];
	/* JANGAN play otomatis di sini. Ini dipanggil dari callback WebSocket,
	 * bukan dari ketukan user — Chrome/WebView bakal nolak dengan
	 * NotAllowedError dan statusnya jadi "diblokir webview".
	 * Yang benar: tunggu user mengetuk tombol play (gesture sah). */
	setStatus("Siap — ketuk play", "");
	writeLog("Siap diputar (autoplay sengaja mati: butuh ketukan user)");
}

function startVideoStream(cfg) {
	var videoUrl = cfg.videoUrl || "";
	var wsUrl = cfg.wsUrl || "";
	var serverEl = document.getElementById("wsServer");
	if (serverEl) {
		var host = "-";
		try {
			host = new URL(wsUrl).host;
		} catch (e) {}
		serverEl.textContent = host || "-";
	}
	if (!wsUrl) {
		setWsState("ERROR");
		writeLog("No video URL tersedia");
		return;
	}
	if (typeof WebSocket === "undefined") {
		setWsState("ERROR");
		writeLog("WebSocket API tidak tersedia");
		return;
	}
	writeLog("Connecting...");
	setWsState("CONNECTING");
	wsVideo = new WebSocket(wsUrl);
	wsVideo.binaryType = "arraybuffer";
	wsVideo.onopen = function() {
		writeLog("WebSocket OPEN");
		setWsState("CONNECTED");
	};
	wsVideo.onmessage = function(event) {
		if (typeof event.data === "string") {
			var message = null;
			try {
				message = JSON.parse(event.data);
			} catch (e) {}
			if (!message) return;
			if (message.type === "start") {
				wsMime = message.mime || "video/mp4";
				if (message.contentLength !== undefined && message.contentLength !== null) {
					wsTotal = Number(message.contentLength);
				} else if (message.length !== undefined && message.length !== null) {
					wsTotal = Number(message.length);
				}
				var mimeEl = document.getElementById("dbgMime");
				if (mimeEl) mimeEl.textContent = wsMime;
				writeLog("START | MIME: " + wsMime);
				if (wsTotal !== null && wsTotal > 0) {
					writeLog("Size: " + fmtSize(wsTotal));
				}
				setWsState("DOWNLOADING");
				updateWsProgress();
				return;
			}
			if (message.type === "end") {
				writeLog("END");
				finishWsDownload(config);
				return;
			}
			if (message.type === "error") {
				writeLog("Server error: " + (message.message || "unknown"));
				setWsState("ERROR");
				return;
			}
			return;
		}
		wsChunks.push(event.data);
		var bytes = event.data.byteLength || 0;
		wsDownloaded += bytes;
		var now = Date.now();
		if (now - wsLastLog > 400) {
			wsLastLog = now;
			writeLog("Binary chunk: " + fmtSize(bytes));
		}
		updateWsProgress();
	};
	wsVideo.onerror = function() {
		writeLog("WebSocket error");
		setWsState("ERROR");
	};
	wsVideo.onclose = function(event) {
		if (wsDone) {
			setWsState("COMPLETE");
			return;
		}
		writeLog("WebSocket closed unexpectedly");
		writeLog("Code: " + event.code + " Reason: " + (event.reason || "-"));
		setWsState("CLOSED");
	};
	window.addEventListener("beforeunload", function() {
		if (wsVideo) {
			try {
				wsVideo.close();
			} catch (e) {}
		}
		if (wsObjectUrl) {
			URL.revokeObjectURL(wsObjectUrl);
		}
	});
}

// [UPDATE] Putar langsung dari URL API (progressive / Range 206) biar audio
// bisa bunyi dalam hitungan detik. Dulu seluruh file (9-45 MB) harus diunduh
// lewat WebSocket + ditampung di array memori baru bisa play — di HP lambat
// itu berjam-jam terasa seperti "lagu gak bisa diputar". WS sekarang cuma
// fallback kalau URL langsung gagal (403/CORS/blokir).
var streamStarted = false;
var directMode = false;

function startWsFallback(reason) {
	if (streamStarted) return;
	streamStarted = true;
	writeLog("Direct gagal (" + reason + ") — pakai WebSocket");
	setStatus("Sumber lambat — ngambil lewat WebSocket…", "warn");
	try {
		video.removeAttribute("src");
		video.load();
	} catch (e) {}
	startVideoStream(config);
}

function attachDirectSource() {
	var url = config.videoUrl || "";
	if (!url) {
		startWsFallback("URL kosong");
		return;
	}
	directMode = true;
	writeLog("Direct stream: " + url.slice(-32));
	video.preload = config.isAudio ? "auto" : "metadata";
	video.src = url;
	video.load();
	setWsState("DIRECT");
}

video.addEventListener("playing", function() {
	dbg('playing • t=' + video.currentTime.toFixed(2) + ' • rs=' + video.readyState);
	setStatus("Memutar", "");
});

video.addEventListener("loadstart", function() {
	dbg('loadstart • src=' + srcShort(video.currentSrc || video.src));
});

video.addEventListener("canplay", function() {
	dbg('canplay • rs=' + video.readyState + ' • dur=' + (isFinite(video.duration) ? video.duration.toFixed(1) : '?'));
});

video.addEventListener("suspend", function() {
	dbg('suspend • ns=' + video.networkState + ' • rs=' + video.readyState);
});

video.addEventListener("abort", function() {
	dbg('abort • ns=' + video.networkState, 'warn');
});

video.addEventListener("waiting", function() {
	dbg('waiting • rs=' + video.readyState + ' • ns=' + video.networkState, 'warn');
	if (!diagDone) setStatus("Buffering… tunggu sinyal", "warn");
});

video.addEventListener("stalled", function() {
	dbg('stalled • rs=' + video.readyState + ' • ns=' + video.networkState, 'warn');
	if (!diagDone) setStatus("Koneksi lambat — masih buffering", "warn");
});

video.addEventListener("loadedmetadata", function() {
	if (!directMode) return;
	setWsState("DIRECT");
	setStatus("Siap — durasi " + formatTime(video.duration), "");
	var mimeEl = document.getElementById("dbgMime");
	if (mimeEl) mimeEl.textContent = config.isAudio ? "audio" : "video";
	writeLog("Siap | durasi " + formatTime(video.duration));
});

// Diagnosa sekali per sesi: kalau media gagal, cek HTTP/Content-Type URL-nya
// biar status di kartu nyebut angka asli (403/502/HTML) — bukan cuma "kode 4".
var diagDone = false;
function diagnoseMedia() {
	// fetch() lintas-origin bakal diblok CORS, jadi diagnosa pakai info dari
	// elemen media sendiri: kode error + pesan asli dari engine.
	diagDone = true;
	var v = video.error;
	var detail = v ? ("kode " + v.code + (v.message ? " • " + v.message : "")) : "tanpa detail";
	writeLog("Diagnosa: " + detail + " • src=" + String(config.videoUrl || "").slice(0, 60) + "…");
}

var retriedDirect = false;
video.addEventListener("error", function() {
	var code = video.error ? video.error.code : 0;
	var msg = video.error && video.error.message ? " • " + video.error.message : "";
	dbg('media error • kode=' + code + msg + ' • rs=' + video.readyState + ' • ns=' + video.networkState + ' • src=' + srcShort(video.currentSrc || video.src), 'err');
	diagnoseMedia();
	if (!streamStarted) setStatus("Gagal memutar (kode " + code + msg + ") — pencet tombol play di player", "err");
	// Tampilkan kontrol bawaan browser: tombol play-nya = gesture sah, jadi
	// kalau kebijakan autoplay webview ketat, user tetap bisa mulai manual.
	try {
		video.controls = true;
		video.setAttribute('controls', 'controls');
	} catch (e) {}
	if (!directMode || streamStarted) {
		if (code) setWsState("ERROR " + code);
		return;
	}
	// Sekali coba ulang untuk SEMUA kode: endpoint proxy nge-resolve ulang tiap
	// request, jadi 502 sesaat (yang tampil sebagai kode 4) sering sembuh sendiri.
	if (!retriedDirect) {
		retriedDirect = true;
		setTimeout(function() {
			try {
				video.src = config.videoUrl;
				video.load();
				safePlay();
			} catch (e) {}
		}, 1200);
		return;
	}
	if (!config.wsUrl) {
		setWsState("ERROR");
		return;
	}
	directMode = false;
	startWsFallback("kode " + (video.error ? video.error.code : "?"));
});

// WebView kartu WA offline: media remote gak bisa dimuat, cuma WebSocket yang
// jalan. Kalau preferWs, langsung ambil lewat WS tanpa nyoba URL dulu.
if (config.preferWs && config.wsUrl) startWsFallback('mode WS (webview offline)');
else attachDirectSource();
</script>
</body>
</html>`;

  return htmlPayload;
}

const pluginConfig = {
  name: "aurora",
  alias: ['splay', 'streamplay', 'deck', 'vplay'],
  category: "downloader",
  description: "Aurora Deck — Player Music/Video",
  usage: ".aurora",
  example: ".aurora",
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
    let query = (ctx.text || '').trim();
    if (!query) {
      return ctx.reply(
        '🎧 *AURORA — UR SPECIAL PLAYER*\n\n' +
        '`.aurora <judul>` — audio mp3\n' +
        '`.aurora <judul> 720` — video\n' +
        '`.aurora <url youtube>` — direct'
      );
    }

    let customFormat = null;
    const mFmt = query.match(/^(.*?)\s+(mp3|m4a|144|240|360|480|720|1080|1440|2160)$/i);
    if (mFmt) { customFormat = mFmt[2].toLowerCase(); query = mFmt[1].trim(); }
    const format = customFormat || 'mp3';

    await ctx.react('🎧');

    try {
      let info;
      if (/^https?:\/\//i.test(query)) {
        info = { url: query, title: 'Aurora Stream', artist: 'skyline-JXRA Stream', thumbnail: '' };
      } else if (skylineReady()) {
        try {
          const results = await skylineSearch(query, 8);
          const v = results[0];
          if (v?.url) {
            info = {
              url: v.url,
              title: v.title || 'Unknown',
              artist: v.artist || v.channel || 'skyline-JXRA Stream',
              thumbnail: v.thumbnail || '',
              duration: v.duration || ''
            };
          }
        } catch (err) {
          logger.warn('[Aurora] Skyline search GAGAL — HTTP ' + (err?.status || 0) + ' • ' + (err?.message || err));
        }
      }
      if (!info?.url) {
        // Tanpa API cadangan: kalau skyline ga bisa, ya error jujur.
        throw new Error('Lagu/video gak ketemu lewat skyline.web.id (search kosong)');
      }

      // AUDIO → jalur `.yta`: unduh lewat skyline lalu kirim audio WhatsApp asli.
      if (AUDIO_FORMAT.test(format)) {
        await sendAuroraAudio(ctx, info, format);
        await ctx.react('🎛️');
        return;
      }

      const media = await resolveSource(info, format);
      if (!media?.url) throw new Error('Link final gak dapet');

      const finalTitle = media.title || info.title || 'Unknown Video';
      const finalChannel = info.artist || 'Unknown Channel';
      const finalDuration = media.duration || '';
      // Thumbnail bisa dari sumber mana saja yang hidup — coba dua-duanya
      // paralel biar gak nambah waktu tunggu.
      const [thumbA, thumbB] = await Promise.all([
        thumbDataUri(media.thumbnail),
        thumbDataUri(info.thumbnail)
      ]);
      const thumbnailb64 = thumbA || thumbB;

      const probe = media.probe || {};
      logger.info(
        `[Aurora] sumber dipakai: ${media.via} • host=${probe.host || '-'} • ${probe.type || '?'} • ` +
        `range=${probe.ranges ? 'ya' : 'tidak'} • ${probe.bytes || 0}B • locked=${probe.locked ? 'YA' : 'tidak'} • format=${format}`
      );
      if (probe.locked) {
        logger.warn('[Aurora] URL final IP-locked — HP bakal 403 kalau main langsung; kartu akan jatuh ke WebSocket (unduh dulu, baru bunyi)');
      }
      if (!probe.ok) {
        logger.warn(`[Aurora] URL final gagal probe (HTTP ${probe.status || 0}) — player kemungkinan gagal; cek log probe di atas`);
      }

      // Video: tanpa WebSocket pihak ketiga — cuma link skyline.
      const wsUrl = '';

      const sourceNote = media.preview
        ? `${media.preview} — tekan play`
        : 'Tekan play buat mulai';
      const htmlPayload = buildHtml({
        finalTitle, finalChannel, finalDuration,
        videoUrl: media.url, thumbnailb64, wsUrl,
        isAudio: AUDIO_FORMAT.test(String(format || 'mp3')),
        sourceNote
      });

      const sent = await sendRichJH(ctx, htmlPayload);

      logger.info('[Aurora] kartu terkirim | id=' + (sent?.id || '?') + ' | sumber=' + media.via + (media.probe?.locked ? ' (locked → WS)' : ''));
      await ctx.react('🎛️');
    } catch (e) {
      logger.error(
        `[Aurora] GAGAL — ${e?.name || 'Error'} • status=${e?.status || 0} • kode=${e?.code || '-'} • ` +
        `pesan=${String(e?.message || e).slice(0, 200)}`
      );
      await ctx.react('❎');
      ctx.reply('*Aurora Error:* ' + String(e.message || e).slice(0, 250));
    }
  }

export { pluginConfig as config, handler };
export const _internals = { resolveSource, probeMedia, isIpLocked, hostOf, buildHtml };
