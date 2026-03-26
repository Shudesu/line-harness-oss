/**
 * LIFF チェックイン/チェックアウトページ
 *
 * QRコードスキャン → LIFF URL(?page=checkin&token=xxx) → このページ
 * friendId を自動取得して、チェックイン/チェックアウトを実行
 */

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  closeWindow(): void;
  isInClient(): boolean;
};

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const idToken = liff.getIDToken();
    if (idToken) headers['X-LIFF-Token'] = idToken;
  } catch { /* LIFF not initialized */ }
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
}

export async function initCheckin(): Promise<void> {
  const container = document.getElementById('app')!;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    container.innerHTML = renderError('QRコードが無効です。もう一度スキャンしてください。');
    return;
  }

  container.innerHTML = renderLoading();

  try {
    // LINE プロフィールから friendId を取得
    const profile = await liff.getProfile();
    const profileRes = await apiCall('/api/liff/profile', {
      method: 'POST',
      body: JSON.stringify({ lineUserId: profile.userId }),
    });

    if (!profileRes.ok) {
      container.innerHTML = renderError('プロフィールの取得に失敗しました。先にお仕事に応募してください。');
      return;
    }

    const profileData = await profileRes.json() as { data?: { id?: string } };
    const friendId = profileData?.data?.id;

    if (!friendId) {
      container.innerHTML = renderError('アカウント情報が見つかりません。LINEで友だち追加してください。');
      return;
    }

    // 勤怠ステータスを確認
    const statusRes = await apiCall(`/api/attendance/status?token=${token}&friendId=${friendId}`);
    if (!statusRes.ok) {
      const err = await statusRes.json() as { error?: string };
      container.innerHTML = renderError(err?.error || 'QRコードが無効です。');
      return;
    }

    const statusData = await statusRes.json() as {
      data: {
        jobId: string;
        nurseryName: string;
        workDate: string;
        startTime: string;
        endTime: string;
        booking: {
          bookingId: string;
          approvalStatus: string;
          checkInAt: string | null;
          checkOutAt: string | null;
          actualHours: number | null;
        } | null;
      };
    };

    const { nurseryName, workDate, startTime, endTime, booking } = statusData.data;
    const dateStr = formatDate(workDate);

    // 予約なし
    if (!booking) {
      container.innerHTML = renderNoBooking(nurseryName, dateStr, startTime, endTime);
      return;
    }

    // 未承認
    if (booking.approvalStatus !== 'approved') {
      container.innerHTML = renderNotApproved(nurseryName, dateStr);
      return;
    }

    // チェックアウト済み
    if (booking.checkOutAt) {
      container.innerHTML = renderCompleted(nurseryName, dateStr, booking.checkInAt!, booking.checkOutAt, booking.actualHours!);
      return;
    }

    // チェックイン済み → チェックアウトボタン表示
    if (booking.checkInAt) {
      container.innerHTML = renderCheckoutReady(nurseryName, dateStr, startTime, endTime, booking.checkInAt, profile.displayName);
      setupCheckoutButton(token, friendId, nurseryName);
      return;
    }

    // 未チェックイン → チェックインボタン表示
    container.innerHTML = renderCheckinReady(nurseryName, dateStr, startTime, endTime, profile.displayName);
    setupCheckinButton(token, friendId, nurseryName);
  } catch (err) {
    console.error('Checkin init error:', err);
    container.innerHTML = renderError('エラーが発生しました。もう一度お試しください。');
  }
}

// --- ボタンハンドラ ---

function setupCheckinButton(token: string, friendId: string, nurseryName: string): void {
  const btn = document.getElementById('checkin-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.textContent = '処理中...';
    (btn as HTMLButtonElement).disabled = true;

    try {
      const res = await apiCall('/api/attendance/checkin', {
        method: 'POST',
        body: JSON.stringify({ token, friendId }),
      });

      const data = await res.json() as { success: boolean; data?: { checkInAt: string }; error?: string };

      if (data.success) {
        const container = document.getElementById('app')!;
        container.innerHTML = renderCheckinSuccess(nurseryName, data.data!.checkInAt);
      } else {
        btn.textContent = data.error || 'エラーが発生しました';
        setTimeout(() => {
          btn.textContent = '出勤する';
          (btn as HTMLButtonElement).disabled = false;
        }, 2000);
      }
    } catch {
      btn.textContent = '通信エラー';
      setTimeout(() => {
        btn.textContent = '出勤する';
        (btn as HTMLButtonElement).disabled = false;
      }, 2000);
    }
  });
}

function setupCheckoutButton(token: string, friendId: string, nurseryName: string): void {
  const btn = document.getElementById('checkout-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.textContent = '処理中...';
    (btn as HTMLButtonElement).disabled = true;

    try {
      const res = await apiCall('/api/attendance/checkout', {
        method: 'POST',
        body: JSON.stringify({ token, friendId }),
      });

      const data = await res.json() as {
        success: boolean;
        data?: { checkInAt: string; checkOutAt: string; actualHours: number };
        error?: string;
      };

      if (data.success) {
        const container = document.getElementById('app')!;
        container.innerHTML = renderCheckoutSuccess(nurseryName, data.data!.checkInAt, data.data!.checkOutAt, data.data!.actualHours);
      } else {
        btn.textContent = data.error || 'エラーが発生しました';
        setTimeout(() => {
          btn.textContent = '退勤する';
          (btn as HTMLButtonElement).disabled = false;
        }, 2000);
      }
    } catch {
      btn.textContent = '通信エラー';
      setTimeout(() => {
        btn.textContent = '退勤する';
        (btn as HTMLButtonElement).disabled = false;
      }, 2000);
    }
  });
}

