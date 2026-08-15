/* ═══════════ 基礎資料 ═══════════ */
const DEV_STAGES = ['企劃選材','技術規格單','打版','樣本修改與確認','量產準備','倉存與物流','陳列銷售'];
const REP_STAGES = ['銷售分析','打版','樣本修改與確認','量產準備','倉存與物流','陳列銷售'];
const CATEGORIES = ['成人保暖衣','兒童保暖衣','成人抓毛','兒童抓毛','成人膠衣','兒童膠衣','成人泳裝','兒童泳裝','防曬用品','游水用品','防水袋','其他'];

const USERS_KEY = 'store-web-users-v1';
const AUTH_TOKEN_KEY = 'store-web-auth-token-v1';
const STAFF_REGIONS = ['觀塘','荔枝角','灣仔','屯門','國內倉'];
const SEED_ADMIN = {id:'adm', login:'admin', pw:'admin', name:'系統管理員', dept:'管理層', role:'system_admin', position:'系統管理員', unit:null, units:[], active:true};
let users = [Object.assign({}, SEED_ADMIN)];
let userSeq = 1;
function isAdmin(){ return currentUser && currentUser.role==='system_admin'; }
function isManager(){ return currentUser && currentUser.role==='manager'; }
function isPersonal(){ return currentUser && (currentUser.role==='personal' || currentUser.position==='員工'); }
function canWriteProduction(){ return isAdmin(); }
function canCreateEmployee(){ return !!(currentUser && (currentUser.role==='system_admin' || currentUser.role==='manager')); }
/** 可被指派為項目經手人／負責人：僅經理、主管（不含系統帳 admin、不含員工） */
function listAssignableStaff(){
  return users.filter(function(u){
    if(!u || u.active===false || u.login==='admin' || u.id==='adm') return false;
    if(userNeedsPhoneBind(u)) return false;
    return u.position==='經理' || u.position==='主管';
  });
}
/** 階段經手人（相容舊單值 handler） */
function stageHandlers(s){
  if(!s) return [];
  if(Array.isArray(s.handlers) && s.handlers.length){
    return s.handlers.filter(Boolean).filter(function(id,i,a){ return a.indexOf(id)===i; });
  }
  return s.handler ? [s.handler] : [];
}
function stageHandlersLabel(s){
  const hs = stageHandlers(s);
  return hs.length ? hs.map(userName).join('、') : '—';
}
function isStageHandler(s, uid){
  if(!uid) return false;
  return stageHandlers(s).indexOf(uid)>=0;
}
function setStageHandlers(s, ids){
  const hs = (Array.isArray(ids)?ids:[]).filter(Boolean).filter(function(id,i,a){ return a.indexOf(id)===i; });
  s.handlers = hs;
  s.handler = hs[0] || null;
}
function userUnits(u){
  if(!u) return [];
  if(Array.isArray(u.units) && u.units.length){
    return u.units.filter(function(x,i,a){ return STAFF_REGIONS.indexOf(x)>=0 && a.indexOf(x)===i; });
  }
  if(u.unit && STAFF_REGIONS.indexOf(u.unit)>=0) return [u.unit];
  if(u.fixedUnit && STAFF_REGIONS.indexOf(u.fixedUnit)>=0) return [u.fixedUnit];
  return [];
}
function normalizePhone(input){
  if(input==null) return null;
  let s = String(input).trim().replace(/[\s\-()]/g,'');
  if(!s) return null;
  if(s.indexOf('+852')===0) s = s.slice(4);
  else if(s.indexOf('852')===0 && s.length===11) s = s.slice(3);
  if(!/^\d{8}$/.test(s)) return null;
  return s;
}
function passwordFromPhone(phone){
  const p = normalizePhone(phone);
  return p ? p.slice(-4) : '';
}
function userNeedsPhoneBind(u){
  if(!u) return false;
  if(u.login==='admin' || u.id==='adm') return false;
  // 主鍵必須是電話；login 雖像電話但 id 仍為 u1 時仍需補登／遷移
  if(normalizePhone(u.id)) return false;
  return true;
}
function actorSnapshot(user){
  user = user || currentUser;
  if(!user) return { userId:'', userName:'—', userLabel:'—' };
  const phone = normalizePhone(user.phone) || normalizePhone(user.id) || '';
  const name = user.name || user.login || '—';
  const label = phone ? (name+'｜'+phone) : (user.login==='admin' ? name+'｜admin' : name+'｜'+(user.login||user.id||''));
  return { userId: user.id || '', userName: name, userPhone: phone || null, userLabel: label };
}
function normalizeUser(u){
  if(!u || typeof u!=='object') return u;
  const out = Object.assign({}, u);
  let units = userUnits(out);
  out.units = units;
  out.unit = units[0] || null;
  const phone = normalizePhone(out.phone) || normalizePhone(out.id) || normalizePhone(out.login);
  if(phone){ out.phone = phone; out.id = out.id || phone; }
  if(!out.position){
    if(out.login==='admin' || out.role==='system_admin') out.position = out.login==='admin' ? '系統管理員' : '經理';
    else if(out.role==='manager') out.position = '主管';
    else out.position = '員工';
  }
  if(out.position==='經理' || out.position==='主管') out.role = 'system_admin';
  else if(out.position==='員工') out.role = 'personal';
  if(typeof out.active==='undefined') out.active = true;
  if(!out.dept) out.dept = units.join('、') || (out.position==='員工'?'—':'管理層');
  out.needsPhoneBind = userNeedsPhoneBind(out);
  return out;
}
/** 舊示範帳（會從名單移除；admin 與之後「創建員工」新增的帳保留） */
const LEGACY_DEMO_LOGINS = ['manager','kt.staff','tm.staff','kwok','ann','coey','wh.staff'];
const LEGACY_DEMO_IDS = ['mgr','kt','tm','kwok','ann','coey','wh'];
function purgeLegacyDemoUsers(){
  const before = (users||[]).length;
  users = (users||[]).filter(function(u){
    if(!u) return false;
    if(u.login==='admin' || u.id==='adm') return true;
    const login = String(u.login||'').toLowerCase();
    if(LEGACY_DEMO_LOGINS.indexOf(login)>=0) return false;
    if(LEGACY_DEMO_IDS.indexOf(u.id)>=0) return false;
    return true;
  });
  return users.length !== before;
}
function ensureAdminUser(){
  const before = JSON.stringify(users||[]);
  users = (users||[]).map(normalizeUser).filter(Boolean);
  purgeLegacyDemoUsers();
  if(!users.some(function(u){ return u.login==='admin'; })){
    users.unshift(Object.assign({}, SEED_ADMIN));
  }
  let maxN = 0;
  users.forEach(function(u){
    const m = String(u.id||'').match(/^u(\d+)$/);
    if(m) maxN = Math.max(maxN, parseInt(m[1],10));
  });
  if(maxN >= userSeq) userSeq = maxN + 1;
  return before !== JSON.stringify(users);
}
function loadUsersLocal(){
  try{
    const j = JSON.parse(localStorage.getItem(USERS_KEY)||'null');
    if(Array.isArray(j) && j.length) users = j;
  }catch(e){}
  if(ensureAdminUser()) saveUsersLocal();
}
function saveUsersLocal(){
  ensureAdminUser();
  try{ localStorage.setItem(USERS_KEY, JSON.stringify(users)); }catch(e){}
}
function roleLabel(u){
  if(!u) return '—';
  const pos = u.position || (u.role==='system_admin'?'系統管理員':(u.role==='manager'?'主管':'員工'));
  const units = userUnits(u);
  if(units.length) return pos+'｜'+units.join('、');
  return pos;
}
const userName = id => { const u = users.find(u=>u.id===id); return (u && u.name) || '—'; };
const userDept = id => { const u=users.find(x=>x.id===id); return u?(u.dept||userUnits(u).join('、')||''):''; };

/* 狀態定義 */
const ST = {
  notstart:'未開始', pending:'待處理', doing:'進行中', wait:'待確認',
  fix:'需要修改', done:'已完成', skip:'直接下一階段', na:'不適用'
};
function stTag(s){
  const map = {'未開始':'s-notstart','待處理':'s-pending','進行中':'s-doing','待確認':'s-wait',
    '需要修改':'s-fix','已退回':'s-return','已完成':'s-done','直接下一階段':'s-skip','不適用':'s-na','逾期':'s-overdue',
    '暫停':'s-pause','已取消':'s-cancel','已封存':'s-archive'};
  return `<span class="tag ${map[s]||'s-notstart'}">${s}</span>`;
}

/* ═══════════ 項目資料 ═══════════ */
function mkStage(name, handlerOrHandlers, status, opts={}){
  const hs = Array.isArray(handlerOrHandlers)
    ? handlerOrHandlers.filter(Boolean)
    : (handlerOrHandlers ? [handlerOrHandlers] : []);
  return {
    name,
    handler: hs[0]||null,
    handlers: hs,
    status,
    deadline:opts.deadline||'',
    completedAt:opts.completedAt||null,
    content:opts.content||'',
    files:opts.files||[],
    skipReason:opts.skipReason||'',
    returnReason:opts.returnReason||''
  };
}
let projects = [];
let projSeq = 1;
let repProjSeq = 1;
let moduleLogs = { daily: [], production: [], replenishment: [], push: [] };
const SAMPLE_PROJECT_IDS = ['P001','P002','P003'];
const SAMPLE_PROJECT_CODES = ['WS-999','WS-888','WS-777'];
const SAMPLE_PROJECT_NAMES = ['成人日本光皮長短','1mm兒童抓毛上衣','兒童防曬套裝'];
const SAMPLE_DAILY_TITLES = ['整理今日到貨箱單','更新門市陳列清單','逾期示範：昨夜未完成點貨'];
const SAMPLE_TPL_TITLES = ['門市巡檢','倉存點算'];
const SAMPLE_LOG_RE = /WS-999|WS-888|WS-777|逾期示範|門市巡檢|倉存點算|整理今日到貨|更新門市陳列|成人日本光皮|兒童抓毛上衣|兒童防曬套裝|每日結算/;
function isSampleDailyWork(w){
  if(!w) return true;
  if(SAMPLE_DAILY_TITLES.indexOf(w.title)>=0) return true;
  if(String(w.title||'').indexOf('逾期示範')>=0) return true;
  if(w.kind==='settlement' && /示範每日結算|每日結算示範/.test(String(w.title||''))) return true;
  if(SAMPLE_TPL_TITLES.indexOf(w.title)>=0) return true;
  return false;
}
function isSampleDailyTemplate(t){
  return !t || SAMPLE_TPL_TITLES.indexOf(t.title)>=0;
}
function purgeSampleProjects(){
  const before = projects.length;
  projects = (projects||[]).filter(function(p){
    if(!p) return false;
    if(SAMPLE_PROJECT_IDS.indexOf(p.id)>=0) return false;
    if(SAMPLE_PROJECT_CODES.indexOf(p.code)>=0) return false;
    if(SAMPLE_PROJECT_NAMES.indexOf(p.name)>=0) return false;
    return true;
  });
  let maxP = 0, maxR = 0;
  projects.forEach(function(p){
    const mp = String(p.id||'').match(/^P(\d+)$/i);
    const mr = String(p.id||'').match(/^R(\d+)$/i);
    if(mp) maxP = Math.max(maxP, parseInt(mp[1],10));
    if(mr) maxR = Math.max(maxR, parseInt(mr[1],10));
  });
  if(maxP >= projSeq) projSeq = maxP + 1;
  if(maxR >= repProjSeq) repProjSeq = maxR + 1;
  if(!projects.length && projSeq < 1) projSeq = 1;
  return projects.length !== before;
}
function purgeSampleModuleLogs(){
  let changed = false;
  ['daily','production','replenishment'].forEach(function(mod){
    const arr = moduleLogs[mod];
    if(!Array.isArray(arr)) return;
    const next = arr.filter(function(l){
      const blob = String((l&&l.detail)||'') + '|' + String((l&&l.action)||'');
      return !SAMPLE_LOG_RE.test(blob);
    });
    if(next.length !== arr.length){ moduleLogs[mod] = next; changed = true; }
  });
  return changed;
}
function purgeSampleDailyState(s){
  s = s || loadDailyState();
  const wBefore = (s.works||[]).length;
  const tBefore = (s.recurringTemplates||[]).length;
  const logBefore = (s.opLogs||[]).length;
  const removedTplIds = {};
  (s.recurringTemplates||[]).forEach(function(t){
    if(isSampleDailyTemplate(t)) removedTplIds[t.id]=true;
  });
  s.recurringTemplates = (s.recurringTemplates||[]).filter(function(t){ return !isSampleDailyTemplate(t); });
  s.works = (s.works||[]).filter(function(w){
    if(isSampleDailyWork(w)) return false;
    if(w.templateId && removedTplIds[w.templateId]) return false;
    return true;
  });
  s.opLogs = (s.opLogs||[]).filter(function(l){
    const blob = String((l&&l.detail)||'') + '|' + String((l&&l.action)||'');
    return !SAMPLE_LOG_RE.test(blob);
  });
  return (s.works.length!==wBefore) || (s.recurringTemplates.length!==tBefore) || (s.opLogs.length!==logBefore);
}
let notifications = [];
let notifSeq = 1;
const NOTIF_KEY = 'store-web-notifications-v1';
const NOTIF_CATEGORIES = ['補貨','價錢更新','緊急通知','一般通知'];
const NOTIF_PRIORITIES = ['一般','重要','緊急'];
let mailboxOpen = false;
let mailboxTab = 'inbox'; // inbox | sent
let mailboxDetailId = null;
let mailboxDetailTab = 'inbox'; // which tab opened the detail
let pushDraftFiles = []; // {name, dataUrl} draft attachments for compose

let currentUser = null, currentModule = 'production', currentView = 'home', currentProject = null, currentTab = 'overview', commentFilter = '全部';
/** 三層側欄展開狀態（空字串＝依目前模組自動展開） */
var sidebarOpenL1 = '';
var sidebarOpenL2 = '';
var sidebarNavManual = false;
let listType = 'dev', fCat='全部', fStatus='全部', fKw='';

/* ═══════════ Cloud API（MongoDB via Node） ═══════════ */
let apiEnabled = false;
let apiReady = false;
let apiBase = (typeof window !== 'undefined' && window.STORE_API_BASE) ? String(window.STORE_API_BASE).replace(/\/$/, '') : '';
let authToken = '';
let projectsSaveTimer = null;
let dailySaveTimer = null;
function loadAuthToken(){
  try{ authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''; }catch(e){ authToken = ''; }
  return authToken;
}
function saveAuthToken(token){
  authToken = token || '';
  try{
    if(authToken) localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  }catch(e){}
}
function clearAuthToken(){ saveAuthToken(''); }
function apiUrl(path){ return apiBase + path; }
function withFileToken(url){
  if(!url || !authToken) return url;
  if(String(url).indexOf('/api/files/')<0) return url;
  const sep = String(url).indexOf('?')>=0 ? '&' : '?';
  return String(url)+sep+'access_token='+encodeURIComponent(authToken);
}
async function apiFetch(path, opts){
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if(authToken && !headers.Authorization) headers.Authorization = 'Bearer '+authToken;
  const r = await fetch(apiUrl(path), Object.assign({}, opts, { headers: headers, credentials: 'include' }));
  if(r.status===401){
    clearAuthToken();
    if(currentUser){
      currentUser = null;
      try{
        document.getElementById('app').classList.add('hidden');
        document.getElementById('page-login').classList.remove('hidden');
      }catch(e){}
    }
  }
  if(!r.ok){
    let msg = r.statusText;
    try{ const j = await r.json(); msg = j.error || msg; }catch(_){ try{ msg = await r.text(); }catch(__){} }
    const err = new Error(msg || ('HTTP '+r.status));
    err.status = r.status;
    throw err;
  }
  const ct = r.headers.get('content-type')||'';
  if(ct.includes('application/json')){
    const text = await r.text();
    if(!text || !String(text).trim()) return {};
    try{ return JSON.parse(text); }
    catch(e){ throw new Error('Invalid JSON from '+path); }
  }
  return r;
}
function slimFileRef(f){
  if(!f || typeof f !== 'object') return f;
  if(f.driveFileId){
    return { name:f.name, by:f.by, time:f.time, ver:f.ver, latest:f.latest, driveFileId:f.driveFileId, mimeType:f.mimeType };
  }
  if(f.dataUrl && String(f.dataUrl).length > 250000){
    return { name:f.name, by:f.by, time:f.time, ver:f.ver, latest:f.latest, omitted:true };
  }
  return f;
}
function slimProjectsPayload(){
  // 開發 → projects collection；補貨 → replenishment_projects；moduleLogs → module_logs
  const productionProjects = projects.filter(function(p){ return p && p.type!=='rep'; });
  const replenishmentProjects = projects.filter(function(p){ return p && p.type==='rep'; });
  const cloned = JSON.parse(JSON.stringify({
    productionProjects,
    replenishmentProjects,
    projects: productionProjects.concat(replenishmentProjects),
    projSeq,
    repProjSeq,
    moduleLogs
  }));
  function slimList(list){
    (list||[]).forEach(function(p){
      if(p.coverFileId && p.coverUrl && String(p.coverUrl).startsWith('data:')) p.coverUrl = apiUrl('/api/files/'+p.coverFileId);
      (p.files||[]).forEach(function(f,i){ p.files[i] = slimFileRef(f); });
      (p.stages||[]).forEach(function(s){
        if(Array.isArray(s.files)) s.files = s.files.map(slimFileRef);
      });
      (p.comments||[]).forEach(function(c){
        if(c.file && typeof c.file === 'object') c.file = slimFileRef(c.file);
      });
    });
  }
  slimList(cloned.productionProjects);
  slimList(cloned.replenishmentProjects);
  slimList(cloned.projects);
  return cloned;
}
function slimDailyPayload(state){
  const cloned = JSON.parse(JSON.stringify(state));
  (cloned.works||[]).forEach(w=>{
    if(Array.isArray(w.attachments)) w.attachments = w.attachments.map(slimFileRef);
    if(Array.isArray(w.descImages)) w.descImages = w.descImages.map(slimFileRef);
  });
  (cloned.recurringTemplates||[]).forEach(t=>{
    if(Array.isArray(t.descImages)) t.descImages = t.descImages.map(slimFileRef);
  });
  return cloned;
}
let cloudSyncMessage = '';
function refreshCloudSyncStatus(){
  const el = document.getElementById('cloud-sync-status');
  if(!el) return;
  if(!apiEnabled){
    el.textContent = '⚠ 本機模式';
    el.style.color = '#ffcc80';
    el.title = '未連接 MongoDB，資料只在此瀏覽器，其他裝置看不到。';
    return;
  }
  if(cloudSyncMessage){
    el.textContent = '⚠ 同步失敗';
    el.style.color = '#ffcdd2';
    el.title = cloudSyncMessage;
    return;
  }
  el.textContent = '☁ 雲端';
  el.style.color = '#c8e6c9';
  el.title = '資料保存在 MongoDB 雲端後端';
}
function noteCloudError(e){
  cloudSyncMessage = String((e && e.message) || e || '同步失敗');
  console.warn('cloud sync', cloudSyncMessage);
  refreshCloudSyncStatus();
}
function noteCloudOk(){
  cloudSyncMessage = '';
  refreshCloudSyncStatus();
}
function requireCloud(actionLabel){
  if(apiEnabled) return true;
  alert2((actionLabel||'此操作')+'需要連接 MongoDB 雲端。請確認 Railway 已設定 MONGODB_URI，並重新整理頁面。');
  return false;
}
function persistProjects(){
  if(!apiEnabled) return;
  clearTimeout(projectsSaveTimer);
  projectsSaveTimer = setTimeout(function(){
    persistProjectsNow().catch(noteCloudError);
  }, 350);
}
async function persistProjectsNow(){
  if(!apiEnabled) return;
  await apiFetch('/api/projects', {
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(slimProjectsPayload())
  });
  noteCloudOk();
}
async function persistDailyNow(){
  if(!apiEnabled || !dailyStateCache) return;
  var seqAtStart = typeof dailyPersistSeq === 'number' ? dailyPersistSeq : 0;
  await apiFetch('/api/daily', {
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(slimDailyPayload(dailyStateCache))
  });
  // 僅在沒有更新的本地變更時清 dirty，避免舊 PUT 回覆把新變更標成已同步
  if(seqAtStart === dailyPersistSeq){
    try{ localStorage.setItem(DAILY_DIRTY_KEY, '0'); }catch(e){}
  }
  noteCloudOk();
}
function scheduleDailyCloudSave(){
  if(!apiEnabled || !dailyStateCache) return;
  clearTimeout(dailySaveTimer);
  dailySaveTimer = setTimeout(function(){
    persistDailyNow().catch(noteCloudError);
  }, 350);
}
async function flushCloudSaves(){
  if(!apiEnabled) return;
  clearTimeout(projectsSaveTimer);
  clearTimeout(dailySaveTimer);
  projectsSaveTimer = null;
  dailySaveTimer = null;
  // 專案與每日工作分開寫入：任一方失敗不得阻擋另一方，否則會出現
  //「畫面上有任務／刷新後消失」（每日 PUT 被專案錯誤短路）。
  let lastErr = null;
  try{
    await persistProjectsNow();
  }catch(e){
    lastErr = e;
  }
  try{
    await persistDailyNow();
  }catch(e){
    lastErr = e;
  }
  if(lastErr){
    noteCloudError(lastErr);
    throw lastErr;
  }
  noteCloudOk();
}
/**
 * 雲端 users collection 為唯一正式來源（GET 不含密碼）。
 * 回傳本機有、雲端沒有的非 admin 賬號，供登入後以 POST /api/users 救援。
 */
function applyUsersFromCloud(cloudUsers){
  const localCopy = (users||[]).map(normalizeUser).filter(Boolean);
  const orphans = [];
  if(Array.isArray(cloudUsers) && cloudUsers.length){
    users = cloudUsers.map(normalizeUser).filter(Boolean);
    ensureAdminUser();
    const have = {};
    users.forEach(function(u){ have[String(u.login||'').toLowerCase()] = true; });
    localCopy.forEach(function(u){
      const key = String(u.login||'').toLowerCase();
      if(!key || key==='admin' || have[key]) return;
      if(!u.pw) return; // 無密碼無法救援上傳
      orphans.push(u);
    });
  } else {
    users = localCopy.length ? localCopy : [Object.assign({}, SEED_ADMIN)];
    ensureAdminUser();
  }
  ensureAdminUser();
  saveUsersLocal();
  return orphans;
}
async function rescueOrphanUsers(orphans){
  if(!apiEnabled || !authToken || !orphans || !orphans.length) return;
  if(!canCreateEmployee()) return;
  for(let i=0;i<orphans.length;i++){
    const u = orphans[i];
    try{
      await apiFetch('/api/users', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          id: u.id, login: u.login, pw: u.pw, name: u.name,
          position: u.position, role: u.role, units: u.units||[], unit: u.unit||null,
          dept: u.dept, active: u.active!==false
        })
      });
    }catch(e){ console.warn('rescue user', u.login, e); }
  }
  try{
    const ju = await apiFetch('/api/users');
    if(Array.isArray(ju.users)){
      users = ju.users.map(normalizeUser).filter(Boolean);
      ensureAdminUser();
      saveUsersLocal();
    }
  }catch(e){}
}
async function loadCloudAppData(){
  // 先讀本機快取：若上次雲端寫入失敗（dirty），刷新時不可被舊雲端整包蓋掉。
  let localDaily = null;
  let localDirty = false;
  try{
    const raw = localStorage.getItem(DAILY_KEY);
    if(raw) localDaily = dailyNormalizeState(JSON.parse(raw));
    localDirty = localStorage.getItem(DAILY_DIRTY_KEY) === '1';
  }catch(e){}

  const daily = await apiFetch('/api/daily');
  const cloud = dailyNormalizeState(daily);
  const shouldMerge = !!(localDirty && localDaily);

  if(shouldMerge){
    dailyStateCache = mergeDailyStates(cloud, localDaily);
  } else {
    dailyStateCache = cloud;
  }

  const dailyChanged = purgeSampleDailyState(dailyStateCache);
  try{ localStorage.setItem(DAILY_KEY, JSON.stringify(dailyStateCache)); }catch(e){}
  if(dailyChanged || shouldMerge){
    try{ await persistDailyNow(); }catch(e){ console.warn('sync daily after load', e); }
  } else {
    try{ localStorage.setItem(DAILY_DIRTY_KEY, '0'); }catch(e){}
  }

  const ps = await apiFetch('/api/projects');
  if(Array.isArray(ps.productionProjects) || Array.isArray(ps.replenishmentProjects)){
    projects = [].concat(ps.productionProjects||[], ps.replenishmentProjects||[]);
  } else if(Array.isArray(ps.projects)){
    projects = ps.projects;
  } else {
    projects = [];
  }
  // 正規化階段經手人：舊 handler 單值 → handlers[]
  projects.forEach(function(p){
    if(!p || !Array.isArray(p.stages)) return;
    p.stages.forEach(function(s){ setStageHandlers(s, stageHandlers(s)); });
  });
  // 補齊建立時間並依新→舊排序（列表／首頁共用）
  projects.forEach(function(p){
    if(!p || Number(p.createdAtMs)>0) return;
    const ms = projCreatedMs(p);
    if(ms) p.createdAtMs = ms;
  });
  projects = sortProjectsNewestFirst(projects);
  if(typeof ps.projSeq === 'number') projSeq = ps.projSeq;
  else if(!projects.filter(function(p){ return p.type!=='rep'; }).length) projSeq = 1;
  if(typeof ps.repProjSeq === 'number') repProjSeq = ps.repProjSeq;
  else if(!projects.filter(function(p){ return p.type==='rep'; }).length) repProjSeq = 1;
  if(ps.moduleLogs && typeof ps.moduleLogs === 'object'){
    moduleLogs = Object.assign({ daily:[], production:[], replenishment:[], push:[] }, ps.moduleLogs);
  }
  const orphans = applyUsersFromCloud(ps.users);
  let projectsDirty = false;
  if(purgeSampleProjects()) projectsDirty = true;
  if(purgeSampleModuleLogs()) projectsDirty = true;
  if(projectsDirty) await persistProjectsNow();
  await loadNotifications();
  if(orphans && orphans.length) await rescueOrphanUsers(orphans);
}
async function cloudUploadFile(file){
  if(!apiEnabled){
    return { name:file.name, dataUrl: await readFileAsDataUrl(file) };
  }
  const fd = new FormData();
  fd.append('file', file);
  const j = await apiFetch('/api/files', { method:'POST', body: fd });
  return {
    name: j.name || file.name,
    driveFileId: j.id,
    mimeType: j.mimeType,
    dataUrl: withFileToken(apiUrl('/api/files/'+j.id))
  };
}
async function cloudUploadDataUrl(name, dataUrl){
  if(!apiEnabled) return { name:name, dataUrl:dataUrl };
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], name || 'file.bin', { type: blob.type || 'application/octet-stream' });
  return cloudUploadFile(file);
}
function fileHref(f){
  if(!f) return '#';
  if(typeof f === 'string') return '#';
  if(f.driveFileId) return withFileToken(apiUrl('/api/files/'+f.driveFileId));
  return f.dataUrl || '#';
}
async function initCloud(){
  apiReady = false;
  loadAuthToken();
  try{
    const health = await apiFetch('/api/health');
    apiEnabled = !!(health.mongoConfigured || health.configured || health.driveConfigured);
    if(!apiEnabled){
      console.warn('API up but MongoDB not configured; using local mode.');
      loadUsersLocal();
      apiReady = true;
      return;
    }
    // 未登入時不打受保護 API；有 token 則嘗試恢復工作階段
    if(authToken){
      try{
        const me = await apiFetch('/api/auth/me');
        if(me && me.user){
          await loadCloudAppData();
          enterAppAs(normalizeUser(me.user), { silent:true });
        } else {
          clearAuthToken();
          loadUsersLocal();
        }
      }catch(e){
        clearAuthToken();
        loadUsersLocal();
      }
    } else {
      loadUsersLocal();
    }
  }catch(e){
    console.warn('Cloud init failed, fallback to local mode:', e);
    apiEnabled = false;
    loadUsersLocal();
    loadNotificationsLocal();
  }
  apiReady = true;
}

/* ═══════════ 信箱／推送通知 ═══════════ */
function loadNotificationsLocal(){
  try{
    const raw = localStorage.getItem(NOTIF_KEY);
    if(!raw){ notifications = []; notifSeq = 1; return; }
    const j = JSON.parse(raw);
    notifications = Array.isArray(j.notifications) ? j.notifications : [];
    notifSeq = typeof j.notifSeq === 'number' ? j.notifSeq : 1;
  }catch(e){
    notifications = [];
    notifSeq = 1;
  }
}
function saveNotificationsLocal(){
  try{
    const slim = notifications.map(n=>{
      const copy = Object.assign({}, n);
      if(Array.isArray(copy.attachments)) copy.attachments = copy.attachments.map(slimFileRef);
      return copy;
    });
    localStorage.setItem(NOTIF_KEY, JSON.stringify({ notifications: slim, notifSeq }));
  }catch(e){}
}
async function loadNotifications(){
  if(!apiEnabled){
    loadNotificationsLocal();
    refreshMailboxUi();
    return;
  }
  try{
    const ns = await apiFetch('/api/notifications');
    notifications = Array.isArray(ns.notifications) ? ns.notifications : [];
    notifSeq = typeof ns.notifSeq === 'number' ? ns.notifSeq : 1;
  }catch(e){
    console.warn('load notifications', e);
  }
  refreshMailboxUi();
}
function notifPriorityRank(p){
  if(p==='緊急') return 0;
  if(p==='重要') return 1;
  return 2;
}
function isNotifUnreadForMe(n){
  if(!currentUser || !n) return false;
  // 推送通知完結／取消後不可再確認已讀，亦不計入未讀待辦
  if(!isTransferNotice(n) && n.status && n.status!=='進行中') return false;
  const rec = (n.recipients||[]).find(r => String(r.userId) === String(currentUser.id));
  if(!rec) return false;
  if(rec.status) return rec.status !== 'read';
  return !rec.read;
}
function isPushNoticeConfirmable(n){
  if(!n || isTransferNotice(n)) return false;
  return !n.status || n.status==='進行中';
}
function notifReadStats(n){
  const recs = Array.isArray(n && n.recipients) ? n.recipients : [];
  let read = 0, opened = 0, unopen = 0;
  recs.forEach(function(r){
    const st = r.status || (r.read ? 'read' : 'unopen');
    if(st==='read') read++;
    else if(st==='opened') opened++;
    else unopen++;
  });
  return { total: recs.length, read: read, opened: opened, unopen: unopen };
}
function recipientReadStatus(r){
  if(!r) return 'unopen';
  if(r.status==='read' || r.status==='opened' || r.status==='unopen') return r.status;
  return r.read ? 'read' : 'unopen';
}
function recipientReadStatusTag(st){
  if(st==='read') return '<span class="tag" style="background:#e8f5e9;color:#2e7d32">已讀</span>';
  if(st==='opened') return '<span class="tag" style="background:#fff8e1;color:#8d6e00">已開啟</span>';
  return '<span class="tag" style="background:#ffebee;color:#c62828">未讀</span>';
}
function sortMailboxItems(list, preferUnread){
  const arr = (list || []).slice();
  arr.sort(function(a,b){
    if(preferUnread){
      const au = isNotifUnreadForMe(a) ? 0 : 1;
      const bu = isNotifUnreadForMe(b) ? 0 : 1;
      if(au!==bu) return au - bu;
    }
    const dt = (b.createdAtMs||0) - (a.createdAtMs||0);
    if(dt!==0) return dt;
    return notifPriorityRank(a.priority) - notifPriorityRank(b.priority);
  });
  return arr;
}
function myInboxItems(){
  if(!currentUser) return [];
  const uid = currentUser.id;
  return sortMailboxItems(
    notifications.filter(n => (n.recipients||[]).some(r => r.userId === uid)),
    true
  );
}
function mySentItems(){
  if(!currentUser) return [];
  const uid = String(currentUser.id);
  return sortMailboxItems(
    notifications.filter(n => String(n.fromUserId||'') === uid),
    false
  );
}
function myMailboxItems(){
  return mailboxTab === 'sent' ? mySentItems() : myInboxItems();
}
function unreadCount(){
  if(!currentUser) return 0;
  return notifications.filter(function(n){ return isNotifUnreadForMe(n); }).length;
}
function setMailboxTab(tab){
  mailboxTab = (tab === 'sent') ? 'sent' : 'inbox';
  const inboxBtn = document.getElementById('mailbox-tab-inbox');
  const sentBtn = document.getElementById('mailbox-tab-sent');
  if(inboxBtn) inboxBtn.classList.toggle('active', mailboxTab==='inbox');
  if(sentBtn) sentBtn.classList.toggle('active', mailboxTab==='sent');
  refreshMailboxUi();
}
function notifPriorityTag(p){
  const cls = p==='緊急' ? 'n-pri-urgent' : (p==='重要' ? 'n-pri-important' : 'n-pri-normal');
  return `<span class="tag ${cls}">${p||'一般'}</span>`;
}
function findMailboxItem(id){
  return (notifications||[]).find(function(n){ return n.id === id; }) || null;
}
async function openMailboxDetail(id){
  mailboxDetailId = id;
  mailboxDetailTab = mailboxTab;
  const bg = document.getElementById('mailbox-detail-bg');
  if(bg) bg.classList.remove('hidden');
  const item = findMailboxItem(id);
  if(item && !isTransferNotice(item) && mailboxTab==='inbox' && apiEnabled && currentUser){
    try{
      await apiFetch('/api/notifications/'+encodeURIComponent(id)+'/open', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      await loadNotifications();
    }catch(_e){}
  }
  refreshMailboxDetailUi();
}
function closeMailboxDetail(){
  mailboxDetailId = null;
  const bg = document.getElementById('mailbox-detail-bg');
  if(bg) bg.classList.add('hidden');
}
function mailboxReceiptHtml(item){
  const recs = Array.isArray(item.recipients) ? item.recipients : [];
  const stats = notifReadStats(item);
  const readList = recs.filter(function(r){ return recipientReadStatus(r)==='read'; });
  const openedList = recs.filter(function(r){ return recipientReadStatus(r)==='opened'; });
  const unopenList = recs.filter(function(r){ return recipientReadStatus(r)==='unopen'; });
  function rowHtml(r, timeField){
    const name = escHtml(userName(r.userId) || r.userId || '—');
    const t = timeField==='confirm' ? (r.confirmTime || r.readAt) : (timeField==='open' ? r.openTime : null);
    if(t) return '<li>'+name+' <span style="color:#90a4ae">（'+escHtml(t)+'）</span></li>';
    return '<li>'+name+'</li>';
  }
  return '<div class="md-receipts">'
    +'<h4>已讀回條</h4>'
    +'<div class="md-receipt-summary">已讀 '+stats.read+'｜已開啟 '+stats.opened+'｜未讀 '+stats.unopen+'（共 '+stats.total+'）</div>'
    +'<div style="font-size:12px;font-weight:bold;color:#2e7d32;margin-bottom:4px">已讀</div>'
    +(readList.length ? '<ul>'+readList.map(function(r){ return rowHtml(r, 'confirm'); }).join('')+'</ul>' : '<p class="md-receipt-empty">尚無已讀</p>')
    +'<div style="font-size:12px;font-weight:bold;color:#8d6e00;margin-bottom:4px">已開啟</div>'
    +(openedList.length ? '<ul>'+openedList.map(function(r){ return rowHtml(r, 'open'); }).join('')+'</ul>' : '<p class="md-receipt-empty">尚無已開啟未確認</p>')
    +'<div style="font-size:12px;font-weight:bold;color:#c62828;margin-bottom:4px">未讀</div>'
    +(unopenList.length ? '<ul>'+unopenList.map(function(r){ return rowHtml(r, null); }).join('')+'</ul>' : '<p class="md-receipt-empty">無人未讀</p>')
    +'</div>';
}
function refreshMailboxDetailUi(){
  if(!mailboxDetailId) return;
  const titleEl = document.getElementById('mailbox-detail-title');
  const bodyEl = document.getElementById('mailbox-detail-body');
  const actionsEl = document.getElementById('mailbox-detail-actions');
  const readBtn = document.getElementById('mailbox-detail-read-btn');
  if(!titleEl || !bodyEl || !actionsEl || !readBtn) return;
  const item = findMailboxItem(mailboxDetailId);
  if(!item){
    titleEl.textContent = '通知';
    bodyEl.innerHTML = '<p style="color:#888;font-size:13px">找不到此通知。</p>';
    actionsEl.innerHTML = '';
    readBtn.classList.add('hidden');
    return;
  }
  const isSentView = mailboxDetailTab === 'sent';
  const uid = currentUser && currentUser.id;
  const rec = uid ? (item.recipients||[]).find(function(r){ return r.userId === uid; }) : null;
  const isRead = !!(rec && rec.read);
  titleEl.textContent = item.title || (item.content||'').slice(0,40) || '（無標題）';
  const metaTo = isSentView
    ? '｜收件 '+(Array.isArray(item.recipients)?item.recipients.length:0)+' 人'
    : '｜來自 '+escHtml(item.fromName||'—');
  bodyEl.innerHTML =
    '<div class="md-meta">'+escHtml(item.category||'一般通知')+'｜'+notifPriorityTag(item.priority)
    +'｜'+escHtml(item.createdAt||'')+metaTo+'</div>'
    +'<div class="md-content">'+escHtml(item.content||'（無內容）')+'</div>'
    +notifAttachHtml(item.attachments)
    +(isSentView ? mailboxReceiptHtml(item) : '');
  if(isSentView){
    actionsEl.innerHTML = '';
    readBtn.classList.add('hidden');
  } else if(isTransferNotice(item)){
    actionsEl.innerHTML = transferMailboxActionsHtml(item);
    readBtn.classList.remove('hidden');
    readBtn.className = 'md-read-toggle '+(isRead?'is-read':'is-unread');
    readBtn.textContent = isRead ? '已讀' : '未讀';
    readBtn.title = isRead ? '點擊改為未讀' : '點擊改為已讀';
  } else {
    actionsEl.innerHTML = '<button type="button" class="btn sm" data-call="openPushNotice" data-arg0="'+escHtml(String(item.id))+'">在推送通知開啟</button>';
    readBtn.classList.remove('hidden');
    if(isRead){
      readBtn.className = 'md-read-toggle is-read';
      readBtn.textContent = '已確認';
      readBtn.title = '已確認閱讀（不可改回）';
    } else if(!isPushNoticeConfirmable(item)){
      readBtn.className = 'md-read-toggle is-read';
      readBtn.textContent = '已完結未確認';
      readBtn.title = '通知已完結，無法再確認已讀';
    } else {
      readBtn.className = 'md-read-toggle is-unread';
      readBtn.textContent = '確認已讀';
      readBtn.title = '確認已閱讀及知悉';
    }
  }
}
async function toggleMailboxDetailRead(){
  if(!mailboxDetailId || !currentUser) return;
  if(mailboxDetailTab === 'sent') return;
  const item = findMailboxItem(mailboxDetailId);
  if(!item) return;
  if(!isTransferNotice(item)){
    if(!isPushNoticeConfirmable(item)){
      alert2('此通知已完結，無法再確認已讀。');
      return;
    }
    if(isNotifUnreadForMe(item)){
      askConfirmMailboxRead(mailboxDetailId);
    }
    return;
  }
  const rec = (item.recipients||[]).find(function(r){ return r.userId === currentUser.id; });
  const isRead = !!(rec && rec.read);
  await setNotifReadState(mailboxDetailId, !isRead);
}
function askConfirmMailboxRead(id){
  const item = findMailboxItem(id);
  if(item && !isPushNoticeConfirmable(item)){
    alert2('此通知已完結，無法再確認已讀。');
    return;
  }
  showModal(
    '<h3>確認已讀？</h3>'+
    '<p style="font-size:14px;line-height:1.6">確定已閱讀並知悉此通知內容？<br><span style="color:#888">確認後將標記為已讀，通常不可改回。</span></p>'+
    '<div class="actions">'+
      '<button type="button" class="btn gray sm" onclick="closeModal()">取消</button>'+
      '<button type="button" class="btn green sm" data-call="doConfirmMailboxRead" data-arg0="'+escHtml(String(id))+'">確定確認已讀</button>'+
    '</div>'
  );
}
async function doConfirmMailboxRead(id){
  closeModal();
  if(!id || !currentUser) return;
  const item = findMailboxItem(id);
  if(item && !isPushNoticeConfirmable(item)){
    alert2('此通知已完結，無法再確認已讀。');
    return;
  }
  try{
    await apiFetch('/api/notifications/'+encodeURIComponent(id)+'/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    await loadNotifications();
    refreshMailboxUi();
    refreshMailboxDetailUi();
    alert2('已成功確認閱讀。');
  }catch(e){ alert2('確認失敗：'+(e.message||e)); }
}
function refreshMailboxUi(){
  const badge = document.getElementById('mailbox-badge');
  const list = document.getElementById('mailbox-list');
  const inboxBtn = document.getElementById('mailbox-tab-inbox');
  const sentBtn = document.getElementById('mailbox-tab-sent');
  if(inboxBtn) inboxBtn.classList.toggle('active', mailboxTab==='inbox');
  if(sentBtn) sentBtn.classList.toggle('active', mailboxTab==='sent');
  if(!badge || !list) return;
  const n = unreadCount();
  if(n > 0){
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  if(!currentUser){
    list.innerHTML = '<p class="mailbox-empty">登入後可查看通知。</p>';
    closeMailboxDetail();
    return;
  }
  const items = myMailboxItems();
  const isSent = mailboxTab === 'sent';
  if(!items.length){
    list.innerHTML = '<p class="mailbox-empty">'+(isSent?'尚無發送記錄。':'暫無通知。')+'</p>';
  } else {
    const uid = currentUser.id;
    list.innerHTML = items.map(item=>{
      const title = item.title || (item.content||'').slice(0,40) || '（無標題）';
      const nidAttr = escHtml(String(item.id));
      let statusHtml;
      let rowClass = 'mailbox-row';
      if(isSent){
        const st = notifReadStats(item);
        statusHtml = '<span class="mb-status mb-receipt">已讀 '+st.read+'｜開 '+st.opened+'｜未 '+st.unopen+'</span>';
      } else {
        const rec = (item.recipients||[]).find(r => r.userId === uid);
        const st = recipientReadStatus(rec);
        const ended = !isTransferNotice(item) && item.status && item.status!=='進行中';
        if(st!=='read' && !ended) rowClass += ' unread';
        if(st==='read') statusHtml = '<span class="mb-status">已讀</span>';
        else if(ended) statusHtml = '<span class="mb-status">完結未確認</span>';
        else statusHtml = '<span class="mb-status">'+(st==='opened'?'已開啟':'未讀')+'</span>';
      }
      const who = isSent
        ? '<span class="mb-from">收件 '+(Array.isArray(item.recipients)?item.recipients.length:0)+' 人</span>'
        : '<span class="mb-from">'+escHtml(item.fromName||'—')+'</span>';
      return '<div class="'+rowClass+'" data-nid="'+nidAttr+'">'
        +'<div class="mailbox-row-main"><div class="mailbox-row-line">'
        +statusHtml
        +notifPriorityTag(item.priority)
        +'<span class="mb-date">'+escHtml(item.createdAt||'')+'</span>'
        +'<span class="mb-title">'+escHtml(title)+'</span>'
        +who
        +'</div></div></div>';
    }).join('');
  }
  if(mailboxDetailId) refreshMailboxDetailUi();
}
function bindMailboxDelegates(){
  const list = document.getElementById('mailbox-list');
  if(list && list.dataset.bound!=='1'){
    list.dataset.bound = '1';
    list.addEventListener('click', function(e){
      const row = e.target && e.target.closest ? e.target.closest('.mailbox-row') : null;
      if(!row || !list.contains(row)) return;
      const id = row.getAttribute('data-nid');
      if(id) openMailboxDetail(id);
    });
  }
  const actions = document.getElementById('mailbox-detail-actions');
  if(actions && actions.dataset.bound!=='1'){
    actions.dataset.bound = '1';
    actions.addEventListener('click', function(e){
      const btn = e.target && e.target.closest ? e.target.closest('[data-tid][data-decision]') : null;
      if(!btn || !actions.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      decideTransferFromMailbox(btn.getAttribute('data-tid'), btn.getAttribute('data-decision'));
    });
  }
}
function bindStaticChrome(){
  if(document.body.dataset.chromeBound==='1') return;
  document.body.dataset.chromeBound = '1';
  const loginBtn = document.getElementById('btn-login');
  if(loginBtn) loginBtn.addEventListener('click', function(){ doLogin(); });
  const logoutBtn = document.getElementById('btn-logout');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){ logout(); });
  const mailboxBtn = document.getElementById('mailbox-btn');
  if(mailboxBtn) mailboxBtn.addEventListener('click', function(e){ toggleMailbox(e); });

  document.addEventListener('click', function(e){
    const t = e.target;
    if(!t || !t.closest) return;
    if(t.id==='mailbox-modal-bg'){ closeMailbox(); return; }
    if(t.id==='mailbox-detail-bg'){ closeMailboxDetail(); return; }
    const actionEl = t.closest('[data-action]');
    const action = actionEl ? actionEl.getAttribute('data-action') : '';
    if(action==='close-mailbox'){ closeMailbox(); return; }
    if(action==='close-mailbox-detail'){ closeMailboxDetail(); return; }
    if(action==='tab-inbox'){ setMailboxTab('inbox'); return; }
    if(action==='tab-sent'){ setMailboxTab('sent'); return; }
    if(action==='toggle-read'){ toggleMailboxDetailRead(); return; }
    if(action==='dismiss-update'){ dismissAppUpdate(); return; }
    if(action==='apply-update'){ applyAppUpdate(); return; }
    if(action==='close-modal'){ closeModal(); return; }
    if(action==='submit-transfer-apply-cart'){
      submitTransferApplyCart();
      return;
    }
    if(action==='tf-apply-add-cart'){
      addTransferApplyCartLine();
      return;
    }
    if(action==='tf-apply-remove-cart'){
      const idx = Number(actionEl.getAttribute('data-idx'));
      if(Number.isFinite(idx)) removeTransferApplyCartLine(idx);
      return;
    }
    if(action==='tf-apply-select-product'){
      const pid = actionEl.getAttribute('data-pid');
      if(pid!=null) selectTransferApplyProduct(pid);
      return;
    }
    if(action==='toggle-transfer-timeline'){
      const tid = actionEl.getAttribute('data-tid');
      if(tid) toggleTransferHistoryExpand(tid);
      return;
    }
    if(action==='submit-transfer-product'){ submitTransferProduct(); return; }
    if(action==='submit-transfer-product-edit'){ submitTransferProductEdit(); return; }
    if(action==='confirm-push-read'){
      const nid = actionEl.getAttribute('data-nid');
      if(nid) askConfirmPushRead(nid);
      return;
    }
    if(action==='submit-push-end'){
      const nid = actionEl.getAttribute('data-nid');
      if(nid) submitPushEnd(nid);
      return;
    }
    if(action==='submit-push-publish'){ closeModal(); sendPushNotification(); return; }
    if(action==='submit-transfer-stock'){
      const pid = actionEl.getAttribute('data-pid');
      const size = actionEl.getAttribute('data-size');
      if(pid!=null && size!=null) submitTransferStockEdit(pid, size);
      return;
    }
    const callEl = t.closest('[data-call]');
    if(callEl){
      const fnName = callEl.getAttribute('data-call') || '';
      const fn = typeof window[fnName] === 'function' ? window[fnName] : null;
      if(!fn) return;
      const args = [];
      for(let i = 0; i < 8; i++){
        const raw = callEl.getAttribute('data-arg' + i);
        if(raw === null) break;
        if(raw === 'true') args.push(true);
        else if(raw === 'false') args.push(false);
        else if(/^-?\d+(\.\d+)?$/.test(raw)) args.push(Number(raw));
        else args.push(raw);
      }
      e.preventDefault();
      try{ fn.apply(null, args); }catch(err){ console.error(fnName, err); }
      return;
    }
  });
  bindMailboxDelegates();
}
function transferMailboxActionsHtml(item){
  if(!item || item.actionType!=='transfer_decide' || !item.transferId) return '';
  if(item.transferResolved){
    return `<div class="mailbox-transfer-actions"><span style="font-size:12px;color:#78909c">此調動已處理${item.transferDecision?'：'+escHtml(item.transferDecision):''}</span></div>`;
  }
  const isOwn = currentUser && String(item.fromUserId||'')===String(currentUser.id);
  if(isOwn){
    return '<div class="mailbox-transfer-actions"><span style="font-size:12px;color:#78909c">你是申請人，不可自行審批。</span></div>';
  }
  const tidAttr = escHtml(String(item.transferId));
  return '<div class="mailbox-transfer-actions">'
    +'<button type="button" class="btn sm green" data-tid="'+tidAttr+'" data-decision="approve">通過</button>'
    +'<button type="button" class="btn sm red" data-tid="'+tidAttr+'" data-decision="reject">拒絕</button>'
    +'</div>';
}
async function decideTransferFromMailbox(transferId, decision){
  if(!apiEnabled || !authToken){ alert2('需要連接雲端。'); return; }
  let reason = '';
  if(decision==='reject'){
    reason = prompt('拒絕理由（可留空）：') || '';
  }else if(!confirm('確認通過此調動？通過後會立即扣減調出店庫存並加入調入店。')){
    return;
  }
  try{
    await apiFetch('/api/transfer/orders/'+encodeURIComponent(transferId)+'/decide', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ decision, reason })
    });
    transferOrdersCache = null;
    transferInvCache = null;
    await loadNotifications();
    if(currentView==='transferInventory' || currentView==='transferHistory' || currentView==='transferStockLog' || currentView==='transferProducts' || currentView==='transferProductLog' || currentView==='transferApply'){
      try{ await loadTransferInventory(true); }catch(_e){}
      try{ await loadTransferOrders(true); }catch(_e){}
      render();
    }else{
      refreshMailboxUi();
    }
    alert2(decision==='approve' ? '已通過，庫存已更新。' : '已拒絕此調動申請。');
  }catch(e){
    alert2('處理失敗：'+(e.message||e));
    await loadNotifications().catch(function(){});
    refreshMailboxUi();
  }
}
function notifAttachHtml(files){
  if(!Array.isArray(files) || !files.length) return '';
  return `<div style="margin-top:4px;font-size:12px">${files.map(function(f,i){
    const href = (typeof fileHref==='function') ? fileHref(f) : (f.dataUrl||'#');
    const name = escHtml(f.name||('附件'+(i+1)));
    return `<a class="file-link" href="${href}" download="${name.replace(/"/g,'')}" target="_blank" rel="noopener" style="display:inline-block;margin:2px 8px 2px 0">📎 ${name}</a>`;
  }).join('')}</div>`;
}
function pushFileListHtml(){
  if(!pushDraftFiles.length) return '<p style="font-size:12px;color:#888;margin:6px 0">尚未添加附件。</p>';
  return `<div style="margin:8px 0">${pushDraftFiles.map((f,i)=>`
    <div class="file-item" style="margin-bottom:6px">
      <span>📎</span><span>${escHtml(f.name)}</span>
      <button type="button" class="btn red sm" onclick="pushRemoveDraftFile(${i})">移除</button>
    </div>`).join('')}</div>`;
}
function pushRenderFileList(){
  const el = document.getElementById('push-file-list');
  if(el) el.innerHTML = pushFileListHtml();
}
function pushRemoveDraftFile(i){
  pushDraftFiles.splice(i,1);
  pushRenderFileList();
}
async function pushOnFilesPick(input){
  const files = input && input.files;
  if(!files || !files.length) return;
  try{
    for(let i=0;i<files.length;i++){
      const f = files[i];
      pushDraftFiles.push({ name:f.name, dataUrl: await readFileAsDataUrl(f) });
    }
  }catch(e){ alert2('讀取附件失敗，請重試。'); }
  input.value = '';
  pushRenderFileList();
}
async function uploadPushAttachments(){
  const out = [];
  for(let i=0;i<pushDraftFiles.length;i++){
    const f = pushDraftFiles[i];
    if(apiEnabled){
      const up = await cloudUploadDataUrl(f.name, f.dataUrl);
      out.push({ name:up.name||f.name, dataUrl:up.dataUrl, driveFileId:up.driveFileId, mimeType:up.mimeType });
    } else {
      out.push({ name:f.name, dataUrl:f.dataUrl });
    }
  }
  return out;
}
function escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function toggleMailbox(ev){
  if(ev) ev.stopPropagation();
  if(mailboxOpen){ closeMailbox(); return; }
  mailboxOpen = true;
  bindMailboxDelegates();
  const bg = document.getElementById('mailbox-modal-bg');
  if(bg) bg.classList.remove('hidden');
  await loadNotifications();
  refreshMailboxUi();
}
function closeMailbox(){
  mailboxOpen = false;
  closeMailboxDetail();
  const bg = document.getElementById('mailbox-modal-bg');
  if(bg) bg.classList.add('hidden');
}
async function setNotifReadState(id, read){
  if(!currentUser) return;
  const uid = currentUser.id;
  if(apiEnabled){
    try{
      const path = '/api/notifications/'+encodeURIComponent(id)+(read?'/read':'/unread');
      await apiFetch(path, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ userId: uid })
      });
      await loadNotifications();
      refreshMailboxUi();
    }catch(e){
      alert2((read?'標為已讀':'標為未讀')+'失敗：'+(e.message||e));
    }
    return;
  }
  const item = notifications.find(n => n.id === id);
  if(!item) return;
  const rec = (item.recipients||[]).find(r => r.userId === uid);
  if(!rec) return;
  rec.read = !!read;
  rec.readAt = read ? nowStr() : null;
  saveNotificationsLocal();
  refreshMailboxUi();
}
async function markNotifRead(id){ return setNotifReadState(id, true); }
async function markNotifUnread(id){ return setNotifReadState(id, false); }
function pushRecipientCandidates(){
  if(!currentUser) return [];
  ensureAdminUser();
  return users.filter(u => u.active!==false && u.id !== currentUser.id);
}
function togglePushRecipients(on){
  document.querySelectorAll('#push-recipients input[type=checkbox]').forEach(cb=>{ cb.checked = !!on; });
}
function selectedPushRecipientIds(){
  return Array.from(document.querySelectorAll('#push-recipients input[type=checkbox]:checked')).map(cb => cb.value);
}
const NOTICE_CAT_META = {
  restock: { name: '補貨', icon: '📦' },
  price: { name: '價錢更新', icon: '💰' },
  urgent: { name: '緊急資訊', icon: '🚨' },
  general: { name: '一般資訊', icon: '📄' },
  transfer: { name: '貨品調動', icon: '🔄' },
  adhoc: { name: '突發任務', icon: '⚡' }
};
let pushNoticeId = null;
let pushStatsId = null;
let pushFilterCat = '全部';
let pushFilterRead = '全部';
let pushFilterKw = '';
let pushUrgentPrompted = false;

function isTransferNotice(n){
  return !!(n && (n.actionType==='transfer_decide' || n.cat==='transfer' || n.category==='貨品調動'));
}
function isAnnouncement(n){ return n && !isTransferNotice(n); }
function noticeCatKey(n){
  if(!n) return 'general';
  if(isTransferNotice(n)) return 'transfer';
  if(n.cat && NOTICE_CAT_META[n.cat]) return n.cat;
  const c = String(n.category||'');
  if(c.indexOf('調動')>=0) return 'transfer';
  if(c.indexOf('突發')>=0) return 'adhoc';
  if(c.indexOf('恆常')>=0) return 'general';
  if(c.indexOf('開發')>=0) return 'general';
  if(c.indexOf('補貨')>=0) return 'restock';
  if(c.indexOf('價錢')>=0) return 'price';
  if(c.indexOf('緊急')>=0) return 'urgent';
  return 'general';
}
function noticeCatTag(n){
  const k = noticeCatKey(n);
  const m = NOTICE_CAT_META[k] || NOTICE_CAT_META.general;
  return '<span class="tag n-cat">'+m.icon+' '+escHtml(m.name)+'</span>';
}
function myNoticeReader(n){
  if(!currentUser || !n) return null;
  const uid = String(currentUser.id);
  if(n.readers && n.readers[uid]) return n.readers[uid];
  const rec = (n.recipients||[]).find(function(r){ return String(r.userId)===uid; });
  if(!rec) return null;
  if(rec.status) return { status: rec.status, openTime: rec.openTime||null, confirmTime: rec.confirmTime||rec.readAt||null };
  return rec.read
    ? { status:'read', openTime: rec.readAt||null, confirmTime: rec.readAt||null }
    : { status:'unopen', openTime:null, confirmTime:null };
}
function isNoticeRecipient(n){
  if(!currentUser || !n) return false;
  const uid = String(currentUser.id);
  return (n.recipients||[]).some(function(r){ return String(r.userId)===uid; });
}
function announcementList(){
  return (notifications||[]).filter(isAnnouncement);
}
function myActiveAnnouncements(){
  return announcementList().filter(function(n){
    return n.status==='進行中' && isNoticeRecipient(n);
  });
}
function myUnreadAnnouncements(){
  return myActiveAnnouncements().filter(function(n){
    const s = myNoticeReader(n);
    return !s || s.status!=='read';
  });
}
function sortAnnouncements(list){
  return (list||[]).slice().sort(function(a,b){
    if(!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const au = noticeCatKey(a)==='urgent';
    const bu = noticeCatKey(b)==='urgent';
    if(au!==bu) return au ? -1 : 1;
    return (b.createdAtMs||0) - (a.createdAtMs||0);
  });
}
function noticeReadStateTag(n){
  const s = myNoticeReader(n);
  if(n.status!=='進行中' && (!s || s.status!=='read') && isNoticeRecipient(n)){
    return '<span class="tag" style="background:#eceff1;color:#78909c">到期未讀</span>';
  }
  if(!s || s.status==='unopen') return '<span class="tag" style="background:#ffebee;color:#c62828">未讀</span>';
  if(s.status==='opened') return '<span class="tag" style="background:#fff8e1;color:#8d6e00">已開啟</span>';
  return '<span class="tag" style="background:#e8f5e9;color:#2e7d32">✓ 已讀</span>';
}
function mailboxUnionNotices(){
  if(!currentUser) return [];
  const uid = String(currentUser.id);
  return (notifications||[]).filter(function(n){
    const inInbox = (n.recipients||[]).some(function(r){ return String(r.userId)===uid; });
    const inSent = String(n.fromUserId||'')===uid;
    return inInbox || inSent;
  });
}
/** 「所有通知」來源：信箱會出現的訊息；管理層另含其餘公告 */
function pushAllSourceList(){
  if(!currentUser) return [];
  const seen = {};
  const out = [];
  function add(n){
    if(!n || !n.id || seen[n.id]) return;
    seen[n.id] = true;
    out.push(n);
  }
  mailboxUnionNotices().forEach(add);
  if(isAdmin() || isManager()){
    (notifications||[]).forEach(function(n){
      if(!isTransferNotice(n)) add(n);
    });
  }
  return out;
}
function noticeCardHtml(n){
  const s = myNoticeReader(n);
  const unread = isNoticeRecipient(n) && (!s||s.status!=='read') && n.status==='進行中';
  const border = n.status!=='進行中' ? '#eee' : (noticeCatKey(n)==='urgent' ? '#e57373' : (unread ? '#e8d9a0' : '#e5e9f0'));
  const bg = n.status!=='進行中' ? '#f5f6f7' : (noticeCatKey(n)==='urgent' ? '#fff5f5' : (unread ? '#fdf9ee' : '#fff'));
  return '<div class="notice-card" style="border:1px solid '+border+';border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;background:'+bg+'" data-call="openPushNotice" data-arg0="'+escHtml(String(n.id))+'">'
    +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">'
    +(n.pinned&&n.status==='進行中'?'<span class="tag" style="background:#c62828;color:#fff">置頂</span>':'')
    +noticeCatTag(n)
    +(n.priority==='緊急'?'<span class="tag n-pri-urgent">緊急</span>':n.priority==='重要'?'<span class="tag n-pri-important">重要</span>':'')
    +'<span style="font-size:15px;flex:1;min-width:140px;'+(unread?'font-weight:bold':'')+'">'+(unread?'<span style="display:inline-block;width:8px;height:8px;background:#e53935;border-radius:50%;margin-right:6px"></span>':'')+escHtml(n.title||'（無標題）')+'</span>'
    +((n.attachments&&n.attachments.length)?'<span>📎</span>':'')
    +(isNoticeRecipient(n)?noticeReadStateTag(n):'<span class="tag">'+(escHtml(n.status||'進行中'))+'</span>')
    +'</div>'
    +'<div style="font-size:13px;color:#666;margin-bottom:6px">'+escHtml(n.summary||(n.content||'').slice(0,80))+'</div>'
    +'<div style="font-size:12px;color:#888;display:flex;gap:12px;flex-wrap:wrap">'
    +'<span>發布人：'+escHtml(n.fromName||'—')+'</span>'
    +'<span>發布：'+escHtml(n.createdAt||'')+'</span>'
    +(n.endDate?'<span>有效期至：'+escHtml(n.endDate)+'</span>':'')
    +(s&&s.status==='read'?'<span style="color:#2e7d32">✓ 本人已於 '+escHtml(s.confirmTime||'')+' 確認</span>':'')
    +'</div></div>';
}
function pushFilterBarHtml(){
  const cats = ['全部'].concat(Object.keys(NOTICE_CAT_META).map(function(k){ return NOTICE_CAT_META[k].name; }));
  return '<div class="filters">'
    +'<select onchange="pushFilterCat=this.value;render()">'
    +cats.map(function(c){ return '<option'+(pushFilterCat===c?' selected':'')+'>'+escHtml(c)+'</option>'; }).join('')
    +'</select>'
    +'<select onchange="pushFilterRead=this.value;render()">'
    +['全部','未讀','已開啟','已讀'].map(function(s){ return '<option'+(pushFilterRead===s?' selected':'')+'>'+s+'</option>'; }).join('')
    +'</select>'
    +'<input type="text" placeholder="搜尋標題／內容" value="'+escHtml(pushFilterKw)+'" onchange="pushFilterKw=this.value;render()" onkeydown="if(event.key===\'Enter\'){pushFilterKw=this.value;render()}">'
    +'</div>';
}
function applyPushFilters(list){
  let out = list || [];
  if(pushFilterCat && pushFilterCat!=='全部'){
    out = out.filter(function(n){ return (NOTICE_CAT_META[noticeCatKey(n)]||{}).name===pushFilterCat; });
  }
  if(pushFilterRead && pushFilterRead!=='全部'){
    out = out.filter(function(n){
      const s = myNoticeReader(n);
      if(pushFilterRead==='未讀' || pushFilterRead==='未開啟') return !s||s.status==='unopen';
      if(pushFilterRead==='已開啟' || pushFilterRead==='已開啟未確認') return s&&s.status==='opened';
      if(pushFilterRead==='已讀' || pushFilterRead==='已讀取') return s&&s.status==='read';
      return true;
    });
  }
  if(pushFilterKw){
    const kw = pushFilterKw.toLowerCase();
    out = out.filter(function(n){
      return (String(n.title||'')+String(n.summary||'')+String(n.content||'')).toLowerCase().indexOf(kw)>=0;
    });
  }
  return out;
}
async function openPushNotice(id){
  pushNoticeId = id;
  currentModule = 'push';
  currentView = 'pushDetail';
  const n = findMailboxItem(id);
  if(n && isAnnouncement(n) && isNoticeRecipient(n) && apiEnabled){
    try{
      await apiFetch('/api/notifications/'+encodeURIComponent(id)+'/open', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      await loadNotifications();
    }catch(_e){}
  }
  render();
}
function pushNoticeStats(n){
  const recs = Array.isArray(n.recipients) ? n.recipients : [];
  let read=0, opened=0, unopen=0;
  recs.forEach(function(r){
    const st = r.status || (r.read ? 'read' : 'unopen');
    if(st==='read') read++;
    else if(st==='opened') opened++;
    else unopen++;
  });
  const total = recs.length;
  return { total, read, opened, unopen, pct: total?Math.round(read/total*100):0 };
}
function vPushAll(){
  if(!currentUser) return '<div class="card"><h2>📢 所有通知</h2><p>請先登入。</p></div>';
  let list = applyPushFilters(sortAnnouncements(pushAllSourceList()));
  const urgentUnread = myUnreadAnnouncements().filter(function(n){ return noticeCatKey(n)==='urgent'; });
  const source = pushAllSourceList();
  const statsU = source.filter(function(n){
    if(!isNoticeRecipient(n)) return false;
    const s = myNoticeReader(n);
    return !s || s.status!=='read';
  }).length;
  const statsR = source.filter(function(n){
    if(!isNoticeRecipient(n)) return false;
    const s = myNoticeReader(n);
    return s && s.status==='read';
  }).length;
  return (urgentUnread.length
    ? '<div style="background:#ffebee;border:1px solid #ef9a9a;color:#b71c1c;padding:12px 14px;border-radius:8px;margin-bottom:12px;font-weight:bold;cursor:pointer" data-call="openPushNotice" data-arg0="'+escHtml(String(urgentUnread[0].id))+'">🚨 你有 '+urgentUnread.length+' 則緊急通知未確認已讀，請立即閱讀 →</div>'
    : '')
    +'<div class="card"><h2>📢 所有通知</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 12px;line-height:1.55">包含所有會出現在信箱的訊息（推送、突發任務、貨品調動等）。</p>'
    +(!isAdmin()&&!isManager()?'<div class="stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">'
      +'<div class="stat" style="background:#f8f6fb;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#c62828">'+statsU+'</div><div style="font-size:12px;color:#777">未讀／已開啟</div></div>'
      +'<div class="stat" style="background:#f8f6fb;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#2e7d32">'+statsR+'</div><div style="font-size:12px;color:#777">已讀</div></div>'
      +'<div class="stat" style="background:#f8f6fb;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#1565c0">'+source.length+'</div><div style="font-size:12px;color:#777">全部訊息</div></div>'
      +'</div>':'')
    +pushFilterBarHtml()
    +(list.length?list.map(noticeCardHtml).join(''):'<p style="color:#888">沒有符合條件的通知。</p>')
    +'</div>';
}
function vPushUnread(){
  const list = sortAnnouncements(myUnreadAnnouncements());
  return '<div class="card"><h2>🔴 未回覆／未閱讀（'+list.length+'）</h2>'
    +'<div class="info-banner" style="background:#ede7f6;border:1px solid #b39ddb;color:#4a2c6b;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px">必須進入詳情閱讀完整內容後剔選確認，才會計算為已讀。只看到標題不會算已讀。</div>'
    +(list.length?list.map(noticeCardHtml).join(''):'<p style="color:#888">🎉 你已確認所有通知。</p>')
    +'</div>';
}
function vPushRead(){
  const list = sortAnnouncements(myActiveAnnouncements().filter(function(n){ const s=myNoticeReader(n); return s&&s.status==='read'; }));
  return '<div class="card"><h2>✅ 已讀取（'+list.length+'）</h2>'
    +(list.length?list.map(noticeCardHtml).join(''):'<p style="color:#888">暫無已讀取通知。</p>')
    +'</div>';
}
function vPushEnded(){
  const list = announcementList().filter(function(n){
    if(n.status==='進行中') return false;
    return isNoticeRecipient(n) || String(n.fromUserId)===String(currentUser.id) || isAdmin() || isManager();
  });
  return '<div class="card"><h2>📁 已完結（'+list.length+'）</h2>'
    +'<div class="info-banner" style="background:#ede7f6;border:1px solid #b39ddb;color:#4a2c6b;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px">通知到期或提早完結後移至此处；閱讀記錄仍保留。</div>'
    +(list.length?sortAnnouncements(list).map(noticeCardHtml).join(''):'<p style="color:#888">暫無已完結通知。</p>')
    +'</div>';
}
function vPushMine(){
  const list = pushAllSourceList().filter(function(n){
    return String(n.fromUserId)===String(currentUser.id) || isAdmin() || isManager();
  });
  const head = '<tr><th>編號</th><th>類別</th><th>標題</th><th>狀態</th><th>接收</th><th>已讀</th><th>已開啟</th><th>未讀</th><th>已讀%</th><th>操作</th></tr>';
  const body = !list.length
    ? '<tr><td colspan="10" style="color:#888;text-align:center">你未發布過通知。</td></tr>'
    : list.map(function(n){
      const st = pushNoticeStats(n);
      return '<tr>'
        +'<td>'+escHtml(n.id)+'</td><td>'+noticeCatTag(n)+'</td><td>'+escHtml(n.title||'')+'</td>'
        +'<td>'+escHtml(n.status||'')+'</td>'
        +'<td>'+st.total+'</td><td>'+st.read+'</td><td>'+st.opened+'</td><td>'+st.unopen+'</td>'
        +'<td><b style="color:'+(st.pct>=80?'#2e7d32':st.pct>=50?'#ef6c00':'#c62828')+'">'+st.pct+'%</b></td>'
        +'<td style="white-space:nowrap">'
        +'<button type="button" class="btn sm" data-call="viewPushStats" data-arg0="'+escHtml(String(n.id))+'">閱讀統計</button> '
        +(n.status==='進行中'&&!isTransferNotice(n)?'<button type="button" class="btn red sm" data-call="askEndPushNotice" data-arg0="'+escHtml(String(n.id))+'">提早完結</button>':'')
        +'</td></tr>';
    }).join('');
  return '<div class="card"><h2>📤 我發布的通知'+(isAdmin()||isManager()?'（管理層：顯示全部）':'')+'</h2>'
    +'<div class="table-wrap"><table>'+head+body+'</table></div></div>';
}
function viewPushStats(id){ pushStatsId=id; currentView='pushStats'; render(); }
function vPushStats(){
  const n = findMailboxItem(pushStatsId);
  if(!n) return vPushMine();
  const st = pushNoticeStats(n);
  const unitMap = {};
  (n.recipients||[]).forEach(function(r){
    const u = users.find(function(x){ return String(x.id)===String(r.userId); });
    const unit = (u && (userUnits(u)[0]||u.unit)) || '—';
    unitMap[unit] = unitMap[unit] || { total:0, read:0, opened:0, unopen:0 };
    unitMap[unit].total++;
    const rst = recipientReadStatus(r);
    if(rst==='read') unitMap[unit].read++;
    else if(rst==='opened') unitMap[unit].opened++;
    else unitMap[unit].unopen++;
  });
  return '<div class="card">'
    +'<button type="button" class="btn gray sm" data-call="go" data-arg0="pushMine">← 返回</button>'
    +'<h2 style="margin-top:12px">📊 閱讀統計｜'+escHtml(n.id)+' '+escHtml(n.title||'')+'</h2>'
    +'<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:10px;margin:12px 0">'
    +[['接收',st.total,'#1565c0'],['已讀',st.read,'#2e7d32'],['已開啟',st.opened,'#ef6c00'],['未讀',st.unopen,'#c62828'],['已讀%',st.pct+'%','#7b1fa2']].map(function(x){
      return '<div style="background:#f8f6fb;border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:'+x[2]+'">'+x[1]+'</div><div style="font-size:12px;color:#777">'+x[0]+'</div></div>';
    }).join('')
    +'</div>'
    +'<h3>👥 閱讀名單</h3><div class="table-wrap"><table><tr><th>姓名</th><th>閱讀狀態</th><th>首次開啟</th><th>確認時間</th></tr>'
    +(n.recipients||[]).map(function(r){
      const stt = recipientReadStatus(r);
      let tag = recipientReadStatusTag(stt);
      if(n.status!=='進行中' && stt!=='read') tag = '<span class="tag" style="background:#eceff1;color:#78909c">到期未讀</span>';
      return '<tr><td>'+escHtml(userName(r.userId)||r.userId)+'</td><td>'+tag+'</td><td>'+escHtml(r.openTime||'—')+'</td><td>'+escHtml(r.confirmTime||r.readAt||'—')+'</td></tr>';
    }).join('')
    +'</table></div>'
    +'<h3>🏪 按單位統計</h3><div class="table-wrap"><table><tr><th>單位</th><th>接收</th><th>已讀</th><th>已開啟</th><th>未讀</th><th>%</th></tr>'
    +Object.keys(unitMap).map(function(u){
      const d = unitMap[u];
      const pct = d.total?Math.round(d.read/d.total*100):0;
      return '<tr><td>'+escHtml(u)+'</td><td>'+d.total+'</td><td>'+d.read+'</td><td>'+d.opened+'</td><td>'+d.unopen+'</td><td><b>'+pct+'%</b></td></tr>';
    }).join('')
    +'</table></div></div>';
}
function vPushDetail(){
  const n = findMailboxItem(pushNoticeId);
  if(!n) return vPushAll();
  if(isTransferNotice(n)){
    const canManage = String(n.fromUserId)===String(currentUser.id) || isAdmin() || isManager();
    const stats = notifReadStats(n);
    return '<div class="card">'
      +'<button type="button" class="btn gray sm" data-call="go" data-arg0="pushAll">← 返回通知列表</button>'
      +'<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+noticeCatTag(n)
      +'<span class="tag n-pri-important">重要</span>'
      +(n.transferResolved?'<span class="tag" style="background:#eceff1;color:#546e7a">已處理</span>':'<span class="tag" style="background:#fff3e0;color:#ef6c00">待審批</span>')
      +'</div>'
      +'<h2 style="font-size:19px;margin-top:8px">'+escHtml(n.title||'貨品調動')+'</h2>'
      +'<div style="margin-top:8px;font-size:13px;color:#777;display:flex;gap:14px;flex-wrap:wrap">'
      +'<span>編號：'+escHtml(n.id)+'</span><span>發布人：'+escHtml(n.fromName||'')+'</span>'
      +'<span>發布：'+escHtml(n.createdAt||'')+'</span>'
      +'<span>已讀 '+stats.read+'｜已開啟 '+stats.opened+'｜未讀 '+stats.unopen+'</span>'
      +'</div>'
      +'<div style="border:1px solid #e5e9f0;border-radius:10px;padding:16px;margin:12px 0;white-space:pre-wrap;line-height:1.7">'+escHtml(n.content||'')+'</div>'
      +'<div class="info-banner" style="background:#e3f2fd;border:1px solid #90caf9;color:#0d47a1;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px">'
      +'貨品調動審批請在信箱處理（通過／拒絕）。'
      +'</div>'
      +'<div class="actions">'
      +'<button type="button" class="btn sm" data-call="openMailboxDetail" data-arg0="'+escHtml(String(n.id))+'">打開信箱詳情</button>'
      +(canManage?'<button type="button" class="btn sm" data-call="viewPushStats" data-arg0="'+escHtml(String(n.id))+'">📊 閱讀統計</button>':'')
      +'</div>'
      +(canManage?mailboxReceiptHtml(n):'')
      +'</div>';
  }
  const s = myNoticeReader(n);
  const isRecip = isNoticeRecipient(n);
  const confirmed = s && s.status==='read';
  let confirmHtml = '';
  if(isRecip){
    if(confirmed){
      confirmHtml = '<div style="border:2px solid #2e7d32;border-radius:10px;padding:16px;background:#f1f8f1;margin-top:14px">'
        +'<div style="font-size:15px;color:#2e7d32;font-weight:bold">✅ 已成功確認閱讀</div>'
        +'<div style="font-size:13px;margin-top:6px;color:#555">已由 <b>'+escHtml(currentUser.name)+'</b> 於 <b>'+escHtml(s.confirmTime||'')+'</b> 確認。首次開啟：'+escHtml(s.openTime||'—')+'</div></div>';
    } else if(n.status==='進行中'){
      confirmHtml = '<div style="border:2px solid #4a2c6b;border-radius:10px;padding:16px;background:#f8f6fb;margin-top:14px">'
        +'<div style="font-size:13px;color:#888;margin-bottom:10px">⚠️ 請先閱讀完整內容。只打開不會算已讀，必須剔選確認並提交。</div>'
        +'<label style="display:flex;gap:10px;align-items:flex-start;font-size:14px;cursor:pointer;margin:0">'
        +'<input type="checkbox" id="push-read-chk" onchange="var b=document.getElementById(\'push-confirm-btn\'); if(b) b.disabled=!this.checked" style="width:20px;height:20px">'
        +'<span>本人已閱讀及知悉以上通知內容。</span></label>'
        +'<button type="button" class="btn green" id="push-confirm-btn" disabled data-action="confirm-push-read" data-nid="'+escHtml(String(n.id))+'">確認已讀</button></div>';
    } else {
      confirmHtml = '<div style="border:2px solid #78909c;border-radius:10px;padding:16px;background:#f5f6f7;margin-top:14px;color:#78909c">⏰ 此通知已完結，本人於完結時仍未確認。</div>';
    }
  } else {
    confirmHtml = '<div class="info-banner" style="background:#ede7f6;border:1px solid #b39ddb;color:#4a2c6b;padding:10px 14px;border-radius:8px;margin-top:14px;font-size:13px">你不是此通知的接收者（檢視模式），不需要確認已讀。</div>';
  }
  const canManage = String(n.fromUserId)===String(currentUser.id) || isAdmin() || isManager();
  return '<div class="card">'
    +'<button type="button" class="btn gray sm" data-call="go" data-arg0="pushAll">← 返回通知列表</button>'
    +'<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+noticeCatTag(n)
    +(n.priority==='緊急'?'<span class="tag n-pri-urgent">緊急</span>':n.priority==='重要'?'<span class="tag n-pri-important">重要</span>':'')
    +'<span class="tag">'+escHtml(n.status||'')+'</span></div>'
    +'<h2 style="font-size:19px;margin-top:8px">'+escHtml(n.title||'（無標題）')+'</h2>'
    +'<div style="margin-top:8px;font-size:13px;color:#777;display:flex;gap:14px;flex-wrap:wrap">'
    +'<span>編號：'+escHtml(n.id)+'</span><span>發布人：'+escHtml(n.fromName||'')+'</span>'
    +'<span>發布：'+escHtml(n.createdAt||'')+'</span>'
    +(n.startDate?'<span>生效：'+escHtml(n.startDate)+'</span>':'')
    +(n.endDate?'<span>有效期至：'+escHtml(n.endDate)+'</span>':'')
    +(n.recipientDesc?'<span>接收：'+escHtml(n.recipientDesc)+'</span>':'')
    +'</div>'
    +'<div style="border:1px solid #e5e9f0;border-radius:10px;padding:16px;margin:12px 0;white-space:pre-wrap;line-height:1.7">'+escHtml(n.content||'')+'</div>'
    +notifAttachHtml(n.attachments)
    +confirmHtml
    +(canManage?mailboxReceiptHtml(n):'')
    +(canManage?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">'
      +'<button type="button" class="btn sm" data-call="viewPushStats" data-arg0="'+escHtml(String(n.id))+'">📊 閱讀統計</button>'
      +(n.status==='進行中'?'<button type="button" class="btn red sm" data-call="askEndPushNotice" data-arg0="'+escHtml(String(n.id))+'">提早完結／取消</button>':'')
      +((isAdmin()||isManager())?'<button type="button" class="btn orange sm" data-call="togglePushPin" data-arg0="'+escHtml(String(n.id))+'">'+(n.pinned?'取消置頂':'置頂通知')+'</button>':'')
      +'</div>':'')
    +'</div>';
}
function askConfirmPushRead(id){
  const n = (notifications||[]).find(function(x){ return String(x.id)===String(id); });
  if(n && !isPushNoticeConfirmable(n)){
    alert2('此通知已完結，無法再確認已讀。');
    return;
  }
  showModal(
    '<h3>確認已讀？</h3>'+
    '<p style="font-size:14px;line-height:1.6">確定已閱讀並知悉此通知內容？<br><span style="color:#888">確認後將標記為已讀，通常不可改回。</span></p>'+
    '<div class="actions">'+
      '<button type="button" class="btn gray sm" onclick="closeModal()">取消</button>'+
      '<button type="button" class="btn green sm" data-call="doConfirmPushRead" data-arg0="'+escHtml(String(id))+'">確定確認已讀</button>'+
    '</div>'
  );
}
async function doConfirmPushRead(id){
  closeModal();
  await confirmPushRead(id);
}
async function confirmPushRead(id){
  const n = (notifications||[]).find(function(x){ return String(x.id)===String(id); });
  if(n && !isPushNoticeConfirmable(n)){
    alert2('此通知已完結，無法再確認已讀。');
    return;
  }
  try{
    await apiFetch('/api/notifications/'+encodeURIComponent(id)+'/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    await loadNotifications();
    render();
    alert2('已成功確認閱讀。');
  }catch(e){ alert2('確認失敗：'+(e.message||e)); }
}
function askEndPushNotice(id){
  showModal('<h3>提早完結／取消通知</h3>'
    +'<label>處理方式</label><select id="push-end-mode"><option>提早完結</option><option>取消通知</option></select>'
    +'<label>原因（必填）</label><input type="text" id="push-end-reason" placeholder="請輸入原因">'
    +'<div class="actions"><button type="button" class="btn gray sm" data-action="close-modal">取消</button>'
    +'<button type="button" class="btn red sm" data-action="submit-push-end" data-nid="'+escHtml(String(id))+'">確認</button></div>');
}
async function submitPushEnd(id){
  const mode = (document.getElementById('push-end-mode')||{}).value || '提早完結';
  const reason = ((document.getElementById('push-end-reason')||{}).value||'').trim();
  if(!reason){ alert2('請填寫原因。'); return; }
  try{
    await apiFetch('/api/notifications/'+encodeURIComponent(id)+'/end', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ mode, reason })
    });
    closeModal();
    await loadNotifications();
    currentView = 'pushMine';
    render();
  }catch(e){ alert2('操作失敗：'+(e.message||e)); }
}
async function togglePushPin(id){
  try{
    await apiFetch('/api/notifications/'+encodeURIComponent(id)+'/pin', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    await loadNotifications();
    render();
  }catch(e){ alert2('置頂失敗：'+(e.message||e)); }
}
function resolvePushRecipients(){
  const target = (document.getElementById('push-target')||{}).value || 'all';
  const stores = ['觀塘','荔枝角','灣仔','屯門'];
  let ids = [];
  let desc = '';
  const me = String(currentUser.id);
  function activeUsers(){ return users.filter(function(u){ return u && u.active!==false && String(u.id)!==me; }); }
  if(target==='all'){
    ids = activeUsers().map(function(u){ return String(u.id); });
    desc = '全部同事';
  } else if(target==='stores'){
    ids = activeUsers().filter(function(u){ return userUnits(u).some(function(x){ return stores.indexOf(x)>=0; }); }).map(function(u){ return String(u.id); });
    desc = '指定單位：全部門市';
  } else if(target==='regions'){
    const picked = Array.from(document.querySelectorAll('.push-region:checked')).map(function(cb){ return cb.value; });
    ids = activeUsers().filter(function(u){ return userUnits(u).some(function(x){ return picked.indexOf(x)>=0; }); }).map(function(u){ return String(u.id); });
    desc = '指定地區：'+picked.join('、');
  } else {
    ids = Array.from(document.querySelectorAll('#push-recipients input[type=checkbox]:checked')).map(function(cb){ return cb.value; });
    desc = '指定個人：'+ids.map(function(id){ return userName(id)||id; }).join('、');
  }
  ids = [...new Set(ids)];
  return { ids, desc };
}
function onPushTargetChange(){
  const v = (document.getElementById('push-target')||{}).value;
  const reg = document.getElementById('push-regions-wrap');
  const per = document.getElementById('push-persons-wrap');
  if(reg) reg.style.display = v==='regions' ? '' : 'none';
  if(per) per.style.display = v==='person' ? '' : 'none';
}
function confirmSendPush(){
  if(!requireCloud('推送通知')) return;
  const cat = (document.getElementById('push-cat')||{}).value || 'general';
  const priority = (document.getElementById('push-pri')||{}).value || '一般';
  const title = ((document.getElementById('push-title')||{}).value || '').trim();
  const summary = ((document.getElementById('push-summary')||{}).value || '').trim();
  const content = ((document.getElementById('push-content')||{}).value || '').trim();
  const startDate = (document.getElementById('push-start')||{}).value || '';
  const endDate = (document.getElementById('push-end')||{}).value || '';
  const resolved = resolvePushRecipients();
  if(!title){ alert2('請填寫通知標題。'); return; }
  if(!content && !pushDraftFiles.length){ alert2('請填寫詳細內容，或至少添加 1 個附件。'); return; }
  if(!resolved.ids.length){ alert2('請至少選擇一位收件人。'); return; }
  if(!endDate){ alert2('請選擇完結日期。'); return; }
  const catName = (NOTICE_CAT_META[cat]||NOTICE_CAT_META.general).name;
  showModal('<h3>確認發布</h3>'
    +'<p style="font-size:14px;line-height:1.7">類別：<b>'+escHtml(catName)+'</b>｜優先：<b>'+escHtml(priority)+'</b><br>'
    +'標題：<b>'+escHtml(title)+'</b><br>'
    +'接收：'+escHtml(resolved.desc)+'（'+resolved.ids.length+' 人）<br>'
    +'生效：'+escHtml(startDate)+'｜完結：'+escHtml(endDate)+'<br>'
    +'附件：'+pushDraftFiles.length+' 個</p>'
    +'<div class="actions"><button type="button" class="btn gray sm" data-action="close-modal">取消</button>'
    +'<button type="button" class="btn green sm" data-action="submit-push-publish">確定發布</button></div>');
}
async function sendPushNotification(){
  if(!requireCloud('推送通知')) return;
  const cat = (document.getElementById('push-cat')||{}).value || 'general';
  const priority = (document.getElementById('push-pri')||{}).value || '一般';
  const title = ((document.getElementById('push-title')||{}).value || '').trim();
  const summary = ((document.getElementById('push-summary')||{}).value || '').trim();
  const content = ((document.getElementById('push-content')||{}).value || '').trim();
  const startDate = (document.getElementById('push-start')||{}).value || '';
  const endDate = (document.getElementById('push-end')||{}).value || '';
  const resolved = resolvePushRecipients();
  if(!title || (!content && !pushDraftFiles.length) || !resolved.ids.length || !currentUser) return;
  let attachments = [];
  try{ attachments = await uploadPushAttachments(); }
  catch(e){ alert2('上傳附件失敗：'+(e.message||e)); return; }
  const category = (NOTICE_CAT_META[cat]||NOTICE_CAT_META.general).name;
  const payload = {
    cat, category, priority, title, summary, content: content || (attachments.length?'（見附件）':''),
    attachments, recipientIds: resolved.ids, recipientDesc: resolved.desc,
    startDate, endDate, pinned: cat==='urgent' || priority==='緊急'
  };
  try{
    const item = await apiFetch('/api/notifications', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    await loadNotifications();
    pushDraftFiles = [];
    currentView = 'pushMine';
    render();
    const id = item && item.id ? item.id : '';
    showModal('<h3 style="color:#2e7d32">✅ 通知已發布</h3>'
      +'<p style="font-size:14px">通知編號：<b>'+escHtml(id)+'</b><br>共 '+resolved.ids.length+' 位接收者將收到未讀提示。</p>'
      +'<div class="actions">'
      +(id?'<button type="button" class="btn sm" data-call="viewPushStats" data-arg0="'+escHtml(id)+'">查看閱讀統計</button>':'')
      +'<button type="button" class="btn gray sm" data-action="close-modal" data-call="go" data-arg0="pushMine">我發布的通知</button></div>');
  }catch(e){ alert2('發布失敗：'+(e.message||e)); }
}
function vPushCreate(){
  const today = new Date();
  const ymd = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  const end = new Date(today.getTime()+14*86400000);
  const endYmd = end.getFullYear()+'-'+String(end.getMonth()+1).padStart(2,'0')+'-'+String(end.getDate()).padStart(2,'0');
  const catOpts = Object.keys(NOTICE_CAT_META).map(function(k){
    const m = NOTICE_CAT_META[k];
    return '<option value="'+k+'">'+m.icon+' '+m.name+'</option>';
  }).join('');
  const priOpts = NOTIF_PRIORITIES.map(function(p){ return '<option'+(p==='一般'?' selected':'')+'>'+p+'</option>'; }).join('');
  const regionChecks = TRANSFER_STORES_FE.map(function(s){
    return '<label class="rc-item"><input type="checkbox" class="push-region" value="'+escHtml(s)+'"> '+escHtml(s)+'</label>';
  }).join('');
  const cands = pushRecipientCandidates();
  const rows = cands.length
    ? cands.map(function(u){ return '<label class="rc-item"><input type="checkbox" value="'+u.id+'"> '+escHtml(u.name)+' <span style="color:#888">（'+escHtml(roleLabel(u))+'）</span></label>'; }).join('')
    : '<p style="color:#888;font-size:13px;margin:0">目前沒有可選收件人。</p>';
  setTimeout(pushRenderFileList, 0);
  return '<div class="card"><h2>➕ 新增通知</h2>'
    +'<div class="info-banner" style="background:#ede7f6;border:1px solid #b39ddb;color:#4a2c6b;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px">發布人：<b>'+escHtml(currentUser.name)+'</b>｜不可匿名；發布後保留操作記錄。</div>'
    +'<label>通知類別</label><select id="push-cat">'+catOpts+'</select>'
    +'<label>優先程度</label><select id="push-pri">'+priOpts+'</select>'
    +'<label>通知標題</label><input type="text" id="push-title" placeholder="例如：WS-777 新產品上架通知">'
    +'<label>通知摘要（列表顯示）</label><input type="text" id="push-summary" placeholder="簡短一句概括">'
    +'<label>詳細內容</label><textarea id="push-content" style="min-height:110px" placeholder="支援分行說明"></textarea>'
    +'<label>接收對象</label><select id="push-target" onchange="onPushTargetChange()">'
    +'<option value="all">全部同事</option>'
    +'<option value="stores">指定單位：全部門市（四間港店）</option>'
    +'<option value="regions">指定地區（多選）</option>'
    +'<option value="person">指定個人</option></select>'
    +'<div id="push-regions-wrap" style="display:none;margin-top:8px;padding:10px;background:#f8f6fb;border-radius:8px">'+regionChecks+'</div>'
    +'<div id="push-persons-wrap" style="display:none;margin-top:8px">'
    +'<div class="recipient-box" id="push-recipients"><div class="rc-tools">'
    +'<button type="button" class="btn sm gray" onclick="togglePushRecipients(true)">全選</button>'
    +'<button type="button" class="btn sm gray" onclick="togglePushRecipients(false)">取消全選</button></div>'+rows+'</div></div>'
    +'<label>生效日期</label><input type="date" id="push-start" value="'+ymd+'">'
    +'<label>完結日期</label><input type="date" id="push-end" value="'+endYmd+'">'
    +'<label>附件</label><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0">'
    +'<button type="button" class="btn green sm" onclick="document.getElementById(\'push-files\').click()">📎 添加附件</button></div>'
    +'<input type="file" id="push-files" multiple onchange="pushOnFilesPick(this)" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">'
    +'<div id="push-file-list">'+pushFileListHtml()+'</div>'
    +'<button type="button" class="btn green" onclick="confirmSendPush()">預覽並發布</button></div>';
}
function vPushLogs(){
  if(!(isAdmin()||isManager())) return '<div class="card"><h2>📜 操作記錄</h2><p>僅管理層可查看。</p></div>';
  const rows = [];
  announcementList().forEach(function(n){
    (n.logs||[]).forEach(function(l){
      rows.push({ time:l.time||'', user:l.user||l.userName||'', action:l.action||'', detail:(n.id||'')+'｜'+(l.detail||'') });
    });
  });
  (moduleLogs.push||[]).forEach(function(l){
    rows.push({ time:l.time||'', user:l.user||l.userName||'', action:l.action||'', detail:l.detail||'' });
  });
  rows.sort(function(a,b){ return String(b.time).localeCompare(String(a.time)); });
  return '<div class="card"><h2>📜 系統操作記錄（管理層）</h2>'
    +'<div class="table-wrap"><table><tr><th>時間</th><th>操作人員</th><th>操作</th><th>詳情</th></tr>'
    +(rows.length?rows.slice(0,300).map(function(l){
      return '<tr><td style="font-size:11px;white-space:nowrap">'+escHtml(l.time)+'</td><td>'+escHtml(l.user)+'</td><td><b>'+escHtml(l.action)+'</b></td><td style="font-size:12px">'+escHtml(l.detail)+'</td></tr>';
    }).join(''):'<tr><td colspan="4" style="color:#888;text-align:center">暫無記錄</td></tr>')
    +'</table></div></div>';
}
function vPushNotify(){ return vPushCreate(); }
/** 突發任務／突發（緊急）通知：登入時要強制彈出信箱內容 */
function isUrgentMailboxItem(n){
  if(!n || isTransferNotice(n)) return false;
  const cat = String(n.category||'');
  const title = String(n.title||'');
  if(n.cat==='urgent' || noticeCatKey(n)==='urgent') return true;
  if(n.priority==='緊急') return true;
  if(cat.indexOf('緊急')>=0 || cat.indexOf('突發')>=0) return true;
  if(title.indexOf('突發任務')>=0 || title.indexOf('突發工作')>=0) return true;
  return false;
}
function listUnreadUrgentMailboxItems(){
  if(!currentUser) return [];
  return sortMailboxItems(
    (notifications||[]).filter(function(n){
      return isUrgentMailboxItem(n) && isNotifUnreadForMe(n);
    }),
    true
  );
}
async function maybePromptUrgentNotices(){
  if(!currentUser || pushUrgentPrompted) return;
  const list = listUnreadUrgentMailboxItems();
  if(!list.length) return;
  pushUrgentPrompted = true;
  const first = list[0];
  // 開啟信箱並直接彈出該則完整內容
  mailboxOpen = true;
  mailboxTab = 'inbox';
  const bg = document.getElementById('mailbox-modal-bg');
  if(bg) bg.classList.remove('hidden');
  refreshMailboxUi();
  await openMailboxDetail(first.id);
  if(list.length>1){
    const titleEl = document.getElementById('mailbox-detail-title');
    if(titleEl){
      titleEl.textContent = (first.title || '突發通知') + '（尚有 '+(list.length-1)+' 則未讀突發）';
    }
  }
}

/* ═══════════ 貨品調動｜庫存查詢／調動記錄／庫存校正 ═══════════ */
const TRANSFER_STORES_FE = ['觀塘','荔枝角','灣仔','屯門'];
const TRANSFER_SIZE_PRESETS = ['S','M','L','XL','XXL','均碼'];
const TRANSFER_CATEGORY_FALLBACK = ['成人保暖衣','兒童保暖衣','成人抓毛','兒童抓毛','成人膠衣','兒童膠衣','防曬用品','游水用品','其他'];
let transferInvCache = null; // { stores, categories, rows }
let transferInvKw = '';
let transferInvCat = '全部';
let transferInvLoading = false;
let transferOrdersCache = null; // array
let transferOrdersLoading = false;
let transferHistoryExpandedId = null;
let transferAdjCache = null; // array
let transferAdjLoading = false;
let transferProductsCache = null; // array
let transferProductsLoading = false;
let transferProductChangesCache = null; // array
let transferProductChangesLoading = false;
let transferEditOriginalId = null;
/** 申請調動全頁狀態 */
let transferApplyState = {
  toStore: '觀塘',
  fromStore: '荔枝角',
  kw: '',
  selectedProductId: null,
  pickSize: '',
  pickQty: 1,
  cart: [], // { productId, productName, category, color, size, quantity, available }
  remark: ''
};
function resetTransferApplyState(keepStores){
  const toStore = keepStores ? transferApplyState.toStore : '觀塘';
  const fromStore = keepStores ? transferApplyState.fromStore : '荔枝角';
  transferApplyState = {
    toStore,
    fromStore,
    kw: '',
    selectedProductId: null,
    pickSize: '',
    pickQty: 1,
    cart: [],
    remark: ''
  };
}

async function loadTransferInventory(force){
  if(!apiEnabled || !authToken){
    transferInvCache = { stores: TRANSFER_STORES_FE.slice(), categories: [], rows: [] };
    return transferInvCache;
  }
  if(transferInvCache && !force) return transferInvCache;
  transferInvLoading = true;
  try{
    const data = await apiFetch('/api/transfer/inventory');
    transferInvCache = {
      stores: Array.isArray(data.stores) && data.stores.length ? data.stores : TRANSFER_STORES_FE.slice(),
      categories: Array.isArray(data.categories) ? data.categories : [],
      rows: Array.isArray(data.rows) ? data.rows : []
    };
  }catch(e){
    noteCloudError(e);
    transferInvCache = transferInvCache || { stores: TRANSFER_STORES_FE.slice(), categories: [], rows: [] };
    throw e;
  }finally{
    transferInvLoading = false;
  }
  return transferInvCache;
}
async function loadTransferOrders(force){
  if(!apiEnabled || !authToken){
    transferOrdersCache = [];
    return transferOrdersCache;
  }
  if(transferOrdersCache && !force) return transferOrdersCache;
  transferOrdersLoading = true;
  try{
    const data = await apiFetch('/api/transfer/orders');
    transferOrdersCache = Array.isArray(data.orders) ? data.orders : [];
  }catch(e){
    noteCloudError(e);
    transferOrdersCache = transferOrdersCache || [];
    throw e;
  }finally{
    transferOrdersLoading = false;
  }
  return transferOrdersCache;
}
function setTransferInvKw(v){ transferInvKw = String(v||''); render(); }
function setTransferInvCat(v){ transferInvCat = v||'全部'; render(); }
function refreshTransferInventory(){
  transferInvCache = null;
  loadTransferInventory(true).then(function(){ render(); }).catch(function(e){
    alert2('載入庫存失敗：'+(e.message||e));
    render();
  });
}
function refreshTransferOrders(){
  transferOrdersCache = null;
  loadTransferOrders(true).then(function(){ render(); }).catch(function(e){
    alert2('載入調動記錄失敗：'+(e.message||e));
    render();
  });
}
async function loadTransferAdjustments(force){
  if(!apiEnabled || !authToken){
    transferAdjCache = [];
    return transferAdjCache;
  }
  if(transferAdjCache && !force) return transferAdjCache;
  transferAdjLoading = true;
  try{
    const data = await apiFetch('/api/transfer/stock-adjustments');
    transferAdjCache = Array.isArray(data.adjustments) ? data.adjustments : [];
  }catch(e){
    noteCloudError(e);
    transferAdjCache = transferAdjCache || [];
    throw e;
  }finally{
    transferAdjLoading = false;
  }
  return transferAdjCache;
}
function refreshTransferAdjustments(){
  transferAdjCache = null;
  loadTransferAdjustments(true).then(function(){ render(); }).catch(function(e){
    alert2('載入庫存校正記錄失敗：'+(e.message||e));
    render();
  });
}
function findTransferInvRow(productId, size){
  const rows = (transferInvCache && transferInvCache.rows) || [];
  return rows.find(function(r){ return r.productId===productId && r.size===size; }) || null;
}
function transferStoreOptions(selected, exclude){
  return TRANSFER_STORES_FE.map(function(s){
    if(exclude && s===exclude) return '';
    return '<option value="'+escHtml(s)+'"'+(selected===s?' selected':'')+'>'+escHtml(s)+'</option>';
  }).join('');
}
function transferCategoryOptionsHtml(selected){
  const cats = ((transferInvCache && transferInvCache.categories) || TRANSFER_CATEGORY_FALLBACK).slice();
  TRANSFER_CATEGORY_FALLBACK.forEach(function(c){ if(cats.indexOf(c)<0) cats.push(c); });
  if(transferProductsCache){
    transferProductsCache.forEach(function(p){
      const c = String(p.category||'').trim();
      if(c && cats.indexOf(c)<0) cats.push(c);
    });
  }
  const sel = selected || (cats[0] || '其他');
  return cats.map(function(c){
    return '<option value="'+escHtml(c)+'"'+(c===sel?' selected':'')+'>'+escHtml(c)+'</option>';
  }).join('') + '<option value="__custom__"'+(sel==='__custom__'?' selected':'')+'>自訂類別…</option>';
}
function onTransferProductCatChange(){
  const sel = document.getElementById('tp-cat');
  const wrap = document.getElementById('tp-cat-custom-wrap');
  if(!sel || !wrap) return;
  wrap.style.display = sel.value==='__custom__' ? '' : 'none';
}
function collectTransferProductForm(){
  const id = ((document.getElementById('tp-id')||{}).value||'').trim();
  const name = ((document.getElementById('tp-name')||{}).value||'').trim();
  const catSel = (document.getElementById('tp-cat')||{}).value || '';
  const category = catSel==='__custom__'
    ? ((document.getElementById('tp-cat-custom')||{}).value||'').trim()
    : catSel.trim();
  const color = ((document.getElementById('tp-color')||{}).value||'').trim();
  const safetyStock = Number((document.getElementById('tp-safety')||{}).value);
  const sizes = [];
  document.querySelectorAll('.tp-size:checked').forEach(function(cb){
    if(cb.value) sizes.push(cb.value);
  });
  const custom = ((document.getElementById('tp-size-custom')||{}).value||'').split(/[,，、]/);
  custom.forEach(function(s){
    const t = String(s||'').trim();
    if(t && sizes.indexOf(t)<0) sizes.push(t);
  });
  return { id, name, category, color, sizes, safetyStock };
}
function validateTransferProductForm(form){
  if(!form.id){ alert2('請填寫產品編號。'); return false; }
  if(!form.name){ alert2('請填寫產品名稱。'); return false; }
  if(!form.category){ alert2('請選擇或填寫類別。'); return false; }
  if(!form.sizes.length){ alert2('請至少選擇或新增 1 個尺碼。'); return false; }
  if(!Number.isFinite(form.safetyStock) || form.safetyStock<0 || Math.floor(form.safetyStock)!==form.safetyStock){
    alert2('安全存量須為 ≥ 0 的整數。'); return false;
  }
  return true;
}
function transferProductSizeChecksHtml(selectedSizes){
  const selected = Array.isArray(selectedSizes) ? selectedSizes : [];
  const selectedSet = {};
  selected.forEach(function(s){ selectedSet[s] = true; });
  const presetHtml = TRANSFER_SIZE_PRESETS.map(function(s){
    return '<label style="display:inline-flex;align-items:center;gap:4px;margin:0 10px 6px 0;font-size:13px">'
      +'<input type="checkbox" class="tp-size" value="'+escHtml(s)+'"'+(selectedSet[s]?' checked':'')+'>'+escHtml(s)+'</label>';
  }).join('');
  const extras = selected.filter(function(s){ return TRANSFER_SIZE_PRESETS.indexOf(s)<0; });
  const extraHtml = extras.map(function(s){
    return '<label style="display:inline-flex;align-items:center;gap:4px;margin:0 10px 6px 0;font-size:13px">'
      +'<input type="checkbox" class="tp-size" value="'+escHtml(s)+'" checked>'+escHtml(s)+'</label>';
  }).join('');
  return presetHtml + extraHtml;
}
function invalidateTransferCaches(){
  transferInvCache = null;
  transferAdjCache = null;
  transferOrdersCache = null;
  transferProductsCache = null;
  transferProductChangesCache = null;
}
async function loadTransferProducts(force){
  if(!apiEnabled || !authToken){
    transferProductsCache = [];
    return transferProductsCache;
  }
  if(transferProductsCache && !force) return transferProductsCache;
  transferProductsLoading = true;
  try{
    const data = await apiFetch('/api/transfer/products');
    transferProductsCache = Array.isArray(data.products) ? data.products : [];
  }catch(e){
    noteCloudError(e);
    transferProductsCache = transferProductsCache || [];
    throw e;
  }finally{
    transferProductsLoading = false;
  }
  return transferProductsCache;
}
function refreshTransferProducts(){
  transferProductsCache = null;
  loadTransferProducts(true).then(function(){ render(); }).catch(function(e){
    alert2('載入貨品失敗：'+(e.message||e));
    render();
  });
}
async function loadTransferProductChanges(force){
  if(!apiEnabled || !authToken){
    transferProductChangesCache = [];
    return transferProductChangesCache;
  }
  if(transferProductChangesCache && !force) return transferProductChangesCache;
  transferProductChangesLoading = true;
  try{
    const data = await apiFetch('/api/transfer/product-changes');
    transferProductChangesCache = Array.isArray(data.changes) ? data.changes : [];
  }catch(e){
    noteCloudError(e);
    transferProductChangesCache = transferProductChangesCache || [];
    throw e;
  }finally{
    transferProductChangesLoading = false;
  }
  return transferProductChangesCache;
}
function refreshTransferProductChanges(){
  transferProductChangesCache = null;
  loadTransferProductChanges(true).then(function(){ render(); }).catch(function(e){
    alert2('載入主檔變更記錄失敗：'+(e.message||e));
    render();
  });
}
function openAddTransferProductModal(){
  if(!currentUser){ alert2('請先登入。'); return; }
  transferEditOriginalId = null;
  showModal(
    '<h3>新增產品</h3>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">建立主檔後，四店各尺碼庫存從 0 起算；請到「庫存查詢」按「改庫存」填入數量。</p>'
    +'<label>產品編號（款號）</label><input type="text" id="tp-id" placeholder="例如 WS-S002" maxlength="64">'
    +'<label>名稱</label><input type="text" id="tp-name" placeholder="產品名稱">'
    +'<label>類別</label><select id="tp-cat" onchange="onTransferProductCatChange()">'+transferCategoryOptionsHtml('其他')+'</select>'
    +'<div id="tp-cat-custom-wrap" style="display:none"><label>自訂類別</label><input type="text" id="tp-cat-custom" placeholder="輸入新類別"></div>'
    +'<label>顏色（可留空）</label><input type="text" id="tp-color" placeholder="例如 黑">'
    +'<label>尺碼</label><div style="margin:4px 0 8px">'+transferProductSizeChecksHtml([])+'</div>'
    +'<label>自訂尺碼（可多個，用逗號分隔）</label><input type="text" id="tp-size-custom" placeholder="例如 120, 童 L">'
    +'<label>安全存量</label><input type="number" id="tp-safety" min="0" step="1" value="0">'
    +'<div class="actions">'
    +'<button type="button" class="btn gray sm" data-action="close-modal">取消</button>'
    +'<button type="button" class="btn green" data-action="submit-transfer-product">建立產品</button>'
    +'</div>'
  );
}
async function submitTransferProduct(){
  const form = collectTransferProductForm();
  if(!validateTransferProductForm(form)) return;
  try{
    await apiFetch('/api/transfer/products', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form)
    });
    closeModal();
    invalidateTransferCaches();
    await loadTransferProducts(true);
    render();
    alert2('已建立產品 '+form.id+'，庫存均為 0，可到「庫存查詢」用「改庫存」填入數量。');
  }catch(e){
    alert2('建立失敗：'+(e.message||e));
  }
}
function openEditTransferProductModal(productId){
  if(!currentUser){ alert2('請先登入。'); return; }
  const list = transferProductsCache || [];
  const p = list.find(function(x){ return String(x.id)===String(productId); });
  if(!p){ alert2('找不到該產品，請重新整理後再試。'); return; }
  transferEditOriginalId = String(p.id);
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const cat = p.category || '其他';
  const knownCats = ((transferInvCache && transferInvCache.categories) || TRANSFER_CATEGORY_FALLBACK).slice();
  TRANSFER_CATEGORY_FALLBACK.forEach(function(c){ if(knownCats.indexOf(c)<0) knownCats.push(c); });
  const catKnown = knownCats.indexOf(cat)>=0;
  showModal(
    '<h3>編輯產品</h3>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">可改款號、名稱、類別、顏色、安全存量與尺碼。'
    +'改款號會一併更新庫存／調動／校正記錄中的編號，並先檢測新號是否已存在。'
    +'新增尺碼四店從 0；取消勾選尺碼僅在該尺碼四店皆為 0 且無待審批調動時可刪。</p>'
    +'<label>產品編號（款號）</label><input type="text" id="tp-id" value="'+escHtml(String(p.id))+'" maxlength="64">'
    +'<label>名稱</label><input type="text" id="tp-name" value="'+escHtml(p.name||'')+'">'
    +'<label>類別</label><select id="tp-cat" onchange="onTransferProductCatChange()">'
    +transferCategoryOptionsHtml(catKnown?cat:'__custom__')
    +'</select>'
    +'<div id="tp-cat-custom-wrap" style="'+(catKnown?'display:none':'')+'"><label>自訂類別</label><input type="text" id="tp-cat-custom" value="'+(catKnown?'':escHtml(cat))+'" placeholder="輸入新類別"></div>'
    +'<label>顏色（可留空）</label><input type="text" id="tp-color" value="'+escHtml(p.color||'')+'">'
    +'<label>尺碼</label><div style="margin:4px 0 8px">'+transferProductSizeChecksHtml(sizes)+'</div>'
    +'<label>自訂尺碼（可多個，用逗號分隔）</label><input type="text" id="tp-size-custom" placeholder="例如 120, 童 L">'
    +'<label>安全存量</label><input type="number" id="tp-safety" min="0" step="1" value="'+escHtml(String(p.safetyStock!=null?p.safetyStock:0))+'">'
    +'<div class="actions">'
    +'<button type="button" class="btn gray sm" data-action="close-modal">取消</button>'
    +'<button type="button" class="btn green" data-action="submit-transfer-product-edit">儲存變更</button>'
    +'</div>'
  );
  // 若用 __custom__ 選項，修正 select 實際值
  const sel = document.getElementById('tp-cat');
  if(sel && !catKnown){
    sel.value = '__custom__';
    onTransferProductCatChange();
  }
}
async function submitTransferProductEdit(){
  const originalId = transferEditOriginalId;
  if(!originalId){ alert2('找不到原產品編號。'); return; }
  const form = collectTransferProductForm();
  if(!validateTransferProductForm(form)) return;
  if(form.id!==originalId){
    if(!confirm('確認將款號由「'+originalId+'」改為「'+form.id+'」？\n系統會檢測新號是否已存在，並一併更新庫存／調動／校正記錄。')) return;
  }
  try{
    await apiFetch('/api/transfer/products/'+encodeURIComponent(originalId), {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form)
    });
    closeModal();
    transferEditOriginalId = null;
    invalidateTransferCaches();
    await loadTransferProducts(true);
    if(currentView==='transferProductLog') await loadTransferProductChanges(true).catch(function(){});
    render();
    alert2('已更新產品。');
  }catch(e){
    alert2('更新失敗：'+(e.message||e));
  }
}
function openTransferStockEditModal(productId, size){
  if(!currentUser){ alert2('請先登入。'); return; }
  const row = findTransferInvRow(productId, size);
  if(!row){ alert2('找不到該庫存列，請重新整理後再試。'); return; }
  const pidAttr = escHtml(String(productId));
  const szAttr = escHtml(String(size));
  const fields = TRANSFER_STORES_FE.map(function(s){
    const q = (row.qty && row.qty[s]!=null) ? row.qty[s] : 0;
    return '<label>'+escHtml(s)+'</label>'
      +'<input type="number" class="tf-stock-qty" data-store="'+escHtml(s)+'" min="0" step="1" value="'+escHtml(String(q))+'">';
  }).join('');
  showModal(
    '<h3>改庫存</h3>'
    +'<p style="font-size:13px;line-height:1.55;margin:0 0 10px">'
    +'<b>'+escHtml(row.productId)+'</b> '+escHtml(row.name||'')
    +'｜尺碼 <b>'+escHtml(row.size)+'</b>'
    +(row.color?'｜'+escHtml(row.color):'')
    +'<br><span style="color:#78909c;font-size:12px">一次設定此列四店數量（整數 ≥ 0）。儲存後會寫入庫存校正記錄。</span></p>'
    +fields
    +'<div class="actions">'
    +'<button type="button" class="btn gray sm" data-action="close-modal">取消</button>'
    +'<button type="button" class="btn green" data-action="submit-transfer-stock" data-pid="'+pidAttr+'" data-size="'+szAttr+'">儲存</button>'
    +'</div>'
  );
}
async function submitTransferStockEdit(productId, size){
  const qty = {};
  let ok = true;
  document.querySelectorAll('.tf-stock-qty').forEach(function(inp){
    const store = inp.getAttribute('data-store');
    const n = Number(inp.value);
    if(!store) return;
    if(!Number.isFinite(n) || n<0 || Math.floor(n)!==n){ ok = false; return; }
    qty[store] = n;
  });
  if(!ok){ alert2('各店庫存須為 ≥ 0 的整數。'); return; }
  try{
    await apiFetch('/api/transfer/inventory/qty', {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ productId, size, qty })
    });
    closeModal();
    transferInvCache = null;
    transferAdjCache = null;
    await loadTransferInventory(true);
    if(currentView==='transferStockLog') await loadTransferAdjustments(true).catch(function(){});
    render();
    alert2('已更新庫存。');
  }catch(e){
    alert2('更新失敗：'+(e.message||e));
  }
}
function openTransferApplyPage(){
  if(!currentUser){ alert2('請先登入。'); return; }
  if(!apiEnabled){ alert2('需要連接 MongoDB 雲端。'); return; }
  resetTransferApplyState(false);
  go('transferApply');
  loadTransferInventory(true).then(function(){ render(); }).catch(function(){ render(); });
}
function transferApplyFromStoreQty(productId, size, store){
  const row = findTransferInvRow(productId, size);
  if(!row || !row.qty) return 0;
  const q = row.qty[store];
  return q!=null ? Number(q) : 0;
}
function transferApplyProductGroups(fromStore){
  const rows = ((transferInvCache && transferInvCache.rows) || []).filter(function(r){
    return transferApplyFromStoreQty(r.productId, r.size, fromStore) > 0;
  });
  const map = new Map();
  rows.forEach(function(r){
    const id = String(r.productId);
    let g = map.get(id);
    if(!g){
      g = {
        productId: id,
        name: r.name || '',
        category: r.category || '',
        color: r.color || '',
        sizes: []
      };
      map.set(id, g);
    }
    g.sizes.push({
      size: String(r.size),
      available: transferApplyFromStoreQty(r.productId, r.size, fromStore)
    });
  });
  return Array.from(map.values());
}
function setTransferApplyToStore(v){
  transferApplyState.toStore = v || '';
  render();
}
function setTransferApplyFromStore(v){
  const next = v || '';
  if(next === transferApplyState.fromStore) return;
  if(transferApplyState.cart.length){
    if(!confirm('更改調動點（調出）會清空已選清單，確定？')){
      render();
      return;
    }
  }
  transferApplyState.fromStore = next;
  transferApplyState.cart = [];
  transferApplyState.selectedProductId = null;
  transferApplyState.pickSize = '';
  transferApplyState.pickQty = 1;
  render();
}
function setTransferApplyKw(v){
  transferApplyState.kw = String(v||'');
  render();
}
function setTransferApplyRemark(v){
  transferApplyState.remark = String(v||'');
}
function setTransferApplyPickSize(v){
  transferApplyState.pickSize = String(v||'');
  const g = transferApplyProductGroups(transferApplyState.fromStore).find(function(x){
    return x.productId === transferApplyState.selectedProductId;
  });
  const sz = g && g.sizes.find(function(s){ return s.size === transferApplyState.pickSize; });
  const avail = sz ? sz.available : 0;
  if(transferApplyState.pickQty > avail) transferApplyState.pickQty = Math.max(1, avail);
  render();
}
function setTransferApplyPickQty(v){
  const n = Math.floor(Number(v));
  transferApplyState.pickQty = Number.isFinite(n) && n >= 1 ? n : 1;
}
function selectTransferApplyProduct(productId){
  transferApplyState.selectedProductId = String(productId||'');
  const g = transferApplyProductGroups(transferApplyState.fromStore).find(function(x){
    return x.productId === transferApplyState.selectedProductId;
  });
  transferApplyState.pickSize = g && g.sizes.length ? g.sizes[0].size : '';
  transferApplyState.pickQty = 1;
  render();
}
function addTransferApplyCartLine(){
  const st = transferApplyState;
  if(!st.toStore || !st.fromStore){ alert2('請選擇發起點與調動點。'); return; }
  if(st.toStore === st.fromStore){ alert2('發起點與調動點不可相同。'); return; }
  if(!st.selectedProductId){ alert2('請先選擇款號。'); return; }
  if(!st.pickSize){ alert2('請選擇尺碼。'); return; }
  const qty = Math.floor(Number(st.pickQty));
  if(!Number.isFinite(qty) || qty < 1){ alert2('調動數量須為正整數。'); return; }
  const available = transferApplyFromStoreQty(st.selectedProductId, st.pickSize, st.fromStore);
  if(available < 1){ alert2('調出點此尺碼無庫存。'); return; }
  const g = transferApplyProductGroups(st.fromStore).find(function(x){ return x.productId === st.selectedProductId; });
  if(!g){ alert2('找不到該商品或調出點無貨。'); return; }
  const existing = st.cart.find(function(c){
    return c.productId === st.selectedProductId && c.size === st.pickSize;
  });
  const nextQty = existing ? existing.quantity + qty : qty;
  if(nextQty > available){
    alert2('調動點（'+st.fromStore+'）庫存不足（現有 '+available+'，已選＋本次共 '+nextQty+'）。');
    return;
  }
  if(existing){
    existing.quantity = nextQty;
    existing.available = available;
    alert2('已在清單，數量改為 '+nextQty+'。');
  }else{
    st.cart.push({
      productId: g.productId,
      productName: g.name || '',
      category: g.category || '',
      color: g.color || '',
      size: st.pickSize,
      quantity: qty,
      available: available
    });
  }
  st.pickQty = 1;
  render();
}
function removeTransferApplyCartLine(idx){
  if(idx < 0 || idx >= transferApplyState.cart.length) return;
  transferApplyState.cart.splice(idx, 1);
  render();
}
function setTransferApplyCartQty(idx, v){
  const line = transferApplyState.cart[idx];
  if(!line) return;
  const qty = Math.floor(Number(v));
  if(!Number.isFinite(qty) || qty < 1){ alert2('數量須為正整數。'); render(); return; }
  const available = transferApplyFromStoreQty(line.productId, line.size, transferApplyState.fromStore);
  if(qty > available){
    alert2('調動點庫存不足（現有 '+available+'）。');
    render();
    return;
  }
  line.quantity = qty;
  line.available = available;
  render();
}
async function submitTransferApplyCart(){
  const st = transferApplyState;
  if(!st.toStore || !st.fromStore){ alert2('請選擇發起點與調動點。'); return; }
  if(st.toStore === st.fromStore){ alert2('發起點與調動點不可相同。'); return; }
  if(!st.cart.length){ alert2('請先加入至少一項貨品。'); return; }
  // 提交前再驗一次庫存
  for(let i = 0; i < st.cart.length; i++){
    const line = st.cart[i];
    const available = transferApplyFromStoreQty(line.productId, line.size, st.fromStore);
    if(line.quantity > available){
      alert2('庫存不足：'+line.productId+' '+line.size+' 現有 '+available+'，申請 '+line.quantity);
      return;
    }
  }
  const remarkEl = document.getElementById('tf-apply-remark');
  if(remarkEl) st.remark = String(remarkEl.value || '').trim();
  try{
    const data = await apiFetch('/api/transfer/orders', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        toStore: st.toStore,
        fromStore: st.fromStore,
        remark: st.remark || '',
        items: st.cart.map(function(c){
          return { productId: c.productId, size: c.size, quantity: c.quantity };
        })
      })
    });
    resetTransferApplyState(false);
    transferOrdersCache = null;
    transferInvCache = null;
    await loadNotifications().catch(function(){});
    await loadTransferInventory(true).catch(function(){});
    go('transferInventory');
    const id = data && data.order && data.order.id ? data.order.id : '';
    alert2('已送出調動申請'+(id?'（'+id+'）':'')+'，請等待調動點人員在信箱審批。');
  }catch(e){
    alert2('申請失敗：'+(e.message||e));
  }
}
function transferOrderItems(order){
  if(!order) return [];
  if(Array.isArray(order.items) && order.items.length) return order.items;
  if(order.productId && order.size){
    return [{
      productId: order.productId,
      productName: order.productName || '',
      size: order.size,
      quantity: order.quantity
    }];
  }
  return [];
}
function vTransferApply(){
  if(!currentUser){
    return '<div class="card"><h2>申請貨品調動</h2><p>請先登入。</p></div>';
  }
  if(!apiEnabled){
    return '<div class="card"><h2>申請貨品調動</h2><p style="color:#c62828">需要連接 MongoDB 雲端。</p></div>';
  }
  if(!transferInvCache && !transferInvLoading){
    loadTransferInventory(true).then(function(){ render(); }).catch(function(){ render(); });
    return '<div class="card"><h2>申請貨品調動</h2><p style="color:#888">正在載入庫存…</p></div>';
  }
  if(transferInvLoading && !transferInvCache){
    return '<div class="card"><h2>申請貨品調動</h2><p style="color:#888">正在載入庫存…</p></div>';
  }
  const st = transferApplyState;
  const groups = transferApplyProductGroups(st.fromStore);
  const kw = st.kw.trim().toLowerCase();
  const filtered = !kw ? groups : groups.filter(function(g){
    return String(g.productId).toLowerCase().indexOf(kw)>=0
      || String(g.name||'').toLowerCase().indexOf(kw)>=0
      || String(g.color||'').toLowerCase().indexOf(kw)>=0
      || String(g.category||'').toLowerCase().indexOf(kw)>=0;
  });
  const selected = filtered.find(function(g){ return g.productId === st.selectedProductId; })
    || groups.find(function(g){ return g.productId === st.selectedProductId; })
    || null;
  const sizeOpts = selected
    ? selected.sizes.map(function(s){
        return '<option value="'+escHtml(s.size)+'"'+(st.pickSize===s.size?' selected':'')+'>'
          +escHtml(s.size)+'（庫存 '+s.available+'）</option>';
      }).join('')
    : '';
  const pickAvail = selected
    ? (selected.sizes.find(function(s){ return s.size === st.pickSize; }) || {}).available || 0
    : 0;
  const productList = !filtered.length
    ? '<p style="font-size:13px;color:#888;margin:8px 0">調出點「'+escHtml(st.fromStore||'—')+'」目前沒有可調庫存'+(kw?'（或不符合搜尋）':'')+'。</p>'
    : '<div class="tf-apply-products">'+filtered.map(function(g){
        const active = st.selectedProductId === g.productId;
        const stockHint = g.sizes.map(function(s){ return s.size+':'+s.available; }).join(' · ');
        return '<button type="button" class="tf-apply-product'+(active?' active':'')+'" data-action="tf-apply-select-product" data-pid="'+escHtml(g.productId)+'">'
          +'<b>'+escHtml(g.productId)+'</b> '+escHtml(g.name||'')
          +(g.color?' <span style="color:#78909c">'+escHtml(g.color)+'</span>':'')
          +'<br><span style="font-size:12px;color:#78909c">'+escHtml(g.category||'')+'｜'+escHtml(stockHint)+'</span>'
          +'</button>';
      }).join('')+'</div>';
  const cartHtml = !st.cart.length
    ? '<p style="font-size:13px;color:#888;margin:8px 0">尚未加入貨品。</p>'
    : '<div class="table-wrap"><table><tr><th>商品</th><th>尺碼</th><th>數量</th><th>調出庫存</th><th></th></tr>'
      + st.cart.map(function(c, idx){
          return '<tr>'
            +'<td><b>'+escHtml(c.productId)+'</b> '+escHtml(c.productName||'')+'</td>'
            +'<td>'+escHtml(c.size)+'</td>'
            +'<td><input type="number" min="1" step="1" value="'+escHtml(String(c.quantity))+'" style="width:72px" onchange="setTransferApplyCartQty('+idx+', this.value)"></td>'
            +'<td>'+escHtml(String(c.available!=null?c.available:transferApplyFromStoreQty(c.productId,c.size,st.fromStore)))+'</td>'
            +'<td><button type="button" class="btn sm gray" data-action="tf-apply-remove-cart" data-idx="'+idx+'">移除</button></td>'
            +'</tr>';
        }).join('')
      +'</table></div>';
  return '<div class="card">'
    +'<h2>申請貨品調動</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">先選發起點（調入）與調動點（調出），再點款號加入尺碼數量。一張單可多明細，整單審批。</p>'
    +'<div class="filters" style="align-items:flex-end">'
    +'<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#546e7a">發起點（調入）'
    +'<select onchange="setTransferApplyToStore(this.value)">'+transferStoreOptions(st.toStore)+'</select></label>'
    +'<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#546e7a">調動點（調出）'
    +'<select onchange="setTransferApplyFromStore(this.value)">'+transferStoreOptions(st.fromStore)+'</select></label>'
    +'<button type="button" class="btn gray sm" data-call="go" data-arg0="transferInventory">返回庫存</button>'
    +'</div>'
    +'</div>'
    +'<div class="card">'
    +'<h3 style="margin:0 0 8px;font-size:16px">選貨</h3>'
    +'<div class="filters">'
    +'<input type="text" placeholder="搜尋編號／名稱／顏色" value="'+escHtml(st.kw)+'" onchange="setTransferApplyKw(this.value)" onkeydown="if(event.key===\'Enter\'){setTransferApplyKw(this.value)}">'
    +'</div>'
    +productList
    +(selected
      ? '<div class="tf-apply-pick">'
        +'<div style="font-size:13px;margin-bottom:8px">已選：<b>'+escHtml(selected.productId)+'</b> '+escHtml(selected.name||'')+'</div>'
        +'<label>尺碼</label><select onchange="setTransferApplyPickSize(this.value)">'+sizeOpts+'</select>'
        +'<label>數量（調出點現有 '+pickAvail+'）</label>'
        +'<input type="number" min="1" step="1" max="'+pickAvail+'" value="'+escHtml(String(st.pickQty))+'" onchange="setTransferApplyPickQty(this.value)" oninput="setTransferApplyPickQty(this.value)">'
        +'<div class="actions" style="margin-top:10px">'
        +'<button type="button" class="btn green sm" data-action="tf-apply-add-cart">加入已選清單</button>'
        +'</div></div>'
      : '')
    +'</div>'
    +'<div class="card">'
    +'<h3 style="margin:0 0 8px;font-size:16px">已選清單（'+st.cart.length+'）</h3>'
    +cartHtml
    +'<label style="margin-top:12px;display:block">備註（選填）</label>'
    +'<textarea id="tf-apply-remark" rows="2" placeholder="例：急補、客人訂、活動" onchange="setTransferApplyRemark(this.value)">'+escHtml(st.remark)+'</textarea>'
    +'<div class="actions" style="margin-top:12px">'
    +'<button type="button" class="btn gray sm" data-call="go" data-arg0="transferInventory">取消</button>'
    +'<button type="button" class="btn green" data-action="submit-transfer-apply-cart"'+(st.cart.length?'':' disabled')+'>申請調動</button>'
    +'</div>'
    +'<p style="font-size:12px;color:#666;margin:10px 0 0;line-height:1.5">送出後會通知調動點相關人員信箱審批；通過後立即扣出／調入。不可審批自己的申請。</p>'
    +'</div>';
}
function transferStatusLabel(st){
  if(st==='pending') return '<span class="tf-status-pending">待審批</span>';
  if(st==='approved') return '<span class="tf-status-approved">已通過</span>';
  if(st==='rejected') return '<span class="tf-status-rejected">已拒絕</span>';
  return escHtml(st||'—');
}
function toggleTransferHistoryExpand(id){
  transferHistoryExpandedId = (transferHistoryExpandedId===id) ? null : id;
  render();
}
function vTransferInventory(){
  if(!currentUser){
    return '<div class="card"><h2>📦 庫存查詢</h2><p>請先登入。</p></div>';
  }
  if(!apiEnabled){
    return '<div class="card"><h2>📦 庫存查詢</h2><p style="color:#c62828">需要連接 MongoDB 雲端才能查看庫存。</p></div>';
  }
  if(!transferInvCache && !transferInvLoading){
    loadTransferInventory(true).then(function(){ render(); }).catch(function(){ render(); });
    return '<div class="card"><h2>📦 庫存查詢</h2><p style="color:#888">正在載入庫存…</p></div>';
  }
  if(transferInvLoading && !transferInvCache){
    return '<div class="card"><h2>📦 庫存查詢</h2><p style="color:#888">正在載入庫存…</p></div>';
  }
  const data = transferInvCache || { stores: TRANSFER_STORES_FE, categories: [], rows: [] };
  const stores = data.stores;
  const cats = data.categories || [];
  const kw = transferInvKw.trim().toLowerCase();
  let rows = data.rows || [];
  if(transferInvCat && transferInvCat!=='全部'){
    rows = rows.filter(function(r){ return r.category===transferInvCat; });
  }
  if(kw){
    rows = rows.filter(function(r){
      return String(r.productId||'').toLowerCase().indexOf(kw)>=0
        || String(r.name||'').toLowerCase().indexOf(kw)>=0
        || String(r.color||'').toLowerCase().indexOf(kw)>=0;
    });
  }
  const lowCount = rows.filter(function(r){
    return stores.some(function(s){ return r.low && r.low[s]; });
  }).length;
  const catOpts = ['全部'].concat(cats).map(function(c){
    return '<option value="'+escHtml(c)+'"'+(transferInvCat===c?' selected':'')+'>'+escHtml(c)+'</option>';
  }).join('');
  const head = '<tr><th>產品編號</th><th>名稱</th><th>類別</th><th>顏色</th><th>尺碼</th><th>安全存量</th>'
    + stores.map(function(s){ return '<th>'+escHtml(s)+'</th>'; }).join('')
    + '<th>合計</th><th></th></tr>';
  const colSpan = 8 + stores.length;
  const body = !rows.length
    ? '<tr><td colspan="'+colSpan+'" style="color:#888;text-align:center">沒有符合條件的庫存列。</td></tr>'
    : rows.map(function(r){
      const cells = stores.map(function(s){
        const q = (r.qty && r.qty[s]!=null) ? r.qty[s] : 0;
        const isLow = !!(r.low && r.low[s]);
        return '<td class="'+(isLow?'inv-low':'inv-ok')+'">'+q+'</td>';
      }).join('');
      return '<tr>'
        +'<td><b>'+escHtml(r.productId)+'</b></td>'
        +'<td>'+escHtml(r.name)+'</td>'
        +'<td>'+escHtml(r.category)+'</td>'
        +'<td>'+escHtml(r.color||'—')+'</td>'
        +'<td>'+escHtml(r.size)+'</td>'
        +'<td>'+escHtml(String(r.safetyStock))+'</td>'
        +cells
        +'<td><b>'+(r.total!=null?r.total:0)+'</b></td>'
        +'<td><button type="button" class="btn sm gray" data-call="openTransferStockEditModal" data-arg0="'+escHtml(String(r.productId))+'" data-arg1="'+escHtml(String(r.size))+'">改庫存</button></td>'
        +'</tr>';
    }).join('');
  return '<div class="card">'
    +'<h2>📦 庫存查詢</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">四間港店（觀塘／荔枝角／灣仔／屯門）· 一列＝款號＋尺碼。'
    +'按「申請調動」可一次選多項；列上「改庫存」可手改四店數量。低於安全存量以<span class="inv-low">紅色</span>標示。篩選列中有 <b>'+lowCount+'</b> 列含預警。</p>'
    +'<div class="filters">'
    +'<input type="text" placeholder="搜尋編號／名稱／顏色" value="'+escHtml(transferInvKw)+'" onchange="setTransferInvKw(this.value)" onkeydown="if(event.key===\'Enter\'){setTransferInvKw(this.value)}">'
    +'<select onchange="setTransferInvCat(this.value)">'+catOpts+'</select>'
    +'<button type="button" class="btn gray sm" data-call="refreshTransferInventory">重新整理</button>'
    +'<button type="button" class="btn green sm" data-call="openTransferApplyPage">申請調動</button>'
    +'</div>'
    +'<p style="font-size:12px;color:#888;margin:8px 0 0">共 '+rows.length+' 列 · 新增／編輯產品請到「貨品」</p>'
    +'</div>'
    +'<div class="card"><div class="table-wrap"><table>'+head+body+'</table></div></div>';
}
function vTransferProducts(){
  if(!currentUser){
    return '<div class="card"><h2>🏷️ 貨品</h2><p>請先登入。</p></div>';
  }
  if(!apiEnabled){
    return '<div class="card"><h2>🏷️ 貨品</h2><p style="color:#c62828">需要連接 MongoDB 雲端。</p></div>';
  }
  if(!transferProductsCache && !transferProductsLoading){
    loadTransferProducts(true).then(function(){ render(); }).catch(function(){ render(); });
    return '<div class="card"><h2>🏷️ 貨品</h2><p style="color:#888">正在載入…</p></div>';
  }
  if(transferProductsLoading && !transferProductsCache){
    return '<div class="card"><h2>🏷️ 貨品</h2><p style="color:#888">正在載入…</p></div>';
  }
  const products = transferProductsCache || [];
  const head = '<tr><th>產品編號</th><th>名稱</th><th>類別</th><th>顏色</th><th>尺碼</th><th>安全存量</th><th></th></tr>';
  const body = !products.length
    ? '<tr><td colspan="7" style="color:#888;text-align:center">尚未有產品，請按「新增產品」。</td></tr>'
    : products.map(function(p){
      const sizes = Array.isArray(p.sizes) ? p.sizes.join('／') : '—';
      return '<tr>'
        +'<td><b>'+escHtml(p.id)+'</b></td>'
        +'<td>'+escHtml(p.name||'')+'</td>'
        +'<td>'+escHtml(p.category||'')+'</td>'
        +'<td>'+escHtml(p.color||'—')+'</td>'
        +'<td>'+escHtml(sizes)+'</td>'
        +'<td>'+escHtml(String(p.safetyStock!=null?p.safetyStock:0))+'</td>'
        +'<td><button type="button" class="btn sm" data-call="openEditTransferProductModal" data-arg0="'+escHtml(String(p.id))+'">編輯</button></td>'
        +'</tr>';
    }).join('');
  return '<div class="card">'
    +'<h2>🏷️ 貨品</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">一列一款主檔。可新增或編輯款號／名稱／類別／顏色／尺碼／安全存量；庫存數量請在「庫存查詢」調整。</p>'
    +'<div class="filters">'
    +'<button type="button" class="btn green sm" data-call="openAddTransferProductModal">＋ 新增產品</button>'
    +'<button type="button" class="btn gray sm" data-call="refreshTransferProducts">重新整理</button>'
    +'</div>'
    +'<p style="font-size:12px;color:#888;margin:8px 0 0">共 '+products.length+' 款</p>'
    +'</div>'
    +'<div class="card"><div class="table-wrap"><table>'+head+body+'</table></div></div>';
}
function vTransferProductLog(){
  if(!currentUser){
    return '<div class="card"><h2>📑 主檔變更記錄</h2><p>請先登入。</p></div>';
  }
  if(!apiEnabled){
    return '<div class="card"><h2>📑 主檔變更記錄</h2><p style="color:#c62828">需要連接 MongoDB 雲端。</p></div>';
  }
  if(!transferProductChangesCache && !transferProductChangesLoading){
    loadTransferProductChanges(true).then(function(){ render(); }).catch(function(){ render(); });
    return '<div class="card"><h2>📑 主檔變更記錄</h2><p style="color:#888">正在載入…</p></div>';
  }
  if(transferProductChangesLoading && !transferProductChangesCache){
    return '<div class="card"><h2>📑 主檔變更記錄</h2><p style="color:#888">正在載入…</p></div>';
  }
  const rows = transferProductChangesCache || [];
  const head = '<tr><th>時間</th><th>操作人</th><th>動作</th><th>商品</th><th>變更明細</th></tr>';
  const body = !rows.length
    ? '<tr><td colspan="5" style="color:#888;text-align:center">尚無主檔變更記錄。</td></tr>'
    : rows.map(function(r){
      const changes = Array.isArray(r.changes) ? r.changes : [];
      const detail = changes.length
        ? changes.map(function(c){
            return '<div><b>'+escHtml(c.field||'')+'</b>：'
              +escHtml(String(c.before==null||c.before===''?'—':c.before))
              +' → '+escHtml(String(c.after==null||c.after===''?'—':c.after))+'</div>';
          }).join('')
        : '—';
      return '<tr>'
        +'<td style="white-space:nowrap;font-size:12px">'+escHtml(r.createdAt||'')+'</td>'
        +'<td>'+escHtml(r.createdByName||r.createdBy||'')+'</td>'
        +'<td>'+escHtml(r.action||'編輯')+'</td>'
        +'<td><b>'+escHtml(r.productId||'')+'</b> '+escHtml(r.productName||'')+'</td>'
        +'<td style="font-size:12px;line-height:1.55">'+detail+'</td>'
        +'</tr>';
    }).join('');
  return '<div class="card">'
    +'<h2>📑 主檔變更記錄</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">建立／編輯貨品主檔的痕跡（含改款號、增刪尺碼）。所有已登入可查看。</p>'
    +'<div class="filters"><button type="button" class="btn gray sm" data-call="refreshTransferProductChanges">重新整理</button></div>'
    +'<p style="font-size:12px;color:#888;margin:8px 0 0">共 '+rows.length+' 筆</p>'
    +'</div>'
    +'<div class="card"><div class="table-wrap"><table>'+head+body+'</table></div></div>';
}
function vTransferHistory(){
  if(!currentUser){
    return '<div class="card"><h2>📋 調動記錄</h2><p>請先登入。</p></div>';
  }
  if(!apiEnabled){
    return '<div class="card"><h2>📋 調動記錄</h2><p style="color:#c62828">需要連接 MongoDB 雲端。</p></div>';
  }
  if(!transferOrdersCache && !transferOrdersLoading){
    loadTransferOrders(true).then(function(){ render(); }).catch(function(){ render(); });
    return '<div class="card"><h2>📋 調動記錄</h2><p style="color:#888">正在載入…</p></div>';
  }
  if(transferOrdersLoading && !transferOrdersCache){
    return '<div class="card"><h2>📋 調動記錄</h2><p style="color:#888">正在載入…</p></div>';
  }
  const orders = transferOrdersCache || [];
  const colCount = 11;
  const head = '<tr><th>單號</th><th>時間</th><th>明細</th><th>合計</th><th>發起點（調入）</th><th>調動點（調出）</th><th>申請人</th><th>狀態</th><th>通過人／拒絕人</th><th>審批時間</th><th></th></tr>';
  const body = !orders.length
    ? '<tr><td colspan="'+colCount+'" style="color:#888;text-align:center">尚無調動記錄。</td></tr>'
    : orders.map(function(o){
      const expanded = transferHistoryExpandedId===o.id;
      const items = transferOrderItems(o);
      const itemsHtml = items.length
        ? items.map(function(it){
            return '<div><b>'+escHtml(it.productId)+'</b> '+escHtml(it.productName||'')
              +'｜'+escHtml(it.size)+' × '+escHtml(String(it.quantity))+'</div>';
          }).join('')
        : '<div>'+escHtml(o.productId||'')+' '+escHtml(o.productName||'')+'</div>';
      const totalQty = items.length
        ? items.reduce(function(s, it){ return s + (Number(it.quantity)||0); }, 0)
        : (o.quantity!=null ? o.quantity : 0);
      const remarkHtml = o.remark ? '<div style="margin-top:4px;color:#78909c;font-size:12px">備註：'+escHtml(o.remark)+'</div>' : '';
      const logs = Array.isArray(o.logs)?o.logs:[];
      const logHtml = logs.length
        ? '<ul class="tf-logs">'+logs.map(function(l){
            return '<li><b>'+escHtml(l.time||'')+'</b> '+escHtml(l.userName||'')+'｜'+escHtml(l.action||'')
              +(l.detail?' — '+escHtml(l.detail):'')+'</li>';
          }).join('')+'</ul>'
        : '<p style="font-size:12px;color:#888;margin:8px 0 0">無操作時間軸。</p>';
      const decided = o.status==='approved' || o.status==='rejected';
      const decidedName = decided ? (o.decidedByName || o.decidedBy || '—') : '—';
      const decidedAt = decided ? (o.decidedAt || '—') : '—';
      return '<tr>'
        +'<td><b>'+escHtml(o.id)+'</b></td>'
        +'<td style="white-space:nowrap;font-size:12px">'+escHtml(o.createdAt||'')+'</td>'
        +'<td style="font-size:12px;line-height:1.5">'+itemsHtml+remarkHtml+'</td>'
        +'<td>'+escHtml(String(totalQty))+(items.length>1?' <span style="color:#90a4ae;font-size:11px">('+items.length+'行)</span>':'')+'</td>'
        +'<td>'+escHtml(o.toStore)+'</td>'
        +'<td>'+escHtml(o.fromStore)+'</td>'
        +'<td>'+escHtml(o.createdByName||'')+'</td>'
        +'<td>'+transferStatusLabel(o.status)+'</td>'
        +'<td>'+escHtml(decidedName)+'</td>'
        +'<td style="white-space:nowrap;font-size:12px">'+escHtml(decidedAt)+'</td>'
        +'<td><button type="button" class="btn sm gray" data-action="toggle-transfer-timeline" data-tid="'+escHtml(String(o.id))+'">'+(expanded?'收合':'時間軸')+'</button></td>'
        +'</tr>'
        +(expanded?'<tr><td colspan="'+colCount+'" style="background:#fafafa">'+logHtml+'</td></tr>':'');
    }).join('');
  return '<div class="card">'
    +'<h2>📋 調動記錄</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">所有已登入人員可查看全部調動單與操作時間軸（申請／通過／拒絕）。</p>'
    +'<div class="filters"><button type="button" class="btn gray sm" data-call="refreshTransferOrders">重新整理</button></div>'
    +'<p style="font-size:12px;color:#888;margin:8px 0 0">共 '+orders.length+' 筆</p>'
    +'</div>'
    +'<div class="card"><div class="table-wrap"><table>'+head+body+'</table></div></div>';
}
function vTransferStockLog(){
  if(!currentUser){
    return '<div class="card"><h2>📝 庫存校正記錄</h2><p>請先登入。</p></div>';
  }
  if(!apiEnabled){
    return '<div class="card"><h2>📝 庫存校正記錄</h2><p style="color:#c62828">需要連接 MongoDB 雲端。</p></div>';
  }
  if(!transferAdjCache && !transferAdjLoading){
    loadTransferAdjustments(true).then(function(){ render(); }).catch(function(){ render(); });
    return '<div class="card"><h2>📝 庫存校正記錄</h2><p style="color:#888">正在載入…</p></div>';
  }
  if(transferAdjLoading && !transferAdjCache){
    return '<div class="card"><h2>📝 庫存校正記錄</h2><p style="color:#888">正在載入…</p></div>';
  }
  const rows = transferAdjCache || [];
  const head = '<tr><th>時間</th><th>類型</th><th>操作人</th><th>商品</th><th>尺碼</th><th>變更明細</th></tr>';
  const body = !rows.length
    ? '<tr><td colspan="6" style="color:#888;text-align:center">尚無庫存校正記錄。</td></tr>'
    : rows.map(function(a){
      const detail = TRANSFER_STORES_FE.map(function(s){
        const b = a.before && a.before[s]!=null ? a.before[s] : '—';
        const n = a.after && a.after[s]!=null ? a.after[s] : '—';
        if(String(b)===String(n)) return '<span style="color:#90a4ae">'+escHtml(s)+' '+escHtml(String(b))+'</span>';
        return '<b>'+escHtml(s)+' '+escHtml(String(b))+'→'+escHtml(String(n))+'</b>';
      }).join(' ｜ ');
      const typ = a.reason || a.type || '庫存校正';
      const typExtra = a.posOrderNo ? ('｜'+a.posOrderNo) : '';
      return '<tr>'
        +'<td style="white-space:nowrap;font-size:12px">'+escHtml(a.createdAt||'')+'</td>'
        +'<td style="font-size:12px">'+escHtml(typ+typExtra)+'</td>'
        +'<td>'+escHtml(a.createdByName||a.createdBy||'')+'</td>'
        +'<td><b>'+escHtml(a.productId||'')+'</b> '+escHtml(a.productName||'')+'</td>'
        +'<td>'+escHtml(a.size||'')+'</td>'
        +'<td style="font-size:12px;line-height:1.55">'+detail+'</td>'
        +'</tr>';
    }).join('');
  return '<div class="card">'
    +'<h2>📝 庫存校正記錄</h2>'
    +'<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">手改庫存、<b>POS 銷售</b> 出庫、<b>POS 退貨</b> 回庫與 <b>POS 換貨</b>（回庫／出庫）痕跡：誰、何時、各店舊→新。所有已登入可查看。</p>'
    +'<div class="filters"><button type="button" class="btn gray sm" data-call="refreshTransferAdjustments">重新整理</button></div>'
    +'<p style="font-size:12px;color:#888;margin:8px 0 0">共 '+rows.length+' 筆</p>'
    +'</div>'
    +'<div class="card"><div class="table-wrap"><table>'+head+body+'</table></div></div>';
}

/* ═══════════ 個人設置（更改密碼） ═══════════ */
function vPersonalSettings(){
  if(!currentUser){
    return '<div class="card"><h2>⚙️ 個人設置</h2><p>請先登入。</p></div>';
  }
  const u = currentUser;
  const account = u.phone || u.login || u.id || '—';
  const units = (typeof userUnits==='function' ? userUnits(u) : (u.units||[])).join('、') || '—';
  // 與後端 canCreateEmployee 對齊：系統管理員／經理／主管
  const showDriveExport = !!(isAdmin() || isManager() || u.role==='system_admin' || u.role==='manager' || u.position==='經理' || u.position==='主管');
  return `<div class="card">
    <h2>⚙️ 個人設置</h2>
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <tr><th style="width:120px">登入帳號</th><td>${escHtml(account)}</td></tr>
        <tr><th>姓名</th><td>${escHtml(u.name||'—')}</td></tr>
        <tr><th>職位</th><td>${escHtml(u.position||roleLabel(u))}</td></tr>
        <tr><th>地區／單位</th><td>${escHtml(units)}</td></tr>
      </table>
    </div>
  </div>
  <div class="card">
    <h2>🔑 更改密碼</h2>
    <p style="font-size:13px;color:#666;margin-bottom:10px">更改後請用新密碼登入。員工初始密碼多為電話末四位，建議首次登入後修改。</p>
    <label>目前密碼</label>
    <input type="password" id="set-pw-current" autocomplete="current-password" placeholder="輸入目前密碼">
    <label>新密碼</label>
    <input type="password" id="set-pw-new" autocomplete="new-password" placeholder="至少 4 個字元">
    <label>確認新密碼</label>
    <input type="password" id="set-pw-confirm" autocomplete="new-password" placeholder="再輸入一次新密碼">
    <div class="actions" style="margin-top:12px">
      <button type="button" class="btn" onclick="submitChangePassword()">儲存新密碼</button>
    </div>
  </div>`
  + (showDriveExport
    ? `<div class="card">
    <h2>☁ Google Drive 匯出</h2>
    <p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">將目前系統的用戶公開資料（不含密碼）寫入 Drive 的 <b>users.json</b>。<br>
    若出現 400／配額錯誤：請在 Railway 新增變數 <code>GOOGLE_DRIVE_USERS_FILE_ID</code>＝檔案 ID（網址 <code>/d/</code> 與 <code>/view</code> 中間那串），再重試。</p>
    <div class="actions">
      <button type="button" class="btn green sm" data-call="exportUsersToGoogleDrive">匯出用戶到 Drive</button>
    </div>
  </div>`
    : '');
}
async function exportUsersToGoogleDrive(){
  if(!currentUser){ alert2('請先登入。'); return; }
  if(!requireCloud('匯出用戶到 Drive')) return;
  if(!confirm('確定將用戶資料匯出到 Google Drive（users.json）？')) return;
  try{
    const data = await apiFetch('/api/drive/export-users', { method:'POST' });
    alert2('已匯出 '+(data.count!=null?data.count:'')+' 名用戶到 Drive（'+(data.fileName||'users.json')+'）。');
  }catch(e){
    alert2('匯出失敗：'+(e.message||e));
  }
}
async function submitChangePassword(){
  if(!currentUser){ alert2('請先登入。'); return; }
  if(!requireCloud('更改密碼')) return;
  const currentPw = ((document.getElementById('set-pw-current')||{}).value||'');
  const newPw = ((document.getElementById('set-pw-new')||{}).value||'');
  const confirmPw = ((document.getElementById('set-pw-confirm')||{}).value||'');
  if(!currentPw){ alert2('請輸入目前密碼。'); return; }
  if(newPw.length < 4){ alert2('新密碼至少 4 個字元。'); return; }
  if(newPw !== confirmPw){ alert2('兩次輸入的新密碼不一致。'); return; }
  if(newPw === currentPw){ alert2('新密碼不可與目前密碼相同。'); return; }
  try{
    await apiFetch('/api/auth/change-password', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ currentPw, newPw, confirmPw })
    });
    const local = users.find(function(x){ return x && x.id === currentUser.id; });
    if(local){ local.pw = newPw; saveUsersLocal(); }
    try{ addModuleLog('push','更改密碼', currentUser.login || currentUser.id || ''); }catch(e){}
    ['set-pw-current','set-pw-new','set-pw-confirm'].forEach(function(id){
      const el = document.getElementById(id); if(el) el.value = '';
    });
    alert2('密碼已更新。下次請用新密碼登入。');
  }catch(e){
    alert2('更改密碼失敗：'+(e.message||e));
  }
}

/* ═══════════ 創建員工（電話 = 主鍵／登入） ═══════════ */
function passwordFromLogin(login){
  const phone = normalizePhone(login);
  if(phone) return passwordFromPhone(phone);
  const s = String(login||'');
  return s.length>=4 ? s.slice(-4) : '';
}
function staffListRowsHtml(){
  ensureAdminUser();
  return users.map(function(u){
    const sys = u.login==='admin' ? ' <span class="tag dept">系統帳</span>' : '';
    const units = userUnits(u);
    const phone = normalizePhone(u.phone) || normalizePhone(u.id) || '';
    const account = phone || u.login || u.id || '';
    const need = userNeedsPhoneBind(u);
    let actions = '—';
    if(u.login!=='admin' && canCreateEmployee()){
      if(need){
        actions = '<button class="btn sm" data-call="promptAssignPhone" data-arg0="'+escHtml(String(u.id))+'">補登電話</button>';
      } else if(phone){
        actions = '<button class="btn sm gray" data-call="promptChangePhone" data-arg0="'+escHtml(String(phone))+'">更換電話</button>';
      }
    }
    return '<tr>'+
      '<td>'+escHtml(account)+sys+(need?' <span class="tag s-fix">待補電話</span>':'')+'</td>'+
      '<td>'+escHtml(u.name||'')+'</td>'+
      '<td>'+escHtml(u.position||roleLabel(u))+'</td>'+
      '<td>'+escHtml(units.length?units.join('、'):'—')+'</td>'+
      '<td>'+(u.active===false?'停用':'啟用')+'</td>'+
      '<td>'+actions+'</td>'+
      '</tr>';
  }).join('');
}
function vCreateStaff(){
  if(!canCreateEmployee()){
    return '<div class="card"><h2>👤 創建員工</h2><p>只有經理／主管／系統管理員可以創建員工。</p></div>';
  }
  const regionChecks = STAFF_REGIONS.map(function(r){
    return '<label class="rc-item"><input type="checkbox" class="staff-region" value="'+r+'"> '+r+'</label>';
  }).join('');
  const pending = users.filter(userNeedsPhoneBind);
  const pendingBox = pending.length
    ? `<div class="card" style="border-left:4px solid #ef6c00">
        <h3>⚠ 待補登電話（${pending.length}）</h3>
        <p style="font-size:13px;color:#666;margin-bottom:8px">舊賬號必須補上香港 8 位電話後，才能以電話登入；補登後密碼改為電話末四位，並自動改寫項目經手人等關聯。</p>
        <div class="table-wrap"><table>
          <thead><tr><th>舊賬號</th><th>名稱</th><th>操作</th></tr></thead>
          <tbody>${pending.map(function(u){
            return '<tr><td>'+escHtml(u.login||u.id)+'</td><td>'+escHtml(u.name||'')+'</td>'+
              '<td><button class="btn sm" data-call="promptAssignPhone" data-arg0="'+escHtml(String(u.id))+'">補登電話</button></td></tr>';
          }).join('')}</tbody>
        </table></div>
      </div>`
    : '';
  return pendingBox+`<div class="card">
    <h2>👤 創建員工</h2>
    <p style="font-size:13px;color:#666;margin-bottom:8px">以<strong>香港 8 位電話</strong>為登入 ID；初始密碼自動為電話最後四位。系統帳 admin 除外。</p>
    <label>電話號碼（必填）</label>
    <input type="tel" id="staff-phone" placeholder="例如 91234567" autocomplete="off" oninput="staffPreviewPw()">
    <label>顯示名稱（選填）</label>
    <input type="text" id="staff-name" placeholder="留空則使用電話號碼">
    <label>初始密碼（自動＝電話末四位）</label>
    <input type="text" id="staff-pw-preview" value="" readonly style="background:#f5f5f5;color:#555">
    <p id="staff-pw-hint" style="font-size:12px;color:#888;margin:4px 0 0">輸入 8 位電話後顯示密碼。</p>
    <label>職位</label>
    <select id="staff-position">
      <option value="經理">經理（等同管理員權限，可創建員工）</option>
      <option value="主管">主管（第一版權限與經理相同）</option>
      <option value="員工" selected>員工</option>
    </select>
    <label>隸屬地區（可多選；員工至少選 1 個，經理／主管可不選）</label>
    <div class="recipient-box" style="max-height:180px">${regionChecks}</div>
    <button type="button" class="btn green" onclick="submitCreateStaff()">建立員工</button>
  </div>
  <div class="card">
    <h3>員工列表</h3>
    <p style="font-size:12px;color:#888;margin-bottom:8px">電話即為 ID。可補登／更換電話（管理員）。</p>
    <div class="table-wrap"><table>
      <thead><tr><th>電話／賬號</th><th>顯示名稱</th><th>職位</th><th>地區</th><th>狀態</th><th>操作</th></tr></thead>
      <tbody id="staff-list-body">${staffListRowsHtml()}</tbody>
    </table></div>
  </div>`;
}
function staffPreviewPw(){
  const raw = ((document.getElementById('staff-phone')||document.getElementById('staff-login')||{}).value||'').trim();
  const phone = normalizePhone(raw);
  const pwEl = document.getElementById('staff-pw-preview');
  const hint = document.getElementById('staff-pw-hint');
  const pw = passwordFromPhone(phone);
  if(pwEl) pwEl.value = pw || '';
  if(hint){
    if(raw && !phone){
      hint.textContent = '請輸入有效的香港 8 位電話（可含 +852）。';
      hint.style.color = '#c62828';
    } else {
      hint.textContent = pw ? ('初始密碼將為：'+pw) : '輸入電話後顯示末四位。';
      hint.style.color = '#888';
    }
  }
}
function selectedStaffRegions(){
  return Array.from(document.querySelectorAll('.staff-region:checked')).map(function(cb){ return cb.value; })
    .filter(function(x,i,a){ return STAFF_REGIONS.indexOf(x)>=0 && a.indexOf(x)===i; });
}
function promptAssignPhone(userId){
  const u = users.find(function(x){ return String(x.id)===String(userId); });
  const prefill = u ? (normalizePhone(u.phone)||normalizePhone(u.login)||'') : '';
  showModal(`<h3>補登／遷移電話主鍵</h3>
    <p style="font-size:13px;color:#666">舊 ID：<b>${escHtml(userId)}</b>${u&&u.login?'（login：'+escHtml(u.login)+'）':''}。確認後主鍵改為電話，密碼改為末四位，並改寫經手人關聯。</p>
    <label>香港 8 位電話</label>
    <input type="tel" id="assign-phone-input" placeholder="91234567" value="${escHtml(prefill)}">
    <div class="actions">
      <button class="btn gray sm" onclick="closeModal()">取消</button>
      <button class="btn sm" data-call="submitAssignPhone" data-arg0="${escHtml(String(userId))}">確認補登</button>
    </div>`);
}
async function submitAssignPhone(userId){
  const phone = ((document.getElementById('assign-phone-input')||{}).value||'').trim();
  if(!normalizePhone(phone)){ alert2('請輸入有效的香港 8 位電話。'); return; }
  try{
    const res = await apiFetch('/api/users/'+encodeURIComponent(userId)+'/assign-phone', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone })
    });
    await loadCloudAppData();
    closeModal();
    alert2('已補登電話 '+normalizePhone(phone)+'，密碼為末四位。');
    if(currentView==='createStaff') render();
    else if(res && res.user){ /* ok */ }
  }catch(e){ alert2('補登失敗：'+(e.message||e)); }
}
function promptChangePhone(oldPhone){
  showModal(`<h3>更換電話</h3>
    <p style="font-size:13px;color:#666">目前電話：<b>${escHtml(oldPhone)}</b>。更換後密碼改為新電話末四位，並改寫全庫關聯。</p>
    <label>新電話（8 位）</label>
    <input type="tel" id="change-phone-input" placeholder="91234567">
    <div class="actions">
      <button class="btn gray sm" onclick="closeModal()">取消</button>
      <button class="btn sm" data-call="submitChangePhone" data-arg0="${escHtml(String(oldPhone))}">確認更換</button>
    </div>`);
}
async function submitChangePhone(oldPhone){
  const phone = ((document.getElementById('change-phone-input')||{}).value||'').trim();
  if(!normalizePhone(phone)){ alert2('請輸入有效的新電話。'); return; }
  try{
    await apiFetch('/api/users/'+encodeURIComponent(oldPhone)+'/change-phone', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone })
    });
    await loadCloudAppData();
    closeModal();
    alert2('已更換為 '+normalizePhone(phone)+'。');
    if(currentView==='createStaff') render();
  }catch(e){ alert2('更換失敗：'+(e.message||e)); }
}
function showBindPhoneGate(){
  showModal(`<h3>請綁定電話號碼</h3>
    <p style="font-size:13px;color:#666;line-height:1.6">此為舊賬號，必須綁定香港 8 位電話後才能使用系統。綁定後請用<strong>電話 + 末四位密碼</strong>登入。</p>
    <label>電話號碼</label>
    <input type="tel" id="bind-phone-input" placeholder="91234567">
    <div class="actions">
      <button class="btn gray sm" onclick="logout()">登出</button>
      <button class="btn sm" onclick="submitBindPhone()">確認綁定</button>
    </div>`);
}
async function submitBindPhone(){
  const phone = ((document.getElementById('bind-phone-input')||{}).value||'').trim();
  if(!normalizePhone(phone)){ alert2('請輸入有效的香港 8 位電話。'); return; }
  try{
    const res = await apiFetch('/api/auth/bind-phone', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone })
    });
    if(res && res.user){
      currentUser = normalizeUser(res.user);
      await loadCloudAppData();
      closeModal();
      alert2('已綁定電話。之後請用電話 '+normalizePhone(phone)+' 與末四位密碼登入。');
      enterAppAs(currentUser, { silent:true });
    }
  }catch(e){ alert2('綁定失敗：'+(e.message||e)); }
}
async function submitCreateStaff(){
  if(!canCreateEmployee()){ alert2('沒有權限創建員工。'); return; }
  if(!requireCloud('創建員工')) return;
  if(!authToken){ alert2('請先登入後再創建員工。'); return; }
  const phoneRaw = ((document.getElementById('staff-phone')||{}).value||'').trim();
  const phone = normalizePhone(phoneRaw);
  let name = ((document.getElementById('staff-name')||{}).value||'').trim();
  const position = ((document.getElementById('staff-position')||{}).value||'員工').trim();
  const regions = selectedStaffRegions();
  if(!phone){ alert2('請輸入有效的香港 8 位電話號碼。'); return; }
  if(['經理','主管','員工'].indexOf(position)<0){ alert2('請選擇有效職位。'); return; }
  if(position==='員工' && !regions.length){ alert2('員工必須至少選擇 1 個隸屬地區。'); return; }
  ensureAdminUser();
  if(users.some(function(u){
    const up = normalizePhone(u.phone) || normalizePhone(u.id) || normalizePhone(u.login);
    return up === phone || String(u.login||'') === phone || String(u.id||'') === phone;
  })){
    alert2('此電話號碼已存在，請換一個。');
    return;
  }
  if(!name) name = phone;
  const pw = passwordFromPhone(phone);
  const role = position==='員工' ? 'personal' : 'system_admin';
  const payload = {
    id: phone,
    login: phone,
    phone: phone,
    pw: pw,
    name: name,
    position: position,
    role: role,
    units: regions,
    unit: regions[0]||null,
    dept: regions.join('、') || (position==='員工'?'—':'管理層'),
    active: true
  };
  let syncNote = '';
  let nu = normalizeUser(payload);
  try{
    const res = await apiFetch('/api/users', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if(res && res.user) nu = normalizeUser(Object.assign({}, res.user, { pw: pw }));
    users.push(nu);
    saveUsersLocal();
    syncNote = '<br><span style="color:#2e7d32">已寫入 users collection（電話為 ID），其他裝置可用此電話登入。</span>';
    noteCloudOk();
  }catch(e){
    alert2('創建失敗：'+(e.message||e));
    return;
  }
  addModuleLog('push','創建員工', position+'｜'+phone+'｜'+(regions.length?regions.join('、'):'無地區'));
  try{ await persistProjectsNow(); }catch(e){ noteCloudError(e); }
  const copyText = '電話：'+phone+'\n密碼：'+pw+'\n職位：'+position+'\n地區：'+(regions.length?regions.join('、'):'—');
  showModal(`<h3>✅ 已建立員工</h3>
    <p style="font-size:14px;line-height:1.7">
      電話／登入：<b>${escHtml(phone)}</b><br>
      初始密碼：<b>${escHtml(pw)}</b><br>
      職位：<b>${escHtml(position)}</b><br>
      地區：<b>${escHtml(regions.length?regions.join('、'):'—')}</b>
      ${syncNote}
    </p>
    <div class="actions">
      <button class="btn sm gray" onclick="closeModal()">關閉</button>
      <button class="btn sm green" data-call="copyStaffCreds" data-arg0="${escHtml(String(copyText))}">複製賬號與密碼</button>
    </div>`);
  const phoneEl = document.getElementById('staff-phone');
  const nameEl = document.getElementById('staff-name');
  if(phoneEl) phoneEl.value = '';
  if(nameEl) nameEl.value = '';
  document.querySelectorAll('.staff-region').forEach(function(cb){ cb.checked=false; });
  staffPreviewPw();
  const body = document.getElementById('staff-list-body');
  if(body) body.innerHTML = staffListRowsHtml();
  else render();
}
async function copyStaffCreds(text){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    alert2('已複製到剪貼簿。');
  }catch(e){
    alert2('複製失敗，請手動選取密碼。');
  }
}

/* ═══════════ 工具 ═══════════ */
function nowStr(){ const d=new Date(); return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日'; }
/** 解析「2026年8月6日」或帶時間的字串 → ms；失敗回 0 */
function parseZhDateMs(s){
  const m = String(s||'').match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m) return 0;
  const hh = m[4]!=null ? Number(m[4]) : 0;
  const mm = m[5]!=null ? Number(m[5]) : 0;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), hh, mm).getTime();
}
function projIdSeq(p){
  const m = String(p&&p.id||'').match(/^[PR](\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}
/** 項目建立時間（越新越大）；優先 createdAtMs，其次建立日誌／建立日期／編號序號 */
function projCreatedMs(p){
  if(!p) return 0;
  if(Number(p.createdAtMs)>0) return Number(p.createdAtMs);
  const createLog = Array.isArray(p.logs) ? p.logs.find(function(l){ return l && l.action==='建立項目'; }) : null;
  if(createLog && createLog.time){
    const t = parseZhDateMs(createLog.time);
    if(t) return t;
  }
  const day = parseZhDateMs(p.created);
  if(day) return day + projIdSeq(p);
  return projIdSeq(p);
}
function compareProjectsNewestFirst(a, b){
  const diff = projCreatedMs(b) - projCreatedMs(a);
  if(diff) return diff;
  const seq = projIdSeq(b) - projIdSeq(a);
  if(seq) return seq;
  return String(b&&b.id||'').localeCompare(String(a&&a.id||''));
}
function sortProjectsNewestFirst(list){
  return (Array.isArray(list) ? list.slice() : []).sort(compareProjectsNewestFirst);
}
function moduleForProject(p){ return p && p.type==='rep' ? 'replenishment' : 'production'; }
function addModuleLog(mod, action, detail){
  if(!moduleLogs[mod]) moduleLogs[mod] = [];
  const snap = actorSnapshot(currentUser);
  moduleLogs[mod].unshift({
    time: nowStr(),
    user: snap.userLabel,
    userId: snap.userId,
    userName: snap.userName,
    userPhone: snap.userPhone,
    action,
    detail: detail || ''
  });
  persistProjects();
}
/** @deprecated use addModuleLog — kept for call sites; scopes to currentModule */
function addSysLog(action, detail){ addModuleLog(currentModule || 'daily', action, detail); }
function addProjLog(p, action, detail){
  const snap = actorSnapshot(currentUser);
  p.logs.unshift({
    time:nowStr(),
    user: snap.userLabel,
    userId: snap.userId,
    userName: snap.userName,
    userPhone: snap.userPhone,
    action,
    detail
  });
  addModuleLog(moduleForProject(p), action, p.code+'｜'+detail);
}

function stageDone(s){ return s.status==='已完成' || s.status==='直接下一階段' || s.status==='不適用'; }
function projProgress(p){
  const applicable = p.stages.filter(s=>s.status!=='不適用');
  const done = applicable.filter(s=>s.status==='已完成'||s.status==='直接下一階段').length;
  return applicable.length ? Math.round(done/applicable.length*100) : 0;
}
function currentStage(p){
  const s = p.stages.find(x=>!stageDone(x));
  return s ? s.name : '全部完成';
}
function isProjectLocked(p){
  return !!(p && ['暫停','已取消','已封存'].indexOf(p.status)>=0);
}
function projStatus(p){
  if(p.status==='已取消'||p.status==='暫停'||p.status==='已封存') return p.status;
  if(p.stages.every(stageDone)) return '已完成';
  if(p.stages.some(s=>s.status==='待確認')) return '待確認';
  if(p.stages.some(s=>s.status==='需要修改')) return '需要修改';
  return '進行中';
}
function typeTag(t){ return t==='dev'?'<span class="tag t-dev">開發及生產</span>':'<span class="tag t-rep">補貨</span>'; }
function projectAssigneeOpts(selectedId){
  const pool = listAssignableStaff();
  const selected = selectedId ? String(selectedId) : '';
  const opts = pool.map(function(u){
    const phone = normalizePhone(u.phone)||normalizePhone(u.id)||'';
    const label = escHtml(u.name)+(phone?('｜'+phone):'')+'（'+escHtml(u.position||roleLabel(u))+'）';
    return `<option value="${u.id}"${u.id===selected?' selected':''}>${label}</option>`;
  }).join('');
  if(!opts) return `<option value="">（尚無經理／主管賬號，請先「創建員工」）</option>`;
  return `<option value="">— 未分配 —</option>`+opts;
}
/** 階段經手人多選 checkbox（僅經理／主管） */
function projectAssigneeChecksHtml(selectedIds, inputClass){
  const pool = listAssignableStaff();
  const selected = {};
  (Array.isArray(selectedIds)?selectedIds:(selectedIds?[selectedIds]:[])).forEach(function(id){
    if(id) selected[String(id)] = true;
  });
  const cls = inputClass || 'stage-handler-cb';
  if(!pool.length){
    return '<p style="font-size:12px;color:#c62828;margin:0">尚無經理／主管可選。請先創建職位為「經理」或「主管」的賬號。</p>';
  }
  return '<div class="recipient-box" style="max-height:160px;min-width:220px">'+
    pool.map(function(u){
      const phone = normalizePhone(u.phone)||normalizePhone(u.id)||'';
      const label = escHtml(u.name)+'（'+escHtml(u.position||'')+(phone?'｜'+phone:'')+'）';
      const checked = selected[String(u.id)] ? ' checked' : '';
      return '<label class="rc-item"><input type="checkbox" class="'+cls+'" value="'+escHtml(u.id)+'"'+checked+'> '+label+'</label>';
    }).join('')+
    '</div>';
}
function readCheckedHandlerIds(rootSel, inputClass){
  const root = typeof rootSel==='string' ? document.querySelector(rootSel) : rootSel;
  if(!root) return [];
  const cls = inputClass || 'stage-handler-cb';
  return Array.from(root.querySelectorAll('input.'+cls+':checked')).map(function(cb){ return cb.value; }).filter(Boolean);
}
function projThumbHtml(p,size){
  size=size||44;
  const fs=size>=60?32:22;
  if(p&&p.coverUrl){
    let src = p.coverUrl;
    if(p.coverFileId) src = withFileToken(apiUrl('/api/files/'+p.coverFileId));
    else src = withFileToken(src);
    return `<div class="thumb" style="width:${size}px;height:${size}px"><img src="${src}" alt=""></div>`;
  }
  return `<div class="thumb" style="width:${size}px;height:${size}px;font-size:${fs}px">${p&&p.icon?p.icon:'🆕'}</div>`;
}
function canOperateStage(p, s){
  if(isProjectLocked(p)) return false;
  if(isAdmin()) return true; // 經理／主管／admin
  if(isManager()) return false;
  return !!(currentUser && isStageHandler(s, currentUser.id));
}
function fmtMention(text){
  return String(text||'').replace(/@([^\s@，,。]+)/g,'<span class="mention">@$1</span>');
}
function ensureFilePayload(f){
  if(!f) return f;
  if(typeof f==='string') return {name:f};
  if(f.driveFileId){
    f.dataUrl = withFileToken(apiUrl('/api/files/'+f.driveFileId));
    return f;
  }
  return f;
}
function fileLinkHtml(fileOrName, label){
  const f = ensureFilePayload(typeof fileOrName==='string'?{name:fileOrName}:fileOrName);
  const name = f.name||'附件';
  const href = fileHref(f);
  return `<a class="file-link" href="${href}" download="${name.replace(/"/g,'')}" target="_blank" rel="noopener">${label||('📎 '+name)}</a>`;
}
function mentionCandidates(q){
  const qq = (q||'').toLowerCase();
  return users.filter(u=>u.active && (!currentUser || u.id!==currentUser.id))
    .filter(u=>!qq || u.name.toLowerCase().includes(qq) || (u.login||'').toLowerCase().includes(qq) || (u.dept||'').toLowerCase().includes(qq));
}
function bindMentionInput(textareaId){
  const ta = document.getElementById(textareaId);
  if(!ta || ta.dataset.mentionBound==='1') return;
  ta.dataset.mentionBound='1';
  const wrap = document.createElement('div');
  wrap.className='mention-wrap';
  ta.parentNode.insertBefore(wrap, ta);
  wrap.appendChild(ta);
  const box = document.createElement('div');
  box.className='mention-box';
  box.id = textareaId+'-mention';
  wrap.appendChild(box);
  let activeIdx = 0;
  const hide = ()=> box.classList.remove('show');
  const insertMention = (name)=>{
    const val = ta.value, pos = ta.selectionStart||val.length;
    const before = val.slice(0,pos);
    const at = before.lastIndexOf('@');
    if(at<0) return;
    const after = val.slice(pos);
    ta.value = before.slice(0,at)+'@'+name+' '+after;
    const np = at+name.length+2;
    ta.focus(); ta.setSelectionRange(np,np);
    hide();
  };
  const renderBox = (list)=>{
    if(!list.length){ hide(); return; }
    box.innerHTML = list.slice(0,8).map((u,i)=>`
      <button type="button" class="mention-item${i===activeIdx?' active':''}" data-name="${u.name}">
        <b>@${u.name}</b><span class="mid">${u.dept||u.role||''}</span>
      </button>`).join('');
    box.classList.add('show');
    [...box.querySelectorAll('.mention-item')].forEach(btn=>{
      btn.onmousedown = (e)=>{ e.preventDefault(); insertMention(btn.dataset.name); };
    });
  };
  ta.addEventListener('input', ()=>{
    const pos = ta.selectionStart||0;
    const before = ta.value.slice(0,pos);
    const m = before.match(/@([^\s@]*)$/);
    if(!m){ hide(); return; }
    activeIdx = 0;
    renderBox(mentionCandidates(m[1]));
  });
  ta.addEventListener('keydown', (e)=>{
    if(!box.classList.contains('show')) return;
    const items = [...box.querySelectorAll('.mention-item')];
    if(!items.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); activeIdx=(activeIdx+1)%items.length; renderBox(mentionCandidates((ta.value.slice(0,ta.selectionStart).match(/@([^\s@]*)$/)||['',''])[1])); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); activeIdx=(activeIdx-1+items.length)%items.length; renderBox(mentionCandidates((ta.value.slice(0,ta.selectionStart).match(/@([^\s@]*)$/)||['',''])[1])); }
    else if(e.key==='Enter' || e.key==='Tab'){ e.preventDefault(); insertMention(items[activeIdx].dataset.name); }
    else if(e.key==='Escape'){ hide(); }
  });
  ta.addEventListener('blur', ()=> setTimeout(hide, 150));
}
function readFileAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function afterProjectChatRender(){
  if(currentView==='project' && currentTab==='chat'){
    setTimeout(()=> bindMentionInput('c-text'), 0);
  }
}

/* ═══════════ 登入/登出 ═══════════ */
function enterAppAs(user, opts){
  opts = opts || {};
  currentUser = normalizeUser(user);
  if(userNeedsPhoneBind(currentUser)){
    document.getElementById('page-login').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    refreshCloudSyncStatus();
    showBindPhoneGate();
    return;
  }
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const pos = currentUser.position || '';
  const phone = normalizePhone(currentUser.phone) || normalizePhone(currentUser.id);
  if(currentUser.role==='system_admin'){
    document.getElementById('top-user').textContent = '👑 '+currentUser.name+'（'+(pos||'系統管理員')+'）';
  } else if(currentUser.role==='manager'){
    document.getElementById('top-user').textContent = '🧭 '+currentUser.name+'（'+(pos||'主管')+'）';
  } else {
    document.getElementById('top-user').textContent = '👤 '+currentUser.name+(phone?'｜'+phone:'｜'+roleLabel(currentUser));
  }
  refreshCloudSyncStatus();
  currentModule = 'daily'; currentView='dailyToday'; currentProject=null;
  ensureDailySeed(); generateRecurringForToday();
  if(!opts.silent) addDailyOpLog('登入系統','進入每日工作流程');
  render();
  // 登入／恢復工作階段後立刻把「今日恆常實例」寫回雲端，避免只留在本機快取
  if(typeof flushCloudSaves==='function'){
    flushCloudSaves().catch(function(e){ if(typeof noteCloudError==='function') noteCloudError(e); });
  }
  setTimeout(function(){
    try{
      // 等通知載入後再彈出未讀突發任務／緊急通知信箱內容
      const run = async function(){
        if(apiEnabled && typeof loadNotifications==='function'){
          try{ await loadNotifications(); }catch(_e){}
        }
        await maybePromptUrgentNotices();
      };
      run();
    }catch(_e){}
  }, 500);
}
async function doLogin(){
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pw').value;
  const err = document.getElementById('login-err');
  if(!apiReady){ err.style.color='#c62828'; err.textContent='資料儲存仍在初始化，請稍候再登入。'; err.style.display='block'; return; }
  if(!apiEnabled){
    err.style.color='#c62828';
    err.textContent='未連接 MongoDB 雲端，無法登入。所有裝置必須使用同一雲端資料庫。請確認 Railway 已設定 MONGODB_URI。';
    err.style.display='block';
    return;
  }
  err.style.color='#1565c0';
  err.textContent='正在驗證帳號…';
  err.style.display='block';
  try{
    const result = await apiFetch('/api/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ login:u, pw:p })
    });
    if(!result || !result.token || !result.user){
      throw new Error('登入回應無效');
    }
    saveAuthToken(result.token);
    if(result.needsPhoneBind || userNeedsPhoneBind(result.user)){
      err.style.display='none';
      currentUser = normalizeUser(result.user);
      showBindPhoneGate();
      return;
    }
    err.textContent='正在載入雲端資料…';
    await loadCloudAppData();
    err.style.display='none'; err.style.color='';
    enterAppAs(result.user);
    try{ await flushCloudSaves(); }catch(e){ noteCloudError(e); }
  }catch(e){
    clearAuthToken();
    err.style.color='#c62828';
    err.textContent= (e && e.message) ? String(e.message) : '登入失敗';
    err.style.display='block';
  }
}
async function logout(){
  if(currentModule==='daily' && typeof addDailyOpLog==='function'){
    try{ addDailyOpLog('登出系統',''); }catch(e){ addModuleLog('daily','登出系統',''); }
  } else {
    addModuleLog(currentModule||'daily','登出系統','');
  }
  try{ await flushCloudSaves(); }catch(e){}
  try{
    if(apiEnabled) await apiFetch('/api/auth/logout', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
  }catch(e){}
  clearAuthToken();
  currentUser=null;
  pushUrgentPrompted = false;
  closeMailbox();
  closeAppSidebar();
  refreshMailboxUi();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('page-login').classList.remove('hidden');
  document.getElementById('login-pw').value='';
}

/* ═══════════ 導航及渲染 ═══════════ */
function setModule(m){
  // 員工職位不可進入開發及生產
  if(m==='production' && isPersonal()){
    alert2('員工賬戶無法使用「開發及生產」。');
    m='daily';
  }
  currentModule = m; currentProject=null;
  sidebarNavManual = false;
  sidebarOpenL1 = sidebarL1ForModule(m);
  sidebarOpenL2 = m;
  closeMailbox();
  if(m==='daily'){ currentView='dailyToday'; ensureDailySeed(); generateRecurringForToday(); }
  else if(m==='production'){
    currentView = isPersonal() ? 'myTasks' : 'home';
    listType='dev';
  }
  else if(m==='push'){ currentView='pushAll'; pushFilterCat='全部'; pushFilterRead='全部'; pushFilterKw=''; }
  else if(m==='createStaff'){ currentView='createStaff'; }
  else if(m==='settings'){ currentView='settings'; }
  else if(m==='transfer'){ currentView='transferInventory'; }
  else if(m==='pos'){ currentView='posCashier'; }
  else {
    currentView = isPersonal() ? 'myTasks' : 'home';
    listType='rep';
  }
  fCat='全部'; fStatus='全部'; fKw='';
  closeAppSidebar();
  render();
}
/** 側欄第一層 → 第二層模組 */
function getSidebarTree(){
  const features = [
    { mod:'daily', label:'今日工作' },
    { mod:'transfer', label:'貨品調動' },
    { mod:'push', label:'推送通知' }
  ];
  if(canCreateEmployee()) features.push({ mod:'createStaff', label:'創建員工' });
  features.push({ mod:'settings', label:'個人設置' });
  const products = [];
  if(!isPersonal()) products.push({ mod:'production', label:'開發及生產' });
  products.push({ mod:'replenishment', label:'補貨' });
  return [
    { id:'features', label:'功能', children: features },
    { id:'pos', label:'POS', children: [{ mod:'pos', label:'POS 收銀' }] },
    { id:'products', label:'產品', children: products }
  ];
}
/** @deprecated 保留給舊呼叫；改走 getSidebarTree */
function getSidebarModules(){
  const out = [];
  getSidebarTree().forEach(function(l1){
    (l1.children||[]).forEach(function(c){ out.push([c.mod, c.label]); });
  });
  return out;
}
function sidebarL1ForModule(mod){
  const tree = getSidebarTree();
  for(var i=0;i<tree.length;i++){
    var kids = tree[i].children||[];
    for(var j=0;j<kids.length;j++){
      if(kids[j].mod===mod) return tree[i].id;
    }
  }
  return 'features';
}
function getDefaultViewForModule(mod){
  var items = getSidebarItemsForModule(mod)||[];
  return items.length ? items[0][0] : 'dailyToday';
}
function ensureSidebarNavOpen(){
  if(!sidebarNavManual){
    sidebarOpenL1 = sidebarL1ForModule(currentModule);
    sidebarOpenL2 = currentModule||'';
  }
}
function toggleSidebarL1(id){
  sidebarNavManual = true;
  id = String(id||'');
  sidebarOpenL1 = (sidebarOpenL1===id) ? '' : id;
  if(sidebarOpenL1 && sidebarOpenL2){
    // 若展開的 L2 不屬於此 L1，清掉
    if(sidebarL1ForModule(sidebarOpenL2)!==sidebarOpenL1) sidebarOpenL2 = '';
  }
  render();
}
function toggleSidebarL2(mod){
  sidebarNavManual = true;
  mod = String(mod||'');
  sidebarOpenL1 = sidebarL1ForModule(mod);
  if(sidebarOpenL2===mod){
    sidebarOpenL2 = '';
    render();
    return;
  }
  sidebarOpenL2 = mod;
  // 進入該模組預設頁（若尚未在此模組）
  if(currentModule!==mod){
    goInModule(mod, getDefaultViewForModule(mod));
    return;
  }
  render();
}
/** 某模組下的第三層子頁 */
function getSidebarItemsForModule(mod){
  if(mod==='daily'){
    const items = [['dailyToday','今日工作'],['dailyProgress','各單位進度'],['dailyHistory','歷史記錄'],['dailyRecords','我的記錄']];
    if(isAdmin()||isManager()) items.push(['dailyNew','新增突發'],['dailyRecurring','恆常任務'],['dailyOpLogs','操作記錄']);
    return items;
  }
  if(mod==='pos'){
    return [
      ['posCashier','POS 收銀'],
      ['posTransactions','交易記錄'],
      ['posSettlement','每日結算'],
      ['posReport','銷售報表'],
      ['posMembers','會員管理'],
      ['posProducts','可售商品'],
      ['posReset','重置示範資料']
    ];
  }
  if(mod==='production'){
    const items = isPersonal()
      ? [['myTasks','我的工作'],['devList','項目列表'],['home','首頁']]
      : [['home','首頁'],['devList','項目列表'],['myTasks','我的工作']];
    if(isAdmin()) items.push(['addProject','建立項目']);
    if(isAdmin()||isManager()) items.push(['sysLogs','操作記錄']);
    return items;
  }
  if(mod==='push'){
    const unreadN = myUnreadAnnouncements().length;
    const readN = myActiveAnnouncements().filter(function(n){ const s=myNoticeReader(n); return s&&s.status==='read'; }).length;
    const endedN = announcementList().filter(function(n){ return n.status!=='進行中' && (isNoticeRecipient(n)||String(n.fromUserId)===String(currentUser.id)||isAdmin()||isManager()); }).length;
    const mineN = pushAllSourceList().filter(function(n){ return String(n.fromUserId)===String(currentUser.id)||isAdmin()||isManager(); }).length;
    const allN = pushAllSourceList().length;
    const items = [
      ['pushAll','所有通知（'+allN+'）'],
      ['pushUnread','未回覆／未閱讀'+(unreadN?'（'+unreadN+'）':'')],
      ['pushRead','已讀取（'+readN+'）'],
      ['pushEnded','已完結（'+endedN+'）'],
      ['pushMine','我發布的（'+mineN+'）'],
      ['pushCreate','＋ 新增通知']
    ];
    if(isAdmin()||isManager()) items.push(['pushLogs','操作記錄']);
    return items;
  }
  if(mod==='createStaff') return [['createStaff','創建員工']];
  if(mod==='settings') return [['settings','更改密碼']];
  if(mod==='transfer'){
    return [
      ['transferInventory','庫存查詢'],
      ['transferHistory','調動記錄'],
      ['transferStockLog','庫存校正記錄'],
      ['transferProducts','貨品'],
      ['transferProductLog','主檔變更記錄']
    ];
  }
  // replenishment
  const items = isPersonal()
    ? [['myTasks','我的工作'],['repList','項目列表'],['home','首頁']]
    : [['home','首頁'],['repList','項目列表'],['myTasks','我的工作']];
  if(isAdmin()) items.push(['addProject','建立項目']);
  if(isAdmin()||isManager()) items.push(['sysLogs','操作記錄']);
  return items;
}
function isSidebarItemActive(mod, viewKey){
  if(currentModule!==mod) return false;
  if(currentView===viewKey) return true;
  if(currentView==='project'){
    if(viewKey==='devList' && mod==='production') return true;
    if(viewKey==='repList' && mod==='replenishment') return true;
  }
  if(currentView==='dailyUnit' && viewKey==='dailyProgress') return true;
  if((currentView==='pushDetail' || currentView==='pushStats') && viewKey==='pushAll') return true;
  if(currentView==='transferApply' && viewKey==='transferInventory') return true;
  if(currentView==='posReceipt' && mod==='pos' && viewKey==='posTransactions') return true;
  return false;
}
function closeAppSidebar(){
  const side = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if(side) side.classList.remove('open');
  if(backdrop) backdrop.classList.remove('show');
  document.body.classList.remove('sidebar-open');
}
function openAppSidebar(){
  const side = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if(side) side.classList.add('open');
  if(backdrop) backdrop.classList.add('show');
  document.body.classList.add('sidebar-open');
}
function toggleAppSidebar(){
  const side = document.getElementById('app-sidebar');
  if(side && side.classList.contains('open')) closeAppSidebar();
  else openAppSidebar();
}
function bindAppSidebarChrome(){
  const toggle = document.getElementById('sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  if(toggle && toggle.dataset.bound!=='1'){
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', function(e){
      e.preventDefault();
      toggleAppSidebar();
    });
  }
  if(backdrop && backdrop.dataset.bound!=='1'){
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', function(){ closeAppSidebar(); });
  }
}
function render(){
  bindAppSidebarChrome();
  // 若目前停在不該看的模組，導回每日
  if(isPersonal() && currentModule==='production'){
    currentModule='daily';
    currentView='dailyToday';
  }
  const sideNav = document.getElementById('side-nav');
  if(sideNav){
    ensureSidebarNavOpen();
    const tree = getSidebarTree();
    sideNav.innerHTML = tree.map(function(l1){
      const l1Open = sidebarOpenL1===l1.id;
      const l2Html = (l1.children||[]).map(function(c){
        const mod = c.mod;
        const l2Open = sidebarOpenL2===mod;
        const inMod = currentModule===mod;
        const items = getSidebarItemsForModule(mod)||[];
        const l3 = l2Open ? ('<div class="side-l3">'+items.map(function(it){
          const k = it[0], l = it[1];
          const active = isSidebarItemActive(mod, k);
          const needsMod = (k==='home'||k==='myTasks'||k==='sysLogs'||k==='addProject');
          if(needsMod){
            return '<button type="button" class="side-link'+(active?' active':'')+'" data-call="goInModule" data-arg0="'+escHtml(String(mod))+'" data-arg1="'+escHtml(String(k))+'">'+l+'</button>';
          }
          return '<button type="button" class="side-link'+(active?' active':'')+'" data-call="go" data-arg0="'+escHtml(String(k))+'">'+l+'</button>';
        }).join('')+'</div>') : '';
        return '<div class="side-l2">'+
          '<button type="button" class="side-l2-btn'+(l2Open?' open':'')+(inMod?' active-mod':'')+'" data-call="toggleSidebarL2" data-arg0="'+escHtml(String(mod))+'">'+
          '<span>'+escHtml(c.label)+'</span><span class="side-chevron">'+(l2Open?'▾':'▸')+'</span></button>'+
          l3+'</div>';
      }).join('');
      return '<div class="side-l1">'+
        '<button type="button" class="side-l1-btn'+(l1Open?' open':'')+'" data-call="toggleSidebarL1" data-arg0="'+escHtml(String(l1.id))+'">'+
        '<span>'+escHtml(l1.label)+'</span><span class="side-chevron">'+(l1Open?'▾':'▸')+'</span></button>'+
        (l1Open ? '<div class="side-l1-body">'+l2Html+'</div>' : '')+
        '</div>';
    }).join('');
  }
  const views = {
    home: ()=> currentModule==='replenishment' ? vHomeFiltered('rep') : vHomeFiltered('dev'),
    devList:()=>vList('dev'), repList:()=>vList('rep'), myTasks:vMyTasks, addProject:vAddProject, sysLogs:vSysLogs, project:vProject,
    dailyToday:()=>vDailyToday(currentUser), dailyProgress:()=>vDailyProgress(currentUser),
    dailyUnit:()=>vDailyUnit(currentUser), dailyHistory:()=>vDailyHistory(currentUser),
    dailyRecords:()=>vDailyRecords(currentUser),
    dailyNew:()=>vDailyNew(currentUser), dailyRecurring:()=>vDailyRecurring(currentUser),
    dailyOpLogs:()=>vDailyOpLogs(currentUser),
    pushNotify: vPushCreate,
    pushAll: vPushAll,
    pushUnread: vPushUnread,
    pushRead: vPushRead,
    pushEnded: vPushEnded,
    pushMine: vPushMine,
    pushCreate: vPushCreate,
    pushDetail: vPushDetail,
    pushStats: vPushStats,
    pushLogs: vPushLogs,
    createStaff: vCreateStaff,
    settings: vPersonalSettings,
    transferInventory: vTransferInventory,
    transferApply: vTransferApply,
    transferHistory: vTransferHistory,
    transferStockLog: vTransferStockLog,
    transferProducts: vTransferProducts,
    transferProductLog: vTransferProductLog,
    posCashier: typeof vPosCashier==='function' ? vPosCashier : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posTransactions: typeof vPosTransactions==='function' ? vPosTransactions : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posReceipt: typeof vPosReceipt==='function' ? vPosReceipt : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posMembers: typeof vPosMembers==='function' ? vPosMembers : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posSettlement: typeof vPosSettlement==='function' ? vPosSettlement : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posReport: typeof vPosReport==='function' ? vPosReport : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posProducts: typeof vPosProducts==='function' ? vPosProducts : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; },
    posReset: typeof vPosReset==='function' ? vPosReset : function(){ return '<div class="card"><p>POS 模組載入中…</p></div>'; }
  };
  document.getElementById('main').innerHTML = (views[currentView]||views.home)();
  try{
    document.body.classList.toggle('pos-module', currentModule==='pos' && currentView!=='posReset');
  }catch(e){}
  afterProjectChatRender();
  refreshMailboxUi();
  refreshCloudSyncStatus();
}
function goInModule(mod, v){
  if(mod==='production' && isPersonal()){
    alert2('員工賬戶無法使用「開發及生產」。');
    return;
  }
  sidebarNavManual = false;
  sidebarOpenL1 = sidebarL1ForModule(mod);
  sidebarOpenL2 = mod;
  currentModule = mod;
  if(mod==='production') listType='dev';
  if(mod==='replenishment') listType='rep';
  go(v);
}
function go(v){
  currentView=v; currentProject=null;
  sidebarNavManual = false;
  if(v==='devList'){
    if(isPersonal()){ currentModule='daily'; currentView='dailyToday'; }
    else { listType='dev'; currentModule='production'; }
  }
  if(v==='repList'){ listType='rep'; currentModule='replenishment'; }
  if(v==='pushNotify' || v==='pushAll' || v==='pushUnread' || v==='pushRead' || v==='pushEnded' || v==='pushMine' || v==='pushCreate' || v==='pushDetail' || v==='pushStats' || v==='pushLogs'){ currentModule='push'; }
  if(v==='createStaff'){ currentModule='createStaff'; }
  if(v==='settings'){ currentModule='settings'; }
  if(v==='transferInventory' || v==='transferApply' || v==='transferHistory' || v==='transferStockLog' || v==='transferProducts' || v==='transferProductLog'){ currentModule='transfer'; }
  if(v==='dailyToday' || v==='dailyProgress' || v==='dailyUnit' || v==='dailyHistory' || v==='dailyRecords' || v==='dailyNew' || v==='dailyRecurring' || v==='dailyOpLogs'){ currentModule='daily'; }
  if(v==='posCashier' || v==='posTransactions' || v==='posReceipt' || v==='posMembers' || v==='posSettlement' || v==='posReport' || v==='posProducts' || v==='posReset'){ currentModule='pos'; }
  fCat='全部'; fStatus='全部'; fKw='';
  closeAppSidebar();
  render();
}
function vHomeFiltered(type){
  const scoped = projects.filter(p=>p.type===type);
  const waitConfirm = scoped.filter(p=>p.stages.some(s=>s.status==='待確認')).length;
  const needFix = scoped.filter(p=>p.stages.some(s=>s.status==='需要修改')).length;
  const myTasks = getMyTasks().filter(t=>{ const p=projects.find(x=>x.id===t.pid); return p && p.type===type; });
  const allComments = scoped.flatMap(p=>p.comments.filter(c=>!c.removed).map(c=>({...c, pname:p.name, pid:p.id}))).slice(0,3);
  const title = type==='dev' ? '開發及生產首頁' : '補貨首頁';
  return `<div class="card">
    <h2>🏭 ${title}｜${todayStr()}</h2>
    <div class="stats">
      <div class="stat"><div class="num blue">${scoped.length}</div><div class="lbl">項目總數</div></div>
      <div class="stat"><div class="num orange">${waitConfirm}</div><div class="lbl">待確認</div></div>
      <div class="stat"><div class="num red">${needFix}</div><div class="lbl">需要修改</div></div>
      <div class="stat"><div class="num green">${myTasks.length}</div><div class="lbl">我的待辦</div></div>
    </div>
  </div>
  ${!isAdmin() ? `<div class="card"><h2>📌 我的待辦工作（${myTasks.length}）</h2>
    ${myTasks.length? `<div class="table-wrap"><table><tr><th>項目</th><th>產品編號</th><th>工作階段</th><th>期限</th><th>狀態</th></tr>
    ${myTasks.map(t=>`<tr class="clickable" data-call="openProject" data-arg0="${escHtml(String(t.pid))}" data-arg1="flow"><td>${t.pname}</td><td>${t.code}</td><td>${t.stage}</td><td>${t.deadline||'—'}</td><td>${stTag(t.status)}</td></tr>`).join('')}
    </table></div>` : '<p style="color:#888">暫時沒有待辦工作。</p>'}
  </div>`:''}
  <div class="card"><h2>💬 最新留言</h2>
    ${allComments.length? allComments.map(c=>`<div class="msg" style="cursor:pointer" data-call="openProject" data-arg0="${escHtml(String(c.pid))}" data-arg1="chat">
      <div class="mhead"><span class="mname">${userName(c.by)}</span><span class="tag dept">${userDept(c.by)}</span>
      <span class="mtime">${c.time}</span><span class="tag s-pending">${c.pname}</span></div>
      <div class="mbody">${fmtMention(c.text)}</div></div>`).join('') : '<p style="color:#888">暫無留言。</p>'}
  </div>
  <div class="card"><h2>📂 項目列表</h2>${projTable(scoped)}</div>`;
}
function openProject(pid, tab){
  const p=projects.find(x=>x.id===pid);
  if(!p) return;
  if(p.type!=='rep' && isPersonal()){
    alert2('員工賬戶無法使用「開發及生產」。');
    return;
  }
  currentModule = p.type==='rep'?'replenishment':'production';
  currentProject=pid; currentView='project'; currentTab=tab||'overview'; commentFilter='全部'; render();
}
function setTab(t){ currentTab=t; render(); }

/* ═══════════ 首頁 ═══════════ */
function vHome(){
  const dev = projects.filter(p=>p.type==='dev'), rep = projects.filter(p=>p.type==='rep');
  const waitConfirm = projects.filter(p=>p.stages.some(s=>s.status==='待確認')).length;
  const needFix = projects.filter(p=>p.stages.some(s=>s.status==='需要修改')).length;
  const myTasks = getMyTasks();
  const allComments = projects.flatMap(p=>p.comments.filter(c=>!c.removed).map(c=>({...c, pname:p.name, pid:p.id}))).slice(0,3);
  return `<div class="card">
    <h2>🏭 生產部首頁｜${todayStr()}</h2>
    <div class="stats">
      <div class="stat"><div class="num blue">${dev.length}</div><div class="lbl">開發及生產項目</div></div>
      <div class="stat"><div class="num purple">${rep.length}</div><div class="lbl">補貨項目</div></div>
      <div class="stat"><div class="num orange">${waitConfirm}</div><div class="lbl">待確認</div></div>
      <div class="stat"><div class="num red">${needFix}</div><div class="lbl">需要修改</div></div>
    </div>
  </div>
  ${!isAdmin() ? `<div class="card"><h2>📌 我的待辦工作（${myTasks.length}）</h2>
    ${myTasks.length? `<div class="table-wrap"><table><tr><th>項目</th><th>產品編號</th><th>工作階段</th><th>期限</th><th>狀態</th></tr>
    ${myTasks.map(t=>`<tr class="clickable" data-call="openProject" data-arg0="${escHtml(String(t.pid))}" data-arg1="flow"><td>${t.pname}</td><td>${t.code}</td><td>${t.stage}</td><td>${t.deadline||'—'}</td><td>${stTag(t.status)}</td></tr>`).join('')}
    </table></div>` : '<p style="color:#888">暫時沒有待辦工作。</p>'}
  </div>`:''}
  <div class="card"><h2>💬 最新留言</h2>
    ${allComments.length? allComments.map(c=>`<div class="msg" style="cursor:pointer" data-call="openProject" data-arg0="${escHtml(String(c.pid))}" data-arg1="chat">
      <div class="mhead"><span class="mname">${userName(c.by)}</span><span class="tag dept">${userDept(c.by)}</span>
      <span class="mtime">${c.time}</span><span class="tag s-pending">${c.pname}</span></div>
      <div class="mbody">${fmtMention(c.text)}</div></div>`).join('') : '<p style="color:#888">暫無留言。</p>'}
  </div>
  <div class="card"><h2>📂 全部項目</h2>${projTable(projects)}</div>`;
}
function getProjectTodosForUser(user){
  user=user||currentUser;
  if(!user) return [];
  // 員工（personal）看自己的經手階段；管理員也可在「我的工作」看到自己被指派的
  if(!(user.role==='personal' || user.position==='員工' || user.role==='system_admin')) return [];
  const out=[];
  projects.forEach(p=>{
    if(isProjectLocked(p)) return;
    p.stages.forEach((s,idx)=>{
      if(!isStageHandler(s, user.id)||stageDone(s)) return;
      if(!['進行中','待處理','需要修改','待確認','未開始'].includes(s.status)) return;
      const prevDone=idx===0||p.stages.slice(0,idx).every(stageDone);
      if(!(prevDone||s.status!=='未開始')) return;
      out.push({
        pid:p.id, idx:idx, pname:p.name, code:p.code, stage:s.name,
        deadline:s.deadline, status:s.status, type:p.type,
        content:s.content||'', files:s.files||[]
      });
    });
  });
  return out;
}
function getMyTasks(){
  return getProjectTodosForUser(currentUser).map(t=>({
    pid:t.pid, pname:t.pname, code:t.code, stage:t.stage, deadline:t.deadline, status:t.status
  })).filter(function(t){
    // 員工職位不可見開發及生產項目
    if(!isPersonal()) return true;
    var p=projects.find(function(x){ return x.id===t.pid; });
    return p && p.type==='rep';
  });
}

/* ═══════════ 項目列表 ═══════════ */
function projTable(list){
  const rows = sortProjectsNewestFirst(list);
  if(!rows.length) return '<p style="color:#888">沒有符合條件的項目。</p>';
  return `<div class="table-wrap"><table>
    <tr><th>建立日期</th><th>圖片</th><th>產品編號</th><th>項目簡介</th><th>類別</th><th>類型</th><th>目前階段</th><th>狀態</th><th>完成進度</th></tr>
    ${rows.map(p=>{const pct=projProgress(p);return `<tr class="clickable" data-call="openProject" data-arg0="${escHtml(String(p.id))}">
      <td style="font-size:12px">${p.created}</td><td>${projThumbHtml(p,44)}</td>
      <td><b>${p.code}</b></td><td>${p.name}</td><td>${p.cat}</td><td>${typeTag(p.type)}</td>
      <td>${currentStage(p)}</td><td>${stTag(projStatus(p))}</td>
      <td style="min-width:100px"><div class="pbar"><div style="width:${pct}%"></div></div><div style="font-size:11px;text-align:right;color:#2e7d32">${pct}%</div></td>
    </tr>`;}).join('')}</table></div>`;
}
function vList(type){
  listType = type;
  let list = projects.filter(p=>p.type===type);
  if(fCat!=='全部') list = list.filter(p=>p.cat===fCat);
  if(fStatus!=='全部') list = list.filter(p=>projStatus(p)===fStatus);
  if(fKw) list = list.filter(p=>(p.code+p.name+p.desc+p.cat).toLowerCase().includes(fKw.toLowerCase()));
  return `<div class="card">
    <h2>${type==='dev'?'📐 開發及生產項目':'🔄 補貨項目'}（${list.length}）</h2>
    <div class="filters">
      <select onchange="fCat=this.value;render()"><option ${fCat==='全部'?'selected':''}>全部</option>${CATEGORIES.map(c=>`<option ${fCat===c?'selected':''}>${c}</option>`).join('')}</select>
      <select onchange="fStatus=this.value;render()">${['全部','進行中','待確認','需要修改','已完成','暫停','已取消','已封存'].map(s=>`<option ${fStatus===s?'selected':''}>${s}</option>`).join('')}</select>
      <input type="text" placeholder="搜尋編號／名稱／內容" value="${fKw}" onchange="fKw=this.value;render()">
      ${isAdmin()?`<button class="btn sm" onclick="go('addProject')">＋ 建立新項目</button><button class="btn gray sm" data-call="exportProjectsCsv" data-arg0="${escHtml(String(type))}">匯出資料</button>`:''}
    </div>
    ${projTable(list)}
  </div>`;
}

/* ═══════════ 我的工作 ═══════════ */
function vMyTasks(){
  if(isAdmin() && !isPersonal()){
    // 純管理層：顯示待確認及各經手人概況
    const waits = [];
    projects.forEach(p=>p.stages.forEach(s=>{ if(s.status==='待確認') waits.push({p,s}); }));
    const staffRows = listAssignableStaff().map(u=>{
      let n=0; projects.forEach(p=>p.stages.forEach(s=>{ if(isStageHandler(s,u.id)&&!stageDone(s)) n++; }));
      return `<tr><td>${escHtml(u.name)}</td><td>${escHtml(u.position||u.dept||'')}</td><td><b>${n}</b></td></tr>`;
    }).join('');
    return `<div class="card"><h2>✅ 等待管理層確認（${waits.length}）</h2>
      ${waits.length?`<div class="table-wrap"><table><tr><th>項目</th><th>階段</th><th>經手人</th><th>操作</th></tr>
      ${waits.map(({p,s})=>`<tr><td>${p.code} ${p.name}</td><td>${s.name}</td><td>${escHtml(stageHandlersLabel(s))}</td>
        <td><button class="btn sm" data-call="openProject" data-arg0="${escHtml(String(p.id))}" data-arg1="flow">處理</button></td></tr>`).join('')}</table></div>`:'<p style="color:#888">沒有等待確認的階段。</p>'}
    </div>
    <div class="card"><h2>👥 各經手人待辦工作（經理／主管）</h2>
      <div class="table-wrap"><table><tr><th>經手人</th><th>職位</th><th>待辦階段數</th></tr>
      ${staffRows||'<tr><td colspan="3" style="color:#888">尚無經理／主管。請先創建職位為「經理」或「主管」的賬號並指派經手人。</td></tr>'}
      </table></div></div>`;
  }
  const tasks = getMyTasks();
  const doneList = [];
  projects.forEach(p=>{
    if(isPersonal() && p.type!=='rep') return;
    p.stages.forEach(s=>{ if(isStageHandler(s,currentUser.id)&&s.status==='已完成') doneList.push({p,s}); });
  });
  const emptyHint = '<p style="color:#888">暫時沒有待辦。請在項目工作流程把階段經手人指派後，即可在此處理。</p>';
  return `<div class="card"><h2>📌 我的待辦工作（${tasks.length}）</h2>
    <p style="font-size:13px;color:#666;margin-bottom:10px">${isPersonal()?'補貨中指派給你的階段會顯示於此，可點擊進入處理。':'開發及生產／補貨中指派給你的階段會顯示於此，可點擊進入處理。'}</p>
    ${tasks.length?`<div class="table-wrap"><table><tr><th>項目</th><th>產品編號</th><th>工作階段</th><th>完成期限</th><th>狀態</th><th>操作</th></tr>
    ${tasks.map(t=>`<tr><td>${t.pname}</td><td>${t.code}</td><td>${t.stage}</td><td>${t.deadline||'—'}</td><td>${stTag(t.status)}</td>
      <td><button class="btn sm" data-call="openProject" data-arg0="${escHtml(String(t.pid))}" data-arg1="flow">查看／處理</button></td></tr>`).join('')}</table></div>`:emptyHint}
  </div>
  <div class="card"><h2>✔️ 我已完成的階段（${doneList.length}）</h2>
    ${doneList.length?`<div class="table-wrap"><table><tr><th>項目</th><th>階段</th><th>完成日期</th></tr>
    ${doneList.map(({p,s})=>`<tr class="clickable" data-call="openProject" data-arg0="${escHtml(String(p.id))}" data-arg1="flow"><td>${p.code} ${p.name}</td><td>${s.name}</td><td>${s.completedAt||'—'}</td></tr>`).join('')}</table></div>`:'<p style="color:#888">暫無記錄。</p>'}
  </div>`;
}

/* ═══════════ 項目詳情 ═══════════ */
function vProject(){
  const p = projects.find(x=>x.id===currentProject);
  if(!p) return vHome();
  const pct = projProgress(p);
  const tabs = [['overview','項目概覽'],['flow','工作流程'],['files','文件及圖片'],['chat','項目對話'],['logs','操作記錄']];
  return `<div class="card">
    <button class="btn gray sm" data-call="go" data-arg0="${escHtml(String(p.type==='dev'?'devList':'repList'))}">← 返回列表</button>
    <div style="display:flex;gap:14px;align-items:center;margin-top:12px;flex-wrap:wrap">
      ${projThumbHtml(p,64)}
      <div style="flex:1;min-width:200px">
        <h2 style="margin-bottom:4px">${p.code}｜${p.name}</h2>
        <div style="font-size:13px;color:#777">${typeTag(p.type)} <span class="tag dept">${p.cat}</span> ${stTag(projStatus(p))}
          <span style="margin-left:6px">負責人：${userName(p.owner)}</span></div>
      </div>
      <div style="min-width:140px;text-align:right">
        <div style="font-size:22px;font-weight:bold;color:#2e7d32">${pct}%</div>
        <div class="pbar"><div style="width:${pct}%"></div></div>
        <div style="font-size:11px;color:#888;margin-top:2px">目前階段：${currentStage(p)}</div>
      </div>
    </div>
    <div class="tabs" style="margin-top:14px">
      ${tabs.map(([k,l])=>`<button class="${currentTab===k?'active':''}" data-call="setTab" data-arg0="${escHtml(String(k))}">${l}${k==='chat'?`（${p.comments.filter(c=>!c.removed).length}）`:''}</button>`).join('')}
    </div>
    ${{overview:tabOverview, flow:tabFlow, files:tabFiles, chat:tabChat, logs:tabLogs}[currentTab](p)}
  </div>`;
}

function tabOverview(p){
  const lockedNote = isProjectLocked(p)
    ? `<div class="info-banner" style="margin-bottom:12px">🔒 項目目前為「${escHtml(p.status)}」${p.statusReason?'：'+escHtml(p.statusReason):''}${p.statusChangedAt?'（'+escHtml(p.statusChangedAt)+'）':''}。階段推進已鎖定。</div>`
    : '';
  const hist = Array.isArray(p.revisions) && p.revisions.length
    ? `<div style="margin-top:12px"><h3>修改紀錄（保留修改前版本）</h3>
        <div class="table-wrap"><table><tr><th>時間</th><th>人員</th><th>變更摘要</th></tr>
        ${p.revisions.slice(0,10).map(r=>`<tr><td style="font-size:11px;white-space:nowrap">${escHtml(r.time||'')}</td><td>${escHtml(r.byName||'')}</td><td style="font-size:12px">${escHtml(r.summary||'')}</td></tr>`).join('')}
        </table></div></div>`
    : '';
  return `${lockedNote}<div class="table-wrap"><table>
    <tr><th style="width:130px">項目編號</th><td>${p.id}</td></tr>
    <tr><th>建立工作日期</th><td>${p.created}</td></tr>
    <tr><th>項目類型</th><td>${typeTag(p.type)}</td></tr>
    <tr><th>產品編號</th><td><b>${escHtml(p.code)}</b></td></tr>
    <tr><th>項目簡介</th><td>${escHtml(p.name)}</td></tr>
    <tr><th>產品類別</th><td>${escHtml(p.cat)}</td></tr>
    <tr><th>項目負責人</th><td>${userName(p.owner)}（${userDept(p.owner)}）</td></tr>
    <tr><th>項目建立人</th><td>${userName(p.createdBy)}</td></tr>
    <tr><th>預計完成日期</th><td>${escHtml(p.due||'—')}</td></tr>
    <tr><th>目前階段</th><td>${currentStage(p)}</td></tr>
    <tr><th>整體狀態</th><td>${stTag(projStatus(p))}</td></tr>
    <tr><th>項目詳細</th><td style="white-space:pre-wrap">${escHtml(p.desc||'')}</td></tr>
  </table></div>
  ${isAdmin()?`<div class="actions-row">
    <button class="btn warn sm" data-call="askEditProject" data-arg0="${escHtml(String(p.id))}">編輯項目資料</button>
    <button class="btn red sm" data-call="askProjectLifecycle" data-arg0="${escHtml(String(p.id))}">暫停／取消／封存</button>
    ${p.status==='暫停'?`<button class="btn green sm" data-call="resumeProject" data-arg0="${escHtml(String(p.id))}">恢復進行</button>`:''}
  </div>`:''}
  ${hist}`;
}

let epCoverDraft = null; // {name, dataUrl} | null
let epCoverRemove = false;

function epCoverSrc(p){
  if(!p || !p.coverUrl) return '';
  if(p.coverFileId) return withFileToken(apiUrl('/api/files/'+p.coverFileId));
  return withFileToken(p.coverUrl);
}
function epCoverPreviewHtml(p){
  if(epCoverDraft){
    return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0">
      <div class="thumb" style="width:64px;height:64px"><img src="${epCoverDraft.dataUrl}" alt=""></div>
      <div style="font-size:13px">${escHtml(epCoverDraft.name||'新封面')}
        <div style="color:#888;font-size:12px;margin-top:2px">將於儲存時更新封面</div>
        <div><button type="button" class="btn gray sm" data-call="epClearCover" data-arg0="${escHtml(String(p.id))}">清除</button></div>
      </div></div>`;
  }
  if(epCoverRemove){
    return `<div style="margin:8px 0">
      <p style="font-size:12px;color:#888;margin:0 0 6px">已標記清除封面（儲存後使用預設圖示）。</p>
      <button type="button" class="btn gray sm" data-call="epUndoClearCover" data-arg0="${escHtml(String(p.id))}">取消清除</button>
    </div>`;
  }
  if(p && p.coverUrl){
    return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0">
      <div class="thumb" style="width:64px;height:64px"><img src="${epCoverSrc(p)}" alt=""></div>
      <div style="font-size:13px">目前封面
        <div style="color:#888;font-size:12px;margin-top:2px">可重新上傳以更換</div>
        <div><button type="button" class="btn gray sm" data-call="epClearCover" data-arg0="${escHtml(String(p.id))}">清除封面</button></div>
      </div></div>`;
  }
  return '<p style="font-size:12px;color:#888;margin:6px 0">目前無封面（將使用預設圖示）。可上傳圖片作為封面。</p>';
}
function epRenderCoverPreview(pid){
  const p = projects.find(x=>x.id===pid);
  const el = document.getElementById('ep-cover-preview');
  if(el) el.innerHTML = epCoverPreviewHtml(p||{});
}
function epClearCover(pid){
  epCoverDraft = null;
  epCoverRemove = true;
  const input = document.getElementById('ep-cover');
  if(input) input.value = '';
  epRenderCoverPreview(pid);
}
function epUndoClearCover(pid){
  epCoverRemove = false;
  epRenderCoverPreview(pid);
}
async function epOnCoverPick(input, pid){
  const f = input.files && input.files[0];
  if(!f) return;
  if(!(f.type||'').startsWith('image/')){
    alert2('封面請選擇圖片檔（JPG／PNG／GIF／WebP）。');
    input.value = '';
    return;
  }
  try{
    epCoverDraft = { name:f.name, dataUrl: await readFileAsDataUrl(f) };
    epCoverRemove = false;
    epRenderCoverPreview(pid);
  }catch(e){
    alert2('讀取封面失敗，請重試。');
    input.value = '';
  }
}
function askEditProject(pid){
  if(!isAdmin()){ alert2('只有系統管理員可以編輯項目。'); return; }
  const p = projects.find(x=>x.id===pid);
  if(!p) return;
  epCoverDraft = null;
  epCoverRemove = false;
  showModal(`<h3>編輯項目資料</h3>
    <label>項目封面圖片</label>
    <input type="file" id="ep-cover" accept="image/*" onchange="epOnCoverPick(this,'${pid}')">
    <div id="ep-cover-preview">${epCoverPreviewHtml(p)}</div>
    <p style="font-size:12px;color:#888;margin:4px 0 10px">封面用於列表／標題縮圖，不會加入「文件及圖片」。</p>
    <label>產品編號</label><input type="text" id="ep-code" value="${escHtml(p.code)}">
    <label>項目簡介</label><input type="text" id="ep-name" value="${escHtml(p.name)}">
    <label>產品類別</label><select id="ep-cat">${CATEGORIES.map(c=>`<option${c===p.cat?' selected':''}>${c}</option>`).join('')}</select>
    <label>項目負責人</label><select id="ep-owner">${projectAssigneeOpts(p.owner)}</select>
    <label>預計完成日期</label><input type="date" id="ep-due" value="${(p.due&&p.due!=='—')?p.due:''}">
    <label>項目詳細內容</label><textarea id="ep-desc">${escHtml(p.desc||'')}</textarea>
    <p style="font-size:12px;color:#888;margin-top:8px">儲存時會保留修改前版本摘要於「修改紀錄」。</p>
    <div class="actions">
      <button class="btn sm gray" onclick="closeModal()">取消</button>
      <button class="btn sm green" data-call="saveProjectEdit" data-arg0="${escHtml(String(pid))}">儲存變更</button>
    </div>`);
}
async function saveProjectEdit(pid){
  if(!isAdmin()){ alert2('只有系統管理員可以編輯項目。'); return; }
  const p = projects.find(x=>x.id===pid);
  if(!p) return;
  const code = ((document.getElementById('ep-code')||{}).value||'').trim();
  const name = ((document.getElementById('ep-name')||{}).value||'').trim();
  const cat = ((document.getElementById('ep-cat')||{}).value||p.cat);
  const owner = ((document.getElementById('ep-owner')||{}).value||p.owner);
  const due = ((document.getElementById('ep-due')||{}).value||'').trim() || '—';
  const desc = ((document.getElementById('ep-desc')||{}).value||'').trim();
  if(!code||!name){ alert2('請輸入產品編號及項目簡介。'); return; }
  const coverChanged = !!(epCoverDraft || (epCoverRemove && p.coverUrl));
  if(coverChanged && !requireCloud('更新封面')) return;
  const before = {
    code:p.code, name:p.name, cat:p.cat, owner:p.owner, due:p.due, desc:p.desc||'',
    coverUrl:p.coverUrl||null, coverFileId:p.coverFileId||null
  };
  const changes = [];
  if(before.code!==code) changes.push('編號 '+before.code+' → '+code);
  if(before.name!==name) changes.push('簡介');
  if(before.cat!==cat) changes.push('類別 '+before.cat+' → '+cat);
  if(before.owner!==owner) changes.push('負責人 '+userName(before.owner)+' → '+userName(owner));
  if(before.due!==due) changes.push('完成日 '+before.due+' → '+due);
  if(before.desc!==desc) changes.push('詳細內容');
  if(epCoverDraft) changes.push('更新封面');
  else if(epCoverRemove && before.coverUrl) changes.push('清除封面');
  if(!changes.length){ closeModal(); alert2('沒有變更。'); return; }
  let nextCoverUrl = p.coverUrl || null;
  let nextCoverFileId = p.coverFileId || null;
  if(epCoverDraft){
    try{
      const up = await cloudUploadDataUrl(epCoverDraft.name, epCoverDraft.dataUrl);
      nextCoverUrl = up.dataUrl;
      nextCoverFileId = up.driveFileId || null;
    }catch(e){
      alert2('上傳封面失敗：'+(e.message||e));
      return;
    }
  } else if(epCoverRemove){
    nextCoverUrl = null;
    nextCoverFileId = null;
  }
  if(!Array.isArray(p.revisions)) p.revisions = [];
  p.revisions.unshift({
    time: nowStr(),
    by: currentUser.id,
    byName: currentUser.name,
    summary: changes.join('；'),
    snapshot: before
  });
  if(p.revisions.length>30) p.revisions = p.revisions.slice(0,30);
  p.code = code; p.name = name; p.cat = cat; p.owner = owner; p.due = due; p.desc = desc;
  p.coverUrl = nextCoverUrl;
  p.coverFileId = nextCoverFileId;
  addProjLog(p,'編輯項目資料', changes.join('；'));
  epCoverDraft = null;
  epCoverRemove = false;
  try{
    await persistProjectsNow();
  }catch(e){
    noteCloudError(e);
    alert2('已套用變更，但雲端同步失敗：'+(e.message||e));
    closeModal();
    render();
    return;
  }
  closeModal();
  render();
  alert2('已儲存項目資料，並保留修改前版本摘要。');
}
function askProjectLifecycle(pid){
  if(!isAdmin()){ alert2('只有系統管理員可以變更項目狀態。'); return; }
  const p = projects.find(x=>x.id===pid);
  if(!p) return;
  const cur = p.status||'進行中';
  showModal(`<h3>暫停／取消／封存項目</h3>
    <p style="font-size:13px;color:#666;margin-bottom:8px">目前狀態：<b>${escHtml(projStatus(p))}</b>。請選擇操作；原因可留空。</p>
    <label>操作</label>
    <select id="pl-act">
      <option value="暫停"${cur==='暫停'?' selected':''}>暫停（可稍後恢復）</option>
      <option value="已取消"${cur==='已取消'?' selected':''}>取消項目</option>
      <option value="已封存"${cur==='已封存'?' selected':''}>封存項目</option>
    </select>
    <label>原因（選填）</label>
    <textarea id="pl-reason" placeholder="可留空，例如：物料未到／客戶取消／已完成歸檔">${escHtml(p.statusReason||'')}</textarea>
    <div class="actions">
      <button class="btn sm gray" onclick="closeModal()">返回</button>
      <button class="btn sm red" data-call="applyProjectLifecycle" data-arg0="${escHtml(String(pid))}">確認變更</button>
    </div>`);
}
function applyProjectLifecycle(pid){
  if(!isAdmin()){ alert2('只有系統管理員可以變更項目狀態。'); return; }
  const p = projects.find(x=>x.id===pid);
  if(!p) return;
  const act = ((document.getElementById('pl-act')||{}).value||'').trim();
  const reason = ((document.getElementById('pl-reason')||{}).value||'').trim();
  if(['暫停','已取消','已封存'].indexOf(act)<0){ alert2('請選擇有效操作。'); return; }
  const prev = p.status || '進行中';
  p.status = act;
  p.statusReason = reason;
  p.statusChangedAt = nowStr();
  p.statusChangedBy = currentUser.id;
  addProjLog(p, act==='暫停'?'暫停項目':(act==='已取消'?'取消項目':'封存項目'), (prev!==act?(prev+' → '+act):'')+(reason?'｜'+reason:''));
  persistProjects();
  closeModal();
  render();
  alert2('項目已設為「'+act+'」。');
}
function resumeProject(pid){
  if(!isAdmin()){ alert2('只有系統管理員可以恢復項目。'); return; }
  const p = projects.find(x=>x.id===pid);
  if(!p) return;
  if(p.status!=='暫停'){ alert2('只有「暫停」中的項目可以恢復。'); return; }
  showModal(`<h3>恢復項目進行？</h3>
    <p style="font-size:14px">「${escHtml(p.code)}｜${escHtml(p.name)}」將由暫停恢復為可推進狀態。</p>
    <label>備註（選填）</label><textarea id="pl-resume-note" placeholder="可留空"></textarea>
    <div class="actions">
      <button class="btn sm gray" onclick="closeModal()">取消</button>
      <button class="btn sm green" data-call="confirmResumeProject" data-arg0="${escHtml(String(pid))}">確認恢復</button>
    </div>`);
}
function confirmResumeProject(pid){
  const p = projects.find(x=>x.id===pid);
  if(!p || !isAdmin()) return;
  const note = ((document.getElementById('pl-resume-note')||{}).value||'').trim();
  p.status = '進行中';
  p.statusReason = note || '';
  p.statusChangedAt = nowStr();
  p.statusChangedBy = currentUser.id;
  addProjLog(p,'恢復項目', note || '暫停 → 進行中');
  persistProjects();
  closeModal();
  render();
}
function exportProjectsCsv(type){
  const list = sortProjectsNewestFirst(projects.filter(p=>p.type===type));
  const header = ['建立日期','產品編號','項目簡介','類別','類型','目前階段','狀態','完成進度%','負責人','預計完成','項目詳細'];
  const rows = list.map(p=>[
    p.created||'', p.code||'', p.name||'', p.cat||'',
    p.type==='dev'?'開發及生產':'補貨',
    currentStage(p), projStatus(p), String(projProgress(p)),
    userName(p.owner), p.due||'', (p.desc||'').replace(/\r?\n/g,' ')
  ]);
  const esc = v=>{
    const s = String(v==null?'':v);
    if(/[",\n\r]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
    return s;
  };
  const csv = '\uFEFF'+[header].concat(rows).map(r=>r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  const stamp = dailyTodayStr ? dailyTodayStr() : new Date().toISOString().slice(0,10);
  a.href = URL.createObjectURL(blob);
  a.download = (type==='dev'?'開發及生產':'補貨')+'_項目_'+stamp+'.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  addModuleLog(type==='rep'?'replenishment':'production','匯出資料','CSV｜'+list.length+' 筆');
}

/* ── 工作流程分頁 ── */
function tabFlow(p){
  const curName = currentStage(p);
  const lockedBanner = isProjectLocked(p)
    ? `<div class="info-banner" style="margin-bottom:12px">🔒 項目「${escHtml(p.status)}」中，無法推進階段。${p.status==='暫停'&&isAdmin()?' 可於概覽按「恢復進行」。':''}</div>`
    : '';
  return lockedBanner + p.stages.map((s,i)=>{
    const done = stageDone(s);
    const isCur = s.name===curName && !done;
    const mine = canOperateStage(p,s);
    let numCls = done?'done':isCur?'current':'';
    let actions = '';
    if(isProjectLocked(p)){
      // 鎖定時不顯示推進按鈕
    } else if(!isAdmin() && isStageHandler(s, currentUser.id)){
      if(['未開始','待處理'].includes(s.status)) actions += `<button class="btn sm" data-call="stageAction" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}" data-arg2="start">開始處理</button>`;
      if(['進行中','需要修改'].includes(s.status)) actions += `<button class="btn green sm" data-call="stageAction" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}" data-arg2="submit">提交確認</button>`;
      if(!done) actions += `<button class="btn purple sm" data-call="askUpload" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">上載文件／圖片</button>
        <button class="btn gray sm" data-call="askContent" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">填寫工作內容</button>`;
    }
    else if(isAdmin()){
      // 經理／主管被指派為經手人時，也可直接推進自己的階段
      if(isStageHandler(s, currentUser.id)){
        if(['未開始','待處理'].includes(s.status)) actions += `<button class="btn sm" data-call="stageAction" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}" data-arg2="start">開始處理</button>`;
        if(['進行中','需要修改'].includes(s.status)) actions += `<button class="btn green sm" data-call="stageAction" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}" data-arg2="submit">提交確認</button>`;
        if(!done) actions += `<button class="btn purple sm" data-call="askUpload" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">上載文件／圖片</button>
          <button class="btn gray sm" data-call="askContent" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">填寫工作內容</button>`;
      }
      if(s.status==='待確認') actions += `<button class="btn green sm" data-call="stageAction" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}" data-arg2="confirm">✓ 確認完成</button>
        <button class="btn red sm" data-call="askReturn" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">退回修改</button>`;
      if(!done && s.status!=='待確認') actions += `<button class="btn purple sm" data-call="askSkip" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">跳過（直接下一階段）</button>`;
      actions += `<button class="btn gray sm" data-call="askReassign" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}">重新分配經手人</button>`;
      if(s.status==='已完成') actions += `<button class="btn warn sm" data-call="stageAction" data-arg0="${escHtml(String(p.id))}" data-arg1="${i}" data-arg2="reopen">重新開啟</button>`;
    }
    return `<div class="stage ${isCur?'current-stage':''}">
      <div class="stage-head" onclick="this.nextElementSibling.classList.toggle('hidden')">
        <div class="stage-num ${numCls}">${done?'✓':i+1}</div>
        <div class="stage-name">${s.name}</div>
        <span class="tag dept">👤 ${escHtml(stageHandlersLabel(s))}</span>
        ${s.deadline?`<span style="font-size:12px;color:#888">⏰ ${s.deadline}</span>`:''}
        ${stTag(s.status)}
      </div>
      <div class="stage-body ${isCur||s.status==='待確認'?'':'hidden'}">
        ${s.content?`<div class="row">📋 工作內容：<span style="white-space:pre-wrap">${s.content}</span></div>`:''}
        ${s.completedAt?`<div class="row">✅ 完成日期：${s.completedAt}</div>`:''}
        ${s.skipReason?`<div class="row">⏭ 跳過原因：${s.skipReason}</div>`:''}
        ${s.returnReason?`<div class="row" style="color:#c62828">↩️ 退回原因：${s.returnReason}</div>`:''}
        ${s.files.length?`<div class="row">📎 文件：${s.files.map(f=>fileLinkHtml(f, f.name+(f.latest?' ✅':''))).join('、 ')}</div>`:''}
        ${!mine&&!isAdmin()?'<div class="row" style="color:#8d6e00">🔒 此階段由 '+escHtml(stageHandlersLabel(s))+' 負責，你只可查看。</div>':''}
        <div class="actions-row">${actions}</div>
      </div>
    </div>`;
  }).join('');
}

function projectAllHandlerIds(p){
  const ids = [];
  (p && p.stages || []).forEach(function(s){
    stageHandlers(s).forEach(function(id){
      const sid = String(id||'');
      if(sid && ids.indexOf(sid)<0) ids.push(sid);
    });
  });
  return ids;
}
async function notifyProjectStageTurn(p, stageName, reason){
  if(!apiEnabled || !authToken || !currentUser || !p) return;
  const recipientIds = projectAllHandlerIds(p);
  if(!recipientIds.length) return;
  const typeLabel = p.type==='rep' ? '補貨' : '開發及生產';
  const title = typeLabel+'：'+(p.code||'')+'｜目前階段 '+(stageName||'');
  const body = (reason||'項目階段已更新')+'\n\n'
    +'類型：'+typeLabel+'\n'
    +'編號：'+(p.code||'')+'\n'
    +'項目：'+(p.name||'')+'\n'
    +'目前階段：'+(stageName||'')+'\n'
    +'操作人：'+(currentUser.name||currentUser.login||'')+'\n'
    +'時間：'+nowStr();
  try{
    await apiFetch('/api/notifications', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        cat: 'general',
        category: typeLabel,
        priority: '重要',
        title: title,
        summary: typeLabel+'｜'+(p.code||'')+'｜'+(stageName||''),
        content: body,
        recipientIds: recipientIds,
        recipientDesc: '項目經手人 '+recipientIds.length+' 人',
        startDate: todayStr(),
        endDate: todayStr(),
        pinned: false
      })
    });
    await loadNotifications();
    refreshMailboxUi();
  }catch(e){
    console.warn('notify project stage', e);
  }
}
function stageAction(pid, idx, act){
  if(isManager()){ alert2('一般管理層只可監督查看，不可推進階段。'); return; }
  if(['confirm','reopen'].includes(act) && !isAdmin()){ alert2('只有系統管理員可以確認或重開。'); return; }
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法推進階段。'); return; }
  if(act==='start'){ s.status='進行中'; addProjLog(p,'開始處理', s.name+' → 進行中'); }
  if(act==='submit'){ s.status='待確認'; s.returnReason=''; addProjLog(p,'提交確認', s.name+' → 待確認'); }
  if(act==='confirm'){
    s.status='已完成'; s.completedAt=todayStr();
    addProjLog(p,'確認完成', s.name+'｜經手人：'+stageHandlersLabel(s));
    const next = (p.stages||[]).find(function(x){ return !stageDone(x); });
    if(next){
      notifyProjectStageTurn(p, next.name, '上一階段「'+s.name+'」已確認完成，目前輪到新階段。')
        .catch(function(e){ console.warn(e); });
    }
  }
  if(act==='reopen'){ s.status='進行中'; s.completedAt=null; addProjLog(p,'重新開啟階段', s.name); }
  render();
}
function askReturn(pid, idx){
  if(!isAdmin()){ alert2('只有系統管理員可以退回修改。'); return; }
  const p0 = projects.find(x=>x.id===pid);
  if(isProjectLocked(p0)){ alert2('項目已「'+p0.status+'」，無法退回。'); return; }
  showModal(`<h3>退回修改</h3><label>退回原因（選填）</label><input type="text" id="m-reason" placeholder="可留空">
    <div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>
    <button class="btn red sm" data-call="doReturn" data-arg0="${escHtml(String(pid))}" data-arg1="${idx}">確認退回</button></div>`);
}
function doReturn(pid, idx){
  const r = document.getElementById('m-reason').value.trim();
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法退回。'); return; }
  s.status='需要修改'; s.returnReason=r;
  addProjLog(p,'退回修改', s.name+(r?'｜原因：'+r:''));
  closeModal(); render();
}
function askSkip(pid, idx){
  if(!isAdmin()){ alert2('只有系統管理員可以跳過階段。'); return; }
  const p0 = projects.find(x=>x.id===pid);
  if(isProjectLocked(p0)){ alert2('項目已「'+p0.status+'」，無法跳過。'); return; }
  showModal(`<h3>跳過此階段（直接下一階段）</h3>
    <p style="font-size:13px;color:#888">例如：沿用上一批最終確認樣板，產品規格沒有修改。</p>
    <label>跳過原因（選填）</label><input type="text" id="m-reason" placeholder="可留空">
    <div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>
    <button class="btn purple sm" data-call="doSkip" data-arg0="${escHtml(String(pid))}" data-arg1="${idx}">確認跳過</button></div>`);
}
function doSkip(pid, idx){
  const r = document.getElementById('m-reason').value.trim();
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法跳過。'); return; }
  s.status='直接下一階段'; s.skipReason=r; s.completedAt=todayStr();
  addProjLog(p,'跳過階段', s.name+(r?'｜原因：'+r:''));
  const next = (p.stages||[]).find(function(x){ return !stageDone(x); });
  if(next){
    notifyProjectStageTurn(p, next.name, '上一階段「'+s.name+'」已跳過，目前輪到新階段。')
      .catch(function(e){ console.warn(e); });
  }
  closeModal(); render();
}
function askReassign(pid, idx){
  if(!isAdmin()){ alert2('只有系統管理員可以重新分配經手人。'); return; }
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法重新分配。'); return; }
  showModal(`<h3>重新分配經手人（可多選）</h3>
    <p style="font-size:13px">階段：<b>${s.name}</b>｜現時：<b>${escHtml(stageHandlersLabel(s))}</b></p>
    <p style="font-size:12px;color:#888;margin:4px 0 8px">僅可選經理／主管，可同時勾選多人。</p>
    <label>經手人</label>
    <div id="m-handler-box">${projectAssigneeChecksHtml(stageHandlers(s), 'm-handler-cb')}</div>
    <label>更改原因（選填）</label><input type="text" id="m-reason" placeholder="可留空">
    <div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>
    <button class="btn sm" data-call="doReassign" data-arg0="${escHtml(String(pid))}" data-arg1="${idx}">確認更改</button></div>`);
}
function doReassign(pid, idx){
  const r = document.getElementById('m-reason').value.trim();
  const nh = readCheckedHandlerIds('#m-handler-box', 'm-handler-cb');
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法重新分配。'); return; }
  const before = stageHandlersLabel(s);
  setStageHandlers(s, nh);
  addProjLog(p,'更改經手人', s.name+'：'+before+' → '+stageHandlersLabel(s)+(r?'｜原因：'+r:'')+'（系統已通知相關經手人）');
  persistProjects();
  closeModal(); render();
}
function askContent(pid, idx){
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法更新工作內容。'); return; }
  showModal(`<h3>填寫工作內容</h3><p style="font-size:13px">階段：<b>${s.name}</b></p>
    <label>工作內容</label><textarea id="m-content">${escHtml(s.content||'')}</textarea>
    <div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>
    <button class="btn sm" data-call="doContent" data-arg0="${escHtml(String(pid))}" data-arg1="${idx}">儲存</button></div>`);
}
function doContent(pid, idx){
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法更新工作內容。'); return; }
  s.content = document.getElementById('m-content').value.trim();
  addProjLog(p,'更新工作內容', s.name);
  closeModal(); render();
}
function askUpload(pid, idx){
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法上載文件。'); return; }
  showModal(`<h3>上載文件／圖片</h3><p style="font-size:13px">階段：<b>${s.name}</b>｜支援 JPG、PNG、PDF、Word、Excel、ZIP 等</p>
    <label>選擇檔案</label><input type="file" id="m-file">
    <div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>
    <button class="btn purple sm" data-call="doUpload" data-arg0="${escHtml(String(pid))}" data-arg1="${idx}">上載</button></div>`);
}
async function doUpload(pid, idx){
  const p = projects.find(x=>x.id===pid), s = p.stages[idx];
  if(isProjectLocked(p)){ alert2('項目已「'+p.status+'」，無法上載文件。'); return; }
  const fi = document.getElementById('m-file');
  const picked = fi.files && fi.files[0] ? fi.files[0] : null;
  if(!picked){ alert2('請選擇要上載的檔案。'); return; }
  let name = picked.name;
  let uploaded;
  try{
    uploaded = await cloudUploadFile(picked);
  }catch(e){ alert2('上載失敗：'+(e.message||e)); return; }
  s.files.forEach(f=>f.latest=false);
  const ver = 'V'+(s.files.length+1);
  s.files.push({name:uploaded.name||name, by:currentUser.id, time:nowStr(), ver, latest:true, dataUrl:uploaded.dataUrl, driveFileId:uploaded.driveFileId, mimeType:uploaded.mimeType});
  addProjLog(p,'上載文件', s.name+'｜'+(uploaded.name||name)+'（'+ver+'）');
  closeModal(); render();
}

/* ── 文件分頁 ── */
function tabFiles(p){
  const all = [];
  (p.files||[]).forEach(f=>all.push({...ensureFilePayload(f), stage:'建立項目'}));
  p.stages.forEach(s=>(s.files||[]).forEach(f=>all.push({...ensureFilePayload(f), stage:s.name})));
  return `<div class="info-banner">📁 同一份文件可有多個版本，舊版本會保留，系統標示最新版本。點擊檔名或下載可開啟／儲存。建立項目時的附件標示為「建立項目」；工作流程／今日工作上傳的附件依階段顯示。</div>
    ${all.length? all.map(f=>`<div class="file-item">
      <span>📎</span>${fileLinkHtml(f, f.name)}
      <span class="tag s-pending">${f.stage}</span><span class="tag dept">${f.ver||''}</span>
      ${f.latest?'<span class="latest-badge">最新版本</span>':''}
      <span class="fmeta">上載人：${userName(f.by)}｜${f.time}</span>
      <a class="btn gray sm" style="display:inline-block;text-decoration:none;color:#fff" href="${fileHref(f)}" download="${(f.name||'file').replace(/"/g,'')}" target="_blank" rel="noopener">下載</a>
    </div>`).join('') : '<p style="color:#888">此項目暫無文件。</p>'}`;
}

/* ── 留言板分頁 ── */
function commentFileHtml(file){
  if(!file) return '';
  const f = ensureFilePayload(typeof file==='string'?{name:file}:file);
  return `<div class="mfile">${fileLinkHtml(f, '📎 附件：'+f.name)}</div>`;
}
function tabChat(p){
  const stageOpts = ['整體項目', ...p.stages.map(s=>s.name)];
  let comments = p.comments;
  if(commentFilter!=='全部') comments = comments.filter(c=>c.stage===commentFilter);
  return `<div class="info-banner">💬 此留言板只顯示「${p.code} ${p.name}」的相關溝通。留言不代表工作完成，經手人仍需在工作流程更新狀態。輸入 @ 可選擇提及同事；自己的留言可刪除。</div>
    <div class="filters"><span style="font-size:13px;color:#888;align-self:center">按階段篩選：</span>
      <select onchange="commentFilter=this.value;render()">
        <option ${commentFilter==='全部'?'selected':''}>全部</option>
        ${stageOpts.map(s=>`<option ${commentFilter===s?'selected':''}>${s}</option>`).join('')}
      </select></div>
    ${comments.length? comments.map((c)=>{
      const realIdx = p.comments.indexOf(c);
      const canDelete = c.by===currentUser.id || isAdmin();
      const removedLabel = c.removedBy==='self'
        ? '此留言已由發表人刪除。'
        : '此留言已由管理層移除。（原始記錄保留供管理層查閱）';
      return `<div class="msg">
      ${c.removed? `<div class="removed">${removedLabel}</div>` : `
      <div class="mhead"><span class="mname">${userName(c.by)}</span><span class="tag dept">${userDept(c.by)}</span>
        <span class="mtime">${c.time}</span><span class="tag s-pending">${c.stage}</span></div>
      <div class="mbody">${fmtMention(c.text)}</div>
      ${commentFileHtml(c.file)}
      ${(c.replies||[]).map((r,ri)=>`<div class="reply"><div class="mhead"><span class="mname">${userName(r.by)}</span>
        <span class="mtime">${r.time}</span>
        ${(r.by===currentUser.id||isAdmin())&&!r.removed?`<button class="btn red sm" style="margin-left:auto" data-call="removeReply" data-arg0="${escHtml(String(p.id))}" data-arg1="${realIdx}" data-arg2="${ri}">刪除</button>`:''}
        </div>
        ${r.removed?'<div class="removed">此回覆已刪除。</div>':`<div class="mbody">${fmtMention(r.text)}</div>`}
      </div>`).join('')}
      <div class="actions-row">
        <button class="btn gray sm" data-call="askReply" data-arg0="${escHtml(String(p.id))}" data-arg1="${realIdx}">回覆</button>
        ${canDelete?`<button class="btn red sm" data-call="removeComment" data-arg0="${escHtml(String(p.id))}" data-arg1="${realIdx}">${c.by===currentUser.id?'刪除留言':'移除留言'}</button>`:''}
      </div>`}
    </div>`;}).join('') : '<p style="color:#888;margin-bottom:12px">暫無留言。</p>'}
    <div class="card" style="background:#f7f9fc;margin-top:14px">
      <h3>✏️ 發表新留言</h3>
      <label>相關工作階段</label>
      <select id="c-stage">${stageOpts.map(s=>`<option>${s}</option>`).join('')}</select>
      <label>留言內容（輸入 @ 選擇同事）</label>
      <textarea id="c-text" placeholder="輸入留言內容… 可用 @ 提及同事"></textarea>
      <label>附件（選填）</label>
      <input type="file" id="c-file">
      <button class="btn" data-call="postComment" data-arg0="${escHtml(String(p.id))}">發表留言</button>
    </div>`;
}
async function postComment(pid){
  const p = projects.find(x=>x.id===pid);
  const text = document.getElementById('c-text').value.trim();
  if(!text){ alert2('請輸入留言內容。'); return; }
  const stage = document.getElementById('c-stage').value;
  const fi = document.getElementById('c-file');
  let file = null;
  if(fi.files && fi.files[0]){
    const picked = fi.files[0];
    try {
      const up = await cloudUploadFile(picked);
      file = {name:up.name||picked.name, dataUrl:up.dataUrl, driveFileId:up.driveFileId, mimeType:up.mimeType};
    } catch(e){ alert2('讀取／上載附件失敗：'+(e.message||e)); return; }
  }
  p.comments.unshift({by:currentUser.id, time:nowStr(), stage, text, file, removed:false, removedBy:null, replies:[]});
  addProjLog(p,'發表留言', stage+'｜'+text.slice(0,30)+(text.length>30?'…':''));
  const mentions = text.match(/@([^\s@，,。]+)/g);
  if(mentions) addProjLog(p,'留言提及通知', mentions.join('、')+' 將收到系統通知');
  render();
}
function askReply(pid, idx){
  showModal(`<h3>回覆留言</h3><label>回覆內容（輸入 @ 選擇同事）</label><textarea id="m-reply"></textarea>
    <div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>
    <button class="btn sm" data-call="doReply" data-arg0="${escHtml(String(pid))}" data-arg1="${idx}">回覆</button></div>`);
  setTimeout(()=> bindMentionInput('m-reply'), 0);
}
function doReply(pid, idx){
  const text = document.getElementById('m-reply').value.trim();
  if(!text){ alert2('請輸入回覆內容。'); return; }
  const p = projects.find(x=>x.id===pid);
  p.comments[idx].replies.push({by:currentUser.id, time:nowStr(), text, removed:false});
  addProjLog(p,'回覆留言', text.slice(0,30));
  closeModal(); render();
}
function removeComment(pid, idx){
  const p = projects.find(x=>x.id===pid);
  const c = p.comments[idx];
  if(!c) return;
  if(c.by!==currentUser.id && !isAdmin()){ alert2('只能刪除自己的留言。'); return; }
  c.removed = true;
  c.removedBy = c.by===currentUser.id ? 'self' : 'admin';
  addProjLog(p, c.removedBy==='self'?'刪除自己的留言':'移除留言', '留言人：'+userName(c.by));
  render();
}
function removeReply(pid, cIdx, rIdx){
  const p = projects.find(x=>x.id===pid);
  const r = p.comments[cIdx] && p.comments[cIdx].replies[rIdx];
  if(!r) return;
  if(r.by!==currentUser.id && !isAdmin()){ alert2('只能刪除自己的回覆。'); return; }
  r.removed = true;
  addProjLog(p,'刪除回覆', '回覆人：'+userName(r.by));
  render();
}

/* ── 操作記錄分頁 ── */
function tabLogs(p){
  return `<div class="table-wrap"><table><tr><th>時間</th><th>操作人員</th><th>操作</th><th>詳情</th></tr>
    ${p.logs.map(l=>`<tr><td style="font-size:11px;white-space:nowrap">${l.time}</td><td>${l.user}</td><td><b>${l.action}</b></td><td style="font-size:12px">${l.detail}</td></tr>`).join('')}
  </table></div>`;
}

/* ═══════════ 建立項目（管理層） ═══════════ */
let npDraftFiles = []; // {name, dataUrl}
let npCoverDraft = null; // {name, dataUrl} | null

function npCoverPreviewHtml(){
  if(!npCoverDraft) return '<p style="font-size:12px;color:#888;margin:6px 0">未選擇封面（將使用預設圖示）。</p>';
  return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0">
    <div class="thumb" style="width:64px;height:64px"><img src="${npCoverDraft.dataUrl}" alt=""></div>
    <div style="font-size:13px">${String(npCoverDraft.name||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
      <div><button type="button" class="btn gray sm" onclick="npClearCover()">清除封面</button></div>
    </div></div>`;
}
function npFileListHtml(){
  if(!npDraftFiles.length) return '<p style="font-size:12px;color:#888;margin:6px 0">尚未添加附件。</p>';
  return `<div style="margin:8px 0">${npDraftFiles.map((f,i)=>`
    <div class="file-item" style="margin-bottom:6px">
      <span>📎</span><span>${String(f.name||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>
      <button type="button" class="btn red sm" onclick="npRemoveDraftFile(${i})">移除</button>
    </div>`).join('')}</div>`;
}
function npRenderCoverPreview(){
  const el=document.getElementById('np-cover-preview');
  if(el) el.innerHTML=npCoverPreviewHtml();
}
function npRenderFileList(){
  const el=document.getElementById('np-file-list');
  if(el) el.innerHTML=npFileListHtml();
}
function npClearCover(){
  npCoverDraft=null;
  const input=document.getElementById('np-cover');
  if(input) input.value='';
  npRenderCoverPreview();
}
function npRemoveDraftFile(i){
  npDraftFiles.splice(i,1);
  npRenderFileList();
}
async function npOnCoverPick(input){
  const f=input.files&&input.files[0];
  if(!f) return;
  if(!(f.type||'').startsWith('image/')){
    alert2('封面請選擇圖片檔（JPG／PNG／GIF／WebP）。');
    input.value='';
    return;
  }
  try{
    npCoverDraft={name:f.name, dataUrl:await readFileAsDataUrl(f)};
    npRenderCoverPreview();
  }catch(e){ alert2('讀取封面失敗，請重試。'); input.value=''; }
}
async function npOnFilesPick(input){
  const files=input.files;
  if(!files||!files.length) return;
  try{
    for(let i=0;i<files.length;i++){
      const f=files[i];
      npDraftFiles.push({name:f.name, dataUrl:await readFileAsDataUrl(f)});
    }
  }catch(e){ alert2('讀取附件失敗，請重試。'); }
  input.value='';
  npRenderFileList();
}
function vAddProject(){
  if(!isAdmin()) return `<div class="card"><h2>➕ 建立新項目</h2><p>只有系統管理員可以建立項目。</p></div>`;
  const staffOpts = projectAssigneeOpts('');
  const staffHint = listAssignableStaff().length
    ? '<p style="font-size:12px;color:#888;margin:4px 0 0">各階段經手人僅可選<strong>經理／主管</strong>，可多選；對方可在「我的工作」看到待辦。</p>'
    : '<p style="font-size:12px;color:#c62828;margin:4px 0 0">尚未有經理／主管賬號。請先到「創建員工」新增職位為「經理」或「主管」的賬號。</p>';
  setTimeout(()=>{ renderNpStages(); npRenderCoverPreview(); npRenderFileList(); },0);
  return `<div class="card"><h2>➕ 建立新項目</h2>
    <label>項目封面圖片（選填）</label>
    <input type="file" id="np-cover" accept="image/*" onchange="npOnCoverPick(this)">
    <div id="np-cover-preview">${npCoverPreviewHtml()}</div>
    <label>項目類型</label>
    <select id="np-type" onchange="renderNpStages()">
      <option value="dev">開發及生產（7個階段）</option>
      <option value="rep">補貨（6個階段）</option>
    </select>
    <label>產品編號</label><input type="text" id="np-code" placeholder="例如：WS-666">
    <label>項目簡介</label><input type="text" id="np-name" placeholder="例如：成人抓毛套裝">
    <label>產品類別</label><select id="np-cat">${CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select>
    <label>項目詳細內容（支援分行）</label><textarea id="np-desc" placeholder="• 要求一&#10;• 要求二"></textarea>
    <label>項目負責人（經理／主管）</label><select id="np-owner">${staffOpts}</select>
    <label>預計完成日期</label><input type="date" id="np-due">
    <label>項目附件（可多次添加、可多選）</label>
    <input type="file" id="np-files" multiple onchange="npOnFilesPick(this)">
    <p style="font-size:12px;color:#888;margin:4px 0 0">附件會顯示在項目「文件及圖片」，標籤為「建立項目」。封面只用於列表／標題縮圖，不進文件列表。</p>
    <div id="np-file-list">${npFileListHtml()}</div>
    <h3 style="margin-top:16px">各階段經手人分配（經理／主管，可多選）</h3>
    ${staffHint}
    <div id="np-stages"></div>
    <button class="btn" onclick="askCreateProject()">建立項目</button>
  </div>`;
}
function renderNpStages(){
  const typeEl=document.getElementById('np-type');
  if(!typeEl) return;
  const type = typeEl.value;
  const stages = type==='dev'?DEV_STAGES:REP_STAGES;
  document.getElementById('np-stages').innerHTML = stages.map((s,i)=>`
    <div class="np-stage-row" style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap">
      <span style="min-width:140px;font-size:13px;padding-top:6px"><b>${i+1}. ${s}</b></span>
      <div class="np-handler-box" data-stage="${i}">${projectAssigneeChecksHtml([], 'np-handler-cb')}</div>
    </div>`).join('');
}
function askCreateProject(){
  if(!isAdmin()){ alert2('只有系統管理員可以建立項目。'); return; }
  if(!requireCloud('建立項目')) return;
  const type = document.getElementById('np-type').value;
  const code = document.getElementById('np-code').value.trim();
  const name = document.getElementById('np-name').value.trim();
  if(!code||!name){ alert2('請輸入產品編號及項目簡介。'); return; }
  const typeLabel = type==='dev'?'開發及生產':'補貨';
  const stages = (type==='dev'?DEV_STAGES:REP_STAGES);
  const coverNote = npCoverDraft ? '已選封面' : '無封面';
  const fileNote = npDraftFiles.length ? ('附件 '+npDraftFiles.length+' 個') : '無附件';
  showModal(
    '<h3>確認建立項目？</h3>'+
    '<p style="font-size:14px">即將建立：</p>'+
    '<ul style="font-size:13px;line-height:1.7;margin:8px 0 12px 18px">'+
      '<li>類型：'+typeLabel+'（'+stages.length+' 個階段）</li>'+
      '<li>編號／簡介：<b>'+String(code).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'｜'+String(name).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</b></li>'+
      '<li>'+coverNote+'｜'+fileNote+'</li>'+
    '</ul>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">返回修改</button>'+
    '<button class="btn sm" onclick="createProject()">確認建立</button></div>'
  );
}
async function createProject(){
  if(!isAdmin()){ alert2('只有系統管理員可以建立項目。'); return; }
  if(!requireCloud('建立項目')) return;
  const type = document.getElementById('np-type').value;
  const code = document.getElementById('np-code').value.trim();
  const name = document.getElementById('np-name').value.trim();
  if(!code||!name){ alert2('請輸入產品編號及項目簡介。'); return; }
  const cat = document.getElementById('np-cat').value;
  const desc = document.getElementById('np-desc').value.trim();
  const owner = document.getElementById('np-owner').value;
  const due = document.getElementById('np-due').value || '—';
  const stages = (type==='dev'?DEV_STAGES:REP_STAGES);
  const handlerBoxes = [...document.querySelectorAll('.np-handler-box')];
  const handlers = stages.map((_, i)=>{
    const box = handlerBoxes.find(b=>String(b.getAttribute('data-stage'))===String(i)) || handlerBoxes[i];
    return box ? readCheckedHandlerIds(box, 'np-handler-cb') : [];
  });
  const assignedN = handlers.filter(hs=>hs && hs.length).length;
  let coverUrl = null, coverFileId = null;
  let files = [];
  try{
    if(npCoverDraft){
      const up = await cloudUploadDataUrl(npCoverDraft.name, npCoverDraft.dataUrl);
      coverUrl = up.dataUrl; coverFileId = up.driveFileId || null;
    }
    for(let i=0;i<npDraftFiles.length;i++){
      const f = npDraftFiles[i];
      const up = await cloudUploadDataUrl(f.name, f.dataUrl);
      files.push({
        name:up.name||f.name, dataUrl:up.dataUrl, driveFileId:up.driveFileId, mimeType:up.mimeType,
        by:currentUser.id, time:nowStr(), ver:'V'+(i+1), latest:i===npDraftFiles.length-1
      });
    }
  }catch(e){ alert2('上傳封面／附件失敗：'+(e.message||e)); return; }
  const p = {
    id: type==='rep'
      ? ('R'+String(repProjSeq++).padStart(3,'0'))
      : ('P'+String(projSeq++).padStart(3,'0')),
    type, code, name, cat, icon:type==='dev'?'🆕':'🔄',
    coverUrl, coverFileId,
    owner: owner||null, createdBy:currentUser.id, created:todayStr(), createdAtMs: Date.now(), due, desc, status:'進行中',
    files: files,
    stages: stages.map((s,i)=>mkStage(s, handlers[i]||[], i===0?'待處理':'未開始')),
    comments:[], logs:[]
  };
  projects.unshift(p);
  addProjLog(p,'建立項目',(type==='dev'?'開發及生產':'補貨')+'｜'+code+'｜'+name+(p.coverUrl?'｜已設封面':'')+(files.length?'｜附件 '+files.length+' 個':''));
  addProjLog(p,'分配經手人', assignedN
    ? ('已指派 '+assignedN+'／'+stages.length+' 個階段（經理／主管可於「我的工作」處理）')
    : '尚未指派經手人（請稍後在工作流程中更改經手人）');
  if(files.length) addProjLog(p,'上載文件','建立項目｜'+files.map(f=>f.name).join('、'));
  npDraftFiles=[]; npCoverDraft=null;
  try{
    await persistProjectsNow();
  }catch(e){
    noteCloudError(e);
    alert2('項目已建立於記憶體，但雲端同步失敗：'+(e.message||e));
    return;
  }
  const firstStage = p.stages && p.stages[0];
  if(firstStage){
    try{
      await notifyProjectStageTurn(p, firstStage.name, '項目已建立，目前為第一階段。');
    }catch(_e){}
  }
  showModal(`<h3>✅ 已建立項目</h3><p>「${code}｜${name}」已建立並同步到雲端，共 ${stages.length} 個階段${files.length?'，附件 '+files.length+' 個':''}。</p>
    <div class="actions"><button class="btn sm" onclick="closeModal();openProject('${p.id}','files')">查看文件及圖片</button>
    <button class="btn gray sm" onclick="closeModal();openProject('${p.id}','flow')">查看工作流程</button></div>`);
}

/* ═══════════ 模組操作記錄（僅顯示當前模組） ═══════════ */
function vSysLogs(){
  const mod = currentModule === 'replenishment' ? 'replenishment' : 'production';
  const type = mod === 'replenishment' ? 'rep' : 'dev';
  const title = mod === 'replenishment' ? '補貨' : '開發及生產';
  const fromModule = (moduleLogs[mod] || []).slice();
  // 種子項目既有 logs：只併入本模組類型，避免跨模組混雜
  const fromProjects = projects
    .filter(p => p.type === type)
    .flatMap(p => (p.logs || []).map(l => ({
      time: l.time,
      user: l.user,
      action: l.action,
      detail: p.code + '｜' + (l.detail || ''),
      _seed: true
    })));
  // moduleLogs 已含執行期 addProjLog；種子用 fromProjects 補齊。去重：同時間+操作+詳情
  const seen = new Set();
  const all = [];
  [...fromModule, ...fromProjects].forEach(l => {
    const key = [l.time, l.user, l.action, l.detail].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    all.push(l);
  });
  return `<div class="card"><h2>📜 ${title}｜操作記錄</h2>
    <p style="font-size:13px;color:#666;margin-bottom:10px">只顯示「${title}」模組內的操作，不含每日工作或其他模組。</p>
    ${all.length ? `<div class="table-wrap"><table><tr><th>時間</th><th>操作人員</th><th>操作</th><th>詳情</th></tr>
    ${all.map(l=>`<tr><td style="font-size:11px;white-space:nowrap">${l.time}</td><td>${l.user}</td><td><b>${l.action}</b></td><td style="font-size:12px">${l.detail}</td></tr>`).join('')}
    </table></div>` : '<p style="color:#888">此模組暫無操作記錄。</p>'}
  </div>`;
}

/* ═══════════ Part 1 每日工作流程（localStorage v2） ═══════════ */
var DAILY_KEY='store-web-daily-v6';
var DAILY_DIRTY_KEY='store-web-daily-v6-dirty';
var FIXED_UNITS=['觀塘','荔枝角','灣仔','屯門'];
var STORE_UNITS=['觀塘','荔枝角','灣仔','屯門','國內倉'];
var PRIORITIES=['高','中','低'];
var dailyUnitFilter='全部';
var dailyHistoryUnit='全部';
var dailyHistoryStatus='全部';
var dailyHistoryKw='';
var dailyHistoryFrom='';
var dailyHistoryTo='';
var dailyProgressUnit=null;
var dailyStateCache=null;
var dailyPersistSeq=0;

function dailyMergeById(cloudArr, localArr){
  var m={};
  function prefer(a,b){
    if(!a) return b;
    if(!b) return a;
    // 已完成優先於未完成，避免雲端舊 open 蓋掉本機／較新的 done（剔選消失）
    if(a.status==='done' && b.status!=='done') return a;
    if(b.status==='done' && a.status!=='done') return b;
    var ta=String(a.updatedAt||a.completedAt||'');
    var tb=String(b.updatedAt||b.completedAt||'');
    return tb.localeCompare(ta)>=0 ? b : a;
  }
  (cloudArr||[]).forEach(function(x){
    if(!x||x.id==null) return;
    var id=String(x.id);
    m[id]=prefer(m[id], x);
  });
  (localArr||[]).forEach(function(x){
    if(!x||x.id==null) return;
    var id=String(x.id);
    m[id]=prefer(m[id], x);
  });
  return Object.keys(m).map(function(k){ return m[k]; });
}
function dailyOpLogKey(l){
  return String((l&&l.time)||'')+'|'+String((l&&(l.userId||l.user))||'')+'|'+String((l&&l.action)||'')+'|'+String((l&&l.detail)||'');
}
function dailyMergeOpLogs(cloudArr, localArr){
  var m={};
  (cloudArr||[]).forEach(function(l){ m[dailyOpLogKey(l)]=l; });
  (localArr||[]).forEach(function(l){ m[dailyOpLogKey(l)]=l; });
  return Object.keys(m).map(function(k){ return m[k]; })
    .sort(function(a,b){ return String((b&&b.time)||'').localeCompare(String((a&&a.time)||'')); })
    .slice(0,500);
}
/** 合併雲端與本機：保留尚未成功同步的新建恆常／突發任務。 */
function mergeDailyStates(cloudRaw, localRaw){
  var cloud=dailyNormalizeState(cloudRaw);
  var local=dailyNormalizeState(localRaw);
  return {
    version:2,
    works:dailyMergeById(cloud.works, local.works),
    recurringTemplates:dailyMergeById(cloud.recurringTemplates, local.recurringTemplates),
    opLogs:dailyMergeOpLogs(cloud.opLogs, local.opLogs)
  };
}

function dailyTodayStr(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function dailyNowStr(){ return typeof nowStr==='function'?nowStr():new Date().toLocaleString('zh-HK'); }
function dailyUserId(user){ user=user||currentUser; return user?String(user.id):'system'; }
function dailyUserName(user){ user=user||currentUser; return user?user.name:'系統'; }
function dailyUserUnits(user){ user=user||currentUser; return userUnits(user); }
function dailyUserUnit(user){ const us=dailyUserUnits(user); return us[0]||null; }
function dailyUserInUnit(user, unit){ return dailyUserUnits(user).indexOf(unit)>=0; }
function dailyCanManage(user){ user=user||currentUser; return !!(user&&(user.role==='system_admin'||user.role==='manager')); }
function dailyId(prefix){ return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7); }
function dailyEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function dailyBaseState(){ return {version:2,works:[],recurringTemplates:[],opLogs:[]}; }
function dailyNormalizeState(raw){
  var s=raw&&typeof raw==='object'?raw:dailyBaseState();
  s.version=2;
  s.works=Array.isArray(s.works)?s.works:[];
  s.recurringTemplates=Array.isArray(s.recurringTemplates)?s.recurringTemplates:[];
  s.opLogs=Array.isArray(s.opLogs)?s.opLogs:[];
  return s;
}
function addDailyOpLog(action, detail){
  var s=loadDailyState();
  var snap = actorSnapshot(currentUser);
  s.opLogs.unshift({
    time: dailyNowStr(),
    user: snap.userLabel || dailyUserName(currentUser),
    userId: snap.userId,
    userName: snap.userName,
    userPhone: snap.userPhone,
    action: action,
    detail: detail||''
  });
  if(s.opLogs.length>500) s.opLogs=s.opLogs.slice(0,500);
  saveDailyState(s);
  addModuleLog('daily', action, detail||'');
}
function saveDailyState(next){
  dailyStateCache=dailyNormalizeState(next||dailyStateCache||dailyBaseState());
  dailyPersistSeq += 1;
  try{
    localStorage.setItem(DAILY_KEY,JSON.stringify(dailyStateCache));
    // dirty=1：雲端尚未確認寫入。刷新時若仍為 dirty，會與雲端合併以免新建任務消失。
    localStorage.setItem(DAILY_DIRTY_KEY, '1');
  }catch(e){}
  // 有雲端時寫入 MongoDB（localStorage 僅作快取）
  scheduleDailyCloudSave();
  return dailyStateCache;
}
function loadDailyState(){
  if(dailyStateCache) return dailyStateCache;
  try{
    var raw=localStorage.getItem(DAILY_KEY);
    dailyStateCache=raw?dailyNormalizeState(JSON.parse(raw)):dailyBaseState();
  }catch(e){ dailyStateCache=dailyBaseState(); }
  return dailyStateCache;
}
function mkWork(o){
  var assigneeIds=Array.isArray(o.assigneeIds)?o.assigneeIds.map(String).filter(Boolean).filter(function(id,i,a){ return a.indexOf(id)===i; }):[];
  var assigneeNames=Array.isArray(o.assigneeNames)?o.assigneeNames.slice():assigneeIds.map(function(id){ return userName(id); });
  return {
    id:o.id||dailyId(o.kind||'wrk'),
    title:o.title||'',
    content:o.content||'',
    unit:o.unit,
    kind:o.kind||'adhoc',
    status:o.status||'open',
    dueDate:o.dueDate||dailyTodayStr(),
    priority:o.priority||'中',
    templateId:o.templateId||null,
    requireAttachment:!!o.requireAttachment,
    attachments:Array.isArray(o.attachments)?o.attachments.slice():[],
    descImages:Array.isArray(o.descImages)?o.descImages.slice():[],
    assigneeIds:assigneeIds,
    assigneeNames:assigneeNames,
    completedAt:o.completedAt||null,
    completedBy:o.completedBy||null,
    completedByName:o.completedByName||null,
    createdBy:o.createdBy||'system',
    createdAt:o.createdAt||dailyNowStr(),
    createdDate:o.createdDate||dailyTodayStr(),
    updatedAt:o.updatedAt||dailyNowStr()
  };
}
function workAssigneeIds(w){
  return (w&&Array.isArray(w.assigneeIds))?w.assigneeIds.map(String).filter(Boolean):[];
}
function workAssigneesLabel(w){
  if(!w) return '整單位';
  var ids=workAssigneeIds(w);
  if(!ids.length) return '整單位';
  if(Array.isArray(w.assigneeNames)&&w.assigneeNames.length) return w.assigneeNames.join('、');
  return ids.map(function(id){ return userName(id); }).join('、');
}
/** 可指派完成工作的賬號（所有職位）；可依單位過濾。經理／主管無地區時仍可指派。 */
function listDailyStaffForUnits(units){
  units=Array.isArray(units)?units:[];
  return (users||[]).filter(function(u){
    if(!u || u.active===false) return false;
    if(String(u.login||'').toLowerCase()==='admin' || String(u.id)==='adm') return false;
    if(typeof userNeedsPhoneBind==='function' && userNeedsPhoneBind(u)) return false;
    if(!units.length) return true;
    var us=dailyUserUnits(u);
    if(!us.length) return true; // 未綁地區的管理層仍可出現在名單
    return us.some(function(unit){ return units.indexOf(unit)>=0; });
  }).sort(function(a,b){
    var pa=String(a.position||a.role||'');
    var pb=String(b.position||b.role||'');
    if(pa!==pb) return pa.localeCompare(pb,'zh-Hant');
    return String(a.name||'').localeCompare(String(b.name||''),'zh-Hant');
  });
}
function isStoreUnit(unit){ return FIXED_UNITS.indexOf(unit)>=0; }
function isActiveWork(w){ return w&&w.status!=='cancelled'; }
/**
 * 今日清單：
 * - 未完成：期限為今天，或更早（跨日延續／逾期）
 * - 已完成：期限為今天，或今日才剔選完成（含逾期後今日完成）
 */
function isDailyTodayWork(w){
  if(!isActiveWork(w) || !w.dueDate) return false;
  var today = dailyTodayStr();
  if(w.status==='done'){
    // 期限為今天，或今日才剔選完成（含逾期後今日完成）
    if(w.dueDate===today) return true;
    var completedDay=dailyParseDateYmd(w.completedAt);
    return completedDay===today;
  }
  return w.dueDate<=today;
}
function isOverdue(w){
  if(!isActiveWork(w)||w.status==='done') return false;
  if(!w.dueDate) return false;
  return w.dueDate<dailyTodayStr();
}
function workCountsForUnit(unit){
  var items=loadDailyState().works.filter(function(w){ return isDailyTodayWork(w)&&w.unit===unit; });
  if(unit==='國內倉') items=items.filter(function(w){ return w.kind!=='settlement'; });
  var done=items.filter(function(w){ return w.status==='done'; }).length;
  var overdue=items.filter(isOverdue).length;
  var total=items.length;
  var pct=total?Math.round(done/total*100):0;
  return {unit:unit,total:total,done:done,open:total-done,overdue:overdue,pct:pct,items:items};
}
function generateRecurringForToday(){
  var s=loadDailyState(), today=dailyTodayStr();
  var newlyCreated=[];
  // 不再自動植入「每日結算」示範工作
  s.works=(s.works||[]).filter(function(w){ return !isSampleDailyWork(w); });
  s.recurringTemplates=(s.recurringTemplates||[]).filter(function(t){ return !isSampleDailyTemplate(t); });
  s.recurringTemplates.forEach(function(t){
    if(!t||!t.active) return;
    (t.units||[]).forEach(function(unit){
      if(STORE_UNITS.indexOf(unit)<0) return;
      // 同一範本＋單位若仍有未完成實例：跨日延續，不另開第二筆
      var openExisting=s.works.find(function(w){
        return w.kind==='recurring'&&w.templateId===t.id&&w.unit===unit&&w.status==='open';
      });
      if(openExisting){
        // 未完成恆常：每日把期限滾到今天（跨日延續仍顯示正確期限）
        if(openExisting.dueDate!==today){
          openExisting.dueDate=today;
          openExisting.updatedAt=dailyNowStr();
        }
        return;
      }
      var existsToday=s.works.some(function(w){
        return w.kind==='recurring'&&w.templateId===t.id&&w.unit===unit&&w.dueDate===today&&w.status!=='cancelled';
      });
      if(!existsToday){
        var tplAssignees=Array.isArray(t.assigneeIds)?t.assigneeIds.map(String).filter(Boolean):[];
        var unitAssigneeIds=tplAssignees.filter(function(id){
          var u=(users||[]).find(function(x){ return String(x.id)===id; });
          if(!u) return false;
          var us=dailyUserUnits(u);
          return !us.length || us.indexOf(unit)>=0;
        });
        var w=mkWork({
          title:t.title, content:t.content||'', unit:unit, kind:'recurring',
          dueDate:today, priority:t.priority||'中', templateId:t.id,
          requireAttachment:!!t.requireAttachment, attachments:[],
          descImages:Array.isArray(t.descImages)?t.descImages.slice():[],
          createdBy:'system',
          assigneeIds:unitAssigneeIds,
          assigneeNames:unitAssigneeIds.map(function(id){ return userName(id); })
        });
        s.works.push(w);
        // 僅有指定人的新實例才排程信箱通知（跨日延續不會走到這裡）
        if(unitAssigneeIds.length) newlyCreated.push(w);
      }
    });
  });
  saveDailyState(s);
  if(newlyCreated.length) queueRecurringMailboxNotifies(newlyCreated);
  return newlyCreated;
}
var _pendingRecurringNotifies=[];
var _recurringNotifyTimer=null;
function queueRecurringMailboxNotifies(works){
  if(!works||!works.length) return;
  _pendingRecurringNotifies=_pendingRecurringNotifies.concat(works);
  if(_recurringNotifyTimer) return;
  _recurringNotifyTimer=setTimeout(function(){
    _recurringNotifyTimer=null;
    var batch=_pendingRecurringNotifies.splice(0);
    notifyRecurringInstancesCreated(batch).catch(function(e){ console.warn('notify recurring', e); });
  }, 400);
}
async function notifyRecurringInstancesCreated(works){
  if(!apiEnabled || !authToken || !currentUser || !works || !works.length) return;
  var seen={};
  var priMap={ '高':'緊急', '中':'重要', '低':'一般' };
  var any=false;
  for(var i=0;i<works.length;i++){
    var w=works[i];
    if(!w||!w.id||seen[w.id]) continue;
    seen[w.id]=true;
    var recipientIds=Array.from(new Set((w.assigneeIds||[]).map(String).filter(Boolean)));
    if(!recipientIds.length) continue;
    var priority=priMap[w.priority]||'重要';
    var title='恆常任務：'+(w.title||'');
    var body='你有今日恆常任務需要處理。\n\n'
      +'標題：'+(w.title||'')+'\n'
      +'單位：'+(w.unit||'')+'\n'
      +'期限：'+(w.dueDate||'')+'\n'
      +'優先級：'+(w.priority||'')+'\n'
      +(w.requireAttachment?'完成時需要上傳附件。\n':'')
      +'\n'+(w.content||'');
    try{
      await apiFetch('/api/notifications', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          cat: priority==='緊急' ? 'urgent' : 'general',
          category: '恆常任務',
          priority: priority,
          title: title,
          summary: '恆常任務｜'+(w.unit||'')+'｜期限 '+(w.dueDate||''),
          content: body,
          recipientIds: recipientIds,
          recipientDesc: '指定人員 '+recipientIds.length+' 人',
          startDate: dailyTodayStr(),
          endDate: w.dueDate || dailyTodayStr(),
          pinned: priority==='緊急'
        })
      });
      any=true;
    }catch(e){
      console.warn('notify recurring one', e);
    }
  }
  if(any){
    try{ await loadNotifications(); refreshMailboxUi(); }catch(_e){}
  }
}
function syncOpenRecurringFromTemplate(t){
  var s=loadDailyState();
  var tplAssignees=Array.isArray(t.assigneeIds)?t.assigneeIds.map(String).filter(Boolean):[];
  s.works.forEach(function(w){
    if(w.kind==='recurring'&&w.templateId===t.id&&w.status==='open'){
      w.requireAttachment=!!t.requireAttachment;
      w.title=t.title;
      w.content=t.content||'';
      w.priority=t.priority||'中';
      var unitAssigneeIds=tplAssignees.filter(function(id){
        var u=(users||[]).find(function(x){ return String(x.id)===id; });
        if(!u) return false;
        var us=dailyUserUnits(u);
        return !us.length || us.indexOf(w.unit)>=0;
      });
      w.assigneeIds=unitAssigneeIds;
      w.assigneeNames=unitAssigneeIds.map(function(id){ return userName(id); });
      w.descImages=Array.isArray(t.descImages)?t.descImages.slice():[];
      w.updatedAt=dailyNowStr();
    }
  });
  saveDailyState(s);
}
function ensureDailySeed(){
  try{
    localStorage.removeItem('store-web-daily-v1');
    localStorage.removeItem('store-web-daily-v2');
    localStorage.removeItem('store-web-daily-v3');
    localStorage.removeItem('store-web-daily-v4');
    localStorage.removeItem('store-web-daily-v5');
  }catch(e){}
  var s=loadDailyState();
  purgeSampleDailyState(s);
  s.recurringTemplates.forEach(function(t){
    if(typeof t.requireAttachment==='undefined') t.requireAttachment=false;
    if(!Array.isArray(t.descImages)) t.descImages=[];
  });
  s.works.forEach(function(w){
    if(typeof w.requireAttachment==='undefined') w.requireAttachment=false;
    if(!Array.isArray(w.attachments)) w.attachments=[];
    if(!Array.isArray(w.descImages)) w.descImages=[];
    if(!Array.isArray(w.assigneeIds)) w.assigneeIds=[];
    if(!Array.isArray(w.assigneeNames)) w.assigneeNames=[];
    if(!w.createdDate){
      var d=workCreatedDate(w);
      if(d) w.createdDate=d;
    }
    if(!w.createdAt) w.createdAt=w.updatedAt||dailyNowStr();
  });
  saveDailyState(s);
  generateRecurringForToday();
  return loadDailyState();
}
function canTickWork(w,user){
  if(!w||!user||w.status==='cancelled') return false;
  // 每日結算只能經 POS 日結模組完成／重開
  if(w.kind==='settlement') return false;
  if(dailyCanManage(user)) return true;
  var ids=workAssigneeIds(w);
  if(ids.length) return ids.indexOf(String(user.id))>=0;
  // 未指定人員：所屬單位內任何職位皆可完成
  return dailyUserInUnit(user, w.unit);
}
function completeDailyWork(id,user,checked,opts){
  user=user||currentUser;
  opts=opts||{};
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===id; });
  if(!w||w.status==='cancelled') return false;
  if(w.kind==='settlement') return false;
  if(!Array.isArray(w.attachments)) w.attachments=[];
  if(checked){
    if(!canTickWork(w,user)) return false;
    if(w.status==='done') return true;
    if(w.requireAttachment){
      var incoming=Array.isArray(opts.attachments)?opts.attachments:[];
      if(incoming.length) w.attachments=w.attachments.concat(incoming);
      if(!w.attachments.length) return false;
    } else if(Array.isArray(opts.attachments)&&opts.attachments.length){
      w.attachments=w.attachments.concat(opts.attachments);
    }
    w.status='done';
    w.completedAt=dailyNowStr();
    w.completedBy=dailyUserId(user);
    w.completedByName=dailyUserName(user);
    // 逾期項今日完成時，把期限滾到今天，避免完成後從今日清單消失
    if(w.dueDate && w.dueDate<dailyTodayStr()) w.dueDate=dailyTodayStr();
    w.updatedAt=dailyNowStr();
    saveDailyState(s);
    addDailyOpLog(w.kind==='settlement'?'完成結算':'完成工作', w.unit+'｜'+w.title+(w.attachments.length?'｜附件 '+w.attachments.length+' 個':''));
  }else{
    if(!canTickWork(w,user)) return false;
    w.status='open';
    w.completedAt=null;
    w.completedBy=null;
    w.completedByName=null;
    w.attachments=[];
    w.updatedAt=dailyNowStr();
    saveDailyState(s);
    addDailyOpLog('取消完成／重開工作', w.unit+'｜'+w.title+'｜已清空附件');
  }
  return true;
}
function dailyTomorrowStr(){
  var d=new Date();
  d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
/** 延期：改 dueDate，維持未完成；日期須嚴格晚於今天 */
function postponeDailyWork(id,newDueDate,user){
  user=user||currentUser;
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===id; });
  if(!w||w.status==='cancelled'||w.status==='done') return false;
  if(!canTickWork(w,user)) return false;
  var due=dailyParseDateYmd(newDueDate);
  var today=dailyTodayStr();
  if(!due||due<=today) return false;
  var prev=w.dueDate||'';
  w.dueDate=due;
  w.lastPostpone={
    fromDue:prev,
    toDue:due,
    byId:dailyUserId(user),
    byName:dailyUserName(user),
    at:dailyNowStr()
  };
  w.updatedAt=dailyNowStr();
  saveDailyState(s);
  addDailyOpLog('延期工作', w.unit+'｜'+w.title+'｜'+prev+' → '+due+'｜填寫人 '+dailyUserName(user));
  return true;
}
function addAttachmentsToWork(id,files,user){
  user=user||currentUser;
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===id; });
  if(!w||!canTickWork(w,user)) return false;
  if(!Array.isArray(w.attachments)) w.attachments=[];
  w.attachments=w.attachments.concat(files||[]);
  w.updatedAt=dailyNowStr();
  saveDailyState(s);
  addDailyOpLog('補傳附件', w.unit+'｜'+w.title+'｜+'+(files||[]).length);
  return true;
}
function cancelAdhocWork(id,user){
  if(!dailyCanManage(user||currentUser)) return false;
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===id; });
  if(!w||w.kind==='settlement') return false;
  w.status='cancelled';
  w.updatedAt=dailyNowStr();
  saveDailyState(s);
  addDailyOpLog('取消工作', w.unit+'｜'+w.title);
  return true;
}
function editWorkFields(id,data,user){
  if(!dailyCanManage(user||currentUser)) return false;
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===id; });
  if(!w||w.status==='cancelled') return false;
  if(data.title!=null) w.title=String(data.title).trim()||w.title;
  if(data.content!=null) w.content=String(data.content);
  if(data.dueDate!=null) w.dueDate=data.dueDate;
  if(data.priority!=null&&PRIORITIES.indexOf(data.priority)>=0) w.priority=data.priority;
  w.updatedAt=dailyNowStr();
  saveDailyState(s);
  addDailyOpLog('編輯工作', w.unit+'｜'+w.title);
  return true;
}
function createAdhocWork(data,user){
  user=user||currentUser;
  if(!dailyCanManage(user)) return false;
  var title=(data.title||'').trim();
  var content=data.content||'';
  var dueDate=data.dueDate||dailyTodayStr();
  var priority=PRIORITIES.indexOf(data.priority)>=0?data.priority:'中';
  var units=(data.units||[]).filter(function(u,i,a){ return STORE_UNITS.indexOf(u)>=0&&a.indexOf(u)===i; });
  if(!title||!units.length) return false;
  var assigneeIds=(data.assigneeIds||[]).map(String).filter(Boolean).filter(function(id,i,a){ return a.indexOf(id)===i; });
  var validStaff=listDailyStaffForUnits(units);
  var validIds={};
  validStaff.forEach(function(u){ validIds[String(u.id)]=u; });
  assigneeIds=assigneeIds.filter(function(id){ return !!validIds[id]; });
  // 有指定員工時，只為「所選員工所屬單位」建立工作
  if(assigneeIds.length){
    units=units.filter(function(unit){
      return assigneeIds.some(function(id){ return dailyUserUnits(validIds[id]).indexOf(unit)>=0; });
    });
    if(!units.length) return false;
  }
  var s=loadDailyState();
  var requireAttachment=!!data.requireAttachment;
  var descImages=Array.isArray(data.descImages)?data.descImages.slice(0,5):[];
  units.forEach(function(unit){
    var unitAssigneeIds=assigneeIds.filter(function(id){
      return dailyUserUnits(validIds[id]).indexOf(unit)>=0;
    });
    s.works.push(mkWork({
      title:title, content:content, unit:unit, kind:'adhoc',
      dueDate:dueDate, priority:priority, createdBy:dailyUserId(user),
      requireAttachment:requireAttachment, attachments:[],
      descImages:descImages.slice(),
      assigneeIds:unitAssigneeIds,
      assigneeNames:unitAssigneeIds.map(function(id){ return validIds[id].name||userName(id); })
    }));
  });
  saveDailyState(s);
  var assignLabel=assigneeIds.length
    ?('｜指派：'+assigneeIds.map(function(id){ return (validIds[id]&&validIds[id].name)||userName(id); }).join('、'))
    :'｜整單位';
  addDailyOpLog('建立突發工作', title+'｜單位：'+units.join('、')+'｜期限 '+dueDate+assignLabel+(requireAttachment?'｜需附件':'')+(descImages.length?'｜說明圖 '+descImages.length:'') );
  return true;
}
function createRecurringTemplate(data,user){
  user=user||currentUser;
  if(!dailyCanManage(user)) return false;
  var title=(data.title||'').trim();
  var content=data.content||'';
  var priority=PRIORITIES.indexOf(data.priority)>=0?data.priority:'中';
  var units=(data.units||[]).filter(function(u,i,a){ return STORE_UNITS.indexOf(u)>=0&&a.indexOf(u)===i; });
  if(!title||!units.length) return false;
  var assigneeIds=(data.assigneeIds||[]).map(String).filter(Boolean).filter(function(id,i,a){ return a.indexOf(id)===i; });
  var validStaff=listDailyStaffForUnits(units);
  var validIds={};
  validStaff.forEach(function(u){ validIds[String(u.id)]=u; });
  assigneeIds=assigneeIds.filter(function(id){ return !!validIds[id]; });
  var s=loadDailyState();
  var descImages=Array.isArray(data.descImages)?data.descImages.slice(0,5):[];
  var t={
    id:dailyId('tpl'), title:title, content:content, units:units, priority:priority, active:true,
    requireAttachment:!!data.requireAttachment,
    descImages:descImages,
    assigneeIds:assigneeIds,
    assigneeNames:assigneeIds.map(function(id){ return validIds[id].name||userName(id); })
  };
  s.recurringTemplates.push(t);
  saveDailyState(s);
  generateRecurringForToday();
  var assignLabel=assigneeIds.length?('｜指派：'+t.assigneeNames.join('、')):'｜整單位';
  addDailyOpLog('建立恆常任務', title+'｜單位：'+units.join('、')+assignLabel+(t.requireAttachment?'｜需附件':'')+(descImages.length?'｜說明圖 '+descImages.length:''));
  return true;
}
function setTemplateActive(id,active,user){
  if(!dailyCanManage(user||currentUser)) return false;
  var s=loadDailyState();
  var t=s.recurringTemplates.find(function(x){ return x.id===id; });
  if(!t) return false;
  t.active=!!active;
  saveDailyState(s);
  // 停用：不再產生新的每日實例，但範本仍留在列表；未完成實例可繼續處理
  // 啟用：立刻為今日補齊各單位工作
  if(active) generateRecurringForToday();
  addDailyOpLog(active?'啟用恆常任務':'停用恆常任務', t.title+(active?'':'｜已停止每日產生'));
  return true;
}
function editTemplate(id,data,user){
  if(!dailyCanManage(user||currentUser)) return false;
  var s=loadDailyState();
  var t=s.recurringTemplates.find(function(x){ return x.id===id; });
  if(!t) return false;
  if(data.title!=null) t.title=String(data.title).trim()||t.title;
  if(data.content!=null) t.content=String(data.content);
  if(data.priority!=null&&PRIORITIES.indexOf(data.priority)>=0) t.priority=data.priority;
  if(Array.isArray(data.units)) t.units=data.units.filter(function(u){ return STORE_UNITS.indexOf(u)>=0; });
  if(typeof data.requireAttachment!=='undefined') t.requireAttachment=!!data.requireAttachment;
  if(Array.isArray(data.descImages)) t.descImages=data.descImages.slice(0,5);
  if(Array.isArray(data.assigneeIds)){
    var validStaff=listDailyStaffForUnits(t.units||[]);
    var validIds={};
    validStaff.forEach(function(u){ validIds[String(u.id)]=u; });
    t.assigneeIds=data.assigneeIds.map(String).filter(Boolean).filter(function(id,i,a){ return a.indexOf(id)===i && validIds[id]; });
    t.assigneeNames=t.assigneeIds.map(function(id){ return validIds[id].name||userName(id); });
  }
  saveDailyState(s);
  syncOpenRecurringFromTemplate(t);
  generateRecurringForToday();
  addDailyOpLog('編輯恆常任務', t.title+'｜單位：'+(t.units||[]).join('、')+(t.assigneeIds&&t.assigneeIds.length?('｜指派 '+(t.assigneeNames||[]).join('、')):'')+(t.requireAttachment?'｜需附件':'')+(t.descImages&&t.descImages.length?('｜說明圖 '+t.descImages.length):''));
  return true;
}
function deleteTemplate(id,user){
  if(!dailyCanManage(user||currentUser)) return false;
  var s=loadDailyState();
  var t=s.recurringTemplates.find(function(x){ return x.id===id; });
  if(!t) return false;
  var title=t.title;
  s.recurringTemplates=s.recurringTemplates.filter(function(x){ return x.id!==id; });
  s.works.forEach(function(w){
    if(w.kind==='recurring'&&w.templateId===id&&w.status==='open'){
      w.status='cancelled';
      w.updatedAt=dailyNowStr();
    }
  });
  saveDailyState(s);
  addDailyOpLog('刪除恆常任務', title);
  return true;
}
function getTodayWorksForUser(user){
  user=user||currentUser;
  var list=loadDailyState().works.filter(isDailyTodayWork);
  if(dailyCanManage(user)){
    if(dailyUnitFilter!=='全部') list=list.filter(function(w){ return w.unit===dailyUnitFilter; });
  }else{
    var units=dailyUserUnits(user);
    var uid=String(user.id);
    list=list.filter(function(w){
      var ids=workAssigneeIds(w);
      if(ids.length && ids.indexOf(uid)>=0){
        // 指定人員：仍可依單位篩選
        if(dailyUnitFilter && dailyUnitFilter!=='全部') return w.unit===dailyUnitFilter;
        return true;
      }
      if(units.indexOf(w.unit)<0) return false;
      if(ids.length) return false;
      if(dailyUnitFilter && dailyUnitFilter!=='全部') return w.unit===dailyUnitFilter;
      return true;
    });
  }
  return list.sort(function(a,b){
    var po={高:0,中:1,低:2};
    return (po[a.priority]-po[b.priority])||a.unit.localeCompare(b.unit,'zh-Hant')||a.title.localeCompare(b.title,'zh-Hant');
  });
}
function getUnitProgress(){
  var out={};
  STORE_UNITS.forEach(function(unit){ out[unit]=workCountsForUnit(unit); });
  return out;
}
function priorityTag(p){
  var cls=p==='高'?'s-fix':(p==='低'?'s-notstart':'s-pending');
  return '<span class="tag '+cls+'">優先：'+dailyEsc(p||'中')+'</span>';
}
function dailyKindTag(w){
  var m={adhoc:['t-dev','突發'],recurring:['t-rep','恆常'],settlement:['dept','結算']}[w.kind]||['s-na',w.kind];
  return '<span class="tag '+m[0]+'">'+m[1]+'</span>';
}
function dailyStatusTag(w){
  if(w.status==='cancelled') return '<span class="tag s-cancelled">已取消</span>';
  if(isOverdue(w)) return '<span class="tag s-overdue">逾期</span>';
  if(w.status==='done') return '<span class="tag s-done">'+(w.kind==='settlement'?'已結算':'已完成')+'</span>';
  return '<span class="tag s-pending">'+(w.kind==='settlement'?'待結算':'未完成')+'</span>';
}
function goDailyView(v){
  currentModule='daily';
  var map={today:'dailyToday',progress:'dailyProgress',new:'dailyNew',recurring:'dailyRecurring',records:'dailyRecords',history:'dailyHistory',unit:'dailyUnit',logs:'dailyOpLogs'};
  currentView=map[v]||'dailyToday';
  if(v!=='unit') dailyProgressUnit=null;
  render();
}
function setDailyUnitFilter(unit){ dailyUnitFilter=unit||'全部'; render(); }
function setDailyHistoryUnit(unit){ dailyHistoryUnit=unit||'全部'; render(); }
function setDailyHistoryStatus(st){ dailyHistoryStatus=st||'全部'; render(); }
function setDailyHistoryKw(v){ dailyHistoryKw=String(v||''); render(); }
function setDailyHistoryFrom(v){ dailyHistoryFrom=String(v||''); render(); }
function setDailyHistoryTo(v){ dailyHistoryTo=String(v||''); render(); }
/** 從各種時間字串抽出 YYYY-MM-DD */
function dailyParseDateYmd(v){
  if(v==null || v==='') return '';
  var s=String(v).trim();
  var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
  m=s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if(m) return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
  m=s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if(m) return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
  return '';
}
/** 工作建立日：createdDate／createdAt → dueDate → updatedAt */
function workCreatedDate(w){
  if(!w) return '';
  var d=dailyParseDateYmd(w.createdDate);
  if(d) return d;
  d=dailyParseDateYmd(w.createdAt);
  if(d) return d;
  d=dailyParseDateYmd(w.dueDate);
  if(d) return d;
  return dailyParseDateYmd(w.updatedAt);
}
function getDailyHistoryWorks(){
  var today=dailyTodayStr();
  var list=(loadDailyState().works||[]).filter(function(w){
    if(!w) return false;
    // 過往：期限早於今天，或已完成／已取消（含今日已完成）
    var pastDue=String(w.dueDate||'') < today;
    var closed=w.status==='done' || w.status==='cancelled';
    return pastDue || closed;
  });
  if(dailyHistoryUnit && dailyHistoryUnit!=='全部'){
    list=list.filter(function(w){ return w.unit===dailyHistoryUnit; });
  }
  if(dailyHistoryStatus==='done') list=list.filter(function(w){ return w.status==='done'; });
  else if(dailyHistoryStatus==='cancelled') list=list.filter(function(w){ return w.status==='cancelled'; });
  else if(dailyHistoryStatus==='open') list=list.filter(function(w){ return w.status==='open'; });
  var from=dailyParseDateYmd(dailyHistoryFrom);
  var to=dailyParseDateYmd(dailyHistoryTo);
  if(from && to && from>to){ var tmp=from; from=to; to=tmp; }
  if(from || to){
    list=list.filter(function(w){
      var d=workCreatedDate(w);
      if(!d) return false;
      if(from && d<from) return false;
      if(to && d>to) return false;
      return true;
    });
  }
  var kw=String(dailyHistoryKw||'').trim().toLowerCase();
  if(kw){
    list=list.filter(function(w){
      return String(w.title||'').toLowerCase().indexOf(kw)>=0
        || String(w.content||'').toLowerCase().indexOf(kw)>=0
        || String(w.completedByName||'').toLowerCase().indexOf(kw)>=0
        || String(w.unit||'').toLowerCase().indexOf(kw)>=0;
    });
  }
  list.sort(function(a,b){
    var ca=workCreatedDate(a);
    var cb=workCreatedDate(b);
    if(ca!==cb) return String(cb).localeCompare(String(ca));
    var da=String(b.completedAt||b.dueDate||b.updatedAt||'');
    var db=String(a.completedAt||a.dueDate||a.updatedAt||'');
    var c=da.localeCompare(db);
    if(c) return c;
    return String(a.title||'').localeCompare(String(b.title||''),'zh-Hant');
  });
  return list;
}
function openDailyUnit(unit){ dailyProgressUnit=unit; currentModule='daily'; currentView='dailyUnit'; render(); }
function dailyToggle(id,el){
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===id; });
  if(!w){ el.checked=!el.checked; return; }
  if(w.kind==='settlement'){
    el.checked=w.status==='done';
    alert2('每日結算請到 POS「每日結算」提交或解除鎖定，不可在此剔選。');
    return;
  }
  if(el.checked){
    // 先還原未勾，確認完成／延期後再變更
    el.checked=false;
    if(!canTickWork(w,currentUser)){
      alert2('無法更新此工作。你只能操作自己所屬單位的工作。');
      return;
    }
    dailyAskTickAction(id);
    return;
  }
  // 取消剔選：確認後清空全部附件並重開
  el.checked=true;
  showModal(
    '<h3>取消完成？</h3>'+
    '<p style="font-size:14px">將重開「'+dailyEsc(w.title)+'」，並<strong>刪除該工作上的全部附件</strong>。</p>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">返回</button>'+
    '<button class="btn red sm" data-call="dailyConfirmUntick" data-arg0="'+escHtml(String(id))+'">確認取消完成</button></div>'
  );
}
function dailyAskTickAction(id){
  var w=loadDailyState().works.find(function(x){ return x.id===id; });
  if(!w) return;
  showModal(
    '<h3>完成或延期？</h3>'+
    '<p style="font-size:14px;line-height:1.55">「<b>'+dailyEsc(w.title)+'</b>」目前期限：'+dailyEsc(w.dueDate||'—')+'<br>請選擇操作：</p>'+
    '<div class="actions">'+
      '<button type="button" class="btn gray sm" onclick="closeModal()">取消</button>'+
      '<button type="button" class="btn warn sm" data-call="dailyAskPostpone" data-arg0="'+escHtml(String(id))+'">延期</button>'+
      '<button type="button" class="btn green sm" data-call="dailyChooseComplete" data-arg0="'+escHtml(String(id))+'">完成</button>'+
    '</div>'
  );
}
function dailyChooseComplete(id){
  closeModal();
  var w=loadDailyState().works.find(function(x){ return x.id===id; });
  if(!w) return;
  if(!canTickWork(w,currentUser)){
    alert2('無法更新此工作。你只能操作自己所屬單位的工作。');
    return;
  }
  if(w.requireAttachment){
    dailyAskCompleteWithFiles(id);
    return;
  }
  var ok=completeDailyWork(id,currentUser,true);
  if(!ok){ alert2('無法完成此工作。'); return; }
  render();
  if(typeof flushCloudSaves==='function') flushCloudSaves().catch(function(){});
}
function dailyAskPostpone(id){
  var w=loadDailyState().works.find(function(x){ return x.id===id; });
  if(!w) return;
  if(!canTickWork(w,currentUser)){
    alert2('無法延期此工作。');
    return;
  }
  var minDue=dailyTomorrowStr();
  showModal(
    '<h3>延期工作</h3>'+
    '<p style="font-size:13px;color:#555;line-height:1.55">「'+dailyEsc(w.title)+'」將維持未完成，期限改為你指定的日期（須晚於今天）。</p>'+
    '<label>延期日期</label><input type="date" id="d-postpone-due" min="'+escHtml(minDue)+'" value="'+escHtml(minDue)+'">'+
    '<label>填寫人</label><input type="text" value="'+dailyEsc(dailyUserName(currentUser))+'" readonly style="background:#f5f5f5;color:#555">'+
    '<p style="font-size:12px;color:#888;margin-top:6px">填寫人固定為目前登入賬戶，不可更改。</p>'+
    '<div class="actions">'+
      '<button type="button" class="btn gray sm" onclick="closeModal()">取消</button>'+
      '<button type="button" class="btn sm" data-call="dailySubmitPostpone" data-arg0="'+escHtml(String(id))+'">確認延期</button>'+
    '</div>'
  );
}
function dailySubmitPostpone(id){
  var due=((document.getElementById('d-postpone-due')||{}).value||'').trim();
  if(!due){ alert2('請選擇延期日期。'); return; }
  if(due<=dailyTodayStr()){ alert2('延期日期必須晚於今天。'); return; }
  var ok=postponeDailyWork(id,due,currentUser);
  closeModal();
  if(!ok){ alert2('延期失敗：請確認日期晚於今天，且你有權限操作。'); return; }
  render();
  if(typeof flushCloudSaves==='function'){
    flushCloudSaves().catch(function(e){
      alert2('延期已保存在本機，但雲端同步失敗：'+(e&&e.message?e.message:e));
    });
  }
}
function dailyConfirmUntick(id){
  var ok=completeDailyWork(id,currentUser,false);
  closeModal();
  if(!ok){ alert2('無法取消完成。'); return; }
  render();
}
function dailyAskCompleteWithFiles(id){
  var w=loadDailyState().works.find(function(x){ return x.id===id; });
  if(!w) return;
  showModal(
    '<h3>上傳附件後完成</h3>'+
    '<p style="font-size:13px;color:#555">「'+dailyEsc(w.title)+'」需要上傳至少 1 個附件（格式不限，可多選）。上傳成功後才會剔選完成。</p>'+
    '<label>選擇檔案</label><input type="file" id="d-complete-files" multiple>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>'+
    '<button class="btn sm" data-call="dailySubmitCompleteWithFiles" data-arg0="'+escHtml(String(id))+'">上傳並完成</button></div>'
  );
}
async function dailySubmitCompleteWithFiles(id){
  var input=document.getElementById('d-complete-files');
  if(!input||!input.files||!input.files.length) return alert2('請至少選擇 1 個附件。');
  var files=[];
  try{
    for(var i=0;i<input.files.length;i++){
      var f=input.files[i];
      var up=await cloudUploadFile(f);
      files.push({name:up.name||f.name, dataUrl:up.dataUrl, driveFileId:up.driveFileId, mimeType:up.mimeType, by:dailyUserId(currentUser), time:dailyNowStr()});
    }
  }catch(e){ return alert2('上傳失敗：'+(e.message||e)); }
  var ok=completeDailyWork(id,currentUser,true,{attachments:files});
  closeModal();
  if(!ok){ alert2('無法完成此工作。'); return; }
  render();
}
function dailyAskAddFiles(id){
  var w=loadDailyState().works.find(function(x){ return x.id===id; });
  if(!w) return;
  showModal(
    '<h3>補傳附件</h3>'+
    '<p style="font-size:13px;color:#555">「'+dailyEsc(w.title)+'」已完成，可再補傳附件（不影響完成狀態）。</p>'+
    '<label>選擇檔案</label><input type="file" id="d-add-files" multiple>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>'+
    '<button class="btn sm" data-call="dailySubmitAddFiles" data-arg0="'+escHtml(String(id))+'">上傳</button></div>'
  );
}
async function dailySubmitAddFiles(id){
  var input=document.getElementById('d-add-files');
  if(!input||!input.files||!input.files.length) return alert2('請選擇至少 1 個檔案。');
  var files=[];
  try{
    for(var i=0;i<input.files.length;i++){
      var f=input.files[i];
      var up=await cloudUploadFile(f);
      files.push({name:up.name||f.name, dataUrl:up.dataUrl, driveFileId:up.driveFileId, mimeType:up.mimeType, by:dailyUserId(currentUser), time:dailyNowStr()});
    }
  }catch(e){ return alert2('上傳失敗：'+(e.message||e)); }
  var ok=addAttachmentsToWork(id,files,currentUser);
  closeModal();
  if(!ok){ alert2('無法補傳附件。'); return; }
  render();
}
function dailyReopen(id){
  if(!dailyCanManage(currentUser)){ alert2('只有管理層可以重新開啟工作。'); return; }
  var w=loadDailyState().works.find(function(x){ return x.id===id; });
  if(!w) return;
  if(w.kind==='settlement'){
    alert2('每日結算請到 POS「每日結算」解除鎖定後重交，不可在此重開。');
    return;
  }
  showModal(
    '<h3>重新開啟工作？</h3>'+
    '<p style="font-size:14px">將重開「'+dailyEsc(w.title)+'」，並<strong>刪除該工作上的全部附件</strong>。</p>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">返回</button>'+
    '<button class="btn red sm" data-call="dailyConfirmUntick" data-arg0="'+escHtml(String(id))+'">確認重開</button></div>'
  );
}
function dailyCancelWork(id){
  if(!dailyCanManage(currentUser)) return;
  cancelAdhocWork(id,currentUser);
  render();
}
function unitChecksHtml(selected){
  selected=selected||STORE_UNITS.slice();
  return STORE_UNITS.map(function(u){
    return '<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 10px 4px 0"><input type="checkbox" class="d-unit" value="'+u+'" '+(selected.indexOf(u)>=0?'checked':'')+' onchange="typeof dailyRefreshAdhocStaffBox===\'function\'&&dailyRefreshAdhocStaffBox()"> '+u+'</label>';
  }).join('');
}
function staffChecksHtml(units, selected){
  selected=(selected||[]).map(String);
  var list=listDailyStaffForUnits(units);
  if(!list.length){
    return '<p style="color:#888;font-size:12px;margin:0">所選單位暫無可指派人員。不選則整單位任何人可完成。</p>';
  }
  return list.map(function(u){
    var labs=dailyUserUnits(u).join('、');
    var pos=u.position||roleLabel(u)||'';
    return '<label style="display:flex;align-items:center;gap:6px;margin:6px 0">'+
      '<input type="checkbox" class="d-staff" value="'+dailyEsc(String(u.id))+'" '+(selected.indexOf(String(u.id))>=0?'checked':'')+'> '+
      '<span>'+dailyEsc(u.name)
      +' <span style="color:#888;font-size:11px">（'+dailyEsc(pos)+(labs?'｜'+dailyEsc(labs):'')+'）</span>'
      +'</span></label>';
  }).join('');
}
function dailyRefreshAdhocStaffBox(){
  var box=document.getElementById('d-staff-box');
  if(!box) return;
  var units=[].slice.call(document.querySelectorAll('#modal-content .d-unit:checked')).map(function(x){return x.value;});
  var selected=[].slice.call(document.querySelectorAll('#modal-content .d-staff:checked')).map(function(x){return x.value;});
  box.innerHTML=staffChecksHtml(units, selected);
}
function prioritySelectHtml(val,id){
  id=id||'d-priority';
  return '<select id="'+id+'">'+PRIORITIES.map(function(p){ return '<option value="'+p+'" '+(p===(val||'中')?'selected':'')+'>'+p+'</option>'; }).join('')+'</select>';
}
var DAILY_DESC_IMAGE_MAX=5;
function dailyDescImagesFieldHtml(existing){
  existing=Array.isArray(existing)?existing:[];
  var keep=existing.length
    ?('<p style="font-size:12px;color:#555;margin:0 0 6px">現有說明圖 '+existing.length+' 張：'+existing.map(function(f){ return dailyEsc((f&&f.name)||'圖'); }).join('、')+'</p>'+
      '<label style="display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:13px"><input type="checkbox" id="d-desc-clear"> 清除全部現有說明圖</label>')
    :'';
  return keep+
    '<label>說明圖（可選，最多 '+DAILY_DESC_IMAGE_MAX+' 張，僅 JPG／PNG／WebP／GIF）</label>'+
    '<input type="file" id="d-desc-images" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" multiple>'+
    '<p style="font-size:12px;color:#888;margin-top:4px">參考圖／說明用，與「完成時需上傳附件」無關。'+(existing.length?'新選圖片會加在現有圖之後（合計最多 '+DAILY_DESC_IMAGE_MAX+' 張）。':'')+'</p>';
}
function dailyIsAllowedDescImageFile(file){
  if(!file) return false;
  var mime=String(file.type||'').toLowerCase();
  if(mime.indexOf('image/')===0 && /jpeg|jpg|png|webp|gif/.test(mime)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(String(file.name||''));
}
async function dailyUploadDescImagesFromInput(existingKeep){
  existingKeep=Array.isArray(existingKeep)?existingKeep.slice():[];
  var input=document.getElementById('d-desc-images');
  var clear=!!(document.getElementById('d-desc-clear')||{}).checked;
  var base=clear?[]:existingKeep;
  var files=input&&input.files?Array.prototype.slice.call(input.files):[];
  if(!files.length) return base.slice(0,DAILY_DESC_IMAGE_MAX);
  if(base.length+files.length>DAILY_DESC_IMAGE_MAX){
    throw new Error('說明圖合計最多 '+DAILY_DESC_IMAGE_MAX+' 張（含現有）。');
  }
  var out=base.slice();
  for(var i=0;i<files.length;i++){
    var f=files[i];
    if(!dailyIsAllowedDescImageFile(f)) throw new Error('「'+f.name+'」不是允許的圖片格式。');
    var up=await cloudUploadFile(f);
    out.push({
      name:up.name||f.name,
      dataUrl:up.dataUrl,
      driveFileId:up.driveFileId,
      mimeType:up.mimeType||f.type||'image/jpeg',
      by:dailyUserId(currentUser),
      time:dailyNowStr()
    });
  }
  return out.slice(0,DAILY_DESC_IMAGE_MAX);
}
function dailyCreateAdhoc(){
  if(!dailyCanManage(currentUser)) return alert2('只有管理層可以建立突發工作。');
  if(!requireCloud('建立突發工作')) return;
  var defaultUnits=STORE_UNITS.slice();
  showModal(
    '<h3>🛠️ 建立突發工作</h3>'+
    '<label>標題</label><input id="d-title" type="text" placeholder="例如：臨時補貨核對">'+
    '<label>內容</label><textarea id="d-content" placeholder="工作說明"></textarea>'+
    dailyDescImagesFieldHtml([])+
    '<label>完成期限</label><input id="d-due" type="date" value="'+dailyTodayStr()+'">'+
    '<label>優先級</label>'+prioritySelectHtml('中')+
    '<label>適用單位（可多選）</label><div class="card" style="padding:10px">'+unitChecksHtml(defaultUnits)+'</div>'+
    '<label>指定人員（可選，含員工／主管／經理）</label><div id="d-staff-box" class="card" style="padding:10px;max-height:180px;overflow:auto">'+staffChecksHtml(defaultUnits)+'</div>'+
    '<p style="font-size:12px;color:#888;margin-top:4px">不選＝該單位任何人可完成；有選則只有指定人員可剔選（管理層仍可操作）。</p>'+
    '<label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="d-require-attach"> 完成時需要上傳附件</label>'+
    '<p style="font-size:12px;color:#888;margin-top:4px">勾選後，員工剔選完成前必須先上傳至少 1 個附件（格式不限）。</p>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button><button class="btn sm" onclick="dailySubmitAdhoc()">建立</button></div>'
  );
}
function resolveAdhocNotifyRecipients(units, assigneeIds){
  var me = currentUser ? String(currentUser.id) : '';
  var ids = [];
  if(assigneeIds && assigneeIds.length){
    ids = assigneeIds.map(String);
  } else {
    ids = listDailyStaffForUnits(units).map(function(u){ return String(u.id); });
  }
  return [...new Set(ids)].filter(function(id){ return id && id!==me; });
}
async function notifyAdhocWorkCreated(workMeta){
  if(!apiEnabled || !authToken || !currentUser) return;
  var recipientIds = resolveAdhocNotifyRecipients(workMeta.units||[], workMeta.assigneeIds||[]);
  if(!recipientIds.length) return;
  var priMap = { '高':'緊急', '中':'重要', '低':'一般' };
  var priority = priMap[workMeta.priority] || '重要';
  var title = '突發任務：'+(workMeta.title||'');
  var body = '你有新的突發任務需要處理。\n\n'
    +'標題：'+(workMeta.title||'')+'\n'
    +'單位：'+(workMeta.units||[]).join('、')+'\n'
    +'期限：'+(workMeta.dueDate||'')+'\n'
    +'優先級：'+(workMeta.priority||'')+'\n'
    +(workMeta.requireAttachment?'完成時需要上傳附件。\n':'')
    +'\n'+(workMeta.content||'');
  var summary = '突發任務｜'+(workMeta.units||[]).join('、')+'｜期限 '+(workMeta.dueDate||'');
  try{
    await apiFetch('/api/notifications', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        cat: priority==='緊急' ? 'urgent' : 'general',
        category: '突發任務',
        priority: priority,
        title: title,
        summary: summary,
        content: body,
        recipientIds: recipientIds,
        recipientDesc: workMeta.assigneeIds && workMeta.assigneeIds.length
          ? ('指定員工 '+recipientIds.length+' 人')
          : ('單位：'+(workMeta.units||[]).join('、')),
        startDate: dailyTodayStr(),
        endDate: workMeta.dueDate || dailyTodayStr(),
        pinned: priority==='緊急'
      })
    });
    await loadNotifications();
    refreshMailboxUi();
  }catch(e){
    console.warn('notify adhoc', e);
  }
}
async function dailySubmitAdhoc(){
  var title=(document.getElementById('d-title').value||'').trim();
  var content=document.getElementById('d-content').value||'';
  var due=document.getElementById('d-due').value||dailyTodayStr();
  var priority=document.getElementById('d-priority').value;
  var requireAttachment=!!(document.getElementById('d-require-attach')||{}).checked;
  var units=[].slice.call(document.querySelectorAll('#modal-content .d-unit:checked')).map(function(x){return x.value;});
  var assigneeIds=[].slice.call(document.querySelectorAll('#modal-content .d-staff:checked')).map(function(x){return x.value;});
  if(!title||!units.length) return alert2('請輸入標題並選擇至少一個單位。');
  if(!requireCloud('建立突發工作')) return;
  var descImages=[];
  try{
    descImages=await dailyUploadDescImagesFromInput([]);
  }catch(e){ return alert2(e&&e.message?e.message:e); }
  if(!createAdhocWork({title:title,content:content,dueDate:due,priority:priority,units:units,assigneeIds:assigneeIds,requireAttachment:requireAttachment,descImages:descImages},currentUser)){
    return alert2('建立失敗：請確認所選員工屬於已勾選的單位。');
  }
  closeModal();
  try{
    await flushCloudSaves();
    await notifyAdhocWorkCreated({ title:title, content:content, dueDate:due, priority:priority, units:units, assigneeIds:assigneeIds, requireAttachment:requireAttachment });
    render();
  }catch(e){
    render();
    alert2('工作已保存在本機，但雲端同步失敗：'+(e&&e.message?e.message:e)+'。請查看頂欄狀態；暫勿關閉分頁，稍後會自動重試。');
  }
}
function dailyCreateRecurring(){
  if(!dailyCanManage(currentUser)) return alert2('只有管理層可以建立恆常任務。');
  if(!requireCloud('建立恆常任務')) return;
  var defaultUnits=STORE_UNITS.slice();
  showModal(
    '<h3>🔁 建立恆常任務</h3>'+
    '<label>標題</label><input id="d-title" type="text" placeholder="輸入工作標題">'+
    '<label>內容</label><textarea id="d-content" placeholder="工作說明"></textarea>'+
    dailyDescImagesFieldHtml([])+
    '<label>優先級</label>'+prioritySelectHtml('中')+
    '<label>適用單位（可多選）</label><div class="card" style="padding:10px">'+unitChecksHtml(defaultUnits)+'</div>'+
    '<label>指定人員（可選，含員工／主管／經理）</label><div id="d-staff-box" class="card" style="padding:10px;max-height:180px;overflow:auto">'+staffChecksHtml(defaultUnits)+'</div>'+
    '<p style="font-size:12px;color:#888;margin-top:4px">不選＝該單位任何人可完成；有選則只有指定人員可剔選。</p>'+
    '<label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="d-require-attach"> 完成時需要上傳附件</label>'+
    '<p style="font-size:12px;color:#888;margin-top:4px">勾選後，員工剔選完成前必須先上傳至少 1 個附件（格式不限）。</p>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button><button class="btn sm" onclick="dailySubmitRecurring()">建立</button></div>'
  );
}
async function dailySubmitRecurring(){
  var title=(document.getElementById('d-title').value||'').trim();
  var content=document.getElementById('d-content').value||'';
  var priority=document.getElementById('d-priority').value;
  var requireAttachment=!!(document.getElementById('d-require-attach')||{}).checked;
  var units=[].slice.call(document.querySelectorAll('#modal-content .d-unit:checked')).map(function(x){return x.value;});
  var assigneeIds=[].slice.call(document.querySelectorAll('#modal-content .d-staff:checked')).map(function(x){return x.value;});
  if(!title||!units.length) return alert2('請輸入標題並選擇至少一個單位。');
  if(!requireCloud('建立恆常任務')) return;
  var descImages=[];
  try{
    descImages=await dailyUploadDescImagesFromInput([]);
  }catch(e){ return alert2(e&&e.message?e.message:e); }
  createRecurringTemplate({title:title,content:content,priority:priority,units:units,assigneeIds:assigneeIds,requireAttachment:requireAttachment,descImages:descImages},currentUser);
  closeModal();
  try{
    await flushCloudSaves();
    render();
  }catch(e){
    render();
    alert2('恆常任務已保存在本機，但雲端同步失敗：'+(e&&e.message?e.message:e)+'。請查看頂欄狀態；暫勿關閉分頁，稍後會自動重試。');
  }
}
function dailyEditWork(id){
  if(!dailyCanManage(currentUser)) return;
  var w=loadDailyState().works.find(function(x){return x.id===id;});
  if(!w) return;
  showModal(
    '<h3>✏️ 編輯工作</h3>'+
    '<label>標題</label><input id="d-title" type="text" value="'+dailyEsc(w.title)+'">'+
    '<label>內容</label><textarea id="d-content">'+dailyEsc(w.content)+'</textarea>'+
    '<label>完成期限</label><input id="d-due" type="date" value="'+dailyEsc(w.dueDate)+'">'+
    '<label>優先級</label>'+prioritySelectHtml(w.priority)+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button><button class="btn sm" data-call="dailySubmitEditWork" data-arg0="'+escHtml(String(id))+'">儲存</button></div>'
  );
}
function dailySubmitEditWork(id){
  editWorkFields(id,{
    title:document.getElementById('d-title').value,
    content:document.getElementById('d-content').value,
    dueDate:document.getElementById('d-due').value,
    priority:document.getElementById('d-priority').value
  },currentUser);
  closeModal(); render();
}
function dailyEditTemplate(id){
  if(!dailyCanManage(currentUser)) return;
  var t=loadDailyState().recurringTemplates.find(function(x){return x.id===id;});
  if(!t) return;
  showModal(
    '<h3>✏️ 編輯恆常任務</h3>'+
    '<label>標題</label><input id="d-title" type="text" value="'+dailyEsc(t.title)+'">'+
    '<label>內容</label><textarea id="d-content">'+dailyEsc(t.content||'')+'</textarea>'+
    dailyDescImagesFieldHtml(t.descImages||[])+
    '<label>優先級</label>'+prioritySelectHtml(t.priority||'中')+
    '<label>適用單位</label><div class="card" style="padding:10px">'+unitChecksHtml(t.units||[])+'</div>'+
    '<label>指定人員（可選，含員工／主管／經理）</label><div id="d-staff-box" class="card" style="padding:10px;max-height:180px;overflow:auto">'+staffChecksHtml(t.units||[], t.assigneeIds||[])+'</div>'+
    '<p style="font-size:12px;color:#888;margin-top:4px">變更會同步到今日尚未完成的實例；已完成工作不受影響。</p>'+
    '<label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="d-require-attach" '+(t.requireAttachment?'checked':'')+'> 完成時需要上傳附件</label>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button><button class="btn sm" data-call="dailySubmitEditTemplate" data-arg0="'+escHtml(String(id))+'">儲存</button></div>'
  );
}
async function dailySubmitEditTemplate(id){
  var units=[].slice.call(document.querySelectorAll('#modal-content .d-unit:checked')).map(function(x){return x.value;});
  var assigneeIds=[].slice.call(document.querySelectorAll('#modal-content .d-staff:checked')).map(function(x){return x.value;});
  var t=loadDailyState().recurringTemplates.find(function(x){return x.id===id;});
  var descImages=[];
  try{
    descImages=await dailyUploadDescImagesFromInput((t&&t.descImages)||[]);
  }catch(e){ return alert2(e&&e.message?e.message:e); }
  editTemplate(id,{
    title:document.getElementById('d-title').value,
    content:document.getElementById('d-content').value,
    priority:document.getElementById('d-priority').value,
    units:units,
    assigneeIds:assigneeIds,
    requireAttachment:!!(document.getElementById('d-require-attach')||{}).checked,
    descImages:descImages
  },currentUser);
  closeModal();
  try{
    await flushCloudSaves();
  }catch(_e){}
  render();
}
function dailyToggleTemplate(id,active){
  setTemplateActive(id,active,currentUser);
  render();
}
function dailyIsImageFile(f,name){
  var mime=String((f&&f.mimeType)||'').toLowerCase();
  if(mime.indexOf('image/')===0) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(name||''));
}
function dailyIsPdfFile(f,name){
  var mime=String((f&&f.mimeType)||'').toLowerCase();
  if(mime==='application/pdf') return true;
  return /\.pdf$/i.test(String(name||''));
}
function dailyShowAttachPreview(f, opts){
  opts=opts||{};
  f=ensureFilePayload(f);
  var name=(f&&f.name)?f.name:'附件';
  var href=fileHref(f);
  if(!href || href==='#'){ alert2('無法開啟此附件。'); return; }
  var safeHref=String(href).replace(/"/g,'&quot;');
  var body='';
  if(dailyIsImageFile(f,name)){
    body='<div style="text-align:center;background:#f5f7fa;border-radius:8px;padding:10px">'+
      '<img src="'+safeHref+'" alt="'+dailyEsc(name)+'" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:4px">'+
      '</div>';
  }else if(dailyIsPdfFile(f,name)){
    body='<iframe src="'+safeHref+'" title="'+dailyEsc(name)+'" style="width:100%;height:70vh;border:1px solid #e0e5ec;border-radius:8px;background:#fafafa"></iframe>';
  }else{
    body='<p style="font-size:14px;color:#555;line-height:1.6">此檔案類型無法在彈窗內直接預覽，請用下方按鈕開啟。</p>'+
      '<p style="margin-top:8px"><a class="file-link" href="'+safeHref+'" target="_blank" rel="noopener">在新分頁開啟／下載</a></p>';
  }
  var deleteBtn='';
  if(opts.canDelete && opts.workId!=null && opts.idx!=null && opts.kind){
    deleteBtn='<button type="button" class="btn red sm" data-call="dailyDeletePreviewAttach" data-arg0="'+escHtml(String(opts.workId))+'" data-arg1="'+escHtml(String(opts.idx))+'" data-arg2="'+escHtml(String(opts.kind))+'">刪除</button>';
  }
  var el=document.getElementById('modal-content');
  if(el) el.classList.add('modal-wide');
  showModal(
    '<h3>📎 '+dailyEsc(name)+'</h3>'+body+
    '<div class="actions">'+
      '<a class="btn gray sm" href="'+safeHref+'" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">新分頁開啟</a>'+
      deleteBtn+
      '<button type="button" class="btn sm" onclick="closeModal()">關閉</button>'+
    '</div>'
  );
}
function dailyCanDeleteWorkAttach(w,user){
  user=user||currentUser;
  if(!w||!user||w.status==='cancelled') return false;
  return canTickWork(w,user) || dailyCanManage(user);
}
function dailyDeletePreviewAttach(workId,idx,kind){
  kind=kind||'attachments';
  var s=loadDailyState();
  var w=s.works.find(function(x){ return x.id===workId; });
  if(!w){ alert2('找不到此工作。'); return; }
  if(!dailyCanDeleteWorkAttach(w,currentUser)){
    alert2('你沒有權限刪除此附件。');
    return;
  }
  var arr=kind==='descImages' ? w.descImages : w.attachments;
  if(!Array.isArray(arr) || arr[idx]==null){
    alert2('找不到此附件。');
    return;
  }
  var fname=(arr[idx]&&arr[idx].name)?arr[idx].name:'附件';
  if(!confirm('確定刪除「'+fname+'」？此操作無法復原。')) return;
  arr.splice(idx,1);
  if(kind==='descImages') w.descImages=arr;
  else w.attachments=arr;
  w.updatedAt=dailyNowStr();
  saveDailyState(s);
  addDailyOpLog(kind==='descImages'?'刪除說明圖':'刪除附件', w.unit+'｜'+w.title+'｜'+fname);
  closeModal();
  if(typeof flushCloudSaves==='function'){
    flushCloudSaves().then(function(){ render(); }).catch(function(){ render(); });
  }else{
    render();
  }
}
function dailyPreviewAttach(workId,idx){
  var w=loadDailyState().works.find(function(x){ return x.id===workId; });
  if(!w||!Array.isArray(w.attachments)||w.attachments[idx]==null){
    alert2('找不到此附件。');
    return;
  }
  dailyShowAttachPreview(w.attachments[idx], {
    workId:workId,
    idx:idx,
    kind:'attachments',
    canDelete:dailyCanDeleteWorkAttach(w,currentUser)
  });
}
function dailyDownloadAttach(workId,idx){
  dailyPreviewAttach(workId,idx);
}
function dailyFileViewHtml(f,workId,idx){
  f=ensureFilePayload(f);
  var name=f&&f.name?f.name:'附件';
  var href=fileHref(f);
  if(!href || href==='#'){
    return '<span style="color:#999;margin:2px 8px 2px 0;display:inline-block">📎 '+dailyEsc(name)+'</span>';
  }
  if(workId!=null && idx!=null && idx!==''){
    return '<a class="file-link" href="#" data-call="dailyPreviewAttach" data-arg0="'+escHtml(String(workId))+'" data-arg1="'+escHtml(String(idx))+'" title="點擊在彈窗檢視">📎 '+dailyEsc(name)+'</a>';
  }
  // 無工作上下文時仍開彈窗（暫存檔案物件）
  if(!window._dailyPreviewFiles) window._dailyPreviewFiles={};
  var key='p'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  window._dailyPreviewFiles[key]=f;
  return '<a class="file-link" href="#" data-call="dailyPreviewAttachCached" data-arg0="'+escHtml(key)+'" title="點擊在彈窗檢視">📎 '+dailyEsc(name)+'</a>';
}
function dailyPreviewAttachCached(key){
  var f=window._dailyPreviewFiles && window._dailyPreviewFiles[key];
  if(!f){ alert2('找不到此附件。'); return; }
  dailyShowAttachPreview(f);
}
function dailyPreviewDescImage(workId,idx){
  var w=loadDailyState().works.find(function(x){ return x.id===workId; });
  if(!w||!Array.isArray(w.descImages)||w.descImages[idx]==null){
    alert2('找不到此說明圖。');
    return;
  }
  dailyShowAttachPreview(w.descImages[idx], {
    workId:workId,
    idx:idx,
    kind:'descImages',
    canDelete:dailyCanManage(currentUser)
  });
}
function dailyDescImagesHtml(w){
  var imgs=Array.isArray(w&&w.descImages)?w.descImages:[];
  if(!imgs.length) return '';
  return '<div style="margin-top:4px;font-size:12px;line-height:1.8">'+
    '<span style="color:#546e7a;margin-right:6px">說明圖：</span>'+
    imgs.map(function(f,i){
      f=ensureFilePayload(f);
      var name=f&&f.name?f.name:('圖'+(i+1));
      var href=fileHref(f);
      if(!href||href==='#'){
        return '<span style="color:#999;margin:2px 8px 2px 0;display:inline-block">🖼 '+dailyEsc(name)+'</span>';
      }
      return '<a class="file-link" href="#" data-call="dailyPreviewDescImage" data-arg0="'+escHtml(String(w.id))+'" data-arg1="'+escHtml(String(i))+'" title="點擊在彈窗檢視">🖼 '+dailyEsc(name)+'</a>';
    }).join(' ')+
    '</div>';
}
function dailyAttachHtml(w,user,readonly){
  var files=Array.isArray(w.attachments)?w.attachments:[];
  var can=canTickWork(w,user);
  var bits=[];
  var desc=dailyDescImagesHtml(w);
  if(desc) bits.push(desc);
  if(w.requireAttachment){
    bits.push('<span class="tag" style="background:#fff3e0;color:#e65100">需附件</span>');
  }
  if(files.length){
    bits.push('<div style="margin-top:4px;font-size:12px;line-height:1.8"><span style="color:#546e7a;margin-right:6px">完成附件：</span>'+files.map(function(f,i){
      return dailyFileViewHtml(f, w.id, i);
    }).join(' ')+'</div>');
  }else if(w.status==='done'){
    bits.push('<div style="font-size:11px;color:#aaa;margin-top:2px">無完成附件</div>');
  }
  if(!readonly&&can&&w.status==='done'){
    bits.push('<div style="margin-top:4px"><button type="button" class="btn gray sm" data-call="dailyAskAddFiles" data-arg0="'+escHtml(String(w.id))+'">補傳附件</button></div>');
  }
  return bits.length?'<div style="margin-top:6px">'+bits.join('')+'</div>':'';
}
function dailyWorkRows(list,user,opts){
  opts=opts||{};
  var readonly=!!opts.readonly;
  var mirrors=opts.mirrors||[];
  var pinAdhoc=opts.pinAdhoc!==false; // 今日工作等：突發置頂
  var showCreated=!!opts.showCreatedDate;
  if(!list.length&&!mirrors.length) return '<p style="color:#888">沒有工作。</p>';
  var showAdmin=dailyCanManage(user)&&!readonly;
  var sorted=(list||[]).slice();
  if(pinAdhoc){
    sorted.sort(function(a,b){
      var aa=a&&a.kind==='adhoc'?0:1;
      var bb=b&&b.kind==='adhoc'?0:1;
      if(aa!==bb) return aa-bb;
      return 0;
    });
  }
  var body=sorted.map(function(w){
      var can=canTickWork(w,user);
      var isAdhoc=w.kind==='adhoc';
      var isSettlement=w.kind==='settlement';
      var tick='';
      if(!readonly){
        if(isSettlement){
          tick=w.status==='done'
            ?'<input type="checkbox" checked disabled title="請經 POS「每日結算」解除鎖定">'
            :'<input type="checkbox" disabled title="請經 POS「每日結算」提交">';
        }else if(w.status==='done'){
          tick=can
            ?'<input type="checkbox" checked onchange="dailyToggle(\''+w.id+'\',this)" title="再點一下可取消完成">'
            :'<input type="checkbox" checked disabled title="已完成（不可操作其他單位）">';
        }else{
          tick=can
            ?'<input type="checkbox" onchange="dailyToggle(\''+w.id+'\',this)" title="點擊選擇完成或延期">'
            :'<input type="checkbox" disabled title="不可操作">';
        }
      }
      var doneInfo=w.status==='done'
        ? dailyEsc(w.completedByName||'—')+'<div style="font-size:11px;color:#888">'+dailyEsc(w.completedAt||'')+'</div>'
        : '—';
      var admin='';
      if(showAdmin){
        admin='<button class="btn gray sm" data-call="dailyEditWork" data-arg0="'+escHtml(String(w.id))+'">編輯</button> ';
        if(w.status==='done' && !isSettlement) admin+='<button class="btn warn sm" data-call="dailyReopen" data-arg0="'+escHtml(String(w.id))+'">重開</button> ';
        if(isSettlement) admin+='<button class="btn sm" data-call="go" data-arg0="posSettlement">去日結</button> ';
        if(w.kind!=='settlement'&&w.status!=='cancelled') admin+='<button class="btn red sm" data-call="dailyCancelWork" data-arg0="'+escHtml(String(w.id))+'">取消</button>';
      }
      var subColor=isAdhoc?'#e53935':'#777';
      var assignColor=isAdhoc?'#c62828':'#666';
      var postponeHint=w.lastPostpone
        ?('<div style="font-size:11px;color:#ef6c00;margin-top:4px">曾延期至 '+dailyEsc(w.lastPostpone.toDue||'')
          +'（'+dailyEsc(w.lastPostpone.byName||'')+(w.lastPostpone.at?'｜'+dailyEsc(w.lastPostpone.at):'')+'）</div>')
        :'';
      return '<tr class="'+(isAdhoc?'daily-adhoc-row':'')+'"'+(isAdhoc?' style="color:#c62828"':'')+'>'+
        (readonly?'':'<td>'+tick+'</td>')+
        '<td><b'+(isAdhoc?' style="color:#c62828"':'')+'>'+dailyEsc(w.title)+'</b>'+(w.content?'<div style="font-size:12px;color:'+subColor+';margin-top:2px;white-space:pre-wrap">'+dailyEsc(w.content)+'</div>':'')+
          (isAdhoc?'<div style="font-size:11px;color:'+assignColor+';margin-top:4px">指派：'+dailyEsc(workAssigneesLabel(w))+'</div>':'')+
          postponeHint+
          dailyAttachHtml(w,user,readonly)+'</td>'+
        '<td>'+dailyEsc(w.unit)+'</td><td>'+dailyKindTag(w)+'</td><td>'+priorityTag(w.priority)+'</td>'+
        (showCreated?'<td style="white-space:nowrap;font-size:12px">'+dailyEsc(workCreatedDate(w)||'—')+'</td>':'')+
        '<td>'+dailyEsc(w.dueDate||'—')+'</td><td>'+dailyStatusTag(w)+'</td><td>'+doneInfo+'</td>'+
        (showAdmin?'<td><div class="actions-row">'+admin+'</div></td>':'')+
        '</tr>';
    }).join('');
  body+=mirrors.map(function(t){ return dailyProjectMirrorRow(t,readonly,showCreated); }).join('');
  return '<div class="table-wrap"><table><thead><tr>'+
    (readonly?'':'<th style="width:40px">剔選</th>')+
    '<th>工作</th><th>單位</th><th>類型</th><th>優先</th>'+
    (showCreated?'<th>建立日</th>':'')+
    '<th>期限</th><th>狀態</th><th>完成資訊</th>'+
    (showAdmin?'<th>管理</th>':'')+
    '</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function dailyProjectMirrorRow(t,readonly,showCreated){
  var submitted=t.status==='待確認';
  var tick='';
  if(!readonly){
    tick=submitted
      ?'<input type="checkbox" checked onchange="dailyToggleProject(\''+t.pid+'\','+t.idx+',this)" title="取消剔選＝撤回提交">'
      :'<input type="checkbox" onchange="dailyToggleProject(\''+t.pid+'\','+t.idx+',this)" title="剔選＝上傳附件並提交確認">';
  }
  var typeLabel=t.type==='rep'?'補貨':'開發';
  var title='['+typeLabel+'] '+t.code+'｜'+t.stage;
  var extra=
    (t.content?'<div style="font-size:12px;color:#777;margin-top:2px;white-space:pre-wrap">'+dailyEsc(t.content)+'</div>':'')+
    '<div style="margin-top:6px" class="actions-row">'+
      '<button type="button" class="btn gray sm" data-call="askContent" data-arg0="'+escHtml(String(t.pid))+'" data-arg1="'+t.idx+'">填寫工作內容</button> '+
      '<button type="button" class="btn sm" data-call="openProject" data-arg0="'+escHtml(String(t.pid))+'" data-arg1="flow">查看項目</button>'+
    '</div>'+
    (t.files&&t.files.length?'<div style="font-size:11px;color:#888;margin-top:4px">已有附件 '+t.files.length+' 個（提交時仍須新上傳）</div>':'');
  return '<tr>'+
    (readonly?'':'<td>'+tick+'</td>')+
    '<td><b>'+dailyEsc(title)+'</b><div style="font-size:12px;color:#777;margin-top:2px">'+dailyEsc(t.pname)+'</div>'+extra+'</td>'+
    '<td>—</td><td>'+typeTag(t.type)+'</td><td>—</td>'+
    (showCreated?'<td>—</td>':'')+
    '<td>'+dailyEsc(t.deadline||'—')+'</td><td>'+stTag(t.status)+'</td><td>—</td></tr>';
}
function dailyToggleProject(pid,idx,el){
  if(isManager()){ el.checked=!el.checked; alert2('一般管理層不可推進階段。'); return; }
  if(!isPersonal()&&!isAdmin()){ el.checked=!el.checked; return; }
  var p=projects.find(function(x){ return x.id===pid; });
  if(!p||!p.stages[idx]){ el.checked=!el.checked; return; }
  var s=p.stages[idx];
  if(!isStageHandler(s,currentUser.id)&&!isAdmin()){ el.checked=!el.checked; alert2('此階段不是你的待辦。'); return; }
  if(el.checked){
    el.checked=false;
    dailyAskProjectSubmit(pid,idx);
    return;
  }
  el.checked=true;
  showModal(
    '<h3>撤回提交？</h3>'+
    '<p style="font-size:14px">將「'+dailyEsc(p.code)+'｜'+dailyEsc(s.name)+'」由待確認撤回為進行中。</p>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">返回</button>'+
    '<button class="btn red sm" data-call="dailyConfirmProjectWithdraw" data-arg0="'+escHtml(String(pid))+'" data-arg1="'+idx+'">確認撤回</button></div>'
  );
}
function dailyAskProjectSubmit(pid,idx){
  var p=projects.find(function(x){ return x.id===pid; });
  if(!p||!p.stages[idx]) return;
  var s=p.stages[idx];
  showModal(
    '<h3>上傳附件後提交確認</h3>'+
    '<p style="font-size:13px;color:#555">「'+dailyEsc(p.code)+'｜'+dailyEsc(s.name)+'」提交前必須<strong>新上傳</strong>至少 1 個附件（格式不限，可多選）。未開始的階段會自動開始處理。</p>'+
    '<label>選擇檔案</label><input type="file" id="d-proj-files" multiple>'+
    '<div class="actions"><button class="btn gray sm" onclick="closeModal()">取消</button>'+
    '<button class="btn sm" data-call="dailySubmitProject" data-arg0="'+escHtml(String(pid))+'" data-arg1="'+idx+'">上傳並提交</button></div>'
  );
}
async function dailySubmitProject(pid,idx){
  if(isManager()) return alert2('一般管理層不可推進階段。');
  var p=projects.find(function(x){ return x.id===pid; });
  if(!p||!p.stages[idx]) return;
  var s=p.stages[idx];
  if(!isStageHandler(s,currentUser.id)&&!isAdmin()) return alert2('此階段不是你的待辦。');
  var input=document.getElementById('d-proj-files');
  if(!input||!input.files||!input.files.length) return alert2('請至少選擇 1 個附件。');
  try{
    for(var i=0;i<input.files.length;i++){
      var f=input.files[i];
      var up=await cloudUploadFile(f);
      s.files.forEach(function(x){ x.latest=false; });
      var ver='V'+(s.files.length+1);
      s.files.push({name:up.name||f.name, by:currentUser.id, time:nowStr(), ver:ver, latest:true, dataUrl:up.dataUrl, driveFileId:up.driveFileId, mimeType:up.mimeType});
      addProjLog(p,'上載文件', s.name+'｜'+(up.name||f.name)+'（'+ver+'）');
    }
  }catch(e){ return alert2('上傳失敗：'+(e.message||e)); }
  if(['未開始','待處理'].includes(s.status)){
    s.status='進行中';
    addProjLog(p,'開始處理', s.name+' → 進行中');
  }
  if(['進行中','需要修改'].includes(s.status)){
    s.status='待確認';
    s.returnReason='';
    addProjLog(p,'提交確認', s.name+' → 待確認');
  }else if(s.status!=='待確認'){
    return alert2('目前狀態無法提交確認：'+s.status);
  }
  closeModal(); render();
}
function dailyConfirmProjectWithdraw(pid,idx){
  if(isManager()){ closeModal(); return alert2('一般管理層不可推進階段。'); }
  var p=projects.find(function(x){ return x.id===pid; });
  if(!p||!p.stages[idx]){ closeModal(); return; }
  var s=p.stages[idx];
  if(!isStageHandler(s,currentUser.id)&&!isAdmin()){ closeModal(); return alert2('此階段不是你的待辦。'); }
  if(s.status!=='待確認'){ closeModal(); render(); return; }
  s.status='進行中';
  addProjLog(p,'撤回提交', s.name+'｜待確認 → 進行中');
  closeModal(); render();
}
function vDailyToday(user){
  ensureDailySeed();
  var list=getTodayWorksForUser(user);
  var mirrors=dailyCanManage(user)?[]:getProjectTodosForUser(user);
  var done=list.filter(function(w){return w.status==='done';}).length;
  var overdue=list.filter(isOverdue).length;
  var filter='';
  if(dailyCanManage(user)){
    filter='<select onchange="setDailyUnitFilter(this.value)">'+['全部'].concat(STORE_UNITS).map(function(u){
      return '<option value="'+u+'"'+(dailyUnitFilter===u?' selected':'')+'>'+u+'</option>';
    }).join('')+'</select>';
  }else{
    var myUnits=dailyUserUnits(user);
    if(myUnits.length>1){
      // 多單位：可切換地點，只看該單位工作
      var opts=['全部'].concat(myUnits);
      if(dailyUnitFilter!=='全部' && myUnits.indexOf(dailyUnitFilter)<0) dailyUnitFilter='全部';
      filter='<label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-size:13px;color:#555">單位 '+
        '<select onchange="setDailyUnitFilter(this.value)">'+opts.map(function(u){
          return '<option value="'+escHtml(u)+'"'+(dailyUnitFilter===u?' selected':'')+'>'+escHtml(u)+'</option>';
        }).join('')+'</select></label>';
    }else{
      filter='<span class="tag dept">所屬單位：'+dailyEsc(myUnits.length?myUnits.join('、'):'—')+'</span>';
    }
  }
  return '<div class="card"><h2>🗓️ 今日工作｜'+dailyEsc(todayStr())+'</h2>'+
    '<div class="stats">'+
    '<div class="stat"><div class="num">'+list.length+'</div><div class="lbl">門市工作</div></div>'+
    '<div class="stat"><div class="num green">'+done+'</div><div class="lbl">已完成</div></div>'+
    '<div class="stat"><div class="num orange">'+(list.length-done)+'</div><div class="lbl">未完成</div></div>'+
    '<div class="stat"><div class="num red">'+overdue+'</div><div class="lbl">逾期</div></div>'+
    (mirrors.length?'<div class="stat"><div class="num blue">'+mirrors.length+'</div><div class="lbl">項目待辦</div></div>':'')+
    '</div><div class="filters" style="margin-top:12px">'+filter+'</div>'+
    (mirrors.length?'<p style="font-size:12px;color:#888;margin-top:8px">項目待辦（開發／補貨）顯示於下方清單，不計入上方門市完成統計。</p>':'')+
    '</div>'+
    '<div class="card"><h3>工作清單（剔選完成）</h3>'
    +'<p style="font-size:12px;color:#c62828;margin:0 0 8px">突發任務以紅色置頂顯示。</p>'
    +dailyWorkRows(list,user,{mirrors:mirrors,pinAdhoc:true})+'</div>';
}
function vDailyProgress(user){
  ensureDailySeed();
  var progress=getUnitProgress();
  var cards=STORE_UNITS.map(function(unit){
    var p=progress[unit];
    return '<div class="card" style="cursor:pointer" data-call="openDailyUnit" data-arg0="'+escHtml(String(unit))+'">'+
      '<h3>'+unit+'</h3>'+
      '<div class="stats">'+
      '<div class="stat"><div class="num">'+p.total+'</div><div class="lbl">總數</div></div>'+
      '<div class="stat"><div class="num green">'+p.done+'</div><div class="lbl">已完成</div></div>'+
      '<div class="stat"><div class="num orange">'+p.open+'</div><div class="lbl">未完成</div></div>'+
      '<div class="stat"><div class="num red">'+p.overdue+'</div><div class="lbl">逾期</div></div>'+
      '<div class="stat"><div class="num blue">'+p.pct+'%</div><div class="lbl">完成率</div></div>'+
      '</div><p style="margin-top:8px;font-size:12px;color:#888">點擊查看唯讀明細</p></div>';
  }).join('');
  return '<div class="card"><h2>📊 各單位進度</h2><p style="color:#666;font-size:13px">個人賬號可查看其他單位，但不可替其他單位剔選。</p></div>'+cards;
}
function vDailyUnit(user){
  ensureDailySeed();
  var unit=dailyProgressUnit||STORE_UNITS[0];
  var p=workCountsForUnit(unit);
  var mine=dailyUserInUnit(user, unit);
  var readonly=!dailyCanManage(user)&&!mine;
  return '<div class="card"><h2>📍 '+dailyEsc(unit)+' 工作明細</h2>'+
    '<div class="stats">'+
    '<div class="stat"><div class="num">'+p.total+'</div><div class="lbl">總數</div></div>'+
    '<div class="stat"><div class="num green">'+p.done+'</div><div class="lbl">已完成</div></div>'+
    '<div class="stat"><div class="num red">'+p.overdue+'</div><div class="lbl">逾期</div></div>'+
    '<div class="stat"><div class="num blue">'+p.pct+'%</div><div class="lbl">完成率</div></div></div>'+
    '<div class="filters" style="margin-top:12px"><button class="btn gray sm" data-call="goDailyView" data-arg0="progress">← 返回進度</button></div>'+
    (readonly?'<div class="info-banner" style="margin-top:10px">🔒 唯讀：非你所屬單位，不可剔選。</div>':'')+
    '</div><div class="card">'+dailyWorkRows(p.items,user,{readonly:readonly})+'</div>';
}
function vDailyNew(user){
  if(!dailyCanManage(user)) return '<div class="card"><h2>➕ 管理工作</h2><p>個人賬號不可新增工作。</p></div>';
  ensureDailySeed();
  var list=loadDailyState().works.filter(function(w){
    return w && w.kind==='adhoc' && w.status!=='cancelled';
  }).sort(function(a,b){
    return String(b.dueDate||'').localeCompare(String(a.dueDate||'')) ||
      String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')) ||
      String(a.title||'').localeCompare(String(b.title||''),'zh-Hant');
  });
  var rows=!list.length
    ?'<p style="color:#888">尚未建立突發工作。按上方按鈕新增後，會顯示於此。</p>'
    :('<div class="table-wrap"><table><thead><tr>'+
      '<th>工作</th><th>單位</th><th>指派</th><th>優先</th><th>期限</th><th>狀態</th><th>完成資訊</th><th>管理</th>'+
      '</tr></thead><tbody>'+
      list.map(function(w){
        var doneInfo=w.status==='done'
          ? dailyEsc(w.completedByName||'—')+'<div style="font-size:11px;color:#888">'+dailyEsc(w.completedAt||'')+'</div>'
          : '—';
        var admin='<button class="btn gray sm" data-call="dailyEditWork" data-arg0="'+escHtml(String(w.id))+'">編輯</button> ';
        if(w.status==='done') admin+='<button class="btn warn sm" data-call="dailyReopen" data-arg0="'+escHtml(String(w.id))+'">重開</button> ';
        admin+='<button class="btn red sm" data-call="dailyCancelWork" data-arg0="'+escHtml(String(w.id))+'">取消</button>';
        return '<tr>'+
          '<td><b>'+dailyEsc(w.title)+'</b>'+(w.content?'<div style="font-size:12px;color:#777;margin-top:2px;white-space:pre-wrap">'+dailyEsc(w.content)+'</div>':'')+'</td>'+
          '<td>'+dailyEsc(w.unit)+'</td>'+
          '<td style="font-size:12px">'+dailyEsc(workAssigneesLabel(w))+'</td>'+
          '<td>'+priorityTag(w.priority)+'</td>'+
          '<td>'+dailyEsc(w.dueDate||'—')+'</td>'+
          '<td>'+dailyStatusTag(w)+'</td>'+
          '<td>'+doneInfo+'</td>'+
          '<td><div class="actions-row">'+admin+'</div></td>'+
          '</tr>';
      }).join('')+
      '</tbody></table></div>');
  return '<div class="card"><h2>➕ 新增突發工作</h2>'+
    '<p style="color:#666;font-size:13px;margin-bottom:10px">可指定多個單位、員工、期限與優先級；建立後即出現在下方清單，並進入對應單位今日／期限日清單。</p>'+
    '<button class="btn" onclick="dailyCreateAdhoc()">🛠️ 建立突發工作</button> '+
    '<button class="btn gray" data-call="goDailyView" data-arg0="recurring">前往恆常任務</button></div>'+
    '<div class="card"><h3>已建立的突發工作（'+list.length+'）</h3>'+rows+'</div>';
}
function askDeleteTemplate(id){
  if(!dailyCanManage(currentUser)) return alert2('只有管理層可以刪除恆常任務。');
  if(!requireCloud('刪除恆常任務')) return;
  var t=loadDailyState().recurringTemplates.find(function(x){return x.id===id;});
  if(!t) return;
  showModal('<h3>刪除恆常任務？</h3>'+
    '<p style="font-size:14px;line-height:1.6">確定刪除「<b>'+dailyEsc(t.title)+'</b>」？<br>'+
    '刪除後<strong>不會再每日出現</strong>於今日工作；尚未完成的相關工作會一併取消。<br>'+
    '若只想暫停，請用「停用」，不要刪除。</p>'+
    '<div class="actions">'+
    '<button class="btn sm gray" onclick="closeModal()">取消</button>'+
    '<button class="btn sm red" data-call="confirmDeleteTemplate" data-arg0="'+escHtml(String(id))+'">確認刪除</button>'+
    '</div>');
}
function confirmDeleteTemplate(id){
  closeModal();
  if(!requireCloud('刪除恆常任務')) return;
  if(!deleteTemplate(id,currentUser)) return alert2('刪除失敗。');
  flushCloudSaves().then(function(){ render(); alert2('已刪除恆常任務。'); }).catch(function(){ render(); alert2('已刪除（雲端同步可能失敗，請查看頂欄狀態）。'); });
}
function vDailyRecurring(user){
  ensureDailySeed();
  var list=loadDailyState().recurringTemplates;
  var rows=!list.length?'<p style="color:#888">暫無恆常任務。請按上方按鈕建立。</p>':
    '<div class="table-wrap"><table><thead><tr><th>任務</th><th>單位</th><th>指定人員</th><th>優先</th><th>附件</th><th>狀態</th>'+(dailyCanManage(user)?'<th>管理</th>':'')+'</tr></thead><tbody>'+
    list.map(function(t){
      var admin=dailyCanManage(user)
        ?('<button class="btn gray sm" data-call="dailyEditTemplate" data-arg0="'+escHtml(String(t.id))+'">編輯</button> '+
          (t.active
            ?'<button class="btn warn sm" data-call="dailyToggleTemplate" data-arg0="'+escHtml(String(t.id))+'" data-arg1="false">停用</button>'
            :'<button class="btn green sm" data-call="dailyToggleTemplate" data-arg0="'+escHtml(String(t.id))+'" data-arg1="true">啟用</button>')+
          ' <button class="btn red sm" data-call="askDeleteTemplate" data-arg0="'+escHtml(String(t.id))+'">刪除</button>')
        :'';
      var assignLabel=(t.assigneeIds&&t.assigneeIds.length)
        ? dailyEsc((t.assigneeNames&&t.assigneeNames.length?t.assigneeNames:t.assigneeIds.map(userName)).join('、'))
        : '<span style="color:#888">整單位</span>';
      return '<tr><td><b>'+dailyEsc(t.title)+'</b>'+(t.content?'<div style="font-size:12px;color:#777">'+dailyEsc(t.content)+'</div>':'')+'</td>'+
        '<td>'+dailyEsc((t.units||[]).join('、'))+'</td><td style="font-size:12px">'+assignLabel+'</td><td>'+priorityTag(t.priority||'中')+'</td>'+
        '<td>'+(t.requireAttachment?'<span class="tag" style="background:#fff3e0;color:#e65100">需上傳</span>':'<span class="tag s-na">否</span>')+'</td>'+
        '<td>'+(t.active?'<span class="tag s-done">啟用</span>':'<span class="tag s-na">停用</span>')+'</td>'+
        (dailyCanManage(user)?'<td><div class="actions-row">'+admin+'</div></td>':'')+'</tr>';
    }).join('')+'</tbody></table></div>';
  return '<div class="card"><h2>🔁 恆常任務</h2>'+
    '<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">啟用中的恆常任務會<strong>每日</strong>出現在「今日工作」（未完成會跨日延續並標示逾期；完成後隔日再產生新一筆）。'+
    '只有在此列表按<strong>刪除</strong>才會永久停止並取消未完成工作；「停用」僅暫停產生。</p>'+
    (dailyCanManage(user)?'<button class="btn sm" onclick="dailyCreateRecurring()">＋ 建立恆常任務</button>':'')+
    '<div style="margin-top:12px">'+rows+'</div></div>';
}
function vDailyRecords(user){
  ensureDailySeed();
  var s=loadDailyState();
  var uid=dailyUserId(user);
  var list=s.works.filter(function(w){
    return w.status==='done' && w.completedBy===uid;
  }).sort(function(a,b){ return String(b.completedAt||'').localeCompare(String(a.completedAt||'')); });
  var rows=!list.length?'<p style="color:#888">暫無你的完成記錄。</p>':
    '<div class="table-wrap"><table><thead><tr><th>工作</th><th>單位</th><th>類型</th><th>完成時間</th><th>附件</th></tr></thead><tbody>'+
    list.map(function(w){
      var attach=Array.isArray(w.attachments)&&w.attachments.length
        ? w.attachments.map(function(f,i){ return dailyFileViewHtml(f, w.id, i); }).join(' ')
        : '<span style="color:#aaa">—</span>';
      return '<tr><td><b>'+dailyEsc(w.title)+'</b></td><td>'+dailyEsc(w.unit)+'</td><td>'+dailyKindTag(w)+'</td>'+
        '<td style="font-size:12px">'+dailyEsc(w.completedAt||'—')+'</td>'+
        '<td style="font-size:12px;line-height:1.8">'+attach+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  return '<div class="card"><h2>📋 我的完成記錄</h2>'+
    '<p style="color:#666;font-size:13px;margin-bottom:10px">只顯示你本人剔選完成的工作。附件可點擊在彈窗內檢視。</p>'+rows+'</div>';
}
function vDailyHistory(user){
  ensureDailySeed();
  var list=getDailyHistoryWorks();
  var unitOpts=['全部'].concat(STORE_UNITS).map(function(u){
    return '<option value="'+escHtml(u)+'"'+(dailyHistoryUnit===u?' selected':'')+'>'+escHtml(u)+'</option>';
  }).join('');
  var statusOpts=[
    ['全部','全部狀態'],['done','已完成'],['open','未完成（含逾期）'],['cancelled','已取消']
  ].map(function(pair){
    return '<option value="'+pair[0]+'"'+(dailyHistoryStatus===pair[0]?' selected':'')+'>'+pair[1]+'</option>';
  }).join('');
  return '<div class="card">'+
    '<h2>📚 歷史記錄</h2>'+
    '<p style="font-size:13px;color:#666;margin:0 0 10px;line-height:1.55">顯示過往工作（期限早於今天，或已完成／已取消）。可依<strong>建立日</strong>起迄篩選（可只填一邊）。附件可點擊在彈窗內檢視。</p>'+
    '<div class="filters">'+
    '<input type="text" placeholder="搜尋標題／內容／完成人" value="'+escHtml(dailyHistoryKw)+'" onchange="setDailyHistoryKw(this.value)" onkeydown="if(event.key===\'Enter\'){setDailyHistoryKw(this.value)}">'+
    '<select onchange="setDailyHistoryUnit(this.value)">'+unitOpts+'</select>'+
    '<select onchange="setDailyHistoryStatus(this.value)">'+statusOpts+'</select>'+
    '<label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-size:12px;color:#666">建立由'+
      '<input type="date" value="'+escHtml(dailyHistoryFrom)+'" onchange="setDailyHistoryFrom(this.value)" style="width:auto;min-width:140px">'+
    '</label>'+
    '<label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-size:12px;color:#666">至'+
      '<input type="date" value="'+escHtml(dailyHistoryTo)+'" onchange="setDailyHistoryTo(this.value)" style="width:auto;min-width:140px">'+
    '</label>'+
    '</div>'+
    '<p style="font-size:12px;color:#888;margin:8px 0 0">共 '+list.length+' 筆</p>'+
    '</div>'+
    '<div class="card">'+
    (list.length
      ? dailyWorkRows(list,user,{readonly:true,pinAdhoc:false,showCreatedDate:true})
      : '<p style="color:#888">沒有符合條件的歷史記錄。</p>')+
    '</div>';
}
function vDailyOpLogs(user){
  if(!dailyCanManage(user)){
    return '<div class="card"><h2>📜 操作記錄</h2><p>只有管理層可以查看每日工作流程的操作記錄。</p></div>';
  }
  ensureDailySeed();
  var list=(loadDailyState().opLogs||[]).slice();
  var rows=!list.length?'<p style="color:#888">暫無操作記錄。</p>':
    '<div class="table-wrap"><table><thead><tr><th>時間</th><th>操作人員</th><th>操作</th><th>詳情</th></tr></thead><tbody>'+
    list.map(function(l){
      return '<tr><td style="font-size:11px;white-space:nowrap">'+dailyEsc(l.time)+'</td><td>'+dailyEsc(l.user)+'</td><td><b>'+dailyEsc(l.action)+'</b></td><td style="font-size:12px">'+dailyEsc(l.detail||'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  return '<div class="card"><h2>📜 每日工作流程｜操作記錄</h2>'+
    '<p style="font-size:13px;color:#666;margin-bottom:10px">只顯示每日工作流程內的操作（完成、建立、編輯、停用等），不含開發及生產／補貨。</p>'+
    rows+'</div>';
}


/* ═══════════ Modal ═══════════ */
function showModal(html){ document.getElementById('modal-content').innerHTML=html; document.getElementById('modal-bg').classList.remove('hidden'); }
function closeModal(){
  var el=document.getElementById('modal-content');
  if(el) el.classList.remove('modal-wide');
  document.getElementById('modal-bg').classList.add('hidden');
}
function alert2(msg){ showModal(`<h3>提示</h3><p style="font-size:14px">${msg}</p><div class="actions"><button class="btn sm" onclick="closeModal()">確定</button></div>`); }
document.getElementById('modal-bg').addEventListener('click', e=>{ if(e.target.id==='modal-bg') closeModal(); });
document.getElementById('login-pw').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
document.addEventListener('keydown', function(e){
  if(e.key==='Escape' && mailboxOpen) closeMailbox();
});
// 建立項目頁初始化階段列表
const _go = go;
go = function(v){ _go(v); if(v==='addProject') setTimeout(renderNpStages, 0); };

(async function bootCloud(){
  const err = document.getElementById('login-err');
  if(err){
    err.style.display = 'block';
    err.textContent = '正在連接資料儲存（MongoDB）…';
  }
  loadUsersLocal();
  await initCloud();
  ensureAdminUser();
  if(!apiEnabled){
    loadUsersLocal();
    loadNotificationsLocal();
  }
  refreshMailboxUi();
  refreshCloudSyncStatus();
  if(err && !currentUser){
    if(apiEnabled){
      err.style.display = 'block';
      err.style.color = '#2e7d32';
      err.textContent = '已連接 MongoDB 雲端。請登入（帳號存於 users collection）。';
    } else {
      err.style.display = 'block';
      err.style.color = '#c62828';
      err.textContent = '未連接 MongoDB，無法使用正式系統。請在 Railway 設定 MONGODB_URI 後重新整理。';
    }
  } else if(err && currentUser){
    err.style.display = 'none';
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='hidden') flushCloudSaves();
    if(document.visibilityState==='visible') checkAppVersion();
  });
  window.addEventListener('pagehide', function(){ flushCloudSaves(); });
  window.addEventListener('focus', function(){ checkAppVersion(); });
  bindStaticChrome();
  startAppVersionWatcher();
})();

/* ═══════════ 新版本提示／更新系統 ═══════════ */
let clientAppVersion = null;
let appUpdateDismissedFor = null;
let appVersionTimer = null;
const APP_VERSION_POLL_MS = 60 * 1000;

async function fetchAppVersion(){
  const r = await fetch(apiUrl('/api/version'), { cache: 'no-store', credentials: 'include' });
  if(!r.ok) throw new Error('version HTTP '+r.status);
  const text = await r.text();
  if(!text || !String(text).trim()) return {};
  return JSON.parse(text);
}
function showAppUpdateBanner(show){
  const el = document.getElementById('app-update-banner');
  if(!el) return;
  if(show) el.classList.remove('hidden');
  else el.classList.add('hidden');
}
async function checkAppVersion(){
  try{
    const info = await fetchAppVersion();
    const remote = info && info.version ? String(info.version) : '';
    if(!remote) return;
    if(!clientAppVersion){
      clientAppVersion = remote;
      return;
    }
    if(remote === clientAppVersion){
      if(appUpdateDismissedFor === remote) return;
      showAppUpdateBanner(false);
      return;
    }
    if(appUpdateDismissedFor === remote) return;
    showAppUpdateBanner(true);
  }catch(e){
    /* 離線或舊伺服器無此 API 時略過 */
  }
}
function dismissAppUpdate(){
  fetchAppVersion().then(function(info){
    if(info && info.version) appUpdateDismissedFor = String(info.version);
  }).catch(function(){});
  showAppUpdateBanner(false);
}
async function applyAppUpdate(){
  showAppUpdateBanner(false);
  try{ await flushCloudSaves(); }catch(e){}
  // Reload root; bootstrap in index.html loads /app.js?v=<build> so code cache is busted cleanly.
  window.location.replace('/?_v=' + encodeURIComponent(String(Date.now())));
}
function startAppVersionWatcher(){
  checkAppVersion();
  if(appVersionTimer) clearInterval(appVersionTimer);
  appVersionTimer = setInterval(checkAppVersion, APP_VERSION_POLL_MS);
}
