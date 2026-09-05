/**
 * LIFF Form Page — Dynamic form renderer for LINE surveys / questionnaires
 *
 * Flow:
 * 1. Fetch form definition from API using form ID from query params
 * 2. Render form fields dynamically (text, email, select, radio, etc.)
 * 3. On submit: POST to /api/forms/:id/submit with user's lineUserId
 * 4. Show success message (auto-close in LINE app)
 *
 * URL format: https://liff.line.me/{LIFF_ID}?page=form&id={FORM_ID}
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

const UUID_STORAGE_KEY = 'lh_uuid';
const FORM_VERSION = '2.1.0'; // cache buster

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  columns?: number;
}

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
  hideProfile?: boolean;
  hasSubmitWebhook: boolean;
  webhookOrigin: string | null;
  webhookGateId: string | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  consultationWebinarSlug?: string | null;
}

interface ConsultationSlot {
  date: string;
  start: string;
  end: string;
  startsAt: string;
}

interface ConsultationAvailability {
  calendarReady: boolean;
  fallbackUrl: string | null;
  menu: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string };
  slots: ConsultationSlot[];
  existingBooking: {
    bookingId: string;
    status: string;
    startsAt: string;
    meetUrl: string | null;
  } | null;
}

interface BookedConsultation {
  bookingId: string;
  status: 'confirmed';
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  externalEventId: string;
  created: boolean;
}

interface XFollowerSuggestion {
  username: string;
  displayName: string;
  profileImageUrl: string | null;
}

interface FormState {
  formDef: FormDef | null;
  xHarnessBaseUrl: string | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  submitting: boolean;
  verifiedXUsername: string;
  /**
   * Tracked link id that brought the user to this form (`?ref=` query param,
   * propagated from /r/:ref → LIFF). When present, the server uses the
   * tracked link's reward_template_id (per-campaign reward) instead of the
   * friend's first-touch attribution.
   */
  refTrackedLinkId: string | null;
}

const state: FormState = {
  formDef: null,
  xHarnessBaseUrl: null,
  profile: null,
  friendId: null,
  submitting: false,
  verifiedXUsername: '',
  refTrackedLinkId: null,
};

// Replier pool loading state (shared between renderFormPage and attachXAutocomplete)
let _replierPoolReady = false;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  const idToken = liff.getIDToken();
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...options?.headers,
    },
  });
}

