import { MongoClient, GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'stream';

const DB_NAME = process.env.MONGODB_DB || 'store_employee';
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
  await db.collection('daily').createIndex({ _id: 1 });
  await db.collection('projects').createIndex({ _id: 1 });
  await db.collection('notifications').createIndex({ _id: 1 });
  console.log('MongoDB connected:', DB_NAME);
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

/** 啟動時清掉示範種子（保留 admin 與之後新建的真實資料）。呼叫前須已連上 db。 */
export async function purgeSampleDataOnce() {
  if (!db) throw new Error('Mongo not connected');
  let changed = false;

  const projDoc = await projectsCol().findOne({ _id: 'main' });
  if (projDoc) {
    const projects = Array.isArray(projDoc.projects) ? projDoc.projects : [];
    const nextProjects = projects.filter((p) => {
      if (!p) return false;
      if (SAMPLE_PROJECT_IDS.has(p.id)) return false;
      if (SAMPLE_PROJECT_CODES.has(p.code)) return false;
      if (SAMPLE_PROJECT_NAMES.has(p.name)) return false;
      return true;
    });
    let users = Array.isArray(projDoc.users) ? projDoc.users : [];
    users = users.filter((u) => {
      if (!u) return false;
      if (u.login === 'admin' || u.id === 'adm') return true;
      if (LEGACY_DEMO_LOGINS.has(String(u.login || '').toLowerCase())) return false;
      if (LEGACY_DEMO_IDS.has(u.id)) return false;
      return true;
    });
    if (!users.some((u) => u.login === 'admin')) {
      users.unshift({
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
      });
    }
    const moduleLogs = projDoc.moduleLogs && typeof projDoc.moduleLogs === 'object' ? { ...projDoc.moduleLogs } : {};
    for (const mod of ['daily', 'production', 'replenishment']) {
      if (!Array.isArray(moduleLogs[mod])) continue;
      moduleLogs[mod] = moduleLogs[mod].filter((l) => {
        const blob = `${(l && l.detail) || ''}|${(l && l.action) || ''}`;
        return !SAMPLE_LOG_RE.test(blob);
      });
    }
    if (
      nextProjects.length !== projects.length ||
      users.length !== (projDoc.users || []).length ||
      JSON.stringify(moduleLogs) !== JSON.stringify(projDoc.moduleLogs || {})
    ) {
      let projSeq = typeof projDoc.projSeq === 'number' ? projDoc.projSeq : 1;
      let maxN = 0;
      nextProjects.forEach((p) => {
        const m = String(p.id || '').match(/^P(\d+)$/);
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
      });
      if (maxN >= projSeq) projSeq = maxN + 1;
      await saveProjectsState({
        projects: nextProjects,
        projSeq,
        moduleLogs,
        users,
      });
      changed = true;
    }
  }

  const dailyDoc = await dailyCol().findOne({ _id: 'main' });
  if (dailyDoc) {
    const works = Array.isArray(dailyDoc.works) ? dailyDoc.works : [];
    const tpls = Array.isArray(dailyDoc.recurringTemplates) ? dailyDoc.recurringTemplates : [];
    const opLogs = Array.isArray(dailyDoc.opLogs) ? dailyDoc.opLogs : [];
    const removedTplIds = new Set(
      tpls.filter(isSampleDailyTemplate).map((t) => t.id).filter(Boolean)
    );
    const nextTpls = tpls.filter((t) => !isSampleDailyTemplate(t));
    const nextWorks = works.filter(
      (w) => !isSampleDailyWork(w) && !(w.templateId && removedTplIds.has(w.templateId))
    );
    const nextLogs = opLogs.filter((l) => {
      const blob = `${(l && l.detail) || ''}|${(l && l.action) || ''}`;
      return !SAMPLE_LOG_RE.test(blob);
    });
    if (
      nextWorks.length !== works.length ||
      nextTpls.length !== tpls.length ||
      nextLogs.length !== opLogs.length
    ) {
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

function dailyCol() {
  return db.collection('daily');
}
function projectsCol() {
  return db.collection('projects');
}
function notificationsCol() {
  return db.collection('notifications');
}

const EMPTY_DAILY = { version: 2, works: [], recurringTemplates: [], opLogs: [] };
const EMPTY_PROJECTS = { projects: null, projSeq: null, moduleLogs: null, users: null };
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

export async function getProjectsState() {
  await connectMongo();
  const doc = await projectsCol().findOne({ _id: 'main' });
  if (!doc) return { ...EMPTY_PROJECTS };
  const { _id, updatedAt, ...rest } = doc;
  return Object.keys(rest).length ? rest : { ...EMPTY_PROJECTS };
}

export async function saveProjectsState(data) {
  await connectMongo();
  const payload = { ...data, _id: 'main', updatedAt: new Date() };
  await projectsCol().replaceOne({ _id: 'main' }, payload, { upsert: true });
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

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    bucket = null;
  }
}
