import type { AdditionalRateLimit, RateLimitResult } from '../types.ts'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import * as v from 'valibot'

interface ClaudeCredentials {
  accessToken: string
  subscriptionType: string
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parsePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.min(100, value))
}

function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return null
  }

  return timestamp.toISOString()
}

function parseClaudeCredentials(payload: unknown): ClaudeCredentials | null {
  const root = asObject(payload)
  const oauth = root ? asObject(root.claudeAiOauth) : null
  if (!oauth) {
    return null
  }

  const accessToken = typeof oauth.accessToken === 'string' ? oauth.accessToken.trim() : ''
  if (!accessToken) {
    return null
  }

  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return null
  }

  const subscriptionType = typeof oauth.subscriptionType === 'string'
    ? oauth.subscriptionType
    : 'unknown'

  return { accessToken, subscriptionType }
}

async function readCredentialsFromFile(): Promise<ClaudeCredentials | null> {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json')

  try {
    const content = await readFile(credentialsPath, 'utf-8')
    return parseClaudeCredentials(JSON.parse(content))
  } catch {
    return null
  }
}

async function readCredentialsFromKeychain(): Promise<ClaudeCredentials | null> {
  if (process.platform !== 'darwin') {
    return null
  }

  try {
    const proc = Bun.spawn([
      '/usr/bin/security',
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w',
    ], { stdout: 'pipe', stderr: 'pipe' })

    const timeoutReached = await Promise.race([
      proc.exited.then(() => false),
      wait(1500).then(() => true),
    ])

    if (timeoutReached) {
      proc.kill()
      return null
    }

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return null
    }

    const stdout = await new Response(proc.stdout).text()
    return parseClaudeCredentials(JSON.parse(stdout.trim()))
  } catch {
    return null
  }
}

// CLIProxyAPI/tokenai flat token format for Claude
const CliProxyClaudeTokenSchema = v.looseObject({
  type: v.literal('claude'),
  access_token: v.string(),
  expired: v.nullish(v.string()),
})

const TOKENAI_AUTH_DIR = join(homedir(), '.worktoolai', 'tokenai', 'auth')

async function readTokenaiClaudeAuth(): Promise<ClaudeCredentials | null> {
  let files: string[]
  try {
    const entries = await readdir(TOKENAI_AUTH_DIR)
    files = entries.filter(f => f.startsWith('claude-') && f.endsWith('.json'))
  } catch {
    return null
  }

  for (const file of files) {
    try {
      const content = await readFile(join(TOKENAI_AUTH_DIR, file), 'utf-8')
      const json = JSON.parse(content)
      const result = v.safeParse(CliProxyClaudeTokenSchema, json)
      if (!result.success) continue

      const token = result.output

      // Skip expired tokens
      if (token.expired && Date.now() >= new Date(token.expired).getTime()) continue

      return { accessToken: token.access_token, subscriptionType: 'unknown' }
    } catch {
      continue
    }
  }

  return null
}

async function readClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const fromFile = await readCredentialsFromFile()
  if (fromFile) return fromFile

  const fromKeychain = await readCredentialsFromKeychain()
  if (fromKeychain) return fromKeychain

  return readTokenaiClaudeAuth()
}

function normalizePlanType(subscriptionType: string): string {
  const lower = subscriptionType.toLowerCase()
  if (lower.includes('max')) return 'max'
  if (lower.includes('pro')) return 'pro'
  if (lower.includes('team')) return 'team'
  return 'unknown'
}

function parseUsageWindow(value: unknown): { usedPercent: number; resetsAt: string | null } | null {
  const window = asObject(value)
  if (!window) {
    return null
  }

  const usedPercent = parsePercent(window.utilization)
  if (usedPercent === null) {
    return null
  }

  return {
    usedPercent,
    resetsAt: parseIsoTimestamp(window.resets_at),
  }
}

function claudeLimitDisplayName(key: string): string {
  if (key === 'seven_day_oauth_apps') return 'All models'
  if (key === 'seven_day_sonnet') return 'Sonnet only'
  if (key === 'seven_day_opus') return 'Opus only'
  if (key === 'seven_day_cowork') return 'Cowork'

  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim()
}

