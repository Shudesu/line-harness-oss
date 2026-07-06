import { BASE_CSS, escapeHtml, escapeJs } from './shared.js'

export function takeoutPage(liffId: string, storeName: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(storeName)} テイクアウト</title>
<style>${BASE_CSS}
  .menu-item { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .menu-item .info { flex: 1; }
  .menu-item .nm { font-weight: 700; }
  .menu-item .pr { color: var(--brand-dark); font-weight: 700; }
  .qty { display: flex; align-items: center; gap: 8px; }
  .qty button { width: 34px; height: 34px; padding: 0; margin: 0; border-radius: 50%; font-size: 18px; }
  .qty .n { min-width: 22px; text-align: center; font-weight: 700; }
  .total-bar { position: sticky; bottom: 0; background: var(--card); border-top: 2px solid var(--brand);
    padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; font-weight: 800; }
  .order-item { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-top: 10px; }
  .order-item .st { font-size: 12px; font-weight: 700; }
  .st-pending { color: var(--muted); } .st-accepted { color: var(--brand-dark); } .st-ready { color: var(--ok); }
  .order-item button { margin-top: 8px; padding: 8px; font-size: 13px; }
  .slide-wrap { position: relative; margin-top: 10px; height: 52px; border-radius: 26px;
    background: linear-gradient(90deg, #fff7ed, #ffedd5); border: 1.5px solid var(--brand); overflow: hidden; }
  .slide-wrap .label { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; font-size: 14px; font-weight: 700; color: var(--brand-dark); pointer-events: none; }
  .slide-wrap input[type=range] { -webkit-appearance: none; appearance: none; position: absolute; inset: 0;
    width: 100%; height: 100%; margin: 0; background: transparent; }
  .slide-wrap input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
    width: 46px; height: 46px; border-radius: 50%; background: var(--brand); border: 3px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,.25); cursor: grab; }
</style>
</head>
<body>
<div class="header"><h1>${escapeHtml(storeName)} テイクアウト</h1></div>
<div class="wrap">
  <div id="loading" class="muted" style="text-align:center;padding:30px">読み込み中…</div>

  <div id="main" class="hidden">
    <div class="card">
      <h2>メニュー</h2>
      <div id="menu"></div>
      <p class="muted" id="noMenu" style="margin-top:10px">現在テイクアウトメニューの準備中です</p>
      <label for="pickupTime">受取時間（本日・15分後以降）</label>
      <select id="pickupTime"></select>
      <label for="orderNote">ご要望（任意）</label>
      <input id="orderNote" placeholder="例: 箸を2膳お願いします">
      <button id="orderBtn">注文する（支払いは店頭）</button>
      <div class="msg" id="orderMsg"></div>
    </div>

    <div class="card">
      <h2>進行中のご注文</h2>
      <div id="orders"></div>
      <p class="muted" id="noOrders">進行中のご注文はありません</p>
    </div>

    <div class="card"><button id="backBtn" class="ghost">会員証にもどる</button></div>
  </div>
</div>
<div class="total-bar hidden" id="totalBar"><span>合計</span><span id="totalYen">¥0</span></div>

<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
const LIFF_ID = ${escapeJs(liffId)};
let TOKEN = null;
let MENU = [];
const CART = {}; // id -> qty
const STATUS_JA = { pending: '受付待ち', accepted: '調理中', ready: '準備完了！' };

async function api(path, opts = {}) {
  const res = await fetch('/api/liff' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN, ...(opts.headers || {}) },
  });
  return res.json();
}

function showMsg(id, ok, text) {
  const el = document.getElementById(id);
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
}

function renderMenu() {
  const box = document.getElementById('menu');
  box.innerHTML = '';
  document.getElementById('noMenu').style.display = MENU.length ? 'none' : 'block';
  for (const m of MENU) {
    const row = document.createElement('div');
    row.className = 'menu-item';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<div class="nm">' + m.name + '</div>'
      + (m.description ? '<div class="muted">' + m.description + '</div>' : '')
      + '<div class="pr">¥' + m.price.toLocaleString() + '</div>';
    const qty = document.createElement('div');
    qty.className = 'qty';
    const minus = document.createElement('button'); minus.textContent = '−'; minus.className = 'ghost';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = CART[m.id] || 0;
    const plus = document.createElement('button'); plus.textContent = '＋';
    minus.addEventListener('click', () => { CART[m.id] = Math.max(0, (CART[m.id] || 0) - 1); n.textContent = CART[m.id]; renderTotal(); });
    plus.addEventListener('click', () => { CART[m.id] = Math.min(20, (CART[m.id] || 0) + 1); n.textContent = CART[m.id]; renderTotal(); });
    qty.append(minus, n, plus);
    row.append(info, qty);
    box.appendChild(row);
  }
}

