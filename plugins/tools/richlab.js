/**
 * © skyline-JXRA
 * richlab.js — LAB DIAGNOSTIK kartu rich HTML WhatsApp.
 *
 * Tujuan: di WebView kartu WhatsApp, cuma WebSocket yang (katanya) jalan;
 * fetch/img/script/media remote diblok. Plugin ini ngirim satu kartu berisi
 * beberapa TES, masing-masing ada tombol + hasil OK/GAGAL. Jadi kita tahu
 * persis metode mana yang hidup di HP user, tanpa nebak-nebak.
 */

import crypto from 'node:crypto';
import config from '../../config.js';
import { sendRichJH } from '../../lib/jhrich.js';
import { logger } from '../../core/logger.js';
import { skylineCreds } from '../../scraper/SKYLINE.js';

const UA = 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36';

/** Video pendek buat sumber tes (Janji Suci — 3:14). */
const TEST_VIDEO = 'https://www.youtube.com/watch?v=hQ-wYw4hP84';

/** 1 detik beep 440 Hz, WAV 8 kHz mono 8-bit → base64. */
function beepDataUri() {
  const rate = 8000;
  const n = rate;
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i += 1) {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    buf[44 + i] = Math.round(128 + 90 * Math.sin((2 * Math.PI * 440 * i) / rate) * fade);
  }
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

