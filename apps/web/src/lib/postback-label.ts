// ボタンを押した記録（lh_tag=<印のID>&kw=...）を、管理画面で読める言葉にする。
// 記録はそのままの文字で残っているので、見せるときだけ置き換える。
export function postbackLabel(
  content: string,
  tagName: (id: string) => string | undefined,
): string | null {
  if (!content.startsWith('lh_tag=')) return null
  const ids = new URLSearchParams(content).getAll('lh_tag').filter((id) => id !== '')
  const names = [...new Set(ids)].map(tagName).filter((n): n is string => !!n)
  return names.length > 0 ? `🔘 ボタンを押した（${names.join('・')}）` : '🔘 ボタンを押した'
}

// content がボタンの記録ならその言葉、そうでなければ元の文字を返す
export function readableIncoming(content: string, tagName: (id: string) => string | undefined): string {
  return postbackLabel(content, tagName) ?? content
}
