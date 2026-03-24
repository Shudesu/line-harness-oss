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

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';
const UUID_STORAGE_KEY = 'lh_uuid';

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
}

interface FormState {
  formDef: FormDef | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  submitting: boolean;
}

const state: FormState = {
  formDef: null,
  profile: null,
  friendId: null,
  submitting: false,
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
      ...options?.headers,
    },
  });
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Field Rendering ==========

function renderField(field: FormField): string {
  const required = field.required ? ' required' : '';
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const requiredMark = field.required ? '<span class="required-mark">*</span>' : '';

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
      inputHtml = `<div class="radio-group">${radios}</div>`;
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
      inputHtml = `<div class="checkbox-group">${boxes}</div>`;
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
    .radio-label, .checkbox-label {
      display: flex; align-items: center; gap: 8px; font-size: 15px; color: #333;
      padding: 10px 12px; background: #fafafa; border-radius: 8px; border: 1.5px solid #e0e0e0;
      cursor: pointer; transition: border-color 0.15s;
    }
    .radio-label:has(input:checked), .checkbox-label:has(input:checked) {
      border-color: #06C755; background: #e8faf0;
    }
    .radio-label input, .checkbox-label input { accent-color: #06C755; width: 18px; height: 18px; }
    .submit-btn {
      width: 100%; padding: 14px; border: none; border-radius: 8px;
      background: #06C755; color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; font-family: inherit; margin-top: 8px; transition: opacity 0.15s;
    }
    .submit-btn:active { opacity: 0.85; }
    .submit-btn:disabled { background: #bbb; cursor: not-allowed; }
    .form-error { color: #e53e3e; font-size: 12px; margin-top: 4px; }
    .form-success { text-align: center; padding: 40px 20px; }
    .form-success .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    .form-success h2 { font-size: 20px; color: #06C755; margin-bottom: 12px; }
    .form-success p { font-size: 14px; color: #666; line-height: 1.6; }
  `;
  document.head.appendChild(style);
}

// ========== Main Render ==========

function render(): void {
  const { formDef, profile } = state;
  if (!formDef) return;

  injectStyles();
  const app = getApp();
  const profileHtml = profile?.pictureUrl
    ? `<div class="form-profile">
        <img src="${profile.pictureUrl}" alt="" />
        <span>${escapeHtml(profile.displayName)} さん</span>
      </div>`
    : '';

  const fieldsHtml = formDef.fields.map(renderField).join('');

  app.innerHTML = `
    <div class="form-page">
      <div class="form-header">
        <h1>${escapeHtml(formDef.name)}</h1>
        ${formDef.description ? `<p class="form-description">${escapeHtml(formDef.description)}</p>` : ''}
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
    const body: Record<string, unknown> = { data };
    if (state.profile?.userId) body.lineUserId = state.profile.userId;
    // Note: state.friendId is users.id (UUID), not friends.id — don't send as friendId
    console.log('Submitting to:', `${API_URL}/api/forms/${state.formDef.id}/submit`);

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

    renderSuccess();
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

function attachFormEvents(): void {
  const form = document.getElementById('liff-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitForm();
  });
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
    render();
  } catch (err) {
    renderFormError(err instanceof Error ? err.message : 'エラーが発生しました');
  }
}
