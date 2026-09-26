import axios from 'axios';
import * as cheerio from 'cheerio';
import qs from 'qs';

class SpotidownScraper {
  constructor() {
    this.baseUrl = 'https://spotidown.app';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  async _getSession() {
    const response = await axios.get(`${this.baseUrl}/en3`, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const cookies = response.headers['set-cookie'] || [];
    const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');

    const $ = cheerio.load(response.data);
    const form = $('form[name="spotifyurl"]');
    if (!form.length) {
      throw new Error('Spotify URL search form not found on homepage.');
    }

    let dynamicName = '';
    let dynamicValue = '';
    form.find('input[type="hidden"]').each((i, elem) => {
      const name = $(elem).attr('name');
      const val = $(elem).attr('value');
      if (name && name !== 'g-recaptcha-response') {
        dynamicName = name;
        dynamicValue = val;
      }
    });

    return { sessionCookie, dynamicName, dynamicValue };
  }

  async search(queryOrUrl) {
    const { sessionCookie, dynamicName, dynamicValue } = await this._getSession();

    const payload = {
      url: queryOrUrl,
      'g-recaptcha-response': '',
    };
    if (dynamicName) {
      payload[dynamicName] = dynamicValue;
    }

    const response = await axios.post(`${this.baseUrl}/action`, qs.stringify(payload), {
      headers: {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/en3`,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': sessionCookie
      }
    });

    if (response.data.error) {
      throw new Error(response.data.message || 'Lookup failed.');
    }

    const $ = cheerio.load(response.data.data);
    const tracks = [];

    $('form[name="submitspurl"]').each((i, formElem) => {
      const form = $(formElem);
      const data = form.find('input[name="data"]').val();
      const base = form.find('input[name="base"]').val();
      const token = form.find('input[name="token"]').val();

      if (data && base && token) {
        let metadata = {};
        try {
          const decodedMeta = Buffer.from(data, 'base64').toString('utf8');
          metadata = JSON.parse(decodedMeta);
        } catch (e) {
          metadata = { error: 'Failed parsing metadata' };
        }

        tracks.push({
          metadata,
          form: { data, base, token }
        });
      }
    });

    return { tracks, sessionCookie };
  }

  async getDownloadLinks(form, sessionCookie) {
    const response = await axios.post(`${this.baseUrl}/action/track`, qs.stringify(form), {
      headers: {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': this.baseUrl,
        'Referer': `${this.baseUrl}/en3`,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': sessionCookie
      }
    });

    if (response.data.error) {
      throw new Error(response.data.message || 'Failed getting download links.');
    }

    const $ = cheerio.load(response.data.data);
    const links = { mp3: null, cover: null };

    $('a').each((i, elem) => {
      const href = $(elem).attr('href');
      const text = $(elem).text().trim().replace(/\s+/g, ' ');
      if (!href) return;

      if (text.toLowerCase().includes('download mp3')) {
        links.mp3 = href;
      } else if (text.toLowerCase().includes('download cover')) {
        links.cover = href;
      }
    });

    return links;
  }
}

/**
 * Fungsi ringkas: cari lagu/resolve link Spotify lalu langsung ambil link
 * download untuk track pertama yang ditemukan.
 */
async function downloadTrack(queryOrUrl) {
  const scraper = new SpotidownScraper();
  const { tracks, sessionCookie } = await scraper.search(queryOrUrl);
  if (!tracks.length) return { success: false, error: 'Track tidak ditemukan.' };
  const track = tracks[0];
  const links = await scraper.getDownloadLinks(track.form, sessionCookie);
  return {
    success: true,
    metadata: track.metadata,
    links,
  };
}

async function searchTracks(query) {
  const scraper = new SpotidownScraper();
  const { tracks, sessionCookie } = await scraper.search(query);
  return {
    success: true,
    sessionCookie,
    items: tracks.map(t => ({
      name: t.metadata.name,
      artist: t.metadata.artist,
      album: t.metadata.album,
      cover: t.metadata.cover,
      duration: t.metadata.duration,
      spotifyUrl: t.metadata.tid ? `https://open.spotify.com/track/${t.metadata.tid}` : null,
      form: t.form,
    })),
  };
}

async function getLinks(form, sessionCookie) {
  const scraper = new SpotidownScraper();
  const links = await scraper.getDownloadLinks(form, sessionCookie);
  return { success: true, links };
}

export { SpotidownScraper, downloadTrack, searchTracks, getLinks };
