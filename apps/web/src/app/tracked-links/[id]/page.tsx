/**
 * 旧 dynamic route のプレースホルダ。`output: 'export'` がダミー1件以上必要なため
 * 'placeholder' を返す。実用上は /tracked-links/detail?id=... を使う。
 */
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return null
}
