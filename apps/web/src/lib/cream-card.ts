// KIDOUインターンの「あいさつ」「回答後」のクリーム色のカードを、ふつうの文として読み書きする。
//
// 書き方（管理画面の入力欄）
//   1行目から最初の空の行まで … 太字の見出し（2行以上でもよい）
//   空の行       … 次の行との間をあける
//   ---          … 区切り線
//   先頭が全角の空白「　」 … その行を少し右に下げる（前の行の続きに見せる）
// この形に戻せないカード（ほかの作り方をしたもの）は null を返し、画面では中身をそのまま直す欄を出す。

const CREAM = '#f6f1e7'
const INK = '#3a3a3a'
const RULE = '#d9cfbb'
const INDENT = '22px'

type Node = Record<string, unknown>

export function cardToText(json: string): string | null {
  let card: Node
  try {
    card = JSON.parse(json)
  } catch {
    return null
  }
  const body = card?.body as Node | undefined
  if (card?.type !== 'bubble' || !body || body.layout !== 'vertical' || !Array.isArray(body.contents)) return null
  const lines: string[] = []
  const contents = body.contents as Node[]
  // 見出しは先頭から続く太字の行（間をあけずに続くものまで）
  let headEnd = 0
  while (headEnd < contents.length && contents[headEnd].type === 'text' && contents[headEnd].weight === 'bold' && (headEnd === 0 || !contents[headEnd].margin)) headEnd++
  if (headEnd === 0 || typeof contents[0].text !== 'string') return null
  for (let i = 0; i < contents.length; i++) {
    const n = contents[i]
    if (n.type === 'separator') {
      lines.push('', '---')
      continue
    }
    if (n.type !== 'text' || typeof n.text !== 'string') return null
    if (i < headEnd) {
      lines.push(n.text)
      continue
    }
    // 見出しのすぐ後に間をあけずに続く本文は、文に戻すと見出しに混ざってしまうので形に戻せない
    if (i === headEnd && !n.margin) return null
    if (n.margin) lines.push('')
    const head = n.offsetStart ? '　' : ''
    lines.push(...n.text.split('\n').map((t, j) => (j === 0 ? head + t : t)))
  }
  return lines.join('\n')
}

export function textToCard(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  const contents: Node[] = []
  const heading: string[] = []
  while (lines.length && lines[0].trim() && lines[0].trim() !== '---') heading.push((lines.shift() as string).trim())
  if (!heading.length) heading.push(' ')
  for (const h of heading) contents.push({ type: 'text', text: h, size: 'md', color: INK, wrap: true, weight: 'bold' })
  let gap = false
  for (const raw of lines) {
    if (!raw.trim()) {
      gap = true
      continue
    }
    if (raw.trim() === '---') {
      contents.push({ type: 'separator', margin: 'xl', color: RULE })
      gap = false
      continue
    }
    const indent = raw.startsWith('　')
    const t = indent ? raw.slice(1) : raw
    const node: Node = { type: 'text', text: t, size: 'sm', color: INK, wrap: true }
    if (gap) node.margin = 'xl'
    if (indent) node.offsetStart = INDENT
    contents.push(node)
    gap = false
  }
  return JSON.stringify({
    type: 'bubble',
    size: 'mega',
    body: { type: 'box', layout: 'vertical', spacing: 'none', backgroundColor: CREAM, paddingAll: '20px', contents },
  })
}
