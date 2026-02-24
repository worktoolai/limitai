import * as v from 'valibot'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'

// auth.json schema — use looseObject to accept unknown fields
const TokenDataSchema = v.looseObject({
  access_token: v.string(),
  refresh_token: v.nullish(v.string()),
  account_id: v.nullish(v.string()),
})

const AuthDotJsonSchema = v.looseObject({
  auth_mode: v.nullish(v.string()),
  OPENAI_API_KEY: v.nullish(v.string()),
  tokens: v.nullish(TokenDataSchema),
  last_refresh: v.nullish(v.string()),
})

// CLIProxyAPI/tokenai flat token format
const CliProxyCodexTokenSchema = v.looseObject({
  type: v.literal('codex'),
  access_token: v.string(),
  account_id: v.nullish(v.string()),
  email: v.nullish(v.string()),
  last_refresh: v.nullish(v.string()),
  expired: v.nullish(v.string()),
})

/** Check if a token is expired based on its `expired` field */
function isTokenExpired(expiredStr: string | null | undefined): boolean {
  if (!expiredStr) return false // no expiry info — assume valid
  const expiresAt = new Date(expiredStr).getTime()
  return Date.now() >= expiresAt
}

export type AuthDotJson = v.InferOutput<typeof AuthDotJsonSchema>

export interface CodexCredentials {
  accessToken: string
  accountId?: string  // from config if available
  authMode: 'chatgpt' | 'apiKey' | null
  lastRefresh?: number  // epoch ms, for freshness comparison
  tokenPath?: string
  expiredAt?: string
}

/** Resolve CODEX_HOME: CODEX_HOME env var -> ~/.codex */
export function findCodexHome(): string {
  const envHome = process.env.CODEX_HOME
  if (envHome && envHome.length > 0) {
    return envHome
  }
  return join(homedir(), '.codex')
}

/** Read Codex CLI native auth.json */
async function readCodexNativeAuth(): Promise<CodexCredentials | null> {
  const codexHome = findCodexHome()
  const authPath = join(codexHome, 'auth.json')

  try {
    const content = await readFile(authPath, 'utf-8')
    const json = JSON.parse(content)
    const result = v.safeParse(AuthDotJsonSchema, json)

    if (!result.success) {
      return null
    }

    const auth = result.output

    if (auth.auth_mode === 'apiKey' && auth.OPENAI_API_KEY) {
      return null
    }

    const accessToken = auth.tokens?.access_token
    if (!accessToken) {
      return null
    }

    const lastRefresh = auth.last_refresh ? new Date(auth.last_refresh).getTime() : 0

    return {
      accessToken,
      accountId: auth.tokens?.account_id ?? undefined,
      authMode: (auth.auth_mode as 'chatgpt' | 'apiKey') ?? null,
      lastRefresh,
      tokenPath: authPath,
    }
  } catch {
    return null
  }
}

const TOKENAI_AUTH_DIR = join(homedir(), '.worktoolai', 'tokenai', 'auth')

/** Find the newest codex token in tokenai auth dir */
async function readTokenaiCodexAuth(): Promise<CodexCredentials | null> {
  let files: string[]
  try {
    const entries = await readdir(TOKENAI_AUTH_DIR)
    files = entries.filter(f => f.startsWith('codex-') && f.endsWith('.json'))
  } catch {
    return null
  }

  // Pick the most recently refreshed token
  let best: { creds: CodexCredentials; lastRefresh: number } | null = null

  for (const file of files) {
    try {
      const content = await readFile(join(TOKENAI_AUTH_DIR, file), 'utf-8')
      const json = JSON.parse(content)
      const result = v.safeParse(CliProxyCodexTokenSchema, json)
      if (!result.success) continue

      const token = result.output

      // Skip expired tokens
      if (isTokenExpired(token.expired)) continue

      const refreshTime = token.last_refresh ? new Date(token.last_refresh).getTime() : 0

      if (!best || refreshTime > best.lastRefresh) {
        best = {
          creds: {
            accessToken: token.access_token,
            accountId: token.account_id ?? undefined,
            authMode: 'chatgpt',
            lastRefresh: refreshTime,
            tokenPath: join(TOKENAI_AUTH_DIR, file),
            expiredAt: token.expired ?? undefined,
          },
          lastRefresh: refreshTime,
        }
      }
    } catch {
      continue
    }
  }

  return best?.creds ?? null
}

/**
 * Read codex auth — picks the freshest token across sources:
 * - ~/.codex/auth.json (Codex CLI native)
 * - ~/.worktoolai/tokenai/auth/codex-*.json (tokenai login)
 *
 * When both exist for the same account, the most recently refreshed wins.
 * Different accounts are handled by cliproxy discovery (dedup by account_id).
 */
export async function readCodexAuth(): Promise<CodexCredentials | null> {
  const [native, tokenai] = await Promise.all([
    readCodexNativeAuth(),
    readTokenaiCodexAuth(),
  ])

  if (!native) return tokenai
  if (!tokenai) return native

  // Same account — pick fresher token
  if (native.accountId && tokenai.accountId && native.accountId === tokenai.accountId) {
    return (tokenai.lastRefresh ?? 0) > (native.lastRefresh ?? 0) ? tokenai : native
  }

  // Different accounts — return native; tokenai account will appear via cliproxy discovery
  return native
}
