/**
 * 旧 dynamic route のプレースホルダ。
 * `output: 'export'` がダミーでも 1 件以上必要なため、'placeholder' を返す。
 * 実用上は /friends/detail?id=... を使うことを想定（一覧ページのリンクで参照）。
 */
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return null
}
