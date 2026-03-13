import React from 'react'

interface DashboardLayoutProps {
  leftSidebar: React.ReactNode
  centerPanel: React.ReactNode
  rightSidebar: React.ReactNode
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ leftSidebar, centerPanel, rightSidebar }) => {
  return (
    <div className="relative z-10 flex flex-col lg:grid lg:grid-cols-[20%_55%_25%] min-h-[calc(100vh-65px)]">
      {leftSidebar}
      {centerPanel}
      {rightSidebar}
    </div>
  )
}

export default DashboardLayout
