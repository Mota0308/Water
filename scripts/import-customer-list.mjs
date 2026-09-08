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

const DEFAULT_XLSX = 'c:/Users/Dolphin/Downloads/CustomerList_20260908T153735.xlsx';
const args = process.argv.slice(2).filter((a) => a !== '--');
const dryRun = args.includes('--dry-run');
const xlsxArg = args.find((a) => !a.startsWith('--'));
const xlsxPath = path.resolve(xlsxArg || DEFAULT_XLSX);

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
  const tmp = path.join(process.env.TEMP || '/tmp', `customer-xlsx-${Date.now()}`);
  fs.rmSync(tmp, { recursive: true, force: true });
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

function parseCustomerList(file) {
  const tmp = extractXlsx(file);
  try {
    const sstPath = path.join(tmp, 'xl/sharedStrings.xml');
    const strings = fs.existsSync(sstPath) ? parseSharedStrings(fs.readFileSync(sstPath, 'utf8')) : [];
    const sheetPath = path.join(tmp, 'xl/worksheets/sheet1.xml');
    if (!fs.existsSync(sheetPath)) throw new Error('Excel 沒有 sheet1');
    const rows = parseSheetRows(fs.readFileSync(sheetPath, 'utf8'), strings);
    const data = rows.slice(1);
    return data.map((r, idx) => {
      const customerGroup = String(r.C || '').trim();
      return {
        excelRow: idx + 2,
        name: String(r.B || '').trim(),
        customerGroup,
        level: /vip/i.test(customerGroup) ? 'VIP 會員' : '一般會員',
        email: String(r.D || '').trim(),
        phone: excelPhone(r.E) || String(r.E || '').trim(),
        birthDay: String(r.F || '').trim(),
        birthMonth: String(r.G || '').trim(),
        points: Number(r.H) || 0,
        balance: Number(r.I) || 0,
        referrer: String(r.J || '').trim(),
      };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const records = parseCustomerList(xlsxPath);
console.log(`Excel：${xlsxPath}`);
console.log(`列數：${records.length}${dryRun ? '（dry-run，不會寫入）' : ''}`);

const { mongoConfigured, importPosMembers, closeMongo } = await import('../server/mongo.js');
if (!mongoConfigured()) {
  console.error('未設定 MONGODB_URI，無法連線後端資料庫。');
  process.exit(1);
}

try {
  const summary = await importPosMembers(records, { actorName: 'Excel 導入', dryRun });
  const skipReasons = {};
  for (const s of summary.skipped || []) {
    skipReasons[s.reason] = (skipReasons[s.reason] || 0) + 1;
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
        skipReasons,
        skippedSample: (summary.skipped || []).slice(0, 20),
      },
      null,
      2
    )
  );
} finally {
  await closeMongo();
}
