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
}

const DEFAULT_CLI_PROXY_DIR = join(homedir(), '.cli-proxy-api')

/**
 * Scan CLIProxyAPI auth directory for token files.
 * Returns discovered accounts (codex type only for now - claude handled separately).
 * 
 * Policy:
 * - Permissive parsing: unknown fields ignored
 * - One file failure doesn't block others
 * - JSON parse failure: retry 1x after 50ms
 */
export async function discoverCliProxyAccounts(
  customDir?: string,
): Promise<{ accounts: DiscoveredCliProxyAccount[]; errors: string[] }> {
  const dir = customDir || DEFAULT_CLI_PROXY_DIR
  const accounts: DiscoveredCliProxyAccount[] = []
  const errors: string[] = []
  const existingIds = new Set<string>()
  
  let files: string[]
  try {
    const entries = await readdir(dir)
    files = entries.filter(f => f.endsWith('.json'))
  } catch {
    // Directory doesn't exist — not an error, just no CLIProxyAPI accounts
    return { accounts, errors }
  }
  
  for (const file of files) {
    const filePath = join(dir, file)
    try {
      const token = await readTokenFile(filePath)
      if (!token) continue
      
      // Only process codex tokens for rate limit API
      // Claude tokens will be used differently (Phase 3 uses CLI bridge instead)
      if (token.type !== 'codex') continue
      
      const accountId = generateAccountId(
        token.type,
        'cliproxy',
        token.email,
        token.account_id,
        existingIds,
      )
      existingIds.add(accountId)
      
      accounts.push({ token, filePath, accountId })
    } catch (err: unknown) {
      errors.push(`CLIProxyAPI ${file}: ${(err as Error).message}`)
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
