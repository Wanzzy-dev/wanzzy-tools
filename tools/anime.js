/*
 * Anime scrape ( wok udah wok aku tak nak anime lagi :( ))
 *
 * Author: Ryusei Hoshino (https://github.com/dev-ryusei-hoshino)
 * Base: https://oploverz.site/
 * Source: https://whatsapp.com/channel/0029VbDnVYyK0IBjO8RGfq3N
 *
 * Note: Jangan di hapus we em nya, hargai dev-scraper kecil! >:(
 */

import * as cheerio from "cheerio";

const BASE_URL = "https://oploverz.site/";
const API_BASE_URL = "https://backapi.oploverz.ac";
const USER_AGENT = "Mozilla/5.0 (compatible; OploverzScraper/1.0)";

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function metaContent($, selector) {
  return cleanText($(selector).first().attr("content")) || null;
}

function canonicalUrl($, baseUrl) {
  const links = $("link[rel='canonical']").toArray();
  const href = links.length ? $(links.at(-1)).attr("href") : null;
  return resolveUrl(href, baseUrl) ?? baseUrl;
}

async function fetchPage(url) {
  const target = new URL(url, BASE_URL).href;
  const response = await fetch(target, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${target}: ${response.status} ${response.statusText}`,
    );
  }

  return {
    html: await response.text(),
    url: response.url || target,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}`);
  }
}

function findHeading($, text) {
  return $("h1, h2, h3, p")
    .filter((_, element) => cleanText($(element).text()) === text)
    .first();
}

function carouselRoots($) {
  return $("[data-embla-container]").toArray();
}

function rootAfterHeading($, roots, headingText) {
  const heading = findHeading($, headingText).get(0);
  if (!heading) return roots[0] ?? null;

  const allElements = $("*").toArray();
  const headingIndex = allElements.indexOf(heading);
  return roots.find((root) => allElements.indexOf(root) > headingIndex) ?? null;
}

function rootContainingHeading($, roots, headingText) {
  return (
    roots.find((root) =>
      $(root)
        .find("h1, h2, h3, p")
        .toArray()
        .some((element) => cleanText($(element).text()) === headingText),
    ) ?? null
  );
}

function parseFeaturedSlide($, slide, baseUrl) {
  const title = cleanText($(slide).find("h1").first().text()) || null;
  const image = resolveUrl($(slide).find("img").first().attr("src"), baseUrl);
  const description =
    $(slide)
      .find("p")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .find(
        (text) =>
          text &&
          text !== "Tonton Anime Terbaru" &&
          text !== title &&
          text.length > 20,
      ) ?? null;

  const links = $(slide)
    .find("a[href]")
    .toArray()
    .map((element) => resolveUrl($(element).attr("href"), baseUrl));

  return {
    title,
    description,
    image,
    url:
      links.find(
        (link) => link && new URL(link).pathname.startsWith("/series/"),
      ) ?? null,
    watchUrl:
      links.find(
        (link) => link && /\/episode\/\d+\/?$/i.test(new URL(link).pathname),
      ) ?? null,
  };
}

function parseCardSlide($, slide, baseUrl) {
  const imageElement = $(slide).find("img").first();
  const image = resolveUrl(imageElement.attr("src"), baseUrl);
  const title = cleanText(imageElement.attr("alt")) || null;
  const links = $(slide)
    .find("a[href]")
    .toArray()
    .map((element) => resolveUrl($(element).attr("href"), baseUrl));
  const url =
    links.find((link) => {
      const pathname = new URL(link).pathname;
      return pathname.startsWith("/series/") || pathname.startsWith("/movie/");
    }) ?? null;

  return {
    title,
    image,
    url,
    type:
      url && new URL(url).pathname.startsWith("/movie/") ? "movie" : "series",
  };
}

function parseLatestEpisodeCard($, card, baseUrl) {
  const linkElement = $(card)
    .find("a[href]")
    .toArray()
    .find((element) =>
      /\/episode\/\d+\/?$/i.test(resolveUrl($(element).attr("href"), baseUrl)),
    );
  const url = resolveUrl(
    linkElement ? $(linkElement).attr("href") : null,
    baseUrl,
  );
  const image = resolveUrl($(card).find("img").first().attr("src"), baseUrl);
  const paragraphs = $(card)
    .find("p")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const episode =
    paragraphs.find((text) => /^Episode\s+\d+$/i.test(text)) ?? null;
  const age =
    paragraphs.find((text) => /^\d+\s*(?:s|m|h|d)$/i.test(text)) ?? null;
  const title =
    paragraphs.find((text) => text !== episode && text !== age) ?? null;

  return {
    title,
    episode,
    age,
    image,
    url,
  };
}

function parseHomepageHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const roots = carouselRoots($);
  const featuredRoot = rootContainingHeading($, roots, "Tonton Anime Terbaru");
  const trendingRoot = rootAfterHeading($, roots, "Sedang Trending");
  const newlyAddedRoot = rootAfterHeading(
    $,
    roots,
    "Tayangan Baru Ditambahkan",
  );
  const latestHeading = findHeading($, "Rilis Terbaru");
  const latestGrid = latestHeading.length
    ? latestHeading
        .parent()
        .find(".grid")
        .filter((_, element) => $(element).find(".bg-card").length > 0)
        .first()
    : $();
  const featured = (
    featuredRoot ? $(featuredRoot).find("[data-embla-slide]").toArray() : []
  ).map((slide) => parseFeaturedSlide($, slide, sourceUrl));
  const trending = (
    trendingRoot ? $(trendingRoot).find("[data-embla-slide]").toArray() : []
  ).map((slide) => parseCardSlide($, slide, sourceUrl));
  const latestEpisodes = latestGrid.length
    ? latestGrid
        .find(".bg-card")
        .toArray()
        .map((card) => parseLatestEpisodeCard($, card, sourceUrl))
    : [];
  const newlyAdded = (
    newlyAddedRoot ? $(newlyAddedRoot).find("[data-embla-slide]").toArray() : []
  ).map((slide) => parseCardSlide($, slide, sourceUrl));

  return {
    page: "homepage",
    url: sourceUrl,
    title: cleanText($("title").first().text()) || null,
    canonicalUrl: canonicalUrl($, sourceUrl),
    featured,
    trending,
    latestEpisodes,
    newlyAdded,
    links: {
      featured: unique(featured.map((item) => item.url)),
      trending: unique(trending.map((item) => item.url)),
      latestEpisodes: unique(latestEpisodes.map((item) => item.url)),
      newlyAdded: unique(newlyAdded.map((item) => item.url)),
    },
  };
}

function parseMetadataList($) {
  const metadataElement = $("li")
    .filter((_, element) => /^Type:/i.test(cleanText($(element).text())))
    .first()
    .parent();
  const metadata = {};

  metadataElement.find("li").each((_, element) => {
    const text = cleanText($(element).text());
    const separator = text.indexOf(":");
    if (separator === -1) return;
    metadata[
      cleanText(text.slice(0, separator)).toLowerCase().replace(/\s+/g, "_")
    ] = cleanText(text.slice(separator + 1));
  });

  return metadata;
}

function parseEpisodeLink($, element, baseUrl) {
  const url = resolveUrl($(element).attr("href"), baseUrl);
  const text = cleanText($(element).text());
  const dateMatch = text.match(
    /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/i,
  );
  const date = dateMatch?.[1] ?? null;
  const title = date ? cleanText(text.replace(dateMatch[0], "")) : text;
  const number = title.match(/(?:Episode|Movie)\s*(\d+)/i)?.[1] ?? null;
  const pathname = url ? new URL(url).pathname : "";
  const id = pathname.split("/").filter(Boolean).at(-1) ?? null;

  return {
    id: id && /^\d+$/.test(id) ? id : null,
    title,
    episodeNumber: number,
    date,
    url,
  };
}

function parseMovieDetailHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const titleElement = $("p.text-2xl").first();
  const ogTitle = metaContent($, "meta[property='og:title']");
  const title =
    cleanText(titleElement.text()) ||
    ogTitle?.replace(/\s*\|\s*Oploverz$/i, "") ||
    null;
  const japaneseTitle = titleElement.length
    ? cleanText(titleElement.nextAll("p").first().text()) || null
    : null;
  const description = titleElement.length
    ? cleanText(titleElement.nextAll("p").eq(1).text()) ||
      metaContent($, "meta[name='description']")
    : metaContent($, "meta[name='description']");
  const metadata = parseMetadataList($);
  const genres = cleanText(metadata.genre)
    .split(",")
    .map((genre) => cleanText(genre))
    .filter(Boolean);
  const scoreValue = metadata.score?.match(/\d+(?:\.\d+)?/)?.[0];
  const episodeElements = $("a[href]")
    .toArray()
    .filter((element) => {
      const url = resolveUrl($(element).attr("href"), sourceUrl);
      const text = cleanText($(element).text());
      return (
        /\/movie\/[^/]+\/\d+\/?$/i.test(url) &&
        text &&
        !/^Watch Now$/i.test(text)
      );
    });
  const episodes = unique(
    episodeElements.map((element) =>
      resolveUrl($(element).attr("href"), sourceUrl),
    ),
  )
    .map((url) => {
      const element = episodeElements.find(
        (candidate) => resolveUrl($(candidate).attr("href"), sourceUrl) === url,
      );
      return element ? parseEpisodeLink($, element, sourceUrl) : null;
    })
    .filter(Boolean);
  const poster = resolveUrl(
    $("img[src*='/posters/']").first().attr("src"),
    sourceUrl,
  );
  const watchUrl = episodes[0]?.url ?? null;

  return {
    page: "movie-detail",
    url: sourceUrl,
    title,
    japaneseTitle,
    description,
    poster,
    type: metadata.type ?? null,
    studio: metadata.studio ?? null,
    releaseDate: metadata.released_date ?? null,
    status: metadata.status ?? null,
    genres,
    score: scoreValue ? Number(scoreValue) : null,
    duration: metadata.duration ?? null,
    episodes,
    watchUrl,
    canonicalUrl: canonicalUrl($, sourceUrl),
    links: {
      detail: sourceUrl,
      episodes: episodes.map((episode) => episode.url).filter(Boolean),
    },
  };
}

