import type { AdditionalRateLimit, RateLimitResult } from '../types.ts'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir, userInfo } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import * as v from 'valibot'

interface ClaudeCredentials {
  accessToken: string
  subscriptionType: string
  refreshToken?: string
  expiresAt?: number
}

interface ClaudeCredentialReadResult {
  credentials: ClaudeCredentials | null
  expiredAt: string | null
}

interface ClaudeCacheUsage {
  planType: string
  fetchedAt: number | null
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

const CLAUDE_CACHE_MAX_AGE_MS = 15 * 60 * 1000

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

function parseClaudeCredentials(payload: unknown): ClaudeCredentialReadResult {
  const root = asObject(payload)
  const oauth = root ? asObject(root.claudeAiOauth) : null
  if (!oauth) {
    return { credentials: null, expiredAt: null }
  }

  const accessToken = typeof oauth.accessToken === 'string' ? oauth.accessToken.trim() : ''
  if (!accessToken) {
    return { credentials: null, expiredAt: null }
  }

  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
  const expiredAt = expiresAt === null
    ? null
    : new Date(expiresAt).toISOString()

  if (expiresAt !== null && expiresAt <= Date.now()) {
    return { credentials: null, expiredAt }
  }

  const subscriptionType = typeof oauth.subscriptionType === 'string'
    ? oauth.subscriptionType
    : 'unknown'

  const refreshToken = typeof oauth.refreshToken === 'string' ? oauth.refreshToken.trim() : undefined

  return {
    credentials: { accessToken, subscriptionType, refreshToken, expiresAt: expiresAt ?? undefined },
    expiredAt,
  }
}

async function readCredentialsFromFile(): Promise<ClaudeCredentialReadResult> {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json')

  try {
    const content = await readFile(credentialsPath, 'utf-8')
    return parseClaudeCredentials(JSON.parse(content))
  } catch {
    return { credentials: null, expiredAt: null }
  }
}

async function readCredentialsFromKeychain(): Promise<ClaudeCredentialReadResult> {
  if (process.platform !== 'darwin') {
    return { credentials: null, expiredAt: null }
  }

  const serviceName = getClaudeKeychainServiceName()
  const candidateAccounts: Array<string | undefined> = []

  try {
    const username = userInfo().username?.trim()
    if (username) {
      candidateAccounts.push(username)
    }
  } catch {
    // Best-effort only; fall back to legacy service-only lookup below.
  }

  candidateAccounts.push(undefined)

  let expiredAt: string | null = null

  try {
    for (const account of candidateAccounts) {
      const args = [
        '/usr/bin/security',
        'find-generic-password',
        '-s',
        serviceName,
      ]

      if (account) {
        args.push('-a', account)
      }

      args.push('-w')

      const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })

      const timeoutReached = await Promise.race([
        proc.exited.then(() => false),
        wait(1500).then(() => true),
      ])

      if (timeoutReached) {
        proc.kill()
        continue
      }

      const exitCode = await proc.exited
      if (exitCode !== 0) {
        continue
      }

      const stdout = await new Response(proc.stdout).text()
      const parsed = parseClaudeCredentials(JSON.parse(stdout.trim()))
      if (parsed.credentials) {
        return parsed
      }

      expiredAt ??= parsed.expiredAt
    }

    return { credentials: null, expiredAt }
  } catch {
    return { credentials: null, expiredAt }
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

async function readClaudeCredentials(): Promise<ClaudeCredentialReadResult> {
  const fromKeychain = await readCredentialsFromKeychain()
  if (fromKeychain.credentials) return fromKeychain

  const fromFile = await readCredentialsFromFile()
  if (fromFile.credentials) return fromFile

  if (fromKeychain.expiredAt || fromFile.expiredAt) {
    return {
      credentials: null,
      expiredAt: fromKeychain.expiredAt ?? fromFile.expiredAt,
    }
  }

  const fromTokenai = await readTokenaiClaudeAuth()
  return { credentials: fromTokenai, expiredAt: null }
}

function getClaudeKeychainServiceName(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (!configDir) {
    return 'Claude Code-credentials'
  }

  const hash = createHash('sha256').update(configDir).digest('hex').slice(0, 8)
  return `Claude Code-credentials-${hash}`
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
    fetchedAt: parseCacheTimestamp(root?.timestamp),
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
    fetchedAt: parseCacheTimestamp(root?.timestamp),
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

function parseCacheTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return value
}

function isClaudeCacheFresh(cache: ClaudeCacheUsage): boolean {
  if (cache.fetchedAt !== null && Date.now() - cache.fetchedAt > CLAUDE_CACHE_MAX_AGE_MS) {
    return false
  }

  const resetCandidates = [
    cache.primary?.resetsAt,
    cache.secondary?.resetsAt,
    ...(cache.additionalLimits ?? []).flatMap(limit => [limit.primary?.resetsAt, limit.secondary?.resetsAt]),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (resetCandidates.length === 0) {
    return true
  }

  return resetCandidates.some((value) => {
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) && timestamp > Date.now()
  })
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
      if (parsed && isClaudeCacheFresh(parsed)) {
        return parsed
      }
    } catch {
      continue
    }
  }

  return null
}