function getGateId(): string | null {
  const gateParam = new URLSearchParams(window.location.search).get('gate');
  return gateParam || state.formDef?.webhookGateId || null;
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Field Rendering ==========

function renderField(field: FormField): string {
  const required = field.required ? ' required' : '';
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const requiredMark = field.required ? '<span class="required-mark">*</span>' : '';

  // If this is an x_username field, render a fuzzy-search autocomplete input
  if (field.name === 'x_username') {
    return `
      <div class="form-field">
        <label class="form-label" for="field-${escapeHtml(field.name)}">
          ${escapeHtml(field.label)}${requiredMark}
        </label>
        <div class="x-autocomplete-wrap">
          <input
            type="text"
            name="${escapeHtml(field.name)}"
            id="field-${escapeHtml(field.name)}"
            class="form-input x-autocomplete-input"
            placeholder="${field.placeholder ? escapeHtml(field.placeholder) : 'X ID or 名前で検索（3文字以上）'}"
            autocomplete="off"
            ${required} />
          <ul class="x-suggest-list" id="x-suggest-list" hidden></ul>
          <p class="x-suggest-hint" id="x-suggest-hint" hidden>3文字以上入力してください</p>
        </div>
        <div class="x-conditions" id="x-conditions" hidden></div>
        <p class="x-conditions-result" id="x-conditions-result" hidden></p>
      </div>
    `;
  }

  let inputHtml = '';

  switch (field.type) {
    case 'textarea':
      inputHtml = `<textarea
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-textarea"
        rows="4"
        ${placeholder}${required}></textarea>`;
      break;

    case 'select': {
      const opts = (field.options ?? [])
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join('');
      inputHtml = `<select
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-select"${required}>
        <option value="">選択してください</option>
        ${opts}
      </select>`;
      break;
    }

    case 'radio': {
      const radios = (field.options ?? [])
        .map(
          (o) =>
            `<label class="radio-label">
              <input type="radio" name="${escapeHtml(field.name)}" value="${escapeHtml(o)}"${required} />
              ${escapeHtml(o)}
            </label>`,
        )
        .join('');
      inputHtml = `<div class="radio-group${field.columns === 2 ? ' two-col' : ''}">${radios}</div>`;
      break;
    }

    case 'checkbox': {
      const boxes = (field.options ?? [])
        .map(
          (o) =>
            `<label class="checkbox-label">
              <input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(o)}" />
              ${escapeHtml(o)}
            </label>`,
        )
        .join('');
      inputHtml = `<div class="checkbox-group${field.columns === 2 ? ' two-col' : ''}">${boxes}</div>`;
      break;
    }

    default:
      inputHtml = `<input
        type="${escapeHtml(field.type)}"
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-input"
        ${placeholder}${required} />`;
      break;
  }

  return `
    <div class="form-field">
      <label class="form-label" for="field-${escapeHtml(field.name)}">
        ${escapeHtml(field.label)}${requiredMark}
      </label>
      ${inputHtml}
    </div>
  `;
}

// ========== Styles ==========

function injectStyles(): void {
  if (document.getElementById('form-styles')) return;
  const style = document.createElement('style');
  style.id = 'form-styles';
  style.textContent = `
    .form-page { max-width: 480px; margin: 0 auto; padding: 16px; }
    .form-header { text-align: center; margin-bottom: 24px; }
    .form-header h1 { font-size: 20px; color: #333; margin-bottom: 8px; }
    .form-description { font-size: 14px; color: #999; }
    .form-profile { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; }
    .form-profile img { width: 36px; height: 36px; border-radius: 50%; }
    .form-profile span { font-size: 14px; font-weight: 600; }
    .form-body { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .form-field { margin-bottom: 20px; }
    .form-label { display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 6px; }
    .required-mark { color: #e53e3e; margin-left: 2px; }
    .form-input, .form-textarea, .form-select {
      width: 100%; padding: 12px; border: 1.5px solid #e0e0e0; border-radius: 8px;
      font-size: 16px; font-family: inherit; background: #fafafa;
      transition: border-color 0.15s; box-sizing: border-box;
      -webkit-appearance: none;
    }
    .form-input:focus, .form-textarea:focus, .form-select:focus {
      outline: none; border-color: #06C755; background: #fff;
    }
    .form-textarea { resize: vertical; min-height: 80px; }
    .form-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
    .radio-group, .checkbox-group { display: flex; flex-direction: column; gap: 10px; }
    .radio-group.two-col, .checkbox-group.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .radio-label, .checkbox-label {
      display: flex; align-items: center; gap: 8px; font-size: 15px; color: #333;
      padding: 10px 12px; background: #fafafa; border-radius: 8px; border: 1.5px solid #e0e0e0;
      cursor: pointer; transition: border-color 0.15s;
    }
    .radio-label:has(input:checked), .checkbox-label:has(input:checked) {
      border-color: #06C755; background: #e8faf0;
    }
    .radio-label input, .checkbox-label input { accent-color: #06C755; width: 18px; height: 18px; }
    .radio-label input[type="radio"] { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; border: 2px solid #ccc; border-radius: 50%; background: #fff; cursor: pointer; }
    .radio-label input[type="radio"]:checked { background: #fff; border-color: #06C755; border-width: 5px; }
    .submit-btn {
      width: 100%; padding: 14px; border: none; border-radius: 8px;
      background: #06C755; color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; font-family: inherit; margin-top: 8px; transition: opacity 0.15s;
    }
    .submit-btn:active { opacity: 0.85; }
    .submit-btn:disabled { background: #bbb; cursor: not-allowed; }
    .form-error { color: #e53e3e; font-size: 12px; margin-top: 4px; }
    .x-loading-spinner {
      width: 28px; height: 28px; border: 3px solid #333; border-top-color: #1D9BF0;
      border-radius: 50%; animation: x-spin 0.8s linear infinite;
    }
    @keyframes x-spin { to { transform: rotate(360deg); } }
    .x-autocomplete-wrap { position: relative; }
    .x-suggest-list {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 100;
      background: #1a1a1a; border: 1.5px solid #333; border-radius: 8px;
      list-style: none; margin: 0; padding: 4px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      max-height: 240px; overflow-y: auto;
    }
    .x-suggest-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; cursor: pointer; transition: background 0.1s;
    }
    .x-suggest-item:hover, .x-suggest-item.focused { background: #2a2a2a; }
    .x-suggest-avatar {
      width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
      background: #333;
    }
    .x-suggest-avatar-placeholder {
      width: 32px; height: 32px; border-radius: 50%; background: #444;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #aaa; flex-shrink: 0;
    }
    .x-suggest-names { display: flex; flex-direction: column; overflow: hidden; }
    .x-suggest-display { font-size: 14px; font-weight: 600; color: #f0f0f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x-suggest-username { font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x-suggest-hint { font-size: 12px; color: #888; margin-top: 4px; }
    .x-conditions-card {
      margin-top: 12px;
      padding: 16px;
      background: #111;
      border-radius: 12px;
      border: 1px solid #222;
    }
    .x-condition-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #1a1a1a;
      font-size: 14px;
      color: #ccc;
    }
    .x-condition-row:last-child { border-bottom: none; }
    .x-condition-check {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .x-condition-check.pass {
      background: rgba(6, 199, 85, 0.15);
      color: #06C755;
      border: 2px solid #06C755;
    }
    .x-condition-check.fail {
      background: rgba(229, 62, 62, 0.15);
      color: #e53e3e;
      border: 2px solid #e53e3e;
    }
    .x-condition-check.na {
      background: rgba(255,255,255,0.05);
      color: #555;
      border: 2px solid #333;
    }
    .x-condition-check.checking {
      background: rgba(255,255,255,0.05);
      color: #888;
      border: 2px solid #444;
    }
    .x-condition-check.checking .spin {
      display: inline-block;
      animation: spin 1s linear infinite;
      font-size: 12px;
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .x-conditions-summary {
      margin-top: 12px;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
    }
    .x-conditions-summary.pass {
      background: rgba(6, 199, 85, 0.1);
      color: #06C755;
      border: 1px solid rgba(6, 199, 85, 0.3);
    }
    .x-conditions-summary.fail {
      background: rgba(229, 62, 62, 0.1);
      color: #e53e3e;
      border: 1px solid rgba(229, 62, 62, 0.3);
    }
    .form-success { text-align: center; padding: 40px 20px; }
    .form-success .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    .form-success h2 { font-size: 20px; color: #06C755; margin-bottom: 12px; }
    .form-success p { font-size: 14px; color: #666; line-height: 1.6; }
    .consultation-card { background:#fff; border-radius:16px; padding:20px; box-shadow:0 1px 4px rgba(0,0,0,.1); }
    .consultation-head { text-align:center; margin-bottom:20px; }
    .consultation-head .calendar-icon { font-size:32px; line-height:1; }
    .consultation-head h2 { margin:8px 0 6px; font-size:21px; color:#1f2937; }
    .consultation-head p { margin:0; font-size:13px; line-height:1.6; color:#6b7280; }
    .consultation-date { margin-top:18px; }
    .consultation-date h3 { margin:0 0 8px; font-size:14px; color:#374151; }
    .consultation-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
    .slot-btn { border:1.5px solid #06C755; border-radius:9px; padding:11px 4px; background:#fff; color:#049f45; font-size:14px; font-weight:700; cursor:pointer; }
    .slot-btn:active { background:#ecfdf3; }
    .slot-btn:disabled { opacity:.45; cursor:not-allowed; }
    .consultation-status { margin:14px 0 0; text-align:center; font-size:13px; color:#dc2626; font-weight:600; }
    .consultation-loading { text-align:center; padding:44px 20px; }
    .consultation-loading h2 { margin:14px 0 6px; font-size:20px; color:#1f2937; }
    .consultation-loading p { margin:0; color:#6b7280; font-size:14px; }
    .consultation-spinner { width:30px; height:30px; margin:0 auto; border:3px solid #d1fae5; border-top-color:#06C755; border-radius:50%; animation:x-spin .8s linear infinite; }
    .consultation-empty { margin:16px 0 0; padding:18px; border-radius:12px; background:#f9fafb; text-align:center; color:#6b7280; font-size:14px; }
    .consultation-primary { display:block; width:100%; box-sizing:border-box; margin-top:16px; padding:13px 16px; border:0; border-radius:999px; background:#06C755; color:#fff; text-align:center; text-decoration:none; font-size:15px; font-weight:700; cursor:pointer; }
    .consultation-secondary { display:block; margin:14px auto 0; border:0; background:transparent; color:#6b7280; font-size:13px; text-decoration:underline; cursor:pointer; }
    .consultation-confirmed { text-align:center; }
    .consultation-confirmed .check { font-size:38px; }
    .consultation-confirmed h2 { margin:8px 0; color:#1f2937; font-size:21px; }
    .consultation-confirmed .time { margin:14px 0; padding:13px; border-radius:12px; background:#ecfdf3; color:#166534; font-size:17px; font-weight:700; }
    .consultation-confirmed .note { color:#6b7280; font-size:12px; line-height:1.6; }
  `;
  document.head.appendChild(style);
}

// ========== Main Render ==========

function render(): void {
  const { formDef, profile } = state;
  if (!formDef) return;

  injectStyles();
  const app = getApp();
  const profileHtml = (formDef.hideProfile || !profile?.pictureUrl)
    ? ''
    : `<div class="form-profile">
        <img src="${profile.pictureUrl}" alt="" />
        <span>${escapeHtml(profile.displayName)} さん</span>
      </div>`;

  // Split fields: survey fields (page 1) vs x_username field (page 2)
  const surveyFields = formDef.fields.filter((f) => f.name !== 'x_username');
  const xUsernameField = formDef.fields.find((f) => f.name === 'x_username');
  const hasTwoPages = !!xUsernameField && formDef.hasSubmitWebhook;

  const surveyFieldsHtml = surveyFields.map(renderField).join('');
  const xFieldHtml = xUsernameField ? renderField(xUsernameField) : '';

  if (hasTwoPages) {
    // ─── 2-page layout ───
    app.innerHTML = `
      <div class="form-page">
        <div class="form-header">
          <h1>${escapeHtml(formDef.name).replace(/\\n|\n/g, '<br>')}</h1>
          ${formDef.description && !formDef.hasSubmitWebhook ? `<p class="form-description">${escapeHtml(formDef.description).replace(/\\n|\n/g, '<br>')}</p>` : ''}
          ${profileHtml}
        </div>
        <!-- Page 1: Survey -->
        <div id="form-page-1">
          <form id="survey-form" class="form-body" novalidate>
            ${surveyFieldsHtml}
            <button type="submit" class="submit-btn" id="nextBtn">次へ →</button>
          </form>
        </div>
        <!-- Page 2: X-Link -->
        <div id="form-page-2" hidden>
          <div class="form-header" style="padding-top:0">
            <h1>X-Link で受け取り</h1>
          </div>
          <form id="liff-form" class="form-body" novalidate>
            ${xFieldHtml}
            <button type="submit" class="submit-btn" id="submitBtn">X Harness を受け取る</button>
          </form>
        </div>
      </div>
    `;

    // Page 1 → Page 2 transition
    document.getElementById('survey-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Validate survey fields
      for (const field of surveyFields) {
        if (!field.required) continue;
        if (field.type === 'checkbox') {
          const checked = document.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]:checked`);
          if (checked.length === 0) {
            showFieldError(`${field.label} は必須項目です`);
            return;
          }
        } else if (field.type === 'radio') {
          const checked = document.querySelector<HTMLInputElement>(`input[name="${field.name}"]:checked`);
          if (!checked) {
            showFieldError(`${field.label} は必須項目です`);
            return;
          }
        } else {
          const el = document.querySelector<HTMLInputElement>(`[name="${field.name}"]`);
          if (!el || !el.value.trim()) {
            showFieldError(`${field.label} は必須項目です`);
            return;
          }
        }
      }

      // Save survey data (partial submit)
      const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;
      nextBtn.disabled = true;
      nextBtn.textContent = '保存中...';

      const surveyData: Record<string, unknown> = {};
      for (const field of surveyFields) {
        if (field.type === 'checkbox') {
          surveyData[field.name] = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]:checked`)).map((el) => el.value);
        } else if (field.type === 'radio') {
          surveyData[field.name] = document.querySelector<HTMLInputElement>(`input[name="${field.name}"]:checked`)?.value ?? '';
        } else {
          surveyData[field.name] = (document.querySelector<HTMLInputElement>(`[name="${field.name}"]`)?.value ?? '').trim();
        }
      }

      try {
        await apiCall(`/api/forms/${formDef.id}/partial`, {
          method: 'POST',
          body: JSON.stringify({ data: surveyData }),
        });
      } catch { /* non-blocking */ }

      // Transition to page 2
      document.getElementById('form-page-1')!.hidden = true;
      document.getElementById('form-page-2')!.hidden = false;
      window.scrollTo(0, 0);

      // Show loading overlay if replier pool is still loading
      if (!_replierPoolReady) {
        const xInput = document.querySelector<HTMLInputElement>('.x-autocomplete-input');
        if (xInput) xInput.disabled = true;
        const wrap = document.querySelector('.x-autocomplete-wrap');
        if (wrap) {
          const overlay = document.createElement('div');
          overlay.id = 'x-loading-overlay';
          overlay.innerHTML = '<div class="x-loading-spinner"></div><p>X連携データを読み込み中...</p>';
          overlay.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0;color:#888;font-size:14px;';
          wrap.parentElement?.insertBefore(overlay, wrap);
        }
      }
    });

    attachFormEvents();
  } else {
    // ─── Single page layout (original) ───
    const fieldsHtml = formDef.fields.map(renderField).join('');
    app.innerHTML = `
      <div class="form-page">
        <div class="form-header">
          <h1>${escapeHtml(formDef.name).replace(/\\n|\n/g, '<br>')}</h1>
          ${formDef.description && !formDef.hasSubmitWebhook ? `<p class="form-description">${escapeHtml(formDef.description).replace(/\\n|\n/g, '<br>')}</p>` : ''}
          ${profileHtml}
        </div>
        <form id="liff-form" class="form-body" novalidate>
          ${fieldsHtml}
          <button type="submit" class="submit-btn" id="submitBtn">送信する</button>
        </form>
      </div>
    `;

    attachFormEvents();
  }
}

