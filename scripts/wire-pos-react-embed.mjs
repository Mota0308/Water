import fs from 'fs';

const p = new URL('../store-web/pos.js', import.meta.url);
let s = fs.readFileSync(p, 'utf8');

const helpers = `/** React POS UI（嵌入 /pos-ui/，與參考 App 同款三欄收銀） */
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
  var src = '/pos-ui/' + hash;
  return '<div class="pos-ui-embed" style="margin:-4px -4px 0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);height:calc(100vh - 72px);min-height:560px">' +
    '<iframe id="pos-ui-iframe" title="POS" src="' + src + '" style="width:100%;height:100%;border:0;display:block;background:#fff"></iframe></div>';
}
`;

function replaceFunction(src, name, body) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(0, start) + `function ${name}() {\n${body}\n}` + src.slice(i);
}

if (!s.includes('function vPosReactEmbed')) {
  const anchor = s.indexOf('function vPosCashier(');
  if (anchor < 0) throw new Error('no vPosCashier');
  s = s.slice(0, anchor) + helpers + s.slice(anchor);
}

const embeds = {
  vPosCashier: "  return vPosReactEmbed('posCashier');",
  vPosTransactions: "  return vPosReactEmbed('posTransactions');",
  vPosReceipt: "  return vPosReactEmbed('posReceipt');",
  vPosMembers: "  return vPosReactEmbed('posMembers');",
  vPosReport: "  return vPosReactEmbed('posReport');",
  vPosSettlement: "  return vPosReactEmbed('posSettlement');",
};

for (const [name, body] of Object.entries(embeds)) {
  s = replaceFunction(s, name, body);
}

if (!s.includes('function vPosProducts')) {
  const start = s.indexOf('function vPosReset(');
  if (start < 0) throw new Error('no vPosReset');
  s =
    s.slice(0, start) +
    `function vPosProducts() {\n  return vPosReactEmbed('posProducts');\n}\n` +
    s.slice(start);
}

fs.writeFileSync(p, s);
console.log('ok', s.length);
