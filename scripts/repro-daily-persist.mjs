/**
 * Regression harness: 恆常／突發任務刷新後消失
 *
 * Run: node scripts/repro-daily-persist.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function flushCloudSaves({ persistProjects, persistDaily }) {
  const errors = [];
  try {
    await persistProjects();
  } catch (e) {
    errors.push(e);
  }
  try {
    await persistDaily();
  } catch (e) {
    errors.push(e);
  }
  if (errors.length) throw errors[errors.length - 1];
}

function dailyNormalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : { version: 2, works: [], recurringTemplates: [], opLogs: [] };
  s.version = 2;
  s.works = Array.isArray(s.works) ? s.works : [];
  s.recurringTemplates = Array.isArray(s.recurringTemplates) ? s.recurringTemplates : [];
  s.opLogs = Array.isArray(s.opLogs) ? s.opLogs : [];
  return s;
}

function mergeById(cloudArr, localArr) {
  const m = new Map();
  (cloudArr || []).forEach((x) => {
    if (x && x.id != null) m.set(String(x.id), x);
  });
  (localArr || []).forEach((x) => {
    if (x && x.id != null) m.set(String(x.id), x);
  });
  return Array.from(m.values());
}

function opLogKey(l) {
  return [l?.time || '', l?.userId || l?.user || '', l?.action || '', l?.detail || ''].join('|');
}

function mergeOpLogs(cloudArr, localArr) {
  const m = new Map();
  (cloudArr || []).forEach((l) => m.set(opLogKey(l), l));
  (localArr || []).forEach((l) => m.set(opLogKey(l), l));
  return Array.from(m.values())
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .slice(0, 500);
}

function mergeDailyStates(cloudRaw, localRaw) {
  const cloud = dailyNormalizeState(cloudRaw);
  const local = dailyNormalizeState(localRaw);
  return {
    version: 2,
    works: mergeById(cloud.works, local.works),
    recurringTemplates: mergeById(cloud.recurringTemplates, local.recurringTemplates),
    opLogs: mergeOpLogs(cloud.opLogs, local.opLogs),
  };
}

/** Mirrors loadCloudAppData: dirty local merges; clean local yields to cloud. */
function loadDailyForRefresh(cloudRaw, localRaw, dirty) {
  const cloud = dailyNormalizeState(cloudRaw);
  if (dirty && localRaw) return mergeDailyStates(cloud, localRaw);
  return cloud;
}

async function testFlushProjectsFailStillSavesDaily() {
  let dailySaved = false;
  let threw = false;
  try {
    await flushCloudSaves({
      persistProjects: async () => {
        throw new Error('projects PUT failed');
      },
      persistDaily: async () => {
        dailySaved = true;
      },
    });
  } catch (e) {
    threw = true;
  }
  assert(dailySaved, 'daily must persist even when projects PUT fails');
  assert(threw, 'flush must still report sync error when projects fail');
}

async function testDirtyRefreshKeepsLocalCreates() {
  const local = {
    version: 2,
    works: [{ id: 'adhoc-new', title: '臨時補貨', kind: 'adhoc', status: 'open', unit: '觀塘' }],
    recurringTemplates: [{ id: 'tpl-new', title: '每日清潔', active: true, units: ['觀塘'] }],
    opLogs: [],
  };
  const cloud = {
    version: 2,
    works: [{ id: 'adhoc-old', title: '舊工作', kind: 'adhoc', status: 'open', unit: '觀塘' }],
    recurringTemplates: [],
    opLogs: [],
  };

  const wiped = loadDailyForRefresh(cloud, local, false);
  assert(!wiped.works.some((w) => w.id === 'adhoc-new'), 'clean local must not override cloud');

  const merged = loadDailyForRefresh(cloud, local, true);
  assert(
    merged.works.some((w) => w.id === 'adhoc-new') && merged.works.some((w) => w.id === 'adhoc-old'),
    'dirty refresh must keep unsynced local creates and cloud works'
  );
  assert(
    merged.recurringTemplates.some((t) => t.id === 'tpl-new'),
    'dirty refresh must keep unsynced recurring template'
  );
}

async function testPersistSeqDoesNotClearNewerDirty() {
  let persistSeq = 0;
  let dirty = '0';
  function saveLocal() {
    persistSeq += 1;
    dirty = '1';
  }
  async function persistNow(getSeq) {
    const seqAtStart = getSeq();
    await Promise.resolve();
    if (seqAtStart === getSeq()) dirty = '0';
  }

  saveLocal();
  const p1 = persistNow(() => persistSeq);
  saveLocal();
  await p1;
  assert(dirty === '1', 'older persist must not clear dirty after a newer local save');
  await persistNow(() => persistSeq);
  assert(dirty === '0', 'matching persist seq clears dirty');
}

async function testOldPatternsAreBroken() {
  async function flushBuggy({ persistProjects, persistDaily }) {
    try {
      await persistProjects();
      await persistDaily();
    } catch (e) {}
  }
  let dailySaved = false;
  await flushBuggy({
    persistProjects: async () => {
      throw new Error('projects fail');
    },
    persistDaily: async () => {
      dailySaved = true;
    },
  });
  assert(!dailySaved, 'old flush blocked daily — symptom of refresh loss');

  const wiped = loadDailyForRefresh(
    { works: [], recurringTemplates: [], opLogs: [] },
    { works: [{ id: 'x' }], recurringTemplates: [{ id: 't' }], opLogs: [] },
    false
  );
  assert(wiped.works.length === 0, 'overwrite without dirty merge wipes local creates');
}

async function main() {
  const tests = [
    ['OLD patterns reproduce refresh-loss symptom', testOldPatternsAreBroken],
    ['flush: projects fail must not block daily', testFlushProjectsFailStillSavesDaily],
    ['refresh: dirty merge keeps unsynced creates', testDirtyRefreshKeepsLocalCreates],
    ['persist seq must not clear newer dirty', testPersistSeqDoesNotClearNewerDirty],
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