async function showSubmitConditions(conditions: Record<string, boolean | null>, passed: boolean): Promise<void> {
  const existing = document.getElementById('submit-conditions');
  if (existing) existing.remove();

  const labels: Array<[string, string]> = [['reply', 'リプライ'], ['like', 'いいね'], ['repost', 'リポスト'], ['follow', 'フォロー']];

  const container = document.createElement('div');
  container.id = 'submit-conditions';
  container.innerHTML = '<div class="x-conditions-card" id="condition-card"></div>';

  const btn = document.getElementById('submitBtn');
  btn?.parentElement?.insertBefore(container, btn);

  const card = document.getElementById('condition-card')!;

  // Animate each condition one by one
  for (const [key, label] of labels) {
    const val = conditions[key];
    if (val === null || val === undefined) continue; // skip non-required

    // Show "checking" state
    const row = document.createElement('div');
    row.className = 'x-condition-row';
    row.innerHTML = `<div class="x-condition-check checking"><span class="spin">⏳</span></div><span>${label}を確認中...</span>`;
    card.appendChild(row);

    // Wait for dramatic effect
    await new Promise(r => setTimeout(r, 600));

    // Reveal result
    if (val) {
      row.innerHTML = `<div class="x-condition-check pass">✓</div><span>${label}</span>`;
    } else {
      row.innerHTML = `<div class="x-condition-check fail">✗</div><span>${label}</span>`;
    }
  }

  // Final summary after all checks
  await new Promise(r => setTimeout(r, 400));

  const summary = document.createElement('div');
  if (passed) {
    summary.className = 'x-conditions-summary pass';
    summary.textContent = '🎉 条件クリア！';
  } else {
    summary.className = 'x-conditions-summary fail';
    summary.innerHTML = '条件を満たしていません<br><span style="font-size:12px;font-weight:normal">ポストにいいね・リプライ・リポストしてから再度お試しください</span>';
  }
  container.appendChild(summary);
}

