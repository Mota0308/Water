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

export async function getNotificationsState() {
  await connectMongo();
  const doc = await notificationsCol().findOne({ _id: 'main' });
  if (!doc) return { ...EMPTY_NOTIFICATIONS };
  const { _id, updatedAt, ...rest } = doc;
  return {
    notifications: Array.isArray(rest.notifications) ? rest.notifications : [],
    notifSeq: typeof rest.notifSeq === 'number' ? rest.notifSeq : 1,
  };
}

/** 依檢視者過濾：非發送人只能看到自己的 recipient；發送人可見完整已讀名單 */
export function filterNotificationForViewer(item, viewerId) {
  if (!item || !viewerId) return null;
  const vid = String(viewerId);
  const isSender = String(item.fromUserId || '') === vid;
  const myRec = (item.recipients || []).find((r) => String(r.userId) === vid);
  if (!isSender && !myRec) return null;
  const { recipients: _r, ...rest } = item;
  if (isSender) {
    return {
      ...rest,
      recipients: Array.isArray(item.recipients)
        ? item.recipients.map((r) => ({
            userId: String(r.userId),
            read: !!r.read,
            readAt: r.readAt || null,
          }))
        : [],
    };
  }
  return {
    ...rest,
    recipients: [
      {
        userId: String(myRec.userId),
        read: !!myRec.read,
        readAt: myRec.readAt || null,
      },
    ],
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
    .map((n) => filterNotificationForViewer(n, viewerId))
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
        }))
    : [];
  let content = String(input?.content || '').trim();
  if (!content && !attachments.length) throw new Error('content or attachments required');
  if (!content && attachments.length) content = '（見附件）';
  const id = 'N' + String(state.notifSeq).padStart(3, '0');
  const now = new Date();
  const createdAt =
    input?.createdAt ||
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const item = {
    id,
    category: String(input?.category || '一般通知'),
    priority: String(input?.priority || '一般'),
    title: String(input?.title || '').trim(),
    content,
    attachments,
    fromUserId: String(input?.fromUserId || ''),
    fromName: String(input?.fromName || ''),
    createdAt,
    createdAtMs: Number(input?.createdAtMs) || now.getTime(),
    recipients: recipientIds.map((userId) => ({ userId, read: false, readAt: null })),
  };
  if (input?.actionType) item.actionType = String(input.actionType);
  if (input?.transferId) item.transferId = String(input.transferId);
  if (input?.transferResolved != null) item.transferResolved = !!input.transferResolved;
  state.notifications.unshift(item);
  state.notifSeq = (state.notifSeq || 1) + 1;
  await saveNotificationsState(state);
  return item;
}

