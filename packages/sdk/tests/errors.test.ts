import { describe, it, expect } from 'vitest'
import { LineHarnessError } from '../src/errors.js'

describe('LineHarnessError', () => {
  it('stores status, message, and endpoint', () => {
    const err = new LineHarnessError('Not found', 404, 'GET /api/scenarios/xxx')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(LineHarnessError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.endpoint).toBe('GET /api/scenarios/xxx')
    expect(err.name).toBe('LineHarnessError')
  })
})
