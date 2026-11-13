import type { HttpClient } from '../http.js'
import type { ApiResponse, ConversionEvent, TrackConversionInput } from '../types.js'

export class ConversionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Record a conversion. With `idempotencyKey`, retrying the same call records
   * it once and returns the same event; `fireEvent` (key required) also raises
   * `cv_fire` so automations run. Keys are DB-wide (not account/client-scoped)
   * and retained indefinitely: namespace with integration/account/event IDs.
   * Keyed automation pushes use stable action keys. Unresolved sends beyond
   * 24h throw LineHarnessError (409, code=line_delivery_requires_review,
   * requiresReview=true); verify delivery manually instead of using a new key.
   * Webhooks and non-send effects are not exactly-once. See docs/api-idempotency.md.
   */
  async track(input: TrackConversionInput): Promise<ConversionEvent> {
    const { idempotencyKey, ...body } = input
    const res = idempotencyKey
      ? await this.http.post<ApiResponse<ConversionEvent>>('/api/conversions/track', body, { 'Idempotency-Key': idempotencyKey })
      : await this.http.post<ApiResponse<ConversionEvent>>('/api/conversions/track', body)
    return res.data
  }
}
