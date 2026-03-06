import type { GeminiCredentials } from './auth.ts'
import { ensureFreshToken, refreshAccessToken } from './auth.ts'
import type { RateLimitResult, RateLimitWindow, AdditionalRateLimit } from '../types.ts'
import { generateAccountId } from '../../accounts/naming.ts'

const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const PROJECTS_URL = 'https://cloudresourcemanager.googleapis.com/v1/projects'

const IDE_METADATA = {
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
  duetProject: 'default',
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403
}

async function postJson(
  url: string,
  accessToken: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
}

/** Retry once on 401/403 by refreshing the token */
async function retryOnAuth<T>(
  request: (token: string) => Promise<T>,
  creds: GeminiCredentials,
): Promise<T> {
  const result = await request(creds.accessToken)
  const resp = result as unknown as Response
  if (resp && typeof resp === 'object' && 'status' in resp && isAuthStatus(resp.status as number)) {
    const refreshed = await refreshAccessToken(creds)
    if (refreshed) {
      return request(refreshed)
    }
  }
  return result
}

/** Search deeply for a string value matching any of the given keys */
function readFirstStringDeep(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null

  const obj = value as Record<string, unknown>
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }

  for (const v of Object.values(obj)) {
    const found = readFirstStringDeep(v, keys)
    if (found) return found
  }
  return null
}

function mapTierToPlan(tier: string | null): string {
  if (!tier) return 'unknown'
  const normalized = tier.trim().toLowerCase()
  if (normalized === 'standard-tier') return 'Paid'
  if (normalized === 'legacy-tier') return 'Legacy'
  if (normalized === 'free-tier') return 'Free'
  return 'unknown'
}

interface QuotaBucket {
  modelId: string
  remainingFraction: number
  resetTime: string | null
}

/** Recursively collect quota buckets from nested API response */
function collectQuotaBuckets(value: unknown, out: QuotaBucket[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectQuotaBuckets(item, out)
    return
  }
  if (!value || typeof value !== 'object') return

  const obj = value as Record<string, unknown>

  if (typeof obj.remainingFraction === 'number') {
    const modelId =
      typeof obj.modelId === 'string'
        ? obj.modelId
        : typeof obj.model_id === 'string'
          ? obj.model_id
          : 'unknown'
    out.push({
      modelId,
      remainingFraction: obj.remainingFraction as number,
      resetTime: (obj.resetTime || obj.reset_time || null) as string | null,
    })
  }

  for (const v of Object.values(obj)) collectQuotaBuckets(v, out)
}

function pickLowestBucket(buckets: QuotaBucket[]): QuotaBucket | null {
  let best: QuotaBucket | null = null
  for (const b of buckets) {
    if (!Number.isFinite(b.remainingFraction)) continue
    if (!best || b.remainingFraction < best.remainingFraction) best = b
  }
  return best
}

function bucketToWindow(bucket: QuotaBucket): RateLimitWindow {
  const clampedRemaining = Math.max(0, Math.min(1, bucket.remainingFraction))
  const usedPercent = Math.round((1 - clampedRemaining) * 100)

  let resetsAt: string | null = null
  if (bucket.resetTime) {
    try {
      const d = new Date(bucket.resetTime)
      if (!isNaN(d.getTime())) resetsAt = d.toISOString()
    } catch { /* ignore */ }
  }

  return { usedPercent, windowMinutes: null, resetsAt }
}

/** Discover the GCP project ID from loadCodeAssist response or projects API */
async function discoverProjectId(
  accessToken: string,
  loadCodeAssistData: unknown,
): Promise<string | null> {
  const fromLoadCodeAssist = readFirstStringDeep(loadCodeAssistData, ['cloudaicompanionProject'])
  if (fromLoadCodeAssist) return fromLoadCodeAssist

  try {
    const resp = await fetch(PROJECTS_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) return null
    const data = await resp.json() as Record<string, unknown>
    const projects = Array.isArray(data.projects) ? data.projects : []

    for (const project of projects) {
      const p = project as Record<string, unknown>
      const projectId = typeof p.projectId === 'string' ? p.projectId : null
      if (!projectId) continue
      if (projectId.startsWith('gen-lang-client')) return projectId
      const labels = p.labels as Record<string, unknown> | null
      if (labels && 'generative-language' in labels) return projectId
    }
  } catch { /* ignore */ }

  return null
}

