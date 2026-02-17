[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md)

# limitai

> Ferramenta CLI que monitora a utilização de rate limit de LLM no Claude, Codex e CLIProxyAPI

**Você está realmente aproveitando ao máximo sua assinatura de LLM?**

Ferramentas como [ccusage](https://github.com/yohasebe/ccusage) mostram quantos tokens você consumiu — mas essa não é a pergunta que importa. A pergunta real é: *quanto da cota que você está pagando você realmente usa?* E se você gerencia múltiplas contas entre Claude, Codex ou serviços proxy, não existe um lugar único para visualizar tudo.

**limitai** é um **monitor CLI de rate limit** para usuários avançados de LLM. Ele mostra sua **utilização de rate limit** em cada conta e provider em uma única visão no terminal — não quanto você gastou, mas quão perto você está do teto que já está pagando, e quando esse teto reinicia.

- **Multi-provider dashboard** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI em uma única visão
- **Multi-account support** — contas pessoais, de equipe e proxy, todas de uma vez
- **Utilization-focused** — rastreia a % de uso contra seu rate limit, não quantidades brutas de tokens
- **Zero config** — detecta automaticamente as credenciais da sua máquina
- **Background recording** — `limitai install` configura um daemon LaunchAgent/systemd para rastreamento histórico

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
# Versão específica
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Diretório personalizado
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

## Início rápido

```bash
# Ver seus rate limits agora
limitai status

# Descobrir todas as contas nesta máquina
limitai list
```

## Habilitar rastreamento histórico

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

### O que muda após `install`

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

> **Um comando. Sem cron. Sem arquivos de configuração.** Apenas `limitai install` e esqueça.

### O que você obtém

| Benefício | Detalhe |
|---------|--------|
| **Daily utilization report** | Veja o quão intensamente você usou cada conta, janela por janela |
| **Monthly trends** | Identifique padrões — você está consistentemente atingindo 90%+ às terças-feiras? |
| **Peak tracking** | Conheça seu maior uso por janela, não apenas a média |
| **Adaptive polling** | Consulta a cada 1 min perto de resets, 5–10 min caso contrário — captura os momentos que importam |
| **Survives reboots** | Scheduler nativo do OS (LaunchAgent / systemd) — não um processo frágil em segundo plano |
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

### Desinstalar a qualquer momento

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## Todos os comandos

```bash
limitai status          # Dashboard de rate limit ao vivo (atualização automática)
limitai list            # Mostrar todas as contas descobertas
limitai daily           # Histórico de utilização diária
limitai monthly         # Histórico de utilização mensal
limitai install         # Iniciar daemon de gravação em segundo plano
limitai uninstall       # Remover daemon
limitai doctor          # Diagnosticar problemas de conexão
limitai watch           # Executar loop de polling em primeiro plano
```

## Licença

MIT