function renderWebhookSuccess(message: string): void {
  const app = getApp();
  const lines = message.split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  app.innerHTML = `
    <div class="form-page">
      <div class="success-card">
        <div class="success-icon">🎉</div>
        <h2>おめでとうございます！</h2>
        <div class="success-message">${lines}</div>
        <button class="close-btn" id="closeBtn">閉じる</button>
      </div>
    </div>
  `;

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });
}

function renderSuccess(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>送信完了！</h2>
        <p class="success-message">ご回答ありがとうございました。</p>
        <button class="close-btn" id="closeBtn">閉じる</button>
      </div>
    </div>
  `;

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });

  // Auto-close after 3s inside LINE
  if (liff.isInClient()) {
    setTimeout(() => {
      try { liff.closeWindow(); } catch { /* ignore */ }
    }, 3000);
  }
}

function consultationDateTime(startsAt: string): string {
  return new Date(startsAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function consultationDateLabel(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function closeFormWindow(): void {
  if (liff.isInClient()) {
    liff.closeWindow();
  } else {
    window.close();
  }
}

function renderConsultationConfirmed(booking: BookedConsultation): void {
  const app = getApp();
  const meetUrl = safeHttpsUrl(booking.meetUrl);
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card consultation-confirmed">
        <div class="check">✅</div>
        <h2>個別相談が確定しました</h2>
        <div class="time">${escapeHtml(consultationDateTime(booking.startsAt))}</div>
        ${meetUrl ? `<a class="consultation-primary" href="${escapeHtml(meetUrl)}" target="_blank" rel="noreferrer">Google Meetを確認する</a>` : ''}
        <p class="note">LINEにも参加リンクを送りました。前日と開始1時間前にもお知らせします。</p>
        <button class="consultation-secondary" id="closeConsultationBtn">閉じる</button>
      </div>
    </div>
  `;
  document.getElementById('closeConsultationBtn')?.addEventListener('click', closeFormWindow);
  window.scrollTo(0, 0);
}

