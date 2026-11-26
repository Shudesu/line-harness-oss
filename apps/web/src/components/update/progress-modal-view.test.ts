import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@cloudflare/kumo/components/button'
import { describe, expect, test, vi } from 'vitest'
import { ProgressModalView, type UpdateFinalState } from './progress-modal-view'
import { buildProgressRows } from './progress-rows'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return []
    return [child, ...elements(child.props.children as ReactNode)]
  })
}
const rows = buildProgressRows([
  { step: 'preflight', status: 'done' },
  { step: 'preflight', status: 'running', name: 'requires_secrets:ADMIN_ORIGIN,API_KEY' },
  { step: 'migration', status: 'done', name: '001.sql (already applied)' },
  { step: 'migration', status: 'done', name: '027.sql (adopted, not executed)' },
  { step: 'rollback', status: 'running', error: 'original update failure' },
  { step: 'rollback', status: 'done' },
])

describe('ProgressModalView', () => {
  test('renders real Kumo button markup and all retained evidence through React SSR', () => {
    const html = renderToStaticMarkup(createElement(ProgressModalView, {
      rows, final: { status: 'rolled_back', error: 'final failure' }, mode: 'polling', titleId: 'update-title', onClose: () => {},
    }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-labelledby="update-title"')
    expect(html).toContain('ADMIN_ORIGIN, API_KEY')
    expect(html).toContain('001.sql')
    expect(html).toContain('027.sql')
    expect(html).toContain('適用済みのためスキップ')
    expect(html).toContain('既存状態を確認して記録（実行なし）')
    expect(html).toContain('original update failure')
    expect(html).toContain('final failure')
    expect(html).toContain('<details')
    const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0]
    expect(button).toContain('data-kumo-component="Button"')
    expect(button).toContain('type="button"')
    expect(button?.replace(/<[^>]*>/g, '')).toBe('閉じる')
  })

  test.each(['success', 'rolled_back', 'failed'] as const)('keeps Close outside scrolling content and wired for %s', (status) => {
    const onClose = vi.fn()
    const final: UpdateFinalState = { status, error: 'very-long-error-'.repeat(500) }
    const tree = ProgressModalView({ rows, final, mode: 'sse', titleId: 'update-title', onClose })
    const all = elements(tree)
    const dialog = all.find((element) => element.props.role === 'dialog')!
    const children = Children.toArray(dialog.props.children as ReactNode).filter(isValidElement<Record<string, unknown>>)
    const scroll = children.find((child) => child.props['data-progress-scroll'] === 'true')!
    const footer = children.find((child) => child.props['data-progress-footer'] === 'true')!
    expect(dialog.props.className).toContain('max-h-[calc(100dvh-2rem)]')
    expect(dialog.props.className).toContain('flex flex-col')
    expect(scroll.props.className).toContain('min-h-0 overflow-y-auto')
    expect(footer.props.className).toContain('shrink-0')
    expect(children.indexOf(footer)).toBeGreaterThan(children.indexOf(scroll))
    expect(elements(scroll).some((element) => element.type === Button)).toBe(false)
    const close = elements(footer).find((element) => element.type === Button)!
    expect(close.props.type).toBe('button')
    expect(close.props.disabled).toBeUndefined()
    ;(close.props.onClick as () => void)()
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('does not add a close/cancel action while the update is running', () => {
    const html = renderToStaticMarkup(createElement(ProgressModalView, {
      rows: [], final: null, mode: 'sse', titleId: 'update-title', onClose: () => {},
    }))
    expect(html).toContain('接続中...')
    expect(html).not.toContain('data-progress-footer')
    expect(html).not.toContain('閉じる')
  })

  test('escapes error and note text while keeping it available in the scroll region', () => {
    const unsafe = '<img src=x onerror="alert(1)">'
    const html = renderToStaticMarkup(createElement(ProgressModalView, {
      rows: buildProgressRows([{ step: 'worker', status: 'failed', error: unsafe }]),
      final: { status: 'failed', error: unsafe }, mode: 'sse', titleId: 'update-title', onClose: () => {},
    }))
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
})
