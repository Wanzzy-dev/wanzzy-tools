import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { chat } from './tools/rewind.js';
import * as otaku from './tools/otakudesu.js';
import * as movies from './tools/movies.js';
import { homePage, searchMovie, detailMovie } from './tools/hdhub4u.js';
import { uploadFile } from './tools/catbox.js';
import { generate as generateIQC } from './tools/iqc.js';
import * as komik from './tools/komik.js';
import { main as tiktok } from './tools/tiktok.js';
import * as anime from './tools/anime.js';

const app = express();
const upload = multer({ dest: path.join(os.tmpdir(), 'wanzzy-tools') });
const PORT = Number(process.env.PORT || 3000);
const USER = process.env.WANZZY_USER || 'wanzzy';
const PASS = process.env.WANZZY_PASS || 'wanzzy41';
const sessions = new Map();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.cookies?.session;
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== USER || password !== PASS) {
    return res.status(401).json({ success: false, error: 'Username atau password salah.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now(), username });
  res.json({ success: true, token, username });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) sessions.delete(token);
  res.json({ success: true });
});

app.get('/api/me', auth, (req, res) => res.json({ success: true, username: 'wanzzy' }));

app.post('/api/rewind', auth, async (req, res) => {
  try { res.json(await chat(req.body?.prompt || '')); }
  catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/otaku', auth, async (req, res) => {
  try {
    const { action, query, url, page, genre } = req.body || {};
    let result;
    if (action === 'home') result = await otaku.home();
    else if (action === 'search') result = await otaku.search(query || '');
    else if (action === 'info') result = await otaku.info(url);
    else if (action === 'genreList') result = await otaku.genreList();
    else if (action === 'genre') result = await otaku.genre(genre || '', Number(page) || 1);
    else if (action === 'watch') result = await otaku.watch(url);
    else if (action === 'upcoming') result = await otaku.upcoming();
    else throw new Error('Action OtakuDesu tidak dikenal.');
    res.json(result);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/movies', auth, async (req, res) => {
  try {
    const { action, query, url } = req.body || {};
    let result;
    if (action === 'list') result = await movies.list(req.body.listType || 'popular');
    else if (action === 'search') result = await movies.search(query || '');
    else if (action === 'get') result = await movies.get(url);
    else throw new Error('Action Movies tidak dikenal.');
    res.json(result);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/hdhub4u', auth, async (req, res) => {
  try {
    const { action, query, url, page } = req.body || {};
    let result;
    if (action === 'home') result = await homePage(Number(page) || 1);
    else if (action === 'search') result = await searchMovie(query || '', Number(page) || 1);
    else if (action === 'detail') result = await detailMovie(url);
    else throw new Error('Action HDHub4u tidak dikenal.');
    res.json(result);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/komik', auth, async (req, res) => {
  try {
    const { action, query, period } = req.body || {};
    let result;
    if (action === 'home') result = await komik.scrapeHome();
    else if (action === 'top') result = await komik.scrapeTop(period || 'weekly');
    else if (action === 'manhwa') result = await komik.scrapeManhwa();
    else if (action === 'list') result = await komik.scrapeMangaList();
    else if (action === 'search') result = await komik.scrapeSearch(query || '');
    else throw new Error('Action Komik tidak dikenal.');
    res.json(result);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/anime', auth, async (req, res) => {
  try {
    const { action, query, url } = req.body || {};
    let result;
    if (action === 'home') result = await anime.scrapeHome();
    else if (action === 'search') result = await anime.scrapeSearch(query || '');
    else if (action === 'detail') result = await anime.scrapeMovieDetail(url);
    else if (action === 'watch') result = await anime.scrapeWatch(url);
    else throw new Error('Action Anime tidak dikenal.');
    res.json(result);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/tiktok', auth, async (req, res) => {
  try { res.json(await tiktok(req.body?.url || '')); }
  catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/catbox', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Pilih file terlebih dahulu.');
    const result = await uploadFile(req.file.path, req.file.originalname);
    await fs.unlink(req.file.path).catch(() => {});
    res.json(result);
  } catch (e) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ success:false, error:e.message });
  }
});

app.post('/api/iqc', auth, async (req, res) => {
  try {
    const result = await generateIQC(req.body || {});
    res.setHeader('Content-Type', result.contentType || 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="iqc.png"');
    result.buffer.pipe ? result.buffer.pipe(res) : res.end(result.buffer);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')));

app.listen(PORT, () => console.log(`Wanzzy Tools running: http://localhost:${PORT}`));
