/*
 * Movies Scrape
 *
 * Author: Ryusei Hoshino (https://github.com/dev-ryusei-hoshino)
 * Base: https://zaammoviesnr.netlify.app
 * Source: https://whatsapp.com/channel/0029VbDnVYyK0IBjO8RGfq3N
 *
 * Note: Jangan di hapus we em nya, hargai dev-scraper kecil! >:(
 *
 * Field names dinormalisasi (title/poster/rating/type/year/slug/synopsis/
 * genre/duration) supaya konsisten dipakai di UI, mengikuti pola dari
 * Skrep_movie.js. Link detail juga diseragamkan ke format "/film/<slug>"
 * (sebelumnya list() memakai "/movie/<slug>" sementara get() hanya
 * menerima prefix "/film/", yang membuat detail dari hasil list() gagal
 * dibuka -- ini kemungkinan penyebab menu Movies terasa "tidak jalan").
 */

const BASE = "https://zaammoviesnr.netlify.app";
const API = `${BASE}/.netlify/functions/zaam-movies`;

function pick(raw, ...keys) {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") return raw[k];
  }
  return undefined;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slug = pick(raw, "slug", "id") || null;
  return {
    title: pick(raw, "title", "judul", "name", "nama") || "Tanpa Judul",
    poster: pick(raw, "poster", "image", "thumbnail", "img", "cover") || null,
    rating: pick(raw, "rating", "score", "vote_average", "nilai") || null,
    type: pick(raw, "type", "tipe", "category") || "movie",
    year: pick(raw, "year", "tahun", "release_date", "date") || null,
    slug,
    url: slug ? `${BASE}/film/${slug}` : null,
    synopsis: pick(raw, "synopsis", "sinopsis", "description", "deskripsi", "overview") || null,
    genre: pick(raw, "genre", "genres", "kategori") || null,
    duration: pick(raw, "duration", "durasi", "runtime") || null,
  };
}

function extractSlug(urlOrSlug) {
  if (!urlOrSlug) return "";
  const s = String(urlOrSlug).trim();
  const m = s.match(/\/(?:film|movie)\/([^/?#]+)/);
  if (m) return m[1];
  return s.replace(/^https?:\/\/[^/]+\/?/, "").replace(/\/$/, "");
}

async function list(action) {
  if (!action)
    return {
      success: false,
      error: "action needed",
      action_lists: ["latest", "top-rated", "upcoming", "popular"],
    };
  const res = await fetch(`${API}?action=${action}`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });

  const data = await res.json();
  const results = (data.results || []).map(normalizeItem).filter(Boolean);

  return { success: true, result: results };
}

async function get(urlOrSlug) {
  const slug = extractSlug(urlOrSlug);
  if (!slug) return { success: false, error: "no url/slug detected" };

  const res = await fetch(`${API}?action=detail&slug=${encodeURIComponent(slug)}`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });

  const data = await res.json();
  const raw = data?.results || data?.data?.results || null;
  if (!raw) return { success: true, results: null };

  const normalized = normalizeItem(raw);
  return {
    success: true,
    results: {
      ...normalized,
      // sertakan juga field mentah lain (mis. daftar link streaming/download)
      // yang mungkin tidak tercakup oleh normalizeItem, tanpa menimpa field baku di atas.
      ...Object.fromEntries(Object.entries(raw).filter(([k]) => !(k in normalized))),
    },
  };
}

async function search(query) {
  if (!query) return { success: false, error: "a query needed" };

  const res = await fetch(`${API}?action=search&q=${encodeURIComponent(query)}`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });

  const data = await res.json();
  const results = (data.results || []).map(normalizeItem).filter(Boolean);

  return { success: true, result: results };
}

export { list, get, search };
