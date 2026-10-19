/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * SPOTIFY.js — Scraper Spotify Searcher + Downloader by SKYLINE-JXRA
 * [UPDATE 2026-10-18] Search pakai Spotify Web API (Client Credentials) —
 *   TANPA browser. puppeteer dihapus dari project (hemat ±652 MB disk,
 *   wajib buat panel Pterodactyl 1 GB).
 *   Kredensial dibaca dari env SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
 *   (fallback: config.api.spotify.clientId / clientSecret).
 *   Download (JHSpotDL / JHSDown) tetap pakai axios — gak butuh browser.
 */

import config from '../config.js';

const axios = (await import('axios')).default;
const FormData = (await import('form-data')).default;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

/* ── Kredensial app Spotify (env menang, config cuma fallback) ────────── */
function getCreds() {
  const id = String(process.env.SPOTIFY_CLIENT_ID || config.api?.spotify?.clientId || '').trim();
  const secret = String(process.env.SPOTIFY_CLIENT_SECRET || config.api?.spotify?.clientSecret || '').trim();
  return { id, secret };
}

/* ── App token (Client Credentials) + cache ±55 menit ─────────────────── */
let cachedToken = { value: null, exp: 0 };

async function getAppToken() {
  if (cachedToken.value && Date.now() < cachedToken.exp) return cachedToken.value;

  const { id, secret } = getCreds();
  if (!id || !secret) {
    const e = new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET belum diset');
    e.code = 'NO_CREDS';
    throw e;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000)
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const e = new Error(body.error_description || body.error || `token HTTP ${res.status}`);
    e.code = 'TOKEN_FAILED';
    throw e;
  }

  // expires_in biasanya 3600s → simpan 3300s biar aman dari expiry di tengah jalan
  const ttl = Math.min(Number(body.expires_in) > 0 ? Number(body.expires_in) - 300 : 3300, 3300);
  cachedToken = { value: body.access_token, exp: Date.now() + ttl * 1000 };
  return cachedToken.value;
}

/* ── Map track Spotify Web API → shape internal plugin ───────────────── */
function mapApiTrack(t) {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).filter(Boolean).join(', ') || undefined,
    album: t.album?.name,
    duration_ms: t.duration_ms,
    cover: t.album?.images?.[0]?.url,
    preview_url: t.preview_url || null,
    spotify_url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`
  };
}

export async function JHSpotSearch(query, limit = 5) {
  const baseRes = { status: true, author_skrep: 'skyline-JXRA', kesayangan: 'Fiony Alveria♡', data: {} };

  try {
    const token = await getAppToken();
    const take = Math.min(Math.max(Number(limit) || 5, 1), 20);
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&type=track&limit=${take}`;

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error?.message || `HTTP ${res.status}`);
    }

    const tracks = (body.tracks?.items || []).map(mapApiTrack).filter((t) => t.id);

    if (!tracks.length) {
      throw new Error('Tidak ditemukan hasil lagu untuk query tersebut.');
    }

    baseRes.data = { tracks };
    return baseRes;

  } catch (error) {
    if (error.code === 'NO_CREDS') {
      return { ...baseRes, status: false, needCreds: true, error: error.message };
    }
    return { ...baseRes, status: false, error: error.message };
  }
}

