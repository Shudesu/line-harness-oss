import { describe, expect, test } from 'vitest'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'

describe('displayFormName', () => {
  test('escaped line breaks and uneven whitespace are made readable', () => {
    expect(displayFormName('Step1.\\nL  Harnessを体験する(3分)')).toBe(
      'Step1. L Harnessを体験する(3分)',
    )
  })
})

describe('sortFormsByLatestAnswer', () => {
  test('sorts by latest answer and keeps unanswered forms at the bottom', () => {
    const sorted = sortFormsByLatestAnswer([
      {
        id: 'unanswered-new',
        name: '未回答',
        createdAt: '2026-08-12T12:00:00+09:00',
        lastSubmittedAt: null,
      },
      {
        id: 'answered-old',
        name: '回答済み1',
        createdAt: '2026-08-10T12:00:00+09:00',
        lastSubmittedAt: '2026-08-11T12:00:00+09:00',
      },
      {
        id: 'answered-new',
        name: '回答済み2',
        createdAt: '2026-07-01T12:00:00+09:00',
        lastSubmittedAt: '2026-08-12T12:00:00+09:00',
      },
      {
        id: 'unanswered-old',
        name: '未回答2',
        createdAt: '2026-06-01T12:00:00+09:00',
        lastSubmittedAt: null,
      },
    ])

    expect(sorted.map((form) => form.id)).toEqual([
      'answered-new',
      'answered-old',
      'unanswered-new',
      'unanswered-old',
    ])
  })
})