// --- レンダリング ---

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function baseStyle(): string {
  return `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; }
      .container { max-width: 420px; margin: 0 auto; padding: 24px 16px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .card { background: #fff; border-radius: 16px; padding: 32px 24px; width: 100%; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
      .icon { font-size: 48px; margin-bottom: 16px; }
      .title { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
      .subtitle { font-size: 14px; color: #666; margin-bottom: 24px; }
      .info { background: #f8f9fa; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left; }
      .info-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; color: #333; }
      .info-row:last-child { margin-bottom: 0; }
      .info-label { color: #888; min-width: 20px; text-align: center; }
      .btn-checkin {
        display: block; width: 100%; padding: 18px; border: none; border-radius: 50px;
        font-size: 18px; font-weight: 700; color: #fff; background: #06C755;
        cursor: pointer; transition: opacity 0.15s;
      }
      .btn-checkin:active { opacity: 0.85; }
      .btn-checkin:disabled { background: #ccc; cursor: not-allowed; }
      .btn-checkout {
        display: block; width: 100%; padding: 18px; border: none; border-radius: 50px;
        font-size: 18px; font-weight: 700; color: #fff; background: #f06292;
        cursor: pointer; transition: opacity 0.15s;
      }
      .btn-checkout:active { opacity: 0.85; }
      .btn-checkout:disabled { background: #ccc; cursor: not-allowed; }
      .success-icon { font-size: 64px; margin-bottom: 16px; }
      .time-display { font-size: 32px; font-weight: 800; color: #06C755; margin: 12px 0; }
      .hours-display { font-size: 24px; font-weight: 700; color: #f06292; margin: 8px 0; }
      .close-note { font-size: 12px; color: #999; margin-top: 16px; }
      .name-badge { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
      .error { color: #d32f2f; }
    </style>
  `;
}

function renderLoading(): string {
  return `${baseStyle()}<div class="container"><div class="card"><div class="icon">⏳</div><p class="title">読み込み中...</p></div></div>`;
}

function renderError(message: string): string {
  return `${baseStyle()}<div class="container"><div class="card"><div class="icon">⚠️</div><p class="title error">${message}</p></div></div>`;
}

function renderNoBooking(nursery: string, date: string, start: string, end: string): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="icon">❌</div>
    <p class="title">予約が見つかりません</p>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
      <div class="info-row"><span class="info-label">📅</span>${date} ${start}〜${end}</div>
    </div>
    <p class="subtitle">このお仕事への応募が確認できませんでした。<br>先にお仕事に応募してください。</p>
  </div></div>`;
}

function renderNotApproved(nursery: string, date: string): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="icon">⏳</div>
    <p class="title">承認待ちです</p>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
      <div class="info-row"><span class="info-label">📅</span>${date}</div>
    </div>
    <p class="subtitle">応募がまだ承認されていません。<br>承認後にチェックインできます。</p>
  </div></div>`;
}

function renderCheckinReady(nursery: string, date: string, start: string, end: string, name: string): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="icon">👋</div>
    <p class="title">おはようございます！</p>
    <div class="name-badge">${name} さん</div>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
      <div class="info-row"><span class="info-label">📅</span>${date}</div>
      <div class="info-row"><span class="info-label">⏰</span>${start}〜${end}</div>
    </div>
    <button class="btn-checkin" id="checkin-btn">出勤する</button>
  </div></div>`;
}

function renderCheckinSuccess(nursery: string, checkInAt: string): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="success-icon">✅</div>
    <p class="title">出勤しました！</p>
    <div class="time-display">${formatTime(checkInAt)}</div>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
    </div>
    <p class="subtitle">本日もよろしくお願いします！<br>退勤時にもう一度QRコードをスキャンしてください。</p>
    <p class="close-note">この画面は閉じて大丈夫です</p>
  </div></div>`;
}

function renderCheckoutReady(nursery: string, date: string, start: string, end: string, checkInAt: string, name: string): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="icon">🏠</div>
    <p class="title">おつかれさまでした！</p>
    <div class="name-badge">${name} さん</div>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
      <div class="info-row"><span class="info-label">📅</span>${date} ${start}〜${end}</div>
      <div class="info-row"><span class="info-label">🕐</span>出勤: ${formatTime(checkInAt)}</div>
    </div>
    <button class="btn-checkout" id="checkout-btn">退勤する</button>
  </div></div>`;
}

function renderCheckoutSuccess(nursery: string, checkInAt: string, checkOutAt: string, actualHours: number): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="success-icon">🎉</div>
    <p class="title">退勤しました！</p>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
      <div class="info-row"><span class="info-label">🕐</span>出勤: ${formatTime(checkInAt)}</div>
      <div class="info-row"><span class="info-label">🕐</span>退勤: ${formatTime(checkOutAt)}</div>
    </div>
    <div class="hours-display">${actualHours.toFixed(1)} 時間</div>
    <p class="subtitle">本日もおつかれさまでした！</p>
    <p class="close-note">この画面は閉じて大丈夫です</p>
  </div></div>`;
}

function renderCompleted(nursery: string, date: string, checkInAt: string, checkOutAt: string, actualHours: number): string {
  return `${baseStyle()}<div class="container"><div class="card">
    <div class="icon">✅</div>
    <p class="title">勤務完了</p>
    <div class="info">
      <div class="info-row"><span class="info-label">🏫</span>${nursery}</div>
      <div class="info-row"><span class="info-label">📅</span>${date}</div>
      <div class="info-row"><span class="info-label">🕐</span>出勤: ${formatTime(checkInAt)}</div>
      <div class="info-row"><span class="info-label">🕐</span>退勤: ${formatTime(checkOutAt)}</div>
    </div>
    <div class="hours-display">${actualHours.toFixed(1)} 時間</div>
    <p class="close-note">この画面は閉じて大丈夫です</p>
  </div></div>`;
}
