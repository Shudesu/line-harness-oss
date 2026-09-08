'use client'

import type { Area } from './canvas-editor'

type PageOption = { id: string; name: string }

type Props = {
  area: Area
  pages: PageOption[]
  onUpdate: (patch: Partial<Area>) => void
  onDelete: () => void
}

function defaultActionData(type: Area['actionType']): Record<string, unknown> {
  switch (type) {
    case 'uri':
      return { uri: '' }
    case 'message':
      return { text: '' }
    case 'postback':
      return { data: '', displayText: '' }
    case 'richmenuswitch':
      return { targetPageId: '' }
  }
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
      />
    </label>
  )
}

export function AreaProperties({ area, pages, onUpdate, onDelete }: Props) {
  const data = (area.actionData ?? {}) as Record<string, unknown>

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700">選択中エリア</h3>
        <button
          onClick={onDelete}
          className="text-xs text-red-600 hover:underline"
        >
          削除
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="x" value={area.boundsX} onChange={(v) => onUpdate({ boundsX: v })} />
        <NumField label="y" value={area.boundsY} onChange={(v) => onUpdate({ boundsY: v })} />
        <NumField
          label="幅"
          value={area.boundsWidth}
          onChange={(v) => onUpdate({ boundsWidth: v })}
        />
        <NumField
          label="高さ"
          value={area.boundsHeight}
          onChange={(v) => onUpdate({ boundsHeight: v })}
        />
      </div>

      <label className="block">
        <span className="text-xs text-gray-500">アクション</span>
        <select
          value={area.actionType}
          onChange={(e) => {
            const next = e.target.value as Area['actionType']
            onUpdate({ actionType: next, actionData: defaultActionData(next) })
          }}
          className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="uri">URL を開く (uri)</option>
          <option value="message">テキスト送信 (message)</option>
          <option value="postback">postback</option>
          <option value="richmenuswitch">タブ切替 (richmenuswitch)</option>
        </select>
      </label>

      {area.actionType === 'uri' && (
        <label className="block">
          <span className="text-xs text-gray-500">URL</span>
          <input
            type="url"
            value={(data.uri as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, uri: e.target.value } })}
            placeholder="https://..."
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
          {!(data.uri as string)?.trim() ? (
            <p className="mt-1 text-[11px] text-red-600">URL は必須です（未入力のままだと登録時にエラーになります）</p>
          ) : (
            <p className="mt-1 text-[11px] text-gray-500">
              LINE 配信用 URL は tracked link (短縮 URL) 経由を推奨。
            </p>
          )}
        </label>
      )}

      {area.actionType === 'message' && (
        <label className="block">
          <span className="text-xs text-gray-500">送信テキスト</span>
          <input
            value={(data.text as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, text: e.target.value } })}
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
          {!(data.text as string)?.trim() && (
            <p className="mt-1 text-[11px] text-red-600">送信テキストは必須です（未入力のままだと登録時にエラーになります）</p>
          )}
        </label>
      )}

      {area.actionType === 'postback' && (
        <>
          <label className="block">
            <span className="text-xs text-gray-500">postback data</span>
            <input
              value={(data.data as string) ?? ''}
              onChange={(e) => onUpdate({ actionData: { ...data, data: e.target.value } })}
              className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
            {!(data.data as string)?.trim() && (
              <p className="mt-1 text-[11px] text-red-600">postback data は必須です（未入力のままだと登録時にエラーになります）</p>
            )}
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">displayText (任意)</span>
            <input
              value={(data.displayText as string) ?? ''}
              onChange={(e) =>
                onUpdate({ actionData: { ...data, displayText: e.target.value } })
              }
              className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
        </>
      )}

      {area.actionType === 'richmenuswitch' && (
        <label className="block">
          <span className="text-xs text-gray-500">遷移先ページ</span>
          <select
            value={(data.targetPageId as string) ?? ''}
            onChange={(e) =>
              onUpdate({ actionData: { ...data, targetPageId: e.target.value } })
            }
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">選択...</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pages.length < 2 && (
            <p className="mt-1 text-[11px] text-amber-600">
              タブ切替には複数ページが必要です。先にページを追加してください。
            </p>
          )}
        </label>
      )}
    </div>
  )
}
