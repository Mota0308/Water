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
  await notificationsCol().createIndex({ _id: 1 });
  await usersCol().createIndex({ login: 1 }, { unique: true });
  await sessionsCol().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await metaCol().createIndex({ _id: 1 });
  console.log('MongoDB connected:', DB_NAME);
  try {
    await migrateUsersV1();
    await migrateProjectsV1();
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
  return db.collection('projects');
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

/** 將各功能文件中的舊使用者 id 改成新電話 id */
export async function rewriteUserRefs(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return { projects: 0, daily: false, notifications: false, sessions: 0 };
  await connectMongo();
  let projects = 0;
  const projDocs = await projectsCol().find({ _id: { $ne: 'main' } }).toArray();
  for (const doc of projDocs) {
    const next = rewriteIdsInValue(doc, oldId, newId);
    if (JSON.stringify(next) !== JSON.stringify(doc)) {
      next.updatedAt = new Date();
      await projectsCol().replaceOne({ _id: doc._id }, next);
      projects++;
    }
  }
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
  return { projects, daily, notifications, sessions: sess.modifiedCount || 0 };
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
    const moduleLogs =
      main.moduleLogs && typeof main.moduleLogs === 'object' ? main.moduleLogs : { daily: [], production: [], replenishment: [] };
    await metaCol().replaceOne(
      { _id: 'projects' },
      { _id: 'projects', projSeq, moduleLogs, updatedAt: new Date() },
      { upsert: true }
    );
    await projectsCol().deleteOne({ _id: 'main' });
    console.log('Migrated projects → one doc each:', list.length);
  } else {
    const meta = await metaCol().findOne({ _id: 'projects' });
    if (!meta) {
      await metaCol().insertOne({
        _id: 'projects',
        projSeq: 1,
        moduleLogs: { daily: [], production: [], replenishment: [] },
        updatedAt: new Date(),
      });
    }
  }
  await setMigrationFlag('projectsV1');
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

  const sampleProjIds = [];
  const cursor = projectsCol().find({ _id: { $ne: 'main' } });
  for await (const doc of cursor) {
    const p = { ...doc, id: doc.id || doc._id };
    if (isSampleProject(p)) sampleProjIds.push(doc._id);
  }
  if (sampleProjIds.length) {
    await projectsCol().deleteMany({ _id: { $in: sampleProjIds } });
    changed = true;
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

  const meta = await metaCol().findOne({ _id: 'projects' });
  if (meta?.moduleLogs && typeof meta.moduleLogs === 'object') {
    const moduleLogs = { ...meta.moduleLogs };
    let logsChanged = false;
    for (const mod of ['daily', 'production', 'replenishment']) {
      if (!Array.isArray(moduleLogs[mod])) continue;
      const next = moduleLogs[mod].filter((l) => {
        const blob = `${(l && l.detail) || ''}|${(l && l.action) || ''}`;
        return !SAMPLE_LOG_RE.test(blob);
      });
      if (next.length !== moduleLogs[mod].length) {
        moduleLogs[mod] = next;
        logsChanged = true;
      }
    }
    if (logsChanged) {
      await metaCol().updateOne({ _id: 'projects' }, { $set: { moduleLogs, updatedAt: new Date() } });
      changed = true;
    }
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

async function listProjectDocs() {
  const docs = await projectsCol().find({ _id: { $ne: 'main' } }).toArray();
  return docs.map((d) => {
    const { _id, updatedAt, users: _u, ...rest } = d;
    return { ...rest, id: rest.id || String(_id) };
  });
}

async function getProjectsMeta() {
  let meta = await metaCol().findOne({ _id: 'projects' });
  if (!meta) {
    meta = {
      _id: 'projects',
      projSeq: 1,
      moduleLogs: { daily: [], production: [], replenishment: [] },
      updatedAt: new Date(),
    };
    await metaCol().insertOne(meta);
  }
  return meta;
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
  const projects = await listProjectDocs();
  const meta = await getProjectsMeta();
  const users = await listUsersPublic();
  return {
    projects,
    projSeq: typeof meta.projSeq === 'number' ? meta.projSeq : 1,
    moduleLogs: meta.moduleLogs && typeof meta.moduleLogs === 'object' ? meta.moduleLogs : { daily: [], production: [], replenishment: [] },
    users,
  };
}

export async function saveProjectsState(data) {
  await connectMongo();
  // users 唯一真相在 users collection — 忽略 body.users
  const list = Array.isArray(data?.projects) ? data.projects.filter((p) => p && p.id) : [];
  const keepIds = new Set(list.map((p) => String(p.id)));

  for (const p of list) {
    const id = String(p.id);
    const { users: _u, _id, ...rest } = p;
    await projectsCol().replaceOne(
      { _id: id },
      { ...rest, id, _id: id, updatedAt: new Date() },
      { upsert: true }
    );
  }

  const existing = await projectsCol()
    .find({ _id: { $ne: 'main' } })
    .project({ _id: 1 })
    .toArray();
  const toDelete = existing.map((d) => d._id).filter((id) => !keepIds.has(String(id)));
  if (toDelete.length) {
    await projectsCol().deleteMany({ _id: { $in: toDelete } });
  }

  // clean legacy blob if still present
  await projectsCol().deleteOne({ _id: 'main' });

  const projSeq = typeof data?.projSeq === 'number' ? data.projSeq : 1;
  const moduleLogs =
    data?.moduleLogs && typeof data.moduleLogs === 'object'
      ? data.moduleLogs
      : { daily: [], production: [], replenishment: [] };
  await metaCol().replaceOne(
    { _id: 'projects' },
    { _id: 'projects', projSeq, moduleLogs, updatedAt: new Date() },
    { upsert: true }
  );
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
  state.notifications.unshift(item);
  state.notifSeq = (state.notifSeq || 1) + 1;
  await saveNotificationsState(state);
  return item;
}

export async function markNotificationRead(id, userId) {
  await connectMongo();
  const state = await getNotificationsState();
  const item = state.notifications.find((n) => n.id === id);
  if (!item) throw new Error('Notification not found');
  const rec = (item.recipients || []).find((r) => r.userId === userId);
  if (!rec) throw new Error('Not a recipient');
  if (!rec.read) {
    const now = new Date();
    rec.read = true;
    rec.readAt = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    await saveNotificationsState(state);
  }
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

export function canCreateEmployee(user) {
  if (!user) return false;
  return user.role === 'system_admin' || user.role === 'manager' || user.position === '經理' || user.position === '主管' || isAdminAccount(user);
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    bucket = null;
  }
}
