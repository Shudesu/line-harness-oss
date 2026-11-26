import { describe, it, expect, vi } from 'vitest'
import { ConversionsResource } from '../../src/resources/conversions.js'
import type { HttpClient } from '../../src/http.js'

describe('ConversionsResource', () => {
  it('track() sends Idempotency-Key as a header only when idempotencyKey is given', async () => {
    const event = { id: 'e1', conversionPointId: 'p1', friendId: 'f1' }
    const http = { post: vi.fn().mockResolvedValue({ success: true, data: event }) } as unknown as HttpClient
    const resource = new ConversionsResource(http)
    expect(await resource.track({ conversionPointId: 'p1', friendId: 'f1' })).toEqual(event)
    expect(http.post).toHaveBeenLastCalledWith('/api/conversions/track', { conversionPointId: 'p1', friendId: 'f1' })
    await resource.track({ conversionPointId: 'p1', friendId: 'f1', fireEvent: true, idempotencyKey: 'payment-1' })
    expect(http.post).toHaveBeenLastCalledWith(
      '/api/conversions/track',
      { conversionPointId: 'p1', friendId: 'f1', fireEvent: true },
      { 'Idempotency-Key': 'payment-1' },
    )
  })
})
