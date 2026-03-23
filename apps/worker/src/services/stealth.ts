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
 * Calculate staggered delay for bulk sending.
 * Spreads messages over time to mimic human-operated account.
 *
 * @param totalMessages Total number of messages to send
 * @param batchIndex Current batch index (0-based)
 * @returns Delay in milliseconds before sending this batch
 */
export function calculateStaggerDelay(
  totalMessages: number,
  batchIndex: number,
): number {
  if (totalMessages <= 100) {
    // Small sends: minimal delay with jitter
    return addJitter(100, 500);
  }

  if (totalMessages <= 1000) {
    // Medium sends: spread over ~2 minutes
    const baseDelay = (120_000 / Math.ceil(totalMessages / 500)) * batchIndex;
    return addJitter(baseDelay, 2000);
  }

  // Large sends: spread over ~5 minutes with more jitter
  const baseDelay = (300_000 / Math.ceil(totalMessages / 500)) * batchIndex;
  return addJitter(baseDelay, 5000);
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
