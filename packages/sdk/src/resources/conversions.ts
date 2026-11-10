import type { HttpClient } from '../http.js'
import type { ApiResponse, ConversionEvent, TrackConversionInput } from '../types.js'

export class ConversionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Record a conversion. With `idempotencyKey`, retrying the same call records
   * it once and returns the same event; `fireEvent` (key required) also raises
   * `cv_fire` so automations run.
   */
  async track(input: TrackConversionInput): Promise<ConversionEvent> {
    const { idempotencyKey, ...body } = input
    const res = idempotencyKey
      ? await this.http.post<ApiResponse<ConversionEvent>>('/api/conversions/track', body, { 'Idempotency-Key': idempotencyKey })
      : await this.http.post<ApiResponse<ConversionEvent>>('/api/conversions/track', body)
    return res.data
  }
}
