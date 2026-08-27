/**
 * Repro: adhoc with future dueDate missing from「今日工作」;
 * notify payload omits descImages; old notices need display fallback.
 *
 * Run: node scripts/repro-adhoc-mailbox-gap.mjs
 */
function dailyParseDateYmd(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
}

function isDailyTodayWorkBuggy(w, today) {
  if (!w || w.status === 'cancelled') return false;
  const due = dailyParseDateYmd(w.dueDate);
  if (!due) return false;
  if (w.status === 'done') {
    if (due === today) return true;
    return dailyParseDateYmd(w.completedAt) === today;
  }
  return due <= today;
}

function isDailyTodayWorkFixed(w, today) {
  if (!w || w.status === 'cancelled') return false;
  const due = dailyParseDateYmd(w.dueDate);
  if (!due) return false;
  if (w.status === 'done') {
    if (due === today) return true;
    return dailyParseDateYmd(w.completedAt) === today;
  }
  if (due <= today) return true;
  if (w.kind === 'adhoc') {
    const created = dailyParseDateYmd(w.createdDate) || dailyParseDateYmd(w.createdAt) || due;
    return created <= today;
  }
  return false;
}

function buildNotifyPayloadBuggy(workMeta) {
  return {
    title: '突發任務：' + (workMeta.title || ''),
    content: workMeta.content || '',
    attachments: undefined,
  };
}

function buildNotifyPayloadFixed(workMeta) {
  const desc = Array.isArray(workMeta.descImages) ? workMeta.descImages : [];
  return {
    title: '突發任務：' + (workMeta.title || ''),
    content: workMeta.content || '',
    attachments: desc.slice(),
  };
}

function noticeAttachmentsForDisplay(n, works) {
  const own = Array.isArray(n && n.attachments) ? n.attachments.filter(Boolean) : [];
  if (own.length) return own;
  const title = String((n && n.title) || '').trim();
  const m = title.match(/^突發任務[：:]\s*(.+)$/);
  const workTitle = m ? String(m[1] || '').trim() : '';
  if (!workTitle) return [];
  const seen = {};
  const out = [];
  for (const w of works || []) {
    if (!w || w.kind !== 'adhoc' || w.status === 'cancelled') continue;
    if (String(w.title || '').trim() !== workTitle) continue;
    for (const f of w.descImages || []) {
      if (!f) continue;
      const key = f.driveFileId || f.name;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(f);
    }
  }
  return out;
}

const today = '2026-08-27';
const adhoc = {
  kind: 'adhoc',
  status: 'open',
  title: '各門市擺設優化',
  dueDate: '2026-08-28',
  createdDate: '2026-08-26',
  createdAt: '2026-08-26 05:15',
  descImages: [{ name: '擺設參考.jpg', driveFileId: 'file1' }],
};
const deferredRecurring = {
  kind: 'recurring',
  status: 'open',
  title: '已延期恆常',
  dueDate: '2026-08-29',
  createdDate: '2026-08-20',
};

let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed++;
    console.error('FAIL:', name);
  } else {
    console.log('PASS:', name);
  }
}

check('buggy: future-due adhoc NOT in today (repro user symptom)', isDailyTodayWorkBuggy(adhoc, today) === false);
check('fixed: future-due adhoc IS in today', isDailyTodayWorkFixed(adhoc, today) === true);
check('fixed: deferred recurring still hidden until due', isDailyTodayWorkFixed(deferredRecurring, today) === false);
check('fixed: overdue adhoc still shown', isDailyTodayWorkFixed({ ...adhoc, dueDate: '2026-08-25' }, today) === true);

const buggyNotif = buildNotifyPayloadBuggy(adhoc);
const fixedNotif = buildNotifyPayloadFixed(adhoc);
check('buggy: notify has no attachments (repro empty mailbox files)', !buggyNotif.attachments || buggyNotif.attachments.length === 0);
check('fixed: notify includes descImages as attachments', fixedNotif.attachments && fixedNotif.attachments.length === 1);

check(
  'display: prefer notice attachments when present',
  noticeAttachmentsForDisplay(
    { title: '突發任務：各門市擺設優化', attachments: [{ name: 'from-notice.jpg', driveFileId: 'n1' }] },
    [adhoc],
  )[0].driveFileId === 'n1',
);
check(
  'display: fallback to work descImages when notice empty (N038 case)',
  noticeAttachmentsForDisplay(
    { title: '突發任務：各門市擺設優化', category: '突發任務', attachments: [] },
    [adhoc],
  ).length === 1,
);

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nAll checks passed.');
