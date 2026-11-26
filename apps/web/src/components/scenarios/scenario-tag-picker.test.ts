import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * タグトリガーのシナリオを作れないまま詰まらせないこと。
 *
 * 開通直後のテナントはタグが0件なので、tag_added を選ぶとドロップダウンが
 * 必ず空になる。以前は理由が何も表示されず、triggerTagId が必須なので
 * 「選べない＝作れない」だけが起きて原因が分からなかった。
 * 取得失敗も .catch(() => {}) で握りつぶしていた（2026-08-25）。
 */
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'scenario-mode-picker.tsx'),
  'utf8',
)

describe('シナリオ作成: トリガータグの選択', () => {
  it('取得状態を持つ（loading / ready / failed）', () => {
    expect(SRC).toContain("useState<'loading' | 'ready' | 'failed'>")
  })

  it('取得失敗を握りつぶさない', () => {
    expect(SRC).not.toContain('.catch(() => {})')
    expect(SRC).toContain("catch(() => setTagsState('failed'))")
  })

  it('タグ0件のとき、作り方を案内する', () => {
    expect(SRC).toContain('タグがまだ1つもありません')
    expect(SRC).toContain('href="/tags"')
  })

  it('取得失敗のとき、その旨を出す', () => {
    expect(SRC).toContain('タグ一覧を取得できませんでした')
  })

  it('選べないときは select を disabled にする（空のまま操作させない）', () => {
    expect(SRC).toContain("disabled={tagsState !== 'ready' || tags.length === 0}")
  })
})
