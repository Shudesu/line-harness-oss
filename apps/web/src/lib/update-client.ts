import type {
  Manifest,
  CurrentVersion,
  ForkStatus,
  ReleaseEntry,
} from '@line-harness/update-engine/pure'
import {
  detectFork as engineDetectFork,
  findLatestUpgrade as engineFindLatestUpgrade,
  compareSemver as engineCompareSemver,
} from '@line-harness/update-engine/pure'

// Re-export so consumers can import all upgrade-related types from one place
export type { Manifest, CurrentVersion, ForkStatus, ReleaseEntry }
export const detectFork = engineDetectFork
export const findLatestUpgrade = engineFindLatestUpgrade
export const compareSemver = engineCompareSemver

// The Worker is on a separate origin from the static admin export, so admin
// fetches must go through `NEXT_PUBLIC_API_URL` like the rest of `lib/api.ts`.
// Failing fast at module load mirrors api.ts so dev builds with missing env
// surface immediately instead of producing 404s at runtime.
const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. update-client cannot reach the Worker.',
  )
}

/**
 * Always fetch the manifest through the Worker proxy.
 *
 * GitHub release assets do not reliably include browser CORS headers, so a
 * public `NEXT_PUBLIC_MANIFEST_URL` pointing at GitHub breaks the dashboard.
 * Operators can still change the upstream source by setting the Worker's
 * server-side `MANIFEST_URL`; the browser should only talk to `/admin/manifest`.
 */
export function getManifestUrl(): string {
  return `${API_URL}/admin/manifest`
}

function adminKey(): string {
  const v = process.env.NEXT_PUBLIC_ADMIN_API_KEY
  if (!v) throw new Error('NEXT_PUBLIC_ADMIN_API_KEY not set')
  return v
}

export async function getCurrentVersion(): Promise<CurrentVersion> {
  const r = await fetch(`${API_URL}/admin/version`)
  if (!r.ok) throw new Error(`version fetch failed ${r.status}`)
  const j = (await r.json()) as {
    version: string
    worker_hash: string
    admin_hash: string
    liff_hash: string
  }
  return {
    version: j.version,
    worker_hash: j.worker_hash,
    admin_hash: j.admin_hash,
    liff_hash: j.liff_hash,
  }
}

export async function getManifest(): Promise<Manifest> {
  const r = await fetch(getManifestUrl(), { cache: 'no-store' })
  if (!r.ok) throw new Error(`manifest fetch failed ${r.status}`)
  return r.json() as Promise<Manifest>
}

export async function startUpdate(): Promise<{ updateId: string }> {
  const r = await fetch(`${API_URL}/admin/update/start`, {
    method: 'POST',
    headers: { 'x-admin-api-key': adminKey() },
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`start failed ${r.status}: ${body}`)
  }
  return r.json() as Promise<{ updateId: string }>
}

export async function getUpdateStatus(id: string): Promise<{
  id: string
  status: string
  events: unknown[]
  error: string | null
}> {
  const r = await fetch(`${API_URL}/admin/update/status/${id}`, {
    headers: { 'x-admin-api-key': adminKey() },
  })
  if (!r.ok) throw new Error(`status ${r.status}`)
  return r.json() as Promise<{
    id: string
    status: string
    events: unknown[]
    error: string | null
  }>
}

export function openUpdateStream(
  id: string,
  onEvent: (e: unknown) => void,
  onComplete: (final: unknown) => void,
): EventSource {
  // KNOWN LIMITATION (Phase 6): EventSource cannot send custom request headers,
  // but the worker's `/admin/update/stream/:id` requires `x-admin-api-key`.
  // For Phase 6 we ship the structure and accept that the SSE connection will
  // fail authentication at runtime — `startUpdate` and `getUpdateStatus` still
  // work via fetch and the dashboard can poll status as a fallback.
  // Phase 9 polish task: switch the gate to a cookie set at login OR add a
  // signed query-param token. See task plan for `feat/upgrade-flow`.
  const es = new EventSource(`${API_URL}/admin/update/stream/${id}`)
  es.addEventListener('progress', (m) =>
    onEvent(JSON.parse((m as MessageEvent).data)),
  )
  es.addEventListener('complete', (m) => {
    onComplete(JSON.parse((m as MessageEvent).data))
    es.close()
  })
  return es
}
