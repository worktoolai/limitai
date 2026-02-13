import { define } from 'gunshi'
import { discoverAndFetch } from '../accounts/discovery.ts'
import { formatStatus, formatStatusJson } from '../display/format.ts'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const onDone = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onDone)
      resolve()
    }

    const timer = setTimeout(onDone, ms)
    signal.addEventListener('abort', onDone, { once: true })
  })
}

function renderFrame(results: Parameters<typeof formatStatus>[0], errors: string[], refreshSeconds: number): string {
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC')
  const lines: string[] = [
    `limitai live dashboard`,
    `updated: ${updatedAt} | refresh: ${refreshSeconds}s | Ctrl+C to exit`,
  ]

  for (const err of errors) {
    lines.push(`Warning: ${err}`)
  }

  lines.push(formatStatus(results))
  return lines.join('\n')
}

export const statusCommand = define({
  name: 'status',
  description: 'Show current rate limits',
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
    },
    simple: {
      type: 'boolean',
      short: 's',
      default: false,
      description: 'Render once (disable live mode)'
    },
    refresh: {
      type: 'number',
      short: 'r',
      default: 30,
      description: 'Live mode refresh interval in seconds'
    }
  },
  run: async (ctx) => {
    const { account, format, simple, refresh } = ctx.values

    if (simple || format === 'json' || !process.stdout.isTTY) {
      const { results, errors } = await discoverAndFetch(account)

      for (const err of errors) {
        console.error(`Warning: ${err}`)
      }

      if (format === 'json') {
        console.log(formatStatusJson(results))
      } else {
        console.log(formatStatus(results))
      }
      return
    }

    const refreshSeconds = typeof refresh === 'number' && Number.isFinite(refresh) && refresh > 0
      ? refresh
      : 5
    const controller = new AbortController()
    const onSigint = () => controller.abort()
    const onSigterm = () => controller.abort()
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)

    process.stdout.write('\x1b[?25l')

    try {
      while (!controller.signal.aborted) {
        const { results, errors } = await discoverAndFetch(account)
        process.stdout.write(`\x1b[2J\x1b[H${renderFrame(results, errors, refreshSeconds)}`)
        await sleep(refreshSeconds * 1000, controller.signal)
      }
    } finally {
      process.stdout.write('\x1b[?25h\n')
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
    }
  }
})
