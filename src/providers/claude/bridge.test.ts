import { afterEach, describe, expect, it } from 'bun:test'
import { __claudeBridgeInternals } from './bridge.ts'

const {
  CLAUDE_CACHE_MAX_AGE_MS,
  getClaudeKeychainServiceName,
  isClaudeCacheFresh,
  parseClaudeCredentials,
  parseClaudeHudUsageCache,
  parseOhMyClaudeCodeUsageCache,
} = __claudeBridgeInternals

describe('Claude bridge internals', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('uses legacy keychain service name by default', () => {
    expect(getClaudeKeychainServiceName()).toBe('Claude Code-credentials')
  })

  it('derives config-scoped keychain service name when CLAUDE_CONFIG_DIR is set', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-claude-config'
    expect(getClaudeKeychainServiceName()).toBe('Claude Code-credentials-e9c7184a')
  })

  it('parses OMC cache timestamps and accepts fresh future-reset data', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const cache = parseOhMyClaudeCodeUsageCache({
      timestamp: Date.now(),
      data: {
        fiveHourPercent: 5,
        weeklyPercent: 7,
        sonnetWeeklyPercent: 0,
        fiveHourResetsAt: future,
        weeklyResetsAt: future,
        sonnetWeeklyResetsAt: future,
      },
    })

    expect(cache).not.toBeNull()
    expect(cache?.fetchedAt).toBeNumber()
    expect(cache?.additionalLimits?.[0]?.limitName).toBe('Sonnet only')
    expect(isClaudeCacheFresh(cache!)).toBe(true)
  })

  it('rejects stale cache entries older than the freshness cutoff', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const cache = parseOhMyClaudeCodeUsageCache({
      timestamp: Date.now() - CLAUDE_CACHE_MAX_AGE_MS - 1,
      data: {
        fiveHourPercent: 5,
        weeklyPercent: 7,
        fiveHourResetsAt: future,
        weeklyResetsAt: future,
      },
    })

    expect(cache).not.toBeNull()
    expect(isClaudeCacheFresh(cache!)).toBe(false)
  })

  it('rejects cache entries whose reset windows are already past', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const cache = parseClaudeHudUsageCache({
      timestamp: Date.now(),
      data: {
        planName: 'Claude Max',
        fiveHour: 5,
        sevenDay: 7,
        fiveHourResetAt: past,
        sevenDayResetAt: past,
      },
    })

    expect(cache).not.toBeNull()
    expect(isClaudeCacheFresh(cache!)).toBe(false)
  })

  it('distinguishes expired Claude credentials from missing credentials', () => {
    const expired = parseClaudeCredentials({
      claudeAiOauth: {
        accessToken: 'token',
        subscriptionType: 'Claude Max',
        expiresAt: Date.now() - 1000,
      },
    })

    expect(expired.credentials).toBeNull()
    expect(expired.expiredAt).toBeString()
  })
})
