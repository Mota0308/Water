/**
 * Regression: 今日工作出現成對重複（同名恆常各兩筆）
 * Run: node scripts/repro-daily-dupes.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

function workSemanticKey(w) {
  if (!w) return '';
  const unit = String(w.unit || '');
  const due = String(w.dueDate || '');
  const kind = String(w.kind || '');
  if (kind === 'recurring') {
    const tid = String(w.templateId || '');
    if (tid) return 'rec|' + tid + '|' + unit + '|' + due;
    return 'rec|' + String(w.title || '') + '|' + unit + '|' + due;
  }
  if (kind === 'settlement') return 'set|' + unit + '|' + due;
  // adhoc: only collapse exact id duplicates elsewhere; keep separate same-title adhocs
  return 'id|' + String(w.id || '');
}

function dedupeWorks(works) {
  const byId = new Map();
  for (const w of works || []) {
    if (!w || w.id == null) continue;
    const id = String(w.id);
    byId.set(id, preferWork(byId.get(id), w));
  }
  const bySem = new Map();
  for (const w of byId.values()) {
    const key = workSemanticKey(w);
    bySem.set(key, preferWork(bySem.get(key), w));
  }
  return Array.from(bySem.values());
}

function tplKey(t) {
  const units = (t.units || []).slice().map(String).sort().join(',');
  return String(t.title || '').trim() + '|' + units;
}

function dedupeTemplates(templates) {
  const byId = new Map();
  for (const t of templates || []) {
    if (!t || t.id == null) continue;
    byId.set(String(t.id), t);
  }
  const bySem = new Map();
  for (const t of byId.values()) {
    const key = tplKey(t);
    const prev = bySem.get(key);
    if (!prev) {
      bySem.set(key, t);
      continue;
    }
    // prefer active, then the one already referenced less conflict — keep newer id string compare as weak tiebreak
    if (prev.active && !t.active) continue;
    if (!prev.active && t.active) {
      bySem.set(key, t);
      continue;
    }
    bySem.set(key, String(t.id).localeCompare(String(prev.id)) >= 0 ? t : prev);
  }
  return Array.from(bySem.values());
}

/** BUG: merge-by-id keeps two templates with same title → two works/day */
function generateFromTemplatesBuggy(templates, existingWorks, today) {
  const works = (existingWorks || []).slice();
  for (const t of templates || []) {
    if (!t || !t.active) continue;
    for (const unit of t.units || []) {
      const openExisting = works.find(
        (w) => w.kind === 'recurring' && w.templateId === t.id && w.unit === unit && w.status === 'open'
      );
      if (openExisting) continue;
      const existsToday = works.some(
        (w) =>
          w.kind === 'recurring' &&
          w.templateId === t.id &&
          w.unit === unit &&
          w.dueDate === today &&
          w.status !== 'cancelled'
      );
      if (!existsToday) {
        works.push({
          id: 'wrk_' + t.id + '_' + unit + '_' + Math.random().toString(36).slice(2, 6),
          kind: 'recurring',
          templateId: t.id,
          title: t.title,
          unit,
          dueDate: today,
          status: 'open',
        });
      }
    }
  }
  return works;
}

function hasRecurringCoverage(works, t, unit, today) {
  return (works || []).some((w) => {
    if (!w || w.status === 'cancelled') return false;
    if (w.kind !== 'recurring' || w.unit !== unit) return false;
    if (String(w.templateId || '') === String(t.id)) {
      if (w.status === 'open') return true;
      if (w.dueDate === today) return true;
    }
    // same title+unit today already covered (duplicate template ids)
    if (String(w.title || '') === String(t.title || '') && w.dueDate === today) return true;
    if (String(w.title || '') === String(t.title || '') && w.status === 'open') return true;
    return false;
  });
}

function generateFromTemplatesFixed(templates, existingWorks, today) {
  const tpls = dedupeTemplates(templates);
  let works = dedupeWorks(existingWorks || []);
  for (const t of tpls) {
    if (!t || !t.active) continue;
    for (const unit of t.units || []) {
      if (hasRecurringCoverage(works, t, unit, today)) continue;
      works.push({
        id: 'wrk_' + t.id + '_' + unit,
        kind: 'recurring',
        templateId: t.id,
        title: t.title,
        unit,
        dueDate: today,
        status: 'open',
      });
    }
  }
  return dedupeWorks(works);
}

function testDupTemplatesCreateDupWorks() {
  const today = '2026-08-22';
  const templates = [
    { id: 'tplA', title: '營業前 ( 開店前 )', units: ['觀塘'], active: true },
    { id: 'tplB', title: '營業前 ( 開店前 )', units: ['觀塘'], active: true },
  ];
  const buggy = generateFromTemplatesBuggy(templates, [], today);
  assert(buggy.filter((w) => w.title === '營業前 ( 開店前 )').length === 2, 'BUG: two templates → two works');

  const fixed = generateFromTemplatesFixed(templates, [], today);
  assert(fixed.filter((w) => w.title === '營業前 ( 開店前 )').length === 1, 'FIX: deduped templates → one work');
}

function testDedupeIdenticalWorks() {
  const works = [
    {
      id: '1',
      kind: 'recurring',
      templateId: 't1',
      title: 'test',
      unit: '觀塘',
      dueDate: '2026-08-22',
      status: 'done',
      completedAt: '2026年8月22日 11:08',
    },
    {
      id: '2',
      kind: 'recurring',
      templateId: 't1',
      title: 'test',
      unit: '觀塘',
      dueDate: '2026-08-22',
      status: 'done',
      completedAt: '2026年8月22日 11:08',
    },
  ];
  const out = dedupeWorks(works);
  assert(out.length === 1, 'FIX: same template+unit+due collapses to one');
}

function testCoverageBlocksSecondTemplate() {
  const today = '2026-08-22';
  const existing = [
    {
      id: '1',
      kind: 'recurring',
      templateId: 'tplA',
      title: 'Whatsapp及Facebook客人回覆',
      unit: '觀塘',
      dueDate: today,
      status: 'done',
    },
  ];
  const templates = [
    { id: 'tplA', title: 'Whatsapp及Facebook客人回覆', units: ['觀塘'], active: true },
    { id: 'tplB', title: 'Whatsapp及Facebook客人回覆', units: ['觀塘'], active: true },
  ];
  const fixed = generateFromTemplatesFixed(templates, existing, today);
  assert(fixed.length === 1, 'FIX: existing done covers duplicate template');
}

async function main() {
  const tests = [
    ['dup templates create dup works', testDupTemplatesCreateDupWorks],
    ['dedupe identical recurring works', testDedupeIdenticalWorks],
    ['coverage blocks second template', testCoverageBlocksSecondTemplate],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
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
