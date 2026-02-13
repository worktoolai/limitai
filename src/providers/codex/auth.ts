import * as v from 'valibot'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'

// auth.json schema — use looseObject to accept unknown fields
const TokenDataSchema = v.looseObject({
  access_token: v.string(),
  refresh_token: v.nullish(v.string()),
  account_id: v.nullish(v.string()),
})

const AuthDotJsonSchema = v.looseObject({
  auth_mode: v.nullish(v.string()),
  OPENAI_API_KEY: v.nullish(v.string()),
  tokens: v.nullish(TokenDataSchema),
  last_refresh: v.nullish(v.string()),
})

export type AuthDotJson = v.InferOutput<typeof AuthDotJsonSchema>

export interface CodexCredentials {
  accessToken: string
  accountId?: string  // from config if available
  authMode: 'chatgpt' | 'apiKey' | null
}

/** Resolve CODEX_HOME: CODEX_HOME env var -> ~/.codex */
export function findCodexHome(): string {
  const envHome = process.env.CODEX_HOME
  if (envHome && envHome.length > 0) {
    return envHome
  }
  return join(homedir(), '.codex')
}

/** Read and parse auth.json, return credentials or null */
export async function readCodexAuth(): Promise<CodexCredentials | null> {
  const codexHome = findCodexHome()
  const authPath = join(codexHome, 'auth.json')
  
  try {
    const content = await readFile(authPath, 'utf-8')
    const json = JSON.parse(content)
    const result = v.safeParse(AuthDotJsonSchema, json)
    
    if (!result.success) {
      console.error(`Warning: Failed to parse ${authPath}:`, result.issues[0]?.message)
      return null
    }
    
    const auth = result.output
    
    // Determine token source
    if (auth.auth_mode === 'apiKey' && auth.OPENAI_API_KEY) {
      // API key mode - not supported for rate limits (no chatgpt session)
      return null
    }
    
    const accessToken = auth.tokens?.access_token
    if (!accessToken) {
      return null
    }
    
    return {
      accessToken,
      accountId: auth.tokens?.account_id ?? undefined,
      authMode: (auth.auth_mode as 'chatgpt' | 'apiKey') ?? null,
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null  // File doesn't exist, that's fine
    }
    console.error(`Warning: Error reading ${authPath}:`, (err as Error).message)
    return null
  }
}
