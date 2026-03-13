import React from 'react'

interface RightSidebarProps {
  children: React.ReactNode
}

const RightSidebar: React.FC<RightSidebarProps> = ({ children }) => {
  return (
    <aside className="flex flex-col gap-4 p-4 border-l border-border overflow-y-auto">
      {children}
    </aside>
  )
}

export default RightSidebar
