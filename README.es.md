[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Français](README.fr.md)

# limitai

> Herramienta CLI que monitorea la utilización de límites de velocidad de LLM en Claude, Codex y CLIProxyAPI

**¿Estás aprovechando al máximo tu suscripción LLM?**

Herramientas como [ccusage](https://github.com/yohasebe/ccusage) rastrean cuántos tokens consumiste, pero esa no es la pregunta que importa. La verdadera pregunta es: *¿cuánto de la cuota que estás pagando estás realmente usando?* Y si manejas múltiples cuentas en Claude, Codex o servicios proxy, no hay un único lugar donde verlo todo.

**limitai** es un **monitor CLI de límites de velocidad** para usuarios avanzados de LLM. Muestra tu **utilización de límites de velocidad** en cada cuenta y proveedor en una sola vista de terminal — no cuánto gastaste, sino qué tan cerca estás del techo que ya estás pagando, y cuándo se reinicia ese techo.

- **Dashboard multi-proveedor** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI en una sola vista
- **Soporte multi-cuenta** — cuentas personales, de equipo y proxy, todas a la vez
- **Enfocado en utilización** — rastrea el % de uso contra tu límite de velocidad, no conteos de tokens brutos
- **Cero configuración** — descubre automáticamente las credenciales en tu máquina
- **Registro en segundo plano** — `limitai install` configura un daemon LaunchAgent/systemd para seguimiento histórico

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

## Instalación

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

Se instala en `~/.local/bin` y actualiza tu PATH del shell automáticamente.

### Opciones

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

Elimina el binario y limpia las entradas de PATH de tus perfiles de shell.

### Plataformas soportadas

| Plataforma | Arquitectura |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## Inicio Rápido

```bash
# See your rate limits right now
limitai status

# Discover all accounts on this machine
limitai list
```

## Habilitar Seguimiento Histórico

Por defecto, limitai solo muestra instantáneas **en vivo**. Ejecuta `install` una vez para desbloquear la imagen completa:

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### Qué cambia después de `install`

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

> **Un solo comando. Sin cron. Sin archivos de configuración.** Solo `limitai install` y olvídate.

### Lo que obtienes

| Beneficio | Detalle |
|---------|--------|
| **Daily utilization report** | Observa cuánto exigiste a cada cuenta, ventana por ventana |
| **Monthly trends** | Detecta patrones — ¿estás alcanzando consistentemente 90%+ los martes? |
| **Peak tracking** | Conoce tu uso más alto por ventana, no solo el promedio |
| **Adaptive polling** | Sondea cada 1 min cerca de los reincios, 5–10 min de lo contrario — captura los momentos que importan |
| **Survives reboots** | Planificador nativo del SO (LaunchAgent / systemd) — no un proceso frágil en segundo plano |
| **30-day rolling history** | Instantáneas brutas conservadas 30 días, resúmenes diarios conservados para siempre |
| **Zero maintenance** | Sin rotación de logs, sin inflado de disco. SQLite se encarga de todo |

### Cómo funciona internamente

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

### Desinstala en cualquier momento

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## Todos los Comandos

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

## Licencia

MIT
