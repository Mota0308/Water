import { google } from 'googleapis';
import { Readable } from 'stream';

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const DAILY_NAME = 'daily.json';
const PROJECTS_NAME = 'projects.json';

let driveClient = null;
const fileIdCache = new Map();

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON env var');
  }
  let info;
  try {
    info = JSON.parse(raw);
    // Railway 有時會變成「字串再包一層」
    if (typeof info === 'string') info = JSON.parse(info);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  if (info.private_key && typeof info.private_key === 'string') {
    info.private_key = info.private_key.replace(/\\n/g, '\n');
  }
  return info;
}

export function getDrive() {
  if (driveClient) return driveClient;
  if (!FOLDER_ID) throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID env var');
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

export function driveConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID);
}

async function findFileIdByName(name) {
  if (fileIdCache.has(name)) return fileIdCache.get(name);
  const drive = getDrive();
  const q = [
    `'${FOLDER_ID}' in parents`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    'trashed = false',
  ].join(' and ');
  const res = await drive.files.list({
    q,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const id = res.data.files?.[0]?.id || null;
  if (id) fileIdCache.set(name, id);
  return id;
}

async function readJsonFile(name, fallback) {
  const drive = getDrive();
  const id = await findFileIdByName(name);
  if (!id) return { data: fallback, fileId: null, exists: false };
  const res = await drive.files.get(
    { fileId: id, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  const text = typeof res.data === 'string' ? res.data : String(res.data || '');
  try {
    return { data: JSON.parse(text || 'null') ?? fallback, fileId: id, exists: true };
  } catch {
    throw new Error(`Invalid JSON in Drive file: ${name}`);
  }
}

function formatDriveError(err) {
  const apiMsg =
    err?.response?.data?.error?.message ||
    err?.errors?.[0]?.message ||
    err?.message ||
    String(err);
  const reason = err?.response?.data?.error?.errors?.[0]?.reason || err?.errors?.[0]?.reason || '';
  if (
    reason === 'storageQuotaExceeded' ||
    /Service Accounts do not have storage quota/i.test(apiMsg)
  ) {
    return (
      'Google 服務帳戶無法在「我的雲端硬碟」新建檔案（無儲存配額）。' +
      '請用你的 Google 帳號在該資料夾手動建立空的 users.json，再重試匯出（之後會改為更新既有檔）。'
    );
  }
  if (/File not found/i.test(apiMsg) || reason === 'notFound') {
    return (
      '找不到 Drive 資料夾或檔案。請確認 GOOGLE_DRIVE_FOLDER_ID 正確，' +
      '且已把資料夾分享給服務帳戶（編輯者）。'
    );
  }
  return apiMsg;
}

async function writeJsonFile(name, data) {
  const drive = getDrive();
  const body = JSON.stringify(data, null, 2);
  const media = {
    mimeType: 'application/json',
    body: Readable.from([body]),
  };
  let id = await findFileIdByName(name);
  if (!id) {
    try {
      const created = await drive.files.create({
        requestBody: {
          name,
          parents: [FOLDER_ID],
          mimeType: 'application/json',
        },
        media,
        fields: 'id,name',
        supportsAllDrives: true,
      });
      id = created.data.id;
      fileIdCache.set(name, id);
      return id;
    } catch (e) {
      throw new Error(formatDriveError(e));
    }
  }
  try {
    await drive.files.update({
      fileId: id,
      media,
      fields: 'id,name',
      supportsAllDrives: true,
    });
  } catch (e) {
    throw new Error(formatDriveError(e));
  }
  return id;
}

export async function getDaily() {
  const empty = { version: 2, works: [], recurringTemplates: [], opLogs: [] };
  const { data } = await readJsonFile(DAILY_NAME, empty);
  return data && typeof data === 'object' ? data : empty;
}

export async function saveDaily(data) {
  await writeJsonFile(DAILY_NAME, data);
  return { ok: true };
}

export async function getProjectsState() {
  const empty = { projects: null, projSeq: null, moduleLogs: null, users: null };
  const { data } = await readJsonFile(PROJECTS_NAME, empty);
  return data && typeof data === 'object' ? data : empty;
}

export async function saveProjectsState(data) {
  await writeJsonFile(PROJECTS_NAME, data);
  return { ok: true };
}

const USERS_NAME = 'users.json';

/**
 * 將公開用戶清單寫入 Drive 資料夾的 users.json（不含密碼）。
 * @param {object[]} users
 */
export async function exportUsersToDrive(users) {
  if (!driveConfigured()) {
    throw new Error('Google Drive 未設定（需要 GOOGLE_SERVICE_ACCOUNT_JSON 與 GOOGLE_DRIVE_FOLDER_ID）');
  }
  const list = Array.isArray(users) ? users : [];
  const payload = {
    exportedAt: new Date().toISOString(),
    exportedAtHk: new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }),
    count: list.length,
    users: list,
  };
  const fileId = await writeJsonFile(USERS_NAME, payload);
  return {
    ok: true,
    fileName: USERS_NAME,
    fileId,
    folderId: FOLDER_ID,
    count: list.length,
    exportedAt: payload.exportedAt,
  };
}

export async function uploadFile({ buffer, filename, mimeType }) {
  const drive = getDrive();
  const created = await drive.files.create({
    requestBody: {
      name: filename || 'upload.bin',
      parents: [FOLDER_ID],
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: Readable.from(buffer),
    },
    fields: 'id,name,mimeType,size,webViewLink',
    supportsAllDrives: true,
  });
  return {
    id: created.data.id,
    name: created.data.name,
    mimeType: created.data.mimeType,
    size: created.data.size,
  };
}

export async function downloadFile(fileId) {
  const drive = getDrive();
  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType',
    supportsAllDrives: true,
  });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return {
    stream: res.data,
    name: meta.data.name || 'file',
    mimeType: meta.data.mimeType || 'application/octet-stream',
  };
}
