/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 *
 * SAFELINK.js — resolver tautan safelink (sfl.gl / safelinku / tutwuri / linku.to
 * / blog wpsafelink) tanpa browser.
 *
 * Cara kerja:
 *  1. Ikuti redirect manual (maxRedirects: 0) sambil nabung cookie per host —
 *     safelink biasanya pasang sesi + XSRF di hop pertama.
 *  2. Di tiap halaman yang masih di domain safelink:
 *     - meta refresh / window.location.href → ikut
 *     - <form> → submit (GET query atau POST form-urlencoded) pakai input apa adanya
 *     - flow khaddavi (app.khaddavi.net) → POST /api/verify lalu /api/go
 *     - link terenkode base64 di parameter (?go=...&r=...) → decode
 *  3. Berhenti begitu host keluar dari daftar safelink = itu tautan tujuan.
 *
 * Kalau semua langkah gagal → fallback ke API bypass publik (bisa dioverride
 * lewat env SAFELINK_BYPASS_API / SAFELINK_BYPASS_KEY).
 *
 * Gak pakai puppeteer: Chromium 652MB, panel 1GB gak kuat (lihat AGENTS.md).
 */

const UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

const MAX_HOPS = 10;
const MAX_STEPS = 8;
const MAX_BYTES = 3 * 1024 * 1024;

/** Domain safelink yang dikenali (termasuk halaman perantara). */
const SAFELINK_HOSTS = [
  'sfl.gl',
  'linku.to',
  'safelinku.com',
  'safelinku.net',
  'safelinkku.com',
  'tutwuri.id',
  'khaddavi.net',
  'wpsafelink',
  'sflinku.com'
];

const FALLBACK_API = (
  process.env.SAFELINK_BYPASS_API || 'https://safebypass.vercel.app/api/bypass'
).trim();
const FALLBACK_KEY = String(process.env.SAFELINK_BYPASS_KEY || '').trim();

export class SafelinkError extends Error {
  constructor(message, code = 'FAILED') {
    super(message);
    this.name = 'SafelinkError';
    this.code = code;
  }
}

export function isSafelink(url) {
  try {
    return SAFELINK_HOSTS.some((h) => new URL(url).hostname.includes(h));
  } catch {
    return false;
  }
}

/* ── cookie jar sederhana (per host, tanpa domain matching ribet) ───────── */
function newJar() {
  return new Map();
}

function jarHeader(jar, url) {
  const host = new URL(url).hostname;
  const out = [];
  for (const [h, map] of jar) {
    if (host === h || host.endsWith('.' + h)) {
      for (const [k, v] of map) out.push(`${k}=${v}`);
    }
  }
  return out.join('; ');
}

