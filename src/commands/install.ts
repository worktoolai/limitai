import { define } from 'gunshi'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { generateLaunchAgentPlist, generateSystemdService } from '../polling/scheduler.ts'

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCommand(command: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }
}

function commandFailure(label: string, result: CommandResult): Error {
  const detail = result.stderr || result.stdout || `exit code ${result.exitCode}`
  return new Error(`${label} failed: ${detail}`)
}

function resolveWatchCommand(): string[] {
  const bundled = import.meta.dir.startsWith('/$bunfs') || process.argv[1]?.startsWith('/$bunfs')
  if (bundled) {
    return [process.execPath, 'watch', '--daemon']
  }

  const entryArg = process.argv[1]
  const scriptPath = entryArg && !entryArg.startsWith('-')
    ? (isAbsolute(entryArg) ? entryArg : resolve(process.cwd(), entryArg))
    : join(import.meta.dir, '..', 'cli.ts')

  return [process.execPath, 'run', scriptPath, 'watch', '--daemon']
}

export const installCommand = define({
  name: 'install',
  description: 'Install background polling daemon',
  args: {},
  run: async () => {
    const platform = process.platform
    const watchCommand = resolveWatchCommand()

    try {
      if (platform === 'darwin') {
        const agentDir = join(homedir(), 'Library', 'LaunchAgents')
        const plistPath = join(agentDir, 'com.limitai.watcher.plist')

        mkdirSync(agentDir, { recursive: true })

        if (existsSync(plistPath)) {
          await runCommand(['launchctl', 'unload', plistPath])
        }

        writeFileSync(plistPath, generateLaunchAgentPlist(watchCommand))

        console.log(`LaunchAgent installed: ${plistPath}`)
        console.log('Loading...')

        const load = await runCommand(['launchctl', 'load', plistPath])
        if (load.exitCode !== 0) {
          throw commandFailure('launchctl load', load)
        }

        console.log('limitai background polling is now active.')
        console.log('Logs: /tmp/limitai.log')
        return
      }

      if (platform === 'linux') {
        const serviceDir = join(homedir(), '.config', 'systemd', 'user')
        const servicePath = join(serviceDir, 'limitai.service')
        const legacyTimerPath = join(serviceDir, 'limitai.timer')

        mkdirSync(serviceDir, { recursive: true })
        writeFileSync(servicePath, generateSystemdService(watchCommand))
        if (existsSync(legacyTimerPath)) {
          unlinkSync(legacyTimerPath)
        }

        console.log(`Service installed: ${servicePath}`)

        const daemonReload = await runCommand(['systemctl', '--user', 'daemon-reload'])
        if (daemonReload.exitCode !== 0) {
          throw commandFailure('systemctl --user daemon-reload', daemonReload)
        }

        const enable = await runCommand(['systemctl', '--user', 'enable', '--now', 'limitai.service'])
        if (enable.exitCode !== 0) {
          throw commandFailure('systemctl --user enable --now limitai.service', enable)
        }

        console.log('limitai background polling is now active.')
        console.log('Check status: systemctl --user status limitai.service')
        return
      }

      console.log(`Unsupported platform: ${platform}`)
      console.log('Use: limitai watch --daemon')
    } catch (err: unknown) {
      console.error(`Install failed: ${(err as Error).message}`)
      process.exitCode = 1
    }
  }
})
