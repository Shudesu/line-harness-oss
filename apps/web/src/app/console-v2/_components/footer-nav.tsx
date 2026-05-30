import type { TabId } from '../types'
import { tabs } from '../utils'

const icons: Record<TabId, string> = {
  main: '⌂',
  messages: '✉',
  broadcast: '◉',
  forms: '▣',
  analytics: '↗',
}

export function FooterNav({ activeTab, onChange }: { activeTab: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mx-auto grid max-w-4xl grid-cols-5 gap-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`rounded-2xl px-2 py-2 text-center transition ${
                active ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="block text-lg leading-none">{icons[tab.id]}</span>
              <span className="mt-1 block text-[11px] font-bold">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
