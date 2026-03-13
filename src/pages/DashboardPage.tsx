import React, { useState, useCallback } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { useSession } from '@/hooks/useSession'
import { useOrders } from '@/hooks/useOrders'
import { useActivityFeed } from '@/hooks/useActivityFeed'
import { useMatchPolling } from '@/hooks/useMatchPolling'
import { ToastMessage } from '@/types'
import GradientBackground from '@/components/layout/GradientBackground'
import Navbar from '@/components/layout/Navbar'
import ToastContainer from '@/components/layout/ToastContainer'
import DashboardLayout from '@/components/dashboard/DashboardLayout'
import LeftSidebar from '@/components/dashboard/LeftSidebar'
import CenterPanel from '@/components/dashboard/CenterPanel'
import RightSidebar from '@/components/dashboard/RightSidebar'
import SessionIdentityCard from '@/components/session/SessionIdentityCard'
import CollateralPanel from '@/components/session/CollateralPanel'
import SessionStatsPanel from '@/components/session/SessionStatsPanel'
import OrderTabs from '@/components/orders/OrderTabs'
import NewOrderForm from '@/components/orders/NewOrderForm'
import MyOrdersTable from '@/components/orders/MyOrdersTable'
import TradeHistoryTable from '@/components/orders/TradeHistoryTable'
import ActivityFeed from '@/components/activity/ActivityFeed'
import OrderDepthChart from '@/components/activity/OrderDepthChart'
import SettlementQueue from '@/components/activity/SettlementQueue'
import MatchFoundModal from '@/components/modals/MatchFoundModal'

const DashboardPage: React.FC = () => {
  const { walletState, connectWallet, disconnectWallet } = useWallet()
  const { session, collateral, stats, rotateAddress, isRotating } = useSession()
  const { activeOrders, tradeHistory, submitOrder, cancelOrder, isSubmitting, lastSubmitTime } = useOrders()
  const { events } = useActivityFeed()
  const { currentMatch, dismissMatch } = useMatchPolling(lastSubmitTime)
  const [activeTab, setActiveTab] = useState<'new' | 'active' | 'history'>('new')
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    setToasts(prev => [...prev, { ...t, id: Date.now().toString() }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const handleSettlementComplete = useCallback(() => {
    rotateAddress()
    addToast({ type: 'rotation', message: '🔄 Address rotated — session closed' })
  }, [rotateAddress, addToast])

  return (
    <>
      <GradientBackground />
      <Navbar walletState={walletState} onConnect={connectWallet} onDisconnect={disconnectWallet} />
      <DashboardLayout
        leftSidebar={
          <LeftSidebar>
            <SessionIdentityCard session={session} onRotate={rotateAddress} isRotating={isRotating} />
            <CollateralPanel collateral={collateral} />
            <SessionStatsPanel stats={stats} />
          </LeftSidebar>
        }
        centerPanel={
          <CenterPanel>
            <OrderTabs activeTab={activeTab} onTabChange={setActiveTab}>
              {activeTab === 'new' && <NewOrderForm onSubmit={submitOrder} isSubmitting={isSubmitting} />}
              {activeTab === 'active' && <MyOrdersTable orders={activeOrders} onCancel={cancelOrder} />}
              {activeTab === 'history' && <TradeHistoryTable history={tradeHistory} />}
            </OrderTabs>
          </CenterPanel>
        }
        rightSidebar={
          <RightSidebar>
            <ActivityFeed events={events} />
            <OrderDepthChart buyPressure={65} sellPressure={45} midPrice={3241} />
            <SettlementQueue pendingSettlements={[]} />
          </RightSidebar>
        }
      />
      <MatchFoundModal
        match={currentMatch}
        onDismiss={dismissMatch}
        onSettlementComplete={handleSettlementComplete}
      />
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}

export default DashboardPage
