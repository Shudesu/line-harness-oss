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

const MANIFEST_URL =
  process.env.NEXT_PUBLIC_MANIFEST_URL ?? `${API_URL}/admin/manifest`

// SECURITY (緊急血止め 2026-06-07):
// 旧実装は `NEXT_PUBLIC_ADMIN_API_KEY` をクライアントバンドルに埋め込んで
// 本番 JS に admin shared secret を露出していた (DevTools で取得可能)。
// hyhome フォークでは self-update 機能 (UpdateBanner / UpdateButton) を
// そもそも運用していない (update-banner.tsx は既に return null) ため、
// 認証が必要な mutate 系 API (start / status / stream) を完全に無効化し、
// `NEXT_PUBLIC_ADMIN_API_KEY` への参照も削除した。
// 将来 self-update を復活させる場合は、staff Bearer (lh_api_key) ベースの
// role guard (requireRole('owner') 等) に張り替えること。
const SELF_UPDATE_DISABLED_MSG =
  'self-update is disabled in this fork (admin api key leak fix)'

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
  const r = await fetch(MANIFEST_URL, { cache: 'no-store' })
  if (!r.ok) throw new Error(`manifest fetch failed ${r.status}`)
  return r.json() as Promise<Manifest>
}

export async function startUpdate(): Promise<{ updateId: string }> {
  throw new Error(SELF_UPDATE_DISABLED_MSG)
}

export async function getUpdateStatus(_id: string): Promise<{
  id: string
  status: string
  events: unknown[]
  error: string | null
}> {
  throw new Error(SELF_UPDATE_DISABLED_MSG)
}

export function openUpdateStream(
  _id: string,
  _onEvent: (e: unknown) => void,
  _onComplete: (final: unknown) => void,
): EventSource {
  // self-update は無効化済。呼び出し元 (progress-modal) が UI から
  // 到達しない設計 (UpdateBanner / UpdateButton は未マウント) のため、
  // ここに来る = バグ。明示的に投げて気付けるようにする。
  throw new Error(SELF_UPDATE_DISABLED_MSG)
}
