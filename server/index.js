import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  mongoConfigured,
  connectMongo,
  getDaily,
  saveDaily,
  getProjectsState,
  saveProjectsState,
  getNotificationsState,
  createNotification,
  markNotificationRead,
  uploadFile,
  downloadFile,
  loginWithPassword,
  getSessionUser,
  destroySession,
  listUsersPublic,
  createUser,
  canCreateEmployee,
  publicUser,
  assignPhoneToUser,
  changeUserPhone,
  isAdminAccount,
} from './mongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'store-web');
const SESSION_COOKIE = 'store_auth';
const SESSION_DAYS = 30;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const i = s.indexOf('=');
    if (i < 1) return;
    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  });
}
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(__dirname, '.env'));

const port = Number(process.env.PORT || 8080);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024 },
});

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '8mb' }));

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  });
  return out;
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const q = req.query?.access_token || req.query?.token;
  if (q) return String(q);
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  return '';
}

function setAuthCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: mongoConfigured(),
    mongoConfigured: mongoConfigured(),
    driveConfigured: mongoConfigured(),
    storage: mongoConfigured() ? 'mongodb' : null,
    db: process.env.MONGODB_DB || 'store_employee',
    auth: true,
  });
});

function requireDb(_req, res, next) {
  if (!mongoConfigured()) {
    return res.status(503).json({
      error: 'MongoDB not configured. Set MONGODB_URI (and optional MONGODB_DB).',
    });
  }
  next();
}

async function requireAuth(req, res, next) {
  if (!mongoConfigured()) {
    return res.status(503).json({
      error: 'MongoDB not configured. Set MONGODB_URI (and optional MONGODB_DB).',
    });
  }
  try {
    const token = extractToken(req);
    const user = await getSessionUser(token);
    if (!user) {
      return res.status(401).json({ error: '未登入或工作階段已過期，請重新登入。' });
    }
    req.authToken = token;
    req.user = user;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
}

app.post('/api/auth/login', requireDb, async (req, res) => {
  try {
    const login = String(req.body?.login || req.body?.user || '').trim();
    const pw = String(req.body?.pw || req.body?.password || '');
    if (!login || !pw) return res.status(400).json({ error: '請輸入電話號碼（或舊賬號）及密碼。' });
    const result = await loginWithPassword(login, pw);
    setAuthCookie(res, result.token);
    res.json({
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      needsPhoneBind: !!result.needsPhoneBind,
    });
  } catch (e) {
    res.status(401).json({ error: String(e.message || e) });
  }
});

app.post('/api/auth/logout', requireDb, async (req, res) => {
  try {
    const token = extractToken(req);
    await destroySession(token);
    clearAuthCookie(res);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.user), needsPhoneBind: !!publicUser(req.user)?.needsPhoneBind });
});

/** 舊帳首次登入後自行綁定電話 */
app.post('/api/auth/bind-phone', requireAuth, async (req, res) => {
  try {
    const phone = req.body?.phone;
    const updated = await assignPhoneToUser(req.user.id || req.user._id, phone, {
      allowSelf: true,
      actorUserId: String(req.user.id || req.user._id),
    });
    // session 已在 rewrite 時改 userId
    res.json({ user: updated, needsPhoneBind: false });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/users', requireAuth, async (_req, res) => {
  try {
    res.json({ users: await listUsersPublic() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/users', requireAuth, async (req, res) => {
  try {
    if (!canCreateEmployee(req.user)) {
      return res.status(403).json({ error: '沒有權限創建員工。' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const created = await createUser(req.body);
    res.json({ user: created });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** 管理員為舊帳補登電話 */
app.post('/api/users/:id/assign-phone', requireAuth, async (req, res) => {
  try {
    if (!canCreateEmployee(req.user)) {
      return res.status(403).json({ error: '沒有權限補登電話。' });
    }
    const updated = await assignPhoneToUser(req.params.id, req.body?.phone, { actorIsAdmin: true });
    res.json({ user: updated });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** 管理員更換已綁定電話 */
app.post('/api/users/:id/change-phone', requireAuth, async (req, res) => {
  try {
    if (!canCreateEmployee(req.user)) {
      return res.status(403).json({ error: '沒有權限更換電話。' });
    }
    if (isAdminAccount({ login: req.params.id, id: req.params.id })) {
      return res.status(400).json({ error: '系統帳不可更換電話。' });
    }
    const updated = await changeUserPhone(req.params.id, req.body?.phone || req.body?.newPhone);
    res.json({ user: updated });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/daily', requireAuth, async (_req, res) => {
  try {
    res.json(await getDaily());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/daily', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    await saveDaily(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/projects', requireAuth, async (_req, res) => {
  try {
    res.json(await getProjectsState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/projects', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    await saveProjectsState(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/notifications', requireAuth, async (_req, res) => {
  try {
    res.json(await getNotificationsState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/notifications', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const item = await createNotification(req.body);
    res.json(item);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = String(req.body?.userId || req.user?.id || req.user?._id || '');
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const item = await markNotificationRead(req.params.id, userId);
    res.json(item);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    res.status(msg === 'Notification not found' ? 404 : 400).json({ error: msg });
  }
});

app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/files/:id', requireAuth, async (req, res) => {
  try {
    const { stream, name, mimeType } = await downloadFile(req.params.id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    stream.on('error', (err) => {
      console.error(err);
      if (!res.headersSent) res.status(404).json({ error: 'File not found' });
    });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: String(e.message || e) });
  }
});

app.use(express.static(webRoot));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webRoot, 'index.html'));
});

async function main() {
  if (mongoConfigured()) {
    try {
      await connectMongo();
    } catch (e) {
      console.error('MongoDB connect failed:', e.message || e);
      console.error('Server will start but /api/* will error until URI/network is fixed.');
    }
  } else {
    console.warn('MONGODB_URI not set — local mode (no cloud persist).');
  }
  app.listen(port, () => {
    console.log(`store-web server on http://localhost:${port}`);
    console.log(`Mongo configured: ${mongoConfigured()}`);
  });
}

main();