function parseClaudeAdditionalLimits(payload: Record<string, unknown>): AdditionalRateLimit[] {
  const additional: AdditionalRateLimit[] = []

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'five_hour' || key === 'seven_day' || key === 'extra_usage') {
      continue
    }

    const parsed = parseUsageWindow(value)
    if (!parsed) {
      continue
    }

    if (key.startsWith('five_hour_')) {
      additional.push({
        limitName: claudeLimitDisplayName(key),
        meteredFeature: key,
        primary: {
          usedPercent: parsed.usedPercent,
          windowMinutes: 300,
          resetsAt: parsed.resetsAt,
        },
      })
      continue
    }

    if (key.startsWith('seven_day_')) {
      additional.push({
        limitName: claudeLimitDisplayName(key),
        meteredFeature: key,
        secondary: {
          usedPercent: parsed.usedPercent,
          windowMinutes: 10080,
          resetsAt: parsed.resetsAt,
        },
      })
    }
  }

  return additional
}

interface ClaudeCacheUsage {
  planType: string
  primary?: {
    usedPercent: number
    windowMinutes: number
    resetsAt: string | null
  }
  secondary?: {
    usedPercent: number
    windowMinutes: number
    resetsAt: string | null
  }
  additionalLimits?: AdditionalRateLimit[]
}

function parseClaudeHudUsageCache(payload: unknown): ClaudeCacheUsage | null {
  const root = asObject(payload)
  const data = root ? asObject(root.data) : null
  if (!data) {
    return null
  }

  const planName = typeof data.planName === 'string' ? data.planName : 'unknown'
  const planType = normalizePlanType(planName)

  const fiveHour = parsePercent(data.fiveHour)
  const sevenDay = parsePercent(data.sevenDay)

  if (fiveHour === null && sevenDay === null) {
    return null
  }

  return {
    planType,
    primary: fiveHour === null
      ? undefined
      : {
        usedPercent: fiveHour,
        windowMinutes: 300,
        resetsAt: parseIsoTimestamp(data.fiveHourResetAt),
      },
    secondary: sevenDay === null
      ? undefined
      : {
        usedPercent: sevenDay,
        windowMinutes: 10080,
        resetsAt: parseIsoTimestamp(data.sevenDayResetAt),
      },
  }
}

function parseOhMyClaudeCodeUsageCache(payload: unknown): ClaudeCacheUsage | null {
  const root = asObject(payload)
  const data = root ? asObject(root.data) : null
  if (!data) {
    return null
  }

  const fiveHour = parsePercent(data.fiveHourPercent)
  const weekly = parsePercent(data.weeklyPercent)
  const sonnetWeekly = parsePercent(data.sonnetWeeklyPercent)

  if (fiveHour === null && weekly === null && sonnetWeekly === null) {
    return null
  }

  const additionalLimits: AdditionalRateLimit[] = []
  if (sonnetWeekly !== null) {
    additionalLimits.push({
      limitName: 'Sonnet only',
      meteredFeature: 'seven_day_sonnet',
      secondary: {
        usedPercent: sonnetWeekly,
        windowMinutes: 10080,
        resetsAt: parseIsoTimestamp(data.sonnetWeeklyResetsAt),
      },
    })
  }

  return {
    planType: 'unknown',
    primary: fiveHour === null
      ? undefined
      : {
        usedPercent: fiveHour,
        windowMinutes: 300,
        resetsAt: parseIsoTimestamp(data.fiveHourResetsAt),
      },
    secondary: weekly === null
      ? undefined
      : {
        usedPercent: weekly,
        windowMinutes: 10080,
        resetsAt: parseIsoTimestamp(data.weeklyResetsAt),
      },
    additionalLimits,
  }
}

async function readClaudeUsageCache(): Promise<ClaudeCacheUsage | null> {
  const cacheCandidates = [
    {
      path: join(homedir(), '.claude', 'plugins', 'claude-hud', '.usage-cache.json'),
      parse: parseClaudeHudUsageCache,
    },
    {
      path: join(homedir(), '.claude', 'plugins', 'oh-my-claudecode', '.usage-cache.json'),
      parse: parseOhMyClaudeCodeUsageCache,
    },
  ]

  for (const candidate of cacheCandidates) {
    try {
      const content = await readFile(candidate.path, 'utf-8')
      const parsed = candidate.parse(JSON.parse(content))
      if (parsed) {
        return parsed
      }
    } catch {
      continue
    }
  }

  return null
}

