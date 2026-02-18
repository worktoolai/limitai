#!/usr/bin/env bun
import { cli, define } from 'gunshi'
import { statusCommand } from './commands/status.ts'
import { dailyCommand } from './commands/daily.ts'
import { monthlyCommand } from './commands/monthly.ts'
import { listCommand } from './commands/list.ts'
import { installCommand } from './commands/install.ts'
import { uninstallCommand } from './commands/uninstall.ts'
import { doctorCommand } from './commands/doctor.ts'
import { watchCommand } from './commands/watch.ts'

const mainCommand = define({
  name: 'limitai',
  description: 'LLM rate limit utilization monitor',
  run: () => {}
})

const args = process.argv.slice(2)
const runStatus = args.length === 0

await cli(runStatus ? ['status'] : args, mainCommand, {
  name: 'limitai',
  version: '0.1.11',
  description: 'LLM rate limit utilization monitor',
  renderHeader: null,
  subCommands: {
    status: statusCommand,
    daily: dailyCommand,
    monthly: monthlyCommand,
    list: listCommand,
    install: installCommand,
    uninstall: uninstallCommand,
    doctor: doctorCommand,
    watch: watchCommand
  }
})
