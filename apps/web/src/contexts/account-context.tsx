'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'

const STORAGE_KEY = 'lh_selected_account'

export interface AccountWithStats {
  id: string
  channelId: string
  name: string
  displayName?: string
  pictureUrl?: string
  basicId?: string
  isActive: boolean
  stats?: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
}

interface AccountContextValue {
  accounts: AccountWithStats[]
  selectedAccountId: string | null
  selectedAccount: AccountWithStats | null
  setSelectedAccountId: (id: string) => void
  refreshAccounts: () => Promise<void>
  loading: boolean
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const setSelectedAccountId = useCallback((id: string) => {
    setSelectedAccountIdState(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await api.lineAccounts.list()
      if (res.success && res.data.length > 0) {
        const list = res.data as AccountWithStats[]
        setAccounts(list)

        // If current selection is invalid (e.g. deleted), fall back to first
        setSelectedAccountIdState((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev
          // Restore from localStorage or default to first
          let stored: string | null = null
          try {
            stored = localStorage.getItem(STORAGE_KEY)
          } catch {
            // localStorage unavailable
          }
          const valid = stored && list.some((a) => a.id === stored)
          return valid ? stored : list[0].id
        })
      } else {
        setAccounts([])
        setSelectedAccountIdState(null)
      }
    } catch {
      // Failed to load accounts
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <AccountContext.Provider
      value={{ accounts, selectedAccountId, selectedAccount, setSelectedAccountId, refreshAccounts, loading }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}
