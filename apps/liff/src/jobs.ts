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
const LIFF_ID = import.meta.env?.VITE_LIFF_ID || '';

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
  // nursery enrichment fields
  nurseryId?: string;
  prefecture?: string | null;
  area?: string | null;
  nurseryType?: string | null;
  qualificationReq?: string | null;
  accessInfo?: string | null;
  hpUrl?: string | null;
  notes?: string | null;
  transportFee?: number;
  breakMinutes?: number;
  photoUrls?: string[];
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
  // nursery enrichment
  nurseryId?: string;
  prefecture?: string | null;
  area?: string | null;
  nurseryType?: string | null;
  qualificationReq?: string | null;
  accessInfo?: string | null;
  hpUrl?: string | null;
  notes?: string | null;
  transportFee?: number;
  breakMinutes?: number;
  photoUrls?: string[];
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
  prefecture: string; // '' = 全都道府県, or '東京都' etc
  area: string;       // '' = 全エリア, or specific area keyword
  dateFrom: string;   // '' = today, or YYYY-MM-DD
  dateTo: string;     // '' = no limit, or YYYY-MM-DD
  selectedDate: string; // '' = all, or YYYY-MM-DD (single date pick)
  sort: 'date' | 'rate-high' | 'rate-low'; // default: date
  weekOffset: number; // 0 = current 2 weeks, 1 = next 2 weeks, etc.
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
  availablePrefectures: string[];
  areasByPrefecture: Map<string, string[]>;
  showFilter: boolean;
  // マイページからの遷移フラグ
  fromMypage: boolean;
  // ミニカレンダー（園詳細）
  miniCalMonth: number; // 0-based month
  miniCalYear: number;
  miniCalSelectedDate: string; // YYYY-MM-DD
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
    idCardBackFile: File | null;
    qualificationCertFile: File | null;
    bacterialTestCertFile: File | null;
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
  filter: { prefecture: '', area: '', dateFrom: '', dateTo: '', selectedDate: '', sort: 'date', weekOffset: 0 },
  availableAreas: [],
  availablePrefectures: [],
  areasByPrefecture: new Map(),
  showFilter: false,
  fromMypage: false,
  miniCalMonth: new Date().getMonth(),
  miniCalYear: new Date().getFullYear(),
  miniCalSelectedDate: '',
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
    idCardBackFile: null,
    qualificationCertFile: null,
    bacterialTestCertFile: null,
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

function calcTotalPay(hourlyRate: number, startTime: string, endTime: string, breakMinutes: number = 60, transportFee: number = 0): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workMinutes = totalMinutes > 360 ? totalMinutes - breakMinutes : totalMinutes;
  const total = Math.round(hourlyRate * workMinutes / 60) + transportFee;
  return `${total.toLocaleString()}円`;
}

