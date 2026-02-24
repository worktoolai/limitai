import type { RateLimitResult } from '../providers/types.ts'
import { readCodexAuth } from '../providers/codex/auth.ts'
import { getCodexBaseUrl } from '../providers/codex/config.ts'
import { fetchCodexRateLimits } from '../providers/codex/api.ts'
import { discoverCliProxyAccounts, toCodexCredentials } from '../providers/cliproxy/discovery.ts'
import { fetchClaudeStats } from '../providers/claude/bridge.ts'
import { loadConfig } from '../config.ts'

export interface DiscoveryResult {
  results: RateLimitResult[]
  errors: string[]
}

export async function discoverAndFetch(filterAccount?: string): Promise<DiscoveryResult> {
  const results: RateLimitResult[] = []
  const errors: string[] = []
  const config = await loadConfig()
  
  // Dedup: same OpenAI account can exist in both ~/.codex/auth.json and ~/.cli-proxy-api/. Native wins.
  const seenAccountIds = new Set<string>()
  
  try {
    const codexAuth = await readCodexAuth()
    if (codexAuth) {
      const baseUrl = await getCodexBaseUrl()
      const result = await fetchCodexRateLimits(baseUrl, codexAuth)

      if (!filterAccount || result.account.id === filterAccount) {
        results.push(result)
      }
      if (codexAuth.accountId) {
        seenAccountIds.add(codexAuth.accountId)
      }
    }
  } catch (err: unknown) {
    // Push as a result with error so it renders in the status display
    const errResult: RateLimitResult = {
      account: { id: 'codex-native', provider: 'codex', source: 'native' },
      planType: 'unknown',
      error: (err as Error).message,
    }
    if (!filterAccount || errResult.account.id === filterAccount) {
      results.push(errResult)
    }
  }
  
  try {
    const cliProxyDir = config['cli-proxy-api-dir'] || undefined
    const { accounts, errors: proxyErrors } = await discoverCliProxyAccounts(cliProxyDir)
    errors.push(...proxyErrors)
    
    const baseUrl = await getCodexBaseUrl()
    
    const uniqueAccounts = accounts.filter((acct) => {
      const oauthId = acct.token.account_id
      if (oauthId && seenAccountIds.has(oauthId)) {
        return false
      }
      if (oauthId) {
        seenAccountIds.add(oauthId)
      }
      return true
    })

    // Skip expired accounts — they are shown in `limitai auth` instead
    const activeAccounts = uniqueAccounts.filter(acct => !acct.expired)

    const proxyResults = await Promise.allSettled(
      activeAccounts.map(async (acct) => {
        const credentials = toCodexCredentials(acct.token)
        const result = await fetchCodexRateLimits(baseUrl, credentials)
        return {
          ...result,
          account: {
            ...result.account,
            id: acct.accountId,
            source: 'cliproxy' as const,
            email: acct.token.email,
          },
          tokenPath: acct.filePath,
        }
      })
    )

    for (const settled of proxyResults) {
      if (settled.status === 'fulfilled') {
        if (!filterAccount || settled.value.account.id === filterAccount) {
          results.push(settled.value)
        }
      } else {
        errors.push(`CLIProxyAPI account: ${settled.reason}`)
      }
    }
  } catch (err: unknown) {
    errors.push(`CLIProxyAPI discovery: ${(err as Error).message}`)
  }
  
  try {
    const claudeResult = await fetchClaudeStats()
    if (claudeResult) {
      if (!filterAccount || claudeResult.account.id === filterAccount) {
        results.push(claudeResult)
      }
    }
  } catch (err: unknown) {
    errors.push(`Claude CLI: ${(err as Error).message}`)
  }
  
  return { results, errors }
}
