'use client'

import { useState } from 'react'
import PromptModal, { type PromptTemplate } from '@/components/prompt-modal'

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
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed ${positionClassName} z-50 flex items-center gap-2 px-4 py-3 min-h-[48px] bg-gray-900 text-white text-sm font-medium rounded-full shadow-lg hover:bg-gray-800 transition-colors`}
        aria-label="CCに依頼"
      >
        <span className="text-base leading-none">📋</span>
        <span className="hidden sm:inline">CCに依頼</span>
      </button>

      <PromptModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        prompts={prompts}
      />
    </>
  )
}
