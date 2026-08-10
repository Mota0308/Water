import { google } from 'googleapis';
import { Readable } from 'stream';

const DAILY_NAME = 'daily.json';
const PROJECTS_NAME = 'projects.json';
const USERS_NAME = 'users.json';

let driveClient = null;
const fileIdCache = new Map();

function getFolderId() {
  return String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
}

function getUsersFileIdOverride() {
  return String(process.env.GOOGLE_DRIVE_USERS_FILE_ID || '').trim();
}

function loadCredentials() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if ((!raw || !String(raw).trim()) && b64) {
    try {
      raw = Buffer.from(String(b64).trim(), 'base64').toString('utf8');
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 無法解碼');
    }
  }
  if (!raw) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON env var');
  }
  raw = String(raw).trim();
  // Railway UI 有時會多包一層引號
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }
  // 常見：整段被 escape 成 \"type\":...
  if (raw.includes('\\"') && !raw.includes('"type"')) {
    raw = raw.replace(/\\"/g, '"').replace(/\\\\n/g, '\\n');
  }

  function parseSaJson(text) {
    let info = JSON.parse(text);
    if (typeof info === 'string') info = JSON.parse(info);
    return info;
  }

  let info;
  try {
    info = parseSaJson(raw);
  } catch {
    // private_key 若含真實換行會弄破 JSON → 改成 \n
    const repaired = raw.replace(
      /("private_key"\s*:\s*")([\s\S]*?)("\s*,)/,
      (_m, a, key, c) => a + key.replace(/\r?\n/g, '\\n') + c
    );
    try {
      info = parseSaJson(repaired);
    } catch (e2) {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON（請改貼整段一行，或改設 GOOGLE_SERVICE_ACCOUNT_JSON_BASE64）'
      );
    }
  }
  if (!info || typeof info !== 'object' || !info.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 缺少 private_key 欄位');
  }
  if (typeof info.private_key === 'string') {
    info.private_key = info.private_key.replace(/\\n/g, '\n');
  }
  return info;
}

export function driveConfigured() {
  return !!(
    (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) &&
    (process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_USERS_FILE_ID)
  );
}

export function getDrive() {
  if (driveClient) return driveClient;
  if (!getFolderId() && !getUsersFileIdOverride()) {
    throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID env var');
  }
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

async function findFileIdByName(name) {
  if (fileIdCache.has(name)) return fileIdCache.get(name);
  const folderId = getFolderId();
  if (!folderId) return null;
  const drive = getDrive();
  const q = [
    `'${folderId}' in parents`,
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
    corpora: 'allDrives',
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
      '請確認資料夾內已有 users.json，或在 Railway 設定 GOOGLE_DRIVE_USERS_FILE_ID（檔案網址 /d/ 與 /view 之間的 ID）。'
    );
  }
  if (/File not found/i.test(apiMsg) || reason === 'notFound') {
    return (
      '找不到 Drive 資料夾或檔案。請確認 GOOGLE_DRIVE_FOLDER_ID／GOOGLE_DRIVE_USERS_FILE_ID 正確，' +
      '且已把資料夾分享給服務帳戶（編輯者）。'
    );
  }
  return apiMsg;
}

async function updateJsonFileById(fileId, data) {
  const drive = getDrive();
  const body = JSON.stringify(data, null, 2);
  const media = {
    mimeType: 'application/json',
    body: Readable.from([body]),
  };
  try {
    await drive.files.update({
      fileId,
      media,
      fields: 'id,name',
      supportsAllDrives: true,
    });
  } catch (e) {
    throw new Error(formatDriveError(e));
  }
  return fileId;
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
    const folderId = getFolderId();
    if (!folderId) {
      throw new Error('缺少 GOOGLE_DRIVE_FOLDER_ID，且找不到既有檔案可更新。');
    }
    try {
      const created = await drive.files.create({
        requestBody: {
          name,
          parents: [folderId],
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
      // 可能其實已有檔但 list 沒找到：清 cache 再找一次
      fileIdCache.delete(name);
      const retryId = await findFileIdByName(name);
      if (retryId) {
        return updateJsonFileById(retryId, data);
      }
      throw new Error(formatDriveError(e));
    }
  }
  return updateJsonFileById(id, data);
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

  // 優先用明確檔案 ID（避開「服務帳戶不能新建」與 list 找不到）
  const overrideId = getUsersFileIdOverride();
  // 已為本專案建立的 users.json（Store_system_test）；無 env 時作後援
  const FALLBACK_USERS_FILE_ID = '1WkFU5XmnNxwxWGtByeZcWlPcv9crc1pD';
  let fileId;
  if (overrideId) {
    fileId = await updateJsonFileById(overrideId, payload);
    fileIdCache.set(USERS_NAME, fileId);
  } else {
    try {
      fileId = await writeJsonFile(USERS_NAME, payload);
    } catch (e) {
      const msg = String(e.message || e);
      if (/儲存配額|storageQuota|無法在「我的雲端硬碟」新建/i.test(msg)) {
        fileId = await updateJsonFileById(FALLBACK_USERS_FILE_ID, payload);
        fileIdCache.set(USERS_NAME, fileId);
      } else {
        throw e;
      }
    }
  }

  return {
    ok: true,
    fileName: USERS_NAME,
    fileId,
    folderId: getFolderId() || null,
    count: list.length,
    exportedAt: payload.exportedAt,
  };
}

/** 診斷用：服務帳戶能否看到資料夾／users.json */
export async function getDriveExportStatus() {
  if (!driveConfigured()) {
    return { ok: false, configured: false, error: 'Drive 未設定' };
  }
  try {
    const drive = getDrive();
    const about = await drive.about.get({ fields: 'user' });
    const folderId = getFolderId();
    const overrideId = getUsersFileIdOverride();
    let folder = null;
    let files = [];
    let usersFile = null;
    if (folderId) {
      try {
        const meta = await drive.files.get({
          fileId: folderId,
          fields: 'id,name,mimeType',
          supportsAllDrives: true,
        });
        folder = meta.data;
      } catch (e) {
        folder = { error: formatDriveError(e) };
      }
      try {
        const list = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'files(id,name)',
          pageSize: 20,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: 'allDrives',
        });
        files = list.data.files || [];
        usersFile = files.find((f) => f.name === USERS_NAME) || null;
      } catch (e) {
        files = [{ error: formatDriveError(e) }];
      }
    }
    if (!usersFile && overrideId) {
      try {
        const meta = await drive.files.get({
          fileId: overrideId,
          fields: 'id,name',
          supportsAllDrives: true,
        });
        usersFile = meta.data;
      } catch (e) {
        usersFile = { error: formatDriveError(e) };
      }
    }
    return {
      ok: true,
      configured: true,
      serviceAccount: about.data.user?.emailAddress || null,
      folderId: folderId || null,
      usersFileIdEnv: overrideId || null,
      folder,
      files,
      usersFile,
      canExportWithoutCreate: !!(usersFile && usersFile.id),
    };
  } catch (e) {
    return { ok: false, configured: true, error: formatDriveError(e) };
  }
}

export async function uploadFile({ buffer, filename, mimeType }) {
  const drive = getDrive();
  const folderId = getFolderId();
  if (!folderId) throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID');
  const created = await drive.files.create({
    requestBody: {
      name: filename || 'upload.bin',
      parents: [folderId],
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
