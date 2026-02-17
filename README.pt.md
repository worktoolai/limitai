[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md)

# limitai

> Ferramenta CLI que monitora a utilização de limites de taxa de LLM em Claude, Codex e CLIProxyAPI

**Você está aproveitando ao máximo sua assinatura LLM?**

Ferramentas como [ccusage](https://github.com/yohasebe/ccusage) rastreiam quantos tokens você consumiu — mas essa não é a pergunta que importa. A verdadeira pergunta é: *quanto da cota que você está pagando você realmente está usando?* E se você gerencia múltiplas contas em Claude, Codex ou serviços proxy, não há um único lugar para ver tudo isso.

**limitai** é um **monitor CLI de limites de taxa** para usuários avançados de LLM. Ele mostra sua **utilização de limites de taxa** em cada conta e provedor em uma única visualização no terminal — não quanto você gastou, mas quão perto você está do teto que já está pagando, e quando esse teto é reiniciado.

- **Dashboard multi-provedor** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI em uma única visualização
- **Suporte multi-conta** — contas pessoais, de equipe e proxy, todas de uma vez
- **Foco em utilização** — rastreia a % de uso contra seu limite de taxa, não contagens brutas de tokens
- **Zero configuração** — descobre automaticamente as credenciais na sua máquina
- **Registro em segundo plano** — `limitai install` configura um daemon LaunchAgent/systemd para rastreamento histórico

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

## Instalação

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

Instala em `~/.local/bin` e atualiza o PATH do seu shell automaticamente.

### Opções

```bash
# Specific version
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Custom directory
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### Desinstalar

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

Remove o binário e limpa as entradas de PATH dos seus perfis de shell.

### Plataformas suportadas

| Plataforma | Arquitetura |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## Início Rápido

```bash
# See your rate limits right now
limitai status

# Discover all accounts on this machine
limitai list
```

## Habilitar Rastreamento Histórico

Por padrão, o limitai mostra apenas snapshots **ao vivo**. Execute `install` uma vez para desbloquear a visão completa:

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### O que muda depois do `install`

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

> **Um único comando. Sem cron. Sem arquivos de configuração.** Apenas `limitai install` e esqueça.

### O que você obtém

| Benefício | Detalhe |
|---------|--------|
| **Daily utilization report** | Veja o quanto você exigiu de cada conta, janela por janela |
| **Monthly trends** | Identifique padrões — você está consistentemente atingindo 90%+ às terças-feiras? |
| **Peak tracking** | Conheça seu maior uso por janela, não apenas a média |
| **Adaptive polling** | Consulta a cada 1 min perto dos reinícios, 5–10 min caso contrário — captura os momentos que importam |
| **Survives reboots** | Agendador nativo do SO (LaunchAgent / systemd) — não um processo frágil em segundo plano |
| **30-day rolling history** | Snapshots brutos mantidos por 30 dias, resumos diários mantidos para sempre |
| **Zero maintenance** | Sem rotação de logs, sem inchaço de disco. SQLite cuida de tudo |

### Como funciona internamente

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

### Desinstale a qualquer momento

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## Todos os Comandos

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

## Licença

MIT