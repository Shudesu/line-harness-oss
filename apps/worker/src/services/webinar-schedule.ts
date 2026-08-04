// 疑似ライブのスケジュール解決。JST は固定 UTC+9 (DST なし) なので epoch 秒を
// 9h シフトした整数演算だけで日付・曜日を求める。サーバー時刻が唯一の権威。

const JST_OFFSET = 9 * 3600;
const DAY = 86400;
const LOOKAHEAD_DAYS = 8;

export interface ScheduleRule {
  type: 'daily' | 'weekly' | 'once';
  time?: string;   // "HH:MM" (daily / weekly, JST)
  days?: number[]; // 0=日 .. 6=土 (weekly)
  at?: string;     // ISO8601 (once)
}

export interface SessionState {
  live: boolean;
  sessionStartAt: number | null;
  offsetSeconds: number | null;
  nextSessionAt: number | null;
}

function parseTime(time: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

export function parseScheduleRules(json: string): ScheduleRule[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const rules: ScheduleRule[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'once' && typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at))) {
      rules.push({ type: 'once', at: r.at });
    } else if (
      (r.type === 'daily' || r.type === 'weekly') &&
      typeof r.time === 'string' &&
      parseTime(r.time)
    ) {
      if (r.type === 'weekly' && !Array.isArray(r.days)) continue;
      rules.push({
        type: r.type,
        time: r.time,
        days: r.type === 'weekly' ? (r.days as number[]) : undefined,
      });
    }
  }
  return rules;
}

/** now の前後 (過去 durationSeconds 〜 未来 8 日) の候補開始時刻を列挙 */
function candidateStarts(
  rules: ScheduleRule[],
  now: number,
  durationSeconds: number,
): number[] {
  const starts = new Set<number>();
  for (const rule of rules) {
    if (rule.type === 'once') {
      starts.add(Math.floor(Date.parse(rule.at!) / 1000));
      continue;
    }
    const time = parseTime(rule.time!)!;
    const firstDay = Math.floor((now - durationSeconds + JST_OFFSET) / DAY);
    const lastDay = Math.floor((now + JST_OFFSET) / DAY) + LOOKAHEAD_DAYS;
    for (let day = firstDay; day <= lastDay; day++) {
      if (rule.type === 'weekly') {
        // epoch day 0 (1970-01-01) は木曜=4
        const weekday = (day + 4) % 7;
        if (!rule.days!.includes(weekday)) continue;
      }
      starts.add(day * DAY - JST_OFFSET + time.h * 3600 + time.m * 60);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

export function resolveSession(
  rules: ScheduleRule[],
  durationSeconds: number,
  nowEpochSeconds: number,
): SessionState {
  const starts = candidateStarts(rules, nowEpochSeconds, durationSeconds);
  let liveStart: number | null = null;
  let next: number | null = null;
  for (const s of starts) {
    if (s <= nowEpochSeconds && nowEpochSeconds < s + durationSeconds) liveStart = s;
    if (s > nowEpochSeconds && next === null) next = s;
  }
  if (liveStart !== null) {
    return {
      live: true,
      sessionStartAt: liveStart,
      offsetSeconds: nowEpochSeconds - liveStart,
      nextSessionAt: next,
    };
  }
  return { live: false, sessionStartAt: null, offsetSeconds: null, nextSessionAt: next };
}
