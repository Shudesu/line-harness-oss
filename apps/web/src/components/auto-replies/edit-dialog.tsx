'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { api } from '@/lib/api'
import ImageUploader from '@/components/shared/image-uploader'

export interface AutoReplyDraft {
  id?: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
}

interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
}

type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

function detectMode(draft: AutoReplyDraft): ResponseMode {
  if (draft.responseType === 'silent') return 'silent'
  if (draft.templateId) return 'template'
  if (draft.responseType === 'flex') return 'inline-flex'
  if (draft.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

export default function EditDialog({ draft, templates, onClose, onSaved }: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(draft.matchType)
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const templateItems = Object.fromEntries(
    templates.map((template) => [template.id, `${template.messageType.toUpperCase()} — ${template.name}`]),
  )

  const handleSave = async () => {
    if (!keyword.trim()) { setError('キーワードを入力してください'); return }
    if (mode === 'template' && !templateId) { setError('テンプレートを選んでください'); return }
    if ((mode === 'inline-text' || mode === 'inline-flex' || mode === 'inline-image') && !responseContent.trim()) {
      setError('返信内容を入力してください'); return
    }
    setError('')
    setSaving(true)
    try {
      const body: {
        keyword: string
        matchType: 'exact' | 'contains'
        responseType: string
        responseContent: string
        templateId: string | null
        lineAccountId: string | null
        isActive: boolean
      } = {
        keyword,
        matchType,
        responseType:
          mode === 'silent' ? 'silent'
          : mode === 'inline-flex' ? 'flex'
          : mode === 'inline-image' ? 'image'
          : 'text',
        responseContent: mode === 'silent' ? '' : responseContent,
        templateId: mode === 'template' ? templateId : null,
        lineAccountId: draft.lineAccountId,
        isActive,
      }
      if (mode === 'template' && templateId) {
        const template = templates.find((candidate) => candidate.id === templateId)
        if (template) {
          body.responseType = template.messageType
          body.responseContent = template.messageContent
        }
      }
      if (draft.id) await api.autoReplies.update(draft.id, body)
      else await api.autoReplies.create(body)
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog size="lg" className="max-h-[90vh] overflow-y-auto p-0">
        <div className="border-b border-kumo-line px-6 py-4">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">
            {draft.id ? '自動返信ルールを編集' : '新しい自動返信ルール'}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
            キーワードの一致条件と返信方法を設定します。
          </Dialog.Description>
        </div>

        <div className="space-y-5 p-6">
          <Input
            label="キーワード"
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="例: コスト比較"
          />

          <div>
            <p className="mb-2 text-sm font-medium text-kumo-default">一致方法</p>
            <div className="flex gap-2">
              {(['exact', 'contains'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={matchType === value ? 'primary' : 'secondary'}
                  onClick={() => setMatchType(value)}
                  aria-pressed={matchType === value}
                >
                  {value === 'exact' ? '完全一致' : '包含'}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-kumo-default">返信方法</p>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: '返信なし' },
                { key: 'template', label: 'テンプレート' },
                { key: 'inline-text', label: 'テキスト' },
                { key: 'inline-flex', label: 'Flex JSON' },
                { key: 'inline-image', label: '画像' },
              ] as const).map(({ key, label }) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={mode === key ? 'primary' : 'secondary'}
                  onClick={() => setMode(key)}
                  aria-pressed={mode === key}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {mode === 'template' ? (
            <div>
              <Select
                label="テンプレート"
                value={templateId ?? ''}
                onValueChange={(value) => setTemplateId(value || null)}
                placeholder="選択してください"
                items={templateItems}
              />
              {templates.length === 0 ? (
                <p className="mt-2 text-xs text-kumo-warning">
                  テンプレートがありません。<Link href="/templates" className="underline">テンプレート管理</Link>で作成してください。
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === 'inline-text' || mode === 'inline-flex' ? (
            <InputArea
              label={mode === 'inline-flex' ? 'Flex JSON' : 'テキスト'}
              value={responseContent}
              onValueChange={setResponseContent}
              minRows={mode === 'inline-flex' ? 8 : 4}
              maxRows={14}
              autoResize
              className="font-mono"
            />
          ) : null}

          {mode === 'inline-image' ? (
            <ImageUploader
              mode="line-image"
              value={(() => {
                try {
                  const parsed = JSON.parse(responseContent) as { originalContentUrl?: string; previewImageUrl?: string }
                  if (parsed.originalContentUrl) {
                    return {
                      mode: 'line-image' as const,
                      originalContentUrl: parsed.originalContentUrl,
                      previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                    }
                  }
                } catch { /* invalid JSON is treated as no selected image */ }
                return null
              })()}
              onChange={(value) => {
                if (value?.mode === 'line-image') {
                  setResponseContent(JSON.stringify({
                    originalContentUrl: value.originalContentUrl,
                    previewImageUrl: value.previewImageUrl,
                  }))
                } else {
                  setResponseContent('')
                }
              }}
              label="返信画像"
            />
          ) : null}

          <Checkbox label="このルールを有効にする" checked={isActive} onCheckedChange={setIsActive} />
          {error ? <Banner size="sm" variant="error" title="保存できませんでした" description={error} /> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-kumo-line px-6 py-4">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>キャンセル</Button>
          <Button type="button" variant="primary" loading={saving} onClick={handleSave}>保存</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
