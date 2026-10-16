import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  Task,
  TaskCounts,
  TaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksParams,
} from '../types.js'

export class TasksResource {
  constructor(private readonly http: HttpClient) {}

  /** Tasks ordered by due date, soonest first, undated last. */
  async list(params: ListTasksParams = {}): Promise<{ tasks: Task[]; counts: TaskCounts }> {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.groupId) query.set('groupId', params.groupId)
    if (params.openOnly) query.set('openOnly', '1')
    const suffix = query.toString() ? `?${query}` : ''
    const res = await this.http.get<ApiResponse<Task[]> & { counts: TaskCounts }>(
      `/api/tasks${suffix}`,
    )
    return { tasks: res.data, counts: res.counts }
  }

  async get(id: string): Promise<Task> {
    const res = await this.http.get<ApiResponse<Task>>(`/api/tasks/${id}`)
    return res.data
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const res = await this.http.post<ApiResponse<Task>>('/api/tasks', input)
    return res.data
  }

  /** Patch only the supplied fields. `dueDate: null` clears the deadline. */
  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const res = await this.http.patch<ApiResponse<Task>>(`/api/tasks/${id}`, input)
    return res.data
  }

  async complete(id: string): Promise<Task> {
    return this.update(id, { status: 'done' as TaskStatus })
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/tasks/${id}`)
  }
}
