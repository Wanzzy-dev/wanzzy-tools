/*
 * SnapTik downloader (fallback provider untuk TikTok)
 *
 * CATATAN KEAMANAN: versi asli file ini memakai `execSync` untuk
 * menjalankan `curl` lewat shell, dengan URL milik pengguna ditempel
 * langsung ke dalam string command. Itu celah command injection --
 * pengguna bisa menyisipkan karakter shell (", `, ;, dst) di URL dan
 * menjalankan perintah sembarang di server. Versi ini ditulis ulang
 * memakai fetch() bawaan Node, tanpa shell exec sama sekali, sekaligus
 * membuatnya bisa jalan di Netlify Functions (tidak ada `curl`/shell
 * yang bisa diandalkan di lingkungan serverless).
 */

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-f0-9]+);/gi, (match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractDirectUrl(href) {
  try {
    const urlObj = new URL(href);
    const token = urlObj.searchParams.get('token');
    if (token) {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
        const decoded = JSON.parse(payload);
        if (decoded && decoded.url) return decoded.url;
      }
    }
  } catch (e) {
    // Fallback ke url asli
  }
  return href;
}

async function resolveTiktokUrl(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
    return res.url || url;
  } catch (e) {
    console.error(`[Engine] Error resolving URL: ${e.message}`);
    return url;
  }
}

async function fetchFromSnaptik(url, resolvedUrl) {
  const searchApi = 'https://snaptik.net/api/ajaxSearch';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Origin': 'https://snaptik.net',
    'Referer': 'https://snaptik.net/en',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };

  try {
    const res = await fetch(searchApi, {
      method: 'POST',
      headers,
      body: `q=${encodeURIComponent(url)}&lang=en`,
    });
    const resJson = await res.json();

    if (resJson.status !== 'ok') {
      return { status: 'fail', message: resJson.msg || 'Unknown Snaptik API error.' };
    }

    if (resJson.statusCode === 326 || (resJson.msg && resJson.msg.includes('snaptikpro.net'))) {
      return {
        status: 'fail',
        message: 'SnapTik.net does not support profile downloads directly. Please enter a TikTok video or slideshow URL.',
      };
    }
    if (resJson.msg) return { status: 'fail', message: resJson.msg };

    const htmlContent = resJson.data || '';

    const titleMatch = htmlContent.match(/<h3>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : 'TikTok Video';

    const coverMatch = htmlContent.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const cover = coverMatch ? coverMatch[1] : '';

    const authorMatch = resolvedUrl.match(/@([a-zA-Z0-9_.]+)/);
    const author = authorMatch ? authorMatch[1] : 'tiktok_user';

    const isSlideshow = resolvedUrl.toLowerCase().includes('/photo/');
    const type = isSlideshow ? 'slideshow' : 'video';

    const hashtags = title.match(/#[a-zA-Z0-9_\u4e00-\u9fa5]+/g) || [];

    const links = [];
    const aRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = aRegex.exec(htmlContent)) !== null) {
      let href = match[1];
      const rawText = match[2];
      const text = rawText.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

      if (href.startsWith('/')) href = 'https://snaptik.net' + href;

      const isDownloadBtn = href.includes('snapcdn.app') || href.includes('tik-cdn.com') || href.includes('snaptik.net/api/');
      if (!isDownloadBtn) continue;

      let linkType = 'video';
      const linkUrl = extractDirectUrl(href);
      if (text.toLowerCase().includes('mp3') || text.toLowerCase().includes('audio')) linkType = 'audio';
      else if (isSlideshow) linkType = 'slideshow';

      links.push({ type: linkType, label: text || 'Download Link', url: linkUrl });
    }

    if (!links.length) return { status: 'fail', message: 'No download links found in Snaptik response.' };

    return { status: 'success', provider: 'snaptik', type, title, cover, author, hashtags, links };
  } catch (e) {
    return { status: 'fail', message: `Error querying Snaptik: ${e.message}` };
  }
}

async function getTiktokMedia(inputUrl) {
  let url = String(inputUrl || '').trim();
  if (!url) return { status: 'fail', message: 'Input cannot be empty.' };

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const usernameRegex = /^@?[a-zA-Z0-9_.]+$/;
    if (usernameRegex.test(url)) {
      url = `https://www.tiktok.com/@${url.replace(/^@/, '')}`;
    } else {
      return { status: 'fail', message: 'Invalid URL or TikTok username format.' };
    }
  }

  const resolvedUrl = await resolveTiktokUrl(url);
  return await fetchFromSnaptik(resolvedUrl, resolvedUrl);
}

export { resolveTiktokUrl, fetchFromSnaptik, getTiktokMedia };
