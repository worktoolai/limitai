import { describe, expect, it } from 'bun:test'
import { formatStatus } from './format.ts'
import type { RateLimitResult } from '../providers/types.ts'

describe('formatStatus', () => {
  it('renders Claude windows with explicit duration/scope labels', () => {
    const output = formatStatus([
      {
        account: { id: 'claude-local', provider: 'claude', source: 'native' },
        planType: 'max',
        primary: { usedPercent: 5, windowMinutes: 300, resetsAt: null },
        secondary: { usedPercent: 7, windowMinutes: 10080, resetsAt: null },
        additionalLimits: [
          {
            limitName: 'Sonnet only',
            meteredFeature: 'seven_day_sonnet',
            secondary: { usedPercent: 0, windowMinutes: 10080, resetsAt: null },
          },
        ],
      } satisfies RateLimitResult,
    ])

    expect(output).toContain('5h all')
    expect(output).toContain('7d all')
    expect(output).toContain('Sonnet only')
    expect(output).toContain('      7d')
    expect(output).not.toContain('Primary')
    expect(output).not.toContain('Secondary')
  })

  it('renders non-Claude windows with duration-only labels', () => {
    const output = formatStatus([
      {
        account: { id: 'codex-native', provider: 'codex', source: 'native' },
        planType: 'pro',
        primary: { usedPercent: 1, windowMinutes: 300, resetsAt: null },
        secondary: { usedPercent: 2, windowMinutes: 10080, resetsAt: null },
      } satisfies RateLimitResult,
    ])

    expect(output).toContain('5h')
    expect(output).toContain('7d')
    expect(output).not.toContain('5h all')
    expect(output).not.toContain('7d all')
  })
})
