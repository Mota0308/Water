import { MongoClient, GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'stream';
import crypto from 'crypto';

const DB_NAME = process.env.MONGODB_DB || 'store_employee';
const SESSION_DAYS = 30;
let client = null;
let db = null;
let bucket = null;

export function mongoConfigured() {
  return !!process.env.MONGODB_URI;
}

export async function connectMongo() {
  if (db) return db;
  if (!process.env.MONGODB_URI) {
    throw new Error('Missing MONGODB_URI');
  }
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  bucket = new GridFSBucket(db, { bucketName: 'uploads' });
  await dailyCol().createIndex({ _id: 1 });
  await projectsCol().createIndex({ _id: 1 });
  await replenishmentProjectsCol().createIndex({ _id: 1 });
  await notificationsCol().createIndex({ _id: 1 });
  await usersCol().createIndex({ login: 1 }, { unique: true });
  await sessionsCol().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await metaCol().createIndex({ _id: 1 });
  await moduleLogsCol().createIndex({ module: 1, createdAt: -1 });
  await transferProductsCol().createIndex({ id: 1 }, { unique: true });
  await transferInventoryCol().createIndex({ productId: 1, size: 1, store: 1 }, { unique: true });
  await transferOrdersCol().createIndex({ id: 1 }, { unique: true });
  await transferOrdersCol().createIndex({ createdAtMs: -1 });
  await transferStockAdjustmentsCol().createIndex({ createdAtMs: -1 });
  await transferProductChangesCol().createIndex({ createdAtMs: -1 });
  console.log('MongoDB connected:', DB_NAME);
  try {
    await migrateUsersV1();
    await migrateProjectsV1();
    await migrateSplitProjectsAndLogsV1();
    await ensureAdminInDb();
  } catch (e) {
    console.warn('Migration skipped/failed:', e.message || e);
  }
  try {
    await purgeSampleDataOnce();
  } catch (e) {
    console.warn('Sample purge skipped:', e.message || e);
  }
  return db;
}

const SAMPLE_PROJECT_IDS = new Set(['P001', 'P002', 'P003']);
const SAMPLE_PROJECT_CODES = new Set(['WS-999', 'WS-888', 'WS-777']);
const SAMPLE_PROJECT_NAMES = new Set(['成人日本光皮長短', '1mm兒童抓毛上衣', '兒童防曬套裝']);
const SAMPLE_DAILY_TITLES = new Set(['整理今日到貨箱單', '更新門市陳列清單', '逾期示範：昨夜未完成點貨']);
const SAMPLE_TPL_TITLES = new Set(['門市巡檢', '倉存點算']);
const LEGACY_DEMO_LOGINS = new Set(['manager', 'kt.staff', 'tm.staff', 'kwok', 'ann', 'coey', 'wh.staff']);
const LEGACY_DEMO_IDS = new Set(['mgr', 'kt', 'tm', 'kwok', 'ann', 'coey', 'wh']);
const SAMPLE_LOG_RE =
  /WS-999|WS-888|WS-777|逾期示範|門市巡檢|倉存點算|整理今日到貨|更新門市陳列|成人日本光皮|兒童抓毛上衣|兒童防曬套裝|每日結算/;

const SEED_ADMIN = {
  id: 'adm',
  login: 'admin',
  pw: 'admin',
  name: '系統管理員',
  dept: '管理層',
  role: 'system_admin',
  position: '系統管理員',
  unit: null,
  units: [],
  active: true,
};

function dailyCol() {
  return db.collection('daily');
}
function projectsCol() {
  return db.collection('projects'); // 僅開發及生產
}
function replenishmentProjectsCol() {
  return db.collection('replenishment_projects'); // 僅補貨
}
function moduleLogsCol() {
  return db.collection('module_logs'); // 全站操作流水（一則一筆）
}
function notificationsCol() {
  return db.collection('notifications');
}
function usersCol() {
  return db.collection('users');
}
function sessionsCol() {
  return db.collection('sessions');
}
function metaCol() {
  return db.collection('meta');
}
function transferProductsCol() {
  return db.collection('transfer_products');
}
function transferInventoryCol() {
  return db.collection('transfer_inventory');
}
function transferOrdersCol() {
  return db.collection('transfer_orders');
}
function transferStockAdjustmentsCol() {
  return db.collection('transfer_stock_adjustments');
}
function transferProductChangesCol() {
  return db.collection('transfer_product_changes');
}

function formatHkDateTime(d = new Date()) {
  const now = d instanceof Date ? d : new Date(d);
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

async function nextTransferOrderId() {
  const result = await metaCol().findOneAndUpdate(
    { _id: 'transfer_seq' },
    { $inc: { seq: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  const doc = result?.value ?? result;
  const seq = typeof doc?.seq === 'number' ? doc.seq : 1;
  return 'TF' + String(seq).padStart(4, '0');
}

/** 貨品調動：四間港店（與員工地區同名，無「店」字） */
export const TRANSFER_STORES = ['觀塘', '荔枝角', '灣仔', '屯門'];
export const TRANSFER_CATEGORIES = [
  '成人保暖衣',
  '兒童保暖衣',
  '成人抓毛',
  '兒童抓毛',
  '成人膠衣',
  '兒童膠衣',
  '防曬用品',
  '游水用品',
  '其他',
];

function stripProjectDoc(d) {
  const { _id, updatedAt, users: _u, ...rest } = d;
  return { ...rest, id: rest.id || String(_id) };
}

async function listDocsFromCol(col) {
  const docs = await col.find({ _id: { $ne: 'main' } }).toArray();
  return docs.map(stripProjectDoc);
}

async function replaceProjectCollection(col, list, forceType) {
  const items = (Array.isArray(list) ? list : []).filter((p) => p && p.id);
  const keepIds = new Set(items.map((p) => String(p.id)));
  for (const p of items) {
    const id = String(p.id);
    const { users: _u, _id, ...rest } = p;
    const doc = {
      ...rest,
      id,
      _id: id,
      type: forceType || rest.type || (forceType === 'rep' ? 'rep' : 'dev'),
      updatedAt: new Date(),
    };
    if (forceType) doc.type = forceType;
    await col.replaceOne({ _id: id }, doc, { upsert: true });
  }
  const existing = await col.find({ _id: { $ne: 'main' } }).project({ _id: 1 }).toArray();
  const toDelete = existing.map((d) => d._id).filter((id) => !keepIds.has(String(id)));
  if (toDelete.length) await col.deleteMany({ _id: { $in: toDelete } });
  await col.deleteOne({ _id: 'main' });
}

function isSampleDailyWork(w) {
  if (!w) return true;
  if (SAMPLE_DAILY_TITLES.has(w.title)) return true;
  if (String(w.title || '').includes('逾期示範')) return true;
  if (w.kind === 'settlement' && /每日結算$/.test(String(w.title || ''))) return true;
  if (SAMPLE_TPL_TITLES.has(w.title)) return true;
  return false;
}
function isSampleDailyTemplate(t) {
  return !t || SAMPLE_TPL_TITLES.has(t.title);
}
function isSampleProject(p) {
  if (!p) return true;
  if (SAMPLE_PROJECT_IDS.has(p.id) || SAMPLE_PROJECT_IDS.has(p._id)) return true;
  if (SAMPLE_PROJECT_CODES.has(p.code)) return true;
  if (SAMPLE_PROJECT_NAMES.has(p.name)) return true;
  return false;
}

/** 香港 8 位電話；允許 +852／空格／橫線，存庫僅 8 位數字 */
export function normalizePhone(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s\-()]/g, '');
  if (s.startsWith('+852')) s = s.slice(4);
  else if (s.startsWith('852') && s.length === 11) s = s.slice(3);
  if (!/^\d{8}$/.test(s)) return null;
  return s;
}

export function passwordFromPhone(phone) {
  const p = normalizePhone(phone);
  return p ? p.slice(-4) : '';
}

export function isAdminAccount(u) {
  if (!u) return false;
  return u.login === 'admin' || u.id === 'adm' || u._id === 'adm';
}

export function userNeedsPhoneBind(u) {
  if (!u || isAdminAccount(u)) return false;
  // 主鍵（id/_id）必須已是 8 位電話；僅 login 像電話仍算未完成遷移
  if (normalizePhone(u.id) || normalizePhone(u._id)) return false;
  return true;
}

export function publicUser(u) {
  if (!u) return null;
  const { pw, password, passwordHash, _id, ...rest } = u;
  const id = rest.id || (typeof _id === 'string' ? _id : String(_id || ''));
  const phone = normalizePhone(rest.phone) || normalizePhone(id) || normalizePhone(rest.login) || null;
  return {
    ...rest,
    id,
    phone,
    needsPhoneBind: userNeedsPhoneBind({ ...rest, id, _id, phone: rest.phone }),
  };
}

function normalizeUserDoc(u) {
  if (!u || typeof u !== 'object') return null;
  const isAdmin = String(u.login || '').toLowerCase() === 'admin' || u.id === 'adm' || u._id === 'adm';
  let phone = normalizePhone(u.phone || (!isAdmin ? u.id || u._id || u.login : null));
  let id;
  let login;
  if (isAdmin) {
    id = 'adm';
    login = 'admin';
    phone = null;
  } else {
    if (!phone) return null;
    id = phone;
    login = phone;
  }
  let units = Array.isArray(u.units) ? u.units.filter(Boolean) : [];
  if (!units.length && u.unit) units = [u.unit];
  let position = u.position;
  let role = u.role;
  if (!position) {
    if (isAdmin || role === 'system_admin') position = isAdmin ? '系統管理員' : '經理';
    else if (role === 'manager') position = '主管';
    else position = '員工';
  }
  if (position === '經理' || position === '主管') role = 'system_admin';
  else if (position === '員工') role = 'personal';
  else if (isAdmin) role = 'system_admin';
  const pw =
    u.pw != null && String(u.pw) !== ''
      ? String(u.pw)
      : isAdmin
        ? 'admin'
        : passwordFromPhone(phone);
  return {
    _id: id,
    id,
    login,
    phone: phone || undefined,
    pw,
    name: String(u.name || (isAdmin ? '系統管理員' : phone)),
    dept: u.dept != null ? String(u.dept) : units.join('、') || (position === '員工' ? '—' : '管理層'),
    role: role || 'personal',
    position,
    unit: units[0] || null,
    units,
    active: u.active === false ? false : true,
    needsPhoneBind: false,
    legacyLogin: u.legacyLogin || (!isAdmin && u.login && !normalizePhone(u.login) ? String(u.login) : undefined),
  };
}

const USER_REF_KEYS = new Set([
  'handler',
  'handlers',
  'owner',
  'createdBy',
  'completedBy',
  'by',
  'fromUserId',
  'userId',
  'assignee',
]);

function rewriteIdsInValue(val, oldId, newId) {
  if (val === oldId) return newId;
  if (Array.isArray(val)) return val.map((x) => rewriteIdsInValue(x, oldId, newId));
  if (!val || typeof val !== 'object') return val;
  const out = Array.isArray(val) ? [] : { ...val };
  for (const k of Object.keys(val)) {
    if (USER_REF_KEYS.has(k) && val[k] === oldId) out[k] = newId;
    else if (k === 'removedBy' && val[k] === oldId) out[k] = newId;
    else if (val[k] && typeof val[k] === 'object') out[k] = rewriteIdsInValue(val[k], oldId, newId);
    else out[k] = val[k];
  }
  return out;
}

async function rewriteInCollection(col, oldId, newId) {
  let n = 0;
  const docs = await col.find({ _id: { $ne: 'main' } }).toArray();
  for (const doc of docs) {
    const next = rewriteIdsInValue(doc, oldId, newId);
    if (JSON.stringify(next) !== JSON.stringify(doc)) {
      next.updatedAt = new Date();
      await col.replaceOne({ _id: doc._id }, next);
      n++;
    }
  }
  return n;
}

/** 將各功能文件中的舊使用者 id 改成新電話 id */
export async function rewriteUserRefs(oldId, newId) {
  if (!oldId || !newId || oldId === newId) {
    return { projects: 0, replenishment: 0, daily: false, notifications: false, sessions: 0 };
  }
  await connectMongo();
  const projects = await rewriteInCollection(projectsCol(), oldId, newId);
  const replenishment = await rewriteInCollection(replenishmentProjectsCol(), oldId, newId);
  await moduleLogsCol().updateMany({ userId: String(oldId) }, { $set: { userId: String(newId) } });
  const dailyDoc = await dailyCol().findOne({ _id: 'main' });
  let daily = false;
  if (dailyDoc) {
    const next = rewriteIdsInValue(dailyDoc, oldId, newId);
    if (JSON.stringify(next) !== JSON.stringify(dailyDoc)) {
      next.updatedAt = new Date();
      await dailyCol().replaceOne({ _id: 'main' }, next);
      daily = true;
    }
  }
  const notifDoc = await notificationsCol().findOne({ _id: 'main' });
  let notifications = false;
  if (notifDoc) {
    const next = rewriteIdsInValue(notifDoc, oldId, newId);
    if (JSON.stringify(next) !== JSON.stringify(notifDoc)) {
      next.updatedAt = new Date();
      await notificationsCol().replaceOne({ _id: 'main' }, next);
      notifications = true;
    }
  }
  const sess = await sessionsCol().updateMany({ userId: String(oldId) }, { $set: { userId: String(newId) } });
  return { projects, replenishment, daily, notifications, sessions: sess.modifiedCount || 0 };
}

async function getMigrations() {
  const doc = await metaCol().findOne({ _id: 'migrations' });
  return doc || { _id: 'migrations' };
}
async function setMigrationFlag(key) {
  await metaCol().updateOne({ _id: 'migrations' }, { $set: { [key]: true, updatedAt: new Date() } }, { upsert: true });
}

function legacyUserDoc(u) {
  const phoneDoc = normalizeUserDoc(u);
  if (phoneDoc) return phoneDoc;
  if (!u || typeof u !== 'object') return null;
  const id = String(u.id || u._id || '').trim();
  const login = String(u.login || '').trim();
  if (!id || !login) return null;
  let units = Array.isArray(u.units) ? u.units.filter(Boolean) : [];
  if (!units.length && u.unit) units = [u.unit];
  let position = u.position || '員工';
  let role = u.role || (position === '員工' ? 'personal' : 'system_admin');
  if (position === '經理' || position === '主管') role = 'system_admin';
  return {
    _id: id,
    id,
    login,
    pw: u.pw != null ? String(u.pw) : '',
    name: String(u.name || login),
    dept: u.dept != null ? String(u.dept) : units.join('、') || '—',
    role,
    position,
    unit: units[0] || null,
    units,
    active: u.active === false ? false : true,
    needsPhoneBind: true,
    legacyLogin: login,
  };
}

/** projects.main.users → users collection（一人一筆） */
async function migrateUsersV1() {
  const mig = await getMigrations();
  if (mig.usersV1) return;
  const main = await projectsCol().findOne({ _id: 'main' });
  const existingCount = await usersCol().countDocuments();
  let source = Array.isArray(main?.users) ? main.users : [];
  source = source.filter((u) => {
    if (!u) return false;
    if (u.login === 'admin' || u.id === 'adm') return true;
    if (LEGACY_DEMO_LOGINS.has(String(u.login || '').toLowerCase())) return false;
    if (LEGACY_DEMO_IDS.has(u.id)) return false;
    return true;
  });
  if (!source.some((u) => u.login === 'admin')) source.unshift({ ...SEED_ADMIN });

  if (existingCount === 0 && source.length) {
    for (const raw of source) {
      const doc = legacyUserDoc(raw);
      if (!doc) continue;
      await usersCol().updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
    }
    console.log('Migrated users → users collection:', source.length);
  } else if (existingCount === 0) {
    const doc = normalizeUserDoc(SEED_ADMIN);
    await usersCol().insertOne(doc);
    console.log('Seeded admin into users collection');
  }

  if (main && Object.prototype.hasOwnProperty.call(main, 'users')) {
    await projectsCol().updateOne({ _id: 'main' }, { $unset: { users: '' }, $set: { updatedAt: new Date() } });
  }
  await setMigrationFlag('usersV1');
}

/** projects.main.projects[] → 一項目一筆；meta 存 projSeq / moduleLogs */
async function migrateProjectsV1() {
  const mig = await getMigrations();
  if (mig.projectsV1) return;
  const main = await projectsCol().findOne({ _id: 'main' });
  if (main && Array.isArray(main.projects)) {
    const list = main.projects.filter((p) => p && p.id && !isSampleProject(p));
    for (const p of list) {
      const id = String(p.id);
      const { users: _u, ...rest } = p;
      await projectsCol().replaceOne(
        { _id: id },
        { ...rest, id, _id: id, updatedAt: new Date() },
        { upsert: true }
      );
    }
    let projSeq = typeof main.projSeq === 'number' ? main.projSeq : 1;
    let maxN = 0;
    list.forEach((p) => {
      const m = String(p.id || '').match(/^P(\d+)$/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    if (maxN >= projSeq) projSeq = maxN + 1;
    // moduleLogs 暫存 meta，下一階段 migrateSplitProjectsAndLogsV1 會拆到 module_logs
    const moduleLogs =
      main.moduleLogs && typeof main.moduleLogs === 'object' ? main.moduleLogs : null;
    const metaSet = { projSeq, repProjSeq: 1, updatedAt: new Date() };
    if (moduleLogs) metaSet.moduleLogs = moduleLogs;
    await metaCol().replaceOne({ _id: 'projects' }, { _id: 'projects', ...metaSet }, { upsert: true });
    await projectsCol().deleteOne({ _id: 'main' });
    console.log('Migrated projects → one doc each:', list.length);
  } else {
    const meta = await metaCol().findOne({ _id: 'projects' });
    if (!meta) {
      await metaCol().insertOne({
        _id: 'projects',
        projSeq: 1,
        repProjSeq: 1,
        updatedAt: new Date(),
      });
    }
  }
  await setMigrationFlag('projectsV1');
}

/** projects 只留開發；補貨搬到 replenishment_projects；moduleLogs → module_logs 一則一筆 */
async function migrateSplitProjectsAndLogsV1() {
  const mig = await getMigrations();
  if (mig.splitProjectsLogsV1) return;

  const mixed = await projectsCol().find({ _id: { $ne: 'main' } }).toArray();
  let moved = 0;
  for (const doc of mixed) {
    if (doc.type === 'rep') {
      const id = String(doc.id || doc._id);
      const { users: _u, ...rest } = doc;
      await replenishmentProjectsCol().replaceOne(
        { _id: id },
        { ...rest, id, type: 'rep', _id: id, updatedAt: new Date() },
        { upsert: true }
      );
      await projectsCol().deleteOne({ _id: doc._id });
      moved++;
    } else if (!doc.type) {
      await projectsCol().updateOne({ _id: doc._id }, { $set: { type: 'dev' } });
    }
  }

  const meta = (await metaCol().findOne({ _id: 'projects' })) || {};
  if (meta.moduleLogs && typeof meta.moduleLogs === 'object') {
    const docs = [];
    for (const mod of Object.keys(meta.moduleLogs)) {
      const arr = Array.isArray(meta.moduleLogs[mod]) ? meta.moduleLogs[mod] : [];
      arr.forEach((l, i) => {
        if (!l) return;
        docs.push({
          module: String(mod),
          time: l.time || '',
          user: l.user || '',
          userId: l.userId || '',
          userName: l.userName || '',
          userPhone: l.userPhone || null,
          action: l.action || '',
          detail: l.detail || '',
          createdAt: new Date(),
          seq: arr.length - i,
        });
      });
    }
    if (docs.length) {
      for (let i = 0; i < docs.length; i += 400) {
        await moduleLogsCol().insertMany(docs.slice(i, i + 400));
      }
      console.log('Migrated module_logs entries:', docs.length);
    }
  }

  let projSeq = typeof meta.projSeq === 'number' ? meta.projSeq : 1;
  let repProjSeq = typeof meta.repProjSeq === 'number' ? meta.repProjSeq : 1;
  const prodDocs = await listDocsFromCol(projectsCol());
  const repDocs = await listDocsFromCol(replenishmentProjectsCol());
  let maxP = 0;
  let maxR = 0;
  prodDocs.forEach((p) => {
    const m = String(p.id || '').match(/^P(\d+)$/i);
    if (m) maxP = Math.max(maxP, parseInt(m[1], 10));
  });
  repDocs.forEach((p) => {
    const m = String(p.id || '').match(/^[PR](\d+)$/i);
    if (m) maxR = Math.max(maxR, parseInt(m[1], 10));
  });
  if (maxP >= projSeq) projSeq = maxP + 1;
  if (maxR >= repProjSeq) repProjSeq = maxR + 1;

  await metaCol().updateOne(
    { _id: 'projects' },
    {
      $set: { projSeq, repProjSeq, updatedAt: new Date() },
      $unset: { moduleLogs: '' },
    },
    { upsert: true }
  );

  await setMigrationFlag('splitProjectsLogsV1');
  console.log('Split collections: moved replenishment projects:', moved);
}

async function ensureAdminInDb() {
  const admin = await usersCol().findOne({ login: 'admin' });
  if (!admin) {
    await usersCol().insertOne(normalizeUserDoc(SEED_ADMIN));
    return;
  }
  // keep existing admin; ensure active
  if (admin.active === false) {
    await usersCol().updateOne({ _id: admin._id }, { $set: { active: true } });
  }
}

/** 啟動時清掉示範種子（保留 admin 與真實資料）。 */
export async function purgeSampleDataOnce() {
  if (!db) throw new Error('Mongo not connected');
  let changed = false;

  for (const col of [projectsCol(), replenishmentProjectsCol()]) {
    const sampleProjIds = [];
    const cursor = col.find({ _id: { $ne: 'main' } });
    for await (const doc of cursor) {
      const p = { ...doc, id: doc.id || doc._id };
      if (isSampleProject(p)) sampleProjIds.push(doc._id);
    }
    if (sampleProjIds.length) {
      await col.deleteMany({ _id: { $in: sampleProjIds } });
      changed = true;
    }
  }

  const legacyUsers = await usersCol()
    .find({
      $or: [
        { login: { $in: [...LEGACY_DEMO_LOGINS] } },
        { id: { $in: [...LEGACY_DEMO_IDS] } },
        { _id: { $in: [...LEGACY_DEMO_IDS] } },
      ],
    })
    .toArray();
  const toRemove = legacyUsers.filter((u) => u.login !== 'admin' && u.id !== 'adm' && u._id !== 'adm');
  if (toRemove.length) {
    await usersCol().deleteMany({ _id: { $in: toRemove.map((u) => u._id) } });
    changed = true;
  }
  await ensureAdminInDb();

  try {
    const logDocs = await moduleLogsCol().find({}).limit(2000).toArray();
    const badIds = logDocs
      .filter((l) => SAMPLE_LOG_RE.test(`${(l && l.detail) || ''}|${(l && l.action) || ''}`))
      .map((l) => l._id);
    if (badIds.length) {
      await moduleLogsCol().deleteMany({ _id: { $in: badIds } });
      changed = true;
    }
  } catch (e) {
    /* ignore */
  }

  const dailyDoc = await dailyCol().findOne({ _id: 'main' });
  if (dailyDoc) {
    const works = Array.isArray(dailyDoc.works) ? dailyDoc.works : [];
    const tpls = Array.isArray(dailyDoc.recurringTemplates) ? dailyDoc.recurringTemplates : [];
    const opLogs = Array.isArray(dailyDoc.opLogs) ? dailyDoc.opLogs : [];
    const removedTplIds = new Set(tpls.filter(isSampleDailyTemplate).map((t) => t.id).filter(Boolean));
    const nextTpls = tpls.filter((t) => !isSampleDailyTemplate(t));
    const nextWorks = works.filter(
      (w) => !isSampleDailyWork(w) && !(w.templateId && removedTplIds.has(w.templateId))
    );
    const nextLogs = opLogs.filter((l) => {
      const blob = `${(l && l.detail) || ''}|${(l && l.action) || ''}`;
      return !SAMPLE_LOG_RE.test(blob);
    });
    if (nextWorks.length !== works.length || nextTpls.length !== tpls.length || nextLogs.length !== opLogs.length) {
      await saveDaily({
        version: dailyDoc.version || 2,
        works: nextWorks,
        recurringTemplates: nextTpls,
        opLogs: nextLogs,
      });
      changed = true;
    }
  }

  if (changed) console.log('Purged leftover sample/demo seed data from MongoDB.');
  return changed;
}

const EMPTY_DAILY = { version: 2, works: [], recurringTemplates: [], opLogs: [] };
const EMPTY_NOTIFICATIONS = { notifications: [], notifSeq: 1 };

export async function getDaily() {
  await connectMongo();
  const doc = await dailyCol().findOne({ _id: 'main' });
  if (!doc) return { ...EMPTY_DAILY };
  const { _id, ...rest } = doc;
  return Object.keys(rest).length ? rest : { ...EMPTY_DAILY };
}

export async function saveDaily(data) {
  await connectMongo();
  const payload = { ...data, _id: 'main', updatedAt: new Date() };
  await dailyCol().replaceOne({ _id: 'main' }, payload, { upsert: true });
  return { ok: true };
}

async function getProjectsMeta() {
  let meta = await metaCol().findOne({ _id: 'projects' });
  if (!meta) {
    meta = {
      _id: 'projects',
      projSeq: 1,
      repProjSeq: 1,
      updatedAt: new Date(),
    };
    await metaCol().insertOne(meta);
  }
  if (typeof meta.repProjSeq !== 'number') {
    meta.repProjSeq = 1;
    await metaCol().updateOne({ _id: 'projects' }, { $set: { repProjSeq: 1 } });
  }
  return meta;
}

const MODULE_LOG_KEYS = ['daily', 'production', 'replenishment', 'push'];

async function getModuleLogsGrouped(limitPerModule = 400) {
  const out = { daily: [], production: [], replenishment: [], push: [] };
  for (const mod of MODULE_LOG_KEYS) {
    const rows = await moduleLogsCol()
      .find({ module: mod })
      .sort({ createdAt: -1, seq: -1 })
      .limit(limitPerModule)
      .toArray();
    out[mod] = rows.map((l) => ({
      time: l.time || '',
      user: l.user || '',
      userId: l.userId || '',
      userName: l.userName || '',
      userPhone: l.userPhone || null,
      action: l.action || '',
      detail: l.detail || '',
    }));
  }
  return out;
}

/** 過渡：用前端送來的 moduleLogs 陣列覆寫各模組流水 */
async function replaceModuleLogsFromBlob(moduleLogs) {
  if (!moduleLogs || typeof moduleLogs !== 'object') return;
  for (const mod of MODULE_LOG_KEYS) {
    const arr = Array.isArray(moduleLogs[mod]) ? moduleLogs[mod] : [];
    await moduleLogsCol().deleteMany({ module: mod });
    if (!arr.length) continue;
    const docs = arr.map((l, i) => ({
      module: mod,
      time: (l && l.time) || '',
      user: (l && l.user) || '',
      userId: (l && l.userId) || '',
      userName: (l && l.userName) || '',
      userPhone: (l && l.userPhone) || null,
      action: (l && l.action) || '',
      detail: (l && l.detail) || '',
      createdAt: new Date(),
      seq: arr.length - i,
    }));
    for (let i = 0; i < docs.length; i += 400) {
      await moduleLogsCol().insertMany(docs.slice(i, i + 400));
    }
  }
}

export async function appendModuleLog(entry) {
  await connectMongo();
  const module = String(entry?.module || 'daily');
  const doc = {
    module,
    time: entry?.time || '',
    user: entry?.user || '',
    userId: entry?.userId || '',
    userName: entry?.userName || '',
    userPhone: entry?.userPhone || null,
    action: entry?.action || '',
    detail: entry?.detail || '',
    projectId: entry?.projectId || null,
    createdAt: new Date(),
    seq: Date.now(),
  };
  await moduleLogsCol().insertOne(doc);
  return doc;
}

export async function listUsersPublic() {
  await connectMongo();
  const docs = await usersCol().find({}).sort({ login: 1 }).toArray();
  return docs.map(publicUser);
}

export async function getUserByLogin(login) {
  await connectMongo();
  const raw = String(login || '').trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'admin') {
    return usersCol().findOne({ $or: [{ login: 'admin' }, { _id: 'adm' }, { id: 'adm' }] });
  }
  const phone = normalizePhone(raw);
  if (phone) {
    const byPhone = await usersCol().findOne({
      $or: [{ _id: phone }, { id: phone }, { phone }, { login: phone }],
    });
    if (byPhone) return byPhone;
  }
  return usersCol().findOne({ login: raw });
}

export async function getUserById(id) {
  await connectMongo();
  const sid = String(id || '');
  const phone = normalizePhone(sid);
  if (phone) {
    return usersCol().findOne({ $or: [{ _id: phone }, { id: phone }, { phone }, { login: phone }] });
  }
  return usersCol().findOne({ $or: [{ _id: sid }, { id: sid }, { login: sid }] });
}

export async function createUser(input) {
  await connectMongo();
  const phone = normalizePhone(input?.phone || input?.login || input?.id);
  if (!phone) throw new Error('請輸入有效的香港 8 位電話號碼');
  if (phone === 'admin') throw new Error('不可建立系統帳 admin');
  const existing = await getUserById(phone);
  if (existing) throw new Error('此電話號碼已存在');
  const doc = normalizeUserDoc({
    ...input,
    id: phone,
    login: phone,
    phone,
    pw: input?.pw || passwordFromPhone(phone),
  });
  if (!doc) throw new Error('Invalid user');
  await usersCol().insertOne(doc);
  return publicUser(doc);
}

/**
 * 將舊帳（無電話主鍵）改為電話主鍵，並改寫全庫關聯。
 * @param {{ actorIsAdmin?: boolean, allowSelf?: boolean, actorUserId?: string }} opts
 */
export async function assignPhoneToUser(oldUserId, phoneRaw, opts = {}) {
  await connectMongo();
  const old = await getUserById(oldUserId);
  if (!old) throw new Error('找不到該用戶');
  if (isAdminAccount(old)) throw new Error('系統帳 admin 不可改為電話主鍵');
  if (opts.allowSelf && String(opts.actorUserId) !== String(old.id || old._id)) {
    throw new Error('只能為自己綁定電話');
  }
  if (!opts.actorIsAdmin && !opts.allowSelf) throw new Error('沒有權限');
  const phone = normalizePhone(phoneRaw) || normalizePhone(old.phone) || normalizePhone(old.login);
  if (!phone) throw new Error('請輸入有效的香港 8 位電話號碼');
  if (!userNeedsPhoneBind(old) && !opts.forceChange) {
    if (normalizePhone(old.id || old._id) === phone) return publicUser(old);
    throw new Error('此帳號已有電話主鍵，請使用「更換電話」');
  }
  const clash = await usersCol().findOne({
    $or: [{ _id: phone }, { id: phone }, { phone }, { login: phone }],
  });
  if (clash && String(clash._id) !== String(old._id)) throw new Error('此電話號碼已被使用');

  const oldId = String(old.id || old._id);
  const legacyLogin = old.login && !normalizePhone(old.login) ? old.login : old.legacyLogin;
  const newDoc = normalizeUserDoc({
    ...old,
    id: phone,
    login: phone,
    phone,
    pw: passwordFromPhone(phone),
    legacyLogin,
    name: old.name,
  });
  if (String(old._id) !== phone) {
    // 先釋放 login 唯一索引，再插入新主鍵文件
    await usersCol().updateOne(
      { _id: old._id },
      { $set: { login: '__migrating_' + oldId, phone: undefined } }
    );
    await usersCol().insertOne(newDoc);
    await rewriteUserRefs(oldId, phone);
    await usersCol().deleteOne({ _id: old._id });
  } else {
    await usersCol().replaceOne({ _id: old._id }, newDoc);
  }
  return publicUser(newDoc);
}

/** 管理員：已有電話主鍵的帳號換號 */
export async function changeUserPhone(oldPhoneRaw, newPhoneRaw) {
  await connectMongo();
  const oldPhone = normalizePhone(oldPhoneRaw) || String(oldPhoneRaw || '').trim();
  const newPhone = normalizePhone(newPhoneRaw);
  if (!newPhone) throw new Error('請輸入有效的新電話（香港 8 位）');
  const old = await getUserById(oldPhone);
  if (!old) throw new Error('找不到該用戶');
  if (isAdminAccount(old)) throw new Error('系統帳不可更換電話');
  const oldId = String(old.id || old._id);
  if (oldId === newPhone) return publicUser(old);
  const clash = await getUserById(newPhone);
  if (clash) throw new Error('新電話號碼已被使用');

  const newDoc = normalizeUserDoc({
    ...old,
    id: newPhone,
    login: newPhone,
    phone: newPhone,
    pw: passwordFromPhone(newPhone),
    name: old.name,
    legacyLogin: old.legacyLogin,
  });
  await usersCol().updateOne(
    { _id: old._id },
    { $set: { login: '__migrating_' + oldId } }
  );
  await usersCol().insertOne(newDoc);
  await rewriteUserRefs(oldId, newPhone);
  await usersCol().deleteOne({ _id: old._id });
  return publicUser(newDoc);
}

export async function getProjectsState() {
  await connectMongo();
  const productionProjects = (await listDocsFromCol(projectsCol())).map((p) => ({ ...p, type: p.type || 'dev' }));
  const replenishmentProjects = (await listDocsFromCol(replenishmentProjectsCol())).map((p) => ({
    ...p,
    type: 'rep',
  }));
  const meta = await getProjectsMeta();
  const users = await listUsersPublic();
  const moduleLogs = await getModuleLogsGrouped();
  return {
    productionProjects,
    replenishmentProjects,
    // 過渡相容：舊前端仍讀 projects 混陣列
    projects: [...productionProjects, ...replenishmentProjects],
    projSeq: typeof meta.projSeq === 'number' ? meta.projSeq : 1,
    repProjSeq: typeof meta.repProjSeq === 'number' ? meta.repProjSeq : 1,
    moduleLogs,
    users,
  };
}

export async function saveProjectsState(data) {
  await connectMongo();
  // users 唯一真相在 users collection — 忽略 body.users
  let productionProjects = Array.isArray(data?.productionProjects) ? data.productionProjects : null;
  let replenishmentProjects = Array.isArray(data?.replenishmentProjects) ? data.replenishmentProjects : null;
  if (!productionProjects && !replenishmentProjects && Array.isArray(data?.projects)) {
    productionProjects = data.projects.filter((p) => p && p.type !== 'rep');
    replenishmentProjects = data.projects.filter((p) => p && p.type === 'rep');
  }
  if (!productionProjects) productionProjects = [];
  if (!replenishmentProjects) replenishmentProjects = [];

  await replaceProjectCollection(projectsCol(), productionProjects, 'dev');
  await replaceProjectCollection(replenishmentProjectsCol(), replenishmentProjects, 'rep');

  const projSeq = typeof data?.projSeq === 'number' ? data.projSeq : 1;
  const repProjSeq = typeof data?.repProjSeq === 'number' ? data.repProjSeq : 1;
  await metaCol().updateOne(
    { _id: 'projects' },
    {
      $set: { projSeq, repProjSeq, updatedAt: new Date() },
      $unset: { moduleLogs: '' },
    },
    { upsert: true }
  );

  if (data?.moduleLogs && typeof data.moduleLogs === 'object') {
    await replaceModuleLogsFromBlob(data.moduleLogs);
  }
  return { ok: true };
}

export const NOTICE_CATS = {
  restock: { name: '補貨', key: 'restock' },
  price: { name: '價錢更新', key: 'price' },
  urgent: { name: '緊急資訊', key: 'urgent' },
  general: { name: '一般資訊', key: 'general' },
  transfer: { name: '貨品調動', key: 'transfer' },
};

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapCategoryToCat(category) {
  const s = String(category || '');
  if (s.includes('調動') || s === 'transfer') return 'transfer';
  if (s.includes('補貨') || s === 'restock') return 'restock';
  if (s.includes('價錢') || s === 'price') return 'price';
  if (s.includes('緊急') || s.includes('突發') || s === 'urgent') return 'urgent';
  return 'general';
}

function categoryLabelFromCat(cat) {
  return NOTICE_CATS[cat]?.name || '一般資訊';
}

function recipientIdsOf(item) {
  if (!item) return [];
  if (Array.isArray(item.recipientIds) && item.recipientIds.length) {
    return [...new Set(item.recipientIds.map(String))];
  }
  return [...new Set((item.recipients || []).map((r) => String(r.userId || r)).filter(Boolean))];
}

function syncRecipientReadFlags(item) {
  const ids = recipientIdsOf(item);
  const readers = item.readers && typeof item.readers === 'object' ? item.readers : {};
  item.readers = readers;
  item.recipients = ids.map((userId) => {
    const prev = (item.recipients || []).find((r) => String(r.userId) === userId) || {};
    const st = readers[userId]?.status || (prev.read ? 'read' : 'unopen');
    const read = st === 'read';
    const readAt = read
      ? readers[userId]?.confirmTime || prev.readAt || null
      : null;
    return { userId, read, readAt, status: st, openTime: readers[userId]?.openTime || null, confirmTime: readers[userId]?.confirmTime || null };
  });
  return item;
}

/** 舊通知映射新模型；必要時自動到期完結 */
export function normalizeNotification(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const n = { ...raw };
  const cat = n.cat || mapCategoryToCat(n.category);
  n.cat = cat;
  n.category = n.category || categoryLabelFromCat(cat);
  n.summary = n.summary != null ? String(n.summary) : '';
  n.startDate = n.startDate || null;
  n.endDate = n.endDate || null;
  n.recipientDesc = n.recipientDesc || '';
  n.pinned = !!n.pinned || cat === 'urgent' || n.priority === '緊急';
  n.logs = Array.isArray(n.logs) ? n.logs : [];
  if (!n.status) n.status = '進行中';
  const ids = recipientIdsOf(n);
  if (!n.readers || typeof n.readers !== 'object') n.readers = {};
  for (const uid of ids) {
    if (!n.readers[uid]) {
      const prev = (n.recipients || []).find((r) => String(r.userId) === uid);
      if (prev && prev.read) {
        n.readers[uid] = {
          status: 'read',
          openTime: prev.readAt || null,
          confirmTime: prev.readAt || null,
        };
      } else {
        n.readers[uid] = { status: 'unopen', openTime: null, confirmTime: null };
      }
    }
  }
  // 到期自動完結（非調動）
  if (n.cat !== 'transfer' && n.status === '進行中' && n.endDate && String(n.endDate) < todayYmd()) {
    n.status = '已完結';
    n.logs = [
      {
        time: formatHkDateTime(new Date()),
        user: '系統',
        userId: 'system',
        action: '自動完結',
        detail: '已到完結日期',
      },
      ...n.logs,
    ];
  }
  syncRecipientReadFlags(n);
  return n;
}

export async function getNotificationsState() {
  await connectMongo();
  const doc = await notificationsCol().findOne({ _id: 'main' });
  if (!doc) return { ...EMPTY_NOTIFICATIONS };
  const { _id, updatedAt, ...rest } = doc;
  let notifications = Array.isArray(rest.notifications) ? rest.notifications.map(normalizeNotification) : [];
  const notifSeq = typeof rest.notifSeq === 'number' ? rest.notifSeq : 1;
  // persist auto-ended / normalized shape when status changed
  let dirty = false;
  const orig = Array.isArray(rest.notifications) ? rest.notifications : [];
  if (orig.length === notifications.length) {
    for (let i = 0; i < notifications.length; i++) {
      if (orig[i]?.status !== notifications[i]?.status || !orig[i]?.readers) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty) {
    await saveNotificationsState({ notifications, notifSeq });
  }
  return { notifications, notifSeq };
}

function viewerReaderSlice(item, viewerId, full) {
  const ids = recipientIdsOf(item);
  const readers = item.readers || {};
  if (full) {
    return ids.map((userId) => {
      const r = readers[userId] || { status: 'unopen' };
      return {
        userId,
        read: r.status === 'read',
        readAt: r.confirmTime || null,
        status: r.status || 'unopen',
        openTime: r.openTime || null,
        confirmTime: r.confirmTime || null,
      };
    });
  }
  const r = readers[viewerId] || { status: 'unopen' };
  return [
    {
      userId: viewerId,
      read: r.status === 'read',
      readAt: r.confirmTime || null,
      status: r.status || 'unopen',
      openTime: r.openTime || null,
      confirmTime: r.confirmTime || null,
    },
  ];
}

/** 依檢視者過濾：非發送人只能看到自己的 recipient；發送人可見完整已讀名單 */
export function filterNotificationForViewer(item, viewerId) {
  if (!item || !viewerId) return null;
  const n = normalizeNotification(item);
  const vid = String(viewerId);
  const isSender = String(n.fromUserId || '') === vid;
  const ids = recipientIdsOf(n);
  const isRecip = ids.includes(vid);
  const isAdmin = false; // admin still needs membership; elevated views handled by caller with full list if needed
  if (!isSender && !isRecip && !isAdmin) return null;
  const { recipients: _r, readers: _readers, ...rest } = n;
  return {
    ...rest,
    readers: isSender ? n.readers : { [vid]: n.readers?.[vid] || { status: 'unopen' } },
    recipients: viewerReaderSlice(n, vid, isSender),
  };
}

/** 管理層可見全部公告（含非收件）；調動仍僅收件／發送人 */
export function filterNotificationForViewerWithRole(item, user) {
  const me = publicUser(user);
  const vid = me?.id ? String(me.id) : '';
  if (!vid) return null;
  const n = normalizeNotification(item);
  const isSender = String(n.fromUserId || '') === vid;
  const ids = recipientIdsOf(n);
  const isRecip = ids.includes(vid);
  const isMgr = me.role === 'system_admin' || me.role === 'manager' || isAdminAccount(me);
  if (n.cat === 'transfer' || n.actionType === 'transfer_decide') {
    if (!isSender && !isRecip) return null;
    return filterNotificationForViewer(n, vid);
  }
  if (!isSender && !isRecip && !isMgr) return null;
  const full = isSender || isMgr;
  const { recipients: _r, ...rest } = n;
  return {
    ...rest,
    readers: full ? n.readers : { [vid]: n.readers?.[vid] || { status: 'unopen' } },
    recipients: viewerReaderSlice(n, vid, full),
  };
}

export async function getNotificationsStateForUser(user) {
  const state = await getNotificationsState();
  const me = publicUser(user);
  const viewerId = me?.id ? String(me.id) : '';
  if (!viewerId) {
    return { notifications: [], notifSeq: state.notifSeq };
  }
  const notifications = (state.notifications || [])
    .map((n) => filterNotificationForViewerWithRole(n, user))
    .filter(Boolean);
  return { notifications, notifSeq: state.notifSeq };
}

export async function saveNotificationsState(data) {
  await connectMongo();
  const payload = {
    notifications: Array.isArray(data?.notifications) ? data.notifications : [],
    notifSeq: typeof data?.notifSeq === 'number' ? data.notifSeq : 1,
    _id: 'main',
    updatedAt: new Date(),
  };
  await notificationsCol().replaceOne({ _id: 'main' }, payload, { upsert: true });
  return { ok: true };
}

export async function createNotification(input) {
  await connectMongo();
  const state = await getNotificationsState();
  const recipientIds = Array.isArray(input?.recipientIds)
    ? [...new Set(input.recipientIds.map(String).filter(Boolean))]
    : [];
  if (!recipientIds.length) throw new Error('recipientIds required');
  const attachments = Array.isArray(input?.attachments)
    ? input.attachments
        .filter((f) => f && (f.name || f.driveFileId || f.dataUrl))
        .map((f) => ({
          name: String(f.name || 'file'),
          driveFileId: f.driveFileId ? String(f.driveFileId) : undefined,
          dataUrl: f.dataUrl && !f.driveFileId ? String(f.dataUrl) : undefined,
          mimeType: f.mimeType ? String(f.mimeType) : undefined,
          by: f.by ? String(f.by) : undefined,
          time: f.time ? String(f.time) : undefined,
        }))
    : [];
  let content = String(input?.content || '').trim();
  if (!content && !attachments.length) throw new Error('content or attachments required');
  if (!content && attachments.length) content = '（見附件）';
  const id = 'N' + String(state.notifSeq).padStart(3, '0');
  const now = new Date();
  const createdAt = input?.createdAt || formatHkDateTime(now);
  const cat = input?.cat || mapCategoryToCat(input?.category);
  const category = String(input?.category || categoryLabelFromCat(cat));
  const priority = String(input?.priority || '一般');
  const title = String(input?.title || '').trim();
  const summary = String(input?.summary || '').trim() || title || content.slice(0, 80);
  const readers = {};
  for (const userId of recipientIds) {
    readers[userId] = { status: 'unopen', openTime: null, confirmTime: null };
  }
  const item = normalizeNotification({
    id,
    cat,
    category,
    priority,
    title,
    summary,
    content,
    attachments,
    fromUserId: String(input?.fromUserId || ''),
    fromName: String(input?.fromName || ''),
    createdAt,
    createdAtMs: Number(input?.createdAtMs) || now.getTime(),
    startDate: input?.startDate || todayYmd(),
    endDate: input?.endDate || null,
    recipientDesc: String(input?.recipientDesc || ''),
    pinned: input?.pinned != null ? !!input.pinned : cat === 'urgent' || priority === '緊急',
    status: '進行中',
    readers,
    recipients: recipientIds.map((userId) => ({ userId, read: false, readAt: null })),
    logs: [
      {
        time: createdAt,
        user: String(input?.fromName || ''),
        userId: String(input?.fromUserId || ''),
        action: '發布通知',
        detail: `${category}｜接收 ${recipientIds.length} 人${input?.recipientDesc ? '｜' + input.recipientDesc : ''}`,
      },
    ],
  });
  if (input?.actionType) item.actionType = String(input.actionType);
  if (input?.transferId) item.transferId = String(input.transferId);
  if (input?.transferResolved != null) item.transferResolved = !!input.transferResolved;
  state.notifications.unshift(item);
  state.notifSeq = (state.notifSeq || 1) + 1;
  await saveNotificationsState(state);
  return item;
}

function findNoticeInState(state, id) {
  const idx = state.notifications.findIndex((n) => n.id === id);
  if (idx < 0) return { idx: -1, item: null };
  const item = normalizeNotification(state.notifications[idx]);
  state.notifications[idx] = item;
  return { idx, item };
}

export async function setNotificationReadState(id, userId, read) {
  await connectMongo();
  const state = await getNotificationsState();
  const { item } = findNoticeInState(state, id);
  if (!item) throw new Error('Notification not found');
  const uid = String(userId);
  if (!recipientIdsOf(item).includes(uid)) throw new Error('Not a recipient');
  if (!item.readers) item.readers = {};
  const time = formatHkDateTime(new Date());
  if (read) {
    const prev = item.readers[uid] || {};
    item.readers[uid] = {
      status: 'read',
      openTime: prev.openTime || time,
      confirmTime: time,
    };
  } else {
    // 公告確認後不可自行改回未讀；調動仍允許切換
    if (item.cat !== 'transfer' && item.actionType !== 'transfer_decide') {
      throw new Error('已確認閱讀的公告不可改回未讀');
    }
    item.readers[uid] = { status: 'unopen', openTime: null, confirmTime: null };
  }
  syncRecipientReadFlags(item);
  await saveNotificationsState(state);
  return item;
}

export async function markNotificationRead(id, userId) {
  return setNotificationReadState(id, userId, true);
}

export async function markNotificationUnread(id, userId) {
  return setNotificationReadState(id, userId, false);
}

export async function openNotification(id, userId) {
  await connectMongo();
  const state = await getNotificationsState();
  const { item } = findNoticeInState(state, id);
  if (!item) throw new Error('Notification not found');
  const uid = String(userId);
  if (!recipientIdsOf(item).includes(uid)) return item;
  if (!item.readers) item.readers = {};
  const cur = item.readers[uid];
  if (!cur || cur.status === 'unopen') {
    const time = formatHkDateTime(new Date());
    item.readers[uid] = { status: 'opened', openTime: time, confirmTime: null };
    item.logs = [
      {
        time,
        user: uid,
        userId: uid,
        action: '開啟通知',
        detail: item.title || item.id,
      },
      ...(item.logs || []),
    ];
    syncRecipientReadFlags(item);
    await saveNotificationsState(state);
  }
  return item;
}

export async function confirmNotificationRead(id, user, userLogin) {
  const me = publicUser(user);
  const uid = String(me?.id || '');
  if (!uid) throw new Error('未登入');
  await connectMongo();
  const state = await getNotificationsState();
  const { item } = findNoticeInState(state, id);
  if (!item) throw new Error('Notification not found');
  if (item.cat === 'transfer' || item.actionType === 'transfer_decide') {
    return markNotificationRead(id, uid);
  }
  if (!recipientIdsOf(item).includes(uid)) throw new Error('Not a recipient');
  if (item.status !== '進行中') throw new Error('此通知已完結，無法再確認');
  const time = formatHkDateTime(new Date());
  const prev = item.readers?.[uid] || {};
  item.readers[uid] = {
    status: 'read',
    openTime: prev.openTime || time,
    confirmTime: time,
  };
  item.logs = [
    {
      time,
      user: me.name || me.login || uid,
      userId: uid,
      action: '確認已讀',
      detail: `${me.name || ''}（${userLogin || me.login || uid}）已確認`,
    },
    ...(item.logs || []),
  ];
  syncRecipientReadFlags(item);
  await saveNotificationsState(state);
  await appendModuleLog({
    module: 'push',
    time,
    action: '確認已讀',
    detail: `${item.id}｜${item.title || ''}`,
    userId: uid,
    userName: me.name || me.login || uid,
    user: me.name || me.login || uid,
  });
  return item;
}

export async function endNotification(id, actor, { mode, reason } = {}) {
  const me = publicUser(actor);
  const uid = String(me?.id || '');
  if (!uid) throw new Error('未登入');
  await connectMongo();
  const state = await getNotificationsState();
  const { item } = findNoticeInState(state, id);
  if (!item) throw new Error('Notification not found');
  if (item.cat === 'transfer' || item.actionType === 'transfer_decide') {
    throw new Error('調動通知不可由此完結');
  }
  const isMgr = me.role === 'system_admin' || me.role === 'manager' || isAdminAccount(me);
  if (String(item.fromUserId) !== uid && !isMgr) throw new Error('只有發布人或管理層可完結通知');
  if (item.status !== '進行中') throw new Error('通知已非進行中');
  const r = String(reason || '').trim();
  if (!r) throw new Error('請填寫原因');
  const ids = recipientIdsOf(item);
  let read = 0;
  for (const id2 of ids) {
    if (item.readers?.[id2]?.status === 'read') read++;
  }
  const time = formatHkDateTime(new Date());
  item.status = mode === '取消通知' ? '已取消' : '已提早完結';
  item.logs = [
    {
      time,
      user: me.name || me.login || uid,
      userId: uid,
      action: item.status === '已取消' ? '取消通知' : '提早完結',
      detail: `原因：${r}｜當時已讀 ${read}／${ids.length}`,
    },
    ...(item.logs || []),
  ];
  await saveNotificationsState(state);
  await appendModuleLog({
    module: 'push',
    time,
    action: item.status,
    detail: `${item.id}｜${r}`,
    userId: uid,
    userName: me.name || me.login || uid,
    user: me.name || me.login || uid,
  });
  return item;
}

export async function toggleNotificationPin(id, actor) {
  const me = publicUser(actor);
  const uid = String(me?.id || '');
  if (!uid) throw new Error('未登入');
  const isMgr = me.role === 'system_admin' || me.role === 'manager' || isAdminAccount(me);
  if (!isMgr) throw new Error('只有管理層可置頂');
  await connectMongo();
  const state = await getNotificationsState();
  const { item } = findNoticeInState(state, id);
  if (!item) throw new Error('Notification not found');
  item.pinned = !item.pinned;
  const time = formatHkDateTime(new Date());
  item.logs = [
    {
      time,
      user: me.name || me.login || uid,
      userId: uid,
      action: item.pinned ? '置頂通知' : '取消置頂',
      detail: '',
    },
    ...(item.logs || []),
  ];
  await saveNotificationsState(state);
  return item;
}

export async function uploadFile({ buffer, filename, mimeType }) {
  await connectMongo();
  const id = new ObjectId();
  const stream = bucket.openUploadStreamWithId(id, filename || 'upload.bin', {
    contentType: mimeType || 'application/octet-stream',
    metadata: { originalName: filename || 'upload.bin' },
  });
  await new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(stream)
      .on('error', reject)
      .on('finish', resolve);
  });
  return {
    id: String(id),
    name: filename || 'upload.bin',
    mimeType: mimeType || 'application/octet-stream',
    size: buffer.length,
  };
}

export async function downloadFile(fileId) {
  await connectMongo();
  let oid;
  try {
    oid = new ObjectId(fileId);
  } catch {
    throw new Error('Invalid file id');
  }
  const files = db.collection('uploads.files');
  const meta = await files.findOne({ _id: oid });
  if (!meta) throw new Error('File not found');
  const stream = bucket.openDownloadStream(oid);
  return {
    stream,
    name: meta.filename || 'file',
    mimeType: meta.contentType || 'application/octet-stream',
  };
}

/* ═══════════ Auth / sessions ═══════════ */
export async function createSession(userId) {
  await connectMongo();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sessionsCol().insertOne({
    _id: token,
    userId: String(userId),
    expiresAt,
    createdAt: new Date(),
  });
  return { token, expiresAt };
}

export async function getSessionUser(token) {
  if (!token) return null;
  await connectMongo();
  const session = await sessionsCol().findOne({ _id: String(token) });
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    await sessionsCol().deleteOne({ _id: session._id });
    return null;
  }
  const user = await getUserById(session.userId);
  if (!user || user.active === false) return null;
  return user;
}

export async function destroySession(token) {
  if (!token) return;
  await connectMongo();
  await sessionsCol().deleteOne({ _id: String(token) });
}

export async function loginWithPassword(login, pw) {
  await connectMongo();
  const user = await getUserByLogin(String(login || '').trim());
  if (!user || user.active === false) throw new Error('登入名稱或密碼錯誤');
  if (String(user.pw) !== String(pw)) throw new Error('登入名稱或密碼錯誤');
  const { token, expiresAt } = await createSession(user.id || user._id);
  const pub = publicUser(user);
  return { token, expiresAt, user: pub, needsPhoneBind: !!pub.needsPhoneBind };
}

/** 登入者自行更改密碼（需驗證目前密碼） */
export async function changeOwnPassword(userId, currentPw, newPw) {
  await connectMongo();
  const user = await getUserById(userId);
  if (!user || user.active === false) throw new Error('找不到用戶');
  if (String(user.pw) !== String(currentPw ?? '')) throw new Error('目前密碼不正確');
  const next = String(newPw ?? '');
  if (next.length < 4) throw new Error('新密碼至少 4 個字元');
  if (next.length > 64) throw new Error('新密碼過長（最多 64 字元）');
  if (next === String(user.pw)) throw new Error('新密碼不可與目前密碼相同');
  await usersCol().updateOne({ _id: user._id }, { $set: { pw: next } });
  return publicUser({ ...user, pw: next });
}

export function canCreateEmployee(user) {
  if (!user) return false;
  return user.role === 'system_admin' || user.role === 'manager' || user.position === '經理' || user.position === '主管' || isAdminAccount(user);
}

const TRANSFER_SEED_PRODUCTS = [
  { id: 'WS-S001', name: '成人 2mm 防寒膠衣', category: '成人膠衣', color: '黑', sizes: ['S', 'M', 'L', 'XL'], safetyStock: 4 },
  { id: 'WS-F001', name: '成人抓毛套裝', category: '成人抓毛', color: '灰', sizes: ['S', 'M', 'L', 'XL'], safetyStock: 5 },
  { id: 'WS-U001', name: '成人長袖防曬衣', category: '防曬用品', color: '白', sizes: ['S', 'M', 'L', 'XL', 'XXL'], safetyStock: 6 },
];

/** 種子庫存：每店每尺碼給定基準，部分故意低於安全存量以便預警示範 */
function seedQtyFor(productId, size, store, safetyStock, sizeIndex) {
  const storeBias = { 觀塘: 1.2, 荔枝角: 1.0, 灣仔: 0.7, 屯門: 0.9 };
  const base = Math.max(0, Math.round(safetyStock * (storeBias[store] || 1) + (sizeIndex % 3) - 1));
  // 灣仔部分尺碼刻意偏低，方便標紅演示
  if (store === '灣仔' && sizeIndex === 0) return Math.max(0, safetyStock - 2);
  if (productId === 'WS-U001' && store === '屯門' && sizeIndex === 0) return Math.max(0, safetyStock - 3);
  return base;
}

function buildSeedInventoryDocs(products, now) {
  const inv = [];
  for (const p of products) {
    (p.sizes || ['均碼']).forEach((size, sizeIndex) => {
      for (const store of TRANSFER_STORES) {
        const qty = seedQtyFor(p.id, size, store, p.safetyStock, sizeIndex);
        inv.push({
          _id: `${p.id}__${size}__${store}`,
          productId: p.id,
          size,
          store,
          quantity: qty,
          updatedAt: now,
        });
      }
    });
  }
  return inv;
}

/** 不再依 WS-* 前綴刪除商品，避免誤刪使用者新增的款號 */
async function trimTransferSeedProducts() {
  return 0;
}

export async function ensureTransferSeed() {
  await connectMongo();
  await trimTransferSeedProducts();
  const existing = await transferProductsCol()
    .find({ $or: [{ _id: { $in: TRANSFER_SEED_PRODUCTS.map((p) => p.id) } }, { id: { $in: TRANSFER_SEED_PRODUCTS.map((p) => p.id) } }] })
    .project({ _id: 1, id: 1 })
    .toArray();
  const have = new Set(existing.map((p) => String(p.id || p._id)));
  const missing = TRANSFER_SEED_PRODUCTS.filter((p) => !have.has(p.id));
  if (!missing.length) return { seeded: false, trimmed: true };
  const now = new Date();
  const products = missing.map((p) => ({
    ...p,
    _id: p.id,
    active: true,
    createdAt: now,
    updatedAt: now,
  }));
  await transferProductsCol().insertMany(products);
  const inv = buildSeedInventoryDocs(missing, now);
  if (inv.length) {
    for (const row of inv) {
      await transferInventoryCol().updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
    }
  }
  console.log('Seeded transfer products/inventory:', products.length, 'products,', inv.length, 'inventory rows');
  return { seeded: true, products: products.length, inventory: inv.length };
}

/**
 * 庫存矩陣列：一列＝款號＋尺碼，含四店數量與是否低於安全存量。
 */
export async function listTransferInventory() {
  await connectMongo();
  await ensureTransferSeed();
  const products = await transferProductsCol().find({ active: { $ne: false } }).sort({ id: 1 }).toArray();
  const invDocs = await transferInventoryCol().find({}).toArray();
  const qtyMap = new Map();
  for (const d of invDocs) {
    qtyMap.set(`${d.productId}__${d.size}__${d.store}`, Number(d.quantity) || 0);
  }
  const rows = [];
  for (const p of products) {
    const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['均碼'];
    const safetyStock = Number(p.safetyStock) || 0;
    for (const size of sizes) {
      const qty = {};
      const low = {};
      let total = 0;
      for (const store of TRANSFER_STORES) {
        const q = qtyMap.has(`${p.id}__${size}__${store}`)
          ? qtyMap.get(`${p.id}__${size}__${store}`)
          : 0;
        qty[store] = q;
        low[store] = q < safetyStock;
        total += q;
      }
      rows.push({
        productId: p.id,
        name: p.name || '',
        category: p.category || '其他',
        color: p.color || '',
        size,
        safetyStock,
        qty,
        low,
        total,
      });
    }
  }
  const fromProducts = products.map((p) => String(p.category || '').trim()).filter(Boolean);
  const categories = [...new Set([...TRANSFER_CATEGORIES, ...fromProducts])].sort((a, b) =>
    a.localeCompare(b, 'zh-Hant')
  );
  return {
    stores: TRANSFER_STORES.slice(),
    categories,
    rows,
  };
}

function normalizeProductId(raw) {
  return String(raw || '').trim();
}

function normalizeSizeList(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[,，、\s]+/);
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseNonNegInt(raw, label) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error(`${label}須為 ≥ 0 的整數`);
  }
  return n;
}

/**
 * 新增商品主檔；四店各尺碼庫存從 0。
 * 全員可操作（由 API requireAuth 把關）。
 */
export async function createTransferProduct(actor, input) {
  await connectMongo();
  await ensureTransferSeed();
  const me = publicUser(actor);
  if (!me?.id) throw new Error('未登入');

  const id = normalizeProductId(input?.id || input?.productId);
  if (!id) throw new Error('請填寫產品編號');
  if (id.length > 64) throw new Error('產品編號過長');
  if (/[\/\\]/.test(id)) throw new Error('產品編號含有不允許的字元');

  const name = String(input?.name || '').trim();
  if (!name) throw new Error('請填寫產品名稱');

  const category = String(input?.category || '').trim();
  if (!category) throw new Error('請選擇或填寫類別');

  const color = String(input?.color || '').trim();
  const sizes = normalizeSizeList(input?.sizes);
  if (!sizes.length) throw new Error('請至少選擇或新增 1 個尺碼');

  const safetyStock = parseNonNegInt(input?.safetyStock, '安全存量');

  const existing = await transferProductsCol().findOne({
    $or: [{ _id: id }, { id }],
  });
  if (existing) throw new Error('產品編號已存在：' + id);

  const now = new Date();
  const time = formatHkDateTime(now);
  const product = {
    _id: id,
    id,
    name,
    category,
    color,
    sizes,
    safetyStock,
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: String(me.id),
    createdByName: me.name || me.login || me.id,
  };
  await transferProductsCol().insertOne(product);

  for (const size of sizes) {
    for (const store of TRANSFER_STORES) {
      const _id = `${id}__${size}__${store}`;
      await transferInventoryCol().updateOne(
        { _id },
        {
          $setOnInsert: {
            _id,
            productId: id,
            size,
            store,
            quantity: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
  }

  const actorName = me.name || me.login || me.id;
  await appendModuleLog({
    module: 'transfer',
    time,
    action: '新增商品',
    detail: `${id}｜${name}｜${category}｜尺碼 ${sizes.join('、')}｜安全存量 ${safetyStock}`,
    userId: me.id,
    userName: actorName,
    user: actorName,
  });
  await recordTransferProductChange({
    productId: id,
    productName: name,
    action: '建立',
    changes: [
      { field: '款號', before: '', after: id },
      { field: '名稱', before: '', after: name },
      { field: '類別', before: '', after: category },
      { field: '顏色', before: '', after: color || '—' },
      { field: '尺碼', before: '', after: sizes.join('、') },
      { field: '安全存量', before: '', after: String(safetyStock) },
    ],
    actor: me,
    actorName,
    now,
    time,
  });

  const { _id, ...rest } = product;
  return rest;
}

function stripTransferProduct(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return {
    id: rest.id || String(_id),
    name: rest.name || '',
    category: rest.category || '其他',
    color: rest.color || '',
    sizes: Array.isArray(rest.sizes) && rest.sizes.length ? rest.sizes.slice() : ['均碼'],
    safetyStock: Number(rest.safetyStock) || 0,
    active: rest.active !== false,
    createdAt: rest.createdAt || null,
    updatedAt: rest.updatedAt || null,
  };
}

async function recordTransferProductChange({ productId, productName, action, changes, actor, actorName, now, time }) {
  if (!Array.isArray(changes) || !changes.length) return null;
  const id = 'PC' + String((now || new Date()).getTime()) + '-' + crypto.randomBytes(2).toString('hex');
  const doc = {
    _id: id,
    id,
    productId,
    productName: productName || '',
    action: action || '編輯',
    changes,
    createdAt: time || formatHkDateTime(now || new Date()),
    createdAtMs: (now || new Date()).getTime(),
    createdBy: String(actor?.id || ''),
    createdByName: actorName || actor?.name || actor?.login || '',
  };
  await transferProductChangesCol().insertOne(doc);
  return doc;
}

export async function listTransferProducts() {
  await connectMongo();
  await ensureTransferSeed();
  const docs = await transferProductsCol().find({ active: { $ne: false } }).sort({ id: 1 }).toArray();
  return docs.map(stripTransferProduct);
}

export async function listTransferProductChanges(limit = 200) {
  await connectMongo();
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const docs = await transferProductChangesCol().find({}).sort({ createdAtMs: -1 }).limit(n).toArray();
  return docs.map((d) => {
    const { _id, ...rest } = d;
    return rest;
  });
}

async function renameTransferProductId(oldId, newId, now) {
  const invDocs = await transferInventoryCol().find({ productId: oldId }).toArray();
  for (const d of invDocs) {
    const nextId = `${newId}__${d.size}__${d.store}`;
    const exists = await transferInventoryCol().findOne({ _id: nextId });
    if (exists) {
      throw new Error('換號失敗：目標庫存列已存在（' + d.size + '／' + d.store + '）');
    }
    await transferInventoryCol().insertOne({
      _id: nextId,
      productId: newId,
      size: d.size,
      store: d.store,
      quantity: Number(d.quantity) || 0,
      createdAt: d.createdAt || now,
      updatedAt: now,
    });
    await transferInventoryCol().deleteOne({ _id: d._id });
  }
  await transferOrdersCol().updateMany({ productId: oldId }, { $set: { productId: newId, updatedAt: now } });
  await transferStockAdjustmentsCol().updateMany({ productId: oldId }, { $set: { productId: newId } });
  await transferProductChangesCol().updateMany({ productId: oldId }, { $set: { productId: newId } });
}

/**
 * 編輯商品主檔：可改名稱／類別／顏色／安全存量／款號／尺碼（增；有條件刪）。
 * 改款號會級聯更新庫存、調動單、校正與主檔變更記錄中的款號。
 */
export async function updateTransferProduct(actor, oldProductId, input) {
  await connectMongo();
  await ensureTransferSeed();
  const me = publicUser(actor);
  if (!me?.id) throw new Error('未登入');

  const currentId = normalizeProductId(oldProductId);
  if (!currentId) throw new Error('缺少產品編號');

  const product = await transferProductsCol().findOne({
    $or: [{ _id: currentId }, { id: currentId }],
    active: { $ne: false },
  });
  if (!product) throw new Error('找不到商品');

  const nextId = normalizeProductId(input?.id || input?.productId || currentId);
  if (!nextId) throw new Error('請填寫產品編號');
  if (nextId.length > 64) throw new Error('產品編號過長');
  if (/[\/\\]/.test(nextId)) throw new Error('產品編號含有不允許的字元');

  if (nextId !== currentId) {
    const clash = await transferProductsCol().findOne({
      $or: [{ _id: nextId }, { id: nextId }],
    });
    if (clash) throw new Error('產品編號已存在：' + nextId);
  }

  const name = String(input?.name != null ? input.name : product.name || '').trim();
  if (!name) throw new Error('請填寫產品名稱');
  const category = String(input?.category != null ? input.category : product.category || '').trim();
  if (!category) throw new Error('請選擇或填寫類別');
  const color = String(input?.color != null ? input.color : product.color || '').trim();
  const safetyStock = parseNonNegInt(
    input?.safetyStock != null ? input.safetyStock : product.safetyStock,
    '安全存量'
  );
  const nextSizes = normalizeSizeList(input?.sizes != null ? input.sizes : product.sizes);
  if (!nextSizes.length) throw new Error('請至少保留 1 個尺碼');

  const prevSizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes.map(String) : ['均碼'];
  const prevSet = new Set(prevSizes);
  const nextSet = new Set(nextSizes);
  const addedSizes = nextSizes.filter((s) => !prevSet.has(s));
  const removedSizes = prevSizes.filter((s) => !nextSet.has(s));

  for (const size of removedSizes) {
    for (const store of TRANSFER_STORES) {
      const q = await getInventoryQty(currentId, size, store);
      if (q > 0) throw new Error('無法刪除尺碼「' + size + '」：' + store + '仍有庫存 ' + q);
    }
    const pending = await transferOrdersCol().countDocuments({
      productId: currentId,
      size,
      status: 'pending',
    });
    if (pending > 0) throw new Error('無法刪除尺碼「' + size + '」：尚有待審批調動');
  }

  const now = new Date();
  const time = formatHkDateTime(now);
  const actorName = me.name || me.login || me.id;
  const changes = [];
  if (nextId !== currentId) changes.push({ field: '款號', before: currentId, after: nextId });
  if (name !== String(product.name || '')) changes.push({ field: '名稱', before: String(product.name || ''), after: name });
  if (category !== String(product.category || '')) {
    changes.push({ field: '類別', before: String(product.category || ''), after: category });
  }
  if (color !== String(product.color || '')) {
    changes.push({ field: '顏色', before: String(product.color || '') || '—', after: color || '—' });
  }
  if (safetyStock !== (Number(product.safetyStock) || 0)) {
    changes.push({
      field: '安全存量',
      before: String(Number(product.safetyStock) || 0),
      after: String(safetyStock),
    });
  }
  if (addedSizes.length || removedSizes.length) {
    changes.push({
      field: '尺碼',
      before: prevSizes.join('、'),
      after: nextSizes.join('、'),
    });
  }
  if (!changes.length) throw new Error('沒有變更');

  // 先處理尺碼增刪（仍用舊款號），再換號
  for (const size of addedSizes) {
    for (const store of TRANSFER_STORES) {
      const _id = `${currentId}__${size}__${store}`;
      await transferInventoryCol().updateOne(
        { _id },
        {
          $setOnInsert: {
            _id,
            productId: currentId,
            size,
            store,
            quantity: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
  }
  for (const size of removedSizes) {
    await transferInventoryCol().deleteMany({ productId: currentId, size });
  }

  if (nextId !== currentId) {
    await renameTransferProductId(currentId, nextId, now);
    const newDoc = {
      _id: nextId,
      id: nextId,
      name,
      category,
      color,
      sizes: nextSizes,
      safetyStock,
      active: true,
      createdAt: product.createdAt || now,
      updatedAt: now,
      createdBy: product.createdBy || String(me.id),
      createdByName: product.createdByName || actorName,
    };
    await transferProductsCol().insertOne(newDoc);
    await transferProductsCol().deleteOne({ _id: product._id });
    await transferOrdersCol().updateMany({ productId: nextId }, { $set: { productName: name } });
  } else {
    await transferProductsCol().updateOne(
      { _id: product._id },
      {
        $set: {
          id: currentId,
          name,
          category,
          color,
          sizes: nextSizes,
          safetyStock,
          updatedAt: now,
        },
      }
    );
    await transferOrdersCol().updateMany({ productId: currentId }, { $set: { productName: name } });
  }

  await recordTransferProductChange({
    productId: nextId,
    productName: name,
    action: '編輯',
    changes,
    actor: me,
    actorName,
    now,
    time,
  });
  await appendModuleLog({
    module: 'transfer',
    time,
    action: '編輯商品',
    detail: changes.map((c) => c.field + ' ' + c.before + '→' + c.after).join('｜'),
    userId: me.id,
    userName: actorName,
    user: actorName,
  });

  const updated = await transferProductsCol().findOne({ $or: [{ _id: nextId }, { id: nextId }] });
  return stripTransferProduct(updated);
}

/**
 * 手改某一款號×尺碼的四店庫存（整數 ≥ 0），並寫入校正記錄。
 */
export async function setTransferInventoryQuantities(actor, input) {
  await connectMongo();
  await ensureTransferSeed();
  const me = publicUser(actor);
  if (!me?.id) throw new Error('未登入');

  const productId = normalizeProductId(input?.productId || input?.id);
  const size = String(input?.size || '').trim();
  if (!productId || !size) throw new Error('缺少產品編號或尺碼');

  const product = await transferProductsCol().findOne({
    $or: [{ _id: productId }, { id: productId }],
    active: { $ne: false },
  });
  if (!product) throw new Error('找不到商品');
  const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['均碼'];
  if (!sizes.includes(size)) throw new Error('此商品沒有該尺碼');

  const qtyInput = input?.qty && typeof input.qty === 'object' ? input.qty : input?.quantities;
  if (!qtyInput || typeof qtyInput !== 'object') throw new Error('請提供四店庫存數量');

  const before = {};
  const after = {};
  for (const store of TRANSFER_STORES) {
    before[store] = await getInventoryQty(productId, size, store);
    if (qtyInput[store] === undefined || qtyInput[store] === null || qtyInput[store] === '') {
      after[store] = before[store];
    } else {
      after[store] = parseNonNegInt(qtyInput[store], store + '庫存');
    }
  }

  const changed = TRANSFER_STORES.some((s) => before[s] !== after[s]);
  if (!changed) throw new Error('數量沒有變更');

  const now = new Date();
  const time = formatHkDateTime(now);
  for (const store of TRANSFER_STORES) {
    if (before[store] === after[store]) continue;
    const _id = `${productId}__${size}__${store}`;
    await transferInventoryCol().updateOne(
      { _id },
      {
        $set: { productId, size, store, quantity: after[store], updatedAt: now },
        $setOnInsert: { _id, createdAt: now },
      },
      { upsert: true }
    );
  }

  const adjId = 'AD' + String(now.getTime()) + '-' + crypto.randomBytes(2).toString('hex');
  const actorName = me.name || me.login || me.id;
  const adjustment = {
    _id: adjId,
    id: adjId,
    productId,
    productName: product.name || '',
    size,
    before,
    after,
    createdAt: time,
    createdAtMs: now.getTime(),
    createdBy: String(me.id),
    createdByName: actorName,
  };
  await transferStockAdjustmentsCol().insertOne(adjustment);

  const detailParts = TRANSFER_STORES.filter((s) => before[s] !== after[s]).map(
    (s) => `${s} ${before[s]}→${after[s]}`
  );
  await appendModuleLog({
    module: 'transfer',
    time,
    action: '庫存校正',
    detail: `${productId}｜${size}｜${detailParts.join('、')}`,
    userId: me.id,
    userName: actorName,
    user: actorName,
  });

  const { _id, ...rest } = adjustment;
  return rest;
}

export async function listTransferStockAdjustments(limit = 200) {
  await connectMongo();
  const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const docs = await transferStockAdjustmentsCol().find({}).sort({ createdAtMs: -1 }).limit(n).toArray();
  return docs.map((d) => {
    const { _id, ...rest } = d;
    return rest;
  });
}

async function getInventoryQty(productId, size, store) {
  const doc = await transferInventoryCol().findOne({ productId, size, store });
  return doc ? Number(doc.quantity) || 0 : 0;
}

async function adjustInventoryQty(productId, size, store, delta) {
  const _id = `${productId}__${size}__${store}`;
  const existing = await transferInventoryCol().findOne({ _id });
  const cur = existing ? Number(existing.quantity) || 0 : 0;
  const next = cur + Number(delta);
  if (next < 0) throw new Error('庫存不足，無法完成調動');
  const now = new Date();
  await transferInventoryCol().updateOne(
    { _id },
    {
      $set: { productId, size, store, quantity: next, updatedAt: now },
      $setOnInsert: { _id, createdAt: now },
    },
    { upsert: true }
  );
  return next;
}

function userBelongsToStore(u, store) {
  const units = Array.isArray(u?.units) ? u.units.filter(Boolean) : [];
  if (!units.length && u?.unit) units.push(u.unit);
  return units.includes(store);
}

function canDecideTransfer(actor, order) {
  if (!actor || !order) return false;
  if (String(actor.id) === String(order.createdBy)) return false;
  if (actor.role === 'system_admin' || actor.role === 'manager') return true;
  return userBelongsToStore(actor, order.fromStore);
}

async function resolveTransferRecipientIds(fromStore) {
  const docs = await usersCol().find({ active: { $ne: false } }).toArray();
  const ids = [];
  for (const raw of docs) {
    const u = publicUser(raw);
    if (!u?.id) continue;
    if (u.role === 'system_admin' || u.role === 'manager' || userBelongsToStore(u, fromStore)) {
      ids.push(String(u.id));
    }
  }
  return [...new Set(ids)];
}

async function markTransferNotificationsResolved(transferId, decisionLabel) {
  const state = await getNotificationsState();
  let changed = false;
  for (const n of state.notifications || []) {
    if (n.actionType === 'transfer_decide' && n.transferId === transferId && !n.transferResolved) {
      n.transferResolved = true;
      n.transferDecision = decisionLabel;
      n.content = `${n.content || ''}\n\n【已處理】${decisionLabel}`;
      changed = true;
    }
  }
  if (changed) await saveNotificationsState(state);
}

function stripTransferOrder(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** 正規化調動單明細（相容舊單：頂層 productId／size／quantity）。 */
function normalizeTransferOrderItems(order) {
  if (!order) return [];
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.map((it) => ({
      productId: String(it.productId || '').trim(),
      productName: String(it.productName || ''),
      category: String(it.category || ''),
      color: String(it.color || ''),
      size: String(it.size || '').trim(),
      quantity: Math.floor(Number(it.quantity)),
    }));
  }
  if (order.productId && order.size) {
    return [
      {
        productId: String(order.productId).trim(),
        productName: String(order.productName || ''),
        category: String(order.category || ''),
        color: String(order.color || ''),
        size: String(order.size).trim(),
        quantity: Math.floor(Number(order.quantity)),
      },
    ];
  }
  return [];
}

function formatTransferItemsSummary(items) {
  if (!items.length) return '';
  if (items.length === 1) {
    const it = items[0];
    return `${it.productId} ${it.size} × ${it.quantity}`;
  }
  const totalQty = items.reduce((s, it) => s + (it.quantity || 0), 0);
  return `${items.length} 項｜共 ${totalQty} 件`;
}

/**
 * 申請調動：發起點＝調入店，調動點＝調出店；通知調出店相關人員信箱。
 * 支援 items[] 多明細；亦相容舊版單筆 productId／size／quantity。
 */
export async function applyTransferRequest(actor, input) {
  await connectMongo();
  await ensureTransferSeed();
  const me = publicUser(actor);
  if (!me?.id) throw new Error('未登入');
  const toStore = String(input?.toStore || '').trim(); // 發起點／調入
  const fromStore = String(input?.fromStore || '').trim(); // 調動點／調出
  const remark = String(input?.remark || '').trim();
  if (!TRANSFER_STORES.includes(toStore) || !TRANSFER_STORES.includes(fromStore)) {
    throw new Error('門市僅限觀塘／荔枝角／灣仔／屯門');
  }
  if (toStore === fromStore) throw new Error('發起點與調動點不可相同');

  let rawItems = Array.isArray(input?.items) ? input.items : null;
  if (!rawItems || !rawItems.length) {
    if (input?.productId && input?.size) {
      rawItems = [{ productId: input.productId, size: input.size, quantity: input.quantity }];
    } else {
      throw new Error('請至少加入一項貨品');
    }
  }

  // 合併同款×尺碼
  const merged = new Map();
  for (const raw of rawItems) {
    const productId = String(raw?.productId || '').trim();
    const size = String(raw?.size || '').trim();
    const quantity = Math.floor(Number(raw?.quantity));
    if (!productId || !size) throw new Error('請指定商品與尺碼');
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error('調動數量須為正整數');
    const key = productId + '\0' + size;
    const prev = merged.get(key);
    if (prev) prev.quantity += quantity;
    else merged.set(key, { productId, size, quantity });
  }

  const items = [];
  for (const draft of merged.values()) {
    const product = await transferProductsCol().findOne({ id: draft.productId, active: { $ne: false } });
    if (!product) throw new Error(`找不到商品 ${draft.productId}`);
    const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['均碼'];
    if (!sizes.includes(draft.size)) throw new Error(`此商品沒有該尺碼（${draft.productId} ${draft.size}）`);
    const available = await getInventoryQty(draft.productId, draft.size, fromStore);
    if (draft.quantity > available) {
      throw new Error(
        `調動點（${fromStore}）庫存不足：${draft.productId} ${draft.size} 現有 ${available}，申請 ${draft.quantity}`
      );
    }
    items.push({
      productId: draft.productId,
      productName: product.name || '',
      category: product.category || '其他',
      color: product.color || '',
      size: draft.size,
      quantity: draft.quantity,
    });
  }

  const now = new Date();
  const id = await nextTransferOrderId();
  const createdAt = formatHkDateTime(now);
  const actorName = String(me.name || me.login || me.id);
  const summary = formatTransferItemsSummary(items);
  const first = items[0];
  const totalQty = items.reduce((s, it) => s + it.quantity, 0);
  const linesDetail = items.map((it) => `${it.productId} ${it.productName || ''}｜尺碼 ${it.size}｜數量 ${it.quantity}`).join('\n');
  const order = {
    _id: id,
    id,
    // 相容舊欄位（首項／彙總）
    productId: first.productId,
    productName: items.length === 1 ? first.productName : `${items.length} 項貨品`,
    category: first.category || '其他',
    color: first.color || '',
    size: items.length === 1 ? first.size : '多項',
    quantity: totalQty,
    items,
    remark,
    toStore,
    fromStore,
    status: 'pending',
    createdBy: String(me.id),
    createdByName: actorName,
    createdAt,
    createdAtMs: now.getTime(),
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    decidedAtMs: null,
    rejectReason: '',
    notificationIds: [],
    logs: [
      {
        time: createdAt,
        timeMs: now.getTime(),
        userId: String(me.id),
        userName: actorName,
        action: '申請調動',
        detail: `${summary}｜發起點（調入）${toStore} ← 調動點（調出）${fromStore}${remark ? '｜備註：' + remark : ''}`,
      },
    ],
  };

  const recipientIds = await resolveTransferRecipientIds(fromStore);
  if (!recipientIds.length) throw new Error('找不到可通知的調動點人員');

  const notif = await createNotification({
    category: '貨品調動',
    priority: '重要',
    title: `調動申請 ${id}｜${summary}`,
    content: [
      `${order.createdByName} 申請貨品調動，請審批。`,
      `單號：${id}`,
      `發起點（調入）：${toStore}`,
      `調動點（調出）：${fromStore}`,
      `明細（${items.length} 行）：`,
      linesDetail,
      remark ? `備註：${remark}` : null,
      '通過後會立即從調出店扣減並加入調入店（整單一次處理）。',
    ]
      .filter(Boolean)
      .join('\n'),
    fromUserId: String(me.id),
    fromName: actorName,
    recipientIds,
    actionType: 'transfer_decide',
    transferId: id,
    transferResolved: false,
  });
  order.notificationIds = [notif.id];
  await transferOrdersCol().insertOne(order);
  await appendModuleLog({
    module: 'transfer',
    time: createdAt,
    action: '申請調動',
    detail: `${id} ${summary} ${fromStore}→${toStore}`,
    userId: me.id,
    userName: order.createdByName,
    user: order.createdByName,
  });
  return stripTransferOrder(order);
}

export async function decideTransferRequest(actor, transferId, decision, reason) {
  await connectMongo();
  const me = publicUser(actor);
  if (!me?.id) throw new Error('未登入');
  const id = String(transferId || '').trim();
  const dec = String(decision || '').trim().toLowerCase();
  if (dec !== 'approve' && dec !== 'reject') throw new Error('decision 須為 approve 或 reject');

  const order = await transferOrdersCol().findOne({ id });
  if (!order) throw new Error('找不到調動單');
  if (order.status !== 'pending') throw new Error('此調動單已處理');

  if (String(me.id) === String(order.createdBy)) {
    throw new Error('不可審批自己的申請');
  }
  if (!canDecideTransfer(me, order)) {
    throw new Error('你沒有權限審批此調動（須為調動點門市人員或管理層）');
  }

  const now = new Date();
  const time = formatHkDateTime(now);
  const actorName = String(me.name || me.login || me.id);
  const items = normalizeTransferOrderItems(order);
  if (!items.length) throw new Error('調動單沒有明細');

  if (dec === 'approve') {
    for (const it of items) {
      const available = await getInventoryQty(it.productId, it.size, order.fromStore);
      if (it.quantity > available) {
        throw new Error(
          `庫存不足，無法通過（${order.fromStore}：${it.productId} ${it.size} 現有 ${available}，申請 ${it.quantity}）。單據仍維持待審批。`
        );
      }
    }
    for (const it of items) {
      await adjustInventoryQty(it.productId, it.size, order.fromStore, -it.quantity);
      await adjustInventoryQty(it.productId, it.size, order.toStore, it.quantity);
    }
    const summary = formatTransferItemsSummary(items);
    order.status = 'approved';
    order.decidedBy = String(me.id);
    order.decidedByName = actorName;
    order.decidedAt = time;
    order.decidedAtMs = now.getTime();
    order.logs.push({
      time,
      timeMs: now.getTime(),
      userId: String(me.id),
      userName: actorName,
      action: '通過',
      detail: `已從 ${order.fromStore} 扣出並加入 ${order.toStore}｜${summary}`,
    });
    await transferOrdersCol().replaceOne({ _id: order._id }, order);
    await markTransferNotificationsResolved(id, `已通過（${actorName}）`);
    await appendModuleLog({
      module: 'transfer',
      time,
      action: '通過調動',
      detail: `${id} ${summary} ${order.fromStore}→${order.toStore}`,
      userId: me.id,
      userName: actorName,
      user: actorName,
    });
    return stripTransferOrder(order);
  }

  const rejectReason = String(reason || '').trim();
  order.status = 'rejected';
  order.decidedBy = String(me.id);
  order.decidedByName = actorName;
  order.decidedAt = time;
  order.decidedAtMs = now.getTime();
  order.rejectReason = rejectReason;
  order.logs.push({
    time,
    timeMs: now.getTime(),
    userId: String(me.id),
    userName: actorName,
    action: '拒絕',
    detail: rejectReason || '（無理由）',
  });
  await transferOrdersCol().replaceOne({ _id: order._id }, order);
  await markTransferNotificationsResolved(id, `已拒絕（${actorName}）${rejectReason ? '：' + rejectReason : ''}`);
  await appendModuleLog({
    module: 'transfer',
    time,
    action: '拒絕調動',
    detail: `${id}${rejectReason ? '｜' + rejectReason : ''}`,
    userId: me.id,
    userName: actorName,
    user: actorName,
  });
  return stripTransferOrder(order);
}

export async function listTransferOrders() {
  await connectMongo();
  const docs = await transferOrdersCol().find({}).sort({ createdAtMs: -1 }).toArray();
  return docs.map(stripTransferOrder);
}

export async function getTransferOrder(id) {
  await connectMongo();
  const doc = await transferOrdersCol().findOne({ id: String(id || '') });
  return stripTransferOrder(doc);
}

/* ═══════════ POS（與調動庫存分離） ═══════════ */
const POS_STORES = ['觀塘', '荔枝角', '灣仔', '屯門'];

function posProductsCol() {
  return db.collection('pos_products');
}
function posTransactionsCol() {
  return db.collection('pos_transactions');
}
function posMetaCol() {
  return db.collection('pos_meta');
}

function posIsSystemAdmin(user) {
  const me = publicUser(user);
  return !!(me && (me.role === 'system_admin' || isAdminAccount(me)));
}
function posCanManageCatalog(user) {
  const me = publicUser(user);
  if (!me) return false;
  if (posIsSystemAdmin(me)) return true;
  return me.role === 'manager' || me.position === '經理' || me.position === '主管';
}
function posUserStores(user) {
  const me = publicUser(user);
  let units = Array.isArray(me?.units) ? me.units.filter(Boolean) : [];
  if (!units.length && me?.unit) units = [me.unit];
  const list = units.filter((u) => POS_STORES.includes(u));
  if (!list.length && posCanManageCatalog(me)) return POS_STORES.slice();
  return list;
}
function posSeedStock(n) {
  const o = {};
  for (const s of POS_STORES) o[s] = n;
  return o;
}
function posSeedProducts() {
  const now = formatHkDateTime();
  return [
    { id: 'p1', name: 'Speedo 小童印花 Muscleback 連身泳衣 - 粉紅', sku: '80832418374', size: '28', price: 305, stock: posSeedStock(8), updatedAt: now },
    { id: 'p2', name: '訓練蛙掌-藍', sku: 'AR1129BU', size: 'S', price: 117, stock: posSeedStock(12), updatedAt: now },
    { id: 'p3', name: '女童純色雙層X背帶連身泳衣-黑', sku: 'WS-434BK', size: '10', price: 228, stock: posSeedStock(10), updatedAt: now },
    { id: 'p4', name: '訓練短蹼鞋 - 藍', sku: 'WS-961BU', size: 'XS', price: 238, stock: posSeedStock(9), updatedAt: now },
    { id: 'p5', name: '成人泳鏡-透明', sku: 'WS-MG01', size: '均碼', price: 88, stock: posSeedStock(20), updatedAt: now },
    { id: 'p6', name: '矽膠泳帽-黑', sku: 'WS-CAP-BK', size: '均碼', price: 45, stock: posSeedStock(25), updatedAt: now },
    { id: 'p7', name: '防曬乳液 SPF50 100ml', sku: 'SUN-50-100', size: '100ml', price: 128, stock: posSeedStock(15), updatedAt: now },
    { id: 'p8', name: '成人競賽泳衣-深藍', sku: 'SPD-RACE-NV', size: '32', price: 420, stock: posSeedStock(6), updatedAt: now },
    { id: 'p9', name: '浮板-黃', sku: 'WS-KB-YL', size: '均碼', price: 65, stock: posSeedStock(18), updatedAt: now },
    { id: 'p10', name: '鼻夾耳塞套裝', sku: 'WS-NE-01', size: '均碼', price: 38, stock: posSeedStock(30), updatedAt: now },
    { id: 'p11', name: '兒童防曬衣-白', sku: 'WS-UV-WH', size: '120', price: 198, stock: posSeedStock(11), updatedAt: now },
    { id: 'p12', name: '防水袋 5L-橙', sku: 'DRY-5L-OR', size: '5L', price: 78, stock: posSeedStock(14), updatedAt: now },
  ];
}
function stripPosProduct(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}
function stripPosTransaction(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function ensurePosIndexes() {
  await posProductsCol().createIndex({ id: 1 }, { unique: true });
  await posTransactionsCol().createIndex({ id: 1 }, { unique: true });
  await posTransactionsCol().createIndex({ createdAtMs: -1 });
  await posTransactionsCol().createIndex({ store: 1, createdAtMs: -1 });
  await posMetaCol().createIndex({ _id: 1 });
}

async function ensurePosSeeded() {
  await ensurePosIndexes();
  const count = await posProductsCol().countDocuments();
  if (count > 0) return;
  const products = posSeedProducts();
  await posProductsCol().insertMany(products.map((p) => ({ ...p, _id: p.id })));
  await posMetaCol().updateOne({ _id: 'main' }, { $setOnInsert: { _id: 'main', seq: 1000 } }, { upsert: true });
}

export async function listPosProducts(user) {
  await connectMongo();
  await ensurePosSeeded();
  const docs = await posProductsCol().find({}).sort({ sku: 1 }).toArray();
  return {
    products: docs.map(stripPosProduct),
    stores: posUserStores(user),
    canManage: posCanManageCatalog(user),
    canReset: posIsSystemAdmin(user),
  };
}

export async function listPosTransactions(user) {
  await connectMongo();
  await ensurePosSeeded();
  const me = publicUser(user);
  const isAdmin = posIsSystemAdmin(me);
  const stores = posUserStores(me);
  const filter = isAdmin || !stores.length ? {} : { store: { $in: stores } };
  const docs = await posTransactionsCol().find(filter).sort({ createdAtMs: -1 }).limit(500).toArray();
  return { transactions: docs.map(stripPosTransaction), stores, canManage: posCanManageCatalog(me), canReset: isAdmin };
}

export async function getPosTransaction(user, id) {
  await connectMongo();
  const doc = await posTransactionsCol().findOne({ id: String(id || '') });
  if (!doc) throw new Error('找不到交易');
  const me = publicUser(user);
  if (!posIsSystemAdmin(me)) {
    const stores = posUserStores(me);
    if (stores.length && !stores.includes(doc.store)) throw new Error('無權查看此交易');
  }
  return stripPosTransaction(doc);
}

export async function adjustPosProduct(user, productId, patch = {}) {
  await connectMongo();
  await ensurePosSeeded();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可調整商品');
  const id = String(productId || '');
  const existing = await posProductsCol().findOne({ id });
  if (!existing) throw new Error('找不到商品');
  const $set = { updatedAt: formatHkDateTime() };
  if (patch.price != null && patch.price !== '') {
    const price = Number(patch.price);
    if (!isFinite(price) || price < 0) throw new Error('售價無效');
    $set.price = Math.round(price * 100) / 100;
  }
  if (patch.stock && typeof patch.stock === 'object') {
    for (const store of POS_STORES) {
      if (patch.stock[store] == null || patch.stock[store] === '') continue;
      const n = Number(patch.stock[store]);
      if (!Number.isInteger(n) || n < 0) throw new Error(`庫存無效：${store}`);
      $set[`stock.${store}`] = n;
    }
  }
  const updated = await posProductsCol().findOneAndUpdate(
    { id },
    { $set },
    { returnDocument: 'after' }
  );
  const doc = updated?.value || updated;
  const me = publicUser(user);
  await appendModuleLog({
    module: 'pos',
    time: formatHkDateTime(),
    action: '調整 POS 商品',
    detail: `${id}｜${existing.name}`,
    userId: me?.id,
    userName: me?.name || me?.login,
    user: me?.name || me?.login,
  });
  return stripPosProduct(doc);
}

export async function checkoutPos(user, payload = {}) {
  await connectMongo();
  await ensurePosSeeded();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const store = String(payload.store || '');
  const allowed = posUserStores(me);
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  if (allowed.length && !allowed.includes(store) && !posIsSystemAdmin(me)) {
    throw new Error('不可在非所屬單位收銀');
  }
  const itemsIn = Array.isArray(payload.items) ? payload.items : [];
  if (!itemsIn.length) throw new Error('購物車是空的');
  const paymentMethod = String(payload.paymentMethod || 'cash');
  const paymentNames = { cash: '現金', credit_card: '信用卡', octopus: '八達通', fps: 'FPS' };
  if (!paymentNames[paymentMethod]) throw new Error('支付方式無效');
  const accountBalance = Number(payload.accountBalance || 0);
  if (!isFinite(accountBalance)) throw new Error('賬戶餘額無效');

  const normalized = [];
  for (const raw of itemsIn) {
    const productId = String(raw.productId || '');
    const qty = Number(raw.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) throw new Error('商品數量無效');
    normalized.push({ productId, qty });
  }

  const deducted = [];
  try {
    for (const line of normalized) {
      const res = await posProductsCol().findOneAndUpdate(
        { id: line.productId, [`stock.${store}`]: { $gte: line.qty } },
        {
          $inc: { [`stock.${store}`]: -line.qty },
          $set: { updatedAt: formatHkDateTime() },
        },
        { returnDocument: 'after' }
      );
      const doc = res?.value || res;
      if (!doc || !doc.id) {
        throw new Error(`庫存不足或找不到商品：${line.productId}`);
      }
      deducted.push({ productId: line.productId, qty: line.qty, product: doc });
    }
  } catch (e) {
    for (const d of deducted) {
      try {
        await posProductsCol().updateOne({ id: d.productId }, { $inc: { [`stock.${store}`]: d.qty } });
      } catch (_) {}
    }
    throw e;
  }

  let subtotal = 0;
  const items = deducted.map((d) => {
    const unitPrice = Number(d.product.price) || 0;
    const lineTotal = Math.round(unitPrice * d.qty * 100) / 100;
    subtotal += lineTotal;
    return {
      qty: d.qty,
      name: d.product.name,
      sku: d.product.sku,
      size: d.product.size,
      unitPrice,
      lineTotal,
      productId: d.productId,
    };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  const orderTotal = Math.round((subtotal + accountBalance) * 100) / 100;
  if (orderTotal < 0) {
    for (const d of deducted) {
      await posProductsCol().updateOne({ id: d.productId }, { $inc: { [`stock.${store}`]: d.qty } });
    }
    throw new Error('訂單總計不可為負');
  }

  const meta = await posMetaCol().findOneAndUpdate(
    { _id: 'main' },
    { $inc: { seq: 1 }, $setOnInsert: { _id: 'main' } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = (meta?.value || meta)?.seq || Date.now() % 100000;
  const orderNo = String(3000000 + seq);
  const orderNoAlt = String(50000 + (seq % 10000));
  const year = new Date().getFullYear();
  const invoiceNo = `INV-${year}-${String(seq).padStart(8, '0')}`;
  const id = `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const time = formatHkDateTime();
  const stamp = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  })();
  const tx = {
    _id: id,
    id,
    receiptNo: `R${Date.now().toString(36).toUpperCase()}`,
    orderNo,
    orderNoAlt,
    invoiceNo,
    store,
    staffId: String(me.id),
    staffName: me.name || me.login || '',
    memberId: String(payload.memberId || ''),
    memberName: String(payload.memberName || ''),
    memberPhone: String(payload.memberPhone || ''),
    remark: String(payload.remark || '').trim(),
    paymentMethod,
    paymentMethodName: paymentNames[paymentMethod],
    paymentStatus: '已付款',
    orderStatus: `訂單已完成（${store}店）`,
    items,
    subtotal,
    collected: 0,
    accountBalance,
    orderTotal,
    paid: orderTotal,
    createdAt: stamp,
    createdAtMs: Date.now(),
    createdAtLabel: time,
  };
  await posTransactionsCol().insertOne(tx);
  await appendModuleLog({
    module: 'pos',
    time,
    action: '完成收銀',
    detail: `${store}｜${orderNo}｜$${orderTotal.toFixed(2)}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return stripPosTransaction(tx);
}

export async function resetPosDemo(user) {
  await connectMongo();
  if (!posIsSystemAdmin(user)) throw new Error('只有系統管理員可重置 POS');
  await ensurePosIndexes();
  await posProductsCol().deleteMany({});
  await posTransactionsCol().deleteMany({});
  const products = posSeedProducts();
  await posProductsCol().insertMany(products.map((p) => ({ ...p, _id: p.id })));
  await posMetaCol().replaceOne({ _id: 'main' }, { _id: 'main', seq: 1000 }, { upsert: true });
  const me = publicUser(user);
  await appendModuleLog({
    module: 'pos',
    time: formatHkDateTime(),
    action: '重置雲端 POS',
    detail: '種子商品＋清空交易',
    userId: me?.id,
    userName: me?.name || me?.login,
    user: me?.name || me?.login,
  });
  return { ok: true };
}

export { POS_STORES };

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    bucket = null;
  }
}
