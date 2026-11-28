import { describe, expect, it } from 'vitest'
import { filterInsertableTemplates, hasTemplateVariables, insertTemplateText } from './chat-templates'

const template = (id: string, overrides: Partial<{ name: string; category: string; messageType: string; messageContent: string }> = {}) => ({
  id,
  name: `テンプレート${id}`,
  category: 'general',
  messageType: 'text',
  messageContent: `本文${id}`,
  ...overrides,
})

describe('filterInsertableTemplates', () => {
  it('keeps only text templates with a body', () => {
    const list = [
      template('a'),
      template('b', { messageType: 'flex', messageContent: '{"type":"bubble"}' }),
      template('c', { messageType: 'image', messageContent: '{"originalContentUrl":"https://example.com/a.png"}' }),
      template('d', { messageContent: '' }),
    ]
    expect(filterInsertableTemplates(list, '').map((t) => t.id)).toEqual(['a'])
  })

  it('matches the query against name, category and body, ignoring case', () => {
    const list = [
      template('a', { name: 'お礼' }),
      template('b', { category: 'FAQ' }),
      template('c', { messageContent: 'ご予約ありがとうございます' }),
      template('d'),
    ]
    expect(filterInsertableTemplates(list, 'お礼').map((t) => t.id)).toEqual(['a'])
    expect(filterInsertableTemplates(list, 'faq').map((t) => t.id)).toEqual(['b'])
    expect(filterInsertableTemplates(list, ' 予約 ').map((t) => t.id)).toEqual(['c'])
    expect(filterInsertableTemplates(list, '該当なし')).toEqual([])
  })
})

describe('insertTemplateText', () => {
  it('inserts into an empty composer', () => {
    expect(insertTemplateText('', 'こんにちは', 0, 0)).toEqual({ value: 'こんにちは', cursor: 5 })
  })

  it('inserts at the caret and keeps the text around it', () => {
    expect(insertTemplateText('前後', '中', 1, 1)).toEqual({ value: '前中後', cursor: 2 })
  })

  it('replaces the selected range', () => {
    expect(insertTemplateText('〇〇様、こんにちは', '山田様', 0, 3)).toEqual({ value: '山田様、こんにちは', cursor: 3 })
  })

  it('accepts a backwards selection and clamps out-of-range positions', () => {
    expect(insertTemplateText('abc', 'X', 2, 1)).toEqual({ value: 'aXc', cursor: 2 })
    expect(insertTemplateText('abc', 'X', 10, 10)).toEqual({ value: 'abcX', cursor: 4 })
    expect(insertTemplateText('abc', 'X', -1, -1)).toEqual({ value: 'Xabc', cursor: 1 })
  })
})

describe('hasTemplateVariables', () => {
  it('detects placeholders that manual sends leave as-is', () => {
    expect(hasTemplateVariables('{{name}}様')).toBe(true)
    expect(hasTemplateVariables('会員番号: {{metadata.member_id}}')).toBe(true)
    expect(hasTemplateVariables('{{#if_ref}}紹介ありがとうございます{{/if_ref}}')).toBe(true)
  })

  it('ignores plain text and unmatched braces', () => {
    expect(hasTemplateVariables('こんにちは')).toBe(false)
    expect(hasTemplateVariables('{name}')).toBe(false)
    expect(hasTemplateVariables('{{}}')).toBe(false)
    expect(hasTemplateVariables('{{ 未完')).toBe(false)
  })
})
