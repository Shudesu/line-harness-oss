'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import ScenarioDetailClient from './scenario-detail-client'

function DetailInner() {
  const params = useSearchParams()
  const id = params.get('id')
  
  if (!id) {
    return <div className="p-8 text-center text-gray-500">シナリオIDが指定されていません</div>
  }
  
  return <ScenarioDetailClient scenarioId={id} />
}

export default function ScenarioDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">読み込み中...</div>}>
      <DetailInner />
    </Suspense>
  )
}
