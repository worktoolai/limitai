export type Provider = 'codex' | 'claude'
export type SourceConfidence = 'direct' | 'estimated' | 'unknown'
export type AccountSource = 'native' | 'cliproxy'

export interface Account {
  id: string
  provider: Provider
  source: AccountSource
  email?: string
  planType?: string
}

export interface NormalizedSnapshot {
  accountId: string
  capturedAt: string
  provider: Provider
  windowId: string
  usedPercent: number | null
  windowMinutes: number | null
  resetsAt: string | null
  secondaryUsedPercent: number | null
  secondaryResetsAt: string | null
  planType: string | null
  sourceConfidence: SourceConfidence
  rawPayload: unknown
}

export interface RateLimitWindow {
  usedPercent: number
  windowMinutes: number | null
  resetsAt: string | null
}

export interface AdditionalRateLimit {
  limitName: string
  meteredFeature: string
  primary?: RateLimitWindow
  secondary?: RateLimitWindow
}

export interface RateLimitResult {
  account: Account
  planType: string
  primary?: RateLimitWindow
  secondary?: RateLimitWindow
  additionalLimits?: AdditionalRateLimit[]
  credits?: {
    hasCredits: boolean
    unlimited: boolean
    balance?: string
  }
  error?: string
  sourceConfidence?: SourceConfidence
  tokenPath?: string
  expiredAt?: string
}
