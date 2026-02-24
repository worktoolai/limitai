import * as v from 'valibot'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { generateAccountId } from '../../accounts/naming.ts'
import type { CodexCredentials } from '../codex/auth.ts'

// Schema for CLIProxyAPI token files — looseObject to accept unknown fields
const CliProxyTokenSchema = v.looseObject({
  type: v.string(),
  access_token: v.string(),
  email: v.optional(v.string()),
  account_id: v.optional(v.string()),
  expired: v.optional(v.string()),
  last_refresh: v.optional(v.string()),
})

export type CliProxyToken = v.InferOutput<typeof CliProxyTokenSchema>

export interface DiscoveredCliProxyAccount {
  token: CliProxyToken
  filePath: string
  accountId: string
  expired: boolean
  expiredAt?: string
}

const DEFAULT_AUTH_DIRS = [
  join(homedir(), '.cli-proxy-api'),
  join(homedir(), '.worktoolai', 'tokenai', 'auth'),
]

/**
 * Scan CLIProxyAPI auth directories for token files.
 * Returns discovered accounts (codex type only for now - claude handled separately).
 *
 * Scans multiple directories:
 * - ~/.cli-proxy-api (CLIProxyAPI default)
 * - ~/.worktoolai/tokenai/auth (tokenai login)
 * - customDir (config override, prepended)
 *
 * Policy:
 * - Permissive parsing: unknown fields ignored
 * - One file failure doesn't block others
 * - JSON parse failure: retry 1x after 50ms
 * - Dedup by file path across directories
 */
export async function discoverCliProxyAccounts(
  customDir?: string,
): Promise<{ accounts: DiscoveredCliProxyAccount[]; errors: string[] }> {
  const dirs = customDir
    ? [customDir, ...DEFAULT_AUTH_DIRS.filter(d => d !== customDir)]
    : DEFAULT_AUTH_DIRS
  const accounts: DiscoveredCliProxyAccount[] = []
  const errors: string[] = []
  const existingIds = new Set<string>()
  const seenAccountKeys = new Set<string>()

  for (const dir of dirs) {
    let files: string[]
    try {
      const entries = await readdir(dir)
      files = entries.filter(f => f.endsWith('.json'))
    } catch {
      // Directory doesn't exist — not an error, just skip
      continue
    }

    for (const file of files) {
      const filePath = join(dir, file)
      try {
        const token = await readTokenFile(filePath)
        if (!token) continue

        // Only process codex tokens for rate limit API
        // Claude tokens will be used differently (Phase 3 uses CLI bridge instead)
        if (token.type !== 'codex') continue

        // Dedup: same account_id across directories
        const dedup = `${token.type}:${token.account_id || token.email || file}`
        if (seenAccountKeys.has(dedup)) continue
        seenAccountKeys.add(dedup)

        const tokenExpired = token.expired ? Date.now() >= new Date(token.expired).getTime() : false

        const accountId = generateAccountId(
          token.type,
          'cliproxy',
          token.email,
          token.account_id,
          existingIds,
        )
        existingIds.add(accountId)

        accounts.push({ token, filePath, accountId, expired: tokenExpired, expiredAt: token.expired })
      } catch (err: unknown) {
        errors.push(`CLIProxyAPI ${file}: ${(err as Error).message}`)
      }
    }
  }

  return { accounts, errors }
}

async function readTokenFile(filePath: string): Promise<CliProxyToken | null> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
  
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    // JSON parse failure — retry once after 50ms (partial write protection)
    await new Promise(resolve => setTimeout(resolve, 50))
    try {
      content = await readFile(filePath, 'utf-8')
      json = JSON.parse(content)
    } catch {
      return null
    }
  }
  
  const result = v.safeParse(CliProxyTokenSchema, json)
  if (!result.success) return null
  
  return result.output
}

/** Convert CLIProxyAPI token to CodexCredentials for API calls */
export function toCodexCredentials(token: CliProxyToken): CodexCredentials {
  return {
    accessToken: token.access_token,
    accountId: token.account_id,
    authMode: 'chatgpt',
  }
}
