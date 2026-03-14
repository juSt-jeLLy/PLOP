type TokenDecimalsMap = Record<string, number>
type TokenAddressMap = Record<string, string>

let cachedPairs: string[] | null = null
let cachedDecimals: TokenDecimalsMap | null = null
let cachedAddresses: TokenAddressMap | null = null

function normalizeToken(symbol: string): string {
  return symbol.trim().toUpperCase()
}

export function getDefaultPairs(): string[] {
  if (cachedPairs) return cachedPairs
  const raw = (import.meta.env.VITE_DEFAULT_PAIRS as string | undefined) || 'ETH/ETH'
  cachedPairs = raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
  if (cachedPairs.length === 0) {
    cachedPairs = ['ETH/ETH']
  }
  return cachedPairs
}

function getTokenDecimalsMap(): TokenDecimalsMap {
  if (cachedDecimals) return cachedDecimals
  const raw = (import.meta.env.VITE_TOKEN_DECIMALS as string | undefined) || ''
  if (!raw) {
    cachedDecimals = {}
    return cachedDecimals
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number | string>
    cachedDecimals = Object.entries(parsed).reduce<TokenDecimalsMap>((acc, [key, value]) => {
      const num = typeof value === 'string' ? Number(value) : value
      acc[normalizeToken(key)] = Number.isFinite(num) ? num : 18
      return acc
    }, {})
  } catch {
    cachedDecimals = {}
  }
  return cachedDecimals
}

export function getTokenDecimals(symbol: string): number {
  const normalized = normalizeToken(symbol)
  const value = getTokenDecimalsMap()[normalized]
  return Number.isFinite(value) ? value : 18
}

function getTokenAddressMap(): TokenAddressMap {
  if (cachedAddresses) return cachedAddresses
  const raw = (import.meta.env.VITE_TOKEN_ADDRESS_MAP as string | undefined) || ''
  if (!raw) {
    cachedAddresses = {}
    return cachedAddresses
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    cachedAddresses = Object.entries(parsed).reduce<TokenAddressMap>((acc, [key, value]) => {
      acc[normalizeToken(key)] = value
      return acc
    }, {})
  } catch {
    cachedAddresses = {}
  }
  return cachedAddresses
}

export function getTokenAddress(symbol: string): string | null {
  const normalized = normalizeToken(symbol)
  return getTokenAddressMap()[normalized] || null
}

export function parseTokenPair(pair: string): { base: string; quote: string } {
  const [baseRaw, quoteRaw] = pair.split('/')
  const base = (baseRaw || pair).trim()
  const quote = (quoteRaw || base).trim()
  return { base, quote }
}
