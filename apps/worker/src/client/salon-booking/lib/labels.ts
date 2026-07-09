export interface SalonBookingLabels {
  headerBooking: string;
  headerHistory: string;
  headerAvailability: string;
  stepMenu: string;
  stepStaff: string;
  stepDateTime: string;
  stepConfirm: string;
  menuTitle: string;
  menuError: string;
  menuLoading: string;
  menuEmpty: string;
  staffTitle: string;
  staffError: string;
  staffLoading: string;
  staffEmpty: string;
  staffOptionalBadge: string;
  staffOptionalAvatar: string;
  confirmMenuLabel: string;
  confirmStaffLabel: string;
  confirmPriceLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  doneReplyLine: string;
  historyButton: string;
  historyContactNotice: string;
}

export const DEFAULT_LABELS: SalonBookingLabels = {
  headerBooking: 'ご予約',
  headerHistory: '予約履歴',
  headerAvailability: '空き状況',
  stepMenu: 'メニュー',
  stepStaff: '担当',
  stepDateTime: '日時',
  stepConfirm: '確認',
  menuTitle: 'メニューを選んでください',
  menuError: 'メニュー情報の取得に失敗しました',
  menuLoading: 'メニューを読み込み中…',
  menuEmpty: 'まだメニューが登録されていません',
  staffTitle: '担当を選んでください',
  staffError: 'スタッフ情報の取得に失敗しました',
  staffLoading: 'スタッフを読み込み中…',
  staffEmpty: 'このメニューを担当できるスタッフがいません',
  staffOptionalBadge: '指名なし枠',
  staffOptionalAvatar: '指',
  confirmMenuLabel: 'メニュー',
  confirmStaffLabel: '担当',
  confirmPriceLabel: '料金',
  noteLabel: 'ご要望（任意）',
  notePlaceholder: '髪型の希望、アレルギー、その他',
  doneReplyLine: 'お店からの返信をお待ちください。',
  historyButton: '予約履歴',
  historyContactNotice: '変更・キャンセルはお店に LINE で直接ご連絡ください',
};

export const RECRUIT_LABELS: SalonBookingLabels = {
  ...DEFAULT_LABELS,
  headerBooking: '面談予約',
  stepMenu: '内容',
  stepStaff: '担当者',
  menuTitle: 'ご希望の内容を選んでください',
  menuError: '内容情報の取得に失敗しました',
  menuLoading: '内容を読み込み中…',
  menuEmpty: 'まだ予約枠が準備されていません',
  staffTitle: '担当者を選んでください',
  staffError: '担当者情報の取得に失敗しました',
  staffLoading: '担当者を読み込み中…',
  staffEmpty: 'この内容を担当できる担当者がいません',
  staffOptionalBadge: 'どちらでも可',
  staffOptionalAvatar: '可',
  confirmMenuLabel: '内容',
  confirmStaffLabel: '担当者',
  noteLabel: '連絡事項（任意）',
  notePlaceholder: '面談希望、相談したいこと、その他',
  doneReplyLine: '担当者からの返信をお待ちください。',
  historyContactNotice: '変更・キャンセルは担当者に LINE で直接ご連絡ください',
};

export function getSalonBookingLabels(vertical: string | null): SalonBookingLabels {
  return vertical === 'recruit' ? RECRUIT_LABELS : DEFAULT_LABELS;
}

export function getSalonBookingLabelsFromUrl(): SalonBookingLabels {
  const params = new URLSearchParams(window.location.search);
  return getSalonBookingLabels(params.get('vertical'));
}
