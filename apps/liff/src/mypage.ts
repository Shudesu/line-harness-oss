/**
 * LIFF My Page — マイページ（応募履歴・報酬・プロフィール）
 *
 * ?page=mypage でアクセス。LIFF認証後に表示。
 */

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';
const LIFF_ID = import.meta.env?.VITE_LIFF_ID || '';

function renderBottomNav(active: 'jobs' | 'mypage'): string {
  const jobsUrl = `https://liff.line.me/${LIFF_ID}?page=jobs`;
  const mypageUrl = `https://liff.line.me/${LIFF_ID}?page=mypage`;
  return `
    <nav class="bottom-nav">
      <a href="${jobsUrl}" class="bottom-nav-item ${active === 'jobs' ? 'active' : ''}">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span>お仕事を探す</span>
      </a>
      <a href="${mypageUrl}" class="bottom-nav-item ${active === 'mypage' ? 'active' : ''}">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>マイページ</span>
      </a>
    </nav>
  `;
}

interface BookingRecord {
  id: string;
  status: string;
  approval_status: string | null;
  created_at: string;
  start_at: string;
  end_at: string;
  job_id: string | null;
  nursery_name: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
  address: string | null;
}

interface ProfileData {
  real_name: string | null;
  real_name_kana: string | null;
  phone: string | null;
  qualification_type: string | null;
}

interface MypageState {
  friendId: string | null;
  displayName: string;
  pictureUrl: string | null;
  active: BookingRecord[];
  past: BookingRecord[];
  totalEarnings: number;
  totalBookings: number;
  profile: ProfileData | null;
  loading: boolean;
  activeTab: 'active' | 'past' | 'profile';
}

const state: MypageState = {
  friendId: null,
  displayName: '',
  pictureUrl: null,
  active: [],
  past: [],
  totalEarnings: 0,
  totalBookings: 0,
  profile: null,
  loading: true,
  activeTab: 'active',
};

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

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
}

function formatTime(t: string): string {
  return t.slice(0, 5);
}

function approvalBadge(status: string | null): string {
  switch (status) {
    case 'approved': return '<span class="badge badge-approved">承認済み</span>';
    case 'pending': return '<span class="badge badge-pending">確認中</span>';
    case 'denied': return '<span class="badge badge-denied">不採用</span>';
    default: return '';
  }
}

function renderBookingCard(b: BookingRecord): string {
  const date = b.work_date ? formatDate(b.work_date) : '';
  const time = b.start_time && b.end_time ? `${formatTime(b.start_time)}〜${formatTime(b.end_time)}` : '';
  const rate = b.hourly_rate ? `¥${b.hourly_rate.toLocaleString()}/h` : '';

  // 勤務時間・報酬計算
  let earnStr = '';
  if (b.hourly_rate && b.start_time && b.end_time && b.approval_status === 'approved') {
    const [sh, sm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    const hours = (eh * 60 + em - sh * 60 - sm) / 60;
    earnStr = `<div class="booking-earn">¥${Math.round(hours * b.hourly_rate).toLocaleString()}</div>`;
  }

  return `
    <div class="booking-card">
      <div class="booking-header">
        <div class="booking-nursery">${escapeHtml(b.nursery_name || '未定')}</div>
        ${approvalBadge(b.approval_status)}
      </div>
      <div class="booking-details">
        <div>📅 ${date}</div>
        <div>⏰ ${time}</div>
        ${rate ? `<div>💰 ${rate}</div>` : ''}
      </div>
      ${earnStr}
    </div>
  `;
}

function render(): void {
  const app = document.getElementById('app')!;

  if (state.loading) {
    app.innerHTML = `
      <div class="mypage-container">
        <div class="loading">読み込み中...</div>
      </div>
    `;
    return;
  }

  const qualLabel: Record<string, string> = {
    hoikushi: '保育士',
    kangoshi: '看護師',
    kosodate_shienin: '子育て支援員',
    mukaku: '無資格',
  };

  const profileSection = state.profile ? `
    <div class="profile-info">
      <div class="profile-row"><span class="label">氏名</span><span>${escapeHtml(state.profile.real_name || '未登録')}</span></div>
      <div class="profile-row"><span class="label">フリガナ</span><span>${escapeHtml(state.profile.real_name_kana || '未登録')}</span></div>
      <div class="profile-row"><span class="label">電話番号</span><span>${escapeHtml(state.profile.phone || '未登録')}</span></div>
      <div class="profile-row"><span class="label">資格</span><span>${qualLabel[state.profile.qualification_type || ''] || state.profile.qualification_type || '未登録'}</span></div>
    </div>
    <a href="https://liff.line.me/${LIFF_ID}?page=jobs&view=profile" class="btn-edit-profile">プロフィールを編集</a>
  ` : `
    <div class="profile-info">
      <p>プロフィールが未登録です。お仕事に応募する際に登録できます。</p>
    </div>
    <a href="https://liff.line.me/${LIFF_ID}?page=jobs&view=profile" class="btn-edit-profile">プロフィールを登録する</a>
  `;

  app.innerHTML = `
    <div class="mypage-container" style="padding-bottom:70px;">
      <div class="mypage-header">
        <div class="mypage-avatar">
          ${state.pictureUrl ? `<img src="${state.pictureUrl}" alt="" />` : '<div class="avatar-placeholder">👤</div>'}
        </div>
        <div class="mypage-name">${escapeHtml(state.displayName)}</div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${state.active.length}</div>
          <div class="stat-label">予定のお仕事</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${state.past.length}</div>
          <div class="stat-label">過去のお仕事</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">¥${state.totalEarnings.toLocaleString()}</div>
          <div class="stat-label">累計報酬</div>
        </div>
      </div>

      <div class="tab-bar">
        <button class="tab ${state.activeTab === 'active' ? 'active' : ''}" data-tab="active">予定 (${state.active.length})</button>
        <button class="tab ${state.activeTab === 'past' ? 'active' : ''}" data-tab="past">履歴 (${state.past.length})</button>
        <button class="tab ${state.activeTab === 'profile' ? 'active' : ''}" data-tab="profile">プロフィール</button>
      </div>

      <div class="tab-content">
        ${state.activeTab === 'active' ? (
          state.active.length > 0
            ? state.active.map(renderBookingCard).join('')
            : '<div class="empty-state">予定のお仕事はありません<br><a href="https://liff.line.me/' + LIFF_ID + '?page=jobs">お仕事を探す</a></div>'
        ) : ''}
        ${state.activeTab === 'past' ? (
          state.past.length > 0
            ? state.past.map(renderBookingCard).join('')
            : '<div class="empty-state">まだ勤務履歴がありません</div>'
        ) : ''}
        ${state.activeTab === 'profile' ? profileSection : ''}
      </div>
    </div>
    ${renderBottomNav('mypage')}
  `;

  // タブ切替イベント
  app.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = (btn as HTMLElement).dataset.tab as MypageState['activeTab'];
      render();
    });
  });
}

