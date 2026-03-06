import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'

export interface LimitaiConfig {
  'cli-proxy-api-dir'?: string
}

const DEFAULT_CONFIG_PATH = join(homedir(), '.worktoolai', 'limitai', 'config.yaml')

export async function loadConfig(configPath?: string): Promise<LimitaiConfig> {
  const path = configPath || DEFAULT_CONFIG_PATH
  
  try {
    const content = await readFile(path, 'utf-8')
    const config: LimitaiConfig = {}
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) continue
      
      const key = trimmed.substring(0, colonIndex).trim()
      const value = trimmed.substring(colonIndex + 1).trim()
      
      if (key === 'cli-proxy-api-dir') {
        config['cli-proxy-api-dir'] = value
      }
    }
    
    return config
  } catch {
    return {}
  }
}
