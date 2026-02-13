import { define } from 'gunshi'
import { getDb } from '../storage/db.ts'

interface MonthlyRow {
  month: string
  account_id: string
  provider: string
  total_windows: number
  avg_percent: number
  peak_percent: number
  days_active: number
}

function queryMonthlyAggregation(account?: string): MonthlyRow[] {
  const db = getDb()
  
  let query = `
    SELECT 
      strftime('%Y-%m', captured_at) as month,
      account_id,
      provider,
      COUNT(DISTINCT window_id) as total_windows,
      ROUND(AVG(used_percent), 1) as avg_percent,
      MAX(used_percent) as peak_percent,
      COUNT(DISTINCT date(captured_at)) as days_active
    FROM snapshots
    WHERE used_percent IS NOT NULL
      AND window_id IS NOT NULL AND window_id != ''
  `
  const params: string[] = []
  
  if (account) {
    query += ' AND account_id = ?'
    params.push(account)
  }
  
  query += ' GROUP BY month, account_id, provider ORDER BY month DESC, provider, account_id'
  
  return db.prepare(query).all(...params) as MonthlyRow[]
}

function formatMonthlyTable(rows: MonthlyRow[]): string {
  if (rows.length === 0) {
    return 'No snapshot data found. Run `limitai install` (or `limitai watch`) to start collecting data.'
  }
  
  const lines: string[] = []
  const byProvider = new Map<string, MonthlyRow[]>()
  
  for (const row of rows) {
    const key = row.provider.charAt(0).toUpperCase() + row.provider.slice(1)
    if (!byProvider.has(key)) byProvider.set(key, [])
    byProvider.get(key)!.push(row)
  }
  
  for (const [provider, providerRows] of byProvider) {
    lines.push('')
    lines.push(`--- ${provider} ${'---'.padStart(40 - provider.length, '-')}`)
    
    for (const row of providerRows) {
      const windowLabel = row.provider === 'claude' ? 'blocks' : 'windows'
      const windows = String(row.total_windows).padStart(3)
      const avg = `avg ${Math.round(row.avg_percent)}%`
      const peak = `peak ${Math.round(row.peak_percent)}%`
      const days = `${row.days_active}d active`
      lines.push(`  ${row.month}  ${windows} ${windowLabel.padEnd(8)} ${avg.padEnd(8)} ${peak.padEnd(9)} ${days}`)
    }
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
