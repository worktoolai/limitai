import type { RateLimitResult } from '../providers/types.ts'
import { readCodexAuth } from '../providers/codex/auth.ts'
import { getCodexBaseUrl } from '../providers/codex/config.ts'
import { fetchCodexRateLimits } from '../providers/codex/api.ts'
import { discoverCliProxyAccounts, toCodexCredentials } from '../providers/cliproxy/discovery.ts'
import { fetchClaudeStats } from '../providers/claude/bridge.ts'
import { readGeminiAuth } from '../providers/gemini/auth.ts'
import { fetchGeminiRateLimits } from '../providers/gemini/api.ts'
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

  // --- Run all providers in parallel ---

  type CliproxyResult = { result: RateLimitResult; oauthId?: string }

  type ProviderOutcome = {
    kind: 'codex-native'
    result?: RateLimitResult
    accountId?: string
  } | {
    kind: 'cliproxy'
    items: CliproxyResult[]
    proxyErrors: string[]
  } | {
    kind: 'claude'
    result?: RateLimitResult
  } | {
    kind: 'gemini'
    result?: RateLimitResult
  }

  const codexTask = async (): Promise<ProviderOutcome> => {
    const codexAuth = await readCodexAuth()
    if (!codexAuth) return { kind: 'codex-native' }
    const baseUrl = await getCodexBaseUrl()
    const result = await fetchCodexRateLimits(baseUrl, codexAuth)
    return { kind: 'codex-native', result, accountId: codexAuth.accountId }
  }

  const cliproxyTask = async (): Promise<ProviderOutcome> => {
    const cliProxyDir = config['cli-proxy-api-dir'] || undefined
    const { accounts, errors: proxyErrors } = await discoverCliProxyAccounts(cliProxyDir)
    const baseUrl = await getCodexBaseUrl()

    // Skip expired accounts — they are shown in `limitai auth` instead
    const activeAccounts = accounts.filter(acct => !acct.expired)

    const proxyResults = await Promise.allSettled(
      activeAccounts.map(async (acct) => {
        const credentials = toCodexCredentials(acct.token)
        const result = await fetchCodexRateLimits(baseUrl, credentials)
        return {
          result: {
            ...result,
            account: {
              ...result.account,
              id: acct.accountId,
              source: 'cliproxy' as const,
              email: acct.token.email,
            },
            tokenPath: acct.filePath,
          },
          oauthId: acct.token.account_id,
        } as CliproxyResult
      })
    )

    const items: CliproxyResult[] = []
    const settledErrors: string[] = [...proxyErrors]
    for (const settled of proxyResults) {
      if (settled.status === 'fulfilled') {
        items.push(settled.value)
      } else {
        settledErrors.push(`CLIProxyAPI account: ${settled.reason}`)
      }
    }

    return { kind: 'cliproxy', items, proxyErrors: settledErrors }
  }

  const claudeTask = async (): Promise<ProviderOutcome> => {
    const claudeResult = await fetchClaudeStats()
    return { kind: 'claude', result: claudeResult ?? undefined }
  }

  const geminiTask = async (): Promise<ProviderOutcome> => {
    const geminiAuth = await readGeminiAuth()
    if (!geminiAuth) return { kind: 'gemini' }
    const geminiResult = await fetchGeminiRateLimits(geminiAuth)
    return { kind: 'gemini', result: geminiResult }
  }

  const settled = await Promise.allSettled([
    codexTask(),
    cliproxyTask(),
    claudeTask(),
    geminiTask(),
  ])

  // --- Process codex-native first (for dedup) ---
  const codexSettled = settled[0]
  if (codexSettled.status === 'fulfilled') {
    const outcome = codexSettled.value as Extract<ProviderOutcome, { kind: 'codex-native' }>
    if (outcome.result) {
      if (!filterAccount || outcome.result.account.id === filterAccount) {
        results.push(outcome.result)
      }
      if (outcome.accountId) {
        seenAccountIds.add(outcome.accountId)
      }
    }
  } else {
    const errResult: RateLimitResult = {
      account: { id: 'codex-native', provider: 'codex', source: 'native' },
      planType: 'unknown',
      error: (codexSettled.reason as Error).message,
    }
    if (!filterAccount || errResult.account.id === filterAccount) {
      results.push(errResult)
    }
  }

  // --- Process cliproxy (dedup against codex-native) ---
  const cliproxySettled = settled[1]
  if (cliproxySettled.status === 'fulfilled') {
    const outcome = cliproxySettled.value as Extract<ProviderOutcome, { kind: 'cliproxy' }>
    errors.push(...outcome.proxyErrors)

    for (const item of outcome.items) {
      // Dedup: skip if already seen via codex-native
      const oauthId = item.oauthId
      if (oauthId && seenAccountIds.has(oauthId)) continue
      if (oauthId) seenAccountIds.add(oauthId)

      if (!filterAccount || item.result.account.id === filterAccount) {
        results.push(item.result)
      }
    }
  } else {
    errors.push(`CLIProxyAPI discovery: ${(cliproxySettled.reason as Error).message}`)
  }

  // --- Process claude ---
  const claudeSettled = settled[2]
  if (claudeSettled.status === 'fulfilled') {
    const outcome = claudeSettled.value as Extract<ProviderOutcome, { kind: 'claude' }>
    if (outcome.result) {
      if (!filterAccount || outcome.result.account.id === filterAccount) {
        results.push(outcome.result)
      }
    }
  } else {
    errors.push(`Claude CLI: ${(claudeSettled.reason as Error).message}`)
  }

  // --- Process gemini ---
  const geminiSettled = settled[3]
  if (geminiSettled.status === 'fulfilled') {
    const outcome = geminiSettled.value as Extract<ProviderOutcome, { kind: 'gemini' }>
    if (outcome.result) {
      if (!filterAccount || outcome.result.account.id === filterAccount) {
        results.push(outcome.result)
      }
    }
  } else {
    errors.push(`Gemini: ${(geminiSettled.reason as Error).message}`)
  }

  return { results, errors }
}
