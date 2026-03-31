'use client'

import { useState, useMemo } from 'react'
import FlexPreviewComponent from '../flex-preview'
import { FLEX_TEMPLATES, TEMPLATE_CATEGORIES } from './templates'
import type { FlexTemplate } from './templates'

interface FlexTemplateGalleryProps {
  onSelect: (flexJson: string) => void
  onClose: () => void
}

export default function FlexTemplateGallery({ onSelect, onClose }: FlexTemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<FlexTemplate | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  const filteredTemplates = useMemo(() => {
    if (!selectedCategory) return FLEX_TEMPLATES
    return FLEX_TEMPLATES.filter((t) => t.category === selectedCategory)
  }, [selectedCategory])

  const handleSelectTemplate = (tmpl: FlexTemplate) => {
    setSelectedTemplate(tmpl)
    const defaults: Record<string, string> = {}
    for (const f of tmpl.fields) {
      defaults[f.key] = f.defaultValue || ''
    }
    setFieldValues(defaults)
  }

  const handleBack = () => {
    setSelectedTemplate(null)
    setFieldValues({})
  }

  const handleApply = () => {
    if (!selectedTemplate) return
    const json = selectedTemplate.generate(fieldValues)
    // Remove undefined values (e.g. empty hero/footer)
    const cleaned = JSON.parse(JSON.stringify(json))
    onSelect(JSON.stringify(cleaned, null, 2))
  }

  const previewJson = useMemo(() => {
    if (!selectedTemplate) return ''
    try {
      const json = selectedTemplate.generate(fieldValues)
      return JSON.stringify(JSON.parse(JSON.stringify(json)), null, 2)
    } catch {
      return ''
    }
  }, [selectedTemplate, fieldValues])

  // ─── Template editing view ────────────────────────────────────
  if (selectedTemplate) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={handleBack} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">
              ← 戻る
            </button>
            <h3 className="text-sm font-semibold text-gray-900">{selectedTemplate.name}</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
              style={{ backgroundColor: '#06C755' }}
            >
              このテンプレートを使う
            </button>
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
              閉じる
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fields */}
          <div className="space-y-3">
            {selectedTemplate.fields.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                {field.type === 'textarea' ? (
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                    rows={2}
                    placeholder={field.placeholder}
                    value={fieldValues[field.key] || ''}
                    onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                  />
                ) : field.type === 'color' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                      value={fieldValues[field.key] || '#06C755'}
                      onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                    />
                    <input
                      type="text"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      value={fieldValues[field.key] || ''}
                      onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                    />
                  </div>
                ) : (
                  <input
                    type={field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'text'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder={field.placeholder}
                    value={fieldValues[field.key] || ''}
                    onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Preview */}
          <div>
            <p className="text-xs text-gray-400 mb-2">プレビュー</p>
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 min-h-[200px]">
              {previewJson && <FlexPreviewComponent content={previewJson} />}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Gallery view ─────────────────────────────────────────────
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Flexテンプレートを選択</h3>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">
          閉じる
        </button>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            !selectedCategory ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          すべて
        </button>
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              selectedCategory === cat ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {filteredTemplates.map((tmpl) => {
          const defaults: Record<string, string> = {}
          for (const f of tmpl.fields) defaults[f.key] = f.defaultValue || ''
          const previewContent = JSON.stringify(JSON.parse(JSON.stringify(tmpl.generate(defaults))))

          return (
            <button
              key={tmpl.id}
              onClick={() => handleSelectTemplate(tmpl)}
              className="border border-gray-200 rounded-lg p-2 hover:border-green-400 hover:shadow-sm transition-all text-left"
            >
              <div className="h-28 overflow-hidden rounded bg-gray-50 mb-2 flex items-start justify-center p-1">
                <div className="transform scale-[0.35] origin-top">
                  <FlexPreviewComponent content={previewContent} />
                </div>
              </div>
              <p className="text-xs font-medium text-gray-900 truncate">{tmpl.name}</p>
              <p className="text-[10px] text-gray-400 truncate">{tmpl.description}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
