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
  if (w.kind === 'settlement' && /示範每日結算|每日結算示範/.test(String(w.title || ''))) return true;
  if (SAMPLE_TPL_TITLES.has(w.title)) return true;
  return false;
}
function isSampleDailyTemplate(t) {
  return !t || SAMPLE_TPL_TITLES.has(t.title);
}
function isSampleProject(p) {
  if (!p) return true;
  // 不可只憑 P001–P003：真實項目建立時也會用這些 id，否則會被清掉並寫回空列表
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

  // 若拆欄位為空、但舊版混陣列仍有開發項目，以混陣列為準（避免誤寫空庫）
  if (
    productionProjects.length === 0 &&
    Array.isArray(data?.projects) &&
    data.projects.some((p) => p && p.type !== 'rep')
  ) {
    productionProjects = data.projects.filter((p) => p && p.type !== 'rep');
  }

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
    return {
      userId,
      read,
      readAt,
      status: st,
      openTime: readers[userId]?.openTime || null,
      confirmTime: readers[userId]?.confirmTime || null,
      segmentTicks: Array.isArray(readers[userId]?.segmentTicks)
        ? readers[userId].segmentTicks
        : Array.isArray(prev.segmentTicks)
          ? prev.segmentTicks
          : [],
    };
  });
  return item;
}

/** 通知詳細內容段落；舊資料無 segments 時以整段 content 當作一段 */
export function contentSegmentsOf(item) {
  if (!item) return [];
  if (Array.isArray(item.contentSegments) && item.contentSegments.length) {
    return item.contentSegments.map((s) => String(s || '').trim()).filter(Boolean);
  }
  const c = String(item.content || '').trim();
  return c ? [c] : [];
}

/** 人工／系統導航 CTA：僅允許 { mod, view }；調貨操作列不走此欄位 */
const NOTICE_CTA_BLOCKED_VIEWS = new Set(['pushCreate', 'posReset']);
function normalizeNoticeCta(raw) {
  const src = raw && typeof raw === 'object' ? raw : null;
  if (!src) return null;
  const mod = String(src.mod || '').trim();
  const view = String(src.view || '').trim();
  if (!mod || !view) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(mod) || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(view)) return null;
  if (NOTICE_CTA_BLOCKED_VIEWS.has(view)) return null;
  return { mod, view };
}

function normalizeContentSegmentsInput(input, fallbackContent) {
  if (Array.isArray(input?.contentSegments)) {
    return input.contentSegments.map((s) => String(s || '').trim()).filter(Boolean);
  }
  const c = String(fallbackContent || input?.content || '').trim();
  return c ? [c] : [];
}

function ensureReaderSegmentTicks(reader, segmentCount) {
  const prev = Array.isArray(reader?.segmentTicks) ? reader.segmentTicks.slice() : [];
  const ticks = [];
  for (let i = 0; i < segmentCount; i++) ticks.push(!!prev[i]);
  return ticks;
}

function allSegmentsTicked(ticks, segmentCount) {
  if (segmentCount <= 0) return true;
  if (!Array.isArray(ticks) || ticks.length < segmentCount) return false;
  for (let i = 0; i < segmentCount; i++) {
    if (!ticks[i]) return false;
  }
  return true;
}

