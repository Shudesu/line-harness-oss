export function todayJst(): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function parseYmd(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day);
}

export function toYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDaysYmd(value: string, days: number): string {
  const date = parseYmd(value);
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

export function dateRangeYmd(dateFrom: string, dateTo: string): string[] {
  const start = parseYmd(dateFrom);
  const end = parseYmd(dateTo);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  for (let current = toYmd(start); current <= dateTo; current = addDaysYmd(current, 1)) {
    dates.push(current);
    if (dates.length > 62) break;
  }
  return dates;
}

export function startOfWeekYmd(value: string): string {
  const date = parseYmd(value);
  date.setDate(date.getDate() - date.getDay());
  return toYmd(date);
}

export function monthDates(year: number, monthIndex: number): string[] {
  const total = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: total }, (_, index) => toYmd(new Date(year, monthIndex, index + 1)));
}

export function formatDateShort(value: string): string {
  const date = parseYmd(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function dayLabel(value: string): string {
  return ['日', '月', '火', '水', '木', '金', '土'][parseYmd(value).getDay()] ?? '';
}

export function formatTime(value: string): string {
  const match = value.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : value;
}