function renderTotal() {
  let total = 0;
  for (const m of MENU) total += (CART[m.id] || 0) * m.price;
  document.getElementById('totalYen').textContent = '¥' + total.toLocaleString();
  document.getElementById('totalBar').classList.toggle('hidden', total === 0);
}

async function loadOrders() {
  const res = await api('/takeout/orders');
  const box = document.getElementById('orders');
  box.innerHTML = '';
  const items = res.success ? res.data : [];
  document.getElementById('noOrders').style.display = items.length ? 'none' : 'block';
  for (const o of items) {
    const div = document.createElement('div');
    div.className = 'order-item';
    div.innerHTML = '<div class="st st-' + o.status + '">' + (STATUS_JA[o.status] || o.status) + '　' + o.orderNo + '</div>'
      + '<div>' + o.items.map(function(l){ return l.name + '×' + l.qty; }).join('、') + '</div>'
      + '<div class="muted">受取: ' + o.pickupAt + '　合計 ¥' + o.total.toLocaleString() + '</div>';
    if (o.status === 'pending') {
      const cancel = document.createElement('button');
      cancel.className = 'ghost';
      cancel.textContent = 'キャンセルする';
      cancel.addEventListener('click', async () => {
        if (!confirm(o.orderNo + ' をキャンセルしますか？')) return;
        const del = await api('/takeout/orders/' + o.id, { method: 'DELETE' });
        if (!del.success) alert(del.error || 'キャンセルできませんでした');
        await loadOrders();
      });
      div.appendChild(cancel);
    }
    if (o.status === 'accepted' || o.status === 'ready') {
      div.appendChild(buildReceiveSlider(o));
    }
    box.appendChild(div);
  }
}

// スライドで受け取り完了（スタッフの前で操作してもらう）
function buildReceiveSlider(o) {
  const wrap = document.createElement('div');
  wrap.className = 'slide-wrap';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = '≫ スライドして受け取り完了（スタッフの前で）';
  const range = document.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '0';
  let busy = false;
  const finish = async () => {
    if (busy) return;
    if (Number(range.value) >= 97) {
      busy = true;
      label.textContent = '処理中…';
      const res = await api('/takeout/orders/' + o.id + '/receive', { method: 'POST' });
      if (res.success) {
        label.textContent = '✅ 受け取りありがとうございました！';
        setTimeout(loadOrders, 1200);
      } else {
        alert(res.error || 'エラーが発生しました');
        range.value = '0';
        label.textContent = '≫ スライドして受け取り完了（スタッフの前で）';
        busy = false;
      }
    } else {
      range.value = '0';
    }
  };
  range.addEventListener('change', finish);
  range.addEventListener('touchend', finish);
  range.addEventListener('mouseup', finish);
  wrap.append(label, range);
  return wrap;
}

document.getElementById('orderBtn').addEventListener('click', async () => {
  const btn = document.getElementById('orderBtn');
  btn.disabled = true;
  try {
    const items = Object.entries(CART).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty }));
    const res = await api('/takeout/orders', {
      method: 'POST',
      body: JSON.stringify({
        items,
        pickupTime: document.getElementById('pickupTime').value,
        note: document.getElementById('orderNote').value,
      }),
    });
    if (res.success) {
      showMsg('orderMsg', true, '✅ ' + res.data.orderNo + ' で承りました。' + res.data.pickupAt + ' にお越しください。');
      for (const k of Object.keys(CART)) delete CART[k];
      renderMenu(); renderTotal();
      await loadOrders();
    } else {
      showMsg('orderMsg', false, res.error || '注文に失敗しました');
    }
  } finally { btn.disabled = false; }
});

document.getElementById('backBtn').addEventListener('click', () => { location.href = '/liff/card'; });

(function initTimes() {
  const sel = document.getElementById('pickupTime');
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const start = new Date(nowJst.getTime() + 20 * 60 * 1000); // 20分後から15分刻み
  start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 32; i++) {
    const t = new Date(start.getTime() + i * 15 * 60 * 1000);
    if (t.getUTCDate() !== nowJst.getUTCDate()) break; // 本日分のみ
    const v = String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0');
    sel.add(new Option(v, v));
  }
})();

liff.init({ liffId: LIFF_ID }).then(async () => {
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
  TOKEN = liff.getAccessToken();
  const res = await api('/takeout/menu');
  MENU = res.success ? res.data : [];
  renderMenu(); renderTotal();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('main').classList.remove('hidden');
  loadOrders();
}).catch((e) => {
  document.getElementById('loading').textContent = 'LIFFの初期化に失敗しました: ' + e.message;
});
</script>
</body>
</html>`
}
