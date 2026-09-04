'use client'

import { useState } from 'react'
import PromptModal, { type PromptTemplate } from '@/components/prompt-modal'
import { Button } from '@cloudflare/kumo/components/button'

interface CcPromptButtonProps {
  prompts: PromptTemplate[]
  /**
   * 固定位置を指定する Tailwind クラス。既定は右下。
   * チャット画面のようにページ下端まで操作要素がある画面では、送信ボタンと
   * 重なってクリックを奪ってしまうため、呼び出し側でずらす。
   */
  positionClassName?: string
}

export default function CcPromptButton({ prompts, positionClassName = 'bottom-6 right-6' }: CcPromptButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`fixed ${positionClassName} z-50 rounded-full shadow-lg`}
        variant="primary"
        aria-label="CCに依頼"
      >
        <span className="text-base leading-none">📋</span>
        <span className="hidden sm:inline">CCに依頼</span>
      </Button>

      <PromptModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        prompts={prompts}
      />
    </>
  )
}
