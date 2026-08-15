/* ═══════════ POS 雲端模組（庫存＝調動；會員＝雲端） ═══════════ */
var POS_LS_KEY = 'store-web-pos-demo-v1'; // 舊本機 key，載入時清除
var POS_PAYMENTS = [
  { id: 'cash', name: '現金' },
  { id: 'credit_card', name: '信用卡' },
  { id: 'octopus', name: '八達通' },
  { id: 'fps', name: 'FPS' }
];
var POS_STORES_FALLBACK = ['觀塘', '荔枝角', '灣仔', '屯門'];

var posCart = [];
var posSelectedStore = '';
var posSearchKw = '';
var posMemberId = '';
var posRemark = '';
var posAccountBalance = 0;
var posPaymentMethod = 'cash';
var posReceiptFocusId = '';
var posTxKw = '';
var posReturnMode = false;
var posExchangeMode = false;
var posCloud = {
  products: [],
  transactions: [],
  stores: [],
  canManage: false,
  canReset: false,
  loaded: false,
  loading: false,
  error: ''
};
var posMembersCloud = {
  list: [],
  canEdit: false,
  loaded: false,
  loading: false,
  error: '',
  kw: '',
  includeInactive: false
};
var posPointsSettings = {
  loaded: false,
  loading: false,
  error: '',
  pointsPerDollar: 100,
  redeemEnabled: true,
  canEdit: false
};
var posPointsToRedeem = 0;
var posMemberEditId = '';
var posMemberPointsId = '';
var posMemberPoints = { loaded: false, loading: false, error: '', ledger: [], member: null };
var posAdjustProductId = '';
var posShowAddPanel = false;
var posCatalogOptions = [];
var posAddForm = { key: '', price: '', sku: '' };
var posReport = {
  loaded: false,
  loading: false,
  error: '',
  store: '',
  from: '',
  to: '',
  summary: null,
  stores: [],
  canExport: false,
  canManage: false
};
var posSettlement = {
  loaded: false,
  loading: false,
  error: '',
  store: '',
  date: '',
  data: null
};

function posHkToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch (e) {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
}
function posPayName(id) {
  var m = { cash: '現金', credit_card: '信用卡', octopus: '八達通', fps: 'FPS' };
  return m[id] || id;
}
async function posReloadDailyAfterSettlement() {
  if (typeof apiEnabled === 'undefined' || !apiEnabled || !authToken) return;
  try {
    var dirty = false;
    try { dirty = localStorage.getItem(typeof DAILY_DIRTY_KEY !== 'undefined' ? DAILY_DIRTY_KEY : 'store-web-daily-dirty') === '1'; } catch (e) {}
    if (dirty) return;
    var daily = await apiFetch('/api/daily');
    if (typeof dailyNormalizeState === 'function' && typeof dailyStateCache !== 'undefined') {
      dailyStateCache = dailyNormalizeState(daily);
      try {
        if (typeof DAILY_KEY !== 'undefined') localStorage.setItem(DAILY_KEY, JSON.stringify(dailyStateCache));
        if (typeof DAILY_DIRTY_KEY !== 'undefined') localStorage.setItem(DAILY_DIRTY_KEY, '0');
      } catch (e) {}
    }
  } catch (e) {}
}

