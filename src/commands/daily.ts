import { define } from 'gunshi'
import { getDb } from '../storage/db.ts'

const BAR_WIDTH = 10

function usageBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty)
}

interface DailyRow {
  date: string
  account_id: string
  provider: string
  window_count: number
  secondary_min: number | null
  secondary_max: number | null
  peak_percent: number
}

function queryDailyAggregation(since: string, until: string, account?: string): DailyRow[] {
  const db = getDb()

  let query = `
    SELECT
      date(captured_at) as date,
      account_id,
      provider,
      COUNT(DISTINCT substr(window_id, 1, 13)) as window_count,
      MIN(secondary_used_percent) as secondary_min,
      MAX(secondary_used_percent) as secondary_max,
      MAX(used_percent) as peak_percent
    FROM snapshots
    WHERE captured_at >= ? AND captured_at < ?
      AND (used_percent IS NOT NULL OR secondary_used_percent IS NOT NULL)
  `
  const params: string[] = [since, until]

  if (account) {
    query += ' AND account_id = ?'
    params.push(account)
  }

  query += ' GROUP BY date(captured_at), account_id, provider ORDER BY date DESC, provider, account_id'

  return db.prepare(query).all(...params) as DailyRow[]
}

function formatProviderCell(row: DailyRow, nameWidth: number): string {
  const hasSecondary = row.secondary_min != null && row.secondary_max != null
  const delta = hasSecondary ? Math.max(0, row.secondary_max! - row.secondary_min!) : row.peak_percent
  const pct = `${Math.round(delta)}%`.padStart(4)
  const sessions = row.window_count > 0 ? ` ×${row.window_count}` : ''
  return `${row.provider.padEnd(nameWidth)} ${usageBar(delta)} ${pct}${sessions}`
}

function formatDailyTable(rows: DailyRow[]): string {
  if (rows.length === 0) {
    return 'No snapshot data found. Run `limitai install` (or `limitai watch`) to start collecting data.'
  }

  const byDate = new Map<string, DailyRow[]>()
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, [])
    byDate.get(row.date)!.push(row)
  }

  const allProviders = [...new Set(rows.map(r => r.provider))].sort()
  const nameWidth = Math.max(...allProviders.map(p => p.length))

  const lines: string[] = []

  for (const [date, dateRows] of byDate) {
    const byProvider = new Map(dateRows.map(r => [r.provider, r]))
    const cells = allProviders.map(p => {
      const row = byProvider.get(p)
      return row
        ? formatProviderCell(row, nameWidth)
        : `${p.padEnd(nameWidth)} ${'—'.repeat(BAR_WIDTH)}  ${'—%'.padStart(4)}`
    })
    lines.push(`${formatShortDate(date)}  ${cells.join(' │ ')}`)
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
