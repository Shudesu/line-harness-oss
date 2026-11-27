'use client'

import { useEffect, useState } from 'react'
import { getCurrentVersionCached } from '@/lib/update-client'
import { resolveDisplayVersion } from '@/lib/app-version'

/**
 * フッターに出す版。`buildVersion` はビルド時に焼いた既定値（`APP_VERSION`）で、
 * マウント後に `GET /admin/version` が返した**実際に動いている Worker** の
 * `BUNDLE_VERSION` に差し替える。
 *
 * なぜ実行時に読み直すのか: Cloud の配布物は「1回ビルドして全テナントで
 * assets を共有する」設計（§18.1）なので、管理画面の静的 JS に焼かれた版は
 * その assets を載せている Worker の版と原理的にずれ得る。運用者が見たいのは
 * 今まさに動いている Worker の版なので、取れたらそちらを優先する。
 *
 * 取得できないとき（オフライン・旧版の Worker・版未埋込）は焼き込んだ値のまま。
 * 版表示は補助情報であり、ここで画面を壊したり空にしたりしない。
 */
export function useRunningVersion(buildVersion: string): string {
  const [runtime, setRuntime] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getCurrentVersionCached()
      .then((v) => {
        if (!cancelled) setRuntime(v.version)
      })
      .catch(() => {
        // 版表示は best-effort。失敗はフッターを焼き込み値のままにするだけ。
      })
    return () => {
      cancelled = true
    }
  }, [])

  return resolveDisplayVersion(buildVersion, runtime)
}
