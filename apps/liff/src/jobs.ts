/**
 * LIFF Jobs Page — 園ベースの求人一覧・詳細・応募
 *
 * 構造（現行 spothoiku.com 準拠）:
 * 1. 園一覧: 園名・時給・最寄駅のカード
 * 2. 園詳細: 園情報 + 募集日時一覧（複数スロット）+ 募集要項
 * 3. 日時選択 → プロフィール未登録なら入力 → 応募確認 → 完了
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

interface Job {
  id: string;
  nurseryName: string;
  address: string | null;
  station: string | null;
  hourlyRate: number | null;
  description: string | null;
  requirements: string | null;
  capacity: number;
  remainingSlots: number;
  workDate: string;
  startTime: string;
  endTime: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** 園単位にグルーピングしたデータ */
interface NurseryGroup {
  nurseryName: string;
  station: string | null;
  address: string | null;
  hourlyRate: number | null; // 最高時給
  description: string | null;
  requirements: string | null;
  jobs: Job[]; // その園の全求人（日付順）
}

interface UserProfile {
  id: string;
  friend_id: string;
  real_name: string;
  real_name_kana: string | null;
  phone: string | null;
  qualification_type: string | null;
  date_of_birth: string | null;
  gender: string | null;
  allergies_medical: string | null;
  experience_years: string | null;
  bacterial_test_status: string | null;
  health_notes: string | null;
  terms_agreed_at: string | null;
}

interface UserDocument {
  id: string;
  friend_id: string;
  doc_type: string;
  r2_key: string;
  file_name: string | null;
  status: string;
}

interface FilterState {
  area: string;       // '' = 全エリア, or specific area keyword
  dateFrom: string;   // '' = today, or YYYY-MM-DD
  dateTo: string;     // '' = no limit, or YYYY-MM-DD
  sort: 'date' | 'rate-high' | 'rate-low'; // default: date
}

interface JobsState {
  view: 'list' | 'nursery' | 'profile' | 'confirm' | 'success' | 'error';
  allJobs: Job[];
  nurseries: NurseryGroup[];
  filteredNurseries: NurseryGroup[];
  selectedNursery: NurseryGroup | null;
  selectedJob: Job | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  userProfile: UserProfile | null;
  userDocuments: UserDocument[];
  loading: boolean;
  submitting: boolean;
  errorMessage: string;
  filter: FilterState;
  availableAreas: string[];
  showFilter: boolean;
  // プロフィール入力中の一時データ
  profileForm: {
    realName: string;
    realNameKana: string;
    phone: string;
    qualificationType: string;
    dateOfBirth: string;
    gender: string;
    allergiesMedical: string;
    experienceYears: string;
    bacterialTestStatus: string;
    healthNotes: string;
    termsAgreed: boolean;
    idCardFile: File | null;
    qualificationCertFile: File | null;
  };
}

const state: JobsState = {
  view: 'list',
  allJobs: [],
  nurseries: [],
  filteredNurseries: [],
  selectedNursery: null,
  selectedJob: null,
  profile: null,
  friendId: null,
  userProfile: null,
  userDocuments: [],
  loading: true,
  submitting: false,
  errorMessage: '',
  filter: { area: '', dateFrom: '', dateTo: '', sort: 'date' },
  availableAreas: [],
  showFilter: false,
  profileForm: {
    realName: '',
    realNameKana: '',
    phone: '',
    qualificationType: '',
    dateOfBirth: '',
    gender: '',
    allergiesMedical: '',
    experienceYears: '',
    bacterialTestStatus: '',
    healthNotes: '',
    termsAgreed: false,
    idCardFile: null,
    qualificationCertFile: null,
  },
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // LIFF認証: IDトークンをX-LIFF-Tokenヘッダーに付与
  try {
    const idToken = liff.getIDToken();
    if (idToken) headers['X-LIFF-Token'] = idToken;
  } catch { /* LIFF not initialized */ }
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Formatters ==========

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function formatHourlyRate(rate: number | null): string {
  if (!rate) return '';
  return `${rate.toLocaleString()}円`;
}

function calcTotalPay(hourlyRate: number, startTime: string, endTime: string, breakMinutes: number = 60): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workMinutes = totalMinutes > 360 ? totalMinutes - breakMinutes : totalMinutes;
  const total = Math.round(hourlyRate * workMinutes / 60);
  return `${total.toLocaleString()}円`;
}

