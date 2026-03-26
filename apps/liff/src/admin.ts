/**
 * LIFF Admin Dashboard — 簡易管理画面
 *
 * ?page=admin でアクセス。APIキーで認証。
 * - 今日の応募一覧
 * - 求人ごとの残枠
 * - 応募者プロフィール
 * - 友だち数サマリ
 */

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';
const API_KEY_STORAGE = 'lh_admin_key';

interface AdminState {
  authenticated: boolean;
  apiKey: string;
  loading: boolean;
  activeTab: 'overview' | 'jobs' | 'bookings' | 'friends' | 'approvals' | 'documents';
  stats: {
    totalFriends: number;
    openJobs: number;
    todayBookings: number;
    filledJobs: number;
    pendingApprovals: number;
  };
  jobs: AdminJob[];
  bookings: AdminBooking[];
  friends: AdminFriend[];
  pendingBookings: PendingBooking[];
  documents: AdminDocument[];
  selectedBooking: AdminBooking | null;
  bookingProfile: BookingProfile | null;
}

interface AdminJob {
  id: string;
  nurseryName: string;
  address: string | null;
  workDate: string;
  startTime: string;
  endTime: string;
  hourlyRate: number | null;
  capacity: number;
  remainingSlots: number;
  status: string;
  createdAt: string;
}

interface AdminBooking {
  id: string;
  connectionId: string | null;
  friendId: string | null;
  eventId: string | null;
  title: string | null;
  startAt: string;
  endAt: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  // joined
  jobId?: string;
  nurseryName?: string;
  displayName?: string;
}

interface AdminFriend {
  id: string;
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
  isFollowing: boolean;
  createdAt: string;
  tags: { id: string; name: string }[];
}

interface BookingProfile {
  real_name: string | null;
  real_name_kana: string | null;
  phone: string | null;
  qualification_type: string | null;
  experience_years: string | null;
  date_of_birth: string | null;
  gender: string | null;
}

interface AdminDocument {
  id: string;
  friend_id: string;
  doc_type: string;
  r2_key: string;
  file_name: string | null;
  status: string;
  created_at: string;
  display_name: string;
  real_name: string | null;
}

interface PendingBooking {
  id: string;
  friendId: string | null;
  displayName: string;
  nurseryName: string;
  workDate: string;
  startTime: string;
  endTime: string;
  hourlyRate: number | null;
  approvalStatus: string;
  createdAt: string;
  profile: {
    realName: string | null;
    realNameKana: string | null;
    phone: string | null;
    qualificationType: string | null;
    experienceYears: string | null;
  } | null;
}

