'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AI_AGENTS,
  DEFAULT_AI_AGENT_ID,
  LH_PREFERRED_AI_AGENT_STORAGE_KEY,
  resolveAiAgentId,
  type AiAgentDefinition,
  type AiAgentId,
} from '@line-crm/shared'

export const AI_AGENT_CHANGED_EVENT = 'lh-ai-agent-changed'

interface AiAgentContextValue {
  agentId: AiAgentId
  agent: AiAgentDefinition
  setAgentId: (id: AiAgentId) => void
}

const AiAgentContext = createContext<AiAgentContextValue | null>(null)

function readStoredAgentId(): AiAgentId {
  if (typeof window === 'undefined') return DEFAULT_AI_AGENT_ID
  return resolveAiAgentId(localStorage.getItem(LH_PREFERRED_AI_AGENT_STORAGE_KEY))
}

export function AiAgentProvider({ children }: { children: ReactNode }) {
  const [agentId, setAgentIdState] = useState<AiAgentId>(DEFAULT_AI_AGENT_ID)

  useEffect(() => {
    setAgentIdState(readStoredAgentId())
  }, [])

  const setAgentId = useCallback((id: AiAgentId) => {
    setAgentIdState(id)
    localStorage.setItem(LH_PREFERRED_AI_AGENT_STORAGE_KEY, id)
    window.dispatchEvent(new CustomEvent(AI_AGENT_CHANGED_EVENT, { detail: id }))
  }, [])

  useEffect(() => {
    const onExternalChange = () => setAgentIdState(readStoredAgentId())
    window.addEventListener(AI_AGENT_CHANGED_EVENT, onExternalChange)
    window.addEventListener('storage', onExternalChange)
    return () => {
      window.removeEventListener(AI_AGENT_CHANGED_EVENT, onExternalChange)
      window.removeEventListener('storage', onExternalChange)
    }
  }, [])

  const value = useMemo(
    () => ({
      agentId,
      agent: AI_AGENTS[agentId],
      setAgentId,
    }),
    [agentId, setAgentId],
  )

  return <AiAgentContext.Provider value={value}>{children}</AiAgentContext.Provider>
}

export function useAiAgent(): AiAgentContextValue {
  const ctx = useContext(AiAgentContext)
  if (!ctx) {
    throw new Error('useAiAgent must be used within AiAgentProvider')
  }
  return ctx
}
