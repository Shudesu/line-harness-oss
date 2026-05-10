'use client'

import { useState } from 'react'
import PromptModal, { type PromptTemplate } from '@/components/prompt-modal'

interface CcPromptButtonProps {
  prompts: PromptTemplate[]
  placement?: 'bottom' | 'top'
}

export default function CcPromptButton({ prompts, placement = 'bottom' }: CcPromptButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const positionClass = placement === 'top'
    ? 'fixed top-20 right-4 z-40'
    : 'fixed bottom-6 right-6 z-50'

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`${positionClass} flex items-center gap-2 px-3 py-2 min-h-[40px] bg-gray-900 text-white text-sm font-medium rounded-full shadow-lg hover:bg-gray-800 transition-colors`}
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
