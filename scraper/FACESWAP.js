/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * faceswap.js — Face Swap engine.
 */

async function getProxy() {
  const axios = (await import('axios')).default

  const { data: proxies } = await axios.get('https://proxy.jhx.my.id/jh-proxy')
  const picked = proxies[Math.floor(Math.random() * proxies.length)]

  const [host, port, username, password] = picked.split(':')

  return {
    protocol: 'http',
    host,
    port: parseInt(port),
    auth: { username, password }
  }
}

async function toBuffer(input, proxy) {
  const axios = (await import('axios')).default

  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)

  if (typeof input === 'string' && /^https?:\/\//i.test(input)) {
    const res = await axios.get(input, {
      responseType: 'arraybuffer',
      proxy
    })
    return Buffer.from(res.data)
  }

  throw new Error('Input image invalid')
}

export async function faceSwap({ target, swap } = {}) {
  const axios = (await import('axios')).default
  const crypto = (await import('crypto')).default
  const FormData = (await import('form-data')).default

  try {
    const proxy = await getProxy()

    const [targetBuf, swapBuf] = await Promise.all([
      toBuffer(target, proxy),
      toBuffer(swap, proxy)
    ])

    const rand1 = Math.floor(1000 + Math.random() * 9000)
    const rand2 = Math.floor(1000 + Math.random() * 9000)

    const form = new FormData()

    form.append('target_image', Buffer.from(targetBuf), {
      filename: `Fiony_target_${rand1}.jpg`,
      contentType: 'image/jpeg'
    })

    form.append('swap_image', Buffer.from(swapBuf), {
      filename: `Fiony_swap_${rand2}.png`,
      contentType: 'image/png'
    })

    form.append('version', '2')

    const jantung = {
      ...form.getHeaders(),
      'Product-Code': '067003',
      'Product-Serial': crypto.randomBytes(16).toString('hex'),
      'source': 'ai_face_vary',
      'Authorization': ''
    }

    const { data: createRes } = await axios.post(
      'https://api.remaker.ai/api/pai/v3/ai-facevary/appapi/create-job',
      form,
      { headers: jantung, proxy }
    )

    if (createRes.code !== 100000 || !createRes.result?.job_id) {
      throw new Error(`Gagal create job: ${JSON.stringify(createRes)}`)
    }

    const jobId = createRes.result.job_id
    let finalResult = null

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 4000))

      const { data: pollRes } = await axios.get(
        `https://api.remaker.ai/api/pai/v3/ai-facevary/appapi/get-job/${jobId}`,
        { headers: jantung, proxy }
      )

      if (pollRes.code === 300006) continue

      if (pollRes.code === 100000 && pollRes.result?.output_image_url) {
        finalResult = Array.isArray(pollRes.result.output_image_url)
          ? pollRes.result.output_image_url[0]
          : pollRes.result.output_image_url
        break
      }

      throw new Error(`Error polling: ${JSON.stringify(pollRes)}`)
    }

    if (!finalResult) throw new Error('Timeout nunggu render kelar!')

    return {
      success: true,
      resultUrl: finalResult
    }
  } catch (err) {
    const errInfo = err.response?.data || err.stack || err.message
    throw new Error(typeof errInfo === 'object' ? JSON.stringify(errInfo) : String(errInfo))
  }
}

export default faceSwap