function daysFromNow(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ========== Grouping ==========

function groupByNursery(jobs: Job[]): NurseryGroup[] {
  const map = new Map<string, NurseryGroup>();
  for (const job of jobs) {
    const key = job.nurseryName;
    if (!map.has(key)) {
      map.set(key, {
        nurseryName: job.nurseryName,
        station: job.station,
        address: job.address,
        hourlyRate: job.hourlyRate,
        description: job.description,
        requirements: job.requirements,
        jobs: [],
      });
    }
    const group = map.get(key)!;
    group.jobs.push(job);
    if (job.hourlyRate && (!group.hourlyRate || job.hourlyRate > group.hourlyRate)) {
      group.hourlyRate = job.hourlyRate;
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.hourlyRate ?? 0) - (a.hourlyRate ?? 0));
}

// ========== Filter & Sort ==========

/** 住所からエリア（区・市）を抽出 */
function extractArea(address: string | null): string {
  if (!address) return '';
  // 「〇〇区」「〇〇市」を抽出
  const match = address.match(/(.{1,4}[区市])/);
  return match ? match[1] : '';
}

/** 全求人からユニークなエリア一覧を生成 */
function buildAvailableAreas(jobs: Job[]): string[] {
  const areas = new Set<string>();
  for (const job of jobs) {
    const area = extractArea(job.address);
    if (area) areas.add(area);
  }
  return Array.from(areas).sort();
}

/** フィルタ・ソートを適用 */
function applyFilterSort(nurseries: NurseryGroup[], filter: FilterState): NurseryGroup[] {
  let result = nurseries.map(n => {
    // 日付フィルタ: 園内の求人を絞る
    let jobs = n.jobs;
    if (filter.dateFrom) {
      jobs = jobs.filter(j => j.workDate >= filter.dateFrom);
    }
    if (filter.dateTo) {
      jobs = jobs.filter(j => j.workDate <= filter.dateTo);
    }
    return { ...n, jobs };
  });

  // 求人が0になった園は除外
  result = result.filter(n => n.jobs.length > 0);

  // エリアフィルタ
  if (filter.area) {
    result = result.filter(n => {
      const area = extractArea(n.address);
      return area === filter.area;
    });
  }

  // ソート
  switch (filter.sort) {
    case 'rate-high':
      result.sort((a, b) => (b.hourlyRate ?? 0) - (a.hourlyRate ?? 0));
      break;
    case 'rate-low':
      result.sort((a, b) => (a.hourlyRate ?? 0) - (b.hourlyRate ?? 0));
      break;
    case 'date':
    default:
      result.sort((a, b) => {
        const aNext = a.jobs.find(j => j.remainingSlots > 0)?.workDate ?? '9999';
        const bNext = b.jobs.find(j => j.remainingSlots > 0)?.workDate ?? '9999';
        return aNext.localeCompare(bNext);
      });
      break;
  }

  return result;
}

// ========== List View (園一覧) ==========

function renderFilterBar(): string {
  const { filter, availableAreas, showFilter, filteredNurseries } = state;
  const activeCount = (filter.area ? 1 : 0) + (filter.dateFrom || filter.dateTo ? 1 : 0);
  const sortLabels: Record<string, string> = { 'date': '日付順', 'rate-high': '時給高い順', 'rate-low': '時給低い順' };

  return `
    <div class="filter-bar">
      <div class="filter-chips">
        <button class="filter-chip ${showFilter ? 'active' : ''}" data-action="toggle-filter">
          絞り込み${activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        <button class="sort-chip" data-action="cycle-sort">${sortLabels[filter.sort]}</button>
      </div>
      ${showFilter ? `
      <div class="filter-panel">
        <div class="filter-row">
          <label class="filter-label">エリア</label>
          <select class="filter-select" id="filterArea">
            <option value="">すべて</option>
            ${availableAreas.map(a => `<option value="${escapeHtml(a)}" ${filter.area === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-row">
          <label class="filter-label">期間</label>
          <div class="filter-date-range">
            <input type="date" class="filter-date" id="filterDateFrom" value="${filter.dateFrom}">
            <span class="filter-date-sep">〜</span>
            <input type="date" class="filter-date" id="filterDateTo" value="${filter.dateTo}">
          </div>
        </div>
        <div class="filter-actions">
          <button class="filter-reset-btn" data-action="reset-filter">リセット</button>
          <button class="filter-apply-btn" data-action="apply-filter">適用</button>
        </div>
      </div>` : ''}
      <p class="filter-result-count">${filteredNurseries.length}園が該当</p>
    </div>
  `;
}

function renderList(): string {
  const { filteredNurseries, loading } = state;

  if (loading) {
    return `
      <div class="jobs-page">
        <div class="jobs-header">
          <h1>お仕事を探す</h1>
        </div>
        <div class="jobs-loading">
          <div class="loading-spinner"></div>
          <p>求人情報を読み込み中...</p>
        </div>
      </div>
    `;
  }

  if (state.nurseries.length === 0) {
    return `
      <div class="jobs-page">
        <div class="jobs-header">
          <h1>お仕事を探す</h1>
        </div>
        <div class="jobs-empty">
          <p>現在、募集中のお仕事はありません</p>
          <p class="jobs-empty-sub">新しいお仕事が登録されるまでお待ちください</p>
        </div>
      </div>
    `;
  }

  const cards = filteredNurseries.map((nursery) => {
    const openSlots = nursery.jobs.filter(j => j.remainingSlots > 0).length;
    const nextDate = nursery.jobs.find(j => j.remainingSlots > 0);

    return `
      <div class="nursery-card" data-nursery="${escapeHtml(nursery.nurseryName)}">
        <h3 class="nursery-name">${escapeHtml(nursery.nurseryName)}</h3>
        ${nursery.hourlyRate ? `
        <div class="nursery-rate">
          <span class="rate-label">時給</span>
          <span class="rate-value">${formatHourlyRate(nursery.hourlyRate)}</span>
        </div>` : ''}
        ${nursery.station ? `<p class="nursery-station">${escapeHtml(nursery.station)}</p>` : ''}
        <div class="nursery-bottom">
          <span class="nursery-slots">${openSlots}日程で募集中</span>
          ${nextDate ? `<span class="nursery-next">直近 ${formatDate(nextDate.workDate)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const noResults = filteredNurseries.length === 0 ? `
    <div class="jobs-empty">
      <p>条件に合うお仕事が見つかりません</p>
      <p class="jobs-empty-sub">フィルタ条件を変更してみてください</p>
    </div>
  ` : '';

  return `
    <div class="jobs-page">
      <div class="jobs-header">
        <h1>お仕事を探す</h1>
        <p>${state.nurseries.length}園で募集中</p>
      </div>
      ${renderFilterBar()}
      ${noResults || `<div class="nursery-list">${cards}</div>`}
    </div>
  `;
}

// ========== Nursery Detail View (園詳細 + 募集日時) ==========

function renderNurseryDetail(): string {
  const nursery = state.selectedNursery;
  if (!nursery) return '';

  const { selectedJob } = state;

  const slotCards = nursery.jobs.map((job) => {
    const days = daysFromNow(job.workDate);
    const isSelected = selectedJob?.id === job.id;
    const isFull = job.remainingSlots <= 0;

    const [sh, sm] = job.startTime.split(':').map(Number);
    const [eh, em] = job.endTime.split(':').map(Number);
    const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const hasBreak = totalMinutes > 360;

    return `
      <div class="slot-card ${isSelected ? 'selected' : ''} ${isFull ? 'full' : ''}" ${!isFull ? `data-job-id="${job.id}"` : ''}>
        <div class="slot-date-row">
          <span class="slot-date">${formatDate(job.workDate)}</span>
          ${days <= 2 && !isFull ? `<span class="slot-urgent">${days === 0 ? '今日' : days === 1 ? '明日' : 'あと2日'}</span>` : ''}
          ${isFull ? '<span class="slot-full-badge">締切</span>' : ''}
          ${!isFull && job.remainingSlots <= 1 ? '<span class="slot-last">残1枠</span>' : ''}
        </div>
        <div class="slot-time">${job.startTime}〜${job.endTime}${hasBreak ? '（休憩60分）' : ''}</div>
        ${job.hourlyRate ? `
        <div class="slot-pay">
          <span class="slot-pay-total">報酬総額 <strong>${calcTotalPay(job.hourlyRate, job.startTime, job.endTime)}</strong></span>
          <span class="slot-pay-hourly">時給 ${formatHourlyRate(job.hourlyRate)}</span>
        </div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="jobs-page">
      <button class="back-btn" data-action="back-to-list">&lt; 一覧に戻る</button>

      <div class="nursery-detail">
        <div class="nursery-detail-header">
          <h2>${escapeHtml(nursery.nurseryName)}</h2>
          ${nursery.station ? `<p class="nursery-detail-station">${escapeHtml(nursery.station)}</p>` : ''}
        </div>

        <div class="section-title">募集中の日程</div>
        <div class="slot-list">${slotCards}</div>

        ${selectedJob ? `
        <button class="apply-btn" data-action="apply">この日程に応募する</button>
        ` : `
        <p class="select-hint">応募する日程をタップしてください</p>
        `}

        <div class="nursery-info">
          ${nursery.description ? `
          <div class="info-section">
            <div class="info-section-title">業務内容</div>
            <p class="info-section-body">${escapeHtml(nursery.description)}</p>
          </div>` : ''}

          ${nursery.requirements ? `
          <div class="info-section">
            <div class="info-section-title">応募資格</div>
            <p class="info-section-body">${escapeHtml(nursery.requirements)}</p>
          </div>` : ''}

          ${nursery.address ? `
          <div class="info-section">
            <div class="info-section-title">勤務地</div>
            <p class="info-section-body">${escapeHtml(nursery.address)}</p>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ========== Profile Form View ==========

function renderProfileForm(): string {
  const { profileForm, userProfile } = state;
  const hasIdCard = state.userDocuments.some(d => d.doc_type === 'id_card');
  const hasQualCert = state.userDocuments.some(d => d.doc_type === 'qualification_cert');

  return `
    <div class="jobs-page">
      <button class="back-btn" data-action="back-to-nursery">&lt; 戻る</button>

      <div class="profile-form-card">
        <h3>応募者情報の登録</h3>
        <p class="profile-form-sub">初回のみ入力が必要です。次回以降は自動で引き継がれます。</p>

        <div class="form-group">
          <label class="form-label">お名前（本名）<span class="required">必須</span></label>
          <input type="text" class="form-input" id="realName" placeholder="山田 花子" value="${escapeHtml(profileForm.realName || userProfile?.real_name || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">フリガナ</label>
          <input type="text" class="form-input" id="realNameKana" placeholder="ヤマダ ハナコ" value="${escapeHtml(profileForm.realNameKana || userProfile?.real_name_kana || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">電話番号</label>
          <input type="tel" class="form-input" id="phone" placeholder="090-1234-5678" value="${escapeHtml(profileForm.phone || userProfile?.phone || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">生年月日 <span class="required">必須</span></label>
          <input type="date" class="form-input" id="dateOfBirth" value="${profileForm.dateOfBirth || userProfile?.date_of_birth || ''}">
        </div>

        <div class="form-group">
          <label class="form-label">性別 <span class="required">必須</span></label>
          <select class="form-select" id="gender">
            <option value="">選択してください</option>
            <option value="女性" ${(profileForm.gender || userProfile?.gender) === '女性' ? 'selected' : ''}>女性</option>
            <option value="男性" ${(profileForm.gender || userProfile?.gender) === '男性' ? 'selected' : ''}>男性</option>
            <option value="その他" ${(profileForm.gender || userProfile?.gender) === 'その他' ? 'selected' : ''}>その他</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">保有資格 <span class="required">必須</span></label>
          <select class="form-select" id="qualificationType">
            <option value="">選択してください</option>
            <option value="保育士" ${(profileForm.qualificationType || userProfile?.qualification_type) === '保育士' ? 'selected' : ''}>保育士</option>
            <option value="看護師" ${(profileForm.qualificationType || userProfile?.qualification_type) === '看護師' ? 'selected' : ''}>看護師</option>
            <option value="子育て支援員" ${(profileForm.qualificationType || userProfile?.qualification_type) === '子育て支援員' ? 'selected' : ''}>子育て支援員</option>
            <option value="無資格" ${(profileForm.qualificationType || userProfile?.qualification_type) === '無資格' ? 'selected' : ''}>無資格</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">保育士としての現場経験歴 <span class="required">必須</span></label>
          <select class="form-select" id="experienceYears">
            <option value="">選択してください</option>
            <option value="未経験" ${(profileForm.experienceYears || userProfile?.experience_years) === '未経験' ? 'selected' : ''}>未経験</option>
            <option value="1年未満" ${(profileForm.experienceYears || userProfile?.experience_years) === '1年未満' ? 'selected' : ''}>1年未満</option>
            <option value="1〜3年" ${(profileForm.experienceYears || userProfile?.experience_years) === '1〜3年' ? 'selected' : ''}>1〜3年</option>
            <option value="3〜5年" ${(profileForm.experienceYears || userProfile?.experience_years) === '3〜5年' ? 'selected' : ''}>3〜5年</option>
            <option value="5〜10年" ${(profileForm.experienceYears || userProfile?.experience_years) === '5〜10年' ? 'selected' : ''}>5〜10年</option>
            <option value="10年以上" ${(profileForm.experienceYears || userProfile?.experience_years) === '10年以上' ? 'selected' : ''}>10年以上</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">アレルギーや持病</label>
          <p class="form-hint">ある場合は、その名称を教えてください</p>
          <input type="text" class="form-input" id="allergiesMedical" placeholder="例: 花粉症、なし" value="${escapeHtml(profileForm.allergiesMedical || userProfile?.allergies_medical || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">健康面・既往歴について</label>
          <p class="form-hint">業務を行う上で、法人側に事前に伝えたいことや聞きたいことがあれば教えてください</p>
          <textarea class="form-input" id="healthNotes" rows="3" placeholder="特になし">${escapeHtml(profileForm.healthNotes || userProfile?.health_notes || '')}</textarea>
        </div>

        <div class="form-group">
          <label class="form-label">細菌検査結果</label>
          <p class="form-hint">応募ページにも記載しておりますが、勤務日から1ヶ月以内の細菌検査結果コピーがあると望ましいです。お持ちでしょうか。</p>
          <select class="form-select" id="bacterialTestStatus">
            <option value="">選択してください</option>
            <option value="持っている" ${(profileForm.bacterialTestStatus || userProfile?.bacterial_test_status) === '持っている' ? 'selected' : ''}>持っている（1ヶ月以内）</option>
            <option value="期限切れ" ${(profileForm.bacterialTestStatus || userProfile?.bacterial_test_status) === '期限切れ' ? 'selected' : ''}>持っているが期限切れ</option>
            <option value="持っていない" ${(profileForm.bacterialTestStatus || userProfile?.bacterial_test_status) === '持っていない' ? 'selected' : ''}>持っていない</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">本人確認書類 ${hasIdCard ? '<span class="uploaded-badge">登録済み</span>' : '<span class="required">必須</span>'}</label>
          <p class="form-hint">運転免許証・マイナンバーカードなど</p>
          <label class="file-upload-btn" id="idCardLabel">
            <input type="file" accept="image/*" id="idCardFile" style="display:none">
            <span id="idCardFileName">${hasIdCard ? '登録済み（変更する場合はタップ）' : '写真を選択'}</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">資格証 ${hasQualCert ? '<span class="uploaded-badge">登録済み</span>' : ''}</label>
          <p class="form-hint">保育士証・看護師免許証など（お持ちの場合）</p>
          <label class="file-upload-btn" id="qualCertLabel">
            <input type="file" accept="image/*" id="qualCertFile" style="display:none">
            <span id="qualCertFileName">${hasQualCert ? '登録済み（変更する場合はタップ）' : '写真を選択'}</span>
          </label>
        </div>

        <div class="form-group terms-group">
          <label class="terms-label">
            <input type="checkbox" id="termsAgreed" ${(profileForm.termsAgreed || userProfile?.terms_agreed_at) ? 'checked' : ''}>
            <span><a href="https://spothoiku.com/terms" target="_blank" rel="noopener" style="color:#f06292;">利用規約</a>に同意する</span>
          </label>
        </div>

        <button class="apply-btn" data-action="save-profile" id="saveProfileBtn">
          ${userProfile ? '更新して応募に進む' : '登録して応募に進む'}
        </button>
      </div>
    </div>
  `;
}

// ========== Confirm View ==========

function renderConfirm(): string {
  const { selectedJob, selectedNursery, profile, userProfile } = state;
  if (!selectedJob || !selectedNursery || !profile) return '';

  const displayName = userProfile?.real_name || profile.displayName;

  return `
    <div class="jobs-page">
      <div class="confirm-card">
        <h3>応募内容の確認</h3>
        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">園名</span>
            <span class="confirm-value">${escapeHtml(selectedNursery.nurseryName)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">日付</span>
            <span class="confirm-value">${formatDateFull(selectedJob.workDate)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">時間</span>
            <span class="confirm-value">${selectedJob.startTime}〜${selectedJob.endTime}</span>
          </div>
          ${selectedJob.hourlyRate ? `
          <div class="confirm-row">
            <span class="confirm-label">報酬総額</span>
            <span class="confirm-value">${calcTotalPay(selectedJob.hourlyRate, selectedJob.startTime, selectedJob.endTime)}</span>
          </div>` : ''}
          <div class="confirm-row">
            <span class="confirm-label">お名前</span>
            <span class="confirm-value">${escapeHtml(displayName)}</span>
          </div>
          ${userProfile?.phone ? `
          <div class="confirm-row">
            <span class="confirm-label">電話番号</span>
            <span class="confirm-value">${escapeHtml(userProfile.phone)}</span>
          </div>` : ''}
          ${userProfile?.qualification_type ? `
          <div class="confirm-row">
            <span class="confirm-label">資格</span>
            <span class="confirm-value">${escapeHtml(userProfile.qualification_type)}</span>
          </div>` : ''}
        </div>
        <p class="confirm-note">※応募後、採用可否についてスポットほいく担当者から公式LINEを通じてご連絡いたします。ご応募いただいても必ずしも勤務が確定するわけではないことを、予めご了承ください。</p>
        <button class="apply-btn" data-action="confirm-apply">応募を確定する</button>
        <button class="cancel-link" data-action="back-to-nursery">戻る</button>
      </div>
    </div>
  `;
}

// ========== Success View ==========

function renderSuccess(): string {
  const { selectedJob, selectedNursery } = state;
  if (!selectedJob || !selectedNursery) return '';

  return `
    <div class="jobs-page">
      <div class="success-card">
        <div class="success-icon">&#10003;</div>
        <h2>応募が完了しました</h2>
        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">園名</span>
            <span class="confirm-value">${escapeHtml(selectedNursery.nurseryName)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">日付</span>
            <span class="confirm-value">${formatDateFull(selectedJob.workDate)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">時間</span>
            <span class="confirm-value">${selectedJob.startTime}〜${selectedJob.endTime}</span>
          </div>
        </div>
        <p class="success-message">ご応募ありがとうございます。<br>担当者からLINEでご連絡いたします。</p>
        <button class="close-btn" data-action="close">閉じる</button>
        <button class="cancel-link" data-action="back-to-list" style="margin-top:8px;">他の園も見る</button>
      </div>
    </div>
  `;
}

// ========== Error View ==========

function renderError(): string {
  return `
    <div class="jobs-page">
      <div class="card">
        <h2 style="color: #e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(state.errorMessage)}</p>
        <button class="cancel-link" data-action="back-to-list" style="margin-top:16px;">一覧に戻る</button>
      </div>
    </div>
  `;
}

// ========== Main Render ==========

function render(): void {
  const app = getApp();
  switch (state.view) {
    case 'list': app.innerHTML = renderList(); break;
    case 'nursery': app.innerHTML = renderNurseryDetail(); break;
    case 'profile': app.innerHTML = renderProfileForm(); break;
    case 'confirm': app.innerHTML = renderConfirm(); break;
    case 'success': app.innerHTML = renderSuccess(); break;
    case 'error': app.innerHTML = renderError(); break;
  }
  attachEvents();
}

// ========== Event Handlers ==========

function attachEvents(): void {
  const app = getApp();

  // Filter: toggle panel
  app.querySelector('[data-action="toggle-filter"]')?.addEventListener('click', () => {
    state.showFilter = !state.showFilter;
    render();
  });

  // Filter: cycle sort
  app.querySelector('[data-action="cycle-sort"]')?.addEventListener('click', () => {
    const order: FilterState['sort'][] = ['date', 'rate-high', 'rate-low'];
    const idx = order.indexOf(state.filter.sort);
    state.filter.sort = order[(idx + 1) % order.length];
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
    render();
  });

  // Filter: apply
  app.querySelector('[data-action="apply-filter"]')?.addEventListener('click', () => {
    const area = (document.getElementById('filterArea') as HTMLSelectElement)?.value ?? '';
    const dateFrom = (document.getElementById('filterDateFrom') as HTMLInputElement)?.value ?? '';
    const dateTo = (document.getElementById('filterDateTo') as HTMLInputElement)?.value ?? '';
    state.filter.area = area;
    state.filter.dateFrom = dateFrom;
    state.filter.dateTo = dateTo;
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
    state.showFilter = false;
    render();
  });

  // Filter: reset
  app.querySelector('[data-action="reset-filter"]')?.addEventListener('click', () => {
    state.filter = { area: '', dateFrom: '', dateTo: '', sort: 'date' };
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
    state.showFilter = false;
    render();
  });

  // Nursery card click → nursery detail
  app.querySelectorAll('.nursery-card').forEach((card) => {
    card.addEventListener('click', () => {
      const name = (card as HTMLElement).dataset.nursery;
      const nursery = state.nurseries.find((n) => n.nurseryName === name);
      if (nursery) {
        state.selectedNursery = nursery;
        state.selectedJob = null;
        state.view = 'nursery';
        render();
        window.scrollTo(0, 0);
      }
    });
  });

  // Slot card click → select job
  app.querySelectorAll('.slot-card:not(.full)').forEach((card) => {
    card.addEventListener('click', () => {
      const jobId = (card as HTMLElement).dataset.jobId;
      const job = state.allJobs.find((j) => j.id === jobId);
      if (job) {
        state.selectedJob = job;
        render();
        setTimeout(() => {
          const btn = getApp().querySelector('.apply-btn');
          btn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
    });
  });

  // Back to list
  app.querySelectorAll('[data-action="back-to-list"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = 'list';
      state.selectedNursery = null;
      state.selectedJob = null;
      render();
    });
  });

  // Back to nursery
  app.querySelector('[data-action="back-to-nursery"]')?.addEventListener('click', () => {
    state.view = 'nursery';
    render();
  });

  // Apply → check profile → profile form or confirm
  app.querySelector('[data-action="apply"]')?.addEventListener('click', () => {
    if (state.userProfile) {
      // プロフィール登録済み → 確認画面へ直行
      state.view = 'confirm';
    } else {
      // 未登録 → プロフィール入力画面へ
      state.view = 'profile';
    }
    render();
    window.scrollTo(0, 0);
  });

  // Profile form: file input change handlers
  const idCardInput = app.querySelector('#idCardFile') as HTMLInputElement | null;
  if (idCardInput) {
    idCardInput.addEventListener('change', () => {
      const file = idCardInput.files?.[0];
      if (file) {
        state.profileForm.idCardFile = file;
        const label = app.querySelector('#idCardFileName');
        if (label) label.textContent = file.name;
      }
    });
  }

  const qualCertInput = app.querySelector('#qualCertFile') as HTMLInputElement | null;
  if (qualCertInput) {
    qualCertInput.addEventListener('change', () => {
      const file = qualCertInput.files?.[0];
      if (file) {
        state.profileForm.qualificationCertFile = file;
        const label = app.querySelector('#qualCertFileName');
        if (label) label.textContent = file.name;
      }
    });
  }

  // Save profile → confirm
  app.querySelector('[data-action="save-profile"]')?.addEventListener('click', () => saveProfile());

  // Confirm apply
  app.querySelector('[data-action="confirm-apply"]')?.addEventListener('click', () => submitApplication());

  // Close
  app.querySelector('[data-action="close"]')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });
}

// ========== API Calls ==========

async function fetchJobs(): Promise<void> {
  try {
    const today = new Date();
    const fromDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const params = new URLSearchParams({ status: 'open', fromDate });
    const res = await apiCall(`/api/jobs?${params}`);
    if (!res.ok) throw new Error('求人情報の取得に失敗しました');
    const json = await res.json() as { success: boolean; data: Job[] };
    if (!json.success) throw new Error('求人情報の取得に失敗しました');
    state.allJobs = json.data;
    state.nurseries = groupByNursery(json.data);
    state.availableAreas = buildAvailableAreas(json.data);
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
  } catch (err) {
    state.allJobs = [];
    state.nurseries = [];
    state.filteredNurseries = [];
    console.error('fetchJobs error:', err);
  } finally {
    state.loading = false;
    render();
  }
}

async function fetchProfile(): Promise<void> {
  if (!state.friendId) return;
  try {
    const res = await apiCall(`/api/profiles/${state.friendId}`);
    if (res.ok) {
      const json = await res.json() as { success: boolean; data: { profile: UserProfile | null; documents: UserDocument[] } };
      if (json.success) {
        state.userProfile = json.data.profile;
        state.userDocuments = json.data.documents || [];
      }
    }
  } catch {
    // silent — profile not found is OK
  }
}

async function saveProfile(): Promise<void> {
  if (state.submitting) return;

  // フォームから値を読み取る
  const realName = (document.getElementById('realName') as HTMLInputElement)?.value?.trim();
  const realNameKana = (document.getElementById('realNameKana') as HTMLInputElement)?.value?.trim();
  const phone = (document.getElementById('phone') as HTMLInputElement)?.value?.trim();
  const qualificationType = (document.getElementById('qualificationType') as HTMLSelectElement)?.value;
  const dateOfBirth = (document.getElementById('dateOfBirth') as HTMLInputElement)?.value;
  const gender = (document.getElementById('gender') as HTMLSelectElement)?.value;
  const experienceYears = (document.getElementById('experienceYears') as HTMLSelectElement)?.value;
  const allergiesMedical = (document.getElementById('allergiesMedical') as HTMLInputElement)?.value?.trim();
  const healthNotes = (document.getElementById('healthNotes') as HTMLTextAreaElement)?.value?.trim();
  const bacterialTestStatus = (document.getElementById('bacterialTestStatus') as HTMLSelectElement)?.value;
  const termsAgreed = (document.getElementById('termsAgreed') as HTMLInputElement)?.checked;

  if (!realName) {
    alert('お名前（本名）は必須です');
    return;
  }
  if (!dateOfBirth) {
    alert('生年月日は必須です');
    return;
  }
  if (!gender) {
    alert('性別を選択してください');
    return;
  }
  if (!qualificationType) {
    alert('保有資格を選択してください');
    return;
  }
  if (!experienceYears) {
    alert('現場経験歴を選択してください');
    return;
  }
  if (!termsAgreed && !state.userProfile?.terms_agreed_at) {
    alert('利用規約への同意が必要です');
    return;
  }

  if (!state.friendId) {
    alert('ユーザー情報が取得できませんでした。LINEアプリからもう一度お試しください。');
    return;
  }

  // 初回で書類未登録の場合のチェック
  const hasIdCard = state.userDocuments.some(d => d.doc_type === 'id_card') || state.profileForm.idCardFile;
  if (!hasIdCard) {
    alert('本人確認書類は必須です');
    return;
  }

  state.submitting = true;
  const btn = document.getElementById('saveProfileBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中...';
  }

  try {
    // 1. プロフィール保存
    const profileRes = await apiCall('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({
        friendId: state.friendId,
        realName,
        realNameKana: realNameKana || undefined,
        phone: phone || undefined,
        qualificationType: qualificationType || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        allergiesMedical: allergiesMedical || undefined,
        experienceYears: experienceYears || undefined,
        bacterialTestStatus: bacterialTestStatus || undefined,
        healthNotes: healthNotes || undefined,
        termsAgreedAt: termsAgreed ? new Date().toISOString() : undefined,
      }),
    });

    if (!profileRes.ok) throw new Error('プロフィールの保存に失敗しました');
    const profileJson = await profileRes.json() as { success: boolean; data: UserProfile };
    state.userProfile = profileJson.data;

    // 2. 書類アップロード
    const uploads: Promise<void>[] = [];

    if (state.profileForm.idCardFile) {
      uploads.push(uploadDocument(state.profileForm.idCardFile, 'id_card'));
    }
    if (state.profileForm.qualificationCertFile) {
      uploads.push(uploadDocument(state.profileForm.qualificationCertFile, 'qualification_cert'));
    }

    if (uploads.length > 0) {
      await Promise.all(uploads);
    }

    state.submitting = false;
    state.view = 'confirm';
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    state.submitting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = state.userProfile ? '更新して応募に進む' : '登録して応募に進む';
    }
    alert(err instanceof Error ? err.message : '保存に失敗しました');
  }
}

