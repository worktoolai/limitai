# Add Gemini Provider

**Date**: 2026-03-02
**Scope**: New provider integration + deployment fix

## What Was Done

Added Gemini as a third provider alongside Claude and Codex.

### New Files
- `src/providers/gemini/auth.ts` — Credential discovery from tokenai + native `~/.gemini/oauth_creds.json`
- `src/providers/gemini/api.ts` — Quota fetch via Google Cloud internal APIs

### Modified Files
- `src/providers/types.ts` — Added `'gemini'` to `Provider` union
- `src/accounts/discovery.ts` — Wired Gemini into `discoverAndFetch()`
- `src/storage/snapshots.ts` — Updated provider type cast
- `src/commands/auth.ts` — Handle Gemini's nested `token` object format
- `src/storage/db.ts` — Data dir `~/.limitai` → `~/.worktoolai/limitai`
- `src/config.ts` — Config path `~/.limitai` → `~/.worktoolai/limitai`

## Issues & Solutions

### 1. macOS kills compiled binary

**Symptom**: `limitai` exits with `killed` signal (137) after `bun build --compile`.

**Root Cause**: macOS requires code signature on Mach-O binaries. Bun's `--compile` output lacks one.

**Fix**: Ad-hoc sign after build:
```bash
bun build src/cli.ts --compile --outfile dist/limitai
codesign -f -s - dist/limitai
cp dist/limitai ~/.local/bin/limitai
```

**Note**: Must sign AFTER copy if `cp` strips extended attributes. Use `codesign -f -s -` on the final path.

### 2. Gemini token not appearing in `limitai auth`

**Symptom**: `limitai auth` shows codex and claude but not gemini.

**Root Cause**: Gemini tokenai files use nested structure `{ token: { access_token, ... } }` while `scanCliProxyTokens()` expected flat `{ access_token }`.

**Fix**: Extract from nested `token` object as fallback:
```typescript
const nested = (json as Record<string, unknown>).token as Record<string, string> | undefined
const accessToken = token.access_token || nested?.access_token
const expiry = token.expired || nested?.expiry || null
const refreshToken = token.refresh_token || nested?.refresh_token
```

### 3. Gemini quota API uses fraction-based model

**Context**: Unlike Codex (which returns `used_percent` directly), Gemini returns `remainingFraction` (0.0–1.0).

**Conversion**: `usedPercent = Math.round((1 - remainingFraction) * 100)`

**Bucket selection**: Multiple buckets per model category (Pro/Flash); pick lowest remaining (most restrictive).

## Gemini API Flow

```
ensureFreshToken (OAuth2 refresh if <5min to expiry)
  → POST loadCodeAssist (get tier/plan + project ID)
  → discoverProjectId (from response or GCP projects API)
  → POST retrieveUserQuota (get quota buckets)
  → Parse: collect buckets → separate Pro/Flash → pick lowest remaining
```

**Error handling** (from openusage reference):
- 401/403 → refresh token + retry once
- Still 401/403 after retry → "session expired"
- Non-2xx quota → "quota request failed (HTTP {status})"
- Unparseable response → "quota response invalid"
- Network failure → "Network error: {message}"

## Provider Addition Checklist

For future providers, touch these files:

1. `src/providers/types.ts` — add to `Provider` union type
2. `src/providers/<name>/auth.ts` — credential discovery
3. `src/providers/<name>/api.ts` — API fetch → `RateLimitResult`
4. `src/accounts/discovery.ts` — import + call in `discoverAndFetch()`
5. `src/storage/snapshots.ts` — update provider type cast in `mapRowToSnapshot()`
6. `src/commands/auth.ts` — handle token format if non-standard (nested fields etc.)

## Reference

- Gemini API patterns: `/Users/bjm/work/ai/github/openusage/plugins/gemini/plugin.js`
- Tokenai auth file: `~/.worktoolai/tokenai/auth/*.json` with `type: "gemini"`
