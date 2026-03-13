import React from 'react'
import OrderRow from './OrderRow'
import { Order } from '@/types'

interface MyOrdersTableProps {
  orders: Order[]
  onCancel: (orderId: string) => void
}

const MyOrdersTable: React.FC<MyOrdersTableProps> = ({ orders, onCancel }) => {
  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm font-mono italic">
        No active orders — submit your first encrypted order above.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {orders.map(order => (
        <OrderRow key={order.id} order={order} onCancel={onCancel} />
      ))}
    </div>
  )
}

export default MyOrdersTable
