import { LineHarnessError } from './errors.js'

interface HttpClientConfig {
  baseUrl: string
  apiKey: string
  timeout: number
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeout: number

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.timeout = config.timeout
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const res = await fetch(url, options)

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`
      try {
        const errorBody = (await res.json()) as { error?: string }
        if (errorBody.error) errorMessage = errorBody.error
      } catch {
        // ignore parse errors
      }
      throw new LineHarnessError(errorMessage, res.status, `${method} ${path}`)
    }

    return res.json() as Promise<T>
  }
}
