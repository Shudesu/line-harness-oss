import { createElement, Children, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@cloudflare/kumo/components/button'
import { expect, it, vi } from 'vitest'
import { PollingStatus } from './polling-status'

it.each(['idle', 'hidden'] as const)('shows the %s pause reason, stale-data explanation and an actionable resume button', (reason) => {
  const onResume = vi.fn()
  const html = renderToStaticMarkup(createElement(PollingStatus, { reason, onResume }))
  expect(html).toContain('一時停止')
  expect(html).toContain('前回取得した内容')
  expect(html).toContain('更新を再開')
  expect(html).toContain(reason === 'idle' ? '5分間操作がなかった' : '画面が非表示')
  const element = PollingStatus({ reason, onResume })!
  const children = Children.toArray(element.props.children).filter(isValidElement<{ onClick?: () => void }> )
  const button = children.find((child) => child.type === Button)!
  button.props.onClick!()
  expect(onResume).toHaveBeenCalledOnce()
})
it('does not show a stale-data warning during normal active polling', () => {
  expect(renderToStaticMarkup(createElement(PollingStatus, { reason: 'active', onResume: () => {} }))).toBe('')
})