export async function fetchGeminiRateLimits(creds: GeminiCredentials): Promise<RateLimitResult> {
  const accountId = generateAccountId(
    'gemini',
    'native',
    creds.email,
    undefined,
    undefined,
  )

  const account = {
    id: accountId,
    provider: 'gemini' as const,
    source: 'native' as const,
    email: creds.email,
  }

  try {
    // 1. Ensure fresh token
    const accessToken = await ensureFreshToken(creds)
    if (!accessToken) {
      return {
        account,
        planType: 'unknown',
        error: 'Not logged in. Run `gemini auth login` to authenticate.',
        tokenPath: creds.tokenPath,
      }
    }

    // 2. loadCodeAssist — get tier & project info
    const loadResp = await retryOnAuth(
      (token) => postJson(LOAD_CODE_ASSIST_URL, token, { metadata: IDE_METADATA }),
      creds,
    )

    if (isAuthStatus(loadResp.status)) {
      return {
        account,
        planType: 'unknown',
        error: 'Gemini session expired. Run `gemini auth login` to re-authenticate.',
        tokenPath: creds.tokenPath,
        expiredAt: creds.expiredAt,
      }
    }

    let loadData: unknown = null
    if (loadResp.ok) {
      try { loadData = await loadResp.json() } catch { /* ignore */ }
    }

    const tier = readFirstStringDeep(loadData, ['tier', 'userTier', 'subscriptionTier'])
    const planType = mapTierToPlan(tier)

    // 3. Discover project ID (from response, credentials, or projects API)
    const projectId =
      creds.projectId ??
      await discoverProjectId(creds.accessToken, loadData)

    // 4. Fetch quota
    const quotaResp = await retryOnAuth(
      (token) => postJson(QUOTA_URL, token, projectId ? { project: projectId } : {}),
      creds,
    )

    if (isAuthStatus(quotaResp.status)) {
      return {
        account,
        planType,
        error: 'Gemini session expired. Run `gemini auth login` to re-authenticate.',
        tokenPath: creds.tokenPath,
        expiredAt: creds.expiredAt,
      }
    }

    if (!quotaResp.ok) {
      return {
        account,
        planType,
        error: `Gemini quota request failed (HTTP ${quotaResp.status}). Try again later.`,
        tokenPath: creds.tokenPath,
      }
    }

    let quotaData: unknown
    try {
      quotaData = await quotaResp.json()
    } catch {
      return {
        account,
        planType,
        error: 'Gemini quota response invalid. Try again later.',
        tokenPath: creds.tokenPath,
      }
    }

    if (!quotaData || typeof quotaData !== 'object') {
      return {
        account,
        planType,
        error: 'Gemini quota response invalid. Try again later.',
        tokenPath: creds.tokenPath,
      }
    }

    // 5. Parse quota buckets
    const buckets: QuotaBucket[] = []
    collectQuotaBuckets(quotaData, buckets)

    const proBuckets: QuotaBucket[] = []
    const flashBuckets: QuotaBucket[] = []

    for (const bucket of buckets) {
      const lower = bucket.modelId.toLowerCase()
      if (lower.includes('gemini') && lower.includes('pro')) {
        proBuckets.push(bucket)
      } else if (lower.includes('gemini') && lower.includes('flash')) {
        flashBuckets.push(bucket)
      }
    }

    // Primary = Pro (most restrictive bucket), Secondary = Flash
    const proBucket = pickLowestBucket(proBuckets)
    const flashBucket = pickLowestBucket(flashBuckets)

    const primary = proBucket ? bucketToWindow(proBucket) : undefined
    const secondary = flashBucket ? bucketToWindow(flashBucket) : undefined

    // Build additional limits for individual model categories if both exist
    const additionalLimits: AdditionalRateLimit[] = []
    if (proBucket) {
      additionalLimits.push({
        limitName: 'Gemini Pro',
        meteredFeature: proBucket.modelId,
        primary: bucketToWindow(proBucket),
      })
    }
    if (flashBucket) {
      additionalLimits.push({
        limitName: 'Gemini Flash',
        meteredFeature: flashBucket.modelId,
        primary: bucketToWindow(flashBucket),
      })
    }

    return {
      account,
      planType,
      primary,
      secondary,
      additionalLimits: additionalLimits.length > 0 ? additionalLimits : undefined,
      sourceConfidence: 'direct',
      tokenPath: creds.tokenPath,
    }
  } catch (err: unknown) {
    return {
      account,
      planType: 'unknown',
      error: `Network error: ${(err as Error).message}`,
      tokenPath: creds.tokenPath,
    }
  }
}
