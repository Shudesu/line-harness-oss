import { BASE_CSS, escapeHtml, escapeJs } from './shared.js'

export function cardPage(liffId: string, storeName: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(storeName)} 会員証</title>
<style>${BASE_CSS}
  .member-card { background: linear-gradient(135deg, #1c1917, #44403c); color: #fff;
    border-radius: 16px; padding: 22px; margin-top: 14px; }
  .member-card .store { font-size: 13px; opacity: .8; }
  .member-card .no { font-size: 26px; font-weight: 800; letter-spacing: 2px; margin-top: 4px; }
  .member-card .name { font-size: 14px; margin-top: 8px; opacity: .9; }
  .stamps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 12px; }
  .stamp { aspect-ratio: 1; border-radius: 50%; border: 2px dashed var(--line);
    display: flex; align-items: center; justify-content: center; font-size: 22px; color: #d6d3d1; }
  .stamp.filled { border: 2px solid var(--brand); background: #fff7ed; color: var(--brand); }
  .reward-item { border: 1.5px dashed var(--brand); border-radius: 10px; padding: 12px; margin-top: 10px; background: #fff7ed; }
  .reward-item .code { font-size: 20px; font-weight: 800; letter-spacing: 2px; color: var(--brand-dark); }
</style>
</head>
<body>
<div class="header"><h1>${escapeHtml(storeName)}</h1></div>
<div class="wrap">
  <div id="loading" class="muted" style="text-align:center;padding:30px">読み込み中…</div>

  <div id="main" class="hidden">
    <div class="member-card">
      <div class="store">${escapeHtml(storeName)} デジタル会員証</div>
      <div class="no" id="memberNo"></div>
      <div class="name" id="memberName"></div>
    </div>

    <div class="card">
      <h2>スタンプカード <span class="muted" id="stampLabel"></span></h2>
      <div class="stamps" id="stamps"></div>
      <p class="muted" style="margin-top:10px">ご来店 <span id="totalVisits"></span> 回目までありがとうございます</p>
      <label for="visitCode">本日の来店コード（店内掲示の4桁）</label>
      <input id="visitCode" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="例: AB3K">
      <button id="stampBtn">スタンプをもらう</button>
      <div class="msg" id="stampMsg"></div>
    </div>

    <div class="card" id="rewardsCard">
      <h2>ご利用可能な特典</h2>
      <div id="rewards"></div>
      <p class="muted" id="noRewards">まだ特典はありません。スタンプを集めるともらえます！</p>
    </div>

    <div class="card" id="birthdayCard">
      <h2>お誕生日登録</h2>
      <p class="muted">登録すると、お誕生日に特典が届きます🎂</p>
      <div class="row">
        <select id="bMonth"></select>
        <select id="bDay"></select>
      </div>
      <button id="birthdayBtn" class="ghost">誕生日を登録する</button>
      <div class="msg" id="birthdayMsg"></div>
    </div>

    <div class="card">
      <h2>ご予約・テイクアウト</h2>
      <div class="row">
        <button id="reserveBtn" class="ghost">お席の予約</button>
        <button id="takeoutBtn" class="ghost">テイクアウト</button>
      </div>
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

function render(d) {
  document.getElementById('memberNo').textContent = d.memberNo;
  document.getElementById('memberName').textContent = (d.displayName || '') + ' 様';
  document.getElementById('totalVisits').textContent = d.totalVisits + 1;
  document.getElementById('stampLabel').textContent = d.stampCount + ' / ' + d.stampGoal + '個で「' + d.rewardName + '」';
  const stamps = document.getElementById('stamps');
  stamps.innerHTML = '';
  for (let i = 0; i < d.stampGoal; i++) {
    const s = document.createElement('div');
    s.className = 'stamp' + (i < d.stampCount ? ' filled' : '');
    s.textContent = i < d.stampCount ? '🍽' : (i + 1);
    stamps.appendChild(s);
  }
  const rewards = document.getElementById('rewards');
  rewards.innerHTML = '';
  document.getElementById('noRewards').style.display = d.rewards.length ? 'none' : 'block';
  for (const r of d.rewards) {
    const div = document.createElement('div');
    div.className = 'reward-item';
    div.innerHTML = '<div>' + r.name + '</div><div class="code">' + r.code + '</div>'
      + (r.expiresAt ? '<div class="muted">有効期限: ' + r.expiresAt + '</div>' : '');
    rewards.appendChild(div);
  }
  if (d.birthday) document.getElementById('birthdayCard').classList.add('hidden');
}

async function refresh() {
  const res = await api('/me', { method: 'POST' });
  if (res.success) {
    render(res.data);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('main').classList.remove('hidden');
  } else {
    document.getElementById('loading').textContent = '読み込みに失敗しました: ' + (res.error || '');
  }
}

// 来店QR経由（?code=XXXX）ならスキャンだけで自動スタンプ
function getUrlCode() {
  const sp = new URLSearchParams(location.search);
  if (sp.get('code')) return sp.get('code');
  const st = sp.get('liff.state'); // LIFF初回リダイレクトはクエリがliff.stateに入る
  if (st) {
    try { return new URLSearchParams(st.replace(/^[^?]*\??/, '')).get('code'); } catch (e) {}
  }
  return null;
}

async function autoStampFromQr() {
  const code = getUrlCode();
  if (!code || sessionStorage.getItem('qr_stamp_done')) return;
  sessionStorage.setItem('qr_stamp_done', '1'); // リロードでの二重送信ガード（サーバー側にも1日1回制限あり）
  const res = await api('/stamp', { method: 'POST', body: JSON.stringify({ code } ) });
  if (res.success) {
    showMsg('stampMsg', true, res.data.rewardEarned
      ? '🎉 ご来店ありがとうございます！スタンプ満了で特典コード ' + res.data.rewardCode + ' を獲得しました'
      : '🎉 ご来店ありがとうございます！スタンプを押しました（' + res.data.stampCount + ' / ' + res.data.stampGoal + '）');
    await refresh();
  } else if (res.reason !== 'already_today') {
    showMsg('stampMsg', false, res.error || 'スタンプを押せませんでした');
  }
}

document.getElementById('stampBtn').addEventListener('click', async () => {
  const btn = document.getElementById('stampBtn');
  btn.disabled = true;
  try {
    const code = document.getElementById('visitCode').value;
    const res = await api('/stamp', { method: 'POST', body: JSON.stringify({ code }) });
    if (res.success) {
      showMsg('stampMsg', true, res.data.rewardEarned
        ? '🎉 スタンプ満了！特典コード ' + res.data.rewardCode + ' を獲得しました'
        : 'スタンプを押しました！（' + res.data.stampCount + ' / ' + res.data.stampGoal + '）');
      document.getElementById('visitCode').value = '';
      await refresh();
    } else {
      showMsg('stampMsg', false, res.error || 'エラーが発生しました');
    }
  } finally { btn.disabled = false; }
});

document.getElementById('birthdayBtn').addEventListener('click', async () => {
  const mm = document.getElementById('bMonth').value, dd = document.getElementById('bDay').value;
  const res = await api('/profile', { method: 'POST', body: JSON.stringify({ birthday: mm + '-' + dd }) });
  if (res.success) { showMsg('birthdayMsg', true, '登録しました！お誕生日をお楽しみに🎂'); }
  else { showMsg('birthdayMsg', false, res.error || 'エラーが発生しました'); }
});

document.getElementById('reserveBtn').addEventListener('click', () => { location.href = '/liff/reserve'; });
document.getElementById('takeoutBtn').addEventListener('click', () => { location.href = '/liff/takeout'; });

(function initSelects() {
  const m = document.getElementById('bMonth'), d = document.getElementById('bDay');
  for (let i = 1; i <= 12; i++) m.add(new Option(i + '月', String(i).padStart(2, '0')));
  for (let i = 1; i <= 31; i++) d.add(new Option(i + '日', String(i).padStart(2, '0')));
})();

liff.init({ liffId: LIFF_ID }).then(async () => {
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
  TOKEN = liff.getAccessToken();
  await refresh();
  await autoStampFromQr();
}).catch((e) => {
  document.getElementById('loading').textContent = 'LIFFの初期化に失敗しました: ' + e.message;
});
</script>
</body>
</html>`
}
