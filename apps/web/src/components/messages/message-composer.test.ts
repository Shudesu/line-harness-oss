import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { packMessageItems, type MessageItem } from '@line-crm/shared'
import MessageComposer, { MessagePreview } from './message-composer'

// Render the actual composition and selection logic without a browser or uploads.
vi.mock('@cloudflare/kumo/components/button', () => ({ Button: ({ children, ...props }: any) => createElement('button', props, children) }))
vi.mock('@cloudflare/kumo/components/input', () => ({ InputArea: ({ label, value }: any) => createElement('textarea', { 'aria-label': label, defaultValue: value }) }))
vi.mock('@cloudflare/kumo/components/select', () => ({ Select: ({ label, value }: any) => createElement('input', { 'aria-label': label, defaultValue: value }) }))
vi.mock('../shared/image-uploader', () => ({ default: () => createElement('input', { type: 'file', 'aria-label': '送信する画像' }) }))
vi.mock('../flex-preview', () => ({ default: ({ content }: any) => createElement('div', { 'data-flex-preview': true }, content) }))

const mixed: MessageItem[] = [
  { messageType: 'text', messageContent: 'お知らせ' },
  { messageType: 'image', messageContent: JSON.stringify({ originalContentUrl: 'https://example.test/image.png', previewImageUrl: 'https://example.test/thumb.png' }) },
  { messageType: 'flex', messageContent: '{"type":"bubble"}' },
]
const render = (items: MessageItem[]) => renderToStaticMarkup(createElement(MessageComposer, { ...packMessageItems(items), onChange: vi.fn() }))
describe('message composer output', () => {
  it('renders different controls for text, image and Flex, including the Flex preview', () => {
    const text = render([mixed[0]])
    const image = render([mixed[1]])
    const flex = render([mixed[2]])
    expect(text).toContain('aria-label="メッセージ内容"')
    expect(image).toContain('type="file"')
    expect(image).not.toContain('<textarea')
    expect(flex).toContain('aria-label="Flex JSON"')
    expect(flex).toContain('data-flex-preview')
  })
  it('caps the add button at five and disables delete for the last item', () => {
    expect(render([...mixed, mixed[0], mixed[1]])).toMatch(/disabled="">＋ メッセージを追加（5\/5）/)
    expect(render([mixed[0]])).toMatch(/disabled="">削除/)
  })
  it('renders each bubble in order without exposing the storage envelope', () => {
    const html = renderToStaticMarkup(createElement(MessagePreview, packMessageItems(mixed)))
    expect(html.indexOf('お知らせ')).toBeLessThan(html.indexOf('<img'))
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('data-flex-preview'))
    expect(html).not.toContain('$lineHarnessMessages')
  })
})
