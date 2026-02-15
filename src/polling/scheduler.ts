import { discoverAndFetch } from '../accounts/discovery.ts'
import { insertSnapshot, purgeOldSnapshots } from '../storage/snapshots.ts'
import { calculatePollInterval } from './adaptive.ts'
import { closeDb } from '../storage/db.ts'
import type { RateLimitResult } from '../providers/types.ts'

interface PollLoopOptions {
  silent?: boolean
}

function resultToSnapshot(result: RateLimitResult) {
  const now = new Date().toISOString()
  return {
    accountId: result.account.id,
    capturedAt: now,
    provider: result.account.provider,
    windowId: result.primary?.resetsAt ?? '',
    usedPercent: result.primary?.usedPercent ?? null,
    windowMinutes: result.primary?.windowMinutes ?? null,
    resetsAt: result.primary?.resetsAt ?? null,
    secondaryUsedPercent: result.secondary?.usedPercent ?? null,
    secondaryResetsAt: result.secondary?.resetsAt ?? null,
    planType: result.planType,
    sourceConfidence: (result.sourceConfidence ?? 'direct') as 'direct' | 'estimated' | 'unknown',
    rawPayload: result,
  }
}

async function pollOnce(): Promise<{ nextInterval: number }> {
  const { results, errors } = await discoverAndFetch()
  
  for (const err of errors) {
    console.error(`[poll] ${err}`)
  }
  
  let earliestReset: string | null = null
  let hasFailures = false
  
  for (const result of results) {
    if (result.error) {
      hasFailures = true
      continue
    }
    
    const snapshot = resultToSnapshot(result)
    insertSnapshot(snapshot)
    
    if (result.primary?.resetsAt) {
      if (!earliestReset || result.primary.resetsAt < earliestReset) {
        earliestReset = result.primary.resetsAt
      }
    }
  }
  
  const nextInterval = calculatePollInterval(earliestReset, hasFailures ? 1 : 0)
  return { nextInterval }
}

export async function runPollLoop(signal?: AbortSignal, options: PollLoopOptions = {}): Promise<void> {
  const silent = options.silent === true

  if (!silent) {
    console.log('[limitai] Starting polling loop...')
  }
  
  const purged = purgeOldSnapshots()
  if (!silent && purged > 0) {
    console.log(`[limitai] Purged ${purged} old snapshots`)
  }
  
  while (!signal?.aborted) {
    try {
      const { nextInterval } = await pollOnce()
      const secs = Math.round(nextInterval / 1000)
      if (!silent) {
        console.log(`[limitai] Next poll in ${secs}s`)
      }
      
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, nextInterval)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        }, { once: true })
      })
    } catch (err: unknown) {
      if ((err as Error).message === 'Aborted') break
      console.error(`[limitai] Poll error: ${(err as Error).message}`)
      await new Promise(resolve => setTimeout(resolve, 60_000))
    }
  }
  
  closeDb()
  if (!silent) {
    console.log('[limitai] Polling stopped.')
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function quoteSystemdArg(value: string): string {
  if (!/[\s"'\\$`]/.test(value)) {
    return value
  }

  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')

  return `"${escaped}"`
}

export function generateLaunchAgentPlist(command: string[]): string {
  const argsXml = command
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.limitai.watcher</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/limitai.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/limitai.err</string>
</dict>
</plist>`
}

export function generateSystemdService(command: string[]): string {
  const execStart = command.map(quoteSystemdArg).join(' ')

  return `[Unit]
Description=limitai - LLM rate limit monitor
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target`
}
