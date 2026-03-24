/**
 * workflows.test.ts
 * T18: 自然言語→LINE操作 E2Eテスト
 *
 * fetch をモックして Workflows クラスの主要メソッドをユニットテストする。
 * 各テストは「自然言語でのLINE CRM操作が正常に完結する」ことを確認する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LineHarness } from './client.js'

// ─── ヘルパー: fetch モック応答を生成 ───────────────────
function mockOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data }),
  } as unknown as Response
}

// ─── テスト共通設定 ───────────────────────────────────
const BASE_URL = 'https://miyabi-line-crm.supernovasyun.workers.dev'
const API_KEY = 'test-api-key'

function createClient(): LineHarness {
  return new LineHarness({ apiUrl: BASE_URL, apiKey: API_KEY })
}

// ─── テストスイート ───────────────────────────────────

describe('Workflows — 自然言語→LINE操作 E2Eテスト', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  // ────────────────────────────────────────────────────
  // シナリオ1: テキストブロードキャスト（全員送信）
  // 「全員に〇〇とLINEして」
  // ────────────────────────────────────────────────────
  it('シナリオ1: broadcastText — 全員にテキストメッセージをブロードキャスト', async () => {
    const broadcastId = 'broadcast-001'
    const sentBroadcast = {
      id: broadcastId,
      title: 'セミナーのお知らせ',
      messageType: 'text',
      messageContent: 'セミナーのお知らせです。来週木曜19時から開催します。',
      targetType: 'all',
      targetTagId: null,
      status: 'sent',
      sentAt: new Date().toISOString(),
      totalCount: 150,
      successCount: 148,
    }

    // POST /api/broadcasts → broadcast 作成
    fetchMock.mockResolvedValueOnce(mockOk({ id: broadcastId, ...sentBroadcast, status: 'draft' }))
    // POST /api/broadcasts/:id/send → 送信
    fetchMock.mockResolvedValueOnce(mockOk(sentBroadcast))

    const client = createClient()
    const result = await client.broadcastText('セミナーのお知らせです。来週木曜19時から開催します。')

    expect(result.status).toBe('sent')
    expect(result.id).toBe(broadcastId)

    // /api/broadcasts への POST が呼ばれたことを確認
    const [firstCallUrl, firstCallInit] = fetchMock.mock.calls[0]
    expect(firstCallUrl).toBe(`${BASE_URL}/api/broadcasts`)
    expect(firstCallInit.method).toBe('POST')
    expect(JSON.parse(firstCallInit.body as string).targetType).toBe('all')

    // /api/broadcasts/:id/send への POST が呼ばれたことを確認
    const [secondCallUrl, secondCallInit] = fetchMock.mock.calls[1]
    expect(secondCallUrl).toBe(`${BASE_URL}/api/broadcasts/${broadcastId}/send`)
    expect(secondCallInit.method).toBe('POST')
  })

  // ────────────────────────────────────────────────────
  // シナリオ2: タグ絞り込みブロードキャスト
  // 「購入済みタグのフレンドにお礼メッセージを送って」
  // ────────────────────────────────────────────────────
  it('シナリオ2: broadcastToTag — 特定タグのフレンドにメッセージを送信', async () => {
    const tagId = 'tag-purchased'
    const broadcastId = 'broadcast-002'

    fetchMock.mockResolvedValueOnce(mockOk({
      id: broadcastId,
      title: 'ご購入ありがとうございます',
      messageType: 'text',
      messageContent: 'ご購入ありがとうございます！',
      targetType: 'tag',
      targetTagId: tagId,
      status: 'draft',
    }))
    fetchMock.mockResolvedValueOnce(mockOk({
      id: broadcastId,
      status: 'sent',
      totalCount: 23,
      successCount: 23,
    }))

    const client = createClient()
    const result = await client.broadcastToTag(tagId, 'text', 'ご購入ありがとうございます！')

    expect(result.status).toBe('sent')

    // タグIDが POST body に含まれていることを確認
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(createBody.targetType).toBe('tag')
    expect(createBody.targetTagId).toBe(tagId)
  })

  // ────────────────────────────────────────────────────
  // シナリオ3: セグメント条件ブロードキャスト
  // 「タグ A を持ち、かつ B を持たない人にメッセージを送って」
  // ────────────────────────────────────────────────────
  it('シナリオ3: broadcastToSegment — AND/OR 条件でセグメント配信', async () => {
    const broadcastId = 'broadcast-003'

    fetchMock.mockResolvedValueOnce(mockOk({
      id: broadcastId,
      status: 'draft',
      messageContent: 'セグメント向けメッセージ',
    }))
    fetchMock.mockResolvedValueOnce(mockOk({
      id: broadcastId,
      status: 'sent',
      totalCount: 42,
      successCount: 40,
    }))

    const client = createClient()
    const conditions = {
      operator: 'AND' as const,
      rules: [
        { type: 'tag_exists' as const, value: 'tag-engaged' },
        { type: 'tag_not_exists' as const, value: 'tag-unsubscribed' },
      ],
    }

    const result = await client.broadcastToSegment('text', 'セグメント向けメッセージ', conditions)

    expect(result.status).toBe('sent')

    // /send-segment エンドポイントが呼ばれたことを確認
    const [sendUrl, sendInit] = fetchMock.mock.calls[1]
    expect(sendUrl).toBe(`${BASE_URL}/api/broadcasts/${broadcastId}/send-segment`)
    expect(sendInit.method).toBe('POST')
    const sendBody = JSON.parse(sendInit.body as string)
    expect(sendBody.conditions.operator).toBe('AND')
    expect(sendBody.conditions.rules).toHaveLength(2)
  })

  // ────────────────────────────────────────────────────
  // シナリオ4: ステップシナリオ作成
  // 「ウェルカムシナリオを3ステップで作って」
  // ────────────────────────────────────────────────────
  it('シナリオ4: createStepScenario — 複数ステップのシナリオを作成', async () => {
    const scenarioId = 'scenario-001'

    // POST /api/scenarios
    fetchMock.mockResolvedValueOnce(mockOk({
      id: scenarioId,
      name: 'ウェルカムシナリオ',
      triggerType: 'friend_add',
      isActive: true,
    }))
    // POST /api/scenarios/:id/steps (step 1)
    fetchMock.mockResolvedValueOnce(mockOk({ id: 'step-1', stepOrder: 1 }))
    // POST /api/scenarios/:id/steps (step 2)
    fetchMock.mockResolvedValueOnce(mockOk({ id: 'step-2', stepOrder: 2 }))
    // POST /api/scenarios/:id/steps (step 3)
    fetchMock.mockResolvedValueOnce(mockOk({ id: 'step-3', stepOrder: 3 }))
    // GET /api/scenarios/:id
    fetchMock.mockResolvedValueOnce(mockOk({
      id: scenarioId,
      name: 'ウェルカムシナリオ',
      triggerType: 'friend_add',
      isActive: true,
      steps: [
        { id: 'step-1', stepOrder: 1, delayMinutes: 0, messageContent: 'ご登録ありがとうございます！' },
        { id: 'step-2', stepOrder: 2, delayMinutes: 1440, messageContent: '翌日フォローアップメッセージ' },
        { id: 'step-3', stepOrder: 3, delayMinutes: 4320, messageContent: '3日後の特典案内' },
      ],
    }))

    const client = createClient()
    const result = await client.createStepScenario(
      'ウェルカムシナリオ',
      'friend_add',
      [
        { delay: '0m', type: 'text', content: 'ご登録ありがとうございます！' },
        { delay: '1d', type: 'text', content: '翌日フォローアップメッセージ' },
        { delay: '3d', type: 'text', content: '3日後の特典案内' },
      ],
    )

    expect(result.id).toBe(scenarioId)
    expect(result.steps).toHaveLength(3)
    expect(result.steps[1].delayMinutes).toBe(1440)

    // シナリオ作成 + 3ステップ追加 + GET = 計5回の fetch 呼び出し
    expect(fetchMock).toHaveBeenCalledTimes(5)

    // シナリオ作成のリクエストを確認
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(createBody.name).toBe('ウェルカムシナリオ')
    expect(createBody.triggerType).toBe('friend_add')
  })

  // ────────────────────────────────────────────────────
  // シナリオ5: フレンドへのタグ付与
  // 「林さんに購入済みタグを付けて」
  // ────────────────────────────────────────────────────
  it('シナリオ5: friends.addTag — フレンドに指定タグを付与', async () => {
    const friendId = 'friend-hayashi'
    const tagId = 'tag-purchased'

    // POST /api/friends/:id/tags は success: true のみ返す（data なし）
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    } as unknown as Response)

    const client = createClient()
    await client.friends.addTag(friendId, tagId)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = fetchMock.mock.calls[0]
    expect(callUrl).toBe(`${BASE_URL}/api/friends/${friendId}/tags`)
    expect(callInit.method).toBe('POST')
    const body = JSON.parse(callInit.body as string)
    expect(body.tagId).toBe(tagId)
  })
})