function extractEmbeddedStreamSources(html, baseUrl) {
  const sources = [];

  for (const match of html.matchAll(/streamUrl:\s*\[(.*?)\]/gs)) {
    for (const objectMatch of match[1].matchAll(/\{[^{}]*\}/gs)) {
      const body = objectMatch[0];
      const source = body.match(/source:\s*"([^"]+)"/)?.[1] ?? null;
      const url = body.match(/url:\s*"([^"]+)"/)?.[1] ?? null;
      if (source && url) {
        sources.push({ source, url: resolveUrl(url, baseUrl) });
      }
    }
  }

  return unique(sources.map((item) => JSON.stringify(item))).map((value) =>
    JSON.parse(value),
  );
}

function extractFiledonMediaUrl(html) {
  const $ = cheerio.load(html);
  const dataPage = $("#app[data-page]").first().attr("data-page");
  if (!dataPage) return null;

  try {
    const payload = JSON.parse(dataPage);
    return payload?.props?.media?.hls_url || payload?.props?.url || null;
  } catch {
    return null;
  }
}

function streamType(url) {
  if (!url) return null;
  if (/\.m3u8(?:\?|$)/i.test(url)) return "hls";
  if (/\.mp4(?:\?|$)/i.test(url)) return "mp4";
  if (/\.mkv(?:\?|$)/i.test(url)) return "mkv";
  return "stream";
}

