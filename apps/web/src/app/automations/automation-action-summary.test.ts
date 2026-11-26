import { describe, expect, it } from 'vitest'
import { summarizeAutomationActions } from './automation-action-summary'

describe('summarizeAutomationActions', () => {
  it('counts send_message template references', () => {
    expect(summarizeAutomationActions([
      { type: 'send_message', params: { template_id: 'tpl-1' } },
      { type: 'add_tag', params: { tag_id: 'tag-1' } },
      { type: 'send_message', params: { template_id: 'tpl-2' } },
    ])).toEqual({ actionCount: 3, templateReferenceCount: 2 })
  })

  it('does not throw when legacy actions have missing or invalid params', () => {
    expect(summarizeAutomationActions([
      { type: 'send_message' },
      { type: 'send_message', params: null },
      { type: 'send_message', params: 'invalid' },
      { type: 'send_message', params: { template_id: '   ' } },
      null,
    ])).toEqual({ actionCount: 5, templateReferenceCount: 0 })
  })

  it('treats a non-array actions value as empty', () => {
    expect(summarizeAutomationActions(undefined)).toEqual({ actionCount: 0, templateReferenceCount: 0 })
    expect(summarizeAutomationActions({})).toEqual({ actionCount: 0, templateReferenceCount: 0 })
  })
})
