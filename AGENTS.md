# limitai — Project Knowledge Base

**Status:** Pre-implementation (design complete, no source code yet)
**Rename pending:** `usage-monitor` dir → `limitai`

## OVERVIEW

CLI tool monitoring LLM rate limit **utilization** (not cost). Auto-discovers Codex/Claude/CLIProxyAPI auth, polls rate limits, stores snapshots for historical view.

## STRUCTURE

```
limitai/
├── DESIGN.md              # Full design spec (source of truth)
├── AGENTS.md              # This file
├── opencode.json          # OpenCode editor config
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
# Not yet implemented. Target commands:
limitai status          # Current rate limits
limitai daily           # Daily utilization history
limitai monthly         # Monthly utilization history
limitai list            # Discovered accounts
limitai install         # Background polling daemon
limitai uninstall       # Remove daemon
limitai doctor          # Connection diagnostics
```

## NOTES

- `analysis/` is reference only. These are external projects cloned for study. Do NOT modify.
- Claude Code is closed source. No auth source code available. CLI bridge (`claude -p "/stats"`) is the only integration path.
- Codex endpoints `/wham/usage` and `/api/codex/usage` are private. Treat as best-effort with probe logic.
- CLIProxyAPI ecosystem has GUI tools (Quotio, ZeroLimit) doing similar quota tracking. limitai is CLI-first.
- Project directory is still named `usage-monitor`. Rename to `limitai` when scaffolding begins.

## IMPLEMENTATION PHASES

| Phase | Scope | Estimate |
|-------|-------|----------|
| 1 | Scaffold + Codex native auth → `status` | 1d |
| 2 | CLIProxyAPI auto-discovery + multi-account | 0.5d |
| 3 | Claude CLI bridge (`/stats`) | 0.5d |
| 4 | SQLite + `install`/`uninstall` + adaptive polling | 1d |
| 5 | `daily` + `monthly` aggregation | 0.5d |
| 6 | `doctor` + `list` + polish | 0.5d |
