import React from 'react'
import GlassCard from '@/components/ui/GlassCard'
import MonoLabel from '@/components/ui/MonoLabel'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'

interface OrderDepthChartProps {
  buyPressure: number
  sellPressure: number
  midPrice: number
}

const OrderDepthChart: React.FC<OrderDepthChartProps> = ({ buyPressure, sellPressure, midPrice }) => {
  const data = [
    { name: 'BUY', value: buyPressure },
    { name: 'SELL', value: sellPressure },
  ]

  return (
    <GlassCard>
      <MonoLabel>Order Depth</MonoLabel>
      <div className="mt-3 h-[120px]" style={{ filter: 'blur(0.5px)' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" barCategoryGap={8}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--text-muted))' }} axisLine={false} tickLine={false} width={40} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              <Cell fill="hsl(var(--accent-green))" />
              <Cell fill="hsl(var(--accent-red))" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center mt-2 font-mono text-sm gradient-text">${midPrice.toLocaleString()}</div>
      <div className="text-center text-[10px] text-muted-foreground font-mono mt-1">
        AGGREGATED DEPTH — no individual orders visible
      </div>
    </GlassCard>
  )
}

export default OrderDepthChart