export async function setNotificationReadState(id, userId, read) {
  await connectMongo();
  const state = await getNotificationsState();
  const item = state.notifications.find((n) => n.id === id);
  if (!item) throw new Error('Notification not found');
  const rec = (item.recipients || []).find((r) => r.userId === userId);
  if (!rec) throw new Error('Not a recipient');
  const wantRead = !!read;
  if (!!rec.read === wantRead) return item;
  if (wantRead) {
    const now = new Date();
    rec.read = true;
    rec.readAt = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else {
    rec.read = false;
    rec.readAt = null;
  }
  await saveNotificationsState(state);
  return item;
}

export async function markNotificationRead(id, userId) {
  return setNotificationReadState(id, userId, true);
}

export async function markNotificationUnread(id, userId) {
  return setNotificationReadState(id, userId, false);
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

/** 只保留目前種子清單中的示範款（WS-*），多餘樣本刪除 */
async function trimTransferSeedProducts() {
  const keepIds = TRANSFER_SEED_PRODUCTS.map((p) => p.id);
  const keepSet = new Set(keepIds);
  const seedish = await transferProductsCol()
    .find({ $or: [{ _id: /^WS-/ }, { id: /^WS-/ }] })
    .project({ _id: 1, id: 1 })
    .toArray();
  const toRemove = seedish
    .map((p) => String(p.id || p._id))
    .filter((id) => id && !keepSet.has(id));
  if (toRemove.length) {
    await transferProductsCol().deleteMany({
      $or: [{ _id: { $in: toRemove } }, { id: { $in: toRemove } }],
    });
    await transferInventoryCol().deleteMany({ productId: { $in: toRemove } });
    console.log('Trimmed transfer seed products:', toRemove.join(', '));
  }
  return toRemove.length;
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
  return {
    stores: TRANSFER_STORES.slice(),
    categories: TRANSFER_CATEGORIES.slice(),
    rows,
  };
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

/**
 * 申請調動：發起點＝調入店，調動點＝調出店；通知調出店相關人員信箱。
 */
export async function applyTransferRequest(actor, input) {
  await connectMongo();
  await ensureTransferSeed();
  const me = publicUser(actor);
  if (!me?.id) throw new Error('未登入');
  const productId = String(input?.productId || '').trim();
  const size = String(input?.size || '').trim();
  const toStore = String(input?.toStore || '').trim(); // 發起點／調入
  const fromStore = String(input?.fromStore || '').trim(); // 調動點／調出
  const quantity = Math.floor(Number(input?.quantity));
  if (!productId || !size) throw new Error('請指定商品與尺碼');
  if (!TRANSFER_STORES.includes(toStore) || !TRANSFER_STORES.includes(fromStore)) {
    throw new Error('門市僅限觀塘／荔枝角／灣仔／屯門');
  }
  if (toStore === fromStore) throw new Error('發起點與調動點不可相同');
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error('調動數量須為正整數');

  const product = await transferProductsCol().findOne({ id: productId, active: { $ne: false } });
  if (!product) throw new Error('找不到商品');
  const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['均碼'];
  if (!sizes.includes(size)) throw new Error('此商品沒有該尺碼');

  const available = await getInventoryQty(productId, size, fromStore);
  if (quantity > available) {
    throw new Error(`調動點（${fromStore}）庫存不足（現有 ${available}）`);
  }

  const now = new Date();
  const id = await nextTransferOrderId();
  const createdAt = formatHkDateTime(now);
  const actorName = String(me.name || me.login || me.id);
  const order = {
    _id: id,
    id,
    productId,
    productName: product.name || '',
    category: product.category || '其他',
    color: product.color || '',
    size,
    quantity,
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
        detail: `${productId} ${size} × ${quantity}｜發起點（調入）${toStore} ← 調動點（調出）${fromStore}`,
      },
    ],
  };

  const recipientIds = await resolveTransferRecipientIds(fromStore);
  if (!recipientIds.length) throw new Error('找不到可通知的調動點人員');

  const notif = await createNotification({
    category: '貨品調動',
    priority: '重要',
    title: `調動申請 ${id}｜${productId} ${size} × ${quantity}`,
    content: [
      `${order.createdByName} 申請貨品調動，請審批。`,
      `單號：${id}`,
      `商品：${productId} ${product.name || ''}｜尺碼 ${size}｜數量 ${quantity}`,
      `發起點（調入）：${toStore}`,
      `調動點（調出）：${fromStore}`,
      '通過後會立即從調出店扣減並加入調入店。',
    ].join('\n'),
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
    detail: `${id} ${productId} ${size}×${quantity} ${fromStore}→${toStore}`,
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

  if (dec === 'approve') {
    const available = await getInventoryQty(order.productId, order.size, order.fromStore);
    if (order.quantity > available) {
      throw new Error(`庫存不足，無法通過（${order.fromStore} 現有 ${available}，申請 ${order.quantity}）。單據仍維持待審批。`);
    }
    await adjustInventoryQty(order.productId, order.size, order.fromStore, -order.quantity);
    await adjustInventoryQty(order.productId, order.size, order.toStore, order.quantity);
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
      detail: `已從 ${order.fromStore} 扣 ${order.quantity}，加入 ${order.toStore}`,
    });
    await transferOrdersCol().replaceOne({ _id: order._id }, order);
    await markTransferNotificationsResolved(id, `已通過（${actorName}）`);
    await appendModuleLog({
      module: 'transfer',
      time,
      action: '通過調動',
      detail: `${id} ${order.productId} ${order.size}×${order.quantity} ${order.fromStore}→${order.toStore}`,
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

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    bucket = null;
  }
}
