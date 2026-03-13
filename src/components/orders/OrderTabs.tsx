import React from 'react'

interface OrderTabsProps {
  activeTab: 'new' | 'active' | 'history'
  onTabChange: (tab: 'new' | 'active' | 'history') => void
  children: React.ReactNode
}

const tabs: { key: 'new' | 'active' | 'history'; label: string }[] = [
  { key: 'new', label: 'New Order' },
  { key: 'active', label: 'My Orders' },
  { key: 'history', label: 'History' },
]

const OrderTabs: React.FC<OrderTabsProps> = ({ activeTab, onTabChange, children }) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 p-1 rounded-lg bg-secondary/50">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-mono transition-all duration-200 ${
              activeTab === t.key
                ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

export default OrderTabs
