import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { findCodexHome } from './auth.ts'

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api'

export async function getCodexBaseUrl(): Promise<string> {
  const codexHome = findCodexHome()
  const configPath = join(codexHome, 'config.toml')
  
  try {
    const content = await readFile(configPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('chatgpt_base_url')) {
        const match = trimmed.match(/chatgpt_base_url\s*=\s*"([^"]+)"/)
        if (match) {
          return normalizeBaseUrl(match[1])
        }
      }
    }
  } catch {
    // Config file doesn't exist or can't be read — use default
  }
  
  return DEFAULT_BASE_URL
}

function normalizeBaseUrl(url: string): string {
  let normalized = url.replace(/\/+$/, '')
  
  if (
    (normalized.startsWith('https://chatgpt.com') || normalized.startsWith('https://chat.openai.com')) &&
    !normalized.includes('/backend-api')
  ) {
    normalized = `${normalized}/backend-api`
  }
  
  return normalized
}
