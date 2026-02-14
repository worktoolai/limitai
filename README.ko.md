[English](README.md)

# limitai

> CLI tool that monitors LLM rate limit utilization across Claude, Codex, and CLIProxyAPI

**LLM 구독 한도를 정말 최대로 활용하고 있나요?**

[ccusage](https://github.com/yohasebe/ccusage) 같은 도구는 내가 얼마나 많은 token을 소비했는지 보여줍니다. 하지만 limitai가 집중하는 핵심은 다릅니다. 진짜 중요한 질문은 **내가 지불하는 한도 대비 얼마나 효율적으로 사용하는가**입니다. 그리고 Claude, Codex, proxy 서비스에 걸쳐 여러 provider/account를 동시에 운용한다면, 이를 한눈에 통합해서 볼 수 있는 곳이 필요합니다.

**limitai**는 LLM 파워 유저를 위한 **CLI rate limit monitor**입니다. 지출 금액이나 raw token 소비량이 아니라, 각 provider/account에서 현재 한도 상한선에 얼마나 근접했는지와 reset 시점을 한 터미널 화면에서 보여줍니다.

- **Multi-provider dashboard** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI를 한 화면에서
- **Multi-account support** — 개인, 팀, proxy account를 동시에
- **Utilization-focused** — raw token 수치가 아니라 rate limit 대비 usage % 추적
- **Zero config** — 로컬 머신의 credential을 자동 탐지
- **Background recording** — `limitai install` 한 번으로 LaunchAgent/systemd daemon 설정 및 히스토리 추적

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

## 설치

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

`~/.local/bin`에 설치되고, shell PATH도 자동으로 업데이트됩니다.

### 옵션

```bash
# Specific version
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Custom directory
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### 제거

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

binary를 제거하고 shell profile에 추가된 PATH 항목도 정리합니다.

### 지원 플랫폼

| 플랫폼 | 아키텍처 |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## 빠른 시작

```bash
# See your rate limits right now
limitai status

# Discover all accounts on this machine
limitai list
```

## 히스토리 추적 활성화

기본적으로 limitai는 **live** snapshot만 보여줍니다. `install`을 한 번 실행하면 전체 그림을 볼 수 있습니다.

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### `install` 이후 달라지는 점

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

> **명령어 한 번. cron 없음. config 파일 없음.** `limitai install`만 실행하면 끝입니다.

### 얻을 수 있는 것

| 혜택 | 세부 내용 |
|---------|--------|
| **Daily utilization report** | 각 account를 window별로 얼마나 강하게 사용했는지 확인 |
| **Monthly trends** | 패턴 파악 — 예: 매주 화요일마다 90%+를 꾸준히 치는지 |
| **Peak tracking** | 평균이 아니라 window별 최고 usage 추적 |
| **Adaptive polling** | reset 근처에서는 1분, 평소에는 5–10분 간격 polling — 중요한 순간을 놓치지 않음 |
| **Survives reboots** | 취약한 백그라운드 프로세스가 아니라 OS 기본 스케줄러(LaunchAgent / systemd) 사용 |
| **30-day rolling history** | raw snapshot은 30일 보관, 일별 rollup은 영구 보관 |
| **Zero maintenance** | log rotation이나 디스크 팽창 걱정 없이 SQLite가 처리 |

### 내부 동작 방식

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

### 언제든 제거 가능

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## 전체 명령어

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

## 라이선스

MIT
