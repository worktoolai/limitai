[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português](README.pt-BR.md)

# limitai

> 跨 Claude、Codex 和 CLIProxyAPI 监控 LLM rate limit 使用率的 CLI 工具

**你真的在充分利用 LLM 订阅额度吗？**

像 [ccusage](https://github.com/yohasebe/ccusage) 这类工具会告诉你消耗了多少 token，但这并不是最关键的问题。真正重要的是：**你实际使用了多少你正在支付的配额？** 如果你同时使用多个 Claude、Codex 或 proxy 服务的账号，目前没有一个地方能统一查看这些信息。

**limitai** 是为 LLM 深度用户打造的 **CLI rate limit 监控工具**。它在一个终端界面中展示你所有 provider/account 的 **rate limit 使用率** ——不是花了多少钱或消耗了多少 token，而是你离正在支付的额度上限还有多远，以及何时重置。

- **Multi-provider dashboard** — Claude (Anthropic)、Codex (OpenAI)、CLIProxyAPI 统一展示
- **Multi-account support** — 个人账号、团队账号、proxy 账号同时查看
- **Utilization-focused** — 追踪 rate limit 使用百分比，而非原始 token 数量
- **Zero config** — 自动发现本机上的 credential
- **Background recording** — 执行一次 `limitai install` 即可设置 LaunchAgent/systemd daemon，开启历史追踪

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

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

安装到 `~/.local/bin`，并自动更新你的 shell PATH。

### 选项

```bash
# 指定版本
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# 自定义安装目录
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### 卸载

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

删除二进制文件并清理 shell profile 中的 PATH 条目。

### 支持的平台

| 平台 | 架构 |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## 快速开始

```bash
# 查看当前 rate limit
limitai status

# 发现本机上的所有账号
limitai list
```

## 启用历史追踪

默认情况下，limitai 仅显示 **live** 快照。执行一次 `install` 即可解锁完整视图：

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### `install` 之后的变化

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

> **一条命令。无需 cron。无需配置文件。** 只需 `limitai install`，然后忘掉它。

### 你将获得

| 收益 | 详细说明 |
|---------|--------|
| **Daily utilization report** | 查看每个 account 在各时间窗口中的使用强度 |
| **Monthly trends** | 发现规律 — 比如你是否每周二都持续达到 90%+ |
| **Peak tracking** | 追踪每个时间窗口的最高使用率，而非平均值 |
| **Adaptive polling** | reset 临近时每 1 分钟轮询，其余时间 5–10 分钟 — 捕捉关键时刻 |
| **Survives reboots** | 使用 OS 原生调度器（LaunchAgent / systemd），而非脆弱的后台进程 |
| **30-day rolling history** | 原始快照保留 30 天，每日汇总永久保留 |
| **Zero maintenance** | 无需日志轮转，无磁盘膨胀问题，SQLite 全部搞定 |

### 内部工作原理

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

### 随时卸载

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## 全部命令

```bash
limitai status          # 实时 rate limit 仪表板（自动刷新）
limitai list            # 显示所有已发现的账号
limitai daily           # 每日使用率历史
limitai monthly         # 每月使用率历史
limitai install         # 启动后台记录 daemon
limitai uninstall       # 移除 daemon
limitai doctor          # 诊断连接问题
limitai watch           # 前台轮询循环
```

## 许可证

MIT