const state: AdminState = {
  authenticated: false,
  apiKey: '',
  loading: false,
  activeTab: 'overview',
  stats: { totalFriends: 0, openJobs: 0, todayBookings: 0, filledJobs: 0, pendingApprovals: 0 },
  jobs: [],
  bookings: [],
  friends: [],
  pendingBookings: [],
  documents: [],
  selectedBooking: null,
  bookingProfile: null,
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.apiKey}`,
      ...options?.headers,
    },
  });
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Date Helpers ==========

function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
}

function formatTime(t: string): string {
  return t.slice(0, 5);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ========== Login ==========

function renderLogin(): void {
  getApp().innerHTML = `
    <div style="max-width:400px;margin:60px auto;padding:24px;">
      <h1 style="font-size:20px;text-align:center;margin-bottom:8px;">スポットほいく管理</h1>
      <p style="text-align:center;color:#888;font-size:13px;margin-bottom:24px;">APIキーを入力してください</p>
      <input type="password" id="apiKeyInput" placeholder="API Key"
        style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box;">
      <button id="loginBtn"
        style="width:100%;margin-top:12px;padding:12px;background:#f06292;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;">
        ログイン
      </button>
      <p id="loginError" style="color:#e53935;text-align:center;margin-top:8px;font-size:13px;display:none;">
        認証に失敗しました
      </p>
    </div>
  `;

  const input = document.getElementById('apiKeyInput') as HTMLInputElement;
  const savedKey = sessionStorage.getItem(API_KEY_STORAGE);
  if (savedKey) input.value = savedKey;

  document.getElementById('loginBtn')!.addEventListener('click', () => tryLogin());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
}

async function tryLogin(): Promise<void> {
  const input = document.getElementById('apiKeyInput') as HTMLInputElement;
  const key = input.value.trim();
  if (!key) return;

  state.apiKey = key;
  const res = await apiCall('/api/friends/count').catch(() => null);
  if (res?.ok) {
    state.authenticated = true;
    sessionStorage.setItem(API_KEY_STORAGE, key);
    await loadDashboard();
  } else {
    document.getElementById('loginError')!.style.display = 'block';
  }
}

// ========== Data Loading ==========

async function loadDashboard(): Promise<void> {
  state.loading = true;
  renderDashboard();

  const today = todayStr();

  try {
    const [friendsCountRes, jobsRes, allJobsRes, bookingsRes, pendingRes] = await Promise.all([
      apiCall('/api/friends/count'),
      apiCall(`/api/jobs?status=open&fromDate=${today}`),
      apiCall('/api/jobs?status=all'),
      apiCall('/api/integrations/google-calendar/bookings'),
      apiCall('/api/bookings/pending'),
    ]);

    if (friendsCountRes.ok) {
      const d = await friendsCountRes.json() as { success: boolean; data: { count: number } };
      state.stats.totalFriends = d.data?.count || 0;
    }

    if (jobsRes.ok) {
      const d = await jobsRes.json() as { success: boolean; data: AdminJob[] };
      state.stats.openJobs = d.data?.length || 0;
    }

    if (allJobsRes.ok) {
      const d = await allJobsRes.json() as { success: boolean; data: AdminJob[] };
      state.jobs = d.data || [];
      state.stats.filledJobs = state.jobs.filter(j => j.status === 'filled').length;
    }

    if (bookingsRes.ok) {
      const d = await bookingsRes.json() as { success: boolean; data: AdminBooking[] };
      state.bookings = d.data || [];
      // 今日の予約数
      state.stats.todayBookings = state.bookings.filter(b => b.startAt?.startsWith(today)).length;
    }

    if (pendingRes.ok) {
      const d = await pendingRes.json() as { success: boolean; data: PendingBooking[] };
      state.pendingBookings = d.data || [];
      state.stats.pendingApprovals = state.pendingBookings.length;
    }

    // Enrich bookings with job info
    const jobMap = new Map(state.jobs.map(j => [j.id, j]));
    for (const b of state.bookings) {
      const meta = b.metadata as Record<string, unknown> | null;
      const jobId = (meta?.jobId as string) || (b as unknown as Record<string, unknown>).job_id as string;
      if (jobId) {
        b.jobId = jobId;
        const job = jobMap.get(jobId);
        if (job) b.nurseryName = job.nurseryName;
      }
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }

  state.loading = false;
  renderDashboard();
}

async function loadFriends(): Promise<void> {
  if (state.friends.length > 0) return;
  const res = await apiCall('/api/friends?limit=50');
  if (res.ok) {
    const d = await res.json() as { success: boolean; data: { items: AdminFriend[] } };
    state.friends = d.data?.items || [];
  }
  renderDashboard();
}

async function loadDocuments(): Promise<void> {
  state.loading = true;
  renderDashboard();
  const res = await apiCall('/api/documents');
  if (res.ok) {
    const d = await res.json() as { success: boolean; data: AdminDocument[] };
    state.documents = d.data || [];
  }
  state.loading = false;
  renderDashboard();
}

async function handleDocumentStatus(docId: string, newStatus: 'verified' | 'rejected'): Promise<void> {
  const label = newStatus === 'verified' ? '承認' : '却下';
  if (!confirm(`この書類を${label}しますか？`)) return;
  const res = await apiCall(`/api/documents/${docId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: newStatus }),
  });
  if (res.ok) {
    await loadDocuments();
  } else {
    alert(`${label}に失敗しました`);
  }
}