/** 1x1 PNG transparan buat tes gambar data-URI. */
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const esc = (v) => String(v ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${')
  .replace(/</g, '\\x3C');

function buildLabHtml({ remoteImg, remoteAudio, wsUrl, beep, label }) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RICH LAB</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;padding:14px;background:#05090b;color:#eafff5;font-family:Arial,Helvetica,sans-serif}
h1{font-size:13px;letter-spacing:2px;margin:0 0 4px;color:#5cffb0}
.sub{font-size:10px;color:#7fa896;margin-bottom:12px}
.row{background:#0b1512;border:1px solid rgba(0,255,136,.14);border-radius:12px;padding:10px;margin-bottom:8px}
.name{font-size:11px;font-weight:700;margin-bottom:6px}
.btn{background:rgba(0,255,136,.12);color:#eafff5;border:0;border-radius:8px;padding:7px 12px;font-size:11px;font-weight:700}
.res{font-size:10px;margin-top:6px;color:#93b3a6;font-family:monospace;word-break:break-all}
.ok{color:#3ddc84}.no{color:#ff7b7b}.wait{color:#fbbf24}
#sum{margin-top:12px;font-size:10px;font-family:monospace;color:#9fd7c2;white-space:pre-wrap}
audio,video{width:100%;margin-top:8px;border-radius:8px}
</style></head>
<body>
<h1>AURORA · RICH LAB</h1>
<div class="sub">${esc(label)}<br>Tekan tiap tombol, lihat hasilnya. Screenshot lalu kirim ke bot.</div>

<div class="row"><div class="name">1. Gambar data: URI (kontrol)</div>
<button class="btn" onclick="tImgData()">Tes</button><div class="res" id="r1">-</div></div>

<div class="row"><div class="name">2. Gambar remote https (kontrol)</div>
<button class="btn" onclick="tImgRemote()">Tes</button><div class="res" id="r2">-</div></div>

<div class="row"><div class="name">3. fetch() ke skyline</div>
<button class="btn" onclick="tFetch()">Tes</button><div class="res" id="r3">-</div></div>

<div class="row"><div class="name">4. XMLHttpRequest ke skyline</div>
<button class="btn" onclick="tXhr()">Tes</button><div class="res" id="r4">-</div></div>

<div class="row"><div class="name">5. WebSocket ke skyline (ws-audio)</div>
<button class="btn" onclick="tWs()">Tes</button><div class="res" id="r5">-</div></div>

<div class="row"><div class="name">6. Audio data: URI (beep 1 dtk)</div>
<button class="btn" onclick="tBeep()">Tes</button><div class="res" id="r6">-</div>
<audio id="a6" preload="auto"></audio></div>

<div class="row"><div class="name">7. Audio remote &lt;audio src=https&gt;</div>
<button class="btn" onclick="tAudioRemote()">Tes</button><div class="res" id="r7">-</div>
<audio id="a7" preload="auto"></audio></div>

<div class="row"><div class="name">8. Video remote &lt;video src=https&gt;</div>
<button class="btn" onclick="tVideoRemote()">Tes</button><div class="res" id="r8">-</div>
<video id="v8" playsinline preload="auto"></video></div>

<div class="row"><div class="name">9. WebSocket → Blob → play</div>
<button class="btn" onclick="tWsBlob()">Tes</button><div class="res" id="r9">-</div>
<audio id="a9" preload="auto"></audio></div>

<div class="row"><div class="name">10. Play dari timer (tanpa gesture)</div>
<button class="btn" onclick="tTimer()">Tes</button><div class="res" id="r10">-</div>
<audio id="a10" preload="auto"></audio></div>

<div id="sum"></div>

<script>
var REMOTE_IMG = "${esc(remoteImg)}";
var REMOTE_AUDIO = "${esc(remoteAudio)}";
var WS_URL = "${esc(wsUrl)}";
var BEEP = "${esc(beep)}";
var R = {};
var UA_STR = navigator.userAgent;

function log(m) {
  try { console.log('[RichLab] ' + m); } catch (e) {}
}

function set(id, state, text) {
  var el = document.getElementById('r' + id);
  if (!el) return;
  el.className = 'res ' + (state === 'ok' ? 'ok' : state === 'no' ? 'no' : 'wait');
  el.textContent = text;
  R[id] = state + ' — ' + text;
  renderSum();
  log(id + ': ' + state + ' ' + text);
}

function renderSum() {
  var s = document.getElementById('sum');
  if (!s) return;
  var lines = ['origin=' + location.origin, 'secure=' + window.isSecureContext, 'ua=' + UA_STR.slice(0, 70)];
  Object.keys(R).sort().forEach(function (k) { lines.push('#' + k + ' ' + R[k]); });
  s.textContent = lines.join('\\n');
}

function playTest(el, id, label) {
  el.muted = false;
  var p = el.play();
  if (!p || !p.then) { set(id, 'wait', 'play() tidak ada promise'); return; }
  p.then(function () {
    setTimeout(function () {
      var t = el.currentTime || 0;
      var rs = el.readyState;
      var err = el.error ? el.error.code : 0;
      if (t > 0.1) set(id, 'ok', label + ' MUTER • t=' + t.toFixed(2) + ' rs=' + rs);
      else set(id, 'wait', label + ' play OK tapi t=0 rs=' + rs + (err ? ' err=' + err : ''));
    }, 1500);
  }).catch(function (e) {
    set(id, 'no', 'play() ditolak: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || ''));
  });
  el.addEventListener('error', function () {
    set(id, 'no', 'media error ' + (el.error ? el.error.code : '?') + ' • ' + (el.error && el.error.message ? el.error.message : ''));
  }, { once: true });
}

function tImgData() {
  var i = new Image();
  i.onload = function () { set(1, 'ok', 'data:image OK ' + i.width + 'x' + i.height); };
  i.onerror = function () { set(1, 'no', 'data:image GAGAL'); };
  i.src = "${PNG_1PX}";
}

function tImgRemote() {
  set(2, 'wait', 'memuat…');
  var i = new Image();
  var done = false;
  i.onload = function () { done = true; set(2, 'ok', 'remote image OK ' + i.width + 'x' + i.height); };
  i.onerror = function () { done = true; set(2, 'no', 'remote image GAGAL (diblok / offline)'); };
  i.src = REMOTE_IMG + (REMOTE_IMG.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
  setTimeout(function () { if (!done) set(2, 'no', 'timeout 6s — kemungkinan diblok'); }, 6000);
}

function tFetch() {
  set(3, 'wait', 'fetch…');
  fetch(REMOTE_AUDIO, { method: 'GET', headers: { Range: 'bytes=0-99' } })
    .then(function (r) { set(3, 'ok', 'fetch HTTP ' + r.status + ' ' + (r.headers.get('content-type') || '-')); try { r.body && r.body.cancel(); } catch (e) {} })
    .catch(function (e) { set(3, 'no', 'fetch GAGAL: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || '')); });
}

function tXhr() {
  set(4, 'wait', 'xhr…');
  try {
    var x = new XMLHttpRequest();
    x.open('GET', REMOTE_AUDIO, true);
    x.setRequestHeader('Range', 'bytes=0-99');
    x.onload = function () { set(4, 'ok', 'xhr HTTP ' + x.status + ' ' + (x.getResponseHeader('content-type') || '-')); };
    x.onerror = function () { set(4, 'no', 'xhr error (diblok)'); };
    x.ontimeout = function () { set(4, 'no', 'xhr timeout'); };
    x.timeout = 8000;
    x.send();
  } catch (e) { set(4, 'no', 'xhr exception: ' + (e && e.name)); }
}

function tWs() {
  if (!WS_URL) { set(5, 'no', 'URL WS kosong'); return; }
  set(5, 'wait', 'connecting…');
  var got = 0, bytes = 0, t0 = Date.now();
  var ws;
  try { ws = new WebSocket(WS_URL); } catch (e) { set(5, 'no', 'WebSocket exception: ' + (e && e.name)); return; }
  ws.binaryType = 'arraybuffer';
  ws.onopen = function () { set(5, 'wait', 'open • nunggu data…'); };
  ws.onmessage = function (ev) {
    if (typeof ev.data === 'string') {
      try {
        var m = JSON.parse(ev.data);
        if (m.type === 'start') set(5, 'wait', 'start ' + (m.mime || '') + ' • ' + (m.length || '?') + 'B');
        if (m.type === 'end') set(5, 'ok', 'WS OK • ' + bytes + 'B dalam ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
        if (m.type === 'error') set(5, 'no', 'WS server error: ' + (m.message || '?'));
      } catch (e) {}
      return;
    }
    bytes += ev.data.byteLength || 0;
    got += 1;
  };
  ws.onerror = function () { set(5, 'no', 'WS error (gagal connect)'); };
  ws.onclose = function (e) { if (!bytes) set(5, 'no', 'WS closed ' + e.code + ' ' + (e.reason || '')); };
  setTimeout(function () { try { ws.close(); } catch (e) {} }, 25000);
}

function tTimer() {
  var a = document.getElementById('a10');
  a.src = BEEP;
  a.load();
  setTimeout(function () {
    var p = a.play();
    if (p && p.catch) p.catch(function (e) { set(10, 'no', 'ditolak: ' + ((e && e.name) || '?')); });
    setTimeout(function () {
      if (!a.error && a.currentTime > 0.1) set(10, 'ok', 'timer play OK (autoplay diizinkan)');
      else if (!a.error) set(10, 'no', 'play jalan tapi t=0');
    }, 1200);
  }, 300);
  set(10, 'wait', 'play dijadwalkan +300ms…');
}

function tBeep() {
  var a = document.getElementById('a6');
  a.src = BEEP;
  playTest(a, 6, 'beep data:');
}

function tAudioRemote() {
  var a = document.getElementById('a7');
  a.src = REMOTE_AUDIO;
  a.load();
  playTest(a, 7, 'audio remote:');
}

function tVideoRemote() {
  var v = document.getElementById('v8');
  v.src = REMOTE_AUDIO;
  v.load();
  playTest(v, 8, 'video remote:');
}

function tWsBlob() {
  if (!WS_URL) { set(9, 'no', 'URL WS kosong'); return; }
  // Unduhan WS selesai di callback — play() di situ BUKAN gesture dan bakal
  // ditolak. Jadi: ketukan pertama = unduh, ketukan kedua = play.
  if (window.__labBlobUrl) {
    var a0 = document.getElementById('a9');
    a0.src = window.__labBlobUrl;
    a0.load();
    playTest(a0, 9, 'blob:');
    return;
  }
  set(9, 'wait', 'download via WS…');
  var ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  var chunks = [], bytes = 0, mime = 'audio/mpeg', t0 = Date.now();
  ws.onmessage = function (ev) {
    if (typeof ev.data === 'string') {
      try {
        var m = JSON.parse(ev.data);
        if (m.type === 'start' && m.mime) mime = m.mime;
        if (m.type === 'end') {
          var blob = new Blob(chunks, { type: mime });
          chunks = [];
          window.__labBlobUrl = URL.createObjectURL(blob);
          set(9, 'wait', 'blob ' + bytes + 'B siap — TEKAN TES LAGI buat play');
        }
        if (m.type === 'error') set(9, 'no', 'server error: ' + (m.message || '?'));
      } catch (e) {}
      return;
    }
    chunks.push(ev.data);
    bytes += ev.data.byteLength || 0;
    if (bytes % 262144 < 65536) set(9, 'wait', 'unduh ' + Math.round(bytes / 1024) + ' KB…');
  };
  ws.onerror = function () { set(9, 'no', 'WS error'); };
  ws.onclose = function (e) { if (!bytes) set(9, 'no', 'WS closed ' + e.code); };
  setTimeout(function () { if (!bytes) { try { ws.close(); } catch (e) {} set(9, 'no', 'timeout 25s tanpa data'); } }, 25000);
}

renderSum();
</script>
</body></html>`;
}

const pluginConfig = {
  name: 'richlab',
  alias: ['labrich', 'richtest'],
  category: 'tools',
  description: 'Lab diagnosa kartu rich HTML WhatsApp — tes audio/video (remote, data URI, WebSocket+blob)',
  usage: '.richlab',
  example: '.richlab',
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 5,
  limit: 0,
  isEnabled: true,
};

async function handler(ctx) {
  const { website, apikey } = skylineCreds();
  if (!apikey) return ctx.reply('⚠️ API key skyline.web.id belum diisi — lab ini butuh itu buat URL tes.');

  const audioUrl =
    `${website}/api/tools/ytdl/audio?url=${encodeURIComponent(TEST_VIDEO)}` +
    `&apikey=${encodeURIComponent(apikey)}&mode=stream`;
  const wsUrl = `${website.replace(/^http/i, 'ws')}/api/tools/ws-audio?url=${encodeURIComponent(audioUrl)}`;
  const remoteImg = 'https://i.ytimg.com/vi/hQ-wYw4hP84/hqdefault.jpg';

  const html = buildLabHtml({
    remoteImg,
    remoteAudio: audioUrl,
    wsUrl,
    beep: beepDataUri(),
    label: `host=${website} • key=${apikey.slice(0, 8)}…`
  });

  try {
    const t0 = Date.now();
    const sent = await sendRichJH(ctx, html);
    logger.info(`[RichLab] kartu terkirim | id=${sent?.id || '?'} | ${html.length}B | ${Date.now() - t0}ms | ws=${wsUrl.slice(0, 60)}…`);
  } catch (err) {
    logger.error(`[RichLab] GAGAL kirim kartu — ${err?.name || 'Error'}: ${err?.message || err}`);
    return ctx.reply('❌ Gagal kirim kartu lab: ' + String(err?.message || err).slice(0, 160));
  }

  await ctx.reply(
    '🧪 *RICH LAB* terkirim.\n\n' +
    'Tekan tombol 1–9 di kartu, lalu screenshot bagian hasil (`#1 … #9`) dan kirim ke sini.\n\n' +
    '> Kontrol: #1 & #6 harus OK. Kalau #1 gagal, kartu bahkan gak bisa gambar data-URI.'
  );
}

export { pluginConfig as config, handler };
export const _internals = { buildLabHtml, beepDataUri, TEST_VIDEO };
