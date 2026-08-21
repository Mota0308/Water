/**
 * Regression: 每日工作剔選後從今日清單消失
 *
 * Run: node scripts/repro-daily-tick-vanish.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function dailyTodayStr(d = new Date()) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function dailyParseDateYmd(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  return '';
}

function dailyNormalizeDue(v) {
  return dailyParseDateYmd(v) || String(v || '').trim();
}

/** BUG mirror: raw string compare / equality without normalizing dueDate */
function isDailyTodayWorkBuggy(w, today) {
  if (!w || w.status === 'cancelled' || !w.dueDate) return false;
  if (w.status === 'done') {
    if (w.dueDate === today) return true;
    return dailyParseDateYmd(w.completedAt) === today;
  }
  return w.dueDate <= today;
}

/** FIXED: always normalize dueDate before visibility checks */
function isDailyTodayWorkFixed(w, today) {
  if (!w || w.status === 'cancelled') return false;
  const due = dailyNormalizeDue(w.dueDate);
  if (!due) return false;
  if (w.status === 'done') {
    if (due === today) return true;
    return dailyParseDateYmd(w.completedAt) === today;
  }
  return due <= today;
}

function preferWork(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.status === 'done' && b.status !== 'done') return a;
  if (b.status === 'done' && a.status !== 'done') return b;
  const ta = String(a.updatedAt || a.completedAt || '');
  const tb = String(b.updatedAt || b.completedAt || '');
  return tb.localeCompare(ta) >= 0 ? b : a;
}

function mergeByIdPrefer(cloudArr, localArr) {
  const m = {};
  for (const x of cloudArr || []) {
    if (!x || x.id == null) continue;
    m[String(x.id)] = preferWork(m[String(x.id)], x);
  }
  for (const x of localArr || []) {
    if (!x || x.id == null) continue;
    m[String(x.id)] = preferWork(m[String(x.id)], x);
  }
  return Object.keys(m).map((k) => m[k]);
}

/** BUG: only merge when dirty */
function loadDailyBuggy(cloud, local, dirty) {
  if (dirty && local) return { works: mergeByIdPrefer(cloud.works, local.works) };
  return cloud;
}

/** FIXED: always merge when local cache exists */
function loadDailyFixed(cloud, local) {
  if (!local) return cloud;
  return { works: mergeByIdPrefer(cloud.works, local.works) };
}

function completeLike(w, today, nowLabel) {
  const next = { ...w, status: 'done', completedAt: nowLabel, updatedAt: nowLabel };
  const due = dailyNormalizeDue(next.dueDate);
  if (due && due < today) next.dueDate = today;
  else if (due) next.dueDate = due;
  return next;
}

function completeLikeBuggy(w, today, nowLabel) {
  const next = { ...w, status: 'done', completedAt: nowLabel, updatedAt: nowLabel };
  // raw compare — unpadded overdue may skip roll
  if (next.dueDate && next.dueDate < today) next.dueDate = today;
  return next;
}

function testUnpaddedDueHidesTodayOpen() {
  const today = '2026-08-22';
  const w = { id: '1', status: 'open', dueDate: '2026-8-22', title: '清潔' };
  assert(!isDailyTodayWorkBuggy(w, today), 'BUG: unpadded today dueDate hides open work');
  assert(isDailyTodayWorkFixed(w, today), 'FIX: unpadded today dueDate stays visible');
}

function testUnpaddedOverdueCompleteVanishesBuggy() {
  const today = '2026-08-22';
  const nowLabel = '2026年8月22日 12:00';
  const open = { id: '2', status: 'open', dueDate: '2026-8-1', title: '點貨' };
  const doneBuggy = completeLikeBuggy(open, today, nowLabel);
  // roll skipped because '2026-8-1' > '2026-08-22' lexicographically
  assert(doneBuggy.dueDate === '2026-8-1', 'setup: buggy complete keeps unpadded overdue due');
  // Chinese completedAt still keeps it visible; vanishing hits when completedAt is unparsable
  const doneNoParse = { ...doneBuggy, completedAt: 'Aug 22, 2026 12:00' };
  assert(
    !isDailyTodayWorkBuggy(doneNoParse, today),
    'BUG: unpadded overdue done + unparsable completedAt vanishes'
  );

  const doneFixed = completeLike(open, today, nowLabel);
  assert(doneFixed.dueDate === today, 'FIX: overdue due rolls to today with normalize');
  assert(isDailyTodayWorkFixed(doneFixed, today), 'FIX: completed work stays on today list');
  assert(
    isDailyTodayWorkFixed({ ...doneFixed, completedAt: 'Aug 22, 2026 12:00' }, today),
    'FIX: rolled dueDate keeps visibility even if completedAt parse fails'
  );
}

function testStaleCloudWipesDoneWhenNotDirty() {
  const local = {
    works: [{ id: 'w1', status: 'done', dueDate: '2026-08-22', updatedAt: '2026年8月22日 12:01', completedAt: '2026年8月22日 12:01' }],
  };
  const cloud = {
    works: [{ id: 'w1', status: 'open', dueDate: '2026-08-22', updatedAt: '2026年8月22日 11:00' }],
  };
  const wiped = loadDailyBuggy(cloud, local, false);
  assert(wiped.works[0].status === 'open', 'BUG: clean reload lets stale cloud open wipe local done');

  const kept = loadDailyFixed(cloud, local);
  assert(kept.works[0].status === 'done', 'FIX: always merge prefers done over stale open');
}

function testPostponeLeavesTodayByDesign() {
  const today = '2026-08-22';
  const postponed = { id: '3', status: 'open', dueDate: '2026-08-23', title: '延後' };
  assert(!isDailyTodayWorkFixed(postponed, today), 'postponed future due correctly leaves today list');
}

async function main() {
  const tests = [
    ['unpadded dueDate hides open today (bug → fix)', testUnpaddedDueHidesTodayOpen],
    ['unpadded overdue tick vanishes (bug → fix)', testUnpaddedOverdueCompleteVanishesBuggy],
    ['stale cloud wipe done when dirty=0 (bug → fix)', testStaleCloudWipesDoneWhenNotDirty],
    ['postpone future due leaves today (expected)', testPostponeLeavesTodayByDesign],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('OK  ' + name);
    } catch (e) {
      failed++;
      console.error('ERR ' + name + '\n  ' + e.message);
    }
  }
  if (failed) {
    console.error('\n' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main();
