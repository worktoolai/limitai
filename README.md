# limitai

Stop guessing your LLM rate limits. **limitai** shows exactly how much of your Codex, Claude, and CLIProxyAPI quota you've used — and when it resets.

```
$ limitai status

--- codex-native (Pro) --------------------------
  Primary    ||||||||||.... 71%  resets in 2h 14m
  Secondary  |||...........  8%  resets in 23h 51m

--- claude-cli -----------------------------------
  Primary    ||||..........  29%  resets in 3h 45m

--- codex-john-company (Pro) ---------------------
  Primary    |||||||||||||. 94%  resets in 12m
  Secondary  ||||||........  43%  resets in 5h 2m
```

No config needed. Just run it.

## Why

- **"Am I about to hit my limit?"** — See usage percentage at a glance, across all accounts
- **"When does it reset?"** — Countdown to your next rate limit window
- **Live dashboard** — `limitai status` auto-refreshes in your terminal
- **Historical tracking** — Run `limitai install` once, get rolling daily/monthly usage trends (raw snapshots kept for 30 days)
- **Zero config** — Auto-discovers Codex, Claude CLI, and CLIProxyAPI accounts from your machine

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

Installs to `~/.local/bin` and updates your shell PATH automatically.

### Options

```bash
# Specific version
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Custom directory
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

Removes the binary and cleans up PATH entries from your shell profiles.

### Supported platforms

| Platform | Architecture |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## Quick Start

```bash
# See your rate limits right now
limitai status

# Discover all accounts on this machine
limitai list
```

## Enable Historical Tracking

By default, limitai only shows **live** snapshots. Run `install` once to unlock the full picture:

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### What changes after `install`

```
                    Before                              After
              ┌──────────────────┐             ┌──────────────────────────┐
              │                  │             │                          │
              │  limitai status  │             │  limitai status          │
              │  (live only)     │             │  limitai daily    ← NEW  │
              │                  │             │  limitai monthly  ← NEW  │
              │                  │             │                          │
              └──────────────────┘             └──────────────────────────┘
                  Manual run                      Automatic background
                  Point-in-time                   Continuous recording
```

> **One command. No cron. No config files.** Just `limitai install` and forget about it.

### What you get

| Benefit | Detail |
|---------|--------|
| **Daily utilization report** | See how hard you pushed each account, window by window |
| **Monthly trends** | Spot patterns — are you consistently hitting 90%+ on Tuesdays? |
| **Peak tracking** | Know your highest usage per window, not just the average |
| **Adaptive polling** | Polls every 1 min near resets, 5–10 min otherwise — captures the moments that matter |
| **Survives reboots** | Native OS scheduler (LaunchAgent / systemd) — not a fragile background process |
| **30-day rolling history** | Raw snapshots kept 30 days, daily rollups kept forever |
| **Zero maintenance** | No log rotation, no disk bloat. SQLite handles it all |

### `limitai daily` — unlocked after install

```
$ limitai daily

02/13  claude █████████░  91% │ codex  █████████░  94%
02/12  claude ████████░░  88% │ codex  ███████░░░  72%
02/11  claude ██████░░░░  58% │ codex  ████████░░  81%
```

### `limitai monthly` — unlocked after install

```
$ limitai monthly

2026-02  claude █████████░  92% │ codex  ██████████  97%
2026-01  claude ████████░░  78% │ codex  █████████░  85%
```

### How it works under the hood

```
┌──────────────┐     poll      ┌───────────────┐    store     ┌──────────────┐
│  Codex API   │◄─────────────►│               │─────────────►│              │
│  Claude CLI  │   every 1-10  │   limitai     │              │   SQLite     │
│  CLIProxyAPI │   min (smart) │   background  │              │   ~/.limitai │
└──────────────┘               │   daemon      │              │   /data.db   │
                               └───────────────┘              └──────┬───────┘
                                                                     │
                                                        ┌────────────┼────────────┐
                                                        │            │            │
                                                        ▼            ▼            ▼
                                                   limitai      limitai      limitai
                                                    status       daily       monthly
```

### Uninstall anytime

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## All Commands

```bash
limitai status          # Live rate limit dashboard (auto-refreshes)
limitai list            # Show all discovered accounts
limitai daily           # Daily utilization history
limitai monthly         # Monthly utilization history
limitai install         # Start background recording daemon
limitai uninstall       # Remove daemon
limitai doctor          # Diagnose connection issues
limitai watch           # Run foreground polling loop
```

## License

MIT
