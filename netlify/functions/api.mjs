import crypto from 'node:crypto';
import { connectLambda, getStore } from '@netlify/blobs';
import { chat } from '../../tools/rewind.js';
import * as otaku from '../../tools/otakudesu.js';
import * as movies from '../../tools/movies.js';
import { homePage, searchMovie, detailMovie } from '../../tools/hdhub4u.js';
import { uploadFile } from '../../tools/catbox.js';
import { generate as generateIQC } from '../../tools/iqc.js';
import * as komik from '../../tools/komik.js';
import { main as tiktokPrimary } from '../../tools/tiktok.js';
import { getTiktokMedia as tiktokFallback } from '../../tools/snaptik.js';
async function tiktok(url) {
  try {
    const primary = await tiktokPrimary(url);
    if (primary && (primary.data || primary.code === 0)) return primary;
    throw new Error(primary?.msg || 'Provider utama gagal.');
  } catch (e) {
    // Sumber utama (tikwm) gagal/berubah format -> coba SnapTik sebagai cadangan.
    const fb = await tiktokFallback(url);
    if (fb.status !== 'success') throw new Error(fb.message || 'Semua provider TikTok gagal memproses link ini.');
    return { success: true, provider: 'snaptik', ...fb };
  }
}
import * as anime from '../../tools/anime.js';
import { NontonAnimeIDScraper } from '../../tools/nontonanime.js';
const nontonanime = new NontonAnimeIDScraper();
import { sendLink, verifyLink } from '../../tools/alightmotion.js';
import { searchTracks, getLinks } from '../../tools/spotidown.js';
import Busboy from 'busboy';

const USER = process.env.WANZZY_USER || 'wanzzy';
const PASS = process.env.WANZZY_PASS || 'wanzzy41';
const SECRET = process.env.WANZZY_TOKEN_SECRET || PASS;
const TOKEN_TTL = 24 * 60 * 60;
const OWNER = USER.toLowerCase();

// PENTING: getStore() HARUS dipanggil di dalam handler (per-request), bukan
// sekali di top-level module. Di production, konteks Netlify Blobs (site ID/
// token) baru tersedia saat request masuk ke handler; memanggilnya di
// top-level bisa membuat store gagal terhubung dengan benar (lihat
// https://github.com/netlify/blobs/issues/175), yang bikin login selalu
// gagal walau username/password sudah benar.
function userStore() { return getStore('wanzzy-users'); }
function chatStore() { return getStore('wanzzy-global-chat'); }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  const storedHash = record?.hash || record?.passwordHash;
  if (!record?.salt || !storedHash) return false;
  const hash = crypto.scryptSync(String(password), record.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}
function makeOwner() {
  const hp = hashPassword(PASS);
  return { username: USER, hash: hp.hash, salt: hp.salt, role: 'admin', verified: true, createdAt: Date.now(), owner: true };
}

async function readUsers() {
  const data = await userStore().get('users', { type: 'json' });
  let users = (data && Array.isArray(data.users)) ? data.users : null;

  if (!users) {
    // Belum ada data sama sekali -> buat owner dari env var saat ini.
    const owner = makeOwner();
    users = [owner];
    await writeUsers(users);
    return users;
  }

  // Self-heal: pastikan akun owner selalu sinkron dengan WANZZY_USER / WANZZY_PASS
  // yang sedang aktif di Environment Variables. Tanpa ini, mengganti env var
  // setelah deploy pertama tidak akan pernah bisa dipakai untuk login karena
  // hash lama sudah kadung tersimpan permanen di Netlify Blobs.
  const ownerIdx = users.findIndex(u => u.owner);
  const ownerMatches = ownerIdx !== -1
    && users[ownerIdx].username.toLowerCase() === OWNER
    && verifyPassword(PASS, users[ownerIdx]);

  if (!ownerMatches) {
    const freshOwner = makeOwner();
    if (ownerIdx !== -1) users[ownerIdx] = { ...users[ownerIdx], ...freshOwner };
    else users.push(freshOwner);
    await writeUsers(users);
  }

  return users;
}
async function writeUsers(users) { await userStore().setJSON('users', { users }); }
function safeUser(u) { return { username: u.username, role: u.role, verified: !!u.verified, createdAt: u.createdAt, owner: !!u.owner }; }


