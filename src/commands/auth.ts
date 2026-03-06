import { define } from 'gunshi'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import * as v from 'valibot'

const TokenFileSchema = v.looseObject({
  type: v.string(),
  access_token: v.optional(v.string()),
  refresh_token: v.optional(v.string()),
  email: v.optional(v.string()),
  account_id: v.optional(v.string()),
  expired: v.optional(v.string()),
  last_refresh: v.optional(v.string()),
})

interface TokenInfo {
  path: string
  provider: string
  email: string
  accountId: string | null
  accessExpiry: string | null
  refreshToken: boolean
  lastRefresh: string | null
  lastRefreshMs: number
  status: 'active' | 'expired' | 'unknown'
}

const AUTH_DIRS = [
  join(homedir(), '.worktoolai', 'tokenai', 'auth'),
  join(homedir(), '.cli-proxy-api'),
]

const CLAUDE_CREDS_PATH = join(homedir(), '.claude', '.credentials.json')
const CODEX_AUTH_PATH = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')

function formatTimeRemaining(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'expired'

  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}d ${remHours}h`
  }
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff <= 0) return 'just now'

  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }
  if (hours > 0) return `${hours}h ${minutes}m ago`
  return `${minutes}m ago`
}

/** Dedup key: provider + (accountId or email) */
function dedupKey(info: TokenInfo): string {
  const id = info.accountId || (info.email !== '-' ? info.email : null)
  return id ? `${info.provider}:${id}` : `${info.provider}:${info.path}`
}

async function scanCliProxyTokens(): Promise<TokenInfo[]> {
  const tokens: TokenInfo[] = []

  for (const dir of AUTH_DIRS) {
    let files: string[]
    try {
      const entries = await readdir(dir)
      files = entries.filter(f => f.endsWith('.json'))
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = join(dir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const json = JSON.parse(content)
        const result = v.safeParse(TokenFileSchema, json)
        if (!result.success) continue

        const token = result.output
        const nested = (json as Record<string, unknown>).token as Record<string, string> | undefined

        // Gemini tokens nest credentials under a `token` object
        const accessToken = token.access_token || nested?.access_token
        if (!accessToken) continue

        const expiry = token.expired || nested?.expiry || null
        const isExpired = expiry
          ? Date.now() >= new Date(expiry).getTime()
          : false
        const refreshToken = token.refresh_token || nested?.refresh_token
        const lastRefreshMs = token.last_refresh ? new Date(token.last_refresh).getTime() : 0

        tokens.push({
          path: filePath,
          provider: token.type || 'unknown',
          email: token.email || '-',
          accountId: token.account_id || null,
          accessExpiry: expiry,
          refreshToken: !!refreshToken,
          lastRefresh: token.last_refresh || null,
          lastRefreshMs,
          status: expiry ? (isExpired ? 'expired' : 'active') : 'unknown',
        })
      } catch {
        continue
      }
    }
  }

  return tokens
}

async function scanClaudeCodeCreds(): Promise<TokenInfo | null> {
  try {
    const content = await readFile(CLAUDE_CREDS_PATH, 'utf-8')
    const json = JSON.parse(content)
    const oauth = json?.claudeAiOauth
    if (!oauth?.accessToken) return null

    const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
    const isExpired = expiresAt !== null && expiresAt <= Date.now()
    const expiryStr = expiresAt ? new Date(expiresAt).toISOString() : null

    return {
      path: CLAUDE_CREDS_PATH,
      provider: 'claude',
      email: '-',
      accountId: null,
      accessExpiry: expiryStr,
      refreshToken: !!oauth.refreshToken,
      lastRefresh: null,
      lastRefreshMs: expiresAt ? expiresAt : 0,
      status: expiresAt ? (isExpired ? 'expired' : 'active') : 'unknown',
    }
  } catch {
    return null
  }
}

async function scanCodexCreds(): Promise<TokenInfo | null> {
  try {
    const content = await readFile(CODEX_AUTH_PATH, 'utf-8')
    const json = JSON.parse(content)
    if (!json?.tokens?.access_token) return null

    const lastRefreshMs = json.last_refresh ? new Date(json.last_refresh).getTime() : 0

    return {
      path: CODEX_AUTH_PATH,
      provider: 'codex',
      email: '-',
      accountId: json.tokens?.account_id || null,
      accessExpiry: null,
      refreshToken: !!json.tokens.refresh_token,
      lastRefresh: json.last_refresh || null,
      lastRefreshMs,
      status: 'unknown',
    }
  } catch {
    return null
  }
}

/** Dedup tokens: keep freshest per provider+account */
function dedup(tokens: TokenInfo[]): TokenInfo[] {
  const best = new Map<string, TokenInfo>()

  for (const token of tokens) {
    const key = dedupKey(token)
    const existing = best.get(key)

    if (!existing || token.lastRefreshMs > existing.lastRefreshMs) {
      best.set(key, token)
    }
  }

  return [...best.values()]
}

function statusLabel(info: TokenInfo): string {
  if (info.status === 'expired') return '\x1b[31mexpired\x1b[0m'
  if (info.status === 'active') return '\x1b[32mactive\x1b[0m'
  return '\x1b[33munknown\x1b[0m'
}

function formatToken(info: TokenInfo): string {
  const lines: string[] = []
  lines.push(`  Provider:  ${info.provider}`)
  lines.push(`  Email:     ${info.email}`)
  lines.push(`  Status:    ${statusLabel(info)}`)

  if (info.accessExpiry) {
    const remaining = formatTimeRemaining(info.accessExpiry)
    lines.push(`  Expires:   ${info.accessExpiry} (${remaining})`)
  }

  if (info.lastRefresh) {
    lines.push(`  Refreshed: ${info.lastRefresh} (${formatTimeSince(info.lastRefresh)})`)
  }

  lines.push(`  Refresh:   ${info.refreshToken ? 'yes' : 'no'}`)
  lines.push(`  Path:      ${info.path}`)

  return lines.join('\n')
}

export const authCommand = define({
  name: 'auth',
  description: 'List discovered auth tokens and expiry status',
  args: {
    all: {
      type: 'boolean',
      short: 'a',
      default: false,
      description: 'Show all tokens including duplicates',
    },
    format: {
      type: 'string',
      short: 'f',
      default: 'table',
      description: 'Output format (table or json)',
    },
  },
  run: async (ctx) => {
    const { all, format } = ctx.values

    const [cliProxyTokens, claudeCreds, codexCreds] = await Promise.all([
      scanCliProxyTokens(),
      scanClaudeCodeCreds(),
      scanCodexCreds(),
    ])

    const allTokens: TokenInfo[] = []
    if (claudeCreds) allTokens.push(claudeCreds)
    if (codexCreds) allTokens.push(codexCreds)
    allTokens.push(...cliProxyTokens)

    const displayTokens = all ? allTokens : dedup(allTokens)

    if (format === 'json') {
      console.log(JSON.stringify(displayTokens, null, 2))
      return
    }

    if (displayTokens.length === 0) {
      console.log('No auth tokens found.')
      console.log('Run `tokenai login <provider>` or provider CLI to authenticate.')
      return
    }

    console.log(`Found ${displayTokens.length} auth token(s):\n`)

    for (const token of displayTokens) {
      console.log(`--- ${token.provider} ${'-'.repeat(Math.max(0, 40 - token.provider.length))}`)
      console.log(formatToken(token))
      console.log()
    }
  },
})
