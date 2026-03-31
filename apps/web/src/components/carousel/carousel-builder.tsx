'use client'

import CarouselCardEditor from './carousel-card-editor'
import type { CarouselCard } from './carousel-card-editor'
import FlexPreviewComponent from '../flex-preview'

interface CarouselBuilderProps {
  content: string
  onChange: (content: string) => void
}

function parseCards(content: string): CarouselCard[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // ignore
  }
  return [{ imageUrl: '', title: '', description: '', buttons: [] }]
}

function cardsToFlexJson(cards: CarouselCard[]): string {
  const bubbles = cards.map((card) => {
    const bubble: Record<string, unknown> = { type: 'bubble', size: 'micro' }
    if (card.imageUrl) {
      bubble.hero = {
        type: 'image',
        url: card.imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      }
    }
    const bodyContents: unknown[] = []
    if (card.title) bodyContents.push({ type: 'text', text: card.title, weight: 'bold', size: 'md', wrap: true })
    if (card.description) bodyContents.push({ type: 'text', text: card.description, size: 'xs', color: '#999999', wrap: true, margin: 'md' })
    if (bodyContents.length > 0) bubble.body = { type: 'box', layout: 'vertical', contents: bodyContents }
    if (card.buttons?.length > 0) {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: card.buttons.slice(0, 3).map((btn) => ({
          type: 'button',
          action:
            btn.type === 'uri'
              ? { type: 'uri', label: btn.label, uri: btn.value }
              : btn.type === 'postback'
                ? { type: 'postback', label: btn.label, data: btn.value }
                : { type: 'message', label: btn.label, text: btn.value },
          style: 'primary',
          color: '#06C755',
          height: 'sm',
        })),
      }
    }
    return bubble
  })
  return JSON.stringify({ type: 'carousel', contents: bubbles })
}

export default function CarouselBuilder({ content, onChange }: CarouselBuilderProps) {
  const cards = parseCards(content)

  const update = (newCards: CarouselCard[]) => {
    onChange(JSON.stringify(newCards))
  }

  const handleCardChange = (index: number, card: CarouselCard) => {
    const next = [...cards]
    next[index] = card
    update(next)
  }

  const handleRemove = (index: number) => {
    if (cards.length <= 1) return
    update(cards.filter((_, i) => i !== index))
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const next = [...cards]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    update(next)
  }

  const handleMoveDown = (index: number) => {
    if (index === cards.length - 1) return
    const next = [...cards]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    update(next)
  }

  const handleAdd = () => {
    if (cards.length >= 10) return
    update([...cards, { imageUrl: '', title: '', description: '', buttons: [] }])
  }

  // Build preview Flex JSON
  const previewJson = cardsToFlexJson(cards)

  return (
    <div className="space-y-3">
      {cards.map((card, i) => (
        <CarouselCardEditor
          key={i}
          card={card}
          index={i}
          total={cards.length}
          onChange={(updated) => handleCardChange(i, updated)}
          onRemove={() => handleRemove(i)}
          onMoveUp={() => handleMoveUp(i)}
          onMoveDown={() => handleMoveDown(i)}
        />
      ))}

      {cards.length < 10 && (
        <button
          type="button"
          onClick={handleAdd}
          className="w-full py-2 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-green-400 hover:text-green-600 transition-colors"
        >
          + カード追加（{cards.length}/10）
        </button>
      )}

      {/* Preview */}
      {cards.some((c) => c.title || c.imageUrl) && (
        <div className="border border-gray-200 rounded-lg p-3 bg-white">
          <p className="text-xs text-gray-400 mb-2">プレビュー</p>
          <FlexPreviewComponent content={previewJson} />
        </div>
      )}
    </div>
  )
}