async function loadBookingProfile(friendId: string): Promise<void> {
  state.bookingProfile = null;
  const res = await apiCall(`/api/profiles/${friendId}`);
  if (res.ok) {
    const d = await res.json() as { success: boolean; data: { profile: BookingProfile | null } };
    state.bookingProfile = d.data?.profile || null;
  }
  renderProfileModal();
}

// ========== Render ==========

function renderDashboard(): void {
  const app = getApp();

  app.innerHTML = `
    <div class="admin-container">
      <header class="admin-header">
        <h1>スポットほいく管理</h1>
        <button id="logoutBtn" class="admin-logout">ログアウト</button>
      </header>

      <nav class="admin-tabs">
        <button class="admin-tab ${state.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">概要</button>
        <button class="admin-tab ${state.activeTab === 'approvals' ? 'active' : ''}" data-tab="approvals">承認${state.stats.pendingApprovals > 0 ? ` (${state.stats.pendingApprovals})` : ''}</button>
        <button class="admin-tab ${state.activeTab === 'jobs' ? 'active' : ''}" data-tab="jobs">求人</button>
        <button class="admin-tab ${state.activeTab === 'bookings' ? 'active' : ''}" data-tab="bookings">応募</button>
        <button class="admin-tab ${state.activeTab === 'friends' ? 'active' : ''}" data-tab="friends">友だち</button>
        <button class="admin-tab ${state.activeTab === 'documents' ? 'active' : ''}" data-tab="documents">書類${state.documents.filter(d => d.status === 'pending').length > 0 ? ` (${state.documents.filter(d => d.status === 'pending').length})` : ''}</button>
      </nav>

      <main class="admin-main">
        ${state.loading ? '<div class="admin-loading">読み込み中...</div>' : renderActiveTab()}
      </main>

      <div id="profileModal" class="admin-modal" style="display:none;"></div>
    </div>
  `;

  // Tab events
  app.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = (btn as HTMLElement).dataset.tab as AdminState['activeTab'];
      if (state.activeTab === 'friends' && state.friends.length === 0) {
        loadFriends();
        return;
      }
      if (state.activeTab === 'documents' && state.documents.length === 0) {
        loadDocuments();
        return;
      }
      renderDashboard();
    });
  });

  // Logout
  app.querySelector('#logoutBtn')?.addEventListener('click', () => {
    state.authenticated = false;
    state.apiKey = '';
    localStorage.removeItem(API_KEY_STORAGE);
    renderLogin();
  });

  // Booking detail click
  app.querySelectorAll('[data-booking-friend]').forEach(el => {
    el.addEventListener('click', () => {
      const friendId = (el as HTMLElement).dataset.bookingFriend!;
      const bookingId = (el as HTMLElement).dataset.bookingId!;
      state.selectedBooking = state.bookings.find(b => b.id === bookingId) || null;
      loadBookingProfile(friendId);
    });
  });

  // Refresh
  app.querySelector('#refreshBtn')?.addEventListener('click', () => {
    if (state.activeTab === 'documents') {
      state.documents = [];
      loadDocuments();
    } else {
      loadDashboard();
    }
  });

  // Approval actions
  app.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bookingId = (btn as HTMLElement).dataset.approve!;
      handleApprove(bookingId);
    });
  });
  app.querySelectorAll('[data-deny]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bookingId = (btn as HTMLElement).dataset.deny!;
      handleDeny(bookingId);
    });
  });

  // Document actions
  app.querySelectorAll('[data-doc-verify]').forEach(btn => {
    btn.addEventListener('click', () => {
      handleDocumentStatus((btn as HTMLElement).dataset.docVerify!, 'verified');
    });
  });
  app.querySelectorAll('[data-doc-reject]').forEach(btn => {
    btn.addEventListener('click', () => {
      handleDocumentStatus((btn as HTMLElement).dataset.docReject!, 'rejected');
    });
  });
  app.querySelectorAll('[data-doc-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = (btn as HTMLElement).dataset.docView!;
      const modal = document.getElementById('profileModal')!;
      modal.style.display = 'flex';
      modal.innerHTML = `
        <div class="modal-backdrop" id="closeDocModal"></div>
        <div class="modal-content">
          <h3>書類プレビュー</h3>
          <div style="text-align:center;padding:10px;">
            <img src="${API_URL}/api/documents/file/${docId}" style="max-width:100%;max-height:60vh;border-radius:8px;border:1px solid #eee;" alt="書類画像"
              onerror="this.outerHTML='<p style=\\'color:#e53935;\\'>R2が未有効化のため表示できません。<br>Cloudflare Dashboard で R2 を有効化してください。</p>'" />
          </div>
          <button id="closeDocBtn" style="width:100%;padding:10px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;margin-top:10px;">閉じる</button>
        </div>
      `;
      modal.querySelector('#closeDocModal')?.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.querySelector('#closeDocBtn')?.addEventListener('click', () => { modal.style.display = 'none'; });
    });
  });
}

