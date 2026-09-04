'use client'

import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import ImageUploader from './image-uploader'

export interface OgValue {
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
}

export interface OgEditorProps {
  value: OgValue
  onChange: (v: OgValue) => void
  /** auto-generate プレースホルダ表示用。空欄なら自動値が使われる旨を示す。 */
  autoTitle?: string
  autoDescription?: string
  autoImageUrl?: string
  /** account 用 — title slot を非表示にする。account には個別 og:title は不要。 */
  hideTitle?: boolean
}

const TITLE_MAX = 80
const DESC_MAX = 200

export default function OgEditor({
  value,
  onChange,
  autoTitle,
  autoDescription,
  autoImageUrl,
  hideTitle = false,
}: OgEditorProps) {
  const set = <K extends keyof OgValue>(k: K, v: OgValue[K]) =>
    onChange({ ...value, [k]: v })

  return (
    <LayerCard className="space-y-3 bg-kumo-tint p-4">
      <div className="text-sm font-medium text-kumo-strong">
        リンクプレビュー（OGP）
      </div>
      <div className="text-xs text-kumo-subtle">
        LINE / X / Facebook 等にリンクを貼ったときに表示されるカードの内容。
        空欄なら自動で生成されます。
      </div>

      {!hideTitle ? (
        <div>
          <Input
            label="タイトル"
            value={value.ogTitle ?? ''}
            maxLength={TITLE_MAX}
            placeholder={autoTitle ? `自動: ${autoTitle}` : '（自動生成）'}
            onValueChange={(nextValue) => set('ogTitle', nextValue || null)}
          />
          <div className="mt-1 text-xs text-kumo-subtle">
            {(value.ogTitle ?? '').length} / {TITLE_MAX}
          </div>
        </div>
      ) : null}

      <div>
        <InputArea
          label="説明文"
          value={value.ogDescription ?? ''}
          maxLength={DESC_MAX}
          placeholder={
            autoDescription ? `自動: ${autoDescription}` : '（自動生成）'
          }
          minRows={3}
          maxRows={6}
          autoResize
          onValueChange={(nextValue) => set('ogDescription', nextValue || null)}
        />
        <div className="mt-1 text-xs text-kumo-subtle">
          {(value.ogDescription ?? '').length} / {DESC_MAX}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-kumo-default">画像</p>
        <ImageUploader
          mode="url"
          value={value.ogImageUrl ? { mode: 'url', url: value.ogImageUrl } : null}
          onChange={(v) =>
            set('ogImageUrl', v?.mode === 'url' ? v.url : null)
          }
        />
        {!value.ogImageUrl && autoImageUrl ? (
          <div className="mt-1 text-xs text-kumo-subtle">
            自動: {autoImageUrl}
          </div>
        ) : null}
      </div>
    </LayerCard>
  )
}
