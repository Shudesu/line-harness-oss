'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckSquareIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'
import {
  api,
  ApiError,
  type LineGroupItem,
  type TaskCounts,
  type TaskItem,
  type TaskStatus,
} from '@/lib/api'
import Header from '@/components/layout/header'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '未着手',
  doing: '進行中',
  done: '完了',
}

const EMPTY_COUNTS: TaskCounts = { todo: 0, doing: 0, done: 0, overdue: 0 }

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `サーバーがエラーを返しました (${err.status})`
  return err instanceof Error ? err.message : String(err)
}

/** Today in JST as 'YYYY-MM-DD' — the same shape the API stores due dates in. */
function todayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [counts, setCounts] = useState<TaskCounts>(EMPTY_COUNTS)
  const [groups, setGroups] = useState<LineGroupItem[]>([])
  const [statusFilter, setStatusFilter] = useState<'' | TaskStatus>('')
  const [groupFilter, setGroupFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newGroupId, setNewGroupId] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [newAssignee, setNewAssignee] = useState('')

  const today = useMemo(todayJst, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.tasks.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(groupFilter ? { groupId: groupFilter } : {}),
      })
      setTasks(res.data)
      setCounts(res.counts ?? EMPTY_COUNTS)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, groupFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.groups.list()
        setGroups(res.data)
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
  }, [])

  const groupItems = useMemo(
    () => groups.map((g) => ({ value: g.id, label: g.name ?? g.id })),
    [groups],
  )

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (!title) return
    setSaving(true)
    try {
      await api.tasks.create({
        title,
        groupId: newGroupId || null,
        dueDate: newDueDate || null,
        assignee: newAssignee.trim() || null,
      })
      setNewTitle('')
      setNewDueDate('')
      setNewAssignee('')
      setCreating(false)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (task: TaskItem, status: TaskStatus) => {
    try {
      await api.tasks.update(task.id, { status })
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const remove = async (task: TaskItem) => {
    try {
      await api.tasks.delete(task.id)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div>
      <Header
        title="タスク"
        description="グループ単位のタスクを期限の近い順に並べます。期限なしは末尾に表示されます。"
        action={(
          <Button
            type="button"
            variant="primary"
            icon={PlusIcon}
            onClick={() => {
              setCreating((current) => !current)
              setError('')
            }}
          >
            新規タスク
          </Button>
        )}
      />

      {error ? (
        <Banner
          className="mb-4"
          variant="error"
          title="操作を完了できませんでした"
          description={error}
        />
      ) : null}

      {creating ? (
        <LayerCard className="mb-4 p-5">
          <div className="grid items-end gap-4 lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto]">
            <Input
              label="件名"
              type="text"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreate()
              }}
              placeholder="例: 契約書のドラフトを送る"
              autoFocus
            />
            <Select
              label="グループ"
              value={newGroupId}
              onValueChange={(value) => setNewGroupId(value ?? '')}
              items={[{ value: '', label: '紐づけない' }, ...groupItems]}
            />
            <Input
              label="期限"
              type="date"
              value={newDueDate}
              onChange={(event) => setNewDueDate(event.target.value)}
            />
            <Input
              label="担当"
              type="text"
              value={newAssignee}
              onChange={(event) => setNewAssignee(event.target.value)}
              placeholder="例: 小嶋"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                loading={saving}
                disabled={!newTitle.trim()}
                onClick={handleCreate}
              >
                作成
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreating(false)
                  setNewTitle('')
                }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        </LayerCard>
      ) : null}

      <LayerCard className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            size="sm"
            label="状態"
            value={statusFilter}
            onValueChange={(value) => setStatusFilter((value ?? '') as '' | TaskStatus)}
            items={[
              { value: '', label: 'すべて' },
              { value: 'todo', label: STATUS_LABELS.todo },
              { value: 'doing', label: STATUS_LABELS.doing },
              { value: 'done', label: STATUS_LABELS.done },
            ]}
          />
          <Select
            size="sm"
            label="グループ"
            value={groupFilter}
            onValueChange={(value) => setGroupFilter(value ?? '')}
            items={[{ value: '', label: 'すべて' }, ...groupItems]}
          />
          <span className="ml-auto pb-1 text-xs text-kumo-subtle">
            未着手 {counts.todo} / 進行中 {counts.doing} / 完了 {counts.done}
            {counts.overdue > 0 ? ` · 期限切れ ${counts.overdue}` : ''}
          </span>
        </div>
      </LayerCard>

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>件名</Table.Head>
                <Table.Head>グループ</Table.Head>
                <Table.Head>期限</Table.Head>
                <Table.Head>担当</Table.Head>
                <Table.Head>状態</Table.Head>
                <Table.Head />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={6} className="py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-sm text-kumo-subtle">
                      <Loader size="sm" /> 読み込み中
                    </span>
                  </Table.Cell>
                </Table.Row>
              ) : tasks.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={6} className="p-0">
                    <Empty
                      size="sm"
                      icon={<CheckSquareIcon size={32} />}
                      title="タスクがありません"
                      description="グループに紐づけてタスクを作ると、期限の近い順に並びます。"
                      contents={(
                        <Button
                          type="button"
                          variant="primary"
                          icon={PlusIcon}
                          onClick={() => setCreating(true)}
                        >
                          新規タスク
                        </Button>
                      )}
                    />
                  </Table.Cell>
                </Table.Row>
              ) : (
                tasks.map((task) => {
                  const overdue =
                    task.status !== 'done' && task.dueDate !== null && task.dueDate < today
                  return (
                    <Table.Row key={task.id}>
                      <Table.Cell>
                        <span
                          className={
                            task.status === 'done'
                              ? 'text-kumo-subtle line-through'
                              : 'font-medium text-kumo-strong'
                          }
                        >
                          {task.title}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-sm text-kumo-default">
                        {task.groupName ?? (task.groupId ? task.groupId : '—')}
                      </Table.Cell>
                      <Table.Cell
                        className={
                          overdue
                            ? 'text-xs font-medium text-kumo-danger'
                            : 'text-xs text-kumo-subtle'
                        }
                      >
                        {task.dueDate ?? '—'}
                        {overdue ? ' (期限切れ)' : ''}
                      </Table.Cell>
                      <Table.Cell className="text-sm text-kumo-default">
                        {task.assignee ?? '—'}
                      </Table.Cell>
                      <Table.Cell>
                        <Select
                          size="sm"
                          value={task.status}
                          aria-label={`${task.title} の状態`}
                          onValueChange={(value) =>
                            void changeStatus(task, (value ?? 'todo') as TaskStatus)
                          }
                          items={[
                            { value: 'todo', label: STATUS_LABELS.todo },
                            { value: 'doing', label: STATUS_LABELS.doing },
                            { value: 'done', label: STATUS_LABELS.done },
                          ]}
                        />
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-right">
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary-destructive"
                          icon={TrashIcon}
                          onClick={() => void remove(task)}
                        >
                          削除
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )
                })
              )}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>
    </div>
  )
}
