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
  getNotificationsStateForUser,
  createNotification,
  markNotificationRead,
  markNotificationUnread,
  openNotification,
  confirmNotificationRead,
  endNotification,
  toggleNotificationPin,
  filterNotificationForViewerWithRole,
  uploadFile,
  downloadFile,
  loginWithPassword,
  changeOwnPassword,
  getSessionUser,
  destroySession,
  listUsersPublic,
  createUser,
  canCreateEmployee,
  publicUser,
  assignPhoneToUser,
  changeUserPhone,
  isAdminAccount,
  appendModuleLog,
  listTransferInventory,
  applyTransferRequest,
  decideTransferRequest,
  listTransferOrders,
  getTransferOrder,
  createTransferProduct,
  setTransferInventoryQuantities,
  listTransferStockAdjustments,
  listTransferProducts,
  updateTransferProduct,
  listTransferProductChanges,
  TRANSFER_STORES,
  TRANSFER_CATEGORIES,
  listPosProducts,
  listPosTransactions,
  getPosTransaction,
  adjustPosProduct,
  checkoutPos,
  resetPosDemo,
  listPosCatalogOptions,
  addPosSellable,
  listMembers,
  createMember,
  updateMember,
  setMemberActive,
} from './mongo.js';
import { driveConfigured, exportUsersToDrive, getDriveExportStatus } from './drive.js';

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

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.version || '1.0.0');
  } catch {
    return '1.0.0';
  }
}

/** Deploy fingerprint: package version + app.js/index.html mtime (changes on each code deploy). */
function getAppVersionInfo() {
  const pkgVersion = readPackageVersion();
  const candidates = [path.join(webRoot, 'app.js'), path.join(webRoot, 'pos.js'), path.join(webRoot, 'index.html')];
  let buildId = '0';
  let builtAt = null;
  let latestMs = 0;
  for (const filePath of candidates) {
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs > latestMs) {
        latestMs = st.mtimeMs;
        buildId = String(Math.floor(st.mtimeMs));
        builtAt = st.mtime.toISOString();
      }
    } catch {
      /* ignore missing file */
    }
  }
  return {
    version: `${pkgVersion}-${buildId}`,
    pkgVersion,
    buildId,
    builtAt,
  };
}

app.get('/api/health', async (req, res) => {
  const ver = getAppVersionInfo();
  const payload = {
    ok: true,
    configured: mongoConfigured(),
    mongoConfigured: mongoConfigured(),
    driveConfigured: driveConfigured(),
    storage: mongoConfigured() ? 'mongodb' : null,
    drive: driveConfigured() ? 'google-drive' : null,
    db: process.env.MONGODB_DB || 'store_employee',
    auth: true,
    version: ver.version,
    buildId: ver.buildId,
    builtAt: ver.builtAt,
  };
  // ?driveProbe=1 → 不需登入的 Drive 連線檢查（不含金鑰內容）
  if (String(req.query.driveProbe || '') === '1' && driveConfigured()) {
    try {
      payload.driveProbe = await getDriveExportStatus();
    } catch (e) {
      payload.driveProbe = { ok: false, error: String(e.message || e) };
    }
  } else if (String(req.query.driveProbe || '') === '1') {
    payload.driveProbe = { ok: false, configured: false, error: 'Drive 未設定' };
  }
  res.json(payload);
});

app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getAppVersionInfo());
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

/** 登入者更改自己的密碼 */
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const currentPw = req.body?.currentPw ?? req.body?.oldPassword ?? '';
    const newPw = req.body?.newPw ?? req.body?.newPassword ?? '';
    const confirmPw = req.body?.confirmPw ?? req.body?.confirmPassword;
    if (confirmPw != null && String(confirmPw) !== String(newPw)) {
      return res.status(400).json({ error: '兩次輸入的新密碼不一致' });
    }
    const updated = await changeOwnPassword(req.user.id || req.user._id, currentPw, newPw);
    res.json({ ok: true, user: updated });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
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

