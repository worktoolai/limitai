import type { AdditionalRateLimit, RateLimitResult } from '../types.ts'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'

interface ClaudeCredentials {
  accessToken: string
  subscriptionType: string
}

interface ClaudeAuthStatus {
  loggedIn: boolean
  authMethod: string
}

async function isClaudeAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', 'claude'], { stdout: 'pipe', stderr: 'pipe' })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus | null> {
  try {
    const proc = Bun.spawn(['claude', 'auth', 'status', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return null
    }

    const parsed = asObject(JSON.parse(stdout))
    if (!parsed) {
      return null
    }

    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : 'unknown',
    }
  } catch {
    return null
  }
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

async function readClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const fromFile = await readCredentialsFromFile()
  if (fromFile) {
    return fromFile
  }

  return readCredentialsFromKeychain()
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
}

async function readHudUsageCache(): Promise<ClaudeCacheUsage | null> {
  const cachePath = join(homedir(), '.claude', 'plugins', 'claude-hud', '.usage-cache.json')

  try {
    const content = await readFile(cachePath, 'utf-8')
    const root = asObject(JSON.parse(content))
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
  } catch {
    return null
  }
}

async function fetchClaudeUsage(accessToken: string): Promise<{ data?: Record<string, unknown>; error?: string }> {
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
    return { error: `Claude usage API network error: ${(err as Error).message}` }
  }
}

export async function fetchClaudeStats(): Promise<RateLimitResult | null> {
  const account = {
    id: 'claude-local',
    provider: 'claude' as const,
    source: 'native' as const,
  }
  
  if (!await isClaudeAvailable()) {
    return null
  }

  const authStatus = await getClaudeAuthStatus()

  const credentials = await readClaudeCredentials()
  if (!credentials) {
    const cachedUsage = await readHudUsageCache()
    if (cachedUsage) {
      return {
        account: { ...account, planType: cachedUsage.planType },
        planType: cachedUsage.planType,
        primary: cachedUsage.primary,
        secondary: cachedUsage.secondary,
        sourceConfidence: 'estimated',
      }
    }

      return {
        account,
        planType: 'unknown',
        error: authStatus?.loggedIn && authStatus.authMethod === 'oauth_token'
          ? 'Claude OAuth is connected, but quota token is not readable by limitai (using interactive-only storage)'
          : 'Claude OAuth credentials not found - run `claude login`',
        sourceConfidence: 'unknown',
      }
  }

  const usage = await fetchClaudeUsage(credentials.accessToken)
  if (usage.error || !usage.data) {
    const cachedUsage = await readHudUsageCache()
    if (cachedUsage) {
      return {
        account: { ...account, planType: cachedUsage.planType },
        planType: cachedUsage.planType,
        primary: cachedUsage.primary,
        secondary: cachedUsage.secondary,
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
