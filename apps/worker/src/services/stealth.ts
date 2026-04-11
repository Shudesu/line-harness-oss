// =============================================================================
// Stealth Delivery — Rate limiting, jitter, and human-like sending patterns
// =============================================================================

/**
 * Add random jitter to a delay in milliseconds.
 * Returns base + random(0, jitterRange) ms.
 */
export function addJitter(baseMs: number, jitterRangeMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterRangeMs);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add random variation to message text to avoid identical bulk messages.
 * Inserts zero-width spaces or slight punctuation variations.
 */
export function addMessageVariation(text: string, index: number): string {
  // Use different unicode whitespace characters at random positions
  // This makes each message slightly unique without visible differences
  const variations = [
    '\u200B', // zero-width space
    '\u200C', // zero-width non-joiner
    '\u200D', // zero-width joiner
    '\uFEFF', // zero-width no-break space
  ];

  // Deterministic but unique per-message variation
  const varChar = variations[index % variations.length];
  const position = (index * 7 + 3) % Math.max(text.length, 1);

  if (text.length === 0) return text;
  return text.slice(0, position) + varChar + text.slice(position);
}

/**
 * バッチ送信用のステアリング遅延を計算する。
 * LINEのレート制限回避と自然な送信パターンを維持しつつ、
 * Cloudflare Workerの実行時間制限（30秒）内に全バッチが完了するように調整。
 *
 * 合計遅延の上限: 20秒（30秒制限に対してAPI呼び出し分の余裕を確保）
 *
 * @param totalMessages 送信対象の総メッセージ数
 * @param batchIndex 現在のバッチインデックス（0始まり）
 * @returns このバッチ送信前の遅延（ミリ秒）
 */
export function calculateStaggerDelay(
  totalMessages: number,
  batchIndex: number,
): number {
  // Cloudflare Worker実行時間制限内に収めるための上限（20秒）
  const MAX_TOTAL_DELAY_MS = 20_000;
  const totalBatches = Math.ceil(totalMessages / 500);

  if (totalMessages <= 100) {
    // 少量送信: 最小限の遅延 + ジッター
    return addJitter(100, 400);
  }

  // バッチ間遅延を均等に分配（合計が上限を超えないように）
  // batchIndex=0 は遅延なしで呼ばれるため、実際の遅延回数は totalBatches - 1
  const delaySlots = Math.max(totalBatches - 1, 1);
  const baseDelay = Math.min(
    Math.floor(MAX_TOTAL_DELAY_MS / delaySlots),
    5000, // バッチ間の最大遅延を5秒に制限
  );

  return addJitter(baseDelay, Math.min(baseDelay * 0.2, 500));
}

/**
 * Calculate jittered delivery time for step delivery.
 * Adds random minutes (±5 min) to scheduled delivery to avoid
 * all scenario deliveries firing at exactly the same time.
 */
export function jitterDeliveryTime(scheduledAt: Date): Date {
  const jitterMinutes = Math.floor(Math.random() * 10) - 5; // -5 to +5 minutes
  const result = new Date(scheduledAt);
  result.setMinutes(result.getMinutes() + jitterMinutes);
  return result;
}

/**
 * Rate limiter for LINE API calls.
 * LINE rate limit is 100,000 messages/min, but we stay well under.
 */
export class StealthRateLimiter {
  private callCount = 0;
  private windowStart = Date.now();
  private readonly maxCallsPerWindow: number;
  private readonly windowMs: number;

  constructor(maxCallsPerWindow = 1000, windowMs = 60_000) {
    this.maxCallsPerWindow = maxCallsPerWindow;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.callCount >= this.maxCallsPerWindow) {
      const waitTime = this.windowMs - (now - this.windowStart) + addJitter(100, 500);
      await sleep(waitTime);
      this.callCount = 0;
      this.windowStart = Date.now();
    }

    this.callCount++;
  }
}
