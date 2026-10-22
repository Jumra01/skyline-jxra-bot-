/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * aurora.js — AURORA DECK: "AURORA — UR SPECIAL PLAYER"
 */

import sharp from 'sharp';
import config from '../../config.js';
import { sendNativeHtml } from '../../lib/emeraldCard.js';
import { logger } from '../../core/logger.js';
import {
  ytSearch as skylineSearch,
  ytInfo as skylineInfo,
  skylineCreds,
  isConfigured as skylineReady
} from '../../scraper/SKYLINE.js';
import { fetchThumbBuffer } from '../../lib/ytUi.js';
import { embedAudioCover } from '../../lib/audioCover.js';
import { fetchLyrics, capLyrics } from '../../lib/lyrics.js';

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

/* ══════ Tombol PLAYER di in-app browser WhatsApp ══════
 * Riset repo contoh komunitas zаpo (jobasfernandes/zapo-interactive-examples):
 * tombol `cta_url` + `webview_interaction: true` membuka halaman di in-app
 * browser WhatsApp ASLI di HP (browser penuh — audio/fetch/media jalan),
 * BUKAN WebView kartu FOA yang offline. Jadi player web hosted bisa bunyi
 * beneran. API key tidak pernah masuk link chat: bot menukar URL audio
 * (berapikey) ke token singkat dulu via /api/tools/aurora-token (D1). */

