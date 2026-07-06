import { BASE_CSS, escapeHtml, escapeJs } from './shared.js'

export function staffPage(liffId: string, storeName: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(storeName)} スタッフ</title>
<style>${BASE_CSS}
  .wrap { max-width: 640px; }
  .code-display { text-align: center; font-size: 42px; font-weight: 800; letter-spacing: 8px;
    color: var(--brand-dark); padding: 10px 0; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .summary .box { text-align: center; border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .summary .n { font-size: 24px; font-weight: 800; color: var(--brand-dark); }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .status-btns button { width: auto; padding: 6px 10px; margin: 2px 4px 0 0; font-size: 12px; display: inline-block; }
  .st-seated { color: var(--ok); font-weight: 700; }
  .st-cancelled, .st-no_show { color: var(--err); font-weight: 700; }
</style>
</head>
<body>
<div class="header"><h1>${escapeHtml(storeName)} スタッフページ</h1></div>
<div class="wrap">
  <div class="card" id="loginCard">
    <h2>スタッフ認証</h2>
    <label for="pin">PIN</label>
    <input id="pin" type="password" autocomplete="off">
    <button id="loginBtn">ログイン</button>
    <div class="msg" id="loginMsg"></div>
  </div>

  <div id="main" class="hidden">
    <div class="card">
      <h2>本日のサマリー</h2>
      <div class="summary">
        <div class="box"><div class="n" id="sumMembers">-</div><div class="muted">会員数</div></div>
        <div class="box"><div class="n" id="sumVisits">-</div><div class="muted">本日来店</div></div>
        <div class="box"><div class="n" id="sumRes">-</div><div class="muted">本日予約</div></div>
      </div>
    </div>

    <div class="card">
      <h2>本日の来店コード・来店QR（店内掲示用）</h2>
      <div class="code-display" id="visitCode">----</div>
      <div id="visitQr" style="display:flex;justify-content:center;padding:8px 0"></div>
      <p class="muted">お客様がQRを読み取ると<b>スキャンだけで自動的にスタンプ</b>が押されます（コード手入力も可）。日付が変わると自動更新されるので、画面掲示か毎日の印刷でご利用ください。</p>
    </div>

    <div class="card">
      <h2>スタンプ付与（会員番号で）</h2>
      <input id="stampMemberNo" placeholder="R-000123" autocapitalize="characters">
      <button id="stampBtn">スタンプを押す</button>
      <div class="msg" id="stampMsg"></div>
    </div>

    <div class="card">
      <h2>特典・クーポンの消込</h2>
      <input id="redeemCode" placeholder="RW-XXXXXX / CP-XXXXXX" autocapitalize="characters">
      <label for="redeemMemberNo">会員番号（CP-クーポン時・任意。入れると来店記録＆レビュー依頼が動く）</label>
      <input id="redeemMemberNo" placeholder="R-000123" autocapitalize="characters">
      <button id="redeemBtn">消込する</button>
      <div class="msg" id="redeemMsg"></div>
    </div>

    <div class="card">
      <h2>テイクアウト注文</h2>
      <input type="date" id="toDate">
      <div id="toList"></div>
      <p class="muted" id="noTo">この日の注文はありません</p>
    </div>

    <div class="card">
      <h2>テイクアウトメニュー管理</h2>
      <div id="menuList"></div>
      <p class="muted" id="noMenu">メニューがまだありません。下のフォームから追加してください。</p>
      <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:4px">
        <input type="hidden" id="mId">
        <label for="mName">商品名 <span id="mEditing" class="muted"></span></label>
        <input id="mName" placeholder="唐揚げ弁当">
        <div class="row">
          <div><label for="mPrice">価格（円・税込）</label><input id="mPrice" type="number" inputmode="numeric" placeholder="800"></div>
          <div><label for="mSort">表示順</label><input id="mSort" type="number" inputmode="numeric" value="0"></div>
        </div>
        <label for="mDesc">説明（任意）</label>
        <input id="mDesc" placeholder="自家製ダレの唐揚げ5個入り">
        <button id="mSaveBtn">メニューを追加する</button>
        <button id="mClearBtn" class="ghost hidden">編集をやめる</button>
        <div class="msg" id="mMsg"></div>
      </div>
    </div>

    <div class="card">
      <h2>予約一覧</h2>
      <input type="date" id="resDate">
      <table>
        <thead><tr><th>時間</th><th>お名前 / 内容</th><th>状態</th></tr></thead>
        <tbody id="resBody"></tbody>
      </table>
      <p class="muted" id="noRes">この日の予約はありません</p>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js"></script>
<script>
const LIFF_ID = ${escapeJs(liffId)};
let PIN = sessionStorage.getItem('staff_pin') || '';

async function api(path, opts = {}) {
  const res = await fetch('/api/staff' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Staff-Pin': PIN, ...(opts.headers || {}) },
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return res.json();
}

function logout() {
  sessionStorage.removeItem('staff_pin');
  document.getElementById('main').classList.add('hidden');
  document.getElementById('loginCard').classList.remove('hidden');
}

function showMsg(id, ok, text) {
  const el = document.getElementById(id);
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
}

const STATUS_JA = { confirmed: '確定', seated: '来店', cancelled: 'キャンセル', no_show: '無断' };

async function loadAll() {
  const [sum, code] = await Promise.all([api('/summary'), api('/visit-code')]);
  if (sum.success) {
    document.getElementById('sumMembers').textContent = sum.data.members;
    document.getElementById('sumVisits').textContent = sum.data.visitsToday;
    document.getElementById('sumRes').textContent = sum.data.reservationsToday;
  }
  if (code.success) {
    document.getElementById('visitCode').textContent = code.data.code;
    const qrBox = document.getElementById('visitQr');
    qrBox.innerHTML = '';
    if (LIFF_ID && typeof QRCode !== 'undefined') {
      new QRCode(qrBox, { text: 'https://liff.line.me/' + LIFF_ID + '?code=' + code.data.code, width: 180, height: 180 });
    }
  }
  await loadReservations();
  await loadTakeout();
  await loadMenu();
}

async function loadReservations() {
  const date = document.getElementById('resDate').value;
  const res = await api('/reservations?date=' + date);
  const body = document.getElementById('resBody');
  body.innerHTML = '';
  const items = res.success ? res.data : [];
  document.getElementById('noRes').style.display = items.length ? 'none' : 'block';
  for (const r of items) {
    const tr = document.createElement('tr');
    const btns = document.createElement('td');
    btns.className = 'status-btns';
    if (r.status === 'confirmed') {
      for (const [st, label] of [['seated', '来店'], ['no_show', '無断'], ['cancelled', '取消']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = st === 'seated' ? '' : 'ghost';
        b.addEventListener('click', async () => {
          await api('/reservations/' + r.id, { method: 'PATCH', body: JSON.stringify({ status: st }) });
          await loadReservations();
        });
        btns.appendChild(b);
      }
    } else {
      btns.innerHTML = '<span class="st-' + r.status + '">' + (STATUS_JA[r.status] || r.status) + '</span>';
    }
    const info = document.createElement('td');
    info.innerHTML = r.name + ' 様 ' + r.partySize + '名'
      + '<div class="muted">' + r.memberNo + (r.phone ? '｜' + r.phone : '') + (r.note ? '｜' + r.note : '') + '</div>';
    const time = document.createElement('td');
    time.textContent = r.time;
    tr.appendChild(time); tr.appendChild(info); tr.appendChild(btns);
    body.appendChild(tr);
  }
}

async function enter() {
  try {
    const res = await api('/summary');
    if (!res.success) throw new Error();
    document.getElementById('loginCard').classList.add('hidden');
    document.getElementById('main').classList.remove('hidden');
    sessionStorage.setItem('staff_pin', PIN);
    await loadAll();
  } catch {
    showMsg('loginMsg', false, 'PINが違います');
  }
}

document.getElementById('loginBtn').addEventListener('click', () => {
  PIN = document.getElementById('pin').value.trim();
  enter();
});

document.getElementById('stampBtn').addEventListener('click', async () => {
  const res = await api('/stamp', { method: 'POST', body: JSON.stringify({ memberNo: document.getElementById('stampMemberNo').value }) });
  if (res.success) {
    showMsg('stampMsg', true, (res.data.displayName || res.data.memberNo) + ' 様に押印（' + res.data.stampCount + '個'
      + (res.data.rewardEarned ? '・🎉特典発行 ' + res.data.rewardCode : '') + '）');
    document.getElementById('stampMemberNo').value = '';
    loadAll();
  } else showMsg('stampMsg', false, res.error || 'エラー');
});

document.getElementById('redeemBtn').addEventListener('click', async () => {
  const res = await api('/redeem', { method: 'POST', body: JSON.stringify({
    code: document.getElementById('redeemCode').value,
    memberNo: document.getElementById('redeemMemberNo').value,
  }) });
  if (res.success) {
    showMsg('redeemMsg', true, res.data.kind === 'campaign'
      ? '「' + res.data.name + '」を消込みました（累計' + res.data.usedCount + '回目）'
      : '「' + res.data.name + '」を使用済みにしました' + (res.data.memberNo ? '（' + res.data.memberNo + ' の来店を記録）' : ''));
    document.getElementById('redeemCode').value = '';
    document.getElementById('redeemMemberNo').value = '';
  } else showMsg('redeemMsg', false, res.error || 'エラー');
});

const TO_STATUS_JA = { pending: '受付待ち', accepted: '調理中', ready: '準備完了', completed: '受渡済', cancelled: 'キャンセル' };
const TO_NEXT = { pending: [['accepted', '調理開始'], ['cancelled', '取消']], accepted: [['ready', '準備完了→通知']], ready: [['completed', '受渡完了']] };

async function loadTakeout() {
  const date = document.getElementById('toDate').value;
  const res = await api('/takeout?date=' + date);
  const box = document.getElementById('toList');
  box.innerHTML = '';
  const items = res.success ? res.data : [];
  document.getElementById('noTo').style.display = items.length ? 'none' : 'block';
  for (const o of items) {
    const div = document.createElement('div');
    div.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:10px;margin-top:8px';
    div.innerHTML = '<b>' + o.orderNo + '</b>　' + o.pickupAt.split(' ')[1] + ' 受取　<span class="muted">' + (TO_STATUS_JA[o.status] || o.status) + '</span>'
      + '<div>' + o.items.map(function(l){ return l.name + '×' + l.qty; }).join('、') + '　¥' + o.total.toLocaleString() + '</div>'
      + '<div class="muted">' + o.memberNo + (o.note ? '｜' + o.note : '') + '</div>';
    const btns = document.createElement('div');
    btns.className = 'status-btns';
    for (const [st, label] of (TO_NEXT[o.status] || [])) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = st === 'cancelled' ? 'ghost' : '';
      b.addEventListener('click', async () => {
        await api('/takeout/' + o.id, { method: 'PATCH', body: JSON.stringify({ status: st }) });
        await loadTakeout();
      });
      btns.appendChild(b);
    }
    div.appendChild(btns);
    box.appendChild(div);
  }
}

document.getElementById('toDate').addEventListener('change', loadTakeout);

// --- テイクアウトメニュー管理 ---
let MENU_ITEMS = [];

async function loadMenu() {
  const res = await api('/takeout-menu');
  MENU_ITEMS = res.success ? res.data : [];
  const box = document.getElementById('menuList');
  box.innerHTML = '';
  document.getElementById('noMenu').style.display = MENU_ITEMS.length ? 'none' : 'block';
  for (const m of MENU_ITEMS) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)'
      + (m.isAvailable ? '' : ';opacity:.5');
    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = '<b>' + m.name + '</b>　¥' + m.price.toLocaleString()
      + (m.isAvailable ? '' : '　<span class="muted">[非公開]</span>')
      + (m.description ? '<div class="muted">' + m.description + '</div>' : '');
    const edit = document.createElement('button');
    edit.textContent = '編集'; edit.className = 'ghost';
    edit.style.cssText = 'width:auto;padding:6px 12px;margin:0;font-size:13px';
    edit.addEventListener('click', () => {
      document.getElementById('mId').value = m.id;
      document.getElementById('mName').value = m.name;
      document.getElementById('mPrice').value = m.price;
      document.getElementById('mSort').value = m.sortOrder;
      document.getElementById('mDesc').value = m.description || '';
      document.getElementById('mEditing').textContent = '（「' + m.name + '」を編集中）';
      document.getElementById('mSaveBtn').textContent = '変更を保存する';
      document.getElementById('mClearBtn').classList.remove('hidden');
    });
    const toggle = document.createElement('button');
    toggle.textContent = m.isAvailable ? '非公開に' : '公開する';
    toggle.className = m.isAvailable ? 'ghost' : '';
    toggle.style.cssText = 'width:auto;padding:6px 12px;margin:0;font-size:13px';
    toggle.addEventListener('click', async () => {
      await api('/takeout-menu', { method: 'POST', body: JSON.stringify({
        id: m.id, name: m.name, price: m.price, description: m.description || undefined,
        sortOrder: m.sortOrder, isAvailable: !m.isAvailable,
      }) });
      await loadMenu();
    });
    div.append(info, edit, toggle);
    box.appendChild(div);
  }
}

function clearMenuForm() {
  for (const id of ['mId', 'mName', 'mPrice', 'mDesc']) document.getElementById(id).value = '';
  document.getElementById('mSort').value = '0';
  document.getElementById('mEditing').textContent = '';
  document.getElementById('mSaveBtn').textContent = 'メニューを追加する';
  document.getElementById('mClearBtn').classList.add('hidden');
}

document.getElementById('mSaveBtn').addEventListener('click', async () => {
  const id = document.getElementById('mId').value;
  const res = await api('/takeout-menu', { method: 'POST', body: JSON.stringify({
    id: id || undefined,
    name: document.getElementById('mName').value,
    price: Number(document.getElementById('mPrice').value),
    description: document.getElementById('mDesc').value || undefined,
    sortOrder: Number(document.getElementById('mSort').value) || 0,
  }) });
  if (res.success) {
    showMsg('mMsg', true, '「' + res.data.name + '」を' + (id ? '更新' : '追加') + 'しました');
    clearMenuForm();
    await loadMenu();
  } else showMsg('mMsg', false, res.error || 'エラー');
});

document.getElementById('mClearBtn').addEventListener('click', clearMenuForm);

document.getElementById('resDate').addEventListener('change', loadReservations);

(function init() {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  document.getElementById('resDate').value = today;
  document.getElementById('toDate').value = today;
  if (PIN) enter();
})();
</script>
</body>
</html>`
}