async function resolveStreamSource(source) {
  const fallbackType = streamType(source.url);
  if (fallbackType !== "stream") {
    return { source: source.source, url: source.url, type: fallbackType };
  }

  try {
    const response = await fetch(source.url, {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return { source: source.source, url: source.url, type: fallbackType };
    }

    const html = await response.text();
    const directUrl = extractFiledonMediaUrl(html);
    if (directUrl) {
      return {
        source: source.source,
        url: directUrl,
        embedUrl: source.url,
        type: streamType(directUrl),
      };
    }

    const finalUrl = response.url || source.url;
    if (finalUrl !== source.url && streamType(finalUrl) !== "stream") {
      return {
        source: source.source,
        url: finalUrl,
        embedUrl: source.url,
        type: streamType(finalUrl),
      };
    }

    return { source: source.source, url: source.url, type: fallbackType };
  } catch {
    return { source: source.source, url: source.url, type: fallbackType };
  }
}

async function resolveStreamSources(sources) {
  return Promise.all(sources.map(resolveStreamSource));
}

async function parseWatchHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const ogTitle = metaContent($, "meta[property='og:title']");
  const title =
    cleanText(
      $("div[role='heading']")
        .filter((_, element) =>
          /Episode\s+\d+/i.test(cleanText($(element).text())),
        )
        .first()
        .text(),
    ) ||
    ogTitle?.replace(/\s*\|\s*Oploverz$/i, "") ||
    null;
  const seriesElement = $("a[href]")
    .toArray()
    .find((element) =>
      /\/movie\/[^/]+\/?$/i.test(
        resolveUrl($(element).attr("href"), sourceUrl),
      ),
    );
  const seriesTitle = seriesElement
    ? cleanText($(seriesElement).text()) || null
    : null;
  const seriesUrl = resolveUrl(
    seriesElement ? $(seriesElement).attr("href") : null,
    sourceUrl,
  );
  const seriesSlug = seriesUrl
    ? (new URL(seriesUrl).pathname.split("/").filter(Boolean)[1] ?? null)
    : null;
  const episodeLinkElement = $("a[href]")
    .toArray()
    .find((element) =>
      /\/movie\/[^/]+\/\d+\/?$/i.test(
        resolveUrl($(element).attr("href"), sourceUrl),
      ),
    );
  const episodeNumber =
    title?.match(/Episode\s*(\d+)/i)?.[1] ??
    (episodeLinkElement
      ? new URL(
          resolveUrl($(episodeLinkElement).attr("href"), sourceUrl),
        ).pathname
          .split("/")
          .filter(Boolean)
          .at(-1)
      : null);
  const pageText = cleanText($("body").text());
  const currentPath = new URL(sourceUrl).pathname.replace(/\/$/, "");
  const embeddedStreamSources = extractEmbeddedStreamSources(html, sourceUrl);
  const streamSources = await resolveStreamSources(embeddedStreamSources);
  const videoAvailable =
    (!/No video available/i.test(pageText) &&
      $("img[src*='placehold.co']").length === 0) ||
    streamSources.some(
      (source) => source.type === "mp4" || source.type === "hls",
    );
  const episodeList = $("a[href]")
    .toArray()
    .filter((element) => {
      const url = resolveUrl($(element).attr("href"), sourceUrl);
      return url && new URL(url).pathname.replace(/\/$/, "") === currentPath;
    })
    .map((element) => cleanText($(element).text()))
    .filter((text) => /^\d+$/.test(text));
  const downloadOptions = [];

  $("a[href]").each((_, element) => {
    const host = cleanText($(element).text());
    const url = resolveUrl($(element).attr("href"), sourceUrl);
    if (!url || !/^[A-Z][A-Z0-9+.-]*$/.test(host)) return;

    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      return;
    }

    if (
      !hostname ||
      hostname.includes("oploverz") ||
      hostname.includes("facebook") ||
      hostname.includes("instagram")
    )
      return;

    const item = $(element).closest("[data-accordion-item]");
    const format = item.length
      ? cleanText(item.find("button").first().text()) || null
      : null;
    const quality = item.length
      ? (item
          .find("p")
          .toArray()
          .map((paragraph) => cleanText($(paragraph).text()))
          .find((text) => /(?:\d+p|^HD$)/i.test(text)) ?? null)
      : null;

    downloadOptions.push({ format, quality, host });
  });

  const result = {
    page: "watch",
    url: sourceUrl,
    title,
    series: {
      title: seriesTitle,
      slug: seriesSlug,
    },
    episode: {
      number: episodeNumber ?? unique(episodeList)[0] ?? null,
      title: title?.replace(/Episode\s*\d+/i, "").trim() || null,
    },
    videoAvailable,
    playerLabels: $("button")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter((text) => text && /^(?:HD|\d+p)$/i.test(text)),
    episodeList: unique(episodeList).map((number) => ({ number })),
    downloadOptions: unique(
      downloadOptions.map((option) => JSON.stringify(option)),
    ).map((value) => JSON.parse(value)),
    streamSources,
    canonicalUrl: canonicalUrl($, sourceUrl),
  };

  if (!videoAvailable) {
    result.message = "No video available";
  }

  return result;
}

function parseSearchPayload(payload, query, requestUrl) {
  const data = Array.isArray(payload?.data)
    ? payload.data.map((series) => {
        const type =
          cleanText(series?.releaseType).toLowerCase() === "movie"
            ? "movie"
            : "series";
        const url = series?.slug
          ? resolveUrl(`/${type}/${series.slug}`, BASE_URL)
          : null;
        return { ...series, url };
      })
    : [];

  return {
    page: "search",
    query: cleanText(query),
    url: requestUrl,
    meta: payload?.meta ?? null,
    data,
    links: data.map((series) => series.url).filter(Boolean),
  };
}

export async function scrapeHome() {
  const page = await fetchPage(BASE_URL);
  return parseHomepageHtml(page.html, page.url);
}

export async function scrapeMovieDetail(url) {
  const page = await fetchPage(url);
  return parseMovieDetailHtml(page.html, page.url);
}

export async function scrapeWatch(url) {
  const page = await fetchPage(url);
  return parseWatchHtml(page.html, page.url);
}

export async function scrapeSearch(query) {
  if (cleanText(query) === "") {
    throw new Error("Search query is required");
  }

  const searchUrl = new URL("/api/series", API_BASE_URL);
  searchUrl.searchParams.set("q", query);
  const payload = await fetchJson(searchUrl.href);
  return parseSearchPayload(payload, query, searchUrl.href);
}

export default {
  scrapeHome,
  scrapeMovieDetail,
  scrapeWatch,
  scrapeSearch,
};
