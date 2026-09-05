'use client'

import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Pagination } from '@cloudflare/kumo/components/pagination'
import InboxRow, { type InboxRowData } from './inbox-row'

interface Props {
  rows: InboxRowData[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  onPageChange: (page: number) => void
}

export default function InboxList({
  rows,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: Props) {
  return (
    <LayerCard className="overflow-hidden p-0">
      {loading ? <div className="flex items-center justify-center gap-2 border-b border-kumo-line p-3 text-xs text-kumo-subtle"><Loader size="sm" />更新中</div> : null}
      {rows.length === 0 && !loading ? (
        <Empty size="sm" title="未対応はありません" description="現在、返事待ちのLINE会話はありません。" />
      ) : (
        <div>
          {rows.map((row) => (
            <InboxRow key={row.friendId} row={row} />
          ))}
        </div>
      )}
      {total > 0 && (
        <Pagination
          className="border-t border-kumo-line px-4 py-3"
          page={page}
          setPage={onPageChange}
          perPage={pageSize}
          totalCount={total}
          labels={{ navigation: '未対応一覧のページ', firstPage: '最初のページ', previousPage: '前のページ', nextPage: '次のページ', lastPage: '最後のページ', pageNumber: 'ページ番号' }}
        >
          <Pagination.Info>{({ pageShowingRange }) => `${total.toLocaleString('ja-JP')}件中 ${pageShowingRange}件`}</Pagination.Info>
          <Pagination.Controls controls="full" pageSelector="input" />
        </Pagination>
      )}
    </LayerCard>
  )
}
