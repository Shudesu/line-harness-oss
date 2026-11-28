/**
 * 管理画面フッターに出す版の決め方（2026-11-14）。
 *
 * これまでフッターは `next.config.ts` がルート `package.json` の version を
 * `APP_VERSION` として焼き込んだ値をそのまま出していた。ところが Cloud の配布物
 * （`bundles/line/<version>/`）の版は、リリース時に `apps/worker/scripts/inject-version.ts`
 * が `_version.ts` の `BUNDLE_VERSION` として刻む別の文字列で、`package.json` の
 * version とは一致しない — `0.26.2-replay.wallet.20261101.3` の Worker が配っている
 * 管理画面が「v0.26.0」と名乗る、という食い違いはこれが原因。
 * （`hc-release-bundle.yml` は `pnpm --filter web build` を、版を刻む
 * `inject-version.ts` より**前**に走らせるので、web のビルドはそもそも
 * `_version.ts` 経由では配布版を知り得なかった。）
 *
 * ここでは版の出所を2段階に分ける:
 *
 *   1. ビルド時の既定値（この `resolveBuildAppVersion`）— 配布版が分かっているなら
 *      それを焼く。CI は `CLOUD_BUNDLE_VERSION` を web のビルドにも渡す。
 *   2. 実行時の実測値（`resolveDisplayVersion`）— ダッシュボードが
 *      `GET /admin/version` を読み、**実際に動いている Worker** の
 *      `BUNDLE_VERSION` を出す。静的書き出しは全テナントで同じ bytes を共有する
 *      （設計 §18.1）ので、焼き込んだ値はあくまで既定値であって、その assets を
 *      載せている Worker の版とは原理的にずれ得る。実測値が取れたらそちらを優先する。
 */

/**
 * `inject-version.ts` を通していないビルド（ローカル dev / 自前 CI）の placeholder。
 * `update-banner.tsx` の同名定数と同じ値 — こちらが出所で、意味も同じ
 * 「版が刻まれていない」。
 */
export const DEV_BUNDLE_VERSION = '0.0.0-dev'

/** `_version.ts` の `BUNDLE_VERSION = '...'` を読む。無ければ null。 */
export function parseBundleVersion(versionModuleSource: string | null): string | null {
  if (!versionModuleSource) return null
  const m = /\bBUNDLE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(versionModuleSource)
  const v = m?.[1]?.trim()
  // dev stub は「版が無い」と同じ扱い。これを焼くと全テナントのフッターが
  // 0.0.0-dev になり、package.json 由来より情報が減る。
  if (!v || v === DEV_BUNDLE_VERSION) return null
  return v
}

/**
 * ビルド時に焼く `APP_VERSION` を決める。純関数 — 呼び出し側（`next.config.ts`）が
 * env・ファイル読み・package.json の取得を担当する。
 *
 * 優先順位:
 *   1. `APP_VERSION`         — 明示指定（運用者の最終手段）
 *   2. `CLOUD_BUNDLE_VERSION` — `hc-release-bundle.yml` が解決した配布版
 *   3. `_version.ts` の `BUNDLE_VERSION` — 先に版を刻むパイプライン向け
 *   4. ルート `package.json` の version — 自己ホスト・ローカルの従来どおりの既定
 */
export function resolveBuildAppVersion(input: {
  env: Record<string, string | undefined>
  versionModuleSource?: string | null
  packageVersion: string
}): string {
  const explicit = input.env.APP_VERSION?.trim()
  if (explicit) return explicit
  const fromCi = input.env.CLOUD_BUNDLE_VERSION?.trim()
  if (fromCi) return fromCi
  const fromModule = parseBundleVersion(input.versionModuleSource ?? null)
  if (fromModule) return fromModule
  return input.packageVersion
}

/**
 * 画面に出す版を決める。`runtime` は `GET /admin/version` の `version`
 * （実際に動いている Worker の `BUNDLE_VERSION`）。
 *
 * 取得前（null）・取得失敗（null）・版未埋込（`0.0.0-dev`）のときは焼き込んだ値に
 * 戻す。ここで `0.0.0-dev` をそのまま出すと、自前ビルド運用の画面が
 * 「v0.0.0-dev」になって、今より分かりにくくなるだけなので採らない。
 */
export function resolveDisplayVersion(buildVersion: string, runtime: string | null | undefined): string {
  const v = runtime?.trim()
  if (!v || v === DEV_BUNDLE_VERSION) return buildVersion
  return v
}