const json = (body, statusCode = 200) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function createToken(username, role = 'user') {
  const payload = `${username}.${role}.${Math.floor(Date.now() / 1000) + TOKEN_TTL}`;
  return `${b64url(payload)}.${sign(payload)}`;
}

function tokenPayload(token) {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, 'base64url').toString();
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const [username, role, exp] = payload.split('.');
  if (!username || !role || Number(exp) <= Math.floor(Date.now() / 1000)) return null;
  return { username, role, exp: Number(exp) };
}

async function getSession(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const payload = tokenPayload(token);
  if (!payload) return null;
  const users = await readUsers();
  const user = users.find(u => u.username.toLowerCase() === payload.username.toLowerCase());
  if (!user) return null;
  return { user, token: payload };
}

function auth(event) { return getSession(event); }

function parseJson(event) {
  if (!event.body) return {};
  try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); }
  catch { return {}; }
}

async function parseMultipart(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const contentType = headers['content-type'];
  if (!contentType) throw new Error('Content-Type multipart/form-data tidak ditemukan.');
  const bb = Busboy({ headers: { 'content-type': contentType } });
  const chunks = [];
  let filename = 'upload.bin';
  let mimeType = 'application/octet-stream';
  let found = false;

  const done = new Promise((resolve, reject) => {
    bb.on('file', (name, file, info) => {
      if (name !== 'file') { file.resume(); return; }
      found = true;
      filename = info.filename || filename;
      mimeType = info.mimeType || mimeType;
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('error', reject);
    });
    bb.on('error', reject);
    bb.on('finish', resolve);
  });

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
  bb.end(raw);
  await done;
  if (!found) throw new Error('Pilih file terlebih dahulu.');
  return { buffer: Buffer.concat(chunks), filename, mimeType };
}