function posDiscardLocalDemo() {
  try { localStorage.removeItem(POS_LS_KEY); } catch (e) {}
}
function posMoney(n) {
  var x = Number(n);
  if (!isFinite(x)) x = 0;
  return x.toFixed(2);
}
function posEsc(s) {
  if (typeof dailyEsc === 'function') return dailyEsc(s);
  if (typeof escHtml === 'function') return escHtml(s);
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function posUserStoresLocal() {
  if (posCloud.stores && posCloud.stores.length) return posCloud.stores.slice();
  var user = typeof currentUser !== 'undefined' ? currentUser : null;
  var units = [];
  if (typeof dailyUserUnits === 'function') units = dailyUserUnits(user) || [];
  else if (user && Array.isArray(user.units)) units = user.units.slice();
  var list = units.filter(function (u) { return POS_STORES_FALLBACK.indexOf(u) >= 0; });
  if (!list.length && user && (user.role === 'system_admin' || user.role === 'manager')) {
    return POS_STORES_FALLBACK.slice();
  }
  return list;
}
function posEnsureStore() {
  var stores = posUserStoresLocal();
  if (!stores.length) {
    posSelectedStore = '';
    return '';
  }
  if (stores.indexOf(posSelectedStore) < 0) posSelectedStore = stores[0];
  return posSelectedStore;
}
function posInvalidateCloud() {
  posCloud.loaded = false;
  posCloud.error = '';
}
async function posRefreshCloud(force) {
  if (!apiEnabled || !authToken) {
    posCloud.error = '需要連接雲端並登入後才能使用 POS。';
    posCloud.loaded = true;
    return posCloud;
  }
  if (posCloud.loading) return;
  if (posCloud.loaded && !force) return posCloud;
  posCloud.loading = true;
  posCloud.error = '';
  posDiscardLocalDemo();
  try {
    var prods = await apiFetch('/api/pos/products');
    var txs = await apiFetch('/api/pos/transactions');
    posCloud.products = (prods && prods.products) || [];
    posCloud.transactions = (txs && txs.transactions) || [];
    posCloud.stores = (prods && prods.stores) || (txs && txs.stores) || [];
    posCloud.canManage = !!(prods && prods.canManage) || !!(txs && txs.canManage);
    posCloud.canReset = !!(prods && prods.canReset) || !!(txs && txs.canReset);
    posCloud.loaded = true;
  } catch (e) {
    posCloud.error = (e && e.message) || String(e);
    posCloud.loaded = true;
  } finally {
    posCloud.loading = false;
  }
  return posCloud;
}
function posKickLoad() {
  if (posCloud.loading) return;
  if (posCloud.loaded) return;
  posRefreshCloud(false).then(function () {
    if (typeof render === 'function') render();
  });
}
function posFindProduct(id) {
  return (posCloud.products || []).find(function (p) { return p.id === id; }) || null;
}
function posFindMember(id) {
  return (posMembersCloud.list || []).find(function (m) { return m.id === id || m.phone === id; }) || null;
}
function posInvalidateMembers() {
  posMembersCloud.loaded = false;
  posMembersCloud.error = '';
}
async function posRefreshMembers(force) {
  if (!apiEnabled || !authToken) {
    posMembersCloud.error = '需要連接雲端並登入。';
    posMembersCloud.loaded = true;
    return;
  }
  if (posMembersCloud.loading) return;
  if (posMembersCloud.loaded && !force) return;
  posMembersCloud.loading = true;
  posMembersCloud.error = '';
  try {
    var q = encodeURIComponent(posMembersCloud.kw || '');
    var inc = posMembersCloud.includeInactive ? '1' : '0';
    var res = await apiFetch('/api/pos/members?q=' + q + '&includeInactive=' + inc);
    posMembersCloud.list = (res && res.members) || [];
    posMembersCloud.canEdit = !!(res && res.canEdit);
    posMembersCloud.loaded = true;
  } catch (e) {
    posMembersCloud.error = (e && e.message) || String(e);
    posMembersCloud.loaded = true;
  } finally {
    posMembersCloud.loading = false;
  }
}
function posKickMembersLoad() {
  if (posMembersCloud.loading) return;
  if (posMembersCloud.loaded) return;
  posRefreshMembers(false).then(function () {
    if (typeof render === 'function') render();
  });
}
function posInvalidatePointsSettings() {
  posPointsSettings.loaded = false;
  posPointsSettings.error = '';
}
async function posRefreshPointsSettings(force) {
  if (!apiEnabled || !authToken) {
    posPointsSettings.error = '需要連接雲端並登入。';
    posPointsSettings.loaded = true;
    return posPointsSettings;
  }
  if (posPointsSettings.loading) return posPointsSettings;
  if (posPointsSettings.loaded && !force) return posPointsSettings;
  posPointsSettings.loading = true;
  posPointsSettings.error = '';
  try {
    var res = await apiFetch('/api/pos/points-settings');
    var s = (res && res.settings) || res || {};
    posPointsSettings.pointsPerDollar = Math.max(1, Math.floor(Number(s.pointsPerDollar) || 100));
    posPointsSettings.redeemEnabled = s.redeemEnabled !== false;
    posPointsSettings.canEdit = !!(res && res.canEdit);
    posPointsSettings.loaded = true;
  } catch (e) {
    posPointsSettings.error = (e && e.message) || String(e);
    posPointsSettings.loaded = true;
  } finally {
    posPointsSettings.loading = false;
  }
  return posPointsSettings;
}
function posKickPointsSettingsLoad() {
  if (posPointsSettings.loading) return;
  if (posPointsSettings.loaded) return;
  posRefreshPointsSettings(false).then(function () {
    if (typeof render === 'function') render();
  });
}
function posSetPointsToRedeem(v) {
  var n = parseInt(v, 10);
  posPointsToRedeem = isFinite(n) && n > 0 ? n : 0;
  if (typeof render === 'function') render();
}
function posPointsDiscountPreview(pts) {
  var n = Math.max(1, Number(posPointsSettings.pointsPerDollar) || 100);
  var p = Number(pts) || 0;
  if (p <= 0) return 0;
  return Math.round((p / n) * 100) / 100;
}
async function posSavePointsSettings() {
  if (!posPointsSettings.canEdit) {
    alert2('只有管理員／主管可修改積分設定。');
    return;
  }
  var nEl = document.getElementById('pos-pts-per-dollar');
  var enEl = document.getElementById('pos-pts-redeem-enabled');
  var n = nEl ? parseInt(nEl.value, 10) : posPointsSettings.pointsPerDollar;
  if (!isFinite(n) || n < 1) {
    alert2('每 N 分＝$1 的 N 須為 ≥1 的整數。');
    return;
  }
  try {
    var res = await apiFetch('/api/pos/points-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pointsPerDollar: n,
        redeemEnabled: enEl ? !!enEl.checked : true
      })
    });
    var s = (res && res.settings) || {};
    posPointsSettings.pointsPerDollar = Math.max(1, Math.floor(Number(s.pointsPerDollar) || n));
    posPointsSettings.redeemEnabled = s.redeemEnabled !== false;
    posPointsSettings.canEdit = !!(res && res.canEdit !== false);
    posPointsSettings.loaded = true;
    alert2('已更新積分設定。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('儲存失敗：' + (e.message || e));
  }
}
function posSetMembersKw(v) {
  posMembersCloud.kw = String(v || '');
  posInvalidateMembers();
  posRefreshMembers(true).then(function () { if (typeof render === 'function') render(); });
}
function posToggleMembersInactive() {
  posMembersCloud.includeInactive = !posMembersCloud.includeInactive;
  posInvalidateMembers();
  posRefreshMembers(true).then(function () { if (typeof render === 'function') render(); });
}
async function posCreateMember() {
  var nameEl = document.getElementById('pos-mem-name');
  var phoneEl = document.getElementById('pos-mem-phone');
  var levelEl = document.getElementById('pos-mem-level');
  var remarkEl = document.getElementById('pos-mem-remark');
  try {
    var res = await apiFetch('/api/pos/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameEl ? nameEl.value : '',
        phone: phoneEl ? phoneEl.value : '',
        level: levelEl ? levelEl.value : '一般會員',
        remark: remarkEl ? remarkEl.value : ''
      })
    });
    if (res && res.member) posMemberId = res.member.id || res.member.phone;
    posInvalidateMembers();
    await posRefreshMembers(true);
    alert2('已新增會員。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('新增失敗：' + (e.message || e));
  }
}
function posOpenMemberEdit(id) {
  posMemberEditId = String(id || '');
  if (typeof render === 'function') render();
}
function posCloseMemberEdit() {
  posMemberEditId = '';
  if (typeof render === 'function') render();
}
async function posSaveMemberEdit(id) {
  var nameEl = document.getElementById('pos-mem-edit-name');
  var phoneEl = document.getElementById('pos-mem-edit-phone');
  var levelEl = document.getElementById('pos-mem-edit-level');
  var remarkEl = document.getElementById('pos-mem-edit-remark');
  try {
    await apiFetch('/api/pos/members/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameEl ? nameEl.value : undefined,
        phone: phoneEl ? phoneEl.value : undefined,
        level: levelEl ? levelEl.value : undefined,
        remark: remarkEl ? remarkEl.value : undefined
      })
    });
    posMemberEditId = '';
    posInvalidateMembers();
    await posRefreshMembers(true);
    alert2('已更新會員。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('更新失敗：' + (e.message || e));
  }
}
async function posSetMemberActive(id, active) {
  try {
    await apiFetch('/api/pos/members/' + encodeURIComponent(id) + '/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !!active })
    });
    posInvalidateMembers();
    await posRefreshMembers(true);
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('操作失敗：' + (e.message || e));
  }
}
async function posOpenMemberPoints(id) {
  posMemberPointsId = String(id || '');
  posMemberPoints = { loaded: false, loading: false, error: '', ledger: [], member: null };
  if (typeof render === 'function') render();
  await posRefreshMemberPoints(true);
}
function posCloseMemberPoints() {
  posMemberPointsId = '';
  posMemberPoints = { loaded: false, loading: false, error: '', ledger: [], member: null };
  if (typeof render === 'function') render();
}
async function posRefreshMemberPoints(force) {
  if (!posMemberPointsId) return;
  if (posMemberPoints.loading) return;
  if (posMemberPoints.loaded && !force) return;
  posMemberPoints.loading = true;
  posMemberPoints.error = '';
  try {
    var res = await apiFetch('/api/pos/members/' + encodeURIComponent(posMemberPointsId) + '/points');
    posMemberPoints.member = res.member || null;
    posMemberPoints.ledger = res.ledger || [];
    posMemberPoints.loaded = true;
  } catch (e) {
    posMemberPoints.error = String(e.message || e);
    posMemberPoints.loaded = true;
  }
  posMemberPoints.loading = false;
  if (typeof render === 'function') render();
}
async function posSubmitAdjustPoints(id) {
  var deltaEl = document.getElementById('pos-pts-delta');
  var reasonEl = document.getElementById('pos-pts-reason');
  var delta = deltaEl ? parseInt(deltaEl.value, 10) : 0;
  var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
  if (!delta) { alert2('請輸入非零整數積分。'); return; }
  if (!reason) { alert2('請填寫調分原因。'); return; }
  try {
    await apiFetch('/api/pos/members/' + encodeURIComponent(id) + '/points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: delta, reason: reason })
    });
    posInvalidateMembers();
    await posRefreshMembers(true);
    await posRefreshMemberPoints(true);
    alert2('已調分。');
  } catch (e) {
    alert2('調分失敗：' + (e.message || e));
  }
}
function posCartSubtotal() {
  return posCart.reduce(function (sum, line) {
    return sum + (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
  }, 0);
}
function posSetStore(store) {
  var stores = posUserStoresLocal();
  if (stores.indexOf(store) < 0) return;
  posSelectedStore = store;
  if (typeof render === 'function') render();
}
function posSetSearch(v) {
  posSearchKw = String(v || '');
  if (typeof render === 'function') render();
}
function posSetMember(id) {
  posMemberId = String(id || '');
  posPointsToRedeem = 0;
  if (typeof render === 'function') render();
}
function posSetRemark(v) { posRemark = String(v || ''); }
function posSetAccountBalance(v) {
  var n = parseFloat(v);
  posAccountBalance = isFinite(n) ? n : 0;
  if (typeof render === 'function') render();
}
function posSetPayment(method) {
  posPaymentMethod = method || 'cash';
  if (typeof render === 'function') render();
}
function posSetTxKw(v) {
  posTxKw = String(v || '');
  if (typeof render === 'function') render();
}
function posAddToCart(productId) {
  var store = posEnsureStore();
  if (!store) { alert2('你的賬戶沒有可收銀的港店單位。'); return; }
  var p = posFindProduct(productId);
  if (!p) { alert2('找不到商品。'); return; }
  var avail = Number((p.stock && p.stock[store]) || 0);
  var existing = posCart.find(function (x) { return x.productId === productId; });
  var nextQty = (existing ? existing.qty : 0) + 1;
  if (nextQty > avail) { alert2('庫存不足（' + store + ' 剩餘 ' + avail + '）。'); return; }
  if (existing) existing.qty = nextQty;
  else {
    posCart.push({
      productId: p.id, name: p.name, sku: p.sku, size: p.size,
      unitPrice: Number(p.price) || 0, qty: 1
    });
  }
  if (typeof render === 'function') render();
}
function posCartQty(productId, delta) {
  var store = posEnsureStore();
  var p = posFindProduct(productId);
  var line = posCart.find(function (x) { return x.productId === productId; });
  if (!line) return;
  var avail = p && p.stock ? Number(p.stock[store] || 0) : 9999;
  var next = (Number(line.qty) || 0) + Number(delta);
  if (next <= 0) posCart = posCart.filter(function (x) { return x.productId !== productId; });
  else if (next > avail) { alert2('庫存不足（' + store + ' 剩餘 ' + avail + '）。'); return; }
  else line.qty = next;
  if (typeof render === 'function') render();
}
function posRemoveCartLine(productId) {
  posCart = posCart.filter(function (x) { return x.productId !== productId; });
  if (typeof render === 'function') render();
}
function posClearCart() {
  posCart = [];
  if (typeof render === 'function') render();
}
async function posCheckout() {
  var store = posEnsureStore();
  if (!store) { alert2('你的賬戶沒有可收銀的港店單位。'); return; }
  if (!posCart.length) { alert2('購物車是空的。'); return; }
  var member = posFindMember(posMemberId);
  var redeemEl = document.getElementById('pos-points-to-redeem');
  var pointsToRedeem = redeemEl ? parseInt(redeemEl.value, 10) : posPointsToRedeem;
  if (!isFinite(pointsToRedeem) || pointsToRedeem < 0) pointsToRedeem = 0;
  try {
    var body = {
      store: store,
      paymentMethod: posPaymentMethod,
      accountBalance: posAccountBalance,
      remark: posRemark,
      memberId: member ? member.id : '',
      memberName: member ? member.name : '',
      memberPhone: member ? member.phone : '',
      items: posCart.map(function (l) { return { productId: l.productId, qty: l.qty }; })
    };
    if (pointsToRedeem > 0) body.pointsToRedeem = pointsToRedeem;
    var res = await apiFetch('/api/pos/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var tx = res && res.transaction;
    posCart = [];
    posRemark = '';
    posAccountBalance = 0;
    posMemberId = '';
    posPointsToRedeem = 0;
    posReceiptFocusId = tx ? tx.id : '';
    posInvalidateCloud();
    await posRefreshCloud(true);
    posInvalidateMembers();
    await posRefreshMembers(true);
    if (typeof go === 'function') go('posReceipt');
    else if (typeof render === 'function') render();
  } catch (e) {
    alert2('結帳失敗：' + (e.message || e));
    posInvalidateCloud();
    await posRefreshCloud(true);
    if (typeof render === 'function') render();
  }
}
function posOpenReceipt(id) {
  posReceiptFocusId = String(id || '');
  posReturnMode = false;
  posExchangeMode = false;
  if (typeof go === 'function') go('posReceipt');
}
function posToggleReturnMode() {
  posReturnMode = !posReturnMode;
  if (posReturnMode) posExchangeMode = false;
  if (typeof render === 'function') render();
}
function posCancelReturnMode() {
  posReturnMode = false;
  if (typeof render === 'function') render();
}
function posToggleExchangeMode() {
  posExchangeMode = !posExchangeMode;
  if (posExchangeMode) posReturnMode = false;
  if (typeof render === 'function') render();
}
function posCancelExchangeMode() {
  posExchangeMode = false;
  if (typeof render === 'function') render();
}
function posTxStatusLabel(tx) {
  if (!tx) return '—';
  if (tx.status === 'full_return' || String(tx.orderStatus || '').indexOf('全部退貨') >= 0) return '全部退貨';
  if (tx.status === 'partial_return' || String(tx.orderStatus || '').indexOf('部分退貨') >= 0) return '部分退貨';
  return '已完成';
}
function posLineRemainQty(it) {
  return Math.max(0, (Number(it.qty) || 0) - (Number(it.returnedQty) || 0));
}
async function posSubmitReturn(txId) {
  if (!posCloud.canManage) {
    alert2('只有管理員／主管可退貨。');
    return;
  }
  var items = [];
  var inputs = document.querySelectorAll('[data-pos-return-qty]');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var qty = parseInt(el.value, 10);
    if (!qty || qty <= 0) continue;
    items.push({ productId: el.getAttribute('data-pos-return-qty'), qty: qty });
  }
  if (!items.length) {
    alert2('請至少輸入一項退貨數量。');
    return;
  }
  var methodEl = document.getElementById('pos-return-method');
  var reasonEl = document.getElementById('pos-return-reason');
  var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
  if (!reason) {
    alert2('請填寫退貨原因。');
    return;
  }
  if (!confirm('確定辦理退貨？將回補調動庫存並記錄退款方式（不作真實扣款）。')) return;
  try {
    var res = await apiFetch('/api/pos/transactions/' + encodeURIComponent(txId) + '/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items,
        refundMethod: methodEl ? methodEl.value : 'cash',
        reason: reason
      })
    });
    var tx = res && res.transaction;
    if (tx && tx.id) posReceiptFocusId = tx.id;
    posReturnMode = false;
    posInvalidateCloud();
    await posRefreshCloud(true);
    posInvalidateMembers();
    await posRefreshMembers(true);
    alert2('退貨完成。已回補調動庫存。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('退貨失敗：' + (e.message || e));
    posInvalidateCloud();
    await posRefreshCloud(true);
    if (typeof render === 'function') render();
  }
}
async function posSubmitExchange(txId) {
  if (!posCloud.canManage) {
    alert2('只有管理員／主管可換貨。');
    return;
  }
  var returnItems = [];
  var retInputs = document.querySelectorAll('[data-pos-ex-return-qty]');
  for (var i = 0; i < retInputs.length; i++) {
    var el = retInputs[i];
    var qty = parseInt(el.value, 10);
    if (!qty || qty <= 0) continue;
    returnItems.push({ productId: el.getAttribute('data-pos-ex-return-qty'), qty: qty });
  }
  var exchangeItems = [];
  var exInputs = document.querySelectorAll('[data-pos-ex-item-qty]');
  for (var j = 0; j < exInputs.length; j++) {
    var exEl = exInputs[j];
    var exQty = parseInt(exEl.value, 10);
    if (!exQty || exQty <= 0) continue;
    exchangeItems.push({ productId: exEl.getAttribute('data-pos-ex-item-qty'), qty: exQty });
  }
  if (!returnItems.length) {
    alert2('請至少輸入一項退回數量。');
    return;
  }
  if (!exchangeItems.length) {
    alert2('請至少選擇一項換入商品並輸入數量。');
    return;
  }
  var methodEl = document.getElementById('pos-ex-settle-method');
  var reasonEl = document.getElementById('pos-ex-reason');
  var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
  if (!reason) {
    alert2('請填寫換貨原因。');
    return;
  }
  if (!confirm('確定辦理換貨？將回補退回品、扣減換入品庫存，並記錄差額收／退款方式。')) return;
  try {
    var res = await apiFetch('/api/pos/transactions/' + encodeURIComponent(txId) + '/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: reason,
        settleMethod: methodEl ? methodEl.value : 'cash',
        returnItems: returnItems,
        exchangeItems: exchangeItems
      })
    });
    var tx = res && res.transaction;
    if (tx && tx.id) posReceiptFocusId = tx.id;
    posExchangeMode = false;
    posInvalidateCloud();
    await posRefreshCloud(true);
    posInvalidateMembers();
    await posRefreshMembers(true);
    alert2('換貨完成。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('換貨失敗：' + (e.message || e));
    posInvalidateCloud();
    await posRefreshCloud(true);
    if (typeof render === 'function') render();
  }
}
async function posResetDemoData() {
  if (!posCloud.canReset && !(typeof isAdmin === 'function' && isAdmin())) {
    alert2('只有系統管理員可重置雲端 POS。');
    return;
  }
  if (!confirm('確定重置雲端 POS？\n將清空所有雲端交易，並還原種子商品庫存。\n此操作影響所有裝置。')) return;
  try {
    await apiFetch('/api/pos/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    posCart = [];
    posReceiptFocusId = '';
    posDiscardLocalDemo();
    posInvalidateCloud();
    await posRefreshCloud(true);
    alert2('已重置雲端 POS（可售目錄＋交易）。調動庫存未改動。');
    if (typeof go === 'function') go('posCashier');
    else if (typeof render === 'function') render();
  } catch (e) {
    alert2('重置失敗：' + (e.message || e));
  }
}
function posOpenAdjust(productId) {
  posAdjustProductId = String(productId || '');
  posShowAddPanel = false;
  if (typeof render === 'function') render();
}
function posCloseAdjust() {
  posAdjustProductId = '';
  if (typeof render === 'function') render();
}
async function posSubmitAdjust(productId) {
  var priceEl = document.getElementById('pos-adj-price');
  var skuEl = document.getElementById('pos-adj-sku');
  var activeEl = document.getElementById('pos-adj-active');
  try {
    await apiFetch('/api/pos/products/' + encodeURIComponent(productId) + '/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price: priceEl ? priceEl.value : undefined,
        sku: skuEl ? skuEl.value : undefined,
        active: activeEl ? !!activeEl.checked : true
      })
    });
    posAdjustProductId = '';
    posInvalidateCloud();
    await posRefreshCloud(true);
    alert2('已更新可售商品（售價／條碼）。庫存請在貨品調動修改。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('調整失敗：' + (e.message || e));
  }
}
async function posToggleAddPanel() {
  posShowAddPanel = !posShowAddPanel;
  posAdjustProductId = '';
  if (posShowAddPanel) {
    try {
      var res = await apiFetch('/api/pos/catalog-options');
      posCatalogOptions = (res && res.options) || [];
      posAddForm = { key: '', price: '', sku: '' };
    } catch (e) {
      alert2('載入調動貨品失敗：' + (e.message || e));
      posShowAddPanel = false;
    }
  }
  if (typeof render === 'function') render();
}
function posSetAddKey(v) {
  posAddForm.key = String(v || '');
  var opt = posCatalogOptions.find(function (o) { return (o.transferProductId + '|' + o.size) === posAddForm.key; });
  if (opt) posAddForm.sku = opt.suggestedSku || '';
  if (typeof render === 'function') render();
}
async function posSubmitAddSellable() {
  var parts = String(posAddForm.key || '').split('|');
  if (parts.length < 2) { alert2('請選擇調動貨品與尺碼。'); return; }
  var priceEl = document.getElementById('pos-add-price');
  var skuEl = document.getElementById('pos-add-sku');
  try {
    await apiFetch('/api/pos/sellables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transferProductId: parts[0],
        size: parts.slice(1).join('|'),
        price: priceEl ? priceEl.value : posAddForm.price,
        sku: skuEl ? skuEl.value : posAddForm.sku
      })
    });
    posShowAddPanel = false;
    posInvalidateCloud();
    await posRefreshCloud(true);
    alert2('已加入可售目錄。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('加入失敗：' + (e.message || e));
  }
}
async function posSubmitBatchAddSellables() {
  if (!posCloud.canManage) {
    alert2('只有管理員／主管可批次加入可售。');
    return;
  }
  var checks = document.querySelectorAll('[data-pos-batch-add-key]:checked');
  var items = [];
  for (var i = 0; i < checks.length; i++) {
    var key = String(checks[i].getAttribute('data-pos-batch-add-key') || '');
    var parts = key.split('|');
    if (parts.length < 2) continue;
    items.push({ transferProductId: parts[0], size: parts.slice(1).join('|') });
  }
  if (!items.length) {
    alert2('請勾選至少一項調動貨品×尺碼。');
    return;
  }
  var priceEl = document.getElementById('pos-batch-add-price');
  var defaultPrice = priceEl ? priceEl.value : '';
  if (defaultPrice === '' || defaultPrice == null) {
    alert2('請填寫共用預設售價。');
    return;
  }
  try {
    var res = await apiFetch('/api/pos/sellables/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, defaultPrice: defaultPrice })
    });
    var msg = '已加入 ' + ((res && res.addedCount) || 0) + ' 項';
    if (res && res.errorCount) msg += '；失敗 ' + res.errorCount + ' 項';
    posInvalidateCloud();
    await posRefreshCloud(true);
    try {
      var opts = await apiFetch('/api/pos/catalog-options');
      posCatalogOptions = (opts && opts.options) || [];
    } catch (e2) {}
    alert2(msg + '。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('批次加入失敗：' + (e.message || e));
  }
}
function posCollectBatchProductIds() {
  var ids = [];
  var checks = document.querySelectorAll('[data-pos-batch-id]:checked');
  for (var i = 0; i < checks.length; i++) {
    var id = checks[i].getAttribute('data-pos-batch-id');
    if (id) ids.push(id);
  }
  return ids;
}
async function posBatchAdjustPrice() {
  if (!posCloud.canManage) {
    alert2('只有管理員／主管可批次改價。');
    return;
  }
  var ids = posCollectBatchProductIds();
  if (!ids.length) { alert2('請勾選商品。'); return; }
  var priceEl = document.getElementById('pos-batch-price');
  var price = priceEl ? priceEl.value : '';
  if (price === '' || price == null) { alert2('請填寫批次售價。'); return; }
  try {
    var res = await apiFetch('/api/pos/products/batch-adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids, price: price })
    });
    posInvalidateCloud();
    await posRefreshCloud(true);
    alert2('已改價 ' + ((res && res.updatedCount) || 0) + ' 項' +
      (res && res.errorCount ? '；失敗 ' + res.errorCount : '') + '。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('批次改價失敗：' + (e.message || e));
  }
}
async function posBatchSetActive(active) {
  if (!posCloud.canManage) {
    alert2('只有管理員／主管可批次上下架。');
    return;
  }
  var ids = posCollectBatchProductIds();
  if (!ids.length) { alert2('請勾選商品。'); return; }
  var label = active ? '上架' : '下架';
  if (!confirm('確定批次' + label + ' ' + ids.length + ' 項？')) return;
  try {
    var res = await apiFetch('/api/pos/products/batch-adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids, active: !!active })
    });
    posInvalidateCloud();
    await posRefreshCloud(true);
    alert2('已' + label + ' ' + ((res && res.updatedCount) || 0) + ' 項' +
      (res && res.errorCount ? '；失敗 ' + res.errorCount : '') + '。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('批次' + label + '失敗：' + (e.message || e));
  }
}
function posLoadingCard(title) {
  if (posCloud.error) {
    return '<div class="card"><h2>' + posEsc(title) + '</h2>' +
      '<p style="color:#c62828">' + posEsc(posCloud.error) + '</p>' +
      '<button type="button" class="btn sm" data-call="posForceReload">重新載入</button></div>';
  }
  return '<div class="card"><h2>' + posEsc(title) + '</h2><p style="color:#888">載入雲端 POS 資料中…</p></div>';
}
function posForceReload() {
  posInvalidateCloud();
  posRefreshCloud(true).then(function () { if (typeof render === 'function') render(); });
}