async function fetchClaudeUsage(accessToken: string): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const MAX_RETRIES = 3
  const BASE_DELAY_MS = 1000

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'limitai/0.1.0',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (response.status === 401 || response.status === 403) {
        return { error: 'Auth expired - re-authenticate in Claude Code CLI' }
      }

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = response.headers.get('retry-after')
          const delayMs = retryAfter && !Number.isNaN(Number(retryAfter))
            ? Math.min(Number(retryAfter) * 1000, 30000)
            : BASE_DELAY_MS * Math.pow(2, attempt)
          await wait(delayMs)
          continue
        }
        return { error: 'Claude usage API rate limited (HTTP 429) - try again later' }
      }

      if (!response.ok) {
        return { error: `Claude usage API error: HTTP ${response.status}` }
      }

      const body = await response.json()
      const parsedBody = asObject(body)
      if (!parsedBody) {
        return { error: 'Claude usage API returned invalid response payload' }
      }

      return { data: parsedBody }
    } catch (err: unknown) {
      if (attempt < MAX_RETRIES) {
        await wait(BASE_DELAY_MS * Math.pow(2, attempt))
        continue
      }
      return { error: `Claude usage API network error: ${(err as Error).message}` }
    }
  }

  return { error: 'Claude usage API failed after retries' }
}

export async function fetchClaudeStats(): Promise<RateLimitResult | null> {
  const account = {
    id: 'claude-local',
    provider: 'claude' as const,
    source: 'native' as const,
  }
  
  const credentials = await readClaudeCredentials()
  if (!credentials) {
    const cachedUsage = await readClaudeUsageCache()
    if (cachedUsage) {
      return {
        account: { ...account, planType: cachedUsage.planType },
        planType: cachedUsage.planType,
        primary: cachedUsage.primary,
        secondary: cachedUsage.secondary,
        additionalLimits: cachedUsage.additionalLimits,
        sourceConfidence: 'estimated',
      }
    }

      return {
        account,
        planType: 'unknown',
        error: 'Claude OAuth credentials not found - run `claude login`',
        sourceConfidence: 'unknown',
      }
  }

  const usage = await fetchClaudeUsage(credentials.accessToken)
  if (usage.error || !usage.data) {
    const cachedUsage = await readClaudeUsageCache()
    if (cachedUsage) {
      const planType = cachedUsage.planType !== 'unknown'
        ? cachedUsage.planType
        : normalizePlanType(credentials.subscriptionType)

      return {
        account: { ...account, planType },
        planType,
        primary: cachedUsage.primary,
        secondary: cachedUsage.secondary,
        additionalLimits: cachedUsage.additionalLimits,
        sourceConfidence: 'estimated',
      }
    }

    return {
      account,
      planType: normalizePlanType(credentials.subscriptionType),
      error: usage.error ?? 'Claude usage API returned empty response',
      sourceConfidence: 'unknown',
    }
  }

  const fiveHour = parseUsageWindow(usage.data.five_hour)
  const sevenDay = parseUsageWindow(usage.data.seven_day)
  const additionalLimits = parseClaudeAdditionalLimits(usage.data)
  const planType = normalizePlanType(credentials.subscriptionType)

  if (!fiveHour && !sevenDay) {
    return {
      account: { ...account, planType },
      planType,
      error: 'Claude usage API response missing quota window data',
      sourceConfidence: 'unknown',
    }
  }

  return {
    account: { ...account, planType },
    planType,
    primary: fiveHour
      ? {
        usedPercent: fiveHour.usedPercent,
        windowMinutes: 300,
        resetsAt: fiveHour.resetsAt,
      }
      : undefined,
    secondary: sevenDay
      ? {
        usedPercent: sevenDay.usedPercent,
        windowMinutes: 10080,
        resetsAt: sevenDay.resetsAt,
      }
      : undefined,
    additionalLimits,
    sourceConfidence: 'direct',
  }
}