function jarAbsorb(jar, url, setCookie) {
  if (!setCookie) return;
  const host = new URL(url).hostname;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  if (!jar.has(host)) jar.set(host, new Map());
  const store = jar.get(host);
  for (const raw of list) {
    const first = String(raw).split(';')[0];
    const eq = first.indexOf('=');
    if (eq < 1) continue;
    store.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

function jarGet(jar, hostPart, name) {
  for (const [h, map] of jar) {
    if (h.includes(hostPart) && map.has(name)) return decodeURIComponent(map.get(name));
  }
  return '';
}

function absUrl(base, rel) {
  try {
    return new URL(rel, base).toString();
  } catch {
    return null;
  }
}

/** GET satu hop tanpa auto-redirect — biar cookie tiap host kebaca. */
async function hop(axios, jar, url, { timeout = 20000, method = 'GET', body = null, referer = '' } = {}) {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    Cookie: jarHeader(jar, url)
  };
  if (referer) headers.Referer = referer;
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const res = await axios.request({
    url,
    method,
    data: body || undefined,
    headers,
    timeout,
    maxRedirects: 0,
    maxContentLength: MAX_BYTES,
    responseType: 'text',
    validateStatus: () => true
  });

  jarAbsorb(jar, url, res.headers['set-cookie']);

  return {
    status: res.status,
    location: res.headers.location ? absUrl(url, res.headers.location) : null,
    html: typeof res.data === 'string' ? res.data : '',
    headers: res.headers
  };
}

/** Ikuti redirect sampai dapat halaman 200 (atau kehabisan hop). */
async function follow(axios, jar, start, opts = {}) {
  let url = start;
  let res = null;
  for (let i = 0; i < MAX_HOPS; i += 1) {
    res = await hop(axios, jar, url, { ...opts, referer: i ? url : '' });
    if (res.location && res.status >= 300 && res.status < 400) {
      url = res.location;
      opts = { ...opts, method: 'GET', body: null };
      continue;
    }
    return { url, ...res };
  }
  throw new SafelinkError('Terlalu banyak redirect', 'TOO_MANY_REDIRECTS');
}

/** Ambil tautan tujuan dari HTML: meta refresh / window.location / location.replace. */
function extractRedirect(html, baseUrl) {
  const patterns = [
    /<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /location\.href\s*=\s*["']([^"']+)["']/i,
    /<a[^>]+id=["'](?:btn|go|next|continue)["'][^>]+href=["']([^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const target = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
      return absUrl(baseUrl, target);
    }
  }
  return null;
}

/** Decode payload base64 pada parameter yang umum dipakai wpsafelink. */
function decodePayloadParam(url) {
  try {
    const u = new URL(url);
    for (const key of ['go', 'r', 'q', 'url', 'u', 'redirect', 'dest']) {
      const raw = u.searchParams.get(key);
      if (!raw) continue;
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch {}
  return null;
}

/** Ambil form pertama + action/method/inputs-nya. */
function readForm(html, baseUrl) {
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/i;
  const m = html.match(formRe);
  if (!m) return null;

  const attrs = m[1];
  const inner = m[2];
  const action = (attrs.match(/action=["']([^"']*)["']/i) || [])[1] || '';
  const method = ((attrs.match(/method=["']([^"']*)["']/i) || [])[1] || 'GET').toUpperCase();

  const inputs = [];
  const inputRe = /<input\b([^>]*)>/gi;
  let im;
  while ((im = inputRe.exec(inner))) {
    const a = im[1];
    const name = (a.match(/name=["']([^"']*)["']/i) || [])[1];
    if (!name) continue;
    const value = (a.match(/value=["']([^"']*)["']/i) || [])[1] || '';
    inputs.push([name, value.replace(/&amp;/g, '&')]);
  }

  return {
    action: absUrl(baseUrl, action || baseUrl),
    method,
    fields: new URLSearchParams(inputs).toString()
  };
}

/** Flow app.khaddavi.net: verify dulu, minta /api/go, lalu baca halaman tujuan. */
async function khaddaviFlow(axios, jar, pageUrl, html, { timeout = 20000 } = {}) {
  const origin = new URL(pageUrl).origin;
  const xsrf = jarGet(jar, 'khaddavi', 'XSRF-TOKEN');
  if (!xsrf) throw new SafelinkError('Token XSRF khaddavi gak ketemu', 'NO_XSRF');

  const key = Math.floor(Math.random() * 1000);
  const size = `${3840 + key * 2}.${2160 + key * 2}`;
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'X-XSRF-TOKEN': xsrf,
    Origin: origin,
    Referer: pageUrl,
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: jarHeader(jar, pageUrl)
  };

  await axios
    .post(`${origin}/api/verify`, { _a: 0, captcha: '', passcode: '' }, { headers, timeout, validateStatus: () => true })
    .catch(() => null);

  const go = await axios
    .post(`${origin}/api/go`, { key, size }, { headers, timeout, validateStatus: () => true })
    .catch(() => null);

  const goUrl = go?.data?.url;
  if (!goUrl) throw new SafelinkError('Balasan /api/go kosong', 'NO_GO_URL');

  const ready = await follow(axios, jar, absUrl(origin, goUrl), { timeout });
  const dest = extractRedirect(ready.html, ready.url) || decodePayloadParam(ready.url);
  if (!dest) throw new SafelinkError('Tautan tujuan gak ketemu di halaman akhir', 'NO_DEST');

  // Halaman "lanjut" kadang masih butuh satu klik — ikutin sekali lagi.
  if (isSafelink(dest) || /khaddavi/.test(dest)) {
    const again = await follow(axios, jar, dest, { timeout });
    return extractRedirect(again.html, again.url) || decodePayloadParam(again.url) || again.url;
  }
  return dest;
}

/* ── engine utama ──────────────────────────────────────────────────────── */
export async function resolveSafelink(input, { timeout = 25000 } = {}) {
  const start = String(input || '').trim();
  if (!/^https?:\/\//i.test(start)) throw new SafelinkError('Link harus diawali http(s)://', 'INVALID');
  if (!isSafelink(start)) throw new SafelinkError('Domain belum didukung', 'UNSUPPORTED');

  const axios = (await import('axios')).default;
  const jar = newJar();
  let url = start;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const decoded = decodePayloadParam(url);
    if (decoded && !isSafelink(decoded)) return decoded;

    const page = await follow(axios, jar, url, { timeout });

    // Sudah keluar dari domain safelink → ini tujuannya.
    if (!isSafelink(page.url) && !/khaddavi/.test(page.url)) {
      return decoded || page.url;
    }

    if (/khaddavi/.test(page.url)) {
      return await khaddaviFlow(axios, jar, page.url, page.html, { timeout });
    }

    const shapeRedirect = extractRedirect(page.html, page.url);
    if (shapeRedirect && !isSafelink(shapeRedirect)) return shapeRedirect;

    if (/wpsafelink|safelinku/i.test(page.html) && shapeRedirect) {
      url = shapeRedirect;
      continue;
    }

    const form = readForm(page.html, page.url);
    if (form) {
      if (form.method === 'POST') {
        const submitted = await hop(axios, jar, form.action, {
          timeout,
          method: 'POST',
          body: form.fields,
          referer: page.url
        });
        if (submitted.location) {
          url = submitted.location;
          continue;
        }
        const next = extractRedirect(submitted.html, form.action) || decodePayloadParam(form.action);
        if (next) {
          url = next;
          continue;
        }
      } else if (form.fields) {
        url = `${form.action}${form.action.includes('?') ? '&' : '?'}${form.fields}`;
        continue;
      }
    }

    if (shapeRedirect) {
      url = shapeRedirect;
      continue;
    }

    break;
  }

  throw new SafelinkError('Tautan gagal diproses. Mungkin sudah kedaluwarsa atau flow-nya berubah.', 'STUCK');
}

/**
 * Fallback API publik (dipakai https://safebypass.vercel.app).
 * Cuma dipanggil kalau engine lokal gagal — bukan sumber utama.
 */
export async function resolveViaApi(url, { timeout = 45000 } = {}) {
  if (!FALLBACK_API) return null;
  const axios = (await import('axios')).default;
  const body = { url: String(url || '').trim() };
  if (FALLBACK_KEY) body.apiKey = FALLBACK_KEY;

  const res = await axios.post(FALLBACK_API, body, {
    timeout,
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    validateStatus: () => true
  });

  const data = res.data || {};
  if (data.ok && data.url) return { url: data.url, source: 'fallback-api' };
  return { error: data.message || `HTTP ${res.status}`, code: data.code || 'API_FAILED' };
}

/** Resolver lengkap: engine lokal dulu, fallback API kalau gagal. */
export async function bypassSafelink(url, { timeout = 25000 } = {}) {
  const target = String(url || '').trim();
  let localError = null;

  try {
    const out = await resolveSafelink(target, { timeout });
    if (out) return { url: out, source: 'engine' };
  } catch (err) {
    localError = err;
  }

  if (FALLBACK_API) {
    try {
      const fb = await resolveViaApi(target);
      if (fb?.url) return fb;
      throw new SafelinkError(fb?.error || 'API bypass gagal', fb?.code || 'API_FAILED');
    } catch (err) {
      if (err instanceof SafelinkError) throw err;
      throw new SafelinkError(`API bypass gak bisa dihubungi (${err?.message || err})`, 'API_DOWN');
    }
  }

  throw localError || new SafelinkError('Gagal memproses tautan', 'FAILED');
}

export default { bypassSafelink, resolveSafelink, resolveViaApi, isSafelink, SafelinkError };
