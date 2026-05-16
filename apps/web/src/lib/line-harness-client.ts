'use client'

import { LineHarness } from '@line-harness/sdk'

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '')

if (!API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

function getApiKey(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('lh_api_key')?.trim() || ''
}

export function createLineHarnessClient(lineAccountId?: string | null): LineHarness {
  if (!API_URL) throw new Error('NEXT_PUBLIC_API_URL is not set')
  return new LineHarness({
    apiUrl: API_URL,
    apiKey: getApiKey(),
    lineAccountId: lineAccountId || undefined,
  })
}
