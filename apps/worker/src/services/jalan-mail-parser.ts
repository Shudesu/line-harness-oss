import type { ExternalReservationEventType } from '@line-crm/shared';

export interface ParsedJalanMail {
  eventType: ExternalReservationEventType;
  externalId: string | null;
  reservationDate: string | null;
  startTime: string | null;
  endTime: string | null;
  totalPeople: number | null;
  adultCount: number | null;
  childCount: number | null;
  infantCount: number | null;
  underThreeCount: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  planName: string | null;
  totalAmount: number | null;
  pointAmount: number | null;
  couponAmount: number | null;
  customerChargeAmount: number | null;
}

export function parseJalanMail(rawText: string): ParsedJalanMail {
  const text = normalizeText(rawText);
  return {
    eventType: detectEventType(text),
    externalId: firstMatch(text, [
      /(?:予約番号|予約No\.?|予約ID|受付番号|照会番号)\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i,
      /\b(?:jalan|JALAN)[-_]?([A-Za-z0-9_-]{4,})\b/,
    ]),
    reservationDate: parseDate(text),
    startTime: parseTime(text),
    endTime: parseEndTime(text),
    totalPeople: parseTotalPeople(text),
    adultCount: parseAdultCount(text),
    childCount: parseChildCount(text),
    infantCount: parseInfantCount(text),
    underThreeCount: parseUnderThreeCount(text),
    customerName: firstMatch(text, [
      /体験者氏名\s*[:：]?\s*(.+?)(?:\([^)\n\r]*\))?様?(?:\n|$)/,
      /(?:氏名|お名前|予約者名|代表者名)\s*[:：]?\s*([^\n\r]+)/,
    ]),
    customerPhone: firstMatch(text, [
      /(?:電話番号|TEL|Tel|tel)\s*[:：]?\s*([0-9+\-() ]{8,})/,
      /(\d{2,4}-\d{2,4}-\d{3,4})/,
    ]),
    customerEmail: firstMatch(text, [
      /メールアドレス\s*[:：]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
      /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    ]),
    planName: normalizePlanName(firstMatch(text, [
      /(?:プラン名|メニュー)\s*[:：]?\s*([^\n\r]+)/,
    ])),
    totalAmount: parseMoney(text, [
      /合計料金\s*\(税込\)\s*[:：]?\s*([0-9,]+)\s*円/,
      /合計金額\s*\(税込\)\s*[:：]?\s*([0-9,]+)\s*円/,
      /合計料金\s*[:：]?\s*([0-9,]+)\s*円/,
      /合計金額\s*[:：]?\s*([0-9,]+)\s*円/,
    ]),
    pointAmount: parseMoney(text, [
      /ポイント利用額\s*[:：]?\s*([0-9,]+)\s*ポイント/,
      /ポイント利用額\s*[:：]?\s*([0-9,]+)\s*円/,
    ]),
    couponAmount: parseMoney(text, [
      /クーポン利用額\s*[:：]?\s*([0-9,]+)\s*円/,
    ]),
    customerChargeAmount: parseMoney(text, [
      /カスタマへの請求額\s*■?\s*[:：]?\s*([0-9,]+)\s*円/,
      /■カスタマへの請求額■\s*([0-9,]+)\s*円/,
      /請求額\s*[:：]?\s*([0-9,]+)\s*円/,
    ]),
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function detectEventType(text: string): ExternalReservationEventType {
  if (/予約(?:が)?キャンセルされました|予約キャンセル|キャンセル通知|取消|取り消し|解約/i.test(text)) return 'cancelled';
  if (/予約(?:が)?確定しました|予約確定|予約確定通知|予約が入りました|予約内容\s*[\s\S]*予約番号/i.test(text)) return 'created';
  if (/予約(?:が)?変更されました|予約変更|変更通知|予約内容(?:の)?変更|利用日時(?:の)?変更/i.test(text)) return 'updated';
  return 'unknown';
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizePlanName(value: string | null): string | null {
  if (!value) return null;
  // NFKC is useful for parsing numbers, but plan names are operator-facing text.
  // Keep Japanese visual punctuation closer to the original mail.
  return value.replace(/!/g, '！');
}

function parseDate(text: string): string | null {
  const usageDate = text.match(/利用日時\s*[:：]?\s*(\d{4})[\/年.-](\d{1,2})[\/月.-](\d{1,2})日?/);
  const match = usageDate ?? text.match(/(\d{4})[\/年.-](\d{1,2})[\/月.-](\d{1,2})日?/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseTime(text: string): string | null {
  const jalanUsageTime = text.match(/利用日時\s*[:：]?\s*\d{4}[\/年.-]\d{1,2}[\/月.-]\d{1,2}日?(?:\([^)]*\))?\s+(\d{1,2}):(\d{2})/);
  if (jalanUsageTime) {
    return `${jalanUsageTime[1].padStart(2, '0')}:${jalanUsageTime[2].padStart(2, '0')}`;
  }

  const contextual = text.match(/(?:開始|来店|来場|入園|予約時間|時間|時刻)\s*[:：]?\s*(\d{1,2})(?::|時)(\d{2})?/);
  const fallback = text.match(/\b(\d{1,2}):(\d{2})\b/);
  const hour = contextual?.[1] ?? fallback?.[1];
  const minute = contextual?.[2] ?? fallback?.[2] ?? '00';
  if (!hour) return null;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function parseEndTime(text: string): string | null {
  const match = text.match(/利用日時\s*[:：]?.*?\d{1,2}:\d{2}\s*[~～〜－-]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
}

function parseTotalPeople(text: string): number | null {
  const match = text.match(/人数\s*[:：]?\s*(\d+)\s*名/);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function parseAdultCount(text: string): number | null {
  return parsePeopleCount(text, ['大人\\(中学生[~～〜]\\)', '大人', 'おとな', 'adult']);
}

function parseChildCount(text: string): number | null {
  const target = extractPeopleLine(text) ?? text;
  const counts = [
    parsePeopleCount(target, ['小学生']),
    parsePeopleCount(target, ['子供', '子ども', '小人', 'child']),
  ];
  const found = counts.filter((count): count is number => count !== null);
  return found.length > 0 ? found.reduce((sum, count) => sum + count, 0) : null;
}

function parseInfantCount(text: string): number | null {
  const target = extractPeopleLine(text) ?? text;
  const counts = [
    parsePeopleCount(target, ['幼児\\(4歳[~～〜]\\)', '幼児']),
  ];
  const found = counts.filter((count): count is number => count !== null);
  return found.length > 0 ? found.reduce((sum, count) => sum + count, 0) : null;
}

function parseUnderThreeCount(text: string): number | null {
  const target = extractPeopleLine(text) ?? text;
  return parsePeopleCount(target, ['3歳以下']);
}

function extractPeopleLine(text: string): string | null {
  return firstMatch(text, [/人数\s*[:：]?\s*([^\n\r]+)/]);
}

function parsePeopleCount(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const pattern = new RegExp(`${label}(?:\\([^)]*\\))?\\s*[:：]?\\s*(\\d+)\\s*(?:名|人)?`, 'i');
    const match = text.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseMoney(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.replace(/,/g, '');
    if (!value) continue;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
