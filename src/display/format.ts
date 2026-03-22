import type { RateLimitResult, RateLimitWindow } from '../providers/types.ts'

const BAR_WIDTH = 10

function progressBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty)
}

function formatTimeRemaining(resetsAt: string | null): string {
  if (!resetsAt) return ''
  
  const now = Date.now()
  const resetTime = new Date(resetsAt).getTime()
  const diffMs = resetTime - now
  
  if (diffMs <= 0) return 'resetting...'
  
  const totalMinutes = Math.ceil(diffMs / 60000)
  if (totalMinutes < 60) {
    return `resets in ${totalMinutes}m`
  }
  
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (minutes === 0) {
    return `resets in ${hours}h`
  }
  return `resets in ${hours}h ${minutes}m`
}

function formatWindowDuration(windowMinutes: number | null): string | null {
  if (windowMinutes === null || !Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return null
  }

  if (windowMinutes % 1440 === 0) {
    return `${windowMinutes / 1440}d`
  }

  if (windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}h`
  }

  return `${windowMinutes}m`
}

function formatWindow(label: string, window: RateLimitWindow): string {
  const bar = progressBar(window.usedPercent)
  const pct = `${Math.round(window.usedPercent)}%`.padStart(4)
  const time = formatTimeRemaining(window.resetsAt)
  return `  ${label.padEnd(11)}${bar} ${pct}  ${time}`
}

function formatAdditionalWindow(label: string, window: RateLimitWindow): string {
  const bar = progressBar(window.usedPercent)
  const pct = `${Math.round(window.usedPercent)}%`.padStart(4)
  const time = formatTimeRemaining(window.resetsAt)
  return `      ${label.padEnd(10)}${bar} ${pct}  ${time}`
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function getMainWindowLabel(result: RateLimitResult, window: RateLimitWindow, fallback: string): string {
  const duration = formatWindowDuration(window.windowMinutes)
  if (!duration) {
    return fallback
  }

  if (result.account.provider === 'claude') {
    return `${duration} all`
  }

  return duration
}

function getAdditionalWindowLabel(window: RateLimitWindow, fallback: string): string {
  return formatWindowDuration(window.windowMinutes) ?? fallback
}

export function formatStatus(results: RateLimitResult[]): string {
  if (results.length === 0) {
    return 'No accounts discovered. Run `limitai doctor` for diagnostics.'
  }
  
  const lines: string[] = []
  
  for (const result of results) {
    const planLabel = result.planType !== 'unknown'
      ? ` (${capitalizeFirst(result.planType)})`
      : ''
    
    lines.push('')
    lines.push(`--- ${result.account.id}${planLabel} ${'---'.padStart(40 - result.account.id.length - planLabel.length, '-')}`)
    
    if (result.error && !result.primary && !result.secondary && !result.additionalLimits?.length) {
      lines.push(`  Error: ${result.error}`)
      continue
    }
    
    if (result.primary) {
      lines.push(formatWindow(getMainWindowLabel(result, result.primary, 'Primary'), result.primary))
    }
    
    if (result.secondary) {
      lines.push(formatWindow(getMainWindowLabel(result, result.secondary, 'Secondary'), result.secondary))
    }

    if (result.additionalLimits && result.additionalLimits.length > 0) {
      lines.push('  Additional limits')
      for (const additional of result.additionalLimits) {
        lines.push(`    ${additional.limitName}`)
        if (additional.primary) {
          lines.push(formatAdditionalWindow(getAdditionalWindowLabel(additional.primary, 'Primary'), additional.primary))
        }
        if (additional.secondary) {
          lines.push(formatAdditionalWindow(getAdditionalWindowLabel(additional.secondary, 'Secondary'), additional.secondary))
        }
      }
    }
    
    if (result.credits) {
      if (result.credits.unlimited) {
        lines.push('  Credits    unlimited')
      } else if (result.credits.balance) {
        lines.push(`  Credits    $${result.credits.balance} remaining`)
      }
    }
    
    if (!result.primary && !result.secondary && !result.additionalLimits?.length && !result.credits && !result.error) {
      lines.push('  No rate limit data available')
    }
    
    if (result.error) {
      lines.push(`  ⚠ ${result.error}`)
    }

    if (result.sourceConfidence === 'estimated') {
      lines.push('  (estimated data source)')
    }
  }
  
  return lines.join('\n')
}

export function formatStatusJson(results: RateLimitResult[]): string {
  return JSON.stringify(results, null, 2)
}
