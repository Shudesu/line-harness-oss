'use client'

import Header from '@/components/layout/header'
import WebinarForm from '@/components/webinars/webinar-form'

export default function NewWebinarPage() {
  return (
    <>
      <Header title="ウェビナー作成" />
      <div className="p-6">
        <WebinarForm />
      </div>
    </>
  )
}