/** 舊通知映射新模型；必要時自動到期完結 */
export function normalizeNotification(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const n = { ...raw };
  const cat = n.cat || mapCategoryToCat(n.category);
  n.cat = cat;
  n.category = n.category || categoryLabelFromCat(cat);
  n.summary = n.summary != null ? String(n.summary) : '';
  n.contentSegments = contentSegmentsOf(n);
  if (!String(n.content || '').trim() && n.contentSegments.length) {
    n.content = n.contentSegments.join('\n\n');
  }
  n.startDate = n.startDate || null;
  n.endDate = n.endDate || null;
  n.recipientDesc = n.recipientDesc || '';
  n.pinned = !!n.pinned || cat === 'urgent' || n.priority === '緊急';
  n.logs = Array.isArray(n.logs) ? n.logs : [];
  n.cta = normalizeNoticeCta(n.cta);
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
        segmentTicks: Array.isArray(r.segmentTicks) ? r.segmentTicks : [],
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
      segmentTicks: Array.isArray(r.segmentTicks) ? r.segmentTicks : [],
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
  const contentSegments = normalizeContentSegmentsInput(input, content);
  if (!contentSegments.length && !attachments.length) throw new Error('content or attachments required');
  if (!contentSegments.length && attachments.length) {
    content = '（見附件）';
  } else {
    content = contentSegments.join('\n\n');
  }
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
    readers[userId] = {
      status: 'unopen',
      openTime: null,
      confirmTime: null,
      segmentTicks: contentSegments.map(() => false),
    };
  }
  const item = normalizeNotification({
    id,
    cat,
    category,
    priority,
    title,
    summary,
    content,
    contentSegments,
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
  const cta = normalizeNoticeCta(input?.cta);
  if (cta) item.cta = cta;
  else delete item.cta;
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
    item.readers[uid] = {
      status: 'opened',
      openTime: time,
      confirmTime: null,
      segmentTicks: ensureReaderSegmentTicks(cur || {}, contentSegmentsOf(item).length),
    };
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

export async function tickNotificationSegment(id, user, { index, checked } = {}) {
  const me = publicUser(user);
  const uid = String(me?.id || '');
  if (!uid) throw new Error('未登入');
  await connectMongo();
  const state = await getNotificationsState();
  const { item } = findNoticeInState(state, id);
  if (!item) throw new Error('Notification not found');
  if (item.cat === 'transfer' || item.actionType === 'transfer_decide') {
    throw new Error('調動通知不支援段落勾選');
  }
  if (!recipientIdsOf(item).includes(uid)) throw new Error('Not a recipient');
  if (item.status !== '進行中') throw new Error('此通知已完結，無法再勾選');
  const segs = contentSegmentsOf(item);
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= segs.length) {
    throw new Error('段落編號無效');
  }
  if (!item.readers) item.readers = {};
  const prev = item.readers[uid] || { status: 'unopen', openTime: null, confirmTime: null };
  if (prev.status === 'read') throw new Error('已確認已讀，不可更改段落勾選');
  const ticks = ensureReaderSegmentTicks(prev, segs.length);
  ticks[idx] = !!checked;
  const time = formatHkDateTime(new Date());
  item.readers[uid] = {
    status: prev.status === 'unopen' ? 'opened' : prev.status || 'opened',
    openTime: prev.openTime || time,
    confirmTime: null,
    segmentTicks: ticks,
  };
  syncRecipientReadFlags(item);
  await saveNotificationsState(state);
  return item;
}

export async function confirmNotificationRead(id, user, userLogin, opts = {}) {
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
  const segs = contentSegmentsOf(item);
  const prev = item.readers?.[uid] || {};
  let ticks = ensureReaderSegmentTicks(prev, segs.length);
  if (Array.isArray(opts.segmentTicks) && opts.segmentTicks.length) {
    ticks = ensureReaderSegmentTicks({ segmentTicks: opts.segmentTicks }, segs.length);
  }
  if (segs.length && !allSegmentsTicked(ticks, segs.length)) {
    throw new Error('請先勾選所有段落的已讀，才能確認整則通知');
  }
  const time = formatHkDateTime(new Date());
  item.readers[uid] = {
    status: 'read',
    openTime: prev.openTime || time,
    confirmTime: time,
    segmentTicks: segs.length ? ticks : [],
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

export async function deleteFile(fileId) {
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
  await bucket.delete(oid);
  return { ok: true, id: String(oid) };
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

/* ═══════════ POS（庫存以調動 transfer_inventory 為準） ═══════════ */
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
function posDraftsCol() {
  return db.collection('pos_drafts');
}

async function getPosPointsSettingsInternal() {
  await posMetaCol().updateOne(
    { _id: 'points' },
    { $setOnInsert: { _id: 'points', pointsPerDollar: 100, redeemEnabled: true } },
    { upsert: true }
  );
  const doc = await posMetaCol().findOne({ _id: 'points' });
  return {
    pointsPerDollar: Math.max(1, Math.floor(Number(doc?.pointsPerDollar) || 100)),
    redeemEnabled: doc?.redeemEnabled !== false,
  };
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
function stripPosProduct(doc) {
  if (!doc) return null;
  const { _id, stock: _legacyStock, ...rest } = doc;
  return rest;
}
function stripPosTransaction(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function dropPosIndexQuiet(col, nameOrSpec) {
  try {
    await col.dropIndex(nameOrSpec);
  } catch (_) {
    /* index missing is fine */
  }
}

async function ensurePosIndexes() {
  const products = posProductsCol();
  await products.createIndex({ id: 1 }, { unique: true });
  // 舊版非 partial unique 會在 transferProductId 缺失／重複時建立失敗 → 整條 POS API 掛掉
  const existing = await products.indexes().catch(() => []);
  const names = new Set((existing || []).map((i) => i.name));
  if (names.has('transferProductId_1_size_1')) {
    await dropPosIndexQuiet(products, 'transferProductId_1_size_1');
  }
  const partialOk = (existing || []).some(
    (i) => i.name === 'transferProductId_size_unique' && i.unique && i.partialFilterExpression
  );
  if (!partialOk) {
    await dropPosIndexQuiet(products, 'transferProductId_size_unique');
    await products.createIndex(
      { transferProductId: 1, size: 1 },
      {
        unique: true,
        name: 'transferProductId_size_unique',
        partialFilterExpression: {
          transferProductId: { $exists: true, $type: 'string' },
          size: { $exists: true, $type: 'string' },
        },
      }
    );
  }
  await posTransactionsCol().createIndex({ id: 1 }, { unique: true });
  await posTransactionsCol().createIndex({ createdAtMs: -1 });
  await posTransactionsCol().createIndex({ store: 1, createdAtMs: -1 });
  await posDraftsCol().createIndex({ id: 1 }, { unique: true });
  await posDraftsCol().createIndex({ store: 1, updatedAtMs: -1 });
}

async function dedupePosSellablesByTransferSize() {
  const groups = await posProductsCol()
    .aggregate([
      {
        $match: {
          transferProductId: { $type: 'string', $ne: '' },
          size: { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: { transferProductId: '$transferProductId', size: '$size' },
          ids: { $push: '$_id' },
          n: { $sum: 1 },
        },
      },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  for (const g of groups) {
    const drop = (g.ids || []).slice(1);
    if (drop.length) await posProductsCol().deleteMany({ _id: { $in: drop } });
  }
}

let posReadyPromise = null;

/** 清除舊版獨立庫存種子；可售目錄改為掛靠調動貨品 */
async function ensurePosReady() {
  if (posReadyPromise) return posReadyPromise;
  posReadyPromise = (async () => {
    await ensureTransferSeed();
    // 必須先清 orphan／重複，再建立 unique partial index
    await posProductsCol().deleteMany({
      $or: [
        { transferProductId: { $exists: false } },
        { transferProductId: null },
        { transferProductId: '' },
      ],
    });
    await dedupePosSellablesByTransferSize();
    await ensurePosIndexes();
    // 去掉殘留 stock 欄位
    await posProductsCol().updateMany({ stock: { $exists: true } }, { $unset: { stock: '' } });
    await posMetaCol().updateOne({ _id: 'main' }, { $setOnInsert: { _id: 'main', seq: 1000 } }, { upsert: true });
  })().catch((e) => {
    posReadyPromise = null;
    throw e;
  });
  return posReadyPromise;
}

async function buildTransferQtyMap() {
  const invDocs = await transferInventoryCol().find({}).toArray();
  const qtyMap = new Map();
  for (const d of invDocs) {
    qtyMap.set(`${d.productId}__${d.size}__${d.store}`, Number(d.quantity) || 0);
  }
  return qtyMap;
}

function stockFromMap(qtyMap, transferProductId, size) {
  const stock = {};
  for (const store of POS_STORES) {
    stock[store] = qtyMap.get(`${transferProductId}__${size}__${store}`) || 0;
  }
  return stock;
}

export async function listPosProducts(user) {
  await connectMongo();
  await ensurePosReady();
  try {
    const n = await posProductsCol().countDocuments({});
    if (n === 0) await seedPosSamples(user, { force: false });
  } catch (e) {
    console.warn('POS sample seed skipped:', e.message || e);
  }
  const docs = await posProductsCol().find({ active: { $ne: false } }).sort({ sku: 1, name: 1 }).toArray();
  const qtyMap = await buildTransferQtyMap();
  const products = docs.map((d) => {
    const base = stripPosProduct(d);
    return {
      ...base,
      stock: stockFromMap(qtyMap, d.transferProductId, d.size),
    };
  });
  return {
    products,
    stores: posUserStores(user),
    canManage: posCanManageCatalog(user),
    canReset: posIsSystemAdmin(user),
    inventorySource: 'transfer',
  };
}

/** 可加入 POS 的調動貨品×尺碼（尚未掛靠） */
export async function listPosCatalogOptions(user) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可管理可售目錄');
  const products = await transferProductsCol().find({ active: { $ne: false } }).sort({ id: 1 }).toArray();
  const linked = await posProductsCol().find({}).project({ transferProductId: 1, size: 1 }).toArray();
  const linkedSet = new Set(linked.map((x) => `${x.transferProductId}__${x.size}`));
  const options = [];
  for (const p of products) {
    const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['均碼'];
    for (const size of sizes) {
      const key = `${p.id}__${size}`;
      if (linkedSet.has(key)) continue;
      options.push({
        transferProductId: p.id,
        name: p.name || '',
        category: p.category || '',
        color: p.color || '',
        size,
        suggestedSku: `${p.id}-${size}`,
      });
    }
  }
  return { options };
}

export async function addPosSellable(user, input = {}) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可加入可售商品');
  const transferProductId = normalizeProductId(input.transferProductId || input.productId);
  const size = String(input.size || '').trim();
  if (!transferProductId || !size) throw new Error('請選擇調動貨品與尺碼');
  const tp = await transferProductsCol().findOne({
    $or: [{ _id: transferProductId }, { id: transferProductId }],
    active: { $ne: false },
  });
  if (!tp) throw new Error('找不到調動貨品');
  const sizes = Array.isArray(tp.sizes) && tp.sizes.length ? tp.sizes : ['均碼'];
  if (!sizes.includes(size)) throw new Error('此貨品沒有該尺碼');
  const dup = await posProductsCol().findOne({ transferProductId, size });
  if (dup) throw new Error('此貨品尺碼已在可售目錄');
  const price = Number(input.price);
  if (!isFinite(price) || price < 0) throw new Error('請填寫有效售價');
  const sku = String(input.sku || `${transferProductId}-${size}`).trim();
  if (!sku) throw new Error('請填寫條碼／SKU');
  const id = `sell_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = formatHkDateTime();
  const name = String(input.name || tp.name || '').trim() || tp.name;
  const doc = {
    _id: id,
    id,
    transferProductId,
    size,
    name,
    sku,
    price: Math.round(price * 100) / 100,
    active: true,
    category: tp.category || '',
    color: tp.color || '',
    updatedAt: now,
    createdAt: now,
  };
  await posProductsCol().insertOne(doc);
  const me = publicUser(user);
  await appendModuleLog({
    module: 'pos',
    time: now,
    action: '加入可售商品',
    detail: `${transferProductId}｜${size}｜$${doc.price}｜${sku}`,
    userId: me?.id,
    userName: me?.name || me?.login,
    user: me?.name || me?.login,
  });
  const qtyMap = await buildTransferQtyMap();
  return { product: { ...stripPosProduct(doc), stock: stockFromMap(qtyMap, transferProductId, size) } };
}

export async function listPosTransactions(user) {
  await connectMongo();
  await ensurePosReady();
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
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可調整商品');
  const id = String(productId || '');
  const existing = await posProductsCol().findOne({ id });
  if (!existing) throw new Error('找不到可售商品');
  if (patch.stock) throw new Error('庫存請在「貨品調動」校正；POS 不可改數量');
  const $set = { updatedAt: formatHkDateTime() };
  if (patch.price != null && patch.price !== '') {
    const price = Number(patch.price);
    if (!isFinite(price) || price < 0) throw new Error('售價無效');
    $set.price = Math.round(price * 100) / 100;
  }
  if (patch.sku != null) {
    const sku = String(patch.sku).trim();
    if (!sku) throw new Error('SKU／條碼不可空白');
    $set.sku = sku;
  }
  if (patch.active != null) $set.active = !!patch.active;
  if (patch.name != null && String(patch.name).trim()) $set.name = String(patch.name).trim();
  const updated = await posProductsCol().findOneAndUpdate({ id }, { $set }, { returnDocument: 'after' });
  const doc = updated?.value || updated;
  const me = publicUser(user);
  await appendModuleLog({
    module: 'pos',
    time: formatHkDateTime(),
    action: '調整可售商品',
    detail: `${id}｜${existing.transferProductId}｜${existing.size}`,
    userId: me?.id,
    userName: me?.name || me?.login,
    user: me?.name || me?.login,
  });
  const qtyMap = await buildTransferQtyMap();
  return {
    ...stripPosProduct(doc),
    stock: stockFromMap(qtyMap, doc.transferProductId, doc.size),
  };
}

async function deductTransferStock(transferProductId, size, store, qty) {
  const _id = `${transferProductId}__${size}__${store}`;
  const before = await getInventoryQty(transferProductId, size, store);
  const res = await transferInventoryCol().findOneAndUpdate(
    { _id, quantity: { $gte: qty } },
    {
      $inc: { quantity: -qty },
      $set: { productId: transferProductId, size, store, updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );
  const doc = res?.value || res;
  if (!doc) {
    // 列不存在或不足
    if (before < qty) throw new Error(`庫存不足：${transferProductId} ${size}＠${store}（剩餘 ${before}）`);
    throw new Error(`找不到庫存列：${transferProductId} ${size}＠${store}`);
  }
  return { before, after: Number(doc.quantity) || 0 };
}

export async function checkoutPos(user, payload = {}) {
  await connectMongo();
  await ensurePosReady();
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

  const lines = [];
  for (const raw of itemsIn) {
    const sellableId = String(raw.productId || '');
    const qty = Number(raw.qty);
    if (!sellableId || !Number.isInteger(qty) || qty <= 0) throw new Error('商品數量無效');
    const sellable = await posProductsCol().findOne({ id: sellableId, active: { $ne: false } });
    if (!sellable || !sellable.transferProductId) throw new Error(`找不到可售商品：${sellableId}`);
    lines.push({ sellable, qty });
  }

  const deducted = [];
  try {
    for (const line of lines) {
      const d = await deductTransferStock(line.sellable.transferProductId, line.sellable.size, store, line.qty);
      deducted.push({ ...line, ...d });
    }
  } catch (e) {
    for (const d of deducted) {
      try {
        await adjustInventoryQty(d.sellable.transferProductId, d.sellable.size, store, d.qty);
      } catch (_) {}
    }
    throw e;
  }

  let subtotal = 0;
  const items = deducted.map((d) => {
    const unitPrice = Number(d.sellable.price) || 0;
    const lineTotal = Math.round(unitPrice * d.qty * 100) / 100;
    subtotal += lineTotal;
    return {
      qty: d.qty,
      name: d.sellable.name,
      sku: d.sellable.sku,
      size: d.sellable.size,
      unitPrice,
      lineTotal,
      productId: d.sellable.id,
      transferProductId: d.sellable.transferProductId,
    };
  });
  subtotal = Math.round(subtotal * 100) / 100;

  // 積分折抵（每 N 分＝$1，可設定）
  await ensureMembersReady();
  const ptsSettings = await getPosPointsSettingsInternal();
  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  const memberKey = String(payload.memberId || payload.memberPhone || '').trim();
  const wantRedeem = Number(payload.pointsToRedeem || 0);
  if (wantRedeem) {
    if (!ptsSettings.redeemEnabled) throw new Error('積分兌換已關閉');
    if (!memberKey) throw new Error('請先選擇會員才能折抵積分');
    if (!Number.isInteger(wantRedeem) || wantRedeem <= 0) throw new Error('折抵積分無效');
    const n = ptsSettings.pointsPerDollar;
    if (wantRedeem % n !== 0) throw new Error(`折抵積分須為 ${n} 的倍數（每 ${n} 分＝$1）`);
    pointsDiscount = wantRedeem / n;
    const member = await findMemberDoc(memberKey);
    if (!member) throw new Error('找不到會員');
    const bal = Math.max(0, Number(member.points) || 0);
    if (wantRedeem > bal) throw new Error(`積分不足（餘額 ${bal}）`);
    const maxDiscount = Math.max(0, subtotal + accountBalance);
    if (pointsDiscount > maxDiscount + 1e-9) throw new Error('折抵金額不可超過應付總額');
    pointsRedeemed = wantRedeem;
  }

  const orderTotal = Math.round((subtotal + accountBalance - pointsDiscount) * 100) / 100;
  if (orderTotal < 0) {
    for (const d of deducted) {
      await adjustInventoryQty(d.sellable.transferProductId, d.sellable.size, store, d.qty);
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
  const now = new Date();
  const time = formatHkDateTime(now);
  const stamp = (() => {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
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
    status: 'completed',
    items,
    returns: [],
    subtotal,
    collected: 0,
    accountBalance,
    orderTotal,
    paid: orderTotal,
    pointsRedeemed: 0,
    pointsDiscount: 0,
    createdAt: stamp,
    createdAtMs: now.getTime(),
    createdAtLabel: time,
    pointsEarned: 0,
    pointsBalanceAfter: null,
  };
  await posTransactionsCol().insertOne(tx);

  // 會員積分：先扣折抵，再依「小計−折抵額」累積
  if (memberKey) {
    try {
      let balanceAfter = null;
      if (pointsRedeemed > 0) {
        const red = await applyMemberPoints({
          memberId: memberKey,
          delta: -pointsRedeemed,
          type: 'redeem',
          reason: `結帳折抵｜${orderNo}｜${pointsRedeemed}分＝$${pointsDiscount}`,
          actor: me,
          posTransactionId: id,
          posOrderNo: orderNo,
          amountBase: pointsDiscount,
        });
        balanceAfter = red.entry.balanceAfter;
        tx.pointsRedeemed = Math.abs(red.actualDelta);
        tx.pointsDiscount = pointsDiscount;
      }
      const earnBase = Math.max(0, subtotal - pointsDiscount);
      const earn = pointsFromAmount(earnBase);
      if (earn > 0) {
        const pts = await applyMemberPoints({
          memberId: memberKey,
          delta: earn,
          type: 'earn',
          reason: `消費累積｜${orderNo}`,
          actor: me,
          posTransactionId: id,
          posOrderNo: orderNo,
          amountBase: earnBase,
        });
        tx.pointsEarned = pts.actualDelta;
        balanceAfter = pts.entry.balanceAfter;
      }
      tx.pointsBalanceAfter = balanceAfter;
      await posTransactionsCol().updateOne(
        { id },
        {
          $set: {
            pointsEarned: tx.pointsEarned,
            pointsRedeemed: tx.pointsRedeemed,
            pointsDiscount: tx.pointsDiscount,
            pointsBalanceAfter: tx.pointsBalanceAfter,
          },
        }
      );
    } catch (e) {
      console.warn('POS points checkout skipped:', e.message || e);
    }
  }

  // 調動側：每項寫一筆 POS 銷售異動
  const actorName = me.name || me.login || me.id;
  for (const d of deducted) {
    const before = {};
    const after = {};
    for (const s of TRANSFER_STORES) {
      const q = await getInventoryQty(d.sellable.transferProductId, d.sellable.size, s);
      after[s] = q;
      before[s] = s === store ? d.before : q;
    }
    const adjId = 'AD' + String(Date.now()) + '-' + crypto.randomBytes(2).toString('hex');
    await transferStockAdjustmentsCol().insertOne({
      _id: adjId,
      id: adjId,
      type: 'pos_sale',
      reason: 'POS 銷售',
      productId: d.sellable.transferProductId,
      productName: d.sellable.name || '',
      size: d.sellable.size,
      before,
      after,
      store,
      qtySold: d.qty,
      posTransactionId: id,
      posOrderNo: orderNo,
      createdAt: time,
      createdAtMs: Date.now(),
      createdBy: String(me.id),
      createdByName: actorName,
    });
  }

  await appendModuleLog({
    module: 'pos',
    time,
    action: '完成收銀',
    detail: `${store}｜${orderNo}｜$${orderTotal.toFixed(2)}｜扣調動庫存`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });

  const draftId = String(payload.draftId || '').trim();
  if (draftId) {
    try {
      await posDraftsCol().deleteOne({ id: draftId, store });
    } catch (e) {
      console.warn('POS draft cleanup skipped:', e.message || e);
    }
  }

  return stripPosTransaction(tx);
}

export async function returnPosTransaction(user, txId, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可退貨');
  const me = publicUser(user);
  const id = String(txId || '');
  const tx = await posTransactionsCol().findOne({ id });
  if (!tx) throw new Error('找不到交易');
  if (!posIsSystemAdmin(me)) {
    const stores = posUserStores(me);
    if (stores.length && !stores.includes(tx.store)) throw new Error('無權退此交易');
  }
  if (tx.status === 'full_return' || String(tx.orderStatus || '').indexOf('全部退貨') >= 0) {
    throw new Error('此單已全部退貨');
  }
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('請填寫退貨原因');
  const refundMethod = String(payload.refundMethod || 'cash');
  const refundNames = { cash: '現金', credit_card: '信用卡', octopus: '八達通', fps: 'FPS' };
  if (!refundNames[refundMethod]) throw new Error('退款方式無效');
  const reqItems = Array.isArray(payload.items) ? payload.items : [];
  if (!reqItems.length) throw new Error('請選擇退貨品項');

  const items = Array.isArray(tx.items) ? tx.items.map((it) => ({ ...it })) : [];
  const returnLines = [];
  for (const raw of reqItems) {
    const productId = String(raw.productId || '');
    const qty = Number(raw.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) throw new Error('退貨數量無效');
    const line = items.find((it) => String(it.productId) === productId);
    if (!line) throw new Error('找不到品項：' + productId);
    const already = Number(line.returnedQty) || 0;
    const remain = Number(line.qty) - already;
    if (qty > remain) throw new Error(`${line.name} 可退數量僅餘 ${remain}`);
    if (!line.transferProductId) throw new Error(`${line.name} 缺少調動貨品對應，無法回庫`);
    returnLines.push({ line, qty, productId });
  }

  const store = tx.store;
  const restocked = [];
  try {
    for (const rl of returnLines) {
      const before = await getInventoryQty(rl.line.transferProductId, rl.line.size, store);
      await adjustInventoryQty(rl.line.transferProductId, rl.line.size, store, rl.qty);
      const afterQty = await getInventoryQty(rl.line.transferProductId, rl.line.size, store);
      restocked.push({ ...rl, before, after: afterQty });
    }
  } catch (e) {
    for (const r of restocked) {
      try {
        await adjustInventoryQty(r.line.transferProductId, r.line.size, store, -r.qty);
      } catch (_) {}
    }
    throw e;
  }

  let refundAmount = 0;
  for (const rl of returnLines) {
    const line = items.find((it) => String(it.productId) === rl.productId);
    line.returnedQty = (Number(line.returnedQty) || 0) + rl.qty;
    refundAmount += (Number(line.unitPrice) || 0) * rl.qty;
  }
  refundAmount = Math.round(refundAmount * 100) / 100;

  const allReturned = items.every((it) => (Number(it.returnedQty) || 0) >= Number(it.qty));
  const status = allReturned ? 'full_return' : 'partial_return';
  const orderStatus = allReturned
    ? `全部退貨（${store}店）`
    : `部分退貨（${store}店）`;

  const now = new Date();
  const time = formatHkDateTime(now);
  const returnRec = {
    id: `ret_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: time,
    atMs: now.getTime(),
    byId: String(me.id),
    byName: me.name || me.login || '',
    reason,
    refundMethod,
    refundMethodName: refundNames[refundMethod],
    refundAmount,
    items: returnLines.map((rl) => ({
      productId: rl.productId,
      transferProductId: rl.line.transferProductId,
      name: rl.line.name,
      sku: rl.line.sku,
      size: rl.line.size,
      qty: rl.qty,
      unitPrice: rl.line.unitPrice,
      lineRefund: Math.round((Number(rl.line.unitPrice) || 0) * rl.qty * 100) / 100,
    })),
    pointsDeducted: 0,
    pointsClamped: false,
  };

  // 會員積分：按退貨金額取整扣回（不足扣至 0）
  const memberKey = String(tx.memberId || tx.memberPhone || '').trim();
  if (memberKey) {
    const deduct = pointsFromAmount(refundAmount);
    if (deduct > 0) {
      try {
        await ensureMembersReady();
        const pts = await applyMemberPoints({
          memberId: memberKey,
          delta: -deduct,
          type: 'return',
          reason: `退貨扣回｜${tx.orderNo}｜${reason}`,
          actor: me,
          posTransactionId: id,
          posOrderNo: tx.orderNo,
          returnId: returnRec.id,
          amountBase: refundAmount,
        });
        returnRec.pointsDeducted = Math.abs(pts.actualDelta);
        returnRec.pointsClamped = !!pts.clamped;
        returnRec.pointsBalanceAfter = pts.entry.balanceAfter;
      } catch (e) {
        console.warn('POS points return skipped:', e.message || e);
      }
    }
  }

  const returns = Array.isArray(tx.returns) ? tx.returns.slice() : [];
  returns.push(returnRec);

  await posTransactionsCol().updateOne(
    { id },
    {
      $set: {
        items,
        returns,
        status,
        orderStatus,
        paymentStatus: allReturned ? '已退款' : '部分退款',
        updatedAt: time,
        updatedAtMs: now.getTime(),
      },
    }
  );

  const actorName = me.name || me.login || me.id;
  for (const r of restocked) {
    const before = {};
    const after = {};
    for (const s of TRANSFER_STORES) {
      const q = await getInventoryQty(r.line.transferProductId, r.line.size, s);
      after[s] = q;
      before[s] = s === store ? r.before : q;
    }
    const adjId = 'AD' + String(Date.now()) + '-' + crypto.randomBytes(2).toString('hex');
    await transferStockAdjustmentsCol().insertOne({
      _id: adjId,
      id: adjId,
      type: 'pos_return',
      reason: 'POS 退貨',
      productId: r.line.transferProductId,
      productName: r.line.name || '',
      size: r.line.size,
      before,
      after,
      store,
      qtyReturned: r.qty,
      posTransactionId: id,
      posOrderNo: tx.orderNo,
      returnId: returnRec.id,
      createdAt: time,
      createdAtMs: Date.now(),
      createdBy: String(me.id),
      createdByName: actorName,
    });
  }

  await appendModuleLog({
    module: 'pos',
    time,
    action: 'POS 退貨',
    detail: `${tx.orderNo}｜${store}｜退 $${refundAmount.toFixed(2)}｜${reason}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });

  const updated = await posTransactionsCol().findOne({ id });
  return stripPosTransaction(updated);
}

export async function exchangePosTransaction(user, txId, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可換貨');
  const me = publicUser(user);
  const id = String(txId || '');
  const tx = await posTransactionsCol().findOne({ id });
  if (!tx) throw new Error('找不到交易');
  if (!posIsSystemAdmin(me)) {
    const stores = posUserStores(me);
    if (stores.length && !stores.includes(tx.store)) throw new Error('無權換此交易');
  }
  if (tx.status === 'full_return' || String(tx.orderStatus || '').indexOf('全部退貨') >= 0) {
    throw new Error('此單已全部退貨，無法換貨');
  }
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('請填寫換貨原因');
  const paymentNames = { cash: '現金', credit_card: '信用卡', octopus: '八達通', fps: 'FPS' };
  const settleMethod = String(payload.settleMethod || payload.paymentMethod || tx.paymentMethod || 'cash');
  if (!paymentNames[settleMethod]) throw new Error('收／退款方式無效');

  const returnReq = Array.isArray(payload.returnItems) ? payload.returnItems : [];
  const exchangeReq = Array.isArray(payload.exchangeItems) ? payload.exchangeItems : [];
  if (!returnReq.length) throw new Error('請選擇退回品項');
  if (!exchangeReq.length) throw new Error('請選擇換入品項');

  const items = Array.isArray(tx.items) ? tx.items.map((it) => ({ ...it })) : [];
  const returnLines = [];
  let returnAmount = 0;
  for (const raw of returnReq) {
    const productId = String(raw.productId || '');
    const qty = Number(raw.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) throw new Error('退回數量無效');
    const line = items.find((it) => String(it.productId) === productId);
    if (!line) throw new Error('找不到退回品項：' + productId);
    const already = Number(line.returnedQty) || 0;
    const remain = Number(line.qty) - already;
    if (qty > remain) throw new Error(`${line.name} 可退數量僅餘 ${remain}`);
    if (!line.transferProductId) throw new Error(`${line.name} 缺少調動貨品對應`);
    returnAmount += (Number(line.unitPrice) || 0) * qty;
    returnLines.push({ line, qty, productId });
  }
  returnAmount = Math.round(returnAmount * 100) / 100;

  const exchangeLines = [];
  let exchangeAmount = 0;
  for (const raw of exchangeReq) {
    const sellableId = String(raw.productId || '');
    const qty = Number(raw.qty);
    if (!sellableId || !Number.isInteger(qty) || qty <= 0) throw new Error('換入數量無效');
    const sellable = await posProductsCol().findOne({ id: sellableId, active: { $ne: false } });
    if (!sellable || !sellable.transferProductId) throw new Error('找不到換入可售商品：' + sellableId);
    const unitPrice = Number(sellable.price) || 0;
    exchangeAmount += unitPrice * qty;
    exchangeLines.push({ sellable, qty, unitPrice });
  }
  exchangeAmount = Math.round(exchangeAmount * 100) / 100;
  const diff = Math.round((exchangeAmount - returnAmount) * 100) / 100;

  const store = tx.store;
  const restocked = [];
  const deducted = [];
  try {
    for (const rl of returnLines) {
      const before = await getInventoryQty(rl.line.transferProductId, rl.line.size, store);
      await adjustInventoryQty(rl.line.transferProductId, rl.line.size, store, rl.qty);
      restocked.push({ ...rl, before });
    }
    for (const el of exchangeLines) {
      const d = await deductTransferStock(el.sellable.transferProductId, el.sellable.size, store, el.qty);
      deducted.push({ ...el, ...d });
    }
  } catch (e) {
    for (const d of deducted) {
      try {
        await adjustInventoryQty(d.sellable.transferProductId, d.sellable.size, store, d.qty);
      } catch (_) {}
    }
    for (const r of restocked) {
      try {
        await adjustInventoryQty(r.line.transferProductId, r.line.size, store, -r.qty);
      } catch (_) {}
    }
    throw e;
  }

  for (const rl of returnLines) {
    const line = items.find((it) => String(it.productId) === rl.productId);
    line.returnedQty = (Number(line.returnedQty) || 0) + rl.qty;
  }

  const now = new Date();
  const time = formatHkDateTime(now);
  const exchId = `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const exchangeRec = {
    id: exchId,
    at: time,
    atMs: now.getTime(),
    byId: String(me.id),
    byName: me.name || me.login || '',
    reason,
    settleMethod,
    settleMethodName: paymentNames[settleMethod],
    returnAmount,
    exchangeAmount,
    diff,
    returnItems: returnLines.map((rl) => ({
      productId: rl.productId,
      transferProductId: rl.line.transferProductId,
      name: rl.line.name,
      sku: rl.line.sku,
      size: rl.line.size,
      qty: rl.qty,
      unitPrice: rl.line.unitPrice,
      lineRefund: Math.round((Number(rl.line.unitPrice) || 0) * rl.qty * 100) / 100,
    })),
    exchangeItems: deducted.map((d) => ({
      productId: d.sellable.id,
      transferProductId: d.sellable.transferProductId,
      name: d.sellable.name,
      sku: d.sellable.sku,
      size: d.sellable.size,
      qty: d.qty,
      unitPrice: d.unitPrice,
      lineTotal: Math.round(d.unitPrice * d.qty * 100) / 100,
    })),
    pointsReturned: 0,
    pointsEarned: 0,
    pointsClamped: false,
  };

  const memberKey = String(tx.memberId || tx.memberPhone || '').trim();
  if (memberKey) {
    try {
      await ensureMembersReady();
      const retPts = pointsFromAmount(returnAmount);
      if (retPts > 0) {
        const p = await applyMemberPoints({
          memberId: memberKey,
          delta: -retPts,
          type: 'return',
          reason: `換貨退回扣分｜${tx.orderNo}`,
          actor: me,
          posTransactionId: id,
          posOrderNo: tx.orderNo,
          returnId: exchId,
          amountBase: returnAmount,
        });
        exchangeRec.pointsReturned = Math.abs(p.actualDelta);
        exchangeRec.pointsClamped = !!p.clamped;
        exchangeRec.pointsBalanceAfter = p.entry.balanceAfter;
      }
      const earnPts = pointsFromAmount(exchangeAmount);
      if (earnPts > 0) {
        const p = await applyMemberPoints({
          memberId: memberKey,
          delta: earnPts,
          type: 'earn',
          reason: `換貨換入累積｜${tx.orderNo}`,
          actor: me,
          posTransactionId: id,
          posOrderNo: tx.orderNo,
          returnId: exchId,
          amountBase: exchangeAmount,
        });
        exchangeRec.pointsEarned = p.actualDelta;
        exchangeRec.pointsBalanceAfter = p.entry.balanceAfter;
      }
    } catch (e) {
      console.warn('POS points exchange skipped:', e.message || e);
    }
  }

  const allReturned = items.every((it) => (Number(it.returnedQty) || 0) >= Number(it.qty));
  const status = allReturned ? 'full_return' : 'partial_return';
  const orderStatus = allReturned ? `全部退貨／已換貨（${store}店）` : `部分退貨／已換貨（${store}店）`;
  const exchanges = Array.isArray(tx.exchanges) ? tx.exchanges.slice() : [];
  exchanges.push(exchangeRec);

  await posTransactionsCol().updateOne(
    { id },
    {
      $set: {
        items,
        exchanges,
        status,
        orderStatus,
        updatedAt: time,
        updatedAtMs: now.getTime(),
      },
    }
  );

  const actorName = me.name || me.login || me.id;
  for (const r of restocked) {
    const before = {};
    const after = {};
    for (const s of TRANSFER_STORES) {
      const q = await getInventoryQty(r.line.transferProductId, r.line.size, s);
      after[s] = q;
      before[s] = s === store ? r.before : q;
    }
    const adjId = 'AD' + String(Date.now()) + '-' + crypto.randomBytes(2).toString('hex');
    await transferStockAdjustmentsCol().insertOne({
      _id: adjId,
      id: adjId,
      type: 'pos_exchange_in',
      reason: 'POS 換貨回庫',
      productId: r.line.transferProductId,
      productName: r.line.name || '',
      size: r.line.size,
      before,
      after,
      store,
      qtyReturned: r.qty,
      posTransactionId: id,
      posOrderNo: tx.orderNo,
      exchangeId: exchId,
      createdAt: time,
      createdAtMs: Date.now(),
      createdBy: String(me.id),
      createdByName: actorName,
    });
  }
  for (const d of deducted) {
    const before = {};
    const after = {};
    for (const s of TRANSFER_STORES) {
      const q = await getInventoryQty(d.sellable.transferProductId, d.sellable.size, s);
      after[s] = q;
      before[s] = s === store ? d.before : q;
    }
    const adjId = 'AD' + String(Date.now()) + '-' + crypto.randomBytes(2).toString('hex');
    await transferStockAdjustmentsCol().insertOne({
      _id: adjId,
      id: adjId,
      type: 'pos_exchange_out',
      reason: 'POS 換貨出庫',
      productId: d.sellable.transferProductId,
      productName: d.sellable.name || '',
      size: d.sellable.size,
      before,
      after,
      store,
      qtySold: d.qty,
      posTransactionId: id,
      posOrderNo: tx.orderNo,
      exchangeId: exchId,
      createdAt: time,
      createdAtMs: Date.now(),
      createdBy: String(me.id),
      createdByName: actorName,
    });
  }

  await appendModuleLog({
    module: 'pos',
    time,
    action: 'POS 換貨',
    detail: `${tx.orderNo}｜${store}｜退 $${returnAmount.toFixed(2)}｜換 $${exchangeAmount.toFixed(2)}｜差 $${diff.toFixed(2)}｜${reason}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });

  const updated = await posTransactionsCol().findOne({ id });
  return stripPosTransaction(updated);
}

function posSettlementsCol() {
  return db.collection('pos_settlements');
}

function hkYmdFromMs(ms) {
  const d = new Date(Number(ms) || Date.now());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}

function hkTodayYmd() {
  return hkYmdFromMs(Date.now());
}

function hkDayBounds(ymd) {
  const s = String(ymd || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期格式無效（YYYY-MM-DD）');
  const start = new Date(`${s}T00:00:00+08:00`).getTime();
  const end = new Date(`${s}T23:59:59.999+08:00`).getTime();
  return { start, end };
}

function posRound2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function posCanAccessStore(user, store) {
  const me = publicUser(user);
  if (!me) return false;
  if (!POS_STORES.includes(store)) return false;
  if (posIsSystemAdmin(me) || posCanManageCatalog(me)) return true;
  return posUserStores(me).includes(store);
}

function stripPosSettlement(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function buildPosSalesSummary({ store, from, to } = {}) {
  const fromYmd = String(from || hkTodayYmd());
  const toYmd = String(to || fromYmd);
  const { start } = hkDayBounds(fromYmd);
  const { end } = hkDayBounds(toYmd);
  if (start > end) throw new Error('開始日期不可晚於結束日期');
  const filter = { createdAtMs: { $gte: start, $lte: end } };
  if (store) filter.store = store;
  const txs = await posTransactionsCol().find(filter).toArray();
  const byPayment = { cash: 0, credit_card: 0, octopus: 0, fps: 0 };
  const byRefundMethod = { cash: 0, credit_card: 0, octopus: 0, fps: 0 };
  let salesCount = 0;
  let salesAmount = 0;
  let refundCount = 0;
  let refundAmount = 0;
  let cashSales = 0;
  let cashRefunds = 0;
  let latestActivityMs = 0;
  const days = {};

  for (const tx of txs) {
    const amt = Number(tx.orderTotal) || 0;
    salesCount += 1;
    salesAmount += amt;
    const pm = tx.paymentMethod || 'cash';
    if (byPayment[pm] != null) byPayment[pm] += amt;
    if (pm === 'cash') cashSales += amt;
    latestActivityMs = Math.max(latestActivityMs, Number(tx.createdAtMs) || 0);
    const dayKey = `${tx.store || ''}__${hkYmdFromMs(tx.createdAtMs)}`;
    if (!days[dayKey]) {
      days[dayKey] = {
        date: hkYmdFromMs(tx.createdAtMs),
        store: tx.store || '',
        salesCount: 0,
        salesAmount: 0,
        refundCount: 0,
        refundAmount: 0,
        cashSales: 0,
        cashRefunds: 0,
      };
    }
    const day = days[dayKey];
    day.salesCount += 1;
    day.salesAmount += amt;
    if (pm === 'cash') day.cashSales += amt;

    for (const r of Array.isArray(tx.returns) ? tx.returns : []) {
      const ra = Number(r.refundAmount) || 0;
      refundCount += 1;
      refundAmount += ra;
      const rm = r.refundMethod || 'cash';
      if (byRefundMethod[rm] != null) byRefundMethod[rm] += ra;
      if (rm === 'cash') cashRefunds += ra;
      latestActivityMs = Math.max(latestActivityMs, Number(r.atMs) || 0);
      day.refundCount += 1;
      day.refundAmount += ra;
      if (rm === 'cash') day.cashRefunds += ra;
    }
  }

  const dayRows = Object.values(days)
    .map((d) => ({
      ...d,
      salesAmount: posRound2(d.salesAmount),
      refundAmount: posRound2(d.refundAmount),
      netAmount: posRound2(d.salesAmount - d.refundAmount),
      cashSales: posRound2(d.cashSales),
      cashRefunds: posRound2(d.cashRefunds),
      expectedCash: posRound2(d.cashSales - d.cashRefunds),
    }))
    .sort((a, b) => {
      const dc = String(b.date).localeCompare(String(a.date));
      if (dc) return dc;
      return String(a.store).localeCompare(String(b.store), 'zh-Hant');
    });

  return {
    store: store || '',
    from: fromYmd,
    to: toYmd,
    salesCount,
    salesAmount: posRound2(salesAmount),
    refundCount,
    refundAmount: posRound2(refundAmount),
    netAmount: posRound2(salesAmount - refundAmount),
    byPayment: {
      cash: posRound2(byPayment.cash),
      credit_card: posRound2(byPayment.credit_card),
      octopus: posRound2(byPayment.octopus),
      fps: posRound2(byPayment.fps),
    },
    byRefundMethod: {
      cash: posRound2(byRefundMethod.cash),
      credit_card: posRound2(byRefundMethod.credit_card),
      octopus: posRound2(byRefundMethod.octopus),
      fps: posRound2(byRefundMethod.fps),
    },
    cashSales: posRound2(cashSales),
    cashRefunds: posRound2(cashRefunds),
    expectedCash: posRound2(cashSales - cashRefunds),
    latestActivityMs,
    days: dayRows,
  };
}

async function syncDailySettlementWork(store, dateYmd, { done, actor } = {}) {
  const daily = await getDaily();
  const works = Array.isArray(daily.works) ? daily.works.slice() : [];
  let changed = false;
  let matched = 0;
  const nowLabel = formatHkDateTime();
  for (const w of works) {
    if (!w || w.kind !== 'settlement') continue;
    if (String(w.unit) !== String(store)) continue;
    if (w.status === 'cancelled') continue;
    const due = String(w.dueDate || '');
    if (due && due !== dateYmd) continue;
    if (!due && dateYmd !== hkTodayYmd()) continue;
    matched += 1;
    if (done) {
      if (w.status === 'done') continue;
      w.status = 'done';
      w.completedAt = nowLabel;
      w.completedBy = String(actor?.id || '');
      w.completedByName = actor?.name || actor?.login || '';
      w.completedViaPosSettlement = true;
      w.updatedAt = nowLabel;
      changed = true;
    } else {
      if (w.status !== 'done') continue;
      w.status = 'open';
      w.completedAt = null;
      w.completedBy = null;
      w.completedByName = null;
      w.completedViaPosSettlement = false;
      w.updatedAt = nowLabel;
      changed = true;
    }
  }
  if (done && matched === 0) {
    works.push({
      id: `settlement_${store}_${dateYmd}`,
      title: '每日結算',
      content: '由 POS 日結模組自動建立／完成',
      unit: store,
      kind: 'settlement',
      priority: 'normal',
      status: 'done',
      dueDate: dateYmd,
      startDate: dateYmd,
      assigneeIds: [],
      attachments: [],
      requireAttachment: false,
      completedAt: nowLabel,
      completedBy: String(actor?.id || ''),
      completedByName: actor?.name || actor?.login || '',
      completedViaPosSettlement: true,
      createdAt: nowLabel,
      updatedAt: nowLabel,
      createdBy: String(actor?.id || ''),
      createdByName: actor?.name || actor?.login || '',
    });
    changed = true;
  }
  if (changed) {
    const opLogs = Array.isArray(daily.opLogs) ? daily.opLogs.slice() : [];
    opLogs.unshift({
      time: nowLabel,
      user: actor?.name || actor?.login || '',
      userId: String(actor?.id || ''),
      userName: actor?.name || actor?.login || '',
      action: done ? '完成結算' : '重開結算',
      detail: `${store}｜${dateYmd}｜經 POS 日結`,
    });
    if (opLogs.length > 500) opLogs.length = 500;
    await saveDaily({
      version: daily.version || 2,
      works,
      recurringTemplates: daily.recurringTemplates || [],
      opLogs,
    });
  }
  return changed;
}

export async function getPosSalesReport(user, query = {}) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const stores = posUserStores(me);
  const canManage = posCanManageCatalog(me);
  const store = String(query.store || '').trim();
  const from = String(query.from || hkTodayYmd());
  const to = String(query.to || from);
  if (store) {
    if (!posCanAccessStore(me, store)) throw new Error('無權查看此店舖報表');
  } else if (!canManage && stores.length !== 1) {
    throw new Error('請選擇店舖');
  }
  const effectiveStore = store || (stores.length === 1 ? stores[0] : '');
  if (effectiveStore && !posCanAccessStore(me, effectiveStore)) {
    throw new Error('無權查看此店舖報表');
  }
  // 個人非管理：僅能查本店
  if (!canManage && effectiveStore && !stores.includes(effectiveStore)) {
    throw new Error('無權查看此店舖報表');
  }
  const summary = await buildPosSalesSummary({
    store: effectiveStore || undefined,
    from,
    to,
  });
  return {
    summary,
    stores: canManage ? POS_STORES.slice() : stores,
    canExport: canManage,
    canManage,
  };
}

export async function exportPosSalesReportCsv(user, query = {}) {
  const report = await getPosSalesReport(user, query);
  if (!report.canExport) throw new Error('只有管理員／主管可匯出 CSV');
  const s = report.summary;
  const lines = [];
  lines.push(['店舖', '由', '至', '銷售筆數', '營業額', '退貨筆數', '退款額', '淨額', '現金收款', '現金退款', '應有現金'].join(','));
  lines.push(
    [
      s.store || '全部',
      s.from,
      s.to,
      s.salesCount,
      s.salesAmount,
      s.refundCount,
      s.refundAmount,
      s.netAmount,
      s.cashSales,
      s.cashRefunds,
      s.expectedCash,
    ].join(',')
  );
  lines.push('');
  lines.push(['日期', '店舖', '銷售筆數', '營業額', '退貨筆數', '退款額', '淨額', '應有現金'].join(','));
  for (const d of s.days || []) {
    lines.push(
      [d.date, d.store || s.store || '', d.salesCount, d.salesAmount, d.refundCount, d.refundAmount, d.netAmount, d.expectedCash].join(',')
    );
  }
  lines.push('');
  lines.push(['支付方式', '金額'].join(','));
  lines.push(['現金', s.byPayment.cash].join(','));
  lines.push(['信用卡', s.byPayment.credit_card].join(','));
  lines.push(['八達通', s.byPayment.octopus].join(','));
  lines.push(['FPS', s.byPayment.fps].join(','));
  const csv = '\uFEFF' + lines.join('\n');
  return { csv, filename: `pos-report-${s.from}_${s.to}.csv` };
}

function emptyPosSalesSummary(store, from, to) {
  return {
    store: store || '',
    from,
    to,
    salesCount: 0,
    salesAmount: 0,
    refundCount: 0,
    refundAmount: 0,
    netAmount: 0,
    byPayment: { cash: 0, credit_card: 0, octopus: 0, fps: 0 },
    byRefundMethod: { cash: 0, credit_card: 0, octopus: 0, fps: 0 },
    cashSales: 0,
    cashRefunds: 0,
    expectedCash: 0,
    latestActivityMs: 0,
    days: [],
  };
}

export async function getPosSettlement(user, query = {}) {
  await connectMongo();
  await ensurePosReady();
  await posSettlementsCol().createIndex({ store: 1, date: 1 }, { unique: true });
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const stores = posUserStores(me);
  const canManage = posCanManageCatalog(me);
  const storeList = canManage ? POS_STORES.slice() : stores;
  const date = String(query.date || hkTodayYmd());
  const store = String(query.store || (storeList[0] || stores[0] || '')).trim();
  if (!store) {
    return {
      store: '',
      date,
      live: emptyPosSalesSummary('', date, date),
      settlement: null,
      locked: false,
      reviewStatus: '',
      hasActivityAfter: false,
      stores: storeList,
      canManage,
      canSubmit: false,
      canUnlock: false,
      canApprove: false,
      canReject: false,
      warning: '此帳號未綁定 POS 店舖，請先在個人設置加入觀塘／荔枝角／灣仔／屯門',
    };
  }
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  if (!posCanAccessStore(me, store)) throw new Error('無權查看此店舖日結');
  const live = await buildPosSalesSummary({ store, from: date, to: date });
  const doc = await posSettlementsCol().findOne({ store, date });
  const settlement = stripPosSettlement(doc);
  const locked = !!(settlement && settlement.locked);
  const reviewStatus = settlement?.reviewStatus || (locked ? 'pending_review' : '');
  const snapshotActivity = Number(settlement?.snapshot?.latestActivityMs) || Number(settlement?.submittedAtMs) || 0;
  const hasActivityAfter = locked && live.latestActivityMs > snapshotActivity;
  return {
    store,
    date,
    live,
    settlement,
    locked,
    reviewStatus,
    hasActivityAfter,
    stores: storeList,
    canManage,
    canSubmit: posCanAccessStore(me, store) && !locked,
    canUnlock: canManage && locked,
    canApprove: canManage && locked && reviewStatus === 'pending_review',
    canReject: canManage && locked && reviewStatus === 'pending_review',
  };
}

export async function submitPosSettlement(user, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  await posSettlementsCol().createIndex({ store: 1, date: 1 }, { unique: true });
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const store = String(payload.store || '').trim();
  const date = String(payload.date || hkTodayYmd());
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  if (!posCanAccessStore(me, store)) throw new Error('無權提交此店舖日結');
  const cashCounted = Number(payload.cashCounted);
  if (!isFinite(cashCounted)) throw new Error('請填寫現金實點金額');
  const remark = String(payload.remark || '').trim();
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments
        .map((a) => ({
          id: String(a.id || a.fileId || ''),
          name: String(a.name || ''),
          mimeType: String(a.mimeType || ''),
        }))
        .filter((a) => a.id)
    : [];
  const existing = await posSettlementsCol().findOne({ store, date });
  if (existing && existing.locked) throw new Error('此日結已提交並鎖定；請主管退回或解除後再重交');

  const live = await buildPosSalesSummary({ store, from: date, to: date });
  const cashDiff = posRound2(cashCounted - live.expectedCash);
  const now = new Date();
  const time = formatHkDateTime(now);
  const snapshot = { ...live };
  const histEntry = {
    action: existing ? 'resubmit' : 'submit',
    at: time,
    atMs: now.getTime(),
    byId: String(me.id),
    byName: me.name || me.login || '',
    cashCounted: posRound2(cashCounted),
    cashDiff,
    expectedCash: live.expectedCash,
    remark,
    attachmentCount: attachments.length,
  };
  const history = Array.isArray(existing?.history) ? existing.history.slice() : [];
  history.push(histEntry);
  const id = existing?.id || `set_${store}_${date}`;
  const doc = {
    _id: id,
    id,
    store,
    date,
    locked: true,
    reviewStatus: 'pending_review',
    reviewNote: '',
    reviewedAt: null,
    reviewedById: null,
    reviewedByName: null,
    snapshot,
    cashCounted: posRound2(cashCounted),
    cashDiff,
    remark,
    attachments,
    submittedAt: time,
    submittedAtMs: now.getTime(),
    submittedById: String(me.id),
    submittedByName: me.name || me.login || '',
    history,
    unlockedAt: null,
    unlockedAtMs: null,
    unlockedById: null,
    unlockedByName: null,
  };
  await posSettlementsCol().replaceOne({ _id: id }, doc, { upsert: true });
  await syncDailySettlementWork(store, date, { done: true, actor: me });
  await appendModuleLog({
    module: 'pos',
    time,
    action: existing ? '重交日結' : '提交日結',
    detail: `${store}｜${date}｜應有現金 $${live.expectedCash.toFixed(2)}｜實點 $${posRound2(cashCounted).toFixed(2)}｜差 $${cashDiff.toFixed(2)}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return getPosSettlement(me, { store, date });
}

export async function unlockPosSettlement(user, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  if (!posCanManageCatalog(me)) throw new Error('只有管理員／主管可解除日結鎖定');
  const store = String(payload.store || '').trim();
  const date = String(payload.date || '');
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期無效');
  const existing = await posSettlementsCol().findOne({ store, date });
  if (!existing) throw new Error('找不到日結紀錄');
  if (!existing.locked) throw new Error('此日結未鎖定');
  const now = new Date();
  const time = formatHkDateTime(now);
  const history = Array.isArray(existing.history) ? existing.history.slice() : [];
  history.push({
    action: 'unlock',
    at: time,
    atMs: now.getTime(),
    byId: String(me.id),
    byName: me.name || me.login || '',
  });
  await posSettlementsCol().updateOne(
    { _id: existing._id },
    {
      $set: {
        locked: false,
        reviewStatus: 'unlocked',
        unlockedAt: time,
        unlockedAtMs: now.getTime(),
        unlockedById: String(me.id),
        unlockedByName: me.name || me.login || '',
        history,
      },
    }
  );
  await syncDailySettlementWork(store, date, { done: false, actor: me });
  await appendModuleLog({
    module: 'pos',
    time,
    action: '解除日結鎖定',
    detail: `${store}｜${date}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return getPosSettlement(me, { store, date });
}

export async function approvePosSettlement(user, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!posCanManageCatalog(me)) throw new Error('只有管理員／主管可核對日結');
  const store = String(payload.store || '').trim();
  const date = String(payload.date || '');
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  const existing = await posSettlementsCol().findOne({ store, date });
  if (!existing) throw new Error('找不到日結紀錄');
  if (!existing.locked) throw new Error('日結未鎖定，無法核對');
  const now = new Date();
  const time = formatHkDateTime(now);
  const note = String(payload.note || '').trim();
  const history = Array.isArray(existing.history) ? existing.history.slice() : [];
  history.push({
    action: 'approve',
    at: time,
    atMs: now.getTime(),
    byId: String(me.id),
    byName: me.name || me.login || '',
    note,
  });
  await posSettlementsCol().updateOne(
    { _id: existing._id },
    {
      $set: {
        reviewStatus: 'approved',
        reviewNote: note,
        reviewedAt: time,
        reviewedById: String(me.id),
        reviewedByName: me.name || me.login || '',
        history,
      },
    }
  );
  await appendModuleLog({
    module: 'pos',
    time,
    action: '核對日結通過',
    detail: `${store}｜${date}` + (note ? `｜${note}` : ''),
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return getPosSettlement(me, { store, date });
}

export async function rejectPosSettlement(user, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!posCanManageCatalog(me)) throw new Error('只有管理員／主管可退回日結');
  const store = String(payload.store || '').trim();
  const date = String(payload.date || '');
  const note = String(payload.note || payload.reason || '').trim();
  if (!note) throw new Error('請填寫退回原因');
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  const existing = await posSettlementsCol().findOne({ store, date });
  if (!existing) throw new Error('找不到日結紀錄');
  if (!existing.locked) throw new Error('日結未鎖定');
  const now = new Date();
  const time = formatHkDateTime(now);
  const history = Array.isArray(existing.history) ? existing.history.slice() : [];
  history.push({
    action: 'reject',
    at: time,
    atMs: now.getTime(),
    byId: String(me.id),
    byName: me.name || me.login || '',
    note,
  });
  await posSettlementsCol().updateOne(
    { _id: existing._id },
    {
      $set: {
        locked: false,
        reviewStatus: 'rejected',
        reviewNote: note,
        reviewedAt: time,
        reviewedById: String(me.id),
        reviewedByName: me.name || me.login || '',
        unlockedAt: time,
        unlockedAtMs: now.getTime(),
        unlockedById: String(me.id),
        unlockedByName: me.name || me.login || '',
        history,
      },
    }
  );
  await syncDailySettlementWork(store, date, { done: false, actor: me });
  await appendModuleLog({
    module: 'pos',
    time,
    action: '退回日結',
    detail: `${store}｜${date}｜${note}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return getPosSettlement(me, { store, date });
}

export async function getPosPointsSettings(user) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const settings = await getPosPointsSettingsInternal();
  return { settings, canEdit: posCanManageCatalog(me) };
}

export async function updatePosPointsSettings(user, input = {}) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可修改積分設定');
  const me = publicUser(user);
  const $set = { updatedAt: formatHkDateTime(), updatedBy: String(me.id) };
  if (input.pointsPerDollar != null) {
    const n = Math.floor(Number(input.pointsPerDollar));
    if (!Number.isInteger(n) || n < 1) throw new Error('每 N 分＝$1 的 N 須為 ≥1 的整數');
    $set.pointsPerDollar = n;
  }
  if (input.redeemEnabled != null) $set.redeemEnabled = !!input.redeemEnabled;
  await posMetaCol().updateOne({ _id: 'points' }, { $set, $setOnInsert: { _id: 'points' } }, { upsert: true });
  const settings = await getPosPointsSettingsInternal();
  await appendModuleLog({
    module: 'pos',
    time: $set.updatedAt,
    action: '更新積分設定',
    detail: `每 ${settings.pointsPerDollar} 分＝$1｜兌換${settings.redeemEnabled ? '開' : '關'}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return { settings, canEdit: true };
}

export async function addPosSellablesBatch(user, input = {}) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可批次加入可售');
  const rows = Array.isArray(input.items) ? input.items : [];
  if (!rows.length) throw new Error('請選擇至少一項');
  const added = [];
  const errors = [];
  for (const row of rows) {
    try {
      const r = await addPosSellable(user, {
        transferProductId: row.transferProductId,
        size: row.size,
        price: row.price != null && row.price !== '' ? row.price : input.defaultPrice,
        sku: row.sku,
        name: row.name,
      });
      added.push(r.product);
    } catch (e) {
      errors.push({
        transferProductId: row.transferProductId,
        size: row.size,
        error: String(e.message || e),
      });
    }
  }
  return { added, errors, addedCount: added.length, errorCount: errors.length };
}

export async function adjustPosProductsBatch(user, input = {}) {
  await connectMongo();
  await ensurePosReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可批次調整');
  const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
  if (!ids.length) throw new Error('請選擇商品');
  const patch = {};
  if (input.price != null && input.price !== '') patch.price = input.price;
  if (input.active != null) patch.active = input.active;
  if (!Object.keys(patch).length) throw new Error('請指定售價或上下架');
  const updated = [];
  const errors = [];
  for (const id of ids) {
    try {
      updated.push(await adjustPosProduct(user, id, patch));
    } catch (e) {
      errors.push({ id, error: String(e.message || e) });
    }
  }
  return { updated, errors, updatedCount: updated.length, errorCount: errors.length };
}

export async function resetPosDemo(user) {
  await connectMongo();
  if (!posIsSystemAdmin(user)) throw new Error('只有系統管理員可重置 POS');
  await ensurePosIndexes();
  await ensureMembersReady();
  await posProductsCol().deleteMany({});
  await posTransactionsCol().deleteMany({});
  await posDraftsCol().deleteMany({});
  await posSettlementsCol().deleteMany({ isSample: true });
  await membersCol().deleteMany({ isSample: true });
  await memberPointsCol().deleteMany({ isSample: true });
  await posMetaCol().replaceOne({ _id: 'main' }, { _id: 'main', seq: 1000 }, { upsert: true });
  await posMetaCol().deleteOne({ _id: 'samples' });
  const me = publicUser(user);
  await appendModuleLog({
    module: 'pos',
    time: formatHkDateTime(),
    action: '重置雲端 POS',
    detail: '清空可售目錄與交易，並重新載入示範資料（不改調動庫存）',
    userId: me?.id,
    userName: me?.name || me?.login,
    user: me?.name || me?.login,
  });
  const seeded = await seedPosSamples(user, { force: true });
  return { ok: true, seeded };
}

/* ═══════════ 雲端會員＋積分 ═══════════ */
function membersCol() {
  return db.collection('pos_members');
}
function memberPointsCol() {
  return db.collection('pos_member_points');
}
async function ensureMembersReady() {
  await membersCol().createIndex({ phone: 1 }, { unique: true });
  await membersCol().createIndex({ name: 1 });
  await membersCol().createIndex({ active: 1, updatedAtMs: -1 });
  await memberPointsCol().createIndex({ memberId: 1, createdAtMs: -1 });
  await memberPointsCol().createIndex({ id: 1 }, { unique: true });
  await membersCol().updateMany({ points: { $exists: false } }, { $set: { points: 0 } });
}
function stripMember(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  if (rest.points == null) rest.points = 0;
  return rest;
}
function normalizeMemberLevel(raw) {
  const s = String(raw || '').trim();
  if (s === 'VIP' || s === 'VIP 會員' || s === 'vip') return 'VIP 會員';
  return '一般會員';
}
function pointsFromAmount(amount) {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}
async function findMemberDoc(idOrPhone) {
  const phoneKey = normalizePhone(idOrPhone) || String(idOrPhone || '').trim();
  if (!phoneKey) return null;
  return membersCol().findOne({ $or: [{ id: phoneKey }, { phone: phoneKey }, { _id: phoneKey }] });
}
function stripPointLedger(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** delta>0 加分；delta<0 扣分（不足則扣至 0） */
async function applyMemberPoints({
  memberId,
  delta,
  type,
  reason,
  actor,
  posTransactionId,
  posOrderNo,
  returnId,
  amountBase,
} = {}) {
  const member = await findMemberDoc(memberId);
  if (!member) throw new Error('找不到會員');
  const want = Number(delta) || 0;
  if (!Number.isInteger(want) || want === 0) throw new Error('積分變動無效');
  const before = Math.max(0, Number(member.points) || 0);
  let actual = want;
  let clamped = false;
  if (want < 0 && before + want < 0) {
    actual = -before;
    clamped = true;
  }
  if (actual === 0 && want < 0) {
    // 已是 0，仍記一筆扣至零（若想扣但無分）
    clamped = true;
  }
  const after = before + actual;
  const now = new Date();
  const time = formatHkDateTime(now);
  await membersCol().updateOne(
    { _id: member._id },
    {
      $set: {
        points: after,
        updatedAt: time,
        updatedAtMs: now.getTime(),
      },
    }
  );
  const lid = `pt_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  const entry = {
    _id: lid,
    id: lid,
    memberId: String(member.id || member.phone),
    memberPhone: member.phone,
    memberName: member.name || '',
    delta: actual,
    requestedDelta: want,
    balanceBefore: before,
    balanceAfter: after,
    clamped,
    type,
    reason: String(reason || '').trim(),
    amountBase: amountBase != null ? Number(amountBase) : null,
    posTransactionId: posTransactionId || '',
    posOrderNo: posOrderNo || '',
    returnId: returnId || '',
    createdAt: time,
    createdAtMs: now.getTime(),
    createdBy: String(actor?.id || ''),
    createdByName: actor?.name || actor?.login || '',
  };
  await memberPointsCol().insertOne(entry);
  return { member: stripMember({ ...member, points: after }), entry: stripPointLedger(entry), clamped, actualDelta: actual };
}

export async function listMembers(user, { q, includeInactive } = {}) {
  await connectMongo();
  await ensureMembersReady();
  const filter = {};
  if (!includeInactive) filter.active = { $ne: false };
  const kw = String(q || '').trim();
  if (kw) {
    const phone = normalizePhone(kw);
    filter.$or = [
      { name: { $regex: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { phone: phone || kw },
      { remark: { $regex: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }
  const docs = await membersCol().find(filter).sort({ updatedAtMs: -1, name: 1 }).limit(300).toArray();
  return {
    members: docs.map(stripMember),
    canEdit: posCanManageCatalog(user),
  };
}

export async function listMemberPoints(user, id) {
  await connectMongo();
  await ensureMembersReady();
  const me = publicUser(user);
  if (!me?.id) throw new Error('未登入');
  const member = await findMemberDoc(id);
  if (!member) throw new Error('找不到會員');
  const memberId = String(member.id || member.phone);
  const docs = await memberPointsCol()
    .find({ memberId })
    .sort({ createdAtMs: -1 })
    .limit(200)
    .toArray();
  return {
    member: stripMember(member),
    ledger: docs.map(stripPointLedger),
    canEdit: posCanManageCatalog(user),
  };
}

export async function adjustMemberPoints(user, id, input = {}) {
  await connectMongo();
  await ensureMembersReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可手動調分');
  const me = publicUser(user);
  const delta = Number(input.delta);
  if (!Number.isInteger(delta) || delta === 0) throw new Error('請輸入非零整數積分（可正可負）');
  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('請填寫調分原因');
  const result = await applyMemberPoints({
    memberId: id,
    delta,
    type: 'adjust',
    reason,
    actor: me,
  });
  await appendModuleLog({
    module: 'pos',
    time: result.entry.createdAt,
    action: '手動調分',
    detail: `${result.member.name}｜${result.member.phone}｜${delta > 0 ? '+' : ''}${delta}｜${reason}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return result;
}

export async function createMember(user, input = {}) {
  await connectMongo();
  await ensureMembersReady();
  const me = publicUser(user);
  if (!me?.id) throw new Error('未登入');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('請填寫姓名');
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('請填寫有效的 8 位香港電話');
  const existing = await membersCol().findOne({ phone });
  if (existing) throw new Error('此電話已登記為會員：' + (existing.name || phone));
  const now = new Date();
  const time = formatHkDateTime(now);
  const doc = {
    _id: phone,
    id: phone,
    phone,
    name,
    level: normalizeMemberLevel(input.level),
    remark: String(input.remark || '').trim(),
    points: 0,
    active: true,
    createdAt: time,
    createdAtMs: now.getTime(),
    updatedAt: time,
    updatedAtMs: now.getTime(),
    createdBy: String(me.id),
    createdByName: me.name || me.login || '',
  };
  await membersCol().insertOne(doc);
  await appendModuleLog({
    module: 'pos',
    time,
    action: '新增會員',
    detail: `${name}｜${phone}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return stripMember(doc);
}

export async function updateMember(user, id, input = {}) {
  await connectMongo();
  await ensureMembersReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可編輯會員');
  const me = publicUser(user);
  const existing = await findMemberDoc(id);
  if (!existing) throw new Error('找不到會員');
  const $set = {
    updatedAt: formatHkDateTime(),
    updatedAtMs: Date.now(),
    updatedBy: String(me.id),
  };
  if (input.name != null) {
    const name = String(input.name).trim();
    if (!name) throw new Error('姓名不可空白');
    $set.name = name;
  }
  if (input.level != null) $set.level = normalizeMemberLevel(input.level);
  if (input.remark != null) $set.remark = String(input.remark).trim();
  if (input.phone != null && input.phone !== '') {
    const newPhone = normalizePhone(input.phone);
    if (!newPhone) throw new Error('新電話無效');
    if (newPhone !== existing.phone) {
      const clash = await membersCol().findOne({ phone: newPhone });
      if (clash) throw new Error('新電話已被其他會員使用');
      const now = new Date();
      const time = formatHkDateTime(now);
      const next = {
        ...existing,
        _id: newPhone,
        id: newPhone,
        phone: newPhone,
        name: $set.name || existing.name,
        level: $set.level || existing.level,
        remark: $set.remark != null ? $set.remark : existing.remark,
        points: Number(existing.points) || 0,
        updatedAt: time,
        updatedAtMs: now.getTime(),
        updatedBy: String(me.id),
      };
      next.active = existing.active !== false;
      await membersCol().insertOne(next);
      await membersCol().deleteOne({ _id: existing._id });
      await memberPointsCol().updateMany(
        { memberId: String(existing.id || existing.phone) },
        { $set: { memberId: newPhone, memberPhone: newPhone, memberName: next.name } }
      );
      await appendModuleLog({
        module: 'pos',
        time,
        action: '編輯會員',
        detail: `${next.name}｜${existing.phone}→${newPhone}`,
        userId: me.id,
        userName: me.name || me.login,
        user: me.name || me.login,
      });
      return stripMember(next);
    }
  }
  await membersCol().updateOne({ _id: existing._id }, { $set });
  const updated = await membersCol().findOne({ _id: existing._id });
  await appendModuleLog({
    module: 'pos',
    time: $set.updatedAt,
    action: '編輯會員',
    detail: `${updated.name}｜${updated.phone}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return stripMember(updated);
}

export async function setMemberActive(user, id, active) {
  await connectMongo();
  await ensureMembersReady();
  if (!posCanManageCatalog(user)) throw new Error('只有管理員／主管可停用／啟用會員');
  const me = publicUser(user);
  const existing = await findMemberDoc(id);
  if (!existing) throw new Error('找不到會員');
  const time = formatHkDateTime();
  await membersCol().updateOne(
    { _id: existing._id },
    { $set: { active: !!active, updatedAt: time, updatedAtMs: Date.now(), updatedBy: String(me.id) } }
  );
  const updated = await membersCol().findOne({ _id: existing._id });
  await appendModuleLog({
    module: 'pos',
    time,
    action: active ? '啟用會員' : '停用會員',
    detail: `${updated.name}｜${updated.phone}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return stripMember(updated);
}

function stripPosDraft(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function normalizeDraftItems(itemsIn) {
  const items = [];
  for (const raw of Array.isArray(itemsIn) ? itemsIn : []) {
    const productId = String(raw.productId || '').trim();
    const qty = Number(raw.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) continue;
    items.push({
      productId,
      name: String(raw.name || ''),
      sku: String(raw.sku || ''),
      size: String(raw.size || ''),
      unitPrice: Math.round((Number(raw.unitPrice) || 0) * 100) / 100,
      qty,
    });
  }
  return items;
}

export async function listPosDrafts(user, query = {}) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const stores = posUserStores(me);
  const store = String(query.store || stores[0] || '').trim();
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  if (!posCanAccessStore(me, store)) throw new Error('無權查看此店舖草稿');
  const docs = await posDraftsCol().find({ store }).sort({ updatedAtMs: -1 }).limit(100).toArray();
  return {
    store,
    drafts: docs.map(stripPosDraft),
    canManage: posCanManageCatalog(me),
    me: { id: String(me.id), name: me.name || me.login || '' },
  };
}

export async function savePosDraft(user, payload = {}) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const store = String(payload.store || '').trim();
  if (!POS_STORES.includes(store)) throw new Error('店舖無效');
  if (!posCanAccessStore(me, store)) throw new Error('無權在此店舖保存草稿');
  const items = normalizeDraftItems(payload.items);
  if (!items.length) throw new Error('購物車是空的，無法保存草稿');
  const label = String(payload.label || payload.title || '').trim();
  const remark = String(payload.remark || '').trim();
  const paymentMethod = String(payload.paymentMethod || 'cash');
  const pointsToRedeem = Math.max(0, Math.floor(Number(payload.pointsToRedeem) || 0));
  const memberId = String(payload.memberId || '').trim();
  const memberName = String(payload.memberName || '').trim();
  const memberPhone = String(payload.memberPhone || '').trim();
  const subtotal = Math.round(items.reduce((s, it) => s + it.unitPrice * it.qty, 0) * 100) / 100;
  const itemCount = items.reduce((s, it) => s + it.qty, 0);
  const now = new Date();
  const time = formatHkDateTime(now);
  const existingId = String(payload.id || payload.draftId || '').trim();
  let id = existingId;
  let createdAt = time;
  let createdAtMs = now.getTime();
  let createdById = String(me.id);
  let createdByName = me.name || me.login || '';

  if (existingId) {
    const existing = await posDraftsCol().findOne({ id: existingId });
    if (!existing) throw new Error('找不到草稿');
    if (existing.store !== store) throw new Error('不可改到其他店舖');
    const isOwner = String(existing.createdById) === String(me.id);
    if (!isOwner && !posCanManageCatalog(me)) throw new Error('只有建立者或主管可更新此草稿');
    createdAt = existing.createdAt || time;
    createdAtMs = Number(existing.createdAtMs) || createdAtMs;
    createdById = existing.createdById || createdById;
    createdByName = existing.createdByName || createdByName;
  } else {
    id = `draft_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  }

  const doc = {
    _id: id,
    id,
    store,
    label,
    remark,
    paymentMethod,
    pointsToRedeem,
    memberId,
    memberName,
    memberPhone,
    items,
    subtotal,
    itemCount,
    createdAt,
    createdAtMs,
    createdById,
    createdByName,
    updatedAt: time,
    updatedAtMs: now.getTime(),
    updatedById: String(me.id),
    updatedByName: me.name || me.login || '',
  };
  await posDraftsCol().replaceOne({ _id: id }, doc, { upsert: true });
  await appendModuleLog({
    module: 'pos',
    time,
    action: existingId ? '更新收銀草稿' : '保存收銀草稿',
    detail: `${store}｜${id}｜${itemCount}件｜$${subtotal.toFixed(2)}${label ? `｜${label}` : ''}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return { draft: stripPosDraft(doc) };
}

export async function deletePosDraft(user, draftId) {
  await connectMongo();
  await ensurePosReady();
  const me = publicUser(user);
  if (!me) throw new Error('未登入');
  const id = String(draftId || '').trim();
  const doc = await posDraftsCol().findOne({ id });
  if (!doc) throw new Error('找不到草稿');
  if (!posCanAccessStore(me, doc.store)) throw new Error('無權操作此店舖草稿');
  const isOwner = String(doc.createdById) === String(me.id);
  if (!isOwner && !posCanManageCatalog(me)) throw new Error('只有建立者或主管可刪除此草稿');
  await posDraftsCol().deleteOne({ id });
  await appendModuleLog({
    module: 'pos',
    time: formatHkDateTime(),
    action: '刪除收銀草稿',
    detail: `${doc.store}｜${id}`,
    userId: me.id,
    userName: me.name || me.login,
    user: me.name || me.login,
  });
  return { ok: true };
}

/**
 * 為 POS 各功能植入示範資料（可售、會員、積分、交易、日結）。
 * 不改動調動庫存數量；交易為歷史樣本，不扣庫。
 */
export async function seedPosSamples(user, { force = false } = {}) {
  await connectMongo();
  await ensurePosReady();
  await ensureTransferSeed();
  await ensureMembersReady();
  await getPosPointsSettingsInternal();
  await posSettlementsCol().createIndex({ store: 1, date: 1 }, { unique: true });

  const me = publicUser(user);
  if (!me) throw new Error('未登入');

  const existingMeta = await posMetaCol().findOne({ _id: 'samples' });
  const sellableCount = await posProductsCol().countDocuments({});
  if (!force && existingMeta?.seededAt && sellableCount > 0) {
    return { ok: true, skipped: true, reason: 'already_seeded' };
  }

  if (force) {
    await posProductsCol().deleteMany({ isSample: true });
    await posTransactionsCol().deleteMany({ isSample: true });
    await membersCol().deleteMany({ isSample: true });
    await memberPointsCol().deleteMany({ isSample: true });
    await posSettlementsCol().deleteMany({ isSample: true });
  }

  const now = new Date();
  const time = formatHkDateTime(now);
  const today = hkTodayYmd();
  const dayMs = 24 * 60 * 60 * 1000;
  const ymdOffset = (daysAgo) => hkYmdFromMs(now.getTime() - daysAgo * dayMs);
  const actorName = me.name || me.login || '示範收銀';

  // —— 可售商品（掛靠調動種子貨品）——
  const sellableSpecs = [
    { id: 'sell_sample_s001_m', transferProductId: 'WS-S001', size: 'M', price: 1280, sku: 'WS-S001-M', name: '成人 2mm 防寒膠衣' },
    { id: 'sell_sample_s001_l', transferProductId: 'WS-S001', size: 'L', price: 1280, sku: 'WS-S001-L', name: '成人 2mm 防寒膠衣' },
    { id: 'sell_sample_f001_m', transferProductId: 'WS-F001', size: 'M', price: 680, sku: 'WS-F001-M', name: '成人抓毛套裝' },
    { id: 'sell_sample_f001_l', transferProductId: 'WS-F001', size: 'L', price: 680, sku: 'WS-F001-L', name: '成人抓毛套裝' },
    { id: 'sell_sample_u001_s', transferProductId: 'WS-U001', size: 'S', price: 320, sku: 'WS-U001-S', name: '成人長袖防曬衣' },
    { id: 'sell_sample_u001_m', transferProductId: 'WS-U001', size: 'M', price: 320, sku: 'WS-U001-M', name: '成人長袖防曬衣' },
  ];
  let sellablesAdded = 0;
  for (const s of sellableSpecs) {
    const tp = await transferProductsCol().findOne({
      $or: [{ _id: s.transferProductId }, { id: s.transferProductId }],
    });
    if (!tp) continue;
    const exists = await posProductsCol().findOne({
      $or: [{ id: s.id }, { transferProductId: s.transferProductId, size: s.size }],
    });
    if (exists) continue;
    await posProductsCol().insertOne({
      _id: s.id,
      id: s.id,
      transferProductId: s.transferProductId,
      name: s.name || tp.name,
      sku: s.sku,
      size: s.size,
      price: s.price,
      category: tp.category || '',
      color: tp.color || '',
      active: true,
      isSample: true,
      createdAt: time,
      updatedAt: time,
      createdBy: String(me.id),
    });
    sellablesAdded += 1;
  }
  const sellables = await posProductsCol()
    .find({ id: { $in: sellableSpecs.map((x) => x.id) } })
    .toArray();
  const bySku = new Map(sellables.map((p) => [p.sku, p]));

  // —— 會員 ——
  const memberSpecs = [
    { phone: '91110001', name: '陳志明', level: 'VIP 會員', points: 2580, remark: '示範 VIP' },
    { phone: '91110002', name: '李美玲', level: '一般會員', points: 620, remark: '示範一般會員' },
    { phone: '91110003', name: '王大偉', level: 'VIP 會員', points: 5120, remark: '示範長期客戶' },
    { phone: '91110004', name: '張小燕', level: '一般會員', points: 150, remark: '示範新會員' },
  ];
  let membersAdded = 0;
  for (const m of memberSpecs) {
    const exists = await membersCol().findOne({ phone: m.phone });
    if (exists) {
      if (force || exists.isSample) {
        await membersCol().updateOne(
          { _id: exists._id },
          {
            $set: {
              name: m.name,
              level: m.level,
              points: m.points,
              remark: m.remark,
              active: true,
              isSample: true,
              updatedAt: time,
              updatedAtMs: now.getTime(),
            },
          }
        );
      }
      continue;
    }
    await membersCol().insertOne({
      _id: m.phone,
      id: m.phone,
      phone: m.phone,
      name: m.name,
      level: m.level,
      remark: m.remark,
      points: m.points,
      active: true,
      isSample: true,
      createdAt: time,
      createdAtMs: now.getTime(),
      updatedAt: time,
      updatedAtMs: now.getTime(),
      createdBy: String(me.id),
      createdByName: actorName,
    });
    membersAdded += 1;
  }

  // —— 積分流水（樣本）——
  let pointsAdded = 0;
  const pointSamples = [
    { memberId: '91110001', delta: 500, type: 'adjust', reason: '示範：開戶贈分', daysAgo: 20 },
    { memberId: '91110001', delta: -100, type: 'redeem', reason: '示範：結帳折抵', daysAgo: 3 },
    { memberId: '91110002', delta: 200, type: 'earn', reason: '示範：消費累積', daysAgo: 5 },
    { memberId: '91110003', delta: 800, type: 'earn', reason: '示範：消費累積', daysAgo: 8 },
    { memberId: '91110004', delta: 150, type: 'adjust', reason: '示範：新會員禮', daysAgo: 2 },
  ];
  for (const [idx, p] of pointSamples.entries()) {
    const id = `pt_sample_${idx + 1}`;
    const exists = await memberPointsCol().findOne({ id });
    if (exists && !force) continue;
    if (exists) await memberPointsCol().deleteOne({ id });
    const member = await findMemberDoc(p.memberId);
    if (!member) continue;
    const atMs = now.getTime() - p.daysAgo * dayMs;
    const bal = Math.max(0, Number(member.points) || 0);
    await memberPointsCol().insertOne({
      _id: id,
      id,
      memberId: String(member.id || member.phone),
      memberPhone: member.phone,
      memberName: member.name || '',
      delta: p.delta,
      requestedDelta: p.delta,
      balanceBefore: Math.max(0, bal - p.delta),
      balanceAfter: bal,
      clamped: false,
      type: p.type,
      reason: p.reason,
      amountBase: null,
      posTransactionId: '',
      posOrderNo: '',
      isSample: true,
      createdAt: formatHkDateTime(new Date(atMs)),
      createdAtMs: atMs,
      createdBy: String(me.id),
      createdByName: actorName,
    });
    pointsAdded += 1;
  }

  // —— 交易樣本（不扣庫存）——
  function lineFromSku(sku, qty) {
    const p = bySku.get(sku);
    if (!p) return null;
    const unitPrice = Number(p.price) || 0;
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    return {
      qty,
      name: p.name,
      sku: p.sku,
      size: p.size,
      unitPrice,
      lineTotal,
      productId: p.id,
      transferProductId: p.transferProductId,
      returnedQty: 0,
    };
  }

  const txSpecs = [
    {
      id: 'tx_sample_1',
      daysAgo: 0,
      store: '觀塘',
      paymentMethod: 'cash',
      memberPhone: '91110002',
      items: [
        ['WS-U001-M', 2],
        ['WS-F001-M', 1],
      ],
      remark: '示範：今日現金單',
    },
    {
      id: 'tx_sample_2',
      daysAgo: 0,
      store: '觀塘',
      paymentMethod: 'octopus',
      memberPhone: '91110001',
      items: [['WS-S001-M', 1]],
      remark: '示範：今日八達通＋會員',
      pointsRedeemed: 100,
    },
    {
      id: 'tx_sample_3',
      daysAgo: 1,
      store: '荔枝角',
      paymentMethod: 'credit_card',
      memberPhone: '91110003',
      items: [
        ['WS-S001-L', 1],
        ['WS-U001-S', 1],
      ],
      remark: '示範：昨日信用卡',
    },
    {
      id: 'tx_sample_4',
      daysAgo: 2,
      store: '灣仔',
      paymentMethod: 'fps',
      items: [['WS-F001-L', 2]],
      remark: '示範：FPS',
    },
    {
      id: 'tx_sample_5',
      daysAgo: 3,
      store: '屯門',
      paymentMethod: 'cash',
      memberPhone: '91110004',
      items: [['WS-U001-M', 1]],
      remark: '示範：屯門現金',
    },
    {
      id: 'tx_sample_6',
      daysAgo: 5,
      store: '觀塘',
      paymentMethod: 'credit_card',
      items: [
        ['WS-S001-M', 1],
        ['WS-F001-M', 1],
      ],
      remark: '示範：報表用歷史單',
      status: 'partial_return',
      orderStatus: '部分退貨',
      returnedSku: 'WS-F001-M',
    },
  ];

  const paymentNames = { cash: '現金', credit_card: '信用卡', octopus: '八達通', fps: 'FPS' };
  const storePrefix = { 觀塘: 'KT', 荔枝角: 'LC', 灣仔: 'WC', 屯門: 'TM' };
  let txsAdded = 0;
  for (const [idx, spec] of txSpecs.entries()) {
    const exists = await posTransactionsCol().findOne({ id: spec.id });
    if (exists && !force) continue;
    if (exists) await posTransactionsCol().deleteOne({ id: spec.id });

    const items = [];
    for (const [sku, qty] of spec.items) {
      const line = lineFromSku(sku, qty);
      if (line) items.push(line);
    }
    if (!items.length) continue;

    let subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    subtotal = Math.round(subtotal * 100) / 100;
    const pointsRedeemed = Number(spec.pointsRedeemed) || 0;
    const pointsDiscount = pointsRedeemed > 0 ? pointsRedeemed / 100 : 0;
    const orderTotal = Math.max(0, Math.round((subtotal - pointsDiscount) * 100) / 100);
    const atMs = now.getTime() - spec.daysAgo * dayMs - idx * 3600 * 1000;
    const ymd = ymdOffset(spec.daysAgo);
    const member = spec.memberPhone ? await findMemberDoc(spec.memberPhone) : null;
    const orderNo = `${storePrefix[spec.store] || 'POS'}${ymd.replace(/-/g, '')}${String(idx + 1).padStart(4, '0')}`;

    const returns = [];
    if (spec.returnedSku) {
      const line = items.find((it) => it.sku === spec.returnedSku);
      if (line) {
        line.returnedQty = 1;
        const refundAmount = line.unitPrice;
        returns.push({
          id: `ret_sample_${idx + 1}`,
          at: formatHkDateTime(new Date(atMs + 2 * 3600 * 1000)),
          atMs: atMs + 2 * 3600 * 1000,
          reason: '示範退貨',
          refundMethod: 'cash',
          refundMethodName: '現金',
          refundAmount,
          items: [{ productId: line.productId, qty: 1, name: line.name }],
        });
      }
    }

    await posTransactionsCol().insertOne({
      _id: spec.id,
      id: spec.id,
      orderNo,
      receiptNo: orderNo,
      store: spec.store,
      paymentMethod: spec.paymentMethod,
      paymentMethodName: paymentNames[spec.paymentMethod] || spec.paymentMethod,
      accountBalance: 0,
      subtotal,
      pointsRedeemed,
      pointsDiscount,
      pointsEarned: member ? Math.floor(subtotal - pointsDiscount) : 0,
      orderTotal,
      items,
      returns,
      exchanges: [],
      status: spec.status || 'completed',
      orderStatus: spec.orderStatus || '完成',
      memberId: member ? String(member.id || member.phone) : '',
      memberName: member?.name || '',
      memberPhone: member?.phone || '',
      remark: spec.remark || '',
      staffId: String(me.id),
      staffName: actorName,
      cashierName: actorName,
      isSample: true,
      createdAt: formatHkDateTime(new Date(atMs)),
      createdAtMs: atMs,
      createdBy: String(me.id),
      createdByName: actorName,
    });
    txsAdded += 1;
  }

  // —— 日結樣本：昨日觀塘「待核對」——
  let settlementsAdded = 0;
  const setDate = ymdOffset(1);
  const setId = `set_sample_觀塘_${setDate}`;
  const setExists = await posSettlementsCol().findOne({ _id: setId });
  if (!setExists || force) {
    if (setExists) await posSettlementsCol().deleteOne({ _id: setId });
    const live = await buildPosSalesSummary({ store: '觀塘', from: setDate, to: setDate });
    const cashCounted = posRound2((live.expectedCash || 0) + 20);
    await posSettlementsCol().replaceOne(
      { _id: setId },
      {
        _id: setId,
        id: setId,
        store: '觀塘',
        date: setDate,
        locked: true,
        reviewStatus: 'pending_review',
        reviewNote: '',
        reviewedAt: null,
        reviewedById: null,
        reviewedByName: null,
        snapshot: { ...live },
        cashCounted,
        cashDiff: posRound2(cashCounted - (live.expectedCash || 0)),
        remark: '示範日結：待主管核對',
        attachments: [],
        submittedAt: time,
        submittedAtMs: now.getTime(),
        submittedById: String(me.id),
        submittedByName: actorName,
        history: [
          {
            action: 'submit',
            at: time,
            atMs: now.getTime(),
            byId: String(me.id),
            byName: actorName,
            cashCounted,
            remark: '示範提交',
          },
        ],
        isSample: true,
      },
      { upsert: true }
    );
    settlementsAdded = 1;
  }

  await posMetaCol().updateOne(
    { _id: 'samples' },
    {
      $set: {
        _id: 'samples',
        seededAt: time,
        seededAtMs: now.getTime(),
        seededBy: String(me.id),
        counts: {
          sellables: sellablesAdded,
          members: membersAdded,
          points: pointsAdded,
          transactions: txsAdded,
          settlements: settlementsAdded,
        },
      },
    },
    { upsert: true }
  );

  await appendModuleLog({
    module: 'pos',
    time,
    action: '載入 POS 示範資料',
    detail: `可售+${sellablesAdded}｜會員+${membersAdded}｜交易+${txsAdded}｜日結+${settlementsAdded}`,
    userId: me.id,
    userName: actorName,
    user: actorName,
  });

  return {
    ok: true,
    skipped: false,
    sellablesAdded,
    membersAdded,
    pointsAdded,
    transactionsAdded: txsAdded,
    settlementsAdded,
  };
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
