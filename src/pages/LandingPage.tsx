import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/hooks/useWallet'
import GradientBackground from '@/components/layout/GradientBackground'
import Navbar from '@/components/layout/Navbar'
import HeroSection from '@/components/landing/HeroSection'
import StatPills from '@/components/landing/StatPills'
import FeatureGrid from '@/components/landing/FeatureGrid'

const LandingPage: React.FC = () => {
  const { walletState, connectWallet, disconnectWallet } = useWallet()
  const navigate = useNavigate()

  return (
    <>
      <GradientBackground />
      <Navbar walletState={walletState} onConnect={connectWallet} onDisconnect={disconnectWallet} />
      <main>
        <HeroSection onEnterPool={() => navigate('/dashboard')} />
        <StatPills ordersLeaked={0} avgMatchTimeSeconds={15} />
        <FeatureGrid />
      </main>
    </>
  )
}

export default LandingPage
