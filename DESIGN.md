# limitai — Design Document

> LLM rate limit **utilization** monitor CLI.
> Not a cost/token tracker. Core question: "How efficiently am I using my rate limits?"

**Project rename**: `usage-monitor` → `limitai`

---

## Commands

```
limitai status                # Current rate limit (auto-discover all accounts)
limitai daily                 # Daily utilization (from stored snapshots)
limitai monthly               # Monthly utilization
limitai list                  # Show discovered accounts
limitai install               # Register background polling (LaunchAgent/systemd)
limitai uninstall             # Remove background polling
limitai doctor                # Diagnose connection/token/endpoint status
```

Non-standard paths via config only:

```yaml
# ~/.limitai/config.yaml
codex-paths:
  - /custom/path/auth.json
cli-proxy-api-dir: /custom/cli-proxy-api
```

---

## Auto-Discovery (Zero-Config)

No `import`, `add`, or `login` commands. Just run `limitai status`.

| Source | Path | Detection |
|--------|------|-----------|
| Codex (native) | `~/.codex/auth.json` | File exists |
| Claude | `claude` CLI | `which claude` + execute `/stats` |
| CLIProxyAPI | `~/.cli-proxy-api/*.json` | Directory scan, `type` field determines provider |

---

## Account Naming

| Source | ID Rule | Example |
|--------|---------|---------|
| Native codex | `codex-native` (singleton) | `codex-native` |
| CLIProxyAPI (email present) | `{type}-{email_local}-{email_domain}` | `codex-john-company` |
| CLIProxyAPI (no email) | `{type}-{account_id[:8]}` | `codex-a3f2b1c9` |
| Claude CLI | `claude-local` (singleton) | `claude-local` |

Collision: append `-2`, `-3` suffix automatically.

---

## Provider Data Sources

### Codex

- **Auth**: `auth.json` → `tokens.access_token`
- **Endpoint probe**: base_url contains `/backend-api` → `GET /wham/usage`, else → `GET /api/codex/usage`
- **Base URL**: `~/.codex/config.toml` → `chatgpt_base_url` (default: `https://chatgpt.com/backend-api/`)
- **Headers**: `Authorization: Bearer {token}` + `ChatGPT-Account-Id: {account_id}` (if present)
- **Response**: `RateLimitStatusPayload` — loose validation (accept unknown fields), store raw payload

```typescript
// Codex auth.json schema
interface AuthDotJson {
  auth_mode?: "chatgpt" | "apiKey" | null;
  OPENAI_API_KEY?: string;
  tokens?: { access_token: string; refresh_token?: string; };
  last_refresh?: string;
}

// Codex API response
interface RateLimitStatusPayload {
  plan_type: "guest"|"free"|"plus"|"pro"|"team"|"enterprise";
  rate_limit?: {
    primary_window?: { used_percent: number; window_minutes?: number; resets_at?: number; };
    secondary_window?: { used_percent: number; window_minutes?: number; resets_at?: number; };
  };
  credits?: { has_credits: boolean; unlimited: boolean; balance?: string; };
  additional_rate_limits?: Array<{ limit_id: string; rate_limit: unknown; }>;
}
```

- **Endpoints are unofficial** — probe and record which worked per account
- On failure, `doctor` shows "unsupported"

### Claude

- **Strategy**: `claude -p "/stats" --output-format json` CLI bridge
- **No self OAuth** (3rd-party blocked since 2026.01). CLI bridge only.
- Store `claude --version` with each snapshot (format change detection)
- JSON parse failure → graceful degradation to "unknown/estimated"
- exit code != 0 → "re-login required" message

### Codex Keyring (Secondary)

- macOS Keychain: service `"Codex Auth"`, key `"cli|{sha256(canonical_codex_home)[:16]}"`
- Only attempt if `auth.json` not found
- Failure → graceful skip (user prompt on macOS, libsecret on Linux)

### CLIProxyAPI Auth Files

File format (CLIProxyAPI-compatible):

```json
{
  "type": "codex",
  "id_token": "...",
  "access_token": "...",
  "refresh_token": "...",
  "account_id": "...",
  "email": "john@example.com",
  "expired": "...",
  "last_refresh": "..."
}
```

