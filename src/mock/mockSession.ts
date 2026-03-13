import { SessionIdentity, CollateralInfo, SessionStats } from '@/types'

export const mockSession: SessionIdentity = {
  ensSubname: 'x7k2m.plop.eth',
  derivedAddress: '0x4a3f8b2c1d9e5f7a3b2c1d9e5f7a3b2c',
  status: 'ACTIVE',
  sessionNonce: 4
}

export const mockCollateral: CollateralInfo = {
  locked: 2.5,
  available: 0.5,
  token: 'ETH'
}

export const mockStats: SessionStats = {
  tradesCompleted: 3,
  avgMatchTimeSeconds: 11,
  totalVolumeUSD: 47200
}
