const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface MeetingDateOption {
  value: string;
  label: string;
}

/** iOS/LINE 内ブラウザでも空欄に見えない、日付プルダウン用の候補を作る。 */
export function buildMeetingDateOptions(todayJst: string, days = 31): MeetingDateOption[] {
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(`${todayJst}T00:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + offset);
    const value = new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Tokyo',
    }).format(date);
    return { value, label: offset === 0 ? `${label}（本日）` : label };
  });
}
