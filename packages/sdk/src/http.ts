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

  url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  async get<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, headers)
  }

  async post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, headers)
  }

  async put<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', path, body, headers)
  }

  async patch<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PATCH', path, body, headers)
  }

  async delete<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, undefined, headers)
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = this.url(path)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
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
