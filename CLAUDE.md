# limitai

LLM rate limit utilization monitor CLI (Bun + TypeScript).

## Quick Reference

- **Runtime**: Bun
- **CLI**: gunshi
- **Validation**: valibot (looseObject for API resilience)
- **Storage**: SQLite at `~/.worktoolai/limitai/limitai.db`
- **Build**: `bun build src/cli.ts --compile --outfile dist/limitai`
- **Local install path**: `~/.worktoolai/bin/limitai`
- **Deploy**: build → `codesign -f -s -` → install under `~/.worktoolai/bin/`
- **Do not use**: `/opt/homebrew/bin/limitai` for local installs

## Providers

| Provider | Dir | Auth Sources |
|----------|-----|-------------|
| codex | `src/providers/codex/` | `~/.codex/auth.json`, tokenai `codex-*.json` |
| claude | `src/providers/claude/` | `~/.claude/.credentials.json`, Keychain, tokenai `claude-*.json` |
| gemini | `src/providers/gemini/` | tokenai `*.json` (type=gemini), `~/.gemini/oauth_creds.json` |

## Adding a Provider

1. `src/providers/types.ts` — add to `Provider` union
2. `src/providers/<name>/auth.ts` — credential discovery
3. `src/providers/<name>/api.ts` — fetch → `RateLimitResult`
4. `src/accounts/discovery.ts` — wire into `discoverAndFetch()`
5. `src/storage/snapshots.ts` — update provider type cast
6. `src/commands/auth.ts` — handle token format if non-standard

## Troubleshooting Index

- [Add Gemini Provider](docs/troubleshooting/20260302-add-gemini-provider.md) — provider integration, nested token format, quota fraction model
- [macOS Code Signing](docs/troubleshooting/20260302-macos-codesign.md) — `bun build --compile` binary killed on macOS