export const __claudeBridgeInternals = {
  CLAUDE_CACHE_MAX_AGE_MS,
  getClaudeKeychainServiceName,
  isClaudeCacheFresh,
  parseCacheTimestamp,
  parseClaudeCredentials,
  parseClaudeHudUsageCache,
  parseOhMyClaudeCodeUsageCache,
}

const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000 // refresh when <10 min remaining

async function refreshClaudeToken(refreshToken: string): Promise<ClaudeCredentials | null> {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    })

    const response = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return null

    const data = await response.json() as Record<string, unknown>
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    if (!accessToken) return null

    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
    const newRefreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken
    const scope = typeof data.scope === 'string' ? data.scope : ''

    return {
      accessToken,
      subscriptionType: 'unknown',
      refreshToken: newRefreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    }
  } catch {
    return null
  }
}

async function saveCredentialsToKeychain(newCreds: ClaudeCredentials): Promise<void> {
  if (process.platform !== 'darwin') return

  const serviceName = getClaudeKeychainServiceName()

  // Read existing credentials JSON to preserve other fields
  let existing: Record<string, unknown> = {}
  try {
    const username = userInfo().username?.trim()
    const readArgs = ['/usr/bin/security', 'find-generic-password', '-s', serviceName]
    if (username) readArgs.push('-a', username)
    readArgs.push('-w')

    const readProc = Bun.spawn(readArgs, { stdout: 'pipe', stderr: 'pipe' })
    const done = await Promise.race([readProc.exited.then(() => false), wait(1500).then(() => true)])
    if (!done && (await readProc.exited) === 0) {
      const stdout = await new Response(readProc.stdout).text()
      existing = JSON.parse(stdout.trim()) as Record<string, unknown>
    }
  } catch {
    // Start fresh
  }

  // Update claudeAiOauth
  const prevOauth = asObject(existing.claudeAiOauth) ?? {}
  existing.claudeAiOauth = {
    ...prevOauth,
    accessToken: newCreds.accessToken,
    refreshToken: newCreds.refreshToken,
    expiresAt: newCreds.expiresAt,
  }

  const jsonStr = JSON.stringify(existing)
  try {
    const username = userInfo().username?.trim() ?? ''
    const writeArgs = [
      '/usr/bin/security', 'add-generic-password', '-U',
      '-a', username,
      '-s', serviceName,
      '-w', jsonStr,
    ]
    const writeProc = Bun.spawn(writeArgs, { stdout: 'pipe', stderr: 'pipe' })
    await writeProc.exited
  } catch {
    // Best-effort
  }
}

async function maybeRefreshToken(credentials: ClaudeCredentials): Promise<ClaudeCredentials> {
  if (!credentials.refreshToken || !credentials.expiresAt) return credentials

  const timeLeft = credentials.expiresAt - Date.now()
  if (timeLeft > REFRESH_THRESHOLD_MS) return credentials

  const refreshed = await refreshClaudeToken(credentials.refreshToken)
  if (!refreshed) return credentials

  // Preserve subscriptionType from original
  refreshed.subscriptionType = credentials.subscriptionType

  await saveCredentialsToKeychain(refreshed)
  return refreshed
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

    if (response.status === 429) {
      return { error: 'Claude usage API rate limited (HTTP 429)' }
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
  
  const { credentials: rawCredentials, expiredAt } = await readClaudeCredentials()
  if (!rawCredentials) {
    const authError = expiredAt
      ? 'Claude session expired - re-authenticate in Claude Code CLI'
      : 'Claude OAuth credentials not found - run `claude login`'
    const cachedUsage = await readClaudeUsageCache()
    if (cachedUsage) {
      return {
        account: { ...account, planType: cachedUsage.planType },
        planType: cachedUsage.planType,
        primary: cachedUsage.primary,
        secondary: cachedUsage.secondary,
        additionalLimits: cachedUsage.additionalLimits,
        error: authError,
        sourceConfidence: 'estimated',
        expiredAt: expiredAt ?? undefined,
      }
    }

      return {
        account,
        planType: 'unknown',
        error: authError,
        sourceConfidence: 'unknown',
        expiredAt: expiredAt ?? undefined,
      }
  }

  const credentials = await maybeRefreshToken(rawCredentials)

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
        error: usage.error,
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
