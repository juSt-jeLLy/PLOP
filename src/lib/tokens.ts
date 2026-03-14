type TokenDecimalsMap = Record<string, number>
type TokenAddressMap = Record<string, string>
type DemoPriceMap = Record<string, number>

let cachedPairs: string[] | null = null
let cachedDecimals: TokenDecimalsMap | null = null
let cachedAddresses: TokenAddressMap | null = null
let cachedDemoPrices: DemoPriceMap | null = null
let cachedDemoDefault: number | null = null

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
  const seen = new Set(
    cachedPairs.map((pair) => {
      const { base, quote } = parseTokenPair(pair)
      return `${normalizeToken(base)}/${normalizeToken(quote)}`
    })
  )
  const withReverse = [...cachedPairs]
  cachedPairs.forEach((pair) => {
    const { base, quote } = parseTokenPair(pair)
    if (normalizeToken(base) === normalizeToken(quote)) return
    const reverse = `${quote}/${base}`
    const key = `${normalizeToken(quote)}/${normalizeToken(base)}`
    if (!seen.has(key)) {
      seen.add(key)
      withReverse.push(reverse)
    }
  })
  cachedPairs = withReverse
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

function getDemoPriceMap(): DemoPriceMap {
  if (cachedDemoPrices) return cachedDemoPrices
  const raw = (import.meta.env.VITE_DEMO_PRICE_MAP as string | undefined) || ''
  if (!raw) {
    cachedDemoPrices = {}
    return cachedDemoPrices
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number | string>
    cachedDemoPrices = Object.entries(parsed).reduce<DemoPriceMap>((acc, [key, value]) => {
      const num = typeof value === 'string' ? Number(value) : value
      if (Number.isFinite(num) && num > 0) {
        acc[key.trim().toUpperCase()] = num
      }
      return acc
    }, {})
  } catch {
    cachedDemoPrices = {}
  }
  return cachedDemoPrices
}

function getDemoDefault(): number | null {
  if (cachedDemoDefault !== null) return cachedDemoDefault
  const raw = (import.meta.env.VITE_DEMO_PRICE_DEFAULT as string | undefined) || ''
  if (!raw) {
    cachedDemoDefault = null
    return cachedDemoDefault
  }
  const num = Number(raw)
  cachedDemoDefault = Number.isFinite(num) && num > 0 ? num : null
  return cachedDemoDefault
}

export function parseTokenPair(pair: string): { base: string; quote: string } {
  const [baseRaw, quoteRaw] = pair.split('/')
  const base = (baseRaw || pair).trim()
  const quote = (quoteRaw || base).trim()
  return { base, quote }
}

export function getDemoPrice(pair: string): number | null {
  const map = getDemoPriceMap()
  const { base, quote } = parseTokenPair(pair)
  const forwardKey = `${normalizeToken(base)}/${normalizeToken(quote)}`
  const inverseKey = `${normalizeToken(quote)}/${normalizeToken(base)}`
  if (Number.isFinite(map[forwardKey])) return map[forwardKey]
  if (Number.isFinite(map[inverseKey]) && map[inverseKey] > 0) {
    return 1 / map[inverseKey]
  }
  const fallback = getDemoDefault()
  return Number.isFinite(fallback) ? fallback : null
}
