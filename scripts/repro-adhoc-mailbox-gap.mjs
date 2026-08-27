/**
 * Repro: adhoc with future dueDate missing from「今日工作」;
 * and adhoc notify payload omits descImages/attachments.
 *
 * Run: node scripts/repro-adhoc-mailbox-gap.mjs
 */
function dailyParseDateYmd(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
}

/** Current (buggy) rule from app.js isDailyTodayWork */
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

/** Fixed: adhoc open from createdDate through dueDate; recurring deferral still hides until due */
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
  // Mirrors notifyAdhocWorkCreated — no attachments field
  return {
    title: '突發任務：' + (workMeta.title || ''),
    content: workMeta.content || '',
    attachments: undefined,
    hasAttachmentsKey: false,
  };
}

function buildNotifyPayloadFixed(workMeta) {
  const desc = Array.isArray(workMeta.descImages) ? workMeta.descImages : [];
  return {
    title: '突發任務：' + (workMeta.title || ''),
    content: workMeta.content || '',
    attachments: desc.slice(),
    hasAttachmentsKey: true,
  };
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

// Symptom 1: future-due adhoc missing from today list (RED on buggy)
check(
  'buggy: future-due adhoc NOT in today (repro user symptom)',
  isDailyTodayWorkBuggy(adhoc, today) === false,
);
check(
  'fixed: future-due adhoc IS in today',
  isDailyTodayWorkFixed(adhoc, today) === true,
);
check(
  'fixed: deferred recurring still hidden until due',
  isDailyTodayWorkFixed(deferredRecurring, today) === false,
);
check(
  'fixed: overdue adhoc still shown',
  isDailyTodayWorkFixed({ ...adhoc, dueDate: '2026-08-25' }, today) === true,
);

// Symptom 2: notify omits descImages (RED on buggy)
const buggyNotif = buildNotifyPayloadBuggy(adhoc);
const fixedNotif = buildNotifyPayloadFixed(adhoc);
check(
  'buggy: notify has no attachments (repro empty mailbox files)',
  !buggyNotif.attachments || buggyNotif.attachments.length === 0,
);
check(
  'fixed: notify includes descImages as attachments',
  fixedNotif.attachments && fixedNotif.attachments.length === 1,
);

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nAll checks passed (harness documents bug + fix expectations).');
