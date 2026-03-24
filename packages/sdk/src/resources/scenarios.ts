import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  Scenario,
  ScenarioListItem,
  ScenarioWithSteps,
  ScenarioStep,
  CreateScenarioInput,
  CreateStepInput,
  UpdateScenarioInput,
  UpdateStepInput,
  FriendScenarioEnrollment,
} from '../types.js'

export class ScenariosResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  async list(params?: { accountId?: string }): Promise<ScenarioListItem[]> {
    const accountId = params?.accountId ?? this.defaultAccountId
    const query = accountId ? `?lineAccountId=${accountId}` : ''
    const res = await this.http.get<ApiResponse<ScenarioListItem[]>>(`/api/scenarios${query}`)
    return res.data
  }

  async get(id: string): Promise<ScenarioWithSteps> {
    const res = await this.http.get<ApiResponse<ScenarioWithSteps>>(`/api/scenarios/${id}`)
    return res.data
  }

  async create(input: CreateScenarioInput & { lineAccountId?: string }): Promise<Scenario> {
    const body = { ...input }
    if (!body.lineAccountId && this.defaultAccountId) {
      body.lineAccountId = this.defaultAccountId
    }
    const res = await this.http.post<ApiResponse<Scenario>>('/api/scenarios', body)
    return res.data
  }

  async update(id: string, input: UpdateScenarioInput): Promise<Scenario> {
    const res = await this.http.put<ApiResponse<Scenario>>(`/api/scenarios/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/scenarios/${id}`)
  }

  async addStep(scenarioId: string, input: CreateStepInput): Promise<ScenarioStep> {
    const res = await this.http.post<ApiResponse<ScenarioStep>>(`/api/scenarios/${scenarioId}/steps`, input)
    return res.data
  }

  async updateStep(scenarioId: string, stepId: string, input: UpdateStepInput): Promise<ScenarioStep> {
    const res = await this.http.put<ApiResponse<ScenarioStep>>(`/api/scenarios/${scenarioId}/steps/${stepId}`, input)
    return res.data
  }

  async deleteStep(scenarioId: string, stepId: string): Promise<void> {
    await this.http.delete(`/api/scenarios/${scenarioId}/steps/${stepId}`)
  }

  async enroll(scenarioId: string, friendId: string): Promise<FriendScenarioEnrollment> {
    const res = await this.http.post<ApiResponse<FriendScenarioEnrollment>>(
      `/api/scenarios/${scenarioId}/enroll/${friendId}`
    )
    return res.data
  }
}
