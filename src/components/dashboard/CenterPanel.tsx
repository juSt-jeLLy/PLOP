import React from 'react'

interface CenterPanelProps {
  children: React.ReactNode
}

const CenterPanel: React.FC<CenterPanelProps> = ({ children }) => {
  return (
    <main className="flex flex-col gap-4 p-4 overflow-y-auto">
      {children}
    </main>
  )
}

export default CenterPanel
