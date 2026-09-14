import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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
loadEnvFile(path.join(root, 'server', '.env'));

const args = process.argv.slice(2).filter((a) => a !== '--');
const dryRun = args.includes('--dry-run');
const xlsxPaths = args.filter((a) => !a.startsWith('--')).map((a) => path.resolve(a));
if (!xlsxPaths.length) {
  console.error('請指定至少一個 Excel 檔路徑。');
  process.exit(1);
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXlsx(file) {
  if (!fs.existsSync(file)) throw new Error('找不到 Excel 檔：' + file);
  const tmp = path.join(process.env.TEMP || '/tmp', `customer-xlsx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmp, { recursive: true });
  const unzip = spawnSync('tar', ['-xf', file, '-C', tmp], { encoding: 'utf8' });
  if (unzip.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(unzip.stderr || unzip.stdout || '無法解壓 Excel');
  }
  return tmp;
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    strings.push(texts.join(''));
  }
  return strings;
}

function parseSheetRows(sheetXml, strings) {
  return [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = {};
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
    let c;
    while ((c = cellRe.exec(row[1]))) {
      const col = c[1];
      const attrs = c[3] || '';
      const inner = c[4] || '';
      if (attrs.includes('t="s"')) {
        const v = inner.match(/<v>([^<]*)<\/v>/);
        cells[col] = strings[Number(v ? v[1] : '')] ?? '';
      } else if (attrs.includes('t="inlineStr"')) {
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        cells[col] = decodeXml(t ? t[1] : '');
      } else {
        const v = inner.match(/<v>([^<]*)<\/v>/);
        cells[col] = v ? v[1] : '';
      }
    }
    return cells;
  });
}

function excelPhone(raw) {
  let s = String(raw || '').replace(/\D/g, '');
  while (s.startsWith('852') && s.length > 8) s = s.slice(3);
  if (/^\d{8}$/.test(s)) return s;
  return null;
}

function cell(row, col) {
  if (!col) return '';
  return String(row[col] ?? '').trim();
}

function birthPart(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '0') return '';
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return String(Math.floor(n));
  return s;
}

function mapHeader(header) {
  const map = {};
  Object.entries(header || {}).forEach(([col, label]) => {
    const k = String(label || '').trim().toLowerCase();
    if (k === 'name' || k === '姓名') map.name = col;
    else if (k === 'customer group' || k === '會員類別' || k === '會員級別') map.group = col;
    else if (k === 'phone' || k === '電話' || k === '手提電話') map.phone = col;
    else if (k === 'e-mail' || k === 'email' || k === '電郵') map.email = col;
    else if (k === 'birth day' || k === '生日日期' || k === '出生日') map.birthDay = col;
    else if (k === 'birth month' || k === '生日月份' || k === '出生月') map.birthMonth = col;
    else if (k === '積分' || k === 'reward balance' || k === 'points') map.points = col;
    else if (k === '餘額' || k === 'credit balance' || k === 'balance') map.balance = col;
    else if (k === '推薦人' || k === 'used referral code' || k === 'referrer') map.referrer = col;
    else if (k === 'custom remark' || k === '備註' || k === 'remark') map.remark = col;
  });
  return map;
}

function parseCustomerList(file) {
  const tmp = extractXlsx(file);
  try {
    const sstPath = path.join(tmp, 'xl/sharedStrings.xml');
    const strings = fs.existsSync(sstPath) ? parseSharedStrings(fs.readFileSync(sstPath, 'utf8')) : [];
    const sheetPath = path.join(tmp, 'xl/worksheets/sheet1.xml');
    if (!fs.existsSync(sheetPath)) throw new Error('Excel 沒有 sheet1');
    const rows = parseSheetRows(fs.readFileSync(sheetPath, 'utf8'), strings);
    const header = rows[0] || {};
    const cols = mapHeader(header);
    if (!cols.name || !cols.phone) {
      throw new Error(`${path.basename(file)} 找不到姓名／電話欄`);
    }
    return rows.slice(1).map((r, idx) => {
      const customerGroup = cell(r, cols.group);
      return {
        file: path.basename(file),
        excelRow: idx + 2,
        name: cell(r, cols.name),
        customerGroup,
        level: customerGroup,
        email: cell(r, cols.email),
        phone: excelPhone(cell(r, cols.phone)) || cell(r, cols.phone),
        birthDay: birthPart(cell(r, cols.birthDay)),
        birthMonth: birthPart(cell(r, cols.birthMonth)),
        points: Number(cell(r, cols.points)) || 0,
        balance: Number(cell(r, cols.balance)) || 0,
        referrer: cell(r, cols.referrer),
        remark: cell(r, cols.remark),
      };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const LEVEL_RANK = {
  尊貴會員: 5,
  教練會員: 4,
  長者會員: 3,
  普通會員: 2,
  新會員: 1,
};

function mergeRecords(lists) {
  const byPhone = new Map();
  const fileStats = [];
  for (const { file, records } of lists) {
    let valid = 0;
    for (const rec of records) {
      const phone = excelPhone(rec.phone);
      const name = String(rec.name || '').trim();
      if (!name || !phone) continue;
      valid += 1;
      const next = { ...rec, phone };
      const prev = byPhone.get(phone);
      if (!prev) {
        byPhone.set(phone, next);
        continue;
      }
      const prevRank = LEVEL_RANK[prev.level] || 0;
      const nextRank = LEVEL_RANK[next.level] || 0;
      const keep = nextRank > prevRank ? next : prev;
      const other = keep === next ? prev : next;
      keep.email = keep.email || other.email;
      keep.birthDay = keep.birthDay || other.birthDay;
      keep.birthMonth = keep.birthMonth || other.birthMonth;
      keep.referrer = keep.referrer || other.referrer;
      keep.remark = keep.remark || other.remark;
      keep.points = Math.max(Number(keep.points) || 0, Number(other.points) || 0);
      keep.balance = Math.max(Number(keep.balance) || 0, Number(other.balance) || 0);
      byPhone.set(phone, keep);
    }
    fileStats.push({ file: path.basename(file), rows: records.length, valid });
  }
  return { records: [...byPhone.values()], fileStats };
}

const lists = xlsxPaths.map((file) => ({ file, records: parseCustomerList(file) }));
const merged = mergeRecords(lists);
console.log(`檔案數：${xlsxPaths.length}${dryRun ? '（dry-run，不會寫入）' : ''}`);
console.log(JSON.stringify({ files: merged.fileStats, uniquePhones: merged.records.length }, null, 2));

const { mongoConfigured, importPosMembers, closeMongo } = await import('../server/mongo.js');
if (!mongoConfigured()) {
  console.error('未設定 MONGODB_URI，無法連線後端資料庫。');
  process.exit(1);
}

try {
  const summary = await importPosMembers(merged.records, { actorName: 'Excel 導入', dryRun });
  const skipReasons = {};
  for (const s of summary.skipped || []) {
    skipReasons[s.reason] = (skipReasons[s.reason] || 0) + 1;
  }
  const levels = {};
  for (const rec of merged.records) {
    const lv = rec.level || rec.customerGroup || '(empty)';
    levels[lv] = (levels[lv] || 0) + 1;
  }
  console.log(
    JSON.stringify(
      {
        dryRun,
        total: summary.total,
        inserted: summary.inserted,
        skippedExisting: summary.skippedExisting,
        skippedInvalid: summary.skippedInvalid,
        startId: summary.startId,
        endId: summary.endId,
        levels,
        skipReasons,
      },
      null,
      2
    )
  );
} finally {
  await closeMongo();
}
