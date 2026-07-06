import { BASE_CSS, escapeHtml, escapeJs } from './shared.js'

export function reservePage(liffId: string, storeName: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(storeName)} 予約</title>
<style>${BASE_CSS}
  .res-item { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-top: 10px; }
  .res-item .when { font-weight: 700; }
  .res-item button { margin-top: 8px; padding: 8px; font-size: 13px; }
</style>
</head>
<body>
<div class="header"><h1>${escapeHtml(storeName)} お席のご予約</h1></div>
<div class="wrap">
  <div id="loading" class="muted" style="text-align:center;padding:30px">読み込み中…</div>

  <div id="main" class="hidden">
    <div class="card">
      <h2>新規予約</h2>
      <div class="row">
        <div><label for="rDate">日付</label><input type="date" id="rDate"></div>
        <div><label for="rTime">時間</label><select id="rTime"></select></div>
      </div>
      <div class="row">
        <div><label for="rParty">人数</label><select id="rParty"></select></div>
        <div><label for="rPhone">電話番号（任意）</label><input type="tel" id="rPhone" placeholder="090-0000-0000"></div>
      </div>
      <label for="rName">お名前</label>
      <input id="rName" placeholder="山田太郎">
      <label for="rNote">ご要望（任意）</label>
      <textarea id="rNote" rows="2" placeholder="アレルギー・お祝い・お席の希望など"></textarea>
      <button id="submitBtn">この内容で予約する</button>
      <div class="msg" id="submitMsg"></div>
    </div>

    <div class="card">
      <h2>ご予約一覧</h2>
      <div id="resList"></div>
      <p class="muted" id="noRes">今後のご予約はありません</p>
    </div>

    <div class="card">
      <button id="backBtn" class="ghost">会員証にもどる</button>
    </div>
  </div>
</div>

<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
const LIFF_ID = ${escapeJs(liffId)};
let TOKEN = null;

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

async function loadList() {
  const res = await api('/reservations');
  const list = document.getElementById('resList');
  list.innerHTML = '';
  const items = res.success ? res.data : [];
  document.getElementById('noRes').style.display = items.length ? 'none' : 'block';
  for (const r of items) {
    const div = document.createElement('div');
    div.className = 'res-item';
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'この予約をキャンセルする';
    cancel.addEventListener('click', async () => {
      if (!confirm(r.reservedAt + ' の予約をキャンセルしますか？')) return;
      const del = await api('/reservations/' + r.id, { method: 'DELETE' });
      if (!del.success) alert(del.error || 'キャンセルに失敗しました');
      await loadList();
    });
    div.innerHTML = '<div class="when">' + r.reservedAt + '　' + r.partySize + '名</div>'
      + '<div class="muted">' + r.name + ' 様' + (r.note ? '｜' + r.note : '') + '</div>';
    div.appendChild(cancel);
    list.appendChild(div);
  }
}

document.getElementById('submitBtn').addEventListener('click', async () => {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  try {
    const res = await api('/reservations', {
      method: 'POST',
      body: JSON.stringify({
        date: document.getElementById('rDate').value,
        time: document.getElementById('rTime').value,
        partySize: Number(document.getElementById('rParty').value),
        name: document.getElementById('rName').value,
        phone: document.getElementById('rPhone').value,
        note: document.getElementById('rNote').value,
      }),
    });
    if (res.success) {
      showMsg('submitMsg', true, '✅ ' + res.data.reservedAt + '・' + res.data.partySize + '名で予約しました。LINEに確認メッセージをお送りします。');
      await loadList();
    } else {
      showMsg('submitMsg', false, res.error || '予約に失敗しました');
    }
  } finally { btn.disabled = false; }
});

document.getElementById('backBtn').addEventListener('click', () => { location.href = '/liff/card'; });

(function initForm() {
  const d = document.getElementById('rDate');
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  d.min = today; d.value = today;
  const t = document.getElementById('rTime');
  for (let h = 11; h <= 21; h++) for (const m of ['00', '30']) {
    const v = String(h).padStart(2, '0') + ':' + m;
    t.add(new Option(v, v));
  }
  t.value = '18:00';
  const p = document.getElementById('rParty');
  for (let i = 1; i <= 20; i++) p.add(new Option(i + '名', String(i)));
  p.value = '2';
})();

liff.init({ liffId: LIFF_ID }).then(() => {
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
  TOKEN = liff.getAccessToken();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('main').classList.remove('hidden');
  loadList();
}).catch((e) => {
  document.getElementById('loading').textContent = 'LIFFの初期化に失敗しました: ' + e.message;
});
</script>
</body>
</html>`
}