async function handle(route, event) {
  if (route === 'login' && event.httpMethod === 'POST') {
    const { username, password } = parseJson(event);
    const users = await readUsers();
    const user = users.find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
    if (!user || !verifyPassword(password || '', user)) return json({ success: false, error: 'Username atau password salah.' }, 401);
    return json({ success: true, token: createToken(user.username, user.role), user: safeUser(user) });
  }

  if (route === 'register' && event.httpMethod === 'POST') {
    const { username, password } = parseJson(event);
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) return json({ success:false, error:'Username 3-24 karakter: huruf, angka, underscore.' }, 400);
    if (String(password || '').length < 6) return json({ success:false, error:'Password minimal 6 karakter.' }, 400);
    const users = await readUsers();
    if (users.some(u => u.username.toLowerCase() === name.toLowerCase())) return json({ success:false, error:'Username sudah dipakai.' }, 409);
    const hp = hashPassword(password);
    const user = { username:name, passwordHash:hp.hash, salt:hp.salt, role:'user', verified:false, createdAt:Date.now(), owner:false };
    users.push(user); await writeUsers(users);
    return json({ success:true, token:createToken(name,'user'), user:safeUser(user) });
  }

  if (route === 'logout' && event.httpMethod === 'POST') return json({ success: true });

  if (route === 'me' && event.httpMethod === 'GET') {
    const session = await auth(event);
    if (!session) return json({ success: false, error: 'Unauthorized' }, 401);
    return json({ success: true, user: safeUser(session.user) });
  }

  const session = await auth(event);
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401);

  const body = parseJson(event);

  if (route === 'accounts' && event.httpMethod === 'GET') {
    if (session.user.role !== 'admin') return json({success:false,error:'Admin only.'},403);
    const users = await readUsers();
    return json({success:true, users:users.map(safeUser)});
  }
  if (route === 'accounts' && event.httpMethod === 'POST') {
    if (session.user.role !== 'admin') return json({success:false,error:'Admin only.'},403);
    const name=String(body.username||'').trim(); const password=String(body.password||''); const role=body.role==='admin'?'admin':'user';
    if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) return json({success:false,error:'Username tidak valid.'},400);
    if (password.length<6) return json({success:false,error:'Password minimal 6 karakter.'},400);
    const users=await readUsers(); if(users.some(u=>u.username.toLowerCase()===name.toLowerCase())) return json({success:false,error:'Username sudah dipakai.'},409);
    const hp=hashPassword(password); const user={username:name,passwordHash:hp.hash,salt:hp.salt,role,verified:false,createdAt:Date.now(),owner:false}; users.push(user); await writeUsers(users);
    return json({success:true,user:safeUser(user)});
  }
  if (route === 'verify-user' && event.httpMethod === 'POST') {
    // Centang biru hanya boleh diberikan/dicabut oleh OWNER, bukan admin biasa.
    if (!session.user.owner) return json({success:false,error:'Hanya owner yang bisa memberikan centang biru.'},403);
    const name=String(body.username||'').trim(); const users=await readUsers(); const user=users.find(u=>u.username.toLowerCase()===name.toLowerCase());
    if(!user) return json({success:false,error:'User tidak ditemukan.'},404); if(user.owner) user.verified=true; else user.verified=!!body.verified; await writeUsers(users);
    return json({success:true,user:safeUser(user)});
  }
  if (route === 'global-chat' && event.httpMethod === 'GET') {
    const data=await chatStore().get('messages',{type:'json'}); return json({success:true,messages:Array.isArray(data?.messages)?data.messages:[]});
  }
  if (route === 'global-chat' && event.httpMethod === 'POST') {
    const message=String(body.message||'').trim(); if(!message) return json({success:false,error:'Pesan kosong.'},400); if(message.length>500) return json({success:false,error:'Maksimal 500 karakter.'},400);
    const data=await chatStore().get('messages',{type:'json'}); const messages=Array.isArray(data?.messages)?data.messages:[]; messages.push({id:crypto.randomUUID(),username:session.user.username,verified:!!session.user.verified,role:session.user.role,message,createdAt:Date.now()});
    await chatStore().setJSON('messages',{messages:messages.slice(-300)}); return json({success:true,message:messages[messages.length-1]});
  }

  let result;

  if (route === 'rewind') result = await chat(body.prompt || '');
  else if (route === 'otaku') {
    const { action, query, url, page, genre } = body;
    if (action === 'home') result = await otaku.home();
    else if (action === 'search') result = await otaku.search(query || '');
    else if (action === 'info') result = await otaku.info(url);
    else if (action === 'genreList') result = await otaku.genreList();
    else if (action === 'genre') result = await otaku.genre(genre || '', Number(page) || 1);
    else if (action === 'watch') result = await otaku.watch(url);
    else if (action === 'upcoming') result = await otaku.upcoming();
    else throw new Error('Action OtakuDesu tidak dikenal.');
  } else if (route === 'movies') {
    const { action, query, url } = body;
    if (action === 'list') result = await movies.list(body.listType || 'popular');
    else if (action === 'search') result = await movies.search(query || '');
    else if (action === 'get') result = await movies.get(url);
    else throw new Error('Action Movies tidak dikenal.');
  } else if (route === 'hdhub4u') {
    const { action, query, url, page } = body;
    if (action === 'home') result = await homePage(Number(page) || 1);
    else if (action === 'search') result = await searchMovie(query || '', Number(page) || 1);
    else if (action === 'detail') result = await detailMovie(url);
    else throw new Error('Action HDHub4u tidak dikenal.');
  } else if (route === 'komik') {
    const { action, query, period } = body;
    if (action === 'home') result = await komik.scrapeHome();
    else if (action === 'top') result = await komik.scrapeTop(period || 'weekly');
    else if (action === 'manhwa') result = await komik.scrapeManhwa();
    else if (action === 'list') result = await komik.scrapeMangaList();
    else if (action === 'search') result = await komik.scrapeSearch(query || '');
    else throw new Error('Action Komik tidak dikenal.');
  } else if (route === 'anime') {
    const { action, query, url } = body;
    if (action === 'home') result = await anime.scrapeHome();
    else if (action === 'search') result = await anime.scrapeSearch(query || '');
    else if (action === 'detail') result = await anime.scrapeMovieDetail(url);
    else if (action === 'watch') result = await anime.scrapeWatch(url);
    else throw new Error('Action Anime tidak dikenal.');
  } else if (route === 'nontonanime') {
    const { action, query, url, page } = body;
    let raw;
    if (action === 'home') raw = await nontonanime.getHome();
    else if (action === 'search') raw = { items: await nontonanime.searchAnime(query || '', page || 1) };
    else if (action === 'ongoing') raw = { items: await nontonanime.getOngoingList(page || 1) };
    else if (action === 'popular') raw = { items: await nontonanime.getPopularSeries(page || 1) };
    else if (action === 'detail') raw = await nontonanime.getAnimeDetail(url);
    else if (action === 'watch') raw = await nontonanime.getStreamingDetail(url);
    else if (action === 'server') {
      const { postId, nume, serverName, nonce, ajaxUrl } = body;
      raw = { iframe: await nontonanime.getVideoIframe(postId, nume, serverName, nonce, ajaxUrl) };
    }
    else throw new Error('Action NontonAnime tidak dikenal.');
    result = { success: true, ...raw };
  } else if (route === 'tiktok') {
    result = await tiktok(body.url || '');
  } else if (route === 'catbox' && event.httpMethod === 'POST') {
    const file = await parseMultipart(event);
    result = await uploadFile({ data: file.buffer, filename: file.filename }, file.filename);
  } else if (route === 'iqc') {
    const generated = await generateIQC(body);
    return {
      statusCode: 200,
      headers: {
        'content-type': generated.contentType || 'image/png',
        'content-disposition': 'inline; filename="iqc.png"',
        'cache-control': 'no-store',
      },
      isBase64Encoded: true,
      body: generated.buffer.toString('base64'),
    };
  } else if (route === 'alightmotion') {
    const action = body.action;
    if (action === 'send') {
      if (!String(body.email || '').trim()) throw new Error('Email tidak boleh kosong.');
      result = await sendLink(String(body.email).trim());
    } else if (action === 'verify') {
      if (!String(body.email || '').trim()) throw new Error('Email tidak boleh kosong.');
      if (!String(body.link || '').trim()) throw new Error('Magic link tidak boleh kosong.');
      result = await verifyLink(String(body.email).trim(), String(body.link).trim());
    } else throw new Error('Action AlightMotion tidak dikenal.');
  } else if (route === 'spotify') {
    const action = body.action;
    if (action === 'search') {
      if (!String(body.query || '').trim()) throw new Error('Query/link Spotify tidak boleh kosong.');
      result = await searchTracks(String(body.query).trim());
    } else if (action === 'download') {
      if (!body.form || !body.sessionCookie) throw new Error('Data track tidak lengkap, ulangi pencarian.');
      result = await getLinks(body.form, body.sessionCookie);
    } else throw new Error('Action Spotify tidak dikenal.');
  } else {
    return json({ success: false, error: `Endpoint /api/${route} tidak ditemukan.` }, 404);
  }

  return json(result);
}

export const handler = async (event) => {
  try {
    // WAJIB: di "Lambda compatibility mode" (handler = async (event) => {}),
    // Netlify TIDAK otomatis menyuntikkan konteks Netlify Blobs (siteID/token).
    // connectLambda(event) menginisialisasi konteks itu secara manual dari
    // event Lambda, harus dipanggil sebelum getStore() manapun dipakai.
    // Ref: https://github.com/netlify/blobs#lambda-compatibility-mode
    connectLambda(event);
    const route = String(event.path || '').replace(/^.*\/api\//, '').replace(/^\//, '').split('/')[0];
    return await handle(route, event);
  } catch (error) {
    const msg = error?.message || 'Terjadi kesalahan pada server.';
    // Netlify Blobs kadang gagal terinisialisasi jika site belum ter-link dengan benar
    // (mis. saat pakai `netlify dev` tanpa `netlify link`, atau deploy context tidak standar).
    const hint = /blob|MissingBlobsEnvironmentError|store/i.test(msg)
      ? ' (Kemungkinan Netlify Blobs belum aktif untuk site ini — pastikan deploy lewat Netlify langsung/CI, bukan preview lokal tanpa `netlify link`.)'
      : '';
    return json({ success: false, error: msg + hint }, 500);
  }
};