function renderConsultationFallback(
  webinarSlug: string,
  message: string,
  fallbackUrl: string | null = null,
): void {
  const app = getApp();
  const safeFallbackUrl = safeHttpsUrl(fallbackUrl);
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card">
        <div class="consultation-head">
          <div class="calendar-icon">📅</div>
          <h2>回答を受け付けました</h2>
          <p>${escapeHtml(message)}</p>
        </div>
        ${safeFallbackUrl ? `<a class="consultation-primary" href="${escapeHtml(safeFallbackUrl)}">予約カレンダーを開く</a>` : '<button class="consultation-primary" id="retryConsultationBtn">空き枠を再読み込み</button>'}
        <button class="consultation-secondary" id="closeConsultationBtn">あとで予約する</button>
      </div>
    </div>
  `;
  document.getElementById('retryConsultationBtn')?.addEventListener('click', () => {
    void renderConsultationBooking(webinarSlug);
  });
  document.getElementById('closeConsultationBtn')?.addEventListener('click', closeFormWindow);
  window.scrollTo(0, 0);
}

function renderConsultationSlots(
  webinarSlug: string,
  availability: ConsultationAvailability,
): void {
  const existing = availability.existingBooking;
  if (existing?.status === 'confirmed' && existing.meetUrl) {
    renderConsultationConfirmed({
      bookingId: existing.bookingId,
      status: 'confirmed',
      startsAt: existing.startsAt,
      endsAt: '',
      meetUrl: existing.meetUrl,
      externalEventId: '',
      created: false,
    });
    return;
  }

  if (!availability.calendarReady) {
    renderConsultationFallback(
      webinarSlug,
      '空き枠を自動取得できませんでした。予約カレンダーから日時を選んでください。',
      availability.fallbackUrl,
    );
    return;
  }

  const grouped = availability.slots.reduce<Record<string, ConsultationSlot[]>>((all, slot) => {
    (all[slot.date] ??= []).push(slot);
    return all;
  }, {});
  const slotHtml = Object.entries(grouped).map(([date, slots]) => `
    <section class="consultation-date">
      <h3>${escapeHtml(consultationDateLabel(date))}</h3>
      <div class="consultation-grid">
        ${slots.map((slot) => `<button class="slot-btn" data-starts-at="${escapeHtml(slot.startsAt)}">${escapeHtml(slot.start)}</button>`).join('')}
      </div>
    </section>
  `).join('');

  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card">
        <div class="consultation-head">
          <div class="calendar-icon">📅</div>
          <h2>このまま相談日時を確定</h2>
          <p>空いている15分枠だけを表示しています。<br>選ぶとGoogle Meetまで自動発行されます。</p>
        </div>
        ${slotHtml || '<div class="consultation-empty">現在、選べる枠がありません。</div>'}
        <p class="consultation-status" id="consultationStatus" hidden></p>
        <button class="consultation-secondary" id="closeConsultationBtn">あとで予約する</button>
      </div>
    </div>
  `;

  document.querySelectorAll<HTMLButtonElement>('.slot-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const startsAt = button.dataset.startsAt;
      if (!startsAt) return;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.slot-btn'));
      const status = document.getElementById('consultationStatus');
      buttons.forEach((item) => { item.disabled = true; });
      const original = button.textContent;
      button.textContent = '確定中...';
      if (status) status.hidden = true;
      try {
        const response = await apiCall(
          `/api/liff/webinars/${encodeURIComponent(webinarSlug)}/consultation-book`,
          { method: 'POST', body: JSON.stringify({ startsAt }) },
        );
        const json = await response.json() as {
          ok?: boolean;
          data?: BookedConsultation;
          error?: string;
        };
        if (!response.ok || !json.ok || !json.data) {
          if (response.status === 409) {
            await renderConsultationBooking(webinarSlug);
            return;
          }
          throw new Error(json.error || '日程を確定できませんでした');
        }
        renderConsultationConfirmed(json.data);
      } catch {
        buttons.forEach((item) => { item.disabled = false; });
        button.textContent = original;
        if (status) {
          status.textContent = '日程を確定できませんでした。もう一度お試しください。';
          status.hidden = false;
        }
      }
    });
  });
  document.getElementById('closeConsultationBtn')?.addEventListener('click', closeFormWindow);
  window.scrollTo(0, 0);
}

async function renderConsultationBooking(webinarSlug: string): Promise<void> {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card consultation-loading">
        <div class="consultation-spinner"></div>
        <h2>回答を受け付けました</h2>
        <p>実際の空き枠を確認しています...</p>
      </div>
    </div>
  `;
  window.scrollTo(0, 0);
  try {
    const response = await apiCall(
      `/api/liff/webinars/${encodeURIComponent(webinarSlug)}/consultation-slots`,
    );
    const json = await response.json() as {
      ok?: boolean;
      data?: ConsultationAvailability;
      error?: string;
    };
    if (!response.ok || !json.ok || !json.data) {
      throw new Error(json.error || 'availability_failed');
    }
    renderConsultationSlots(webinarSlug, json.data);
  } catch {
    renderConsultationFallback(
      webinarSlug,
      '空き枠を読み込めませんでした。通信環境を確認して、もう一度お試しください。',
    );
  }
}

function renderFormError(message: string): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card">
        <h2 style="color: #e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function showFieldError(message: string): void {
  const existing = getApp().querySelector('.form-error-msg');
  if (existing) existing.remove();
  const errEl = document.createElement('p');
  errEl.className = 'form-error-msg';
  errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
  errEl.textContent = message;
  const btn = document.getElementById('nextBtn') || document.getElementById('submitBtn');
  btn?.parentElement?.insertBefore(errEl, btn);
}

function renderLoading(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card" style="text-align:center;padding:40px 20px;">
        <div class="loading-spinner"></div>
        <p style="margin-top:12px;color:#718096;">読み込み中...</p>
      </div>
    </div>
  `;
}

// ========== Form Submission ==========

