import { define } from 'gunshi'
import { getDb } from '../storage/db.ts'

const BAR_WIDTH = 10

function usageBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty)
}

interface MonthlyRow {
  month: string
  account_id: string
  provider: string
  total_windows: number
  days_active: number
  peak_percent: number
  secondary_min: number | null
  secondary_max: number | null
}

function queryMonthlyAggregation(account?: string): MonthlyRow[] {
  const db = getDb()

  let query = `
    SELECT
      strftime('%Y-%m', captured_at) as month,
      account_id,
      provider,
      COUNT(DISTINCT substr(window_id, 1, 13)) as total_windows,
      COUNT(DISTINCT date(captured_at)) as days_active,
      MAX(used_percent) as peak_percent,
      MIN(secondary_used_percent) as secondary_min,
      MAX(secondary_used_percent) as secondary_max
    FROM snapshots
    WHERE (used_percent IS NOT NULL OR secondary_used_percent IS NOT NULL)
  `
  const params: string[] = []

  if (account) {
    query += ' AND account_id = ?'
    params.push(account)
  }

  query += ' GROUP BY month, account_id, provider ORDER BY month DESC, provider, account_id'

  return db.prepare(query).all(...params) as MonthlyRow[]
}

function formatProviderCell(row: MonthlyRow, nameWidth: number): string {
  const hasSecondary = row.secondary_min != null && row.secondary_max != null
  const delta = hasSecondary ? Math.max(0, row.secondary_max! - row.secondary_min!) : row.peak_percent
  const pct = `${Math.round(delta)}%`.padStart(4)
  const days = `${row.days_active}d`
  return `${row.provider.padEnd(nameWidth)} ${usageBar(delta)} ${pct}  ${days}`
}

function formatMonthlyTable(rows: MonthlyRow[]): string {
  if (rows.length === 0) {
    return 'No snapshot data found. Run `limitai install` (or `limitai watch`) to start collecting data.'
  }

  const byMonth = new Map<string, MonthlyRow[]>()
  for (const row of rows) {
    if (!byMonth.has(row.month)) byMonth.set(row.month, [])
    byMonth.get(row.month)!.push(row)
  }

  const allProviders = [...new Set(rows.map(r => r.provider))].sort()
  const nameWidth = Math.max(...allProviders.map(p => p.length))

  const lines: string[] = []

  for (const [month, monthRows] of byMonth) {
    const byProvider = new Map(monthRows.map(r => [r.provider, r]))
    const cells = allProviders.map(p => {
      const row = byProvider.get(p)
      return row
        ? formatProviderCell(row, nameWidth)
        : `${p.padEnd(nameWidth)} ${'\u2014'.repeat(BAR_WIDTH)}  ${'\u2014%'.padStart(4)}`
    })
    lines.push(`${month}  ${cells.join(' \u2502 ')}`)
  }

  return lines.join('\n')
}

export const monthlyCommand = define({
  name: 'monthly',
  description: 'Show monthly utilization history',
  args: {
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
    const { account, format } = ctx.values
    const rows = queryMonthlyAggregation(account)
    
    if (format === 'json') {
      console.log(JSON.stringify(rows, null, 2))
    } else {
      console.log(formatMonthlyTable(rows))
    }
  }
})
