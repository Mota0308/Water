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
var posMemberEditId = '';
var posAdjustProductId = '';
var posShowAddPanel = false;
var posCatalogOptions = [];
var posAddForm = { key: '', price: '', sku: '' };

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
  try {
    var res = await apiFetch('/api/pos/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: store,
        paymentMethod: posPaymentMethod,
        accountBalance: posAccountBalance,
        remark: posRemark,
        memberId: member ? member.id : '',
        memberName: member ? member.name : '',
        memberPhone: member ? member.phone : '',
        items: posCart.map(function (l) { return { productId: l.productId, qty: l.qty }; })
      })
    });
    var tx = res && res.transaction;
    posCart = [];
    posRemark = '';
    posAccountBalance = 0;
    posMemberId = '';
    posReceiptFocusId = tx ? tx.id : '';
    posInvalidateCloud();
    await posRefreshCloud(true);
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
  if (typeof go === 'function') go('posReceipt');
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

function vPosCashier() {
  posKickLoad();
  posKickMembersLoad();
  if (!posCloud.loaded || posCloud.loading) return posLoadingCard('🛒 POS 收銀');
  if (posCloud.error) return posLoadingCard('🛒 POS 收銀');
  var stores = posUserStoresLocal();
  var store = posEnsureStore();
  if (!stores.length) {
    return '<div class="card"><h2>🛒 POS 收銀</h2>' +
      '<p style="color:#c62828;font-size:14px">你的賬戶沒有港店所屬單位，無法使用 POS。</p></div>';
  }
  var kw = String(posSearchKw || '').trim().toLowerCase();
  var products = (posCloud.products || []).filter(function (p) {
    if (!kw) return true;
    return String(p.name).toLowerCase().indexOf(kw) >= 0 ||
      String(p.sku).toLowerCase().indexOf(kw) >= 0 ||
      String(p.size).toLowerCase().indexOf(kw) >= 0;
  });
  var storeOpts = stores.map(function (s) {
    return '<option value="' + posEsc(s) + '"' + (s === store ? ' selected' : '') + '>' + posEsc(s) + '店</option>';
  }).join('');
  var memberOpts = '<option value="">（不選擇會員）</option>' + (posMembersCloud.list || []).filter(function (m) {
    return m.active !== false;
  }).map(function (m) {
    return '<option value="' + posEsc(m.id || m.phone) + '"' + (posMemberId === (m.id || m.phone) ? ' selected' : '') + '>' +
      posEsc(m.name + '｜' + m.phone + '｜' + (m.level || '一般會員')) + '</option>';
  }).join('');
  var payOpts = POS_PAYMENTS.map(function (p) {
    return '<label style="display:inline-flex;align-items:center;gap:6px;margin:0 12px 8px 0;font-size:13px;cursor:pointer">' +
      '<input type="radio" name="pos-pay" value="' + p.id + '"' + (posPaymentMethod === p.id ? ' checked' : '') +
      ' onchange="posSetPayment(this.value)"> ' + posEsc(p.name) + '</label>';
  }).join('');
  var productRows = products.map(function (p) {
    var avail = Number((p.stock && p.stock[store]) || 0);
    var low = avail <= 2 ? ' style="color:#c62828;font-weight:bold"' : '';
    var adj = posCloud.canManage
      ? ' <button type="button" class="btn gray sm" data-call="posOpenAdjust" data-arg0="' + posEsc(p.id) + '">售價</button>'
      : '';
    return '<tr>' +
      '<td>' + posEsc(p.sku) + '<div style="font-size:11px;color:#90a4ae">' + posEsc(p.transferProductId || '') + '</div></td>' +
      '<td>' + posEsc(p.name) + '<div style="font-size:12px;color:#78909c">尺寸 ' + posEsc(p.size) + '</div></td>' +
      '<td>$' + posMoney(p.price) + '</td>' +
      '<td' + low + '>' + avail + '</td>' +
      '<td><button type="button" class="btn green sm" data-call="posAddToCart" data-arg0="' + posEsc(p.id) + '"' +
      (avail <= 0 ? ' disabled' : '') + '>加入</button>' + adj + '</td></tr>';
  }).join('');
  var cartRows = posCart.length ? posCart.map(function (line) {
    return '<tr>' +
      '<td>' + posEsc(line.name) + '<div style="font-size:12px;color:#78909c">' + posEsc(line.sku) + '｜' + posEsc(line.size) + '</div></td>' +
      '<td style="white-space:nowrap">' +
      '<button type="button" class="btn gray sm" data-call="posCartQty" data-arg0="' + posEsc(line.productId) + '" data-arg1="-1">−</button> ' +
      '<b>' + line.qty + '</b> ' +
      '<button type="button" class="btn gray sm" data-call="posCartQty" data-arg0="' + posEsc(line.productId) + '" data-arg1="1">＋</button></td>' +
      '<td>$' + posMoney(line.unitPrice * line.qty) + '</td>' +
      '<td><button type="button" class="btn red sm" data-call="posRemoveCartLine" data-arg0="' + posEsc(line.productId) + '">移除</button></td></tr>';
  }).join('') : '<tr><td colspan="4" style="color:#888;text-align:center">購物車是空的</td></tr>';
  var subtotal = posCartSubtotal();
  var balance = Number(posAccountBalance) || 0;
  var total = Math.round((subtotal + balance) * 100) / 100;
  var adjustPanel = '';
  if (posAdjustProductId && posCloud.canManage) {
    var ap = posFindProduct(posAdjustProductId);
    if (ap) {
      adjustPanel = '<div class="card" style="border:1px solid #90caf9">' +
        '<h3>調整可售｜' + posEsc(ap.name) + '（' + posEsc(ap.transferProductId) + ' / ' + posEsc(ap.size) + '）</h3>' +
        '<p style="font-size:12px;color:#78909c;margin:0 0 8px">不可改庫存數量；請到「貨品調動 → 庫存查詢」校正。</p>' +
        '<label>售價</label><input type="number" id="pos-adj-price" step="0.01" min="0" value="' + posEsc(String(ap.price)) + '">' +
        '<label>SKU／條碼</label><input type="text" id="pos-adj-sku" value="' + posEsc(ap.sku || '') + '">' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="pos-adj-active"' + (ap.active === false ? '' : ' checked') + '> 上架可售</label>' +
        '<div class="actions" style="margin-top:12px;display:flex;gap:8px">' +
        '<button type="button" class="btn green sm" data-call="posSubmitAdjust" data-arg0="' + posEsc(ap.id) + '">儲存</button>' +
        '<button type="button" class="btn gray sm" data-call="posCloseAdjust">取消</button></div></div>';
    }
  }
  var addPanel = '';
  if (posShowAddPanel && posCloud.canManage) {
    var optHtml = '<option value="">— 選擇貨品×尺碼 —</option>' + posCatalogOptions.map(function (o) {
      var k = o.transferProductId + '|' + o.size;
      return '<option value="' + posEsc(k) + '"' + (posAddForm.key === k ? ' selected' : '') + '>' +
        posEsc(o.transferProductId + '｜' + o.name + (o.color ? '｜' + o.color : '') + '｜' + o.size) + '</option>';
    }).join('');
    addPanel = '<div class="card" style="border:1px solid #a5d6a7">' +
      '<h3>從調動貨品加入可售</h3>' +
      (posCatalogOptions.length
        ? '<label>調動貨品 × 尺碼</label><select onchange="posSetAddKey(this.value)">' + optHtml + '</select>' +
          '<label>售價</label><input type="number" id="pos-add-price" step="0.01" min="0" value="' + posEsc(String(posAddForm.price || '')) + '">' +
          '<label>SKU／條碼</label><input type="text" id="pos-add-sku" value="' + posEsc(posAddForm.sku || '') + '">' +
          '<div class="actions" style="margin-top:12px;display:flex;gap:8px">' +
          '<button type="button" class="btn green sm" data-call="posSubmitAddSellable">加入可售目錄</button>' +
          '<button type="button" class="btn gray sm" data-call="posToggleAddPanel">取消</button></div>'
        : '<p style="color:#888">所有調動貨品尺碼都已加入，或尚無調動貨品。請先到「貨品調動 → 貨品」新增。</p>' +
          '<button type="button" class="btn gray sm" data-call="posToggleAddPanel">關閉</button>') +
      '</div>';
  }
  return '<div class="card"><h2>🛒 POS 收銀</h2>' +
    '<div class="info-banner">庫存以<strong>貨品調動</strong>為準。可售目錄需管理員／主管從調動貨品加入並設定售價。賣出會寫入調動「庫存校正記錄」（POS 銷售）。</div>' +
    '<div class="filters" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">' +
    '<div><label>收銀店舖</label><select onchange="posSetStore(this.value)">' + storeOpts + '</select></div>' +
    '<div style="flex:1;min-width:180px"><label>搜尋商品</label>' +
    '<input type="text" value="' + posEsc(posSearchKw) + '" placeholder="品名／SKU／尺寸" oninput="posSetSearch(this.value)"></div>' +
    (posCloud.canManage ? '<button type="button" class="btn green sm" data-call="posToggleAddPanel">' + (posShowAddPanel ? '關閉加入' : '＋ 從調動加入可售') + '</button>' : '') +
    '<button type="button" class="btn gray sm" data-call="posForceReload">重新整理</button></div></div>' +
    addPanel +
    adjustPanel +
    (!products.length && !kw
      ? '<div class="card"><p style="color:#888">尚未有可售商品。' + (posCloud.canManage ? '請點「從調動加入可售」。' : '請通知主管加入可售目錄。') + '</p></div>'
      : '') +
    '<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,0.9fr);gap:14px" class="pos-cashier-grid">' +
    '<div class="card"><h3>商品（調動庫存）</h3><div class="table-wrap"><table><thead><tr>' +
    '<th>SKU</th><th>商品</th><th>售價</th><th>庫存</th><th></th></tr></thead><tbody>' +
    (productRows || '<tr><td colspan="5" style="color:#888;text-align:center">無符合商品</td></tr>') +
    '</tbody></table></div></div>' +
    '<div class="card"><h3>購物車</h3><div class="table-wrap"><table><thead><tr>' +
    '<th>商品</th><th>數量</th><th>小計</th><th></th></tr></thead><tbody>' + cartRows +
    '</tbody></table></div>' +
    '<label>會員（雲端）</label><select onchange="posSetMember(this.value)">' + memberOpts + '</select>' +
    '<div style="font-size:12px;color:#78909c;margin:4px 0 8px">沒有名單？到側欄「會員管理」新增。</div>' +
    '<label>備註</label><input type="text" value="' + posEsc(posRemark) + '" placeholder="例如客人姓名" onchange="posSetRemark(this.value)" oninput="posRemark=this.value">' +
    '<label>賬戶餘額／抵扣（可負數）</label>' +
    '<input type="number" step="0.01" value="' + posEsc(String(balance)) + '" onchange="posSetAccountBalance(this.value)">' +
    '<div style="margin-top:10px"><div style="font-size:13px;color:#555;margin-bottom:6px">支付方式</div>' + payOpts + '</div>' +
    '<div style="margin-top:12px;border-top:1px dashed #cfd8dc;padding-top:10px;font-size:14px;line-height:1.7">' +
    '<div style="display:flex;justify-content:space-between"><span>商品小計</span><b>$' + posMoney(subtotal) + '</b></div>' +
    '<div style="display:flex;justify-content:space-between"><span>賬戶餘額</span><b>$' + posMoney(balance) + '</b></div>' +
    '<div style="display:flex;justify-content:space-between;font-size:16px"><span>訂單總計</span><b>$' + posMoney(total) + '</b></div></div>' +
    '<div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button type="button" class="btn gray sm" data-call="posClearCart">清空購物車</button>' +
    '<button type="button" class="btn green" data-call="posCheckout"' + (!posCart.length ? ' disabled' : '') + '>確認收款</button>' +
    '</div></div></div>' +
    '<style>@media (max-width:900px){.pos-cashier-grid{grid-template-columns:1fr !important}}</style>';
}
function vPosTransactions() {
  posKickLoad();
  if (!posCloud.loaded || posCloud.loading) return posLoadingCard('🧾 交易記錄');
  if (posCloud.error) return posLoadingCard('🧾 交易記錄');
  var kw = String(posTxKw || '').trim().toLowerCase();
  var list = (posCloud.transactions || []).filter(function (tx) {
    if (!kw) return true;
    var blob = [tx.orderNo, tx.receiptNo, tx.invoiceNo, tx.store, tx.staffName, tx.memberName, tx.remark, tx.paymentMethodName].join(' ').toLowerCase();
    return blob.indexOf(kw) >= 0;
  });
  var rows = list.map(function (tx) {
    return '<tr class="clickable" data-call="posOpenReceipt" data-arg0="' + posEsc(tx.id) + '">' +
      '<td>' + posEsc(tx.createdAt || '') + '</td>' +
      '<td>' + posEsc(tx.orderNo) + '</td>' +
      '<td>' + posEsc(tx.store) + '店</td>' +
      '<td>' + posEsc(tx.paymentMethodName || '') + '</td>' +
      '<td>$' + posMoney(tx.orderTotal) + '</td>' +
      '<td>' + posEsc(tx.staffName || '—') + '</td>' +
      '<td><button type="button" class="btn sm" data-call="posOpenReceipt" data-arg0="' + posEsc(tx.id) + '">收據</button></td></tr>';
  }).join('');
  return '<div class="card"><h2>🧾 交易記錄</h2>' +
    '<div class="filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
    '<div style="flex:1;min-width:200px"><label>搜尋</label>' +
    '<input type="text" value="' + posEsc(posTxKw) + '" placeholder="單號／店舖／員工／備註" oninput="posSetTxKw(this.value)"></div>' +
    '<button type="button" class="btn gray sm" data-call="posForceReload">重新整理</button>' +
    '<button type="button" class="btn green sm" data-call="go" data-arg0="posCashier">＋ 新收銀</button></div>' +
    '<div class="table-wrap" style="margin-top:12px"><table><thead><tr>' +
    '<th>時間</th><th>訂單編號</th><th>店舖</th><th>支付</th><th>總計</th><th>員工</th><th></th>' +
    '</tr></thead><tbody>' +
    (rows || '<tr><td colspan="7" style="color:#888;text-align:center">尚無交易</td></tr>') +
    '</tbody></table></div></div>';
}
function posReceiptHtml(tx) {
  if (!tx) return '<div class="card"><h2>收據</h2><p style="color:#888">找不到此收據。</p></div>';
  var items = (tx.items || []).map(function (it) {
    return '<tr>' +
      '<td style="text-align:center">' + posEsc(String(it.qty)) + '</td>' +
      '<td>' + posEsc(it.name) + ' (' + posEsc(it.sku) + ')<div style="font-size:12px;color:#666">- 尺寸: ' + posEsc(it.size) + '</div></td>' +
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
    '</div>' +
    '<div style="font-size:11px;color:#777;line-height:1.55;margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #bbb">' +
    '• 此單為雲端電子收據（對齊門市熱感單格式）<br>• 顯示價格為折後價<br>• 一般貨品 7 日換貨；特價品不設換貨<br>• 不設退款</div>' +
    '<table style="width:100%;font-size:13px;margin-bottom:10px"><thead><tr>' +
    '<th style="width:48px;text-align:center">Qty</th><th>商品名稱</th><th style="text-align:right;width:80px">總計(HKD)</th>' +
    '</tr></thead><tbody>' + items + '</tbody></table>' +
    '<div style="border-top:1px dashed #bbb;padding-top:8px">' +
    sumRow('商品小計', tx.subtotal) +
    sumRow('已取貨', tx.collected || 0) +
    sumRow('賬戶餘額', tx.accountBalance || 0) +
    sumRow('訂單總計', tx.orderTotal, true) +
    sumRow('已付金額', tx.paid, true) +
    '</div>' +
    '<div class="actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' +
    '<button type="button" class="btn gray sm" data-call="go" data-arg0="posTransactions">← 交易記錄</button>' +
    '<button type="button" class="btn green sm" data-call="go" data-arg0="posCashier">繼續收銀</button></div></div>';
}
function vPosReceipt() {
  posKickLoad();
  if (!posCloud.loaded || posCloud.loading) return posLoadingCard('收據');
  if (posCloud.error) return posLoadingCard('收據');
  var tx = (posCloud.transactions || []).find(function (t) { return t.id === posReceiptFocusId; });
  if (!tx && posCloud.transactions && posCloud.transactions[0]) tx = posCloud.transactions[0];
  return posReceiptHtml(tx);
}
function vPosMembers() {
  posKickMembersLoad();
  if (!posMembersCloud.loaded || posMembersCloud.loading) {
    return '<div class="card"><h2>👤 會員管理</h2><p style="color:#888">載入會員中…</p></div>';
  }
  if (posMembersCloud.error) {
    return '<div class="card"><h2>👤 會員管理</h2><p style="color:#c62828">' + posEsc(posMembersCloud.error) + '</p>' +
      '<button type="button" class="btn sm" data-call="posSetMembersKw" data-arg0="">重新載入</button></div>';
  }
  var canEdit = posMembersCloud.canEdit || (typeof isAdmin === 'function' && isAdmin()) || (typeof isManager === 'function' && isManager());
  var rows = (posMembersCloud.list || []).map(function (m) {
    var inactive = m.active === false;
    var actions = '';
    if (canEdit) {
      actions = '<button type="button" class="btn gray sm" data-call="posOpenMemberEdit" data-arg0="' + posEsc(m.id || m.phone) + '">編輯</button> ' +
        (inactive
          ? '<button type="button" class="btn green sm" data-call="posSetMemberActive" data-arg0="' + posEsc(m.id || m.phone) + '" data-arg1="true">啟用</button>'
          : '<button type="button" class="btn red sm" data-call="posSetMemberActive" data-arg0="' + posEsc(m.id || m.phone) + '" data-arg1="false">停用</button>');
    }
    return '<tr' + (inactive ? ' style="opacity:.6"' : '') + '>' +
      '<td>' + posEsc(m.name) + '</td>' +
      '<td>' + posEsc(m.phone) + '</td>' +
      '<td>' + posEsc(m.level || '一般會員') + '</td>' +
      '<td>' + posEsc(m.remark || '—') + '</td>' +
      '<td>' + (inactive ? '停用' : '正常') + '</td>' +
      '<td>' + actions + '</td></tr>';
  }).join('');
  var editPanel = '';
  if (posMemberEditId && canEdit) {
    var em = posFindMember(posMemberEditId);
    if (em) {
      editPanel = '<div class="card" style="border:1px solid #90caf9">' +
        '<h3>編輯會員</h3>' +
        '<label>姓名</label><input type="text" id="pos-mem-edit-name" value="' + posEsc(em.name || '') + '">' +
        '<label>電話</label><input type="text" id="pos-mem-edit-phone" value="' + posEsc(em.phone || '') + '">' +
        '<label>等級</label><select id="pos-mem-edit-level">' +
        '<option value="一般會員"' + ((em.level || '') !== 'VIP 會員' ? ' selected' : '') + '>一般會員</option>' +
        '<option value="VIP 會員"' + (em.level === 'VIP 會員' ? ' selected' : '') + '>VIP 會員</option></select>' +
        '<label>備註</label><input type="text" id="pos-mem-edit-remark" value="' + posEsc(em.remark || '') + '">' +
        '<div class="actions" style="margin-top:12px;display:flex;gap:8px">' +
        '<button type="button" class="btn green sm" data-call="posSaveMemberEdit" data-arg0="' + posEsc(em.id || em.phone) + '">儲存</button>' +
        '<button type="button" class="btn gray sm" data-call="posCloseMemberEdit">取消</button></div></div>';
    }
  }
  return '<div class="card"><h2>👤 會員管理</h2>' +
    '<div class="info-banner">雲端會員主檔（暫無積分）。全員可新增；編輯／停用僅管理員／主管。</div>' +
    '<div class="filters" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">' +
    '<div style="flex:1;min-width:180px"><label>搜尋</label>' +
    '<input type="text" value="' + posEsc(posMembersCloud.kw) + '" placeholder="姓名／電話／備註" onchange="posSetMembersKw(this.value)"></div>' +
    '<button type="button" class="btn gray sm" data-call="posToggleMembersInactive">' +
    (posMembersCloud.includeInactive ? '隱藏停用' : '顯示停用') + '</button></div></div>' +
    '<div class="card"><h3>新增會員</h3>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">' +
    '<div><label>姓名＊</label><input type="text" id="pos-mem-name" placeholder="客人姓名"></div>' +
    '<div><label>電話＊</label><input type="text" id="pos-mem-phone" placeholder="8 位香港電話"></div>' +
    '<div><label>等級</label><select id="pos-mem-level"><option>一般會員</option><option>VIP 會員</option></select></div>' +
    '<div><label>備註</label><input type="text" id="pos-mem-remark" placeholder="選填"></div></div>' +
    '<div class="actions" style="margin-top:12px"><button type="button" class="btn green sm" data-call="posCreateMember">新增</button></div></div>' +
    editPanel +
    '<div class="card"><h3>會員列表（' + (posMembersCloud.list || []).length + '）</h3>' +
    '<div class="table-wrap"><table><thead><tr>' +
    '<th>姓名</th><th>電話</th><th>等級</th><th>備註</th><th>狀態</th><th></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" style="color:#888;text-align:center">尚無會員</td></tr>') +
    '</tbody></table></div></div>';
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
