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

/** Beep 440 Hz, WAV 4 kHz mono 8-bit 0.3 dtk → base64.
 *  Sample rate 4 kHz sengaja (beep 440Hz tetap jelas, Nyquist aman) —
 *  kartu lab harus tetap muat di payload FOA, dan beep ini ±1.6KB. */
function beepDataUri() {
  const rate = 4000;
  const n = Math.round(rate * 0.3);
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

function buildLabHtml({ remoteImg, remoteAudio, wsUrl, pagesWsUrl = '', imgstream = '', beep, label }) {
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

<div class="row"><div class="name">6. Audio data: URI (beep 0.6 dtk)</div>
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

<div class="row"><div class="name">11. WebAudio oscillator (beep 0.6 dtk — didengar?)</div>
<button class="btn" onclick="tWebAudioOsc()">Tes</button><div class="res" id="r11">-</div></div>

<div class="row"><div class="name">12. WebAudio decode beep WAV (data lokal)</div>
<button class="btn" onclick="tWebAudioDecode()">Tes</button><div class="res" id="r12">-</div></div>

<div class="row"><div class="name">13. WS → WebAudio decode → play lagu</div>
<button class="btn" onclick="tWsAudio()">Tes</button><div class="res" id="r13">-</div></div>

<div class="row"><div class="name">14. WS netral (echo.websocket.org — pemisah)</div>
<button class="btn" onclick="tWsEcho()">Tes</button><div class="res" id="r14">-</div></div>

<div class="row"><div class="name">15. WS langsung ke pages.dev (lewatatin apex)</div>
<button class="btn" onclick="tWsPages()">Tes</button><div class="res" id="r15">-</div></div>

<div class="row"><div class="name">16. PIKSEL: imgstream → canvas → decode → play</div>
<button class="btn" onclick="tImgStream()">Tes</button><div class="res" id="r16">-</div></div>

<div id="sum"></div>

<script>
var REMOTE_IMG = "${esc(remoteImg)}";
var REMOTE_AUDIO = "${esc(remoteAudio)}";
var WS_URL = "${esc(wsUrl)}";
var PAGES_WS = "${esc(pagesWsUrl || '')}";
var IMGSTREAM = "${esc(imgstream || '')}";
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
  var lines = ['origin=' + location.origin, 'secure=' + window.isSecureContext, 'ua=' + UA_STR.slice(0, 70), 'ws=' + (WS_URL ? WS_URL.slice(0, 90) : '(kosong)')];
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
  ws.onerror = function () { set(5, 'no', 'WS error (gagal connect) • ' + WS_URL.slice(0, 55)); };
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

/* ── Jalur WebAudio (AudioContext) — BUKAN elemen <audio>, jadi bisa jadi
 *    gak kena blokir pipeline media WebView. Ini harapan terakhir biar audio
 *    bisa bunyi dari dalam kartu. ────────────────────────────────────── */

function getCtx(id) {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { set(id, 'no', 'AudioContext TIDAK ADA di WebView ini'); return null; }
    var ctx = window.__labCtx || (window.__labCtx = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) {
    set(id, 'no', 'AudioContext exception: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || ''));
    return null;
  }
}

/** data: URI → ArrayBuffer tanpa fetch (fetch diblok di WebView). */
function dataUriToAb(uri) {
  var b64 = uri.slice(uri.indexOf(',') + 1);
  var bin = atob(b64);
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

function tWebAudioOsc() {
  var ctx = getCtx(11);
  if (!ctx) return;
  try {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    g.gain.value = 0.15;
    osc.frequency.value = 440;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    set(11, 'wait', 'beep oscillator 0.3 dtk terjadwal…');
    setTimeout(function () {
      if (ctx.state === 'running') set(11, 'ok', 'WebAudio jalan (state=running) — BUNYI BEEP kedengaran?');
      else set(11, 'no', 'state=' + ctx.state + ' — output diblok (gak kedengaran)');
    }, 400);
  } catch (e) { set(11, 'no', 'exception: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || '')); }
}

function tWebAudioDecode() {
  var ctx = getCtx(12);
  if (!ctx) return;
  set(12, 'wait', 'decode beep WAV…');
  try {
    var ab = dataUriToAb(BEEP);
    var done = false;
    var cb = function (buf) {
      if (done) return;
      done = true;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      set(12, 'ok', 'decodeAudioData OK (' + buf.duration.toFixed(2) + 's @ ' + buf.sampleRate + 'Hz) — BUNYI beep?');
    };
    var fail = function (e) {
      if (done) return;
      done = true;
      set(12, 'no', 'decode GAGAL: ' + ((e && (e.message || e.name)) || '?'));
    };
    var p = ctx.decodeAudioData(ab, cb, fail);
    if (p && p.then) p.then(cb, fail);
    setTimeout(function () { if (!done) set(12, 'no', 'decode timeout 8s (kemungkinan gak didukung)'); }, 8000);
  } catch (e) { set(12, 'no', 'exception: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || '')); }
}

function playDecoded(buf) {
  var ctx = window.__labCtx;
  if (!ctx) return;
  if (window.__labSrc) { try { window.__labSrc.stop(); } catch (e) {} }
  if (window.__labProg) clearInterval(window.__labProg);
  var src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  window.__labSrc = src;
  var t0 = ctx.currentTime;
  set(13, 'wait', 'playing… 0.0 / ' + buf.duration.toFixed(1) + 's');
  window.__labProg = setInterval(function () {
    var t = ctx.currentTime - t0;
    if (t >= buf.duration) {
      clearInterval(window.__labProg);
      window.__labProg = 0;
      set(13, 'ok', 'WebAudio PLAY penuh ' + buf.duration.toFixed(1) + 's @ ' + buf.sampleRate + 'Hz — LAGU KEDENGARAN?');
    } else set(13, 'wait', 'playing… ' + t.toFixed(1) + ' / ' + buf.duration.toFixed(1) + 's');
  }, 500);
  setTimeout(function () {
    if (window.__labProg && ctx.currentTime - t0 > 2) set(13, 'ok', 'WebAudio MUTER ' + (ctx.currentTime - t0).toFixed(1) + 's dari ' + buf.duration.toFixed(1) + 's — LAGU KEDENGARAN? (tekan TES lagi = stop)');
  }, 2500);
}

function tWsAudio() {
  var ctx = getCtx(13);
  if (!ctx) return;
  // Ketukan kedua: unduhan sudah ada → decode + play
  if (window.__labWsBuf) {
    var buf = window.__labWsBuf;
    window.__labWsBuf = null;
    set(13, 'wait', 'decode ' + Math.round(buf.byteLength / 1024) + ' KB…');
    var done = false;
    var cb = function (b) { if (done) return; done = true; playDecoded(b); };
    var fail = function (e) { if (done) return; done = true; set(13, 'no', 'decodeAudioData GAGAL: ' + ((e && (e.message || e.name)) || '?')); };
    try {
      var p = ctx.decodeAudioData(buf, cb, fail);
      if (p && p.then) p.then(cb, fail);
    } catch (e) { fail(e); }
    setTimeout(function () { if (!done) set(13, 'no', 'decode timeout 30s — buffer kemungkinan OOM di WebView'); }, 30000);
    return;
  }
  // Ketukan pertama: unduh lagu penuh lewat WS
  if (!WS_URL) { set(13, 'no', 'URL WS kosong'); return; }
  set(13, 'wait', 'download lagu via WS…');
  var ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  var chunks = [], total = 0, t0 = Date.now();
  ws.onmessage = function (ev) {
    if (typeof ev.data === 'string') {
      try {
        var m = JSON.parse(ev.data);
        if (m.type === 'end') {
          var u8 = new Uint8Array(total);
          var off = 0;
          for (var i = 0; i < chunks.length; i++) { u8.set(chunks[i], off); off += chunks[i].length; }
          chunks = [];
          window.__labWsBuf = u8.buffer;
          set(13, 'wait', 'unduhan siap (' + Math.round(total / 1024) + ' KB, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's) — TEKAN TES LAGI buat decode+play');
        }
        if (m.type === 'error') set(13, 'no', 'server error: ' + (m.message || '?'));
      } catch (e) {}
      return;
    }
    chunks.push(new Uint8Array(ev.data));
    total += ev.data.byteLength || 0;
    if (total % 262144 < 65536) set(13, 'wait', 'unduh ' + Math.round(total / 1024) + ' KB…');
  };
  ws.onerror = function () { set(13, 'no', 'WS error (gagal connect) • ' + WS_URL.slice(0, 55)); };
  ws.onclose = function (e) { if (!total) set(13, 'no', 'WS closed ' + e.code); };
  setTimeout(function () { if (!total) { try { ws.close(); } catch (e) {} set(13, 'no', 'timeout 60s tanpa data'); } }, 60000);
}

/* ── Pemisah diagnosa: WS mati TOTAL di WebView, atau cuma skyline.web.id? ── */

/** #14: WS ke server netral (echo.websocket.org) — kirim 'ping', tunggu balik. */
function tWsEcho() {
  var url = 'wss://echo.websocket.org';
  set(14, 'wait', 'connect ke ' + url + '…');
  var t0 = Date.now();
  var ws;
  try { ws = new WebSocket(url); } catch (e) { set(14, 'no', 'exception: ' + ((e && e.name) || '?')); return; }
  var gotEcho = false;
  ws.onopen = function () {
    set(14, 'wait', 'open (' + (Date.now() - t0) + 'ms) — kirim ping…');
    try { ws.send('ping'); } catch (e) { set(14, 'no', 'send gagal: ' + ((e && e.name) || '?')); }
  };
  ws.onmessage = function (ev) {
    if (ev.data === 'ping' && !gotEcho) {
      gotEcho = true;
      set(14, 'ok', 'WS netral HIDUP — ping balik dalam ' + (Date.now() - t0) + 'ms');
      try { ws.close(); } catch (e) {}
    }
  };
  ws.onerror = function () { set(14, 'no', 'WS netral GAGAL connect — WebView/jaringan kamu nutup WS total'); };
  ws.onclose = function () { if (!gotEcho) set(14, 'no', 'close tanpa echo (' + (Date.now() - t0) + 'ms)'); };
  setTimeout(function () { if (!gotEcho) { try { ws.close(); } catch (e) {} set(14, 'no', 'timeout 12s tanpa echo'); } }, 12000);
}

/** #15: WS ke host pages.dev langsung — lewatin apex skyline.web.id
 *  (record A apex pernah nunjuk tunnel lama; kalau DNS HP kamu nyasar,
 *  konek langsung ke origin Pages-nya bisa jalan walau apex mati). */
function tWsPages() {
  if (!PAGES_WS) { set(15, 'no', 'URL pages WS kosong'); return; }
  set(15, 'wait', 'connect ke skyline-27v.pages.dev…');
  var ws;
  try { ws = new WebSocket(PAGES_WS); } catch (e) { set(15, 'no', 'exception: ' + ((e && e.name) || '?')); return; }
  ws.onopen = function () { set(15, 'wait', 'open — nunggu respons server…'); };
  ws.onmessage = function (ev) {
    if (typeof ev.data === 'string') {
      try {
        var m = JSON.parse(ev.data);
        if (m.type === 'start') set(15, 'ok', 'pages.dev WS HIDUP • start ' + (m.mime || '') + ' ' + (m.length || '?') + 'B');
        if (m.type === 'end') set(15, 'ok', 'pages.dev WS OK (end)');
        if (m.type === 'error') set(15, 'ok', 'pages.dev WS HIDUP (server balas: ' + String(m.message || '?').slice(0, 60) + ')');
      } catch (e) { set(15, 'ok', 'pages.dev WS HIDUP (pesan non-JSON)'); }
      try { ws.close(); } catch (e) {}
      return;
    }
  };
  ws.onerror = function () { set(15, 'no', 'pages.dev WS GAGAL connect'); };
  ws.onclose = function (e) { set(15, 'no', 'close ' + e.code + ' tanpa respons'); };
  setTimeout(function () { try { ws.close(); } catch (e) {} }, 25000);
}

/* ── Jalur PIKSEL (plan B): bytes audio disembunyiin server di piksel PNG,
 *    kartu muat lewat <img> (satu-satunya jalur network yang masih hidup di
 *    WebView offline), canvas getImageData baca balik, rakit → decode → play.
 *    Protokol piksel lihat functions/api/tools/imgstream.js (web-cf). ── */

function imgChunk(i) {
  return new Promise(function (res, rej) {
    var im = new Image();
    im.crossOrigin = 'anonymous';
    var to = setTimeout(function () { rej(new Error('timeout 15s chunk ' + i)); }, 15000);
    im.onload = function () {
      clearTimeout(to);
      try {
        var c = document.createElement('canvas');
        c.width = im.width; c.height = im.height;
        var g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        var d = g.getImageData(0, 0, c.width, c.height).data;
        /* Server nulis stream sebagai RGB (3 byte/piksel); canvas balikin
         * RGBA (4 byte/piksel) — jadi SEMUA byte stream (termasuk header)
         * harus dibaca lewat piksel s/3, channel s%3. Kalau dibaca kontigu,
         * byte ke-3 kena alpha (255) dan header rusak. */
        var rd = function (i) { return d[((i / 3) | 0) * 4 + (i % 3)]; };
        var total = (rd(0) << 24 | rd(1) << 16 | rd(2) << 8 | rd(3)) >>> 0;
        var crc = rd(4), count = (rd(5) << 16 | rd(6) << 8 | rd(7)) >>> 0;
        var out = new Uint8Array(count);
        var sum = 0;
        for (var k = 0; k < count; k++) {
          var v = rd(8 + k);
          out[k] = v; sum = (sum + v) & 255;
        }
        if (sum !== crc) { rej(new Error('checksum salah (piksel rusak)')); return; }
        res({ total: total, data: out });
      } catch (e) { rej(new Error('canvas: ' + ((e && e.name) || '?') + ' ' + ((e && e.message) || ''))); }
    };
    im.onerror = function () { clearTimeout(to); rej(new Error('img onerror (imgstream belum ke-deploy?)')); };
    im.src = IMGSTREAM + '&off=' + (i * 65536) + '&len=65536&r=' + Math.random();
  });
}

function tImgStream() {
  var ctx = getCtx(16);
  if (!ctx) return;
  if (!IMGSTREAM) { set(16, 'no', 'URL imgstream kosong'); return; }
  set(16, 'wait', 'unduh chunk 1…');
  var parts = [], got = 0, total = 0, i = 0, t0 = Date.now();
  var play = function () {
    var ab = new Uint8Array(got), off = 0;
    for (var j = 0; j < parts.length; j++) { ab.set(parts[j], off); off += parts[j].length; }
    set(16, 'wait', Math.round(got / 1024) + 'KB byte COCOK ✓ (' + ((Date.now() - t0) / 1000).toFixed(1) + 's) — decode…');
    var done = false;
    var cb = function (buf) {
      if (done) return; done = true;
      var src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start();
      set(16, 'ok', 'PIPELINE PENUH OK — ' + buf.duration.toFixed(1) + 's audio dari PIKSEL gambar — DENGAR LAGU?');
    };
    var fail = function (e) { if (done) return; done = true; set(16, 'no', 'decode GAGAL: ' + ((e && (e.message || e.name)) || '?')); };
    try { var p = ctx.decodeAudioData(ab.buffer, cb, fail); if (p && p.then) p.then(cb, fail); } catch (e) { fail(e); }
  };
  var next = function () {
    if (i >= 3 || (total && got >= Math.min(total, 3 * 65536))) { play(); return; }
    imgChunk(i).then(function (r) {
      i++;
      if (!total) total = r.total;
      parts.push(r.data); got += r.data.length;
      set(16, 'wait', 'unduh ' + Math.round(got / 1024) + 'KB ✓ — chunk ' + (i + 1) + '…');
      next();
    }, function (e) { set(16, 'no', 'chunk ' + (i + 1) + ' GAGAL: ' + ((e && e.message) || '?')); });
  };
  next();
}

renderSum();
</script>
</body></html>`;
}

const pluginConfig = {
  name: 'richlab',
  alias: ['labrich', 'richtest'],
  category: 'tools',
  description: 'Lab diagnosa kartu rich HTML WhatsApp — tes audio/video (remote, data URI, WebSocket+blob) + jalur WebAudio (#11–#13)',
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
  /* Skema WAJIB wss:// — WebView kartu gak boleh buka ws:// (plain), dan
   * front worker skyline nolak/redirect upgrade non-https → "gagal connect".
   * Kalau env panel isi `http://`, http→ws doang bikin ws:// yang rusak. */
  const wsUrl = `${website.replace(/^http/i, 'ws').replace(/^ws:\/\//, 'wss://')}/api/tools/ws-audio?url=${encodeURIComponent(audioUrl)}`;
  /* Host Pages origin langsung — buat ngetes apex skyline.web.id yang record
   * A-nya pernah nunjuk tunnel lama (tes #15). */
  const pagesWsUrl = `wss://skyline-27v.pages.dev/api/tools/ws-audio?url=${encodeURIComponent(audioUrl)}`;
  /* Jalur piksel (plan B) — bytes audio disembunyiin di PNG (tes #16). */
  const imgstreamUrl = `${website}/api/tools/imgstream?url=${encodeURIComponent(audioUrl)}`;
  const remoteImg = 'https://i.ytimg.com/vi/hQ-wYw4hP84/hqdefault.jpg';

  const html = buildLabHtml({
    remoteImg,
    remoteAudio: audioUrl,
    wsUrl,
    pagesWsUrl,
    imgstream: imgstreamUrl,
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
    'Tekan tombol 1–15 di kartu (terutama **#11, #12, #13** — jalur WebAudio, dan **#14, #15** — diagnosa WS), ' +
    'lalu screenshot bagian hasil (`#1 … #15`) dan kirim ke sini.\n\n' +
    '> #14 = WS netral (server pihak ketiga): OK berarti WebView kamu masih boleh WS.\n' +
    '> #15 = WS langsung ke host pages.dev (lewatin apex skyline.web.id).\n' +
    '> Kontrol: #1 & #6 harus OK. Kalau #1 gagal, kartu bahkan gak bisa gambar data-URI.'
  );
}

export { pluginConfig as config, handler };
export const _internals = { buildLabHtml, beepDataUri, TEST_VIDEO };
