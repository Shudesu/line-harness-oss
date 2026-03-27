'use client'

const statusConfig: Record<string, { label: string; className: string }> = {
  // Job statuses
  open: { label: '公開中', className: 'bg-green-100 text-green-700' },
  filled: { label: '充足', className: 'bg-blue-100 text-blue-700' },
  completed: { label: '完了', className: 'bg-gray-100 text-gray-700' },
  cancelled: { label: 'キャンセル', className: 'bg-red-100 text-red-700' },
  // Booking approval statuses
  pending: { label: '承認待ち', className: 'bg-yellow-100 text-yellow-700' },
  approved: { label: '承認済', className: 'bg-green-100 text-green-700' },
  denied: { label: '否認', className: 'bg-red-100 text-red-700' },
}

export default function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
