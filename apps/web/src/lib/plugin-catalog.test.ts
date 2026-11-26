import { describe, expect, it } from 'vitest'
import { filterPlugins, pluginCatalog } from './plugin-catalog'

describe('plugin catalog search', () => {
  it('combines category and normalized search terms', () => {
    expect(filterPlugins(' TAG ', 'すべて')).toEqual([])
    expect(filterPlugins('タグ 配信', '自動化').map(p => p.id)).toEqual(['tag-rules'])
    expect(filterPlugins('  typescript  ', '開発ツール').map(p => p.id)).toEqual(['typescript-sdk'])
    expect(filterPlugins('typescript', '外部連携')).toEqual([])
    expect(filterPlugins('  ', 'すべて')).toHaveLength(pluginCatalog.length)
  })
})
