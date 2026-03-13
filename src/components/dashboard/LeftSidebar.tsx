import React from 'react'

interface LeftSidebarProps {
  children: React.ReactNode
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({ children }) => {
  return (
    <aside className="flex flex-col gap-4 p-4 border-r border-border overflow-y-auto">
      {children}
    </aside>
  )
}

export default LeftSidebar