/** 將 Mongo 用戶公開資料匯出到 Google Drive（users.json，不含密碼） */
app.post('/api/drive/export-users', requireAuth, async (req, res) => {
  try {
    if (!canCreateEmployee(req.user) && !isAdminAccount(req.user)) {
      return res.status(403).json({ error: '沒有權限匯出用戶到 Google Drive。' });
    }
    if (!driveConfigured()) {
      return res.status(503).json({
        error: 'Google Drive 未設定。請在 Railway 設定 GOOGLE_SERVICE_ACCOUNT_JSON 與 GOOGLE_DRIVE_FOLDER_ID。',
      });
    }
    if (!mongoConfigured()) {
      return res.status(503).json({ error: 'MongoDB 未設定，無法讀取用戶。' });
    }
    const users = await listUsersPublic();
    const result = await exportUsersToDrive(users);
    try {
      await appendModuleLog({
        module: 'settings',
        action: '匯出用戶到 Drive',
        detail: `users.json｜${result.count} 人｜fileId=${result.fileId}`,
        userId: req.user.id || req.user._id,
        userName: req.user.name || req.user.login || req.user.id,
        user: req.user.name || req.user.login || req.user.id,
      });
    } catch (logErr) {
      console.warn('appendModuleLog failed', logErr);
    }
    res.json(result);
  } catch (e) {
    console.error('[drive/export-users]', e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Drive 連線診斷（管理員） */
app.get('/api/drive/status', requireAuth, async (req, res) => {
  try {
    if (!canCreateEmployee(req.user) && !isAdminAccount(req.user)) {
      return res.status(403).json({ error: '沒有權限。' });
    }
    res.json(await getDriveExportStatus());
  } catch (e) {
    console.error('[drive/status]', e);
    res.status(400).json({ error: String(e.message || e) });
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

app.get('/api/transfer/inventory', requireAuth, async (_req, res) => {
  try {
    res.json(await listTransferInventory());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/transfer/stores', requireAuth, async (_req, res) => {
  res.json({ stores: TRANSFER_STORES });
});

app.get('/api/transfer/meta', requireAuth, async (_req, res) => {
  res.json({
    stores: TRANSFER_STORES,
    categories: TRANSFER_CATEGORIES,
    sizePresets: ['S', 'M', 'L', 'XL', 'XXL', '均碼'],
  });
});

app.get('/api/transfer/products', requireAuth, async (_req, res) => {
  try {
    res.json({ products: await listTransferProducts() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/transfer/products', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const product = await createTransferProduct(req.user, req.body);
    res.json({ product });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.put('/api/transfer/products/:id', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const product = await updateTransferProduct(req.user, req.params.id, req.body);
    res.json({ product });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/transfer/product-changes', requireAuth, async (req, res) => {
  try {
    res.json({ changes: await listTransferProductChanges(req.query?.limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/transfer/inventory/qty', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const adjustment = await setTransferInventoryQuantities(req.user, req.body);
    res.json({ adjustment });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/transfer/stock-adjustments', requireAuth, async (req, res) => {
  try {
    const limit = req.query?.limit;
    res.json({ adjustments: await listTransferStockAdjustments(limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/transfer/orders', requireAuth, async (_req, res) => {
  try {
    res.json({ orders: await listTransferOrders() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/transfer/orders/:id', requireAuth, async (req, res) => {
  try {
    const order = await getTransferOrder(req.params.id);
    if (!order) return res.status(404).json({ error: '找不到調動單' });
    res.json({ order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/transfer/orders', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const order = await applyTransferRequest(req.user, req.body);
    res.json({ order });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/transfer/orders/:id/decide', requireAuth, async (req, res) => {
  try {
    const decision = req.body?.decision || req.body?.action;
    const order = await decideTransferRequest(req.user, req.params.id, decision, req.body?.reason);
    res.json({ order });
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

app.get('/api/pos/products', requireAuth, async (req, res) => {
  try {
    res.json(await listPosProducts(req.user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/pos/transactions', requireAuth, async (req, res) => {
  try {
    res.json(await listPosTransactions(req.user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/pos/transactions/:id', requireAuth, async (req, res) => {
  try {
    res.json({ transaction: await getPosTransaction(req.user, req.params.id) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/pos/checkout', requireAuth, async (req, res) => {
  try {
    const transaction = await checkoutPos(req.user, req.body || {});
    res.json({ transaction });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/pos/products/:id/adjust', requireAuth, async (req, res) => {
  try {
    const product = await adjustPosProduct(req.user, req.params.id, req.body || {});
    res.json({ product });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/pos/catalog-options', requireAuth, async (req, res) => {
  try {
    res.json(await listPosCatalogOptions(req.user));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/pos/sellables', requireAuth, async (req, res) => {
  try {
    res.json(await addPosSellable(req.user, req.body || {}));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/pos/members', requireAuth, async (req, res) => {
  try {
    res.json(
      await listMembers(req.user, {
        q: req.query?.q,
        includeInactive: String(req.query?.includeInactive || '') === '1',
      })
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/pos/members', requireAuth, async (req, res) => {
  try {
    res.json({ member: await createMember(req.user, req.body || {}) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.put('/api/pos/members/:id', requireAuth, async (req, res) => {
  try {
    res.json({ member: await updateMember(req.user, req.params.id, req.body || {}) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/pos/members/:id/active', requireAuth, async (req, res) => {
  try {
    const active = req.body?.active !== false && req.body?.active !== 'false' && req.body?.active !== 0;
    res.json({ member: await setMemberActive(req.user, req.params.id, active) });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/pos/reset', requireAuth, async (req, res) => {
  try {
    res.json(await resetPosDemo(req.user));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
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

app.post('/api/module-logs', requireAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const item = await appendModuleLog(req.body);
    res.json({ ok: true, log: item });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    res.json(await getNotificationsStateForUser(req.user));
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
    const me = publicUser(req.user);
    const body = {
      ...req.body,
      fromUserId: String(me?.id || req.body.fromUserId || ''),
      fromName: String(me?.name || me?.login || req.body.fromName || ''),
    };
    const item = await createNotification(body);
    const filtered = filterNotificationForViewerWithRole(item, req.user) || item;
    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const me = publicUser(req.user);
    const userId = String(me?.id || '');
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const item = await markNotificationRead(req.params.id, userId);
    res.json(filterNotificationForViewerWithRole(item, req.user) || item);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    res.status(msg === 'Notification not found' ? 404 : 400).json({ error: msg });
  }
});

app.post('/api/notifications/:id/unread', requireAuth, async (req, res) => {
  try {
    const me = publicUser(req.user);
    const userId = String(me?.id || '');
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const item = await markNotificationUnread(req.params.id, userId);
    res.json(filterNotificationForViewerWithRole(item, req.user) || item);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    res.status(msg === 'Notification not found' ? 404 : 400).json({ error: msg });
  }
});

app.post('/api/notifications/:id/open', requireAuth, async (req, res) => {
  try {
    const me = publicUser(req.user);
    const userId = String(me?.id || '');
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const item = await openNotification(req.params.id, userId);
    res.json(filterNotificationForViewerWithRole(item, req.user) || item);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    res.status(msg === 'Notification not found' ? 404 : 400).json({ error: msg });
  }
});

app.post('/api/notifications/:id/confirm', requireAuth, async (req, res) => {
  try {
    const me = publicUser(req.user);
    const item = await confirmNotificationRead(req.params.id, req.user, me?.login);
    res.json(filterNotificationForViewerWithRole(item, req.user) || item);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    res.status(msg === 'Notification not found' ? 404 : 400).json({ error: msg });
  }
});

app.post('/api/notifications/:id/end', requireAuth, async (req, res) => {
  try {
    const item = await endNotification(req.params.id, req.user, {
      mode: req.body?.mode,
      reason: req.body?.reason,
    });
    res.json(filterNotificationForViewerWithRole(item, req.user) || item);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    res.status(msg === 'Notification not found' ? 404 : 400).json({ error: msg });
  }
});

app.post('/api/notifications/:id/pin', requireAuth, async (req, res) => {
  try {
    const item = await toggleNotificationPin(req.params.id, req.user);
    res.json(filterNotificationForViewerWithRole(item, req.user) || item);
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

app.use(
  express.static(webRoot, {
    setHeaders(res, filePath) {
      const p = String(filePath).replace(/\\/g, '/');
      if (p.endsWith('index.html') || p.endsWith('/app.js') || p.endsWith('app.js') || p.endsWith('/pos.js') || p.endsWith('pos.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
