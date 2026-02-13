import { define } from 'gunshi'
import { findCodexHome, readCodexAuth } from '../providers/codex/auth.ts'
import { getCodexBaseUrl } from '../providers/codex/config.ts'
import { resolveCodexUsageUrl } from '../providers/codex/api.ts'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getDb } from '../storage/db.ts'

interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

async function runChecks(): Promise<CheckResult[]> {
  const checks: CheckResult[] = []
  
  const codexHome = findCodexHome()
  const authPath = join(codexHome, 'auth.json')
  
  if (existsSync(authPath)) {
    checks.push({ name: 'Codex auth.json', status: 'ok', message: `Found at ${authPath}` })
    
    const creds = await readCodexAuth()
    if (creds) {
      checks.push({ name: 'Codex token', status: 'ok', message: `Mode: ${creds.authMode ?? 'auto'}` })
      
      const baseUrl = await getCodexBaseUrl()
      const usageUrl = resolveCodexUsageUrl(baseUrl)
      checks.push({ name: 'Codex base URL', status: 'ok', message: baseUrl })
      
      try {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${creds.accessToken}`,
          'User-Agent': 'limitai/0.1.0',
        }
        if (creds.accountId) {
          headers['ChatGPT-Account-Id'] = creds.accountId
        }
        const response = await fetch(usageUrl, { headers })
        
        if (response.ok) {
          checks.push({ name: 'Codex API', status: 'ok', message: `HTTP ${response.status}` })
        } else if (response.status === 401 || response.status === 403) {
          checks.push({ name: 'Codex API', status: 'fail', message: `HTTP ${response.status} - token expired. Re-auth in Codex CLI.` })
        } else {
          checks.push({ name: 'Codex API', status: 'warn', message: `HTTP ${response.status} ${response.statusText}` })
        }
      } catch (err: unknown) {
        checks.push({ name: 'Codex API', status: 'fail', message: `Network error: ${(err as Error).message}` })
      }
    } else {
      checks.push({ name: 'Codex token', status: 'warn', message: 'No valid token found (apiKey mode or empty tokens)' })
    }
  } else {
    checks.push({ name: 'Codex auth.json', status: 'warn', message: `Not found at ${authPath}` })
  }
  
  const cliProxyDir = join(homedir(), '.cli-proxy-api')
  if (existsSync(cliProxyDir)) {
    const files = readdirSync(cliProxyDir).filter((f: string) => f.endsWith('.json'))
    checks.push({ name: 'CLIProxyAPI dir', status: 'ok', message: `${files.length} token file(s) in ${cliProxyDir}` })
  } else {
    checks.push({ name: 'CLIProxyAPI dir', status: 'warn', message: `Not found: ${cliProxyDir}` })
  }
  
  try {
    const proc = Bun.spawn(['which', 'claude'], { stdout: 'pipe', stderr: 'pipe' })
    const path = (await new Response(proc.stdout).text()).trim()
    const exitCode = await proc.exited
    
    if (exitCode === 0) {
      const vProc = Bun.spawn(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' })
      const version = (await new Response(vProc.stdout).text()).trim()
      await vProc.exited
      checks.push({ name: 'Claude CLI', status: 'ok', message: `${version} at ${path}` })
    } else {
      checks.push({ name: 'Claude CLI', status: 'warn', message: 'Not installed' })
    }
  } catch {
    checks.push({ name: 'Claude CLI', status: 'warn', message: 'Not available' })
  }
  
  try {
    const db = getDb()
    const count = db.prepare('SELECT COUNT(*) as cnt FROM snapshots').get() as { cnt: number }
    checks.push({ name: 'Database', status: 'ok', message: `${count.cnt} snapshots stored` })
  } catch (err: unknown) {
    checks.push({ name: 'Database', status: 'fail', message: (err as Error).message })
  }
  
  return checks
}

function formatChecks(checks: CheckResult[]): string {
  const lines: string[] = ['', 'limitai diagnostics', '']
  
  for (const check of checks) {
    const icon = check.status === 'ok' ? '[OK]  ' : check.status === 'warn' ? '[WARN]' : '[FAIL]'
    lines.push(`  ${icon} ${check.name.padEnd(20)} ${check.message}`)
  }
  
  lines.push('')
  
  const fails = checks.filter(c => c.status === 'fail')
  if (fails.length > 0) {
    lines.push(`${fails.length} issue(s) found. Fix the [FAIL] items above.`)
  } else {
    const warns = checks.filter(c => c.status === 'warn')
    if (warns.length > 0) {
      lines.push(`All checks passed with ${warns.length} warning(s).`)
    } else {
      lines.push('All checks passed.')
    }
  }
  lines.push('')
  
  return lines.join('\n')
}

export const doctorCommand = define({
  name: 'doctor',
  description: 'Run connection diagnostics',
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
    const checks = await runChecks()
    
    if (format === 'json') {
      console.log(JSON.stringify(checks, null, 2))
    } else {
      console.log(formatChecks(checks))
    }
  }
})
