import { define } from 'gunshi'
import { getDb } from '../storage/db.ts'

interface DailyRow {
  date: string
  account_id: string
  provider: string
  window_count: number
  avg_percent: number
  peak_percent: number
}

function queryDailyAggregation(since: string, until: string, account?: string): DailyRow[] {
  const db = getDb()
  
  let query = `
    SELECT 
      date(captured_at) as date,
      account_id,
      provider,
      COUNT(DISTINCT window_id) as window_count,
      ROUND(AVG(used_percent), 1) as avg_percent,
      MAX(used_percent) as peak_percent
    FROM snapshots
    WHERE captured_at >= ? AND captured_at < ?
      AND used_percent IS NOT NULL
      AND window_id IS NOT NULL AND window_id != ''
  `
  const params: string[] = [since, until]
  
  if (account) {
    query += ' AND account_id = ?'
    params.push(account)
  }
  
  query += ' GROUP BY date(captured_at), account_id, provider ORDER BY date DESC, provider, account_id'
  
  return db.prepare(query).all(...params) as DailyRow[]
}

function formatDailyTable(rows: DailyRow[]): string {
  if (rows.length === 0) {
    return 'No snapshot data found. Run `limitai install` (or `limitai watch`) to start collecting data.'
  }
  
  const lines: string[] = []
  
  // Group by provider
  const byProvider = new Map<string, DailyRow[]>()
  for (const row of rows) {
    const key = row.provider.charAt(0).toUpperCase() + row.provider.slice(1)
    if (!byProvider.has(key)) byProvider.set(key, [])
    byProvider.get(key)!.push(row)
  }
  
  for (const [provider, providerRows] of byProvider) {
    lines.push('')
    lines.push(`--- ${provider} ${'---'.padStart(40 - provider.length, '-')}`)
    
    for (const row of providerRows) {
      const dateStr = formatShortDate(row.date)
      const windowLabel = row.provider === 'claude' ? 'blocks' : 'windows'
      const windowCount = String(row.window_count).padStart(2)
      const avg = `avg ${Math.round(row.avg_percent)}%`
      const peak = `peak ${Math.round(row.peak_percent)}%`
      lines.push(`  ${dateStr}  ${windowCount} ${windowLabel.padEnd(8)} ${avg.padEnd(8)} ${peak}`)
    }
  }
  
  return lines.join('\n')
}

function formatShortDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}`
}

function parseDateArg(val: string): string {
  const normalized = /^\d{8}$/.test(val)
    ? `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`
    : val

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date: ${val}. Use YYYY-MM-DD or YYYYMMDD.`)
  }

  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid date: ${val}. Use a real calendar date.`)
  }

  return normalized
}

export const dailyCommand = define({
  name: 'daily',
  description: 'Show daily utilization history',
  args: {
    since: {
      type: 'string',
      description: 'Start date (YYYY-MM-DD or YYYYMMDD)'
    },
    until: {
      type: 'string',
      description: 'End date (YYYY-MM-DD or YYYYMMDD)'
    },
    account: {
      type: 'string',
      short: 'a',
      description: 'Filter by account ID'
    },
    format: {
      type: 'string',
      short: 'f',
      default: 'table',
      description: 'Output format (table or json)'
    }
  },
  run: (ctx) => {
    const { since, until, account, format } = ctx.values

    let untilDate: string
    let sinceDate: string

    try {
      untilDate = until ? parseDateArg(until) : new Date().toISOString().slice(0, 10)
      sinceDate = since ? parseDateArg(since) : (() => {
        const d = new Date()
        d.setDate(d.getDate() - 7)
        return d.toISOString().slice(0, 10)
      })()
    } catch (err: unknown) {
      console.error(`Error: ${(err as Error).message}`)
      process.exitCode = 1
      return
    }

    if (sinceDate > untilDate) {
      console.error('Error: `--since` must be on or before `--until`.')
      process.exitCode = 1
      return
    }
    
    // Add 1 day to until for < comparison
    const untilPlus = new Date(untilDate + 'T00:00:00Z')
    untilPlus.setUTCDate(untilPlus.getUTCDate() + 1)
    
    const rows = queryDailyAggregation(sinceDate, untilPlus.toISOString().slice(0, 10), account)
    
    if (format === 'json') {
      console.log(JSON.stringify(rows, null, 2))
    } else {
      console.log(formatDailyTable(rows))
    }
  }
})