export async function initMypage(): Promise<void> {
  // スタイル注入
  injectStyles();

  const profile = await liff.getProfile();
  state.displayName = profile.displayName;
  state.pictureUrl = profile.pictureUrl || null;

  // friendId取得
  try { state.friendId = localStorage.getItem('lh_friend_id'); } catch { /* silent */ }

  if (!state.friendId && profile.userId) {
    const profRes = await apiCall('/api/liff/profile', {
      method: 'POST',
      body: JSON.stringify({ lineUserId: profile.userId }),
    }).catch(() => null);
    if (profRes?.ok) {
      const profData = await profRes.json() as { success: boolean; data?: { id?: string } };
      if (profData?.data?.id) {
        state.friendId = profData.data.id;
        try { localStorage.setItem('lh_friend_id', profData.data.id); } catch { /* silent */ }
      }
    }
  }

  if (!state.friendId) {
    state.loading = false;
    render();
    return;
  }

  // マイページデータ＆プロフィールを並列取得
  const [mypageRes, profileRes] = await Promise.all([
    apiCall(`/api/liff/mypage/${state.friendId}`).catch(() => null),
    apiCall(`/api/profiles/${state.friendId}`).catch(() => null),
  ]);

  if (mypageRes?.ok) {
    const data = await mypageRes.json() as {
      success: boolean;
      data: { active: BookingRecord[]; past: BookingRecord[]; totalEarnings: number; totalBookings: number };
    };
    if (data.success) {
      state.active = data.data.active;
      state.past = data.data.past;
      state.totalEarnings = data.data.totalEarnings;
      state.totalBookings = data.data.totalBookings;
    }
  }

  if (profileRes?.ok) {
    const data = await profileRes.json() as { success: boolean; data?: ProfileData };
    if (data.success && data.data) {
      state.profile = data.data;
    }
  }

  state.loading = false;
  render();
}

function injectStyles(): void {
  if (document.getElementById('mypage-styles')) return;
  const style = document.createElement('style');
  style.id = 'mypage-styles';
  style.textContent = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif; background: #f5f5f5; color: #333; }

    .mypage-container { max-width: 480px; margin: 0 auto; padding: 16px; }
    .loading { text-align: center; padding: 60px 0; color: #888; }

    .mypage-header { text-align: center; padding: 20px 0 16px; }
    .mypage-avatar img { width: 64px; height: 64px; border-radius: 50%; }
    .avatar-placeholder { width: 64px; height: 64px; border-radius: 50%; background: #e0e0e0; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto; }
    .mypage-name { font-size: 18px; font-weight: 600; margin-top: 8px; }

    .stats-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .stat-card { flex: 1; background: #fff; border-radius: 12px; padding: 12px 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stat-value { font-size: 18px; font-weight: 700; color: #f06292; }
    .stat-label { font-size: 11px; color: #888; margin-top: 4px; }

    .tab-bar { display: flex; background: #fff; border-radius: 12px; overflow: hidden; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .tab { flex: 1; padding: 10px 0; border: none; background: transparent; font-size: 13px; font-weight: 500; color: #888; cursor: pointer; transition: all 0.2s; }
    .tab.active { color: #f06292; border-bottom: 2px solid #f06292; font-weight: 600; }

    .tab-content { min-height: 200px; }

    .booking-card { background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .booking-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .booking-nursery { font-size: 15px; font-weight: 600; }
    .booking-details { display: flex; gap: 12px; font-size: 13px; color: #666; flex-wrap: wrap; }
    .booking-earn { margin-top: 8px; font-size: 16px; font-weight: 700; color: #f06292; text-align: right; }

    .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
    .badge-approved { background: #e8f5e9; color: #2e7d32; }
    .badge-pending { background: #fff3e0; color: #e65100; }
    .badge-denied { background: #fce4ec; color: #c62828; }

    .profile-info { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .profile-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .profile-row:last-child { border-bottom: none; }
    .profile-row .label { color: #888; }

    .btn-edit-profile { display: block; text-align: center; margin-top: 12px; padding: 12px; background: #f06292; color: #fff; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; }

    .empty-state { text-align: center; padding: 40px 0; color: #888; font-size: 14px; line-height: 2; }
    .empty-state a { color: #f06292; text-decoration: none; font-weight: 600; }
  `;
  document.head.appendChild(style);
}
