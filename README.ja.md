[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português](README.pt-BR.md)

# limitai

> Claude、Codex、CLIProxyAPI の LLM rate limit 使用率を監視する CLI ツール

**LLM サブスクリプションの上限を本当に使い切っていますか？**

[ccusage](https://github.com/yohasebe/ccusage) のようなツールは、消費した token 数を教えてくれます。しかし、本当に重要な問いはそこではありません。**支払っている quota に対して、実際にどれだけ活用しているのか？** そして、Claude、Codex、proxy サービスで複数のアカウントを使い分けている場合、それらを一箇所で確認できる場所がありません。

**limitai** は LLM パワーユーザーのための **CLI rate limit モニター**です。支出額や raw token 消費量ではなく、各 provider/account における **rate limit 使用率** —— 支払っている上限にどれだけ近づいているか、そしてリセットがいつ来るかを、1つのターミナル画面で表示します。

- **Multi-provider dashboard** — Claude (Anthropic)、Codex (OpenAI)、CLIProxyAPI を一画面で
- **Multi-account support** — 個人・チーム・proxy アカウントをまとめて表示
- **Utilization-focused** — raw token 数ではなく、rate limit に対する使用率 % を追跡
- **Zero config** — ローカルマシンの credential を自動検出
- **Background recording** — `limitai install` 一回で LaunchAgent/systemd daemon を設定し、履歴追跡を開始

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

`~/.local/bin` にインストールされ、shell の PATH も自動で更新されます。

### オプション

```bash
# バージョン指定
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# カスタムディレクトリ
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### アンインストール

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

バイナリを削除し、shell profile に追加された PATH エントリもクリーンアップします。

### 対応プラットフォーム

| プラットフォーム | アーキテクチャ |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## クイックスタート

```bash
# 現在の rate limit を確認
limitai status

# このマシン上のすべてのアカウントを検出
limitai list
```

## 履歴追跡を有効にする

デフォルトでは limitai は **live** スナップショットのみを表示します。`install` を一度実行すれば、全体像が見えるようになります：

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### `install` 後に変わること

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

> **コマンド一発。cron 不要。設定ファイル不要。** `limitai install` を実行するだけです。

### 得られるもの

| メリット | 詳細 |
|---------|--------|
| **Daily utilization report** | 各アカウントの各ウィンドウでの使用度合いを確認 |
| **Monthly trends** | パターンを発見 — 毎週火曜日に 90%+ を安定的に記録していないか？ |
| **Peak tracking** | 平均ではなく、ウィンドウごとの最高使用率を追跡 |
| **Adaptive polling** | リセット付近では 1 分間隔、通常時は 5–10 分間隔 — 重要な瞬間を逃さない |
| **Survives reboots** | 脆弱なバックグラウンドプロセスではなく、OS ネイティブスケジューラ（LaunchAgent / systemd）を使用 |
| **30-day rolling history** | raw スナップショットは 30 日保持、日次ロールアップは永久保持 |
| **Zero maintenance** | ログローテーションもディスク肥大も不要。SQLite がすべて処理 |

### 内部の仕組み

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
limitai status          # ライブ rate limit ダッシュボード（自動更新）
limitai list            # 検出されたすべてのアカウントを表示
limitai daily           # 日次使用率履歴
limitai monthly         # 月次使用率履歴
limitai install         # バックグラウンド記録 daemon を開始
limitai uninstall       # daemon を削除
limitai doctor          # 接続問題を診断
limitai watch           # フォアグラウンド polling ループ
```

## ライセンス

MIT
