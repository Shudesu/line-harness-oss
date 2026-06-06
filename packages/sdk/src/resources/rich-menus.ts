import type { HttpClient } from '../http.js'
import type { ApiResponse, RichMenu, CreateRichMenuInput } from '../types.js'

export interface RichMenuRequestOptions {
  accountId?: string
}

function accountQuery(options?: RichMenuRequestOptions): string {
  return options?.accountId ? `?${new URLSearchParams({ accountId: options.accountId }).toString()}` : ''
}

export class RichMenusResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  private options(options?: RichMenuRequestOptions): RichMenuRequestOptions {
    return { accountId: options?.accountId ?? this.defaultAccountId }
  }

  async list(options?: RichMenuRequestOptions): Promise<RichMenu[]> {
    const res = await this.http.get<ApiResponse<RichMenu[]>>(`/api/rich-menus${accountQuery(this.options(options))}`)
    return res.data
  }

  async create(menu: CreateRichMenuInput, options?: RichMenuRequestOptions): Promise<{ richMenuId: string }> {
    const res = await this.http.post<ApiResponse<{ richMenuId: string }>>(`/api/rich-menus${accountQuery(this.options(options))}`, menu)
    return res.data
  }

  async delete(richMenuId: string, options?: RichMenuRequestOptions): Promise<void> {
    await this.http.delete(`/api/rich-menus/${encodeURIComponent(richMenuId)}${accountQuery(this.options(options))}`)
  }

  async setDefault(richMenuId: string, options?: RichMenuRequestOptions): Promise<void> {
    await this.http.post(`/api/rich-menus/${encodeURIComponent(richMenuId)}/default${accountQuery(this.options(options))}`)
  }

  async uploadImage(richMenuId: string, image: string, contentType: 'image/png' | 'image/jpeg' = 'image/png', options?: RichMenuRequestOptions): Promise<void> {
    await this.http.post(`/api/rich-menus/${encodeURIComponent(richMenuId)}/image${accountQuery(this.options(options))}`, {
      image,
      contentType,
    })
  }

  async saveAlias(
    richMenuAliasId: string,
    richMenuId: string,
    options?: RichMenuRequestOptions & { upsert?: boolean },
  ): Promise<void> {
    await this.http.post(`/api/rich-menus/aliases${accountQuery(this.options(options))}`, {
      richMenuAliasId,
      richMenuId,
      upsert: options?.upsert ?? true,
    })
  }

  async deleteAlias(richMenuAliasId: string, options?: RichMenuRequestOptions): Promise<void> {
    await this.http.delete(`/api/rich-menus/aliases/${encodeURIComponent(richMenuAliasId)}${accountQuery(this.options(options))}`)
  }
}