async function uploadDocument(file: File, docType: string): Promise<void> {
  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await apiCall('/api/documents/upload', {
    method: 'POST',
    body: JSON.stringify({
      friendId: state.friendId,
      docType,
      fileName: file.name,
      image: base64,
      contentType: file.type || 'image/jpeg',
    }),
  });

  if (!res.ok) throw new Error(`${docType}のアップロードに失敗しました`);
}

async function submitApplication(): Promise<void> {
  const { selectedJob, profile, friendId, userProfile } = state;
  if (!selectedJob || !profile || state.submitting) return;
  state.submitting = true;

  const btn = getApp().querySelector('[data-action="confirm-apply"]') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '送信中...';
  }

  try {
    const displayName = userProfile?.real_name || profile.displayName;
    const body: Record<string, unknown> = { displayName };
    if (friendId) body.friendId = friendId;

    const res = await apiCall(`/api/jobs/${selectedJob.id}/book`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(errData?.error || '応募に失敗しました');
    }

    state.view = 'success';
    render();
  } catch (err) {
    state.submitting = false;
    state.errorMessage = err instanceof Error ? err.message : '応募に失敗しました';
    state.view = 'error';
    render();
  }
}

// ========== Init ==========

export async function initJobs(): Promise<void> {
  const profile = await liff.getProfile();
  state.profile = profile;

  const UUID_STORAGE_KEY = 'lh_uuid';
  try { state.friendId = localStorage.getItem('lh_friend_id'); } catch { /* silent */ }

  // friendId取得: まずliff/profileでLINE userIdから直接引く（IDトークン不要で確実）
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

  // UUID linking（best-effort、ユーザー紐付け用）
  const rawIdToken = liff.getIDToken();
  if (rawIdToken) {
    const linkRes = await apiCall('/api/liff/link', {
      method: 'POST',
      body: JSON.stringify({
        idToken: rawIdToken,
        displayName: profile.displayName,
        existingUuid: localStorage.getItem(UUID_STORAGE_KEY),
      }),
    }).catch(() => null);

    if (linkRes?.ok) {
      const data = await linkRes.json() as { success: boolean; data?: { userId?: string; friendId?: string } };
      if (data?.data?.userId) {
        try { localStorage.setItem(UUID_STORAGE_KEY, data.data.userId); } catch { /* silent */ }
      }
      if (data?.data?.friendId && !state.friendId) {
        state.friendId = data.data.friendId;
        try { localStorage.setItem('lh_friend_id', data.data.friendId); } catch { /* silent */ }
      }
    }
  }

  // プロフィール取得（既存ユーザーなら自動引き継ぎ）
  await fetchProfile();

  render();
  fetchJobs();
}
