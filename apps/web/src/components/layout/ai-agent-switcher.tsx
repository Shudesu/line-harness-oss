'use client'

import { useState } from 'react'
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { DropdownMenu } from '@cloudflare/kumo/components/dropdown'
import { AI_AGENT_IDS, AI_AGENTS } from '@line-crm/shared'
import { useAiAgent } from '@/contexts/ai-agent-context'

export default function AiAgentSwitcher() {
  const { agentId, agent, setAgentId } = useAiAgent()
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-kumo-line px-3 py-3">
      <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle">
        使用する AI エージェント
      </p>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger
          render={
            <Button
              type="button"
              variant="secondary"
              className="h-auto min-h-10 w-full justify-start px-2.5 py-2 text-left"
            />
          }
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-kumo-strong">
            {agent.label}
          </span>
          <CaretDownIcon
            className={`ml-auto shrink-0 text-kumo-subtle transition-transform ${open ? 'rotate-180' : ''}`}
            size={16}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" className="min-w-56">
          <DropdownMenu.Group>
            <DropdownMenu.Label>切り替え</DropdownMenu.Label>
            {AI_AGENT_IDS.map((id) => {
              const def = AI_AGENTS[id]
              const isSelected = id === agentId
              return (
                <DropdownMenu.Item
                  key={id}
                  selected={isSelected}
                  onClick={() => {
                    setAgentId(id)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{def.label}</span>
                  {isSelected ? (
                    <CheckIcon className="shrink-0 text-kumo-success" size={16} weight="bold" />
                  ) : null}
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu>
      <p className="mt-1.5 px-2 text-[10px] leading-snug text-kumo-subtle">
        プロンプトテンプレートの表示名が変わります。MCP 接続は各ツールの設定ファイルで行います。
      </p>
    </div>
  )
}