/** React POS UI（嵌入 /pos-ui/，與參考 App 同款三欄收銀） */
function posUiHashForView(view) {
  if (view === 'posCashier') return '#/pos';
  if (view === 'posTransactions') return '#/transactions';
  if (view === 'posMembers') return '#/members';
  if (view === 'posSettlement') return '#/settlement';
  if (view === 'posReport') return '#/reports';
  if (view === 'posProducts') return '#/products';
  if (view === 'posSettings') return '#/settings';
  if (view === 'posReceipt') {
    var rid = encodeURIComponent(String(posReceiptFocusId || ''));
    return rid ? '#/receipt/' + rid : '#/transactions';
  }
  return '#/pos';
}
function vPosReactEmbed(view) {
  var hash = posUiHashForView(view || (typeof currentView !== 'undefined' ? currentView : 'posCashier'));
  var src = '/pos-ui/index.html' + hash;
  return '<div class="pos-ui-embed" style="margin:-4px -4px 0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);height:calc(100vh - 72px);min-height:560px">' +
    '<iframe id="pos-ui-iframe" title="POS" src="' + src + '" style="width:100%;height:100%;border:0;display:block;background:#fff"></iframe></div>';
}
function vPosCashier() {
  return vPosReactEmbed('posCashier');
}
function vPosTransactions() {
  return vPosReactEmbed('posTransactions');
}
function posReceiptHtml(tx) {
  if (!tx) return '<div class="card"><h2>收據</h2><p style="color:#888">找不到此收據。</p></div>';
  var canReturn = !!posCloud.canManage && posTxStatusLabel(tx) !== '全部退貨';
  var canExchange = !!posCloud.canManage && posTxStatusLabel(tx) !== '全部退貨';
  var items = (tx.items || []).map(function (it) {
    var returned = Number(it.returnedQty) || 0;
    var remain = posLineRemainQty(it);
    var note = returned > 0
      ? '<div style="font-size:12px;color:#c62828">已退 ' + returned + '／原 ' + it.qty + (remain > 0 ? '（尚可退 ' + remain + '）' : '') + '</div>'
      : '';
    return '<tr>' +
      '<td style="text-align:center">' + posEsc(String(it.qty)) + '</td>' +
      '<td>' + posEsc(it.name) + ' (' + posEsc(it.sku) + ')<div style="font-size:12px;color:#666">- 尺寸: ' + posEsc(it.size) + '</div>' + note + '</td>' +
      '<td style="text-align:right">' + posMoney(it.lineTotal) + '</td></tr>';
  }).join('');
  function metaRow(label, value) {
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:13px">' +
      '<span style="color:#555">' + posEsc(label) + '</span>' +
      '<span style="text-align:right;font-weight:600">' + posEsc(value) + '</span></div>';
  }
  function sumRow(label, value, strong) {
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:' + (strong ? '15px' : '13px') + ';' + (strong ? 'font-weight:bold' : '') + '">' +
      '<span>' + posEsc(label) + '</span><span>$' + posMoney(value) + '</span></div>';
  }
  var returnsHtml = '';
  if (tx.returns && tx.returns.length) {
    returnsHtml = '<div style="margin-top:14px;border-top:1px dashed #bbb;padding-top:10px">' +
      '<div style="font-size:13px;font-weight:bold;margin-bottom:6px">退貨紀錄</div>' +
      tx.returns.map(function (r) {
        var lines = (r.items || []).map(function (li) {
          return posEsc(li.name) + ' ×' + li.qty + '（$' + posMoney(li.lineRefund) + '）';
        }).join('；');
        return '<div style="font-size:12px;line-height:1.55;margin-bottom:8px;padding:8px;background:#fafafa;border:1px solid #eee">' +
          '<div>' + posEsc(r.at || '') + '｜' + posEsc(r.byName || '') + '</div>' +
          '<div>退款 $' + posMoney(r.refundAmount) + '（' + posEsc(r.refundMethodName || '') + '）</div>' +
          '<div>原因：' + posEsc(r.reason || '') + '</div>' +
          '<div>' + lines + '</div>' +
          (r.pointsDeducted
            ? '<div style="color:#c62828">扣積分 −' + r.pointsDeducted + (r.pointsClamped ? '（扣至零）' : '') +
              (r.pointsBalanceAfter != null ? '｜餘額 ' + r.pointsBalanceAfter : '') + '</div>'
            : '') +
          '</div>';
      }).join('') + '</div>';
  }
  var exchangesHtml = '';
  if (tx.exchanges && tx.exchanges.length) {
    exchangesHtml = '<div style="margin-top:14px;border-top:1px dashed #bbb;padding-top:10px">' +
      '<div style="font-size:13px;font-weight:bold;margin-bottom:6px">換貨紀錄</div>' +
      tx.exchanges.map(function (ex) {
        var retLines = (ex.returnItems || []).map(function (li) {
          return posEsc(li.name) + ' ×' + li.qty + '（$' + posMoney(li.lineRefund) + '）';
        }).join('；');
        var inLines = (ex.exchangeItems || []).map(function (li) {
          return posEsc(li.name) + ' ×' + li.qty + '（$' + posMoney(li.lineTotal) + '）';
        }).join('；');
        var diff = Number(ex.diff) || 0;
        var diffLabel = diff > 0 ? ('客人補 $' + posMoney(diff)) : (diff < 0 ? ('退回 $' + posMoney(Math.abs(diff))) : '無差額');
        return '<div style="font-size:12px;line-height:1.55;margin-bottom:8px;padding:8px;background:#fafafa;border:1px solid #eee">' +
          '<div>' + posEsc(ex.at || '') + '｜' + posEsc(ex.byName || '') + '</div>' +
          '<div>退回 $' + posMoney(ex.returnAmount) + '｜換入 $' + posMoney(ex.exchangeAmount) +
          '｜' + diffLabel + '（' + posEsc(ex.settleMethodName || '') + '）</div>' +
          '<div>原因：' + posEsc(ex.reason || '') + '</div>' +
          '<div>退回：' + retLines + '</div>' +
          '<div>換入：' + inLines + '</div>' +
          (ex.pointsReturned
            ? '<div style="color:#c62828">扣積分 −' + ex.pointsReturned + (ex.pointsClamped ? '（扣至零）' : '') + '</div>'
            : '') +
          (ex.pointsEarned
            ? '<div style="color:#2e7d32">換入累積 +' + ex.pointsEarned +
              (ex.pointsBalanceAfter != null ? '｜餘額 ' + ex.pointsBalanceAfter : '') + '</div>'
            : '') +
          '</div>';
      }).join('') + '</div>';
  }
  var returnPanel = '';
  if (canReturn && posReturnMode) {
    var returnRows = (tx.items || []).map(function (it) {
      var remain = posLineRemainQty(it);
      if (remain <= 0) {
        return '<tr><td>' + posEsc(it.name) + '</td><td colspan="2" style="color:#888">已全部退回</td></tr>';
      }
      return '<tr>' +
        '<td>' + posEsc(it.name) + '<div style="font-size:11px;color:#666">' + posEsc(it.size) + '｜$' + posMoney(it.unitPrice) + '</div></td>' +
        '<td style="white-space:nowrap">可退 ' + remain + '</td>' +
        '<td><input type="number" min="0" max="' + remain + '" step="1" value="0" ' +
        'data-pos-return-qty="' + posEsc(it.productId) + '" style="width:72px"></td></tr>';
    }).join('');
    var payOpts = POS_PAYMENTS.map(function (p) {
      return '<option value="' + posEsc(p.id) + '"' + (p.id === (tx.paymentMethod || 'cash') ? ' selected' : '') + '>' + posEsc(p.name) + '</option>';
    }).join('');
    returnPanel = '<div class="card" style="max-width:520px;margin:14px auto 0;border:1px solid #ef9a9a">' +
      '<h3 style="margin-top:0">辦理退貨</h3>' +
      '<p style="font-size:12px;color:#666;margin:0 0 10px">按原單價計算退款金額；庫存回補至 <b>' + posEsc(tx.store) + '</b> 店調動庫存，並寫入「POS 退貨」記錄。</p>' +
      '<div class="table-wrap"><table><thead><tr><th>品項</th><th>剩餘</th><th>退貨數</th></tr></thead><tbody>' +
      returnRows + '</tbody></table></div>' +
      '<label>退款方式</label><select id="pos-return-method">' + payOpts + '</select>' +
      '<label>退貨原因＊</label><input type="text" id="pos-return-reason" placeholder="例如：客人不滿／瑕疵">' +
      '<div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn red sm" data-call="posSubmitReturn" data-arg0="' + posEsc(tx.id) + '">確認退貨</button>' +
      '<button type="button" class="btn gray sm" data-call="posCancelReturnMode">取消</button></div></div>';
  }
  var exchangePanel = '';
  if (canExchange && posExchangeMode) {
    var exReturnRows = (tx.items || []).map(function (it) {
      var remain = posLineRemainQty(it);
      if (remain <= 0) {
        return '<tr><td>' + posEsc(it.name) + '</td><td colspan="2" style="color:#888">已全部退回</td></tr>';
      }
      return '<tr>' +
        '<td>' + posEsc(it.name) + '<div style="font-size:11px;color:#666">' + posEsc(it.size) + '｜$' + posMoney(it.unitPrice) + '</div></td>' +
        '<td style="white-space:nowrap">可退 ' + remain + '</td>' +
        '<td><input type="number" min="0" max="' + remain + '" step="1" value="0" ' +
        'data-pos-ex-return-qty="' + posEsc(it.productId) + '" style="width:72px"></td></tr>';
    }).join('');
    var store = tx.store || posEnsureStore();
    var exPickRows = (posCloud.products || []).filter(function (p) {
      return p.active !== false;
    }).map(function (p) {
      var avail = Number((p.stock && p.stock[store]) || 0);
      return '<tr>' +
        '<td>' + posEsc(p.name) + '<div style="font-size:11px;color:#666">' + posEsc(p.sku) + '｜' + posEsc(p.size) +
        '｜$' + posMoney(p.price) + '｜庫存 ' + avail + '</div></td>' +
        '<td><input type="number" min="0" max="' + Math.max(0, avail) + '" step="1" value="0" ' +
        'data-pos-ex-item-qty="' + posEsc(p.id) + '" style="width:72px"' + (avail <= 0 ? ' disabled' : '') + '></td></tr>';
    }).join('');
    var settleOpts = POS_PAYMENTS.map(function (p) {
      return '<option value="' + posEsc(p.id) + '"' + (p.id === (tx.paymentMethod || 'cash') ? ' selected' : '') + '>' + posEsc(p.name) + '</option>';
    }).join('');
    exchangePanel = '<div class="card" style="max-width:560px;margin:14px auto 0;border:1px solid #81d4fa">' +
      '<h3 style="margin-top:0">辦理換貨</h3>' +
      '<p style="font-size:12px;color:#666;margin:0 0 10px">退回原單品項並換入可售商品；差額以收／退款方式記錄（不作真實扣款）。庫存異動寫入「POS 換貨」記錄。</p>' +
      '<div style="font-size:13px;font-weight:bold;margin:8px 0 4px">退回品項</div>' +
      '<div class="table-wrap"><table><thead><tr><th>品項</th><th>剩餘</th><th>退回數</th></tr></thead><tbody>' +
      exReturnRows + '</tbody></table></div>' +
      '<div style="font-size:13px;font-weight:bold;margin:12px 0 4px">換入商品</div>' +
      '<div class="table-wrap" style="max-height:220px;overflow:auto"><table><thead><tr><th>可售商品</th><th>數量</th></tr></thead><tbody>' +
      (exPickRows || '<tr><td colspan="2" style="color:#888;text-align:center">無可售商品</td></tr>') +
      '</tbody></table></div>' +
      '<label>收／退款方式</label><select id="pos-ex-settle-method">' + settleOpts + '</select>' +
      '<label>換貨原因＊</label><input type="text" id="pos-ex-reason" placeholder="例如：換尺寸／換款">' +
      '<div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn green sm" data-call="posSubmitExchange" data-arg0="' + posEsc(tx.id) + '">確認換貨</button>' +
      '<button type="button" class="btn gray sm" data-call="posCancelExchangeMode">取消</button></div></div>';
  }
  var returnBtn = canReturn && !posReturnMode && !posExchangeMode
    ? '<button type="button" class="btn orange sm" data-call="posToggleReturnMode">辦理退貨</button>'
    : '';
  var exchangeBtn = canExchange && !posReturnMode && !posExchangeMode
    ? '<button type="button" class="btn sm" data-call="posToggleExchangeMode">辦理換貨</button>'
    : '';
  return '<div class="card" style="max-width:520px;margin:0 auto">' +
    '<div style="text-align:center;margin-bottom:12px">' +
    '<div style="font-size:18px;font-weight:bold;letter-spacing:.04em">Water Sports S.H.</div>' +
    '<div style="font-size:14px;font-weight:bold;margin-top:2px">SHAREmall</div>' +
    '<div style="font-size:12px;color:#666;margin-top:6px">灣仔｜荔枝角｜屯門｜觀塘</div>' +
    '<div style="font-size:12px;color:#666">生活用品專賣店</div>' +
    '<div style="font-size:11px;color:#888;margin-top:6px;line-height:1.5">WhatsApp: 61231104<br>watersports0227@gmail.com<br>https://www.sharemall.hk</div></div>' +
    '<div style="border-top:1px dashed #bbb;border-bottom:1px dashed #bbb;padding:10px 0;margin-bottom:10px">' +
    metaRow('訂單日期', tx.createdAt || '') +
    metaRow('訂單編號', tx.orderNo + (tx.orderNoAlt ? ' (' + tx.orderNoAlt + ')' : '')) +
    metaRow('支付方式', tx.paymentMethodName || '') +
    metaRow('付款狀態', tx.paymentStatus || '已付款') +
    metaRow('訂單狀態', tx.orderStatus || '') +
    metaRow('讀取單號', tx.invoiceNo || '') +
    metaRow('員工', tx.staffName || '—') +
    metaRow('備註', tx.remark || (tx.memberName || '—')) +
    (tx.memberName ? metaRow('會員', tx.memberName + (tx.memberPhone ? '｜' + tx.memberPhone : '')) : '') +
    (tx.pointsRedeemed ? metaRow('積分折抵', '−' + tx.pointsRedeemed + ' 分＝$' + posMoney(tx.pointsDiscount || 0)) : '') +
    (tx.pointsEarned ? metaRow('本單積分', '+' + tx.pointsEarned + (tx.pointsBalanceAfter != null ? '（餘額 ' + tx.pointsBalanceAfter + '）' : '')) : '') +
    '</div>' +
    '<div style="font-size:11px;color:#777;line-height:1.55;margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #bbb">' +
    '• 此單為雲端電子收據（對齊門市熱感單格式）<br>• 顯示價格為折後價<br>• 一般貨品 7 日換貨；特價品不設換貨<br>• 門市政策以店規為準；系統退貨／換貨由主管操作</div>' +
    '<table style="width:100%;font-size:13px;margin-bottom:10px"><thead><tr>' +
    '<th style="width:48px;text-align:center">Qty</th><th>商品名稱</th><th style="text-align:right;width:80px">總計(HKD)</th>' +
    '</tr></thead><tbody>' + items + '</tbody></table>' +
    '<div style="border-top:1px dashed #bbb;padding-top:8px">' +
    sumRow('商品小計', tx.subtotal) +
    sumRow('已取貨', tx.collected || 0) +
    sumRow('賬戶餘額', tx.accountBalance || 0) +
    (tx.pointsDiscount ? sumRow('積分折抵', -(Number(tx.pointsDiscount) || 0)) : '') +
    sumRow('訂單總計', tx.orderTotal, true) +
    sumRow('已付金額', tx.paid, true) +
    '</div>' +
    returnsHtml +
    exchangesHtml +
    '<div class="actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' +
    '<button type="button" class="btn gray sm" data-call="go" data-arg0="posTransactions">← 交易記錄</button>' +
    returnBtn +
    exchangeBtn +
    '<button type="button" class="btn green sm" data-call="go" data-arg0="posCashier">繼續收銀</button></div></div>' +
    returnPanel +
    exchangePanel;
}
function vPosReceipt() {
  return vPosReactEmbed('posReceipt');
}
function vPosMembers() {
  return vPosReactEmbed('posMembers');
}
function vPosProducts() {
  return vPosReactEmbed('posProducts');
}
function vPosReset() {
  posKickLoad();
  var can = posCloud.canReset || (typeof isAdmin === 'function' && isAdmin());
  if (!can) {
    return '<div class="card"><h2>♻️ 重置雲端 POS</h2>' +
      '<p style="color:#c62828">只有系統管理員可重置雲端 POS 資料。</p>' +
      '<button type="button" class="btn gray sm" data-call="go" data-arg0="posCashier">返回收銀</button></div>';
  }
  return '<div class="card"><h2>♻️ 重置雲端 POS 資料</h2>' +
    '<p style="font-size:14px;line-height:1.6;color:#455a64">會清空<strong>可售目錄與交易</strong>（所有裝置）。' +
    '<br><b>不會</b>改動貨品調動的庫存數量。</p>' +
    '<div class="actions" style="margin-top:14px">' +
    '<button type="button" class="btn red" data-call="posResetDemoData">確認重置雲端 POS</button>' +
    '<button type="button" class="btn gray sm" data-call="go" data-arg0="posCashier">返回收銀</button></div></div>';
}