| Policy | Rule |
|--------|------|
| Parsing | Permissive — unknown fields ignored, only required fields validated |
| Failure | Skip with warning (one file failure doesn't block others) |
| Partial write | JSON parse failure → retry 1x after 50ms |
| Write-back | **NEVER** |

---

## Token Refresh

**limitai does NOT refresh tokens.**

| Situation | Behavior |
|-----------|----------|
| Token valid | Normal query |
| Token expired | Show "expired — re-auth in [original tool]" in `status` |
| Auth failure (401/403) | Backoff + jitter, stop polling after repeated failures |
| CLIProxyAPI tokens | CLIProxyAPI handles refresh. limitai reads only |

---

## Security

| Item | Policy |
|------|--------|
| Token storage | No self-storage. Read original files directly |
| CLIProxyAPI files | Read-only. Never write back |
| File permissions | `~/.limitai/` directory `0700`, DB file `0600` |
| Logs | Never output token values |

---

## Reset Detection — `resets_at` Based

NOT `used_percent == 0` detection. Use `resets_at` timestamp boundaries.

```
snapshot 1: used 72%, resets_at 11:30
snapshot 2: used 85%, resets_at 11:30    ← same window
snapshot 3: used 15%, resets_at 12:00    ← resets_at changed = new window
```

Snapshots sharing the same `resets_at` = same window.
`resets_at` change = window transition.
Last snapshot's `used_percent` before transition = that window's final utilization.

---

## Polling Strategy

### Adaptive Polling (resets_at-based dynamic intervals)

| Condition | Interval |
|-----------|----------|
| < 5 min to reset | 1 min |
| < 30 min to reset | 3 min |
| Otherwise | 5-10 min |
| Auth failure | Exponential backoff (max 30 min) |

### Schedulers (Cross-platform)

| OS | Method |
|----|--------|
| macOS | `~/Library/LaunchAgents/com.limitai.watcher.plist` |
| Linux | `~/.config/systemd/user/limitai.timer` + `.service` |
| Fallback | `limitai watch --daemon` (nohup) |

---

## Storage — SQLite

```sql
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,       -- UTC ISO 8601
  provider TEXT NOT NULL,          -- "codex" | "claude"
  window_id TEXT,                  -- resets_at value (window grouping key)
  used_percent REAL,
  window_minutes INTEGER,
  resets_at TEXT,                   -- UTC ISO 8601
  plan_type TEXT,
  source_confidence TEXT,          -- "direct" | "estimated" | "unknown"
  raw_payload TEXT                 -- original JSON stored as-is
);

CREATE INDEX idx_account_time ON snapshots(account_id, captured_at);
```

- **All timestamps UTC**
- `resets_at - now` negative → "reset imminent" handling
- Retention: raw snapshots 30 days, daily rollups kept permanently

---

## Normalized Internal Model

```typescript
interface NormalizedSnapshot {
  accountId: string;
  capturedAt: string;             // UTC ISO 8601
  provider: "codex" | "claude";
  windowId: string;               // resets_at based
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
  planType: string | null;
  sourceConfidence: "direct" | "estimated" | "unknown";
  rawPayload: unknown;            // original response as-is
}
```

---

## Display

Provider-separated view:

```
$ limitai status

--- codex-native (Pro) -----------------------
  Primary    ||||||||||....  72%  resets in 14m
  Secondary  |||...........  21%  resets in 3h 20m
  Credits    $12.40 remaining

--- codex-john-company (Team) ----------------
  Primary    |||...........  22%  resets in 8m

--- claude-local (Max $200) ------------------
  Block      ||||||........  45%  resets in 2h 33m
  (estimated from /stats)
```

```
$ limitai daily

--- Codex ------------------------------------
  02/13  12 windows  avg 67%  peak 94%
  02/12  8 windows   avg 45%  peak 72%

--- Claude -----------------------------------
  02/13  2 blocks    avg 58%  peak 91%
  02/12  3 blocks    avg 73%  peak 88%
```

---

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Language | TypeScript |
| CLI framework | gunshi |
| Validation | valibot |
| Database | better-sqlite3 |

---

## Reference Codebases (in analysis/)

| Path | Purpose |
|------|---------|
| `analysis/codex/codex-rs/core/src/auth/` | Codex auth.json schema, keyring storage |
| `analysis/codex/codex-rs/backend-client/src/client.rs` | API call logic (get_rate_limits_many) |
| `analysis/codex/codex-rs/protocol/src/protocol.rs` | RateLimitSnapshot types |
| `analysis/codex/codex-rs/codex-backend-openapi-models/` | API response schema |
| `analysis/codex/codex-rs/core/src/config/mod.rs` | find_codex_home(), config loading |
| `analysis/codex/codex-rs/utils/home-dir/src/lib.rs` | CODEX_HOME path resolution |
| `analysis/ccusage/apps/ccusage/src/` | JSONL parsing, daily/monthly aggregation reference |
| `analysis/ccusage/apps/codex/src/` | Codex JSONL parsing reference |
| `analysis/claude-code/CHANGELOG.md` | Claude Code auth history |
| `/Users/bjm/work/ai/github/CLIProxyAPI/` | Multi-provider proxy, auth file format |

### Key Reference Files

- `analysis/codex/codex-rs/core/src/auth/storage.rs` — AuthDotJson struct, keyring service name
- `analysis/codex/codex-rs/core/src/auth.rs` — Token loading/refresh logic
- `analysis/codex/codex-rs/backend-client/src/client.rs` — API call (get_rate_limits_many, PathStyle)
- `analysis/codex/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs` — Response schema

---

## Discoveries (from analysis phase)

1. **Claude Code is closed source.** analysis/claude-code/ repo has README, CHANGELOG, plugins only.
2. **No Anthropic personal usage API.** Admin API is org-only, requires `sk-ant-admin...` key.
3. **2026.01 Anthropic OAuth blocked.** 3rd-party tool subscription OAuth usage prohibited.
4. **Claude Code has built-in commands.** `/cost` (API users), `/stats` (subscribers) → JSON output possible.
5. **Codex auth_mode duality.** apiKey and chatgpt OAuth coexist in same auth.json → mode branching required.
6. **Keyring access constraints.** macOS prompts user, Linux needs libsecret, failure → graceful degradation.
7. **JSONL format unofficial.** ccusage uses it but Anthropic doesn't guarantee stability.
8. **Codex endpoints unofficial.** `/wham/usage` and `/api/codex/usage` are private APIs, may change.
9. **CLIProxyAPI ecosystem.** Quotio, ZeroLimit, vibeproxy etc. already exist as GUI quota trackers.

---

## Implementation Phases

| Phase | Scope | Estimate |
|-------|-------|----------|
| 1 | Project scaffold + Codex native auth.json → `status` | 1d |
| 2 | CLIProxyAPI auto-discovery + multi-account `status` | 0.5d |
| 3 | Claude CLI bridge (`/stats`) | 0.5d |
| 4 | SQLite + `install`/`uninstall` + adaptive polling | 1d |
| 5 | `daily` + `monthly` (snapshot aggregation) | 0.5d |
| 6 | `doctor` + `list` + error handling polish | 0.5d |
| **Total** | | **~4d** |
