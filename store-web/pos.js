/* ═══════════ POS 示範模組（本機 localStorage，不上雲） ═══════════ */
var POS_LS_KEY = 'store-web-pos-demo-v1';
var POS_STORES = ['觀塘', '荔枝角', '灣仔', '屯門'];
var POS_PAYMENTS = [
  { id: 'cash', name: '現金' },
  { id: 'credit_card', name: '信用卡' },
  { id: 'octopus', name: '八達通' },
  { id: 'fps', name: 'FPS' }
];
var posCart = [];
var posSelectedStore = '';
var posSearchKw = '';
var posMemberId = '';
var posRemark = '';
var posAccountBalance = 0;
var posPaymentMethod = 'cash';
var posReceiptFocusId = '';
var posTxKw = '';

function posSeedProducts() {
  function stock(n) {
    var o = {};
    POS_STORES.forEach(function (s) { o[s] = n; });
    return o;
  }
  return [
    { id: 'p1', name: 'Speedo 小童印花 Muscleback 連身泳衣 - 粉紅', sku: '80832418374', size: '28', price: 305, stock: stock(8) },
    { id: 'p2', name: '訓練蛙掌-藍', sku: 'AR1129BU', size: 'S', price: 117, stock: stock(12) },
    { id: 'p3', name: '女童純色雙層X背帶連身泳衣-黑', sku: 'WS-434BK', size: '10', price: 228, stock: stock(10) },
    { id: 'p4', name: '訓練短蹼鞋 - 藍', sku: 'WS-961BU', size: 'XS', price: 238, stock: stock(9) },
    { id: 'p5', name: '成人泳鏡-透明', sku: 'WS-MG01', size: '均碼', price: 88, stock: stock(20) },
    { id: 'p6', name: '矽膠泳帽-黑', sku: 'WS-CAP-BK', size: '均碼', price: 45, stock: stock(25) },
    { id: 'p7', name: '防曬乳液 SPF50 100ml', sku: 'SUN-50-100', size: '100ml', price: 128, stock: stock(15) },
    { id: 'p8', name: '成人競賽泳衣-深藍', sku: 'SPD-RACE-NV', size: '32', price: 420, stock: stock(6) },
    { id: 'p9', name: '浮板-黃', sku: 'WS-KB-YL', size: '均碼', price: 65, stock: stock(18) },
    { id: 'p10', name: '鼻夾耳塞套裝', sku: 'WS-NE-01', size: '均碼', price: 38, stock: stock(30) },
    { id: 'p11', name: '兒童防曬衣-白', sku: 'WS-UV-WH', size: '120', price: 198, stock: stock(11) },
    { id: 'p12', name: '防水袋 5L-橙', sku: 'DRY-5L-OR', size: '5L', price: 78, stock: stock(14) }
  ];
}
function posSeedMembers() {
  return [
    { id: 'm1', name: '梁先生', phone: '56140870', level: '一般會員' },
    { id: 'm2', name: '陳小姐', phone: '91234567', level: 'VIP 會員' },
    { id: 'm3', name: '王先生', phone: '61239876', level: '一般會員' },
    { id: 'm4', name: '李小姐', phone: '98881234', level: 'VIP 會員' },
    { id: 'm5', name: '測試客人', phone: '60000000', level: '一般會員' }
  ];
}
function posEmptyState() {
  return {
    version: 1,
    products: posSeedProducts(),
    members: posSeedMembers(),
    transactions: [],
    seq: 1000
  };
}
function posLoadState() {
  try {
    var raw = localStorage.getItem(POS_LS_KEY);
    if (!raw) return posEmptyState();
    var s = JSON.parse(raw);
    if (!s || !Array.isArray(s.products) || !Array.isArray(s.transactions)) return posEmptyState();
    if (!Array.isArray(s.members)) s.members = posSeedMembers();
    if (typeof s.seq !== 'number') s.seq = 1000;
    return s;
  } catch (e) {
    return posEmptyState();
  }
}
function posSaveState(s) {
  try {
    localStorage.setItem(POS_LS_KEY, JSON.stringify(s));
  } catch (e) {
    if (typeof alert2 === 'function') alert2('無法儲存本機 POS 資料（可能儲存空間已滿）。');
  }
}
function posResetDemoData() {
  if (!confirm('確定重置本機示範 POS 資料？\n交易記錄將清空，商品庫存與會員將還原為種子資料。')) return;
  posSaveState(posEmptyState());
  posCart = [];
  posMemberId = '';
  posRemark = '';
  posAccountBalance = 0;
  posPaymentMethod = 'cash';
  posReceiptFocusId = '';
  if (typeof addModuleLog === 'function') addModuleLog('pos', '重置示範 POS', '本機 localStorage');
  if (typeof alert2 === 'function') alert2('已重置示範 POS 資料。');
  if (typeof go === 'function') go('posCashier');
  else if (typeof render === 'function') render();
}
function posUserStores(user) {
  user = user || (typeof currentUser !== 'undefined' ? currentUser : null);
  var units = [];
  if (typeof dailyUserUnits === 'function') units = dailyUserUnits(user) || [];
  else if (user && Array.isArray(user.units)) units = user.units.slice();
  else if (user && user.unit) units = [user.unit];
  var list = units.filter(function (u) { return POS_STORES.indexOf(u) >= 0; });
  if (!list.length && user && (user.role === 'system_admin' || user.role === 'manager')) {
    return POS_STORES.slice();
  }
  return list;
}
function posEnsureStore() {
  var stores = posUserStores();
  if (!stores.length) {
    posSelectedStore = '';
    return '';
  }
  if (stores.indexOf(posSelectedStore) < 0) posSelectedStore = stores[0];
  return posSelectedStore;
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
function posNowStr() {
  if (typeof dailyNowStr === 'function') return dailyNowStr();
  if (typeof nowStr === 'function') return nowStr();
  return new Date().toLocaleString('zh-HK');
}
function posNowStamp() {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function posFindProduct(state, id) {
  return (state.products || []).find(function (p) { return p.id === id; }) || null;
}
function posFindMember(state, id) {
  return (state.members || []).find(function (m) { return m.id === id; }) || null;
}
function posCartSubtotal() {
  return posCart.reduce(function (sum, line) {
    return sum + (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
  }, 0);
}
function posSetStore(store) {
  var stores = posUserStores();
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
function posSetRemark(v) {
  posRemark = String(v || '');
}
function posSetAccountBalance(v) {
  var n = parseFloat(v);
  posAccountBalance = isFinite(n) ? n : 0;
  if (typeof render === 'function') render();
}
function posSetPayment(method) {
  posPaymentMethod = method || 'cash';
  if (typeof render === 'function') render();
}
function posAddToCart(productId) {
  var store = posEnsureStore();
  if (!store) {
    alert2('你的賬戶沒有可收銀的港店單位，無法使用 POS。');
    return;
  }
  var state = posLoadState();
  var p = posFindProduct(state, productId);
  if (!p) { alert2('找不到商品。'); return; }
  var avail = Number((p.stock && p.stock[store]) || 0);
  var existing = posCart.find(function (x) { return x.productId === productId; });
  var nextQty = (existing ? existing.qty : 0) + 1;
  if (nextQty > avail) {
    alert2('庫存不足（' + store + ' 剩餘 ' + avail + '）。');
    return;
  }
  if (existing) existing.qty = nextQty;
  else {
    posCart.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      size: p.size,
      unitPrice: Number(p.price) || 0,
      qty: 1
    });
  }
  if (typeof render === 'function') render();
}
function posCartQty(productId, delta) {
  var store = posEnsureStore();
  var state = posLoadState();
  var p = posFindProduct(state, productId);
  var line = posCart.find(function (x) { return x.productId === productId; });
  if (!line) return;
  var avail = p && p.stock ? Number(p.stock[store] || 0) : 9999;
  var next = (Number(line.qty) || 0) + delta;
  if (next <= 0) {
    posCart = posCart.filter(function (x) { return x.productId !== productId; });
  } else if (next > avail) {
    alert2('庫存不足（' + store + ' 剩餘 ' + avail + '）。');
    return;
  } else {
    line.qty = next;
  }
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
function posCheckout() {
  var store = posEnsureStore();
  if (!store) {
    alert2('你的賬戶沒有可收銀的港店單位。');
    return;
  }
  if (!posCart.length) {
    alert2('購物車是空的。');
    return;
  }
  var state = posLoadState();
  for (var i = 0; i < posCart.length; i++) {
    var line = posCart[i];
    var p = posFindProduct(state, line.productId);
    if (!p) { alert2('商品已不存在：' + line.name); return; }
    var avail = Number((p.stock && p.stock[store]) || 0);
    if (line.qty > avail) {
      alert2('庫存不足：' + p.name + '（剩餘 ' + avail + '）');
      return;
    }
  }
  var subtotal = posCartSubtotal();
  var balance = Number(posAccountBalance) || 0;
  var orderTotal = Math.round((subtotal + balance) * 100) / 100;
  if (orderTotal < 0) {
    alert2('訂單總計不可為負，請調整賬戶抵扣。');
    return;
  }
  var pay = POS_PAYMENTS.find(function (x) { return x.id === posPaymentMethod; });
  var member = posFindMember(state, posMemberId);
  state.seq = (state.seq || 1000) + 1;
  var orderNo = String(3000000 + state.seq);
  var orderNoAlt = String(50000 + (state.seq % 10000));
  var invoiceNo = 'INV-' + new Date().getFullYear() + '-' + String(state.seq).padStart(8, '0');
  var receiptNo = 'R' + Date.now().toString(36).toUpperCase();
  var user = typeof currentUser !== 'undefined' ? currentUser : null;
  var tx = {
    id: 'tx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    receiptNo: receiptNo,
    orderNo: orderNo,
    orderNoAlt: orderNoAlt,
    invoiceNo: invoiceNo,
    store: store,
    staffId: user ? String(user.id) : '',
    staffName: user ? (user.name || user.login || '') : '',
    memberId: member ? member.id : '',
    memberName: member ? member.name : '',
    memberPhone: member ? member.phone : '',
    remark: String(posRemark || '').trim(),
    paymentMethod: pay ? pay.id : 'cash',
    paymentMethodName: pay ? pay.name : '現金',
    paymentStatus: '已付款',
    orderStatus: '訂單已完成（' + store + '店）',
    items: posCart.map(function (line) {
      return {
        qty: line.qty,
        name: line.name,
        sku: line.sku,
        size: line.size,
        unitPrice: line.unitPrice,
        lineTotal: Math.round(line.unitPrice * line.qty * 100) / 100
      };
    }),
    subtotal: Math.round(subtotal * 100) / 100,
    collected: 0,
    accountBalance: balance,
    orderTotal: orderTotal,
    paid: orderTotal,
    createdAt: posNowStamp(),
    createdAtMs: Date.now()
  };
  posCart.forEach(function (line) {
    var p = posFindProduct(state, line.productId);
    if (p && p.stock) {
      p.stock[store] = Math.max(0, Number(p.stock[store] || 0) - line.qty);
    }
  });
  state.transactions.unshift(tx);
  posSaveState(state);
  posCart = [];
  posRemark = '';
  posAccountBalance = 0;
  posMemberId = '';
  posReceiptFocusId = tx.id;
  if (typeof addModuleLog === 'function') {
    addModuleLog('pos', '完成收銀', store + '｜' + tx.orderNo + '｜$' + posMoney(tx.orderTotal));
  }
  if (typeof go === 'function') go('posReceipt');
  else if (typeof render === 'function') render();
}
function posOpenReceipt(id) {
  posReceiptFocusId = String(id || '');
  if (typeof go === 'function') go('posReceipt');
}
function posSetTxKw(v) {
  posTxKw = String(v || '');
  if (typeof render === 'function') render();
}
function vPosCashier() {
  var stores = posUserStores();
  var store = posEnsureStore();
  if (!stores.length) {
    return '<div class="card"><h2>🛒 POS 收銀</h2>' +
      '<p style="color:#c62828;font-size:14px">你的賬戶沒有港店所屬單位（觀塘／荔枝角／灣仔／屯門），無法使用示範 POS。</p></div>';
  }
  var state = posLoadState();
  var kw = String(posSearchKw || '').trim().toLowerCase();
  var products = (state.products || []).filter(function (p) {
    if (!kw) return true;
    return String(p.name).toLowerCase().indexOf(kw) >= 0 ||
      String(p.sku).toLowerCase().indexOf(kw) >= 0 ||
      String(p.size).toLowerCase().indexOf(kw) >= 0;
  });
  var storeOpts = stores.map(function (s) {
    return '<option value="' + posEsc(s) + '"' + (s === store ? ' selected' : '') + '>' + posEsc(s) + '店</option>';
  }).join('');
  var memberOpts = '<option value="">（不選擇會員）</option>' + (state.members || []).map(function (m) {
    return '<option value="' + posEsc(m.id) + '"' + (posMemberId === m.id ? ' selected' : '') + '>' +
      posEsc(m.name + '｜' + m.phone + '｜' + m.level) + '</option>';
  }).join('');
  var payOpts = POS_PAYMENTS.map(function (p) {
    return '<label style="display:inline-flex;align-items:center;gap:6px;margin:0 12px 8px 0;font-size:13px;cursor:pointer">' +
      '<input type="radio" name="pos-pay" value="' + p.id + '"' + (posPaymentMethod === p.id ? ' checked' : '') +
      ' onchange="posSetPayment(this.value)"> ' + posEsc(p.name) + '</label>';
  }).join('');
  var productRows = products.map(function (p) {
    var avail = Number((p.stock && p.stock[store]) || 0);
    var low = avail <= 2 ? ' style="color:#c62828;font-weight:bold"' : '';
    return '<tr>' +
      '<td>' + posEsc(p.sku) + '</td>' +
      '<td>' + posEsc(p.name) + '<div style="font-size:12px;color:#78909c">尺寸 ' + posEsc(p.size) + '</div></td>' +
      '<td>$' + posMoney(p.price) + '</td>' +
      '<td' + low + '>' + avail + '</td>' +
      '<td><button type="button" class="btn green sm" data-call="posAddToCart" data-arg0="' + posEsc(p.id) + '"' +
      (avail <= 0 ? ' disabled' : '') + '>加入</button></td>' +
      '</tr>';
  }).join('');
  var cartRows = posCart.length ? posCart.map(function (line) {
    return '<tr>' +
      '<td>' + posEsc(line.name) + '<div style="font-size:12px;color:#78909c">' + posEsc(line.sku) + '｜' + posEsc(line.size) + '</div></td>' +
      '<td style="white-space:nowrap">' +
      '<button type="button" class="btn gray sm" data-call="posCartQty" data-arg0="' + posEsc(line.productId) + '" data-arg1="-1">−</button> ' +
      '<b>' + line.qty + '</b> ' +
      '<button type="button" class="btn gray sm" data-call="posCartQty" data-arg0="' + posEsc(line.productId) + '" data-arg1="1">＋</button>' +
      '</td>' +
      '<td>$' + posMoney(line.unitPrice * line.qty) + '</td>' +
      '<td><button type="button" class="btn red sm" data-call="posRemoveCartLine" data-arg0="' + posEsc(line.productId) + '">移除</button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="4" style="color:#888;text-align:center">購物車是空的</td></tr>';
  var subtotal = posCartSubtotal();
  var balance = Number(posAccountBalance) || 0;
  var total = Math.round((subtotal + balance) * 100) / 100;
  return '<div class="card"><h2>🛒 POS 收銀</h2>' +
    '<div class="info-banner">示範模式：資料只存在本機瀏覽器。目前店舖鎖定你的所屬單位。</div>' +
    '<div class="filters" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">' +
    '<div><label>收銀店舖</label><select onchange="posSetStore(this.value)">' + storeOpts + '</select></div>' +
    '<div style="flex:1;min-width:180px"><label>搜尋商品</label>' +
    '<input type="text" value="' + posEsc(posSearchKw) + '" placeholder="品名／SKU／尺寸" oninput="posSetSearch(this.value)"></div>' +
    '</div></div>' +
    '<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,0.9fr);gap:14px" class="pos-cashier-grid">' +
    '<div class="card"><h3>商品</h3><div class="table-wrap"><table><thead><tr>' +
    '<th>SKU</th><th>商品</th><th>售價</th><th>庫存</th><th></th></tr></thead><tbody>' +
    (productRows || '<tr><td colspan="5" style="color:#888;text-align:center">無符合商品</td></tr>') +
    '</tbody></table></div></div>' +
    '<div class="card"><h3>購物車</h3><div class="table-wrap"><table><thead><tr>' +
    '<th>商品</th><th>數量</th><th>小計</th><th></th></tr></thead><tbody>' + cartRows +
    '</tbody></table></div>' +
    '<label>示範會員</label><select onchange="posSetMember(this.value)">' + memberOpts + '</select>' +
    '<label>備註</label><input type="text" value="' + posEsc(posRemark) + '" placeholder="例如客人姓名" onchange="posSetRemark(this.value)" oninput="posRemark=this.value">' +
    '<label>賬戶餘額／抵扣（可負數）</label>' +
    '<input type="number" step="0.01" value="' + posEsc(String(balance)) + '" onchange="posSetAccountBalance(this.value)">' +
    '<div style="margin-top:10px"><div style="font-size:13px;color:#555;margin-bottom:6px">支付方式</div>' + payOpts + '</div>' +
    '<div style="margin-top:12px;border-top:1px dashed #cfd8dc;padding-top:10px;font-size:14px;line-height:1.7">' +
    '<div style="display:flex;justify-content:space-between"><span>商品小計</span><b>$' + posMoney(subtotal) + '</b></div>' +
    '<div style="display:flex;justify-content:space-between"><span>賬戶餘額</span><b>$' + posMoney(balance) + '</b></div>' +
    '<div style="display:flex;justify-content:space-between;font-size:16px"><span>訂單總計</span><b>$' + posMoney(total) + '</b></div>' +
    '</div>' +
    '<div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button type="button" class="btn gray sm" data-call="posClearCart">清空購物車</button>' +
    '<button type="button" class="btn green" data-call="posCheckout"' + (!posCart.length ? ' disabled' : '') + '>確認收款</button>' +
    '</div></div></div>' +
    '<style>@media (max-width:900px){.pos-cashier-grid{grid-template-columns:1fr !important}}</style>';
}
function vPosTransactions() {
  var state = posLoadState();
  var stores = posUserStores();
  var kw = String(posTxKw || '').trim().toLowerCase();
  var list = (state.transactions || []).filter(function (tx) {
    if (stores.length && stores.indexOf(tx.store) < 0 && !(typeof isAdmin === 'function' && isAdmin()) && !(typeof isManager === 'function' && isManager())) {
      return false;
    }
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
      '<td><button type="button" class="btn sm" data-call="posOpenReceipt" data-arg0="' + posEsc(tx.id) + '">收據</button></td>' +
      '</tr>';
  }).join('');
  return '<div class="card"><h2>🧾 交易記錄</h2>' +
    '<div class="filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
    '<div style="flex:1;min-width:200px"><label>搜尋</label>' +
    '<input type="text" value="' + posEsc(posTxKw) + '" placeholder="單號／店舖／員工／備註" oninput="posSetTxKw(this.value)"></div>' +
    '<button type="button" class="btn green sm" data-call="go" data-arg0="posCashier">＋ 新收銀</button>' +
    '</div>' +
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
      '<td style="text-align:right">' + posMoney(it.lineTotal) + '</td>' +
      '</tr>';
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
    '<div style="font-size:11px;color:#888;margin-top:6px;line-height:1.5">WhatsApp: 61231104<br>watersports0227@gmail.com<br>https://www.sharemall.hk</div>' +
    '</div>' +
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
    '• 此單為示範電子收據（對齊門市熱感單格式）<br>' +
    '• 顯示價格為折後價<br>' +
    '• 一般貨品 7 日換貨；特價品不設換貨<br>' +
    '• 不設退款' +
    '</div>' +
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
    '<button type="button" class="btn green sm" data-call="go" data-arg0="posCashier">繼續收銀</button>' +
    '</div></div>';
}
function vPosReceipt() {
  var state = posLoadState();
  var tx = (state.transactions || []).find(function (t) { return t.id === posReceiptFocusId; });
  if (!tx && state.transactions && state.transactions[0]) tx = state.transactions[0];
  return posReceiptHtml(tx);
}
function vPosReset() {
  return '<div class="card"><h2>♻️ 重置示範 POS 資料</h2>' +
    '<p style="font-size:14px;line-height:1.6;color:#455a64">會清除本機瀏覽器內的示範交易，並把商品庫存、會員名單還原為種子資料。' +
    '<br><b>不影響</b>雲端 Mongo 的每日工作、推送、調動等資料。</p>' +
    '<div class="actions" style="margin-top:14px">' +
    '<button type="button" class="btn red" data-call="posResetDemoData">確認重置</button>' +
    '<button type="button" class="btn gray sm" data-call="go" data-arg0="posCashier">返回收銀</button>' +
    '</div></div>';
}
// 若 app.js 已先完成登入渲染，補載入後刷新一次
if (typeof currentUser !== 'undefined' && currentUser && typeof render === 'function') {
  try { render(); } catch (e) {}
}
