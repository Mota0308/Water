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
  return db;
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
  const content = String(input?.content || '').trim();
  if (!content) throw new Error('content required');
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
