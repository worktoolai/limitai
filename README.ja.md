[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [Português](README.pt.md) | [Français](README.fr.md)

# limitai

> Claude、Codex、CLIProxyAPI にまたがる LLM レート制限の利用状況を監視する CLI ツール

**LLM サブスクリプションの上限を本当にフル活用できていますか？**

[ccusage](https://github.com/yohasebe/ccusage) のようなツールは消費したトークン数を追跡しますが、本当に重要な問いはそこではありません。真の問いは：**支払っているクォータのうち、実際にどれだけ使っているか？** そして Claude、Codex、プロキシサービスをまたいで複数のアカウントを使い分けているなら、すべてを一箇所で確認できる場所はありません。

**limitai** は LLM パワーユーザーのための **CLI レート制限モニター**です。支出額や生のトークン消費量ではなく、すべてのアカウントとプロバイダーにおける**レート制限の利用率**を一つのターミナルビューで表示します——支払っている上限にどれだけ近づいているか、そしてその上限がいつリセットされるかを表示します。

- **マルチプロバイダーダッシュボード** — Claude (Anthropic)、Codex (OpenAI)、CLIProxyAPI を一画面で
- **マルチアカウント対応** — 個人、チーム、プロキシアカウントを同時に
- **利用率重視** — 生のトークン数ではなく、レート制限に対する使用率 % を追跡
- **設定不要** — ローカルマシンの認証情報を自動検出
- **バックグラウンド記録** — `limitai install` 一つで LaunchAgent/systemd デーモンを設定し、履歴を追跡

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

## インストール

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

`~/.local/bin` にインストールされ、シェルの PATH も自動的に更新されます。

### オプション

```bash
# Specific version
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Custom directory
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### アンインストール

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

バイナリを削除し、シェルプロファイルに追加された PATH エントリもクリーンアップします。

### 対応プラットフォーム

| プラットフォーム | アーキテクチャ |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## クイックスタート

```bash
# See your rate limits right now
limitai status

# Discover all accounts on this machine
limitai list
```

## 履歴追跡を有効にする

デフォルトでは、limitai は**ライブ**スナップショットのみを表示します。`install` を一度実行するだけで全体像を把握できます：

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### `install` 後の変化

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

> **コマンド一つ。cron 不要。設定ファイル不要。** `limitai install` を実行するだけで完了です。

### 得られるもの

| メリット | 詳細 |
|---------|--------|
| **Daily utilization report** | 各アカウントのウィンドウごとの使用強度を確認 |
| **Monthly trends** | パターンを発見——例えば毎週火曜日に常に 90%+ に達しているか |
| **Peak tracking** | 平均ではなく、ウィンドウごとの最大使用量を追跡 |
| **Adaptive polling** | リセット時刻付近では 1 分間隔、それ以外は 5〜10 分間隔——重要な瞬間を逃さない |
| **Survives reboots** | 脆弱なバックグラウンドプロセスではなく、OS ネイティブスケジューラ（LaunchAgent / systemd）を使用 |
| **30-day rolling history** | 生のスナップショットは 30 日間保持、日次ロールアップは永久保持 |
| **Zero maintenance** | ログローテーションやディスク肥大の心配なし。SQLite がすべて処理 |

### 内部動作の仕組み

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

### いつでもアンインストール可能

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## 全コマンド

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

## ライセンス

MIT