export async function JHSpotDL(targetUrl) {
  const baseRes = { status: true, author_skrep: 'skyline-JXRA', kesayangan: 'Fiony Alveria♡', data: {} };
  const jantung = {
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "user-agent": UA,
    "referer": "https://www.spotify-downloads.com/"
  };

  try {
    const initReq = await axios.post('https://www.spotify-downloads.com/api/download', {
      url: targetUrl,
      quality: "320k"
    }, { headers: jantung });

    if (!initReq.data || !initReq.data.job_id) {
      throw new Error("Gagal membuat antrean download di server.");
    }

    const jobId = initReq.data.job_id;
    let finalData = null;

    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const checkReq = await axios.get(`https://www.spotify-downloads.com/api/status/${jobId}`, { headers: jantung });
      
      if (checkReq.data && checkReq.data.status === 'ready') {
        finalData = checkReq.data;
        break;
      } else if (checkReq.data && checkReq.data.error) {
        throw new Error(checkReq.data.error);
      }
    }

    if (!finalData) {
      throw new Error("Waktu tunggu habis, proses download gagal.");
    }

    const firstTrack = finalData.songs && finalData.songs.length > 0 ? finalData.songs[0] : {};

    baseRes.data = {
      job_id: finalData.job_id,
      title: finalData.name || firstTrack.name,
      artist: finalData.artist || firstTrack.artist,
      track_id: firstTrack.track_id || "",
      download_url: `https://www.spotify-downloads.com/api/file/${finalData.job_id}`
    };

    return baseRes;

  } catch (error) {
    return { ...baseRes, status: false, error: error.response?.data || error.message };
  }
}

export async function JHSDown(targetUrl) {
  const baseRes = { status: true, author_skrep: 'skyline-JXRA', kesayangan: 'Fiony Alveria♡', data: {} };

  try {
    const spoHtml = await axios.get(targetUrl);
    const titleMatch = spoHtml.data.match(/<title>(.*?)<\/title>/i)?.[1] || 'Spotify Track';
    const cleanTitle = titleMatch.replace(' - song and lyrics by ', ' - ').split(' | ')[0];
    const [song_name, artist] = cleanTitle.includes(' - ') ? cleanTitle.split(' - ') : [cleanTitle, 'Unknown'];

    const form = new FormData();
    form.append('post_id', '2');
    form.append('form_id', '394636d');
    form.append('referer_title', 'Spotify Music Downloader - Convert Spotify to MP3 Online Free');
    form.append('queried_id', '2');
    form.append('form_fields[music_url]', targetUrl);
    form.append('action', 'elementor_pro_forms_send_form');
    form.append('referrer', 'https://spotidown.net/en/');

    const req1 = await axios.post('https://spotidown.net/en/wp-admin/admin-ajax.php', form, {
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        'referer': 'https://spotidown.net/en/',
        ...form.getHeaders()
      }
    });

    let cookie = '';
    if (req1.headers['set-cookie']) {
      cookie = req1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    }

    const step2DataObj = { song_name: song_name.trim(), artist: artist.trim(), link: targetUrl };
    const step2Encoded = Buffer.from(JSON.stringify(step2DataObj)).toString('base64');

    const req2 = await axios.get(`https://spotidown.net/en/wp-admin/admin-ajax.php?action=check_download_status&data=${step2Encoded}`, {
      headers: {
        'accept': '*/*',
        'x-requested-with': 'XMLHttpRequest',
        'referer': 'https://spotidown.net/en/downloads/',
        'cookie': cookie
      }
    });

    if (!req2.data?.success || !req2.data?.data?.download_id) {
      throw new Error('Gagal inisiasi download ID Spotidown.');
    }

    const downloadId = req2.data.data.download_id;
    let finalData = null;
    let attempts = 0;

    while (attempts < 10) {
      await new Promise(r => setTimeout(r, 2000));
      const req3 = await axios.get(`https://spotidown.net/en/wp-admin/admin-ajax.php?action=get_download_status&download_id=${downloadId}`, {
        headers: {
          'accept': '*/*',
          'x-requested-with': 'XMLHttpRequest',
          'referer': 'https://spotidown.net/en/downloads/',
          'cookie': cookie
        }
      });

      if (req3.data?.success && req3.data?.data?.status === 'ready') {
        finalData = req3.data.data;
        break;
      }
      attempts++;
    }

    if (!finalData) throw new Error('Timeout saat menunggu status download.');

    baseRes.data = finalData;
    return baseRes;

  } catch (error) {
    return { ...baseRes, status: false, error: error.response?.data?.message || error.message };
  }
}
