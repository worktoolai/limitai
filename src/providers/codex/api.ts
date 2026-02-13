import * as v from 'valibot'
import type { CodexCredentials } from './auth.ts'
import type { RateLimitResult, RateLimitWindow as RateLimitWindowType } from '../types.ts'

const RateLimitWindowSnapshotSchema = v.looseObject({
  used_percent: v.number(),
  limit_window_seconds: v.number(),
  reset_after_seconds: v.number(),
  reset_at: v.number(),
})

const RateLimitStatusDetailsSchema = v.looseObject({
  allowed: v.boolean(),
  limit_reached: v.boolean(),
  primary_window: v.optional(v.nullable(RateLimitWindowSnapshotSchema)),
  secondary_window: v.optional(v.nullable(RateLimitWindowSnapshotSchema)),
})

const CreditStatusDetailsSchema = v.looseObject({
  has_credits: v.boolean(),
  unlimited: v.boolean(),
  balance: v.optional(v.nullable(v.string())),
})

const RateLimitStatusPayloadSchema = v.looseObject({
  plan_type: v.string(),
  rate_limit: v.optional(v.nullable(RateLimitStatusDetailsSchema)),
  credits: v.optional(v.nullable(CreditStatusDetailsSchema)),
  additional_rate_limits: v.optional(v.nullable(v.array(v.looseObject({
    limit_name: v.string(),
    metered_feature: v.string(),
    rate_limit: v.optional(v.nullable(RateLimitStatusDetailsSchema)),
  })))),
})

type PathStyle = 'codex-api' | 'chatgpt-api'

function getPathStyle(baseUrl: string): PathStyle {
  return baseUrl.includes('/backend-api') ? 'chatgpt-api' : 'codex-api'
}

function getUsageUrl(baseUrl: string, style: PathStyle): string {
  return style === 'chatgpt-api'
    ? `${baseUrl}/wham/usage`
    : `${baseUrl}/api/codex/usage`
}

export function resolveCodexUsageUrl(baseUrl: string): string {
  return getUsageUrl(baseUrl, getPathStyle(baseUrl))
}

function mapWindow(snapshot: { used_percent: number; limit_window_seconds: number; reset_at: number } | null | undefined): RateLimitWindowType | undefined {
  if (!snapshot) return undefined
  
  const windowMinutes = snapshot.limit_window_seconds > 0
    ? Math.round(snapshot.limit_window_seconds / 60)
    : null
  
  const resetsAt = snapshot.reset_at > 0
    ? new Date(snapshot.reset_at * 1000).toISOString()
    : null
  
  return {
    usedPercent: snapshot.used_percent,
    windowMinutes,
    resetsAt,
  }
}

function normalizeLimitName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchCodexRateLimits(
  baseUrl: string,
  credentials: CodexCredentials,
): Promise<RateLimitResult> {
  const url = resolveCodexUsageUrl(baseUrl)
  
  const headers: Record<string, string> = {
    'User-Agent': 'limitai/0.1.0',
    'Authorization': `Bearer ${credentials.accessToken}`,
  }
  
  if (credentials.accountId) {
    headers['ChatGPT-Account-Id'] = credentials.accountId
  }
  
  const account = {
    id: 'codex-native',
    provider: 'codex' as const,
    source: 'native' as const,
  }
  
  try {
    const response = await fetch(url, { headers })
    
    if (response.status === 401 || response.status === 403) {
      return {
        account,
        planType: 'unknown',
        error: 'Auth expired - re-authenticate in Codex CLI',
      }
    }
    
    if (!response.ok) {
      return {
        account,
        planType: 'unknown',
        error: `API error: ${response.status} ${response.statusText}`,
      }
    }
    
    const body = await response.json()
    const result = v.safeParse(RateLimitStatusPayloadSchema, body)
    
    if (!result.success) {
      return {
        account,
        planType: 'unknown',
        error: `Invalid API response: ${result.issues[0]?.message}`,
      }
    }
    
    const payload = result.output
    const rateLimit = payload.rate_limit
    const additionalLimits = (payload.additional_rate_limits ?? [])
      .map((entry) => {
        const entryRateLimit = entry.rate_limit
        const primary = mapWindow(entryRateLimit?.primary_window)
        const secondary = mapWindow(entryRateLimit?.secondary_window)

        if (!primary && !secondary) {
          return null
        }

        return {
          limitName: normalizeLimitName(entry.limit_name),
          meteredFeature: entry.metered_feature,
          primary,
          secondary,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    
    return {
      account: { ...account, planType: payload.plan_type },
      planType: payload.plan_type,
      primary: mapWindow(rateLimit?.primary_window),
      secondary: mapWindow(rateLimit?.secondary_window),
      additionalLimits,
      credits: payload.credits ? {
        hasCredits: payload.credits.has_credits,
        unlimited: payload.credits.unlimited,
        balance: payload.credits.balance ?? undefined,
      } : undefined,
    }
  } catch (err: unknown) {
    return {
      account,
      planType: 'unknown',
      error: `Network error: ${(err as Error).message}`,
    }
  }
}