function posKickReportLoad() {
  if (!posReport.from) posReport.from = posHkToday();
  if (!posReport.to) posReport.to = posReport.from;
  if (!posReport.loaded && !posReport.loading) posRefreshReport(false);
}
async function posRefreshReport(force) {
  if (!apiEnabled || !authToken) {
    posReport.error = '需要連接雲端並登入。';
    posReport.loaded = true;
    return;
  }
  if (posReport.loading) return;
  if (posReport.loaded && !force) return;
  posReport.loading = true;
  posReport.error = '';
  try {
    var q = [];
    if (posReport.store) q.push('store=' + encodeURIComponent(posReport.store));
    if (posReport.from) q.push('from=' + encodeURIComponent(posReport.from));
    if (posReport.to) q.push('to=' + encodeURIComponent(posReport.to));
    var res = await apiFetch('/api/pos/report' + (q.length ? '?' + q.join('&') : ''));
    posReport.summary = res.summary || null;
    posReport.stores = res.stores || [];
    posReport.canExport = !!res.canExport;
    posReport.canManage = !!res.canManage;
    if (!posReport.store && posReport.stores.length === 1) posReport.store = posReport.stores[0];
    posReport.loaded = true;
  } catch (e) {
    posReport.error = String(e.message || e);
    posReport.loaded = true;
  }
  posReport.loading = false;
  if (typeof render === 'function') render();
}
function posSetReportStore(v) {
  posReport.store = String(v || '');
  posReport.loaded = false;
  posRefreshReport(true);
}
function posSetReportFrom(v) {
  posReport.from = String(v || '');
  posReport.loaded = false;
  posRefreshReport(true);
}
function posSetReportTo(v) {
  posReport.to = String(v || '');
  posReport.loaded = false;
  posRefreshReport(true);
}
async function posExportReportCsv() {
  if (!posReport.canExport) { alert2('只有管理員／主管可匯出 CSV。'); return; }
  try {
    var q = [];
    if (posReport.store) q.push('store=' + encodeURIComponent(posReport.store));
    if (posReport.from) q.push('from=' + encodeURIComponent(posReport.from));
    if (posReport.to) q.push('to=' + encodeURIComponent(posReport.to));
    var r = await apiFetch('/api/pos/report.csv' + (q.length ? '?' + q.join('&') : ''));
    var text = typeof r.text === 'function' ? await r.text() : String(r);
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pos-report-' + (posReport.from || '') + '_' + (posReport.to || '') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  } catch (e) {
    alert2('匯出失敗：' + (e.message || e));
  }
}
function vPosReport() {
  return vPosReactEmbed('posReport');
}

