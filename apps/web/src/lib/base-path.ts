/**
 * admin の basePath（three-surfaces bundle、2026-08-24）を、生の絶対パス代入に
 * 手動でプレフィックスするためのヘルパー。
 *
 * Next.js の `basePath` 設定は `next/link` / `next/router`（`router.push`）には自動で
 * 乗るが、`window.location.href = '/login'` のような生の絶対パス代入には乗らない —
 * それらはブラウザの Location への直接代入であり、Next のルーターを経由しないため。
 * このリポジトリには意図的にハード遷移（フルリロード）したい箇所が2つある
 * （sidebar.tsx のログアウト、emergency/page.tsx の切替導線）— どちらも
 * `router.push` に変えず、この関数で正しい絶対パスを組み立てて使う。
 *
 * `NEXT_PUBLIC_BASE_PATH` は `next.config.ts` が `NEXT_BASE_PATH`（配布ビルドの
 * ビルド時のみ設定）から埋め込む。自己ホスト/開発時（root 配信）は空文字列で、
 * その場合はプレフィックスせず従来どおり動く。
 */
export function withBasePath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  if (!basePath) return path
  return `${basePath}${path}`
}
