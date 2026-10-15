/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * rch.js — WhatsApp Reaction Channel engine
 */
import axios from 'axios';

export async function JHRCH(link, emoji = '❤️') {
  const baseRes = { author_skrep: 'skyline-JXRA', kesayangan: 'Fiony Alveria♡' };
  const baseUrl = 'https://reaction-whatsapp.edgeone.dev';

  let proxyConfig = false; 

  try {
    const proxyRes = await axios.get('https://proxy.jhx.my.id/jh-proxy', { timeout: 5000 });
    let rawData = proxyRes.data;
    
    let rawList = [];
    if (typeof rawData === 'string') {
      rawList = rawData.split('\n').map(l => l.trim()).filter(Boolean);
    } else if (Array.isArray(rawData)) {
      rawList = rawData;
    } else if (rawData && rawData.proxies) {
      rawList = rawData.proxies;
    }

    if (rawList.length > 0) {
      const randomProxy = rawList[Math.floor(Math.random() * rawList.length)];
      let clean = String(randomProxy).replace(/^https?:\/\//, '');
      let parts = clean.split(':');

      if (parts.length >= 4) {
        proxyConfig = {
          protocol: 'http',
          host: parts[0],
          port: Number(parts[1]),
          auth: {
            username: parts[2],
            password: parts[3]
          }
        };
      } else if (parts.length === 2) {
        proxyConfig = {
          protocol: 'http',
          host: parts[0],
          port: Number(parts[1])
        };
      }
    }
  } catch (err) {
  }

  try {
    const jantung = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer J93Y22SN",
      "Origin": baseUrl,
      "Referer": baseUrl + "/"
    };

    const axiosConfig = {
      timeout: 60000,
      headers: jantung,
      validateStatus: () => true,
      proxy: proxyConfig 
    };

    const res = await axios.post(`${baseUrl}/react`, {
      link,
      emoji
    }, axiosConfig);

    return {
      ...baseRes,
      status: res.status === 200,
      httpStatus: res.status,
      data: res.data
    };

  } catch (err) {
    const errInfo = err.response?.data || err.stack || err.message;
    return {
      ...baseRes,
      status: false,
      error: typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo
    };
  }
}
