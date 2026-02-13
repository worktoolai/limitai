import { define } from 'gunshi'
import { discoverAndFetch } from '../accounts/discovery.ts'
import { getAllAccounts } from '../storage/snapshots.ts'

interface AccountInfo {
  id: string
  provider: string
  source: string
  planType: string
  status: string
  lastSeen?: string
}

export const listCommand = define({
  name: 'list',
  description: 'List discovered accounts',
  args: {
    format: {
      type: 'string',
      short: 'f',
      default: 'table',
      description: 'Output format (table or json)'
    }
  },
  run: async (ctx) => {
    const { format } = ctx.values
    
    const { results } = await discoverAndFetch()
    const accounts: AccountInfo[] = []
    
    for (const result of results) {
      accounts.push({
        id: result.account.id,
        provider: result.account.provider,
        source: result.account.source,
        planType: result.planType,
        status: result.error ? 'error' : 'ok',
      })
    }
    
    const stored = getAllAccounts()
    for (const s of stored) {
      if (!accounts.find(a => a.id === s.accountId)) {
        accounts.push({
          id: s.accountId,
          provider: s.provider,
          source: 'stored',
          planType: s.planType ?? 'unknown',
          status: 'inactive',
          lastSeen: s.lastSeen,
        })
      }
    }
    
    if (format === 'json') {
      console.log(JSON.stringify(accounts, null, 2))
      return
    }
    
    if (accounts.length === 0) {
      console.log('No accounts found.')
      return
    }
    
    console.log('')
    console.log(`  ${'ID'.padEnd(25)} ${'Provider'.padEnd(10)} ${'Plan'.padEnd(12)} ${'Status'.padEnd(10)}`)
    console.log(`  ${''.padEnd(25, '-')} ${''.padEnd(10, '-')} ${''.padEnd(12, '-')} ${''.padEnd(10, '-')}`)
    
    for (const a of accounts) {
      const lastSeen = a.lastSeen ? ` (last: ${a.lastSeen.slice(0, 10)})` : ''
      console.log(`  ${a.id.padEnd(25)} ${a.provider.padEnd(10)} ${a.planType.padEnd(12)} ${a.status}${lastSeen}`)
    }
    console.log('')
  }
})
