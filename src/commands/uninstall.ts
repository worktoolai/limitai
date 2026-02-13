import { define } from 'gunshi'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { unlinkSync, existsSync } from 'node:fs'

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

function isIgnorableLaunchctlUnloadError(output: string): boolean {
  return /could not find specified service|no such process|service is not loaded/i.test(output)
}

function isIgnorableSystemctlDisableError(output: string): boolean {
  return /unit limitai\.service not loaded|unit limitai\.service could not be found/i.test(output)
}

export const uninstallCommand = define({
  name: 'uninstall',
  description: 'Remove background polling daemon',
  args: {},
  run: async () => {
    const platform = process.platform

    try {
      if (platform === 'darwin') {
        const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.limitai.watcher.plist')

        if (existsSync(plistPath)) {
          const unload = await runCommand(['launchctl', 'unload', plistPath])
          const output = `${unload.stderr}\n${unload.stdout}`
          if (unload.exitCode !== 0 && !isIgnorableLaunchctlUnloadError(output)) {
            throw commandFailure('launchctl unload', unload)
          }

          unlinkSync(plistPath)
          console.log('LaunchAgent removed.')
        } else {
          console.log('No LaunchAgent found. Nothing to uninstall.')
        }
        return
      }

      if (platform === 'linux') {
        const serviceDir = join(homedir(), '.config', 'systemd', 'user')
        const servicePath = join(serviceDir, 'limitai.service')
        const timerPath = join(serviceDir, 'limitai.timer')
        const hasService = existsSync(servicePath)
        const hasTimer = existsSync(timerPath)

        if (!hasService && !hasTimer) {
          console.log('No systemd unit files found. Nothing to uninstall.')
          return
        }

        const disable = await runCommand(['systemctl', '--user', 'disable', '--now', 'limitai.service'])
        const output = `${disable.stderr}\n${disable.stdout}`
        if (disable.exitCode !== 0 && !isIgnorableSystemctlDisableError(output)) {
          throw commandFailure('systemctl --user disable --now limitai.service', disable)
        }

        for (const path of [servicePath, timerPath]) {
          if (existsSync(path)) {
            unlinkSync(path)
          }
        }

        const daemonReload = await runCommand(['systemctl', '--user', 'daemon-reload'])
        if (daemonReload.exitCode !== 0) {
          throw commandFailure('systemctl --user daemon-reload', daemonReload)
        }

        console.log('systemd service removed.')
        return
      }

      console.log(`Unsupported platform: ${platform}`)
    } catch (err: unknown) {
      console.error(`Uninstall failed: ${(err as Error).message}`)
      process.exitCode = 1
    }
  }
})