function collectFormData(): Record<string, unknown> {
  const { formDef } = state;
  if (!formDef) return {};

  const result: Record<string, unknown> = {};

  for (const field of formDef.fields) {
    if (field.type === 'checkbox') {
      const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `input[name="${field.name}"]:checked`,
        ),
      ).map((el) => el.value);
      result[field.name] = checked;
    } else if (field.type === 'radio') {
      const checked = document.querySelector<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      result[field.name] = checked?.value ?? '';
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${field.name}"]`,
      );
      result[field.name] = el?.value ?? '';
    }
  }

  return result;
}

function validateForm(): string | null {
  const { formDef } = state;
  if (!formDef) return null;

  for (const field of formDef.fields) {
    if (!field.required) continue;

    if (field.type === 'checkbox') {
      const checked = document.querySelectorAll<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      if (checked.length === 0) return `${field.label} は必須項目です`;
    } else if (field.type === 'radio') {
      const checked = document.querySelector<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      if (!checked) return `${field.label} は必須項目です`;
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${field.name}"]`,
      );
      if (!el || !el.value.trim()) return `${field.label} は必須項目です`;
    }
  }

  return null;
}

async function submitForm(): Promise<void> {
  if (state.submitting || !state.formDef) return;

  const validationError = validateForm();
  if (validationError) {
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
    errEl.textContent = validationError;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn?.parentElement?.insertBefore(errEl, submitBtn);
    return;
  }

  state.submitting = true;
  const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';
  }

  try {
    const data = collectFormData();
    console.log('Form data collected:', JSON.stringify(data));

    // Webhook gate — pre-verified by /repliers endpoint
    if (state.formDef.hasSubmitWebhook) {
      // Check that user was selected from pre-verified repliers list
      const xField = ((data.x_username as string) ?? '').trim().replace(/^@/, '');
      if (!xField || xField !== state.verifiedXUsername) {
        state.submitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '送信する'; }
        const existing = getApp().querySelector('.form-error-msg');
        if (existing) existing.remove();
        const errEl = document.createElement('p');
        errEl.className = 'form-error-msg';
        errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
        errEl.textContent = !xField
          ? 'X IDを入力してください'
          : 'X IDを入力後、入力欄の外をタップして確認してください';
        submitBtn?.parentElement?.insertBefore(errEl, submitBtn);
        return;
      }

      // Show success animation (conditions already verified by repliers endpoint)
      const allPassConditions: Record<string, boolean | null> = {
        reply: true,
        like: true,
        repost: true,
        follow: true,
      };
      if (submitBtn) submitBtn.textContent = '判定中...';
      await showSubmitConditions(allPassConditions, true);
      await new Promise(r => setTimeout(r, 500));

      // Webhook passed — submit data to server, then show success
      // If message is Flex JSON, show generic success (Flex is sent via LINE push)
      const rawMsg = state.formDef.onSubmitMessageContent || '条件をクリアしました！';
      const successMsg = rawMsg.trimStart().startsWith('{') ? '特典をLINEでお送りしました！' : rawMsg;
      // Fall through to submit below, then show webhook success
      const webhookBody: Record<string, unknown> = { data: { ...data } };
      if (state.refTrackedLinkId) webhookBody.trackedLinkId = state.refTrackedLinkId;

      const webhookSubmitRes = await apiCall(`/api/forms/${state.formDef.id}/submit`, {
        method: 'POST',
        body: JSON.stringify(webhookBody),
      });
      if (!webhookSubmitRes.ok) {
        const errText = await webhookSubmitRes.text().catch(() => '');
        let errMsg = '送信に失敗しました';
        try { const errData = JSON.parse(errText); errMsg = errData.error || errMsg; } catch { errMsg = errText || errMsg; }
        throw new Error(`${webhookSubmitRes.status}: ${errMsg}`);
      }
      // Check server-side webhook recheck result
      const submitResult = await webhookSubmitRes.clone().json().catch(() => null) as { data?: { webhookPassed?: boolean } } | null;
      if (submitResult?.data?.webhookPassed === false) {
        throw new Error(state.formDef.onSubmitWebhookFailMessage || '条件を満たしていません');
      }
      renderWebhookSuccess(successMsg);
      return;
    }

    const body: Record<string, unknown> = { data };
    if (state.refTrackedLinkId) body.trackedLinkId = state.refTrackedLinkId;
    console.log('Submitting to:', `/api/forms/${state.formDef.id}/submit`);

    const res = await apiCall(`/api/forms/${state.formDef.id}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    console.log('Response status:', res.status);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = '送信に失敗しました';
      try { const errData = JSON.parse(errText); errMsg = errData.error || errMsg; } catch { errMsg = errText || errMsg; }
      throw new Error(`${res.status}: ${errMsg}`);
    }

    if (state.formDef.consultationWebinarSlug) {
      await renderConsultationBooking(state.formDef.consultationWebinarSlug);
    } else {
      renderSuccess();
    }
  } catch (err) {
    state.submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '送信する';
    }
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.style.cssText = 'color:#e53e3e;font-size:14px;margin:8px 0;text-align:center;';
    errEl.textContent = err instanceof Error ? err.message : '送信に失敗しました';
    const btn = document.getElementById('submitBtn');
    btn?.parentElement?.insertBefore(errEl, btn);
  }
}

function attachXAutocomplete(): void {
  const input = document.querySelector<HTMLInputElement>('.x-autocomplete-input');
  if (!input) return;

  const suggestList = document.getElementById('x-suggest-list') as HTMLUListElement | null;
  const hint = document.getElementById('x-suggest-hint');
  const conditionsEl = document.getElementById('x-conditions');
  const conditionsResult = document.getElementById('x-conditions-result');
  if (!suggestList) return;

  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  let focusedIndex = -1;
  let replierPool: XFollowerSuggestion[] = [];

  // Prefetch repliers on form load
  const gateIdForPool = getGateId();
  if (state.xHarnessBaseUrl && gateIdForPool) {
    fetch(`${state.xHarnessBaseUrl}/api/engagement-gates/${encodeURIComponent(gateIdForPool)}/repliers`)
      .then(r => r.json())
      .then((json: { success: boolean; data?: XFollowerSuggestion[] }) => {
        replierPool = json.data ?? [];
        _replierPoolReady = true;
        // If page 2 is already visible, remove loading overlay
        const overlay = document.getElementById('x-loading-overlay');
        if (overlay) {
          overlay.remove();
          input.disabled = false;
          input.focus();
        }
      })
      .catch(() => {
        _replierPoolReady = true;
        const overlay = document.getElementById('x-loading-overlay');
        if (overlay) {
          overlay.remove();
          input.disabled = false;
        }
      });
  } else {
    _replierPoolReady = true;
  }

  function hideConditions(): void {
    if (conditionsEl) conditionsEl.hidden = true;
    if (conditionsResult) conditionsResult.hidden = true;
  }

  function hideSuggestions(): void {
    suggestList!.hidden = true;
    suggestList!.innerHTML = '';
    focusedIndex = -1;
    if (hint) hint.hidden = true;
  }

  function selectSuggestion(username: string): void {
    input!.value = username;
    state.verifiedXUsername = username;
    hideSuggestions();
    input!.focus();
    void triggerVerify(username);
  }

  function updateFocus(items: NodeListOf<Element>): void {
    items.forEach((el, i) => {
      el.classList.toggle('focused', i === focusedIndex);
    });
    const focused = items[focusedIndex] as HTMLElement | undefined;
    focused?.scrollIntoView({ block: 'nearest' });
  }

  interface VerifyCondition {
    type: string;
    label: string;
    required: boolean;
    passed: boolean;
  }

  interface VerifyResult {
    eligible: boolean;
    userNotFound?: boolean;
    conditions?: VerifyCondition[];
  }

  function renderConditions(result: VerifyResult): void {
    if (!conditionsEl || !conditionsResult) return;

    if (result.userNotFound) {
      conditionsEl.hidden = true;
      conditionsResult.innerHTML = '❌ Xアカウントが見つかりません<br><span style="font-size:11px;font-weight:normal">IDを確認してもう一度お試しください</span>';
      conditionsResult.className = 'x-conditions-summary fail';
      conditionsResult.hidden = false;
      return;
    }

    const conditionDefs = [
      { key: 'reply', label: 'リプライ' },
      { key: 'like', label: 'いいね' },
      { key: 'repost', label: 'リポスト' },
      { key: 'follow', label: 'フォロー' },
    ];

    const conditions = result.conditions ?? [];

    // Build a lookup by type
    const condMap: Record<string, VerifyCondition> = {};
    for (const c of conditions) {
      condMap[c.type] = c;
    }

    let rowsHtml = '';
    for (const def of conditionDefs) {
      const cond = condMap[def.key];
      if (!cond) continue; // not part of this gate, skip
      if (!cond.required) {
        rowsHtml += `
          <div class="x-condition-row">
            <div class="x-condition-check na">—</div>
            <span>${escapeHtml(def.label)}</span>
          </div>`;
      } else if (cond.passed) {
        rowsHtml += `
          <div class="x-condition-row">
            <div class="x-condition-check pass">✓</div>
            <span>${escapeHtml(def.label)}</span>
          </div>`;
      } else {
        rowsHtml += `
          <div class="x-condition-row">
            <div class="x-condition-check fail">✗</div>
            <span>${escapeHtml(def.label)}</span>
          </div>`;
      }
    }

    if (rowsHtml) {
      conditionsEl.innerHTML = `<div class="x-conditions-card">${rowsHtml}</div>`;
      conditionsEl.hidden = false;
    } else {
      conditionsEl.hidden = true;
    }

    if (result.eligible) {
      conditionsResult.textContent = '🎉 条件クリア！特典を受け取れます';
      conditionsResult.className = 'x-conditions-summary pass';
    } else {
      conditionsResult.textContent = '条件を満たしていません';
      conditionsResult.className = 'x-conditions-summary fail';
    }
    conditionsResult.hidden = false;
  }

  async function triggerVerify(username: string): Promise<void> {
    const clean = username.trim().replace(/^@/, '');
    if (!state.xHarnessBaseUrl || !clean) return;
    const gateId = getGateId();
    if (!gateId) return;

    try {
      const url = `${state.xHarnessBaseUrl}/api/engagement-gates/${encodeURIComponent(gateId)}/verify?username=${encodeURIComponent(clean)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('verify failed');
      const json = await res.json() as { success: boolean; data?: VerifyResult };
      const verifyData = json.data;
      if (verifyData) {
        renderConditions(verifyData);
        // Mark as verified so submit is allowed even without selecting from suggestions
        // Allow submit for any verified user (server-side webhook does final eligibility check)
        if (!verifyData.userNotFound) {
          state.verifiedXUsername = clean;
          if (input) input.value = clean; // normalize input (strip @)
        }
      }
    } catch {
      // Hide stale gate condition rows before showing the error message
      hideConditions();
      // Show helpful message on verify error (e.g. X API down)
      if (conditionsResult) {
        conditionsResult.innerHTML = '⚠️ 確認中にエラーが発生しました<br><span style="font-size:11px;font-weight:normal">しばらく待ってからもう一度お試しください</span>';
        conditionsResult.className = 'x-conditions-summary fail';
        conditionsResult.hidden = false;
      }
    }
  }

  function showSuggestions(suggestions: XFollowerSuggestion[]): void {
    suggestList!.innerHTML = '';
    focusedIndex = -1;

    if (suggestions.length === 0) {
      suggestList!.hidden = true;
      if (hint) {
        hint.innerHTML = replierPool.length === 0
          ? '<span style="color:#e53e3e">⏳ まだリアクションがありません</span><br><span style="font-size:11px;color:#888">ポストにリポスト＆フォローしてから再度お試しください</span>'
          : '<span style="color:#888">候補に表示されなくても、そのままIDを入力して送信できます</span>';
        hint.hidden = false;
      }
      return;
    }

    if (hint) hint.hidden = true;
    for (const s of suggestions) {
      const li = document.createElement('li');
      li.className = 'x-suggest-item';
      li.dataset.username = s.username;
      const avatarHtml = s.profileImageUrl
        ? `<img class="x-suggest-avatar" src="${escapeHtml(s.profileImageUrl)}" alt="" />`
        : `<div class="x-suggest-avatar-placeholder">@</div>`;
      li.innerHTML = `
        ${avatarHtml}
        <div class="x-suggest-names">
          <span class="x-suggest-display">${escapeHtml(s.displayName)}</span>
          <span class="x-suggest-username">@${escapeHtml(s.username)}</span>
        </div>
      `;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent input blur before click
        selectSuggestion(s.username);
      });
      suggestList!.appendChild(li);
    }
    suggestList!.hidden = false;
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().replace(/^@/, ''); // strip leading @
    if (verifyTimer !== null) clearTimeout(verifyTimer);
    // Clear verified flag when user types manually
    if (q !== state.verifiedXUsername) state.verifiedXUsername = '';

    if (!q) {
      hideSuggestions();
      hideConditions();
      return;
    }

    if (q.length < 3) {
      hideSuggestions();
      hideConditions();
      if (hint) { hint.textContent = '3文字以上入力してください'; hint.hidden = false; }
      return;
    }

    if (hint) hint.hidden = true;
    const qLower = q.toLowerCase();
    const matches = replierPool.filter(r =>
      r.username.toLowerCase().includes(qLower) ||
      r.displayName.toLowerCase().includes(qLower)
    ).slice(0, 5);
    showSuggestions(matches);
  });

  input.addEventListener('keydown', (e) => {
    const items = suggestList!.querySelectorAll('.x-suggest-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      updateFocus(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
      updateFocus(items);
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault();
      const focused = items[focusedIndex] as HTMLElement;
      const username = focused.dataset.username;
      if (username) selectSuggestion(username);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  input.addEventListener('blur', () => {
    // Small delay so mousedown on suggestion can fire first
    setTimeout(() => {
      hideSuggestions();
      // Trigger verify on blur if input has a value
      const username = input.value.trim().replace(/^@/, '');
      if (username && getGateId()) {
        if (verifyTimer !== null) clearTimeout(verifyTimer);
        verifyTimer = setTimeout(() => {
          void triggerVerify(username);
        }, 300);
      }
    }, 150);
  });
}

function attachFormEvents(): void {
  const form = document.getElementById('liff-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitForm();
  });
  attachXAutocomplete();
}

// ========== Init ==========

export async function initForm(formId: string | null): Promise<void> {
  if (!formId) {
    renderFormError('フォームIDが指定されていません');
    return;
  }

  renderLoading();

  try {
    // Fetch profile and form definition in parallel
    const [profile, res] = await Promise.all([
      liff.getProfile(),
      apiCall(`/api/forms/${formId}`),
    ]);

    state.profile = profile;

    // Try to get friendId from local storage (set by main UUID linking flow)
    try {
      state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
    } catch {
      // silent
    }

    // Silent UUID linking (best-effort, so friend metadata saves correctly)
    const rawIdToken = liff.getIDToken();
    if (rawIdToken) {
      apiCall('/api/liff/link', {
        method: 'POST',
        body: JSON.stringify({
          idToken: rawIdToken,
          displayName: profile.displayName,
          existingUuid: state.friendId,
        }),
      }).then(async (linkRes) => {
        if (linkRes.ok) {
          const data = await linkRes.json() as { success: boolean; data?: { userId?: string } };
          if (data?.data?.userId) {
            try {
              localStorage.setItem(UUID_STORAGE_KEY, data.data.userId);
              state.friendId = data.data.userId;
            } catch { /* silent */ }
          }
        }
      }).catch(() => { /* silent */ });
    }

    if (!res.ok) {
      if (res.status === 404) {
        renderFormError('フォームが見つかりません');
      } else {
        renderFormError('フォームの読み込みに失敗しました');
      }
      return;
    }

    const json = await res.json() as { success: boolean; data?: FormDef };
    if (!json.success || !json.data) {
      renderFormError('フォームの読み込みに失敗しました');
      return;
    }

    if (!json.data.isActive) {
      renderFormError('このフォームは現在受付を停止しています');
      return;
    }

    state.formDef = json.data;

    // Use only the trusted origin derived from the stored webhook. The raw
    // webhook path/query and secret headers never reach the browser.
    const urlParams = new URLSearchParams(window.location.search);
    const xhParam = urlParams.get('xh');
    const requestedOrigin = xhParam?.replace(/\/$/, '') ?? null;
    state.xHarnessBaseUrl =
      requestedOrigin && requestedOrigin === json.data.webhookOrigin
        ? requestedOrigin
        : json.data.webhookOrigin;

    // Capture tracked link ref so submit can attribute reward to this campaign
    const refParam = urlParams.get('ref');
    if (refParam) {
      state.refTrackedLinkId = refParam;
    }

    render();

    // Record form open event (fire-and-forget)
    apiCall(`/api/forms/${state.formDef!.id}/opened`, {
      method: 'POST',
      body: JSON.stringify({}),
    }).catch(() => { /* silent */ });
  } catch (err) {
    renderFormError(err instanceof Error ? err.message : 'エラーが発生しました');
  }
}
