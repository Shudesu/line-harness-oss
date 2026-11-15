import { describe, it, expect } from 'vitest'
import { postbackLabel, readableIncoming } from './postback-label'

const names: Record<string, string> = { t1: '軌_引っ越し済み', t2: '軌_学生' }
const tagName = (id: string) => names[id]

describe('postbackLabel', () => {
  it('印の名前を出す', () => {
    expect(postbackLabel('lh_tag=t1&kw=asa_move_ok', tagName)).toBe('🔘 ボタンを押した（軌_引っ越し済み）')
  })
  it('印が複数なら並べる（重複はまとめる）', () => {
    expect(postbackLabel('lh_tag=t1&lh_tag=t2&lh_tag=t1', tagName)).toBe('🔘 ボタンを押した（軌_引っ越し済み・軌_学生）')
  })
  it('印の名前がわからなくても ID は出さない', () => {
    expect(postbackLabel('lh_tag=zzz&kw=x', tagName)).toBe('🔘 ボタンを押した')
  })
  it('印の ID が空でも「ボタンを押した」だけ出す', () => {
    expect(postbackLabel('lh_tag=&kw=x', tagName)).toBe('🔘 ボタンを押した')
  })
  it('名前がわかる印だけ出す', () => {
    expect(postbackLabel('lh_tag=zzz&lh_tag=t2', tagName)).toBe('🔘 ボタンを押した（軌_学生）')
  })
  it('ボタンの記録でなければ null／元の文字のまま', () => {
    expect(postbackLabel('こんにちは', tagName)).toBeNull()
    expect(readableIncoming('こんにちは', tagName)).toBe('こんにちは')
    expect(readableIncoming('kw=x&lh_tag=t1', tagName)).toBe('kw=x&lh_tag=t1')
  })
})
