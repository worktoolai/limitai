# limitai

> CLI tool that monitors LLM rate limit utilization across Claude, Codex, and CLIProxyAPI

[한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Português](README.pt.md) | [Français](README.fr.md)

**Are you getting the most out of your LLM subscription?**

Tools like [ccusage](https://github.com/yohasebe/ccusage) track how many tokens you consumed — but that's not the question that matters. The real question is: *how much of the quota you're paying for are you actually using?* And if you juggle multiple accounts across Claude, Codex, or proxy services, there's no single place to see it all.

**limitai** is a **CLI rate limit monitor** for LLM power users. It shows your **rate limit utilization** across every account and provider in one terminal view — not how much you spent, but how close you are to the ceiling you're already paying for, and when that ceiling resets.

- **Multi-provider dashboard** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI in one view
- **Multi-account support** — personal, team, proxy accounts all at once
- **Utilization-focused** — track usage % against your rate limit, not raw token counts
- **Zero config** — auto-discovers credentials from your machine
- **Background recording** — `limitai install` sets up a LaunchAgent/systemd daemon for historical tracking

<table align="center">
  <tr>
    <td colspan="2" align="center">
      <code>limitai status</code><br><br>
      <img src="img/status.png" alt="limitai status" width="600">
    </td>
  </tr>
  <tr>
    <td align="center">
      <code>limitai daily</code><br><br>
      <img src="img/daily.png" alt="limitai daily" width="400">
    </td>
    <td align="center">
      <code>limitai monthly</code><br><br>
      <img src="img/monthly.png" alt="limitai monthly" width="400">
    </td>
  </tr>
</table>

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