function calcWorkPay(hourlyRate: number, startTime: string, endTime: string, breakMinutes: number = 60): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workMinutes = totalMinutes > 360 ? totalMinutes - breakMinutes : totalMinutes;
  return Math.round(hourlyRate * workMinutes / 60);
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
        // nursery enrichment (from first job that has it)
        nurseryId: job.nurseryId,
        prefecture: job.prefecture,
        area: job.area,
        nurseryType: job.nurseryType,
        qualificationReq: job.qualificationReq,
        accessInfo: job.accessInfo,
        hpUrl: job.hpUrl,
        notes: job.notes,
        transportFee: job.transportFee,
        breakMinutes: job.breakMinutes,
        photoUrls: job.photoUrls,
      });
    }
    const group = map.get(key)!;
    group.jobs.push(job);
    if (job.hourlyRate && (!group.hourlyRate || job.hourlyRate > group.hourlyRate)) {
      group.hourlyRate = job.hourlyRate;
    }
    // fill enrichment from any job that has it
    if (job.nurseryId && !group.nurseryId) {
      group.nurseryId = job.nurseryId;
      group.prefecture = job.prefecture;
      group.area = job.area;
      group.nurseryType = job.nurseryType;
      group.qualificationReq = job.qualificationReq;
      group.accessInfo = job.accessInfo;
      group.hpUrl = job.hpUrl;
      group.notes = job.notes;
      group.transportFee = job.transportFee;
      group.breakMinutes = job.breakMinutes;
      group.photoUrls = job.photoUrls;
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

/** 住所から都道府県を抽出 */
function extractPrefecture(address: string | null): string {
  if (!address) return '';
  const match = address.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
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

/** 都道府県一覧と、都道府県ごとのエリア（区・市）マップを構築 */
function buildPrefectureAreaMap(jobs: Job[]): { prefectures: string[]; areasByPref: Map<string, string[]> } {
  const prefSet = new Set<string>();
  const areaMap = new Map<string, Set<string>>();
  for (const job of jobs) {
    const pref = job.prefecture || extractPrefecture(job.address);
    const area = extractArea(job.address);
    if (pref) {
      prefSet.add(pref);
      if (!areaMap.has(pref)) areaMap.set(pref, new Set());
      if (area) areaMap.get(pref)!.add(area);
    }
  }
  const prefectures = Array.from(prefSet).sort();
  const areasByPref = new Map<string, string[]>();
  for (const [pref, areas] of areaMap) {
    areasByPref.set(pref, Array.from(areas).sort());
  }
  return { prefectures, areasByPref };
}

/** フィルタ・ソートを適用 */
function applyFilterSort(nurseries: NurseryGroup[], filter: FilterState): NurseryGroup[] {
  let result = nurseries.map(n => {
    // 日付フィルタ: 園内の求人を絞る
    let jobs = n.jobs;
    if (filter.selectedDate) {
      // 単日選択モード
      jobs = jobs.filter(j => j.workDate === filter.selectedDate);
    } else {
      if (filter.dateFrom) {
        jobs = jobs.filter(j => j.workDate >= filter.dateFrom);
      }
      if (filter.dateTo) {
        jobs = jobs.filter(j => j.workDate <= filter.dateTo);
      }
    }
    return { ...n, jobs };
  });

  // 求人が0になった園は除外
  result = result.filter(n => n.jobs.length > 0);

  // 都道府県フィルタ
  if (filter.prefecture) {
    result = result.filter(n => {
      const pref = n.prefecture || extractPrefecture(n.address);
      return pref === filter.prefecture;
    });
  }

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

// ========== Bottom Navigation ==========

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

// ========== List View (園一覧) ==========

/** 月カレンダー用: FilterStateのweekOffset を月オフセットとして再利用 */

/** 各日付の求人数を集計 */
function countJobsByDate(jobs: Job[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const job of jobs) {
    if (job.remainingSlots > 0) {
      map.set(job.workDate, (map.get(job.workDate) || 0) + 1);
    }
  }
  return map;
}

function renderFilterBar(): string {
  const { filter, filteredNurseries, allJobs } = state;
  const sortLabels: Record<string, string> = { 'date': '日付順', 'rate-high': '時給高い順', 'rate-low': '時給低い順' };
  const jobCounts = countJobsByDate(allJobs);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 月カレンダー: weekOffset を月オフセットとして利用
  const calYear = new Date(today.getFullYear(), today.getMonth() + filter.weekOffset, 1).getFullYear();
  const calMonth = new Date(today.getFullYear(), today.getMonth() + filter.weekOffset, 1).getMonth();
  const monthLabel = `${calYear}年${calMonth + 1}月`;
  const weekdaysJa = ['日', '月', '火', '水', '木', '金', '土'];
  const firstDayOfMonth = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow = firstDayOfMonth.getDay(); // 0=Sun

  const dowHeaders = weekdaysJa.map((d, i) => {
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    return `<div class="month-cal-dow ${cls}">${d}</div>`;
  }).join('');

  let calCells = '';
  for (let i = 0; i < startDow; i++) calCells += '<div class="month-cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(calYear, calMonth, d);
    const dow = dateObj.getDay();
    const isPast = dateObj < today;
    const isToday = dateStr === todayStr;
    const isSelected = filter.selectedDate === dateStr;
    const count = jobCounts.get(dateStr) || 0;
    const dowCls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    const classes = [
      'month-cal-cell',
      isPast ? 'past' : '',
      isToday ? 'today' : '',
      isSelected ? 'selected' : '',
      count > 0 ? 'has-job' : '',
      dowCls,
    ].filter(Boolean).join(' ');
    calCells += `<div class="${classes}" data-date="${dateStr}">
      <div class="month-cal-day">${d}</div>
      ${count > 0 ? `<div class="month-cal-dot"></div>` : ''}
    </div>`;
  }

  return `
    <div class="month-calendar">
      <div class="month-cal-header">
        <div class="month-cal-nav"><button data-action="month-prev">&lt;</button></div>
        <div class="month-cal-title">${monthLabel}</div>
        <div class="month-cal-nav"><button data-action="month-next">&gt;</button></div>
      </div>
      <div class="month-cal-grid">
        ${dowHeaders}
        ${calCells}
      </div>
    </div>
    <div class="area-filter-section">
      <div class="area-filter-row">
        <div class="area-filter-chips">
          <button class="area-chip ${!filter.prefecture ? 'active' : ''}" data-action="filter-pref-all">すべて</button>
          ${state.availablePrefectures.map(p => `<button class="area-chip ${filter.prefecture === p ? 'active' : ''}" data-action="filter-pref" data-pref="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
        </div>
        <button class="sort-chip" data-action="cycle-sort">${sortLabels[filter.sort]}</button>
      </div>
      ${filter.prefecture && (state.areasByPrefecture.get(filter.prefecture)?.length ?? 0) > 1 ? `
      <div class="area-filter-chips sub">
        <button class="area-chip sub ${!filter.area ? 'active' : ''}" data-action="filter-area-all">全域</button>
        ${(state.areasByPrefecture.get(filter.prefecture) || []).map(a => `<button class="area-chip sub ${filter.area === a ? 'active' : ''}" data-action="filter-area" data-area="${escapeHtml(a)}">${escapeHtml(a)}</button>`).join('')}
      </div>
      ` : ''}
    </div>
    <p class="filter-result-count">${filteredNurseries.length}園が該当${filter.selectedDate ? ` (${formatDate(filter.selectedDate)})` : ''}</p>
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
    const photoUrl = nursery.photoUrls?.[0];

    // バッジ: 県・園タイプ・資格
    const badges: string[] = [];
    if (nursery.prefecture) badges.push(escapeHtml(nursery.prefecture));
    if (nursery.area) badges.push(escapeHtml(nursery.area));
    if (nursery.nurseryType) badges.push(escapeHtml(nursery.nurseryType));
    if (nursery.qualificationReq) badges.push(escapeHtml(nursery.qualificationReq));

    return `
      <div class="nursery-card" data-nursery="${escapeHtml(nursery.nurseryName)}">
        ${photoUrl ? `<div class="nursery-photo"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(nursery.nurseryName)}" loading="lazy"></div>` : ''}
        ${nursery.station ? `<div class="nursery-station-badge"><span class="station-label">最寄駅</span> ${escapeHtml(nursery.station)}</div>` : ''}
        <h3 class="nursery-name">${escapeHtml(nursery.nurseryName)}</h3>
        ${badges.length > 0 ? `<div class="nursery-badges">${badges.map(b => `<span class="badge">${b}</span>`).join('')}</div>` : ''}
        ${nursery.hourlyRate ? `
        <div class="nursery-rate">
          <span class="rate-label">時給</span>
          <span class="rate-value">${formatHourlyRate(nursery.hourlyRate)}</span>
        </div>` : ''}
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
    <div class="jobs-page" style="padding-bottom:70px;">
      <div class="jobs-header">
        <h1>お仕事を探す</h1>
        <p>${state.nurseries.length}園で募集中</p>
      </div>
      ${renderFilterBar()}
      ${noResults || `<div class="nursery-list">${cards}</div>`}
    </div>
    ${renderBottomNav('jobs')}
  `;
}

// ========== Nursery Detail View (園詳細 + 募集日時) ==========

function renderNurseryDetail(): string {
  const nursery = state.selectedNursery;
  if (!nursery) return '';

  const { selectedJob } = state;
  const transportFee = nursery.transportFee ?? 0;
  const breakMins = nursery.breakMinutes ?? 60;

  // 写真カルーセル
  const photos = nursery.photoUrls ?? [];
  const photoHtml = photos.length > 0
    ? `<div class="nursery-photos">${photos.map(url => `<img src="${escapeHtml(url)}" alt="${escapeHtml(nursery.nurseryName)}" loading="lazy">`).join('')}</div>`
    : '';

  // バッジ
  const badges: string[] = [];
  if (nursery.prefecture) badges.push(escapeHtml(nursery.prefecture));
  if (nursery.area) badges.push(escapeHtml(nursery.area));
  if (nursery.nurseryType) badges.push(escapeHtml(nursery.nurseryType));
  if (nursery.qualificationReq) badges.push(escapeHtml(nursery.qualificationReq));

  // ========== ミニカレンダー ==========
  const { miniCalMonth, miniCalYear, miniCalSelectedDate } = state;
  const weekdaysJa = ['日', '月', '火', '水', '木', '金', '土'];
  const calMonthLabel = `${miniCalYear}年${miniCalMonth + 1}月`;

  // その月のカレンダー用日付
  const firstDayOfMonth = new Date(miniCalYear, miniCalMonth, 1);
  const daysInMonth = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();
  const startDow = firstDayOfMonth.getDay(); // 0=Sun

  // 求人がある日のSet
  const jobDateSet = new Set<string>();
  for (const job of nursery.jobs) {
    if (job.remainingSlots > 0) jobDateSet.add(job.workDate);
  }

  const todayNow = new Date();
  todayNow.setHours(0, 0, 0, 0);
  const todayStrCal = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, '0')}-${String(todayNow.getDate()).padStart(2, '0')}`;

  // DOWヘッダー
  const miniCalDowHtml = weekdaysJa.map((d, i) => {
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    return `<div class="mini-cal-dow ${cls}">${d}</div>`;
  }).join('');

  // 日付セル
  let miniCalCells = '';
  for (let i = 0; i < startDow; i++) miniCalCells += '<div class="mini-cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${miniCalYear}-${String(miniCalMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(miniCalYear, miniCalMonth, d);
    const dow = dateObj.getDay();
    const isPast = dateObj < todayNow;
    const hasJob = jobDateSet.has(dateStr);
    const isSelected = miniCalSelectedDate === dateStr;
    const isToday = dateStr === todayStrCal;
    const dowCls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    const classes = [
      'mini-cal-cell',
      hasJob ? 'has-job' : '',
      isPast ? '' : '',
      isSelected ? 'selected' : '',
      isToday ? 'today' : '',
      dowCls,
    ].filter(Boolean).join(' ');
    miniCalCells += `<div class="${classes}" ${hasJob ? `data-cal-date="${dateStr}"` : ''}>${d}</div>`;
  }

  // 選択日のスロットカード
  const selectedDateJobs = miniCalSelectedDate
    ? nursery.jobs.filter(j => j.workDate === miniCalSelectedDate)
    : nursery.jobs;

  const slotCards = selectedDateJobs.map((job) => {
    const days = daysFromNow(job.workDate);
    const isSelected = selectedJob?.id === job.id;
    const isFull = job.remainingSlots <= 0;

    const [sh, sm] = job.startTime.split(':').map(Number);
    const [eh, em] = job.endTime.split(':').map(Number);
    const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const hasBreak = totalMinutes > 360;
    const breakText = hasBreak ? `（休憩${breakMins}分）` : '（休憩なし）';
    const workMinutes = hasBreak ? totalMinutes - breakMins : totalMinutes;
    const workH = Math.floor(workMinutes / 60);
    const workM = workMinutes % 60;
    const workDuration = workM > 0 ? `${workH}時間${workM}分` : `${workH}時間`;

    return `
      <div class="slot-card ${isSelected ? 'selected' : ''} ${isFull ? 'full' : ''}" ${!isFull ? `data-job-id="${job.id}"` : ''}>
        <div class="slot-date-row">
          <span class="slot-date">${formatDate(job.workDate)}</span>
          ${days <= 2 && !isFull ? `<span class="slot-urgent">${days === 0 ? '今日' : days === 1 ? '明日' : 'あと2日'}</span>` : ''}
          ${isFull ? '<span class="slot-full-badge">締切</span>' : ''}
          ${!isFull && job.remainingSlots <= 1 ? '<span class="slot-last">残1枠</span>' : ''}
        </div>
        <div class="slot-time">${job.startTime.slice(0, 5)}〜${job.endTime.slice(0, 5)} ${breakText} <span class="slot-work-duration">実働${workDuration}</span></div>
        ${job.hourlyRate ? `
        <div class="slot-pay">
          <span class="slot-pay-total">${calcTotalPay(job.hourlyRate, job.startTime, job.endTime, breakMins, transportFee)}</span>
          <span class="slot-pay-detail">時給${formatHourlyRate(job.hourlyRate)}${transportFee > 0 ? ` + 交通費${transportFee.toLocaleString()}円` : ''}</span>
        </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // 報酬内訳
  const payBreakdownHtml = nursery.hourlyRate
    ? `<div class="info-row">
        <div class="info-row-label">報酬内訳</div>
        <div class="info-row-value">時給¥${nursery.hourlyRate.toLocaleString()}×勤務時間数${transportFee > 0 ? `＋交通費${transportFee.toLocaleString()}円` : ''}</div>
      </div>`
    : '';

  // Google Maps iframe
  const mapsHtml = nursery.address
    ? `<div class="nursery-map">
        <iframe src="https://maps.google.com/maps?q=${encodeURIComponent(nursery.address)}&output=embed&z=15" width="100%" height="200" style="border:0;border-radius:8px;" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </div>`
    : '';

  return `
    <div class="jobs-page">
      <button class="back-btn" data-action="back-to-list">&lt; 一覧に戻る</button>

      <div class="nursery-detail">
        ${photoHtml}

        <div class="nursery-detail-header">
          ${nursery.station ? `<div class="nursery-station-badge"><span class="station-label">最寄駅</span> ${escapeHtml(nursery.station)}</div>` : ''}
          <h2>${escapeHtml(nursery.nurseryName)}</h2>
          ${badges.length > 0 ? `<div class="nursery-badges">${badges.map(b => `<span class="badge">${b}</span>`).join('')}</div>` : ''}
        </div>

        <div class="section-title">＜ 現在募集している日時 ＞</div>
        <p class="section-sub">日付をタップして募集中の日程を確認！<br>※ 複数応募も可能です</p>

        <div class="mini-cal">
          <div class="mini-cal-header">
            <div class="mini-cal-nav"><button data-action="mini-cal-prev">&lt;</button></div>
            <div class="mini-cal-title">${calMonthLabel}</div>
            <div class="mini-cal-nav"><button data-action="mini-cal-next">&gt;</button></div>
          </div>
          <div class="mini-cal-grid">
            ${miniCalDowHtml}
            ${miniCalCells}
          </div>
          ${miniCalSelectedDate ? `
            <div class="mini-cal-day-slots">
              <div class="mini-cal-day-title">${formatDate(miniCalSelectedDate)} の募集</div>
            </div>
          ` : ''}
        </div>

        <div class="slot-list">${slotCards}</div>
        ${!miniCalSelectedDate && nursery.jobs.length > 10 ? '<p class="section-sub" style="font-size:11px;margin-top:8px;">カレンダーで日付を選ぶと絞り込めます</p>' : ''}

        ${selectedJob ? `
        <button class="apply-btn" data-action="apply">この園に応募する ▶</button>
        ` : `
        <p class="select-hint">応募する日程をタップしてください</p>
        `}

        <p class="apply-note">※応募後いただきましたら、採用可否についてスポットほいく担当者から公式LINEを通じてご連絡いたします。なお、ご応募いただいても必ずしも勤務が確定するわけではないことを、予めご了承ください。</p>

        <div class="section-title">＜ 募集要項 ＞</div>

        <div class="nursery-info-table">
          ${nursery.description ? `
          <div class="info-row">
            <div class="info-row-label">業務内容</div>
            <div class="info-row-value">${escapeHtml(nursery.description).replace(/\n/g, '<br>')}</div>
          </div>` : ''}

          ${nursery.requirements ? `
          <div class="info-row">
            <div class="info-row-label">応募資格</div>
            <div class="info-row-value">${escapeHtml(nursery.requirements).replace(/\n/g, '<br>')}</div>
          </div>` : ''}

          ${payBreakdownHtml}

          ${nursery.notes ? `
          <div class="info-row">
            <div class="info-row-label">注意事項</div>
            <div class="info-row-value">${escapeHtml(nursery.notes).replace(/\n/g, '<br>')}</div>
          </div>` : ''}

          ${nursery.hpUrl ? `
          <div class="info-row">
            <div class="info-row-label">園のHP</div>
            <div class="info-row-value">${escapeHtml(nursery.nurseryName)} <a href="${escapeHtml(nursery.hpUrl)}" target="_blank" rel="noopener" class="hp-link">園のHP</a></div>
          </div>` : ''}

          ${nursery.address ? `
          <div class="info-row">
            <div class="info-row-label">勤務地</div>
            <div class="info-row-value">${escapeHtml(nursery.address)}</div>
          </div>` : ''}

          ${nursery.accessInfo ? `
          <div class="info-row">
            <div class="info-row-label">アクセス</div>
            <div class="info-row-value">${escapeHtml(nursery.accessInfo).replace(/\n/g, '<br>')}</div>
          </div>` : ''}
        </div>

        ${mapsHtml}

        ${selectedJob ? `
        <button class="apply-btn" data-action="apply" style="margin-top:24px;">この園に応募する ▶</button>
        ` : ''}
      </div>

      <footer class="liff-footer">
        <a href="https://spothoiku.com/terms" target="_blank" rel="noopener">利用規約</a>
        <span>運営会社 <a href="https://kit-inc.jp" target="_blank" rel="noopener">KIT株式会社</a></span>
        <p class="footer-license">有料職業紹介事業(厚生労働大臣許可・許可番号13-ユ-318729)</p>
      </footer>
    </div>
  `;
}

// ========== Profile Form View ==========

function renderProfileForm(): string {
  const { profileForm, userProfile } = state;
  const hasIdCard = state.userDocuments.some(d => d.doc_type === 'id_card');
  const hasIdCardBack = state.userDocuments.some(d => d.doc_type === 'id_card_back');
  const hasQualCert = state.userDocuments.some(d => d.doc_type === 'qualification_cert');
  const hasBacterialTestCert = state.userDocuments.some(d => d.doc_type === 'bacterial_test_cert');

  const fromMypage = state.fromMypage;
  const backAction = fromMypage ? 'back-to-mypage' : (state.selectedNursery ? 'back-to-nursery' : 'back-to-list');

  return `
    <div class="jobs-page">
      <button class="back-btn" data-action="${backAction}">&lt; 戻る</button>

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
          <label class="form-label">検便検査について</label>
          <p class="form-hint">勤務日から1ヶ月以内の検便検査結果が必要です。お持ちでしょうか。</p>
          <select class="form-select" id="bacterialTestStatus" data-toggle-upload="bacterialTestUpload">
            <option value="">選択してください</option>
            <option value="持っている" ${(profileForm.bacterialTestStatus || userProfile?.bacterial_test_status) === '持っている' ? 'selected' : ''}>持っている（一ヶ月以内）</option>
            <option value="持っていない" ${(profileForm.bacterialTestStatus || userProfile?.bacterial_test_status) === '持っていない' ? 'selected' : ''}>持っていない</option>
          </select>
        </div>

        <div class="form-group" id="bacterialTestUpload" style="display:${(profileForm.bacterialTestStatus || userProfile?.bacterial_test_status) === '持っている' ? 'block' : 'none'}">
          <label class="form-label">検便検査結果のアップロード ${hasBacterialTestCert ? '<span class="uploaded-badge">登録済み</span>' : '<span class="required">必須</span>'}</label>
          <p class="form-hint">検査結果のコピーを撮影またはファイルで提出してください</p>
          <label class="file-upload-btn" id="bacterialTestCertLabel">
            <input type="file" accept="image/*" id="bacterialTestCertFile" style="display:none">
            <span id="bacterialTestCertFileName">${hasBacterialTestCert ? '登録済み（変更する場合はタップ）' : '写真を選択'}</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">本人確認書類（表面） ${hasIdCard ? '<span class="uploaded-badge">登録済み</span>' : '<span class="required">必須</span>'}</label>
          <p class="form-hint">運転免許証・マイナンバーカードなどの表面</p>
          <label class="file-upload-btn" id="idCardLabel">
            <input type="file" accept="image/*" id="idCardFile" style="display:none">
            <span id="idCardFileName">${hasIdCard ? '登録済み（変更する場合はタップ）' : '表面の写真を選択'}</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">本人確認書類（裏面） ${hasIdCardBack ? '<span class="uploaded-badge">登録済み</span>' : '<span class="required">必須</span>'}</label>
          <p class="form-hint">裏面も必ずご提出ください</p>
          <label class="file-upload-btn" id="idCardBackLabel">
            <input type="file" accept="image/*" id="idCardBackFile" style="display:none">
            <span id="idCardBackFileName">${hasIdCardBack ? '登録済み（変更する場合はタップ）' : '裏面の写真を選択'}</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">資格証（表面） ${hasQualCert ? '<span class="uploaded-badge">登録済み</span>' : '<span class="required">必須</span>'}</label>
          <p class="form-hint">保育士証・看護師免許証などの表面を撮影してください</p>
          <p class="form-hint" style="color:#e57373;">※ 必ず現在の姓でのものをご提出ください。旧姓のものは使用できません。</p>
          <label class="file-upload-btn" id="qualCertLabel">
            <input type="file" accept="image/*" id="qualCertFile" style="display:none">
            <span id="qualCertFileName">${hasQualCert ? '登録済み（変更する場合はタップ）' : '表面の写真を選択'}</span>
          </label>
        </div>

        <button class="apply-btn" data-action="save-profile" id="saveProfileBtn">
          ${fromMypage ? (userProfile ? 'プロフィールを更新' : 'プロフィールを登録') : (userProfile ? '更新して応募に進む' : '登録して応募に進む')}
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
            <span class="confirm-value">${calcTotalPay(selectedJob.hourlyRate, selectedJob.startTime, selectedJob.endTime, state.selectedNursery?.breakMinutes ?? 60, state.selectedNursery?.transportFee ?? 0)}</span>
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

        ${!userProfile?.terms_agreed_at ? `
        <div class="form-group terms-group" style="margin: 16px 0;">
          <label class="terms-label">
            <input type="checkbox" id="termsAgreedConfirm">
            <span><a href="https://spothoiku.com/terms" target="_blank" rel="noopener" style="color:#f06292;">利用規約</a>に同意する</span>
          </label>
        </div>
        ` : ''}
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

  // Month Calendar: date cell click
  app.querySelectorAll('.month-cal-cell:not(.past):not(.empty)').forEach((cell) => {
    cell.addEventListener('click', () => {
      const dateStr = (cell as HTMLElement).dataset.date || '';
      state.filter.selectedDate = state.filter.selectedDate === dateStr ? '' : dateStr;
      state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
      render();
    });
  });

  // Month Calendar: prev/next
  app.querySelector('[data-action="month-prev"]')?.addEventListener('click', () => {
    state.filter.weekOffset = Math.max(0, state.filter.weekOffset - 1);
    state.filter.selectedDate = '';
    render();
  });
  app.querySelector('[data-action="month-next"]')?.addEventListener('click', () => {
    state.filter.weekOffset += 1;
    state.filter.selectedDate = '';
    render();
  });

  // Prefecture filter: all
  app.querySelector('[data-action="filter-pref-all"]')?.addEventListener('click', () => {
    state.filter.prefecture = '';
    state.filter.area = '';
    state.filter.selectedDate = '';
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
    render();
  });

  // Prefecture filter: specific
  app.querySelectorAll('[data-action="filter-pref"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pref = (btn as HTMLElement).dataset.pref || '';
      state.filter.prefecture = state.filter.prefecture === pref ? '' : pref;
      state.filter.area = ''; // 都道府県変更時はエリアリセット
      state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
      render();
    });
  });

  // Area filter: all (within prefecture)
  app.querySelector('[data-action="filter-area-all"]')?.addEventListener('click', () => {
    state.filter.area = '';
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
    render();
  });

  // Area filter: specific
  app.querySelectorAll('[data-action="filter-area"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const area = (btn as HTMLElement).dataset.area || '';
      state.filter.area = state.filter.area === area ? '' : area;
      state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
      render();
    });
  });

  // Filter: cycle sort
  app.querySelector('[data-action="cycle-sort"]')?.addEventListener('click', () => {
    const order: FilterState['sort'][] = ['date', 'rate-high', 'rate-low'];
    const idx = order.indexOf(state.filter.sort);
    state.filter.sort = order[(idx + 1) % order.length];
    state.filteredNurseries = applyFilterSort(state.nurseries, state.filter);
    render();
  });

  // Mini calendar: date cell click
  app.querySelectorAll('.mini-cal-cell.has-job').forEach((cell) => {
    cell.addEventListener('click', () => {
      const dateStr = (cell as HTMLElement).dataset.calDate || '';
      state.miniCalSelectedDate = state.miniCalSelectedDate === dateStr ? '' : dateStr;
      state.selectedJob = null; // reset selection when switching dates
      render();
    });
  });

  // Mini calendar: prev/next month
  app.querySelector('[data-action="mini-cal-prev"]')?.addEventListener('click', () => {
    if (state.miniCalMonth === 0) {
      state.miniCalMonth = 11;
      state.miniCalYear -= 1;
    } else {
      state.miniCalMonth -= 1;
    }
    state.miniCalSelectedDate = '';
    render();
  });
  app.querySelector('[data-action="mini-cal-next"]')?.addEventListener('click', () => {
    if (state.miniCalMonth === 11) {
      state.miniCalMonth = 0;
      state.miniCalYear += 1;
    } else {
      state.miniCalMonth += 1;
    }
    state.miniCalSelectedDate = '';
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
        // ミニカレンダーを最初の求人の月に合わせる
        const firstJob = nursery.jobs[0];
        if (firstJob) {
          const d = new Date(firstJob.workDate + 'T00:00:00');
          state.miniCalYear = d.getFullYear();
          state.miniCalMonth = d.getMonth();
        } else {
          state.miniCalYear = new Date().getFullYear();
          state.miniCalMonth = new Date().getMonth();
        }
        state.miniCalSelectedDate = '';
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

  // Back to mypage
  app.querySelector('[data-action="back-to-mypage"]')?.addEventListener('click', () => {
    window.location.href = `https://liff.line.me/${LIFF_ID}?page=mypage`;
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

  const idCardBackInput = app.querySelector('#idCardBackFile') as HTMLInputElement | null;
  if (idCardBackInput) {
    idCardBackInput.addEventListener('change', () => {
      const file = idCardBackInput.files?.[0];
      if (file) {
        state.profileForm.idCardBackFile = file;
        const label = app.querySelector('#idCardBackFileName');
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

  const bacterialTestCertInput = app.querySelector('#bacterialTestCertFile') as HTMLInputElement | null;
  if (bacterialTestCertInput) {
    bacterialTestCertInput.addEventListener('change', () => {
      const file = bacterialTestCertInput.files?.[0];
      if (file) {
        state.profileForm.bacterialTestCertFile = file;
        const label = app.querySelector('#bacterialTestCertFileName');
        if (label) label.textContent = file.name;
      }
    });
  }

  // 検便検査: 「持っている」選択時にアップロード欄を表示
  const bacterialTestSelect = app.querySelector('#bacterialTestStatus') as HTMLSelectElement | null;
  if (bacterialTestSelect) {
    bacterialTestSelect.addEventListener('change', () => {
      const uploadDiv = app.querySelector('#bacterialTestUpload') as HTMLElement | null;
      if (uploadDiv) {
        uploadDiv.style.display = bacterialTestSelect.value === '持っている' ? 'block' : 'none';
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
    // 締切を過ぎた枠を除外（当日の勤務開始時刻を過ぎた枠は非表示）
    const now = new Date();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const filteredJobs = json.data.filter((job: Job) => {
      const jobDate = new Date(job.workDate + 'T00:00:00');
      if (jobDate.getTime() === todayMidnight.getTime()) {
        const [h, m] = job.startTime.split(':').map(Number);
        const startDateTime = new Date(job.workDate + `T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
        if (now >= startDateTime) return false;
      }
      return true;
    });
    state.allJobs = filteredJobs;
    state.nurseries = groupByNursery(filteredJobs);
    state.availableAreas = buildAvailableAreas(filteredJobs);
    const prefAreaMap = buildPrefectureAreaMap(filteredJobs);
    state.availablePrefectures = prefAreaMap.prefectures;
    state.areasByPrefecture = prefAreaMap.areasByPref;
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
  if (!state.friendId) {
    alert('ユーザー情報が取得できませんでした。LINEアプリからもう一度お試しください。');
    return;
  }

  // 書類チェック
  const hasIdCard = state.userDocuments.some(d => d.doc_type === 'id_card') || state.profileForm.idCardFile;
  if (!hasIdCard) {
    alert('本人確認書類（表面）は必須です');
    return;
  }
  const hasIdCardBack = state.userDocuments.some(d => d.doc_type === 'id_card_back') || state.profileForm.idCardBackFile;
  if (!hasIdCardBack) {
    alert('本人確認書類（裏面）は必須です');
    return;
  }
  const hasQualCert = state.userDocuments.some(d => d.doc_type === 'qualification_cert') || state.profileForm.qualificationCertFile;
  if (!hasQualCert) {
    alert('資格証は必須です');
    return;
  }
  // 検便検査「持っている」選択時はアップロード必須
  if (bacterialTestStatus === '持っている') {
    const hasBacterialCert = state.userDocuments.some(d => d.doc_type === 'bacterial_test_cert') || state.profileForm.bacterialTestCertFile;
    if (!hasBacterialCert) {
      alert('検便検査結果のアップロードは必須です');
      return;
    }
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
        termsAgreedAt: undefined, // 利用規約同意は応募確定画面で取得
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
    if (state.profileForm.idCardBackFile) {
      uploads.push(uploadDocument(state.profileForm.idCardBackFile, 'id_card_back'));
    }
    if (state.profileForm.qualificationCertFile) {
      uploads.push(uploadDocument(state.profileForm.qualificationCertFile, 'qualification_cert'));
    }
    if (state.profileForm.bacterialTestCertFile) {
      uploads.push(uploadDocument(state.profileForm.bacterialTestCertFile, 'bacterial_test_cert'));
    }

    if (uploads.length > 0) {
      await Promise.all(uploads);
    }

    state.submitting = false;

    // マイページから来た場合は保存後マイページに戻る
    if (state.fromMypage) {
      alert('プロフィールを更新しました');
      window.location.href = `https://liff.line.me/${LIFF_ID}?page=mypage`;
      return;
    }

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

  // 利用規約同意チェック（未同意ユーザーのみ）
  if (!userProfile?.terms_agreed_at) {
    const termsCheckbox = document.getElementById('termsAgreedConfirm') as HTMLInputElement | null;
    if (!termsCheckbox?.checked) {
      alert('利用規約への同意が必要です');
      return;
    }
  }

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

    // 利用規約同意を保存（初回のみ）
    if (!userProfile?.terms_agreed_at && friendId) {
      await apiCall('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({ friendId, termsAgreedAt: new Date().toISOString() }),
      }).catch(() => null);
    }

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

  // URLパラメータで初期ビューを指定（マイページからの遷移対応）
  const urlParams = new URLSearchParams(window.location.search);
  const viewParam = urlParams.get('view');
  if (viewParam === 'profile') {
    state.view = 'profile';
    state.fromMypage = true;
  }

  render();
  if (state.view === 'list') fetchJobs();
}
