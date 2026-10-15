import axios from "axios";

class YouTubeDownloader {
  constructor() {
    this.baseUrl = "https://p.savenow.to";
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: "https://y2down.cc/",
      Origin: "https://y2down.cc",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      Priority: "u=4",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    };

    this.audioFormats = [
      "mp3",
      "m4a",
      "webm",
      "aac",
      "flac",
      "opus",
      "ogg",
      "wav",
    ];
    this.videoFormats = [
      "4k",
      "1440",
      "1080",
      "720",
      "480",
      "320",
      "240",
      "144",
    ];
    this.supportedFormats = [...this.audioFormats, ...this.videoFormats];
  }

  validateFormat(formatQuality) {
    if (!this.supportedFormats.includes(formatQuality)) {
      return false;
    }
    return true;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async requestDownload(youtubeUrl, formatQuality = "720") {
    this.validateFormat(formatQuality);

    const params = {
      copyright: "0",
      format: formatQuality,
      url: youtubeUrl,
      api: "dfcb6d76f2f6a9894gjkege8a4ab232222",
    };

    try {
      const response = await axios.get(`${this.baseUrl}/ajax/download.php`, {
        params: params,
        headers: this.headers,
        timeout: 30000,
      });

      if (response.data.progress_url) {
        return {
          progress_url: response.data.progress_url,
          title: response.data.info?.title || null,
          image: response.data.info?.image || null,
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  async checkProgress(progressUrl, maxAttempts = 60, delay = 2000) {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(progressUrl, {
          headers: this.headers,
          timeout: 30000,
        });

        const data = response.data;
        const downloadUrl = data.download_url || "";

        if (downloadUrl && downloadUrl.trim() !== "") {
          return {
            download_url: downloadUrl,
          };
        }

        if (
          data.error ||
          (data.success === 0 &&
            (data.text || "").toLowerCase().includes("error"))
        ) {
          throw new Error(data.message || "Unknown error from progress");
        }

        attempts++;
        await this.sleep(delay);
      } catch (error) {
        attempts++;
        await this.sleep(delay);
      }
    }
    return null;
  }

  async download(youtubeUrl, formatQuality = "720") {
    const progressData = await this.requestDownload(youtubeUrl, formatQuality);
    if (!progressData)
      return {
        error: "Failed to request download",
      };

    const downloadData = await this.checkProgress(progressData.progress_url);
    if (!downloadData)
      return {
        error: "Timeout or failed to retrieve download URL",
      };

    return {
      status: "success",
      title: progressData.title,
      image: progressData.image,
      download_url: downloadData.download_url,
      format: formatQuality,
    };
  }
}

export const jhydl = new YouTubeDownloader();