function renderActiveTab(): string {
  switch (state.activeTab) {
    case 'overview': return renderOverview();
    case 'approvals': return renderApprovals();
    case 'jobs': return renderJobs();
    case 'bookings': return renderBookings();
    case 'friends': return renderFriends();
    case 'documents': return renderDocuments();
    default: return '';
  }
}

// ========== Approval Actions ==========

async function handleApprove(bookingId: string): Promise<void> {
  if (!confirm('この応募を承認しますか？承認するとLINEで通知が送信されます。')) return;
  const res = await apiCall(`/api/bookings/${bookingId}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) {
    await loadDashboard();
  } else {
    alert('承認に失敗しました');
  }
}

async function handleDeny(bookingId: string): Promise<void> {
  if (!confirm('この応募を否認しますか？否認するとLINEで通知が送信されます。')) return;
  const res = await apiCall(`/api/bookings/${bookingId}/deny`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (res.ok) {
    await loadDashboard();
  } else {
    alert('否認に失敗しました');
  }
}

// ========== Approvals Tab ==========

function renderApprovals(): string {
  const { pendingBookings } = state;

  return `
    <div class="admin-section">
      <div class="section-header">
        <h2>承認待ち (${pendingBookings.length}件)</h2>
        <button id="refreshBtn" class="refresh-btn">更新</button>
      </div>
      ${pendingBookings.length === 0
        ? '<p class="empty-text">承認待ちの応募はありません</p>'
        : pendingBookings.map(b => `
          <div class="admin-card approval-card">
            <div class="card-header">
              <span class="card-title">${escapeHtml(b.nurseryName)}</span>
              <span class="status-badge status-pending">承認待ち</span>
            </div>
            <div class="card-meta">
              ${b.workDate ? formatDate(b.workDate) + ' ' : ''}${b.startTime ? formatTime(b.startTime) + '〜' + formatTime(b.endTime) : ''}
              ${b.hourlyRate ? ` | ¥${b.hourlyRate.toLocaleString()}/h` : ''}
            </div>
            <div class="approval-applicant">
              <div class="applicant-name">${escapeHtml(b.profile?.realName || b.displayName || '名前未登録')}</div>
              ${b.profile ? `
                <div class="applicant-detail">
                  ${b.profile.qualificationType ? `<span class="tag-chip">${escapeHtml(b.profile.qualificationType)}</span>` : ''}
                  ${b.profile.experienceYears ? `<span class="tag-chip">経験${escapeHtml(b.profile.experienceYears)}</span>` : ''}
                  ${b.profile.phone ? `<span class="applicant-phone"><a href="tel:${escapeHtml(b.profile.phone)}">${escapeHtml(b.profile.phone)}</a></span>` : ''}
                </div>
              ` : '<div class="applicant-detail"><span style="color:#aaa;">プロフィール未登録</span></div>'}
            </div>
            <div class="approval-actions">
              <button class="approve-btn" data-approve="${b.id}">承認</button>
              <button class="deny-btn" data-deny="${b.id}">否認</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
}

function renderOverview(): string {
  const today = todayStr();
  const todayJobs = state.jobs.filter(j => j.workDate === today && j.status === 'open');
  const upcomingBookings = state.bookings
    .filter(b => b.startAt >= today && b.status !== 'cancelled')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 10);

  return `
    <div class="admin-stats">
      <div class="stat-card">
        <div class="stat-number">${state.stats.totalFriends}</div>
        <div class="stat-label">登録友だち</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${state.stats.openJobs}</div>
        <div class="stat-label">公開中の求人</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${state.stats.todayBookings}</div>
        <div class="stat-label">今日の応募</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${state.stats.filledJobs}</div>
        <div class="stat-label">充足済み</div>
      </div>
    </div>

    <div class="admin-section">
      <div class="section-header">
        <h2>今日の求人 (${todayJobs.length}件)</h2>
        <button id="refreshBtn" class="refresh-btn">更新</button>
      </div>
      ${todayJobs.length === 0
        ? '<p class="empty-text">今日の求人はありません</p>'
        : todayJobs.map(j => `
          <div class="admin-card">
            <div class="card-header">
              <span class="card-title">${escapeHtml(j.nurseryName)}</span>
              <span class="slot-badge ${j.remainingSlots === 0 ? 'filled' : ''}">${j.remainingSlots}/${j.capacity}枠</span>
            </div>
            <div class="card-meta">
              ${formatTime(j.startTime)}〜${formatTime(j.endTime)}
              ${j.hourlyRate ? ` | ¥${j.hourlyRate.toLocaleString()}/h` : ''}
              ${j.address ? ` | ${escapeHtml(j.address)}` : ''}
            </div>
          </div>
        `).join('')}
    </div>

    <div class="admin-section">
      <h2>直近の応募 (${upcomingBookings.length}件)</h2>
      ${upcomingBookings.length === 0
        ? '<p class="empty-text">応募はありません</p>'
        : upcomingBookings.map(b => `
          <div class="admin-card clickable" ${b.friendId ? `data-booking-friend="${b.friendId}" data-booking-id="${b.id}"` : ''}>
            <div class="card-header">
              <span class="card-title">${escapeHtml(b.nurseryName || b.title || '不明')}</span>
              <span class="status-badge status-${b.status}">${b.status}</span>
            </div>
            <div class="card-meta">
              ${formatDateTime(b.startAt)}〜${formatTime(b.endAt.split('T')[1] || '')}
              ${b.friendId ? ' | タップで詳細' : ''}
            </div>
          </div>
        `).join('')}
    </div>
  `;
}

function renderJobs(): string {
  const grouped = {
    open: state.jobs.filter(j => j.status === 'open').sort((a, b) => a.workDate.localeCompare(b.workDate)),
    filled: state.jobs.filter(j => j.status === 'filled'),
    cancelled: state.jobs.filter(j => j.status === 'cancelled'),
    completed: state.jobs.filter(j => j.status === 'completed'),
  };

  return `
    <div class="admin-section">
      <div class="section-header">
        <h2>公開中 (${grouped.open.length})</h2>
        <button id="refreshBtn" class="refresh-btn">更新</button>
      </div>
      ${grouped.open.length === 0
        ? '<p class="empty-text">公開中の求人はありません</p>'
        : grouped.open.map(j => renderJobCard(j)).join('')}
    </div>

    <div class="admin-section">
      <h2>充足済み (${grouped.filled.length})</h2>
      ${grouped.filled.map(j => renderJobCard(j)).join('')}
    </div>

    ${grouped.completed.length > 0 ? `
    <div class="admin-section">
      <h2>完了 (${grouped.completed.length})</h2>
      ${grouped.completed.map(j => renderJobCard(j)).join('')}
    </div>` : ''}

    ${grouped.cancelled.length > 0 ? `
    <div class="admin-section">
      <h2>キャンセル (${grouped.cancelled.length})</h2>
      ${grouped.cancelled.map(j => renderJobCard(j)).join('')}
    </div>` : ''}
  `;
}

function renderJobCard(j: AdminJob): string {
  return `
    <div class="admin-card">
      <div class="card-header">
        <span class="card-title">${escapeHtml(j.nurseryName)}</span>
        <span class="slot-badge ${j.remainingSlots === 0 ? 'filled' : ''}">${j.remainingSlots}/${j.capacity}枠</span>
      </div>
      <div class="card-meta">
        ${formatDate(j.workDate)} ${formatTime(j.startTime)}〜${formatTime(j.endTime)}
        ${j.hourlyRate ? ` | ¥${j.hourlyRate.toLocaleString()}/h` : ''}
      </div>
      <div class="card-meta">${j.address ? escapeHtml(j.address) : ''}</div>
    </div>
  `;
}

function renderBookings(): string {
  const sorted = [...state.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return `
    <div class="admin-section">
      <div class="section-header">
        <h2>全応募 (${sorted.length}件)</h2>
        <button id="refreshBtn" class="refresh-btn">更新</button>
      </div>
      ${sorted.length === 0
        ? '<p class="empty-text">応募はありません</p>'
        : sorted.map(b => `
          <div class="admin-card clickable" ${b.friendId ? `data-booking-friend="${b.friendId}" data-booking-id="${b.id}"` : ''}>
            <div class="card-header">
              <span class="card-title">${escapeHtml(b.nurseryName || b.title || '不明')}</span>
              <span class="status-badge status-${b.status}">${b.status}</span>
            </div>
            <div class="card-meta">
              ${formatDateTime(b.startAt)}〜${formatTime(b.endAt.split('T')[1] || '')}
            </div>
            <div class="card-meta" style="color:#888;font-size:12px;">
              応募日: ${formatDateTime(b.createdAt)}
              ${b.friendId ? ' | タップで応募者詳細' : ''}
            </div>
          </div>
        `).join('')}
    </div>
  `;
}

function renderDocuments(): string {
  const pending = state.documents.filter(d => d.status === 'pending');
  const verified = state.documents.filter(d => d.status === 'verified');
  const rejected = state.documents.filter(d => d.status === 'rejected');

  const docTypeLabel = (t: string) => t === 'id_card' ? '本人確認書類' : t === 'qualification_cert' ? '資格証' : t;
  const statusLabel = (s: string) => s === 'pending' ? '確認待ち' : s === 'verified' ? '承認済' : '却下';
  const statusClass = (s: string) => s === 'pending' ? 'status-pending' : s === 'verified' ? 'status-confirmed' : 'status-cancelled';

  const renderDocCard = (doc: AdminDocument) => `
    <div class="admin-card doc-card ${doc.status === 'pending' ? 'doc-pending' : ''}">
      <div class="card-header">
        <span class="card-title">${escapeHtml(doc.real_name || doc.display_name)}</span>
        <span class="status-badge ${statusClass(doc.status)}">${statusLabel(doc.status)}</span>
      </div>
      <div class="card-meta">
        ${docTypeLabel(doc.doc_type)} | ${doc.file_name ? escapeHtml(doc.file_name) : 'ファイル名なし'} | ${new Date(doc.created_at).toLocaleDateString('ja-JP')}
      </div>
      <div class="doc-actions">
        <button class="doc-view-btn" data-doc-view="${doc.id}">画像を確認</button>
        ${doc.status === 'pending' ? `
          <button class="approve-btn doc-action-btn" data-doc-verify="${doc.id}">承認</button>
          <button class="deny-btn doc-action-btn" data-doc-reject="${doc.id}">却下</button>
        ` : ''}
      </div>
    </div>
  `;

  return `
    <div class="admin-section">
      <div class="section-header">
        <h2>確認待ち (${pending.length}件)</h2>
        <button id="refreshBtn" class="refresh-btn">更新</button>
      </div>
      ${pending.length === 0
        ? '<p class="empty-text">確認待ちの書類はありません</p>'
        : pending.map(renderDocCard).join('')}
    </div>
    ${verified.length > 0 ? `
    <div class="admin-section">
      <h2>承認済み (${verified.length}件)</h2>
      ${verified.map(renderDocCard).join('')}
    </div>` : ''}
    ${rejected.length > 0 ? `
    <div class="admin-section">
      <h2>却下 (${rejected.length}件)</h2>
      ${rejected.map(renderDocCard).join('')}
    </div>` : ''}
  `;
}

function renderFriends(): string {
  return `
    <div class="admin-section">
      <div class="section-header">
        <h2>友だち一覧 (${state.stats.totalFriends}人)</h2>
      </div>
      ${state.friends.length === 0
        ? '<p class="empty-text">読み込み中...</p>'
        : state.friends.map(f => `
          <div class="admin-card">
            <div style="display:flex;align-items:center;gap:10px;">
              ${f.pictureUrl
                ? `<img src="${f.pictureUrl}" style="width:36px;height:36px;border-radius:50%;" alt="">`
                : '<div style="width:36px;height:36px;border-radius:50%;background:#eee;"></div>'}
              <div>
                <div class="card-title">${escapeHtml(f.displayName)}</div>
                <div class="card-meta" style="margin-top:2px;">
                  ${f.isFollowing ? 'フォロー中' : 'ブロック中'}
                  | 登録: ${formatDateTime(f.createdAt)}
                </div>
              </div>
            </div>
            ${f.tags.length > 0 ? `
              <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">
                ${f.tags.map(t => `<span class="tag-chip">${escapeHtml(t.name)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
    </div>
  `;
}

function renderProfileModal(): void {
  const modal = document.getElementById('profileModal');
  if (!modal) return;

  const b = state.selectedBooking;
  const p = state.bookingProfile;

  if (!b) { modal.style.display = 'none'; return; }

  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop"></div>
    <div class="modal-content">
      <h3>応募者詳細</h3>
      <div class="modal-section">
        <div class="modal-label">求人</div>
        <div class="modal-value">${escapeHtml(b.nurseryName || b.title || '不明')}</div>
      </div>
      <div class="modal-section">
        <div class="modal-label">日時</div>
        <div class="modal-value">${formatDateTime(b.startAt)}〜${formatTime(b.endAt.split('T')[1] || '')}</div>
      </div>
      <div class="modal-section">
        <div class="modal-label">ステータス</div>
        <div class="modal-value"><span class="status-badge status-${b.status}">${b.status}</span></div>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
      ${p ? `
        <div class="modal-section">
          <div class="modal-label">氏名</div>
          <div class="modal-value">${escapeHtml(p.real_name || '未入力')}</div>
        </div>
        ${p.real_name_kana ? `
        <div class="modal-section">
          <div class="modal-label">フリガナ</div>
          <div class="modal-value">${escapeHtml(p.real_name_kana)}</div>
        </div>` : ''}
        ${p.phone ? `
        <div class="modal-section">
          <div class="modal-label">電話番号</div>
          <div class="modal-value"><a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a></div>
        </div>` : ''}
        ${p.qualification_type ? `
        <div class="modal-section">
          <div class="modal-label">資格</div>
          <div class="modal-value">${escapeHtml(p.qualification_type)}</div>
        </div>` : ''}
      ` : '<p style="color:#888;text-align:center;">プロフィール未登録</p>'}
      <button id="closeModal" style="width:100%;margin-top:16px;padding:10px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;cursor:pointer;">閉じる</button>
    </div>
  `;

  modal.querySelector('#modalBackdrop')?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.querySelector('#closeModal')?.addEventListener('click', () => { modal.style.display = 'none'; });
}

// ========== Entry Point ==========

export async function initAdmin(): Promise<void> {
  // Inject admin styles
  const style = document.createElement('style');
  style.textContent = `
    .admin-container { max-width: 600px; margin: 0 auto; padding: 0 12px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .admin-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 8px; border-bottom: 1px solid #eee; }
    .admin-header h1 { font-size: 18px; margin: 0; color: #333; }
    .admin-logout { background: none; border: 1px solid #ddd; padding: 6px 12px; border-radius: 6px; font-size: 12px; color: #888; cursor: pointer; }
    .admin-tabs { display: flex; gap: 0; border-bottom: 2px solid #eee; margin-top: 8px; overflow-x: auto; }
    .admin-tab { flex: 1; padding: 10px 8px; border: none; background: none; font-size: 13px; color: #888; cursor: pointer; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .admin-tab.active { color: #f06292; border-bottom-color: #f06292; font-weight: 600; }
    .admin-main { padding-top: 12px; }
    .admin-loading { text-align: center; padding: 40px; color: #888; }
    .admin-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .stat-card { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px; text-align: center; }
    .stat-number { font-size: 28px; font-weight: 700; color: #333; }
    .stat-label { font-size: 12px; color: #888; margin-top: 2px; }
    .admin-section { margin-bottom: 20px; }
    .section-header { display: flex; justify-content: space-between; align-items: center; }
    .admin-section h2 { font-size: 15px; color: #333; margin: 0 0 8px; }
    .refresh-btn { background: none; border: 1px solid #ddd; padding: 4px 10px; border-radius: 6px; font-size: 12px; color: #888; cursor: pointer; }
    .admin-card { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 12px; margin-bottom: 8px; }
    .admin-card.clickable { cursor: pointer; }
    .admin-card.clickable:active { background: #fafafa; }
    .card-header { display: flex; justify-content: space-between; align-items: center; }
    .card-title { font-size: 14px; font-weight: 600; color: #333; }
    .card-meta { font-size: 12px; color: #666; margin-top: 4px; }
    .slot-badge { font-size: 12px; font-weight: 600; color: #4caf50; background: #e8f5e9; padding: 2px 8px; border-radius: 10px; }
    .slot-badge.filled { color: #e53935; background: #ffebee; }
    .status-badge { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 10px; }
    .status-pending { color: #ff9800; background: #fff3e0; }
    .status-confirmed { color: #4caf50; background: #e8f5e9; }
    .status-cancelled { color: #e53935; background: #ffebee; }
    .tag-chip { font-size: 11px; background: #f3e5f5; color: #7b1fa2; padding: 2px 8px; border-radius: 10px; }
    .empty-text { color: #aaa; font-size: 13px; text-align: center; padding: 20px 0; }
    .admin-modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 100; align-items: center; justify-content: center; }
    .modal-backdrop { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); }
    .modal-content { position: relative; background: #fff; border-radius: 12px; padding: 20px; margin: 20px; max-width: 400px; width: 100%; }
    .modal-content h3 { font-size: 16px; margin: 0 0 16px; }
    .modal-section { margin-bottom: 10px; }
    .modal-label { font-size: 11px; color: #888; margin-bottom: 2px; }
    .modal-value { font-size: 14px; color: #333; }
    .modal-value a { color: #f06292; text-decoration: none; }
    .approval-card { border-left: 3px solid #ff9800; }
    .approval-applicant { margin-top: 8px; padding: 8px; background: #fafafa; border-radius: 6px; }
    .applicant-name { font-size: 14px; font-weight: 600; color: #333; }
    .applicant-detail { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .applicant-phone a { color: #f06292; text-decoration: none; font-size: 13px; }
    .approval-actions { display: flex; gap: 8px; margin-top: 10px; }
    .approve-btn { flex: 1; padding: 10px; background: #4caf50; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .approve-btn:active { opacity: 0.85; }
    .deny-btn { flex: 1; padding: 10px; background: #fff; color: #e53935; border: 1px solid #e53935; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .deny-btn:active { opacity: 0.85; }
    .doc-card { position: relative; }
    .doc-pending { border-left: 3px solid #2196f3; }
    .doc-actions { display: flex; gap: 6px; margin-top: 8px; }
    .doc-view-btn { flex: 2; padding: 8px; background: #e3f2fd; color: #1565c0; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .doc-view-btn:active { opacity: 0.85; }
    .doc-action-btn { flex: 1; padding: 8px; font-size: 13px; }
  `;
  document.head.appendChild(style);

  // Check saved API key
  const savedKey = sessionStorage.getItem(API_KEY_STORAGE);
  if (savedKey) {
    state.apiKey = savedKey;
    const res = await apiCall('/api/friends/count').catch(() => null);
    if (res?.ok) {
      state.authenticated = true;
      await loadDashboard();
      return;
    }
  }

  renderLogin();
}
