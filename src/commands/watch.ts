import { define } from 'gunshi'
import { runPollLoop } from '../polling/scheduler.ts'

export const watchCommand = define({
  name: 'watch',
  description: 'Run continuous polling (foreground daemon)',
  args: {
    daemon: {
      type: 'boolean',
      short: 'd',
      description: 'Run as daemon (suppress banner)',
      default: false,
    }
  },
  run: async (ctx) => {
    const { daemon } = ctx.values
    const controller = new AbortController()
    
    process.on('SIGINT', () => {
      if (!daemon) {
        console.log('\nReceived SIGINT, shutting down...')
      }
      controller.abort()
    })
    process.on('SIGTERM', () => {
      controller.abort()
    })
    
    await runPollLoop(controller.signal, { silent: daemon })
  }
})
