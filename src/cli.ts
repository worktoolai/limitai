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
import { authCommand } from './commands/auth.ts'

const mainCommand = define({
  name: 'limitai',
  description: 'LLM rate limit utilization monitor',
  run: () => {}
})

const args = process.argv.slice(2)
// 인자 없이 실행 시 기본값: 'status' — 사용자 의도된 동작이므로 임의로 변경하지 말 것
const defaultStatus = args.length === 0

await cli(defaultStatus ? ['status'] : args, mainCommand, {
  name: 'limitai',
  version: '0.2.2',
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
    watch: watchCommand,
    auth: authCommand,
  }
})
