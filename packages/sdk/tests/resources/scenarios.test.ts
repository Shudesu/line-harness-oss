import { describe, it, expect, vi } from 'vitest'
import { ScenariosResource } from '../../src/resources/scenarios.js'
import type { HttpClient } from '../../src/http.js'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

describe('ScenariosResource', () => {
  it('list() calls GET /api/scenarios and returns ScenarioListItem[]', async () => {
    const items = [
      {
        id: 'scenario-1',
        name: 'Welcome Flow',
        description: 'First-time friend welcome',
        triggerType: 'friend_add',
        triggerTagId: null,
        isActive: true,
        createdAt: '2026-03-21T00:00:00Z',
        updatedAt: '2026-03-21T00:00:00Z',
        stepCount: 3,
      },
    ]
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: items }) })
    const resource = new ScenariosResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/scenarios')
    expect(result).toEqual(items)
  })

  it('get(id) calls GET /api/scenarios/:id and returns ScenarioWithSteps', async () => {
    const scenario = {
      id: 'scenario-1',
      name: 'Welcome Flow',
      description: 'First-time friend welcome',
      triggerType: 'friend_add',
      triggerTagId: null,
      isActive: true,
      createdAt: '2026-03-21T00:00:00Z',
      updatedAt: '2026-03-21T00:00:00Z',
      steps: [
        {
          id: 'step-1',
          scenarioId: 'scenario-1',
          stepOrder: 1,
          delayMinutes: 0,
          messageType: 'text',
          messageContent: 'Welcome!',
          createdAt: '2026-03-21T00:00:00Z',
        },
      ],
    }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: scenario }) })
    const resource = new ScenariosResource(http)
    const result = await resource.get('scenario-1')
    expect(http.get).toHaveBeenCalledWith('/api/scenarios/scenario-1')
    expect(result).toEqual(scenario)
  })

  it('create(input) calls POST /api/scenarios with input', async () => {
    const scenario = {
      id: 'scenario-1',
      name: 'Welcome Flow',
      description: 'First-time friend welcome',
      triggerType: 'friend_add',
      triggerTagId: null,
      isActive: true,
      createdAt: '2026-03-21T00:00:00Z',
      updatedAt: '2026-03-21T00:00:00Z',
    }
    const input = { name: 'Welcome Flow', description: 'First-time friend welcome', triggerType: 'friend_add' as const }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: scenario }) })
    const resource = new ScenariosResource(http)
    const result = await resource.create(input)
    expect(http.post).toHaveBeenCalledWith('/api/scenarios', input)
    expect(result).toEqual(scenario)
  })

  it('update(id, input) calls PUT /api/scenarios/:id with input', async () => {
    const scenario = {
      id: 'scenario-1',
      name: 'Updated Welcome',
      description: 'Updated description',
      triggerType: 'friend_add',
      triggerTagId: null,
      isActive: false,
      createdAt: '2026-03-21T00:00:00Z',
      updatedAt: '2026-03-21T01:00:00Z',
    }
    const input = { name: 'Updated Welcome', description: 'Updated description', isActive: false }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: scenario }) })
    const resource = new ScenariosResource(http)
    const result = await resource.update('scenario-1', input)
    expect(http.put).toHaveBeenCalledWith('/api/scenarios/scenario-1', input)
    expect(result).toEqual(scenario)
  })

  it('delete(id) calls DELETE /api/scenarios/:id', async () => {
    const http = mockHttp({ delete: vi.fn().mockResolvedValue({ success: true, data: null }) })
    const resource = new ScenariosResource(http)
    await resource.delete('scenario-1')
    expect(http.delete).toHaveBeenCalledWith('/api/scenarios/scenario-1')
  })

  it('addStep(scenarioId, input) calls POST /api/scenarios/:id/steps with input', async () => {
    const step = {
      id: 'step-1',
      scenarioId: 'scenario-1',
      stepOrder: 1,
      delayMinutes: 0,
      messageType: 'text',
      messageContent: 'Hello!',
      createdAt: '2026-03-21T00:00:00Z',
    }
    const input = { stepOrder: 1, delayMinutes: 0, messageType: 'text' as const, messageContent: 'Hello!' }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: step }) })
    const resource = new ScenariosResource(http)
    const result = await resource.addStep('scenario-1', input)
    expect(http.post).toHaveBeenCalledWith('/api/scenarios/scenario-1/steps', input)
    expect(result).toEqual(step)
  })

  it('updateStep(scenarioId, stepId, input) calls PUT /api/scenarios/:id/steps/:stepId with input', async () => {
    const step = {
      id: 'step-1',
      scenarioId: 'scenario-1',
      stepOrder: 2,
      delayMinutes: 60,
      messageType: 'text',
      messageContent: 'Updated message',
      createdAt: '2026-03-21T00:00:00Z',
    }
    const input = { messageContent: 'Updated message', delayMinutes: 60 }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: step }) })
    const resource = new ScenariosResource(http)
    const result = await resource.updateStep('scenario-1', 'step-1', input)
    expect(http.put).toHaveBeenCalledWith('/api/scenarios/scenario-1/steps/step-1', input)
    expect(result).toEqual(step)
  })

  it('deleteStep(scenarioId, stepId) calls DELETE /api/scenarios/:id/steps/:stepId', async () => {
    const http = mockHttp({ delete: vi.fn().mockResolvedValue({ success: true, data: null }) })
    const resource = new ScenariosResource(http)
    await resource.deleteStep('scenario-1', 'step-1')
    expect(http.delete).toHaveBeenCalledWith('/api/scenarios/scenario-1/steps/step-1')
  })

  it('enroll(scenarioId, friendId) calls POST /api/scenarios/:id/enroll/:friendId', async () => {
    const enrollment = {
      id: 'enrollment-1',
      friendId: 'friend-1',
      scenarioId: 'scenario-1',
      currentStepOrder: 0,
      status: 'active' as const,
      startedAt: '2026-03-21T00:00:00Z',
      nextDeliveryAt: '2026-03-21T01:00:00Z',
      updatedAt: '2026-03-21T00:00:00Z',
    }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: enrollment }) })
    const resource = new ScenariosResource(http)
    const result = await resource.enroll('scenario-1', 'friend-1')
    expect(http.post).toHaveBeenCalledWith('/api/scenarios/scenario-1/enroll/friend-1')
    expect(result).toEqual(enrollment)
  })
})
