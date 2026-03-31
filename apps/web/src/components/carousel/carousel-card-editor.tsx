'use client'

export interface CarouselButton {
  label: string
  type: 'uri' | 'message' | 'postback'
  value: string
}

export interface CarouselCard {
  imageUrl: string
  title: string
  description: string
  buttons: CarouselButton[]
}

interface CarouselCardEditorProps {
  card: CarouselCard
  index: number
  total: number
  onChange: (card: CarouselCard) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

const buttonTypeLabels: Record<CarouselButton['type'], string> = {
  uri: 'URLリンク',
  message: 'メッセージ送信',
  postback: 'ポストバック',
}

export default function CarouselCardEditor({
  card,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: CarouselCardEditorProps) {
  const updateButton = (bi: number, field: string, value: string) => {
    const buttons = [...card.buttons]
    buttons[bi] = { ...buttons[bi], [field]: value }
    onChange({ ...card, buttons })
  }

  const addButton = () => {
    if (card.buttons.length >= 3) return
    onChange({ ...card, buttons: [...card.buttons, { label: '', type: 'uri', value: '' }] })
  }

  const removeButton = (bi: number) => {
    onChange({ ...card, buttons: card.buttons.filter((_, i) => i !== bi) })
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-600">カード {index + 1}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30" title="上へ">
            ↑
          </button>
          <button type="button" onClick={onMoveDown} disabled={index === total - 1} className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30" title="下へ">
            ↓
          </button>
          <button type="button" onClick={onRemove} disabled={total <= 1} className="px-1.5 py-0.5 text-xs text-red-400 hover:text-red-600 disabled:opacity-30" title="削除">
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {/* Image URL */}
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">画像URL</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="https://example.com/image.jpg"
            value={card.imageUrl}
            onChange={(e) => onChange({ ...card, imageUrl: e.target.value })}
          />
          {card.imageUrl && (
            <img
              src={card.imageUrl}
              alt="preview"
              className="mt-1 max-h-20 rounded border border-gray-200"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">タイトル（最大40文字）</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="商品名や見出し"
            maxLength={40}
            value={card.title}
            onChange={(e) => onChange({ ...card, title: e.target.value })}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">説明文（最大60文字）</label>
          <textarea
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
            rows={2}
            maxLength={60}
            placeholder="簡単な説明を入力..."
            value={card.description}
            onChange={(e) => onChange({ ...card, description: e.target.value })}
          />
        </div>

        {/* Buttons */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">ボタン（最大3個）</label>
          <div className="space-y-2">
            {card.buttons.map((btn, bi) => (
              <div key={bi} className="flex items-start gap-1.5 bg-gray-50 rounded p-2">
                <div className="flex-1 space-y-1">
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="ボタンラベル"
                    value={btn.label}
                    onChange={(e) => updateButton(bi, 'label', e.target.value)}
                  />
                  <div className="flex gap-1.5">
                    <select
                      className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                      value={btn.type}
                      onChange={(e) => updateButton(bi, 'type', e.target.value)}
                    >
                      {Object.entries(buttonTypeLabels).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder={btn.type === 'uri' ? 'https://...' : 'テキスト'}
                      value={btn.value}
                      onChange={(e) => updateButton(bi, 'value', e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeButton(bi)}
                  className="px-1 py-0.5 text-xs text-red-400 hover:text-red-600 mt-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {card.buttons.length < 3 && (
            <button
              type="button"
              onClick={addButton}
              className="mt-1 text-xs text-green-600 hover:text-green-800"
            >
              + ボタン追加
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
