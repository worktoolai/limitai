import * as v from 'valibot'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REFRESH_BUFFER_MS = 5 * 60 * 1000

// tokenai gemini token schema (file: ~/.worktoolai/tokenai/auth/*gemini*.json)
const TokenaiGeminiTokenSchema = v.looseObject({
  type: v.literal('gemini'),
  email: v.optional(v.string()),
  project_id: v.optional(v.string()),
  token: v.looseObject({
    access_token: v.string(),
    client_id: v.optional(v.string()),
    client_secret: v.optional(v.string()),
    refresh_token: v.optional(v.string()),
    expiry: v.optional(v.string()),
    token_uri: v.optional(v.string()),
  }),
})

// ~/.gemini/oauth_creds.json schema (Gemini CLI native)
const NativeOauthCredsSchema = v.looseObject({
  access_token: v.string(),
  refresh_token: v.optional(v.string()),
  client_id: v.optional(v.string()),
  client_secret: v.optional(v.string()),
  expiry_date: v.optional(v.union([v.number(), v.string()])),
  id_token: v.optional(v.string()),
})

export interface GeminiCredentials {
  accessToken: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  email?: string
  projectId?: string
  expiryMs?: number
  tokenPath?: string
  expiredAt?: string
}

const TOKENAI_AUTH_DIR = join(homedir(), '.worktoolai', 'tokenai', 'auth')
const NATIVE_CREDS_PATH = join(homedir(), '.gemini', 'oauth_creds.json')

function parseExpiryMs(expiry: string | number | undefined | null): number | undefined {
  if (expiry === undefined || expiry === null) return undefined
  if (typeof expiry === 'number') {
    // Could be seconds or milliseconds
    return expiry > 10_000_000_000 ? expiry : expiry * 1000
  }
  const ms = new Date(expiry).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

function isExpired(expiryMs: number | undefined): boolean {
  if (!expiryMs) return false
  return Date.now() + REFRESH_BUFFER_MS >= expiryMs
}

/** Refresh an expired access token using client credentials */
export async function refreshAccessToken(creds: GeminiCredentials): Promise<string | null> {
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) return null

  try {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    })

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    })

    if (resp.status === 401 || resp.status === 403) {
      return null
    }

    if (!resp.ok) return null

    const data = await resp.json() as Record<string, unknown>
    if (typeof data.access_token !== 'string' || !data.access_token) return null

    // Update in-place for the current session
    creds.accessToken = data.access_token
    if (typeof data.expires_in === 'number') {
      creds.expiryMs = Date.now() + (data.expires_in as number) * 1000
    }

    return data.access_token
  } catch {
    return null
  }
}

/** Ensure credentials have a valid (non-expired) access token, refreshing if needed */
export async function ensureFreshToken(creds: GeminiCredentials): Promise<string | null> {
  if (!isExpired(creds.expiryMs)) return creds.accessToken

  const refreshed = await refreshAccessToken(creds)
  if (refreshed) return refreshed

  // Token expired and refresh failed — still return the old token as a last resort
  return creds.accessToken || null
}

/** Read Gemini credentials from tokenai auth dir */
async function readTokenaiGeminiAuth(): Promise<GeminiCredentials | null> {
  let files: string[]
  try {
    const entries = await readdir(TOKENAI_AUTH_DIR)
    files = entries.filter(f => f.endsWith('.json'))
  } catch {
    return null
  }

  let best: { creds: GeminiCredentials; expiryMs: number } | null = null

  for (const file of files) {
    try {
      const filePath = join(TOKENAI_AUTH_DIR, file)
      const content = await readFile(filePath, 'utf-8')
      const json = JSON.parse(content)
      const result = v.safeParse(TokenaiGeminiTokenSchema, json)
      if (!result.success) continue

      const token = result.output
      const expiryMs = parseExpiryMs(token.token.expiry)

      const creds: GeminiCredentials = {
        accessToken: token.token.access_token,
        refreshToken: token.token.refresh_token,
        clientId: token.token.client_id,
        clientSecret: token.token.client_secret,
        email: token.email,
        projectId: token.project_id,
        expiryMs,
        tokenPath: filePath,
        expiredAt: token.token.expiry,
      }

      const thisExpiry = expiryMs ?? 0
      if (!best || thisExpiry > best.expiryMs) {
        best = { creds, expiryMs: thisExpiry }
      }
    } catch {
      continue
    }
  }

  return best?.creds ?? null
}

/** Read Gemini CLI native credentials (~/.gemini/oauth_creds.json) */
async function readNativeGeminiAuth(): Promise<GeminiCredentials | null> {
  try {
    const content = await readFile(NATIVE_CREDS_PATH, 'utf-8')
    const json = JSON.parse(content)
    const result = v.safeParse(NativeOauthCredsSchema, json)
    if (!result.success) return null

    const data = result.output
    const expiryMs = parseExpiryMs(data.expiry_date)

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      expiryMs,
      tokenPath: NATIVE_CREDS_PATH,
    }
  } catch {
    return null
  }
}

/**
 * Read Gemini auth — picks the best available credential:
 * - ~/.worktoolai/tokenai/auth/ (tokenai login)
 * - ~/.gemini/oauth_creds.json (Gemini CLI native)
 *
 * tokenai tokens are preferred as they include project_id and email.
 */
export async function readGeminiAuth(): Promise<GeminiCredentials | null> {
  const [tokenai, native] = await Promise.all([
    readTokenaiGeminiAuth(),
    readNativeGeminiAuth(),
  ])

  // Prefer tokenai — has project_id and email
  if (tokenai) return tokenai
  return native
}