/** Tukar URL audio ke token player. Null kalau gagal (tombol dilewati). */
async function mintPlayerToken(audioUrl) {
  const { website } = skylineCreds();
  try {
    const res = await fetch(`${website}/api/tools/aurora-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ url: audioUrl }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      logger.warn(`[Aurora] player: mint token HTTP ${res.status} — tombol dilewati`);
      return null;
    }
    const j = await res.json();
    if (!j?.token) {
      logger.warn('[Aurora] player: mint token balasan kosong — tombol dilewati');
      return null;
    }
    return String(j.token);
  } catch (err) {
    logger.warn(`[Aurora] player: mint token gagal — ${err?.message || err}`);
    return null;
  }
}

/** "3:45" / "1:02:03" → detik. Null kalau gak kebaca. */
function durToSeconds(dur) {
  const parts = String(dur || '').split(':').map((n) => parseInt(n, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null;
}

/** Kirim tombol "Buka Player" (cta_url + webview_interaction). Null-safe. */
async function sendPlayerButton(ctx, info, clean, duration) {
  const { website } = skylineCreds();
  const token = await mintPlayerToken(audioEndpoint(info.url));
  if (!token) return false;

  const params = new URLSearchParams({
    t: token,
    title: String(info.title || clean || '').slice(0, 120),
    cover: String(info.thumbnail || '').slice(0, 300)
  });
  const artist = /skyline-JXRA Stream/.test(String(info.artist || '')) ? '' : String(info.artist || '').slice(0, 80);
  if (artist) params.set('artist', artist);
  const durSec = durToSeconds(duration || info.duration);
  if (durSec) params.set('dur', String(durSec));
  const playerUrl = `${website}/aurora-player?${params.toString()}`;

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: {
        text: `🎧 *${clean}*\nBuka player di dalam WhatsApp — cover, tombol play, dan lirik sinkron.`
      },
      footer: { text: 'AURORA • skyline.web.id' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '▶ Buka Player',
              url: playerUrl,
              merchant_url: playerUrl,
              webview_presentation: 'full',
              webview_interaction: true
            })
          }
        ]
      }
    }
  });
  return true;
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
   * tetap bisa diputar dari pesan audio di bawahnya.
   * Lirik (LRCLIB) diambil PARALEL sama cover biar nambah nol waktu tunggu. */
  let cover = null;
  const wantLyrics = String(info.title || '') !== 'Aurora Stream'; // input URL manual = judul palsu
  const [coverRes, lyricRes] = await Promise.all([
    fetchThumbBuffer(info.thumbnail, { width: 640 }).then(
      (c) => {
        logger.info(`[Aurora] audio: cover ${c ? `OK ${Math.round(c.buffer.length / 1024)}KB` : 'kosong'}`);
        return c;
      },
      (err) => {
        logger.warn(`[Aurora] audio: cover gagal — ${err?.message || err}`);
        return null;
      }
    ),
    wantLyrics
      ? fetchLyrics({
          title: info.title,
          // Placeholder "skyline-JXRA Stream" (input URL manual) jangan dicari.
          artist: /skyline-JXRA Stream/.test(String(info.artist || '')) ? '' : info.artist,
          duration: info.duration
        }).then(
          (ly) => capLyrics(ly),
          (err) => {
            logger.warn(`[Aurora] lirik: gagal — ${err?.name || 'Error'}: ${err?.message || err}`);
            return null;
          }
        )
      : Promise.resolve(null)
  ]);
  cover = coverRes;
  const lyricCard = lyricRes;
  if (lyricCard) {
    logger.info(
      `[Aurora] audio: lirik siap — ${lyricCard.s ? `synced ${lyricCard.l.length} baris` : `plain ${String(lyricCard.p).split('\n').length} baris`}`
    );
  } else if (wantLyrics) {
    logger.info('[Aurora] audio: lirik tidak ketemu — kartu dikirim tanpa panel lirik');
  }

  // Warna aksen diambil dari cover lalu dinaikin saturasi/terangnya biar
  // gradiennya hidup (cover gelap kalau dipakai mentah jadi lumpur).
  let accent = '#1DB954';
  try {
    if (cover?.buffer) accent = await accentFromBuffer(cover.buffer) || accent;
  } catch { /* pakai default */ }

  let cardSent = false;
  let thumbB64 = '';
  /* Cover di kartu lirik dibikin kecil (2,4KB) — markup panel lirik ikut
   * nambah payload, dan payload base64 wajib tetap ≤ ±26KB (AGENTS §9.2).
   * thumbDataUri() sekarang nurut budget (turun sampai 90px kalau perlu). */
  try { thumbB64 = await thumbDataUri(info.thumbnail, lyricCard ? { maxB64: 2400 } : {}); } catch { /* tanpa cover */ }

  if (config.aurora && config.aurora.playerCard) {
    /* Kartu player (opt-in). WebView kartu WA offline, tapi WebSocket JALAN —
     * byte audio diambil lewat /api/tools/ws-audio lalu dijadikan blob. */
    try {
      const link = audioEndpoint(info.url);
      const { website } = skylineCreds();
      /* wajib wss:// — ws:// plain kena redirect 301 front worker → gagal. */
      const wsUrl = `${website.replace(/^http/i, 'ws').replace(/^ws:\/\//, 'wss://')}/api/tools/ws-audio?url=${encodeURIComponent(link)}`;
      const html = buildHtml({
        finalTitle: clean,
        finalChannel: 'AURORA',
        finalDuration: duration,
        videoUrl: link,
        thumbnailb64: thumbB64,
        wsUrl,
        isAudio: true,
        preferWs: true,
        sourceNote: 'Menyiapkan audio lewat WebSocket…'
      });
      await sendNativeHtml(ctx.client, ctx.chat, html);
      cardSent = true;
      logger.info(`[Aurora] audio: kartu player terkirim • ${html.length}B • ws=${wsUrl.slice(0, 48)}…`);
    } catch (err) {
      logger.warn(`[Aurora] audio: kartu player gagal — ${err?.message || err}`);
    }
  } else {
    /* DEFAULT: kartu visual (tanpa <audio>) — WebView kartu WA di banyak HP
     * offline (media nggak bisa diputar), jadi kartu dibuat ringan + cantik,
     * lagunya tetap diputar dari pesan audio native di bawahnya. */
    try {
      const base = {
        title: clean,
        channel: info.artist || 'Unknown Artist',
        duration,
        thumbnailb64: thumbB64,
        accent: accent || '#1DB954',
        note: 'Lagu diputar dari pesan audio di bawah kartu.'
      };
      let html = buildSpotifyHtml({ ...base, lyrics: lyricCard });
      let shrink = '';
      /* Jaga-jaga: payload base64 unifiedResponse wajib ≤ ±26KB biar kartu
       * tetap ke-render (25,6KB = batas; 25,0KB pernah terbukti ke-render).
       * Kalau kartu + lirik kegedean, pangkas bertahap: timestamp dibuang
       * (panel jadi biasa) → potong baris → buang lirik (cover tetap). */
      if (lyricCard && payloadB64Len(html) > 25600) {
        let ly = { s: false, l: [], p: lyricCard.l.map((x) => x[1]).join('\n') || lyricCard.p };
        html = buildSpotifyHtml({ ...base, lyrics: ly });
        shrink = ' • lirik polos';
        if (payloadB64Len(html) > 25600) {
          ly = { s: false, l: [], p: String(ly.p).split('\n').slice(0, 18).join('\n') };
          html = buildSpotifyHtml({ ...base, lyrics: ly });
          shrink = ' • lirik dipangkas';
          if (payloadB64Len(html) > 25600) {
            // Step terakhir: buang LIRIK aja — cover jangan, biar kartu tetap
            // komplit. (Dulu keduanya dibuang barengan → kartu telanjang.)
            html = buildSpotifyHtml({ ...base, lyrics: null });
            shrink = ' • lirik dibuang (cover tetap)';
          }
        }
      }
      await sendNativeHtml(ctx.client, ctx.chat, html);
      cardSent = true;
      logger.info(
        `[Aurora] audio: kartu cover terkirim • ${html.length}B • payload±${payloadB64Len(html)}B ` +
        `(playerCard=false${lyricCard ? ' +lirik' : ''})${shrink}`
      );
    } catch (err) {
      logger.warn(`[Aurora] audio: kartu cover gagal — ${err?.message || err}`);
    }
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

  /* Tombol player (in-app browser WhatsApp) — pelengkap; gagal = dilewati,
   * kartu + pesan audio native di atas tetap utuh. */
  try {
    const ok = await sendPlayerButton(ctx, info, clean, duration);
    if (ok) logger.info('[Aurora] audio: tombol player (in-app webview) terkirim');
  } catch (err) {
    logger.warn(`[Aurora] player: tombol gagal — ${err?.message || err}`);
  }
}

/**
 * Kartu gaya Spotify "Now Playing" + panel LIRIK.
 * Tanpa elemen media (WebView kartu WA cuma bisa gambar) — murni visual.
 * Warna aksen diambil dari cover biar gradiennya nyatu.
 */
/** Ambil warna dominan cover, lalu boost saturasi & kecerahan (HSL). */
async function accentFromBuffer(buffer) {
  const { data } = await sharp(buffer).resize(1, 1, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
  let r = data[0] / 255, g = data[1] / 255, b = data[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0;
  const l0 = (max + min) / 2;
  const d = max - min;
  if (d) {
    sat = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s2 = Math.min(1, Math.max(0.55, sat));
  const l2 = Math.min(0.62, Math.max(0.46, l0 + 0.18));
  const hue2rgb = (p2, q2, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
    if (t < 1 / 2) return q2;
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
    return p2;
  };
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p2 = 2 * l2 - q;
  const out = [hue2rgb(p2, q, h + 1 / 3), hue2rgb(p2, q, h), hue2rgb(p2, q, h - 1 / 3)]
    .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Perkiraan ukuran payload base64 sebuah HTML kartu (batas render ±26KB).
 * +600 = envelope JSON GenAIUnifiedResponse sebelum di-base64. */
function payloadB64Len(html) {
  return Math.ceil(String(html || '').length * 4 / 3) + 600;
}

/** Panel lirik di dalam kartu (sembunyi default; dibuka lewat tombol lirik).
 * Baris sengaja TANPA atribut data — teksnya dibaca dari DOM pas user tap,
 * dan timestamp-nya dari array `LY.t` (hemat ±2KB payload vs nyimpen dua kali). */
function buildLyricPanelHtml(lyrics, synced) {
  const body = synced
    ? lyrics.l
        .map(([, tx]) => `<i class=ly>${escHtml(tx)}</i>`)
        .join('')
    : String(lyrics.p || '')
        .split('\n')
        .filter(Boolean)
        .map((tx) => `<i class=ly>${escHtml(tx)}</i>`)
        .join('') || '<div class="lyr-none">Lirik tidak tersedia.</div>';
  const ctl = synced
    ? `<div class="lyr-ctl">
        <button type="button" id="lyrPlay" onclick="lyrPlay()" title="Mulai sinkron">▶</button>
        <button type="button" onclick="lyrShift(-0.5)" title="Geser lirik +0,5 dtk">−</button>
        <button type="button" onclick="lyrShift(0.5)" title="Geser lirik −0,5 dtk">+</button>
      </div>`
    : '';
  return `<div class="lyrics" id="lyrPanel" style="display:none">
    <div class="lyr-head"><b>LIRIK</b><span>${synced ? 'SINKRON' : 'TEKS'}</span>${ctl}</div>
    <div class="lyr-view" id="lyrView">${body}</div>
  </div>`;
}

/**
 * Kartu "Now Playing" gaya Spotify (dark, cover besar, kontrol penuh).
 * WebView kartu WA: cuma image + WebSocket yang jalan — makanya audio diambil
 * lewat ws-audio, dan lagu tetap dikirim sebagai pesan audio native di bawah.
 * Warna aksen diambil dari cover biar gradiennya nyatu.
 *
 * `lyrics` = hasil `capLyrics()` dari lib/lyrics.js — `{ s, l:[[detik,teks]], p }`.
 * Panel lirik muncul lewat tombol di baris judul; kalau synced, ada mode
 * karaoke (tap ▶ kira-kira pas lagu mulai di pesan audio) + auto-highlight.
 */
function buildSpotifyHtml({ title, channel, duration, thumbnailb64, accent = '#1DB954', note, lyrics = null }) {
  const dur = String(duration || '').trim();
  const hits = /^\d+:\d{2}(:\d{2})?$/.test(dur) ? dur : '';
  const safeTitle = escHtml(title || 'Tanpa Judul');
  const safeChannel = escHtml(channel || 'Unknown Artist');
  const safeNote = escHtml(note || 'Lagu juga dikirim sebagai pesan audio — putar dari situ kalau tombol play rewel.');
  const hasLyrics = Boolean(lyrics && (lyrics.p || (Array.isArray(lyrics.l) && lyrics.l.length)));
  const lyrSynced = hasLyrics && Array.isArray(lyrics.l) && lyrics.l.length > 0;
  const art = thumbnailb64
    ? `<div class="art-wrap"><img class="art" src="${thumbnailb64}" alt=""></div>`
    : `<div class="art-wrap"><div class="art-ph"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M9 18V5.5l10-2V16"/><circle cx="6.6" cy="18" r="2.6"/><circle cx="16.6" cy="16" r="2.6"/></svg></div></div>`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AURORA — ${safeTitle}</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
html,body{margin:0;background:#000}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;padding:12px}
.card{max-width:412px;margin:0 auto;border-radius:26px;overflow:hidden;position:relative;
  background:
    radial-gradient(130% 52% at 50% 0%,${accent}59 0%,${accent}1f 34%,rgba(0,0,0,0) 68%),
    linear-gradient(180deg,#1b1b1b 0%,#121212 44%,#0a0a0a 100%);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 24px 70px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.03) inset}
.top{display:flex;align-items:center;gap:10px;padding:15px 17px 6px}
.logo{width:23px;height:23px;flex:none;display:block}
.who{display:flex;flex-direction:column;line-height:1.16;min-width:0}
.who b{font-size:11.5px;letter-spacing:2.4px;font-weight:800;white-space:nowrap}
.who span{font-size:8px;letter-spacing:1.9px;color:rgba(255,255,255,.42);font-weight:700;margin-top:2px}
.more{margin-left:auto;display:flex;align-items:center;color:rgba(255,255,255,.55)}
.hero{padding:14px 18px 2px;text-align:center;position:relative}
.hero::before{content:"";position:absolute;left:50%;top:8px;width:290px;height:290px;
  transform:translateX(-50%);border-radius:50%;pointer-events:none;
  background:radial-gradient(closest-side,${accent}30 0%,${accent}12 55%,transparent 78%)}
.art-wrap{position:relative;border-radius:20px;overflow:hidden;background:#181818;
  max-width:252px;margin:0 auto;
  box-shadow:0 24px 54px rgba(0,0,0,.78),0 0 0 1px rgba(255,255,255,.09),0 0 34px ${accent}26}
.art{display:block;width:100%;height:auto}
.art-wrap::after{content:"";position:absolute;inset:0;border-radius:18px;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.08) 0%,rgba(255,255,255,0) 22%,rgba(0,0,0,.22) 100%)}
.art-ph{position:relative;padding-top:100%;color:${accent};
  background:radial-gradient(110% 80% at 50% 20%,${accent}47 0%,rgba(255,255,255,.03) 70%)}
.art-ph svg{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);opacity:.85}
.track{display:flex;align-items:flex-start;gap:12px;padding:17px 18px 0}
.meta{min-width:0;flex:1}
.title{font-size:20px;font-weight:800;letter-spacing:-.35px;line-height:1.24;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.artist{margin-top:6px;font-size:12.5px;color:#b3b3b3;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.heart{width:37px;height:37px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  color:#c7c7c7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.prog{padding:19px 18px 0}
.bar{position:relative;height:4px;border-radius:4px;background:rgba(255,255,255,.17)}
.bar i{position:absolute;inset:0 auto 0 0;width:0%;border-radius:4px;background:${accent};
  box-shadow:0 0 14px ${accent}8c}
.bar b{position:absolute;top:50%;left:0%;width:11px;height:11px;border-radius:50%;background:#fff;
  transform:translate(-50%,-50%);box-shadow:0 3px 10px rgba(0,0,0,.55)}
.times{display:flex;justify-content:space-between;margin-top:9px;font-size:10px;color:#8f8f8f;
  font-weight:600;font-variant-numeric:tabular-nums}
.ctrl{display:flex;align-items:center;justify-content:space-between;padding:10px 24px 2px}
.ico{width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.76)}
.ico.on{color:${accent}}
.play{width:62px;height:62px;border-radius:50%;background:#fff;color:#0a0a0a;flex:none;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 14px 32px rgba(0,0,0,.58),0 0 0 1px rgba(255,255,255,.45) inset;
  transition:transform .12s ease,box-shadow .2s ease}
.play:active{transform:scale(.93)}
.play.ready{box-shadow:0 14px 32px rgba(0,0,0,.58),0 0 0 6px ${accent}22,0 0 26px ${accent}66}
.src{margin:14px 14px 0;display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:18px;
  background:
    radial-gradient(120% 130% at 0% 0%,${accent}26 0%,rgba(255,255,255,.02) 62%),
    linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));
  border:1px solid rgba(255,255,255,.075)}
.src-ico{width:36px;height:36px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  background:${accent};color:#08130c;box-shadow:0 8px 20px ${accent}47}
.src-txt{min-width:0;flex:1}
.src-txt b{display:block;font-size:11.5px;font-weight:800;letter-spacing:.15px}
.src-txt span{display:block;font-size:10px;color:#9a9a9a;line-height:1.45;margin-top:2px}
.eq{display:flex;align-items:flex-end;gap:2.5px;height:18px;flex:none;padding-right:2px}
.eq i{width:2.5px;border-radius:2px;background:${accent};opacity:.85;
  animation:eq 1.05s ease-in-out infinite}
.eq i:nth-child(1){height:30%;animation-delay:0s}
.eq i:nth-child(2){height:62%;animation-delay:.14s}
.eq i:nth-child(3){height:44%;animation-delay:.28s}
.eq i:nth-child(4){height:82%;animation-delay:.42s}
.eq i:nth-child(5){height:38%;animation-delay:.56s}
@keyframes eq{0%,100%{transform:scaleY(.42)}50%{transform:scaleY(1)}}
.lyr-btn{width:37px;height:37px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  color:#c7c7c7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.lyr-btn.on{color:${accent};background:${accent}22;border-color:${accent}66}
.lyrics{margin:14px 14px 0;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));
  border:1px solid rgba(255,255,255,.075)}
.lyr-head{display:flex;align-items:center;gap:8px;padding:11px 14px 5px}
.lyr-head b{font-size:10.5px;letter-spacing:2.2px;font-weight:800}
.lyr-head span{font-size:8.5px;letter-spacing:1.4px;color:#8f8f8f;font-weight:700;
  padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.06)}
.lyr-ctl{margin-left:auto;display:flex;gap:5px}
.lyr-ctl button{border:0;border-radius:9px;background:rgba(255,255,255,.08);color:#dcdcdc;
  font-size:11px;font-weight:800;padding:4px 10px;min-width:30px;line-height:1.25}
.lyr-ctl button.on{background:${accent};color:#08130c}
.lyr-view{max-height:236px;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;
  padding:2px 14px 12px}
.ly{display:block;font-size:13.5px;line-height:1.62;font-weight:600;color:rgba(255,255,255,.40);
  padding:3px 0;transition:color .2s ease}
.ly.cur{color:#fff}
.lyr-none{font-size:11.5px;color:#8f8f8f}
.foot{display:flex;align-items:center;justify-content:center;gap:7px;padding:14px 0 16px;
  font-size:9px;color:#6f6f6f;letter-spacing:1.5px;font-weight:700}
.chip{padding:3px 7px;border-radius:6px;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.08);color:#9a9a9a;letter-spacing:.9px}
</style></head>
<body>
<div class="card">
  <div class="top">
    <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="${accent}"/>
      <g fill="none" stroke="#07120a" stroke-width="1.7" stroke-linecap="round">
        <path d="M6.4 8.9c3.7-1.05 8.4-.6 11.2 1.05"/>
        <path d="M7.3 12.2c3.1-.85 7-.4 9.4 1"/>
        <path d="M8.1 15.4c2.5-.6 5.4-.3 7.3.8"/>
      </g>
    </svg>
    <div class="who"><b>AURORA</b><span>NOW PLAYING</span></div>
    <div class="more">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
      </svg>
    </div>
  </div>

  <div class="hero">${art}</div>

  <div class="track">
    <div class="meta">
      <div class="title">${safeTitle}</div>
      <div class="artist">${safeChannel}</div>
    </div>
    <div class="acts">
      ${hasLyrics ? `<div class="lyr-btn" id="lyrBtn" onclick="lyrToggle()" title="Lirik">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16"/><path d="M4 11h11"/><path d="M4 16h16"/><path d="M4 21h8"/>
        </svg>
      </div>` : ''}
      <div class="heart">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>
        </svg>
      </div>
    </div>
  </div>

  <div class="prog">
    <div class="bar"><i id="barFill"></i><b id="knob"></b></div>
    <div class="times"><span id="tCur">0:00</span><span id="tDur">${escHtml(hits || '--:--')}</span></div>
  </div>

  <div class="ctrl">
    <div class="ico on">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>
      </svg>
    </div>
    <div class="ico">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 5h2v14H6zM19 5v14l-9.5-7z"/>
      </svg>
    </div>
    <div class="play" id="playBtn" onclick="hint()">
      <svg id="icoPlay" width="25" height="25" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </div>
    <div class="ico">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 5h2v14h-2zM5 5v14l9.5-7z"/>
      </svg>
    </div>
    <div class="ico">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    </div>
  </div>

  <div class="src">
    <div class="src-ico">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9 18V5.4l10-2V16"/><circle cx="6.6" cy="18" r="2.7"/><circle cx="16.6" cy="16" r="2.7"/>
      </svg>
    </div>
    <div class="src-txt"><b>Audio siap diputar</b><span id="srcNote">${safeNote}</span></div>
    <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
  </div>

  ${hasLyrics ? buildLyricPanelHtml(lyrics, lyrSynced) : ''}

  <div class="foot"><span>AURORA</span><span>•</span><span>skyline.web.id</span><span class="chip">HQ</span></div>
</div>

<script>
/* WebView kartu WA offline (media nggak jalan di banyak device), jadi tombol
 * play cuma ngasih tau: lagunya diputar dari pesan audio di bawah kartu. */
function hint() {
  var t = document.getElementById('srcNote');
  if (t) { t.textContent = 'Putar lagu dari pesan audio di bawah \u2193'; t.style.color = '#1ed760'; }
  var b = document.getElementById('playBtn');
  if (b) b.className = 'play ready';
}
</script>${hasLyrics ? `
<script>
/* LIRIK KARAOKE — WebView kartu WA gak bisa muter audio remote, jadi
 * sinkronisasi pakai jam manual (ketuk ▶ pas lagu mulai di pesan audio).
 * Teks baris dibaca dari DOM, cuma timestamp yang di-embed (hemat payload). */
window.LYRICS = ${JSON.stringify({ s: Boolean(lyrSynced), t: (lyrics.l || []).map((x) => Math.round((Number(x[0]) || 0) * 10) / 10) })};
var LY = window.LYRICS || {}, T = 0, L = 0, TI = null, I = -1, E = null;
function nodes() { return E || (E = [].slice.call(document.querySelectorAll('#lyrView .ly'))) }
function lyrToggle() {
  var p = document.getElementById('lyrPanel');
  if (!p) return;
  var on = p.style.display === 'none';
  p.style.display = on ? 'block' : 'none';
  var b = document.getElementById('lyrBtn');
  if (b) b.className = on ? 'lyr-btn on' : 'lyr-btn';
  if (on) paint(1);
}
function lyrPlay() {
  var b = document.getElementById('lyrPlay');
  if (TI) { clearInterval(TI); TI = null; if (b) { b.textContent = '\u25B6'; b.className = ''; } return; }
  L = Date.now();
  TI = setInterval(function() { var n = Date.now(); T += (n - L) / 1e3; L = n; paint(); }, 200);
  if (b) { b.textContent = '\u275A\u275A'; b.className = 'on'; }
}
function lyrShift(d) { T = Math.max(0, T + d); L = Date.now(); paint(); }
function lyrSeek(t) { T = Math.max(0, Number(t) || 0); L = Date.now(); paint(); }
function paint(f) {
  var ts = LY.t || [];
  if (!ts.length) return;
  var els = nodes();
  if (!els.length) return;
  var i = -1;
  for (var k = 0; k < ts.length && k < els.length; k++) { if (ts[k] <= T + 1e-3) i = k; else break; }
  if (i === I && !f) return;
  I = i;
  for (var j = 0; j < els.length; j++) els[j].className = (j === i ? 'ly cur' : 'ly');
  var cur = els[i], v = document.getElementById('lyrView');
  if (cur && v) { // rect, bukan offsetTop: offsetParent kartu ini .card, bukan panel scroll
    var dy = cur.getBoundingClientRect().top - v.getBoundingClientRect().top;
    v.scrollTop = Math.max(0, v.scrollTop + dy - v.clientHeight * .4);
  }
}
(function() {
  var v = document.getElementById('lyrView');
  if (!v) return;
  v.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== v && el.className !== 'ly') el = el.parentNode;
    if (!el || el === v) return;
    var els = nodes();
    for (var i = 0; i < els.length; i++) if (els[i] === el) { lyrSeek((LY.t || [])[i]); return; }
  });
})();
</script>` : ''}
</body></html>`;
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

async function thumbDataUri(url, { maxB64 = 9 * 1024 } = {}) {
  if (!url) return '';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return '';
    const raw = Buffer.from(await r.arrayBuffer());
    if (!raw.length) return '';
    /* Cover di-embed sebagai data URI, jadi tiap KB di sini ikut membengkak
     * 4/3 di payload base64 — dan kartu rich yang kegedean bikin WA nampilin
     * "pesan tidak didukung". Turunin resolusi bertahap sampai masuk budget
     * (plan diperpanjang sampai 90px — thumbnail foto asli di 160px pun bisa
     * masih ±3.5KB, gak muat di budget kecil kartu lirik). */
    const plan = [[400, 62], [340, 58], [300, 54], [260, 50], [220, 46], [200, 44], [180, 44], [160, 42], [140, 40], [120, 38], [110, 36], [100, 34], [90, 32]];
    let last = raw;
    for (const [width, quality] of plan) {
      try {
        last = await sharp(raw).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      } catch { return 'data:image/jpeg;base64,' + last.toString('base64'); }
      const b64 = last.toString('base64');
      if (b64.length <= maxB64) return 'data:image/jpeg;base64,' + b64;
    }
    return 'data:image/jpeg;base64,' + last.toString('base64');
  } catch { return ''; }
}

/** Escape buat teks/atribut HTML (judul bisa ada `&`, `<`, kutip). */
const escHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

      const sent = await sendNativeHtml(ctx.client, ctx.chat, htmlPayload);

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
export const _internals = { resolveSource, probeMedia, isIpLocked, hostOf, buildHtml, buildCoverHtml, buildSpotifyHtml, thumbDataUri, payloadB64Len, buildLyricPanelHtml };
