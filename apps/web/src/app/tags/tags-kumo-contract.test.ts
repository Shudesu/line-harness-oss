import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8')

describe('タグ管理のKumo移行契約', () => {
  it('汎用UIをKumoのコンポーネントから構成する', () => {
    for (const component of ['banner', 'button', 'dialog', 'empty', 'input', 'layer-card', 'loader', 'table']) {
      expect(SOURCE).toContain(`@cloudflare/kumo/components/${component}`)
    }
  })

  it('独自のbutton・input・table・confirmへ戻さない', () => {
    expect(SOURCE).not.toMatch(/<(?:button|input|table)(?:\s|>)/)
    expect(SOURCE).not.toContain('confirm(')
  })
})