function posKickSettlementLoad() {
  if (!posSettlement.date) posSettlement.date = posHkToday();
  if (!posSettlement.loaded && !posSettlement.loading) posRefreshSettlement(false);
}
async function posRefreshSettlement(force) {
  if (!apiEnabled || !authToken) {
    posSettlement.error = '需要連接雲端並登入。';
    posSettlement.loaded = true;
    return;
  }
  if (posSettlement.loading) return;
  if (posSettlement.loaded && !force) return;
  posSettlement.loading = true;
  posSettlement.error = '';
  try {
    var q = [];
    if (posSettlement.store) q.push('store=' + encodeURIComponent(posSettlement.store));
    if (posSettlement.date) q.push('date=' + encodeURIComponent(posSettlement.date));
    var res = await apiFetch('/api/pos/settlement' + (q.length ? '?' + q.join('&') : ''));
    posSettlement.data = res;
    if (res.store) posSettlement.store = res.store;
    if (res.date) posSettlement.date = res.date;
    posSettlement.loaded = true;
  } catch (e) {
    posSettlement.error = String(e.message || e);
    posSettlement.loaded = true;
  }
  posSettlement.loading = false;
  if (typeof render === 'function') render();
}
function posSetSettlementStore(v) {
  posSettlement.store = String(v || '');
  posSettlement.loaded = false;
  posRefreshSettlement(true);
}
function posSetSettlementDate(v) {
  posSettlement.date = String(v || '');
  posSettlement.loaded = false;
  posRefreshSettlement(true);
}
async function posSubmitSettlement() {
  var cashEl = document.getElementById('pos-set-cash');
  var remarkEl = document.getElementById('pos-set-remark');
  var fileEl = document.getElementById('pos-set-files');
  var cash = cashEl ? cashEl.value : '';
  if (cash === '' || cash == null) { alert2('請填寫現金實點金額。'); return; }
  if (!confirm('確定提交日結？提交後將鎖定，並把今日工作的「每日結算」標為已結算。')) return;
  try {
    var attachments = [];
    if (fileEl && fileEl.files && fileEl.files.length) {
      for (var i = 0; i < fileEl.files.length; i++) {
        var file = fileEl.files[i];
        var fd = new FormData();
        fd.append('file', file);
        var up = await apiFetch('/api/files', { method: 'POST', body: fd });
        if (up && up.id) {
          attachments.push({
            id: up.id,
            name: up.name || file.name || '',
            mimeType: up.mimeType || file.type || ''
          });
        }
      }
    }
    var res = await apiFetch('/api/pos/settlement/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: posSettlement.store,
        date: posSettlement.date,
        cashCounted: Number(cash),
        remark: remarkEl ? remarkEl.value : '',
        attachments: attachments
      })
    });
    posSettlement.data = res;
    posSettlement.loaded = true;
    await posReloadDailyAfterSettlement();
    alert2('日結已提交。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('提交失敗：' + (e.message || e));
  }
}
async function posUnlockSettlement() {
  if (!confirm('確定解除此日結鎖定？解除後可重交，今日工作的結算會重開為待結算。')) return;
  try {
    var res = await apiFetch('/api/pos/settlement/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: posSettlement.store, date: posSettlement.date })
    });
    posSettlement.data = res;
    posSettlement.loaded = true;
    await posReloadDailyAfterSettlement();
    alert2('已解除鎖定。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('解除失敗：' + (e.message || e));
  }
}
async function posApproveSettlement() {
  var noteEl = document.getElementById('pos-set-review-note');
  var note = noteEl ? String(noteEl.value || '').trim() : '';
  if (!confirm('確定核對通過此日結？')) return;
  try {
    var res = await apiFetch('/api/pos/settlement/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: posSettlement.store,
        date: posSettlement.date,
        note: note || undefined
      })
    });
    posSettlement.data = res;
    posSettlement.loaded = true;
    alert2('已核對通過。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('核對失敗：' + (e.message || e));
  }
}
async function posRejectSettlement() {
  var noteEl = document.getElementById('pos-set-reject-note');
  var note = noteEl ? String(noteEl.value || '').trim() : '';
  if (!note) {
    alert2('請填寫退回原因。');
    return;
  }
  if (!confirm('確定退回此日結？退回後將解除鎖定以便重交。')) return;
  try {
    var res = await apiFetch('/api/pos/settlement/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: posSettlement.store,
        date: posSettlement.date,
        note: note
      })
    });
    posSettlement.data = res;
    posSettlement.loaded = true;
    await posReloadDailyAfterSettlement();
    alert2('已退回日結。');
    if (typeof render === 'function') render();
  } catch (e) {
    alert2('退回失敗：' + (e.message || e));
  }
}
function posSettlementFileHref(att) {
  if (!att || !att.id) return '';
  var path = '/api/files/' + encodeURIComponent(att.id);
  if (typeof apiUrl === 'function' && typeof withFileToken === 'function') {
    return withFileToken(apiUrl(path));
  }
  return path;
}
function posReviewStatusLabel(status) {
  var m = {
    pending_review: '待核對',
    approved: '已通過',
    rejected: '已退回',
    unlocked: '已解除'
  };
  return m[status] || status || '—';
}
function vPosSettlement() {
  return vPosReactEmbed('posSettlement');
}

// Hide reset sidebar for non-admin by filtering in app.js would be better;
// here we still show page with denial. Optionally patch getSidebarItems after load.
(function posPatchSidebarResetVisibility() {
  if (typeof getSidebarItemsForModule !== 'function') return;
  var _orig = getSidebarItemsForModule;
  getSidebarItemsForModule = function (mod) {
    var items = _orig(mod);
    if (mod !== 'pos') return items;
    var can = (posCloud && posCloud.canReset) || (typeof isAdmin === 'function' && isAdmin());
    if (can) return items;
    return (items || []).filter(function (it) { return it[0] !== 'posReset'; });
  };
})();

if (typeof currentUser !== 'undefined' && currentUser && typeof render === 'function') {
  try { render(); } catch (e) {}
}
