/** 返信欄へ挿入できるテンプレート (登録済みテンプレートのうち必要な項目だけ) */
export interface InsertableTemplate {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

/**
 * 返信欄へ挿入できるテンプレートだけを残し、検索語で絞り込む。
 * 返信欄はテキストの入力欄なので、テキストのテンプレートだけを対象にする
 * (Flex・画像などは本文が JSON で、そのまま入れても送れる文面にならない)。
 * 検索は名前・カテゴリ・本文の部分一致で、大文字小文字を区別しない。
 */
export function filterInsertableTemplates<T extends InsertableTemplate>(templates: T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return templates.filter((template) => {
    if (template.messageType !== 'text' || !template.messageContent) return false
    if (!needle) return true
    return [template.name, template.category, template.messageContent]
      .some((field) => field.toLowerCase().includes(needle))
  })
}

/**
 * 入力中の文面のカーソル位置 (選択範囲があればその部分) にテンプレートの本文を入れる。
 * 挿入後のカーソル位置 (本文の直後) もあわせて返す。位置は文面の長さに丸める。
 */
export function insertTemplateText(
  current: string,
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; cursor: number } {
  const clamp = (n: number) => Math.min(Math.max(n, 0), current.length)
  const start = clamp(Math.min(selectionStart, selectionEnd))
  const end = clamp(Math.max(selectionStart, selectionEnd))
  return {
    value: current.slice(0, start) + text + current.slice(end),
    cursor: start + text.length,
  }
}

/**
 * 文面に `{{name}}` などの差し込み変数が残っているか。個別チャットの手動送信では
 * 変数を置き換えないため、そのまま送るとお客さまに `{{name}}` が届いてしまう。
 */
export function hasTemplateVariables(text: string): boolean {
  return /\{\{[^{}]+\}\}/.test(text)
}
