import { describe, expect, it } from 'vitest'
import { buildLineExperienceUrl } from './line-experience-url'

describe('buildLineExperienceUrl', () => {
  it('builds the LINE auth URL from the deployed Worker URL', () => {
    expect(buildLineExperienceUrl('https://line-harness.example.workers.dev')).toBe(
      'https://line-harness.example.workers.dev/auth/line?ref=dashboard',
    )
  })

  it('removes trailing slashes and encodes the ref', () => {
    expect(buildLineExperienceUrl('https://worker.example///', 'gift guide')).toBe(
      'https://worker.example/auth/line?ref=gift%20guide',
    )
  })

  it('returns null when the Worker URL is unavailable', () => {
    expect(buildLineExperienceUrl(undefined)).toBeNull()
    expect(buildLineExperienceUrl('  ')).toBeNull()
  })
})
