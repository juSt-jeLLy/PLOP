// @refresh reset
import React, { useState, useCallback } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { useSession } from '@/hooks/useSession'
import { useOrders } from '@/hooks/useOrders'
import { usePoolActivity } from '@/hooks/usePoolActivity'
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
import DepositInstructionsModal from '@/components/modals/DepositInstructionsModal'

const DashboardPage: React.FC = () => {
  const { walletState, connectWallet, disconnectWallet } = useWallet()
  const {
    session,
    collateral,
    stats,
    refreshSession,
    isRotating,
    sessionError,
    settlementState,
    retrySettlement,
    engineConfig,
    engineConfigStatus,
    reloadEngineConfig,
  } = useSession(walletState.address)
  const {
    activeOrders,
    tradeHistory,
    submitOrder,
    cancelOrder,
    isSubmitting,
    lastSubmitTime,
    depositRequest,
    clearDepositRequest,
  } = useOrders({
    sessionSubname: session.ensSubname,
    walletConnected: walletState.connected,
    enginePublicKey: engineConfig?.enginePublicKey ?? null,
    sessionDepositAddress: session.depositAddress || null,
    walletAddress: walletState.address,
  })
  const pool = usePoolActivity()
  const [activeTab, setActiveTab] = useState<'new' | 'active' | 'history'>('new')
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    setToasts(prev => [...prev, { ...t, id: Date.now().toString() }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <>
      <GradientBackground />
      <Navbar walletState={walletState} onConnect={connectWallet} onDisconnect={disconnectWallet} />
      <DashboardLayout
        leftSidebar={
          <LeftSidebar>
            <SessionIdentityCard
              session={session}
              onRotate={refreshSession}
              isRotating={isRotating}
              walletConnected={walletState.connected}
              onConnect={connectWallet}
              walletAddress={walletState.address}
              settlementState={settlementState}
              onAuthorizeSettlement={retrySettlement}
              configStatus={engineConfigStatus}
              onReloadConfig={reloadEngineConfig}
              error={sessionError}
            />
            <CollateralPanel collateral={collateral} />
            <SessionStatsPanel stats={stats} />
          </LeftSidebar>
        }
        centerPanel={
          <CenterPanel>
            <OrderTabs activeTab={activeTab} onTabChange={setActiveTab}>
              {activeTab === 'new' && (
                <NewOrderForm
                  onSubmit={submitOrder}
                  isSubmitting={isSubmitting}
                  walletConnected={walletState.connected}
                  onConnect={connectWallet}
                />
              )}
              {activeTab === 'active' && <MyOrdersTable orders={activeOrders} onCancel={cancelOrder} />}
              {activeTab === 'history' && <TradeHistoryTable history={tradeHistory} />}
            </OrderTabs>
          </CenterPanel>
        }
        rightSidebar={
          <RightSidebar>
            <ActivityFeed events={pool.events} />
            <OrderDepthChart
              buyPressure={pool.depthStats.buyPressure}
              sellPressure={pool.depthStats.sellPressure}
              midPrice={pool.depthStats.midPrice}
            />
            <SettlementQueue pendingSettlements={pool.pendingSettlements} />
          </RightSidebar>
        }
      />
      <DepositInstructionsModal
        request={depositRequest}
        onDismiss={clearDepositRequest}
        orderStatus={
          depositRequest
            ? activeOrders.find((order) => order.id === depositRequest.orderId)?.status ?? null
            : null
        }
      />
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}

export default DashboardPage
