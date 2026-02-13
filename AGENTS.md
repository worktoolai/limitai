# limitai — Project Knowledge Base

**Status:** Implemented (v0.1.x)

## OVERVIEW

CLI tool monitoring LLM rate limit **utilization** (not cost). Auto-discovers Codex/Claude/CLIProxyAPI auth, polls rate limits, stores snapshots for historical view.

## STRUCTURE

```
limitai/
├── DESIGN.md              # Full design spec (source of truth)
├── AGENTS.md              # This file
├── Claude.json          # Claude Code editor config
└── analysis/              # Reference codebases (read-only, not shipped)
    ├── ccusage/            # Token/cost tracker CLI (JSONL parsing reference)
    ├── claude-code/        # Claude Code repo (README/CHANGELOG only, closed source)
    └── codex/              # OpenAI Codex CLI (Rust, auth/API reference)
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Full design spec | `DESIGN.md` |
| Codex auth schema | `analysis/codex/codex-rs/core/src/auth/storage.rs` |
| Codex API calls | `analysis/codex/codex-rs/backend-client/src/client.rs` |
| Codex rate limit types | `analysis/codex/codex-rs/protocol/src/protocol.rs` |
| Codex API response schema | `analysis/codex/codex-rs/codex-backend-openapi-models/src/models/` |
| Codex home path logic | `analysis/codex/codex-rs/utils/home-dir/src/lib.rs` |
| JSONL parsing (Claude) | `analysis/ccusage/apps/ccusage/src/data-loader.ts` |
| JSONL parsing (Codex) | `analysis/ccusage/apps/codex/src/data-loader.ts` |
| CLIProxyAPI auth format | `/Users/bjm/work/ai/github/CLIProxyAPI/internal/auth/codex/token.go` |
| CLIProxyAPI config | `/Users/bjm/work/ai/github/CLIProxyAPI/config.example.yaml` |

## CONVENTIONS

- **Language:** TypeScript
- **Runtime:** Bun
- **CLI framework:** gunshi
- **Validation:** valibot
- **Database:** better-sqlite3
- **All timestamps:** UTC ISO 8601
- **No self-OAuth:** Read existing auth files only. Never implement own OAuth flow.
- **No token refresh:** Read-only. Expired → tell user to re-auth in original tool.
- **No write-back:** Never modify source auth files (CLIProxyAPI, Codex native).

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** implement OAuth login flow (Claude blocked 3rd-party, Codex has no public client flow)
- **NEVER** write to CLIProxyAPI auth-dir or Codex auth.json
- **NEVER** store tokens ourselves — read originals directly
- **NEVER** log/print token values
- **NEVER** detect window resets by `used_percent == 0` — use `resets_at` boundaries
- **NEVER** assume Codex API endpoints are stable (they're unofficial)

## KEY DESIGN DECISIONS

1. **Zero-config auto-discovery** — no import/add/login commands. Scan known paths.
2. **Rate limit focus** — not cost/token tracking. Core metric is `used_percent`.
3. **`resets_at`-based window detection** — snapshots grouped by `resets_at` value.
4. **Adaptive polling** — faster near reset boundaries, slower mid-window.
5. **SQLite storage** — snapshots with raw payload preserved.
6. **Cross-platform scheduling** — macOS LaunchAgent + Linux systemd + `--daemon` fallback.
7. **CLIProxyAPI compatibility** — read `~/.cli-proxy-api/*.json` auth files natively.
8. **Account naming** — `{type}-{email_local}-{email_domain}`, collision → append `-2`.

## COMMANDS

```bash
limitai status          # Current rate limits
limitai list            # Discovered accounts
limitai daily           # Daily utilization history
limitai monthly         # Monthly utilization history
limitai install         # Background polling daemon
limitai uninstall       # Remove daemon
limitai doctor          # Connection diagnostics
limitai watch           # Run foreground polling loop
```

## RELEASE

```bash
# 1. Bump version in both files
#    - package.json: "version" field
#    - src/cli.ts: version in cli() call

# 2. Build 4 platform binaries
bun build --compile --target=bun-darwin-arm64 --outfile dist/limitai-macos-arm64 src/cli.ts
bun build --compile --target=bun-darwin-x64 --outfile dist/limitai-macos-x64 src/cli.ts
bun build --compile --target=bun-linux-x64 --outfile dist/limitai-linux-x64 src/cli.ts
bun build --compile --target=bun-linux-arm64 --outfile dist/limitai-linux-arm64 src/cli.ts

# 3. Commit, push, create release
git add -A && git commit -m "..." && git push
gh release create v0.x.x dist/limitai-* --title "v0.x.x — Title" --notes "..."
```

## NOTES

- `analysis/` is reference only. These are external projects cloned for study. Do NOT modify.
- Claude Code is closed source. No auth source code available. CLI bridge (`claude -p "/stats"`) is the only integration path.
- Codex endpoints `/wham/usage` and `/api/codex/usage` are private. Treat as best-effort with probe logic.
- CLIProxyAPI ecosystem has GUI tools (Quotio, ZeroLimit) doing similar quota tracking. limitai is CLI-first.
